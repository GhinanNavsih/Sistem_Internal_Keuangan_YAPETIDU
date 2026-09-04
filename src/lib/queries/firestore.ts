import { collection, doc, getDoc, getDocs, setDoc } from 'firebase/firestore';
import { db, secondaryDb } from '@/lib/firebase';
import { timestampToMillis } from '@/lib/payroll/presenceCorrections';
import type { SalaryMatrixCollection } from './keys';

/**
 * Shared fetchers for the Firestore reads that several dashboard pages make.
 *
 * These were previously inlined in each page's `useEffect`, which meant every
 * mount re-read whole collections. Pulling them out gives the query cache a
 * stable unit to key on and keeps the version-resolution rules in one place.
 */

/** Version used when a matrix collection has no `_config.activeVersion` yet. */
export const DEFAULT_MATRIX_VERSION = '2026_v1';

const withId = <T,>(snapshotDocs: { id: string; data: () => any }[]): T[] =>
  snapshotDocs.map(docSnap => ({ id: docSnap.id, ...docSnap.data() }) as T);

export async function fetchEmployeesLoyalis(): Promise<any[]> {
  const snap = await getDocs(collection(db, 'Employees_Loyalis'));
  return withId(snap.docs);
}

export async function fetchEmployeesBlueCollar(): Promise<any[]> {
  const snap = await getDocs(collection(db, 'Employees_BlueCollar'));
  return withId(snap.docs);
}

/** Resolves the active version of a salary matrix collection. */
export async function fetchMatrixActiveVersion(
  collectionName: SalaryMatrixCollection,
): Promise<string> {
  const configSnap = await getDoc(doc(db, collectionName, '_config'));
  if (configSnap.exists() && configSnap.data().activeVersion) {
    return configSnap.data().activeVersion as string;
  }
  return DEFAULT_MATRIX_VERSION;
}

/** Grade codes live on the version doc's `metadata`, not on the rows. */
export async function fetchMatrixGradeCodes(
  collectionName: SalaryMatrixCollection,
  version: string,
): Promise<string[]> {
  const versionSnap = await getDoc(doc(db, collectionName, version));
  if (!versionSnap.exists()) return [];
  return (versionSnap.data()?.metadata?.gradeCodes as string[]) || [];
}

export async function fetchMatrixRows<T = any>(
  collectionName: SalaryMatrixCollection,
  version: string,
): Promise<T[]> {
  const snap = await getDocs(collection(db, collectionName, version, 'rows'));
  return withId<T>(snap.docs);
}

export async function fetchKoperasiLoans(): Promise<any[]> {
  const snap = await getDocs(collection(secondaryDb, 'simpanPinjam'));
  return withId(snap.docs);
}

export async function fetchKoperasiUsers(): Promise<any[]> {
  const snap = await getDocs(collection(secondaryDb, 'users'));
  return withId(snap.docs);
}

export interface JabatanStrukturalOption {
  id: string;
  name: string;
  satker: string;
  allowance: number;
}

export async function fetchJabatanStruktural(): Promise<JabatanStrukturalOption[]> {
  const snap = await getDocs(collection(db, 'JabatanStruktural'));
  const list = snap.docs.map(docSnap => ({
    id: docSnap.id,
    name: docSnap.data().name as string,
    satker: docSnap.data().satker as string,
    allowance: Number(docSnap.data().allowance) || 0,
  }));
  return list.sort((a, b) => a.name.localeCompare(b.name));
}

const DEFAULT_DEPARTMENTS = [
  'FAK. AGAMA ISLAM',
  'FAK. BISNIS, BAHASA DAN PENDIDIKAN',
  'FAK. ILMU KESEHATAN',
  'FAK. SAINS DAN TEKNOLOGI',
  'PASCASARJANA',
  'REKTORAT',
  'UPT & LEMBAGA',
];

/**
 * Reads the department list, seeding `Settings/departments` with the defaults
 * the first time it is missing. The seeding write is preserved from the original
 * employees-page implementation; it is idempotent and only fires when the doc
 * genuinely does not exist.
 */
export async function fetchDepartments(): Promise<string[]> {
  const deptDoc = await getDoc(doc(db, 'Settings', 'departments'));
  if (deptDoc.exists() && deptDoc.data().list) {
    return deptDoc.data().list as string[];
  }

  try {
    await setDoc(doc(db, 'Settings', 'departments'), { list: DEFAULT_DEPARTMENTS });
  } catch (e) {
    console.error('Failed to initialize departments in Firestore:', e);
  }
  return DEFAULT_DEPARTMENTS;
}

export interface SignatureSlot {
  name: string;
  title: string;
}

/**
 * Reads `Settings/signatures`, normalizing the legacy single-signature shape
 * (`{name, title}`) into an array so callers never have to special-case it.
 * That normalization previously lived inline in the rekap page.
 */
export async function fetchSettingsSignatures(): Promise<Record<string, SignatureSlot[]>> {
  const docSnap = await getDoc(doc(db, 'Settings', 'signatures'));
  if (!docSnap.exists()) return {};

  const raw = docSnap.data();
  const normalized: Record<string, SignatureSlot[]> = {};
  Object.entries(raw).forEach(([cat, val]) => {
    if (Array.isArray(val)) {
      normalized[cat] = val;
    } else if (val && typeof val === 'object' && ((val as any).name || (val as any).title)) {
      normalized[cat] = [val as SignatureSlot];
    }
  });
  return normalized;
}

/**
 * Reads one `PayrollPeriods/{period}` doc. Returns the raw document because
 * consumers derive different things from it — the proposal page reads
 * `attendanceStatus` as an edit gate, the rekap page reads duty-plan and
 * calendar fields.
 */
export async function fetchPayrollPeriod(period: string): Promise<any | null> {
  const snap = await getDoc(doc(db, 'PayrollPeriods', period));
  return snap.exists() ? snap.data() : null;
}

export async function fetchSatpamShiftTeams(): Promise<any[]> {
  const snap = await getDocs(collection(db, 'SatpamShiftTeams'));
  return withId(snap.docs);
}

/**
 * Reads the whole `LoyalisPresenceCorrections` collection, newest first.
 *
 * Deliberately unfiltered: callers scope it to a period client-side using the
 * `date` field, which is what every existing read path treats as authoritative.
 * The `date`-based filter must not be swapped for the doc's `period` field —
 * that one is optional and only written as a by-product of processing a
 * correction, so filtering on it would silently drop records.
 *
 * Sorted client-side rather than with `orderBy('createdAt')` for the same
 * reason: a Firestore sort would drop any document missing the field, whereas
 * `timestampToMillis` degrades to 0 and keeps it in the queue.
 */
export async function fetchLoyalisPresenceCorrections(): Promise<any[]> {
  const snap = await getDocs(collection(db, 'LoyalisPresenceCorrections'));
  return withId<any>(snap.docs).sort(
    (a, b) => timestampToMillis(b.createdAt) - timestampToMillis(a.createdAt),
  );
}

/**
 * Every proposal and LPJ ever filed, for the "clone from historical baseline"
 * dialog. Unbounded by period by design — the dialog offers past periods as
 * templates.
 */
export async function fetchKegiatanHistoricalBaselines(): Promise<any[]> {
  const [snapProp, snapLpj] = await Promise.all([
    getDocs(collection(db, 'ProposalKegiatan')),
    getDocs(collection(db, 'PelaporanKegiatan')),
  ]);

  const listProp = snapProp.docs.map(d => ({ id: d.id, sourceType: 'PROPOSAL', ...d.data() }));
  const listLpj = snapLpj.docs.map(d => ({ id: d.id, sourceType: 'LPJ', ...d.data() }));

  const combined = [...listProp, ...listLpj].filter((e: any) => (e.reportName || '').trim() !== '');
  combined.sort((a: any, b: any) => (b.period || '').localeCompare(a.period || ''));
  return combined;
}
