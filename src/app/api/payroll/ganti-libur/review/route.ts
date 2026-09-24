import { createHash } from 'node:crypto';
import { NextRequest } from 'next/server';
import admin, { adminDb } from '@/lib/firebase-admin';
import { assertRequestId, isImmutablePayrollStatus } from '@/lib/payroll/domain';
import {
  gantiLiburDecisionIssue,
  gantiLiburVerdictLabel,
  isActiveGantiLiburStatus,
  type GantiLiburDecisionIssue,
  type GantiLiburRequest,
} from '@/lib/payroll/gantiLibur';
import {
  applyApprovedPaidLeaveToLoyalisEntry,
  loyalisHasPayableAttendance,
  type LoyalisPaidLeaveEntry,
} from '@/lib/payroll/loyalisPaidLeave';
import { buildFinancialAuditRecord, newFinancialAuditRef } from '@/lib/server/audit';
import {
  ANNUAL_PAID_LEAVE_REQUESTS_COLLECTION,
  annualPaidLeaveDocumentId,
} from '@/lib/server/annualPaidLeave';
import {
  errorResponse,
  HttpError,
  requireAuthenticatedProfile,
  requireRole,
} from '@/lib/server/auth';
import {
  GANTI_LIBUR_REQUESTS_COLLECTION,
  GANTI_LIBUR_REVISIONS_COLLECTION,
  gantiLiburAttendanceCheckFromSnapshots,
  gantiLiburEmployeeFromData,
  gantiLiburRequestFromData,
  loadGantiLiburAttendanceChecks,
  loadLoyalisOffDayChecker,
  loyalisPresenceRefs,
  sortGantiLiburRequests,
} from '@/lib/server/gantiLibur';
import { isPeriodClosed } from '@/lib/server/payrollPeriod';

export const dynamic = 'force-dynamic';

/** Loyalis attendance reviewers: the same people who decide Loyalis annual leave. */
const REVIEWER_ROLES = ['super_admin', 'loyalis_admin'] as const;
/** Readers also include the pages that overlay approved days onto presence. */
const REVIEW_READER_ROLES = [
  ...REVIEWER_ROLES,
  'satker_head_loyalis',
  'finance_verifier',
] as const;

const STATUSES = ['pending', 'approved', 'declined', 'withdrawn', 'all'] as const;
type StatusFilter = (typeof STATUSES)[number];

function stableHash(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

function parseStatus(value: string | null): StatusFilter {
  const status = (value || 'pending') as StatusFilter;
  if (!STATUSES.includes(status)) {
    throw new HttpError(400, 'Status ganti libur tidak valid.');
  }
  return status;
}

function decisionIssueMessage(issue: GantiLiburDecisionIssue, verdictLabel: string): string {
  return {
    period_closed: 'Periode payroll tanggal ganti libur sudah ditutup; keputusan tidak dapat diproses.',
    immutable_slip: 'Slip bulan tanggal ganti libur sudah final; gunakan koreksi finansial.',
    revision_conflict: 'Pengajuan telah berubah. Muat ulang sebelum memutuskan.',
    not_pending: 'Pengajuan ini sudah pernah diputuskan atau ditarik.',
    attendance_not_verified: `Presensi hari libur belum memenuhi 07.30–14.00 WIB (${verdictLabel}); pengajuan tidak dapat disetujui.`,
    day_off_now_holiday: 'Tanggal ganti libur kini tercatat sebagai hari libur; minta pegawai memilih tanggal lain.',
    day_off_conflict: 'Tanggal ganti libur sudah memiliki presensi, koreksi, atau cuti tahunan.',
  }[issue];
}

export async function GET(request: NextRequest) {
  try {
    const actor = await requireAuthenticatedProfile(request);
    requireRole(actor, REVIEW_READER_ROLES);
    const status = parseStatus(request.nextUrl.searchParams.get('status'));
    const dayOffPeriod = request.nextUrl.searchParams.get('dayOffPeriod')?.trim() || '';
    if (dayOffPeriod && !/^\d{4}-\d{2}$/.test(dayOffPeriod)) {
      throw new HttpError(400, 'Periode wajib menggunakan format YYYY-MM.');
    }

    const collection = adminDb.collection(GANTI_LIBUR_REQUESTS_COLLECTION);
    const snapshot = await (dayOffPeriod
      ? collection.where('dayOffPeriod', '==', dayOffPeriod).get()
      : status === 'all'
        ? collection.get()
        : collection.where('status', '==', status).get());
    const requests = sortGantiLiburRequests(
      snapshot.docs
        .map((document) => gantiLiburRequestFromData(document.id, document.data()))
        .filter((item) => status === 'all' || item.status === status),
    );

    // Pending requests are judged against the attendance as it stands now;
    // decided ones keep the check recorded when they were decided.
    const pending = requests.filter((item) => item.status === 'pending');
    const liveChecks = pending.length > 0
      ? await loadGantiLiburAttendanceChecks(pending)
      : new Map();
    const withChecks: GantiLiburRequest[] = requests.map((item) =>
      item.status === 'pending'
        ? { ...item, attendanceCheck: liveChecks.get(item.id) || null }
        : item,
    );

    return Response.json(
      { status, dayOffPeriod: dayOffPeriod || null, requests: withChecks },
      { headers: { 'Cache-Control': 'no-store' } },
    );
  } catch (error) {
    return errorResponse(error);
  }
}

export async function POST(request: NextRequest) {
  try {
    const actor = await requireAuthenticatedProfile(request);
    requireRole(actor, REVIEWER_ROLES);
    const body = (await request.json()) as Record<string, unknown>;
    const gantiLiburRequestId = String(body.gantiLiburRequestId || '');
    const action = String(body.action || '');
    const commandId = String(body.requestId || '');
    const expectedRevision = Number(body.expectedRevision);
    const decisionReason = String(body.reason || '').trim();
    if (!/^[a-f0-9]{64}$/.test(gantiLiburRequestId)) {
      throw new HttpError(400, 'ID pengajuan ganti libur tidak valid.');
    }
    if (action !== 'approve' && action !== 'decline') {
      throw new HttpError(400, 'Aksi keputusan ganti libur tidak valid.');
    }
    try {
      assertRequestId(commandId);
    } catch (error) {
      throw new HttpError(
        400,
        error instanceof Error ? error.message : 'requestId tidak valid.',
      );
    }
    if (!Number.isSafeInteger(expectedRevision) || expectedRevision < 1) {
      throw new HttpError(400, 'Revisi pengajuan tidak valid.');
    }
    if (decisionReason.length > 500 || (action === 'decline' && !decisionReason)) {
      throw new HttpError(
        400,
        action === 'decline'
          ? 'Alasan penolakan wajib diisi maksimal 500 karakter.'
          : 'Catatan keputusan maksimal 500 karakter.',
      );
    }

    const approving = action === 'approve';
    const requestRef = adminDb
      .collection(GANTI_LIBUR_REQUESTS_COLLECTION)
      .doc(gantiLiburRequestId);
    const initialSnapshot = await requestRef.get();
    if (!initialSnapshot.exists) {
      throw new HttpError(404, 'Pengajuan ganti libur tidak ditemukan.');
    }
    const initial = gantiLiburRequestFromData(initialSnapshot.id, initialSnapshot.data() || {});
    const { employeeId, workedDate, dayOffDate, dayOffPeriod } = initial;
    const isOffDay = approving ? await loadLoyalisOffDayChecker([dayOffDate]) : () => false;
    const dayOffIsOffDay = isOffDay(dayOffDate);

    const idempotencyRef = adminDb
      .collection('FinancialIdempotencyKeys')
      .doc(`${actor.uid}__${commandId}`);
    const employeeRef = adminDb.collection('Employees_Loyalis').doc(employeeId);
    const periodRef = adminDb.collection('PayrollPeriods').doc(dayOffPeriod);
    const slipRef = adminDb
      .collection('PayrollSlipStates')
      .doc(`${dayOffPeriod.replace('-', '_')}_${employeeId}`);
    const workedPresenceRefs = loyalisPresenceRefs(workedDate.slice(0, 7));
    // Written where the presence calculator and annual leave write it.
    const dayOffPresenceRef = loyalisPresenceRefs(dayOffPeriod)[0];
    const annualLeaveRef = adminDb
      .collection(ANNUAL_PAID_LEAVE_REQUESTS_COLLECTION)
      .doc(annualPaidLeaveDocumentId(employeeId, dayOffDate));
    const correctionsQuery = adminDb
      .collection('LoyalisPresenceCorrections')
      .where('employeeId', '==', employeeId);
    const requestHash = stableHash({
      gantiLiburRequestId,
      action,
      commandId,
      expectedRevision,
      decisionReason,
    });

    const result = await adminDb.runTransaction(async (transaction) => {
      const [
        requestSnapshot,
        idempotencySnapshot,
        employeeSnapshot,
        periodSnapshot,
        slipSnapshot,
        dayOffPresenceSnapshot,
        annualLeaveSnapshot,
        correctionsSnapshot,
        ...workedPresenceSnapshots
      ] = await Promise.all([
        transaction.get(requestRef),
        transaction.get(idempotencyRef),
        transaction.get(employeeRef),
        transaction.get(periodRef),
        transaction.get(slipRef),
        transaction.get(dayOffPresenceRef),
        transaction.get(annualLeaveRef),
        transaction.get(correctionsQuery),
        ...workedPresenceRefs.map((reference) => transaction.get(reference)),
      ]);

      if (idempotencySnapshot.exists) {
        if (idempotencySnapshot.data()?.requestHash !== requestHash) {
          throw new HttpError(409, 'requestId sudah digunakan untuk keputusan lain.');
        }
        return {
          id: gantiLiburRequestId,
          status: idempotencySnapshot.data()?.status,
          revision: Number(idempotencySnapshot.data()?.revision || expectedRevision),
          dayOffPeriod,
          idempotent: true,
        };
      }

      const currentData = requestSnapshot.data();
      if (!currentData) throw new HttpError(404, 'Pengajuan ganti libur tidak ditemukan.');
      const current = gantiLiburRequestFromData(requestSnapshot.id, currentData);
      const employee = gantiLiburEmployeeFromData(employeeId, employeeSnapshot.data());
      if (approving && !employee) {
        throw new HttpError(409, 'Data pegawai Loyalis aktif tidak ditemukan.');
      }

      const attendanceCheck = gantiLiburAttendanceCheckFromSnapshots(
        workedPresenceSnapshots,
        employeeId,
        workedDate,
      );
      const presence = dayOffPresenceSnapshot.data() || null;
      const presenceEntries = presence?.entries && typeof presence.entries === 'object'
        ? { ...(presence.entries as Record<string, LoyalisPaidLeaveEntry>) }
        : {};
      const dayOffConflict =
        isActiveGantiLiburStatus(annualLeaveSnapshot.data()?.status) ||
        correctionsSnapshot.docs.some((document) => {
          const correction = document.data();
          return correction.date === dayOffDate && correction.status === 'approved';
        }) ||
        loyalisHasPayableAttendance(presenceEntries[employeeId], dayOffDate);

      const issue = gantiLiburDecisionIssue({
        approving,
        periodClosed: isPeriodClosed(periodSnapshot.data()),
        immutableSlip:
          slipSnapshot.exists && isImmutablePayrollStatus(slipSnapshot.data()?.status),
        expectedRevision,
        currentRevision: current.revision,
        status: current.status,
        verdict: attendanceCheck.verdict,
        dayOffIsOffDay,
        dayOffConflict,
      });
      if (issue) {
        throw new HttpError(
          409,
          decisionIssueMessage(issue, gantiLiburVerdictLabel(attendanceCheck.verdict)),
        );
      }

      const revision = expectedRevision + 1;
      const now = admin.firestore.FieldValue.serverTimestamp();
      const after = {
        ...currentData,
        status: approving ? 'approved' : 'declined',
        revision,
        decisionReason,
        decidedAt: now,
        decidedBy: actor.uid,
        decidedByName: actor.displayName,
        attendanceCheck,
        updatedAt: now,
      };
      transaction.set(requestRef, after);

      if (approving && presence) {
        const workingDays = Number(presence.workingDays || 25);
        const expectedHours = Number(presence.expectedHours || 6.5);
        presenceEntries[employeeId] = applyApprovedPaidLeaveToLoyalisEntry({
          entry: presenceEntries[employeeId] || {
            employeeId,
            employeeName: employee?.name || current.employeeName,
            minutes: 0,
            absenceMinutes: workingDays * expectedHours * 60,
            stratum: 5,
            deduction: 250_000,
            netBonus: 0,
            activeDaysCount: 0,
            incompleteDaysCount: 0,
            absentDaysCount: 0,
            dailyLogs: [],
          },
          leaveDate: dayOffDate,
          expectedHours,
          workingDays,
          isOffDay: false,
          kind: 'ganti_libur',
        });
        transaction.set(dayOffPresenceRef, {
          ...presence,
          entries: presenceEntries,
          updatedAt: now,
          gantiLiburUpdatedAt: now,
          gantiLiburUpdatedBy: actor.uid,
        });
      }

      transaction.create(
        adminDb
          .collection(GANTI_LIBUR_REVISIONS_COLLECTION)
          .doc(`${gantiLiburRequestId}__r${revision}`),
        {
          gantiLiburRequestId,
          revision,
          action,
          before: currentData,
          after,
          actorUid: actor.uid,
          requestId: commandId,
          reason: decisionReason,
          createdAt: now,
        },
      );
      transaction.create(
        newFinancialAuditRef(),
        buildFinancialAuditRecord(actor, {
          action: approving ? 'GANTI_LIBUR_APPROVED' : 'GANTI_LIBUR_DECLINED',
          entityType: 'GantiLiburRequest',
          entityId: gantiLiburRequestId,
          requestId: commandId,
          reason: decisionReason,
          before: currentData,
          after,
          metadata: {
            employeeId,
            workedDate,
            dayOffDate,
            dayOffPeriod,
            attendanceVerdict: attendanceCheck.verdict,
          },
        }),
      );
      transaction.create(idempotencyRef, {
        actorUid: actor.uid,
        requestId: commandId,
        requestHash,
        entityType: 'GantiLiburRequest',
        entityId: gantiLiburRequestId,
        status: after.status,
        revision,
        createdAt: now,
      });
      return {
        id: gantiLiburRequestId,
        status: after.status,
        revision,
        dayOffPeriod,
        idempotent: false,
      };
    });

    return Response.json(result, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    return errorResponse(error);
  }
}
