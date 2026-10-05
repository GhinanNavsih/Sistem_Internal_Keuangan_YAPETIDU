"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Image from 'next/image';
import { useAuth } from '@/lib/AuthContext';
import { useConfirmLogout } from '@/components/LogoutConfirmProvider';
import SatkerPekaryaNavBar from '@/components/SatkerPekaryaNavBar';
import { academicYearFor, buildFinancialStatements, fiscalMonths, FinancialAccount, JournalEntry, OpeningBalances } from '@/lib/satker-finance/core';
import type { FinancialUnit } from '@/lib/server/satkerFinance';
import { CurrencyInput } from '@/components/ui/currency-input';
import { SearchSelect } from '@/components/ui/search-select';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Download, FileCheck2, FilePlus2, Loader2, RefreshCw } from 'lucide-react';

type Statements = ReturnType<typeof buildFinancialStatements>;
type Report = {
  id: string; unitName?: string; monthIndex: number; status: string; revision: number; sourceRevision: number;
  snapshot: Statements; submittedName?: string; bakApprovedName?: string; rectorApprovedName?: string;
  submittedAt?: unknown; bakApprovedAt?: unknown; rectorApprovedAt?: unknown;
  revisionNotes?: string; verificationCode?: string;
};
type ResponseData = {
  units: FinancialUnit[]; accounts: FinancialAccount[]; editorUsers?: { uid: string; displayName: string; role: string }[];
  unit?: FinancialUnit; year?: { status: string; revision: number; entryCount: number; openingBalances: OpeningBalances };
  statements?: Statements; monthlyTrial?: { monthIndex: number; year: number; period: number; rows: { code: string; debit: number; credit: number }[] }[];
  annualStatements?: Statements;
  entries?: (JournalEntry & { hasReceipt?: boolean })[]; reports?: Report[]; events?: { id: string; action: string; actorUid: string; actorRole?: string; actorName?: string; at: unknown; details: Record<string, unknown> }[];
  reportRevisions?: { id: string; monthIndex: number; revision: number; submittedName: string; submittedAt: unknown; income: number; expense: number; endingCash: number }[];
  unitSummaries?: { unit: FinancialUnit; year: { status: string }; statements: Statements; report: Report | null }[];
  notifications?: { id: string; unitId: string; academicYear: string; monthIndex: number; title: string; message: string; readAt?: unknown; at?: unknown }[];
};
type Tab = 'ringkasan' | 'jurnal' | 'buku_besar' | 'neraca_saldo' | 'laba_rugi' | 'arus_kas' | 'neraca' | 'tahunan' | 'audit' | 'pengaturan';
type DraftLine = { accountCode: string; debit: string; credit: string };

const tabs: { id: Tab; label: string }[] = [
  { id: 'ringkasan', label: 'Ringkasan' }, { id: 'jurnal', label: 'Jurnal' }, { id: 'buku_besar', label: 'Buku Besar' },
  { id: 'neraca_saldo', label: 'Neraca Saldo' }, { id: 'laba_rugi', label: 'Laba Rugi' }, { id: 'arus_kas', label: 'Arus Kas' },
  { id: 'neraca', label: 'Neraca' }, { id: 'tahunan', label: 'Neraca Lajur Tahunan' }, { id: 'audit', label: 'Jejak Audit' },
  { id: 'pengaturan', label: 'Pengaturan' },
];
const monthNames = ['Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni', 'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember'];
const localToday = () => { const date = new Date(); return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`; };
const fmt = (value: number | undefined | null) => new Intl.NumberFormat('id-ID').format(value || 0);
const money = (value: number | undefined | null) => `Rp ${fmt(value)}`;
const dateText = (value: unknown) => {
  if (!value) return '—';
  if (typeof value === 'string') return value;
  const raw = value as { _seconds?: number; seconds?: number };
  const seconds = raw._seconds ?? raw.seconds;
  return seconds ? new Date(seconds * 1000).toLocaleString('id-ID') : '—';
};
// Styling follows SIMPEL_UI_THEME.md: navy accent, slate neutrals, no shadows, no bold/uppercase.
const field = 'w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-700 placeholder:text-slate-400 focus:border-accent-500 focus:outline-none focus:ring-2 focus:ring-accent-100';
const button = 'inline-flex items-center justify-center gap-2 rounded-md bg-accent-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-accent-700 disabled:cursor-not-allowed disabled:opacity-50';
const lightButton = 'inline-flex items-center justify-center gap-2 rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50';
const dangerGhostButton = 'inline-flex items-center justify-center gap-2 rounded-md px-3 py-1.5 text-sm font-medium text-red-700 hover:bg-red-50 disabled:opacity-50';
const selectTrigger = 'mt-1 h-9.5 w-full rounded-md border-slate-300 bg-white px-3 text-sm font-normal text-slate-700 shadow-none focus-visible:border-accent-500 focus-visible:ring-2 focus-visible:ring-accent-100';
const selectContent = 'max-h-72 rounded-lg border border-slate-200 bg-white p-1 text-slate-700 shadow-lg';
const selectItem = 'min-h-9 rounded-md px-3 py-1.5 text-sm text-slate-700 focus:bg-slate-50 focus:text-slate-900 data-highlighted:bg-slate-50 data-highlighted:text-slate-900';
// Base UI's SelectValue shows the raw value once the list closes unless the Select is given `items` to look the label up in.
const cashFlowItems = { OPERATING: 'Operasional', INVESTING: 'Investasi', FINANCING: 'Pendanaan' };
const normalBalanceItems = { DEBIT: 'Debet', CREDIT: 'Kredit' };
const reportTargetItems = { BALANCE_SHEET: 'Neraca', INCOME_STATEMENT: 'Laba Rugi' };
// A one-line entry is balanced against KAS automatically: money typed in Debet is a Pengeluaran, in Kredit a Penerimaan.
const DEFAULT_CASH_CODE = '10000';
const emptyLine = (): DraftLine => ({ accountCode: '', debit: '', credit: '' });
const cell = 'border-b border-slate-100 px-3 py-2 text-right tabular-nums';
const leftCell = 'border-b border-slate-100 px-3 py-2 text-left';

// One status per record, shown as a dot plus text (never a filled pill).
function Status({ status }: { status?: string }) {
  const dot = status === 'APPROVED' ? 'bg-green-500' : status === 'BAK_APPROVED' ? 'bg-accent-500' : status === 'SUBMITTED' ? 'bg-amber-500' : status === 'REVISION_REQUESTED' ? 'bg-red-500' : 'bg-slate-400';
  const label = status === 'APPROVED' ? 'Disahkan Rektorat' : status === 'BAK_APPROVED' ? 'Disetujui BAK' : status === 'SUBMITTED' ? 'Menunggu BAK' : status === 'REVISION_REQUESTED' ? 'Perlu revisi' : 'Draf';
  return <span className="inline-flex items-center gap-2 text-sm text-slate-700"><span className={`h-2 w-2 rounded-full ${dot}`} />{label}</span>;
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return <section className="rounded-lg border border-slate-200 bg-white p-5"><h2 className="mb-4 text-base font-semibold text-slate-900">{title}</h2>{children}</section>;
}

export default function SatkerFinancePage() {
  const { user, profile, activeProfile } = useAuth();
  const requestLogout = useConfirmLogout();
  const visibleProfile = activeProfile || profile;
  const initialYear = academicYearFor(new Date());
  const [yearStart, setYearStart] = useState(Number(initialYear.slice(0, 4)));
  const academicYear = `${yearStart}-${yearStart + 1}`;
  const [month, setMonth] = useState<number | 'ANNUAL'>(new Date().getMonth() + 1);
  const [unitId, setUnitId] = useState('');
  const [tab, setTab] = useState<Tab>('ringkasan');
  const [data, setData] = useState<ResponseData | null>(null);
  const [loading, setLoading] = useState(false);
  const loadSequence = useRef(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [reviewNote, setReviewNote] = useState('');
  const [voucherDate, setVoucherDate] = useState(localToday);
  const [voucherId, setVoucherId] = useState(() => crypto.randomUUID());
  const [description, setDescription] = useState('');
  const [cashFlowSection, setCashFlowSection] = useState('OPERATING');
  const [lines, setLines] = useState<DraftLine[]>([emptyLine()]);
  const [receipt, setReceipt] = useState<File | null>(null);
  const [receiptPreview, setReceiptPreview] = useState('');
  const [ledgerCode, setLedgerCode] = useState('10000');
  const [openingDraft, setOpeningDraft] = useState<OpeningBalances>({});
  const [unitDraft, setUnitDraft] = useState({ id: '', name: '', headName: '', adminName: '', editorUids: [] as string[], expectedRevision: 0 });
  const [accountEditCode, setAccountEditCode] = useState('');
  const [accountDraft, setAccountDraft] = useState({ name: '', normalBalance: 'DEBIT', reportTarget: 'BALANCE_SHEET', cashEquivalent: false, cashFlowSection: 'OPERATING' });
  const isAdmin = profile?.role === 'super_admin';
  const canReadAll = !!profile && ['super_admin', 'finance_verifier', 'rector_finance'].includes(profile.role);
  const canEdit = !!profile && (isAdmin || (['satker_head_loyalis', 'satker_finance_admin'].includes(profile.role) && data?.unit?.editorUids?.includes(profile.uid)));
  const selectedReport = month === 'ANNUAL' ? undefined : data?.reports?.find((item) => item.monthIndex === month);
  const months = useMemo(() => fiscalMonths(academicYear), [academicYear]);
  const postable = data?.accounts.filter((account) => account.postable) || [];
  const amountNumber = (value: string) => Number(value.replace(/[^0-9]/g, '')) || 0;
  const amountText = (value: number) => (value ? String(value) : '');
  const canPost = unitId !== 'ALL' && canEdit && data?.year?.status !== 'CLOSED';
  const draftDebit = lines.reduce((sum, line) => sum + amountNumber(line.debit), 0);
  const draftCredit = lines.reduce((sum, line) => sum + amountNumber(line.credit), 0);
  const oneSided = (line: DraftLine) => (amountNumber(line.debit) > 0) !== (amountNumber(line.credit) > 0);
  const draftValid = !!description.trim() && (lines.length === 1
    ? !!lines[0].accountCode && lines[0].accountCode !== DEFAULT_CASH_CODE && oneSided(lines[0])
    : lines.every((line) => line.accountCode && oneSided(line)) && draftDebit > 0 && draftDebit === draftCredit);
  const draftTouchesCash = lines.length > 1 && lines.some((line) => postable.find((account) => account.code === line.accountCode)?.cashEquivalent);
  const unitItems = [...(canReadAll ? [{ value: 'ALL', label: 'Konsolidasi seluruh SatKer' }] : []), ...(data?.units.map((unit) => ({ value: unit.id, label: unit.name })) || [])];
  const periodItems = [{ value: 'ANNUAL', label: 'Tahunan (Sep–Agu)' }, ...months.map((item) => ({ value: String(item.monthIndex), label: `${item.period}. ${monthNames[item.monthIndex - 1]} ${item.year}` }))];
  const accountItems = postable.map((account) => ({ value: account.code, label: `${account.code} · ${account.name}` }));
  const entryAccountItems = lines.length > 1 ? accountItems : accountItems.filter((item) => item.value !== DEFAULT_CASH_CODE);
  const allAccountItems = data?.accounts.map((account) => ({ value: account.code, label: `${account.code} · ${account.name || '(belum bernama)'}` })) || [];

  const load = useCallback(async (silent = false) => {
    if (!user) return;
    const sequence = ++loadSequence.current;
    if (!silent) { setLoading(true); setError(''); }
    try {
      const params = new URLSearchParams({ academicYear, month: String(month) });
      if (unitId) params.set('unitId', unitId);
      const response = await fetch(`/api/satker-finance?${params}`, { headers: { Authorization: `Bearer ${await user.getIdToken()}` }, cache: 'no-store' });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || 'Gagal memuat buku SatKer.');
      if (sequence !== loadSequence.current) return;
      setData(body);
      if (body.year) setOpeningDraft(body.year.openingBalances || {});
      if (body.unit && body.unit.id !== 'ALL') setUnitDraft({ id: body.unit.id, name: body.unit.name, headName: body.unit.headName || '', adminName: body.unit.adminName || '', editorUids: body.unit.editorUids || [], expectedRevision: body.unit.revision || 0 });
      if (!unitId && body.units?.length) setUnitId(body.units[0].id);
    } catch (cause) { if (sequence === loadSequence.current) setError(cause instanceof Error ? cause.message : 'Gagal memuat buku SatKer.'); }
    finally { if (sequence === loadSequence.current) setLoading(false); }
  }, [user, unitId, academicYear, month]);
  useEffect(() => { const id = window.setTimeout(() => { void load(); }, 0); return () => window.clearTimeout(id); }, [load]);
  useEffect(() => {
    if (tab !== 'ringkasan') return;
    const id = window.setInterval(() => { if (document.visibilityState === 'visible' && !busy) void load(true); }, 30_000);
    return () => window.clearInterval(id);
  }, [tab, busy, load]);

  const post = async (action: string, extra: Record<string, unknown> = {}) => {
    if (!user) return false;
    setBusy(true); setError(''); setSuccess('');
    try {
      const response = await fetch('/api/satker-finance', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${await user.getIdToken()}` },
        body: JSON.stringify({ action, unitId, academicYear, ...extra }) });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || 'Tindakan gagal.');
      setSuccess('Perubahan berhasil disimpan.');
      await load();
      return true;
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Tindakan gagal.'); return false; }
    finally { setBusy(false); }
  };

  const postVoucher = async () => {
    let receiptDataUrl: string | undefined;
    if (receipt) {
      if (!['image/jpeg', 'image/png', 'image/webp'].includes(receipt.type) || receipt.size > 5 * 1024 * 1024) { setError('Bukti harus JPG, PNG, atau WebP maksimal 5 MB.'); return; }
      receiptDataUrl = await new Promise<string>((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(String(reader.result)); reader.onerror = reject; reader.readAsDataURL(receipt); });
    }
    const targetMonth = Number(voucherDate.slice(5, 7));
    const [only] = lines;
    const voucher = lines.length === 1
      ? { kind: amountNumber(only.debit) > 0 ? 'EXPENSE' : 'INFLOW', accountCode: only.accountCode, paymentAccountCode: DEFAULT_CASH_CODE, amount: amountNumber(only.debit) || amountNumber(only.credit) }
      : { kind: 'ADVANCED', cashFlowSection, lines: lines.map((line) => ({ accountCode: line.accountCode, debit: amountNumber(line.debit), credit: amountNumber(line.credit) })) };
    const result = await post('POST_ENTRY', { entryId: voucherId, monthIndex: targetMonth, date: voucherDate, description, ...voucher, receiptDataUrl });
    if (result) { setVoucherId(crypto.randomUUID()); setDescription(''); setReceipt(null); setLines([emptyLine()]); }
  };

  const viewReceipt = async (entryId: string) => {
    if (!user) return;
    try {
      const params = new URLSearchParams({ unitId, academicYear, entryId });
      const response = await fetch(`/api/satker-finance/receipt?${params}`, { headers: { Authorization: `Bearer ${await user.getIdToken()}` } });
      if (!response.ok) throw new Error('Bukti tidak dapat dibuka.');
      if (receiptPreview) URL.revokeObjectURL(receiptPreview);
      setReceiptPreview(URL.createObjectURL(await response.blob()));
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Bukti tidak dapat dibuka.'); }
  };

  const downloadReport = async () => {
    if (!selectedReport || selectedReport.status !== 'APPROVED' || !selectedReport.verificationCode || !data?.unit) return;
    const [{ jsPDF }, { default: autoTable }, { default: QRCode }] = await Promise.all([import('jspdf'), import('jspdf-autotable'), import('qrcode')]);
    const pdf = new jsPDF();
    const snapshot = selectedReport.snapshot;
    const title = `Laporan Keuangan SatKer - ${selectedReport.unitName || data.unit.name}`;
    const period = `${monthNames[selectedReport.monthIndex - 1]} ${months.find((item) => item.monthIndex === selectedReport.monthIndex)?.year}`;
    pdf.setFontSize(16); pdf.text('UNIVERSITAS PESANTREN TINGGI DARUL ULUM', 14, 18);
    pdf.setFontSize(11); pdf.text(title, 14, 27); pdf.text(`Periode: ${period} | Tahun akademik ${academicYear}`, 14, 34);
    pdf.text(`Status: DISAHKAN | Revisi ${selectedReport.revision}`, 14, 41);
    autoTable(pdf, { startY: 48, head: [['Laporan Operasional', 'Rupiah']], body: [
      ['Jumlah penerimaan', fmt(snapshot.incomeStatement.income)], ['Jumlah pengeluaran', fmt(snapshot.incomeStatement.expense)],
      ['Surplus / (defisit)', fmt(snapshot.incomeStatement.surplus)],
    ], styles: { fontSize: 9 }, headStyles: { fillColor: [45, 58, 99] } });
    autoTable(pdf, { startY: 94, head: [['Arus Kas', 'Rupiah']], body: [
      ['Saldo awal kas dan bank', fmt(snapshot.cashFlow.openingCash)], ['Aktivitas operasional', fmt(snapshot.cashFlow.OPERATING)],
      ['Aktivitas investasi', fmt(snapshot.cashFlow.INVESTING)], ['Aktivitas pendanaan', fmt(snapshot.cashFlow.FINANCING)],
      ['Saldo akhir kas dan bank', fmt(snapshot.cashFlow.endingCash)], ['Selisih rekonsiliasi', fmt(snapshot.cashFlow.reconciliationDelta)],
    ], styles: { fontSize: 9 }, headStyles: { fillColor: [45, 58, 99] } });
    pdf.setFontSize(9);
    pdf.text(`Disusun SatKer: ${selectedReport.submittedName || '—'} · ${dateText(selectedReport.submittedAt)}`, 14, 160, { maxWidth: 145 });
    pdf.text(`Disetujui Kepala BAK: ${selectedReport.bakApprovedName || '—'} · ${dateText(selectedReport.bakApprovedAt)}`, 14, 170, { maxWidth: 145 });
    pdf.text(`Disahkan Rektorat: ${selectedReport.rectorApprovedName || '—'} · ${dateText(selectedReport.rectorApprovedAt)}`, 14, 180, { maxWidth: 145 });
    pdf.setFontSize(8); pdf.text(`Kode verifikasi: ${selectedReport.verificationCode}`, 14, 193);
    const url = new URL('/satker-finance/verify', window.location.origin);
    url.search = new URLSearchParams({ unitId, academicYear, month: String(selectedReport.monthIndex).padStart(2, '0'), code: selectedReport.verificationCode }).toString();
    pdf.addImage(await QRCode.toDataURL(url.toString(), { margin: 0, width: 220 }), 'PNG', 165, 160, 30, 30);
    pdf.addPage(); pdf.setFontSize(14); pdf.text('Rincian Laba Rugi', 14, 18);
    autoTable(pdf, { startY: 25, head: [['Kode', 'Akun', 'Penerimaan', 'Pengeluaran']], body: snapshot.incomeStatement.rows.map((row) => [row.account.code, row.account.name,
      row.account.type === 'TERIMA' ? fmt(row.creditMovement - row.debitMovement) : '', row.account.type === 'KELUAR' ? fmt(row.debitMovement - row.creditMovement) : '']),
      styles: { fontSize: 8 }, headStyles: { fillColor: [45, 58, 99] } });
    pdf.addPage(); pdf.setFontSize(14); pdf.text('Neraca Saldo', 14, 18);
    autoTable(pdf, { startY: 25, head: [['Kode', 'Akun', 'Debet', 'Kredit']], body: snapshot.rows.map((row) => [row.account.code, row.account.name, fmt(row.endingDebit), fmt(row.endingCredit)]),
      styles: { fontSize: 8 }, headStyles: { fillColor: [45, 58, 99] } });
    pdf.save(`Laporan-${unitId}-${academicYear}-${selectedReport.monthIndex}.pdf`);
  };

  const statement = data?.statements;
  const status = selectedReport?.status || 'DRAFT';
  const fiscalMonth = month === 'ANNUAL' ? null : months.find((item) => item.monthIndex === month);
  const previousApproved = !fiscalMonth || fiscalMonth.period === 1 || data?.reports?.some((item) => item.monthIndex === months[fiscalMonth.period - 2].monthIndex && item.status === 'APPROVED');
  const selectedLedger = postable.find((account) => account.code === ledgerCode);
  const ledger = useMemo(() => {
    const rows: { date: string; id: string; description: string; debit: number; credit: number; balance: number }[] = [];
    let balance = (data?.year?.openingBalances?.[ledgerCode]?.debit || 0) - (data?.year?.openingBalances?.[ledgerCode]?.credit || 0);
    const targetPeriod = month === 'ANNUAL' ? 12 : months.find((item) => item.monthIndex === month)?.period || 12;
    let beginning = balance;
    for (const entry of data?.entries || []) {
      const period = months.find((item) => item.monthIndex === entry.monthIndex)?.period || 0;
      if (period > targetPeriod) continue;
      for (const line of entry.lines.filter((item) => item.accountCode === ledgerCode)) {
        balance += line.debit - line.credit;
        if (month === 'ANNUAL' || period === targetPeriod) rows.push({ date: entry.date, id: entry.id, description: entry.description, debit: line.debit, credit: line.credit, balance });
      }
      if (period < targetPeriod && month !== 'ANNUAL') beginning = balance;
    }
    return { beginning, ending: balance, rows };
  }, [data?.entries, data?.year?.openingBalances, ledgerCode, month, months]);

  return <div className="min-h-screen bg-white text-slate-700">
    {visibleProfile?.role === 'satker_head_loyalis' && <SatkerPekaryaNavBar />}
    <div className="mx-auto max-w-[1600px] space-y-5 px-4 pt-6 pb-16 sm:px-8 sm:pt-8">
      {/* This page has no shell top bar, so the title sits in the toolbar row instead of a banner. */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-base font-semibold text-slate-900">Buku keuangan satuan kerja</h1>
        <div className="flex gap-2"><button className={`${lightButton} !px-2`} onClick={() => void load()} aria-label="Muat ulang" title="Muat ulang"><RefreshCw className="h-4 w-4" /></button>{['satker_finance_admin', 'rector_finance'].includes(visibleProfile?.role || '') && <button className={lightButton} onClick={requestLogout}>Keluar</button>}</div>
      </div>
      <div className="flex flex-wrap items-end gap-3 border-b border-slate-200 pb-5">
        <div className="min-w-60 flex-1 text-xs font-medium text-slate-500"><span id="satker-unit-label">Satuan Kerja</span><Select items={unitItems} value={unitId || null} onValueChange={(value) => setUnitId(value || '')}><SelectTrigger aria-labelledby="satker-unit-label" className={selectTrigger}><SelectValue placeholder="Pilih SatKer" /></SelectTrigger><SelectContent className={selectContent}>{canReadAll && <SelectItem className={selectItem} value="ALL">Konsolidasi seluruh SatKer</SelectItem>}{data?.units.map((unit) => <SelectItem className={selectItem} key={unit.id} value={unit.id}>{unit.name}</SelectItem>)}</SelectContent></Select></div>
        <label className="w-40 text-xs font-medium text-slate-500">Awal tahun akademik<input className={`${field} mt-1`} type="number" min="2020" max="2100" value={yearStart} onChange={(event) => { const start = Number(event.target.value); setYearStart(start); if (month !== 'ANNUAL') setVoucherDate(`${month >= 9 ? start : start + 1}-${String(month).padStart(2, '0')}-01`); }} /></label>
        <div className="w-52 text-xs font-medium text-slate-500"><span id="satker-period-label">Periode</span><Select items={periodItems} value={String(month)} onValueChange={(value) => { if (!value) return; const selected = value === 'ANNUAL' ? 'ANNUAL' : Number(value); setMonth(selected); if (selected !== 'ANNUAL') { const period = months.find((item) => item.monthIndex === selected); if (period) setVoucherDate(`${period.year}-${String(selected).padStart(2, '0')}-01`); } }}><SelectTrigger aria-labelledby="satker-period-label" className={selectTrigger}><SelectValue /></SelectTrigger><SelectContent className={selectContent}><SelectItem className={selectItem} value="ANNUAL">Tahunan (Sep–Agu)</SelectItem>{months.map((item) => <SelectItem className={selectItem} key={item.period} value={String(item.monthIndex)}>{item.period}. {monthNames[item.monthIndex - 1]} {item.year}</SelectItem>)}</SelectContent></Select></div>
        {data?.unit && unitId !== 'ALL' && <div className="pb-2"><Status status={status} /></div>}
      </div>
      {error && <div role="alert" className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800">{error}</div>}
      {success && <div role="status" className="rounded-lg border border-green-200 bg-green-50 p-3 text-sm text-green-800">{success}</div>}
      {!!data?.notifications?.filter((item) => !item.readAt).length && <Section title="Pemberitahuan Keuangan SatKer"><div className="space-y-2">{data.notifications.filter((item) => !item.readAt).map((item) => <div key={item.id} className="flex flex-wrap items-center justify-between gap-3 rounded-md bg-amber-50 p-3 text-sm"><div><strong className="font-semibold">{item.title}</strong><p className="text-slate-600">{item.message}</p></div><div className="flex gap-2"><button className={lightButton} onClick={() => { setUnitId(item.unitId); setYearStart(Number(item.academicYear.slice(0, 4))); setMonth(item.monthIndex); setTab('ringkasan'); }}>Buka</button><button className={lightButton} onClick={() => void post('READ_NOTIFICATION', { notificationId: item.id })}>Tandai dibaca</button></div></div>)}</div></Section>}
      {loading && <div className="flex items-center gap-2 text-sm text-slate-500"><Loader2 className="h-4 w-4 animate-spin" /> Memuat data keuangan...</div>}
      {!unitId && !loading && <Section title="Belum ada SatKer"><p className="text-sm text-slate-600">{isAdmin ? 'Buat SatKer pada tab Pengaturan untuk mulai menggunakan buku keuangan.' : 'BAK belum memberikan akses ke buku keuangan SatKer. Hubungi administrator.'}</p><button className={`${lightButton} mt-3`} onClick={() => setTab('pengaturan')}>Pengaturan</button></Section>}
      {data?.unit && <>
        <nav className="flex gap-6 overflow-x-auto border-b border-slate-200" aria-label="Bagian pelaporan keuangan">{tabs.filter((item) => item.id !== 'pengaturan' || isAdmin).map((item) => <button key={item.id} onClick={() => setTab(item.id)} aria-current={tab === item.id ? 'page' : undefined} className={`-mb-px shrink-0 border-b-2 px-1 py-2.5 text-sm ${tab === item.id ? 'border-accent-600 font-medium text-accent-700' : 'border-transparent text-slate-500 hover:text-slate-700'}`}>{item.label}</button>)}</nav>
        {tab === 'ringkasan' && statement && <div className="space-y-5">
          <dl className="grid grid-cols-2 gap-y-4 border-b border-slate-200 pb-5 xl:grid-cols-4 xl:divide-x xl:divide-slate-200">{[
            { label: 'Penerimaan', value: statement.incomeStatement.income }, { label: 'Pengeluaran', value: statement.incomeStatement.expense },
            { label: 'Surplus / defisit', value: statement.incomeStatement.surplus }, { label: 'Saldo kas & bank', value: statement.cashFlow.physicalCash },
          ].map((item) => <div key={item.label} className="xl:px-6 xl:first:pl-0"><dt className="text-xs text-slate-500">{item.label}</dt><dd className="mt-1 text-xl font-semibold tabular-nums text-slate-900">{money(item.value)}</dd></div>)}</dl>
          {unitId === 'ALL' && <Section title="Pemantauan seluruh SatKer"><div className="overflow-x-auto"><table className="w-full text-sm"><thead><tr className="text-xs text-slate-500 [&_th]:font-medium"><th className={leftCell}>SatKer</th><th className={cell}>Penerimaan</th><th className={cell}>Pengeluaran</th><th className={cell}>Kas akhir</th><th className={leftCell}>Status</th></tr></thead><tbody>{data.unitSummaries?.map((item) => <tr key={item.unit.id}><td className={leftCell}><button className="font-semibold text-accent-700 hover:underline" onClick={() => setUnitId(item.unit.id)}>{item.unit.name}</button></td><td className={cell}>{money(item.statements.incomeStatement.income)}</td><td className={cell}>{money(item.statements.incomeStatement.expense)}</td><td className={cell}>{money(item.statements.cashFlow.physicalCash)}</td><td className={leftCell}>{month === 'ANNUAL' ? item.year.status : <Status status={item.report?.status} />}</td></tr>)}</tbody></table></div></Section>}
          <Section title="Perkembangan 12 bulan"><div className="overflow-x-auto"><table className="w-full text-sm"><thead><tr className="text-xs text-slate-500 [&_th]:font-medium"><th className={leftCell}>Bulan</th><th className={cell}>Penerimaan</th><th className={cell}>Pengeluaran</th><th className={cell}>Surplus / Defisit</th><th className={cell}>Kas akhir</th><th className={leftCell}>Status</th></tr></thead><tbody>{(data.annualStatements || statement).monthlyIncome.map((item) => <tr key={item.period}><td className={leftCell}>{monthNames[item.monthIndex - 1]} {item.year}</td><td className={cell}>{money(item.income)}</td><td className={cell}>{money(item.expense)}</td><td className={cell}>{money(item.surplus)}</td><td className={cell}>{money(item.endingCash)}</td><td className={leftCell}>{unitId === 'ALL' ? '—' : <Status status={data.reports?.find((report) => report.monthIndex === item.monthIndex)?.status} />}</td></tr>)}</tbody></table></div></Section>
          {unitId !== 'ALL' && month !== 'ANNUAL' && <Section title="Pengajuan & persetujuan"><div className="flex flex-wrap items-center gap-3"><Status status={status} /><span className="text-sm text-slate-600">Selisih neraca saldo: {money(statement.trialBalance.difference)} · Selisih kas: {money(statement.cashFlow.reconciliationDelta)}</span></div>
            {selectedReport?.revisionNotes && <p className="mt-3 rounded-lg bg-red-50 p-3 text-sm text-red-800">Catatan revisi: {selectedReport.revisionNotes}</p>}
            <div className="mt-4 flex flex-wrap gap-2">{canEdit && ['DRAFT', 'REVISION_REQUESTED'].includes(status) && <button disabled={busy || !previousApproved || statement.trialBalance.difference !== 0 || statement.cashFlow.reconciliationDelta !== 0} className={button} onClick={() => void post('SUBMIT_REPORT', { monthIndex: month })}><FileCheck2 className="h-4 w-4" />Kirim laporan ke BAK</button>}
              {isAdmin && status === 'SUBMITTED' && <button disabled={busy} className={button} onClick={() => void post('BAK_APPROVE', { monthIndex: month, expectedRevision: selectedReport?.revision, note: reviewNote })}>Setujui sebagai Kepala BAK</button>}
              {profile?.role === 'rector_finance' && status === 'BAK_APPROVED' && <button disabled={busy} className={button} onClick={() => void post('RECTOR_APPROVE', { monthIndex: month, expectedRevision: selectedReport?.revision, note: reviewNote })}>Sahkan sebagai Rektorat</button>}
              {status === 'APPROVED' && <button className={lightButton} onClick={() => void downloadReport()}><Download className="h-4 w-4" />Unduh PDF resmi</button>}
            </div>
            {((isAdmin && status === 'SUBMITTED') || (profile?.role === 'rector_finance' && status === 'BAK_APPROVED')) && <div className="mt-4 max-w-2xl"><label className="text-xs font-medium text-slate-500">Catatan pemeriksaan / alasan revisi<textarea className={`${field} mt-1`} rows={2} value={reviewNote} onChange={(event) => setReviewNote(event.target.value)} /></label><button disabled={busy || !reviewNote.trim()} className={`${dangerGhostButton} mt-2`} onClick={() => void post(isAdmin ? 'BAK_REVISE' : 'RECTOR_REVISE', { monthIndex: month, expectedRevision: selectedReport?.revision, note: reviewNote })}>Minta revisi</button></div>}
            {!previousApproved && <p className="mt-3 rounded-lg bg-amber-50 p-3 text-sm text-amber-800">Laporan bulan sebelumnya harus disahkan lebih dahulu.</p>}
            <div className="mt-4 grid gap-2 text-xs text-slate-500 sm:grid-cols-3"><div>Disusun: {selectedReport?.submittedName || data.unit?.headName || '—'}<br />{dateText(selectedReport?.submittedAt)}</div><div>BAK: {selectedReport?.bakApprovedName || '—'}<br />{dateText(selectedReport?.bakApprovedAt)}</div><div>Rektorat: {selectedReport?.rectorApprovedName || '—'}<br />{dateText(selectedReport?.rectorApprovedAt)}</div></div>
          </Section>}
          {isAdmin && unitId !== 'ALL' && month === 'ANNUAL' && <Section title="Penutupan tahun buku"><p className="mb-3 text-sm text-slate-600">Tahun buku dapat ditutup setelah 12 bulan disahkan Rektorat dan laporan tahunan rekonsiliasi.</p><button className={button} disabled={busy || data.year?.status === 'CLOSED'} onClick={() => void post('CLOSE_YEAR')}>{data.year?.status === 'CLOSED' ? 'Tahun buku ditutup' : 'Tutup tahun buku'}</button></Section>}
        </div>}
        {tab === 'jurnal' && <div className="space-y-5"><Section title="Riwayat jurnal"><div className="overflow-x-auto"><table className="w-full min-w-[960px] text-sm"><thead><tr className="text-xs text-slate-500 [&_th]:font-medium"><th className={`${leftCell} w-40`}>Tanggal</th><th className={`${leftCell} min-w-64`}>Akun</th><th className={`${leftCell} min-w-56`}>Uraian</th><th className={`${cell} w-44`}>Debet</th><th className={`${cell} w-44`}>Kredit</th><th className={`${leftCell} w-44`}>Aksi</th></tr></thead>
            {canPost && <tbody className="bg-slate-50 align-top">
              {lines.map((line, index) => <tr key={index}>
                {index === 0 && <td rowSpan={lines.length + 1} className="border-b border-slate-200 px-3 py-2"><input type="date" aria-label="Tanggal transaksi" className={field} value={voucherDate} onChange={(event) => setVoucherDate(event.target.value)} /></td>}
                <td className="px-3 py-1.5"><div className="flex items-center gap-1">
                  <SearchSelect aria-label={`Akun baris ${index + 1}`} placeholder="Cari kode / nama akun" options={entryAccountItems} value={line.accountCode} onValueChange={(value) => setLines((current) => current.map((item, i) => i === index ? { ...item, accountCode: value } : item))} />
                  {lines.length > 1 && <button type="button" aria-label={`Hapus baris ${index + 1}`} className={`${lightButton} !px-2`} onClick={() => setLines((current) => { const next = current.filter((_, i) => i !== index); return next.length === 1 && next[0].accountCode === DEFAULT_CASH_CODE ? [{ ...next[0], accountCode: '' }] : next; })}>×</button>}
                </div></td>
                {index === 0 && <td rowSpan={lines.length + 1} className="border-b border-slate-200 px-3 py-2"><input aria-label="Uraian transaksi" className={field} value={description} onChange={(event) => setDescription(event.target.value)} placeholder="Tujuan pembayaran / penerimaan" /></td>}
                <td className="px-3 py-1.5"><CurrencyInput className={`${field} text-right`} aria-label={`Debet baris ${index + 1}`} value={amountNumber(line.debit)} onValue={(value) => setLines((current) => current.map((item, i) => i === index ? { ...item, debit: amountText(value) } : item))} /></td>
                <td className="px-3 py-1.5"><CurrencyInput className={`${field} text-right`} aria-label={`Kredit baris ${index + 1}`} value={amountNumber(line.credit)} onValue={(value) => setLines((current) => current.map((item, i) => i === index ? { ...item, credit: amountText(value) } : item))} /></td>
                {index === 0 && <td rowSpan={lines.length + 1} className="border-b border-slate-200 px-3 py-2"><div className="flex flex-col items-start gap-2">
                  <button type="button" className={button} disabled={busy || !draftValid} onClick={() => void postVoucher()}><FilePlus2 className="h-4 w-4" />Posting jurnal</button>
                  <label className="text-xs text-slate-500">Foto bukti (opsional, maks. 5 MB)<input key={voucherId} className="mt-1 block w-full text-xs" type="file" accept="image/jpeg,image/png,image/webp" onChange={(event) => setReceipt(event.target.files?.[0] || null)} /></label>
                </div></td>}
              </tr>)}
              <tr>
                <td className="border-b border-slate-200 px-3 py-1.5"><button type="button" className={lightButton} disabled={lines.length >= 30} onClick={() => setLines((current) => [...current, emptyLine()])}>Tambah baris</button>
                  {draftTouchesCash && <div className="mt-2 text-xs font-medium text-slate-500"><span id="voucher-cashflow-label">Klasifikasi arus kas</span><Select items={cashFlowItems} value={cashFlowSection} onValueChange={(value) => value && setCashFlowSection(value)}><SelectTrigger aria-labelledby="voucher-cashflow-label" className={selectTrigger}><SelectValue /></SelectTrigger><SelectContent className={selectContent}><SelectItem className={selectItem} value="OPERATING">Operasional</SelectItem><SelectItem className={selectItem} value="INVESTING">Investasi</SelectItem><SelectItem className={selectItem} value="FINANCING">Pendanaan</SelectItem></SelectContent></Select></div>}</td>
                <td className="border-b border-slate-200 px-3 py-1.5 text-right text-xs tabular-nums text-slate-600">{lines.length > 1 ? money(draftDebit) : ''}</td>
                <td className="border-b border-slate-200 px-3 py-1.5 text-right text-xs tabular-nums text-slate-600">{lines.length > 1 ? money(draftCredit) : ''}</td>
              </tr>
            </tbody>}
            {data.entries?.map((entry) => <tbody key={entry.id} className="align-top">{entry.lines.map((line, index) => {
            const last = index === entry.lines.length - 1;
            const rule = last ? 'border-b border-slate-100' : '';
            const span = entry.lines.length;
            return <tr key={index}>
              {index === 0 && <td rowSpan={span} className={leftCell}>{entry.date}</td>}
              <td className={`px-3 py-2 text-left ${rule}`}>{line.accountCode} · {line.accountName}</td>
              {index === 0 && <td rowSpan={span} className={`${leftCell} font-semibold`}>{entry.description}</td>}
              <td className={`px-3 py-2 text-right tabular-nums ${rule}`}>{line.debit ? money(line.debit) : ''}</td>
              <td className={`px-3 py-2 text-right tabular-nums ${rule}`}>{line.credit ? money(line.credit) : ''}</td>
              {index === 0 && <td rowSpan={span} className={leftCell}><div className="flex flex-col items-start gap-1">{entry.hasReceipt && <button className="text-accent-700 hover:underline" onClick={() => void viewReceipt(entry.id)}>Lihat bukti</button>}{canEdit && unitId !== 'ALL' && entry.kind !== 'REVERSAL' && data.year?.status !== 'CLOSED' && <button className="text-red-700 hover:underline" onClick={() => { const reason = window.prompt('Alasan pembalikan jurnal:'); if (reason?.trim()) void post('REVERSE_ENTRY', { sourceEntryId: entry.id, monthIndex: Number(voucherDate.slice(5, 7)), date: voucherDate, description: reason }); }}>Buat jurnal pembalik</button>}</div></td>}
            </tr>;
          })}</tbody>)}</table>{!data.entries?.length && !canPost && <p className="p-4 text-sm text-slate-500">Belum ada transaksi.</p>}</div></Section>
        </div>}
        {tab === 'buku_besar' && unitId !== 'ALL' && <Section title="Buku Besar"><div className="mb-4 max-w-lg text-xs font-medium text-slate-500"><span id="ledger-account-label">Akun</span><Select items={accountItems} value={ledgerCode} onValueChange={(value) => value && setLedgerCode(value)}><SelectTrigger aria-labelledby="ledger-account-label" className={selectTrigger}><SelectValue /></SelectTrigger><SelectContent className={selectContent}>{postable.map((account) => <SelectItem className={selectItem} key={account.code} value={account.code}>{account.code} · {account.name}</SelectItem>)}</SelectContent></Select></div><p className="mb-3 text-sm text-slate-600">Saldo awal periode {selectedLedger?.name}: {money(ledger.beginning)}</p><div className="overflow-x-auto"><table className="w-full text-sm"><thead><tr className="text-xs text-slate-500 [&_th]:font-medium"><th className={leftCell}>Tanggal</th><th className={leftCell}>Uraian</th><th className={cell}>Debet</th><th className={cell}>Kredit</th><th className={cell}>Saldo</th></tr></thead><tbody>{ledger.rows.map((row, index) => <tr key={`${row.id}-${index}`}><td className={leftCell}>{row.date}</td><td className={leftCell}>{row.description}</td><td className={cell}>{money(row.debit)}</td><td className={cell}>{money(row.credit)}</td><td className={cell}>{money(row.balance)}</td></tr>)}</tbody></table></div><p className="mt-3 text-sm font-semibold">Saldo akhir: {money(ledger.ending)} · {ledger.ending === ((statement?.rows.find((row) => row.account.code === ledgerCode)?.endingDebit || 0) - (statement?.rows.find((row) => row.account.code === ledgerCode)?.endingCredit || 0)) ? 'Alhamdulillah · sesuai neraca saldo' : 'Selisih dengan neraca saldo'}</p></Section>}
        {tab === 'neraca_saldo' && statement && <div className="space-y-5"><Section title="Neraca Saldo"><div className="overflow-x-auto"><table className="w-full text-sm"><thead><tr className="text-xs text-slate-500 [&_th]:font-medium"><th className={leftCell}>Kode</th><th className={leftCell}>Akun</th><th className={cell}>Saldo Debet</th><th className={cell}>Saldo Kredit</th></tr></thead><tbody>{statement.rows.map((row) => <tr key={row.account.code}><td className={leftCell}>{row.account.code}</td><td className={leftCell}>{row.account.name}</td><td className={cell}>{money(row.endingDebit)}</td><td className={cell}>{money(row.endingCredit)}</td></tr>)}</tbody><tfoot><tr className="bg-slate-50 font-semibold"><td colSpan={2} className={leftCell}>Total · Selisih {money(statement.trialBalance.difference)}</td><td className={cell}>{money(statement.trialBalance.debit)}</td><td className={cell}>{money(statement.trialBalance.credit)}</td></tr></tfoot></table></div></Section><Section title="Neraca Lajur Bulanan · Saldo Kumulatif"><div className="overflow-x-auto"><table className="w-full min-w-[1600px] text-xs"><thead><tr className="text-xs text-slate-500 [&_th]:font-medium"><th className={leftCell} rowSpan={2}>Akun</th>{data.monthlyTrial?.map((item) => <th className="border-b px-2 py-2 text-center" key={item.period} colSpan={2}>{monthNames[item.monthIndex - 1].slice(0, 3)} {item.year}</th>)}</tr><tr>{data.monthlyTrial?.map((item) => <FragmentPair key={item.period} />)}</tr></thead><tbody>{postable.map((account) => <tr key={account.code}><td className={leftCell}>{account.code} · {account.name}</td>{data.monthlyTrial?.map((item) => { const row = item.rows.find((value) => value.code === account.code); return <FragmentAmounts key={item.period} debit={row?.debit || 0} credit={row?.credit || 0} />; })}</tr>)}</tbody></table></div></Section></div>}
        {tab === 'laba_rugi' && statement && <Section title={`Laba Rugi ${month === 'ANNUAL' ? 'Tahunan' : monthNames[month - 1]}`}><div className="overflow-x-auto"><table className="w-full text-sm"><thead><tr className="text-xs text-slate-500 [&_th]:font-medium"><th className={leftCell}>Akun</th><th className={cell}>Penerimaan</th><th className={cell}>Pengeluaran</th></tr></thead><tbody>{statement.incomeStatement.rows.map((row) => <tr key={row.account.code}><td className={leftCell}>{row.account.code} · {row.account.name}</td><td className={cell}>{row.account.type === 'TERIMA' ? money(row.creditMovement - row.debitMovement) : '—'}</td><td className={cell}>{row.account.type === 'KELUAR' ? money(row.debitMovement - row.creditMovement) : '—'}</td></tr>)}</tbody><tfoot><tr className="bg-slate-50 font-semibold"><td className={leftCell}>Jumlah</td><td className={cell}>{money(statement.incomeStatement.income)}</td><td className={cell}>{money(statement.incomeStatement.expense)}</td></tr><tr className="font-semibold"><td className={leftCell}>Surplus / Defisit</td><td colSpan={2} className={cell}>{money(statement.incomeStatement.surplus)}</td></tr></tfoot></table></div></Section>}
        {tab === 'arus_kas' && statement && <Section title="Laporan Arus Kas"><div className="max-w-3xl space-y-2 text-sm">{[
          ['Saldo awal kas dan setara kas', statement.cashFlow.openingCash], ['I. Aktivitas operasional', statement.cashFlow.OPERATING],
          ['II. Aktivitas investasi', statement.cashFlow.INVESTING], ['III. Aktivitas pendanaan', statement.cashFlow.FINANCING],
          ['Perubahan bersih kas', statement.cashFlow.netChange], ['Saldo akhir kas menurut arus kas', statement.cashFlow.endingCash],
          ['Saldo fisik akun kas/bank', statement.cashFlow.physicalCash], ['Selisih rekonsiliasi', statement.cashFlow.reconciliationDelta],
        ].map(([label, value]) => <div key={String(label)} className="flex justify-between border-b border-slate-100 py-2"><span>{label}</span><strong className="font-semibold tabular-nums">{money(Number(value))}</strong></div>)}</div></Section>}
        {tab === 'neraca' && statement && <Section title="Neraca"><div className="grid gap-5 md:grid-cols-2">{(['AKTIVA', 'HUTANG', 'MODAL'] as const).map((type) => <div key={type}><h3 className="mb-2 text-sm font-semibold text-slate-900">{type}</h3>{statement.balanceSheet.rows.filter((row) => row.account.type === type).map((row) => <div key={row.account.code} className="flex justify-between gap-3 border-b py-2 text-sm"><span>{row.account.code} · {row.account.name}</span><strong className="font-semibold tabular-nums">{money(type === 'AKTIVA' ? row.endingDebit - row.endingCredit : row.endingCredit - row.endingDebit)}</strong></div>)}</div>)}</div><div className="mt-4 rounded-lg bg-accent-50 p-4 text-sm font-medium text-accent-800">Aktiva {money(statement.balanceSheet.assets)} · Hutang {money(statement.balanceSheet.liabilities)} · Modal {money(statement.balanceSheet.equity)} · Surplus berjalan {money(statement.balanceSheet.accumulatedSurplus)}</div></Section>}
        {tab === 'tahunan' && data.annualStatements && <Section title="Neraca Lajur Tahunan · 10 Kolom">
          <div className="overflow-x-auto"><table className="min-w-[1300px] w-full text-xs">
            <thead><tr className="text-xs text-slate-500 [&_th]:font-medium"><th className={leftCell} rowSpan={2}>Akun</th><th colSpan={2}>Saldo Awal</th><th colSpan={2}>Mutasi Tahunan</th><th colSpan={2}>Neraca Saldo</th><th colSpan={2}>Laba Rugi</th><th colSpan={2}>Neraca</th></tr><tr>{Array.from({ length: 5 }, (_, index) => <FragmentPair key={index} />)}</tr></thead>
            <tbody>{data.annualStatements.rows.map((row) => <tr key={row.account.code}><td className={leftCell}>{row.account.code} · {row.account.name}</td><FragmentAmounts debit={row.openingDebit} credit={row.openingCredit} /><FragmentAmounts debit={row.debitMovement} credit={row.creditMovement} /><FragmentAmounts debit={row.endingDebit} credit={row.endingCredit} /><FragmentAmounts debit={row.account.reportTarget === 'INCOME_STATEMENT' ? row.endingDebit : 0} credit={row.account.reportTarget === 'INCOME_STATEMENT' ? row.endingCredit : 0} /><FragmentAmounts debit={row.account.reportTarget === 'BALANCE_SHEET' ? row.endingDebit : 0} credit={row.account.reportTarget === 'BALANCE_SHEET' ? row.endingCredit : 0} /></tr>)}</tbody>
            <tfoot className="font-semibold">
              <tr><td className={leftCell}>Alokasi surplus / defisit</td><FragmentAmounts debit={0} credit={0} /><FragmentAmounts debit={0} credit={0} /><FragmentAmounts debit={0} credit={0} /><FragmentAmounts debit={Math.max(data.annualStatements.annualWorksheet.allocatedSurplus, 0)} credit={Math.max(-data.annualStatements.annualWorksheet.allocatedSurplus, 0)} /><FragmentAmounts debit={Math.max(-data.annualStatements.annualWorksheet.allocatedSurplus, 0)} credit={Math.max(data.annualStatements.annualWorksheet.allocatedSurplus, 0)} /></tr>
              <tr className="bg-slate-50"><td className={leftCell}>Total setelah alokasi</td><FragmentAmounts debit={data.annualStatements.rows.reduce((sum, row) => sum + row.openingDebit, 0)} credit={data.annualStatements.rows.reduce((sum, row) => sum + row.openingCredit, 0)} /><FragmentAmounts debit={data.annualStatements.rows.reduce((sum, row) => sum + row.debitMovement, 0)} credit={data.annualStatements.rows.reduce((sum, row) => sum + row.creditMovement, 0)} /><FragmentAmounts debit={data.annualStatements.trialBalance.debit} credit={data.annualStatements.trialBalance.credit} /><FragmentAmounts debit={data.annualStatements.annualWorksheet.incomeDebit} credit={data.annualStatements.annualWorksheet.incomeCredit} /><FragmentAmounts debit={data.annualStatements.annualWorksheet.balanceDebit} credit={data.annualStatements.annualWorksheet.balanceCredit} /></tr>
            </tfoot>
          </table></div>
          <p className="mt-3 text-sm font-semibold">Surplus / Defisit tahun berjalan: {money(data.annualStatements.annualWorksheet.allocatedSurplus)} · Selisih neraca saldo: {money(data.annualStatements.trialBalance.difference)}</p>
        </Section>}
        {tab === 'audit' && <div className="space-y-5"><Section title="Riwayat versi laporan"><div className="overflow-x-auto"><table className="w-full text-sm"><thead><tr className="text-xs text-slate-500 [&_th]:font-medium"><th className={leftCell}>Periode / versi</th><th className={leftCell}>Pengirim / waktu</th><th className={cell}>Penerimaan</th><th className={cell}>Pengeluaran</th><th className={cell}>Kas akhir</th></tr></thead><tbody>{data.reportRevisions?.map((item) => <tr key={item.id}><td className={leftCell}>{monthNames[item.monthIndex - 1]} · revisi {item.revision}</td><td className={leftCell}>{item.submittedName || '—'}<div className="text-xs text-slate-500">{dateText(item.submittedAt)}</div></td><td className={cell}>{money(item.income)}</td><td className={cell}>{money(item.expense)}</td><td className={cell}>{money(item.endingCash)}</td></tr>)}</tbody></table>{!data.reportRevisions?.length && <p className="p-3 text-sm text-slate-500">Belum ada versi laporan yang dikirim.</p>}</div></Section><Section title="Jejak Audit"><div className="space-y-2">{data.events?.map((event) => <div key={event.id} className="border-b border-slate-100 py-3 text-sm"><div className="flex flex-wrap justify-between gap-2"><strong className="font-semibold">{event.action.replaceAll('_', ' ')}</strong><span className="text-slate-500">{dateText(event.at)}</span></div><div className="mt-1 text-xs text-slate-500">Pelaku: {event.actorName || event.actorUid} ({event.actorRole || '—'}) · {JSON.stringify(event.details)}</div></div>)}{!data.events?.length && <p className="text-sm text-slate-500">Belum ada peristiwa audit.</p>}</div></Section></div>}
        {tab === 'pengaturan' && isAdmin && <div className="space-y-5"><Section title="Unit SatKer & pengelola"><div className="grid gap-3 md:grid-cols-2"><label className="text-xs font-medium text-slate-500">ID unik<input className={`${field} mt-1`} value={unitDraft.id} onChange={(event) => setUnitDraft({ ...unitDraft, id: event.target.value })} placeholder="puskomnet" /></label><label className="text-xs font-medium text-slate-500">Nama SatKer<input className={`${field} mt-1`} value={unitDraft.name} onChange={(event) => setUnitDraft({ ...unitDraft, name: event.target.value })} /></label><label className="text-xs font-medium text-slate-500">Nama Kepala SatKer<input className={`${field} mt-1`} value={unitDraft.headName} onChange={(event) => setUnitDraft({ ...unitDraft, headName: event.target.value })} /></label><label className="text-xs font-medium text-slate-500">Nama sekretariat / bendahara<input className={`${field} mt-1`} value={unitDraft.adminName} onChange={(event) => setUnitDraft({ ...unitDraft, adminName: event.target.value })} /></label></div><p className="mt-4 text-xs font-medium text-slate-500">Akun yang boleh mencatat dan mengirim laporan unit ini</p><div className="mt-2 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">{data.editorUsers?.map((editor) => <label key={editor.uid} className="flex items-center gap-2 rounded-md border border-slate-100 p-2 text-sm"><input type="checkbox" checked={unitDraft.editorUids.includes(editor.uid)} onChange={(event) => setUnitDraft({ ...unitDraft, editorUids: event.target.checked ? [...unitDraft.editorUids, editor.uid] : unitDraft.editorUids.filter((uid) => uid !== editor.uid) })} />{editor.displayName} <span className="text-xs text-slate-400">{editor.role}</span></label>)}</div><div className="mt-4 flex gap-2"><button className={button} disabled={busy} onClick={() => void post('SAVE_UNIT', unitDraft)}>Simpan SatKer</button><button className={lightButton} onClick={() => setUnitDraft({ id: '', name: '', headName: '', adminName: '', editorUids: [], expectedRevision: 0 })}>Unit baru</button></div></Section>
          {unitId !== 'ALL' && <Section title="Saldo awal 1 September"><p className="mb-3 text-sm text-slate-600">Saldo awal disetujui BAK dan harus seimbang. Terkunci setelah transaksi pertama.</p><div className="max-h-96 overflow-auto"><table className="w-full text-sm"><thead><tr className="text-xs text-slate-500 [&_th]:font-medium"><th className={leftCell}>Akun</th><th className={cell}>Debet</th><th className={cell}>Kredit</th></tr></thead><tbody>{postable.map((account) => <tr key={account.code}><td className={leftCell}>{account.code} · {account.name}</td>{(['debit', 'credit'] as const).map((side) => <td key={side} className={cell}><div className="ml-auto max-w-44"><CurrencyInput className={`${field} text-right`} aria-label={`${side === 'debit' ? 'Debet' : 'Kredit'} ${account.name}`} value={openingDraft[account.code]?.[side] || 0} onValue={(value) => setOpeningDraft((current) => ({ ...current, [account.code]: { debit: current[account.code]?.debit || 0, credit: current[account.code]?.credit || 0, [side]: value } }))} /></div></td>)}</tr>)}</tbody></table></div><p className="my-3 text-sm font-semibold">Total debet {money(Object.values(openingDraft).reduce((sum, item) => sum + item.debit, 0))} · kredit {money(Object.values(openingDraft).reduce((sum, item) => sum + item.credit, 0))}</p><button className={button} disabled={busy || !!data.year?.entryCount || data.year?.status === 'CLOSED'} onClick={() => void post('SAVE_OPENING', { openingBalances: openingDraft, expectedRevision: data.year?.revision || 0 })}>Simpan saldo awal</button></Section>}
          <Section title="Katalog akun 129 kode">
            <p className="mb-3 text-sm text-slate-600">Kode kosong pada buku sumber dapat diberi nama dan diaktifkan sebelum kode itu dipakai di saldo awal atau jurnal.</p>
            <div className="block max-w-md text-xs font-medium text-slate-500"><span id="account-code-label">Kode akun</span><Select items={allAccountItems} value={accountEditCode || null} onValueChange={(code) => { setAccountEditCode(code || ''); const account = data.accounts.find((item) => item.code === code); if (account) setAccountDraft({ name: account.name, normalBalance: account.normalBalance || 'DEBIT', reportTarget: account.reportTarget || (['TERIMA', 'KELUAR'].includes(account.type) ? 'INCOME_STATEMENT' : 'BALANCE_SHEET'), cashEquivalent: account.cashEquivalent, cashFlowSection: account.cashFlowSection || 'OPERATING' }); }}><SelectTrigger aria-labelledby="account-code-label" className={selectTrigger}><SelectValue placeholder="Pilih kode" /></SelectTrigger><SelectContent className={selectContent}>{data.accounts.map((account) => <SelectItem className={selectItem} key={account.code} value={account.code}>{account.code} · {account.name || '(belum bernama)'}</SelectItem>)}</SelectContent></Select></div>
            {accountEditCode && <div className="mt-3 grid gap-3 md:grid-cols-2">
              <label className="text-xs font-medium text-slate-500">Nama akun<input className={`${field} mt-1`} value={accountDraft.name} onChange={(event) => setAccountDraft({ ...accountDraft, name: event.target.value })} /></label>
              <div className="text-xs font-medium text-slate-500"><span id="account-normal-label">Pos saldo</span><Select items={normalBalanceItems} value={accountDraft.normalBalance} onValueChange={(value) => value && setAccountDraft((current) => ({ ...current, normalBalance: value }))}><SelectTrigger aria-labelledby="account-normal-label" className={selectTrigger}><SelectValue /></SelectTrigger><SelectContent className={selectContent}><SelectItem className={selectItem} value="DEBIT">Debet</SelectItem><SelectItem className={selectItem} value="CREDIT">Kredit</SelectItem></SelectContent></Select></div>
              <div className="text-xs font-medium text-slate-500"><span id="account-report-label">Pos laporan</span><Select items={reportTargetItems} value={accountDraft.reportTarget} onValueChange={(value) => value && setAccountDraft((current) => ({ ...current, reportTarget: value }))}><SelectTrigger aria-labelledby="account-report-label" className={selectTrigger}><SelectValue /></SelectTrigger><SelectContent className={selectContent}><SelectItem className={selectItem} value="BALANCE_SHEET">Neraca</SelectItem><SelectItem className={selectItem} value="INCOME_STATEMENT">Laba Rugi</SelectItem></SelectContent></Select></div>
              <div className="text-xs font-medium text-slate-500"><span id="account-cashflow-label">Arus kas</span><Select items={cashFlowItems} value={accountDraft.cashFlowSection} onValueChange={(value) => value && setAccountDraft((current) => ({ ...current, cashFlowSection: value }))}><SelectTrigger aria-labelledby="account-cashflow-label" className={selectTrigger}><SelectValue /></SelectTrigger><SelectContent className={selectContent}><SelectItem className={selectItem} value="OPERATING">Operasional</SelectItem><SelectItem className={selectItem} value="INVESTING">Investasi</SelectItem><SelectItem className={selectItem} value="FINANCING">Pendanaan</SelectItem></SelectContent></Select></div>
              <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={accountDraft.cashEquivalent} onChange={(event) => setAccountDraft({ ...accountDraft, cashEquivalent: event.target.checked })} />Akun kas atau bank</label>
              <button className={button} disabled={busy || !accountDraft.name.trim()} onClick={() => void post('SAVE_ACCOUNT', { code: accountEditCode, ...accountDraft, cashFlowSection: accountDraft.cashEquivalent ? null : accountDraft.cashFlowSection, expectedRevision: data.accounts.find((item) => item.code === accountEditCode)?.revision || 0 })}>Simpan akun</button>
            </div>}
          </Section></div>}
      </>}
    </div>
    {receiptPreview && <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/80 p-4" onClick={() => { URL.revokeObjectURL(receiptPreview); setReceiptPreview(''); }}><button className="absolute right-5 top-5 rounded-lg bg-white px-3 py-2 text-sm font-semibold">Tutup</button><Image src={receiptPreview} alt="Bukti transaksi" width={1000} height={1000} unoptimized className="max-h-[90vh] max-w-full object-contain" /></div>}
  </div>;
}

function FragmentPair() { return <><th className="border-b px-2 py-2 text-right font-medium">D</th><th className="border-b px-2 py-2 text-right font-medium">K</th></>; }
function FragmentAmounts({ debit, credit }: { debit: number; credit: number }) { return <><td className={cell}>{fmt(debit)}</td><td className={cell}>{fmt(credit)}</td></>; }
