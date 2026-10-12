"use client";

import { useMemo, useState } from 'react';
import {
  accountId, adjacentAcademicYear, buildYearClosing, defaultSurplusAccountId,
  type FinancialAccount, type JournalEntry, type OpeningBalances, type YearClosing,
} from '@/lib/satker-finance/core';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { button, cell, leftCell, money, Section, selectContent, selectItem, selectTrigger } from './ui';

/**
 * Year-end closing: the closing journal (jurnal penutup) brings every Penerimaan and Pengeluaran account to zero
 * and moves the surplus into a Modal account; the balance-sheet balances left become next year's opening balance.
 */
export default function YearClosingPanel({ accounts, openingBalances, entries, academicYear, closing, closed, allApproved, isAdmin, busy, post }: {
  accounts: FinancialAccount[];
  openingBalances: OpeningBalances;
  entries: JournalEntry[];
  academicYear: string;
  closing: (YearClosing & { equityAccountCode?: string; equityAccountName?: string }) | null;
  closed: boolean;
  allApproved: boolean;
  isAdmin: boolean;
  busy: boolean;
  post: (action: string, extra?: Record<string, unknown>) => Promise<boolean>;
}) {
  const equityAccounts = accounts.filter((account) => account.postable && account.type === 'MODAL' && account.reportTarget === 'BALANCE_SHEET');
  const [equityAccountId, setEquityAccountId] = useState(() => defaultSurplusAccountId(accounts));
  const nextYear = adjacentAcademicYear(academicYear, 1);
  const preview = useMemo(() => {
    if (closing) return { result: closing, error: '' };
    if (!equityAccountId) return { result: null, error: 'Belum ada akun Modal yang aktif untuk menampung surplus. Buat di tab Akun.' };
    try { return { result: buildYearClosing({ accounts, opening: openingBalances, entries, academicYear, equityAccountId }), error: '' }; }
    catch (cause) { return { result: null, error: cause instanceof Error ? cause.message : 'Penutupan belum dapat dihitung.' }; }
  }, [closing, accounts, openingBalances, entries, academicYear, equityAccountId]);
  const nameOf = (id: string) => { const account = accounts.find((item) => accountId(item) === id); return account ? `${account.code} · ${account.name}` : id; };
  const result = preview.result;
  const balances = result ? Object.entries(result.balances).sort(([a], [b]) => nameOf(a).localeCompare(nameOf(b))) : [];
  const equityItems = equityAccounts.map((account) => ({ value: accountId(account), label: `${account.code} · ${account.name}` }));

  return <Section title="Penutupan tahun buku">
    <p className="max-w-3xl text-sm text-slate-600">Menutup tahun buku melakukan tiga hal sekaligus: (1) jurnal penutup membuat saldo semua akun Penerimaan dan Pengeluaran kembali nol, (2) surplus atau defisit tahun ini dipindahkan ke akun Modal, dan (3) saldo akun Neraca yang tersisa otomatis menjadi saldo awal tahun {nextYear}, sehingga tidak perlu diketik ulang. Tahun buku dapat ditutup setelah 12 bulan disahkan Rektorat dan laporan tahunan rekonsiliasi.</p>
    {closed && closing && <p className="mt-3 rounded-lg bg-green-50 p-3 text-sm text-green-800">Tahun buku sudah ditutup. {closing.surplus >= 0 ? 'Surplus' : 'Defisit'} {money(Math.abs(closing.surplus))} dipindahkan ke {closing.equityAccountCode} · {closing.equityAccountName}, dan saldo awal tahun {nextYear} sudah dibawa.</p>}
    {closed && !closing && <p className="mt-3 rounded-lg bg-slate-50 p-3 text-sm text-slate-600">Tahun buku ini ditutup sebelum penutupan otomatis tersedia, sehingga jurnal penutupnya tidak tersimpan.</p>}
    {!closed && <div className="mt-4 max-w-md text-xs font-medium text-slate-500"><span id="surplus-account-label">Akun Modal penampung surplus</span>
      <Select items={equityItems} value={equityAccountId || null} disabled={!isAdmin} onValueChange={(value) => value && setEquityAccountId(value)}>
        <SelectTrigger aria-labelledby="surplus-account-label" className={selectTrigger}><SelectValue placeholder="Pilih akun Modal" /></SelectTrigger>
        <SelectContent className={selectContent}>{equityItems.map((item) => <SelectItem className={selectItem} key={item.value} value={item.value}>{item.label}</SelectItem>)}</SelectContent>
      </Select></div>}
    {preview.error && <p className="mt-3 rounded-lg bg-amber-50 p-3 text-sm text-amber-800">{preview.error}</p>}
    {result && <>
      <p className="mt-4 text-sm font-semibold text-slate-900">{result.surplus >= 0 ? 'Surplus' : 'Defisit'} tahun {academicYear}: {money(Math.abs(result.surplus))}</p>
      <h3 className="mt-4 mb-2 text-sm font-semibold text-slate-900">Jurnal penutup{closed ? '' : ' (pratinjau)'}</h3>
      <div className="overflow-x-auto"><table className="w-full text-sm"><thead><tr className="text-xs text-slate-500 [&_th]:font-medium"><th className={leftCell}>Akun</th><th className={leftCell}>Uraian</th><th className={cell}>Debet</th><th className={cell}>Kredit</th></tr></thead>
        <tbody>{result.lines.map((line, index) => <tr key={`${line.accountCode}-${index}`}><td className={leftCell}>{line.accountNumber} · {line.accountName}</td><td className={leftCell}>{line.description}</td><td className={cell}>{line.debit ? money(line.debit) : ''}</td><td className={cell}>{line.credit ? money(line.credit) : ''}</td></tr>)}</tbody>
        <tfoot><tr className="bg-slate-50 font-semibold"><td colSpan={2} className={leftCell}>Jumlah</td><td className={cell}>{money(result.lines.reduce((sum, line) => sum + line.debit, 0))}</td><td className={cell}>{money(result.lines.reduce((sum, line) => sum + line.credit, 0))}</td></tr></tfoot></table>
        {!result.lines.length && <p className="p-3 text-sm text-slate-500">Tidak ada saldo Penerimaan atau Pengeluaran untuk ditutup.</p>}</div>
      <h3 className="mt-5 mb-2 text-sm font-semibold text-slate-900">Saldo awal tahun {nextYear}</h3>
      <div className="max-h-96 overflow-auto"><table className="w-full text-sm"><thead><tr className="text-xs text-slate-500 [&_th]:font-medium"><th className={leftCell}>Akun</th><th className={cell}>Debet</th><th className={cell}>Kredit</th></tr></thead>
        <tbody>{balances.map(([id, balance]) => <tr key={id}><td className={leftCell}>{nameOf(id)}</td><td className={cell}>{balance.debit ? money(balance.debit) : ''}</td><td className={cell}>{balance.credit ? money(balance.credit) : ''}</td></tr>)}</tbody>
        <tfoot><tr className="bg-slate-50 font-semibold"><td className={leftCell}>Jumlah</td><td className={cell}>{money(balances.reduce((sum, [, balance]) => sum + balance.debit, 0))}</td><td className={cell}>{money(balances.reduce((sum, [, balance]) => sum + balance.credit, 0))}</td></tr></tfoot></table></div>
    </>}
    {isAdmin && !closed && <div className="mt-4"><button className={button} disabled={busy || !allApproved || !result} onClick={() => void post('CLOSE_YEAR', { equityAccountId })}>Tutup tahun buku dan bawa saldo ke {nextYear}</button>
      {!allApproved && <p className="mt-2 text-xs text-slate-500">Menunggu 12 laporan bulanan disahkan Rektorat.</p>}</div>}
  </Section>;
}
