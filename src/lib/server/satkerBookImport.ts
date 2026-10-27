import admin, { adminDb } from '@/lib/firebase-admin';
import { AuthenticatedProfile, HttpError } from '@/lib/server/auth';
import { audit, CATALOG_META_REF, loadAccounts, previousYearState, reportId, unitAccountCatalogMetaRef, unitAccountCollection, yearRef } from '@/lib/server/satkerFinance';
import { bookImportFrom, planBookAccounts } from '@/lib/satker-finance/bookImport';
import { buildVoucher, fiscalMonths, JournalEntry, OpeningBalances, validateEntryDate, validateOpeningBalances } from '@/lib/satker-finance/core';
import { openingComesFromPreviousYear } from '@/lib/satker-finance/monthControls';

function invalid(error: unknown): never {
  if (error instanceof HttpError) throw error;
  throw new HttpError(400, error instanceof Error ? error.message : 'Data tidak valid.');
}

/**
 * Writes a unit's accounts, opening balances and journals from a workbook book, all in one transaction. The caller
 * checks that the actor may edit the unit.
 */
export async function importUnitBook({ actor, unitId, academicYear, raw }: {
  actor: AuthenticatedProfile; unitId: string; academicYear: string; raw: unknown;
}) {
  let book: ReturnType<typeof bookImportFrom>;
  try { book = bookImportFrom(raw); } catch (error) { invalid(error); }
  let planned: ReturnType<typeof planBookAccounts>;
  try { planned = planBookAccounts(book.accounts, unitId, await loadAccounts()); } catch (error) { invalid(error); }
  const accountIdByCode = new Map(planned.map((item) => [item.code, item.accountId]));
  const accounts = planned.map((item) => item.account);
  const opening: OpeningBalances = {};
  for (const [code, balance] of Object.entries(book.opening)) {
    const accountId = accountIdByCode.get(code);
    if (!accountId) throw new HttpError(400, `Saldo awal akun ${code} tidak ada dalam daftar akun.`);
    opening[accountId] = balance;
  }
  try { validateOpeningBalances(opening, accounts); } catch (error) { invalid(error); }
  const entries: JournalEntry[] = book.vouchers.map((voucher) => {
    try {
      const monthIndex = Number(voucher.date.slice(5, 7));
      validateEntryDate(voucher.date, academicYear, monthIndex);
      const lines = voucher.lines.map((line) => {
        const accountCode = accountIdByCode.get(line.code);
        if (!accountCode) throw new Error(`akun ${line.code} tidak ada dalam daftar akun.`);
        return { accountCode, debit: line.debit, credit: line.credit, description: line.description };
      });
      const built = buildVoucher({ kind: 'ADVANCED', description: voucher.description, date: voucher.date, lines }, accounts);
      return { ...built, id: voucher.id, satkerId: unitId, academicYear, monthIndex, isBalanced: true, createdBy: actor.uid };
    } catch (error) {
      throw new HttpError(400, `Jurnal ${voucher.id}: ${error instanceof Error ? error.message : 'tidak valid.'}`);
    }
  });

  const year = yearRef(unitId, academicYear);
  const catalogMeta = unitAccountCatalogMetaRef(unitId);
  await adminDb.runTransaction(async (tx) => {
    const current = await tx.get(year);
    const previous = await previousYearState(unitId, academicYear, tx);
    const data = current.data();
    if (data?.openingSource === 'CARRIED_FORWARD' || openingComesFromPreviousYear(previous)) {
      throw new HttpError(409, `Saldo awal tahun ${academicYear} dibawa otomatis dari penutupan tahun buku ${previous.academicYear}, tidak diimpor.`);
    }
    if (data?.status === 'CLOSED') throw new HttpError(409, 'Tahun buku sudah ditutup.');
    if (Number(data?.entryCount || 0) > 0) throw new HttpError(409, 'Buku SatKer ini sudah berisi jurnal. Impor hanya untuk buku yang masih kosong.');
    const ownAccounts = await tx.get(unitAccountCollection(unitId).limit(1));
    if (!ownAccounts.empty) throw new HttpError(409, 'SatKer ini sudah memiliki daftar akun. Impor hanya untuk SatKer yang belum memiliki daftar akun.');
    const reports = await Promise.all(fiscalMonths(academicYear).map((month) => tx.get(year.collection('reports').doc(reportId(month.monthIndex)))));
    if (reports.some((report) => report.exists)) throw new HttpError(409, 'Buku sudah memiliki laporan bulanan dan tidak dapat diimpor ulang.');
    const entryDocs = await Promise.all(entries.map((entry) => tx.get(year.collection('entries').doc(entry.id))));
    if (entryDocs.some((doc) => doc.exists)) throw new HttpError(409, 'Sebagian jurnal impor sudah pernah diposting.');

    const now = admin.firestore.FieldValue.serverTimestamp();
    for (const item of planned) tx.set(unitAccountCollection(unitId).doc(item.docId), { ...item.data, revision: 1, updatedAt: now, updatedBy: actor.uid });
    tx.set(catalogMeta, { revision: admin.firestore.FieldValue.increment(1), updatedAt: now }, { merge: true });
    const yearFields = { satkerId: unitId, academicYear, startDate: `${academicYear.slice(0, 4)}-09-01`, endDate: `${academicYear.slice(5)}-08-31`, status: 'ACTIVE',
      openingBalances: opening, revision: Number(data?.revision || 0) + 1, entryCount: entries.length, updatedAt: now };
    if (current.exists) tx.update(year, yearFields);
    else tx.create(year, yearFields);
    for (const entry of entries) tx.create(year.collection('entries').doc(entry.id), { ...entry, createdAt: now });
    const usedIds = [...new Set([...Object.keys(opening), ...entries.flatMap((entry) => entry.lines.map((line) => line.accountCode))])];
    if (usedIds.length) tx.set(CATALOG_META_REF, { usedCodes: admin.firestore.FieldValue.arrayUnion(...usedIds) }, { merge: true });
    const summary = { accounts: planned.length, openingAccounts: Object.keys(opening).length, vouchers: entries.length, lines: entries.reduce((sum, entry) => sum + entry.lines.length, 0) };
    audit(tx, year, actor, 'BOOK_IMPORTED', summary);
    tx.create(adminDb.collection('SatkerFinancialConfigAudit').doc(), { action: 'UNIT_BOOK_IMPORTED', target: unitId, ...summary, unitId, actorUid: actor.uid, actorRole: actor.role, at: now });
  });
  return { ok: true, accounts: planned.length, vouchers: entries.length };
}
