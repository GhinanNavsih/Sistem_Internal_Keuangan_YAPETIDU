import { createHash, randomBytes } from 'node:crypto';
import { NextRequest } from 'next/server';
import type { DocumentReference, Transaction } from 'firebase-admin/firestore';
import admin, { adminDb, adminStorage } from '@/lib/firebase-admin';
import { errorResponse, HttpError, requireAuthenticatedProfile, requireRole, type AuthenticatedProfile } from '@/lib/server/auth';
import {
  ACCOUNT_COLLECTION, CATALOG_META_REF, assertUnitEdit, canReadAll, ensureOwnUnit, getUnit, listUnits, loadAccounts, unitAccountCatalogSource,
  openingFrom, publicYear, UNIT_COLLECTION, unitAccountCatalogMetaRef, unitAccountCollection, yearRef,
} from '@/lib/server/satkerFinance';
import {
  accountId as financialAccountId, academicYearFor, buildFinancialStatements, buildVoucher, CASH_FLOW_SECTIONS, DEFAULT_ACCOUNTS,
  fiscalMonths, FinancialAccount, JournalEntry, OpeningBalances, type AccountType,
  validateEntryDate, validateOpeningBalances,
} from '@/lib/satker-finance/core';
import { entryChangeBlocker } from '@/lib/satker-finance/entryEditing';
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
/**
 * Validates a receipt photo sent as a data URL and stores it, returning its
 * Storage path. Every call writes a new file (random suffix), so replacing a
 * receipt never overwrites the old one, which the audit trail still points at.
 */
async function storeReceipt(dataUrl: unknown, unitId: string, academicYear: string, entryId: string): Promise<string> {
  if (typeof dataUrl !== 'string') throw new HttpError(400, 'Bukti transaksi tidak valid.');
  const buffer = parseBase64DataUrl(dataUrl);
  if (!buffer) throw new HttpError(400, 'Bukti transaksi tidak valid.');
  if (!buffer.length || buffer.length > MAX_UPLOAD_BYTES) throw new HttpError(400, 'Ukuran bukti transaksi maksimal 5 MB.');
  // The type comes from the file's own bytes, whatever the browser declared.
  const type = detectUploadFileType(buffer);
  if (!type) throw new HttpError(400, `Bukti harus berupa ${UPLOAD_TYPES_TEXT}, dan isi berkas harus sesuai jenisnya.`);
  const receiptPath = `satker-finance/${unitId}/${academicYear}/${entryId}_${randomBytes(8).toString('hex')}.${type.extension}`;
  await adminStorage.bucket().file(receiptPath).save(buffer, { resumable: false, metadata: { contentType: type.mime } });
  return receiptPath;
}
/** What the audit trail keeps of a journal that is changed or removed. */
function entrySnapshot(entry: Partial<JournalEntry>) {
  return {
    date: entry.date ?? null, monthIndex: entry.monthIndex ?? null, kind: entry.kind ?? null, description: entry.description ?? '',
    totalAmount: entry.totalAmount ?? 0, cashFlowSection: entry.cashFlowSection ?? null, receiptPath: entry.receiptPath ?? null,
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
async function loadYear(unitId: string, academicYear: string, includeHistory = false) {
  const ref = yearRef(unitId, academicYear);
  const [yearDoc, entryDocs, reportDocs] = await Promise.all([
    ref.get(), ref.collection('entries').orderBy('date', 'asc').get(),
    ref.collection('reports').get(),
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
  return { ref, year: publicYear(yearDoc.data()), entries, reports, events, revisions };
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
    const unitCatalog = await unitAccountCatalogMetaRef(unitId).get();
    const state = await loadYear(unitId, academicYear, true);
    const statements = buildFinancialStatements({ accounts, opening: state.year.openingBalances, entries: state.entries, academicYear, monthIndex });
    const annualStatements = monthIndex === 'ANNUAL' ? statements : buildFinancialStatements({ accounts, opening: state.year.openingBalances, entries: state.entries, academicYear, monthIndex: 'ANNUAL' });
    return Response.json({ ...base, accountCatalogRevision: Number(unitCatalog.data()?.revision || 0), unit, year: state.year, statements, annualStatements, monthlyTrial: monthlyTrial(accounts, state.year.openingBalances, state.entries, academicYear),
      entries: state.entries.map((entry) => {
        const result = { ...entry, hasReceipt: !!entry.receiptPath };
        delete result.receiptPath;
        delete result.requestFingerprint;
        return result;
      }),
      reports: state.reports, events: state.events,
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
      const code = string(raw.code, 'Nomor akun', 5);
      if (!/^\d{5}$/.test(code)) throw new HttpError(400, 'Nomor akun harus terdiri dari 5 angka.');
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
      let accountData: Record<string, unknown>;
      if (sourceAccount) {
        accountData = { baseCode: sourceCode, code, name };
      } else if (current) {
        accountData = { ...current, code, name };
        delete accountData.id;
        delete accountData.localAccountId;
      } else {
        const type = raw.type as AccountType;
        if (!['AKTIVA', 'HUTANG', 'MODAL', 'TERIMA', 'KELUAR'].includes(type)) throw new HttpError(400, 'Kelompok akun tidak valid.');
        const cashEquivalent = raw.cashEquivalent === true;
        if (cashEquivalent && (type !== 'AKTIVA' || (code !== '10000' && !code.startsWith('11')))) {
          throw new HttpError(400, 'Akun kas atau bank harus bertipe Aktiva dan memakai nomor 10000 atau 11xxx.');
        }
        const normalBalance = type === 'HUTANG' || type === 'MODAL' || type === 'TERIMA' ? 'CREDIT' : 'DEBIT';
        const reportTarget = type === 'TERIMA' || type === 'KELUAR' ? 'INCOME_STATEMENT' : 'BALANCE_SHEET';
        const cashFlowSection = cashEquivalent ? null : type === 'HUTANG' || type === 'MODAL' ? 'FINANCING' : type === 'AKTIVA' && code.startsWith('13') ? 'INVESTING' : 'OPERATING';
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
        if ((meta.data()?.usedCodes || []).includes(code)) throw new HttpError(409, 'Kode akun sudah dipakai di saldo awal atau jurnal dan tidak dapat diubah.');
        const revision = Number(before.data()?.revision || 0);
        if (raw.expectedRevision !== revision) throw new HttpError(409, 'Akun berubah. Muat ulang sebelum menyimpan.');
        const after = { name, normalBalance, reportTarget, cashEquivalent, cashFlowSection, revision: revision + 1, updatedAt: admin.firestore.FieldValue.serverTimestamp(), updatedBy: actor.uid };
        tx.set(ref, after);
        tx.set(CATALOG_META_REF, { revision: admin.firestore.FieldValue.increment(1), updatedAt: admin.firestore.FieldValue.serverTimestamp() }, { merge: true });
        tx.create(adminDb.collection('SatkerFinancialConfigAudit').doc(), { action: 'ACCOUNT_UPDATED', target: code, before: before.data() || original, after, actorUid: actor.uid, actorRole: actor.role, at: admin.firestore.FieldValue.serverTimestamp() });
      });
      return Response.json({ ok: true }, { headers: noStore });
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
        const [current, meta, unitMeta] = await Promise.all([tx.get(year), tx.get(CATALOG_META_REF), tx.get(unitAccountCatalogMetaRef(unitId))]);
        if (Number(meta.data()?.revision || 0) !== Number(catalogMeta.data()?.revision || 0)) throw new HttpError(409, 'Katalog akun berubah. Muat ulang sebelum menyimpan saldo awal.');
        if (Number(unitMeta.data()?.revision || 0) !== Number(unitCatalogMeta.data()?.revision || 0)) throw new HttpError(409, 'Daftar akun SatKer berubah. Muat ulang sebelum menyimpan saldo awal.');
        const data = current.data();
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
        voucher = { kind: 'REVERSAL', date, description: `Pembalikan ${original.id}: ${reason}`, totalAmount: old.totalAmount,
          lines: old.lines.map((line) => ({ ...line, debit: line.credit, credit: line.debit })), cashFlowSection: old.cashFlowSection };
        reversesEntryId = original.id;
      } else {
        try { voucher = buildVoucher(raw, accounts); } catch (error) { inputError(error); }
      }
      const requestFingerprint = createHash('sha256').update(JSON.stringify({ voucher, reversesEntryId: reversesEntryId || null, receiptDataUrl: raw.receiptDataUrl || null })).digest('hex');
      const existing = await entryRef.get();
      if (existing.exists) {
        if (existing.data()?.createdBy === actor.uid && existing.data()?.requestFingerprint === requestFingerprint) {
          return Response.json({ ok: true, entryId, duplicate: true }, { headers: noStore });
        }
        throw new HttpError(409, 'ID voucher sudah dipakai untuk transaksi lain.');
      }
      let receiptPath: string | undefined;
      if (action === 'POST_ENTRY' && raw.receiptDataUrl) receiptPath = await storeReceipt(raw.receiptDataUrl, unitId, academicYear, entryId);
      const entry: JournalEntry = { ...voucher, id: entryId, satkerId: unitId, academicYear, monthIndex, isBalanced: true,
        createdBy: actor.uid, requestFingerprint, ...(receiptPath ? { receiptPath } : {}), ...(reversesEntryId ? { reversesEntryId } : {}) };
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
        if (receiptPath) await adminStorage.bucket().file(receiptPath).delete({ ignoreNotFound: true }).catch((cleanupError) => console.error('Receipt cleanup failed', cleanupError));
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
      let receiptPath: string | undefined;
      if (!deleting && raw.receiptDataUrl) receiptPath = await storeReceipt(raw.receiptDataUrl, unitId, academicYear, entryId);
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
            cashFlowSection: next.cashFlowSection, isBalanced: true, ...(receiptPath ? { receiptPath } : {}),
            revision: Number(current.revision || 0) + 1, updatedBy: actor.uid, updatedAt: now,
          });
          tx.set(year, { revision: admin.firestore.FieldValue.increment(1), updatedAt: now }, { merge: true });
          tx.set(CATALOG_META_REF, { usedCodes: admin.firestore.FieldValue.arrayUnion(...next.lines.map((line) => line.accountCode)) }, { merge: true });
          audit(tx, year, actor, 'ENTRY_UPDATED', {
            entryId, before: entrySnapshot(current),
            after: entrySnapshot({ ...next, monthIndex, receiptPath: receiptPath ?? current.receiptPath }),
          });
        });
      } catch (error) {
        if (receiptPath) await adminStorage.bucket().file(receiptPath).delete({ ignoreNotFound: true }).catch((cleanupError) => console.error('Receipt cleanup failed', cleanupError));
        throw error;
      }
      return Response.json({ ok: true, entryId }, { headers: noStore });
    }
    if (action === 'SUBMIT_REPORT') {
      assertUnitEdit(actor, unit);
      const bakUids = await usersWithRole('super_admin');
      const monthIndex = validateMonth(raw.monthIndex);
      const [accounts, unitCatalogMeta] = await Promise.all([loadAccounts(unitId), unitAccountCatalogMetaRef(unitId).get()]);
      const state = await loadYear(unitId, academicYear);
      if (state.year.status === 'CLOSED') throw new HttpError(409, 'Tahun buku sudah ditutup.');
      const statements = buildFinancialStatements({ accounts, opening: state.year.openingBalances, entries: state.entries, academicYear, monthIndex });
      if (statements.trialBalance.difference !== 0 || statements.trialBalance.periodDebits !== statements.trialBalance.periodCredits || statements.cashFlow.reconciliationDelta !== 0) {
        throw new HttpError(409, 'Laporan gagal rekonsiliasi debit/kredit atau kas.');
      }
      const months = fiscalMonths(academicYear);
      const period = months.find((month) => month.monthIndex === monthIndex)!.period;
      const ref = year.collection('reports').doc(reportId(monthIndex));
      await adminDb.runTransaction(async (tx) => {
        const [currentYear, currentReport, ...allReports] = await Promise.all([
          tx.get(year), tx.get(ref), ...months.map((month) => tx.get(year.collection('reports').doc(reportId(month.monthIndex)))),
        ]);
        const currentUnitCatalog = await tx.get(unitAccountCatalogMetaRef(unitId));
        if (Number(currentUnitCatalog.data()?.revision || 0) !== Number(unitCatalogMeta.data()?.revision || 0)) throw new HttpError(409, 'Daftar akun SatKer berubah saat laporan dihitung. Muat ulang lalu kirim kembali.');
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
      await adminDb.runTransaction(async (tx) => {
        const [current, currentUnitCatalog] = await Promise.all([tx.get(year), tx.get(unitAccountCatalogMetaRef(unitId))]);
        if (Number(currentUnitCatalog.data()?.revision || 0) !== Number(unitCatalogMeta.data()?.revision || 0)) throw new HttpError(409, 'Daftar akun SatKer berubah saat penutupan dihitung. Muat ulang lalu ulangi.');
        if (Number(current.data()?.revision || 0) !== state.year.revision) throw new HttpError(409, 'Tahun buku berubah. Muat ulang sebelum menutup.');
        tx.update(year, { status: 'CLOSED', annualSnapshot: statements, closedBy: actor.uid, closedAt: admin.firestore.FieldValue.serverTimestamp(), revision: admin.firestore.FieldValue.increment(1) });
        audit(tx, year, actor, 'YEAR_CLOSED', { academicYear });
      });
      return Response.json({ ok: true }, { headers: noStore });
    }
    throw new HttpError(400, 'Tindakan tidak dikenal.');
  } catch (error) { return errorResponse(error); }
}
