import { createHash } from 'node:crypto';
import { NextRequest } from 'next/server';
import admin, { adminDb } from '@/lib/firebase-admin';
import { buildFinancialAuditRecord, newFinancialAuditRef } from '@/lib/server/audit';
import {
  errorResponse,
  HttpError,
  requireAuthenticatedProfile,
  requireRole,
} from '@/lib/server/auth';
import { pekaryaPayrollWindow } from '@/lib/payroll/pekaryaSpj';
import {
  ATTENDANCE_PAYROLL_START_PERIOD,
} from '@/lib/payroll/attendance';
import {
  normalizePeriodPremiumDates,
  periodCalendarFromData,
} from '@/lib/payroll/calendar';
import { isSatpamDutyPlanRequired } from '@/lib/payroll/satpamDutyPlan';
import { validateMoneyFields } from '@/lib/payroll/domain';
import {
  buildPayrollRoster,
  missingPayrollRosterEntries,
  PayrollRosterEntry,
} from '@/lib/payroll/payrollRoster';
import {
  ATTENDANCE_IMPORTS_COLLECTION,
  PEKARYA_PUBLICATIONS_COLLECTION,
  loadAttendanceEmployeeIdentities,
  pekaryaPublicationId,
} from '@/lib/server/attendanceStore';
import { syncSatpamDutyReconciliation } from '@/lib/server/satpamDutyPlan';
import {
  hashKoperasiInstallmentPlan,
  KoperasiInstallmentPlan,
  koperasiLoanDeduction,
} from '@/lib/server/koperasiPayrollBridge';
import {
  isPeriodClosed,
  isPeriodMaterialized,
  livePeriodWindow,
} from '@/lib/server/payrollPeriod';

export const dynamic = 'force-dynamic';

type AttendanceStatus = 'open' | 'closed';
const LEGACY_ROSTER_REPAIR_PERIOD = '2026-07';

function hasPayrollRosterSeal(data: FirebaseFirestore.DocumentData | undefined): boolean {
  return data?.payrollRosterSeal?.schemaVersion === 1;
}

function payrollRosterHash(entries: readonly PayrollRosterEntry[]): string {
  return createHash('sha256')
    .update(JSON.stringify(entries.map((entry) => ({
      employeeId: entry.employeeId,
      employeeCollection: entry.employeeCollection,
    }))))
    .digest('hex');
}

export async function GET(request: NextRequest) {
  try {
    await requireAuthenticatedProfile(request);
    const snapshot = await adminDb.collection('PayrollPeriods').get();
    const byPeriod = new Map(
      snapshot.docs
        .filter((document) => /^\d{4}-\d{2}$/.test(document.id))
        .map((document) => [document.id, document.data()]),
    );

    // Periods accept input by default, so the answer is no longer "which
    // documents say open" -- an untouched month has no document at all. The
    // reportable set is the live window around today plus any existing period
    // that has not been permanently closed.
    const candidates = new Set<string>(byPeriod.keys());
    for (const period of livePeriodWindow()) candidates.add(period);

    const openPeriods = Array.from(candidates)
      .filter((period) => !isPeriodClosed(byPeriod.get(period)))
      .map((period) => {
        const window = pekaryaPayrollWindow(period);
        const calendar = periodCalendarFromData(period, byPeriod.get(period));
        return {
          period,
          startDate: window.startsOn,
          endDate: window.endsOn,
          calendarRevision: calendar.revision,
          premiumDates: calendar.premiumDates,
          materialized: isPeriodMaterialized(byPeriod.get(period)),
        };
      })
      .sort((left, right) => left.startDate.localeCompare(right.startDate));
    return Response.json(
      { openPeriods },
      { headers: { 'Cache-Control': 'no-store' } },
    );
  } catch (error) {
    return errorResponse(error);
  }
}

export async function POST(request: NextRequest) {
  try {
    const actor = await requireAuthenticatedProfile(request);
    requireRole(actor, ['super_admin', 'finance_verifier']);
    const body = await request.json();
    const period = typeof body.period === 'string' ? body.period : '';
    const attendanceStatus = body.attendanceStatus as AttendanceStatus;
    const holidays = Array.isArray(body.holidays)
      ? body.holidays.filter(
          (holiday: unknown): holiday is string =>
            typeof holiday === 'string' &&
            /^\d{4}-\d{2}-\d{2}$/.test(holiday),
        )
      : [];
    const reason =
      typeof body.reason === 'string' && body.reason.trim().length > 0
        ? body.reason.trim()
        : (attendanceStatus === 'open'
            ? `Membuka periode ${period} dengan ${holidays.length} tanggal merah`
            : `Menutup periode ${period}`);

    if (!/^\d{4}-\d{2}$/.test(period)) {
      throw new HttpError(400, 'Periode wajib menggunakan format YYYY-MM.');
    }
    if (!['open', 'closed'].includes(attendanceStatus)) {
      throw new HttpError(400, 'Status periode tidak valid.');
    }

    // Closing is forward-only. A repeated request is a read-only success so it
    // cannot move timestamps, alter the frozen calendar, or emit a second audit.
    const currentPeriodSnapshot = await adminDb
      .collection('PayrollPeriods')
      .doc(period)
      .get();
    if (
      attendanceStatus === 'closed' &&
      isPeriodClosed(currentPeriodSnapshot.data()) &&
      (
        hasPayrollRosterSeal(currentPeriodSnapshot.data()) ||
        period !== LEGACY_ROSTER_REPAIR_PERIOD
      )
    ) {
      return Response.json(
        { ...currentPeriodSnapshot.data(), idempotent: true },
        { headers: { 'Cache-Control': 'no-store' } },
      );
    }

    if (
      attendanceStatus === 'closed' &&
      period >= ATTENDANCE_PAYROLL_START_PERIOD
    ) {
      const [
        periodBeforeClose,
        attendanceImport,
        loyalisPresence,
        identityData,
        reopenedShiftSnapshot,
      ] = await Promise.all([
        adminDb.collection('PayrollPeriods').doc(period).get(),
        adminDb.collection(ATTENDANCE_IMPORTS_COLLECTION).doc(period).get(),
        adminDb.collection('LoyalisPresence').doc(period.replace('-', '_')).get(),
        loadAttendanceEmployeeIdentities(),
        adminDb
          .collection('ShiftOccurrences')
          .where('payrollPeriod', '==', period)
          .get(),
      ]);
      if (
        !attendanceImport.exists ||
        !attendanceImport.data()?.activeRevisionId
      ) {
        throw new HttpError(
          409,
          'Import presensi terpadu harus diaktifkan sebelum periode ditutup.',
        );
      }
      // An unmaterialized period never had a calendar revision to reconcile;
      // closure pins it for the first time.
      if (
        isPeriodMaterialized(periodBeforeClose.data()) &&
        periodBeforeClose.data()?.calendarReconciliationStatus !== 'complete'
      ) {
        throw new HttpError(
          409,
          'Rekonsiliasi perubahan kalender belum selesai.',
        );
      }
      const importRevision = Number(attendanceImport.data()?.activeRevision || 0);
      if (
        !loyalisPresence.exists ||
        loyalisPresence.data()?.sourceImportStale === true ||
        loyalisPresence.data()?.sourceCalendarStale === true ||
        Number(loyalisPresence.data()?.sourceImportRevision || 0) !==
          importRevision ||
        Number(loyalisPresence.data()?.sourceCalendarRevision || 0) !==
          Number(periodBeforeClose.data()?.workCalendar?.revision || 1)
      ) {
        throw new HttpError(
          409,
          'Presensi Loyalis belum diproses dari revisi import aktif.',
        );
      }
      const missingNipy = identityData.identities.filter(
        (identity) =>
          identity.active &&
          (identity.employeeCollection === 'Employees_BlueCollar' ||
            identity.employeeCollection === 'Employees_Loyalis') &&
          !identity.nipy,
      );
      const duplicateNipy = Array.from(identityData.byNipy.values()).filter(
        (items) => items.filter((item) => item.active).length > 1,
      );
      if (missingNipy.length > 0 || duplicateNipy.length > 0) {
        throw new HttpError(
          409,
          `Identitas NIPY belum siap: ${missingNipy.length} kosong dan ${duplicateNipy.length} duplikat.`,
        );
      }
      const categories = Array.from(
        new Set(
          identityData.identities.flatMap((identity) =>
            identity.active &&
            identity.employeeCollection === 'Employees_BlueCollar' &&
            identity.jobCategory &&
            identity.jobCategory !== 'SATPAM'
              ? [identity.jobCategory]
              : [],
          ),
        ),
      );
      const publicationSnapshots =
        categories.length > 0
          ? await adminDb.getAll(
              ...categories.map((category) =>
                adminDb
                  .collection(PEKARYA_PUBLICATIONS_COLLECTION)
                  .doc(pekaryaPublicationId(period, category)),
              ),
            )
          : [];
      const calendarRevision = periodCalendarFromData(
        period,
        periodBeforeClose.data()!,
      ).revision;
      const staleCategory = publicationSnapshots.find(
        (snapshot) =>
          !snapshot.exists ||
          snapshot.data()?.state !== 'published' ||
          snapshot.data()?.stale === true ||
          Number(snapshot.data()?.importRevision || 0) !== importRevision ||
          Number(snapshot.data()?.calendarRevision || 0) !== calendarRevision,
      );
      if (staleCategory) {
        throw new HttpError(
          409,
          'Semua kategori Pekarya non-Satpam harus dipublikasikan dari revisi presensi dan kalender terbaru.',
        );
      }
      const calendarReopened = reopenedShiftSnapshot.docs.find((snapshot) => {
        if (
          !['pending_review', 'under_review'].includes(
            String(snapshot.data().status || ''),
          )
        ) {
          return false;
        }
        const codes = snapshot.data().anomalyCodes;
        return (
          Array.isArray(codes) &&
          codes.includes('CALENDAR_CHANGED_AFTER_APPROVAL')
        );
      });
      if (calendarReopened) {
        throw new HttpError(
          409,
          'Ada shift Satpam yang dibuka kembali karena perubahan kalender.',
        );
      }
    }

    if (attendanceStatus === 'closed') {
      const satpamPeriodSnapshot = await adminDb
        .collection('PayrollPeriods')
        .doc(period)
        .get();
      if (
        satpamPeriodSnapshot.exists &&
        isSatpamDutyPlanRequired(
          period,
          satpamPeriodSnapshot.data() || null,
        )
      ) {
        const teamsSnapshot = await adminDb.collection('SatpamShiftTeams').get();
        const dutyReconciliation = await syncSatpamDutyReconciliation(
          period,
          actor.uid,
        );
        if (dutyReconciliation.plans.length !== teamsSnapshot.size) {
          throw new HttpError(
            409,
            `Rencana dinas Satpam belum lengkap: ${dutyReconciliation.plans.length} dari ${teamsSnapshot.size} regu.`,
          );
        }
        if (!dutyReconciliation.periodComplete) {
          throw new HttpError(
            409,
            'Periode belum dapat ditutup sebelum seluruh shift Satpam berakhir.',
          );
        }
        if (dutyReconciliation.blockers.length > 0) {
          throw new HttpError(
            409,
            `Rekonsiliasi Satpam belum selesai: ${dutyReconciliation.blockers.join(' ')}`,
          );
        }
      }
    }

    const result = await adminDb.runTransaction(async (transaction) => {
      const periodRef = adminDb.collection('PayrollPeriods').doc(period);
      const calendarRef = adminDb
        .collection('PayrollHolidayCalendars')
        .doc(period.slice(0, 4));
      const periodSlipsQuery = adminDb
        .collection('PayrollSlipStates')
        .where('period', '==', period.replace('-', '_'));
      const blueEmployeesQuery = adminDb.collection('Employees_BlueCollar');
      const loyalisEmployeesQuery = adminDb.collection('Employees_Loyalis');
      const [
        snapshot,
        calendarSnapshot,
        periodSlipsSnapshot,
        blueEmployeesSnapshot,
        loyalisEmployeesSnapshot,
      ] = await Promise.all([
        transaction.get(periodRef),
        transaction.get(calendarRef),
        transaction.get(periodSlipsQuery),
        transaction.get(blueEmployeesQuery),
        transaction.get(loyalisEmployeesQuery),
      ]);
      const before = snapshot.exists ? snapshot.data()! : null;
      let validatedPayrollRosterSeal: Record<string, unknown> | null = null;
      // Periods are open by default, so closing a month that nobody explicitly
      // opened is normal and must materialize it rather than be rejected.
      if (before?.attendanceStatus === 'closed' && attendanceStatus === 'open') {
        throw new HttpError(
          409,
          'Periode yang sudah ditutup tidak dapat dibuka kembali; gunakan proses koreksi.',
        );
      }
      if (
        before?.attendanceStatus === 'closed' &&
        attendanceStatus === 'closed' &&
        (hasPayrollRosterSeal(before) || period !== LEGACY_ROSTER_REPAIR_PERIOD)
      ) {
        return { ...before, idempotent: true };
      }
      if (attendanceStatus === 'open' && !isPeriodClosed(before)) {
        throw new HttpError(
          409,
          'Periode sudah menerima input secara otomatis; tindakan membuka periode tidak diperlukan lagi.',
        );
      }
      if (attendanceStatus === 'closed') {
        const roster = buildPayrollRoster(
          blueEmployeesSnapshot.docs.map((document) => ({
            id: document.id,
            data: document.data(),
          })),
          loyalisEmployeesSnapshot.docs.map((document) => ({
            id: document.id,
            data: document.data(),
          })),
        );
        if (roster.duplicateEmployeeIds.length > 0) {
          throw new HttpError(
            409,
            `ID pegawai payroll dipakai di lebih dari satu koleksi: ${roster.duplicateEmployeeIds.slice(0, 10).join(', ')}.`,
          );
        }
        const slipIdPrefix = `${period.replace('-', '_')}_`;
        const slipsByEmployeeId = new Map(
          periodSlipsSnapshot.docs.map((document) => {
            const data = document.data();
            const employeeId = String(
              data.employeeId || document.id.slice(slipIdPrefix.length),
            );
            return [employeeId, data] as const;
          }),
        );
        const missingEntries = missingPayrollRosterEntries(
          roster.entries,
          new Set(slipsByEmployeeId.keys()),
        );
        if (missingEntries.length > 0) {
          const examples = missingEntries
            .slice(0, 8)
            .map((entry) => `${entry.name || entry.employeeId} (${entry.employeeId})`)
            .join(', ');
          throw new HttpError(
            409,
            `${missingEntries.length} pegawai payroll belum memiliki draf: ${examples}${missingEntries.length > 8 ? ', …' : ''}. Siapkan seluruh draf sebelum menutup periode.`,
          );
        }

        const invalidStatuses = roster.entries.filter((entry) => {
          const status = slipsByEmployeeId.get(entry.employeeId)?.status;
          if (before?.attendanceStatus === 'closed') {
            return !['draft', 'locked', 'payment_created', 'paid', 'confirmed'].includes(status);
          }
          return status !== 'draft';
        });
        if (invalidStatuses.length > 0) {
          throw new HttpError(
            409,
            `${invalidStatuses.length} slip memiliki status yang tidak sesuai untuk penyegelan roster payroll.`,
          );
        }

        const invalidDrafts = periodSlipsSnapshot.docs.filter((document) => {
          const data = document.data();
          if (data.status !== 'draft') return false;
          const plan = data.koperasiInstallmentPlan as
            | KoperasiInstallmentPlan
            | undefined;
          try {
            const expectedDeduction = koperasiLoanDeduction(
              validateMoneyFields(data.deductions, 'deductions'),
            );
            const planTotal = Array.isArray(plan?.loans)
              ? plan.loans.reduce(
                  (total, loan) => total + Number(loan.installmentAmount || 0),
                  0,
                )
              : -1;
            return !plan ||
              plan.schemaVersion !== 1 ||
              plan.payrollPeriod !== period ||
              typeof plan.planHash !== 'string' ||
              plan.expectedDeduction !== expectedDeduction ||
              planTotal !== expectedDeduction ||
              hashKoperasiInstallmentPlan(plan) !== plan.planHash;
          } catch {
            return true;
          }
        });
        if (invalidDrafts.length > 0) {
          throw new HttpError(
            409,
            `${invalidDrafts.length} draf belum memiliki rencana cicilan Koperasi yang valid. Simpan ulang seluruh draf sebelum menutup periode.`,
          );
        }

        const now = admin.firestore.FieldValue.serverTimestamp();
        const payrollRosterSeal = {
          schemaVersion: 1,
          employeeIds: roster.entries.map((entry) => entry.employeeId),
          rosterHash: payrollRosterHash(roster.entries),
          totalEmployeeCount: roster.entries.length,
          pekaryaCount: roster.entries.filter(
            (entry) => entry.employeeCollection === 'Employees_BlueCollar',
          ).length,
          loyalisCount: roster.entries.filter(
            (entry) => entry.employeeCollection === 'Employees_Loyalis',
          ).length,
          sealedAt: now,
          sealedBy: actor.uid,
        };
        validatedPayrollRosterSeal = payrollRosterSeal;

        // July 2026 was already closed before roster completeness became a
        // closure invariant. Once its missing drafts have been repaired, seal
        // only the roster metadata; never move its original closure timestamp
        // or rewrite its frozen calendar.
        if (before?.attendanceStatus === 'closed') {
          const after = {
            ...before,
            payrollRosterSeal,
            koperasiPlannedDraftCount: periodSlipsSnapshot.docs.filter(
              (document) => document.data().status === 'draft',
            ).length,
            rosterSealRepairedAt: now,
            rosterSealRepairedBy: actor.uid,
            updatedAt: now,
            updatedBy: actor.uid,
          };
          transaction.set(periodRef, {
            payrollRosterSeal,
            koperasiPlannedDraftCount: after.koperasiPlannedDraftCount,
            rosterSealRepairedAt: now,
            rosterSealRepairedBy: actor.uid,
            updatedAt: now,
            updatedBy: actor.uid,
          }, { merge: true });
          transaction.create(
            newFinancialAuditRef(),
            buildFinancialAuditRecord(actor, {
              action: 'PAYROLL_PERIOD_ROSTER_REPAIRED',
              entityType: 'PayrollPeriod',
              entityId: period,
              reason: `Menyegel roster lengkap ${roster.entries.length} pegawai pada periode tertutup ${period}`,
              before,
              after,
            }),
          );
          return { ...after, rosterSealRepaired: true };
        }
      }

      // Sync calendar snapshot or create auto-version if calendar doesn't exist yet
      const year = period.slice(0, 4);
      const calData = calendarSnapshot.exists ? calendarSnapshot.data()! : { version: `ID-${year}-V1`, dates: [] };
      const existingDates: string[] = Array.isArray(calData.dates) ? calData.dates : [];
      const mergedDates = Array.from(new Set([...existingDates, ...holidays])).sort();
      const periodPremiumDates = normalizePeriodPremiumDates(
        period,
        [...existingDates, ...holidays],
      );

      const now = admin.firestore.FieldValue.serverTimestamp();
      transaction.set(
        calendarRef,
        {
          year,
          version: calData.version || `ID-${year}-V1`,
          dates: mergedDates,
          updatedAt: now,
          updatedBy: actor.uid,
        },
        { merge: true },
      );

      const after = {
        period,
        attendanceStatus,
        holidays: before?.holidays || periodPremiumDates,
        datePolicy: 'shift_start_date',
        timeZone: 'Asia/Jakarta',
        holidayCalendarVersion: calData.version || `ID-${year}-V1`,
        // A month that collected work without ever being explicitly opened has
        // no frozen calendar yet. Closure is the last moment it can be pinned,
        // so the closed snapshot records exactly what the period was rated on.
        ...(isPeriodMaterialized(before)
          ? {}
          : {
              satpamDutyPlanRequired:
                before?.satpamDutyPlanRequired === true ||
                period >= ATTENDANCE_PAYROLL_START_PERIOD,
              satpamDutyPlanSchemaVersion: 1,
              workCalendar: {
                revision: 1,
                annualVersion: calData.version || `ID-${year}-V1`,
                premiumDates: periodPremiumDates,
                reason,
                updatedAt: now,
                updatedBy: actor.uid,
              },
              calendarReconciliationStatus: 'complete',
            }),
        ...(attendanceStatus === 'closed'
          ? {
              sealedAt: now,
              sealedBy: actor.uid,
              dataSealVersion: 1,
              koperasiPlanVersion: 1,
              koperasiPlannedDraftCount: periodSlipsSnapshot.docs.filter(
                (document) => document.data().status === 'draft',
              ).length,
              payrollRosterSeal: validatedPayrollRosterSeal,
            }
          : {}),
        updatedAt: now,
        updatedBy: actor.uid,
        schemaVersion: 1,
      };
      transaction.set(periodRef, after, { merge: true });
      transaction.create(
        newFinancialAuditRef(),
        buildFinancialAuditRecord(actor, {
          action: attendanceStatus === 'open' ? 'PAYROLL_PERIOD_OPENED' : 'PAYROLL_PERIOD_CLOSED',
          entityType: 'PayrollPeriod',
          entityId: period,
          reason,
          before,
          after,
        }),
      );
      return after;
    });

    return Response.json(result, {
      status:
        'idempotent' in result && result.idempotent === true ? 200 : 201,
      headers: { 'Cache-Control': 'no-store' },
    });
  } catch (error) {
    return errorResponse(error);
  }
}
