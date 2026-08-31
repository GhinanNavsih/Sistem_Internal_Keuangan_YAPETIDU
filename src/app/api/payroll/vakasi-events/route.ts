import { createHash } from 'node:crypto';
import { NextRequest } from 'next/server';
import admin, { adminDb } from '@/lib/firebase-admin';
import { assertRequestId, isImmutablePayrollStatus } from '@/lib/payroll/domain';
import { URAIAN_EDITOR_ROLES } from '@/lib/payroll/roles';
import {
  buildVakasiPekaryaProjectionInputs,
  isProposalLpjSandboxSource,
  isPayableVakasiTambahan,
  VAKASI_PEKARYA_PROJECTION_SOURCE_KIND,
  vakasiWorkerCollection,
  type ResolvedVakasiWorker,
  type VakasiEmployeeCollection,
  type VakasiWorkerLike,
} from '@/lib/payroll/vakasiTambahan';
import { buildFinancialAuditRecord, newFinancialAuditRef } from '@/lib/server/audit';
import {
  errorResponse,
  HttpError,
  requireAuthenticatedProfile,
  requireRole,
  type AuthenticatedProfile,
} from '@/lib/server/auth';
import { assertPeriodAcceptsInput } from '@/lib/server/payrollPeriod';
import { POST as propagateVakasiRoute } from '@/app/api/payroll/vakasi-propagation/route';

export const dynamic = 'force-dynamic';

type VakasiAction = 'save' | 'submit' | 'review' | 'unapprove';
type VakasiStatus =
  | 'draft'
  | 'pending_review'
  | 'approved'
  | 'revision_needed'
  | 'declined';

interface VakasiWorkerInput {
  employeeId: string;
  payGiven: number;
}

interface VakasiSnapshotInput {
  eventName: string;
  period: string;
  isEndOfMonth: boolean;
  departmentUnit: string | null;
  reportFileUrl: string | null;
  reportFileName: string | null;
  workers: VakasiWorkerInput[];
}

interface VakasiCommand {
  requestId: string;
  action: VakasiAction;
  eventId?: string;
  expectedRevision?: number;
  desiredStatus?: 'draft' | 'revision_needed' | 'approved';
  reviewAction?: 'approved' | 'revision_needed' | 'declined';
  reviewNote?: string;
  snapshot?: VakasiSnapshotInput;
}

interface DirectoryRecord {
  employeeId: string;
  employeeCollection: VakasiEmployeeCollection;
  employeeName: string;
  active: boolean;
  jobCategory?: string;
  department?: string;
  role?: string;
}

const SAFE_EVENT_ID = /^[A-Za-z0-9_-]{1,220}$/;
const SAFE_EMPLOYEE_ID = /^[A-Za-z0-9_-]{1,128}$/;
const MAX_RECIPIENT_AMOUNT = 100_000_000;

function normalizedText(value: unknown, maxLength: number): string {
  return typeof value === 'string'
    ? value.normalize('NFKC').trim().slice(0, maxLength)
    : '';
}

function nullableText(value: unknown, maxLength: number): string | null {
  const text = normalizedText(value, maxLength);
  return text || null;
}

function parseSnapshot(value: unknown): VakasiSnapshotInput {
  if (!value || typeof value !== 'object') {
    throw new HttpError(400, 'Rincian kegiatan Vakasi wajib diisi.');
  }
  const raw = value as Record<string, unknown>;
  const eventName = normalizedText(raw.eventName, 180);
  if (eventName.length < 2) {
    throw new HttpError(400, 'Nama kegiatan wajib diisi antara 2 dan 180 karakter.');
  }
  const period = typeof raw.period === 'string' ? raw.period : '';
  if (!/^\d{4}-\d{2}$/.test(period)) {
    throw new HttpError(400, 'Periode wajib menggunakan format YYYY-MM.');
  }
  if (!Array.isArray(raw.workers) || raw.workers.length < 1 || raw.workers.length > 200) {
    throw new HttpError(400, 'Daftar penerima wajib berisi 1 sampai 200 pegawai.');
  }

  const workers = raw.workers.map((worker): VakasiWorkerInput => {
    if (!worker || typeof worker !== 'object') {
      throw new HttpError(400, 'Data penerima Vakasi tidak valid.');
    }
    const candidate = worker as Record<string, unknown>;
    const employeeId = typeof candidate.employeeId === 'string'
      ? candidate.employeeId
      : '';
    if (!SAFE_EMPLOYEE_ID.test(employeeId)) {
      throw new HttpError(400, 'ID penerima Vakasi tidak valid.');
    }
    const payGiven = candidate.payGiven;
    if (
      typeof payGiven !== 'number' ||
      !Number.isSafeInteger(payGiven) ||
      payGiven <= 0 ||
      payGiven > MAX_RECIPIENT_AMOUNT
    ) {
      throw new HttpError(400, `Nominal Vakasi ${employeeId} tidak valid.`);
    }
    return { employeeId, payGiven };
  });
  if (new Set(workers.map((worker) => worker.employeeId)).size !== workers.length) {
    throw new HttpError(400, 'Daftar penerima Vakasi tidak boleh duplikat.');
  }

  return {
    eventName,
    period,
    isEndOfMonth: raw.isEndOfMonth === true,
    departmentUnit: nullableText(raw.departmentUnit, 120),
    reportFileUrl: nullableText(raw.reportFileUrl, 2_000),
    reportFileName: nullableText(raw.reportFileName, 240),
    workers,
  };
}

function parseCommand(raw: unknown): VakasiCommand {
  if (!raw || typeof raw !== 'object') {
    throw new HttpError(400, 'Perintah kegiatan Vakasi tidak valid.');
  }
  const value = raw as Record<string, unknown>;
  const requestId = typeof value.requestId === 'string' ? value.requestId : '';
  try {
    assertRequestId(requestId);
  } catch (error) {
    throw new HttpError(
      400,
      error instanceof Error ? error.message : 'requestId tidak valid.',
    );
  }
  const action = value.action;
  if (action !== 'save' && action !== 'submit' && action !== 'review' && action !== 'unapprove') {
    throw new HttpError(400, 'Tindakan kegiatan Vakasi tidak valid.');
  }
  const eventId = typeof value.eventId === 'string' ? value.eventId : undefined;
  if (eventId && !SAFE_EVENT_ID.test(eventId)) {
    throw new HttpError(400, 'ID kegiatan Vakasi tidak valid.');
  }
  const expectedRevision = value.expectedRevision;
  if (
    expectedRevision !== undefined &&
    (!Number.isSafeInteger(expectedRevision) || Number(expectedRevision) < 0)
  ) {
    throw new HttpError(400, 'Revisi kegiatan Vakasi tidak valid.');
  }

  const desiredStatus = value.desiredStatus;
  if (
    desiredStatus !== undefined &&
    desiredStatus !== 'draft' &&
    desiredStatus !== 'revision_needed' &&
    desiredStatus !== 'approved'
  ) {
    throw new HttpError(400, 'Status penyimpanan Vakasi tidak valid.');
  }
  const reviewAction = value.reviewAction;
  if (
    reviewAction !== undefined &&
    reviewAction !== 'approved' &&
    reviewAction !== 'revision_needed' &&
    reviewAction !== 'declined'
  ) {
    throw new HttpError(400, 'Keputusan review Vakasi tidak valid.');
  }
  const reviewNote = nullableText(value.reviewNote, 500) || undefined;
  if ((reviewAction === 'revision_needed' || reviewAction === 'declined') && !reviewNote) {
    throw new HttpError(400, 'Catatan review wajib diisi.');
  }
  if ((action === 'review' || action === 'unapprove') && !eventId) {
    throw new HttpError(400, 'ID kegiatan Vakasi wajib diisi.');
  }
  if (action === 'review' && !reviewAction) {
    throw new HttpError(400, 'Keputusan review Vakasi wajib diisi.');
  }

  return {
    requestId,
    action,
    eventId,
    expectedRevision: expectedRevision as number | undefined,
    desiredStatus: desiredStatus as VakasiCommand['desiredStatus'],
    reviewAction: reviewAction as VakasiCommand['reviewAction'],
    reviewNote,
    snapshot:
      action === 'save' || action === 'submit'
        ? parseSnapshot(value.snapshot)
        : undefined,
  };
}

function assertActionAllowed(actor: AuthenticatedProfile, command: VakasiCommand): void {
  requireRole(actor, URAIAN_EDITOR_ROLES);
  if (command.action === 'save') {
    requireRole(actor, ['super_admin', 'finance_verifier', 'satker_head_loyalis']);
  }
  if (command.action === 'review' || command.action === 'unapprove') {
    requireRole(actor, ['super_admin']);
  }
  if (command.action === 'submit') {
    requireRole(actor, ['satker_head_loyalis', 'super_admin']);
  }
  if (
    command.action === 'save' &&
    command.desiredStatus === 'approved' &&
    actor.role !== 'super_admin' &&
    actor.role !== 'finance_verifier'
  ) {
    throw new HttpError(403, 'Hanya Badan Keuangan yang dapat menyimpan Vakasi sebagai disetujui.');
  }
}

function workersFromEvent(data: Record<string, unknown> | null): VakasiWorkerInput[] {
  if (!data?.eventWorkers || typeof data.eventWorkers !== 'object') return [];
  return Object.entries(data.eventWorkers as Record<string, VakasiWorkerLike>).map(
    ([employeeId, worker]) => ({
      employeeId,
      payGiven: Number(worker?.payGiven),
    }),
  );
}

function eventWorkerMetadata(
  data: Record<string, unknown> | null,
  employeeId: string,
): VakasiWorkerLike | undefined {
  if (!data?.eventWorkers || typeof data.eventWorkers !== 'object') return undefined;
  return (data.eventWorkers as Record<string, VakasiWorkerLike>)[employeeId];
}

function directoryFromSnapshots(
  employeeId: string,
  loyalisSnapshot: FirebaseFirestore.DocumentSnapshot,
  blueSnapshot: FirebaseFirestore.DocumentSnapshot,
): DirectoryRecord | null {
  if (loyalisSnapshot.exists && blueSnapshot.exists) {
    throw new HttpError(
      409,
      `ID ${employeeId} terdapat di dua koleksi pegawai. Perbaiki data induk sebelum melanjutkan.`,
    );
  }
  if (blueSnapshot.exists) {
    const data = blueSnapshot.data() || {};
    const jobCategory = String(data.employment?.jobCategory || '').normalize('NFKC').trim();
    if (jobCategory.length > 64) {
      throw new HttpError(409, `Kategori Pekarya ${employeeId} melebihi batas 64 karakter.`);
    }
    return {
      employeeId,
      employeeCollection: 'Employees_BlueCollar',
      employeeName: normalizedText(data.name, 180),
      active: data.employment?.status === 'active',
      jobCategory,
      department: normalizedText(data.employment?.unit, 120) || undefined,
      role: normalizedText(data.employment?.position, 120) || undefined,
    };
  }
  if (loyalisSnapshot.exists) {
    const data = loyalisSnapshot.data() || {};
    return {
      employeeId,
      employeeCollection: 'Employees_Loyalis',
      employeeName: normalizedText(data.personal_info?.name, 180),
      active: data.personal_info?.status === 'AKTIF',
      department: normalizedText(data.employment_profile?.department_unit, 120) || undefined,
      role: normalizedText(data.employment_profile?.job_role, 120) || undefined,
    };
  }
  return null;
}

function resolvedWorker(
  input: VakasiWorkerInput,
  directory: DirectoryRecord | null,
  previousMetadata?: VakasiWorkerLike,
  requireActive = true,
): ResolvedVakasiWorker {
  if (!directory) {
    if (requireActive) {
      throw new HttpError(409, `Penerima ${input.employeeId} tidak ditemukan di data induk.`);
    }
    return {
      employeeId: input.employeeId,
      employeeName: normalizedText(previousMetadata?.employeeName, 180) || input.employeeId,
      payGiven: input.payGiven,
      employeeCollection: vakasiWorkerCollection(previousMetadata),
      jobCategory: normalizedText(previousMetadata?.jobCategory, 64) || undefined,
      department: normalizedText(previousMetadata?.department, 120) || undefined,
      role: normalizedText(previousMetadata?.role, 120) || undefined,
    };
  }
  if (requireActive && !directory.active) {
    throw new HttpError(409, `Penerima ${directory.employeeName || input.employeeId} sudah tidak aktif.`);
  }
  if (
    directory.employeeCollection === 'Employees_BlueCollar' &&
    !directory.jobCategory
  ) {
    throw new HttpError(409, `Kategori Pekarya ${directory.employeeName || input.employeeId} belum diisi.`);
  }
  return {
    employeeId: input.employeeId,
    employeeName: directory.employeeName || input.employeeId,
    payGiven: input.payGiven,
    employeeCollection: directory.employeeCollection,
    jobCategory: directory.jobCategory,
    department: directory.department,
    role: directory.role,
  };
}

function historicalWorker(
  input: VakasiWorkerInput,
  previousMetadata?: VakasiWorkerLike,
): ResolvedVakasiWorker {
  const employeeCollection = vakasiWorkerCollection(previousMetadata);
  return {
    employeeId: input.employeeId,
    employeeName:
      normalizedText(previousMetadata?.employeeName, 180) || input.employeeId,
    payGiven: input.payGiven,
    employeeCollection,
    jobCategory:
      employeeCollection === 'Employees_BlueCollar'
        ? normalizedText(previousMetadata?.jobCategory, 64) || undefined
        : undefined,
    department: normalizedText(previousMetadata?.department, 120) || undefined,
    role: normalizedText(previousMetadata?.role, 120) || undefined,
  };
}

function financialSignature(
  worker: ResolvedVakasiWorker | undefined,
  eventName: string,
): string {
  return worker
    ? [
        worker.employeeCollection,
        worker.jobCategory || '',
        worker.payGiven,
        worker.employeeCollection === 'Employees_Loyalis' ? eventName : '',
      ].join('|')
    : '';
}

function statusForCommand(
  actor: AuthenticatedProfile,
  command: VakasiCommand,
  before: Record<string, unknown> | null,
): VakasiStatus {
  if (command.action === 'submit') return 'pending_review';
  if (command.action === 'review') return command.reviewAction!;
  if (command.action === 'unapprove') return 'pending_review';
  if (actor.role === 'super_admin' || actor.role === 'finance_verifier') {
    return command.desiredStatus || 'approved';
  }
  return before?.status === 'revision_needed' ? 'revision_needed' : 'draft';
}

function reasonForCommand(command: VakasiCommand, status: VakasiStatus): string {
  if (command.action === 'submit') return 'Kegiatan Vakasi diajukan untuk review';
  if (command.action === 'unapprove') return 'Persetujuan kegiatan Vakasi dibatalkan';
  if (command.action === 'review') return `Review kegiatan Vakasi: ${status}`;
  return status === 'approved'
    ? 'Rincian kegiatan Vakasi disimpan dan disetujui'
    : 'Rincian kegiatan Vakasi disimpan';
}

export async function POST(request: NextRequest) {
  try {
    const actor = await requireAuthenticatedProfile(request);
    const command = parseCommand(await request.json());
    assertActionAllowed(actor, command);

    const eventId = command.eventId || `VAKASI_${command.requestId}`;
    const requestHash = createHash('sha256')
      .update(JSON.stringify(command))
      .digest('hex');

    const result = await adminDb.runTransaction(async (transaction) => {
      const eventRef = adminDb.collection('VakasiTambahan').doc(eventId);
      const idempotencyRef = adminDb
        .collection('FinancialIdempotencyKeys')
        .doc(`${actor.uid}__vakasi__${command.requestId}`);
      const [eventSnapshot, idempotencySnapshot] = await transaction.getAll(
        eventRef,
        idempotencyRef,
      );

      if (idempotencySnapshot.exists) {
        const previous = idempotencySnapshot.data()!;
        if (previous.requestHash !== requestHash || previous.entityId !== eventId) {
          throw new HttpError(409, 'requestId sudah digunakan untuk perubahan Vakasi lain.');
        }
        return {
          eventId,
          period: String(previous.period || command.snapshot?.period || ''),
          revision: Number(previous.revision || 0),
          status: String(previous.resultingStatus || 'draft') as VakasiStatus,
          affectedEmployeeIds: Array.isArray(previous.affectedEmployeeIds)
            ? previous.affectedEmployeeIds as string[]
            : [],
          idempotent: true,
        };
      }

      const before = eventSnapshot.exists
        ? (eventSnapshot.data() as Record<string, unknown>)
        : null;
      if (before && isProposalLpjSandboxSource(before)) {
        throw new HttpError(409, 'Catatan LPJ sandbox tidak dapat diubah sebagai Vakasi payroll.');
      }
      const beforeStatus = before
        ? (typeof before.status === 'string' ? before.status : 'approved')
        : null;
      if (!before && (command.action === 'review' || command.action === 'unapprove')) {
        throw new HttpError(404, 'Kegiatan Vakasi tidak ditemukan.');
      }
      if (before && command.expectedRevision === undefined) {
        throw new HttpError(409, 'Revisi kegiatan wajib dikirim. Muat ulang data sebelum menyimpan.');
      }
      if (
        before &&
        Number(before.revision || 0) !== command.expectedRevision
      ) {
        throw new HttpError(409, 'Data telah berubah di perangkat lain. Muat ulang sebelum melanjutkan.');
      }
      if (
        before &&
        actor.role === 'satker_head_loyalis' &&
        before.submittedBy &&
        before.submittedBy !== actor.uid
      ) {
        throw new HttpError(403, 'Anda hanya dapat mengubah kegiatan yang Anda buat.');
      }
      if (
        actor.role === 'satker_head_loyalis' &&
        (command.action === 'save' || command.action === 'submit') &&
        beforeStatus !== null &&
        beforeStatus !== 'draft' &&
        beforeStatus !== 'revision_needed'
      ) {
        throw new HttpError(409, 'Status kegiatan ini tidak dapat diubah oleh Kepala SatKer.');
      }

      const snapshot = command.snapshot;
      const period = snapshot?.period || normalizedText(before?.period, 7);
      if (!/^\d{4}-\d{2}$/.test(period)) {
        throw new HttpError(400, 'Periode kegiatan Vakasi tidak valid.');
      }
      if (before?.period && before.period !== period) {
        throw new HttpError(409, 'Periode kegiatan Vakasi tidak boleh diubah.');
      }
      const periodRef = adminDb.collection('PayrollPeriods').doc(period);
      const projectionQuery = adminDb
        .collection('KegiatanSpj')
        .where('sourceVakasiEventId', '==', eventId);
      const [periodSnapshot, existingProjectionSnapshot] = await Promise.all([
        transaction.get(periodRef),
        transaction.get(projectionQuery),
      ]);
      assertPeriodAcceptsInput(periodSnapshot.data());

      const nextStatus = statusForCommand(actor, command, before);
      if (
        command.action === 'submit' &&
        !snapshot?.reportFileUrl
      ) {
        throw new HttpError(400, 'Laporan yang ditandatangani wajib diunggah sebelum submit.');
      }
      if (command.action === 'review' && beforeStatus !== 'pending_review') {
        throw new HttpError(409, 'Hanya kegiatan berstatus menunggu review yang dapat diproses.');
      }
      if (command.action === 'unapprove' && beforeStatus !== 'approved') {
        throw new HttpError(409, 'Hanya kegiatan yang disetujui yang dapat dibatalkan.');
      }

      const currentInputs = snapshot?.workers || workersFromEvent(before);
      if (currentInputs.length < 1 || currentInputs.length > 200) {
        throw new HttpError(400, 'Kegiatan Vakasi harus memiliki penerima.');
      }
      currentInputs.forEach((worker) => {
        if (
          !SAFE_EMPLOYEE_ID.test(worker.employeeId) ||
          !Number.isSafeInteger(worker.payGiven) ||
          worker.payGiven <= 0 ||
          worker.payGiven > MAX_RECIPIENT_AMOUNT
        ) {
          throw new HttpError(400, `Data penerima ${worker.employeeId || '-'} tidak valid.`);
        }
      });
      if (new Set(currentInputs.map((worker) => worker.employeeId)).size !== currentInputs.length) {
        throw new HttpError(400, 'Daftar penerima Vakasi tidak boleh duplikat.');
      }

      const previousInputs = workersFromEvent(before);
      const allEmployeeIds = [...new Set([
        ...previousInputs.map((worker) => worker.employeeId),
        ...currentInputs.map((worker) => worker.employeeId),
      ])];
      const loyalisRefs = allEmployeeIds.map((employeeId) =>
        adminDb.collection('Employees_Loyalis').doc(employeeId),
      );
      const blueRefs = allEmployeeIds.map((employeeId) =>
        adminDb.collection('Employees_BlueCollar').doc(employeeId),
      );
      const directorySnapshots = allEmployeeIds.length > 0
        ? await transaction.getAll(...loyalisRefs, ...blueRefs)
        : [];
      const directories = new Map<string, DirectoryRecord | null>();
      allEmployeeIds.forEach((employeeId, index) => {
        directories.set(
          employeeId,
          directoryFromSnapshots(
            employeeId,
            directorySnapshots[index],
            directorySnapshots[index + allEmployeeIds.length],
          ),
        );
      });

      const currentWorkers = currentInputs.map((worker) =>
        resolvedWorker(
          worker,
          directories.get(worker.employeeId) || null,
          eventWorkerMetadata(before, worker.employeeId),
          command.action === 'save' ||
            command.action === 'submit' ||
            nextStatus === 'approved',
        ),
      );
      // The source document owns the historical classification. Re-resolving
      // old rows against today's master data would make a category transfer
      // look unchanged and could leave the old projection/rekap amount stale.
      const previousWorkers = previousInputs.map((worker) =>
        historicalWorker(worker, eventWorkerMetadata(before, worker.employeeId)),
      );

      const wasPayable = Boolean(before && isPayableVakasiTambahan(before));
      const willBePayable = nextStatus === 'approved';
      const previousEventName = normalizedText(before?.eventName, 180);
      const currentEventName = snapshot?.eventName || previousEventName;
      const previousById = new Map(previousWorkers.map((worker) => [worker.employeeId, worker]));
      const currentById = new Map(currentWorkers.map((worker) => [worker.employeeId, worker]));
      const affectedEmployeeIds = allEmployeeIds.filter((employeeId) => {
        const previous = wasPayable ? previousById.get(employeeId) : undefined;
        const current = willBePayable ? currentById.get(employeeId) : undefined;
        return (
          financialSignature(previous, previousEventName) !==
          financialSignature(current, currentEventName)
        );
      });

      if (affectedEmployeeIds.length > 0) {
        const slipRefs = affectedEmployeeIds.map((employeeId) =>
          adminDb
            .collection('PayrollSlipStates')
            .doc(`${period.replace('-', '_')}_${employeeId}`),
        );
        const slipSnapshots = await transaction.getAll(...slipRefs);
        const immutableNames = slipSnapshots.flatMap((slipSnapshot, index) => {
          if (!slipSnapshot.exists || !isImmutablePayrollStatus(slipSnapshot.data()?.status)) {
            return [];
          }
          const employeeId = affectedEmployeeIds[index];
          const directory = directories.get(employeeId);
          return [directory?.employeeName || employeeId];
        });
        if (immutableNames.length > 0) {
          throw new HttpError(
            409,
            `Perubahan ditolak karena slip penerima berikut sudah dikunci/dibayar: ${immutableNames.join(', ')}.`,
          );
        }
      }

      const now = admin.firestore.FieldValue.serverTimestamp();
      const eventName = snapshot?.eventName || normalizedText(before?.eventName, 180);
      if (eventName.length < 2) {
        throw new HttpError(400, 'Nama kegiatan Vakasi tidak valid.');
      }
      const workersMap = Object.fromEntries(
        currentWorkers.map((worker) => [
          worker.employeeId,
          {
            employeeName: worker.employeeName,
            payGiven: worker.payGiven,
            employeeCollection: worker.employeeCollection,
            ...(worker.jobCategory ? { jobCategory: worker.jobCategory } : {}),
            ...(worker.department ? { department: worker.department } : {}),
            ...(worker.role ? { role: worker.role } : {}),
          },
        ]),
      );
      const ownedEarningLabelsByEmployee = Object.fromEntries(
        Object.entries(
          before?.ownedEarningLabelsByEmployee &&
          typeof before.ownedEarningLabelsByEmployee === 'object'
            ? before.ownedEarningLabelsByEmployee as Record<string, unknown>
            : {},
        ).flatMap(([employeeId, labels]) => {
          const validLabels = Array.isArray(labels)
            ? labels.filter((label): label is string => typeof label === 'string' && Boolean(label.trim()))
            : [];
          return validLabels.length > 0 ? [[employeeId, validLabels.slice(-20)]] : [];
        }),
      ) as Record<string, string[]>;
      const rememberOwnedLabel = (worker: ResolvedVakasiWorker, label: string) => {
        if (worker.employeeCollection !== 'Employees_Loyalis' || !label.trim()) return;
        const labels = ownedEarningLabelsByEmployee[worker.employeeId] || [];
        if (!labels.some((existing) => existing.trim().toLocaleLowerCase('id-ID') === label.trim().toLocaleLowerCase('id-ID'))) {
          labels.push(label.trim());
        }
        ownedEarningLabelsByEmployee[worker.employeeId] = labels.slice(-20);
      };
      previousWorkers.forEach((worker) => rememberOwnedLabel(worker, previousEventName));
      currentWorkers.forEach((worker) => rememberOwnedLabel(worker, eventName));
      const after: Record<string, unknown> = {
        ...before,
        eventName,
        period,
        totalPayout: currentWorkers.reduce((sum, worker) => sum + worker.payGiven, 0),
        isEndOfMonth: snapshot?.isEndOfMonth ?? before?.isEndOfMonth === true,
        departmentUnit: snapshot
          ? (snapshot.isEndOfMonth ? null : snapshot.departmentUnit)
          : before?.departmentUnit || null,
        eventWorkers: workersMap,
        ownedEarningLabelsByEmployee,
        status: nextStatus,
        revision: Number(before?.revision || 0) + 1,
        createdAt: before?.createdAt || now,
        createdBy: before?.createdBy || actor.uid,
        submittedBy: before?.submittedBy || actor.uid,
        submittedByName: before?.submittedByName || actor.displayName || null,
        submittedByEmail: before?.submittedByEmail || actor.email || null,
        updatedAt: now,
        updatedBy: actor.uid,
        schemaVersion: 3,
      };
      if (snapshot) {
        after.reportFileUrl = snapshot.reportFileUrl;
        after.reportFileName = snapshot.reportFileName;
      }
      if (command.action === 'submit') {
        after.submittedAt = now;
        after.reviewNote = null;
        after.reviewedBy = null;
        after.reviewedAt = null;
      }
      if (command.action === 'review') {
        after.reviewedBy = actor.uid;
        after.reviewedAt = now;
        after.reviewNote = command.reviewNote || null;
      }
      if (nextStatus === 'approved' && command.action === 'save') {
        after.reviewedBy = actor.uid;
        after.reviewedAt = now;
        after.reviewNote = null;
      }
      if (command.action === 'unapprove') {
        after.unapprovedAt = now;
        after.unapprovedBy = actor.uid;
      }

      const desiredProjections = nextStatus === 'approved'
        ? buildVakasiPekaryaProjectionInputs({
            sourceVakasiEventId: eventId,
            eventName,
            period,
            workers: currentWorkers,
          })
        : [];
      const desiredProjectionIds = new Set(desiredProjections.map((projection) => projection.id));
      const existingProjections = new Map(
        existingProjectionSnapshot.docs.map((snapshot) => [snapshot.id, snapshot]),
      );

      for (const projection of desiredProjections) {
        const projectionRef = adminDb.collection('KegiatanSpj').doc(projection.id);
        const existing = existingProjections.get(projection.id);
        const existingData = existing?.data() || null;
        transaction.set(projectionRef, {
          ...projection,
          status: 'approved',
          revision: Number(existingData?.revision || 0) + 1,
          sourceVakasiRevision: after.revision,
          approvedAt:
            existingData?.status === 'approved' && existingData.approvedAt
              ? existingData.approvedAt
              : now,
          approvedBy:
            existingData?.status === 'approved' && existingData.approvedBy
              ? existingData.approvedBy
              : actor.uid,
          createdAt: existingData?.createdAt || now,
          createdBy: existingData?.createdBy || actor.uid,
          updatedAt: now,
          updatedBy: actor.uid,
          schemaVersion: 3,
        });
      }

      for (const projectionSnapshot of existingProjectionSnapshot.docs) {
        if (desiredProjectionIds.has(projectionSnapshot.id)) continue;
        const projectionData = projectionSnapshot.data();
        transaction.set(
          projectionSnapshot.ref,
          {
            status: 'voided',
            sourceKind: VAKASI_PEKARYA_PROJECTION_SOURCE_KIND,
            sourceVakasiEventId: eventId,
            sourceVakasiRevision: after.revision,
            revision: Number(projectionData.revision || 0) + 1,
            voidedAt: now,
            voidedBy: actor.uid,
            updatedAt: now,
            updatedBy: actor.uid,
          },
          { merge: true },
        );
      }

      transaction.set(eventRef, after);
      transaction.create(
        newFinancialAuditRef(),
        buildFinancialAuditRecord(actor, {
          action: `VAKASI_EVENT_${command.action.toUpperCase()}`,
          entityType: 'VakasiTambahan',
          entityId: eventId,
          reason: reasonForCommand(command, nextStatus),
          requestId: command.requestId,
          before,
          after,
          metadata: {
            resultingStatus: nextStatus,
            affectedEmployeeIds,
            pekaryaProjectionIds: desiredProjections.map((projection) => projection.id),
          },
        }),
      );
      transaction.create(idempotencyRef, {
        requestHash,
        entityId: eventId,
        revision: after.revision,
        resultingStatus: nextStatus,
        period,
        affectedEmployeeIds,
        createdAt: now,
      });

      return {
        eventId,
        period,
        revision: Number(after.revision),
        status: nextStatus,
        affectedEmployeeIds,
        idempotent: false,
      };
    });

    let propagation: { summary: Record<string, number> } = { summary: {} };
    if (result.affectedEmployeeIds.length > 0) {
      const propagationRequest = new NextRequest(
        new URL('/api/payroll/vakasi-propagation', request.url),
        {
          method: 'POST',
          headers: request.headers,
          body: JSON.stringify({
            period: result.period,
            employeeIds: result.affectedEmployeeIds,
            requestId: `vakasi_auto_${createHash('sha256')
              .update(command.requestId)
              .digest('hex')
              .slice(0, 32)}`,
          }),
        },
      );
      const propagationResponse = await propagateVakasiRoute(propagationRequest);
      const propagationPayload = await propagationResponse.json() as {
        error?: string;
        summary?: Record<string, number>;
      };
      if (!propagationResponse.ok) {
        throw new HttpError(
          propagationResponse.status,
          propagationPayload.error || 'Vakasi tersimpan, tetapi propagasi SPJ gagal.',
        );
      }
      propagation = { summary: propagationPayload.summary || {} };
    }

    return Response.json({
      ...result,
      propagationSummary: propagation.summary,
    }, {
      status: command.eventId ? 200 : 201,
      headers: { 'Cache-Control': 'no-store' },
    });
  } catch (error) {
    return errorResponse(error);
  }
}
