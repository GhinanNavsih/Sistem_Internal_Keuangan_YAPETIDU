import { adminDb } from '@/lib/firebase-admin';
import { AuthenticatedProfile, HttpError } from '@/lib/server/auth';
import { DEFAULT_ACCOUNTS, FinancialAccount, OpeningBalances } from '@/lib/satker-finance/core';

export const UNIT_COLLECTION = 'SatkerFinancialUnits';
export const YEAR_COLLECTION = 'SatkerFinancialYears';
export const ACCOUNT_COLLECTION = 'SatkerFinancialAccounts';
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

export async function loadAccounts(): Promise<FinancialAccount[]> {
  const snapshot = await adminDb.collection(ACCOUNT_COLLECTION).get();
  const overrides = new Map(snapshot.docs.map((doc) => [doc.id, doc.data()]));
  return DEFAULT_ACCOUNTS.map((defaultAccount) => {
    const override = overrides.get(defaultAccount.code);
    if (!override) return defaultAccount;
    const account = { ...defaultAccount,
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
