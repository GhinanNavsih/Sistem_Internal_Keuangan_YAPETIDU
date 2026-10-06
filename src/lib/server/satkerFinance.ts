import admin, { adminDb } from '@/lib/firebase-admin';
import { AuthenticatedProfile, HttpError } from '@/lib/server/auth';
import { DEFAULT_ACCOUNTS, FinancialAccount, OpeningBalances } from '@/lib/satker-finance/core';
import biroUmumAkunData from '@/lib/satker-finance/biro-umum-26-27-akun.json';

export const UNIT_COLLECTION = 'SatkerFinancialUnits';
export const YEAR_COLLECTION = 'SatkerFinancialYears';
export const ACCOUNT_COLLECTION = 'SatkerFinancialAccounts';
export const UNIT_ACCOUNT_SUBCOLLECTION = 'accountCatalog';
export const BIRO_UMUM_ACCOUNT_UNIT_ID = 'loyalis-6e44fkzdvenwmudsoklvzbokblg3';
export const BIRO_UMUM_ACCOUNT_SOURCE = biroUmumAkunData.source;
export const CATALOG_META_REF = adminDb.collection('SatkerFinancialCatalogMeta').doc('catalog');
export const BOOK_PATH = '/dashboard/satker-finance';
export const FINANCIAL_READ_ROLES = ['super_admin', 'finance_verifier', 'rector_finance'] as const;
export const FINANCIAL_EDITOR_ROLES = ['satker_head_loyalis', 'satker_finance_admin'] as const;

export type FinancialUnit = {
  id: string;
  name: string;
  headName: string;
  adminName: string;
  editorUids: string[];
  revision: number;
};

export function canReadAll(actor: AuthenticatedProfile) {
  return (FINANCIAL_READ_ROLES as readonly string[]).includes(actor.role);
}

export function canEditUnit(actor: AuthenticatedProfile, unit: FinancialUnit) {
  return actor.role === 'super_admin' ||
    ((FINANCIAL_EDITOR_ROLES as readonly string[]).includes(actor.role) && unit.editorUids.includes(actor.uid));
}

export function assertUnitRead(actor: AuthenticatedProfile, unit: FinancialUnit) {
  if (!canReadAll(actor) && !canEditUnit(actor, unit)) throw new HttpError(403, 'Anda tidak memiliki akses ke buku SatKer ini.');
}

export function assertUnitEdit(actor: AuthenticatedProfile, unit: FinancialUnit) {
  if (!canEditUnit(actor, unit)) throw new HttpError(403, 'Anda tidak dapat mengubah buku SatKer ini.');
}

export async function listUnits(actor: AuthenticatedProfile): Promise<FinancialUnit[]> {
  const collection = adminDb.collection(UNIT_COLLECTION);
  const snapshot = await (canReadAll(actor) ? collection : collection.where('editorUids', 'array-contains', actor.uid)).get();
  return snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() } as FinancialUnit))
    .filter((unit) => canReadAll(actor) || canEditUnit(actor, unit))
    .sort((a, b) => a.name.localeCompare(b.name, 'id'));
}

/** Deterministic, so a head's own book is found again (and never duplicated) without a lookup by name. */
export function ownUnitId(uid: string) {
  return `loyalis-${uid.toLowerCase().replace(/[^a-z0-9]/g, '')}`.slice(0, 50);
}

/**
 * Gives a Kepala SatKer Loyalis their own book the first time they open the page,
 * so Super Admin does not have to create it and list them as pengelola. Only
 * runs for a head who is on no book yet; the book is theirs alone, named with
 * the per-user SatKer name when set, or their account name as a fallback.
 *
 * Runs at most once per head: if the document already exists it is left alone,
 * so a head Super Admin deliberately removed from their own book is not put back.
 * Returns true only when it created the book.
 */
export async function ensureOwnUnit(actor: AuthenticatedProfile): Promise<boolean> {
  if (actor.role !== 'satker_head_loyalis') return false;
  const id = ownUnitId(actor.uid);
  const ref = adminDb.collection(UNIT_COLLECTION).doc(id);
  const displayName = actor.displayName.trim().slice(0, 150);
  const satkerName = actor.satkerName?.trim().slice(0, 150) || displayName;
  return adminDb.runTransaction(async (tx) => {
    if ((await tx.get(ref)).exists) return false;
    const after = {
      name: satkerName || 'SatKer Loyalis', headName: displayName, adminName: '', editorUids: [actor.uid],
      revision: 1, autoProvisioned: true, updatedAt: admin.firestore.FieldValue.serverTimestamp(), updatedBy: actor.uid,
    };
    tx.create(ref, after);
    tx.create(adminDb.collection('SatkerFinancialConfigAudit').doc(), {
      action: 'UNIT_CREATED', target: id, before: null, after, auto: true,
      actorUid: actor.uid, actorRole: actor.role, at: admin.firestore.FieldValue.serverTimestamp(),
    });
    return true;
  });
}

export async function getUnit(actor: AuthenticatedProfile, id: string): Promise<FinancialUnit> {
  if (!/^[a-z0-9][a-z0-9-]{1,49}$/.test(id)) throw new HttpError(400, 'ID SatKer tidak valid.');
  const snapshot = await adminDb.collection(UNIT_COLLECTION).doc(id).get();
  if (!snapshot.exists) throw new HttpError(404, 'SatKer tidak ditemukan.');
  const unit = { id: snapshot.id, ...snapshot.data() } as FinancialUnit;
  assertUnitRead(actor, unit);
  return unit;
}

export function yearRef(unitId: string, academicYear: string) {
  if (!/^[a-z0-9][a-z0-9-]{1,49}$/.test(unitId) || !/^\d{4}-\d{4}$/.test(academicYear)) {
    throw new HttpError(400, 'SatKer atau tahun akademik tidak valid.');
  }
  return adminDb.collection(YEAR_COLLECTION).doc(`${unitId}_${academicYear}`);
}

export function unitAccountCollection(unitId: string) {
  return adminDb.collection(UNIT_COLLECTION).doc(unitId).collection(UNIT_ACCOUNT_SUBCOLLECTION);
}

export function unitAccountCatalogMetaRef(unitId: string) {
  return unitAccountCollection(unitId).doc('_meta');
}

export function unitAccountCatalogSource(unitId: string) {
  return unitId === BIRO_UMUM_ACCOUNT_UNIT_ID ? BIRO_UMUM_ACCOUNT_SOURCE : null;
}

type ImportedAkun = {
  code: string;
  name: string;
  type: FinancialAccount['type'];
  normalBalance: FinancialAccount['normalBalance'];
  reportTarget: FinancialAccount['reportTarget'];
};

function inferredCashFlowSection(account: ImportedAkun): FinancialAccount['cashFlowSection'] {
  if (account.type === 'TERIMA' || account.type === 'KELUAR') return 'OPERATING';
  if (account.type === 'HUTANG' || account.type === 'MODAL') return 'FINANCING';
  if (account.type === 'AKTIVA' && account.code.startsWith('13')) return 'INVESTING';
  if (account.type === 'AKTIVA' && account.code.startsWith('12')) return 'OPERATING';
  return null;
}

function accountsForUnit(unitId: string, globalAccounts: FinancialAccount[]): FinancialAccount[] {
  if (unitId !== BIRO_UMUM_ACCOUNT_UNIT_ID) return globalAccounts;
  const importedAccounts = biroUmumAkunData.accounts as ImportedAkun[];
  const globalByCode = new Map(globalAccounts.map((account) => [account.code, account]));
  return importedAccounts.map((source) => {
    const existing = globalByCode.get(source.code);
    const normalBalance = existing?.normalBalance ?? source.normalBalance;
    const reportTarget = existing?.reportTarget ?? source.reportTarget;
    const postable = !!source.name && !!normalBalance && !!reportTarget;
    return {
      ...(existing || {}),
      id: existing ? source.code : `biro_umum_${source.code}`,
      code: source.code,
      name: source.name,
      type: source.type,
      normalBalance,
      reportTarget,
      postable,
      cashEquivalent: existing?.cashEquivalent === true || (postable && (source.code === '10000' || /^11\d{3}$/.test(source.code))),
      cashFlowSection: existing?.cashFlowSection ?? inferredCashFlowSection(source),
    };
  });
}

export async function loadAccounts(unitId?: string): Promise<FinancialAccount[]> {
  const snapshot = await adminDb.collection(ACCOUNT_COLLECTION).get();
  const overrides = new Map(snapshot.docs.map((doc) => [doc.id, doc.data()]));
  const globalAccounts = DEFAULT_ACCOUNTS.map((defaultAccount) => {
    const override = overrides.get(defaultAccount.code);
    if (!override) return { ...defaultAccount, id: defaultAccount.code };
    const account = { ...defaultAccount,
      id: defaultAccount.code,
      name: String(override.name || ''),
      normalBalance: override.normalBalance,
      reportTarget: override.reportTarget,
      cashEquivalent: override.cashEquivalent === true,
      cashFlowSection: override.cashFlowSection,
      revision: typeof override.revision === 'number' ? override.revision : 0,
    } as FinancialAccount;
    account.postable = !!account.name && !!account.normalBalance && !!account.reportTarget;
    return account;
  });
  if (!unitId) return globalAccounts;

  const unitDefaults = accountsForUnit(unitId, globalAccounts);
  const localSnapshot = await unitAccountCollection(unitId).get();
  const localById = new Map(localSnapshot.docs.map((doc) => [doc.id, doc.data()]));
  const unitAccounts = unitDefaults.map((account) => {
    const localAccountId = `base_${account.code}`;
    const local = localById.get(localAccountId);
    if (!local) return { ...account, localAccountId, revision: 0 };
    const code = typeof local.code === 'string' ? local.code : account.code;
    const name = typeof local.name === 'string' ? local.name : account.name;
    return { ...account, id: account.id || account.code, code, name, localAccountId, revision: Number(local.revision || 0), postable: !!name && !!account.normalBalance && !!account.reportTarget };
  });
  for (const doc of localSnapshot.docs) {
    if (doc.id === '_meta' || doc.id.startsWith('base_')) continue;
    const local = doc.data();
    if (typeof local.code !== 'string' || typeof local.name !== 'string') continue;
    unitAccounts.push({
      id: doc.id, localAccountId: doc.id, code: local.code, name: local.name,
      type: local.type as FinancialAccount['type'],
      normalBalance: local.normalBalance as FinancialAccount['normalBalance'],
      reportTarget: local.reportTarget as FinancialAccount['reportTarget'],
      postable: local.postable === true, cashEquivalent: local.cashEquivalent === true,
      cashFlowSection: local.cashFlowSection as FinancialAccount['cashFlowSection'],
      revision: Number(local.revision || 0),
    });
  }
  return unitAccounts;
}

export function openingFrom(value: unknown): OpeningBalances {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return value as OpeningBalances;
}

export function publicYear(data: Record<string, unknown> | undefined) {
  return {
    status: data?.status === 'CLOSED' ? 'CLOSED' : 'ACTIVE',
    revision: typeof data?.revision === 'number' ? data.revision : 0,
    entryCount: typeof data?.entryCount === 'number' ? data.entryCount : 0,
    openingBalances: openingFrom(data?.openingBalances),
  };
}
