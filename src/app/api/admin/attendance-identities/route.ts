import { createHash } from 'node:crypto';
import { NextRequest } from 'next/server';
import admin, { adminDb } from '@/lib/firebase-admin';
import { normalizeNipy } from '@/lib/payroll/attendance';
import {
  ATTENDANCE_IDENTITIES_COLLECTION,
  attendanceIdentityDocumentId,
  employeeNipy,
  loadAttendanceEmployeeIdentities,
} from '@/lib/server/attendanceStore';
import { buildFinancialAuditRecord, newFinancialAuditRef } from '@/lib/server/audit';
import {
  errorResponse,
  HttpError,
  requireAuthenticatedProfile,
  requireRole,
} from '@/lib/server/auth';

export const dynamic = 'force-dynamic';

const EMPLOYEE_COLLECTIONS = [
  'Employees_BlueCollar',
  'Employees_Loyalis',
  'Employees_WhiteCollar',
] as const;

type EmployeeCollection = (typeof EMPLOYEE_COLLECTIONS)[number];

function parseCommand(value: unknown) {
  if (!value || typeof value !== 'object') {
    throw new HttpError(400, 'Payload identitas presensi tidak valid.');
  }
  const input = value as Record<string, unknown>;
  const employeeId =
    typeof input.employeeId === 'string' ? input.employeeId.trim() : '';
  const employeeCollection = input.employeeCollection as EmployeeCollection;
  const nipy = normalizeNipy(input.nipy);
  const requestId =
    typeof input.requestId === 'string' ? input.requestId.trim() : '';
  if (
    !/^[A-Za-z0-9_-]{1,128}$/.test(employeeId) ||
    !EMPLOYEE_COLLECTIONS.includes(employeeCollection) ||
    (nipy && (nipy.length > 64 || /[\u0000-\u001F]/.test(nipy))) ||
    !/^[A-Za-z0-9_-]{8,128}$/.test(requestId)
  ) {
    throw new HttpError(400, 'Employee, koleksi, NIPY, atau requestId tidak valid.');
  }
  return { employeeId, employeeCollection, nipy, requestId };
}

export async function PATCH(request: NextRequest) {
  try {
    const actor = await requireAuthenticatedProfile(request);
    requireRole(actor, ['super_admin', 'employee_admin']);
    const command = parseCommand(await request.json());
    if (command.employeeCollection === 'Employees_BlueCollar') {
      throw new HttpError(
        409,
        'NIPY Pekarya wajib diterbitkan melalui generator formula.',
      );
    }

    const { byNipy } = await loadAttendanceEmployeeIdentities();
    const duplicate = command.nipy
      ? (byNipy.get(command.nipy) || []).find(
          (identity) =>
            identity.employeeId !== command.employeeId ||
            identity.employeeCollection !== command.employeeCollection,
        )
      : null;
    if (duplicate) {
      throw new HttpError(
        409,
        `NIPY ${command.nipy} sudah digunakan oleh ${duplicate.name || duplicate.employeeId}.`,
      );
    }

    const requestHash = createHash('sha256')
      .update(JSON.stringify(command))
      .digest('hex');
    const result = await adminDb.runTransaction(async (transaction) => {
      const employeeRef = adminDb
        .collection(command.employeeCollection)
        .doc(command.employeeId);
      const idempotencyRef = adminDb
        .collection('FinancialIdempotencyKeys')
        .doc(`${actor.uid}__${command.requestId}`);
      const [employeeSnapshot, idempotencySnapshot] = await Promise.all([
        transaction.get(employeeRef),
        transaction.get(idempotencyRef),
      ]);
      if (idempotencySnapshot.exists) {
        const previous = idempotencySnapshot.data()!;
        if (
          previous.requestHash !== requestHash ||
          previous.entityId !== command.employeeId
        ) {
          throw new HttpError(409, 'requestId sudah digunakan untuk perubahan berbeda.');
        }
        return { nipy: String(previous.nipy || ''), idempotent: true };
      }
      if (!employeeSnapshot.exists) {
        throw new HttpError(404, 'Data pegawai tidak ditemukan.');
      }
      const before = employeeSnapshot.data()!;
      const oldNipy = employeeNipy(before);
      const oldIndexRef = oldNipy
        ? adminDb
            .collection(ATTENDANCE_IDENTITIES_COLLECTION)
            .doc(attendanceIdentityDocumentId(oldNipy))
        : null;
      const newIndexRef = command.nipy
        ? adminDb
            .collection(ATTENDANCE_IDENTITIES_COLLECTION)
            .doc(attendanceIdentityDocumentId(command.nipy))
        : null;
      const indexSnapshot =
        newIndexRef && command.nipy !== oldNipy
          ? await transaction.get(newIndexRef)
          : null;
      if (
        indexSnapshot?.exists &&
        (indexSnapshot.data()?.employeeId !== command.employeeId ||
          indexSnapshot.data()?.employeeCollection !== command.employeeCollection)
      ) {
        throw new HttpError(409, `NIPY ${command.nipy} sudah digunakan pegawai lain.`);
      }

      if (oldIndexRef && oldNipy !== command.nipy) {
        transaction.delete(oldIndexRef);
      }
      if (newIndexRef) {
        transaction.set(newIndexRef, {
          nipy: command.nipy,
          employeeId: command.employeeId,
          employeeCollection: command.employeeCollection,
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
          updatedBy: actor.uid,
          schemaVersion: 1,
        });
      }
      const identityFields: Record<string, unknown> = {
        nipy: command.nipy || null,
        'audit.updatedAt': admin.firestore.FieldValue.serverTimestamp(),
        'audit.updatedBy': actor.uid,
      };
      if (command.employeeCollection === 'Employees_Loyalis') {
        identityFields['personal_info.employee_id_niy'] =
          command.nipy || null;
      }
      transaction.update(employeeRef, identityFields);
      transaction.create(
        newFinancialAuditRef(),
        buildFinancialAuditRecord(actor, {
          action: 'ATTENDANCE_IDENTITY_UPDATED',
          entityType: command.employeeCollection,
          entityId: command.employeeId,
          requestId: command.requestId,
          reason: command.nipy ? 'Memperbarui identitas NIPY presensi' : 'Menghapus identitas NIPY presensi',
          before: { nipy: oldNipy || null },
          after: { nipy: command.nipy || null },
        }),
      );
      transaction.create(idempotencyRef, {
        requestHash,
        entityType: 'AttendanceIdentity',
        entityId: command.employeeId,
        nipy: command.nipy,
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
      });
      return { nipy: command.nipy, idempotent: false };
    });
    return Response.json(result);
  } catch (error) {
    return errorResponse(error);
  }
}
