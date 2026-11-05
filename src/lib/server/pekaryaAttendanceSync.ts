import { createHash, randomUUID } from 'node:crypto';
import admin, { adminDb } from '@/lib/firebase-admin';
import {
  ATTENDANCE_PAYROLL_START_PERIOD,
  attendancePublicationMatchesPolicy,
} from '@/lib/payroll/attendance';
import {
  attendanceSyncSource,
  buildAutoPublishedEntries,
} from '@/lib/payroll/pekaryaAttendanceSync';
import { presenceBonusColumnKey } from '@/lib/payroll/pekaryaPresenceBonus';
import { ALL_BLUE_COLLAR_CATEGORY } from '@/lib/payroll/pekaryaSpj';
import {
  PEKARYA_PUBLICATIONS_COLLECTION,
  pekaryaPublicationId,
} from './attendanceStore';
import { autoLeaveStateRef } from './automaticLeavePosting';
import { HttpError, type AuthenticatedProfile } from './auth';
import {
  buildPekaryaAttendanceView,
  listActivePekaryaAttendanceCategories,
  loadAttendanceViewContext,
  type AttendanceViewContext,
} from './pekaryaAttendance';
import { ensurePekaryaAutoLeave } from './pekaryaAutoLeave';
import { isPeriodClosed } from './payrollPeriod';
import {
  propagateUraianToDraftSlips,
  UraianChangedDuringPropagation,
  uraianDocumentId,
} from './uraianSlipPropagation';

/**
 * Pekarya attendance reaches the Uraian rekap and the draft payslips on its
 * own: every command that changes what a worker is owed calls
 * `syncPekaryaAttendance` after it commits, and the Presensi Pekarya page
 * calls it on every load through the auto-leave route. There is no Publish
 * step any more.
 *
 * For each category the sync rebuilds the attendance view, writes it into
 * `UraianGaji` and the `PekaryaAttendancePublications` record, then overlays
 * the attendance rows onto the category's draft slips. Locked and paid slips
 * are never rewritten (a drift notice is recorded instead), closed periods are
 * left alone, and an employee without a unique NIPY is held on their own.
 *
 * A sync never fails the command that triggered it: its outcome is recorded in
 * `PekaryaAttendanceSyncStates` for the page to show, with a retry button.
 */

export const PEKARYA_ATTENDANCE_SYNC_STATES_COLLECTION = 'PekaryaAttendanceSyncStates';

export type PekaryaSyncTrigger =
  | 'attendance_import'
  | 'attendance_correction'
  | 'manual_link'
  | 'official_leave'
  | 'paid_leave'
  | 'ganti_libur'
  | 'calendar'
  | 'driver_journey'
  | 'page_reconcile'
  | 'manual_retry';

export interface PekaryaCategorySyncResult {
  category: string;
  status: 'synced' | 'unchanged' | 'skipped' | 'failed';
  reason?: string;
  heldEmployees?: Array<{ employeeId: string; name: string; reason: string }>;
  slipSummary?: Record<string, number>;
}

export interface PekaryaSyncOptions {
  /** The caller already reconciled automatic leave for these categories. */
  autoLeaveReconciled?: boolean;
  /**
   * The command changed only these employees and has already patched their
   * rekap entries. While the publication is current, only their slips are
   * updated instead of rebuilding the whole category.
   */
  employeeIds?: readonly string[];
}

const MAX_ATTEMPTS = 3;

/** Another write landed while this sync was reading; it starts over. */
export class AttendanceSyncConflict extends Error {}

export function pekaryaSyncStateRef(period: string, category: string) {
  return adminDb
    .collection(PEKARYA_ATTENDANCE_SYNC_STATES_COLLECTION)
    .doc(`${period.replace('-', '_')}__${category}`);
}

function sameDocumentVersion(
  left: FirebaseFirestore.DocumentSnapshot,
  right: FirebaseFirestore.DocumentSnapshot,
): boolean {
  if (!left.exists || !right.exists) return left.exists === right.exists;
  return Boolean(left.updateTime && right.updateTime && left.updateTime.isEqual(right.updateTime));
}

function periodLabel(period: string): string {
  const [year, month] = period.split('-').map(Number);
  const months = [
    'Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni',
    'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember',
  ];
  return `${months[month - 1]} ${year}`;
}

/**
 * Every non-Satpam category, the same set "Publikasikan Semua" used to cover.
 * Categories without Harian columns (the Ponti ones) are included too: closing
 * a period requires a current publication for each of them.
 */
export function syncableAttendanceCategories(categories: readonly string[]): string[] {
  return Array.from(new Set(categories.map((item) => item.trim().toUpperCase())))
    .filter((category) => category && category !== 'SATPAM' && category !== ALL_BLUE_COLLAR_CATEGORY);
}

function publicationIsCurrent(
  publication: FirebaseFirestore.DocumentData | undefined,
  view: { singleScanPolicy: Parameters<typeof attendancePublicationMatchesPolicy>[1]; importRevisionId: string; calendarRevision: number },
): boolean {
  return Boolean(
    publication &&
      publication.state === 'published' &&
      publication.stale !== true &&
      attendancePublicationMatchesPolicy(publication, view.singleScanPolicy) &&
      publication.importRevisionId === view.importRevisionId &&
      Number(publication.calendarRevision || 0) === view.calendarRevision,
  );
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'Sinkronisasi presensi gagal.';
}

/**
 * Writes one category's attendance into the rekap and its publication record
 * in one transaction. Throws AttendanceSyncConflict when anything it read has
 * moved since the view was built, so an older sync can never overwrite a
 * newer one.
 */
export async function writeAutomaticPublication(input: {
  period: string;
  category: string;
  view: Awaited<ReturnType<typeof buildPekaryaAttendanceView>>;
  publicationBefore: FirebaseFirestore.DocumentSnapshot;
  expectedAutoRevision: number;
  fingerprint: string;
  actor: AuthenticatedProfile;
  trigger: PekaryaSyncTrigger;
}) {
  const { period, category, view } = input;
  const publicationRef = adminDb
    .collection(PEKARYA_PUBLICATIONS_COLLECTION)
    .doc(pekaryaPublicationId(period, category));
  const uraianRef = adminDb
    .collection('UraianGaji')
    .doc(uraianDocumentId(period.replace('-', '_'), category));
  const bonusKey = presenceBonusColumnKey(category);
  return adminDb.runTransaction(async (transaction) => {
    const [autoState, publication, uraian, periodSnapshot, importSnapshot] = await transaction.getAll(
      autoLeaveStateRef(period, category),
      publicationRef,
      uraianRef,
      adminDb.collection('PayrollPeriods').doc(period),
      adminDb.collection('AttendanceImports').doc(period),
    );
    if (isPeriodClosed(periodSnapshot.data())) {
      throw new HttpError(409, 'Periode payroll sudah ditutup permanen.');
    }
    if (
      autoState.data()?.dirty === true ||
      Number(autoState.data()?.revision || 0) !== input.expectedAutoRevision ||
      !sameDocumentVersion(publication, input.publicationBefore) ||
      String(importSnapshot.data()?.activeRevisionId || '') !== view.importRevisionId ||
      Number((periodSnapshot.data()?.workCalendar as { revision?: number } | undefined)?.revision || 1) !==
        view.calendarRevision
    ) {
      throw new AttendanceSyncConflict();
    }
    const publicationRevision = Number(publication.data()?.publicationRevision || 0) + 1;
    const existingEntries =
      uraian.exists && uraian.data()?.entries && typeof uraian.data()?.entries === 'object'
        ? (uraian.data()!.entries as Record<string, Record<string, unknown>>)
        : {};
    const { entries, heldEmployees, totals } = buildAutoPublishedEntries(existingEntries, view, {
      bonusKey,
      publicationRevision,
    });
    const now = admin.firestore.FieldValue.serverTimestamp();
    const attendancePublication = {
      singleScanPolicy: view.singleScanPolicy,
      importRevisionId: view.importRevisionId,
      calendarRevision: view.calendarRevision,
      publicationRevision,
    };
    // `update` replaces the whole entries map, so a cleared hold really goes.
    if (uraian.exists) {
      transaction.update(uraianRef, { entries, attendancePublication, updatedAt: now });
    } else {
      transaction.set(uraianRef, {
        period,
        periodLabel: periodLabel(period),
        jobCategory: category,
        entries,
        attendancePublication,
        updatedAt: now,
      });
    }
    transaction.set(
      publicationRef,
      {
        period,
        category,
        state: 'published',
        stale: false,
        staleReason: admin.firestore.FieldValue.delete(),
        staleAt: admin.firestore.FieldValue.delete(),
        requiredCalendarRevision: admin.firestore.FieldValue.delete(),
        singleScanPolicy: view.singleScanPolicy,
        importRevision: view.importRevision,
        importRevisionId: view.importRevisionId,
        calendarRevision: view.calendarRevision,
        publicationRevision,
        acknowledgedWarnings: [],
        employeeCount: totals.employeeCount,
        heldEmployeeIds: heldEmployees.map((employee) => employee.employeeId),
        totals: { harian: totals.harian, jumatLibur: totals.jumatLibur, amount: totals.amount },
        publishMode: 'automatic',
        trigger: input.trigger,
        sourceFingerprint: input.fingerprint,
        publishedBy: input.actor.uid,
        publishedAt: now,
        updatedAt: now,
      },
      { merge: true },
    );
    return { publicationRevision, heldEmployees };
  });
}

interface CategoryAttempt {
  category: string;
  publicationBefore: FirebaseFirestore.DocumentSnapshot;
  stateBefore: FirebaseFirestore.DocumentSnapshot;
  expectedAutoRevision: number;
}

async function syncCategory(
  period: string,
  attempt: CategoryAttempt,
  context: AttendanceViewContext,
  actor: AuthenticatedProfile,
  trigger: PekaryaSyncTrigger,
  options: PekaryaSyncOptions,
): Promise<PekaryaCategorySyncResult> {
  const { category, publicationBefore, stateBefore } = attempt;
  const periodKey = period.replace('-', '_');
  const command = {
    scope: 'pekarya' as const,
    periodKey,
    periodToken: period,
    jobCategory: category,
    requestId: `attendance-sync-${randomUUID()}`,
  };

  const view = await buildPekaryaAttendanceView(period, category, { allowMissingActiveImport: true }, context);
  if (!view.importRevisionId) {
    return { category, status: 'skipped', reason: 'Belum ada import presensi aktif.' };
  }
  const fingerprint = createHash('sha256')
    .update(attendanceSyncSource(view, presenceBonusColumnKey(category)))
    .digest('hex');
  const current = publicationIsCurrent(publicationBefore.data(), view);

  // A command that already patched its own employees' rekap entries only
  // needs those employees' slips refreshed — unless an earlier sync failed,
  // which leaves other slips behind too.
  if (
    current &&
    options.employeeIds &&
    options.employeeIds.length > 0 &&
    stateBefore.data()?.status !== 'failed'
  ) {
    const propagation = await propagateUraianToDraftSlips(command, actor, {
      autoLeaveReconciled: true,
      employeeIds: options.employeeIds,
    });
    return {
      category,
      status: 'synced',
      heldEmployees: stateBefore.data()?.heldEmployees || [],
      slipSummary: propagation.summary,
    };
  }

  const published = current && publicationBefore.data()?.sourceFingerprint === fingerprint;
  if (published && stateBefore.data()?.propagatedFingerprint === fingerprint && stateBefore.data()?.status === 'ok') {
    return { category, status: 'unchanged', heldEmployees: stateBefore.data()?.heldEmployees || [] };
  }

  let heldEmployees: PekaryaCategorySyncResult['heldEmployees'] = stateBefore.data()?.heldEmployees || [];
  if (!published) {
    const written = await writeAutomaticPublication({
      period,
      category,
      view,
      publicationBefore,
      expectedAutoRevision: attempt.expectedAutoRevision,
      fingerprint,
      actor,
      trigger,
    });
    heldEmployees = written.heldEmployees;
  }
  const propagation = await propagateUraianToDraftSlips(command, actor, { autoLeaveReconciled: true });
  await pekaryaSyncStateRef(period, category).set(
    {
      period,
      category,
      status: 'ok',
      error: admin.firestore.FieldValue.delete(),
      heldEmployees,
      propagatedFingerprint: fingerprint,
      slipSummary: propagation.summary,
      trigger,
      actorUid: actor.uid,
      syncedAt: admin.firestore.FieldValue.serverTimestamp(),
    },
    { merge: true },
  );
  return { category, status: 'synced', heldEmployees, slipSummary: propagation.summary };
}

/**
 * Brings the Uraian rekap and the draft payslips of these categories up to
 * date with the current attendance. Never throws: each category's outcome is
 * returned and recorded.
 */
export async function syncPekaryaAttendance(
  period: string,
  categories: readonly string[] | 'ALL',
  actor: AuthenticatedProfile,
  trigger: PekaryaSyncTrigger,
  options: PekaryaSyncOptions = {},
): Promise<PekaryaCategorySyncResult[]> {
  try {
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(period) || period < ATTENDANCE_PAYROLL_START_PERIOD) return [];
    const requested = syncableAttendanceCategories(
      categories === 'ALL' ? await listActivePekaryaAttendanceCategories(period) : categories,
    );
    if (requested.length === 0) return [];
    const [periodSnapshot, importSnapshot] = await Promise.all([
      adminDb.collection('PayrollPeriods').doc(period).get(),
      adminDb.collection('AttendanceImports').doc(period).get(),
    ]);
    if (isPeriodClosed(periodSnapshot.data())) {
      return requested.map((category) => ({ category, status: 'skipped', reason: 'Periode sudah ditutup.' }));
    }
    if (!importSnapshot.data()?.activeRevisionId) {
      return requested.map((category) => ({ category, status: 'skipped', reason: 'Belum ada import presensi aktif.' }));
    }

    const results = new Map<string, PekaryaCategorySyncResult>();
    let pending = requested;
    let autoLeaveReconciled = options.autoLeaveReconciled === true;
    for (let round = 1; round <= MAX_ATTEMPTS && pending.length > 0; round += 1) {
      // Leave reconciliation runs first unless the caller just did it; a
      // category left dirty (by the caller or by a command since) runs again.
      const needLeave = autoLeaveReconciled
        ? (await Promise.all(pending.map(async (category) =>
            (await autoLeaveStateRef(period, category).get()).data()?.dirty === true ? category : null,
          ))).filter((category): category is string => Boolean(category))
        : pending;
      if (needLeave.length > 0) {
        try {
          await ensurePekaryaAutoLeave(period, actor, needLeave);
        } catch (error) {
          for (const category of needLeave) results.set(category, { category, status: 'failed', reason: errorMessage(error) });
          pending = pending.filter((category) => !needLeave.includes(category));
          if (pending.length === 0) break;
        }
      }
      // Read each category's publication before any source, so a command that
      // commits after these reads is always noticed by the write below.
      const attempts: CategoryAttempt[] = await Promise.all(
        pending.map(async (category) => {
          const [publicationBefore, stateBefore, autoState] = await Promise.all([
            adminDb.collection(PEKARYA_PUBLICATIONS_COLLECTION).doc(pekaryaPublicationId(period, category)).get(),
            pekaryaSyncStateRef(period, category).get(),
            autoLeaveStateRef(period, category).get(),
          ]);
          return {
            category,
            publicationBefore,
            stateBefore,
            expectedAutoRevision: Number(autoState.data()?.revision || 0),
          };
        }),
      );
      const context = await loadAttendanceViewContext(period, { allowMissingActiveImport: true });
      const retry: string[] = [];
      for (const attempt of attempts) {
        try {
          results.set(attempt.category, await syncCategory(period, attempt, context, actor, trigger, options));
        } catch (error) {
          const conflict = error instanceof AttendanceSyncConflict || error instanceof UraianChangedDuringPropagation;
          if (conflict && round < MAX_ATTEMPTS) {
            retry.push(attempt.category);
          } else {
            results.set(attempt.category, {
              category: attempt.category,
              status: 'failed',
              reason: conflict ? 'Data presensi terus berubah; sinkronisasi dicoba lagi saat halaman dimuat.' : errorMessage(error),
            });
          }
        }
      }
      pending = retry;
      // A retry rebuilds from fresh reads. Leave reconciliation runs again only
      // for a category a newer command left dirty.
      autoLeaveReconciled = true;
    }

    const failed = [...results.values()].filter((result) => result.status === 'failed');
    await Promise.all(
      failed.map((result) =>
        pekaryaSyncStateRef(period, result.category).set(
          {
            period,
            category: result.category,
            status: 'failed',
            error: result.reason || 'Sinkronisasi presensi gagal.',
            trigger,
            actorUid: actor.uid,
            failedAt: admin.firestore.FieldValue.serverTimestamp(),
          },
          { merge: true },
        ).catch((error) => console.error('Gagal mencatat status sinkronisasi presensi:', error)),
      ),
    );
    for (const result of failed) {
      console.error(`Sinkronisasi presensi ${result.category} ${period} gagal (${trigger}):`, result.reason);
    }
    return requested.map((category) => results.get(category) || { category, status: 'skipped' });
  } catch (error) {
    console.error(`Sinkronisasi presensi ${period} gagal (${trigger}):`, error);
    return (categories === 'ALL' ? [] : syncableAttendanceCategories(categories)).map((category) => ({
      category,
      status: 'failed',
      reason: errorMessage(error),
    }));
  }
}
