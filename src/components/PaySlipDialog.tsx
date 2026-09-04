"use client";

import React, { useState, useEffect, useCallback } from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogDescription,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import {
  FileText,
  Printer,
  Plus,
  Trash2,
  ArrowRight,
  AlertCircle,
  Landmark,
  Eye,
  CheckCircle2,
  RotateCcw,
  Loader2,
} from 'lucide-react';
import { generatePaySlipPdf, PaySlipField, PaySlipData } from '@/utils/generatePaySlipPdf';
import { BlueCollarEmployee, UraianEntry, RekapColumn } from '@/types';
import {
  buildInitialEarnings,
  buildInitialDeductions,
} from '@/lib/payroll/slipBuilders';
import { PekaryaSlipPreview } from '@/lib/payroll/pekaryaSlipPreview';
import { PayrollStatus, isImmutablePayrollStatus } from '@/lib/payroll/domain';
import {
  PAYROLL_TAX_THRESHOLD,
  calculateTaxBase,
  describeTaxIneligibility,
  isTaxableBase,
  resolveSlipTaxes,
  resolveTaxSelection,
} from '@/lib/payroll/payrollTax';
import { UserRole } from '@/lib/payroll/roles';
import { mergeSatpamLegacyBonusIntoTunjangan } from '@/lib/payroll/satpamCompensation';

// ─── Types ─────────────────────────────────────────────────────

export type SlipStatus = PayrollStatus;

export interface SlipState {
  status: SlipStatus;
  earnings: PaySlipField[];
  deductions: PaySlipField[];
  /** Income tax rows; empty or absent unless a super admin applied the tax. */
  taxes?: PaySlipField[];
  /** The stored selection, which survives a period spent under the threshold. */
  taxApplied?: boolean;
  generatedAt?: string;
  lockedAt?: string;
  verifiedAt?: string;
  verifiedBy?: string;
  lockedBy?: string;
  lockedSnapshotHash?: string;
  paymentBatchId?: string;
  bankReference?: string;
  emailSent?: boolean;
  emailSentAt?: string;
}

interface PaySlipDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  employee: any | null;
  employeeNo: number;
  gapok: number;
  period: string; // e.g. "Mei 2026"
  periodClosed: boolean;
  slipState: SlipState | null;
  onSave: (
    employeeId: string,
    earnings: PaySlipField[],
    deductions: PaySlipField[],
    taxApplied: boolean,
  ) => Promise<void>;
  onVerifyAndLock: (employeeId: string, reason: string) => Promise<void>;
  onCreatePayment: (employeeId: string, paymentBatchId: string, reason: string) => Promise<void>;
  onMarkPaid: (employeeId: string, bankReference: string, reason: string) => Promise<void>;
  onRequestCorrection: (employeeId: string, reason: string) => Promise<void>;
  onRefresh: (employeeId: string) => Promise<{ earnings: PaySlipField[]; deductions: PaySlipField[] }>;
  actorRole?: UserRole;
  uraianEntry?: UraianEntry; // from UraianGaji collection
  activeTab?: string;
  vakasiTambahanSum?: number;
  vakasiTambahanList?: { eventName: string; payGiven: number }[];
  tunjanganFungsional?: number;
  tunjanganKepangkatan?: number;
  customColumns?: RekapColumn[];
  koperasiDeduction?: number;
  presenceBonus?: number;
  presenceDeduction?: number;
  presensiEarning?: number;
  presensiDeduction?: number;
  koperasiSaving?: number;
  /**
   * The shared Pekarya earnings preview for this employee and period, as
   * returned by /api/payroll/slip-preview. A slip that has never been saved
   * opens on these rows, so the modal shows exactly what the employee sees on
   * /employee/payslip instead of zero placeholders. Ignored once a draft
   * exists — a saved draft keeps its own values until Refresh.
   */
  pekaryaPreview?: PekaryaSlipPreview | null;
  /** True while the period previews are still being fetched. */
  previewLoading?: boolean;
  /** Fetch failure shown for an unsaved Pekarya slip. */
  previewError?: string | null;
}

// ─── Helpers ───────────────────────────────────────────────────

const formatIDR = (amount: number) => {
  return new Intl.NumberFormat('id-ID', {
    style: 'currency',
    currency: 'IDR',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(amount);
};

const formatNumberWithDots = (num: number): string => {
  if (num === 0) return '';
  return new Intl.NumberFormat('id-ID').format(num);
};

const parseDotsToNumber = (val: string): number => {
  const clean = val.replace(/\./g, '').replace(/[^0-9]/g, '');
  return Number(clean) || 0;
};

interface DiffItem {
  type: 'earnings' | 'deductions';
  label: string;
  oldValue: number | null;
  newValue: number | null;
}

/**
 * The builders live in @/lib/payroll/slipBuilders so the propagation API route
 * can derive the exact same numbers this dialog shows. Re-exported here so the
 * existing dashboard imports keep working unchanged.
 */
export { buildInitialEarnings, buildInitialDeductions };

// ─── Component ─────────────────────────────────────────────────

export default function PaySlipDialog({
  open,
  onOpenChange,
  employee,
  employeeNo,
  gapok,
  period,
  periodClosed,
  slipState,
  onSave,
  onVerifyAndLock,
  onCreatePayment,
  onMarkPaid,
  onRequestCorrection,
  onRefresh,
  actorRole,
  uraianEntry,
  activeTab = 'blue',
  vakasiTambahanSum,
  vakasiTambahanList = [],
  tunjanganFungsional,
  tunjanganKepangkatan = 0,
  customColumns,
  koperasiDeduction = 0,
  presenceBonus = 0,
  presenceDeduction = 0,
  presensiEarning = 0,
  presensiDeduction = 0,
  koperasiSaving = 0,
  pekaryaPreview = null,
  previewLoading = false,
  previewError = null,
}: PaySlipDialogProps) {
  const [earnings, setEarnings] = useState<PaySlipField[]>([]);
  const [deductions, setDeductions] = useState<PaySlipField[]>([]);
  /**
   * Only the *selection* is state. The tax amount is always re-derived from
   * the rows currently on screen, so editing an earning or a deduction moves
   * the 5% with it and the modal can never show a tax that disagrees with its
   * own Gaji Bersih — the same rule the server applies on save.
   */
  const [taxApplied, setTaxApplied] = useState(false);

  // Snapshots for Batal functionality
  const [snapshotEarnings, setSnapshotEarnings] = useState<PaySlipField[]>([]);
  const [snapshotDeductions, setSnapshotDeductions] = useState<PaySlipField[]>([]);
  const [snapshotTaxApplied, setSnapshotTaxApplied] = useState(false);

  const [localStatus, setLocalStatus] = useState<SlipStatus>('draft');
  const localIsLocked = localStatus !== 'draft' || periodClosed;

  // Preview gating applies to Pekarya only; Loyalis keeps its own flow.
  const isPekaryaTab = activeTab !== 'loyalis';
  const previewMeta = isPekaryaTab ? pekaryaPreview?.meta ?? null : null;
  const blockingWarnings = (previewMeta?.warnings || []).filter(
    (warning) => warning.blocking,
  );
  // e.g. a SATPAM Ketua's duty/bonus figures, entered by hand outside the
  // automated 3-regu reconciliation — worth flagging, not worth refusing.
  const nonBlockingWarnings = (previewMeta?.warnings || []).filter(
    (warning) => !warning.blocking,
  );
  // A draft that already exists keeps its normal workflow. What must not
  // happen is materializing a *new* slip out of a preview whose Gaji Pokok
  // could not be read from the matrix, or whose attendance is not published —
  // the server would reject the write anyway.
  const newSlipBlocked =
    isPekaryaTab &&
    !slipState &&
    (previewLoading || !pekaryaPreview || blockingWarnings.length > 0);
  const newSlipBlockedReason = previewLoading
    ? 'Pratinjau perhitungan masih dimuat.'
    : previewError ||
      (!pekaryaPreview
        ? 'Pratinjau perhitungan Pekarya tidak tersedia. Klik Refresh untuk mencoba lagi.'
        : blockingWarnings.map((warning) => warning.message).join(' '));

  // Refresh & diff comparison states
  const [compareOpen, setCompareOpen] = useState(false);
  const [refreshDiff, setRefreshDiff] = useState<DiffItem[] | null>(null);
  const [freshRecalculated, setFreshRecalculated] = useState<{ earnings: PaySlipField[]; deductions: PaySlipField[] } | null>(null);
  const [refreshLoading, setRefreshLoading] = useState(false);

  // Initialize fields and snapshots when dialog opens
  useEffect(() => {
    if (!open || !employee) return;

    let initEarnings: PaySlipField[] = [];
    let initDeductions: PaySlipField[] = [];

    if (slipState && Array.isArray(slipState.earnings)) {
      const savedEarnings =
        employee.employment?.jobCategory === 'SATPAM'
          ? mergeSatpamLegacyBonusIntoTunjangan(slipState.earnings)
          : slipState.earnings;
      initEarnings = JSON.parse(JSON.stringify(savedEarnings));
    } else if (activeTab !== 'loyalis' && pekaryaPreview) {
      // No saved slip: open on the live matrix-based preview rather than the
      // profile snapshot, so the modal and the employee's own payslip agree.
      initEarnings = JSON.parse(JSON.stringify(pekaryaPreview.earnings));
    } else if (activeTab !== 'loyalis') {
      // An absent shared preview is an unavailable source, not permission to
      // rebuild Pekarya rows locally. Leave the new slip empty and blocked.
      initEarnings = [];
    } else {
      initEarnings = buildInitialEarnings(
        employee,
        gapok,
        activeTab,
        uraianEntry,
        vakasiTambahanSum,
        vakasiTambahanList,
        tunjanganFungsional,
        tunjanganKepangkatan,
        customColumns,
        presenceBonus,
        presensiEarning
      );
    }

    if (slipState && Array.isArray(slipState.deductions)) {
      initDeductions = JSON.parse(JSON.stringify(slipState.deductions));
    } else if (activeTab !== 'loyalis' && !pekaryaPreview) {
      initDeductions = [];
    } else {
      initDeductions = buildInitialDeductions(
        employee,
        activeTab,
        koperasiDeduction,
        presenceDeduction,
        presensiDeduction,
        koperasiSaving
      );
    }

    const initTaxApplied = resolveTaxSelection(slipState);

    setEarnings(initEarnings);
    setDeductions(initDeductions);
    setTaxApplied(initTaxApplied);
    setSnapshotEarnings(JSON.parse(JSON.stringify(initEarnings)));
    setSnapshotDeductions(JSON.parse(JSON.stringify(initDeductions)));
    setSnapshotTaxApplied(initTaxApplied);
    
    setLocalStatus(slipState?.status || 'draft');
    setRefreshDiff(null);
    setCompareOpen(false);
    setFreshRecalculated(null);
  }, [
    open,
    employee,
    gapok,
    slipState,
    activeTab,
    vakasiTambahanSum,
    vakasiTambahanList,
    uraianEntry,
    tunjanganFungsional,
    tunjanganKepangkatan,
    customColumns,
    koperasiDeduction,
    presenceBonus,
    presensiEarning,
    presenceDeduction,
    presensiDeduction,
    koperasiSaving,
    pekaryaPreview
  ]);

  // Helper function to calculate diffs
  const getDiff = (
    currentEarn: PaySlipField[],
    freshEarn: PaySlipField[],
    currentDed: PaySlipField[],
    freshDed: PaySlipField[]
  ): DiffItem[] => {
    const diffs: DiffItem[] = [];

    // Earnings diff
    freshEarn.forEach(f => {
      const cur = currentEarn.find(c => c.label === f.label);
      if (!cur) {
        diffs.push({ type: 'earnings', label: f.label, oldValue: null, newValue: f.amount });
      } else if (cur.amount !== f.amount) {
        diffs.push({ type: 'earnings', label: f.label, oldValue: cur.amount, newValue: f.amount });
      }
    });
    currentEarn.forEach(c => {
      const f = freshEarn.find(fresh => fresh.label === c.label);
      if (!f) {
        diffs.push({ type: 'earnings', label: c.label, oldValue: c.amount, newValue: null });
      }
    });

    // Deductions diff
    freshDed.forEach(f => {
      const cur = currentDed.find(c => c.label === f.label);
      if (!cur) {
        diffs.push({ type: 'deductions', label: f.label, oldValue: null, newValue: f.amount });
      } else if (cur.amount !== f.amount) {
        diffs.push({ type: 'deductions', label: f.label, oldValue: cur.amount, newValue: f.amount });
      }
    });
    currentDed.forEach(c => {
      const f = freshDed.find(fresh => fresh.label === c.label);
      if (!f) {
        diffs.push({ type: 'deductions', label: c.label, oldValue: c.amount, newValue: null });
      }
    });

    return diffs;
  };

  // ─── Field Mutators ───────────────────────────────────────────

  const updateField = useCallback(
    (type: 'earnings' | 'deductions', index: number, field: 'label' | 'amount', value: string) => {
      const setter = type === 'earnings' ? setEarnings : setDeductions;
      setter((prev) => {
        const copy = [...prev];
        if (field === 'label') {
          copy[index] = { ...copy[index], label: value };
        } else {
          copy[index] = { ...copy[index], amount: Number(value) || 0 };
        }
        return copy;
      });
    },
    []
  );

  const addRow = useCallback((type: 'earnings' | 'deductions') => {
    const setter = type === 'earnings' ? setEarnings : setDeductions;
    setter((prev) => [...prev, { label: '', amount: 0 }]);
  }, []);

  const removeRow = useCallback((type: 'earnings' | 'deductions', index: number) => {
    const setter = type === 'earnings' ? setEarnings : setDeductions;
    setter((prev) => prev.filter((_, i) => i !== index));
  }, []);

  // ─── Computed ─────────────────────────────────────────────────

  const totalEarnings = earnings.reduce((sum, e) => sum + e.amount, 0);
  const totalDeductions = deductions.reduce((sum, d) => sum + d.amount, 0);
  // Gaji Bersih before tax — both the figure the tax is charged on and the
  // figure that decides whether the employee is taxable at all.
  const taxBase = calculateTaxBase(earnings, deductions);
  const taxes = resolveSlipTaxes(earnings, deductions, taxApplied);
  const totalTax = taxes.reduce((sum, t) => sum + t.amount, 0);
  const netSalary = totalEarnings - totalDeductions - totalTax;
  const taxEligible = isTaxableBase(taxBase);
  const taxIneligibilityReason = describeTaxIneligibility(taxBase);
  const canManageTax = actorRole === 'super_admin';
  // Locking reads the tax off the *saved* slip, so an un-saved toggle would be
  // silently discarded at the moment it matters most.
  const savedTaxApplied = resolveTaxSelection(slipState);
  const taxSelectionUnsaved = taxApplied !== savedTaxApplied;

  // ─── Actions ──────────────────────────────────────────────────

  const handleBatal = () => {
    setEarnings(snapshotEarnings);
    setDeductions(snapshotDeductions);
    setTaxApplied(snapshotTaxApplied);
    onOpenChange(false);
  };

  const handleRefresh = async () => {
    if (!employee) return;
    setRefreshLoading(true);
    try {
      const fresh = await onRefresh(employee.employeeId || employee.id);
      const diffs = getDiff(earnings, fresh.earnings, deductions, fresh.deductions);
      if (diffs.length === 0) {
        alert("Data slip gaji saat ini sudah sesuai dengan data terbaru di database.");
      } else {
        setRefreshDiff(diffs);
        setFreshRecalculated(fresh);
        setCompareOpen(true);
      }
    } catch (err) {
      console.error("Gagal merefresh data:", err);
      alert("Gagal memuat data terbaru dari database.");
    } finally {
      setRefreshLoading(false);
    }
  };

  const handleSimpan = async () => {
    if (!employee || newSlipBlocked) return;
    try {
      // The raw selection is sent, not `taxApplied && taxEligible`: a slip
      // that is selected but currently under the threshold must keep its
      // selection, and a non-super-admin saving such a slip must not appear
      // to be flipping it off.
      await onSave(
        employee.employeeId || employee.id,
        earnings,
        deductions,
        taxApplied,
      );
      onOpenChange(false);
    } catch (err) {
      console.error("Gagal menyimpan slip:", err);
    }
  };

  // ─── Inline Modal States ──────────────────────────────────────
  const [correctionModalOpen, setCorrectionModalOpen] = useState(false);
  const [correctionReasonInput, setCorrectionReasonInput] = useState('');
  const [paidModalOpen, setPaidModalOpen] = useState(false);
  const [bankRefInput, setBankRefInput] = useState('');

  const handleVerifyAndLock = async () => {
    if (!employee) return;
    try {
      await onVerifyAndLock(
        employee.employeeId || employee.id,
        'Verifikasi angka dan penguncian final oleh Badan Keuangan',
      );
      onOpenChange(false);
    } catch (err) {
      console.error("Gagal memverifikasi dan mengunci slip:", err);
    }
  };

  const handleConfirmCorrectionRequest = async () => {
    if (!employee) return;
    const reason = correctionReasonInput.trim() || 'Pengajuan koreksi slip gaji';
    try {
      await onRequestCorrection(employee.employeeId || employee.id, reason);
      setCorrectionModalOpen(false);
      onOpenChange(false);
    } catch (err) {
      console.error("Gagal mengajukan koreksi:", err);
    }
  };

  const handleConfirmMarkPaid = async () => {
    if (!employee) return;
    const refStr = bankRefInput.trim() || `TR-${Date.now().toString(36).toUpperCase()}`;
    const autoBatchId = `PAY-${period.replace(/\s+/g, '-')}-${Date.now().toString(36).toUpperCase()}`;
    try {
      // Create payment instruction automatically behind the scenes if not created yet
      if (localStatus === 'locked' && onCreatePayment) {
        await onCreatePayment(employee.employeeId || employee.id, autoBatchId, 'Instruksi pembayaran otomatis');
      }
      await onMarkPaid(employee.employeeId || employee.id, refStr, 'Pembayaran gaji terkonfirmasi');
      setPaidModalOpen(false);
      onOpenChange(false);
    } catch (err) {
      console.error('Gagal mencatat pembayaran:', err);
    }
  };

  const statusLabel: Record<SlipStatus, string> = {
    draft: 'Draf',
    locked: 'Terkunci',
    payment_created: 'Instruksi Bayar Dibuat',
    paid: 'Dibayar',
  };

  if (!employee) return null;

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="sm:max-w-3xl max-h-[90vh] overflow-y-auto rounded-[28px] border-none shadow-2xl p-0 bg-white">
          {/* ─── Dialog Header ────────────────────────────────────── */}
          <DialogHeader className="p-6 pb-4 bg-gradient-to-r from-indigo-50/80 to-purple-50/60 border-b border-slate-100">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-gradient-to-tr from-indigo-500 to-purple-400 flex items-center justify-center shadow-sm">
                <FileText className="w-5 h-5 text-white" />
              </div>
              <div>
                <DialogTitle className="text-xl font-bold tracking-tight text-slate-800 flex items-center gap-2">
                  Tinjau Slip Gaji
                  {localStatus !== 'draft' && (
                    <span className="inline-flex items-center gap-1 text-xs font-semibold bg-red-50 text-red-600 border border-red-200 px-2 py-0.5 rounded-full">
                      🔒 {statusLabel[localStatus]}
                    </span>
                  )}
                </DialogTitle>
                <DialogDescription className="text-sm text-slate-500 mt-0.5">
                  {(activeTab === 'loyalis' ? employee.personal_info?.name : employee.name) || ''} — {period}
                </DialogDescription>
              </div>
            </div>

            {/* Employee summary badges */}
            <div className="flex flex-wrap gap-2 mt-3">
              <Badge variant="secondary" className="bg-white/80 text-slate-600 rounded-full border border-slate-200 font-normal shadow-none">
                {activeTab === 'loyalis' ? (employee.employment_profile?.job_role || 'Staf') : employee.employment?.jobCategory}
              </Badge>
              <Badge variant="secondary" className="bg-white/80 text-indigo-600 rounded-full border border-indigo-150 font-semibold shadow-none flex items-center gap-1">
                No. Antrean {employeeNo}
              </Badge>
            </div>
          </DialogHeader>

          {/* ─── Content ──────────────────────────────────────────── */}
          <div className="p-6 space-y-6">
            {isPekaryaTab && !slipState && (previewLoading || !pekaryaPreview) && (
              <div className="flex items-start gap-2 text-xs text-rose-700 bg-rose-50 rounded-xl p-3 border border-rose-200">
                {previewLoading ? (
                  <Loader2 className="w-4 h-4 mt-0.5 flex-shrink-0 animate-spin" />
                ) : (
                  <AlertCircle className="w-4 h-4 mt-0.5 flex-shrink-0" />
                )}
                <div>
                  <p className="font-semibold">
                    {previewLoading
                      ? 'Pratinjau perhitungan Pekarya sedang dimuat.'
                      : previewError || 'Pratinjau perhitungan Pekarya tidak tersedia.'}
                  </p>
                  {!previewLoading && (
                    <p className="mt-1">
                      Slip baru tidak dapat ditampilkan atau disimpan. Klik Refresh untuk mencoba lagi.
                    </p>
                  )}
                </div>
              </div>
            )}

            {/* Two-column layout */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">

              {/* ─── Earnings (Uraian) ──────────────────────────────── */}
              <div>
                <div className="flex items-center justify-between mb-3">
                  <h3 className="text-sm font-semibold text-emerald-700 uppercase tracking-wider flex items-center gap-2">
                    <div className="w-2 h-2 rounded-full bg-emerald-500"></div>
                    Uraian (Pendapatan)
                  </h3>
                  {!localIsLocked && (
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() => addRow('earnings')}
                      className="text-emerald-600 hover:text-emerald-700 hover:bg-emerald-50 rounded-lg h-7 text-xs px-2"
                    >
                      <Plus className="w-3 h-3 mr-1" /> Tambah
                    </Button>
                  )}
                </div>

                <div className="space-y-2">
                  {earnings.map((item, idx) => (
                    <div key={idx} className="flex items-center gap-2 group">
                      <Input
                        value={item.label}
                        onChange={(e) => updateField('earnings', idx, 'label', (e.target as HTMLInputElement).value)}
                        placeholder="Nama"
                        disabled={localIsLocked}
                        className="flex-1 text-sm h-8 rounded-lg bg-slate-50 border-slate-200 focus-visible:border-emerald-400 focus-visible:ring-emerald-200 disabled:opacity-80"
                      />
                      <div className="flex items-center w-32 h-8 rounded-lg bg-slate-50 border border-slate-200 px-2 focus-within:border-emerald-400 focus-within:ring-1 focus-within:ring-emerald-200 transition-all shrink-0">
                        <span className="text-xs font-semibold text-slate-400 mr-1 select-none">Rp</span>
                        <input
                          type="text"
                          value={item.amount ? formatNumberWithDots(item.amount) : ''}
                          disabled={localIsLocked}
                          onChange={(e) => updateField('earnings', idx, 'amount', String(parseDotsToNumber(e.target.value)))}
                          placeholder="0"
                          className="w-full bg-transparent border-none p-0 h-full text-right text-sm outline-none focus:outline-none focus:ring-0 focus:border-none tabular-nums disabled:cursor-not-allowed"
                        />
                      </div>
                      {!localIsLocked && (
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          onClick={() => removeRow('earnings', idx)}
                          className="h-7 w-7 text-slate-300 hover:text-red-500 hover:bg-red-50 rounded-lg opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </Button>
                      )}
                    </div>
                  ))}
                </div>

                {/* Earnings subtotal */}
                <div className="mt-3 pt-3 border-t border-emerald-100 flex justify-between items-center">
                  <span className="text-xs font-semibold text-emerald-600 uppercase">Total Uraian</span>
                  <span className="text-sm font-bold text-emerald-700 tabular-nums">{formatIDR(totalEarnings)}</span>
                </div>
              </div>

              {/* ─── Deductions (Potongan) ──────────────────────────── */}
              <div>
                <div className="flex items-center justify-between mb-3">
                  <h3 className="text-sm font-semibold text-red-600 uppercase tracking-wider flex items-center gap-2">
                    <div className="w-2 h-2 rounded-full bg-red-500"></div>
                    Potongan
                  </h3>
                  {!localIsLocked && (
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() => addRow('deductions')}
                      className="text-red-500 hover:text-red-600 hover:bg-red-50 rounded-lg h-7 text-xs px-2"
                    >
                      <Plus className="w-3 h-3 mr-1" /> Tambah
                    </Button>
                  )}
                </div>

                <div className="space-y-2">
                  {deductions.map((item, idx) => (
                    <div key={idx} className="flex items-center gap-2 group">
                      <Input
                        value={item.label}
                        onChange={(e) => updateField('deductions', idx, 'label', (e.target as HTMLInputElement).value)}
                        placeholder="Nama"
                        disabled={localIsLocked}
                        className="flex-1 text-sm h-8 rounded-lg bg-slate-50 border-slate-200 focus-visible:border-red-400 focus-visible:ring-red-200 disabled:opacity-80"
                      />
                      <div className="flex items-center w-32 h-8 rounded-lg bg-slate-50 border border-slate-200 px-2 focus-within:border-red-400 focus-within:ring-1 focus-within:ring-red-200 transition-all shrink-0">
                        <span className="text-xs font-semibold text-slate-400 mr-1 select-none">Rp</span>
                        <input
                          type="text"
                          value={item.amount ? formatNumberWithDots(item.amount) : ''}
                          disabled={localIsLocked}
                          onChange={(e) => updateField('deductions', idx, 'amount', String(parseDotsToNumber(e.target.value)))}
                          placeholder="0"
                          className="w-full bg-transparent border-none p-0 h-full text-right text-sm outline-none focus:outline-none focus:ring-0 focus:border-none tabular-nums disabled:cursor-not-allowed"
                        />
                      </div>
                      {!localIsLocked && (
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          onClick={() => removeRow('deductions', idx)}
                          className="h-7 w-7 text-slate-300 hover:text-red-500 hover:bg-red-50 rounded-lg opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </Button>
                      )}
                    </div>
                  ))}
                </div>

                {/* Deductions subtotal */}
                <div className="mt-3 pt-3 border-t border-red-100 flex justify-between items-center">
                  <span className="text-xs font-semibold text-red-500 uppercase">Total Potongan</span>
                  <span className="text-sm font-bold text-red-600 tabular-nums">{formatIDR(totalDeductions)}</span>
                </div>

                {/* ─── Pajak (its own category, charged after Potongan) ─── */}
                <div className="mt-6">
                  <div className="flex items-center justify-between mb-3">
                    <h3 className="text-sm font-semibold text-amber-700 uppercase tracking-wider flex items-center gap-2">
                      <div className="w-2 h-2 rounded-full bg-amber-500"></div>
                      Pajak
                    </h3>
                  </div>

                  {taxes.length > 0 ? (
                    <div className="space-y-2">
                      {taxes.map((item, idx) => (
                        <div key={idx} className="flex items-center gap-2">
                          <div className="flex-1 text-sm h-8 rounded-lg bg-amber-50/60 border border-amber-200 px-3 flex items-center text-slate-700">
                            {item.label}
                          </div>
                          <div className="flex items-center w-32 h-8 rounded-lg bg-amber-50/60 border border-amber-200 px-2 shrink-0">
                            <span className="text-xs font-semibold text-amber-500 mr-1 select-none">Rp</span>
                            <span className="w-full text-right text-sm tabular-nums text-slate-700">
                              {formatNumberWithDots(item.amount) || '0'}
                            </span>
                          </div>
                        </div>
                      ))}
                      <p className="text-[11px] text-amber-700/80 leading-relaxed">
                        5% dari gaji bersih {formatIDR(taxBase)} sebelum pajak. Nominal
                        mengikuti perubahan uraian dan potongan secara otomatis.
                      </p>
                    </div>
                  ) : (
                    <p className="text-[11px] text-slate-400 italic">
                      {taxApplied
                        ? `Ditandai kena pajak, tetapi gaji bersih ${formatIDR(taxBase)} masih di bawah ${formatIDR(PAYROLL_TAX_THRESHOLD)}. Penandaan tetap tersimpan dan pajak kembali dihitung bila gaji bersih mencapai batas.`
                        : taxEligible
                          ? 'Belum dikenakan pajak penghasilan.'
                          : `Tidak dikenakan pajak — gaji bersih di bawah ${formatIDR(PAYROLL_TAX_THRESHOLD)}.`}
                    </p>
                  )}

                  {/* Tax subtotal */}
                  <div className="mt-3 pt-3 border-t border-amber-100 flex justify-between items-center">
                    <span className="text-xs font-semibold text-amber-600 uppercase">Total Pajak</span>
                    <span className="text-sm font-bold text-amber-700 tabular-nums">{formatIDR(totalTax)}</span>
                  </div>
                </div>
              </div>
            </div>

            {/* ─── Net Salary Summary ──────────────────────────────── */}
            <div className="bg-gradient-to-r from-indigo-50 to-purple-50 rounded-2xl p-4 border border-indigo-100">
              <div className="flex justify-between items-center">
                <div>
                  <p className="text-xs text-indigo-500 font-medium uppercase tracking-wider mb-0.5">Gaji Bersih</p>
                  <p className="text-2xl font-bold text-indigo-700 tabular-nums">{formatIDR(netSalary)}</p>
                </div>
                <div className="text-right text-xs text-slate-500 space-y-0.5">
                  <p className="flex items-center justify-end gap-1">
                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 inline-block"></span>
                    Pendapatan: {formatIDR(totalEarnings)}
                  </p>
                  <p className="flex items-center justify-end gap-1">
                    <span className="w-1.5 h-1.5 rounded-full bg-red-400 inline-block"></span>
                    Potongan: {formatIDR(totalDeductions)}
                  </p>
                  <p className="flex items-center justify-end gap-1">
                    <span className="w-1.5 h-1.5 rounded-full bg-amber-400 inline-block"></span>
                    Pajak: {formatIDR(totalTax)}
                  </p>
                </div>
              </div>
            </div>

            {/* Blocking preview problems: matrix unreadable, presensi unpublished */}
            {isPekaryaTab && !slipState && blockingWarnings.length > 0 && (
              <div className="flex items-start gap-2 text-xs text-rose-700 bg-rose-50 rounded-xl p-3 border border-rose-200">
                <AlertCircle className="w-4 h-4 mt-0.5 flex-shrink-0" />
                <div className="space-y-1">
                  {blockingWarnings.map((warning) => (
                    <p key={warning.code}>{warning.message}</p>
                  ))}
                  <p className="font-semibold">
                    Slip baru tidak dapat dibuat atau dikunci sampai hal di atas selesai.
                  </p>
                </div>
              </div>
            )}

            {/* Non-blocking preview notes: figures entered by hand rather than
                sourced from an automated reconciliation. Save proceeds either way. */}
            {isPekaryaTab && !slipState && nonBlockingWarnings.length > 0 && (
              <div className="flex items-start gap-2 text-xs text-amber-700 bg-amber-50 rounded-xl p-3 border border-amber-200">
                <AlertCircle className="w-4 h-4 mt-0.5 flex-shrink-0" />
                <div className="space-y-1">
                  {nonBlockingWarnings.map((warning) => (
                    <p key={warning.code}>{warning.message}</p>
                  ))}
                </div>
              </div>
            )}

            {/* Provisional data: rows still rest on estimates, not publications */}
            {isPekaryaTab && !slipState && previewMeta?.isProvisional && blockingWarnings.length === 0 && (
              <div className="flex items-start gap-2 text-xs text-amber-700 bg-amber-50 rounded-xl p-3 border border-amber-200">
                <AlertCircle className="w-4 h-4 mt-0.5 flex-shrink-0" />
                <p>
                  Angka presensi masih bersifat sementara — perhitungan memakai estimasi
                  jadwal Piket karena presensi resmi periode ini belum dipublikasikan.
                </p>
              </div>
            )}

            {/* Warning for incomplete data */}
            {earnings.some(e => e.amount === 0) && (
              <div className="flex items-start gap-2 text-xs text-amber-600 bg-amber-50 rounded-xl p-3 border border-amber-100">
                <AlertCircle className="w-4 h-4 mt-0.5 flex-shrink-0" />
                <p>
                  Beberapa field masih bernilai 0. Pastikan data sudah benar sebelum mencetak slip gaji.
                </p>
              </div>
            )}
          </div>

          {/* ─── Footer ───────────────────────────────────────────── */}
          <DialogFooter className="p-6 pt-4 bg-slate-50/50 border-t border-slate-100 flex flex-row justify-between items-center gap-3">
            <div className="flex items-center gap-2">
              <Button
                type="button"
                variant="ghost"
                onClick={handleBatal}
                className="rounded-xl text-slate-500"
              >
                Batal
              </Button>

              {!localIsLocked && (
                <Button
                  type="button"
                  variant="outline"
                  onClick={handleRefresh}
                  disabled={refreshLoading}
                  className="rounded-xl border-slate-200 text-slate-600 hover:bg-slate-50 hover:text-indigo-600 hover:border-indigo-200 transition-all cursor-pointer flex items-center h-10 font-bold"
                  title="Periksa perubahan data terbaru di database"
                >
                  {refreshLoading ? (
                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  ) : (
                    <RotateCcw className="w-4 h-4 mr-2" />
                  )}
                  Refresh
                </Button>
              )}

              {/* Manual, per-employee tax selection. The amount is derived, so
                  this only ever toggles whether the rule applies. */}
              {canManageTax && !localIsLocked && (
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setTaxApplied((previous) => !previous)}
                  disabled={!taxApplied && !taxEligible}
                  title={
                    taxApplied
                      ? 'Hapus pajak penghasilan dari slip ini.'
                      : taxIneligibilityReason ||
                        `Kenakan pajak 5% dari gaji bersih ${formatIDR(taxBase)}.`
                  }
                  className={`rounded-xl h-10 font-bold flex items-center transition-all cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed ${
                    taxApplied
                      ? 'border-amber-300 bg-amber-50 text-amber-700 hover:bg-amber-100'
                      : 'border-slate-200 text-slate-600 hover:bg-amber-50 hover:text-amber-700 hover:border-amber-200'
                  }`}
                >
                  <Landmark className="w-4 h-4 mr-2" />
                  {taxApplied ? 'Hapus Pajak 5%' : 'Kenakan Pajak 5%'}
                </Button>
              )}
            </div>

            <div>
              {localStatus === 'draft' ? (
                <div className="flex flex-wrap items-center justify-end gap-2">
                  {!periodClosed && (
                    <Button
                      type="button"
                      onClick={handleSimpan}
                      disabled={newSlipBlocked}
                      title={newSlipBlocked ? newSlipBlockedReason : undefined}
                      className="rounded-xl bg-indigo-50 border border-indigo-200 text-indigo-700 hover:bg-indigo-100 shadow-sm px-6 cursor-pointer font-bold disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      Simpan Perubahan
                    </Button>
                  )}
                  {(actorRole === 'finance_verifier' || actorRole === 'super_admin') && (
                    <Button
                      type="button"
                      onClick={handleVerifyAndLock}
                      disabled={
                        !periodClosed ||
                        !slipState ||
                        newSlipBlocked ||
                        taxSelectionUnsaved
                      }
                      className="rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white px-6 font-bold disabled:opacity-50 disabled:cursor-not-allowed"
                      title={
                        !periodClosed
                          ? 'Tutup periode payroll terlebih dahulu.'
                          : !slipState
                            ? 'Draf harus disimpan sebelum periode ditutup.'
                            : taxSelectionUnsaved
                              ? 'Simpan perubahan pajak terlebih dahulu.'
                              : undefined
                      }
                    >
                      ✓ Verifikasi &amp; Kunci
                    </Button>
                  )}
                  {!periodClosed && (
                    <span className="text-xs text-slate-500">Tutup periode untuk mengaktifkan verifikasi final.</span>
                  )}
                  {periodClosed && !slipState && (
                    <span className="text-xs text-rose-600">Tidak ada draf tersimpan sebelum periode ditutup.</span>
                  )}
                  {taxSelectionUnsaved && (
                    <span className="text-xs text-amber-600">
                      Perubahan pajak belum disimpan.
                    </span>
                  )}
                </div>
              ) : isImmutablePayrollStatus(localStatus) ? (
                <div className="flex items-center gap-2">
                  {localStatus !== 'paid' && (actorRole === 'finance_verifier' || actorRole === 'super_admin') && (
                    <Button
                      type="button"
                      onClick={() => {
                        setBankRefInput(`TR-${Date.now().toString(36).toUpperCase()}`);
                        setPaidModalOpen(true);
                      }}
                      className="rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white px-6 font-bold cursor-pointer"
                    >
                      ✓ Tandai Dibayar
                    </Button>
                  )}
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => {
                      setCorrectionReasonInput('');
                      setCorrectionModalOpen(true);
                    }}
                    className="rounded-xl border-amber-300 text-amber-700 hover:bg-amber-50 px-6 font-bold cursor-pointer"
                  >
                    Ajukan Koreksi
                  </Button>
                </div>
              ) : null}
            </div>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ─── Modal Ajukan Koreksi ─────────────────────────────────── */}
      <Dialog open={correctionModalOpen} onOpenChange={setCorrectionModalOpen}>
        <DialogContent className="sm:max-w-md rounded-2xl p-6 bg-white border border-slate-100 shadow-2xl">
          <DialogHeader>
            <DialogTitle className="text-lg font-bold text-slate-900 flex items-center gap-2">
              <AlertCircle className="w-5 h-5 text-amber-500" />
              Ajukan Koreksi Slip Gaji
            </DialogTitle>
            <DialogDescription className="text-xs text-slate-500 mt-1">
              Slip ini sudah terkunci. Berikan catatan/alasan koreksi untuk dicatat pada Financial Audit Log.
            </DialogDescription>
          </DialogHeader>

          <div className="py-3 space-y-2">
            <Label className="text-xs font-bold text-slate-700">Alasan / Catatan Koreksi</Label>
            <textarea
              rows={3}
              value={correctionReasonInput}
              onChange={(e) => setCorrectionReasonInput(e.target.value)}
              placeholder="Contoh: Koreksi nomor rekening bank atau penyesuaian insentif tambahan..."
              className="w-full text-xs font-semibold p-3 rounded-xl border border-slate-200 focus:border-amber-500 outline-none resize-none bg-slate-50/50"
            />
          </div>

          <DialogFooter className="flex justify-end gap-2 pt-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => setCorrectionModalOpen(false)}
              className="rounded-xl text-xs font-bold h-9 px-4 cursor-pointer"
            >
              Batal
            </Button>
            <Button
              type="button"
              onClick={handleConfirmCorrectionRequest}
              className="rounded-xl bg-amber-600 hover:bg-amber-700 text-white text-xs font-bold h-9 px-5 cursor-pointer"
            >
              Kirim Pengajuan Koreksi
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ─── Modal Konfirmasi Tandai Dibayar ──────────────────────── */}
      <Dialog open={paidModalOpen} onOpenChange={setPaidModalOpen}>
        <DialogContent className="sm:max-w-md rounded-2xl p-6 bg-white border border-slate-100 shadow-2xl">
          <DialogHeader>
            <DialogTitle className="text-lg font-bold text-slate-900 flex items-center gap-2">
              <CheckCircle2 className="w-5 h-5 text-emerald-600" />
              Konfirmasi Pembayaran Gaji
            </DialogTitle>
            <DialogDescription className="text-xs text-slate-500 mt-1">
              Konfirmasi bahwa gaji sebesar <strong className="text-emerald-700">{netSalary.toLocaleString('id-ID')}</strong> telah berhasil ditransfer.
            </DialogDescription>
          </DialogHeader>

          <div className="py-3 space-y-2">
            <Label className="text-xs font-bold text-slate-700">Referensi Transaksi Bank</Label>
            <Input
              value={bankRefInput}
              onChange={(e) => setBankRefInput(e.target.value)}
              placeholder="Contoh: TR-20260724-889A"
              className="text-xs font-semibold h-10 rounded-xl bg-slate-50/50 border-slate-200"
            />
          </div>

          <DialogFooter className="flex justify-end gap-2 pt-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => setPaidModalOpen(false)}
              className="rounded-xl text-xs font-bold h-9 px-4 cursor-pointer"
            >
              Batal
            </Button>
            <Button
              type="button"
              onClick={handleConfirmMarkPaid}
              className="rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold h-9 px-5 cursor-pointer"
            >
              Konfirmasi Dibayar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ─── Comparison Dialog for Refresh ───────────────────── */}
      <Dialog open={compareOpen} onOpenChange={setCompareOpen}>
        <DialogContent className="sm:max-w-md rounded-2xl p-6 bg-white border border-slate-100 shadow-xl">
          <DialogHeader>
            <DialogTitle className="text-lg font-bold text-slate-800 flex items-center gap-2">
              <RotateCcw className="w-5 h-5 text-indigo-500" />
              Perbandingan Data Terbaru
            </DialogTitle>
            <DialogDescription className="text-sm text-slate-500">
              Berikut adalah perbedaan antara draf slip saat ini dengan data terbaru di database:
            </DialogDescription>
          </DialogHeader>
          <div className="my-4 space-y-3 max-h-[40vh] overflow-y-auto pr-1">
            {refreshDiff && refreshDiff.length > 0 ? (
              refreshDiff.map((diff, idx) => (
                <div key={idx} className="flex justify-between items-center p-3 rounded-xl border border-slate-100 bg-slate-50/50 text-xs font-semibold">
                  <div className="space-y-1">
                    <span className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${diff.type === 'earnings' ? 'bg-emerald-50 text-emerald-700' : 'bg-red-50 text-red-700'}`}>
                      {diff.type === 'earnings' ? 'Pendapatan' : 'Potongan'}
                    </span>
                    <p className="text-slate-700 font-bold mt-1">{diff.label}</p>
                  </div>
                  <div className="text-right tabular-nums space-y-0.5">
                    <p className="text-slate-400 line-through">
                      {diff.oldValue !== null ? formatIDR(diff.oldValue) : '(baru)'}
                    </p>
                    <p className="text-indigo-600 font-bold">
                      {diff.newValue !== null ? formatIDR(diff.newValue) : '(dihapus)'}
                    </p>
                  </div>
                </div>
              ))
            ) : (
              <p className="text-xs text-slate-500 text-center py-6">Tidak ada perbedaan data.</p>
            )}
          </div>
          <DialogFooter className="flex justify-end gap-2">
            <Button
              type="button"
              variant="ghost"
              onClick={() => setCompareOpen(false)}
              className="rounded-xl"
            >
              Batal
            </Button>
            <Button
              type="button"
              onClick={() => {
                if (freshRecalculated) {
                  setEarnings(freshRecalculated.earnings);
                  setDeductions(freshRecalculated.deductions);
                }
                setCompareOpen(false);
              }}
              className="rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white font-bold"
            >
              Terapkan Perubahan
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
