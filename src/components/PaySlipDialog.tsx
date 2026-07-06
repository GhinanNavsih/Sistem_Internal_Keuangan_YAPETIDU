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
  Eye,
  CheckCircle2,
  RotateCcw,
  Loader2,
} from 'lucide-react';
import { generatePaySlipPdf, PaySlipField, PaySlipData } from '@/utils/generatePaySlipPdf';
import { BlueCollarEmployee, UraianEntry, RekapColumn } from '@/types';
import { REKAP_COLUMNS, computeSlipAmount } from '@/utils/rekapConfig';
import { 
  calculateTotalEarnings, 
  calculateTotalDeductions, 
  calculateNetSalary 
} from '@/utils/salaryCalculator';

// ─── Types ─────────────────────────────────────────────────────

export type SlipStatus = 'draft' | 'locked';

export interface SlipState {
  status: SlipStatus;
  earnings: PaySlipField[];
  deductions: PaySlipField[];
  generatedAt?: string;
  lockedAt?: string;
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
  slipState: SlipState | null;
  onSave: (employeeId: string, earnings: PaySlipField[], deductions: PaySlipField[]) => Promise<void>;
  onLock: (employeeId: string, earnings: PaySlipField[], deductions: PaySlipField[]) => Promise<void>;
  onUnlock: (employeeId: string) => Promise<void>;
  onRefresh: (employeeId: string) => Promise<{ earnings: PaySlipField[]; deductions: PaySlipField[] }>;
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
 * Build initial earnings rows from whatever we know about the employee.
 */
export function buildInitialEarnings(
  emp: any,
  gapok: number,
  activeTab?: string,
  uraian?: UraianEntry,
  vakasiTambahanSum?: number,
  vakasiTambahanList?: { eventName: string; payGiven: number }[],
  tunjanganFungsional?: number,
  tunjanganKepangkatan?: number,
  customColumns?: RekapColumn[],
  presenceBonus = 0,
  presensiEarning = 0
): PaySlipField[] {
  const earnings: PaySlipField[] = [];

  if (activeTab === 'loyalis') {
    // White Collar / Loyalis calculations
    earnings.push({ label: 'Gaji Pokok', amount: gapok });
    
    // Tunjangan Keluarga formula
    const metrics = emp.family_allowance_metrics;
    let spouseCount = 0, sd = 0, sltp = 0, slta = 0, pt = 0;
    if (metrics) {
      spouseCount = Number(metrics.spouse_count) || 0;
      sd = Number(metrics.children_sd) || 0;
      sltp = Number(metrics.children_sltp) || 0;
      slta = Number(metrics.children_slta) || 0;
      pt = Number(metrics.children_pt) || 0;
    }
    const familyPct = (spouseCount * 0.05) + (sd * 0.05) + (sltp * 0.075) + (slta * 0.1) + (pt * 0.125);
    const tunjKeluarga = Math.round(gapok * familyPct);
    earnings.push({ label: 'T. Keluarga', amount: tunjKeluarga });

    // Tunjangan Jabatan (Kofu) -> mapped to T. Fungsional
    earnings.push({ label: 'T. Fungsional', amount: tunjanganFungsional ?? 0 });

    // Kepangkatan
    const tKepangkatan = tunjanganKepangkatan !== undefined 
      ? tunjanganKepangkatan 
      : (emp.kepangkatan?.t_kepangkatan || 0);
    earnings.push({ label: 'Kepangkatan', amount: tKepangkatan });

    // Instruksional
    const tInstruksional = emp.t_instruksional || 0;
    earnings.push({ label: 'Instruksional', amount: tInstruksional });

    // T. Hari Tua (10% of Gaji Pokok)
    earnings.push({ label: 'T. Hari Tua', amount: Math.round(gapok * 0.1) });

    // T. BPJS TK
    earnings.push({ label: 'T. BPJS TK', amount: emp.bpjs?.t_bpjs_tk || 0 });

    // T. BPJS KES
    earnings.push({ label: 'T. BPJS KES', amount: emp.bpjs?.t_bpjs_kes || 0 });

    // Beras
    const tunjBeras = emp.salaryProfile?.tunjanganBeras || 0;
    earnings.push({ label: 'Beras', amount: tunjBeras });

    // Presensi
    earnings.push({ label: 'Presensi', amount: presensiEarning });

    // Bonus Presensi
    earnings.push({ label: 'Bonus Presensi', amount: presenceBonus });

    // Piket
    earnings.push({ label: 'Piket', amount: 0 });

    // Lembur
    earnings.push({ label: 'Lembur', amount: 0 });

    // Struktural
    const positions = emp.employment_profile?.structural_positions || [];
    if (positions.length > 0) {
      const sorted = [...positions].sort((a: any, b: any) => (Number(b.allowance) || 0) - (Number(a.allowance) || 0));
      sorted.forEach((pos, idx) => {
        const amt = Number(pos.allowance) || 0;
        if (idx === 0) {
          earnings.push({ label: `Struktural: ${pos.name}`, amount: amt });
        } else {
          const adjustedAmt = Math.round(amt / 2);
          earnings.push({
            label: `Struktural: ${pos.name} (50% dari Rp ${amt.toLocaleString('id-ID')})`,
            amount: adjustedAmt,
          });
        }
      });
    } else {
      const structuralRole = emp.employment_profile?.department_unit || emp.employment_profile?.job_role || 'Struktural';
      earnings.push({ label: `Struktural: ${structuralRole}`, amount: 0 });
    }

    // Vakasi Tambahan - show each event worked
    if (vakasiTambahanList && vakasiTambahanList.length > 0) {
      vakasiTambahanList.forEach((item) => {
        earnings.push({ label: item.eventName, amount: item.payGiven });
      });
    } else if (vakasiTambahanSum && vakasiTambahanSum > 0) {
      earnings.push({ label: 'Vakasi Tambahan', amount: vakasiTambahanSum });
    }
  } else {
    const jobCategory = emp.employment?.jobCategory || '';
    const columns = REKAP_COLUMNS[jobCategory] || REKAP_COLUMNS.KEBERSIHAN;
    const allCols = [...columns, ...(customColumns || [])];

    // Gaji Pokok – always known
    earnings.push({ label: 'Gaji Pokok', amount: gapok });

    if (allCols.length > 0 && uraian) {
      // Auto-fill from UraianGaji data using column config
      for (const col of allCols) {
        if (col.slipLabel) {
          // If it's a count column and we have the raw count, compute it.
          // Otherwise, use the value from the values map (which is already a nominal currency amount).
          let amount = 0;
          if (col.type === 'count' && uraian.counts && uraian.counts[col.key] !== undefined) {
            amount = computeSlipAmount(col, uraian.counts[col.key]);
          } else {
            amount = uraian.values[col.key] ?? 0;
          }
          earnings.push({ label: col.slipLabel, amount });
        }
      }
    } else {
      // Fallback: generic placeholder rows when no UraianGaji data exists
      earnings.push({ label: 'Vakasi Harian', amount: 0 });
      earnings.push({ label: "Bonus Jum'at", amount: 0 });
      earnings.push({ label: 'Lembur', amount: 0 });
      earnings.push({ label: 'Bonus Finger', amount: 0 });
      earnings.push({ label: 'Bonus presensi', amount: 0 });
    }

    // BPJS Allowance – we have this
    if (emp.bpjs?.allowanceAmount) {
      earnings.push({ label: 'BPJS (Tunjangan)', amount: Math.round(emp.bpjs.allowanceAmount) });
    }

    // Tunjangan Beras
    earnings.push({ 
      label: 'Tunjangan Beras', 
      amount: emp.salaryProfile?.tunjanganBeras ?? 0 
    });

    // Vakasi Tambahan for Pekarya
    if (vakasiTambahanList && vakasiTambahanList.length > 0) {
      vakasiTambahanList.forEach((item) => {
        earnings.push({ label: item.eventName, amount: item.payGiven });
      });
    } else if (vakasiTambahanSum && vakasiTambahanSum > 0) {
      earnings.push({ label: 'Vakasi Tambahan', amount: vakasiTambahanSum });
    }
  }

  return earnings;
}

/**
 * Build initial deductions rows from whatever we know about the employee.
 */
export function buildInitialDeductions(
  emp: any,
  activeTab?: string,
  koperasiDeduction = 0,
  presenceDeduction = 0,
  presensiDeduction = 0,
  koperasiSaving = 0
): PaySlipField[] {
  const deductions: PaySlipField[] = [];

  if (activeTab === 'loyalis') {
    // White Collar / Loyalis deductions
    deductions.push({ label: 'Koperasi Rochmad', amount: emp.deductions?.koperasiRochmad || 0 });
    deductions.push({ label: 'BPJS', amount: emp.bpjs?.deductionAmount || 0 });
    deductions.push({ label: 'Tabungan Hari Tua BNI Simponi', amount: emp.tht?.deductionAmount || 0 });
    deductions.push({ label: 'Tabungan', amount: emp.savings?.deductionAmount || 0 });
    deductions.push({ label: 'Zakat Infaq Sodaqoh', amount: emp.ziz?.deductionAmount || 0 });
    deductions.push({ label: 'Revisi Gaji', amount: 0 });
    deductions.push({ label: 'Pinlu/Tagihan', amount: emp.pinlu?.deductionAmount || 0 });
    deductions.push({ label: 'Pinjaman Kop. UNIPDU', amount: koperasiDeduction });
    deductions.push({ label: 'Potongan Presensi', amount: presensiDeduction });
    deductions.push({ label: 'Potongan Bonus Presensi', amount: presenceDeduction });
    deductions.push({ label: 'Iuran Wajib Kop. UNIPDU', amount: koperasiSaving });
  } else {
    // BPJS deduction
    if (emp.bpjs?.deductionAmount) {
      deductions.push({ label: 'BPJS', amount: Math.round(emp.bpjs.deductionAmount) });
    }

    // Koperasi Rochmad
    if (emp.deductions?.koperasiRochmad) {
      deductions.push({ label: 'Kop. Rochmad', amount: emp.deductions.koperasiRochmad });
    }

    // Koperasi Unipdu from sample
    deductions.push({ label: 'Pinjaman Kop. UNIPDU', amount: koperasiDeduction });

    // Simpanan Wajib Koperasi
    if (koperasiSaving) {
      deductions.push({ label: 'Iuran Wajib Kop. UNIPDU', amount: koperasiSaving });
    }
  }

  return deductions;
}

// ─── Component ─────────────────────────────────────────────────

export default function PaySlipDialog({
  open,
  onOpenChange,
  employee,
  employeeNo,
  gapok,
  period,
  slipState,
  onSave,
  onLock,
  onUnlock,
  onRefresh,
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
}: PaySlipDialogProps) {
  const [earnings, setEarnings] = useState<PaySlipField[]>([]);
  const [deductions, setDeductions] = useState<PaySlipField[]>([]);

  // Snapshots for Batal functionality
  const [snapshotEarnings, setSnapshotEarnings] = useState<PaySlipField[]>([]);
  const [snapshotDeductions, setSnapshotDeductions] = useState<PaySlipField[]>([]);

  // In-place lock state representation
  const [localIsLocked, setLocalIsLocked] = useState(false);

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

    if (slipState && slipState.earnings && slipState.earnings.length > 0) {
      initEarnings = JSON.parse(JSON.stringify(slipState.earnings));
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

    if (slipState && slipState.deductions && slipState.deductions.length > 0) {
      initDeductions = JSON.parse(JSON.stringify(slipState.deductions));
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

    setEarnings(initEarnings);
    setDeductions(initDeductions);
    setSnapshotEarnings(JSON.parse(JSON.stringify(initEarnings)));
    setSnapshotDeductions(JSON.parse(JSON.stringify(initDeductions)));
    
    setLocalIsLocked(slipState ? slipState.status === 'locked' : false);
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
    customColumns,
    koperasiDeduction,
    presenceBonus,
    presensiEarning,
    presenceDeduction,
    presensiDeduction,
    koperasiSaving
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
  const netSalary = totalEarnings - totalDeductions;

  // ─── Actions ──────────────────────────────────────────────────

  const handleBatal = () => {
    setEarnings(snapshotEarnings);
    setDeductions(snapshotDeductions);
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
    if (!employee) return;
    try {
      await onSave(employee.employeeId || employee.id, earnings, deductions);
      onOpenChange(false);
    } catch (err) {
      console.error("Gagal menyimpan slip:", err);
    }
  };

  const handleKunci = async () => {
    if (!employee) return;
    try {
      await onLock(employee.employeeId || employee.id, earnings, deductions);
      onOpenChange(false);
    } catch (err) {
      console.error("Gagal mengunci slip:", err);
    }
  };

  const handleBuka = async () => {
    if (!employee) return;
    const confirmUnlock = window.confirm("Apakah Anda yakin ingin membuka kunci slip gaji ini?");
    if (!confirmUnlock) return;
    try {
      await onUnlock(employee.employeeId || employee.id);
      setLocalIsLocked(false);
    } catch (err) {
      console.error("Gagal membuka kunci:", err);
    }
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
                  {localIsLocked && (
                    <span className="inline-flex items-center gap-1 text-xs font-semibold bg-red-50 text-red-600 border border-red-200 px-2 py-0.5 rounded-full">
                      🔒 Terkunci
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
                </div>
              </div>
            </div>

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
            </div>

            <div>
              {localIsLocked ? (
                <Button
                  type="button"
                  onClick={handleBuka}
                  className="rounded-xl bg-amber-500 hover:bg-amber-600 text-white shadow-md shadow-amber-200 px-6 cursor-pointer flex items-center gap-1.5 font-bold"
                >
                  🔓 Buka Kunci
                </Button>
              ) : (
                <div className="flex items-center gap-2">
                  <Button
                    type="button"
                    onClick={handleSimpan}
                    className="rounded-xl bg-indigo-50 border border-indigo-200 text-indigo-700 hover:bg-indigo-100 shadow-sm px-6 cursor-pointer font-bold"
                  >
                    Simpan Perubahan
                  </Button>
                  <Button
                    type="button"
                    onClick={handleKunci}
                    className="rounded-xl bg-gradient-to-r from-red-500 to-rose-600 hover:from-red-600 hover:to-rose-700 text-white shadow-md shadow-red-200 px-6 cursor-pointer flex items-center gap-1.5 font-bold"
                  >
                    🔒 Kunci
                  </Button>
                </div>
              )}
            </div>
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
