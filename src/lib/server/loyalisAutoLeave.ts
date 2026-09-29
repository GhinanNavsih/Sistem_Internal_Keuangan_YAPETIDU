import admin, { adminDb } from '@/lib/firebase-admin';
import { employeeInPayrollPeriod } from '@/lib/employeeConversion';
import {
  annualPaidLeaveBalanceEntitlementForYear,
  nextAnnualPaidLeaveBalanceRevision,
} from '@/lib/payroll/annualPaidLeave';
import { isImmutablePayrollStatus } from '@/lib/payroll/domain';
import { isActiveGantiLiburStatus } from '@/lib/payroll/gantiLibur';
import {
  AUTO_ABSENCE_DECISION_REASON,
  AUTO_ABSENCE_LEAVE_REASON,
  AUTO_ABSENCE_LEAVE_SOURCE,
  autoLeaveAbsentDates,
  isAutoLeavePeriod,
  planLoyalisAutoLeave,
  type AutoLeaveEmployeeResult,
  type AutoLeaveSummary,
} from '@/lib/payroll/loyalisAutoLeave';
import {
  ANNUAL_PAID_LEAVE_BALANCES_COLLECTION,
  ANNUAL_PAID_LEAVE_PAYROLL_POSTS_COLLECTION,
  ANNUAL_PAID_LEAVE_REQUESTS_COLLECTION,
  ANNUAL_PAID_LEAVE_REVISIONS_COLLECTION,
  annualPaidLeaveBalanceDocumentId,
  annualPaidLeaveDocumentId,
  annualPaidLeaveEmployeeFromData,
} from '@/lib/server/annualPaidLeave';
import { buildFinancialAuditRecord, newFinancialAuditRef } from '@/lib/server/audit';
import { HttpError, type AuthenticatedProfile } from '@/lib/server/auth';
import {
  employeeGantiLiburQuery,
  loadLoyalisOffDayChecker,
  loyalisPresenceRefs,
} from '@/lib/server/gantiLibur';
import { isPeriodClosed, jakartaToday } from '@/lib/server/payrollPeriod';

const CORRECTIONS_COLLECTION = 'LoyalisPresenceCorrections';
const CONCURRENCY = 5;

function inPeriod(date: unknown, period: string): date is string {
  return typeof date === 'string' && date.startsWith(`${period}-`);
}

/** The saved presence of the month: the first stored document that has entries. */
async function loadSavedPresence(period: string) {
  const snapshots = await Promise.all(
    loyalisPresenceRefs(period).map((reference) => reference.get()),
  );
  const data = snapshots.find((snapshot) => snapshot.exists)?.data();
  if (!data) {
    throw new HttpError(409, `Data presensi Loyalis ${period} belum disimpan.`);
  }
  return data;
}

/**
 * Brings the automatic cuti of one Loyalis in line with the saved presence. It
 * re-reads everything it depends on inside the transaction, so it is safe to
 * run again and again, and safe against a leave request or correction arriving
 * while a save is in flight.
 */
async function reconcileEmployee(
  period: string,
  employee: NonNullable<ReturnType<typeof annualPaidLeaveEmployeeFromData>>,
  absentDates: readonly string[],
  actor: AuthenticatedProfile,
): Promise<AutoLeaveEmployeeResult> {
  const result: AutoLeaveEmployeeResult = {
    employeeId: employee.id,
    employeeName: employee.name,
    covered: [],
    released: [],
    uncovered: [],
  };
  const year = Number(period.slice(0, 4));
  const balanceRef = adminDb
    .collection(ANNUAL_PAID_LEAVE_BALANCES_COLLECTION)
    .doc(annualPaidLeaveBalanceDocumentId(employee.id, year));
  const slipRef = adminDb
    .collection('PayrollSlipStates')
    .doc(`${period.replace('-', '_')}_${employee.id}`);

  await adminDb.runTransaction(async (transaction) => {
    const [requestsSnapshot, balanceSnapshot, slipSnapshot, gantiLiburSnapshot, correctionsSnapshot] =
      await Promise.all([
        transaction.get(
          adminDb
            .collection(ANNUAL_PAID_LEAVE_REQUESTS_COLLECTION)
            .where('employeeId', '==', employee.id),
        ),
        transaction.get(balanceRef),
        transaction.get(slipRef),
        transaction.get(employeeGantiLiburQuery(employee.id)),
        transaction.get(
          adminDb.collection(CORRECTIONS_COLLECTION).where('employeeId', '==', employee.id),
        ),
      ]);

    result.covered = [];
    result.released = [];
    result.uncovered = [];
    if (slipSnapshot.exists && isImmutablePayrollStatus(slipSnapshot.data()?.status)) {
      result.skipped = 'Slip periode ini sudah final; cuti otomatis tidak diubah.';
      return;
    }

    const requestsById = new Map(
      requestsSnapshot.docs
        .filter((document) => inPeriod(document.data().leaveDate, period))
        .map((document) => [document.id, document.data()]),
    );
    const existingAutoDates = new Set<string>();
    const blockedDates = new Set<string>();
    for (const data of requestsById.values()) {
      if (data.status === 'approved' && data.source === AUTO_ABSENCE_LEAVE_SOURCE) {
        existingAutoDates.add(String(data.leaveDate));
      } else if (data.status === 'pending' || data.status === 'approved') {
        blockedDates.add(String(data.leaveDate));
      }
    }
    for (const document of gantiLiburSnapshot.docs) {
      const data = document.data();
      if (isActiveGantiLiburStatus(data.status) && inPeriod(data.dayOffDate, period)) {
        blockedDates.add(data.dayOffDate);
      }
    }
    for (const document of correctionsSnapshot.docs) {
      const data = document.data();
      if (
        (data.status === 'pending' || data.status === 'approved') &&
        inPeriod(data.date, period)
      ) {
        blockedDates.add(data.date);
      }
    }

    const balance = balanceSnapshot.data() || {};
    const usedDays = Math.max(0, Number(balance.usedDays || 0));
    const reservedDays = Math.max(0, Number(balance.reservedDays || 0));
    const plan = planLoyalisAutoLeave({
      period,
      serviceDate: employee.serviceDate,
      absentDates,
      blockedDates,
      existingAutoDates,
      balance: {
        reservedDays,
        usedDays,
        manualUsedDays: Math.max(0, Number(balance.manualUsedDays || 0)),
      },
    });
    result.uncovered = plan.uncovered;
    result.covered = plan.cover;
    result.released = plan.release;
    if (plan.cover.length === 0 && plan.release.length === 0) return;

    const now = admin.firestore.FieldValue.serverTimestamp();
    const commonMetadata = { employeeId: employee.id, year, period };
    const requestRefFor = (date: string) =>
      adminDb
        .collection(ANNUAL_PAID_LEAVE_REQUESTS_COLLECTION)
        .doc(annualPaidLeaveDocumentId(employee.id, date));
    const writeRevision = (
      requestId: string,
      revision: number,
      action: string,
      before: unknown,
      after: unknown,
      reason: string,
    ) =>
      transaction.create(
        adminDb.collection(ANNUAL_PAID_LEAVE_REVISIONS_COLLECTION).doc(`${requestId}__r${revision}`),
        {
          annualPaidLeaveRequestId: requestId,
          revision,
          action,
          before,
          after,
          actorUid: actor.uid,
          requestId: `auto-leave:${period}`,
          reason,
          createdAt: now,
        },
      );

    for (const date of plan.cover) {
      const requestRef = requestRefFor(date);
      const current = requestsById.get(requestRef.id);
      const revision = Number(current?.revision || 0) + 1;
      const after = {
        id: requestRef.id,
        employeeId: employee.id,
        employeeName: employee.name,
        employeeKind: employee.kind,
        employeeCollection: employee.collection,
        category: employee.category,
        leaveDate: date,
        year,
        period,
        reason: AUTO_ABSENCE_LEAVE_REASON,
        attachments: [],
        serviceDate: employee.serviceDate,
        qualifyingDate: employee.qualifyingDate,
        status: 'approved',
        source: AUTO_ABSENCE_LEAVE_SOURCE,
        revision,
        submittedBy: actor.uid,
        submittedByName: actor.displayName,
        submittedAt: now,
        decisionReason: AUTO_ABSENCE_DECISION_REASON,
        decidedAt: now,
        decidedBy: actor.uid,
        decidedByName: actor.displayName,
        approvedPayType: 'Harian',
        approvedAmount: 0,
        updatedAt: now,
        schemaVersion: 1,
      };
      transaction.set(requestRef, after);
      transaction.set(
        adminDb.collection(ANNUAL_PAID_LEAVE_PAYROLL_POSTS_COLLECTION).doc(requestRef.id),
        {
          annualPaidLeaveRequestId: requestRef.id,
          employeeId: employee.id,
          employeeName: employee.name,
          employeeKind: employee.kind,
          employeeCollection: employee.collection,
          category: employee.category,
          leaveDate: date,
          year,
          period,
          payType: 'Harian',
          amount: 0,
          payrollMode: 'loyalis_presence_overlay',
          status: 'posted',
          source: AUTO_ABSENCE_LEAVE_SOURCE,
          postedAt: now,
          postedBy: actor.uid,
          sourceRevision: revision,
          schemaVersion: 1,
        },
      );
      writeRevision(requestRef.id, revision, 'auto_approve', current || null, after, AUTO_ABSENCE_DECISION_REASON);
      transaction.create(
        newFinancialAuditRef(),
        buildFinancialAuditRecord(actor, {
          action: 'ANNUAL_PAID_LEAVE_AUTO_APPLIED',
          entityType: 'AnnualPaidLeaveRequest',
          entityId: requestRef.id,
          requestId: `auto-leave:${period}`,
          reason: AUTO_ABSENCE_DECISION_REASON,
          before: current || null,
          after,
          metadata: { ...commonMetadata, leaveDate: date },
        }),
      );
    }

    const releaseReason =
      'Cuti otomatis dibatalkan: presensi atau pengajuan pada tanggal ini berubah.';
    for (const date of plan.release) {
      const requestRef = requestRefFor(date);
      const current = requestsById.get(requestRef.id);
      if (!current) continue;
      const revision = Number(current.revision || 0) + 1;
      const after = {
        ...current,
        status: 'withdrawn',
        revision,
        decisionReason: releaseReason,
        approvedPayType: null,
        approvedAmount: 0,
        revokedAt: now,
        revokedBy: actor.uid,
        revokedFromStatus: 'approved',
        updatedAt: now,
      };
      transaction.set(requestRef, after);
      transaction.delete(
        adminDb.collection(ANNUAL_PAID_LEAVE_PAYROLL_POSTS_COLLECTION).doc(requestRef.id),
      );
      writeRevision(requestRef.id, revision, 'auto_release', current, after, releaseReason);
      transaction.create(
        newFinancialAuditRef(),
        buildFinancialAuditRecord(actor, {
          action: 'ANNUAL_PAID_LEAVE_AUTO_RELEASED',
          entityType: 'AnnualPaidLeaveRequest',
          entityId: requestRef.id,
          requestId: `auto-leave:${period}`,
          reason: releaseReason,
          before: current,
          after,
          metadata: { ...commonMetadata, leaveDate: date },
        }),
      );
    }

    transaction.set(
      balanceRef,
      {
        employeeId: employee.id,
        employeeKind: employee.kind,
        employeeCollection: employee.collection,
        year,
        entitlementDays: annualPaidLeaveBalanceEntitlementForYear(
          employee.serviceDate,
          year,
          jakartaToday(),
        ),
        usedDays: Math.max(0, usedDays + plan.cover.length - plan.release.length),
        reservedDays,
        balanceRevision: nextAnnualPaidLeaveBalanceRevision(balance.balanceRevision),
        serviceDate: employee.serviceDate,
        qualifyingDate: employee.qualifyingDate,
        updatedAt: now,
        schemaVersion: 1,
      },
      { merge: true },
    );
  });
  return result;
}

/**
 * Turns every unexcused absence of a saved Loyalis presence into automatic
 * annual cuti while the balance lasts (see `loyalisAutoLeave.ts` for the
 * rules). It reads the saved document, so it must run after the presence save.
 * The result is derived afresh each time: covering what is now absent and
 * releasing what no longer is.
 */
export async function reconcileLoyalisAutoLeave(
  period: string,
  actor: AuthenticatedProfile,
): Promise<AutoLeaveSummary> {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(period)) {
    throw new HttpError(400, 'Periode wajib menggunakan format YYYY-MM.');
  }
  if (!isAutoLeavePeriod(period)) {
    return {
      period,
      applicable: false,
      note: 'Cuti otomatis hanya berlaku untuk periode mulai 2026-09.',
      results: [],
    };
  }

  const [presence, periodSnapshot, isOffDay, employeesSnapshot] = await Promise.all([
    loadSavedPresence(period),
    adminDb.collection('PayrollPeriods').doc(period).get(),
    loadLoyalisOffDayChecker([`${period}-01`]),
    adminDb.collection('Employees_Loyalis').get(),
  ]);
  if (isPeriodClosed(periodSnapshot.data())) {
    return {
      period,
      applicable: false,
      note: 'Periode payroll sudah ditutup; cuti otomatis tidak diproses.',
      results: [],
    };
  }

  const entries: Record<string, { dailyLogs?: unknown }> =
    presence.entries && typeof presence.entries === 'object' && !Array.isArray(presence.entries)
      ? presence.entries
      : {};
  const autoRequestsSnapshot = await adminDb
    .collection(ANNUAL_PAID_LEAVE_REQUESTS_COLLECTION)
    .where('period', '==', period)
    .get();
  const employeesWithAutoDays = new Set(
    autoRequestsSnapshot.docs
      .filter(
        (document) =>
          document.data().source === AUTO_ABSENCE_LEAVE_SOURCE &&
          document.data().status === 'approved',
      )
      .map((document) => String(document.data().employeeId)),
  );

  const results: AutoLeaveEmployeeResult[] = [];
  const work: Array<() => Promise<AutoLeaveEmployeeResult>> = [];
  for (const document of employeesSnapshot.docs) {
    const data = document.data();
    if (!employeeInPayrollPeriod('Employees_Loyalis', data, period)) continue;
    const absentDates = autoLeaveAbsentDates(
      (entries[document.id]?.dailyLogs as never) ?? [],
      period,
      isOffDay,
    );
    if (absentDates.length === 0 && !employeesWithAutoDays.has(document.id)) continue;

    const employee = annualPaidLeaveEmployeeFromData(document.id, 'loyalis', data);
    const name = String(data.personal_info?.name || document.id);
    if (!employee) {
      results.push({
        employeeId: document.id,
        employeeName: name,
        covered: [],
        released: [],
        uncovered: [],
        skipped: 'Tanggal pengakuan masa kerja belum diisi.',
      });
      continue;
    }
    if (!employee.active) continue;
    work.push(async () => {
      try {
        return await reconcileEmployee(period, employee, absentDates, actor);
      } catch (error) {
        console.error(`Cuti otomatis ${period} gagal untuk ${employee.id}:`, error);
        return {
          employeeId: employee.id,
          employeeName: employee.name,
          covered: [],
          released: [],
          uncovered: [],
          skipped: error instanceof Error ? error.message : 'Cuti otomatis gagal diproses.',
        };
      }
    });
  }
  for (let offset = 0; offset < work.length; offset += CONCURRENCY) {
    results.push(...(await Promise.all(work.slice(offset, offset + CONCURRENCY).map((run) => run()))));
  }

  return {
    period,
    applicable: true,
    results: results
      .filter(
        (item) =>
          item.covered.length + item.released.length + item.uncovered.length > 0 || item.skipped,
      )
      .sort((left, right) => left.employeeName.localeCompare(right.employeeName)),
  };
}
