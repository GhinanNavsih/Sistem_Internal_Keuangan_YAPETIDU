"use client";

import React, { useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogDescription,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { FileText, Printer, FileSpreadsheet } from 'lucide-react';
import { BlueCollarEmployee, SalaryMatrix, UraianGajiDocument } from '@/types';
import { calculateTotalEarnings, calculateTotalDeductions, calculateNetSalary } from '@/utils/salaryCalculator';
import { REKAP_COLUMNS, computeSlipAmount } from '@/utils/rekapConfig';
import { PaySlipField } from '@/utils/generatePaySlipPdf';
import { generateLegalitasPimpinanPdf, LegalitasEmployeeData, LegalitasPimpinanData } from '@/utils/generateLegalitasPimpinanPdf';
import { generateLegalitasPimpinanXlsx } from '@/utils/generateLegalitasPimpinanXlsx';
import { calculateGapok } from '@/utils/payrollLogic';

interface EmployeeRow {
  id: string;
  name: string;
  role: string;
  gradeLevel: string;
  joinDate: Date;
  isActive: boolean;
  raw: any;
  rowIndex: number;
}

interface LegalitasPimpinanDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  employees: EmployeeRow[];
  categories: string[];
  salaryMatrix: SalaryMatrix;
  targetDate: Date;
  uraianMap: Record<string, UraianGajiDocument>;
  periodName: string;
  vakasiTambahanMap?: Record<string, number>;
  functionalAllowanceMap?: Record<string, number>;
  slipStates?: Record<string, any>;
  koperasiDeductions?: Record<string, number>;
}

function buildInitialEarnings(
  emp: any,
  gapok: number,
  uraian?: any,
  vakasiTambahanSum?: number,
  tunjanganFungsional?: number
): PaySlipField[] {
  const earnings: PaySlipField[] = [];

  if (emp.employeeId?.startsWith('Loyalis_') || emp.id?.startsWith('Loyalis_') || emp.personal_info) {
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
    earnings.push({ label: 'Tunjangan Keluarga', amount: tunjKeluarga });

    // Tunjangan Jabatan (Kofu)
    const fAllowance = tunjanganFungsional !== undefined 
      ? tunjanganFungsional 
      : (Number(emp.academic_and_tier?.functional_tier) || 0);
    earnings.push({ label: 'Tunjangan Jabatan', amount: fAllowance });

    // Vakasi Tambahan
    earnings.push({ label: 'Vakasi Tambahan', amount: vakasiTambahanSum ?? 0 });

    // BPJS & Beras Allowances (Loyalis)
    earnings.push({ label: 'T. BPJS TK', amount: emp.bpjs?.t_bpjs_tk || 0 });
    earnings.push({ label: 'T. BPJS KES', amount: emp.bpjs?.t_bpjs_kes || 0 });
    earnings.push({ label: 'Beras', amount: emp.salaryProfile?.tunjanganBeras || 0 });

    return earnings;
  }

  const jobCategory = emp.employment?.jobCategory || '';
  const columns = REKAP_COLUMNS[jobCategory];

  // Gapok
  earnings.push({ label: 'Gapok', amount: gapok });

  if (columns && uraian) {
    for (const col of columns) {
      if (col.slipLabel) {
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
    earnings.push({ label: 'Vakasi Harian', amount: 0 });
    earnings.push({ label: "Bonus Jum'at", amount: 0 });
    earnings.push({ label: 'Lembur', amount: 0 });
    earnings.push({ label: 'Bonus Finger', amount: 0 });
    earnings.push({ label: 'Bonus presensi', amount: 0 });
  }

  if (emp.bpjs?.allowanceAmount) {
    earnings.push({ label: 'BPJS (Tunjangan)', amount: Math.round(emp.bpjs.allowanceAmount) });
  }

  earnings.push({ 
    label: 'Tunjangan Beras', 
    amount: emp.salaryProfile?.tunjanganBeras ?? 0 
  });

  return earnings;
}

function buildInitialDeductions(emp: any, koperasiDeduction = 0): PaySlipField[] {
  const deductions: PaySlipField[] = [];

  if (emp.employeeId?.startsWith('Loyalis_') || emp.id?.startsWith('Loyalis_') || emp.personal_info) {
    // White Collar / Loyalis deductions
    deductions.push({ label: 'BPJS', amount: emp.bpjs?.deductionAmount || 0 });
    deductions.push({ label: 'Kop. Rochmad', amount: 0 });
    deductions.push({ label: 'Kop. Unipdu Rejoso Gemilang', amount: koperasiDeduction });
    return deductions;
  }

  if (emp.bpjs?.deductionAmount) {
    deductions.push({ label: 'BPJS', amount: Math.round(emp.bpjs.deductionAmount) });
  }

  if (emp.deductions?.koperasiRochmad) {
    deductions.push({ label: 'Kop. Rochmad', amount: emp.deductions.koperasiRochmad });
  }

  deductions.push({ label: 'Kop. Unipdu Rejoso Gemilang', amount: koperasiDeduction });

  return deductions;
}

export default function LegalitasPimpinanDialog({
  open,
  onOpenChange,
  employees,
  categories,
  salaryMatrix,
  targetDate,
  uraianMap,
  periodName,
  vakasiTambahanMap,
  functionalAllowanceMap,
  slipStates,
  koperasiDeductions = {},
}: LegalitasPimpinanDialogProps) {
  const [selectedCategory, setSelectedCategory] = useState<string>(categories[0] || '');

  // Synchronize selectedCategory with categories when the dialog opens
  React.useEffect(() => {
    if (open && categories.length > 0) {
      setSelectedCategory(categories[0]);
    }
  }, [open, categories]);

  const handlePrint = async (format: 'pdf' | 'xlsx') => {
    if (!selectedCategory) return;

    const filteredEmployees = employees.filter(emp => emp.role === selectedCategory && emp.isActive);
    if (filteredEmployees.length === 0) {
      alert(`Tidak ada karyawan aktif untuk kategori "${selectedCategory}"`);
      return;
    }

    const periodKey = `${targetDate.getFullYear()}_${String(targetDate.getMonth() + 1).padStart(2, '0')}`;
    const uraianDoc = uraianMap[`${periodKey}_${selectedCategory}`];

    const legalitasEmployees: LegalitasEmployeeData[] = filteredEmployees.map((emp, idx) => {
      const gapok = calculateGapok(emp, salaryMatrix, targetDate);
      const uraianEntry = uraianDoc?.entries?.[emp.id];
      const vakasiSum = vakasiTambahanMap?.[emp.id] ?? 0;
      const fAllowance = functionalAllowanceMap?.[emp.id] ?? 0;

      const slip = slipStates?.[emp.id];
      let earnings: PaySlipField[] = [];
      let deductions: PaySlipField[] = [];
      let totalEarnings = 0;
      let totalDeductions = 0;
      let netSalary = 0;
      let gapokVal = gapok;

      if (slip && slip.earnings && slip.deductions) {
        earnings = slip.earnings;
        deductions = slip.deductions;
        totalEarnings = earnings.reduce((sum, e) => sum + e.amount, 0);
        totalDeductions = deductions.reduce((sum, d) => sum + d.amount, 0);
        netSalary = totalEarnings - totalDeductions;
        const gapokField = earnings.find(e => e.label === 'Gapok' || e.label === 'Gaji Pokok');
        if (gapokField) {
          gapokVal = gapokField.amount;
        }
      } else {
        const kopUnipdu = koperasiDeductions?.[emp.id] ?? 0;
        earnings = buildInitialEarnings(emp.raw, gapok, uraianEntry, vakasiSum, fAllowance);
        deductions = buildInitialDeductions(emp.raw, kopUnipdu);
        totalEarnings = earnings.reduce((sum, e) => sum + e.amount, 0);
        totalDeductions = deductions.reduce((sum, d) => sum + d.amount, 0);
        netSalary = totalEarnings - totalDeductions;
        gapokVal = gapok;
      }

      return {
        employeeNo: idx + 1,
        nik: emp.raw.personal_info?.employee_id_niy || emp.raw.nik || '',
        name: emp.name,
        gapok: gapokVal,
        earnings,
        totalEarnings,
        deductions,
        totalDeductions,
        netSalary
      };
    });

    const data: LegalitasPimpinanData = {
      jobCategory: selectedCategory,
      period: periodName,
      employees: legalitasEmployees,
    };

    if (format === 'pdf') {
      await generateLegalitasPimpinanPdf(data);
    } else {
      generateLegalitasPimpinanXlsx(data);
    }
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md rounded-[28px] border-none shadow-2xl p-0 bg-white">
        <DialogHeader className="p-6 pb-4 bg-gradient-to-r from-indigo-50/80 to-purple-50/60 border-b border-slate-100">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-tr from-indigo-500 to-purple-400 flex items-center justify-center shadow-sm">
              <FileText className="w-5 h-5 text-white" />
            </div>
            <div>
              <DialogTitle className="text-xl font-bold tracking-tight text-slate-800">
                Cetak Legalitas Pimpinan
              </DialogTitle>
              <DialogDescription className="text-sm text-slate-500 mt-0.5">
                Pilih kategori jabatan untuk dicetak
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>

        <div className="p-6">
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">
                Kategori Jabatan
              </label>
              <select
                value={selectedCategory}
                onChange={(e) => setSelectedCategory(e.target.value)}
                className="w-full bg-white border border-slate-200 text-slate-600 text-sm font-semibold rounded-xl px-3 py-2 outline-none focus:ring-2 focus:ring-indigo-500/20 transition-all cursor-pointer"
              >
                {categories.map(cat => (
                  <option key={cat} value={cat}>{cat}</option>
                ))}
              </select>
            </div>
            <p className="text-xs text-slate-500">
              Dokumen yang dicetak akan merangkum semua komponen gaji karyawan pada kategori yang dipilih.
            </p>
          </div>
        </div>

        <DialogFooter className="p-6 pt-4 bg-slate-50/50 border-t border-slate-100">
          <Button
            type="button"
            variant="ghost"
            onClick={() => onOpenChange(false)}
            className="rounded-xl text-slate-500"
          >
            Batal
          </Button>
          <Button
            type="button"
            onClick={() => handlePrint('pdf')}
            className="rounded-xl bg-gradient-to-r from-indigo-500 to-purple-500 text-white hover:from-indigo-600 hover:to-purple-600 shadow-md shadow-indigo-200 px-6"
          >
            <Printer className="w-4 h-4 mr-2" />
            Cetak PDF
          </Button>
          <Button
            type="button"
            onClick={() => handlePrint('xlsx')}
            className="rounded-xl bg-gradient-to-r from-emerald-500 to-teal-500 text-white hover:from-emerald-600 hover:to-teal-600 shadow-md shadow-emerald-200 px-6"
          >
            <FileSpreadsheet className="w-4 h-4 mr-2" />
            Unduh Excel
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
