"use client";

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  AlertCircle,
  Check,
  CheckCircle2,
  Eye,
  FileDown,
  FileText,
  Link2,
  Loader2,
  Lock,
  Plus,
  Search,
  Trash2,
  Upload,
  Users,
  X,
} from 'lucide-react';
import { uploadProofFile } from '@/lib/uploads';
import { renderFileToCanvas } from '@/utils/ocrParser';
import {
  createExpenseReport,
  createExpenseReportRow,
  createStableId,
  ExpenseReport,
  ExpenseReportMode,
  ExpenseReportRow,
  getExpenseGroupRows,
  getExpenseReportActualTotal,
  getExpenseReportBudgetTotal,
  getExpenseReportRowsForItem,
  getExpenseReportRowsQuantity,
  getExpenseReportRowsSubtotal,
  hasExpenseReportContent,
  MAX_EXPENSE_REPORT_RECEIPT_BYTES,
  normalizeExpenseReport,
  parseProposalQty,
  ProposalExpenseRow,
  sanitizeForFirestore,
  seedExpenseReportRows,
  validateExpenseReport,
} from '@/lib/payroll/proposalExpenseReports';
import { focusCellInDirection, handleRowCellKeyDown } from '@/lib/tableKeyboardNav';

const MAX_RECEIPT_INPUT_BYTES = 25 * 1024 * 1024;
const RECEIPT_MAX_DIMENSION = 1600;
const RECEIPT_ACCEPT_TYPES = ['application/pdf', 'image/jpeg', 'image/jpg', 'image/png', 'image/webp'];

function canvasToJpegBlob(canvas: HTMLCanvasElement, quality: number): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('Gagal mengompresi gambar bukti.'))), 'image/jpeg', quality);
  });
}

function scaleCanvas(source: HTMLCanvasElement, scale: number): HTMLCanvasElement {
  const target = document.createElement('canvas');
  target.width = Math.max(1, Math.round(source.width * scale));
  target.height = Math.max(1, Math.round(source.height * scale));
  const ctx = target.getContext('2d');
  if (!ctx) throw new Error('Perangkat tidak mendukung kompresi gambar.');
  ctx.drawImage(source, 0, 0, target.width, target.height);
  return target;
}

/** Rasterizes an image or PDF receipt (first page) and re-encodes it as a JPEG under the shared storage limit. */
async function compressReceiptFile(file: File): Promise<File> {
  const rendered = await renderFileToCanvas(file);
  const initialScale = Math.min(1, RECEIPT_MAX_DIMENSION / Math.max(rendered.width, rendered.height));
  let canvas = initialScale < 1 ? scaleCanvas(rendered, initialScale) : rendered;

  let quality = 0.85;
  let blob = await canvasToJpegBlob(canvas, quality);
  while (blob.size > MAX_EXPENSE_REPORT_RECEIPT_BYTES && quality > 0.35) {
    quality -= 0.15;
    blob = await canvasToJpegBlob(canvas, quality);
  }
  while (blob.size > MAX_EXPENSE_REPORT_RECEIPT_BYTES && Math.max(canvas.width, canvas.height) > 500) {
    canvas = scaleCanvas(canvas, 0.75);
    blob = await canvasToJpegBlob(canvas, 0.6);
  }

  const baseName = file.name.replace(/\.[^/.]+$/, '').replace(/[^A-Za-z0-9_-]/g, '_') || 'bukti';
  return new File([blob], `${baseName}.jpg`, { type: 'image/jpeg', lastModified: Date.now() });
}

async function uploadExpenseReceipt(
  file: File,
  reportId: string,
  headerRowId: string,
): Promise<{ url: string; fileName: string }> {
  const url = await uploadProofFile('/api/uploads/expense-report-receipts', file, {
    reportId,
    headerRowId,
  });
  return { url, fileName: file.name };
}

interface EmployeeOption {
  id: string;
  name: string;
  role?: string;
  department?: string;
}

interface ExpenseReportStageProps {
  expenseRows: ProposalExpenseRow[];
  expenseReports: ExpenseReport[];
  employees: EmployeeOption[];
  unlocked: boolean;
  readOnly?: boolean;
  openGroupRowId?: string | null;
  onOpenGroupHandled?: () => void;
  onUpsertReport: (report: ExpenseReport) => void;
  onReportSaved?: (report: ExpenseReport) => void;
  onUnlinkReport: (reportId: string) => void;
  onPrintReport: (report: ExpenseReport) => void;
  printingReport?: boolean;
  fmtRp: (amount: number) => string;
  parseQty?: (value: string) => number;
}

interface ReportSaveChange {
  headerLabel: string;
  currentQty: string;
  nextQty: string;
  currentRealisasi: number;
  nextRealisasi: number;
  qtyChanged: boolean;
  realisasiChanged: boolean;
}

interface PendingReportSave {
  report: ExpenseReport;
  changes: ReportSaveChange[];
}

const parseMoney = (value: string): number => {
  const parsed = parseInt(value.replace(/\D/g, ''), 10);
  return Number.isFinite(parsed) ? parsed : 0;
};

const formatQuantity = (value: number): string => {
  if (Number.isInteger(value)) return String(value);
  return String(Number(value.toFixed(2)));
};

const formatQuantityLike = (value: number, source: string): string => {
  const suffix = source.trim().replace(/^[\d.\s]+/, '').trim();
  return suffix ? `${formatQuantity(value)} ${suffix}` : formatQuantity(value);
};

function modeLabel(mode: ExpenseReportMode): string {
  return mode === 'employee' ? 'Pembayaran Pegawai' : 'Pengeluaran Tanpa Pegawai';
}

function getGroupBudget(rows: ProposalExpenseRow[], index: number, parseQty: (value: string) => number): number {
  return getExpenseGroupRows(rows, index).reduce(
    (sum, row) => sum + parseQty(row.rincianQty) * (row.rincianRate || 0),
    0,
  );
}

function getGroupActual(rows: ProposalExpenseRow[], index: number): number {
  return getExpenseGroupRows(rows, index).reduce((sum, row) => sum + (row.realisasi || 0), 0);
}

function getModalReportRowLabels(report: ExpenseReport, expenseRows: ProposalExpenseRow[]): Map<string, string> {
  const labels = new Map<string, string>();
  const groupHeaderIndex = expenseRows.findIndex(
    (row) => row.type === 'group_header' && row.rowId === report.expenseRowId,
  );
  if (groupHeaderIndex === -1) return labels;

  getExpenseGroupRows(expenseRows, groupHeaderIndex).forEach((headerItem, headerIndex) => {
    getExpenseReportRowsForItem(report, headerItem).forEach((row, childIndex) => {
      if (!labels.has(row.id)) {
        labels.set(row.id, `Baris ${headerIndex + 1}.${childIndex + 1}`);
      }
    });
  });
  return labels;
}

function ReportModeCard({
  mode,
  selected,
  disabled,
  onClick,
}: {
  mode: ExpenseReportMode;
  selected: boolean;
  disabled: boolean;
  onClick: () => void;
}) {
  const employee = mode === 'employee';
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className={`rounded-2xl border p-4 text-left transition-all ${selected
        ? 'border-indigo-300 bg-indigo-50 ring-2 ring-indigo-100'
        : 'border-slate-200 bg-white hover:border-indigo-200 hover:bg-indigo-50/40'} ${disabled ? 'cursor-not-allowed opacity-60' : 'cursor-pointer'}`}
    >
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-[10px] font-black uppercase tracking-wider text-indigo-500">Mode laporan</p>
          <h4 className="mt-1 text-sm font-black text-slate-900">{modeLabel(mode)}</h4>
        </div>
        {selected && <CheckCircle2 className="h-5 w-5 shrink-0 text-indigo-600" />}
      </div>
      <p className="mt-2 text-[11px] leading-relaxed text-slate-500">
        {employee
          ? 'Setiap rincian harus terhubung ke pegawai aktif. Nominal hanya untuk simulasi laporan dan tidak dikirim ke payroll.'
          : 'Gunakan untuk konsumsi, ATK, rapat, bukti pembelian, atau pengeluaran lain tanpa penerima pegawai.'}
      </p>
    </button>
  );
}

function EmployeeSearch({
  row,
  employees,
  disabled,
  onChange,
  onConnect,
  onDisconnect,
  onKeyDown,
}: {
  row: ExpenseReportRow;
  employees: EmployeeOption[];
  disabled: boolean;
  onChange: (value: string) => void;
  onConnect: (employee: EmployeeOption) => void;
  onDisconnect: () => void;
  onKeyDown?: (event: React.KeyboardEvent<HTMLInputElement>) => void;
}) {
  const isConnected = Boolean(row.employeeId);
  const searchText = row.employeeSearchText ?? row.employeeName;

  // Only show search dropdown when unconnected or when user actively edits the search text
  const isActivelyEditing = !isConnected || (row.employeeSearchText !== undefined && row.employeeSearchText !== row.employeeName);

  const matches = isActivelyEditing && searchText.trim().length > 0
    ? employees.filter((employee) =>
      employee.name.toLowerCase().includes(searchText.toLowerCase()) ||
      employee.id.toLowerCase().includes(searchText.toLowerCase()) ||
      (employee.role || '').toLowerCase().includes(searchText.toLowerCase())
    ).slice(0, 8)
    : [];

  const [highlightedIndex, setHighlightedIndex] = useState(0);

  useEffect(() => {
    setHighlightedIndex(0);
  }, [searchText]);

  const handleInputKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (matches.length > 0) {
      if (event.key === 'ArrowDown') {
        event.preventDefault();
        setHighlightedIndex((i) => Math.min(i + 1, matches.length - 1));
        return;
      }
      if (event.key === 'ArrowUp') {
        event.preventDefault();
        setHighlightedIndex((i) => Math.max(i - 1, 0));
        return;
      }
      if (event.key === 'Enter' && !event.shiftKey) {
        event.preventDefault();
        const selected = matches[highlightedIndex] ?? matches[0];
        if (selected) onConnect(selected);
        return;
      }
    }
    onKeyDown?.(event);
  };

  return (
    <div className="w-full">
      <div className="relative flex items-center">
        <Input
          type="text"
          value={searchText}
          disabled={disabled}
          placeholder="Cari pegawai aktif..."
          onChange={(event) => onChange(event.target.value)}
          onKeyDown={handleInputKeyDown}
          className={`h-8 w-full rounded-lg text-xs transition-all ${
            isConnected
              ? 'border-emerald-300 bg-emerald-50/90 font-bold text-emerald-950 pl-3 pr-8 shadow-2xs focus:bg-white focus:text-slate-900 focus:border-indigo-400'
              : 'border-slate-200 bg-white font-semibold text-slate-900 pl-3 pr-3 focus:border-indigo-400'
          }`}
        />

        {isConnected && (
          <Check className="pointer-events-none absolute right-2.5 h-3.5 w-3.5 stroke-[3] text-emerald-600 shrink-0" />
        )}

        {!disabled && matches.length > 0 && (
          <div className="absolute left-0 right-0 top-9 z-[80] max-h-48 overflow-y-auto rounded-xl border border-slate-200 bg-white shadow-xl">
            {matches.map((employee, index) => (
              <button
                key={employee.id}
                type="button"
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => onConnect(employee)}
                onMouseEnter={() => setHighlightedIndex(index)}
                className={`flex w-full items-center justify-between gap-2 border-b border-slate-50 px-3 py-2 text-left transition-colors last:border-0 ${
                  index === highlightedIndex ? 'bg-indigo-50' : 'hover:bg-indigo-50'
                }`}
              >
                <span className="min-w-0">
                  <span className="block truncate text-xs font-bold text-slate-900">{employee.name}</span>
                  <span className="mt-0.5 block truncate text-[9px] text-slate-400">{employee.role || 'Pegawai'} · {employee.id}</span>
                </span>
                <span className="shrink-0 rounded-lg bg-indigo-100 px-2 py-1 text-[9px] font-black text-indigo-700">Hubungkan</span>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

export default function ExpenseReportStage({
  expenseRows,
  expenseReports,
  employees,
  unlocked,
  readOnly = false,
  openGroupRowId = null,
  onOpenGroupHandled,
  onUpsertReport,
  onReportSaved,
  onUnlinkReport,
  onPrintReport,
  printingReport = false,
  fmtRp,
  parseQty = parseProposalQty,
}: ExpenseReportStageProps) {
  const [dialogOpen, setDialogOpen] = useState(false);
  const [draftReport, setDraftReport] = useState<ExpenseReport | null>(null);
  const [formErrors, setFormErrors] = useState<string[]>([]);
  const [uploadingReceiptKey, setUploadingReceiptKey] = useState<string | null>(null);
  const [receiptError, setReceiptError] = useState<string | null>(null);
  const [pendingSave, setPendingSave] = useState<PendingReportSave | null>(null);

  const groupRows = useMemo(() => expenseRows
    .map((row, index) => ({ row, index }))
    .filter(({ row }) => row.type === 'group_header' && row.uraian.trim()), [expenseRows]);

  const openReport = useCallback((group: ProposalExpenseRow, groupIndex: number) => {
    if (!unlocked) return;
    const linked = group.reportId
      ? expenseReports.find((report) => report.id === group.reportId && hasExpenseReportContent(report))
      : undefined;
    const normalized = linked ? normalizeExpenseReport(linked, {
      expenseRowId: group.rowId || '',
      expenseLabel: group.uraian,
    }) : null;
    const report = normalized || createExpenseReport(
      createStableId('expense-report'),
      group.rowId || createStableId('expense-row'),
      group.uraian,
      'employee',
      seedExpenseReportRows(expenseRows, groupIndex),
    );
    setDraftReport({
      ...report,
      expenseRowId: group.rowId || report.expenseRowId,
      expenseLabel: group.uraian,
      title: report.title || `Laporan ${group.uraian}`,
    });
    setFormErrors([]);
    setReceiptError(null);
    setDialogOpen(true);
  }, [expenseReports, expenseRows, unlocked]);

  useEffect(() => {
    if (!openGroupRowId || !unlocked) return;
    const timer = window.setTimeout(() => {
      const target = groupRows.find(({ row }) => row.rowId === openGroupRowId);
      if (target) openReport(target.row, target.index);
      onOpenGroupHandled?.();
    }, 0);
    return () => window.clearTimeout(timer);
  }, [groupRows, onOpenGroupHandled, openGroupRowId, openReport, unlocked]);

  const [autosaveStatus, setAutosaveStatus] = useState<'idle' | 'saving' | 'saved'>('idle');

  const updateDraft = (updater: (report: ExpenseReport) => ExpenseReport) => {
    setDraftReport((current) => current ? updater(current) : current);
    setFormErrors([]);
  };

  const updateDraftRow = (rowId: string, updater: (row: ExpenseReportRow) => ExpenseReportRow) => {
    updateDraft((report) => ({
      ...report,
      rows: report.rows.map((row) => row.id === rowId ? updater(row) : row),
    }));
  };

  const getReportSaveChanges = (report: ExpenseReport): ReportSaveChange[] => {
    const groupHeaderIndex = expenseRows.findIndex(
      (row) => row.type === 'group_header' && row.rowId === report.expenseRowId,
    );
    if (groupHeaderIndex === -1) return [];

    return getExpenseGroupRows(expenseRows, groupHeaderIndex).flatMap((headerItem) => {
      const childRows = getExpenseReportRowsForItem(report, headerItem);
      if (childRows.length === 0) return [];

      const headerAnggaran = parseQty(headerItem.rincianQty) * headerItem.rincianRate;
      const currentRealisasi = headerItem.realisasi ?? headerAnggaran;
      const childQty = getExpenseReportRowsQuantity(childRows, parseQty);
      const nextRealisasi = getExpenseReportRowsSubtotal(childRows, parseQty);
      const qtyChanged = Math.abs(childQty - parseQty(headerItem.rincianQty)) >= 0.001;
      const realisasiChanged = Math.abs(nextRealisasi - currentRealisasi) >= 1;

      if (!qtyChanged && !realisasiChanged) return [];

      return [{
        headerLabel: headerItem.uraian,
        currentQty: headerItem.rincianQty || '-',
        nextQty: formatQuantityLike(childQty, headerItem.rincianQty),
        currentRealisasi,
        nextRealisasi,
        qtyChanged,
        realisasiChanged,
      }];
    });
  };

  const handleReportRowCellKeyDown = (
    event: React.KeyboardEvent<HTMLInputElement>,
    onShiftEnter?: () => void,
  ) => {
    if (event.key === 'Enter' && event.shiftKey) {
      event.preventDefault();
      const input = event.currentTarget;
      onShiftEnter?.();
      if (onShiftEnter) {
        window.setTimeout(() => focusCellInDirection(input, 'down'), 0);
      }
      return;
    }
    handleRowCellKeyDown(event, onShiftEnter);
  };

  const handleReceiptFileChange = async (headerRowId: string, headerLabel: string, file: File) => {
    if (!RECEIPT_ACCEPT_TYPES.includes(file.type)) {
      setReceiptError('Format bukti tidak valid. Gunakan PDF, JPG, atau PNG.');
      return;
    }
    if (file.size > MAX_RECEIPT_INPUT_BYTES) {
      setReceiptError('Ukuran file terlalu besar untuk diproses (maks 25MB).');
      return;
    }
    setReceiptError(null);
    setUploadingReceiptKey(headerRowId);
    try {
      const compressed = await compressReceiptFile(file);
      if (compressed.size > MAX_EXPENSE_REPORT_RECEIPT_BYTES) {
        throw new Error('Bukti masih melebihi batas 1MB setelah dikompresi.');
      }
      const reportId = draftReport?.id || createStableId('expense-report');
      const { url, fileName } = await uploadExpenseReceipt(compressed, reportId, headerRowId);
      updateDraft((report) => ({
        ...report,
        receipts: { ...report.receipts, [headerRowId]: { url, fileName, label: headerLabel || 'Bukti Pengeluaran' } },
      }));
    } catch (error) {
      console.error('Error uploading expense receipt:', error);
      setReceiptError('Gagal mengunggah bukti. Coba lagi.');
    } finally {
      setUploadingReceiptKey(null);
    }
  };

  const handleReceiptRemove = (headerRowId: string) => {
    updateDraft((report) => {
      const receipts = { ...report.receipts };
      delete receipts[headerRowId];
      return { ...report, receipts };
    });
  };

  // Live Autosave on every input / change
  useEffect(() => {
    if (!draftReport || readOnly || !dialogOpen) return;
    setAutosaveStatus('saving');
    const timer = setTimeout(() => {
      onUpsertReport(sanitizeForFirestore({ ...draftReport, source: draftReport.source || 'custom' }));
      setAutosaveStatus('saved');
    }, 350);
    return () => clearTimeout(timer);
  }, [draftReport, readOnly, dialogOpen, onUpsertReport]);

  const closeDialog = () => {
    if (draftReport && !readOnly) {
      onUpsertReport(sanitizeForFirestore({ ...draftReport, source: draftReport.source || 'custom' }));
    }
    setDialogOpen(false);
    setDraftReport(null);
    setFormErrors([]);
    setReceiptError(null);
    setAutosaveStatus('idle');
    setPendingSave(null);
  };

  const applySavedReport = (savedReport: ExpenseReport) => {
    onUpsertReport(savedReport);
    onReportSaved?.(savedReport);
    closeDialog();
  };

  const saveDraft = () => {
    if (!draftReport) return;
    const rowLabels = getModalReportRowLabels(draftReport, expenseRows);
    const getDraftRowLabel = (row: ExpenseReportRow, index: number) => rowLabels.get(row.id) || `Baris ${index + 1}`;
    const validation = validateExpenseReport(draftReport, parseQty, getDraftRowLabel);
    const invalidActiveEmployees = draftReport.mode === 'employee'
      ? validation.populatedRows.filter((row) => row.employeeId && !employees.some((employee) => employee.id === row.employeeId))
      : [];
    const errors = [
      ...validation.errors,
      ...invalidActiveEmployees.map((row) => {
        const rowIndex = draftReport.rows.findIndex((item) => item.id === row.id);
        return `${getDraftRowLabel(row, Math.max(0, rowIndex))}: pegawai sudah tidak aktif atau tidak ditemukan.`;
      }),
    ];
    if (errors.length > 0) {
      setFormErrors(Array.from(new Set(errors)));
      return;
    }
    const savedReport = sanitizeForFirestore({ ...draftReport, source: draftReport.source || 'custom' });
    const changes = getReportSaveChanges(savedReport);
    if (changes.length > 0) {
      setPendingSave({ report: savedReport, changes });
      return;
    }
    applySavedReport(savedReport);
  };

  const confirmPendingSave = () => {
    if (!pendingSave) return;
    applySavedReport(pendingSave.report);
  };

  return (
    <section className="space-y-4 rounded-2xl border border-indigo-100 bg-gradient-to-br from-indigo-50/50 via-white to-slate-50/80 p-4 md:p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <Link2 className="h-4 w-4 text-indigo-600" />
            <h3 className="text-sm font-black uppercase tracking-wider text-indigo-900">Laporan Per Pos Pengeluaran</h3>
          </div>
          <p className="mt-1 max-w-3xl text-[11px] leading-relaxed text-slate-500">
            Hubungkan setiap header grup LPJ ke laporan custom. Format laporan dapat disesuaikan per kebutuhan dan tidak mengubah PDF anggaran maupun PDF realisasi.
          </p>
        </div>
        <div className="rounded-xl border border-indigo-100 bg-white px-3 py-2 text-[10px] font-bold text-slate-500">
          {groupRows.filter(({ row }) => row.reportId).length}/{groupRows.length} header terhubung
        </div>
      </div>

      {!unlocked ? (
        <div className="rounded-2xl border border-dashed border-amber-200 bg-amber-50/60 p-5 text-center">
          <p className="text-xs font-bold text-amber-800">Hubungan laporan tersedia setelah proposal anggaran disetujui.</p>
        </div>
      ) : groupRows.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-indigo-200 bg-white p-7 text-center">
          <Link2 className="mx-auto h-8 w-8 text-indigo-300" />
          <p className="mt-3 text-sm font-bold text-slate-800">Belum ada header grup pengeluaran</p>
          <p className="mx-auto mt-1 max-w-lg text-xs leading-relaxed text-slate-500">Tambahkan header grup pada tabel Realisasi Keuangan terlebih dahulu. Hanya header grup yang dapat dihubungkan ke laporan.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-3 xl:grid-cols-2">
          {groupRows.map(({ row, index }) => {
            const linked = row.reportId
              ? expenseReports.find((report) => report.id === row.reportId && hasExpenseReportContent(report))
              : undefined;
            const budget = getGroupBudget(expenseRows, index, parseQty);
            const actual = getGroupActual(expenseRows, index);
            return (
              <Card key={row.rowId || `${row.uraian}-${index}`} className="border-slate-200 bg-white p-4 shadow-sm">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-[10px] font-black uppercase tracking-wider text-indigo-500">Header grup LPJ</p>
                    <h4 className="mt-1 truncate text-sm font-black text-slate-900">{row.uraian}</h4>
                    <p className="mt-1 text-[10px] text-slate-400">{getExpenseGroupRows(expenseRows, index).length} rincian anak · Anggaran {fmtRp(budget)} · Realisasi {fmtRp(actual)}</p>
                  </div>
                  {linked ? (
                    <span className="inline-flex shrink-0 items-center gap-1 rounded-lg bg-emerald-50 px-2 py-1 text-[10px] font-bold text-emerald-700"><CheckCircle2 className="h-3 w-3" /> Terhubung</span>
                  ) : (
                    <span className="inline-flex shrink-0 items-center gap-1 rounded-lg bg-amber-50 px-2 py-1 text-[10px] font-bold text-amber-700">Belum terhubung</span>
                  )}
                </div>
                {linked && (
                  <div className="mt-3 rounded-xl border border-slate-100 bg-slate-50/70 px-3 py-2.5">
                    <div className="flex items-center justify-between gap-2">
                      <p className="truncate text-xs font-bold text-slate-800">{linked.title || 'Tanpa judul'}</p>
                      <span className="shrink-0 rounded-md bg-indigo-100 px-2 py-0.5 text-[9px] font-black text-indigo-700">{modeLabel(linked.mode)}</span>
                    </div>
                    <p className="mt-1 text-[10px] text-slate-500">Anggaran {fmtRp(getExpenseReportBudgetTotal(linked, parseQty))} · Realisasi {fmtRp(getExpenseReportActualTotal(linked))}</p>
                  </div>
                )}
                <div className="mt-3 flex flex-wrap items-center gap-2">
                  <Button type="button" disabled={readOnly && !linked} onClick={() => openReport(row, index)} className="h-8 rounded-lg bg-indigo-600 px-3 text-[10px] font-bold text-white hover:bg-indigo-700 disabled:cursor-not-allowed disabled:opacity-50">
                    {linked ? <><FileDown className="mr-1.5 h-3.5 w-3.5" /> Buka / Edit Laporan</> : <><Link2 className="mr-1.5 h-3.5 w-3.5" /> Hubungkan Header Grup ke Laporan</>}
                  </Button>
                  {linked && !readOnly && (
                    <Button type="button" variant="ghost" onClick={() => onUnlinkReport(linked.id)} className="h-8 rounded-lg px-3 text-[10px] font-bold text-rose-600 hover:bg-rose-50">
                      <X className="mr-1 h-3.5 w-3.5" /> Lepas
                    </Button>
                  )}
                </div>
              </Card>
            );
          })}
        </div>
      )}

      <Dialog open={dialogOpen} onOpenChange={(open) => { if (!open) closeDialog(); }}>
        <DialogContent className="flex h-[92vh] max-h-[95vh] w-[96vw] max-w-[96vw] sm:max-w-[96vw] flex-col overflow-hidden rounded-3xl border-none bg-white p-0 shadow-2xl">
          <DialogHeader className="shrink-0 border-b border-slate-100 bg-gradient-to-r from-indigo-50 to-slate-50 p-5 md:p-6">
            <DialogTitle className="flex items-center gap-2.5 text-lg font-bold text-slate-800">
              <Link2 className="h-5 w-5 text-indigo-600" /> Hubungkan Header Grup ke Laporan
            </DialogTitle>
            <p className="mt-1 text-xs leading-relaxed text-slate-500">Buat format laporan reusable untuk rincian header LPJ ini. QTY, RATE, ANGGARAN, dan REALISASI mengikuti pola tabel proposal/LPJ.</p>
          </DialogHeader>

          {draftReport && (
            <div className="min-h-0 flex-1 overflow-hidden p-5 md:p-6">
              <div className="grid h-full min-h-0 grid-cols-1 gap-6 lg:grid-cols-12">
                {/* Left Side: Meta, Title, Notes & Mode Selection */}
                <div className="flex flex-col space-y-4 overflow-y-auto pr-0 xl:col-span-3 lg:col-span-4 lg:border-r lg:border-slate-100 lg:pr-5">
                  <div className="rounded-2xl border border-indigo-100 bg-indigo-50/50 p-4 shadow-2xs">
                    <span className="block text-[10px] font-black uppercase tracking-wider text-indigo-500">Header grup yang dipilih</span>
                    <span className="mt-1 block text-sm font-black text-slate-900">{draftReport.expenseLabel}</span>
                  </div>

                  <div className="space-y-3 bg-slate-50/50 p-4 rounded-2xl border border-slate-150">
                    <div className="space-y-1.5">
                      <label className="text-[10px] font-black uppercase tracking-wider text-slate-600">Judul laporan custom</label>
                      <Input value={draftReport.title} disabled={readOnly} onChange={(event) => updateDraft((report) => ({ ...report, title: event.target.value }))} placeholder="Contoh: Laporan Pembayaran Tim Pelaksana" className="h-10 rounded-xl bg-white border-slate-200 text-sm font-bold text-slate-900" />
                    </div>
                  </div>

                  <div className="space-y-2">
                    <label className="text-[10px] font-black uppercase tracking-wider text-slate-500">Mode Laporan</label>
                    <div className="grid grid-cols-1 gap-3">
                      <ReportModeCard mode="employee" selected={draftReport.mode === 'employee'} disabled={readOnly} onClick={() => updateDraft((report) => ({ ...report, mode: 'employee' }))} />
                      <ReportModeCard mode="expense" selected={draftReport.mode === 'expense'} disabled={readOnly} onClick={() => updateDraft((report) => ({ ...report, mode: 'expense' }))} />
                    </div>
                  </div>

                  {formErrors.length > 0 && (
                    <div className="rounded-2xl border border-rose-200 bg-rose-50 p-4 text-xs text-rose-800 shadow-2xs">
                      <p className="font-black">Periksa laporan sebelum disimpan:</p>
                      <ul className="mt-1 list-disc space-y-0.5 pl-4">{formErrors.map((error) => <li key={error}>{error}</li>)}</ul>
                    </div>
                  )}
                </div>

                {/* Right Side: Item Details Table */}
                <div className="flex h-full min-h-0 flex-col space-y-3 xl:col-span-9 lg:col-span-8">
                  <div className="flex shrink-0 items-center justify-between">
                    <div>
                      <h4 className="text-xs font-black uppercase tracking-wider text-slate-800">Rincian Item & Nominal Laporan</h4>
                      <p className="mt-0.5 text-[11px] text-slate-500">Isi uraian, pegawai/penerima, qty, rate, dan realisasi.</p>
                    </div>
                    <div className="flex items-center gap-3">
                      {receiptError && <span className="text-[11px] font-bold text-rose-600">{receiptError}</span>}
                      {!readOnly && (
                        <Button type="button" variant="outline" onClick={() => updateDraft((report) => ({ ...report, rows: [...report.rows, createExpenseReportRow({ id: createStableId('expense-report-row') })] }))} className="h-8.5 rounded-xl border-indigo-200 bg-indigo-50/50 text-xs font-bold text-indigo-700 hover:bg-indigo-100">
                          <Plus className="mr-1.5 h-3.5 w-3.5" /> Tambah Baris
                        </Button>
                      )}
                    </div>
                  </div>

                  <div className="relative min-h-0 flex-1 overflow-auto rounded-2xl border border-slate-200 bg-white">
                    <table className="w-full min-w-[1000px] border-collapse text-left">
                      <thead>
                        <tr className="sticky top-0 z-20 border-b border-slate-200 bg-slate-100 shadow-2xs">
                          <th className="w-12 px-3 py-3 text-center text-[10px] font-black uppercase text-slate-600">No</th>
                          <th className="w-[210px] max-w-[210px] px-3 py-3 text-[10px] font-black uppercase text-slate-600">Uraian / Pegawai</th>
                          <th className="w-[190px] px-3 py-3 text-center text-[10px] font-black uppercase text-slate-600">QTY</th>
                          <th className="w-[150px] px-3 py-3 text-right text-[10px] font-black uppercase text-slate-600">RATE</th>
                          <th className="w-[160px] px-3 py-3 text-right text-[10px] font-black uppercase text-slate-600">REALISASI</th>
                          <th className="w-[260px] px-3 py-3 text-right text-[10px] font-black uppercase text-slate-600">Status / Aksi</th>
                        </tr>
                      </thead>
                      <tbody>
                        {(() => {
                          const groupHeaderIndex = expenseRows.findIndex(
                            (r) => r.type === 'group_header' && r.rowId === draftReport.expenseRowId
                          );
                          const headerItems = groupHeaderIndex !== -1 ? getExpenseGroupRows(expenseRows, groupHeaderIndex) : [];

                          if (headerItems.length === 0) {
                            return draftReport.rows.map((row, index) => {
                              return (
                                <tr key={row.id} className="border-b border-slate-100 align-top hover:bg-slate-50/50">
                                  <td className="px-3 py-3 text-center text-xs font-bold text-slate-400">{index + 1}</td>
                                  <td className="px-3 py-3">
                                    <div className="space-y-2">
                                      <Input value={row.uraian} disabled={readOnly} onChange={(event) => updateDraftRow(row.id, (current) => ({ ...current, uraian: event.target.value }))} placeholder="Uraian rincian..." className="h-8 rounded-lg border-slate-200 text-xs font-semibold" />
                                      {draftReport.mode === 'employee' && (
                                        <EmployeeSearch
                                          row={row}
                                          employees={employees}
                                          disabled={readOnly}
                                          onChange={(value) => updateDraftRow(row.id, (current) => ({ ...current, employeeId: '', employeeName: '', employeeSearchText: value }))}
                                          onConnect={(employee) => updateDraftRow(row.id, (current) => ({ ...current, employeeId: employee.id, employeeName: employee.name, employeeSearchText: employee.name }))}
                                          onDisconnect={() => updateDraftRow(row.id, (current) => ({ ...current, employeeId: '', employeeName: '', employeeSearchText: '' }))}
                                        />
                                      )}
                                    </div>
                                  </td>
                                  <td className="px-3 py-3"><Input value={row.rincianQty} disabled={readOnly} onChange={(event) => updateDraftRow(row.id, (current) => ({ ...current, rincianQty: event.target.value }))} placeholder="10 / 20%" className="h-8 rounded-lg border-slate-200 text-center text-xs font-bold" /></td>
                                  <td className="px-3 py-3"><Input type="text" inputMode="numeric" value={row.rincianRate > 0 ? fmtRp(row.rincianRate) : ''} disabled={readOnly} onChange={(event) => updateDraftRow(row.id, (current) => ({ ...current, rincianRate: parseMoney(event.target.value) }))} placeholder="Rp 0" className="h-8 rounded-lg border-slate-200 text-right text-xs font-bold" /></td>
                                  <td className="px-3 py-3"><Input type="text" inputMode="numeric" value={row.realisasi > 0 ? fmtRp(row.realisasi) : ''} disabled={readOnly} onChange={(event) => updateDraftRow(row.id, (current) => ({ ...current, realisasi: parseMoney(event.target.value) }))} placeholder="Rp 0" className="h-8 rounded-lg border-slate-200 text-right text-xs font-bold" /></td>
                                  <td className="px-3 py-3 text-right"><Button type="button" variant="ghost" size="icon-xs" disabled={readOnly || draftReport.rows.length <= 1} onClick={() => updateDraft((report) => ({ ...report, rows: report.rows.filter((item) => item.id !== row.id) }))} className="text-rose-400 hover:bg-rose-50 hover:text-rose-600 disabled:opacity-30"><Trash2 /></Button></td>
                                </tr>
                              );
                            });
                          }

                          return headerItems.map((headerItem, hIdx) => {
                            const headerAnggaran = parseQty(headerItem.rincianQty) * headerItem.rincianRate;
                            const headerRealisasi = headerItem.realisasi ?? headerAnggaran;

                            const childRows = getExpenseReportRowsForItem(draftReport, headerItem);

                            const childTotal = getExpenseReportRowsSubtotal(childRows, parseQty);
                            const childQty = getExpenseReportRowsQuantity(childRows, parseQty);
                            const isQtyBalanced = childRows.length > 0 && Math.abs(childQty - parseQty(headerItem.rincianQty)) < 0.001;
                            const isSubtotalBalanced = childRows.length > 0 && Math.abs(childTotal - headerRealisasi) < 1;
                            const hasWarning = !isQtyBalanced || !isSubtotalBalanced;
                            const isEmployeeMode = draftReport.mode === 'employee';
                            const addRowLabel = isEmployeeMode ? 'Penerima' : 'Rincian';
                            const receipt = draftReport.receipts[headerItem.rowId || ''];
                            const receiptUploadId = `receipt-upload-${draftReport.id}-${headerItem.rowId || hIdx}`;
                            const isUploadingReceipt = uploadingReceiptKey === (headerItem.rowId || '');

                            const addPenerima = (afterRowId?: string) => {
                              const sourceChild = afterRowId
                                ? childRows.find((child) => child.id === afterRowId)
                                : childRows[childRows.length - 1];
                              const initialQty = sourceChild ? (sourceChild.rincianQty || '1') : (headerItem.rincianQty || '1');
                              const initialRate = sourceChild ? (sourceChild.rincianRate || 0) : (headerItem.rincianRate || 0);
                              const calculatedSubtotal = parseQty(initialQty) * initialRate;
                              const initialRealisasi = sourceChild ? (sourceChild.realisasi || calculatedSubtotal) : (headerItem.realisasi || calculatedSubtotal);

                              const newRow = createExpenseReportRow({
                                id: createStableId('expense-report-row'),
                                parentRowId: headerItem.rowId,
                                parentUraian: headerItem.uraian,
                                uraian: isEmployeeMode ? headerItem.uraian : '',
                                rincianQty: initialQty,
                                rincianRate: initialRate,
                                realisasi: initialRealisasi,
                              });
                              updateDraft((report) => ({
                                ...report,
                                rows: (() => {
                                  const insertionIndex = afterRowId
                                    ? report.rows.findIndex((row) => row.id === afterRowId) + 1
                                    : report.rows.length;
                                  return [
                                    ...report.rows.slice(0, insertionIndex > 0 ? insertionIndex : report.rows.length),
                                    newRow,
                                    ...report.rows.slice(insertionIndex > 0 ? insertionIndex : report.rows.length),
                                  ];
                                })(),
                              }));
                            };

                            return (
                              <React.Fragment key={headerItem.rowId || hIdx}>
                                {/* LOCKED HEADER ITEM ROW */}
                                <tr className="bg-indigo-50/80 border-y border-indigo-200/80 font-bold text-slate-900">
                                  <td className="px-3 py-2.5 text-center text-xs font-black text-indigo-700">{hIdx + 1}</td>
                                  <td className="px-3 py-2.5 text-xs font-black text-slate-900 flex items-center gap-1.5">
                                    <Lock className="w-3.5 h-3.5 text-indigo-500 shrink-0" />
                                    <span>{headerItem.uraian}</span>
                                  </td>
                                  <td className="px-3 py-2.5 text-center font-bold text-xs text-slate-700">{headerItem.rincianQty || '-'}</td>
                                  <td className="px-3 py-2.5 text-right font-mono font-bold text-xs text-slate-700">{fmtRp(headerItem.rincianRate)}</td>
                                  <td className="px-3 py-2.5 text-right font-mono font-black text-xs text-indigo-800">{fmtRp(headerRealisasi)}</td>
                                  <td className="w-[260px] px-3 py-2.5 text-right">
                                    <div className="flex items-center justify-end gap-2">
                                      {childRows.length > 0 ? (
                                        hasWarning ? (
                                          <div className="inline-flex items-center gap-1.5 text-left text-amber-900 bg-amber-100/90 px-2.5 py-1 rounded-lg shrink-0">
                                            <AlertCircle className="w-3.5 h-3.5 shrink-0 text-amber-600" />
                                            <div className="flex flex-col leading-tight">
                                              {!isQtyBalanced && (
                                                <span className="text-[9px] font-extrabold uppercase tracking-wider text-amber-800">
                                                  QTY: {formatQuantity(childQty)} / {headerItem.rincianQty || '-'}
                                                </span>
                                              )}
                                              {!isSubtotalBalanced ? (
                                                <>
                                                  <span className="text-[9px] font-extrabold uppercase tracking-wider text-amber-800">Penerima: {fmtRp(childTotal)}</span>
                                                  <span className="text-[10px] font-bold font-mono text-amber-700">LPJ: {fmtRp(headerRealisasi)}</span>
                                                </>
                                              ) : (
                                                <span className="text-[10px] font-bold font-mono text-amber-700">Subtotal sesuai: {fmtRp(headerRealisasi)}</span>
                                              )}
                                            </div>
                                          </div>
                                        ) : (
                                          <div className="inline-flex items-center gap-1.5 text-left text-emerald-800 bg-emerald-100/90 px-2.5 py-1 rounded-lg shrink-0">
                                            <Check className="w-3.5 h-3.5 shrink-0 text-emerald-600" />
                                            <div className="flex flex-col leading-tight">
                                              <span className="text-[9px] font-extrabold uppercase tracking-wider text-emerald-800">Total Sesuai</span>
                                              <span className="text-[11px] font-black font-mono text-emerald-700">{fmtRp(headerRealisasi)}</span>
                                            </div>
                                          </div>
                                        )
                                      ) : (
                                        <span className="text-[10px] font-semibold text-slate-400 italic whitespace-nowrap">
                                          {isEmployeeMode ? 'Belum ada penerima' : 'Belum ada rincian'}
                                        </span>
                                      )}

                                      {childRows.length === 0 && !readOnly && (
                                        <Button
                                          type="button"
                                          variant="ghost"
                                          size="sm"
                                          title={`Tambah ${addRowLabel}`}
                                          onClick={() => addPenerima()}
                                          className="h-7 px-2 rounded-lg text-[10px] font-bold bg-indigo-600 hover:bg-indigo-700 text-white shadow-2xs shrink-0"
                                        >
                                          <Plus className="w-3 h-3 mr-0.5" /> {addRowLabel}
                                        </Button>
                                      )}

                                      {!isEmployeeMode && (
                                        isUploadingReceipt ? (
                                          <span className="inline-flex shrink-0 items-center gap-1 text-[10px] font-semibold text-indigo-600">
                                            <Loader2 className="h-3.5 w-3.5 animate-spin" /> Mengunggah...
                                          </span>
                                        ) : receipt ? (
                                          <span className="inline-flex shrink-0 items-center gap-1 rounded-lg border border-slate-200 bg-white px-1.5 py-1">
                                            <FileText className="h-3 w-3 shrink-0 text-indigo-500" />
                                            <span className="max-w-[70px] truncate text-[9px] font-semibold text-slate-600" title={receipt.fileName}>{receipt.fileName}</span>
                                            <button type="button" title="Lihat bukti" onClick={() => window.open(receipt.url, '_blank', 'noopener,noreferrer')} className="text-slate-400 hover:text-indigo-600"><Eye className="h-3 w-3" /></button>
                                            {!readOnly && (
                                              <button type="button" title="Hapus bukti" onClick={() => handleReceiptRemove(headerItem.rowId || '')} className="text-slate-400 hover:text-rose-600"><X className="h-3 w-3" /></button>
                                            )}
                                          </span>
                                        ) : !readOnly ? (
                                          <>
                                            <label
                                              htmlFor={receiptUploadId}
                                              title="Unggah bukti"
                                              className="inline-flex h-7 w-7 shrink-0 cursor-pointer items-center justify-center rounded-lg border border-dashed border-slate-300 text-slate-400 hover:border-indigo-300 hover:text-indigo-600"
                                            >
                                              <Upload className="h-3.5 w-3.5" />
                                            </label>
                                            <input
                                              id={receiptUploadId}
                                              type="file"
                                              className="hidden"
                                              accept=".pdf,image/*"
                                              onChange={(event) => {
                                                const file = event.target.files?.[0];
                                                if (file) handleReceiptFileChange(headerItem.rowId || '', headerItem.uraian, file);
                                                event.target.value = '';
                                              }}
                                            />
                                          </>
                                        ) : (
                                          <span className="text-[10px] font-semibold italic text-slate-300 whitespace-nowrap">Tanpa bukti</span>
                                        )
                                      )}
                                    </div>
                                  </td>
                                </tr>

                                {/* CHILD RECIPIENT ROWS UNDER THIS HEADER ITEM */}
                                {childRows.map((cRow, cIdx) => {
                                  const cQty = parseQty(cRow.rincianQty || '1');
                                  const cSubtotal = cRow.realisasi > 0 ? cRow.realisasi : cQty * cRow.rincianRate;
                                  const isLastChild = cIdx === childRows.length - 1;

                                  return (
                                    <tr key={cRow.id} className="border-b border-slate-100 bg-white hover:bg-slate-50/70">
                                      <td className="px-3 py-2.5 text-center text-[10px] font-bold text-slate-400">{hIdx + 1}.{cIdx + 1}</td>
                                      <td className="px-3 py-2.5">
                                        {draftReport.mode === 'employee' ? (
                                          <EmployeeSearch
                                            row={cRow}
                                            employees={employees}
                                            disabled={readOnly}
                                            onChange={(value) => updateDraftRow(cRow.id, (current) => ({ ...current, employeeId: '', employeeName: '', employeeSearchText: value }))}
                                            onConnect={(employee) => updateDraftRow(cRow.id, (current) => ({ ...current, employeeId: employee.id, employeeName: employee.name, employeeSearchText: employee.name }))}
                                            onDisconnect={() => updateDraftRow(cRow.id, (current) => ({ ...current, employeeId: '', employeeName: '', employeeSearchText: '' }))}
                                            onKeyDown={(event) => handleReportRowCellKeyDown(event, !readOnly ? () => addPenerima(cRow.id) : undefined)}
                                          />
                                        ) : (
                                          <Input
                                            value={cRow.uraian}
                                            disabled={readOnly}
                                            onChange={(event) => updateDraftRow(cRow.id, (current) => ({ ...current, uraian: event.target.value }))}
                                            onKeyDown={(event) => handleReportRowCellKeyDown(event, !readOnly ? () => addPenerima(cRow.id) : undefined)}
                                            placeholder="Uraian rincian..."
                                            className="h-7.5 rounded-lg border-slate-200 text-xs font-semibold"
                                          />
                                        )}
                                      </td>
                                      <td className="px-3 py-2.5">
                                        <Input
                                          value={cRow.rincianQty}
                                          disabled={readOnly}
                                          onChange={(event) => {
                                            const val = event.target.value;
                                            const parsedQty = parseQty(val);
                                            updateDraftRow(cRow.id, (current) => ({
                                              ...current,
                                              rincianQty: val,
                                              realisasi: parsedQty * current.rincianRate,
                                            }));
                                          }}
                                          onKeyDown={(event) => handleReportRowCellKeyDown(event, !readOnly ? () => addPenerima(cRow.id) : undefined)}
                                          placeholder="1"
                                          className="h-7.5 rounded-lg border-slate-200 text-center text-xs font-bold"
                                        />
                                      </td>
                                      <td className="px-3 py-2.5">
                                        <Input
                                          type="text"
                                          inputMode="numeric"
                                          value={cRow.rincianRate > 0 ? fmtRp(cRow.rincianRate) : ''}
                                          disabled={readOnly}
                                          onChange={(event) => {
                                            const rateVal = parseMoney(event.target.value);
                                            const parsedQty = parseQty(cRow.rincianQty || '1');
                                            updateDraftRow(cRow.id, (current) => ({
                                              ...current,
                                              rincianRate: rateVal,
                                              realisasi: parsedQty * rateVal,
                                            }));
                                          }}
                                          onKeyDown={(event) => handleReportRowCellKeyDown(event, !readOnly ? () => addPenerima(cRow.id) : undefined)}
                                          placeholder="Rp 0"
                                          className="h-7.5 rounded-lg border-slate-200 text-right text-xs font-bold"
                                        />
                                      </td>
                                      <td className="px-3 py-2.5">
                                        <Input
                                          type="text"
                                          inputMode="numeric"
                                          value={cSubtotal > 0 ? fmtRp(cSubtotal) : ''}
                                          disabled={readOnly}
                                          onChange={(event) => {
                                            const subtotalVal = parseMoney(event.target.value);
                                            updateDraftRow(cRow.id, (current) => ({
                                              ...current,
                                              realisasi: subtotalVal,
                                            }));
                                          }}
                                          onKeyDown={(event) => handleReportRowCellKeyDown(event, !readOnly ? () => addPenerima(cRow.id) : undefined)}
                                          placeholder="Rp 0"
                                          className="h-7.5 rounded-lg border-slate-200 text-right text-xs font-black text-indigo-700"
                                        />
                                      </td>
                                      <td className="px-3 py-2.5 text-right">
                                        <div className="flex items-center justify-end gap-2">
                                          {isLastChild && !readOnly && (
                                            <Button
                                              type="button"
                                              variant="ghost"
                                              size="sm"
                                              title={`Tambah ${addRowLabel}`}
                                              onClick={() => addPenerima()}
                                              className="h-7 px-2 rounded-lg text-[10px] font-bold bg-indigo-600 hover:bg-indigo-700 text-white shadow-2xs shrink-0"
                                            >
                                              <Plus className="w-3 h-3 mr-0.5" /> {addRowLabel}
                                            </Button>
                                          )}
                                          <Button
                                            type="button"
                                            variant="ghost"
                                            size="icon-xs"
                                            disabled={readOnly}
                                            onClick={() => updateDraft((report) => ({ ...report, rows: report.rows.filter((item) => item.id !== cRow.id) }))}
                                            className="text-rose-400 hover:bg-rose-50 hover:text-rose-600"
                                          >
                                            <Trash2 className="w-3.5 h-3.5" />
                                          </Button>
                                        </div>
                                      </td>
                                    </tr>
                                  );
                                })}
                              </React.Fragment>
                            );
                          });
                        })()}
                      </tbody>
                      <tfoot>
                        <tr className="sticky bottom-0 z-20 border-t-2 border-slate-200 bg-slate-100 shadow-2xs">
                          <td colSpan={4} className="px-3 py-3 text-right text-xs font-black uppercase text-slate-700">Total laporan</td>
                          <td className="px-3 py-3 text-right font-mono text-xs font-black text-indigo-700">{fmtRp(getExpenseReportActualTotal(draftReport))}</td>
                          <td />
                        </tr>
                      </tfoot>
                    </table>
                  </div>
                </div>
              </div>
            </div>
          )}

          <div className="flex shrink-0 flex-wrap items-center justify-between gap-2 border-t border-slate-100 bg-slate-50 p-4">
            <div className="flex items-center gap-2">
              {draftReport && !readOnly && expenseReports.some((report) => report.id === draftReport.id) && (
                <Button type="button" variant="ghost" onClick={() => { onUnlinkReport(draftReport.id); closeDialog(); }} className="rounded-xl text-xs font-bold text-rose-600 hover:bg-rose-50">Lepas Hubungan</Button>
              )}
              {draftReport && (
                <Button type="button" variant="ghost" disabled={printingReport} onClick={() => onPrintReport(draftReport)} className="rounded-xl text-xs font-bold text-indigo-700 hover:bg-indigo-50 disabled:cursor-not-allowed disabled:opacity-60">
                  {printingReport ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <FileDown className="mr-1.5 h-3.5 w-3.5" />} {printingReport ? 'Membuat PDF...' : 'Cetak PDF'}
                </Button>
              )}
            </div>
            <div className="flex items-center gap-3">
              {!readOnly && (
                autosaveStatus === 'saving' ? (
                  <span className="inline-flex items-center gap-1.5 rounded-full border border-amber-200 bg-amber-50 px-2.5 py-1 text-[11px] font-bold text-amber-700">
                    <Loader2 className="h-3 w-3 animate-spin text-amber-600" /> Menyimpan...
                  </span>
                ) : autosaveStatus === 'saved' ? (
                  <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-200 bg-emerald-50 px-2.5 py-1 text-[11px] font-bold text-emerald-700">
                    <CheckCircle2 className="h-3 w-3 text-emerald-600" /> Tersimpan otomatis
                  </span>
                ) : null
              )}
              <Button type="button" variant="ghost" onClick={closeDialog} className="rounded-xl text-xs font-bold text-slate-500">Tutup</Button>
              {!readOnly && <Button type="button" onClick={saveDraft} className="rounded-xl bg-indigo-600 px-5 text-xs font-bold text-white hover:bg-indigo-700"><Check className="mr-1.5 h-3.5 w-3.5" /> Simpan & Selesai</Button>}
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog
        open={pendingSave !== null}
        onOpenChange={(open) => {
          if (!open) setPendingSave(null);
        }}
      >
        <DialogContent className="max-w-xl overflow-hidden rounded-3xl border-none bg-white p-0 shadow-2xl">
          <DialogHeader className="border-b border-amber-100 bg-gradient-to-r from-amber-50 to-orange-50 p-5">
            <DialogTitle className="flex items-center gap-2.5 text-lg font-bold text-amber-950">
              <AlertCircle className="h-5 w-5 text-amber-600" /> Konfirmasi Perubahan Nilai SPJ
            </DialogTitle>
          </DialogHeader>

          <div className="max-h-[60vh] space-y-4 overflow-y-auto p-5">
            <p className="text-xs leading-relaxed text-slate-600">
              Total child rows berbeda dari nilai heading. Jika dilanjutkan, QTY dan Realisasi SPJ akan disesuaikan ke nilai peringatan berikut:
            </p>

            <div className="space-y-3">
              {pendingSave?.changes.map((change, index) => (
                <div key={`${change.headerLabel}-${index}`} className="rounded-2xl border border-amber-100 bg-amber-50/60 p-4">
                  <p className="text-sm font-black text-slate-800">{change.headerLabel}</p>
                  <div className="mt-2 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-xs">
                    {change.qtyChanged && (
                      <>
                        <span className="font-bold uppercase tracking-wider text-amber-700">QTY</span>
                        <span className="font-mono font-bold text-slate-700">{change.currentQty} <span className="px-1 text-amber-600">→</span> {change.nextQty}</span>
                      </>
                    )}
                    {change.realisasiChanged && (
                      <>
                        <span className="font-bold uppercase tracking-wider text-amber-700">Realisasi</span>
                        <span className="font-mono font-bold text-slate-700">{fmtRp(change.currentRealisasi)} <span className="px-1 text-amber-600">→</span> {fmtRp(change.nextRealisasi)}</span>
                      </>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="flex justify-end gap-2.5 border-t border-slate-100 bg-slate-50 p-4">
            <Button type="button" variant="ghost" onClick={() => setPendingSave(null)} className="rounded-xl text-xs font-bold text-slate-500 hover:bg-white">Batal</Button>
            <Button type="button" onClick={confirmPendingSave} className="rounded-xl bg-indigo-600 text-xs font-bold text-white hover:bg-indigo-700">Konfirmasi & Simpan</Button>
          </div>
        </DialogContent>
      </Dialog>
    </section>
  );
}
