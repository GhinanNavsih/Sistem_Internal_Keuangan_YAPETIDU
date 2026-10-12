"use client";

import { useMemo, useRef, useState } from 'react';
import { accountId, calendarYearOf, type FinancialAccount, type JournalEntry } from '@/lib/satker-finance/core';
import {
  accumulatedDepreciation, buildDepreciationJournal, depreciationEntryId, depreciationForMonth, depreciationStatus, MAX_USEFUL_LIFE_YEARS,
  scheduledAccumulatedByAccount, suggestedAccumulatedAccountId, type FixedAsset,
} from '@/lib/satker-finance/depreciation';
import { CurrencyInput } from '@/components/ui/currency-input';
import { SearchSelect } from '@/components/ui/search-select';
import { button, cell, CheckLine, dangerGhostButton, field, leftCell, lightButton, money, monthNames, Section } from './ui';

type BalanceRow = { account: FinancialAccount; endingDebit: number; endingCredit: number };
type Draft = { name: string; assetAccountId: string; accumulatedAccountId: string; expenseAccountId: string; acquisitionDate: string; cost: number; residualValue: number; usefulLifeYears: string };
const emptyDraft = (): Draft => ({ name: '', assetAccountId: '', accumulatedAccountId: '', expenseAccountId: '', acquisitionDate: '', cost: 0, residualValue: 0, usefulLifeYears: '' });

/**
 * The unit's fixed-asset register and the month's depreciation journal built from it. Assets are written down evenly
 * over their useful life from the month they were acquired; the journal debits each asset's expense account and
 * credits its accumulated-depreciation account.
 */
export default function FixedAssetsPanel({ accounts, assets, entries, rows, academicYear, month, canPost, canPostMonth, busy, post }: {
  accounts: FinancialAccount[];
  assets: FixedAsset[];
  entries: JournalEntry[];
  rows: BalanceRow[];
  academicYear: string;
  month: number | 'ANNUAL';
  /** May change the register (it spans years). */
  canPost: boolean;
  /** May post this month's depreciation: the month is still open. */
  canPostMonth: boolean;
  busy: boolean;
  post: (action: string, extra?: Record<string, unknown>) => Promise<boolean>;
}) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft>(emptyDraft);
  const formRef = useRef<HTMLDivElement>(null);
  // The annual view reads the register at the end of the year (August).
  const reportMonth = month === 'ANNUAL' ? 8 : month;
  const reportYear = calendarYearOf(academicYear, reportMonth);
  const postable = accounts.filter((account) => account.postable);
  const option = (account: FinancialAccount) => ({ value: accountId(account), label: `${account.code} · ${account.name}` });
  const assetAccountItems = postable.filter((account) => account.type === 'AKTIVA' && !account.cashEquivalent && account.normalBalance === 'DEBIT').map(option);
  const accumulatedItems = postable.filter((account) => account.type === 'AKTIVA' && !account.cashEquivalent && account.normalBalance === 'CREDIT').map(option);
  const expenseItems = postable.filter((account) => account.type === 'KELUAR').map(option);
  const nameOf = (id: string) => { const account = accounts.find((item) => accountId(item) === id); return account ? `${account.code} · ${account.name}` : id; };

  const journal = useMemo(() => {
    if (month === 'ANNUAL') return { expected: null, error: '' };
    try { return { expected: buildDepreciationJournal(assets, accounts, academicYear, month), error: '' }; }
    catch (cause) { return { expected: null, error: cause instanceof Error ? cause.message : 'Daftar aset tetap tidak valid.' }; }
  }, [assets, accounts, academicYear, month]);
  const posted = month === 'ANNUAL' ? undefined : entries.find((entry) => entry.id === depreciationEntryId(month));
  const status = month === 'ANNUAL' || journal.error ? null : depreciationStatus(journal.expected, posted);
  const scheduled = useMemo(() => scheduledAccumulatedByAccount(assets, academicYear, reportMonth), [assets, academicYear, reportMonth]);

  const startEdit = (asset: FixedAsset) => {
    setEditingId(asset.id);
    setDraft({ name: asset.name, assetAccountId: asset.assetAccountId, accumulatedAccountId: asset.accumulatedAccountId, expenseAccountId: asset.expenseAccountId,
      acquisitionDate: asset.acquisitionDate, cost: asset.cost, residualValue: asset.residualValue, usefulLifeYears: String(asset.usefulLifeMonths / 12) });
    window.requestAnimationFrame(() => formRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' }));
  };
  const closeForm = () => { setEditingId(null); setDraft(emptyDraft()); };
  const editing = editingId && editingId !== 'new' ? assets.find((asset) => asset.id === editingId) : undefined;
  const draftReady = !!draft.name.trim() && !!draft.assetAccountId && !!draft.accumulatedAccountId && !!draft.expenseAccountId && !!draft.acquisitionDate && draft.cost > 0 && Number(draft.usefulLifeYears) >= 1;
  const save = async () => {
    const saved = await post('SAVE_FIXED_ASSET', {
      ...(editing ? { assetId: editing.id } : {}), expectedRevision: editing?.revision || 0,
      name: draft.name, assetAccountId: draft.assetAccountId, accumulatedAccountId: draft.accumulatedAccountId, expenseAccountId: draft.expenseAccountId,
      acquisitionDate: draft.acquisitionDate, cost: draft.cost, residualValue: draft.residualValue, usefulLifeYears: Number(draft.usefulLifeYears),
    });
    if (saved) closeForm();
  };
  const remove = async (asset: FixedAsset) => {
    if (!window.confirm(`Hapus aset "${asset.name}" dari daftar? Jurnal penyusutan bulan yang masih terbuka perlu diposting ulang sesudahnya.`)) return;
    if (await post('DELETE_FIXED_ASSET', { assetId: asset.id, expectedRevision: asset.revision || 0 }) && editingId === asset.id) closeForm();
  };

  const statusText = status === 'POSTED' ? 'Sudah diposting dan sesuai daftar aset.'
    : status === 'MISSING' ? 'Belum diposting.'
      : status === 'STALE' ? (journal.expected ? 'Jurnal yang ada berbeda dengan daftar aset sekarang. Posting ulang.' : 'Tidak ada lagi aset yang disusutkan bulan ini, tetapi jurnalnya masih ada. Hapus dengan tombol di bawah.')
        : 'Tidak ada aset yang disusutkan bulan ini.';

  return <div className="space-y-5">
    <Section title="Cara kerja penyusutan">
      <p className="max-w-3xl text-sm text-slate-600">Setiap aset tetap (gedung, kendaraan, peralatan) kehilangan nilainya sedikit demi sedikit selama dipakai. Nilai yang hilang itu dicatat tiap bulan sebagai beban, dengan jumlah yang sama setiap bulan mulai bulan perolehan sampai umur manfaatnya habis (metode garis lurus). Jurnalnya: Debet akun beban penyusutan, Kredit akun akumulasi penyusutan, sehingga di Neraca aset tampil sebesar nilai bukunya. Tanah tidak disusutkan.</p>
      <p className="mt-2 max-w-3xl text-sm text-slate-600">Bila belum ada akun Pengeluaran untuk beban penyusutan, buat dulu di tab Akun (misalnya &ldquo;Beban Penyusutan&rdquo;). Aset yang dibeli sebelum buku ini dimulai juga dimasukkan, dengan tanggal perolehan aslinya; akumulasinya sampai saldo awal sudah ada di saldo awal akun akumulasi.</p>
    </Section>

    {month !== 'ANNUAL' && <Section title={`Penyusutan ${monthNames[month - 1]} ${reportYear}`}>
      {journal.error ? <p className="rounded-lg bg-red-50 p-3 text-sm text-red-800">{journal.error}</p> : <>
        <CheckLine ok={status === 'POSTED' || status === 'NONE'} label={journal.expected ? `Penyusutan ${money(journal.expected.total)}` : 'Penyusutan bulan ini'} detail={statusText} />
        {journal.expected && <div className="mt-3 overflow-x-auto"><table className="w-full text-sm"><thead><tr className="text-xs text-slate-500 [&_th]:font-medium"><th className={leftCell}>Akun</th><th className={cell}>Debet</th><th className={cell}>Kredit</th></tr></thead>
          <tbody>{journal.expected.lines.map((line) => <tr key={`${line.accountCode}-${line.debit}`}><td className={leftCell}>{line.accountNumber} · {line.accountName}</td><td className={cell}>{line.debit ? money(line.debit) : ''}</td><td className={cell}>{line.credit ? money(line.credit) : ''}</td></tr>)}</tbody></table></div>}
        {canPostMonth && (status === 'MISSING' || status === 'STALE') && <button type="button" className={`${journal.expected ? button : dangerGhostButton} mt-3`} disabled={busy} onClick={() => void post('POST_DEPRECIATION', { monthIndex: month })}>
          {status === 'MISSING' ? 'Posting penyusutan' : journal.expected ? 'Posting ulang penyusutan' : 'Hapus jurnal penyusutan'}
        </button>}
      </>}
    </Section>}

    <Section title="Daftar aset tetap">
      {canPost && <div className="mb-3 flex justify-end"><button type="button" className={button} onClick={() => { setEditingId('new'); setDraft(emptyDraft()); window.requestAnimationFrame(() => formRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' })); }}>Tambah aset</button></div>}
      {editingId && <div ref={formRef} className="mb-4 rounded-lg border border-accent-200 bg-accent-50/30 p-4">
        <h3 className="mb-3 text-sm font-semibold text-slate-900">{editing ? `Ubah ${editing.name}` : 'Aset baru'}</h3>
        <div className="grid gap-3 md:grid-cols-2">
          <label className="text-xs font-medium text-slate-500">Nama aset<input className={`${field} mt-1`} maxLength={150} value={draft.name} onChange={(event) => setDraft({ ...draft, name: event.target.value })} placeholder="contoh: Mobil operasional Avanza" /></label>
          <label className="text-xs font-medium text-slate-500">Tanggal perolehan<input type="date" className={`${field} mt-1`} value={draft.acquisitionDate} onChange={(event) => setDraft({ ...draft, acquisitionDate: event.target.value })} /></label>
          <div className="text-xs font-medium text-slate-500">Akun aset<div className="mt-1"><SearchSelect aria-label="Akun aset" placeholder="Cari akun aset" options={assetAccountItems} value={draft.assetAccountId}
            onValueChange={(value) => setDraft((current) => ({ ...current, assetAccountId: value, accumulatedAccountId: current.accumulatedAccountId || suggestedAccumulatedAccountId(value, accounts) }))} /></div></div>
          <div className="text-xs font-medium text-slate-500">Akun akumulasi penyusutan<div className="mt-1"><SearchSelect aria-label="Akun akumulasi penyusutan" placeholder="Cari akun akumulasi" options={accumulatedItems} value={draft.accumulatedAccountId} onValueChange={(value) => setDraft({ ...draft, accumulatedAccountId: value })} /></div></div>
          <div className="text-xs font-medium text-slate-500">Akun beban penyusutan<div className="mt-1"><SearchSelect aria-label="Akun beban penyusutan" placeholder="Cari akun Pengeluaran" options={expenseItems} value={draft.expenseAccountId} onValueChange={(value) => setDraft({ ...draft, expenseAccountId: value })} /></div></div>
          <label className="text-xs font-medium text-slate-500">Umur manfaat (tahun)<input className={`${field} mt-1`} inputMode="numeric" value={draft.usefulLifeYears} onChange={(event) => setDraft({ ...draft, usefulLifeYears: event.target.value.replace(/\D/g, '').slice(0, 2) })} placeholder={`1–${MAX_USEFUL_LIFE_YEARS}, contoh: kendaraan 8, gedung 20`} /></label>
          <div className="text-xs font-medium text-slate-500">Harga perolehan<div className="mt-1"><CurrencyInput className={field} aria-label="Harga perolehan" value={draft.cost} onValue={(value) => setDraft((current) => ({ ...current, cost: value }))} /></div></div>
          <div className="text-xs font-medium text-slate-500">Nilai sisa di akhir umur (boleh 0)<div className="mt-1"><CurrencyInput className={field} aria-label="Nilai sisa" value={draft.residualValue} onValue={(value) => setDraft((current) => ({ ...current, residualValue: value }))} /></div></div>
        </div>
        {draftReady && <p className="mt-3 text-xs text-slate-500">Penyusutan sekitar {money(Math.floor((draft.cost - draft.residualValue) / (Number(draft.usefulLifeYears) * 12)))} per bulan selama {Number(draft.usefulLifeYears) * 12} bulan.</p>}
        <div className="mt-4 flex gap-2"><button type="button" className={button} disabled={busy || !draftReady} onClick={() => void save()}>{editing ? 'Simpan perubahan' : 'Tambah aset'}</button><button type="button" className={lightButton} onClick={closeForm}>Batal</button></div>
      </div>}
      <div className="overflow-x-auto"><table className="w-full min-w-[960px] text-sm"><thead><tr className="text-xs text-slate-500 [&_th]:font-medium">
        <th className={leftCell}>Aset</th><th className={leftCell}>Perolehan</th><th className={cell}>Harga</th><th className={cell}>Umur</th>
        <th className={cell}>Penyusutan {monthNames[reportMonth - 1].slice(0, 3)}</th><th className={cell}>Akumulasi s.d. {monthNames[reportMonth - 1].slice(0, 3)} {reportYear}</th><th className={cell}>Nilai buku</th>{canPost && <th className={leftCell}>Aksi</th>}
      </tr></thead><tbody>{[...assets].sort((a, b) => a.name.localeCompare(b.name, 'id')).map((asset) => {
        const accumulated = accumulatedDepreciation(asset, reportYear, reportMonth);
        return <tr key={asset.id} className={editingId === asset.id ? 'bg-amber-50' : ''}>
          <td className={leftCell}>{asset.name}<div className="text-xs text-slate-500">{nameOf(asset.assetAccountId)}</div></td>
          <td className={leftCell}>{asset.acquisitionDate}</td><td className={cell}>{money(asset.cost)}{asset.residualValue ? <div className="text-xs text-slate-500">sisa {money(asset.residualValue)}</div> : null}</td>
          <td className={cell}>{asset.usefulLifeMonths / 12} th</td><td className={cell}>{money(depreciationForMonth(asset, reportYear, reportMonth))}</td>
          <td className={cell}>{money(accumulated)}</td><td className={cell}>{money(asset.cost - accumulated)}</td>
          {canPost && <td className={leftCell}><div className="flex gap-1"><button type="button" className={`${lightButton} !px-2`} disabled={busy} onClick={() => startEdit(asset)}>Ubah</button><button type="button" className={`${dangerGhostButton} !px-2`} disabled={busy} onClick={() => void remove(asset)}>Hapus</button></div></td>}
        </tr>;
      })}</tbody></table>{!assets.length && <p className="p-3 text-sm text-slate-500">Belum ada aset tetap.</p>}</div>
    </Section>

    {scheduled.size > 0 && <Section title={`Akumulasi penyusutan: daftar aset dan buku, akhir ${monthNames[reportMonth - 1]} ${reportYear}`}>
      <p className="mb-3 text-sm text-slate-600">Bila semua penyusutan sudah diposting dan saldo awal akumulasinya sesuai, kedua angka ini sama. Selisih berarti ada aset yang belum terdaftar, saldo awal yang berbeda, atau jurnal manual pada akun akumulasi.</p>
      <div className="overflow-x-auto"><table className="w-full text-sm"><thead><tr className="text-xs text-slate-500 [&_th]:font-medium"><th className={leftCell}>Akun akumulasi</th><th className={cell}>Menurut daftar aset</th><th className={cell}>Saldo buku</th><th className={cell}>Selisih</th></tr></thead>
        <tbody>{[...scheduled].map(([id, total]) => {
          const row = rows.find((item) => accountId(item.account) === id);
          const book = row ? row.endingCredit - row.endingDebit : 0;
          return <tr key={id}><td className={leftCell}>{nameOf(id)}</td><td className={cell}>{money(total)}</td><td className={cell}>{money(book)}</td><td className={`${cell} ${book !== total ? 'text-amber-700' : ''}`}>{money(book - total)}</td></tr>;
        })}</tbody></table></div>
    </Section>}
  </div>;
}
