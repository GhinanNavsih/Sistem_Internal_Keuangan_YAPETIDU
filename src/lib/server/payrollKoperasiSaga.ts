import { createHash } from 'node:crypto';
import admin, { adminDb } from '@/lib/firebase-admin';
import { calculatePayrollTotals, validateMoneyFields } from '@/lib/payroll/domain';
import { canVerifyPayroll } from '@/lib/payroll/roles';
import { buildFinancialAuditRecord, newFinancialAuditRef } from '@/lib/server/audit';
import { AuthenticatedProfile, HttpError } from '@/lib/server/auth';
import {
  applyKoperasiInstallmentPlan,
  KoperasiBridgeEmployee,
  KoperasiBridgeError,
  KoperasiInstallmentPlan,
  KoperasiProgressionReceipt,
  hashKoperasiInstallmentPlan,
  koperasiLoanDeduction,
  previewKoperasiInstallmentPlan,
} from '@/lib/server/koperasiPayrollBridge';

interface PayrollCommandLike {
  employeeId: string;
  period: string;
  requestId: string;
  reason?: string;
  deductions?: unknown;
}

function hashPayload(payload: unknown): string {
  return createHash('sha256').update(JSON.stringify(payload)).digest('hex');
}

function operationId(slipId: string): string {
  return `payroll_${slipId}`;
}

function requireReason(command: PayrollCommandLike): string {
  const reason = command.reason?.trim() || '';
  if (reason.length < 8 || reason.length > 500) {
    throw new HttpError(400, 'Alasan wajib diisi antara 8 dan 500 karakter.');
  }
  return reason;
}

function employeeIdentity(
  employeeId: string,
  blueData: FirebaseFirestore.DocumentData | undefined,
  loyalisData: FirebaseFirestore.DocumentData | undefined,
): KoperasiBridgeEmployee {
  const data = blueData || loyalisData;
  if (!data) throw new HttpError(404, 'Pegawai payroll tidak ditemukan.');
  const name = blueData?.name || loyalisData?.personal_info?.name || '';
  if (!String(name).trim()) {
    throw new HttpError(409, 'Nama pegawai tidak tersedia untuk pencocokan Koperasi.');
  }
  return {
    id: employeeId,
    name: String(name).trim(),
    koperasiAuthUid:
      typeof data.koperasiAuthUid === 'string' && data.koperasiAuthUid.trim()
        ? data.koperasiAuthUid.trim()
        : null,
  };
}

function actorPayload(actor: AuthenticatedProfile) {
  return { uid: actor.uid, name: actor.displayName, role: actor.role };
}

export async function prepareKoperasiPlanForDraft(
  command: PayrollCommandLike,
  actor: AuthenticatedProfile,
): Promise<KoperasiInstallmentPlan> {
  const deductions = validateMoneyFields(command.deductions, 'deductions');
  const blueRef = adminDb.collection('Employees_BlueCollar').doc(command.employeeId);
  const loyalisRef = adminDb.collection('Employees_Loyalis').doc(command.employeeId);
  const [blueSnapshot, loyalisSnapshot] = await adminDb.getAll(blueRef, loyalisRef);
  const employee = employeeIdentity(
    command.employeeId,
    blueSnapshot.exists ? blueSnapshot.data() : undefined,
    loyalisSnapshot.exists ? loyalisSnapshot.data() : undefined,
  );
  const slipId = `${command.period}_${command.employeeId}`;
  return previewKoperasiInstallmentPlan({
    operationId: `preview_${hashPayload({ slipId, requestId: command.requestId }).slice(0, 32)}`,
    slipId,
    payrollPeriod: command.period.replace('_', '-'),
    employee,
    expectedDeduction: koperasiLoanDeduction(deductions),
    actor: actorPayload(actor),
  });
}

function validateStoredPlan(
  raw: unknown,
  command: PayrollCommandLike,
  savedDeductions: unknown,
): KoperasiInstallmentPlan {
  const plan = raw as Partial<KoperasiInstallmentPlan> | null;
  const expectedDeduction = koperasiLoanDeduction(
    validateMoneyFields(savedDeductions, 'deductions'),
  );
  const planTotal = Array.isArray(plan?.loans)
    ? plan.loans.reduce(
        (total, loan) => total + Number(loan?.installmentAmount || 0),
        0,
      )
    : -1;
  if (
    !plan ||
    plan.schemaVersion !== 1 ||
    plan.payrollPeriod !== command.period.replace('_', '-') ||
    typeof plan.planHash !== 'string' ||
    !/^[a-f0-9]{64}$/.test(plan.planHash) ||
    !Number.isSafeInteger(plan.expectedDeduction) ||
    !Array.isArray(plan.loans) ||
    plan.expectedDeduction !== expectedDeduction ||
    planTotal !== expectedDeduction ||
    hashKoperasiInstallmentPlan(plan as KoperasiInstallmentPlan) !== plan.planHash
  ) {
    throw new HttpError(
      409,
      'Draf belum memiliki rencana cicilan Koperasi yang valid. Simpan ulang draf sebelum menutup periode.',
    );
  }
  return plan as KoperasiInstallmentPlan;
}

async function recordOperationFailure(
  operationRef: FirebaseFirestore.DocumentReference,
  error: KoperasiBridgeError,
): Promise<void> {
  await adminDb.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(operationRef);
    if (snapshot.data()?.status === 'completed') return;
    transaction.set(operationRef, {
      status: error.status >= 500 ? 'retryable' : 'blocked',
      lastErrorCode: error.code,
      lastErrorMessage: error.message.slice(0, 500),
      lastErrorDetails: error.details || null,
      lastAttemptAt: admin.firestore.FieldValue.serverTimestamp(),
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    }, { merge: true });
  });
}

export async function verifyAndLockWithKoperasi(
  command: PayrollCommandLike,
  actor: AuthenticatedProfile,
): Promise<{
  slipId: string;
  status: 'locked';
  idempotent: boolean;
  koperasi: KoperasiProgressionReceipt;
}> {
  if (!canVerifyPayroll(actor.role)) {
    throw new HttpError(
      403,
      'Hanya Badan Keuangan atau Super Admin yang dapat memverifikasi dan mengunci.',
    );
  }
  const reason = requireReason(command);
  const slipId = `${command.period}_${command.employeeId}`;
  const slipRef = adminDb.collection('PayrollSlipStates').doc(slipId);
  const periodRef = adminDb.collection('PayrollPeriods').doc(command.period.replace('_', '-'));
  const operationRef = adminDb.collection('PayrollKoperasiProgressions').doc(slipId);
  const idempotencyRef = adminDb
    .collection('FinancialIdempotencyKeys')
    .doc(`${actor.uid}__${command.requestId}`);
  const blueRef = adminDb.collection('Employees_BlueCollar').doc(command.employeeId);
  const loyalisRef = adminDb.collection('Employees_Loyalis').doc(command.employeeId);
  const commandHash = hashPayload({ action: 'verify_and_lock', ...command });

  const prepared = await adminDb.runTransaction(async (transaction) => {
    const [slipSnapshot, periodSnapshot, operationSnapshot, idempotencySnapshot, blueSnapshot, loyalisSnapshot] =
      await Promise.all([
        transaction.get(slipRef),
        transaction.get(periodRef),
        transaction.get(operationRef),
        transaction.get(idempotencyRef),
        transaction.get(blueRef),
        transaction.get(loyalisRef),
      ]);
    if (idempotencySnapshot.exists) {
      const previous = idempotencySnapshot.data()!;
      if (previous.requestHash !== commandHash || previous.entityId !== slipId) {
        throw new HttpError(409, 'requestId sudah digunakan untuk perintah berbeda.');
      }
      const receipt = operationSnapshot.data()?.receipt as KoperasiProgressionReceipt | undefined;
      if (!receipt) throw new HttpError(409, 'Receipt Koperasi untuk operasi idempoten tidak ditemukan.');
      return { completed: true as const, plan: null, employee: null, receipt };
    }
    if (periodSnapshot.data()?.attendanceStatus !== 'closed') {
      throw new HttpError(409, 'Tutup periode payroll sebelum verifikasi dan penguncian.');
    }
    const before = slipSnapshot.data();
    const existingOperation = operationSnapshot.data();
    if (before?.status === 'locked' && existingOperation?.status === 'completed') {
      return {
        completed: true as const,
        plan: null,
        employee: null,
        receipt: existingOperation.receipt as KoperasiProgressionReceipt,
      };
    }
    if (!slipSnapshot.exists || before?.status !== 'draft') {
      throw new HttpError(409, 'Hanya slip draf yang dapat diverifikasi dan dikunci.');
    }
    const plan = validateStoredPlan(
      before.koperasiInstallmentPlan,
      command,
      before.deductions,
    );
    if (
      existingOperation &&
      (existingOperation.planHash !== plan.planHash ||
        Number(existingOperation.sourceRevision) !== Number(before.revision || 0))
    ) {
      throw new HttpError(409, 'Operasi cicilan sebelumnya memakai revisi draf yang berbeda.');
    }
    const employee = employeeIdentity(
      command.employeeId,
      blueSnapshot.exists ? blueSnapshot.data() : undefined,
      loyalisSnapshot.exists ? loyalisSnapshot.data() : undefined,
    );
    const now = admin.firestore.FieldValue.serverTimestamp();
    transaction.set(operationRef, {
      schemaVersion: 1,
      operationId: operationId(slipId),
      slipId,
      employeeId: command.employeeId,
      payrollPeriod: plan.payrollPeriod,
      planHash: plan.planHash,
      sourceRevision: Number(before.revision || 0),
      status: 'external_pending',
      attemptCount: Number(existingOperation?.attemptCount || 0) + 1,
      requestedBy: actor.uid,
      reason,
      createdAt: existingOperation?.createdAt || now,
      updatedAt: now,
      lastAttemptAt: now,
    }, { merge: true });
    return { completed: false as const, plan, employee, receipt: null };
  });

  if (prepared.completed) {
    return { slipId, status: 'locked', idempotent: true, koperasi: prepared.receipt };
  }

  let receipt: KoperasiProgressionReceipt;
  try {
    receipt = await applyKoperasiInstallmentPlan({
      operationId: operationId(slipId),
      slipId,
      payrollPeriod: prepared.plan.payrollPeriod,
      employee: prepared.employee,
      expectedDeduction: prepared.plan.expectedDeduction,
      actor: actorPayload(actor),
      plan: prepared.plan,
    });
  } catch (error) {
    const bridgeError = error instanceof KoperasiBridgeError
      ? error
      : new KoperasiBridgeError(503, 'KOPERASI_UNAVAILABLE', 'Koperasi tidak dapat dihubungi.');
    await recordOperationFailure(operationRef, bridgeError);
    throw new HttpError(
      bridgeError.status >= 500 ? 503 : 409,
      `${bridgeError.message} Slip tetap berstatus draf.`,
    );
  }

  return adminDb.runTransaction(async (transaction) => {
    const [slipSnapshot, periodSnapshot, operationSnapshot, idempotencySnapshot] =
      await Promise.all([
        transaction.get(slipRef),
        transaction.get(periodRef),
        transaction.get(operationRef),
        transaction.get(idempotencyRef),
      ]);
    if (idempotencySnapshot.exists) {
      const previous = idempotencySnapshot.data()!;
      if (previous.requestHash !== commandHash || previous.entityId !== slipId) {
        throw new HttpError(409, 'requestId sudah digunakan untuk perintah berbeda.');
      }
      return { slipId, status: 'locked' as const, idempotent: true, koperasi: receipt };
    }
    if (periodSnapshot.data()?.attendanceStatus !== 'closed') {
      throw new HttpError(409, 'Periode payroll tidak lagi tertutup.');
    }
    const before = slipSnapshot.data();
    const operation = operationSnapshot.data();
    if (before?.status === 'locked' && operation?.status === 'completed') {
      return {
        slipId,
        status: 'locked' as const,
        idempotent: true,
        koperasi: operation.receipt as KoperasiProgressionReceipt,
      };
    }
    if (!before || before.status !== 'draft') {
      throw new HttpError(409, 'Draf berubah sebelum penguncian dapat diselesaikan.');
    }
    const plan = validateStoredPlan(
      before.koperasiInstallmentPlan,
      command,
      before.deductions,
    );
    if (
      operation?.planHash !== plan.planHash ||
      Number(operation?.sourceRevision) !== Number(before.revision || 0) ||
      receipt.planHash !== plan.planHash
    ) {
      throw new HttpError(409, 'Receipt Koperasi tidak cocok dengan draf yang disegel.');
    }
    const earnings = validateMoneyFields(before.earnings, 'earnings');
    const deductions = validateMoneyFields(before.deductions, 'deductions');
    const totals = calculatePayrollTotals(earnings, deductions);
    const now = admin.firestore.FieldValue.serverTimestamp();
    const immutableSnapshot = {
      schemaVersion: 4,
      employeeId: before.employeeId,
      period: before.period,
      earnings,
      deductions,
      ...totals,
      koperasiInstallmentPlan: plan,
      koperasiProgressionReceipt: receipt,
      verifiedAndLockedBy: actor.uid,
      verificationReason: reason,
      sourceRevision: Number(before.revision || 0),
    };
    const lockedSnapshotHash = hashPayload(immutableSnapshot);
    const after = {
      ...before,
      status: 'locked',
      earnings,
      deductions,
      ...totals,
      koperasiProgressionReceipt: receipt,
      verifiedAt: now,
      verifiedBy: actor.uid,
      verificationReason: reason,
      lockedAt: now,
      lockedBy: actor.uid,
      lockedSnapshotHash,
      lockedSnapshot: immutableSnapshot,
      revision: Number(before.revision || 0) + 1,
      updatedAt: now,
    };
    transaction.set(slipRef, after);
    transaction.set(operationRef, {
      status: 'completed',
      receipt,
      completedAt: now,
      updatedAt: now,
      lastErrorCode: null,
      lastErrorMessage: null,
      lastErrorDetails: null,
    }, { merge: true });
    transaction.create(
      newFinancialAuditRef(),
      buildFinancialAuditRecord(actor, {
        action: 'VERIFY_AND_LOCK',
        entityType: 'PayrollSlipState',
        entityId: slipId,
        reason,
        requestId: command.requestId,
        before,
        after,
        metadata: { koperasiProgressionReceipt: receipt },
      }),
    );
    transaction.create(idempotencyRef, {
      actorUid: actor.uid,
      requestId: command.requestId,
      requestHash: commandHash,
      entityType: 'PayrollSlipState',
      entityId: slipId,
      resultingStatus: 'locked',
      createdAt: now,
    });
    return { slipId, status: 'locked' as const, idempotent: false, koperasi: receipt };
  });
}
