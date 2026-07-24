import { createHash } from 'node:crypto';
import { NextRequest } from 'next/server';
import admin, { adminDb } from '@/lib/firebase-admin';
import { assertRequestId, isImmutablePayrollStatus } from '@/lib/payroll/domain';
import { isPekaryaJobCategory } from '@/lib/payroll/pekaryaSpj';
import { buildFinancialAuditRecord, newFinancialAuditRef } from '@/lib/server/audit';
import {
  errorResponse,
  HttpError,
  requireAuthenticatedProfile,
  requireRole,
} from '@/lib/server/auth';

export const dynamic = 'force-dynamic';

interface SaveEventCommand {
  requestId: string;
  eventId?: string;
  period: string;
  jobCategory: string;
  eventName: string;
  eventFee: number;
  employeeIds: string[];
  reason: string;
  expectedRevision?: number;
}

function assertCategoryAccess(
  actor: Awaited<ReturnType<typeof requireAuthenticatedProfile>>,
  category: string,
) {
  if (!isPekaryaJobCategory(category)) {
    throw new HttpError(400, 'Kategori SPJ Pekarya tidak valid.');
  }
  if (actor.role === 'satker_head' && !actor.permittedCategories.includes(category)) {
    throw new HttpError(403, `Anda tidak memiliki akses kategori ${category}.`);
  }
}

function parseCommand(raw: unknown): SaveEventCommand {
  if (!raw || typeof raw !== 'object') throw new HttpError(400, 'Kegiatan SPJ tidak valid.');
  const value = raw as Partial<SaveEventCommand>;
  if (typeof value.requestId !== 'string') throw new HttpError(400, 'requestId wajib diisi.');
  try {
    assertRequestId(value.requestId);
  } catch (error) {
    throw new HttpError(400, error instanceof Error ? error.message : 'requestId tidak valid.');
  }
  if (
    typeof value.period !== 'string' ||
    !/^\d{4}-\d{2}$/.test(value.period) ||
    typeof value.jobCategory !== 'string'
  ) {
    throw new HttpError(400, 'Periode atau kategori tidak valid.');
  }
  const eventName = typeof value.eventName === 'string' ? value.eventName.normalize('NFKC').trim() : '';
  if (eventName.length < 2 || eventName.length > 180) {
    throw new HttpError(400, 'Nama kegiatan wajib diisi antara 2 dan 180 karakter.');
  }
  if (
    typeof value.eventFee !== 'number' ||
    !Number.isSafeInteger(value.eventFee) ||
    value.eventFee <= 0 ||
    value.eventFee > 100_000_000
  ) {
    throw new HttpError(400, 'Nominal SPJ per orang tidak valid.');
  }
  if (
    !Array.isArray(value.employeeIds) ||
    value.employeeIds.length < 1 ||
    value.employeeIds.length > 200 ||
    value.employeeIds.some(
      (id) => typeof id !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(id),
    ) ||
    new Set(value.employeeIds).size !== value.employeeIds.length
  ) {
    throw new HttpError(400, 'Daftar penerima SPJ tidak valid atau mengandung duplikasi.');
  }
  const reason = typeof value.reason === 'string' ? value.reason.trim() : '';
  if (reason.length < 8 || reason.length > 500) {
    throw new HttpError(400, 'Alasan penyimpanan wajib diisi antara 8 dan 500 karakter.');
  }
  if (value.eventId && !/^[A-Za-z0-9_-]{1,180}$/.test(value.eventId)) {
    throw new HttpError(400, 'ID kegiatan SPJ tidak valid.');
  }
  return {
    requestId: value.requestId,
    eventId: value.eventId,
    period: value.period,
    jobCategory: value.jobCategory,
    eventName,
    eventFee: value.eventFee,
    employeeIds: value.employeeIds,
    reason,
    expectedRevision: value.expectedRevision,
  };
}

export async function GET(request: NextRequest) {
  try {
    const actor = await requireAuthenticatedProfile(request);
    requireRole(actor, ['super_admin', 'satker_head', 'finance_verifier', 'payroll_authorizer']);
    const period = request.nextUrl.searchParams.get('period') || '';
    const category = request.nextUrl.searchParams.get('category') || '';
    if (!/^\d{4}-\d{2}$/.test(period)) throw new HttpError(400, 'Periode tidak valid.');
    assertCategoryAccess(actor, category);

    const [employeeSnapshot, eventSnapshot] = await Promise.all([
      adminDb
        .collection('Employees_BlueCollar')
        .where('employment.status', '==', 'active')
        .where('employment.jobCategory', '==', category)
        .get(),
      adminDb.collection('KegiatanSpj').where('period', '==', period).get(),
    ]);
    const employees = employeeSnapshot.docs
      .map((snapshot) => ({ id: snapshot.id, name: String(snapshot.data().name || '') }))
      .sort((a, b) => a.name.localeCompare(b.name, 'id'));
    const allowedIds = new Set(employees.map((employee) => employee.id));
    const events = eventSnapshot.docs.flatMap((snapshot) => {
      const data = snapshot.data();
      if (data.jobCategory && data.jobCategory !== category) return [];
      if (data.status && data.status !== 'approved') return [];
      const eventWorkers = Object.fromEntries(
        Object.entries(data.eventWorkers || {}).filter(([employeeId]) =>
          allowedIds.has(employeeId),
        ),
      );
      if (Object.keys(eventWorkers).length === 0) return [];
      return [{
        id: snapshot.id,
        eventName: String(data.eventName || ''),
        period,
        jobCategory: category,
        eventFee: Number(data.eventFee || 0),
        eventWorkers,
        totalPayout: (
          Object.values(eventWorkers) as Array<{ payGiven?: unknown }>
        ).reduce((sum, worker) => sum + Number(worker.payGiven || 0), 0),
        revision: Number(data.revision || 0),
        legacyCategoryInferred: !data.jobCategory,
      }];
    });

    return Response.json({ employees, events });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function POST(request: NextRequest) {
  try {
    const actor = await requireAuthenticatedProfile(request);
    requireRole(actor, ['super_admin', 'satker_head']);
    const command = parseCommand(await request.json());
    assertCategoryAccess(actor, command.jobCategory);
    const requestHash = createHash('sha256').update(JSON.stringify(command)).digest('hex');
    const safeCategory = command.jobCategory.replace(/[^A-Za-z0-9_-]/g, '_');
    const eventId =
      command.eventId || `SPJEV-${command.period.replace('-', '')}-${safeCategory}-${command.requestId}`;

    const result = await adminDb.runTransaction(async (transaction) => {
      const eventRef = adminDb.collection('KegiatanSpj').doc(eventId);
      const periodRef = adminDb.collection('PayrollPeriods').doc(command.period);
      const idempotencyRef = adminDb
        .collection('FinancialIdempotencyKeys')
        .doc(`${actor.uid}__${command.requestId}`);
      const employeeRefs = command.employeeIds.map((employeeId) =>
        adminDb.collection('Employees_BlueCollar').doc(employeeId),
      );
      const slipRefs = command.employeeIds.map((employeeId) =>
        adminDb
          .collection('PayrollSlipStates')
          .doc(`${command.period.replace('-', '_')}_${employeeId}`),
      );
      const [eventSnapshot, periodSnapshot, idempotencySnapshot, ...rest] =
        await Promise.all([
          transaction.get(eventRef),
          transaction.get(periodRef),
          transaction.get(idempotencyRef),
          ...employeeRefs.map((ref) => transaction.get(ref)),
          ...slipRefs.map((ref) => transaction.get(ref)),
        ]);
      const employeeSnapshots = rest.slice(0, command.employeeIds.length);
      const slipSnapshots = rest.slice(command.employeeIds.length);

      if (idempotencySnapshot.exists) {
        const previous = idempotencySnapshot.data()!;
        if (previous.requestHash !== requestHash || previous.entityId !== eventId) {
          throw new HttpError(409, 'requestId sudah digunakan untuk kegiatan berbeda.');
        }
        return { eventId, revision: previous.revision, idempotent: true };
      }
      if (!periodSnapshot.exists || periodSnapshot.data()?.attendanceStatus !== 'open') {
        throw new HttpError(409, 'Periode payroll belum dibuka atau sudah ditutup.');
      }
      employeeSnapshots.forEach((snapshot, index) => {
        const employee = snapshot.data();
        if (
          !snapshot.exists ||
          employee?.employment?.status !== 'active' ||
          employee?.employment?.jobCategory !== command.jobCategory
        ) {
          throw new HttpError(
            409,
            `Penerima ${command.employeeIds[index]} tidak aktif atau berbeda kategori.`,
          );
        }
        if (slipSnapshots[index]?.exists && isImmutablePayrollStatus(slipSnapshots[index]?.data()?.status)) {
          throw new HttpError(409, 'Salah satu slip penerima sudah dikunci.');
        }
      });

      const before = eventSnapshot.exists ? eventSnapshot.data()! : null;
      if (command.eventId && !eventSnapshot.exists) {
        throw new HttpError(404, 'Kegiatan SPJ yang akan diubah tidak ditemukan.');
      }
      if (
        before &&
        (before.period !== command.period ||
          (before.jobCategory && before.jobCategory !== command.jobCategory))
      ) {
        throw new HttpError(409, 'Periode atau kategori kegiatan tidak boleh diubah.');
      }
      if (
        before &&
        command.expectedRevision !== undefined &&
        Number(before.revision || 0) !== command.expectedRevision
      ) {
        throw new HttpError(409, 'Data telah berubah di perangkat lain. Muat ulang sebelum menyimpan.');
      }

      const eventWorkers = Object.fromEntries(
        employeeSnapshots.map((snapshot) => [
          snapshot.id,
          {
            employeeName: String(snapshot.data()?.name || ''),
            payGiven: command.eventFee,
          },
        ]),
      );
      const now = admin.firestore.FieldValue.serverTimestamp();
      const after = {
        eventName: command.eventName,
        period: command.period,
        jobCategory: command.jobCategory,
        eventFee: command.eventFee,
        eventWorkers,
        totalPayout: command.eventFee * employeeSnapshots.length,
        status: 'approved',
        revision: Number(before?.revision || 0) + 1,
        createdAt: before?.createdAt || now,
        createdBy: before?.createdBy || actor.uid,
        updatedAt: now,
        updatedBy: actor.uid,
        schemaVersion: 2,
      };
      transaction.set(eventRef, after);
      transaction.create(
        newFinancialAuditRef(),
        buildFinancialAuditRecord(actor, {
          action: before ? 'PEKARYA_SPJ_EVENT_UPDATED' : 'PEKARYA_SPJ_EVENT_CREATED',
          entityType: 'KegiatanSpj',
          entityId: eventId,
          reason: command.reason,
          requestId: command.requestId,
          before,
          after,
          metadata: {
            period: command.period,
            jobCategory: command.jobCategory,
            recipientCount: command.employeeIds.length,
          },
        }),
      );
      transaction.create(idempotencyRef, {
        requestHash,
        entityId: eventId,
        revision: after.revision,
        resultingStatus: 'approved',
        createdAt: now,
      });
      return { eventId, revision: after.revision, idempotent: false };
    });

    return Response.json(result, { status: 201 });
  } catch (error) {
    return errorResponse(error);
  }
}
