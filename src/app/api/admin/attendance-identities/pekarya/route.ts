import { createHash } from 'node:crypto';
import { NextRequest } from 'next/server';
import admin, { adminDb } from '@/lib/firebase-admin';
import {
  buildPekaryaNipyPreview,
  generatePekaryaNipy,
  normalizePekaryaStartDate,
  PEKARYA_NIPY_FORMULA_VERSION,
  PEKARYA_NIPY_PREFIXES,
  PekaryaNipyAssignment,
  PekaryaNipyEmployeeInput,
  PekaryaNipyGroup,
  pekaryaNipyGroup,
} from '@/lib/payroll/nipy';
import { assertRequestId } from '@/lib/payroll/domain';
import {
  ATTENDANCE_IDENTITIES_COLLECTION,
  attendanceIdentityDocumentId,
  loadAttendanceEmployeeIdentities,
  PEKARYA_NIPY_SEQUENCES_COLLECTION,
} from '@/lib/server/attendanceStore';
import {
  buildFinancialAuditRecord,
  newFinancialAuditRef,
} from '@/lib/server/audit';
import {
  AuthenticatedProfile,
  errorResponse,
  HttpError,
  requireAuthenticatedProfile,
  requireRole,
} from '@/lib/server/auth';

export const dynamic = 'force-dynamic';

const GROUPS = Object.keys(PEKARYA_NIPY_PREFIXES) as PekaryaNipyGroup[];

type FirestoreEmployeeData = Record<string, unknown> & {
  employment?: { jobCategory?: unknown; startDate?: unknown; status?: unknown };
  flags?: { isActive?: unknown; isPayrollEligible?: unknown };
};

function normalizedStoredNipy(value: unknown) {
  return String(value || '').trim().toUpperCase();
}

function activePekarya(data: FirestoreEmployeeData) {
  return (
    data.employment?.status === 'active' &&
    data.flags?.isActive !== false &&
    data.flags?.isPayrollEligible !== false
  );
}

function employeeInput(
  id: string,
  data: FirestoreEmployeeData,
): PekaryaNipyEmployeeInput {
  const assignment =
    data.nipyAssignment && typeof data.nipyAssignment === 'object'
      ? (data.nipyAssignment as Partial<PekaryaNipyAssignment>)
      : null;
  return {
    employeeId: id,
    name: String(data.name || ''),
    category: String(data.employment?.jobCategory || '').trim().toUpperCase(),
    startDate: normalizePekaryaStartDate(data.employment?.startDate),
    active: activePekarya(data),
    nipy: normalizedStoredNipy(data.nipy),
    assignment,
  };
}

function sequenceData(
  snapshots: FirebaseFirestore.QuerySnapshot<FirebaseFirestore.DocumentData>,
) {
  const counters: Partial<Record<PekaryaNipyGroup, number>> = {};
  const initializedGroups = new Set<PekaryaNipyGroup>();
  for (const snapshot of snapshots.docs) {
    const group = snapshot.data().categoryGroup as PekaryaNipyGroup;
    if (!GROUPS.includes(group)) continue;
    counters[group] = Number(snapshot.data().lastSequence || 0);
    if (snapshot.data().initialized === true) initializedGroups.add(group);
  }
  if (initializedGroups.size > 0 && initializedGroups.size < GROUPS.length) {
    throw new HttpError(
      409,
      'Konfigurasi nomor urut NIPY belum lengkap. Hubungi Superadmin.',
    );
  }
  return {
    initialized: initializedGroups.size === GROUPS.length,
    counters,
  };
}

function identityOwners(
  identities: Awaited<
    ReturnType<typeof loadAttendanceEmployeeIdentities>
  >['identities'],
) {
  const owners = new Map<
    string,
    { employeeId: string; employeeCollection: string }
  >();
  for (const identity of identities) {
    if (!identity.nipy) continue;
    const previous = owners.get(identity.nipy);
    if (
      !previous ||
      (previous.employeeId === identity.employeeId &&
        previous.employeeCollection === identity.employeeCollection)
    ) {
      owners.set(identity.nipy, {
        employeeId: identity.employeeId,
        employeeCollection: identity.employeeCollection,
      });
    }
  }
  return owners;
}

async function currentPreview() {
  const [employeeSnapshots, sequenceSnapshots, identityData] =
    await Promise.all([
      adminDb.collection('Employees_BlueCollar').get(),
      adminDb.collection(PEKARYA_NIPY_SEQUENCES_COLLECTION).get(),
      loadAttendanceEmployeeIdentities(),
    ]);
  const sequence = sequenceData(sequenceSnapshots);
  return buildPekaryaNipyPreview(
    employeeSnapshots.docs.map((snapshot) =>
      employeeInput(snapshot.id, snapshot.data()),
    ),
    {
      ...sequence,
      identityOwners: identityOwners(identityData.identities),
    },
  );
}

function requestIdFrom(input: Record<string, unknown>) {
  const requestId = String(input.requestId || '');
  try {
    assertRequestId(requestId);
  } catch (error) {
    throw new HttpError(
      400,
      error instanceof Error ? error.message : 'requestId tidak valid.',
    );
  }
  return requestId;
}

function requestHash(input: Record<string, unknown>) {
  return createHash('sha256').update(JSON.stringify(input)).digest('hex');
}

function assignmentRecord(
  item: {
    categoryGroup: PekaryaNipyGroup | null;
    prefixCode: string | null;
    startDate: string | null;
    sequence: number | null;
  },
  status: 'issued' | 'reserved',
  actor: AuthenticatedProfile,
) {
  if (!item.categoryGroup || !item.prefixCode || !item.sequence) {
    throw new HttpError(409, 'Metadata formula NIPY tidak lengkap.');
  }
  const now = admin.firestore.FieldValue.serverTimestamp();
  return {
    formulaVersion: PEKARYA_NIPY_FORMULA_VERSION,
    categoryGroup: item.categoryGroup,
    prefixCode: item.prefixCode,
    sourceStartDate: item.startDate,
    sequence: item.sequence,
    status,
    source: 'formula',
    assignedAt: now,
    assignedBy: actor.uid,
    assignedByRole: actor.role,
    updatedAt: now,
  };
}

export async function GET(request: NextRequest) {
  try {
    const actor = await requireAuthenticatedProfile(request);
    requireRole(actor, ['super_admin', 'employee_admin']);
    return Response.json(await currentPreview());
  } catch (error) {
    return errorResponse(error);
  }
}

export async function POST(request: NextRequest) {
  try {
    const actor = await requireAuthenticatedProfile(request);
    requireRole(actor, ['super_admin', 'employee_admin']);
    const body = (await request.json()) as Record<string, unknown>;
    const operation = String(body.operation || '');
    const requestId = requestIdFrom(body);
    if (operation === 'bulk_apply') {
      const expectedPreviewHash = String(body.expectedPreviewHash || '');
      if (!/^[a-f0-9]{64}$/.test(expectedPreviewHash)) {
        throw new HttpError(400, 'Hash pratinjau NIPY tidak valid.');
      }
      const externalIdentityData = await loadAttendanceEmployeeIdentities();
      const ownerMap = identityOwners(externalIdentityData.identities);
      const hash = requestHash({
        operation,
        expectedPreviewHash,
      });
      const result = await adminDb.runTransaction(async (transaction) => {
        const idempotencyRef = adminDb
          .collection('FinancialIdempotencyKeys')
          .doc(`${actor.uid}__${requestId}`);
        const idempotencySnapshot = await transaction.get(idempotencyRef);
        if (idempotencySnapshot.exists) {
          if (idempotencySnapshot.data()?.requestHash !== hash) {
            throw new HttpError(
              409,
              'requestId sudah digunakan untuk operasi berbeda.',
            );
          }
          return {
            ...(idempotencySnapshot.data()?.response || {}),
            idempotent: true,
          };
        }

        const [employeeSnapshots, sequenceSnapshots] = await Promise.all([
          transaction.get(adminDb.collection('Employees_BlueCollar')),
          transaction.get(
            adminDb.collection(PEKARYA_NIPY_SEQUENCES_COLLECTION),
          ),
        ]);
        const sequence = sequenceData(sequenceSnapshots);
        const preview = buildPekaryaNipyPreview(
          employeeSnapshots.docs.map((snapshot) =>
            employeeInput(snapshot.id, snapshot.data()),
          ),
          { ...sequence, identityOwners: ownerMap },
        );
        if (preview.previewHash !== expectedPreviewHash) {
          throw new HttpError(
            409,
            'Data pegawai atau urutan NIPY berubah. Muat ulang pratinjau.',
          );
        }
        if (preview.summary.conflicts > 0 || preview.summary.blocked > 0) {
          throw new HttpError(
            409,
            'Konflik atau data tidak valid harus diselesaikan sebelum penerbitan massal.',
          );
        }

        const writableItems = preview.items.filter(
          (item) => item.needsWrite,
        );
        const readyItems = writableItems.filter(
          (item) => item.state === 'ready' && item.proposedNipy,
        );
        const indexSnapshots = await Promise.all(
          readyItems.map((item) =>
            transaction.get(
              adminDb
                .collection(ATTENDANCE_IDENTITIES_COLLECTION)
                .doc(attendanceIdentityDocumentId(item.proposedNipy!)),
            ),
          ),
        );
        indexSnapshots.forEach((snapshot, index) => {
          const item = readyItems[index];
          if (
            snapshot.exists &&
            (snapshot.data()?.employeeId !== item.employeeId ||
              snapshot.data()?.employeeCollection !== 'Employees_BlueCollar')
          ) {
            throw new HttpError(
              409,
              `NIPY ${item.proposedNipy} sudah dimiliki pegawai lain.`,
            );
          }
        });

        const now = admin.firestore.FieldValue.serverTimestamp();
        for (const item of writableItems) {
          const employeeRef = adminDb
            .collection('Employees_BlueCollar')
            .doc(item.employeeId);
          const status = item.state === 'ready' ? 'issued' : 'reserved';
          const assignment = assignmentRecord(item, status, actor);
          transaction.update(employeeRef, {
            nipy: item.proposedNipy || null,
            nipyAssignment: assignment,
            'audit.updatedAt': now,
            'audit.updatedBy': actor.uid,
          });
          if (item.proposedNipy) {
            transaction.set(
              adminDb
                .collection(ATTENDANCE_IDENTITIES_COLLECTION)
                .doc(attendanceIdentityDocumentId(item.proposedNipy)),
              {
                nipy: item.proposedNipy,
                employeeId: item.employeeId,
                employeeCollection: 'Employees_BlueCollar',
                updatedAt: now,
                updatedBy: actor.uid,
                schemaVersion: 1,
              },
            );
          }
          transaction.create(
            newFinancialAuditRef(),
            buildFinancialAuditRecord(actor, {
              action:
                status === 'issued'
                  ? 'PEKARYA_NIPY_ISSUED'
                  : 'PEKARYA_NIPY_RESERVED',
              entityType: 'Employees_BlueCollar',
              entityId: item.employeeId,
              requestId,
              reason:
                status === 'issued'
                  ? 'Penerbitan massal NIPY Pekarya berdasarkan formula resmi'
                  : 'Reservasi nomor urut NIPY menunggu tanggal mulai kerja',
              before: { nipy: item.currentNipy },
              after: {
                nipy: item.proposedNipy,
                nipyAssignment: assignment,
              },
              metadata: { previewHash: preview.previewHash },
            }),
          );
        }
        for (const group of GROUPS) {
          transaction.set(
            adminDb
              .collection(PEKARYA_NIPY_SEQUENCES_COLLECTION)
              .doc(PEKARYA_NIPY_PREFIXES[group]),
            {
              categoryGroup: group,
              prefixCode: PEKARYA_NIPY_PREFIXES[group],
              lastSequence: preview.counters[group],
              initialized: true,
              formulaVersion: PEKARYA_NIPY_FORMULA_VERSION,
              initializedAt: now,
              initializedBy: actor.uid,
              updatedAt: now,
            },
            { merge: true },
          );
        }
        const response = {
          issued: readyItems.length,
          reserved: writableItems.filter(
            (item) => item.state === 'reserved',
          ).length,
          existing: preview.summary.existing,
          previewHash: preview.previewHash,
          counters: preview.counters,
        };
        transaction.create(idempotencyRef, {
          requestHash: hash,
          entityType: 'PekaryaNipyBulkIssuance',
          entityId: preview.previewHash,
          response,
          createdAt: now,
        });
        return { ...response, idempotent: false };
      });
      return Response.json(result, { status: 201 });
    }

    if (operation !== 'generate_one') {
      throw new HttpError(400, 'Operasi penerbitan NIPY tidak valid.');
    }
    const employeeId = String(body.employeeId || '').trim();
    if (!/^BC_\d{3}$/.test(employeeId)) {
      throw new HttpError(400, 'ID Pekarya tidak valid.');
    }
    const hash = requestHash({ operation, employeeId });
    const externalIdentityData = await loadAttendanceEmployeeIdentities();
    const ownerMap = identityOwners(externalIdentityData.identities);
    const result = await adminDb.runTransaction(async (transaction) => {
      const employeeRef = adminDb
        .collection('Employees_BlueCollar')
        .doc(employeeId);
      const idempotencyRef = adminDb
        .collection('FinancialIdempotencyKeys')
        .doc(`${actor.uid}__${requestId}`);
      const [employeeSnapshot, idempotencySnapshot] = await Promise.all([
        transaction.get(employeeRef),
        transaction.get(idempotencyRef),
      ]);
      if (idempotencySnapshot.exists) {
        if (idempotencySnapshot.data()?.requestHash !== hash) {
          throw new HttpError(
            409,
            'requestId sudah digunakan untuk operasi berbeda.',
          );
        }
        return {
          ...(idempotencySnapshot.data()?.response || {}),
          idempotent: true,
        };
      }
      if (!employeeSnapshot.exists) {
        throw new HttpError(404, 'Pekarya tidak ditemukan.');
      }
      const employee = employeeInput(
        employeeSnapshot.id,
        employeeSnapshot.data()!,
      );
      if (!employee.active) {
        throw new HttpError(
          409,
          'NIPY formula hanya diterbitkan untuk Pekarya aktif.',
        );
      }
      if (employee.nipy) {
        throw new HttpError(
          409,
          'Pekarya sudah memiliki NIPY. Gunakan koreksi Superadmin bila salah.',
        );
      }
      const group = pekaryaNipyGroup(employee.category);
      if (!group) {
        throw new HttpError(409, 'Kategori Pekarya belum mendukung formula NIPY.');
      }
      const startDate = normalizePekaryaStartDate(employee.startDate);
      if (!startDate) {
        throw new HttpError(
          409,
          'Isi tanggal mulai kerja yang benar sebelum menerbitkan NIPY.',
        );
      }
      const sequenceRef = adminDb
        .collection(PEKARYA_NIPY_SEQUENCES_COLLECTION)
        .doc(PEKARYA_NIPY_PREFIXES[group]);
      const sequenceSnapshot = await transaction.get(sequenceRef);
      if (!sequenceSnapshot.exists || sequenceSnapshot.data()?.initialized !== true) {
        throw new HttpError(
          409,
          'Lakukan penerbitan massal awal sebelum menerbitkan NIPY baru.',
        );
      }
      const reservedSequence =
        employee.assignment?.status === 'reserved' &&
        employee.assignment.categoryGroup === group &&
        Number.isSafeInteger(employee.assignment.sequence)
          ? Number(employee.assignment.sequence)
          : null;
      const sequence =
        reservedSequence || Number(sequenceSnapshot.data()?.lastSequence || 0) + 1;
      const nipy = generatePekaryaNipy(group, startDate, sequence);
      const externalOwner = ownerMap.get(nipy);
      if (
        externalOwner &&
        (externalOwner.employeeId !== employeeId ||
          externalOwner.employeeCollection !== 'Employees_BlueCollar')
      ) {
        throw new HttpError(409, `NIPY ${nipy} sudah dimiliki pegawai lain.`);
      }
      const indexRef = adminDb
        .collection(ATTENDANCE_IDENTITIES_COLLECTION)
        .doc(attendanceIdentityDocumentId(nipy));
      const indexSnapshot = await transaction.get(indexRef);
      if (
        indexSnapshot.exists &&
        (indexSnapshot.data()?.employeeId !== employeeId ||
          indexSnapshot.data()?.employeeCollection !== 'Employees_BlueCollar')
      ) {
        throw new HttpError(409, `NIPY ${nipy} sudah dimiliki pegawai lain.`);
      }
      const assignment = assignmentRecord(
        {
          categoryGroup: group,
          prefixCode: PEKARYA_NIPY_PREFIXES[group],
          startDate,
          sequence,
        },
        'issued',
        actor,
      );
      const now = admin.firestore.FieldValue.serverTimestamp();
      transaction.update(employeeRef, {
        nipy,
        nipyAssignment: assignment,
        'audit.updatedAt': now,
        'audit.updatedBy': actor.uid,
      });
      transaction.set(indexRef, {
        nipy,
        employeeId,
        employeeCollection: 'Employees_BlueCollar',
        updatedAt: now,
        updatedBy: actor.uid,
        schemaVersion: 1,
      });
      if (!reservedSequence) {
        transaction.update(sequenceRef, {
          lastSequence: sequence,
          updatedAt: now,
          updatedBy: actor.uid,
        });
      }
      transaction.create(
        newFinancialAuditRef(),
        buildFinancialAuditRecord(actor, {
          action: 'PEKARYA_NIPY_ISSUED',
          entityType: 'Employees_BlueCollar',
          entityId: employeeId,
          requestId,
          reason: reservedSequence
            ? 'Penerbitan NIPY dari nomor urut yang telah direservasi'
            : 'Penerbitan NIPY Pekarya baru berdasarkan formula resmi',
          before: { nipy: null, nipyAssignment: employee.assignment || null },
          after: { nipy, nipyAssignment: assignment },
        }),
      );
      const response = { employeeId, nipy, sequence, categoryGroup: group };
      transaction.create(idempotencyRef, {
        requestHash: hash,
        entityType: 'PekaryaNipyIssuance',
        entityId: employeeId,
        response,
        createdAt: now,
      });
      return { ...response, idempotent: false };
    });
    return Response.json(result, { status: 201 });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function PATCH(request: NextRequest) {
  try {
    const actor = await requireAuthenticatedProfile(request);
    requireRole(actor, ['super_admin']);
    const body = (await request.json()) as Record<string, unknown>;
    const employeeId = String(body.employeeId || '').trim();
    const expectedNipy = normalizedStoredNipy(body.expectedNipy);
    const reason = String(body.reason || '').trim();
    const requestId = requestIdFrom(body);
    if (!/^BC_\d{3}$/.test(employeeId) || !/^\d{11}$/.test(expectedNipy)) {
      throw new HttpError(400, 'ID Pekarya atau NIPY saat ini tidak valid.');
    }
    if (reason.length < 8 || reason.length > 500) {
      throw new HttpError(
        400,
        'Alasan koreksi wajib diisi antara 8 dan 500 karakter.',
      );
    }
    const hash = requestHash({ employeeId, expectedNipy, reason });
    const externalIdentityData = await loadAttendanceEmployeeIdentities();
    const ownerMap = identityOwners(externalIdentityData.identities);
    const result = await adminDb.runTransaction(async (transaction) => {
      const employeeRef = adminDb
        .collection('Employees_BlueCollar')
        .doc(employeeId);
      const idempotencyRef = adminDb
        .collection('FinancialIdempotencyKeys')
        .doc(`${actor.uid}__${requestId}`);
      const [employeeSnapshot, idempotencySnapshot] = await Promise.all([
        transaction.get(employeeRef),
        transaction.get(idempotencyRef),
      ]);
      if (idempotencySnapshot.exists) {
        if (idempotencySnapshot.data()?.requestHash !== hash) {
          throw new HttpError(
            409,
            'requestId sudah digunakan untuk operasi berbeda.',
          );
        }
        return {
          ...(idempotencySnapshot.data()?.response || {}),
          idempotent: true,
        };
      }
      if (!employeeSnapshot.exists) {
        throw new HttpError(404, 'Pekarya tidak ditemukan.');
      }
      const employee = employeeInput(
        employeeSnapshot.id,
        employeeSnapshot.data()!,
      );
      if (employee.nipy !== expectedNipy) {
        throw new HttpError(
          409,
          'NIPY telah berubah. Muat ulang data sebelum melakukan koreksi.',
        );
      }
      const group = pekaryaNipyGroup(employee.category);
      const startDate = normalizePekaryaStartDate(employee.startDate);
      const sequence = Number(employee.assignment?.sequence || 0);
      if (!group || !startDate || !Number.isSafeInteger(sequence) || sequence < 1) {
        throw new HttpError(
          409,
          'Kategori, tanggal mulai, atau metadata urutan belum valid untuk koreksi.',
        );
      }
      const nipy = generatePekaryaNipy(group, startDate, sequence);
      if (nipy === expectedNipy) {
        throw new HttpError(
          409,
          'NIPY saat ini sudah sesuai formula dari data pegawai terbaru.',
        );
      }
      const externalOwner = ownerMap.get(nipy);
      if (
        externalOwner &&
        (externalOwner.employeeId !== employeeId ||
          externalOwner.employeeCollection !== 'Employees_BlueCollar')
      ) {
        throw new HttpError(409, `NIPY ${nipy} sudah dimiliki pegawai lain.`);
      }
      const oldIndexRef = adminDb
        .collection(ATTENDANCE_IDENTITIES_COLLECTION)
        .doc(attendanceIdentityDocumentId(expectedNipy));
      const newIndexRef = adminDb
        .collection(ATTENDANCE_IDENTITIES_COLLECTION)
        .doc(attendanceIdentityDocumentId(nipy));
      const sequenceRef = adminDb
        .collection(PEKARYA_NIPY_SEQUENCES_COLLECTION)
        .doc(PEKARYA_NIPY_PREFIXES[group]);
      const [newIndexSnapshot, sequenceSnapshot] = await Promise.all([
        transaction.get(newIndexRef),
        transaction.get(sequenceRef),
      ]);
      if (
        newIndexSnapshot.exists &&
        (newIndexSnapshot.data()?.employeeId !== employeeId ||
          newIndexSnapshot.data()?.employeeCollection !==
            'Employees_BlueCollar')
      ) {
        throw new HttpError(409, `NIPY ${nipy} sudah dimiliki pegawai lain.`);
      }
      const now = admin.firestore.FieldValue.serverTimestamp();
      const assignment = {
        ...assignmentRecord(
          {
            categoryGroup: group,
            prefixCode: PEKARYA_NIPY_PREFIXES[group],
            startDate,
            sequence,
          },
          'issued',
          actor,
        ),
        correctedAt: now,
        correctedBy: actor.uid,
        correctionReason: reason,
        previousNipy: expectedNipy,
      };
      transaction.delete(oldIndexRef);
      transaction.set(newIndexRef, {
        nipy,
        employeeId,
        employeeCollection: 'Employees_BlueCollar',
        updatedAt: now,
        updatedBy: actor.uid,
        schemaVersion: 1,
      });
      transaction.update(employeeRef, {
        nipy,
        nipyAssignment: assignment,
        'audit.updatedAt': now,
        'audit.updatedBy': actor.uid,
      });
      transaction.set(
        sequenceRef,
        {
          categoryGroup: group,
          prefixCode: PEKARYA_NIPY_PREFIXES[group],
          initialized: true,
          formulaVersion: PEKARYA_NIPY_FORMULA_VERSION,
          lastSequence: Math.max(
            sequence,
            Number(sequenceSnapshot.data()?.lastSequence || 0),
          ),
          updatedAt: now,
          updatedBy: actor.uid,
        },
        { merge: true },
      );
      transaction.create(
        newFinancialAuditRef(),
        buildFinancialAuditRecord(actor, {
          action: 'PEKARYA_NIPY_REISSUED',
          entityType: 'Employees_BlueCollar',
          entityId: employeeId,
          requestId,
          reason,
          before: {
            nipy: expectedNipy,
            nipyAssignment: employee.assignment || null,
          },
          after: { nipy, nipyAssignment: assignment },
        }),
      );
      const response = { employeeId, previousNipy: expectedNipy, nipy };
      transaction.create(idempotencyRef, {
        requestHash: hash,
        entityType: 'PekaryaNipyReissuance',
        entityId: employeeId,
        response,
        createdAt: now,
      });
      return { ...response, idempotent: false };
    });
    return Response.json(result);
  } catch (error) {
    return errorResponse(error);
  }
}
