"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Image from 'next/image';
import { useAuth } from '@/lib/AuthContext';
import { useConfirmLogout } from '@/components/LogoutConfirmProvider';
import AccountSwitcher from '@/components/AccountSwitcher';
import {
  accountId as financialAccountId, academicYearFor, buildFinancialStatements, cashFlowAllocation, CASH_FLOW_SECTIONS, defaultCashFlowSection,
  fiscalMonths, FinancialAccount, groupNormalBalance, hasAbnormalBalance, isCashAccount, JournalEntry, MAX_ENTRY_RECEIPT_BYTES, MAX_ENTRY_RECEIPTS, OpeningBalances, validateOpeningBalances, type AccountType, type CashFlowSection,
} from '@/lib/satker-finance/core';
import { entryChangeBlocker, reversedEntryIds } from '@/lib/satker-finance/entryEditing';
import { findNegativeCash } from '@/lib/satker-finance/negativeCash';
import { journalReceiptRefs, cashFlowStatementSections } from '@/lib/satker-finance/cashFlowStatement';
import { cashFlowSignaturesFrom, defaultCashFlowSignatures, type CashFlowSignatures, type SignatureEmployee } from '@/lib/satker-finance/signatures';
import { satkerInitials } from '@/lib/satker-finance/fileName';
import type { FixedAsset } from '@/lib/satker-finance/depreciation';
import type { BankReconciliation } from '@/lib/satker-finance/bankReconciliation';
import type { FinancialUnit } from '@/lib/server/satkerFinance';
import type { BookReadResult } from '@/lib/satker-finance/workbookBook';
import type { WorkBook } from 'xlsx';
import { fitUploadToLimit } from '@/lib/photoEvidence';
import { UPLOAD_ACCEPT, uploadFileProblem, uploadFileTypeFor, type UploadFileType } from '@/lib/uploadFileTypes';
import { Button } from '@/components/ui/button';
import { CurrencyInput } from '@/components/ui/currency-input';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { SearchSelect } from '@/components/ui/search-select';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import BankReconciliationPanel from '@/components/satker-finance/BankReconciliationPanel';
import FixedAssetsPanel from '@/components/satker-finance/FixedAssetsPanel';
import CashFlowSignatureSettings from '@/components/satker-finance/CashFlowSignatureSettings';
import EntryReceipts from '@/components/satker-finance/EntryReceipts';
import {
  button, cashFlowItems, cell, dangerGhostButton, field, fmt, leftCell, lightButton, money, monthNames, Section, selectContent, selectItem, selectTrigger,
} from '@/components/satker-finance/ui';
import { Download, FilePlus2, Loader2, Paperclip, Pencil, RefreshCw, Save, Trash2, X } from 'lucide-react';

type Statements = ReturnType<typeof buildFinancialStatements>;
// `revision` counts the edits of a journal (absent on one never edited); the server refuses a change made on an older one.
type EntryRecord = JournalEntry & { hasReceipt?: boolean; receiptCount?: number; revision?: number };
type ResponseData = {
  academicYear: string;
  units: FinancialUnit[]; accounts: FinancialAccount[]; globalAccounts?: FinancialAccount[]; accountCatalogRevision?: number; accountCatalogSource?: string | null; editorUsers?: { uid: string; displayName: string; role: string }[];
  unit?: FinancialUnit;
  year?: { revision: number; entryCount: number; openingBalances: OpeningBalances };
  fixedAssets?: FixedAsset[]; reconciliations?: BankReconciliation[];
  cashFlowSignatures?: CashFlowSignatures; signatureEmployees?: SignatureEmployee[];
  statements?: Statements; monthlyTrial?: { monthIndex: number; year: number; period: number; rows: { id: string; code: string; debit: number; credit: number }[] }[];
  annualStatements?: Statements;
  entries?: EntryRecord[]; events?: { id: string; action: string; actorUid: string; actorRole?: string; actorName?: string; at: unknown; details: Record<string, unknown> }[];
  unitSummaries?: { unit: FinancialUnit; statements: Statements }[];
};
type Tab = 'ringkasan' | 'jurnal' | 'buku_besar' | 'neraca_saldo' | 'laba_rugi' | 'arus_kas' | 'neraca' | 'rekonsiliasi' | 'aset_tetap' | 'tahunan' | 'audit' | 'akun' | 'pengaturan';
type DraftLine = { accountCode: string; description: string; debit: string; credit: string };

const tabs: { id: Tab; label: string }[] = [
  { id: 'ringkasan', label: 'Ringkasan' }, { id: 'jurnal', label: 'Jurnal' }, { id: 'akun', label: 'Akun' }, { id: 'arus_kas', label: 'Arus Kas' },
  { id: 'buku_besar', label: 'Buku Besar' }, { id: 'neraca_saldo', label: 'Neraca Saldo' }, { id: 'laba_rugi', label: 'Laba Rugi' },
  { id: 'neraca', label: 'Neraca' }, { id: 'rekonsiliasi', label: 'Rekonsiliasi Bank' }, { id: 'aset_tetap', label: 'Aset Tetap' },
  { id: 'tahunan', label: 'Neraca Lajur Tahunan' }, { id: 'audit', label: 'Jejak Audit' },
  { id: 'pengaturan', label: 'Pengaturan' },
];
// Tabs about one unit's own book; the consolidated view has no register, reconciliation, or catalog of its own.
const unitOnlyTabs: Tab[] = ['rekonsiliasi', 'aset_tetap', 'akun'];
const localToday = () => { const date = new Date(); return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`; };
const dateText = (value: unknown) => {
  if (!value) return '—';
  if (typeof value === 'string') return value;
  const raw = value as { _seconds?: number; seconds?: number };
  const seconds = raw._seconds ?? raw.seconds;
  return seconds ? new Date(seconds * 1000).toLocaleString('id-ID') : '—';
};
const normalBalanceItems = { DEBIT: 'Debet', CREDIT: 'Kredit' };
const reportTargetItems = { BALANCE_SHEET: 'Neraca', INCOME_STATEMENT: 'Laba Rugi' };
const accountTypeItems: Record<AccountType, string> = { AKTIVA: 'Aktiva', HUTANG: 'Hutang', MODAL: 'Modal', TERIMA: 'Penerimaan', KELUAR: 'Pengeluaran' };
const emptyLine = (): DraftLine => ({ accountCode: '', description: '', debit: '', credit: '' });
// Journal lines are tinted by side so Debet and Kredit read apart at a glance.
const debitRow = 'bg-sky-50';
const creditRow = 'bg-emerald-50';

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
  // Receipts loaded so far while the Arus Kas PDF is being built.
  const [cashFlowSignatures, setCashFlowSignatures] = useState<CashFlowSignatures>(() => defaultCashFlowSignatures());
  const [cashFlowPrint, setCashFlowPrint] = useState<{ loaded: number; total: number } | null>(null);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [voucherDate, setVoucherDate] = useState(localToday);
  const [voucherId, setVoucherId] = useState(() => crypto.randomUUID());
  const [lines, setLines] = useState<DraftLine[]>([emptyLine(), emptyLine()]);
  const [receipts, setReceipts] = useState<File[]>([]);
  const [preparingReceipts, setPreparingReceipts] = useState(false);
  // The journal being edited in the form above the table, and the draft that was in the form before the edit began.
  const [editingEntry, setEditingEntry] = useState<EntryRecord | null>(null);
  // Journals whose receipts are shown in an expanded row under the journal in the Riwayat jurnal table.
  const [expandedReceipts, setExpandedReceipts] = useState<Set<string>>(new Set());
  const toggleReceipts = (entryId: string) => setExpandedReceipts((current) => { const next = new Set(current); if (next.has(entryId)) next.delete(entryId); else next.add(entryId); return next; });
  const [removedReceiptIndexes, setRemovedReceiptIndexes] = useState<number[]>([]);
  // Saved receipts keep their original preview indexes until the edit is saved.
  const originalReceiptCount = editingEntry?.receiptCount ?? 0;
  const savedReceiptCount = originalReceiptCount - removedReceiptIndexes.length;
  const draftBeforeEdit = useRef<{ lines: DraftLine[]; voucherDate: string; receipts: File[] } | null>(null);
  const composerRef = useRef<HTMLTableSectionElement>(null);
  const receiptInputRef = useRef<HTMLInputElement>(null);
  const [deletingEntry, setDeletingEntry] = useState<EntryRecord | null>(null);
  const [deleteReason, setDeleteReason] = useState('');
  const [receiptPreview, setReceiptPreview] = useState('');
  const [receiptPreviewType, setReceiptPreviewType] = useState<UploadFileType | null>(null);
  const [ledgerCode, setLedgerCode] = useState('10000');
  const [openingDraft, setOpeningDraft] = useState<OpeningBalances>({});
  const [unitDraft, setUnitDraft] = useState({ id: '', name: '', headName: '', adminName: '', editorUids: [] as string[], expectedRevision: 0 });
  const [accountEditCode, setAccountEditCode] = useState('');
  const [accountDraft, setAccountDraft] = useState({ name: '', normalBalance: 'DEBIT', reportTarget: 'BALANCE_SHEET', cashEquivalent: false, cashFlowSection: 'OPERATING' });
  const [unitAccountId, setUnitAccountId] = useState('');
  const [unitAccountDraft, setUnitAccountDraft] = useState<{ code: string; name: string; type: AccountType; cashEquivalent: boolean; contra: boolean; cashFlowSection: CashFlowSection }>(
    { code: '', name: '', type: 'AKTIVA', cashEquivalent: false, contra: false, cashFlowSection: 'OPERATING' });
  const [creatingUnitAccount, setCreatingUnitAccount] = useState(false);
  // The workbook chosen for import, and what its Akun and Jurnal sheets read as for this unit.
  const [bookFile, setBookFile] = useState<{ fileName: string; workbook: WorkBook; akun: string; jurnal: string } | null>(null);
  const [bookCheck, setBookCheck] = useState<BookReadResult | null>(null);
  const unitAccountEditorRef = useRef<HTMLDivElement>(null);
  const isAdmin = profile?.role === 'super_admin';
  const canReadAll = !!profile && ['super_admin', 'finance_verifier', 'rector_finance'].includes(profile.role);
  const canEdit = !!profile && (isAdmin || (['satker_head_loyalis', 'satker_finance_admin'].includes(profile.role) && data?.unit?.editorUids?.includes(profile.uid)));
  const months = useMemo(() => fiscalMonths(academicYear), [academicYear]);
  const reversedIds = useMemo(() => reversedEntryIds(data?.entries || []), [data?.entries]);
  const cashFlowReceipts = useMemo(() => month === 'ANNUAL' ? [] : journalReceiptRefs({ entries: data?.entries || [], accounts: data?.accounts || [], academicYear, monthIndex: month }), [data?.entries, data?.accounts, academicYear, month]);
  const postable = useMemo(() => (data?.accounts.filter((account) => account.postable) || []).sort((a, b) => a.code.localeCompare(b.code, undefined, { numeric: true })), [data?.accounts]);
  const amountNumber = (value: string) => Number(value.replace(/[^0-9]/g, '')) || 0;
  const amountText = (value: number) => (value ? String(value) : '');
  const canPost = unitId !== 'ALL' && canEdit;
  const draftDebit = lines.reduce((sum, line) => sum + amountNumber(line.debit), 0);
  const draftCredit = lines.reduce((sum, line) => sum + amountNumber(line.credit), 0);
  const oneSided = (line: DraftLine) => (amountNumber(line.debit) > 0) !== (amountNumber(line.credit) > 0);
  // The entry's own description is its first filled-in line description; every line keeps its own as well.
  const entryDescription = lines.map((line) => line.description.trim()).find(Boolean) || '';
  const draftValid = !!entryDescription && lines.every((line) => line.accountCode && oneSided(line)) && draftDebit > 0 && draftDebit === draftCredit;
  // Says what is still missing while "Posting jurnal" is greyed out.
  const draftHint = !lines.every((line) => line.accountCode) ? 'Pilih akun di setiap baris.'
    : !lines.every(oneSided) ? 'Isi Debet atau Kredit (salah satu) di setiap baris.'
    : !entryDescription ? 'Isi uraian pada salah satu baris.'
    : draftDebit !== draftCredit ? 'Debet dan Kredit harus sama.' : '';
  // Where the draft's cash goes, split by each counter account's own classification; the server derives the same split.
  const draftCashFlows = (() => {
    const filled = lines.filter((line) => line.accountCode && (amountNumber(line.debit) || amountNumber(line.credit)))
      .map((line) => ({ accountCode: line.accountCode, debit: amountNumber(line.debit), credit: amountNumber(line.credit) }));
    try { return { flows: cashFlowAllocation(filled, postable), error: '' }; }
    catch (cause) { return { flows: null, error: cause instanceof Error ? cause.message : 'Klasifikasi arus kas tidak lengkap.' }; }
  })();
  const draftCashFlowParts = draftCashFlows.flows ? CASH_FLOW_SECTIONS.filter((section) => draftCashFlows.flows![section] !== 0)
    .map((section) => `${cashFlowItems[section]} ${draftCashFlows.flows![section] > 0 ? '+' : '−'}${money(Math.abs(draftCashFlows.flows![section]))}`) : [];
  // Warns, without blocking, when the draft would leave KAS or a bank account below zero on or after its date.
  const draftNegativeCash = canPost ? findNegativeCash({
    accounts: postable, opening: data?.year?.openingBalances || {}, entries: data?.entries || [], academicYear, editingEntryId: editingEntry?.id,
    draft: { date: voucherDate, lines: lines.filter((line) => line.accountCode && (amountNumber(line.debit) || amountNumber(line.credit))).map((line) => ({ accountCode: line.accountCode, debit: amountNumber(line.debit), credit: amountNumber(line.credit) })) },
  }) : [];
  const unitItems = [...(canReadAll ? [{ value: 'ALL', label: 'Konsolidasi seluruh SatKer' }] : []), ...(data?.units.map((unit) => ({ value: unit.id, label: unit.name })) || [])];
  const periodItems = [{ value: 'ANNUAL', label: 'Tahunan (Sep–Agu)' }, ...months.map((item) => ({ value: String(item.monthIndex), label: `${monthNames[item.monthIndex - 1]} ${item.year}` }))];
  const accountItems = postable.map((account) => ({ value: financialAccountId(account), label: `${account.code} · ${account.name}` }));
  const globalAccounts = data?.globalAccounts || data?.accounts || [];
  const allAccountItems = globalAccounts.map((account) => ({ value: financialAccountId(account), label: `${account.code} · ${account.name || '(belum bernama)'}` }));

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
      setCashFlowSignatures(cashFlowSignaturesFrom(body.cashFlowSignatures, defaultCashFlowSignatures(body.unit?.headName, body.signatureEmployees)));
      setOpeningDraft(body.year?.openingBalances || {});
      if (body.unit && body.unit.id !== 'ALL') setUnitDraft({ id: body.unit.id, name: body.unit.name, headName: body.unit.headName || '', adminName: body.unit.adminName || '', editorUids: body.unit.editorUids || [], expectedRevision: body.unit.revision || 0 });
      if (!unitId && body.units?.length) setUnitId(body.units[0].id);
    } catch (cause) { if (sequence === loadSequence.current) setError(cause instanceof Error ? cause.message : 'Gagal memuat buku SatKer.'); }
    finally { if (sequence === loadSequence.current) setLoading(false); }
  }, [user, unitId, academicYear, month]);
  useEffect(() => { const id = window.setTimeout(() => { void load(); }, 0); return () => window.clearTimeout(id); }, [load]);
  useEffect(() => {
    if (!creatingUnitAccount && !unitAccountId) return;
    const editor = unitAccountEditorRef.current;
    editor?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    editor?.querySelector<HTMLInputElement>('input')?.focus({ preventScroll: true });
  }, [creatingUnitAccount, unitAccountId]);
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

  const saveUnitAccount = async () => {
    const existing = data?.accounts.find((account) => account.localAccountId === unitAccountId);
    const saved = await post('SAVE_UNIT_ACCOUNT', {
      ...(unitAccountId ? { accountId: unitAccountId } : {}),
      ...unitAccountDraft,
      code: unitAccountDraft.code.trim(),
      expectedRevision: existing?.revision || 0,
      expectedCatalogRevision: data?.accountCatalogRevision || 0,
    });
    if (saved) {
      setUnitAccountId('');
      setCreatingUnitAccount(false);
      setUnitAccountDraft({ code: '', name: '', type: 'AKTIVA', cashEquivalent: false, contra: false, cashFlowSection: 'OPERATING' });
    }
  };

  // The sheet whose name shares the most words with the unit's name, so the usual Akun and Jurnal pair is preselected.
  const sheetFor = (names: string[], prefix: string, unitName: string) => {
    const words = unitName.toLowerCase().split(/\s+/).filter((word) => word.length > 2);
    const score = (name: string) => words.filter((word) => name.toLowerCase().includes(word)).length;
    const best = names.filter((name) => name.startsWith(prefix)).sort((a, b) => score(b) - score(a))[0];
    return best && score(best) > 0 ? best : '';
  };

  const readBookFile = async (file: File) => {
    try {
      const XLSX = await import('xlsx');
      const workbook = XLSX.read(await file.arrayBuffer(), { type: 'array', cellFormula: true });
      const unitName = data?.unit?.name || '';
      setBookFile({ fileName: file.name, workbook, akun: sheetFor(workbook.SheetNames, 'Akun ', unitName), jurnal: sheetFor(workbook.SheetNames, 'Jurnal ', unitName) });
      setBookCheck(null);
      setError('');
    } catch { setError('Berkas tidak dapat dibaca. Pastikan berkasnya berformat .xlsx.'); }
  };

  const checkBookFile = async () => {
    if (!bookFile?.akun || !bookFile.jurnal) return;
    const { readBookWorkbook } = await import('@/lib/satker-finance/workbookBook');
    setBookCheck(readBookWorkbook({ akun: bookFile.workbook.Sheets[bookFile.akun], akunLabel: bookFile.akun,
      jurnal: bookFile.workbook.Sheets[bookFile.jurnal], jurnalLabel: bookFile.jurnal, academicYear }));
  };

  const importBook = async () => {
    const book = bookCheck?.book;
    if (!book || !window.confirm(`Impor ${book.accounts.length} akun dan ${book.vouchers.length} jurnal ke ${data?.unit?.name || 'SatKer'} tahun ${academicYear}? Buku harus masih kosong.`)) return;
    const saved = await post('IMPORT_BOOK', { accounts: book.accounts, opening: book.opening, vouchers: book.vouchers });
    if (saved) { setBookFile(null); setBookCheck(null); }
  };

  // Puts the form back as it was before an edit began (or empty), and ends the edit.
  const leaveEdit = () => {
    const draft = draftBeforeEdit.current;
    draftBeforeEdit.current = null;
    setEditingEntry(null);
    setRemovedReceiptIndexes([]);
    setVoucherId(crypto.randomUUID());
    setReceipts(draft?.receipts ?? []);
    setLines(draft?.lines ?? [emptyLine(), emptyLine()]);
    if (draft) setVoucherDate(draft.voucherDate);
  };
  const cancelEdit = () => { if (editingEntry) leaveEdit(); };
  const selectUnit = (id: string) => {
    cancelEdit();
    setUnitAccountId('');
    setCreatingUnitAccount(false);
    if (id === 'ALL') setTab('ringkasan');
    setUnitId(id);
  };

  // Loads a posted journal into the form in its own row. Journals posted with one uraian for the whole entry get it on every line.
  const startEdit = (entry: EntryRecord) => {
    if (!editingEntry) draftBeforeEdit.current = { lines, voucherDate, receipts };
    const sharedDescription = entry.lines.some((line) => line.description) ? '' : entry.description;
    setEditingEntry(entry);
    setRemovedReceiptIndexes([]);
    setVoucherId(crypto.randomUUID());
    setVoucherDate(entry.date);
    setReceipts([]);
    setLines(entry.lines.map((line) => ({ accountCode: line.accountCode, description: line.description || sharedDescription, debit: amountText(line.debit), credit: amountText(line.credit) })));
    setError(''); setSuccess('');
    window.requestAnimationFrame(() => composerRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' }));
  };

  // Adds the picked files to the receipts, each compressed to MAX_ENTRY_RECEIPT_BYTES (photos only; a PDF over the limit is refused).
  // Files that cannot be added are named in the error; the others are kept.
  const addReceipts = async (picked: File[]) => {
    setPreparingReceipts(true);
    setError('');
    const added: File[] = [];
    const failures: string[] = [];
    for (const file of picked) {
      if (savedReceiptCount + receipts.length + added.length >= MAX_ENTRY_RECEIPTS) { failures.push(`${file.name}: satu jurnal maksimal memiliki ${MAX_ENTRY_RECEIPTS} bukti.`); continue; }
      const problem = uploadFileProblem(file, Number.POSITIVE_INFINITY);
      if (problem) { failures.push(`${file.name}: ${problem}`); continue; }
      try { added.push(await fitUploadToLimit(file, MAX_ENTRY_RECEIPT_BYTES)); }
      catch (cause) { failures.push(`${file.name}: ${cause instanceof Error ? cause.message : 'tidak dapat diproses.'}`); }
    }
    if (added.length) setReceipts((current) => [...current, ...added]);
    if (failures.length) setError(`Tidak ditambahkan — ${failures.join(' ')}`);
    setPreparingReceipts(false);
  };

  const postVoucher = async () => {
    for (const receipt of receipts) {
      const problem = uploadFileProblem(receipt);
      if (problem) { setError(problem); return; }
    }
    const receiptDataUrls = await Promise.all(receipts.map((receipt) => new Promise<string>((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(String(reader.result)); reader.onerror = reject; reader.readAsDataURL(receipt); })));
    const targetMonth = Number(voucherDate.slice(5, 7));
    const voucher = {
      monthIndex: targetMonth, date: voucherDate, description: entryDescription, kind: 'ADVANCED',
      lines: lines.map((line) => ({ accountCode: line.accountCode, description: line.description.trim(), debit: amountNumber(line.debit), credit: amountNumber(line.credit) })),
      ...(receiptDataUrls.length ? { receiptDataUrls } : {}),
    };
    if (editingEntry) {
      if (await post('UPDATE_ENTRY', { ...voucher, entryId: editingEntry.id, expectedRevision: editingEntry.revision ?? 0, removedReceiptIndexes })) leaveEdit();
      return;
    }
    const result = await post('POST_ENTRY', { entryId: voucherId, ...voucher });
    if (result) { setVoucherId(crypto.randomUUID()); setReceipts([]); setLines([emptyLine(), emptyLine()]); }
  };

  const openDelete = (entry: EntryRecord) => { setError(''); setSuccess(''); setDeleteReason(''); setDeletingEntry(entry); };
  const closeDelete = () => { setDeletingEntry(null); setDeleteReason(''); };

  const deleteEntry = async () => {
    if (!deletingEntry || deleteReason.trim().length < 3) return;
    const target = deletingEntry;
    if (await post('DELETE_ENTRY', { entryId: target.id, expectedRevision: target.revision ?? 0, reason: deleteReason.trim() })) {
      if (editingEntry?.id === target.id) leaveEdit();
      closeDelete();
    }
  };

  // A journal's receipt, or a bank reconciliation's statement.
  const viewReceipt = async (target: { entryId: string; index: string } | { reconciliationId: string }) => {
    if (!user) return;
    try {
      const params = new URLSearchParams({ unitId, academicYear, ...target });
      const response = await fetch(`/api/satker-finance/receipt?${params}`, { headers: { Authorization: `Bearer ${await user.getIdToken()}` } });
      if (!response.ok) throw new Error('Bukti tidak dapat dibuka.');
      if (receiptPreview) URL.revokeObjectURL(receiptPreview);
      const blob = await response.blob();
      setReceiptPreviewType(uploadFileTypeFor(blob.type));
      setReceiptPreview(URL.createObjectURL(blob));
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Bukti tidak dapat dibuka.'); }
  };

  // The month's Laporan Arus Kas followed by the receipts of its cash journals, ready to print.
  const downloadCashFlowReport = async () => {
    const current = data?.statements;
    if (!user || !data?.unit || data.unit.id !== unitId || !current || month === 'ANNUAL' || loading) return;
    setCashFlowPrint({ loaded: 0, total: cashFlowReceipts.length }); setError(''); setSuccess('');
    try {
      const [{ generateCashFlowReportPdf }, { receiptPageImages }] = await Promise.all([import('@/utils/generateSatkerCashFlowPdf'), import('@/utils/satkerReceiptImages')]);
      const cashMonth = months.find((item) => item.monthIndex === month);
      const period = `${monthNames[month - 1]} ${cashMonth?.year}`;
      const { pdf, missing } = await generateCashFlowReportPdf({
        unitName: data.unit.name,
        period,
        sections: cashFlowStatementSections({ entries: data.entries || [], accounts: data.accounts, academicYear, monthIndex: month }),
        openingCash: current.cashFlow.openingCash,
        cashAccounts: current.rows.filter((row) => isCashAccount(row.account) && (row.endingDebit !== 0 || row.endingCredit !== 0)).map((row) => ({ code: row.account.code, name: row.account.name, balance: row.endingDebit - row.endingCredit })),
        signatures: cashFlowSignatures,
        receipts: cashFlowReceipts.map((ref) => ({ ...ref, load: async () => {
          const params = new URLSearchParams({ unitId, academicYear, entryId: ref.entryId, index: String(ref.index) });
          const response = await fetch(`/api/satker-finance/receipt?${params}`, { headers: { Authorization: `Bearer ${await user.getIdToken()}` } });
          if (!response.ok) throw new Error('Bukti tidak dapat dibuka.');
          return receiptPageImages(await response.blob());
        } })),
        onProgress: (loaded, total) => setCashFlowPrint({ loaded, total }),
      });
      pdf.save(`Lap Arus Kas - ${satkerInitials(data.unit.name)} - ${monthNames[month - 1].slice(0, 3)}${String(cashMonth?.year).slice(-2)}.pdf`);
      if (missing) setError(`${missing} bukti tidak dapat dimuat; halamannya di PDF diberi catatan. Buka bukti tersebut dari tab Jurnal.`);
      else setSuccess('PDF Arus Kas dan bukti berhasil dibuat.');
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'PDF Arus Kas gagal dibuat.'); }
    finally { setCashFlowPrint(null); }
  };

  const statement = data?.statements;
  // A specific month shows only its own column in the monthly trial; ANNUAL keeps all twelve.
  const shownTrial = data?.monthlyTrial?.filter((item) => month === 'ANNUAL' || item.monthIndex === month) || [];
  const selectedLedger = postable.find((account) => financialAccountId(account) === ledgerCode);
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
        if (month === 'ANNUAL' || period === targetPeriod) rows.push({ date: entry.date, id: entry.id, description: line.description || entry.description, debit: line.debit, credit: line.credit, balance });
      }
      if (period < targetPeriod && month !== 'ANNUAL') beginning = balance;
    }
    return { beginning, ending: balance, rows };
  }, [data?.entries, data?.year?.openingBalances, ledgerCode, month, months]);
  // The ledger keeps debit minus credit; it is shown in the account's normal direction, so a liability's balance reads positive.
  const ledgerShown = (signed: number) => (selectedLedger?.normalBalance === 'CREDIT' && signed ? -signed : signed);
  const openingDisabled = busy || loading || data?.unit?.id !== unitId || data?.academicYear !== academicYear;
  const openingDebit = Object.values(openingDraft).reduce((sum, balance) => sum + balance.debit, 0);
  const openingCredit = Object.values(openingDraft).reduce((sum, balance) => sum + balance.credit, 0);
  let openingError = '';
  try { validateOpeningBalances(openingDraft, data?.accounts || []); }
  catch (cause) { openingError = cause instanceof Error ? cause.message : 'Saldo awal tidak valid.'; }
  const changeOpening = (account: FinancialAccount, side: 'debit' | 'credit', value: number) => {
    const id = financialAccountId(account);
    setOpeningDraft((current) => {
      const balance = { debit: current[id]?.debit || 0, credit: current[id]?.credit || 0, [side]: value };
      if (value) balance[side === 'debit' ? 'credit' : 'debit'] = 0;
      const next = { ...current };
      if (balance.debit || balance.credit) next[id] = balance;
      else delete next[id];
      return next;
    });
  };
  const monthlyPeriod = month !== 'ANNUAL';

  // The journal form. A new journal is posted from the top; an edit takes the place of that journal's own rows, highlighted yellow.
  const journalComposer = canPost ? <tbody key={editingEntry?.id ?? 'composer'} ref={composerRef} className={`align-top ${editingEntry ? 'bg-amber-50' : 'bg-slate-50'}`}>
      {editingEntry && <tr><td colSpan={6} className="border-b border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">Mengedit jurnal {editingEntry.date} · {editingEntry.description}. Simpan perubahan, atau batalkan untuk kembali.{error && <span role="alert" className="mt-1 block text-red-700">{error}</span>}</td></tr>}
      {lines.map((line, index) => <tr key={index}>
        {index === 0 && <td rowSpan={lines.length + 1} className="border-b border-slate-200 px-3 py-2"><input type="date" aria-label="Tanggal transaksi" className={field} value={voucherDate} onChange={(event) => setVoucherDate(event.target.value)} /></td>}
        <td className="px-3 py-1.5"><div className="flex items-center gap-1">
          <SearchSelect aria-label={`Akun baris ${index + 1}`} placeholder="Cari kode / nama akun" options={accountItems} value={line.accountCode} onValueChange={(value) => setLines((current) => current.map((item, i) => i === index ? { ...item, accountCode: value } : item))} />
          {lines.length > 2 && <button type="button" aria-label={`Hapus baris ${index + 1}`} className={`${lightButton} !px-2`} onClick={() => setLines((current) => current.filter((_, i) => i !== index))}>×</button>}
        </div></td>
        <td className="px-3 py-1.5"><input aria-label={`Uraian baris ${index + 1}`} className={field} value={line.description} maxLength={300} onChange={(event) => setLines((current) => current.map((item, i) => i === index ? { ...item, description: event.target.value } : item))} placeholder="Uraian" /></td>
        <td className="px-3 py-1.5"><CurrencyInput className={`${field} text-right`} aria-label={`Debet baris ${index + 1}`} value={amountNumber(line.debit)} onValue={(value) => setLines((current) => current.map((item, i) => i === index ? { ...item, debit: amountText(value) } : item))} /></td>
        <td className="px-3 py-1.5"><CurrencyInput className={`${field} text-right`} aria-label={`Kredit baris ${index + 1}`} value={amountNumber(line.credit)} onValue={(value) => setLines((current) => current.map((item, i) => i === index ? { ...item, credit: amountText(value) } : item))} /></td>
        {index === 0 && <td rowSpan={lines.length + 1} className="border-b border-slate-200 px-3 py-2"><div className="flex flex-col items-start gap-2">
          <button type="button" className={button} disabled={busy || preparingReceipts || !draftValid} onClick={() => void postVoucher()}>{editingEntry ? <Save className="h-4 w-4" /> : <FilePlus2 className="h-4 w-4" />}{editingEntry ? 'Simpan perubahan' : 'Posting jurnal'}</button>
          {editingEntry && <button type="button" className={lightButton} disabled={busy} onClick={cancelEdit}>Batal</button>}
          {!draftValid && !busy && draftHint && lines.some((line) => line.accountCode || line.debit || line.credit || line.description) && <p className="text-xs text-amber-700">{draftHint}</p>}
          <div className="w-full border-t border-slate-200 pt-2">
            <input key={voucherId} ref={receiptInputRef} id="voucher-receipt" className="hidden" type="file" multiple accept={UPLOAD_ACCEPT} onChange={(event) => {
              const picked = Array.from(event.target.files || []);
              event.target.value = '';
              if (picked.length) void addReceipts(picked);
            }} />
            {editingEntry && originalReceiptCount > 0 && <ul className="mb-2 space-y-1">{Array.from({ length: originalReceiptCount }, (_, index) => {
              const removed = removedReceiptIndexes.includes(index);
              const restoreFull = removed && savedReceiptCount + receipts.length >= MAX_ENTRY_RECEIPTS;
              return <li key={index} className={`flex items-center justify-between gap-2 rounded-md border px-2 py-1.5 text-xs ${removed ? 'border-red-200 bg-red-50' : 'border-slate-200 bg-white'}`}>
                <button type="button" className={`text-accent-700 hover:underline ${removed ? 'line-through opacity-60' : ''}`} disabled={busy} onClick={() => void viewReceipt({ entryId: editingEntry.id, index: String(index) })}>Bukti tersimpan {index + 1}</button>
                <button type="button" aria-label={`${removed ? 'Urungkan penghapusan' : 'Hapus'} bukti ${index + 1}`} title={restoreFull ? 'Lepas bukti baru terlebih dahulu; maksimal 10 bukti.' : removed ? 'Urungkan penghapusan' : 'Hapus bukti'} className="shrink-0 text-slate-500 hover:text-red-700 disabled:opacity-50" disabled={busy || preparingReceipts || restoreFull} onClick={() => setRemovedReceiptIndexes((current) => current.includes(index) ? current.filter((value) => value !== index) : [...current, index])}>{removed ? 'Urungkan' : <Trash2 className="h-4 w-4" />}</button>
              </li>;
            })}</ul>}
            {receipts.length > 0 && <ul className="mb-2 space-y-1">{receipts.map((file, index) => <li key={`${file.name}-${index}`} className="flex items-center justify-between gap-2 rounded-md border border-slate-200 bg-white px-2 py-1.5 text-xs text-slate-700"><span className="min-w-0 truncate" title={file.name}>{file.name}</span><button type="button" aria-label={`Lepas ${file.name}`} title="Lepas bukti" className="shrink-0 text-slate-400 hover:text-red-700 disabled:opacity-50" disabled={busy || preparingReceipts} onClick={() => setReceipts((current) => current.filter((_, i) => i !== index))}><X className="h-4 w-4" /></button></li>)}</ul>}
            <button type="button" className={lightButton} disabled={busy || preparingReceipts || savedReceiptCount + receipts.length >= MAX_ENTRY_RECEIPTS} onClick={() => receiptInputRef.current?.click()}>{preparingReceipts ? <Loader2 className="h-4 w-4 animate-spin" /> : <Paperclip className="h-4 w-4" />}{preparingReceipts ? 'Memproses bukti…' : savedReceiptCount + receipts.length > 0 ? 'Tambah bukti' : 'Lampirkan bukti'}</button>
            {savedReceiptCount > 0 && <p className="mt-1 text-xs text-slate-400">{savedReceiptCount} bukti sudah tersimpan.</p>}
            {removedReceiptIndexes.length > 0 && <p role="status" className="mt-1 text-xs text-red-700">{removedReceiptIndexes.length} bukti akan dihapus saat Anda menyimpan perubahan.</p>}
          </div>
        </div></td>}
      </tr>)}
      <tr>
        <td className="border-b border-slate-200 px-3 py-1.5"><button type="button" className={lightButton} disabled={lines.length >= 30} onClick={() => setLines((current) => {
          // The new line starts with whatever amount makes Debet equal Kredit.
          const gap = current.reduce((sum, line) => sum + amountNumber(line.debit) - amountNumber(line.credit), 0);
          return [...current, { ...emptyLine(), debit: gap < 0 ? String(-gap) : '', credit: gap > 0 ? String(gap) : '' }];
        })}>Tambah baris</button></td>
        <td className="border-b border-slate-200 px-3 py-1.5 text-xs text-slate-500">
          {/* Classified by the counter accounts in the catalog, not chosen per journal. */}
          {!!draftCashFlowParts.length && <p className="font-medium text-slate-600" title="Mengikuti klasifikasi arus kas akun lawan di katalog akun">Arus kas: {draftCashFlowParts.join(' · ')}</p>}
          {draftCashFlows.error && <p className="text-amber-700">{draftCashFlows.error}</p>}
          {draftDebit !== draftCredit && <p className="mt-1 text-amber-700">Belum seimbang · selisih {money(Math.abs(draftDebit - draftCredit))}</p>}
          {draftNegativeCash.map((dip) => <p key={dip.accountCode} role="status" className="mt-1 text-amber-700">Saldo {dip.accountName} jadi minus {money(-dip.lowest)} mulai {dip.firstDate}. Catat dulu uang masuknya (mis. Tarik Tunai dari bank). Jurnal tetap bisa diposting.</p>)}
        </td>
        <td className="border-b border-slate-200 px-3 py-1.5 text-right text-xs tabular-nums text-slate-600">{money(draftDebit)}</td>
        <td className="border-b border-slate-200 px-3 py-1.5 text-right text-xs tabular-nums text-slate-600">{money(draftCredit)}</td>
      </tr>
  </tbody> : null;

  return <div className="min-h-screen bg-white text-slate-700">
    <div className="space-y-5 px-4 pt-6 pb-16 sm:px-8 sm:pt-8">
      {/* This page has no shell top bar, so the title sits in the toolbar row instead of a banner. */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-3xl font-semibold text-slate-900">Buku Keuangan Satuan Kerja</h1>
        <div className="flex gap-2"><button className={`${lightButton} !px-2`} onClick={() => void load()} aria-label="Muat ulang" title="Muat ulang"><RefreshCw className="h-4 w-4" /></button>{['satker_finance_admin', 'rector_finance'].includes(visibleProfile?.role || '') && <><AccountSwitcher label="always" className="h-auto rounded-md border-slate-300 bg-white px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50" /><button className={lightButton} onClick={requestLogout}>Keluar</button></>}</div>
      </div>
      <div className="flex flex-wrap items-end gap-3 border-b border-slate-200 pb-5">
        <div className="min-w-60 flex-1 text-xs font-medium text-slate-500"><span id="satker-unit-label">Satuan Kerja</span><SearchSelect aria-label="Satuan Kerja" placeholder="Cari SatKer" options={unitItems} value={unitId || ''} onValueChange={(value) => selectUnit(value)} className="mt-1" /></div>
        <label className="w-40 text-xs font-medium text-slate-500">Awal tahun akademik<input className={`${field} mt-1`} type="number" min="2020" max="2100" value={yearStart} onChange={(event) => { cancelEdit(); const start = Number(event.target.value); setYearStart(start); if (month !== 'ANNUAL') setVoucherDate(`${month >= 9 ? start : start + 1}-${String(month).padStart(2, '0')}-01`); }} /></label>
        <div className="w-52 text-xs font-medium text-slate-500"><span id="satker-period-label">Periode</span><Select items={periodItems} value={String(month)} onValueChange={(value) => { if (!value) return; cancelEdit(); const selected = value === 'ANNUAL' ? 'ANNUAL' : Number(value); setMonth(selected); if (selected !== 'ANNUAL') { const period = months.find((item) => item.monthIndex === selected); if (period) setVoucherDate(`${period.year}-${String(selected).padStart(2, '0')}-01`); } }}><SelectTrigger aria-labelledby="satker-period-label" className={selectTrigger}><SelectValue /></SelectTrigger><SelectContent className={selectContent}><SelectItem className={selectItem} value="ANNUAL">Tahunan (Sep–Agu)</SelectItem>{months.map((item) => <SelectItem className={selectItem} key={item.period} value={String(item.monthIndex)}>{monthNames[item.monthIndex - 1]} {item.year}</SelectItem>)}</SelectContent></Select></div>
      </div>
      {error && <div role="alert" className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800">{error}</div>}
      {success && <div role="status" className="rounded-lg border border-green-200 bg-green-50 p-3 text-sm text-green-800">{success}</div>}
      {loading && <div className="flex items-center gap-2 text-sm text-slate-500"><Loader2 className="h-4 w-4 animate-spin" /> Memuat data keuangan...</div>}
      {!unitId && !loading && <Section title="Belum ada SatKer"><p className="text-sm text-slate-600">{isAdmin ? 'Buat SatKer pada tab Pengaturan untuk mulai menggunakan buku keuangan.' : 'BAK belum memberikan akses ke buku keuangan SatKer. Hubungi administrator.'}</p><button className={`${lightButton} mt-3`} onClick={() => setTab('pengaturan')}>Pengaturan</button></Section>}
      {data?.unit && <>
      <nav className="flex gap-6 overflow-x-auto border-b border-slate-200" aria-label="Bagian pelaporan keuangan">{tabs.filter((item) => (item.id !== 'pengaturan' || isAdmin) && (item.id !== 'akun' || canEdit) && (!unitOnlyTabs.includes(item.id) || (!!unitId && unitId !== 'ALL'))).map((item) => <button key={item.id} onClick={() => setTab(item.id)} aria-current={tab === item.id ? 'page' : undefined} className={`-mb-px shrink-0 border-b-2 px-1 py-2.5 text-sm ${tab === item.id ? 'border-accent-600 font-medium text-accent-700' : 'border-transparent text-slate-500 hover:text-slate-700'}`}>{item.label}</button>)}</nav>
        {tab === 'ringkasan' && statement && <div className="space-y-5">
          <dl className="grid grid-cols-2 gap-y-4 border-b border-slate-200 pb-5 xl:grid-cols-4 xl:divide-x xl:divide-slate-200">{[
            { label: 'Penerimaan', value: statement.incomeStatement.income }, { label: 'Pengeluaran', value: statement.incomeStatement.expense },
            { label: 'Surplus / defisit', value: statement.incomeStatement.surplus }, { label: 'Saldo kas & bank', value: statement.cashFlow.physicalCash },
          ].map((item) => <div key={item.label} className="xl:px-6 xl:first:pl-0"><dt className="text-xs text-slate-500">{item.label}</dt><dd className="mt-1 text-xl font-semibold tabular-nums text-slate-900">{money(item.value)}</dd></div>)}</dl>
          {!!statement.abnormalBalances?.length && <Section title="Saldo tidak normal">
            <p className="mb-2 text-sm text-slate-600">Akun berikut bersaldo di sisi yang berlawanan dengan pos saldonya, misalnya kas yang minus atau hutang yang bersaldo debet. Biasanya ini tanda salah akun atau salah sisi saat menjurnal; periksa Buku Besar akun tersebut.</p>
            <ul className="space-y-1 text-sm">{statement.abnormalBalances.map((item) => <li key={item.account.code} className="flex flex-wrap justify-between gap-3 border-b border-slate-100 py-1.5"><span>{item.account.code} · {item.account.name} <span className="text-slate-500">(pos saldo {item.account.normalBalance === 'DEBIT' ? 'Debet' : 'Kredit'})</span></span><span className="tabular-nums text-amber-700">{item.side === 'DEBIT' ? 'Debet' : 'Kredit'} {money(item.amount)}</span></li>)}</ul>
          </Section>}
          {unitId === 'ALL' && <Section title="Pemantauan seluruh SatKer"><div className="overflow-x-auto"><table className="w-full text-sm"><thead><tr className="text-xs text-slate-500 [&_th]:font-medium"><th className={leftCell}>SatKer</th><th className={cell}>Penerimaan</th><th className={cell}>Pengeluaran</th><th className={cell}>Kas akhir</th></tr></thead><tbody>{data.unitSummaries?.map((item) => <tr key={item.unit.id}><td className={leftCell}><button className="font-semibold text-accent-700 hover:underline" onClick={() => selectUnit(item.unit.id)}>{item.unit.name}</button></td><td className={cell}>{money(item.statements.incomeStatement.income)}</td><td className={cell}>{money(item.statements.incomeStatement.expense)}</td><td className={cell}>{money(item.statements.cashFlow.physicalCash)}</td></tr>)}</tbody></table></div></Section>}
          <Section title={month === 'ANNUAL' ? 'Perkembangan 12 bulan' : 'Bulan terpilih'}><div className="overflow-x-auto"><table className="w-full text-sm"><thead><tr className="text-xs text-slate-500 [&_th]:font-medium"><th className={leftCell}>Bulan</th><th className={cell}>Penerimaan</th><th className={cell}>Pengeluaran</th><th className={cell}>Surplus / Defisit</th><th className={cell}>Kas akhir</th></tr></thead><tbody>{(data.annualStatements || statement).monthlyIncome.filter((item) => month === 'ANNUAL' || item.monthIndex === month).map((item) => <tr key={item.period}><td className={leftCell}>{monthNames[item.monthIndex - 1]} {item.year}</td><td className={cell}>{money(item.income)}</td><td className={cell}>{money(item.expense)}</td><td className={cell}>{money(item.surplus)}</td><td className={cell}>{money(item.endingCash)}</td></tr>)}</tbody></table></div></Section>
          {unitId !== 'ALL' && <p className="text-sm text-slate-600">Cetak laporan pada tab Arus Kas dan serahkan salinan cetaknya ke kantor BAK. Pencatatan dan koreksi tetap dapat dilakukan untuk setiap bulan dan tahun buku.</p>}
        </div>}
        {tab === 'jurnal' && <div className="space-y-5"><Section title="Riwayat jurnal"><div className="overflow-x-auto"><table className="w-full min-w-[960px] text-sm"><thead><tr className="text-xs text-slate-500 [&_th]:font-medium"><th className={`${leftCell} w-40`}>Tanggal</th><th className={`${leftCell} w-96 min-w-52`}>Akun</th><th className={`${leftCell} min-w-56`}>Uraian</th><th className={`${cell} w-44`}>Debet</th><th className={`${cell} w-44`}>Kredit</th><th className={`${leftCell} w-60 min-w-60`}>Aksi</th></tr></thead>
            {!editingEntry && journalComposer}
            {/* A specific month lists its own journals; every period remains editable. */}
            {data.entries?.filter((entry) => month === 'ANNUAL' || entry.monthIndex === month).map((entry) => {
            const reversed = reversedIds.has(entry.id);
            const changeBlocker = entryChangeBlocker({ change: 'delete', entry, reversed, academicYear });
            const beingEdited = editingEntry?.id === entry.id;
            if (beingEdited && journalComposer) return journalComposer;
            return <tbody key={entry.id} className="align-top">{entry.lines.map((line, index) => {
            const last = index === entry.lines.length - 1;
            const rule = last ? 'border-b border-slate-100' : '';
            const span = entry.lines.length;
            // Entries posted with a uraian on each line show them row by row; older ones and reversals show one for the whole entry.
            const perLine = entry.kind !== 'REVERSAL' && entry.lines.some((item) => item.description);
            return <tr key={index} className={line.debit ? debitRow : creditRow}>
              {index === 0 && <td rowSpan={span} className={leftCell}>{entry.date}</td>}
              <td className={`px-3 py-2 text-left ${rule}`}>{line.accountNumber || line.accountCode} · {line.accountName}</td>
              {perLine ? <td className={`px-3 py-2 text-left ${rule}`}>{line.description}</td> : index === 0 ? <td rowSpan={span} className={`${leftCell} font-semibold`}>{entry.description}</td> : null}
              <td className={`px-3 py-2 text-right tabular-nums ${rule}`}>{line.debit ? money(line.debit) : ''}</td>
              <td className={`px-3 py-2 text-right tabular-nums ${rule}`}>{line.credit ? money(line.credit) : ''}</td>
              {index === 0 && <td rowSpan={span} className={leftCell}><div className="flex flex-col items-start gap-1.5">
                {(entry.receiptCount ?? 0) > 0 && <button type="button" className={lightButton} aria-expanded={expandedReceipts.has(entry.id)} onClick={() => toggleReceipts(entry.id)}>{expandedReceipts.has(entry.id) ? 'Tutup bukti' : entry.receiptCount === 1 ? 'Lihat bukti' : `Lihat ${entry.receiptCount} bukti`}</button>}
                {entry.kind === 'DEPRECIATION' && <span className="text-xs text-slate-500">Dibuat dari daftar aset tetap</span>}
                {canPost && !changeBlocker && <div className="flex items-center gap-1">
                  {entry.kind !== 'REVERSAL' && entry.kind !== 'DEPRECIATION' && <button type="button" className={`${lightButton} !px-2`} aria-label="Edit jurnal" title="Edit jurnal" disabled={busy || beingEdited} onClick={() => startEdit(entry)}><Pencil className="h-4 w-4" /></button>}
                  <button type="button" className={`${dangerGhostButton} !px-2`} aria-label="Hapus jurnal" title="Hapus jurnal" disabled={busy} onClick={() => openDelete(entry)}><Trash2 className="h-4 w-4" /></button>
                </div>}
                {canPost && changeBlocker && reversed && <span className="text-xs text-slate-500" title={changeBlocker}>Sudah dibalik</span>}
              </div></td>}
            </tr>;
          })}{user && expandedReceipts.has(entry.id) && (entry.receiptCount ?? 0) > 0 && <tr className="bg-slate-50"><td colSpan={6} className="border-b border-slate-100 px-3 pb-4"><EntryReceipts user={user} unitId={unitId} academicYear={academicYear} entryId={entry.id} count={entry.receiptCount ?? 0} /></td></tr>}</tbody>; })}</table>{!data.entries?.length && !canPost && <p className="p-4 text-sm text-slate-500">Belum ada transaksi.</p>}</div></Section>
        </div>}
        {tab === 'buku_besar' && unitId !== 'ALL' && <Section title="Buku Besar"><div className="mb-4 max-w-lg text-xs font-medium text-slate-500"><span id="ledger-account-label">Akun</span><Select items={accountItems} value={ledgerCode} onValueChange={(value) => value && setLedgerCode(value)}><SelectTrigger aria-labelledby="ledger-account-label" className={selectTrigger}><SelectValue /></SelectTrigger><SelectContent className={selectContent}>{postable.map((account) => <SelectItem className={selectItem} key={financialAccountId(account)} value={financialAccountId(account)}>{account.code} · {account.name}</SelectItem>)}</SelectContent></Select></div><p className="mb-3 text-sm text-slate-600">Saldo awal periode {selectedLedger?.name}: {money(ledgerShown(ledger.beginning))} · Pos saldo {selectedLedger?.normalBalance === 'CREDIT' ? 'Kredit' : 'Debet'}: saldo positif berarti saldo normal, minus berarti saldo di sisi sebaliknya.</p><div className="overflow-x-auto"><table className="w-full text-sm"><thead><tr className="text-xs text-slate-500 [&_th]:font-medium"><th className={leftCell}>Tanggal</th><th className={leftCell}>Uraian</th><th className={cell}>Debet</th><th className={cell}>Kredit</th><th className={cell}>Saldo ({selectedLedger?.normalBalance === 'CREDIT' ? 'K' : 'D'})</th></tr></thead><tbody>{ledger.rows.map((row, index) => <tr key={`${row.id}-${index}`}><td className={leftCell}>{row.date}</td><td className={leftCell}>{row.description}</td><td className={cell}>{money(row.debit)}</td><td className={cell}>{money(row.credit)}</td><td className={`${cell} ${ledgerShown(row.balance) < 0 ? 'text-amber-700' : ''}`}>{money(ledgerShown(row.balance))}</td></tr>)}</tbody></table></div><p className="mt-3 text-sm font-semibold">Saldo akhir: {money(ledgerShown(ledger.ending))} · {ledger.ending === ((statement?.rows.find((row) => financialAccountId(row.account) === ledgerCode)?.endingDebit || 0) - (statement?.rows.find((row) => financialAccountId(row.account) === ledgerCode)?.endingCredit || 0)) ? 'Alhamdulillah · sesuai neraca saldo' : 'Selisih dengan neraca saldo'}</p></Section>}
        {tab === 'neraca_saldo' && statement && <div className="space-y-5"><Section title="Neraca Saldo"><div className="overflow-x-auto"><table className="w-full text-sm"><thead><tr className="text-xs text-slate-500 [&_th]:font-medium"><th className={leftCell}>Kode</th><th className={leftCell}>Akun</th><th className={cell}>Saldo Debet</th><th className={cell}>Saldo Kredit</th></tr></thead><tbody>{statement.rows.map((row) => { const abnormal = hasAbnormalBalance(row.account, row.endingDebit, row.endingCredit); return <tr key={row.account.code} className={abnormal ? 'bg-amber-50' : ''}><td className={leftCell}>{row.account.code}</td><td className={leftCell}>{row.account.name}{abnormal && <span className="ml-2 text-xs text-amber-700">saldo tidak normal (pos {row.account.normalBalance === 'DEBIT' ? 'Debet' : 'Kredit'})</span>}</td><td className={cell}>{money(row.endingDebit)}</td><td className={cell}>{money(row.endingCredit)}</td></tr>; })}</tbody><tfoot><tr className="bg-slate-50 font-semibold"><td colSpan={2} className={leftCell}>Total · Selisih {money(statement.trialBalance.difference)}</td><td className={cell}>{money(statement.trialBalance.debit)}</td><td className={cell}>{money(statement.trialBalance.credit)}</td></tr></tfoot></table></div></Section><Section title="Neraca Lajur Bulanan · Saldo Kumulatif"><div className="overflow-x-auto"><table className={`w-full text-xs ${month === 'ANNUAL' ? 'min-w-[1600px]' : ''}`}><thead><tr className="text-xs text-slate-500 [&_th]:font-medium"><th className={leftCell} rowSpan={2}>Akun</th>{shownTrial.map((item) => <th className="border-b px-2 py-2 text-center" key={item.period} colSpan={2}>{monthNames[item.monthIndex - 1].slice(0, 3)} {item.year}</th>)}</tr><tr>{shownTrial.map((item) => <FragmentPair key={item.period} />)}</tr></thead><tbody>{postable.map((account) => <tr key={account.code}><td className={leftCell}>{account.code} · {account.name}</td>{shownTrial.map((item) => { const row = item.rows.find((value) => value.id === financialAccountId(account)); return <FragmentAmounts key={item.period} debit={row?.debit || 0} credit={row?.credit || 0} />; })}</tr>)}</tbody></table></div></Section></div>}
        {tab === 'laba_rugi' && statement && <Section title={`Laba Rugi ${month === 'ANNUAL' ? 'Tahunan' : monthNames[month - 1]}`}><div className="overflow-x-auto"><table className="w-full text-sm"><thead><tr className="text-xs text-slate-500 [&_th]:font-medium"><th className={leftCell}>Akun</th><th className={cell}>Penerimaan</th><th className={cell}>Pengeluaran</th></tr></thead><tbody>{statement.incomeStatement.rows.map((row) => <tr key={row.account.code}><td className={leftCell}>{row.account.code} · {row.account.name}</td><td className={cell}>{row.account.type === 'TERIMA' ? money(row.creditMovement - row.debitMovement) : '—'}</td><td className={cell}>{row.account.type === 'KELUAR' ? money(row.debitMovement - row.creditMovement) : '—'}</td></tr>)}</tbody><tfoot><tr className="bg-slate-50 font-semibold"><td className={leftCell}>Jumlah</td><td className={cell}>{money(statement.incomeStatement.income)}</td><td className={cell}>{money(statement.incomeStatement.expense)}</td></tr><tr className="font-semibold"><td className={leftCell}>Surplus / Defisit</td><td colSpan={2} className={cell}>{money(statement.incomeStatement.surplus)}</td></tr></tfoot></table></div></Section>}
        {tab === 'arus_kas' && statement && <Section title="Laporan Arus Kas">
          {unitId !== 'ALL' && month !== 'ANNUAL' && <div className="mb-5 flex flex-wrap items-center gap-3">
            <button type="button" className={button} disabled={!!cashFlowPrint || loading || busy || data.unit?.id !== unitId} onClick={() => void downloadCashFlowReport()}>{cashFlowPrint ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}{cashFlowPrint ? `Menyiapkan bukti ${cashFlowPrint.loaded}/${cashFlowPrint.total}…` : 'Unduh PDF Arus Kas + bukti'}</button>
            <span className="text-xs text-slate-500">Laporan {monthNames[month - 1]} diikuti {cashFlowReceipts.length} bukti yang diunggah pada jurnal bulan ini (tab Jurnal).</span>
          </div>}
          <div className={`grid gap-6 ${unitId !== 'ALL' && month !== 'ANNUAL' ? 'lg:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)]' : ''}`}>
            <div className="min-w-0 space-y-2 text-sm">{[
              ['Saldo awal kas dan setara kas', statement.cashFlow.openingCash], ['I. Aktivitas operasional', statement.cashFlow.OPERATING],
              ['II. Aktivitas investasi', statement.cashFlow.INVESTING], ['III. Aktivitas pendanaan', statement.cashFlow.FINANCING],
              ['Perubahan bersih kas', statement.cashFlow.netChange], ['Saldo akhir kas menurut arus kas', statement.cashFlow.endingCash],
              ['Saldo fisik akun kas/bank', statement.cashFlow.physicalCash], ['Selisih rekonsiliasi', statement.cashFlow.reconciliationDelta],
            ].map(([label, value]) => <div key={String(label)} className="flex justify-between gap-3 border-b border-slate-100 py-2"><span>{label}</span><strong className="shrink-0 font-semibold tabular-nums">{money(Number(value))}</strong></div>)}</div>
            {unitId !== 'ALL' && month !== 'ANNUAL' && <CashFlowSignatureSettings signatures={cashFlowSignatures} employees={data.signatureEmployees || []}
              canEdit={!!canEdit} disabled={busy || loading || !!cashFlowPrint || data.unit?.id !== unitId} onChange={setCashFlowSignatures}
              onSave={() => void post('SAVE_CASH_FLOW_SIGNATURES', { signatures: cashFlowSignatures, expectedRevision: data.unit?.revision || 0 })} />}
          </div>
          {(() => {
            const activeCashAccounts = statement.rows
              .filter((row) => isCashAccount(row.account) && (row.endingDebit !== 0 || row.endingCredit !== 0))
              .map((row) => ({ code: row.account.code, name: row.account.name, balance: row.endingDebit - row.endingCredit }));
            return <div className="mt-6 space-y-2">
              <h3 className="text-sm font-semibold text-slate-900">Rincian Saldo Kas dan Setara Kas Akhir Periode</h3>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-xs text-slate-500 [&_th]:font-medium">
                      <th className={leftCell}>Nomor</th>
                      <th className={leftCell}>Nama akun</th>
                      <th className={cell}>Saldo Akhir</th>
                    </tr>
                  </thead>
                  <tbody>
                    {activeCashAccounts.map((account) => (
                      <tr key={account.code}>
                        <td className={leftCell}>{account.code}</td>
                        <td className={leftCell}>{account.name}</td>
                        <td className={cell}>{money(account.balance)}</td>
                      </tr>
                    ))}
                    {!activeCashAccounts.length && (
                      <tr>
                        <td colSpan={3} className="py-2 text-center text-xs text-slate-400">Tidak ada saldo kas atau bank</td>
                      </tr>
                    )}
                  </tbody>
                  <tfoot>
                    <tr className="bg-slate-50 font-semibold">
                      <td colSpan={2} className={leftCell}>Jumlah Keseluruhan</td>
                      <td className={cell}>{money(activeCashAccounts.reduce((sum, a) => sum + a.balance, 0))}</td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            </div>;
          })()}
        </Section>}
        {tab === 'neraca' && statement && (() => {
          const sheet = statement.balanceSheet;
          const rightSide = sheet.liabilities + sheet.equity + sheet.accumulatedSurplus;
          const sideRows = (type: 'AKTIVA' | 'HUTANG' | 'MODAL') => sheet.rows.filter((row) => row.account.type === type).map((row) => <BalanceLine key={row.account.code} label={`${row.account.code} · ${row.account.name}`} amount={type === 'AKTIVA' ? row.endingDebit - row.endingCredit : row.endingCredit - row.endingDebit} />);
          return <Section title="Neraca"><div className="grid gap-5 md:grid-cols-2">
            <div><h3 className="mb-2 text-sm font-semibold text-slate-900">AKTIVA</h3>{sideRows('AKTIVA')}<BalanceLine label="Total Aktiva" amount={sheet.assets} total /></div>
            <div><h3 className="mb-2 text-sm font-semibold text-slate-900">HUTANG</h3>{sideRows('HUTANG')}<BalanceLine label="Total Hutang" amount={sheet.liabilities} subtotal />
              <h3 className="mb-2 mt-5 text-sm font-semibold text-slate-900">MODAL</h3>{sideRows('MODAL')}<BalanceLine label="Surplus / Defisit berjalan" amount={sheet.accumulatedSurplus} /><BalanceLine label="Total Modal" amount={sheet.equity + sheet.accumulatedSurplus} subtotal />
              <BalanceLine label="Total Hutang + Modal" amount={rightSide} total /></div>
          </div>
          <div className={`mt-4 rounded-lg p-4 text-sm font-medium ${sheet.assets === rightSide ? 'bg-accent-50 text-accent-800' : 'bg-amber-50 text-amber-800'}`}>{sheet.assets === rightSide ? `Seimbang · Aktiva ${money(sheet.assets)} = Hutang + Modal ${money(rightSide)}` : `Tidak seimbang · Aktiva ${money(sheet.assets)} · Hutang + Modal ${money(rightSide)} · Selisih ${money(sheet.assets - rightSide)}`}</div></Section>;
        })()}
        {tab === 'rekonsiliasi' && unitId !== 'ALL' && statement && <BankReconciliationPanel rows={statement.rows} reconciliations={data.reconciliations || []}
          academicYear={academicYear} month={month} canPost={!!canPost && monthlyPeriod} busy={busy} post={post} viewStatement={(reconciliationId) => void viewReceipt({ reconciliationId })} />}
        {tab === 'aset_tetap' && unitId !== 'ALL' && statement && <FixedAssetsPanel accounts={data.accounts} assets={data.fixedAssets || []} entries={data.entries || []}
          rows={statement.rows} academicYear={academicYear} month={month} canPost={!!canPost} canPostMonth={!!canPost && monthlyPeriod} busy={busy} post={post} />}
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
        {tab === 'audit' && <Section title="Jejak Audit"><div className="space-y-2">{data.events?.map((event) => <div key={event.id} className="border-b border-slate-100 py-3 text-sm"><div className="flex flex-wrap justify-between gap-2"><strong className="font-semibold">{event.action.replaceAll('_', ' ')}</strong><span className="text-slate-500">{dateText(event.at)}</span></div><div className="mt-1 text-xs text-slate-500">Pelaku: {event.actorName || event.actorUid} ({event.actorRole || '—'}) · {JSON.stringify(event.details)}</div></div>)}{!data.events?.length && <p className="text-sm text-slate-500">Belum ada peristiwa audit.</p>}</div></Section>}
        {tab === 'akun' && canEdit && !!unitId && unitId !== 'ALL' && <Section title={`Akun ${data.unit?.name || 'SatKer'}`}>
          <div className="mb-6 rounded-lg border border-slate-200 p-4">
            <h3 className="text-sm font-semibold text-slate-900">Impor dari berkas Excel</h3>
            <p className="mt-1 text-sm text-slate-600">Berkas berisi sheet &quot;Akun …&quot; dan &quot;Jurnal …&quot; SatKer. Impor hanya untuk SatKer yang belum memiliki akun atau jurnal; akun, saldo awal, dan jurnal masuk sekaligus atau tidak sama sekali.</p>
            <input type="file" accept=".xlsx" aria-label="Berkas Excel buku SatKer" className="mt-3 block text-sm text-slate-700"
              onChange={(event) => { const file = event.target.files?.[0]; if (file) void readBookFile(file); event.target.value = ''; }} />
            {bookFile && <div className="mt-3 space-y-3">
              <p className="text-xs text-slate-500">Berkas: {bookFile.fileName}</p>
              <div className="grid gap-3 md:grid-cols-2">
                {(['akun', 'jurnal'] as const).map((part) => <label key={part} className="text-xs font-medium text-slate-500">{part === 'akun' ? 'Sheet akun' : 'Sheet jurnal'}
                  <select className={`${field} mt-1`} value={bookFile[part]} onChange={(event) => { setBookFile({ ...bookFile, [part]: event.target.value }); setBookCheck(null); }}>
                    <option value="">Pilih sheet</option>
                    {bookFile.workbook.SheetNames.map((name) => <option key={name} value={name}>{name}</option>)}
                  </select></label>)}
              </div>
              <button type="button" className={lightButton} disabled={!bookFile.akun || !bookFile.jurnal || busy} onClick={() => void checkBookFile()}>Periksa berkas</button>
            </div>}
            {bookCheck && <div className="mt-4 space-y-3 text-sm">
              <p className="text-slate-700">{bookCheck.summary.accounts} akun ({bookCheck.summary.openingAccounts} dengan saldo awal, debet {money(bookCheck.summary.openingDebit)}) · {bookCheck.summary.vouchers} jurnal · {bookCheck.summary.lines} baris · total debet {money(bookCheck.summary.debit)}</p>
              {bookCheck.problems.length > 0 && <ul className="list-disc space-y-1 pl-5 text-amber-700">
                {bookCheck.problems.slice(0, 50).map((problem, index) => <li key={index}>{problem}</li>)}
                {bookCheck.problems.length > 50 && <li>…dan {bookCheck.problems.length - 50} masalah lain</li>}
              </ul>}
              <div className="flex flex-wrap items-center gap-3">
                <button type="button" className={button} disabled={busy || !bookCheck.book} onClick={() => void importBook()}>
                  {bookCheck.book ? `Impor ${bookCheck.summary.accounts} akun dan ${bookCheck.summary.vouchers} jurnal` : 'Perbaiki berkas dahulu'}
                </button>
                {bookCheck.problems.length > 0 && <span className="text-xs text-slate-500">Perbaiki baris yang disebut di berkas, unggah ulang, lalu periksa lagi.</span>}
              </div>
            </div>}
          </div>
          {data.accountCatalogSource && <p className="mb-2 text-sm text-slate-600">Daftar akun dasar diimpor dari {data.accountCatalogSource} dan hanya berlaku untuk buku ini.</p>}
          <p className="mb-4 text-sm text-slate-600">Nomor dan nama yang Anda ubah atau tambahkan di sini hanya berlaku untuk {data.unit?.name || 'SatKer'} ini. Perubahan tidak mengubah akun SatKer Loyalis lain.</p>
          <div className="mb-3 flex justify-end"><button type="button" className={button} onClick={() => { setUnitAccountId(''); setCreatingUnitAccount(true); setUnitAccountDraft({ code: '', name: '', type: 'AKTIVA', cashEquivalent: false, contra: false, cashFlowSection: 'OPERATING' }); }}>Buat akun baru</button></div>
          {(creatingUnitAccount || unitAccountId) && <div ref={unitAccountEditorRef} className="mb-4 rounded-lg border border-accent-200 bg-accent-50/30 p-4">
            <h3 className="mb-3 text-sm font-semibold text-slate-900">{creatingUnitAccount ? 'Akun baru' : 'Ubah akun'}</h3>
            <div className="grid gap-3 md:grid-cols-2">
              <label className="text-xs font-medium text-slate-500">Nomor akun<input className={`${field} mt-1`} inputMode="decimal" maxLength={20} value={unitAccountDraft.code} onChange={(event) => {
                const sanitized = event.target.value.replace(',', '.').replace(/[^0-9.]/g, '');
                const parts = sanitized.split('.');
                const code = (parts.length > 1 ? `${parts[0]}.${parts.slice(1).join('')}` : parts[0]).slice(0, 20);
                setUnitAccountDraft((current) => ({ ...current, code }));
              }} placeholder="contoh: 52199 atau 52199.1" /></label>
              <label className="text-xs font-medium text-slate-500">Nama akun<input className={`${field} mt-1`} maxLength={150} value={unitAccountDraft.name} onChange={(event) => setUnitAccountDraft((current) => ({ ...current, name: event.target.value }))} /></label>
              {creatingUnitAccount && <div className="text-xs font-medium text-slate-500"><span id="unit-account-type-label">Kelompok akun</span><Select items={Object.entries(accountTypeItems).map(([value, label]) => ({ value, label }))} value={unitAccountDraft.type} onValueChange={(value) => value && setUnitAccountDraft((current) => ({ ...current, type: value as AccountType, cashEquivalent: value === 'AKTIVA' ? current.cashEquivalent : false, cashFlowSection: defaultCashFlowSection(value as AccountType, current.code) }))}><SelectTrigger aria-labelledby="unit-account-type-label" className={selectTrigger}><SelectValue /></SelectTrigger><SelectContent className={selectContent}>{Object.entries(accountTypeItems).map(([value, label]) => <SelectItem className={selectItem} key={value} value={value}>{label}</SelectItem>)}</SelectContent></Select></div>}
              {unitAccountDraft.type === 'AKTIVA' && <label className="flex items-center gap-2 self-end pb-2 text-sm"><input type="checkbox" checked={isCashAccount(unitAccountDraft)} onChange={(event) => setUnitAccountDraft((current) => ({ ...current, cashEquivalent: event.target.checked, contra: event.target.checked ? false : current.contra }))} />Akun kas atau bank</label>}
              {!isCashAccount(unitAccountDraft) && <>
                <label className="flex items-center gap-2 self-end pb-2 text-sm"><input type="checkbox" checked={unitAccountDraft.contra} onChange={(event) => setUnitAccountDraft((current) => ({ ...current, contra: event.target.checked }))} />Akun pengurang (kontra), pos saldo {groupNormalBalance(unitAccountDraft.type, unitAccountDraft.contra) === 'CREDIT' ? 'Kredit' : 'Debet'}</label>
                <div className="text-xs font-medium text-slate-500"><span id="unit-account-cashflow-label">Klasifikasi arus kas</span><Select items={cashFlowItems} value={unitAccountDraft.cashFlowSection} onValueChange={(value) => value && setUnitAccountDraft((current) => ({ ...current, cashFlowSection: value as CashFlowSection }))}><SelectTrigger aria-labelledby="unit-account-cashflow-label" className={selectTrigger}><SelectValue /></SelectTrigger><SelectContent className={selectContent}>{CASH_FLOW_SECTIONS.map((section) => <SelectItem className={selectItem} key={section} value={section}>{cashFlowItems[section]}</SelectItem>)}</SelectContent></Select></div>
              </>}
            </div>
            <p className="mt-3 text-xs text-slate-500">Nomor akun dapat berupa angka atau desimal (misalnya 52199 atau 52199.1). Kelompok akun ditetapkan saat akun baru dibuat. Akun pengurang mengurangi kelompoknya, misalnya akumulasi penyusutan (Aktiva bersaldo Kredit). Klasifikasi arus kas menentukan ke bagian mana kas yang dibayar atau diterima lewat akun ini dicatat; perubahannya hanya berlaku untuk jurnal berikutnya.</p>
            <div className="mt-4 flex gap-2"><button type="button" className={button} disabled={busy || !/^\d+(\.\d+)?$/.test(unitAccountDraft.code.trim()) || !unitAccountDraft.name.trim()} onClick={() => void saveUnitAccount()}>{creatingUnitAccount ? 'Buat akun' : 'Simpan perubahan'}</button><button type="button" className={lightButton} onClick={() => { setUnitAccountId(''); setCreatingUnitAccount(false); }}>Batal</button></div>
          </div>}
          <div className="mb-4 space-y-3 border-y border-slate-200 py-4">
            <h3 className="text-sm font-semibold text-slate-900">Saldo awal · 1 September {yearStart}</h3>
            <p className="text-sm text-slate-600">Isi saldo awal setiap akun neraca pada kolom Debet atau Kredit. Total keduanya harus sama. Saldo awal berlaku untuk SatKer dan tahun buku yang dipilih, dan dapat diubah kapan saja. Akun penerimaan dan pengeluaran dimulai dari nol.</p>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="text-sm font-semibold" aria-live="polite">
                <p>Total debet {money(openingDebit)} · kredit {money(openingCredit)}</p>
                <p className={openingDebit === openingCredit ? 'text-green-700' : 'text-amber-700'}>{openingDebit === openingCredit ? 'Seimbang' : `Belum seimbang · selisih ${money(Math.abs(openingDebit - openingCredit))}`}</p>
              </div>
              <div className="flex gap-2">
                <button type="button" className={lightButton} disabled={openingDisabled} onClick={() => setOpeningDraft(data.year?.openingBalances || {})}>Batal perubahan saldo</button>
                <button type="button" className={button} disabled={openingDisabled || !!openingError} onClick={() => void post('SAVE_OPENING', { openingBalances: openingDraft, expectedRevision: data.year?.revision || 0 })}>Simpan saldo awal</button>
              </div>
            </div>
            {openingError && <p role="status" className="text-sm text-amber-700">{openingError}</p>}
          </div>
          <div className="max-h-[32rem] overflow-auto"><table className="w-full text-sm"><thead className="sticky top-0 bg-white"><tr className="text-xs text-slate-500 [&_th]:font-medium"><th className={leftCell}>Nomor</th><th className={leftCell}>Nama akun</th><th className={cell}>Saldo awal Debet</th><th className={cell}>Saldo awal Kredit</th><th className={leftCell}>Kelompok</th><th className={leftCell}>Pos saldo</th><th className={leftCell}>Arus kas</th><th className={leftCell}>Aksi</th></tr></thead><tbody>{[...(data.accounts)].sort((a, b) => a.code.localeCompare(b.code, undefined, { numeric: true })).map((account) => <tr key={account.localAccountId || financialAccountId(account)}><td className={leftCell}>{account.code}</td><td className={leftCell}>{account.name || '—'}</td>
            {(['debit', 'credit'] as const).map((side) => <td key={side} className={cell}>{account.postable && account.reportTarget === 'BALANCE_SHEET'
              ? <div className="ml-auto min-w-40 max-w-48"><CurrencyInput className={`${field} text-right`} aria-label={`Saldo awal ${side === 'debit' ? 'Debet' : 'Kredit'} ${account.code} ${account.name}`} disabled={openingDisabled} value={openingDraft[financialAccountId(account)]?.[side] || 0} onValue={(value) => changeOpening(account, side, value)} /></div>
              : <span className="text-slate-400" title={account.postable ? 'Akun penerimaan dan pengeluaran dimulai dari nol.' : 'Aktifkan akun sebelum mengisi saldo awal.'}>—</span>}</td>)}
            <td className={leftCell}>{accountTypeItems[account.type]}</td>
            <td className={leftCell}>{account.normalBalance ? normalBalanceItems[account.normalBalance] : '—'}{account.normalBalance && account.normalBalance !== groupNormalBalance(account.type) && <span className="text-xs text-slate-500"> (pengurang)</span>}</td>
            <td className={leftCell}>{isCashAccount(account) ? 'Kas/bank' : account.cashFlowSection ? cashFlowItems[account.cashFlowSection] : '—'}</td>
            <td className={leftCell}><button type="button" className={lightButton} onClick={() => { setUnitAccountId(account.localAccountId || financialAccountId(account)); setCreatingUnitAccount(false); setUnitAccountDraft({ code: account.code, name: account.name, type: account.type, cashEquivalent: isCashAccount(account), contra: !!account.normalBalance && account.normalBalance !== groupNormalBalance(account.type), cashFlowSection: account.cashFlowSection || defaultCashFlowSection(account.type, account.code) }); }}>Ubah</button></td></tr>)}</tbody></table></div>
        </Section>}
        {tab === 'pengaturan' && isAdmin && <div className="space-y-5"><Section title="Unit SatKer & pengelola"><div className="grid gap-3 md:grid-cols-2"><label className="text-xs font-medium text-slate-500">ID unik<input className={`${field} mt-1`} value={unitDraft.id} onChange={(event) => setUnitDraft({ ...unitDraft, id: event.target.value })} placeholder="puskomnet" /></label><label className="text-xs font-medium text-slate-500">Nama SatKer<input className={`${field} mt-1`} value={unitDraft.name} onChange={(event) => setUnitDraft({ ...unitDraft, name: event.target.value })} /></label><label className="text-xs font-medium text-slate-500">Nama Kepala SatKer<input className={`${field} mt-1`} value={unitDraft.headName} onChange={(event) => setUnitDraft({ ...unitDraft, headName: event.target.value })} /></label><label className="text-xs font-medium text-slate-500">Nama sekretariat / bendahara<input className={`${field} mt-1`} value={unitDraft.adminName} onChange={(event) => setUnitDraft({ ...unitDraft, adminName: event.target.value })} /></label></div><p className="mt-4 text-xs font-medium text-slate-500">Akun yang boleh mengelola buku keuangan unit ini</p><div className="mt-2 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">{data.editorUsers?.map((editor) => <label key={editor.uid} className="flex items-center gap-2 rounded-md border border-slate-100 p-2 text-sm"><input type="checkbox" checked={unitDraft.editorUids.includes(editor.uid)} onChange={(event) => setUnitDraft({ ...unitDraft, editorUids: event.target.checked ? [...unitDraft.editorUids, editor.uid] : unitDraft.editorUids.filter((uid) => uid !== editor.uid) })} />{editor.displayName} <span className="text-xs text-slate-400">{editor.role}</span></label>)}</div><div className="mt-4 flex gap-2"><button className={button} disabled={busy} onClick={() => void post('SAVE_UNIT', unitDraft)}>Simpan SatKer</button><button className={lightButton} onClick={() => setUnitDraft({ id: '', name: '', headName: '', adminName: '', editorUids: [], expectedRevision: 0 })}>Unit baru</button></div></Section>
          <Section title="Katalog akun umum · 129 kode">
            <p className="mb-3 text-sm text-slate-600">Perubahan di katalog umum berlaku untuk semua SatKer. Gunakan tab Akun untuk mengubah nomor atau nama pada satu unit saja.</p>
            <p className="mb-3 text-sm text-slate-600">Kode kosong pada buku sumber dapat diberi nama dan diaktifkan sebelum kode itu dipakai di saldo awal atau jurnal.</p>
            <div className="block max-w-md text-xs font-medium text-slate-500"><span id="account-code-label">Kode akun</span><Select items={allAccountItems} value={accountEditCode || null} onValueChange={(code) => { setAccountEditCode(code || ''); const account = globalAccounts.find((item) => financialAccountId(item) === code); if (account) setAccountDraft({ name: account.name, normalBalance: account.normalBalance || 'DEBIT', reportTarget: account.reportTarget || (['TERIMA', 'KELUAR'].includes(account.type) ? 'INCOME_STATEMENT' : 'BALANCE_SHEET'), cashEquivalent: isCashAccount(account), cashFlowSection: account.cashFlowSection || 'OPERATING' }); }}><SelectTrigger aria-labelledby="account-code-label" className={selectTrigger}><SelectValue placeholder="Pilih kode" /></SelectTrigger><SelectContent className={selectContent}>{globalAccounts.map((account) => <SelectItem className={selectItem} key={financialAccountId(account)} value={financialAccountId(account)}>{account.code} · {account.name || '(belum bernama)'}</SelectItem>)}</SelectContent></Select></div>
            {accountEditCode && <div className="mt-3 grid gap-3 md:grid-cols-2">
              <label className="text-xs font-medium text-slate-500">Nama akun<input className={`${field} mt-1`} value={accountDraft.name} onChange={(event) => setAccountDraft({ ...accountDraft, name: event.target.value })} /></label>
              <div className="text-xs font-medium text-slate-500"><span id="account-normal-label">Pos saldo</span><Select items={normalBalanceItems} value={accountDraft.normalBalance} onValueChange={(value) => value && setAccountDraft((current) => ({ ...current, normalBalance: value }))}><SelectTrigger aria-labelledby="account-normal-label" className={selectTrigger}><SelectValue /></SelectTrigger><SelectContent className={selectContent}><SelectItem className={selectItem} value="DEBIT">Debet</SelectItem><SelectItem className={selectItem} value="CREDIT">Kredit</SelectItem></SelectContent></Select></div>
              <div className="text-xs font-medium text-slate-500"><span id="account-report-label">Pos laporan</span><Select items={reportTargetItems} value={accountDraft.reportTarget} onValueChange={(value) => value && setAccountDraft((current) => ({ ...current, reportTarget: value }))}><SelectTrigger aria-labelledby="account-report-label" className={selectTrigger}><SelectValue /></SelectTrigger><SelectContent className={selectContent}><SelectItem className={selectItem} value="BALANCE_SHEET">Neraca</SelectItem><SelectItem className={selectItem} value="INCOME_STATEMENT">Laba Rugi</SelectItem></SelectContent></Select></div>
              <div className="text-xs font-medium text-slate-500"><span id="account-cashflow-label">Arus kas</span><Select items={cashFlowItems} value={accountDraft.cashFlowSection} onValueChange={(value) => value && setAccountDraft((current) => ({ ...current, cashFlowSection: value }))}><SelectTrigger aria-labelledby="account-cashflow-label" className={selectTrigger}><SelectValue /></SelectTrigger><SelectContent className={selectContent}><SelectItem className={selectItem} value="OPERATING">Operasional</SelectItem><SelectItem className={selectItem} value="INVESTING">Investasi</SelectItem><SelectItem className={selectItem} value="FINANCING">Pendanaan</SelectItem></SelectContent></Select></div>
              <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={accountDraft.cashEquivalent} onChange={(event) => setAccountDraft({ ...accountDraft, cashEquivalent: event.target.checked })} />Akun kas atau bank</label>
              <button className={button} disabled={busy || !accountDraft.name.trim()} onClick={() => void post('SAVE_ACCOUNT', { code: accountEditCode, ...accountDraft, cashFlowSection: accountDraft.cashEquivalent ? null : accountDraft.cashFlowSection, expectedRevision: globalAccounts.find((item) => financialAccountId(item) === accountEditCode)?.revision || 0 })}>Simpan akun</button>
            </div>}
          </Section></div>}
      </>}
    </div>
    <Dialog open={deletingEntry !== null} onOpenChange={(open) => { if (!open && !busy) closeDelete(); }}>
      <DialogContent showCloseButton={false} className="rounded-md sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="text-base font-semibold text-slate-900">Hapus jurnal ini?</DialogTitle>
          <DialogDescription render={<div />} className="space-y-2 text-sm leading-relaxed text-slate-600">
            <p>{deletingEntry?.date} · {deletingEntry?.description} · {money(deletingEntry?.totalAmount)}</p>
            <p>{deletingEntry?.kind === 'REVERSAL' ? 'Ini jurnal pembalik. Setelah dihapus, jurnal yang dibalik berlaku kembali dalam laporan.' : 'Jurnal dihapus dari buku dan tidak lagi dihitung dalam laporan.'} Riwayatnya tetap tercatat di Jejak Audit beserta alasannya.</p>
          </DialogDescription>
        </DialogHeader>
        <label className="text-xs font-medium text-slate-500">Alasan penghapusan<textarea className={`${field} mt-1`} rows={3} maxLength={500} value={deleteReason} onChange={(event) => setDeleteReason(event.target.value)} placeholder="Contoh: salah input nominal" /></label>
        {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
        <DialogFooter className="rounded-b-md">
          <Button className="rounded-sm" type="button" variant="outline" size="lg" disabled={busy} onClick={closeDelete}>Kembali</Button>
          <Button className="rounded-sm" type="button" variant="danger" size="lg" disabled={busy || deleteReason.trim().length < 3} onClick={() => void deleteEntry()}>{busy ? <Loader2 className="animate-spin" /> : null}Hapus jurnal</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
    {receiptPreview && <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/80 p-4" onClick={() => { URL.revokeObjectURL(receiptPreview); setReceiptPreview(''); }}>
      <button className="absolute right-5 top-5 rounded-md bg-white px-3 py-2 text-sm font-semibold">Tutup</button>
      {receiptPreviewType?.mime === 'application/pdf' ? <iframe title="Bukti transaksi" src={receiptPreview} className="h-[90vh] w-full max-w-4xl rounded-md bg-white" onClick={(event) => event.stopPropagation()} />
        : receiptPreviewType && !receiptPreviewType.inlinePreview ? <div className="max-w-sm rounded-md bg-white p-5 text-sm text-slate-700" onClick={(event) => event.stopPropagation()}><p>Bukti ini berformat {receiptPreviewType.label}, yang tidak bisa ditampilkan langsung di peramban.</p><a className={`${button} mt-4`} href={receiptPreview} download={`bukti-transaksi.${receiptPreviewType.extension}`}>Unduh berkas</a></div>
        : <Image src={receiptPreview} alt="Bukti transaksi" width={1000} height={1000} unoptimized className="max-h-[90vh] max-w-full object-contain" />}
    </div>}
  </div>;
}

function BalanceLine({ label, amount, subtotal, total }: { label: string; amount: number; subtotal?: boolean; total?: boolean }) {
  return <div className={`flex justify-between gap-3 py-2 text-sm ${total ? 'mt-1 border-t-2 border-slate-300 font-semibold' : subtotal ? 'border-b font-medium text-slate-700' : 'border-b'}`}><span>{label}</span><strong className="font-semibold tabular-nums">{money(amount)}</strong></div>;
}
function FragmentPair() { return <><th className="border-b px-2 py-2 text-right font-medium">D</th><th className="border-b px-2 py-2 text-right font-medium">K</th></>; }
function FragmentAmounts({ debit, credit }: { debit: number; credit: number }) { return <><td className={cell}>{fmt(debit)}</td><td className={cell}>{fmt(credit)}</td></>; }
