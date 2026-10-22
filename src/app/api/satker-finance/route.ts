import { createHash, randomBytes } from 'node:crypto';
import { NextRequest } from 'next/server';
import type { DocumentReference, Transaction } from 'firebase-admin/firestore';
import admin, { adminDb, adminStorage } from '@/lib/firebase-admin';
import { errorResponse, HttpError, requireAuthenticatedProfile, requireRole, type AuthenticatedProfile } from '@/lib/server/auth';
import {
  ACCOUNT_COLLECTION, CATALOG_META_REF, assertUnitEdit, canReadAll, ensureOwnUnit, fixedAssetCollection, fixedAssetFrom, getUnit,
  listUnits, loadAccounts, loadFixedAssets, unitAccountCatalogSource, openingFrom, publicYear, UNIT_COLLECTION, unitAccountCatalogMetaRef,
  unitAccountCollection, YEAR_COLLECTION, yearRef,
} from '@/lib/server/satkerFinance';
import {
  accountId as financialAccountId, academicYearFor, adjacentAcademicYear, buildFinancialStatements, buildVoucher, buildYearClosing, CASH_FLOW_SECTIONS,
  calendarYearOf, DEFAULT_ACCOUNTS, defaultCashFlowSection, entryReceiptPaths, MAX_ENTRY_RECEIPTS, MAX_ENTRY_RECEIPT_BYTES, defaultSurplusAccountId, emptyCashFlows, groupNormalBalance, entryCashFlows, fiscalMonths, FinancialAccount, JournalEntry, lastDateOfMonth,
  OpeningBalances, sameBalances, type AccountType, type CashFlowAmounts, validateEntryDate, validateOpeningBalances,
} from '@/lib/satker-finance/core';
import { entryChangeBlocker, isReportOpen } from '@/lib/satker-finance/entryEditing';
import {
  assetChangeBlocker, assetFiguresChanged, buildDepreciationJournal, depreciationEntryId, sameJournalLines, validateFixedAsset,
} from '@/lib/satker-finance/depreciation';
import { reconciliationDocId, validateReconciliationInput, type BankReconciliation } from '@/lib/satker-finance/bankReconciliation';
import { monthChecks, openingComesFromPreviousYear, type PreviousYearState } from '@/lib/satker-finance/monthControls';
import { MAX_UPLOAD_BYTES, UPLOAD_TYPES_TEXT, detectUploadFileType, parseBase64DataUrl } from '@/lib/uploadFileTypes';

export const dynamic = 'force-dynamic';
const noStore = { 'Cache-Control': 'no-store, max-age=0, must-revalidate' };
const monthNames = ['Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni', 'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember'];
const monthName = (index: number) => monthNames[index - 1];

function string(value: unknown, name: string, max = 150) {
  if (typeof value !== 'string' || !value.trim() || value.trim().length > max) throw new HttpError(400, `${name} wajib diisi (maksimal ${max} karakter).`);
  return value.trim();
}
function inputError(error: unknown): never {
  if (error instanceof HttpError) throw error;
  throw new HttpError(400, error instanceof Error ? error.message : 'Data tidak valid.');
}
function audit(tx: Transaction, year: DocumentReference, actor: AuthenticatedProfile, action: string, details: Record<string, unknown>) {
  tx.create(year.collection('audit').doc(), {
    action, actorUid: actor.uid, actorRole: actor.role, actorName: actor.displayName || actor.email || actor.uid, details,
    at: admin.firestore.FieldValue.serverTimestamp(),
  });
}
function notify(tx: Transaction, recipientUids: string[], data: { unitId: string; academicYear: string; monthIndex: number; title: string; message: string }) {
  for (const uid of [...new Set(recipientUids)]) {
    tx.create(adminDb.collection('users').doc(uid).collection('satkerFinancialNotifications').doc(), {
      ...data, readAt: null, at: admin.firestore.FieldValue.serverTimestamp(),
    });
  }
}
async function usersWithRole(role: string) {
  const snapshot = await adminDb.collection('users').where('role', '==', role).get();
  return snapshot.docs.filter((doc) => doc.data().disabled !== true).map((doc) => doc.id);
}
/** The receipts a request carries: `receiptDataUrls`, or the single `receiptDataUrl` older clients send. */
function receiptInputs(raw: Record<string, unknown>): unknown[] {
  const value = raw.receiptDataUrls ?? (raw.receiptDataUrl ? [raw.receiptDataUrl] : []);
  if (!Array.isArray(value)) throw new HttpError(400, 'Bukti transaksi tidak valid.');
  if (value.length > MAX_ENTRY_RECEIPTS) throw new HttpError(400, `Bukti transaksi maksimal ${MAX_ENTRY_RECEIPTS} berkas.`);
  return value;
}
async function deleteReceipts(paths: string[]) {
  await Promise.all(paths.map((path) => adminStorage.bucket().file(path).delete({ ignoreNotFound: true }).catch((cleanupError) => console.error('Receipt cleanup failed', cleanupError))));
}
/**
 * Validates receipt photos sent as data URLs and stores them, returning their
 * Storage paths in order. Nothing is stored unless every file is valid (each at
 * most maxBytes; the browser compresses journal receipts to that size). Every
 * call writes new files (random suffix), so adding a receipt never overwrites
 * an old one, which the audit trail still points at.
 */
async function storeReceipts(dataUrls: unknown[], unitId: string, academicYear: string, entryId: string, maxBytes = MAX_UPLOAD_BYTES): Promise<string[]> {
  const files = dataUrls.map((dataUrl) => {
    if (typeof dataUrl !== 'string') throw new HttpError(400, 'Bukti transaksi tidak valid.');
    const buffer = parseBase64DataUrl(dataUrl);
    if (!buffer) throw new HttpError(400, 'Bukti transaksi tidak valid.');
    if (!buffer.length || buffer.length > maxBytes) throw new HttpError(400, `Ukuran tiap bukti maksimal ${maxBytes / (1024 * 1024)} MB.`);
    // The type comes from the file's own bytes, whatever the browser declared.
    const type = detectUploadFileType(buffer);
    if (!type) throw new HttpError(400, `Bukti harus berupa ${UPLOAD_TYPES_TEXT}, dan isi berkas harus sesuai jenisnya.`);
    return { buffer, type };
  });
  const paths: string[] = [];
  try {
    for (const { buffer, type } of files) {
      const receiptPath = `satker-finance/${unitId}/${academicYear}/${entryId}_${randomBytes(8).toString('hex')}.${type.extension}`;
      await adminStorage.bucket().file(receiptPath).save(buffer, { resumable: false, metadata: { contentType: type.mime } });
      paths.push(receiptPath);
    }
  } catch (error) { await deleteReceipts(paths); throw error; }
  return paths;
}
/** What the audit trail keeps of a journal that is changed or removed. */
function entrySnapshot(entry: Partial<JournalEntry>) {
  return {
    date: entry.date ?? null, monthIndex: entry.monthIndex ?? null, kind: entry.kind ?? null, description: entry.description ?? '',
    totalAmount: entry.totalAmount ?? 0, cashFlowSection: entry.cashFlowSection ?? null, cashFlows: entry.cashFlows ?? null, receiptPaths: entryReceiptPaths(entry),
    lines: (entry.lines || []).map((line) => ({ accountCode: line.accountCode, accountNumber: line.accountNumber ?? null, accountName: line.accountName, debit: line.debit, credit: line.credit, description: line.description ?? null })),
  };
}
function reportId(monthIndex: number) { return String(monthIndex).padStart(2, '0'); }
function validateMonth(raw: unknown) {
  const month = Number(raw);
  if (!Number.isInteger(month) || month < 1 || month > 12) throw new HttpError(400, 'Bulan tidak valid.');
  return month;
}
function reportStatus(snapshot: FirebaseFirestore.DocumentSnapshot) {
  return String(snapshot.data()?.status || 'DRAFT');
}
function reconciliationFrom(data: FirebaseFirestore.DocumentData): BankReconciliation {
  return {
    monthIndex: Number(data.monthIndex), accountId: String(data.accountId), statementBalance: Number(data.statementBalance || 0),
    items: Array.isArray(data.items) ? data.items : [], ...(data.note ? { note: String(data.note) } : {}),
    revision: Number(data.revision || 0), hasStatement: typeof data.statementPath === 'string',
  };
}
/** The previous year's book as the opening-balance and submission rules see it. */
async function previousYearState(unitId: string, academicYear: string, tx?: Transaction): Promise<PreviousYearState> {
  const previous = adjacentAcademicYear(academicYear, -1);
  const ref = yearRef(unitId, previous);
  const data = (tx ? await tx.get(ref) : await ref.get()).data();
  return {
    academicYear: previous, status: data?.status === 'CLOSED' ? 'CLOSED' : data ? 'ACTIVE' : null,
    entryCount: Number(data?.entryCount || 0), closingBalances: data?.closing?.balances ?? null,
  };
}
/** Refuses a change to a month that is sealed (its report, or a later one, is with BAK or Rektorat) or to a closed year. */
function assertMonthOpen(academicYear: string, monthIndex: number, yearStatus: unknown, reports: FirebaseFirestore.DocumentSnapshot[]) {
  if (yearStatus === 'CLOSED') throw new HttpError(409, 'Tahun buku sudah ditutup.');
  const period = fiscalMonths(academicYear).find((month) => month.monthIndex === monthIndex)!.period;
  for (let index = period - 1; index < reports.length; index++) {
    if (!isReportOpen(reportStatus(reports[index]))) throw new HttpError(409, 'Bulan ini atau bulan sesudahnya sudah dikunci dalam pelaporan.');
  }
}
const reportRefs = (year: DocumentReference, academicYear: string) => fiscalMonths(academicYear).map((month) => year.collection('reports').doc(reportId(month.monthIndex)));
/** Why an asset's figures can no longer change (see assetChangeBlocker), read inside the transaction that would change them. */
async function assetChangeBlockerInTransaction(tx: Transaction, unitId: string, assetId: string) {
  const yearDocs = await tx.get(adminDb.collection(YEAR_COLLECTION).where('satkerId', '==', unitId));
  const years = await Promise.all(yearDocs.docs.map(async (doc) => {
    const academicYear = String(doc.data().academicYear || '');
    if (!/^\d{4}-\d{4}$/.test(academicYear)) return null;
    const [entries, ...reports] = await Promise.all([
      tx.get(doc.ref.collection('entries').where('kind', '==', 'DEPRECIATION')), ...reportRefs(doc.ref, academicYear).map((ref) => tx.get(ref)),
    ]);
    return {
      academicYear, status: doc.data().status as string | undefined,
      reports: fiscalMonths(academicYear).map((month, index) => ({ monthIndex: month.monthIndex, status: reportStatus(reports[index]) })),
      depreciationEntries: entries.docs.map((entry) => entry.data() as JournalEntry),
    };
  }));
  return assetChangeBlocker(assetId, years.filter((year) => year !== null));
}
const negateFlows = (flows: CashFlowAmounts): CashFlowAmounts => ({ OPERATING: -flows.OPERATING, INVESTING: -flows.INVESTING, FINANCING: -flows.FINANCING });

async function loadYear(unitId: string, academicYear: string, includeHistory = false) {
  const ref = yearRef(unitId, academicYear);
  const [yearDoc, entryDocs, reportDocs, reconciliationDocs] = await Promise.all([
    ref.get(), ref.collection('entries').orderBy('date', 'asc').get(),
    ref.collection('reports').get(), ref.collection('bankReconciliations').get(),
  ]);
  const [auditDocs, revisionDocs] = includeHistory ? await Promise.all([
    ref.collection('audit').orderBy('at', 'desc').limit(200).get(),
    ref.collection('reportRevisions').orderBy('submittedAt', 'desc').limit(100).get(),
  ]) : [null, null];
  const entries = entryDocs.docs.map((doc) => ({ id: doc.id, ...doc.data() } as JournalEntry));
  const reports = reportDocs.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
  const events = auditDocs?.docs.map((doc) => ({ id: doc.id, ...doc.data() })) || [];
  const revisions = revisionDocs?.docs.map((doc) => ({
    id: doc.id,
    monthIndex: Number(doc.data().monthIndex),
    revision: Number(doc.data().revision),
    submittedName: String(doc.data().submittedName || ''),
    submittedAt: doc.data().submittedAt,
    snapshot: doc.data().snapshot as ReturnType<typeof buildFinancialStatements>,
  })) || [];
  const reconciliations = reconciliationDocs.docs.map((doc) => reconciliationFrom(doc.data()));
  return { ref, year: publicYear(yearDoc.data()), entries, reports, events, revisions, reconciliations };
}

function monthlyTrial(accounts: FinancialAccount[], opening: OpeningBalances, entries: JournalEntry[], academicYear: string) {
  return fiscalMonths(academicYear).map((month) => ({ ...month,
    rows: buildFinancialStatements({ accounts, opening, entries, academicYear, monthIndex: month.monthIndex }).rows
      .map((row) => ({ id: financialAccountId(row.account), code: row.account.code, debit: row.endingDebit, credit: row.endingCredit })),
  }));
}

export async function GET(request: NextRequest) {
  try {
    const actor = await requireAuthenticatedProfile(request);
    if (!canReadAll(actor) && actor.role !== 'satker_head_loyalis' && actor.role !== 'satker_finance_admin') {
      throw new HttpError(403, 'Akses pelaporan SatKer tidak tersedia.');
    }
    let units = await listUnits(actor);
    // A Kepala SatKer Loyalis on no book yet gets their own, without Super Admin listing them.
    if (!units.length && await ensureOwnUnit(actor)) units = await listUnits(actor);
    const academicYear = request.nextUrl.searchParams.get('academicYear') || academicYearFor(new Date());
    fiscalMonths(academicYear);
    const monthParam = request.nextUrl.searchParams.get('month') || 'ANNUAL';
    const monthIndex = monthParam === 'ANNUAL' ? 'ANNUAL' : validateMonth(Number(monthParam));
    const unitId = request.nextUrl.searchParams.get('unitId');
    const globalAccounts = await loadAccounts();
    let accounts = globalAccounts;
    const notifications = await adminDb.collection('users').doc(actor.uid).collection('satkerFinancialNotifications').orderBy('at', 'desc').limit(30).get();
    const base: Record<string, unknown> = { units, accounts, academicYear, monthIndex,
      notifications: notifications.docs.map((doc) => ({ id: doc.id, ...doc.data() })) };
    if (actor.role === 'super_admin') {
      const users = await adminDb.collection('users').get();
      base.editorUsers = users.docs.filter((doc) => doc.data().disabled !== true && ['satker_head_loyalis', 'satker_finance_admin'].includes(doc.data().role))
        .map((doc) => ({ uid: doc.id, displayName: doc.data().displayName || doc.data().email || doc.id, role: doc.data().role }));
      base.globalAccounts = globalAccounts;
    }
    if (!unitId) return Response.json(actor.role === 'super_admin' ? { ...base, unit: { id: '', name: 'Pengaturan awal', headName: '', adminName: '', editorUids: [], revision: 0 } } : base, { headers: noStore });
    if (unitId === 'ALL') {
      if (!canReadAll(actor)) throw new HttpError(403, 'Konsolidasi hanya untuk BAK dan Rektorat.');
      const years = await Promise.all(units.map(async (unit) => {
        const [year, unitAccounts] = await Promise.all([loadYear(unit.id, academicYear), loadAccounts(unit.id)]);
        return { ...year, unitAccounts, unit };
      }));
      const sharedAccountIds = new Set(accounts.map(financialAccountId));
      const consolidatedAccounts = [...accounts, ...years.flatMap((year) => year.unitAccounts.filter((account) => !sharedAccountIds.has(financialAccountId(account))))];
      const opening: OpeningBalances = {};
      for (const year of years) {
        for (const [code, balance] of Object.entries(year.year.openingBalances)) {
          const prior = opening[code] || { debit: 0, credit: 0 };
          opening[code] = { debit: prior.debit + balance.debit, credit: prior.credit + balance.credit };
        }
      }
      for (const [code, balance] of Object.entries(opening)) {
        const signed = balance.debit - balance.credit;
        opening[code] = { debit: Math.max(signed, 0), credit: Math.max(-signed, 0) };
      }
      const entries = years.flatMap((year) => year.entries);
      const statements = buildFinancialStatements({ accounts: consolidatedAccounts, opening, entries, academicYear, monthIndex });
      const annualStatements = monthIndex === 'ANNUAL' ? statements : buildFinancialStatements({ accounts: consolidatedAccounts, opening, entries, academicYear, monthIndex: 'ANNUAL' });
      return Response.json({ ...base, accounts: consolidatedAccounts, unit: { id: 'ALL', name: 'Konsolidasi Seluruh SatKer' }, statements, annualStatements, monthlyTrial: monthlyTrial(consolidatedAccounts, opening, entries, academicYear), year: { status: 'ACTIVE', openingBalances: opening }, entries: [], reports: [], events: [], reportRevisions: [],
        unitSummaries: years.map((year) => ({
          unit: year.unit, year: year.year,
          statements: buildFinancialStatements({ accounts: year.unitAccounts, opening: year.year.openingBalances, entries: year.entries, academicYear, monthIndex }),
          report: monthIndex === 'ANNUAL' ? null : year.reports.find((report) => report.id === reportId(monthIndex)) || null,
        })) }, { headers: noStore });
    }
    const unit = await getUnit(actor, unitId);
    accounts = await loadAccounts(unitId);
    base.accounts = accounts;
    base.accountCatalogSource = unitAccountCatalogSource(unitId);
    const [unitCatalog, state, fixedAssets, previousYear] = await Promise.all([
      unitAccountCatalogMetaRef(unitId).get(), loadYear(unitId, academicYear, true), loadFixedAssets(unitId), previousYearState(unitId, academicYear),
    ]);
    const statements = buildFinancialStatements({ accounts, opening: state.year.openingBalances, entries: state.entries, academicYear, monthIndex });
    const annualStatements = monthIndex === 'ANNUAL' ? statements : buildFinancialStatements({ accounts, opening: state.year.openingBalances, entries: state.entries, academicYear, monthIndex: 'ANNUAL' });
    return Response.json({ ...base, accountCatalogRevision: Number(unitCatalog.data()?.revision || 0), unit, year: state.year, statements, annualStatements, monthlyTrial: monthlyTrial(accounts, state.year.openingBalances, state.entries, academicYear),
      entries: state.entries.map((entry) => {
        const receiptCount = entryReceiptPaths(entry).length;
        const result = { ...entry, hasReceipt: receiptCount > 0, receiptCount };
        delete result.receiptPath;
        delete result.receiptPaths;
        delete result.requestFingerprint;
        return result;
      }),
      reports: state.reports, events: state.events, fixedAssets, reconciliations: state.reconciliations, previousYear,
      reportRevisions: state.revisions.map((revision) => ({ id: revision.id, monthIndex: revision.monthIndex, revision: revision.revision, submittedName: revision.submittedName, submittedAt: revision.submittedAt,
        income: revision.snapshot?.incomeStatement?.income ?? 0, expense: revision.snapshot?.incomeStatement?.expense ?? 0, endingCash: revision.snapshot?.cashFlow?.endingCash ?? 0 })),
    }, { headers: noStore });
  } catch (error) { return errorResponse(error); }
}

export async function POST(request: NextRequest) {
  try {
    const actor = await requireAuthenticatedProfile(request);
    const raw = await request.json() as Record<string, unknown>;
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new HttpError(400, 'Payload pelaporan tidak valid.');
    const action = string(raw.action, 'Tindakan', 50);
    if (action === 'READ_NOTIFICATION') {
      const id = string(raw.notificationId, 'ID notifikasi', 100);
      if (!/^[a-zA-Z0-9_-]{8,100}$/.test(id)) throw new HttpError(400, 'ID notifikasi tidak valid.');
      const ref = adminDb.collection('users').doc(actor.uid).collection('satkerFinancialNotifications').doc(id);
      const notification = await ref.get();
      if (!notification.exists) throw new HttpError(404, 'Notifikasi tidak ditemukan.');
      await ref.update({ readAt: admin.firestore.FieldValue.serverTimestamp() });
      return Response.json({ ok: true }, { headers: noStore });
    }
    if (action === 'SAVE_UNIT') {
      requireRole(actor, ['super_admin']);
      const id = string(raw.id, 'ID SatKer', 50).toLowerCase();
      if (!/^[a-z0-9][a-z0-9-]{1,49}$/.test(id)) throw new HttpError(400, 'ID SatKer hanya boleh berisi huruf kecil, angka, dan tanda hubung.');
      const name = string(raw.name, 'Nama SatKer');
      const headName = typeof raw.headName === 'string' ? raw.headName.trim().slice(0, 150) : '';
      const adminName = typeof raw.adminName === 'string' ? raw.adminName.trim().slice(0, 150) : '';
      if (!Array.isArray(raw.editorUids) || raw.editorUids.some((value) => typeof value !== 'string')) throw new HttpError(400, 'Daftar pengelola SatKer tidak valid.');
      const editorUids = [...new Set(raw.editorUids as string[])];
      if (editorUids.length > 20) throw new HttpError(400, 'Maksimal 20 pengelola per SatKer.');
      const editors = await Promise.all(editorUids.map((uid) => adminDb.collection('users').doc(uid).get()));
      if (editors.some((doc) => !doc.exists || doc.data()?.disabled === true || !['satker_head_loyalis', 'satker_finance_admin'].includes(String(doc.data()?.role)))) {
        throw new HttpError(400, 'Pengelola harus akun aktif Kepala SatKer Loyalis atau sekretariat keuangan.');
      }
      const ref = adminDb.collection(UNIT_COLLECTION).doc(id);
      await adminDb.runTransaction(async (tx) => {
        const current = await tx.get(ref);
        const revision = Number(current.data()?.revision || 0);
        if (current.exists && raw.expectedRevision !== revision) throw new HttpError(409, 'Data SatKer berubah. Muat ulang sebelum menyimpan.');
        const after = { name, headName, adminName, editorUids, revision: revision + 1, updatedAt: admin.firestore.FieldValue.serverTimestamp(), updatedBy: actor.uid };
        tx.set(ref, after, { merge: true });
        tx.create(adminDb.collection('SatkerFinancialConfigAudit').doc(), { action: current.exists ? 'UNIT_UPDATED' : 'UNIT_CREATED', target: id, before: current.data() || null, after, actorUid: actor.uid, actorRole: actor.role, at: admin.firestore.FieldValue.serverTimestamp() });
      });
      return Response.json({ ok: true }, { headers: noStore });
    }
    if (action === 'SAVE_UNIT_ACCOUNT') {
      const unitId = string(raw.unitId, 'SatKer', 50);
      const unit = await getUnit(actor, unitId);
      assertUnitEdit(actor, unit);
      const code = string(raw.code, 'Nomor akun', 20);
      if (!/^\d+(\.\d+)?$/.test(code)) throw new HttpError(400, 'Nomor akun harus berupa angka atau desimal.');
      const name = string(raw.name, 'Nama akun');
      const accounts = await loadAccounts(unitId);
      const requestedId = typeof raw.accountId === 'string' ? raw.accountId : '';
      const current = requestedId ? accounts.find((account) => account.localAccountId === requestedId) : undefined;
      if (requestedId && !current) throw new HttpError(404, 'Akun SatKer tidak ditemukan. Muat ulang daftar akun.');
      const localAccountId = requestedId || `custom_${unitId}_${randomBytes(12).toString('hex')}`;
      if (!/^[a-zA-Z0-9_-]{6,120}$/.test(localAccountId)) throw new HttpError(400, 'ID akun tidak valid.');
      if (accounts.some((account) => account.code === code && account.localAccountId !== localAccountId)) {
        throw new HttpError(409, 'Nomor akun sudah digunakan di SatKer ini.');
      }

      const existingRevision = Number(current?.revision || 0);
      const expectedRevision = requestedId ? raw.expectedRevision : 0;
      if (expectedRevision !== existingRevision) throw new HttpError(409, 'Akun berubah. Muat ulang sebelum menyimpan.');
      const catalogMeta = unitAccountCatalogMetaRef(unitId);
      const expectedCatalogRevision = raw.expectedCatalogRevision;
      if (typeof expectedCatalogRevision !== 'number' || !Number.isInteger(expectedCatalogRevision)) throw new HttpError(400, 'Versi katalog akun tidak valid. Muat ulang sebelum menyimpan.');

      const sourceCode = localAccountId.startsWith('base_') ? localAccountId.slice('base_'.length) : '';
      const sourceAccount = sourceCode ? accounts.find((account) => account.localAccountId === localAccountId) : undefined;
      if (sourceCode && !sourceAccount) throw new HttpError(400, 'Akun dasar tidak ditemukan.');
      const chosenCashFlowSection = CASH_FLOW_SECTIONS.includes(raw.cashFlowSection as typeof CASH_FLOW_SECTIONS[number]) ? raw.cashFlowSection as typeof CASH_FLOW_SECTIONS[number] : null;
      let accountData: Record<string, unknown>;
      if (sourceAccount) {
        const type = sourceAccount.type;
        const isCashBank = typeof raw.cashEquivalent === 'boolean'
          ? (raw.cashEquivalent && type === 'AKTIVA' && (code === '10000' || code.startsWith('11')))
          : (sourceAccount.cashEquivalent || (type === 'AKTIVA' && (code === '10000' || code.startsWith('11'))));
        const cashEquivalent = isCashBank;
        const contra = raw.contra === true && !cashEquivalent;
        const normalBalance = groupNormalBalance(type, contra);
        const reportTarget = ['TERIMA', 'KELUAR'].includes(type) ? 'INCOME_STATEMENT' : 'BALANCE_SHEET';
        const cashFlowSection = cashEquivalent ? null : (chosenCashFlowSection ?? sourceAccount.cashFlowSection ?? defaultCashFlowSection(type, code));
        accountData = { baseCode: sourceCode, code, name, normalBalance, reportTarget, cashEquivalent, cashFlowSection, postable: true };
      } else if (current) {
        // The unit's own accounts may also change their contra flag and cash-flow classification; journals keep the split they were posted with.
        accountData = { ...current, code, name,
          ...(typeof raw.contra === 'boolean' && !current.cashEquivalent ? { normalBalance: groupNormalBalance(current.type, raw.contra) } : {}),
          ...(chosenCashFlowSection && !current.cashEquivalent ? { cashFlowSection: chosenCashFlowSection } : {}) };
        delete accountData.id;
        delete accountData.localAccountId;
      } else {
        const type = raw.type as AccountType;
        if (!['AKTIVA', 'HUTANG', 'MODAL', 'TERIMA', 'KELUAR'].includes(type)) throw new HttpError(400, 'Kelompok akun tidak valid.');
        const cashEquivalent = raw.cashEquivalent === true;
        if (cashEquivalent && (type !== 'AKTIVA' || (!code.startsWith('10') && !code.startsWith('11')))) {
          throw new HttpError(400, 'Akun kas atau bank harus bertipe Aktiva dan memakai nomor 10xxx atau 11xxx.');
        }
        const contra = raw.contra === true && !cashEquivalent;
        const normalBalance = groupNormalBalance(type, contra);
        const reportTarget = type === 'TERIMA' || type === 'KELUAR' ? 'INCOME_STATEMENT' : 'BALANCE_SHEET';
        const cashFlowSection = cashEquivalent ? null : chosenCashFlowSection ?? defaultCashFlowSection(type, code);
        accountData = { code, name, type, normalBalance, reportTarget, postable: true, cashEquivalent, cashFlowSection };
      }
      const accountRef = unitAccountCollection(unitId).doc(localAccountId);
      await adminDb.runTransaction(async (tx) => {
        const [meta, before] = await Promise.all([tx.get(catalogMeta), tx.get(accountRef)]);
        const currentCatalogRevision = Number(meta.data()?.revision || 0);
        if (currentCatalogRevision !== expectedCatalogRevision) throw new HttpError(409, 'Katalog akun berubah. Muat ulang sebelum menyimpan.');
        const revision = Number(before.data()?.revision || 0);
        if (revision !== existingRevision || (!requestedId && before.exists)) throw new HttpError(409, 'Akun berubah. Muat ulang sebelum menyimpan.');
        const after = { ...accountData, revision: revision + 1, updatedAt: admin.firestore.FieldValue.serverTimestamp(), updatedBy: actor.uid };
        tx.set(accountRef, after);
        tx.set(catalogMeta, { revision: currentCatalogRevision + 1, updatedAt: admin.firestore.FieldValue.serverTimestamp() }, { merge: true });
        tx.create(adminDb.collection('SatkerFinancialConfigAudit').doc(), {
          action: requestedId ? 'UNIT_ACCOUNT_UPDATED' : 'UNIT_ACCOUNT_CREATED', target: `${unitId}:${localAccountId}`,
          before: before.data() || null, after, unitId, actorUid: actor.uid, actorRole: actor.role,
          at: admin.firestore.FieldValue.serverTimestamp(),
        });
      });
      return Response.json({ ok: true }, { headers: noStore });
    }
    if (action === 'SAVE_ACCOUNT') {
      requireRole(actor, ['super_admin']);
      const code = string(raw.code, 'Kode akun', 5);
      const original = DEFAULT_ACCOUNTS.find((account) => account.code === code);
      if (!original) throw new HttpError(400, 'Kode akun tidak ditemukan dalam katalog.');
      const name = string(raw.name, 'Nama akun');
      const normalBalance = raw.normalBalance;
      const reportTarget = raw.reportTarget;
      if (normalBalance !== 'DEBIT' && normalBalance !== 'CREDIT') throw new HttpError(400, 'Pos saldo tidak valid.');
      if (reportTarget !== 'BALANCE_SHEET' && reportTarget !== 'INCOME_STATEMENT') throw new HttpError(400, 'Pos laporan tidak valid.');
      if (original.type === 'AKTIVA' && reportTarget !== 'BALANCE_SHEET' || original.type === 'HUTANG' && reportTarget !== 'BALANCE_SHEET' || original.type === 'MODAL' && reportTarget !== 'BALANCE_SHEET' || ['TERIMA', 'KELUAR'].includes(original.type) && reportTarget !== 'INCOME_STATEMENT') throw new HttpError(400, 'Pos laporan tidak sesuai kelompok akun.');
      const cashEquivalent = raw.cashEquivalent === true;
      if (cashEquivalent && code !== '10000' && !code.startsWith('11')) throw new HttpError(400, 'Hanya kode kas 10000 atau kelompok bank 11xxx dapat menjadi kas/bank.');
      const cashFlowSection = cashEquivalent ? null : raw.cashFlowSection;
      if (!cashEquivalent && !CASH_FLOW_SECTIONS.includes(cashFlowSection as typeof CASH_FLOW_SECTIONS[number])) throw new HttpError(400, 'Klasifikasi arus kas wajib diisi.');
      const ref = adminDb.collection(ACCOUNT_COLLECTION).doc(code);
      await adminDb.runTransaction(async (tx) => {
        const [meta, before] = await Promise.all([tx.get(CATALOG_META_REF), tx.get(ref)]);
        // A used code keeps what its posted figures mean; the normal side (presentation and warnings) and the cash-flow
        // classification (applied to journals posted from now on) may still change.
        const stored = (before.data() || original) as Partial<FinancialAccount>;
        if ((meta.data()?.usedCodes || []).includes(code) && (String(stored.name || '') !== name || stored.reportTarget !== reportTarget || (stored.cashEquivalent === true) !== cashEquivalent)) {
          throw new HttpError(409, 'Kode akun sudah dipakai di saldo awal atau jurnal: nama, pos laporan, dan status kas/banknya tidak dapat diubah. Pos saldo dan klasifikasi arus kas tetap dapat diubah.');
        }
        const revision = Number(before.data()?.revision || 0);
        if (raw.expectedRevision !== revision) throw new HttpError(409, 'Akun berubah. Muat ulang sebelum menyimpan.');
        const after = { name, normalBalance, reportTarget, cashEquivalent, cashFlowSection, revision: revision + 1, updatedAt: admin.firestore.FieldValue.serverTimestamp(), updatedBy: actor.uid };
        tx.set(ref, after);
        tx.set(CATALOG_META_REF, { revision: admin.firestore.FieldValue.increment(1), updatedAt: admin.firestore.FieldValue.serverTimestamp() }, { merge: true });
        tx.create(adminDb.collection('SatkerFinancialConfigAudit').doc(), { action: 'ACCOUNT_UPDATED', target: code, before: before.data() || original, after, actorUid: actor.uid, actorRole: actor.role, at: admin.firestore.FieldValue.serverTimestamp() });
      });
      return Response.json({ ok: true }, { headers: noStore });
    }
    if (action === 'SAVE_FIXED_ASSET' || action === 'DELETE_FIXED_ASSET') {
      const unitId = string(raw.unitId, 'SatKer', 50);
      const unit = await getUnit(actor, unitId);
      assertUnitEdit(actor, unit);
      const deleting = action === 'DELETE_FIXED_ASSET';
      const requestedId = typeof raw.assetId === 'string' ? raw.assetId : '';
      if (deleting && !requestedId) throw new HttpError(400, 'ID aset wajib diisi.');
      const assetId = requestedId || `asset_${randomBytes(12).toString('hex')}`;
      if (!/^[a-zA-Z0-9_-]{8,100}$/.test(assetId)) throw new HttpError(400, 'ID aset tidak valid.');
      let asset: ReturnType<typeof validateFixedAsset> | undefined;
      if (!deleting) {
        const accounts = await loadAccounts(unitId);
        try { asset = validateFixedAsset(raw, accounts); } catch (error) { inputError(error); }
      }
      const ref = fixedAssetCollection(unitId).doc(assetId);
      await adminDb.runTransaction(async (tx) => {
        const before = await tx.get(ref);
        if (requestedId && !before.exists) throw new HttpError(404, 'Aset tidak ditemukan. Muat ulang daftar aset.');
        if (!requestedId && before.exists) throw new HttpError(409, 'ID aset sudah dipakai.');
        const revision = Number(before.data()?.revision || 0);
        if (raw.expectedRevision !== revision) throw new HttpError(409, 'Aset berubah. Muat ulang sebelum menyimpan.');
        // Deleting, or changing any figure, would rewrite depreciation that may already be in a sealed report.
        if (before.exists && (deleting || assetFiguresChanged(fixedAssetFrom(assetId, before.data()!), asset!))) {
          const blocker = await assetChangeBlockerInTransaction(tx, unitId, assetId);
          if (blocker) throw new HttpError(409, blocker);
        }
        const now = admin.firestore.FieldValue.serverTimestamp();
        const after = deleting ? null : { ...asset!, revision: revision + 1, updatedAt: now, updatedBy: actor.uid };
        if (deleting) tx.delete(ref);
        else tx.set(ref, after!);
        tx.create(adminDb.collection('SatkerFinancialConfigAudit').doc(), {
          action: deleting ? 'FIXED_ASSET_DELETED' : before.exists ? 'FIXED_ASSET_UPDATED' : 'FIXED_ASSET_CREATED', target: `${unitId}:${assetId}`,
          before: before.data() || null, after, unitId, actorUid: actor.uid, actorRole: actor.role, at: now,
        });
      });
      return Response.json({ ok: true, assetId }, { headers: noStore });
    }
    const unitId = string(raw.unitId, 'SatKer', 50);
    const academicYear = string(raw.academicYear, 'Tahun akademik', 9);
    fiscalMonths(academicYear);
    const unit = await getUnit(actor, unitId);
    const year = yearRef(unitId, academicYear);
    if (action === 'SAVE_OPENING') {
      requireRole(actor, ['super_admin']);
      const [accounts, catalogMeta, unitCatalogMeta] = await Promise.all([loadAccounts(unitId), CATALOG_META_REF.get(), unitAccountCatalogMetaRef(unitId).get()]);
      const opening = openingFrom(raw.openingBalances);
      try { validateOpeningBalances(opening, accounts); } catch (error) { inputError(error); }
      await adminDb.runTransaction(async (tx) => {
        const [current, meta, unitMeta, previous] = await Promise.all([
          tx.get(year), tx.get(CATALOG_META_REF), tx.get(unitAccountCatalogMetaRef(unitId)), previousYearState(unitId, academicYear, tx),
        ]);
        if (Number(meta.data()?.revision || 0) !== Number(catalogMeta.data()?.revision || 0)) throw new HttpError(409, 'Katalog akun berubah. Muat ulang sebelum menyimpan saldo awal.');
        if (Number(unitMeta.data()?.revision || 0) !== Number(unitCatalogMeta.data()?.revision || 0)) throw new HttpError(409, 'Daftar akun SatKer berubah. Muat ulang sebelum menyimpan saldo awal.');
        const data = current.data();
        // Only a book's first year in the app is typed in; after that the opening comes from the previous year's closing.
        if (data?.openingSource === 'CARRIED_FORWARD' || openingComesFromPreviousYear(previous)) {
          throw new HttpError(409, `Saldo awal tahun ${academicYear} dibawa otomatis dari penutupan tahun buku ${previous.academicYear}, tidak diketik ulang.`);
        }
        if (Number(data?.entryCount || 0) > 0 || data?.status === 'CLOSED') throw new HttpError(409, 'Saldo awal terkunci setelah jurnal pertama diposting.');
        if (Number(data?.revision || 0) !== raw.expectedRevision) throw new HttpError(409, 'Tahun buku berubah. Muat ulang sebelum menyimpan.');
        const reportDocs = await Promise.all(fiscalMonths(academicYear).map((month) => tx.get(year.collection('reports').doc(reportId(month.monthIndex)))));
        if (reportDocs.some((report) => report.exists)) throw new HttpError(409, 'Saldo awal terkunci setelah laporan pertama dibuat.');
        tx.set(year, { satkerId: unitId, academicYear, startDate: `${academicYear.slice(0, 4)}-09-01`, endDate: `${academicYear.slice(5)}-08-31`, status: 'ACTIVE', openingBalances: opening, revision: Number(data?.revision || 0) + 1, entryCount: 0, updatedAt: admin.firestore.FieldValue.serverTimestamp() }, { merge: true });
        const openingCodes = Object.entries(opening).filter(([, balance]) => balance.debit || balance.credit).map(([code]) => code);
        if (openingCodes.length) tx.set(CATALOG_META_REF, { usedCodes: admin.firestore.FieldValue.arrayUnion(...openingCodes) }, { merge: true });
        audit(tx, year, actor, 'OPENING_BALANCE_UPDATED', { before: data?.openingBalances || {}, after: opening });
      });
      return Response.json({ ok: true }, { headers: noStore });
    }
    if (action === 'POST_ENTRY' || action === 'REVERSE_ENTRY') {
      assertUnitEdit(actor, unit);
      const [accounts, catalogMeta, unitCatalogMeta] = await Promise.all([loadAccounts(unitId), CATALOG_META_REF.get(), unitAccountCatalogMetaRef(unitId).get()]);
      const monthIndex = validateMonth(raw.monthIndex);
      const date = string(raw.date, 'Tanggal', 10);
      try { validateEntryDate(date, academicYear, monthIndex); } catch (error) { inputError(error); }
      const entryId = action === 'REVERSE_ENTRY' ? `reverse_${string(raw.sourceEntryId, 'Jurnal asal', 80)}` : string(raw.entryId, 'ID voucher', 100);
      if (!/^[a-zA-Z0-9_-]{8,100}$/.test(entryId)) throw new HttpError(400, 'ID voucher tidak valid.');
      // These prefixes name the journals the server makes itself (reversals, monthly depreciation).
      if (action === 'POST_ENTRY' && /^(reverse_|depreciation-)/.test(entryId)) throw new HttpError(400, 'ID voucher tidak valid.');
      const entryRef = year.collection('entries').doc(entryId);
      let voucher: ReturnType<typeof buildVoucher>;
      let reversesEntryId: string | undefined;
      if (action === 'REVERSE_ENTRY') {
        const original = await year.collection('entries').doc(String(raw.sourceEntryId)).get();
        if (!original.exists) throw new HttpError(404, 'Jurnal asal tidak ditemukan.');
        const old = original.data() as JournalEntry;
        if (old.kind === 'REVERSAL') throw new HttpError(409, 'Jurnal pembalik tidak dapat dibalik lagi.');
        if (date < old.date) throw new HttpError(400, 'Tanggal pembalikan tidak boleh mendahului jurnal asal.');
        const reason = string(raw.description, 'Alasan pembalikan', 500);
        // The reversal undoes the original's cash flows exactly, whatever the catalog says today.
        voucher = { kind: 'REVERSAL', date, description: `Pembalikan ${original.id}: ${reason}`, totalAmount: old.totalAmount,
          lines: old.lines.map((line) => ({ ...line, debit: line.credit, credit: line.debit })), cashFlowSection: old.cashFlowSection,
          cashFlows: negateFlows(entryCashFlows(old, new Map(accounts.map((account) => [financialAccountId(account), account])))) };
        reversesEntryId = original.id;
      } else {
        try { voucher = buildVoucher(raw, accounts); } catch (error) { inputError(error); }
      }
      const receiptDataUrls = action === 'POST_ENTRY' ? receiptInputs(raw) : [];
      const requestFingerprint = createHash('sha256').update(JSON.stringify({ voucher, reversesEntryId: reversesEntryId || null, receiptDataUrls: receiptDataUrls.length ? receiptDataUrls : null })).digest('hex');
      const existing = await entryRef.get();
      if (existing.exists) {
        if (existing.data()?.createdBy === actor.uid && existing.data()?.requestFingerprint === requestFingerprint) {
          return Response.json({ ok: true, entryId, duplicate: true }, { headers: noStore });
        }
        throw new HttpError(409, 'ID voucher sudah dipakai untuk transaksi lain.');
      }
      const receiptPaths = await storeReceipts(receiptDataUrls, unitId, academicYear, entryId, MAX_ENTRY_RECEIPT_BYTES);
      const entry: JournalEntry = { ...voucher, id: entryId, satkerId: unitId, academicYear, monthIndex, isBalanced: true,
        createdBy: actor.uid, requestFingerprint, ...(receiptPaths.length ? { receiptPaths } : {}), ...(reversesEntryId ? { reversesEntryId } : {}) };
      try {
        await adminDb.runTransaction(async (tx) => {
          const [yearDoc, entryDoc, meta, unitMeta, ...reports] = await Promise.all([
            tx.get(year), tx.get(entryRef), tx.get(CATALOG_META_REF), tx.get(unitAccountCatalogMetaRef(unitId)), ...fiscalMonths(academicYear).map((month) => tx.get(year.collection('reports').doc(reportId(month.monthIndex)))),
          ]);
          if (Number(meta.data()?.revision || 0) !== Number(catalogMeta.data()?.revision || 0)) throw new HttpError(409, 'Katalog akun berubah. Muat ulang dan posting kembali.');
          if (Number(unitMeta.data()?.revision || 0) !== Number(unitCatalogMeta.data()?.revision || 0)) throw new HttpError(409, 'Daftar akun SatKer berubah. Muat ulang dan posting kembali.');
          if (entryDoc.exists) throw new HttpError(409, 'Voucher ini sudah diposting.');
          if (yearDoc.data()?.status === 'CLOSED') throw new HttpError(409, 'Tahun buku sudah ditutup.');
          const fiscalPeriod = fiscalMonths(academicYear).find((month) => month.monthIndex === monthIndex)!.period;
          for (let index = fiscalPeriod - 1; index < reports.length; index++) {
            const status = reportStatus(reports[index]);
            if (!['DRAFT', 'REVISION_REQUESTED'].includes(status)) throw new HttpError(409, 'Bulan ini atau bulan sesudahnya sudah dikunci dalam pelaporan.');
          }
          tx.create(entryRef, { ...entry, createdAt: admin.firestore.FieldValue.serverTimestamp() });
          tx.set(year, { satkerId: unitId, academicYear, startDate: `${academicYear.slice(0, 4)}-09-01`, endDate: `${academicYear.slice(5)}-08-31`, status: 'ACTIVE', revision: admin.firestore.FieldValue.increment(1), entryCount: admin.firestore.FieldValue.increment(1), updatedAt: admin.firestore.FieldValue.serverTimestamp() }, { merge: true });
          tx.set(CATALOG_META_REF, { usedCodes: admin.firestore.FieldValue.arrayUnion(...entry.lines.map((line) => line.accountCode)) }, { merge: true });
          audit(tx, year, actor, action === 'REVERSE_ENTRY' ? 'ENTRY_REVERSED' : 'ENTRY_POSTED', { entryId, date, lines: entry.lines, description: entry.description, reversesEntryId: reversesEntryId || null });
        });
      } catch (error) {
        await deleteReceipts(receiptPaths);
        throw error;
      }
      return Response.json({ ok: true, entryId }, { headers: noStore });
    }
    if (action === 'UPDATE_ENTRY' || action === 'DELETE_ENTRY') {
      // Allowed only while the journal's month and every later month are still open (see entryEditing.ts);
      // a sealed month is corrected by a reversing journal instead. Every change is kept in the audit trail
      // with the journal as it was, and receipt photos are never deleted from Storage.
      assertUnitEdit(actor, unit);
      const deleting = action === 'DELETE_ENTRY';
      const entryId = string(raw.entryId, 'ID jurnal', 100);
      if (!/^[a-zA-Z0-9_-]{8,100}$/.test(entryId)) throw new HttpError(400, 'ID jurnal tidak valid.');
      const expectedRevision = raw.expectedRevision;
      if (typeof expectedRevision !== 'number' || !Number.isInteger(expectedRevision) || expectedRevision < 0) {
        throw new HttpError(400, 'Versi jurnal tidak valid. Muat ulang sebelum menyimpan.');
      }
      const reason = deleting ? string(raw.reason, 'Alasan penghapusan', 500) : '';
      const [accounts, catalogMeta, unitCatalogMeta] = await Promise.all([loadAccounts(unitId), CATALOG_META_REF.get(), unitAccountCatalogMetaRef(unitId).get()]);
      let monthIndex = 0;
      let voucher: ReturnType<typeof buildVoucher> | undefined;
      if (!deleting) {
        monthIndex = validateMonth(raw.monthIndex);
        const date = string(raw.date, 'Tanggal', 10);
        try { validateEntryDate(date, academicYear, monthIndex); } catch (error) { inputError(error); }
        // An edited journal is saved in the advanced form whatever form it was first posted in.
        try { voucher = buildVoucher({ ...raw, kind: 'ADVANCED', date }, accounts); } catch (error) { inputError(error); }
      }
      // New receipts are added to the ones the journal already has.
      const newReceiptPaths = deleting ? [] : await storeReceipts(receiptInputs(raw), unitId, academicYear, entryId, MAX_ENTRY_RECEIPT_BYTES);
      const entryRef = year.collection('entries').doc(entryId);
      const months = fiscalMonths(academicYear);
      try {
        await adminDb.runTransaction(async (tx) => {
          const [yearDoc, entryDoc, reversal, meta, unitMeta, ...reports] = await Promise.all([
            tx.get(year), tx.get(entryRef), tx.get(year.collection('entries').where('reversesEntryId', '==', entryId).limit(1)),
            tx.get(CATALOG_META_REF), tx.get(unitAccountCatalogMetaRef(unitId)),
            ...months.map((month) => tx.get(year.collection('reports').doc(reportId(month.monthIndex)))),
          ]);
          if (!entryDoc.exists) throw new HttpError(404, 'Jurnal tidak ditemukan. Muat ulang daftar jurnal.');
          const current = entryDoc.data() as JournalEntry & { revision?: number };
          if (Number(current.revision || 0) !== expectedRevision) throw new HttpError(409, 'Jurnal berubah. Muat ulang sebelum menyimpan.');
          if (!deleting) {
            if (Number(meta.data()?.revision || 0) !== Number(catalogMeta.data()?.revision || 0)) throw new HttpError(409, 'Katalog akun berubah. Muat ulang dan simpan kembali.');
            if (Number(unitMeta.data()?.revision || 0) !== Number(unitCatalogMeta.data()?.revision || 0)) throw new HttpError(409, 'Daftar akun SatKer berubah. Muat ulang dan simpan kembali.');
          }
          const blocker = entryChangeBlocker({
            change: deleting ? 'delete' : 'edit', entry: current, reversed: !reversal.empty, academicYear, yearStatus: yearDoc.data()?.status,
            reports: months.map((month, index) => ({ monthIndex: month.monthIndex, status: reportStatus(reports[index]) })),
            ...(deleting ? {} : { newMonthIndex: monthIndex }),
          });
          if (blocker) throw new HttpError(409, blocker);
          const receiptPaths = [...entryReceiptPaths(current), ...newReceiptPaths];
          if (receiptPaths.length > MAX_ENTRY_RECEIPTS) throw new HttpError(409, `Satu jurnal maksimal memiliki ${MAX_ENTRY_RECEIPTS} bukti.`);
          const now = admin.firestore.FieldValue.serverTimestamp();
          if (deleting) {
            tx.delete(entryRef);
            tx.set(year, { revision: admin.firestore.FieldValue.increment(1), entryCount: Math.max(0, Number(yearDoc.data()?.entryCount || 0) - 1), updatedAt: now }, { merge: true });
            audit(tx, year, actor, 'ENTRY_DELETED', { entryId, reason, entry: entrySnapshot(current) });
            return;
          }
          const next = voucher!;
          tx.update(entryRef, {
            kind: next.kind, date: next.date, monthIndex, description: next.description, lines: next.lines, totalAmount: next.totalAmount,
            cashFlowSection: next.cashFlowSection, cashFlows: next.cashFlows, isBalanced: true, ...(newReceiptPaths.length ? { receiptPaths, receiptPath: admin.firestore.FieldValue.delete() } : {}),
            revision: Number(current.revision || 0) + 1, updatedBy: actor.uid, updatedAt: now,
          });
          tx.set(year, { revision: admin.firestore.FieldValue.increment(1), updatedAt: now }, { merge: true });
          tx.set(CATALOG_META_REF, { usedCodes: admin.firestore.FieldValue.arrayUnion(...next.lines.map((line) => line.accountCode)) }, { merge: true });
          audit(tx, year, actor, 'ENTRY_UPDATED', {
            entryId, before: entrySnapshot(current),
            after: entrySnapshot({ ...next, monthIndex, receiptPaths }),
          });
        });
      } catch (error) {
        await deleteReceipts(newReceiptPaths);
        throw error;
      }
      return Response.json({ ok: true, entryId }, { headers: noStore });
    }
    if (action === 'POST_DEPRECIATION') {
      // Writes (or rewrites, or removes) the month's one depreciation journal so it matches the fixed-asset register.
      assertUnitEdit(actor, unit);
      const monthIndex = validateMonth(raw.monthIndex);
      const [accounts, catalogMeta, unitCatalogMeta] = await Promise.all([loadAccounts(unitId), CATALOG_META_REF.get(), unitAccountCatalogMetaRef(unitId).get()]);
      const entryId = depreciationEntryId(monthIndex);
      const entryRef = year.collection('entries').doc(entryId);
      const assetKey = (assets: { assetId: string; name: string; amount: number }[] | undefined) => (assets || []).map((item) => `${item.assetId}|${item.name}|${item.amount}`).join(';');
      const outcome = await adminDb.runTransaction(async (tx) => {
        const [yearDoc, entryDoc, reversal, meta, unitMeta, assetDocs, ...reports] = await Promise.all([
          tx.get(year), tx.get(entryRef), tx.get(year.collection('entries').where('reversesEntryId', '==', entryId).limit(1)),
          tx.get(CATALOG_META_REF), tx.get(unitAccountCatalogMetaRef(unitId)), tx.get(fixedAssetCollection(unitId)),
          ...reportRefs(year, academicYear).map((ref) => tx.get(ref)),
        ]);
        if (Number(meta.data()?.revision || 0) !== Number(catalogMeta.data()?.revision || 0)) throw new HttpError(409, 'Katalog akun berubah. Muat ulang dan posting kembali.');
        if (Number(unitMeta.data()?.revision || 0) !== Number(unitCatalogMeta.data()?.revision || 0)) throw new HttpError(409, 'Daftar akun SatKer berubah. Muat ulang dan posting kembali.');
        assertMonthOpen(academicYear, monthIndex, yearDoc.data()?.status, reports);
        const current = entryDoc.exists ? entryDoc.data() as JournalEntry & { revision?: number } : undefined;
        if (current && current.kind !== 'DEPRECIATION') throw new HttpError(409, 'Nomor jurnal penyusutan bulan ini sudah dipakai jurnal lain.');
        if (current && !reversal.empty) throw new HttpError(409, 'Jurnal penyusutan bulan ini sudah dibalik. Hapus jurnal pembaliknya lebih dahulu.');
        let journal: ReturnType<typeof buildDepreciationJournal>;
        try {
          journal = buildDepreciationJournal(assetDocs.docs.map((doc) => fixedAssetFrom(doc.id, doc.data())), accounts, academicYear, monthIndex);
        } catch (error) { inputError(error); }
        const now = admin.firestore.FieldValue.serverTimestamp();
        if (!journal) {
          if (!current) throw new HttpError(400, 'Tidak ada aset tetap yang disusutkan bulan ini.');
          tx.delete(entryRef);
          tx.set(year, { revision: admin.firestore.FieldValue.increment(1), entryCount: Math.max(0, Number(yearDoc.data()?.entryCount || 0) - 1), updatedAt: now }, { merge: true });
          audit(tx, year, actor, 'DEPRECIATION_REMOVED', { monthIndex, entry: entrySnapshot(current) });
          return 'removed';
        }
        if (current && sameJournalLines(current.lines, journal.lines) && assetKey(current.depreciation?.assets) === assetKey(journal.assets)) return 'unchanged';
        const fields = {
          kind: 'DEPRECIATION', date: lastDateOfMonth(academicYear, monthIndex), monthIndex,
          description: `Penyusutan aset tetap ${monthName(monthIndex)} ${calendarYearOf(academicYear, monthIndex)}`,
          lines: journal.lines, totalAmount: journal.total, isBalanced: true, cashFlowSection: null, cashFlows: emptyCashFlows(),
          depreciation: { assets: journal.assets },
        };
        if (current) tx.update(entryRef, { ...fields, revision: Number(current.revision || 0) + 1, updatedBy: actor.uid, updatedAt: now });
        else tx.create(entryRef, { ...fields, id: entryId, satkerId: unitId, academicYear, createdBy: actor.uid, createdAt: now });
        tx.set(year, { satkerId: unitId, academicYear, startDate: `${academicYear.slice(0, 4)}-09-01`, endDate: `${academicYear.slice(5)}-08-31`, status: 'ACTIVE',
          revision: admin.firestore.FieldValue.increment(1), ...(current ? {} : { entryCount: admin.firestore.FieldValue.increment(1) }), updatedAt: now }, { merge: true });
        tx.set(CATALOG_META_REF, { usedCodes: admin.firestore.FieldValue.arrayUnion(...journal.lines.map((line) => line.accountCode)) }, { merge: true });
        audit(tx, year, actor, 'DEPRECIATION_POSTED', { monthIndex, total: journal.total, assets: journal.assets, lines: journal.lines, before: current ? entrySnapshot(current) : null });
        return current ? 'updated' : 'created';
      });
      return Response.json({ ok: true, outcome }, { headers: noStore });
    }
    if (action === 'SAVE_BANK_RECONCILIATION') {
      assertUnitEdit(actor, unit);
      const monthIndex = validateMonth(raw.monthIndex);
      const accounts = await loadAccounts(unitId);
      const accountKey = string(raw.accountId, 'Akun kas/bank', 120);
      const account = accounts.find((item) => financialAccountId(item) === accountKey && item.postable && item.cashEquivalent);
      if (!account) throw new HttpError(400, 'Akun kas/bank tidak ditemukan.');
      let input: ReturnType<typeof validateReconciliationInput>;
      try { input = validateReconciliationInput(raw); } catch (error) { inputError(error); }
      const docId = reconciliationDocId(monthIndex, accountKey);
      if (!/^[a-zA-Z0-9_-]{4,150}$/.test(docId)) throw new HttpError(400, 'Akun kas/bank tidak valid.');
      const statementPath = raw.statementDataUrl ? (await storeReceipts([raw.statementDataUrl], unitId, academicYear, `rekonsiliasi-${docId}`))[0] : undefined;
      const ref = year.collection('bankReconciliations').doc(docId);
      try {
        await adminDb.runTransaction(async (tx) => {
          const [yearDoc, before, ...reports] = await Promise.all([tx.get(year), tx.get(ref), ...reportRefs(year, academicYear).map((report) => tx.get(report))]);
          assertMonthOpen(academicYear, monthIndex, yearDoc.data()?.status, reports);
          const revision = Number(before.data()?.revision || 0);
          if (raw.expectedRevision !== revision) throw new HttpError(409, 'Rekonsiliasi berubah. Muat ulang sebelum menyimpan.');
          const now = admin.firestore.FieldValue.serverTimestamp();
          tx.set(ref, {
            monthIndex, accountId: accountKey, accountCode: account.code, accountName: account.name, statementBalance: input.statementBalance, items: input.items,
            note: input.note ?? null, statementPath: statementPath ?? before.data()?.statementPath ?? null, revision: revision + 1, updatedBy: actor.uid, updatedAt: now,
          });
          // Moves the year's revision, so a report computed meanwhile is refused.
          tx.set(year, { satkerId: unitId, academicYear, revision: admin.firestore.FieldValue.increment(1), updatedAt: now }, { merge: true });
          audit(tx, year, actor, 'BANK_RECONCILIATION_SAVED', {
            monthIndex, accountId: accountKey, accountCode: account.code, statementBalance: input.statementBalance, items: input.items,
            before: before.exists ? { statementBalance: before.data()!.statementBalance, items: before.data()!.items } : null,
          });
        });
      } catch (error) {
        if (statementPath) await adminStorage.bucket().file(statementPath).delete({ ignoreNotFound: true }).catch((cleanupError) => console.error('Statement cleanup failed', cleanupError));
        throw error;
      }
      return Response.json({ ok: true }, { headers: noStore });
    }
    if (action === 'SUBMIT_REPORT') {
      assertUnitEdit(actor, unit);
      const bakUids = await usersWithRole('super_admin');
      const monthIndex = validateMonth(raw.monthIndex);
      const [accounts, unitCatalogMeta] = await Promise.all([loadAccounts(unitId), unitAccountCatalogMetaRef(unitId).get()]);
      const state = await loadYear(unitId, academicYear);
      if (state.year.status === 'CLOSED') throw new HttpError(409, 'Tahun buku sudah ditutup.');
      const statements = buildFinancialStatements({ accounts, opening: state.year.openingBalances, entries: state.entries, academicYear, monthIndex });
      const months = fiscalMonths(academicYear);
      const period = months.find((month) => month.monthIndex === monthIndex)!.period;
      const ref = year.collection('reports').doc(reportId(monthIndex));
      await adminDb.runTransaction(async (tx) => {
        const [currentYear, currentReport, ...allReports] = await Promise.all([
          tx.get(year), tx.get(ref), ...months.map((month) => tx.get(year.collection('reports').doc(reportId(month.monthIndex)))),
        ]);
        const [currentUnitCatalog, assetDocs, previousYear] = await Promise.all([
          tx.get(unitAccountCatalogMetaRef(unitId)), tx.get(fixedAssetCollection(unitId)), previousYearState(unitId, academicYear, tx),
        ]);
        if (Number(currentUnitCatalog.data()?.revision || 0) !== Number(unitCatalogMeta.data()?.revision || 0)) throw new HttpError(409, 'Daftar akun SatKer berubah saat laporan dihitung. Muat ulang lalu kirim kembali.');
        // The same checklist the page shows; reconciliations and journals are covered by the year revision below.
        const failed = monthChecks({
          academicYear, monthIndex, accounts, statements, entries: state.entries, openingBalances: state.year.openingBalances, previousYear,
          assets: assetDocs.docs.map((doc) => fixedAssetFrom(doc.id, doc.data())), reconciliations: state.reconciliations,
        }).filter((check) => !check.ok);
        if (failed.length) throw new HttpError(409, `Laporan belum dapat dikirim. ${failed.map((check) => `${check.label}: ${check.detail}`).join(' ')}`);
        if (Number(currentYear.data()?.revision || 0) !== state.year.revision) throw new HttpError(409, 'Jurnal berubah saat laporan dihitung. Muat ulang lalu kirim kembali.');
        if (currentYear.data()?.status === 'CLOSED') throw new HttpError(409, 'Tahun buku sudah ditutup.');
        if (period > 1 && reportStatus(allReports[period - 2]) !== 'APPROVED') throw new HttpError(409, 'Laporan bulan sebelumnya harus disahkan Rektorat lebih dahulu.');
        if (!['DRAFT', 'REVISION_REQUESTED'].includes(reportStatus(currentReport))) throw new HttpError(409, 'Laporan bulan ini sudah dikirim.');
        if (allReports.slice(period).some((item) => !['DRAFT', 'REVISION_REQUESTED'].includes(reportStatus(item)))) throw new HttpError(409, 'Laporan bulan berikutnya sudah dikirim.');
        const revision = Number(currentReport.data()?.revision || 0) + 1;
        tx.set(ref, { satkerId: unitId, unitName: unit.name, academicYear, monthIndex, status: 'SUBMITTED', revision,
          totalIncome: statements.incomeStatement.income, totalExpense: statements.incomeStatement.expense,
          netSurplusDeficit: statements.incomeStatement.surplus, endingCashBalance: statements.cashFlow.endingCash,
          snapshot: statements, sourceRevision: state.year.revision,
          submittedBy: actor.uid, submittedName: actor.displayName || actor.email || actor.uid, submittedAt: admin.firestore.FieldValue.serverTimestamp(),
          bakApprovedBy: null, bakApprovedAt: null, rectorApprovedBy: null, rectorApprovedAt: null,
          revisionNotes: null, verificationCode: null,
        }, { merge: true });
        tx.create(year.collection('reportRevisions').doc(`${reportId(monthIndex)}_${revision}`), {
          satkerId: unitId, unitName: unit.name, academicYear, monthIndex, revision, sourceRevision: state.year.revision,
          snapshot: statements, submittedBy: actor.uid, submittedName: actor.displayName || actor.email || actor.uid,
          submittedAt: admin.firestore.FieldValue.serverTimestamp(),
        });
        tx.set(year, { revision: admin.firestore.FieldValue.increment(1), updatedAt: admin.firestore.FieldValue.serverTimestamp() }, { merge: true });
        audit(tx, year, actor, 'REPORT_SUBMITTED', { monthIndex, reportRevision: revision, sourceRevision: state.year.revision });
        notify(tx, bakUids, { unitId, academicYear, monthIndex, title: 'Laporan SatKer menunggu pemeriksaan BAK', message: `${unit.name} mengirim laporan ${monthName(monthIndex)} ${academicYear}.` });
      });
      return Response.json({ ok: true }, { headers: noStore });
    }
    if (action === 'BAK_APPROVE' || action === 'BAK_REVISE' || action === 'RECTOR_APPROVE' || action === 'RECTOR_REVISE') {
      if (action.startsWith('BAK_')) requireRole(actor, ['super_admin']);
      else requireRole(actor, ['rector_finance']);
      const monthIndex = validateMonth(raw.monthIndex);
      const note = action.endsWith('REVISE') ? string(raw.note, 'Catatan revisi', 1000) : typeof raw.note === 'string' ? raw.note.trim().slice(0, 1000) : '';
      const recipients = action === 'BAK_APPROVE' ? await usersWithRole('rector_finance') : action === 'RECTOR_APPROVE' ? unit.editorUids : [...unit.editorUids, ...(action === 'RECTOR_REVISE' ? await usersWithRole('super_admin') : [])];
      const ref = year.collection('reports').doc(reportId(monthIndex));
      await adminDb.runTransaction(async (tx) => {
        const [yearDoc, report] = await Promise.all([tx.get(year), tx.get(ref)]);
        const expected = action.startsWith('BAK_') ? 'SUBMITTED' : 'BAK_APPROVED';
        if (reportStatus(report) !== expected) throw new HttpError(409, 'Status laporan telah berubah atau belum siap diputuskan.');
        if (report.data()?.revision !== raw.expectedRevision) throw new HttpError(409, 'Laporan berubah. Muat ulang sebelum memutuskan.');
        if (yearDoc.data()?.status === 'CLOSED') throw new HttpError(409, 'Tahun buku sudah ditutup.');
        const next = action.endsWith('REVISE') ? 'REVISION_REQUESTED' : action === 'BAK_APPROVE' ? 'BAK_APPROVED' : 'APPROVED';
        const update: Record<string, unknown> = { status: next, revision: admin.firestore.FieldValue.increment(1), updatedAt: admin.firestore.FieldValue.serverTimestamp() };
        if (action === 'BAK_APPROVE') { update.bakApprovedBy = actor.uid; update.bakApprovedName = actor.displayName || actor.email || actor.uid; update.bakApprovedAt = admin.firestore.FieldValue.serverTimestamp(); }
        if (action === 'RECTOR_APPROVE') { update.rectorApprovedBy = actor.uid; update.rectorApprovedName = actor.displayName || actor.email || actor.uid; update.rectorApprovedAt = admin.firestore.FieldValue.serverTimestamp(); update.verificationCode = randomBytes(18).toString('hex'); }
        if (action.endsWith('REVISE')) { update.revisionNotes = note; update.bakApprovedBy = null; update.bakApprovedAt = null; update.rectorApprovedBy = null; update.rectorApprovedAt = null; }
        tx.update(ref, update);
        tx.set(year, { revision: admin.firestore.FieldValue.increment(1), updatedAt: admin.firestore.FieldValue.serverTimestamp() }, { merge: true });
        audit(tx, year, actor, action, { monthIndex, note, fromRevision: report.data()?.revision, toStatus: next });
        notify(tx, recipients, { unitId, academicYear, monthIndex,
          title: action === 'BAK_APPROVE' ? 'Laporan SatKer menunggu pengesahan Rektorat' : action === 'RECTOR_APPROVE' ? 'Laporan SatKer telah disahkan' : 'Revisi laporan SatKer diminta',
          message: action.endsWith('REVISE') ? `${unit.name}: ${note}` : `${unit.name} · ${monthName(monthIndex)} ${academicYear}`,
        });
      });
      return Response.json({ ok: true }, { headers: noStore });
    }
    if (action === 'CLOSE_YEAR') {
      requireRole(actor, ['super_admin']);
      const reports = await Promise.all(fiscalMonths(academicYear).map((month) => year.collection('reports').doc(reportId(month.monthIndex)).get()));
      if (reports.some((report) => reportStatus(report) !== 'APPROVED')) throw new HttpError(409, 'Semua 12 laporan bulan harus disahkan sebelum tahun buku ditutup.');
      const [accounts, unitCatalogMeta] = await Promise.all([loadAccounts(unitId), unitAccountCatalogMetaRef(unitId).get()]);
      const state = await loadYear(unitId, academicYear);
      const statements = buildFinancialStatements({ accounts, opening: state.year.openingBalances, entries: state.entries, academicYear, monthIndex: 'ANNUAL' });
      if (statements.trialBalance.difference !== 0 || statements.cashFlow.reconciliationDelta !== 0) throw new HttpError(409, 'Neraca tahunan atau kas belum rekonsiliasi.');
      // The closing journal moves the year's surplus into Modal; the balances left become next year's opening.
      const equityAccountId = typeof raw.equityAccountId === 'string' && raw.equityAccountId ? raw.equityAccountId : defaultSurplusAccountId(accounts);
      let closing: ReturnType<typeof buildYearClosing>;
      try { closing = buildYearClosing({ accounts, opening: state.year.openingBalances, entries: state.entries, academicYear, equityAccountId }); } catch (error) { inputError(error); }
      const equity = accounts.find((account) => financialAccountId(account) === equityAccountId)!;
      const nextYear = adjacentAcademicYear(academicYear, 1);
      const nextRef = yearRef(unitId, nextYear);
      await adminDb.runTransaction(async (tx) => {
        const [current, currentUnitCatalog, next, ...nextReports] = await Promise.all([
          tx.get(year), tx.get(unitAccountCatalogMetaRef(unitId)), tx.get(nextRef), ...reportRefs(nextRef, nextYear).map((ref) => tx.get(ref)),
        ]);
        if (current.data()?.status === 'CLOSED') throw new HttpError(409, 'Tahun buku sudah ditutup.');
        if (Number(currentUnitCatalog.data()?.revision || 0) !== Number(unitCatalogMeta.data()?.revision || 0)) throw new HttpError(409, 'Daftar akun SatKer berubah saat penutupan dihitung. Muat ulang lalu ulangi.');
        if (Number(current.data()?.revision || 0) !== state.year.revision) throw new HttpError(409, 'Tahun buku berubah. Muat ulang sebelum menutup.');
        const nextOpening = openingFrom(next.data()?.openingBalances);
        if (nextReports.some((report) => !isReportOpen(reportStatus(report))) && !sameBalances(nextOpening, closing.balances)) {
          throw new HttpError(409, `Laporan tahun ${nextYear} sudah dikirim dengan saldo awal yang berbeda dari hasil penutupan ini.`);
        }
        const now = admin.firestore.FieldValue.serverTimestamp();
        tx.update(year, {
          status: 'CLOSED', annualSnapshot: statements, closedBy: actor.uid, closedAt: now, revision: admin.firestore.FieldValue.increment(1),
          closing: { ...closing, equityAccountCode: equity.code, equityAccountName: equity.name },
        });
        const carried = { openingBalances: closing.balances, openingSource: 'CARRIED_FORWARD', openingCarriedFrom: academicYear, revision: admin.firestore.FieldValue.increment(1), updatedAt: now };
        // update() replaces the whole opening map; a merging set() would keep accounts the closing no longer has.
        if (next.exists) tx.update(nextRef, carried);
        else tx.set(nextRef, { satkerId: unitId, academicYear: nextYear, startDate: `${nextYear.slice(0, 4)}-09-01`, endDate: `${nextYear.slice(5)}-08-31`, status: 'ACTIVE', entryCount: 0, ...carried });
        const usedIds = Object.keys(closing.balances);
        if (usedIds.length) tx.set(CATALOG_META_REF, { usedCodes: admin.firestore.FieldValue.arrayUnion(...usedIds) }, { merge: true });
        audit(tx, year, actor, 'YEAR_CLOSED', { academicYear, surplus: closing.surplus, equityAccountId, lines: closing.lines, carriedTo: nextYear });
        audit(tx, nextRef, actor, 'OPENING_CARRIED_FORWARD', { from: academicYear, before: nextOpening, after: closing.balances });
      });
      return Response.json({ ok: true }, { headers: noStore });
    }
    throw new HttpError(400, 'Tindakan tidak dikenal.');
  } catch (error) { return errorResponse(error); }
}
