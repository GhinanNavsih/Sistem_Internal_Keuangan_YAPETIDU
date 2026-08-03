import * as admin from 'firebase-admin';
import * as dotenv from 'dotenv';
import * as fs from 'fs';
import * as path from 'path';

dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });

const serviceAccountPath = path.resolve(process.cwd(), 'service-account.json');

if (!admin.apps.length) {
  const projectId = process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID || 'internal-bak';
  if (fs.existsSync(serviceAccountPath)) {
    admin.initializeApp({
      credential: admin.credential.cert(serviceAccountPath),
      projectId,
    });
  } else if (process.env.FIREBASE_SERVICE_ACCOUNT) {
    admin.initializeApp({
      credential: admin.credential.cert(
        JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT),
      ),
      projectId,
    });
  } else {
    admin.initializeApp({
      credential: admin.credential.applicationDefault(),
      projectId,
    });
  }
}

const db = admin.firestore();

const BLUE_COLLAR_COLLECTION = 'Employees_BlueCollar';
const URAIAN_COLLECTION = 'UraianGaji';
const USERS_COLLECTION = 'users';
const LEGACY_CATEGORY = 'KEBERSIHAN_IC';
const CANONICAL_CATEGORY = 'KEBERSIHAN';
const USER_ID = 'n6jnkPvgXRSxhexXYZ5n8zJhgOn1';

const EMPLOYEES = [
  { id: 'BC_053', name: 'Khoirul Anam' },
  { id: 'BC_054', name: 'Pribadi' },
] as const;

const URAIAN_PERIODS = ['2026_05', '2026_06', '2026_07'] as const;

type FirestoreMap = Record<string, unknown>;

function asMap(value: unknown, label: string): FirestoreMap {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${label} harus berupa object Firestore.`);
  }
  return value as FirestoreMap;
}

function entriesFrom(data: FirestoreMap, documentId: string): FirestoreMap {
  const rawEntries = data.entries;
  if (rawEntries === undefined) return {};
  return asMap(rawEntries, `entries pada UraianGaji/${documentId}`);
}

function expectedEmployeeNameMatches(actual: unknown, expected: string): boolean {
  return String(actual || '').trim().toLocaleLowerCase('id-ID') === expected.toLocaleLowerCase('id-ID');
}

function mergeEntries(
  canonicalEntries: FirestoreMap,
  legacyEntries: FirestoreMap,
  legacyDocumentId: string,
): FirestoreMap {
  const merged = { ...canonicalEntries };
  for (const [employeeId, entry] of Object.entries(legacyEntries)) {
    if (Object.prototype.hasOwnProperty.call(merged, employeeId)) {
      throw new Error(
        `Benturan entry ${employeeId} antara UraianGaji/${legacyDocumentId} dan dokumen canonical. ` +
          'Migrasi dibatalkan agar data canonical tidak tertimpa.',
      );
    }
    merged[employeeId] = entry;
  }
  return merged;
}

async function migrate(): Promise<void> {
  const employeeRefs = EMPLOYEES.map(({ id }) =>
    db.collection(BLUE_COLLAR_COLLECTION).doc(id),
  );
  const userRef = db.collection(USERS_COLLECTION).doc(USER_ID);
  const uraianRefs = URAIAN_PERIODS.flatMap((period) => [
    db.collection(URAIAN_COLLECTION).doc(`${period}_${CANONICAL_CATEGORY}`),
    db.collection(URAIAN_COLLECTION).doc(`${period}_${LEGACY_CATEGORY}`),
  ]);

  await db.runTransaction(async (transaction) => {
    const snapshots = await transaction.getAll(
      ...employeeRefs,
      ...uraianRefs,
      userRef,
    );
    const snapshotsByPath = new Map(
      snapshots.map((snapshot) => [snapshot.ref.path, snapshot]),
    );

    for (let index = 0; index < EMPLOYEES.length; index += 1) {
      const employee = EMPLOYEES[index];
      const snapshot = snapshotsByPath.get(employeeRefs[index].path);
      if (!snapshot?.exists) {
        throw new Error(`Dokumen ${BLUE_COLLAR_COLLECTION}/${employee.id} tidak ditemukan.`);
      }
      if (!expectedEmployeeNameMatches(snapshot.data()?.name, employee.name)) {
        throw new Error(
          `Nama pada ${BLUE_COLLAR_COLLECTION}/${employee.id} tidak sesuai target (${employee.name}).`,
        );
      }
    }

    const userSnapshot = snapshotsByPath.get(userRef.path);
    if (!userSnapshot?.exists) {
      throw new Error(`Dokumen ${USERS_COLLECTION}/${USER_ID} tidak ditemukan.`);
    }

    for (let index = 0; index < URAIAN_PERIODS.length; index += 1) {
      const period = URAIAN_PERIODS[index];
      const canonicalRef = uraianRefs[index * 2];
      const legacyRef = uraianRefs[index * 2 + 1];
      const canonicalSnapshot = snapshotsByPath.get(canonicalRef.path);
      const legacySnapshot = snapshotsByPath.get(legacyRef.path);

      if (!legacySnapshot?.exists) {
        if (canonicalSnapshot?.exists) {
          transaction.update(canonicalRef, {
            jobCategory: CANONICAL_CATEGORY,
          });
        }
        console.log(`UraianGaji/${period}_${LEGACY_CATEGORY} sudah tidak ada; dilewati.`);
        continue;
      }
      if (!canonicalSnapshot?.exists) {
        throw new Error(
          `Dokumen tujuan UraianGaji/${period}_${CANONICAL_CATEGORY} tidak ditemukan; ` +
            `UraianGaji/${period}_${LEGACY_CATEGORY} tidak dihapus.`,
        );
      }

      const canonicalData = canonicalSnapshot.data() || {};
      const legacyData = legacySnapshot.data() || {};
      const mergedEntries = mergeEntries(
        entriesFrom(canonicalData, canonicalRef.id),
        entriesFrom(legacyData, legacyRef.id),
        legacyRef.id,
      );

      transaction.set(
        canonicalRef,
        {
          jobCategory: CANONICAL_CATEGORY,
          entries: mergedEntries,
        },
        { merge: true },
      );
      transaction.delete(legacyRef);
      console.log(
        `UraianGaji/${legacyRef.id}: ${Object.keys(legacyData.entries || {}).length} entry digabung ke UraianGaji/${canonicalRef.id}.`,
      );
    }

    for (const employeeRef of employeeRefs) {
      transaction.update(employeeRef, {
        // Canonical application field.
        'employment.jobCategory': CANONICAL_CATEGORY,
        // Keep the requested role/position/unit values available in both the
        // current nested schema and the legacy flat shape used by old tools.
        'employment.role': CANONICAL_CATEGORY,
        'employment.position': CANONICAL_CATEGORY,
        'employment.unit': CANONICAL_CATEGORY,
        role: CANONICAL_CATEGORY,
        position: CANONICAL_CATEGORY,
        unit: CANONICAL_CATEGORY,
      });
    }

    const permittedCategories = Array.isArray(userSnapshot.data()?.permittedCategories)
      ? userSnapshot
          .data()!
          .permittedCategories.filter((category: unknown) => category !== LEGACY_CATEGORY)
      : [];
    transaction.update(userRef, { permittedCategories });
  });

  console.log('Migrasi merge KEBERSIHAN_IC ke KEBERSIHAN selesai.');
  console.log(`Pegawai diperbarui: ${EMPLOYEES.map(({ id }) => id).join(', ')}`);
  console.log(`Izin pengguna diperbarui: ${USER_ID}`);
}

migrate().then(
  () => process.exit(0),
  (error: unknown) => {
    console.error('Migrasi gagal:', error);
    process.exit(1);
  },
);
