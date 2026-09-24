import { createHash } from 'node:crypto';
import { NextRequest } from 'next/server';
import admin, { adminDb } from '@/lib/firebase-admin';
import {
  annualPaidLeaveBalanceEntitlementForYear,
  annualPaidLeaveBalanceReferenceDate,
  annualPaidLeaveEntitlementDays,
  annualPaidLeaveIdempotencyState,
  annualPaidLeaveYear,
  assertAnnualPaidLeaveDate,
  calculateAnnualPaidLeaveBalance,
  completedServiceYears,
  isAnnualPaidLeaveEligible,
  isAnnualPaidLeaveRequestOwner,
  nextAnnualPaidLeaveBalanceRevision,
} from '@/lib/payroll/annualPaidLeave';
import { assertRequestId, isImmutablePayrollStatus } from '@/lib/payroll/domain';
import { buildFinancialAuditRecord, newFinancialAuditRef } from '@/lib/server/audit';
import {
  errorResponse,
  HttpError,
  requireAuthenticatedProfile,
} from '@/lib/server/auth';
import {
  ANNUAL_PAID_LEAVE_BALANCES_COLLECTION,
  ANNUAL_PAID_LEAVE_REQUESTS_COLLECTION,
  ANNUAL_PAID_LEAVE_REVISIONS_COLLECTION,
  annualPaidLeaveEmployeeDataMatches,
  annualPaidLeaveBalanceDocumentId,
  annualPaidLeaveDocumentId,
  annualPaidLeavePeriod,
  loadEmployeeAnnualPaidLeaveRequests,
  requireSelfAnnualPaidLeaveEmployee,
} from '@/lib/server/annualPaidLeave';
import { assertPeriodAcceptsInput, jakartaToday } from '@/lib/server/payrollPeriod';
import { employeeGantiLiburQuery } from '@/lib/server/gantiLibur';
import { isActiveGantiLiburStatus } from '@/lib/payroll/gantiLibur';

export const dynamic = 'force-dynamic';

function stableHash(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

function parseYear(value: string | null): number {
  const year = Number(value || jakartaToday().slice(0, 4));
  if (!Number.isInteger(year) || year < 2000 || year > 9999) {
    throw new HttpError(400, 'Tahun cuti tidak valid.');
  }
  return year;
}

function parseReason(value: unknown): string {
  if (value === undefined || value === null) return '';
  if (typeof value !== 'string' || value.trim().length > 500) {
    throw new HttpError(400, 'Alasan cuti maksimal 500 karakter.');
  }
  return value.trim();
}

function parseExpectedRevision(value: unknown): number {
  const revision = Number(value ?? 0);
  if (!Number.isInteger(revision) || revision < 0) {
    throw new HttpError(400, 'Revisi pengajuan tidak valid.');
  }
  return revision;
}

function nonNegativeDayCount(value: unknown): number {
  const count = Number(value || 0);
  return Number.isSafeInteger(count) ? Math.max(0, count) : 0;
}

export async function GET(request: NextRequest) {
  try {
    const actor = await requireAuthenticatedProfile(request);
    const employee = await requireSelfAnnualPaidLeaveEmployee(actor);
    const year = parseYear(request.nextUrl.searchParams.get('year'));
    const [requests, balanceSnapshot] = await Promise.all([
      loadEmployeeAnnualPaidLeaveRequests(employee.id, year),
      adminDb
        .collection(ANNUAL_PAID_LEAVE_BALANCES_COLLECTION)
        .doc(annualPaidLeaveBalanceDocumentId(employee.id, year))
        .get(),
    ]);
    const today = jakartaToday();
    const balanceReferenceDate = annualPaidLeaveBalanceReferenceDate(year, today);
    const entitlementDays = annualPaidLeaveBalanceEntitlementForYear(
      employee.serviceDate,
      year,
      today,
    );
    const manualUsedDays = nonNegativeDayCount(
      balanceSnapshot.data()?.manualUsedDays,
    );
    const balance = calculateAnnualPaidLeaveBalance(
      requests,
      entitlementDays,
      manualUsedDays,
    );
    return Response.json(
      {
        employee: {
          id: employee.id,
          name: employee.name,
          kind: employee.kind,
          category: employee.category,
          serviceDate: employee.serviceDate,
          qualifyingDate: employee.qualifyingDate,
          completedYearsToday: completedServiceYears(employee.serviceDate, today),
          eligibleToday: isAnnualPaidLeaveEligible(employee.serviceDate, today),
        },
        policy: {
          year,
          eligibleFrom: employee.qualifyingDate,
          balanceReferenceDate,
        },
        balance,
        requests,
      },
      { headers: { 'Cache-Control': 'no-store' } },
    );
  } catch (error) {
    return errorResponse(error);
  }
}

export async function POST(request: NextRequest) {
  try {
    const actor = await requireAuthenticatedProfile(request);
    const employee = await requireSelfAnnualPaidLeaveEmployee(actor);
    const body = (await request.json()) as Record<string, unknown>;
    const action = String(body.action || '');
    const commandId = String(body.requestId || '');
    try {
      assertRequestId(commandId);
    } catch (error) {
      throw new HttpError(
        400,
        error instanceof Error ? error.message : 'requestId tidak valid.',
      );
    }
    if (action !== 'submit' && action !== 'withdraw') {
      throw new HttpError(400, 'Aksi pengajuan cuti tidak valid.');
    }
    const leaveDate = String(body.leaveDate || '');
    try {
      assertAnnualPaidLeaveDate(leaveDate);
    } catch (error) {
      throw new HttpError(
        400,
        error instanceof Error ? error.message : 'Tanggal cuti tidak valid.',
      );
    }
    const expectedRevision = parseExpectedRevision(body.expectedRevision);
    const reason = parseReason(body.reason);
    const year = annualPaidLeaveYear(leaveDate);
    const leaveDateEntitlementDays = annualPaidLeaveEntitlementDays(
      employee.serviceDate,
      leaveDate,
    );
    const yearEntitlementDays = annualPaidLeaveBalanceEntitlementForYear(
      employee.serviceDate,
      year,
      jakartaToday(),
    );
    const period = annualPaidLeavePeriod(employee.kind, leaveDate);
    const requestDocumentId = annualPaidLeaveDocumentId(employee.id, leaveDate);
    const balanceDocumentId = annualPaidLeaveBalanceDocumentId(employee.id, year);
    const leaveRef = adminDb
      .collection(ANNUAL_PAID_LEAVE_REQUESTS_COLLECTION)
      .doc(requestDocumentId);
    const balanceRef = adminDb
      .collection(ANNUAL_PAID_LEAVE_BALANCES_COLLECTION)
      .doc(balanceDocumentId);
    const periodRef = adminDb.collection('PayrollPeriods').doc(period);
    const slipRef = adminDb
      .collection('PayrollSlipStates')
      .doc(`${period.replace('-', '_')}_${employee.id}`);
    const employeeRef = adminDb.collection(employee.collection).doc(employee.id);
    const idempotencyRef = adminDb
      .collection('FinancialIdempotencyKeys')
      .doc(`${actor.uid}__${commandId}`);
    const requestHash = stableHash({
      action,
      employeeId: employee.id,
      leaveDate,
      expectedRevision,
      reason,
      commandId,
    });

    const result = await adminDb.runTransaction(async (transaction) => {
      const [
        leaveSnapshot,
        balanceSnapshot,
        periodSnapshot,
        slipSnapshot,
        latestEmployeeSnapshot,
        idempotencySnapshot,
        gantiLiburSnapshot,
      ] =
        await Promise.all([
          transaction.get(leaveRef),
          transaction.get(balanceRef),
          transaction.get(periodRef),
          transaction.get(slipRef),
          transaction.get(employeeRef),
          transaction.get(idempotencyRef),
          // Only Loyalis can take ganti libur.
          employee.kind === 'loyalis' && action === 'submit'
            ? transaction.get(employeeGantiLiburQuery(employee.id))
            : Promise.resolve(null),
        ]);

      if (idempotencySnapshot.exists) {
        if (
          annualPaidLeaveIdempotencyState(
            idempotencySnapshot.data()?.requestHash,
            requestHash,
          ) === 'conflict'
        ) {
          throw new HttpError(409, 'requestId sudah digunakan untuk tindakan lain.');
        }
        return {
          id: requestDocumentId,
          status: idempotencySnapshot.data()?.status,
          revision: Number(idempotencySnapshot.data()?.revision || expectedRevision),
          idempotent: true,
        };
      }

      const current = leaveSnapshot.data();
      const currentRevision = Number(current?.revision || 0);
      if (currentRevision !== expectedRevision) {
        throw new HttpError(409, 'Pengajuan telah berubah. Muat ulang sebelum melanjutkan.');
      }
      const now = admin.firestore.FieldValue.serverTimestamp();
      const balanceData = balanceSnapshot.data() || {};
      const reservedDays = nonNegativeDayCount(balanceData.reservedDays);
      const usedDays = nonNegativeDayCount(balanceData.usedDays);
      const manualUsedDays = nonNegativeDayCount(balanceData.manualUsedDays);

      if (action === 'submit') {
        if (
          !latestEmployeeSnapshot.exists ||
          !annualPaidLeaveEmployeeDataMatches(
            employee,
            latestEmployeeSnapshot.data() || {},
          )
        ) {
          throw new HttpError(
            409,
            'Data pegawai berubah. Muat ulang sebelum mengajukan cuti.',
          );
        }
        assertPeriodAcceptsInput(
          periodSnapshot.data(),
          'Periode payroll tanggal cuti sudah ditutup; pengajuan tidak dapat dibuat.',
        );
        if (slipSnapshot.exists && isImmutablePayrollStatus(slipSnapshot.data()?.status)) {
          throw new HttpError(
            409,
            'Slip tanggal cuti sudah final; pengajuan tidak dapat dibuat.',
          );
        }
        if (!isAnnualPaidLeaveEligible(employee.serviceDate, leaveDate)) {
          throw new HttpError(
            409,
            `Hak cuti pertama berlaku mulai ${employee.qualifyingDate}, setelah masa kerja lebih dari 5 tahun.`,
          );
        }
        if (current?.status === 'pending' || current?.status === 'approved') {
          throw new HttpError(409, 'Tanggal ini sudah memiliki pengajuan cuti aktif.');
        }
        if (
          gantiLiburSnapshot?.docs.some((document) => {
            const gantiLibur = document.data();
            return (
              gantiLibur.dayOffDate === leaveDate &&
              isActiveGantiLiburStatus(gantiLibur.status)
            );
          })
        ) {
          throw new HttpError(409, 'Tanggal ini sudah diajukan sebagai ganti libur.');
        }
        if (
          reservedDays + usedDays + manualUsedDays >= leaveDateEntitlementDays
        ) {
          throw new HttpError(
            409,
            `Jatah cuti ${leaveDateEntitlementDays} hari pada tanggal tersebut sudah terpakai atau sedang menunggu keputusan.`,
          );
        }
        const revision = currentRevision + 1;
        const after = {
          id: requestDocumentId,
          employeeId: employee.id,
          employeeName: employee.name,
          employeeKind: employee.kind,
          employeeCollection: employee.collection,
          category: employee.category,
          leaveDate,
          year,
          period,
          reason,
          serviceDate: employee.serviceDate,
          qualifyingDate: employee.qualifyingDate,
          status: 'pending',
          revision,
          submittedBy: actor.uid,
          submittedByName: actor.displayName,
          submittedAt: now,
          decisionReason: null,
          decidedAt: null,
          decidedBy: null,
          approvedPayType: null,
          approvedAmount: 0,
          updatedAt: now,
          schemaVersion: 1,
        };
        transaction.set(leaveRef, after);
        transaction.set(
          balanceRef,
          {
            employeeId: employee.id,
            employeeKind: employee.kind,
            employeeCollection: employee.collection,
            year,
            entitlementDays: yearEntitlementDays,
            reservedDays: reservedDays + 1,
            usedDays,
            balanceRevision: nextAnnualPaidLeaveBalanceRevision(balanceData.balanceRevision),
            serviceDate: employee.serviceDate,
            qualifyingDate: employee.qualifyingDate,
            updatedAt: now,
            schemaVersion: 1,
          },
          { merge: true },
        );
        transaction.create(
          adminDb
            .collection(ANNUAL_PAID_LEAVE_REVISIONS_COLLECTION)
            .doc(`${requestDocumentId}__r${revision}`),
          {
            annualPaidLeaveRequestId: requestDocumentId,
            revision,
            action,
            before: current || null,
            after,
            actorUid: actor.uid,
            requestId: commandId,
            reason,
            createdAt: now,
          },
        );
        transaction.create(
          newFinancialAuditRef(),
          buildFinancialAuditRecord(actor, {
            action: 'ANNUAL_PAID_LEAVE_SUBMITTED',
            entityType: 'AnnualPaidLeaveRequest',
            entityId: requestDocumentId,
            requestId: commandId,
            reason,
            before: current || null,
            after,
            metadata: { employeeId: employee.id, leaveDate, year, period },
          }),
        );
        transaction.create(idempotencyRef, {
          actorUid: actor.uid,
          requestId: commandId,
          requestHash,
          entityType: 'AnnualPaidLeaveRequest',
          entityId: requestDocumentId,
          status: 'pending',
          revision,
          createdAt: now,
        });
        return { id: requestDocumentId, status: 'pending', revision, idempotent: false };
      }

      if (!current) throw new HttpError(404, 'Pengajuan cuti tidak ditemukan.');
      if (!isAnnualPaidLeaveRequestOwner(current.employeeId, employee.id)) {
        throw new HttpError(403, 'Pengajuan cuti bukan milik akun ini.');
      }
      if (current.status !== 'pending') {
        throw new HttpError(409, 'Hanya pengajuan menunggu yang dapat ditarik.');
      }
      const revision = currentRevision + 1;
      const after = {
        ...current,
        status: 'withdrawn',
        revision,
        withdrawnAt: now,
        withdrawnBy: actor.uid,
        updatedAt: now,
      };
      transaction.set(leaveRef, after);
      transaction.set(
        balanceRef,
        {
          reservedDays: Math.max(0, reservedDays - 1),
          usedDays,
          balanceRevision: nextAnnualPaidLeaveBalanceRevision(balanceData.balanceRevision),
          updatedAt: now,
        },
        { merge: true },
      );
      transaction.create(
        adminDb
          .collection(ANNUAL_PAID_LEAVE_REVISIONS_COLLECTION)
          .doc(`${requestDocumentId}__r${revision}`),
        {
          annualPaidLeaveRequestId: requestDocumentId,
          revision,
          action,
          before: current,
          after,
          actorUid: actor.uid,
          requestId: commandId,
          reason,
          createdAt: now,
        },
      );
      transaction.create(
        newFinancialAuditRef(),
        buildFinancialAuditRecord(actor, {
          action: 'ANNUAL_PAID_LEAVE_WITHDRAWN',
          entityType: 'AnnualPaidLeaveRequest',
          entityId: requestDocumentId,
          requestId: commandId,
          reason,
          before: current,
          after,
          metadata: { employeeId: employee.id, leaveDate, year, period },
        }),
      );
      transaction.create(idempotencyRef, {
        actorUid: actor.uid,
        requestId: commandId,
        requestHash,
        entityType: 'AnnualPaidLeaveRequest',
        entityId: requestDocumentId,
        status: 'withdrawn',
        revision,
        createdAt: now,
      });
      return { id: requestDocumentId, status: 'withdrawn', revision, idempotent: false };
    });

    return Response.json(result, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    return errorResponse(error);
  }
}
