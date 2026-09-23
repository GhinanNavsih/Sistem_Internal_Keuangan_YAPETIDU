import { createHash } from 'node:crypto';
import { NextRequest } from 'next/server';
import admin, { adminDb } from '@/lib/firebase-admin';
import {
  ANNUAL_PAID_LEAVE_DAYS,
  annualPaidLeaveIdempotencyState,
  type AnnualPaidLeaveEmployeeKind,
} from '@/lib/payroll/annualPaidLeave';
import { assertRequestId } from '@/lib/payroll/domain';
import {
  ANNUAL_PAID_LEAVE_BALANCES_COLLECTION,
  ANNUAL_PAID_LEAVE_BALANCE_REVISIONS_COLLECTION,
  annualPaidLeaveBalanceDocumentId,
  annualPaidLeaveEmployeeDataMatches,
  annualPaidLeaveEmployeeFromData,
  loadAnnualPaidLeaveEmployee,
  reviewerCanAccessAnnualPaidLeave,
} from '@/lib/server/annualPaidLeave';
import { buildFinancialAuditRecord, newFinancialAuditRef } from '@/lib/server/audit';
import {
  errorResponse,
  HttpError,
  requireAuthenticatedProfile,
  requireRole,
} from '@/lib/server/auth';
import { jakartaToday } from '@/lib/server/payrollPeriod';

export const dynamic = 'force-dynamic';

const BALANCE_REVIEWER_ROLES = [
  'super_admin',
  'satker_head',
  'loyalis_presence_admin',
] as const;

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

function parseEmployeeKind(value: unknown): AnnualPaidLeaveEmployeeKind {
  if (value === 'loyalis' || value === 'blue_collar') return value;
  throw new HttpError(400, 'Jenis pegawai tidak valid.');
}

function countDays(value: unknown): number {
  const numberValue = Number(value || 0);
  return Number.isSafeInteger(numberValue) ? Math.max(0, numberValue) : 0;
}

function parseExpectedRevision(value: unknown): number {
  const revision = Number(value);
  if (!Number.isSafeInteger(revision) || revision < 0) {
    throw new HttpError(400, 'Revisi saldo tidak valid.');
  }
  return revision;
}

export async function GET(request: NextRequest) {
  try {
    const actor = await requireAuthenticatedProfile(request);
    requireRole(actor, BALANCE_REVIEWER_ROLES);
    const year = parseYear(request.nextUrl.searchParams.get('year'));
    const kinds: AnnualPaidLeaveEmployeeKind[] = actor.role === 'loyalis_presence_admin'
      ? ['loyalis']
      : actor.role === 'satker_head'
        ? ['blue_collar']
        : ['loyalis', 'blue_collar'];

    const snapshots = await Promise.all(
      kinds.map((kind) =>
        kind === 'loyalis'
          ? adminDb
              .collection('Employees_Loyalis')
              .where('personal_info.status', '==', 'AKTIF')
              .get()
          : adminDb
              .collection('Employees_BlueCollar')
              .where('employment.status', '==', 'active')
              .get(),
      ),
    );
    const employees = snapshots.flatMap((snapshot, index) => {
      const kind = kinds[index];
      return snapshot.docs.flatMap((document) => {
        const employee = annualPaidLeaveEmployeeFromData(
          document.id,
          kind,
          document.data(),
        );
        if (
          !employee ||
          !employee.active ||
          !employee.category ||
          employee.qualifyingDate > `${year}-12-31` ||
          !reviewerCanAccessAnnualPaidLeave(actor, employee)
        ) {
          return [];
        }
        return [employee];
      });
    }).sort((left, right) =>
      left.name.localeCompare(right.name, 'id') || left.id.localeCompare(right.id),
    );

    const balanceRefs = employees.map((employee) =>
      adminDb
        .collection(ANNUAL_PAID_LEAVE_BALANCES_COLLECTION)
        .doc(annualPaidLeaveBalanceDocumentId(employee.id, year)),
    );
    const balanceSnapshots = balanceRefs.length > 0
      ? await adminDb.getAll(...balanceRefs)
      : [];
    const rows = employees.map((employee, index) => {
      const balance = balanceSnapshots[index]?.data() || {};
      const reservedDays = countDays(balance.reservedDays);
      const appUsedDays = countDays(balance.usedDays);
      const manualUsedDays = countDays(balance.manualUsedDays);
      const maxSettableRemainingDays = Math.max(
        0,
        ANNUAL_PAID_LEAVE_DAYS - reservedDays - appUsedDays,
      );
      return {
        employeeId: employee.id,
        employeeName: employee.name || employee.id,
        employeeKind: employee.kind,
        category: employee.category,
        serviceDate: employee.serviceDate,
        qualifyingDate: employee.qualifyingDate,
        entitlementDays: ANNUAL_PAID_LEAVE_DAYS,
        reservedDays,
        usedDays: appUsedDays + manualUsedDays,
        manualUsedDays,
        availableDays: Math.max(
          0,
          maxSettableRemainingDays - manualUsedDays,
        ),
        maxSettableRemainingDays,
        revision: countDays(balance.balanceRevision),
      };
    });

    return Response.json(
      { year, employees: rows },
      { headers: { 'Cache-Control': 'no-store' } },
    );
  } catch (error) {
    return errorResponse(error);
  }
}

export async function POST(request: NextRequest) {
  try {
    const actor = await requireAuthenticatedProfile(request);
    requireRole(actor, BALANCE_REVIEWER_ROLES);
    const body = (await request.json()) as Record<string, unknown>;
    const employeeId = String(body.employeeId || '').trim();
    const employeeKind = parseEmployeeKind(body.employeeKind);
    const year = parseYear(String(body.year || ''));
    const remainingDays = body.remainingDays;
    const expectedRevision = parseExpectedRevision(body.expectedRevision);
    const commandId = String(body.requestId || '');
    const reason = typeof body.reason === 'string' ? body.reason.trim() : '';

    if (!/^[A-Za-z0-9_-]{1,128}$/.test(employeeId)) {
      throw new HttpError(400, 'ID pegawai tidak valid.');
    }
    if (
      typeof remainingDays !== 'number' ||
      !Number.isSafeInteger(remainingDays) ||
      remainingDays < 0 ||
      remainingDays > ANNUAL_PAID_LEAVE_DAYS
    ) {
      throw new HttpError(400, `Sisa cuti harus berupa bilangan bulat 0–${ANNUAL_PAID_LEAVE_DAYS}.`);
    }
    if (reason.length < 8 || reason.length > 500) {
      throw new HttpError(400, 'Alasan perubahan saldo wajib diisi antara 8 dan 500 karakter.');
    }
    try {
      assertRequestId(commandId);
    } catch (error) {
      throw new HttpError(
        400,
        error instanceof Error ? error.message : 'ID permintaan tidak valid.',
      );
    }

    const employee = await loadAnnualPaidLeaveEmployee(employeeId, employeeKind);
    if (!employee || !employee.active) {
      throw new HttpError(409, 'Pegawai aktif tidak ditemukan.');
    }
    if (employee.kind === 'blue_collar' && !employee.category) {
      throw new HttpError(409, 'Kategori pekerjaan pegawai belum diisi.');
    }
    if (!reviewerCanAccessAnnualPaidLeave(actor, employee)) {
      throw new HttpError(403, 'Anda tidak berwenang mengatur saldo pegawai ini.');
    }
    if (employee.qualifyingDate > `${year}-12-31`) {
      throw new HttpError(409, 'Pegawai belum berhak atas cuti tahunan pada tahun tersebut.');
    }

    const balanceRef = adminDb
      .collection(ANNUAL_PAID_LEAVE_BALANCES_COLLECTION)
      .doc(annualPaidLeaveBalanceDocumentId(employee.id, year));
    const employeeRef = adminDb.collection(employee.collection).doc(employee.id);
    const idempotencyRef = adminDb
      .collection('FinancialIdempotencyKeys')
      .doc(`${actor.uid}__${commandId}`);
    const requestHash = stableHash({
      action: 'set_remaining',
      employeeId,
      employeeKind,
      year,
      remainingDays,
      expectedRevision,
      reason,
      commandId,
    });

    const result = await adminDb.runTransaction(async (transaction) => {
      const [balanceSnapshot, employeeSnapshot, idempotencySnapshot] =
        await Promise.all([
          transaction.get(balanceRef),
          transaction.get(employeeRef),
          transaction.get(idempotencyRef),
        ]);

      if (idempotencySnapshot.exists) {
        if (
          annualPaidLeaveIdempotencyState(
            idempotencySnapshot.data()?.requestHash,
            requestHash,
          ) === 'conflict'
        ) {
          throw new HttpError(409, 'ID permintaan sudah digunakan untuk perubahan lain.');
        }
        const stored = idempotencySnapshot.data() || {};
        return {
          remainingDays: countDays(stored.remainingDays),
          manualUsedDays: countDays(stored.manualUsedDays),
          revision: countDays(stored.balanceRevision),
          idempotent: true,
        };
      }

      if (
        !employeeSnapshot.exists ||
        !annualPaidLeaveEmployeeDataMatches(employee, employeeSnapshot.data() || {})
      ) {
        throw new HttpError(409, 'Data pegawai berubah. Muat ulang sebelum mengatur saldo.');
      }

      const currentBalance = balanceSnapshot.data() || {};
      const currentRevision = countDays(currentBalance.balanceRevision);
      if (currentRevision !== expectedRevision) {
        throw new HttpError(409, 'Saldo telah berubah. Segarkan daftar sebelum mengatur kembali.');
      }
      const reservedDays = countDays(currentBalance.reservedDays);
      const appUsedDays = countDays(currentBalance.usedDays);
      const previousManualUsedDays = countDays(currentBalance.manualUsedDays);
      if (reservedDays + appUsedDays > ANNUAL_PAID_LEAVE_DAYS) {
        throw new HttpError(
          409,
          'Saldo cuti tidak konsisten dengan jumlah pengajuan yang sudah disetujui atau menunggu.',
        );
      }
      const maxSettableRemainingDays = Math.max(
        0,
        ANNUAL_PAID_LEAVE_DAYS - reservedDays - appUsedDays,
      );
      if (remainingDays > maxSettableRemainingDays) {
        throw new HttpError(
          409,
          `Sisa cuti tidak dapat melebihi ${maxSettableRemainingDays} hari karena ada cuti yang sudah dipakai atau menunggu.`,
        );
      }

      const manualUsedDays =
        ANNUAL_PAID_LEAVE_DAYS - reservedDays - appUsedDays - remainingDays;
      const balanceRevision = currentRevision + 1;
      const now = admin.firestore.FieldValue.serverTimestamp();
      const before = {
        entitlementDays: ANNUAL_PAID_LEAVE_DAYS,
        reservedDays,
        appUsedDays,
        manualUsedDays: previousManualUsedDays,
        usedDays: appUsedDays + previousManualUsedDays,
        availableDays: Math.max(
          0,
          ANNUAL_PAID_LEAVE_DAYS - reservedDays - appUsedDays - previousManualUsedDays,
        ),
      };
      const after = {
        entitlementDays: ANNUAL_PAID_LEAVE_DAYS,
        reservedDays,
        appUsedDays,
        manualUsedDays,
        usedDays: appUsedDays + manualUsedDays,
        availableDays: remainingDays,
      };
      const balanceRevisionRef = adminDb
        .collection(ANNUAL_PAID_LEAVE_BALANCE_REVISIONS_COLLECTION)
        .doc(`${balanceRef.id}__r${balanceRevision}`);

      transaction.set(
        balanceRef,
        {
          employeeId: employee.id,
          employeeKind: employee.kind,
          employeeCollection: employee.collection,
          category: employee.category,
          year,
          entitlementDays: ANNUAL_PAID_LEAVE_DAYS,
          reservedDays,
          usedDays: appUsedDays,
          manualUsedDays,
          balanceRevision,
          serviceDate: employee.serviceDate,
          qualifyingDate: employee.qualifyingDate,
          lastBalanceEditedAt: now,
          lastBalanceEditedBy: actor.uid,
          lastBalanceEditReason: reason,
          updatedAt: now,
          schemaVersion: 1,
        },
        { merge: true },
      );
      transaction.create(balanceRevisionRef, {
        annualPaidLeaveBalanceId: balanceRef.id,
        employeeId: employee.id,
        employeeKind: employee.kind,
        employeeName: employee.name,
        category: employee.category,
        year,
        revision: balanceRevision,
        action: 'set_remaining',
        before,
        after,
        reason,
        actorUid: actor.uid,
        actorRole: actor.role,
        actorName: actor.displayName,
        requestId: commandId,
        createdAt: now,
        schemaVersion: 1,
      });
      transaction.create(
        newFinancialAuditRef(),
        buildFinancialAuditRecord(actor, {
          action: 'ANNUAL_PAID_LEAVE_BALANCE_SET',
          entityType: 'AnnualPaidLeaveBalance',
          entityId: balanceRef.id,
          requestId: commandId,
          reason,
          before,
          after,
          metadata: {
            employeeId: employee.id,
            employeeKind: employee.kind,
            category: employee.category,
            year,
            balanceRevision,
          },
        }),
      );
      transaction.create(idempotencyRef, {
        actorUid: actor.uid,
        requestId: commandId,
        requestHash,
        entityType: 'AnnualPaidLeaveBalance',
        entityId: balanceRef.id,
        status: 'updated',
        remainingDays,
        manualUsedDays,
        balanceRevision,
        createdAt: now,
      });

      return {
        remainingDays,
        manualUsedDays,
        revision: balanceRevision,
        idempotent: false,
      };
    });

    return Response.json(result, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    return errorResponse(error);
  }
}
