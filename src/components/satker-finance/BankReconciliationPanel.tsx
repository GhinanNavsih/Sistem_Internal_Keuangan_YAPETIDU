"use client";

import { useState } from 'react';
import { accountId, calendarYearOf, type FinancialAccount } from '@/lib/satker-finance/core';
import {
  adjustedStatementBalance, RECONCILIATION_ITEM_LABELS, reconciliationDocId, reconciliationStates,
  type BankReconciliation, type ReconciliationItem, type ReconciliationItemKind, type ReconciliationState,
} from '@/lib/satker-finance/bankReconciliation';
import { UPLOAD_ACCEPT, UPLOAD_TYPES_TEXT, uploadFileProblem } from '@/lib/uploadFileTypes';
import { CurrencyInput } from '@/components/ui/currency-input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Paperclip, X } from 'lucide-react';
import { button, cell, CheckLine, dangerGhostButton, field, leftCell, lightButton, money, monthNames, Section, selectContent, selectItem, selectTrigger } from './ui';

type BalanceRow = { account: FinancialAccount; endingDebit: number; endingCredit: number; periodDebit: number; periodCredit: number };
type ItemDraft = { kind: ReconciliationItemKind; description: string; amount: number };

/**
 * Month-end comparison of every cash and bank account with an outside figure: the bank statement (rekening koran)
 * or the cash counted in the box. A gap is explained only by the bank's timing; anything else must be journaled first.
 */
export default function BankReconciliationPanel({ rows, reconciliations, academicYear, month, canPost, busy, post, viewStatement }: {
  rows: BalanceRow[];
  reconciliations: BankReconciliation[];
  academicYear: string;
  month: number | 'ANNUAL';
  canPost: boolean;
  busy: boolean;
  post: (action: string, extra?: Record<string, unknown>) => Promise<boolean>;
  viewStatement: (reconciliationId: string) => void;
}) {
  if (month === 'ANNUAL') return <Section title="Rekonsiliasi bank"><p className="text-sm text-slate-600">Pilih satu bulan pada Periode untuk mengisi rekonsiliasi bank dan hitung fisik kas bulan itu.</p></Section>;
  const states = reconciliationStates(rows, reconciliations, month);
  const year = calendarYearOf(academicYear, month);
  return <div className="space-y-5">
    <Section title={`Rekonsiliasi bank dan hitung fisik kas, akhir ${monthNames[month - 1]} ${year}`}>
      <p className="max-w-3xl text-sm text-slate-600">Buku yang seimbang belum tentu sama dengan uang yang sebenarnya ada. Setiap akhir bulan, cocokkan saldo setiap rekening dengan saldo akhir di rekening koran, dan saldo kas tunai dengan hasil hitung uang di brankas. Selisih boleh dijelaskan hanya oleh waktu: setoran yang sudah dicatat tetapi belum masuk rekening koran, atau pembayaran yang sudah dicatat tetapi belum didebet bank. Biaya admin, bunga, atau potongan bank yang belum ada di buku harus dijurnal lebih dahulu.</p>
      <p className="mt-2 text-sm text-slate-600">Laporan bulan ini baru dapat dikirim ke BAK setelah semua akun di bawah cocok.</p>
    </Section>
    {!states.length && <Section title="Tidak ada yang perlu dicocokkan"><p className="text-sm text-slate-600">Tidak ada akun kas atau bank yang bersaldo atau bergerak bulan ini.</p></Section>}
    {states.map((state) => <ReconciliationCard key={`${month}_${state.account.code}_${state.reconciliation?.revision ?? 0}`} state={state} monthIndex={month}
      canPost={canPost} busy={busy} post={post} viewStatement={viewStatement} />)}
  </div>;
}

function ReconciliationCard({ state, monthIndex, canPost, busy, post, viewStatement }: {
  state: ReconciliationState;
  monthIndex: number;
  canPost: boolean;
  busy: boolean;
  post: (action: string, extra?: Record<string, unknown>) => Promise<boolean>;
  viewStatement: (reconciliationId: string) => void;
}) {
  const saved = state.reconciliation;
  const [statementBalance, setStatementBalance] = useState(saved?.statementBalance ?? 0);
  const [items, setItems] = useState<ItemDraft[]>(saved?.items.map((item: ReconciliationItem) => ({ ...item })) ?? []);
  const [note, setNote] = useState(saved?.note ?? '');
  const [statement, setStatement] = useState<File | null>(null);
  const [fileError, setFileError] = useState('');
  // KAS keeps id 10000 even when a unit renumbers it; the other cash-equivalent accounts are bank accounts.
  const isCash = accountId(state.account) === '10000';
  const adjusted = adjustedStatementBalance({ statementBalance, items: items.filter((item) => item.amount > 0) });
  const difference = adjusted - state.bookBalance;
  const itemsValid = items.every((item) => item.description.trim() && item.amount > 0);
  const id = reconciliationDocId(monthIndex, accountId(state.account));
  const save = async () => {
    let statementDataUrl: string | undefined;
    if (statement) statementDataUrl = await new Promise<string>((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(String(reader.result)); reader.onerror = reject; reader.readAsDataURL(statement); });
    await post('SAVE_BANK_RECONCILIATION', {
      monthIndex, accountId: accountId(state.account), statementBalance, note,
      items: items.map((item) => ({ ...item, description: item.description.trim() })), expectedRevision: saved?.revision ?? 0,
      ...(statementDataUrl ? { statementDataUrl } : {}),
    });
  };
  const kindItems = Object.entries(RECONCILIATION_ITEM_LABELS).map(([value, label]) => ({ value, label }));

  return <Section title={`${state.account.code} · ${state.account.name}`}>
    <CheckLine ok={state.status === 'MATCHED'} label={state.status === 'MATCHED' ? 'Cocok' : state.status === 'MISSING' ? 'Belum diisi' : 'Belum cocok'}
      detail={state.status === 'MISSING' ? `Saldo buku ${money(state.bookBalance)}.` : `Saldo buku ${money(state.bookBalance)}, saldo ${isCash ? 'hitung fisik' : 'rekening koran'} setelah penyesuaian ${money(state.adjusted)}.`} />
    <div className="mt-3 grid gap-3 md:grid-cols-2">
      <div className="text-xs font-medium text-slate-500">{isCash ? 'Uang tunai hasil hitung fisik' : 'Saldo akhir di rekening koran'}<div className="mt-1"><CurrencyInput className={field} aria-label="Saldo rekening koran" disabled={!canPost} value={statementBalance} onValue={setStatementBalance} /></div></div>
      <div className="text-xs font-medium text-slate-500">Saldo menurut buku<p className="mt-2 text-sm font-semibold tabular-nums text-slate-900">{money(state.bookBalance)}</p></div>
    </div>
    <div className="mt-4 overflow-x-auto"><table className="w-full min-w-[720px] text-sm"><thead><tr className="text-xs text-slate-500 [&_th]:font-medium"><th className={`${leftCell} w-72`}>Penyesuaian</th><th className={leftCell}>Uraian</th><th className={`${cell} w-48`}>Nominal</th>{canPost && <th className="w-10" />}</tr></thead>
      <tbody>{items.map((item, index) => <tr key={index}>
        <td className="px-3 py-1.5"><Select items={kindItems} value={item.kind} disabled={!canPost} onValueChange={(value) => value && setItems((current) => current.map((row, i) => i === index ? { ...row, kind: value as ReconciliationItemKind } : row))}>
          <SelectTrigger aria-label={`Jenis penyesuaian ${index + 1}`} className={selectTrigger}><SelectValue /></SelectTrigger>
          <SelectContent className={selectContent}>{kindItems.map((kind) => <SelectItem className={selectItem} key={kind.value} value={kind.value}>{kind.label}</SelectItem>)}</SelectContent></Select></td>
        <td className="px-3 py-1.5"><input className={field} aria-label={`Uraian penyesuaian ${index + 1}`} maxLength={200} disabled={!canPost} value={item.description} placeholder="contoh: cek no. 123 ke CV Maju" onChange={(event) => setItems((current) => current.map((row, i) => i === index ? { ...row, description: event.target.value } : row))} /></td>
        <td className="px-3 py-1.5"><CurrencyInput className={`${field} text-right`} aria-label={`Nominal penyesuaian ${index + 1}`} disabled={!canPost} value={item.amount} onValue={(value) => setItems((current) => current.map((row, i) => i === index ? { ...row, amount: value } : row))} /></td>
        {canPost && <td className="px-1"><button type="button" aria-label={`Hapus penyesuaian ${index + 1}`} className={`${dangerGhostButton} !px-2`} onClick={() => setItems((current) => current.filter((_, i) => i !== index))}>×</button></td>}
      </tr>)}</tbody></table>
      {canPost && <button type="button" className={`${lightButton} mt-2`} disabled={items.length >= 50} onClick={() => setItems((current) => [...current, { kind: 'OUTSTANDING_PAYMENT', description: '', amount: 0 }])}>Tambah penyesuaian</button>}
    </div>
    <dl className="mt-4 grid max-w-xl grid-cols-2 gap-y-1 text-sm">
      <dt className="text-slate-500">Saldo {isCash ? 'hitung fisik' : 'rekening koran'}</dt><dd className="text-right tabular-nums">{money(statementBalance)}</dd>
      <dt className="text-slate-500">Setelah penyesuaian</dt><dd className="text-right tabular-nums">{money(adjusted)}</dd>
      <dt className="text-slate-500">Saldo buku</dt><dd className="text-right tabular-nums">{money(state.bookBalance)}</dd>
      <dt className="text-slate-900">Selisih</dt><dd className={`text-right font-semibold tabular-nums ${difference ? 'text-amber-700' : 'text-green-700'}`}>{money(difference)}</dd>
    </dl>
    <label className="mt-4 block max-w-2xl text-xs font-medium text-slate-500">Catatan (opsional)<textarea className={`${field} mt-1`} rows={2} maxLength={500} disabled={!canPost} value={note} onChange={(event) => setNote(event.target.value)} /></label>
    <div className="mt-3 flex flex-wrap items-center gap-3">
      {saved?.hasStatement && <button type="button" className="text-sm text-accent-700 hover:underline" onClick={() => viewStatement(id)}>Lihat {isCash ? 'berita acara hitung kas' : 'rekening koran'}</button>}
      {canPost && (statement
        ? <span className="flex items-center gap-2 rounded-md border border-slate-200 bg-white px-2 py-1.5 text-xs text-slate-700"><span className="max-w-60 truncate" title={statement.name}>{statement.name}</span><button type="button" aria-label="Lepas berkas" className="text-slate-400 hover:text-red-700" onClick={() => setStatement(null)}><X className="h-4 w-4" /></button></span>
        : <label className={`${lightButton} cursor-pointer`}><Paperclip className="h-4 w-4" />{saved?.hasStatement ? 'Ganti' : 'Lampirkan'} {isCash ? 'berita acara' : 'rekening koran'}
          <input type="file" className="hidden" accept={UPLOAD_ACCEPT} onChange={(event) => { const file = event.target.files?.[0] || null; const problem = file ? uploadFileProblem(file) : null; setFileError(problem || ''); setStatement(problem ? null : file); event.target.value = ''; }} /></label>)}
      {canPost && <span className="text-xs text-slate-400">Boleh dikosongkan. {UPLOAD_TYPES_TEXT}, maks. 5 MB.</span>}
    </div>
    {fileError && <p role="alert" className="mt-2 text-sm text-red-700">{fileError}</p>}
    {canPost && <div className="mt-4 flex items-center gap-3"><button type="button" className={button} disabled={busy || !itemsValid} onClick={() => void save()}>Simpan rekonsiliasi</button>
      {!itemsValid && <span className="text-xs text-amber-700">Isi uraian dan nominal setiap penyesuaian.</span>}
      {itemsValid && difference !== 0 && <span className="text-xs text-amber-700">Masih ada selisih {money(difference)}. Tetap dapat disimpan, tetapi laporan belum dapat dikirim.</span>}</div>}
  </Section>;
}
