import admin, { adminDb } from '../src/lib/firebase-admin';
import {
  buildPekaryaNipyPreview,
  normalizePekaryaStartDate,
  PEKARYA_NIPY_FORMULA_VERSION,
  PEKARYA_NIPY_PREFIXES,
  PekaryaNipyAssignment,
  PekaryaNipyEmployeeInput,
  PekaryaNipyGroup,
} from '../src/lib/payroll/nipy';
import {
  ATTENDANCE_IDENTITIES_COLLECTION,
  attendanceIdentityDocumentId,
  loadAttendanceEmployeeIdentities,
  PEKARYA_NIPY_SEQUENCES_COLLECTION,
} from '../src/lib/server/attendanceStore';

const GROUPS = Object.keys(PEKARYA_NIPY_PREFIXES) as PekaryaNipyGroup[];
const APPLY_FLAG = '--apply';
const hashArg = process.argv.find((item) => item.startsWith('--expected-hash='));
const requestArg = process.argv.find((item) => item.startsWith('--request-id='));
const expectedHash = hashArg?.slice('--expected-hash='.length) || '';
const requestId = requestArg?.slice('--request-id='.length) || '';

function employeeInput(
  snapshot: FirebaseFirestore.QueryDocumentSnapshot,
): PekaryaNipyEmployeeInput {
  const data = snapshot.data();
  return {
    employeeId: snapshot.id,
    name: String(data.name || ''),
    category: String(data.employment?.jobCategory || '').trim().toUpperCase(),
    startDate: normalizePekaryaStartDate(data.employment?.startDate),
    active:
      data.employment?.status === 'active' &&
      data.flags?.isActive !== false &&
      data.flags?.isPayrollEligible !== false,
    nipy: String(data.nipy || '').trim().toUpperCase(),
    assignment:
      data.nipyAssignment && typeof data.nipyAssignment === 'object'
        ? (data.nipyAssignment as Partial<PekaryaNipyAssignment>)
        : null,
  };
}

function sequenceState(
  snapshot: FirebaseFirestore.QuerySnapshot,
): {
  initialized: boolean;
  counters: Partial<Record<PekaryaNipyGroup, number>>;
} {
  const counters: Partial<Record<PekaryaNipyGroup, number>> = {};
  let initializedCount = 0;
  snapshot.docs.forEach((document) => {
    const group = document.data().categoryGroup as PekaryaNipyGroup;
    if (!GROUPS.includes(group)) return;
    counters[group] = Number(document.data().lastSequence || 0);
    if (document.data().initialized === true) initializedCount += 1;
  });
  if (initializedCount > 0 && initializedCount < GROUPS.length) {
    throw new Error('Konfigurasi sequence NIPY hanya terisi sebagian.');
  }
  return {
    initialized: initializedCount === GROUPS.length,
    counters,
  };
}

async function identityOwners() {
  const { identities } = await loadAttendanceEmployeeIdentities();
  return new Map(
    identities
      .filter((identity) => identity.nipy)
      .map((identity) => [
        identity.nipy,
        {
          employeeId: identity.employeeId,
          employeeCollection: identity.employeeCollection,
        },
      ]),
  );
}

async function preview() {
  const [employees, sequences, owners] = await Promise.all([
    adminDb.collection('Employees_BlueCollar').get(),
    adminDb.collection(PEKARYA_NIPY_SEQUENCES_COLLECTION).get(),
    identityOwners(),
  ]);
  return buildPekaryaNipyPreview(
    employees.docs.map(employeeInput),
    {
      ...sequenceState(sequences),
      identityOwners: owners,
    },
  );
}

async function main() {
  const current = await preview();
  console.log(
    JSON.stringify(
      {
        previewHash: current.previewHash,
        initialized: current.initialized,
        summary: current.summary,
        counters: current.counters,
        reservations: current.items
          .filter((item) => item.state === 'reserved')
          .map((item) => ({
            employeeId: item.employeeId,
            name: item.name,
            sequence: item.sequence,
          })),
      },
      null,
      2,
    ),
  );
  if (!process.argv.includes(APPLY_FLAG)) return;
  if (!/^[A-Za-z0-9_-]{8,128}$/.test(requestId)) {
    throw new Error('request-id wajib diisi dan harus stabil.');
  }
  const existingIdempotency = await adminDb
    .collection('FinancialIdempotencyKeys')
    .doc(`system_pekarya_nipy__${requestId}`)
    .get();
  if (existingIdempotency.exists) {
    if (existingIdempotency.data()?.previewHash !== expectedHash) {
      throw new Error('request-id sudah digunakan untuk preview berbeda.');
    }
    console.log(
      JSON.stringify(
        {
          applied: {
            ...(existingIdempotency.data()?.response || {}),
            idempotent: true,
          },
        },
        null,
        2,
      ),
    );
    return;
  }
  if (!/^[a-f0-9]{64}$/.test(expectedHash) || expectedHash !== current.previewHash) {
    throw new Error('Expected preview hash tidak cocok dengan data live.');
  }
  if (current.summary.blocked > 0 || current.summary.conflicts > 0) {
    throw new Error('Preview masih memiliki data terblokir atau konflik.');
  }
  const owners = await identityOwners();
  const result = await adminDb.runTransaction(async (transaction) => {
    const idempotencyRef = adminDb
      .collection('FinancialIdempotencyKeys')
      .doc(`system_pekarya_nipy__${requestId}`);
    const idempotency = await transaction.get(idempotencyRef);
    if (idempotency.exists) {
      if (idempotency.data()?.previewHash !== expectedHash) {
        throw new Error('request-id sudah digunakan untuk preview berbeda.');
      }
      return { ...idempotency.data()?.response, idempotent: true };
    }
    const [employees, sequences] = await Promise.all([
      transaction.get(adminDb.collection('Employees_BlueCollar')),
      transaction.get(
        adminDb.collection(PEKARYA_NIPY_SEQUENCES_COLLECTION),
      ),
    ]);
    const fresh = buildPekaryaNipyPreview(
      employees.docs.map(employeeInput),
      {
        ...sequenceState(sequences),
        identityOwners: owners,
      },
    );
    if (fresh.previewHash !== expectedHash) {
      throw new Error('Data berubah setelah preview; migrasi dibatalkan.');
    }
    const writable = fresh.items.filter((item) => item.needsWrite);
    const ready = writable.filter(
      (item) => item.state === 'ready' && item.proposedNipy,
    );
    const indexes = await Promise.all(
      ready.map((item) =>
        transaction.get(
          adminDb
            .collection(ATTENDANCE_IDENTITIES_COLLECTION)
            .doc(attendanceIdentityDocumentId(item.proposedNipy!)),
        ),
      ),
    );
    indexes.forEach((snapshot, index) => {
      if (
        snapshot.exists &&
        (snapshot.data()?.employeeId !== ready[index].employeeId ||
          snapshot.data()?.employeeCollection !== 'Employees_BlueCollar')
      ) {
        throw new Error(`NIPY ${ready[index].proposedNipy} sudah digunakan.`);
      }
    });

    const now = admin.firestore.FieldValue.serverTimestamp();
    for (const item of writable) {
      if (!item.categoryGroup || !item.prefixCode || !item.sequence) {
        throw new Error(`Metadata NIPY ${item.employeeId} tidak lengkap.`);
      }
      const status = item.state === 'ready' ? 'issued' : 'reserved';
      const assignment = {
        formulaVersion: PEKARYA_NIPY_FORMULA_VERSION,
        categoryGroup: item.categoryGroup,
        prefixCode: item.prefixCode,
        sourceStartDate: item.startDate,
        sequence: item.sequence,
        status,
        source: 'formula',
        assignedAt: now,
        assignedBy: 'system:pekarya-nipy-initial-migration',
        assignedByRole: 'system',
        updatedAt: now,
      };
      transaction.update(
        adminDb.collection('Employees_BlueCollar').doc(item.employeeId),
        {
          nipy: item.proposedNipy || null,
          nipyAssignment: assignment,
          'audit.updatedAt': now,
          'audit.updatedBy': 'system:pekarya-nipy-initial-migration',
        },
      );
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
            updatedBy: 'system:pekarya-nipy-initial-migration',
            schemaVersion: 1,
          },
        );
      }
      transaction.create(adminDb.collection('FinancialAuditLogs').doc(), {
        action:
          status === 'issued'
            ? 'PEKARYA_NIPY_ISSUED'
            : 'PEKARYA_NIPY_RESERVED',
        entityType: 'Employees_BlueCollar',
        entityId: item.employeeId,
        reason:
          status === 'issued'
            ? 'Penerbitan awal NIPY Pekarya berdasarkan formula resmi'
            : 'Reservasi awal nomor urut NIPY menunggu tanggal mulai kerja',
        requestId,
        actorUid: 'system:pekarya-nipy-initial-migration',
        actorRole: 'system',
        actorEmail: null,
        before: { nipy: item.currentNipy },
        after: { nipy: item.proposedNipy, nipyAssignment: assignment },
        metadata: { previewHash: fresh.previewHash },
        occurredAt: now,
        schemaVersion: 1,
      });
    }
    for (const group of GROUPS) {
      transaction.set(
        adminDb
          .collection(PEKARYA_NIPY_SEQUENCES_COLLECTION)
          .doc(PEKARYA_NIPY_PREFIXES[group]),
        {
          categoryGroup: group,
          prefixCode: PEKARYA_NIPY_PREFIXES[group],
          lastSequence: fresh.counters[group],
          initialized: true,
          formulaVersion: PEKARYA_NIPY_FORMULA_VERSION,
          initializedAt: now,
          initializedBy: 'system:pekarya-nipy-initial-migration',
          updatedAt: now,
        },
        { merge: true },
      );
    }
    const response = {
      issued: ready.length,
      reserved: writable.filter((item) => item.state === 'reserved').length,
      counters: fresh.counters,
    };
    transaction.create(idempotencyRef, {
      previewHash: fresh.previewHash,
      entityType: 'PekaryaNipyInitialMigration',
      entityId: fresh.previewHash,
      response,
      createdAt: now,
    });
    return { ...response, idempotent: false };
  });
  console.log(JSON.stringify({ applied: result }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
