"use client";

import React, { useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { FileText, Printer } from 'lucide-react';
import { generateGabunganPdf, GabunganRow } from '@/utils/generateGabunganPdf';
import { calculateGapok } from '@/utils/payrollLogic';
import { calculateStructuralAllowance } from '@/utils/salaryCalculator';

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

interface CetakGabunganDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  employees: EmployeeRow[];
  categories: string[]; // Unique department units for Loyalis
  periodName: string; // e.g. "Mei 2026"
  salaryMatrix: any;
  targetDate: Date;
  functionalAllowanceMap: Record<string, number>;
  kepangkatanAllowanceMap?: Record<string, number>;
  getLoyalisPresenceBonus: (empId: string) => number;
  getLoyalisPresenceDeduction: (empId: string) => number;
  getLoyalisPresensiEarning: (empId: string) => number;
  getLoyalisPresensiDeduction: (empId: string) => number;
  loyalisPresenceData: any;
  vakasiTambahanListMap: Record<string, { eventName: string; payGiven: number; isEndOfMonth?: boolean }[]>;
  slipStates?: Record<string, any>;
  koperasiDeductions?: Record<string, number>;
  koperasiSavings?: Record<string, number>;
}

export default function CetakGabunganDialog({
  open,
  onOpenChange,
  employees,
  categories,
  periodName,
  salaryMatrix,
  targetDate,
  functionalAllowanceMap,
  kepangkatanAllowanceMap,
  getLoyalisPresenceBonus,
  getLoyalisPresenceDeduction,
  getLoyalisPresensiEarning,
  getLoyalisPresensiDeduction,
  loyalisPresenceData,
  vakasiTambahanListMap,
  slipStates,
  koperasiDeductions,
  koperasiSavings,
}: CetakGabunganDialogProps) {
  const [selectedCategory, setSelectedCategory] = useState<string>('');

  React.useEffect(() => {
    if (open) {
      setSelectedCategory('Semua');
    }
  }, [open]);

  const handlePrint = () => {
    if (!selectedCategory) return;

    // 1. Get all active Loyalis employees in the selected department unit
    const activeLoyalis = employees.filter(emp => {
      const raw = emp.raw;
      const isLoyalis = emp.id?.startsWith('Loyalis_') || raw.employeeId?.startsWith('Loyalis_') || !!raw.personal_info;
      return isLoyalis && emp.isActive && (selectedCategory === 'Semua' || emp.role === selectedCategory);
    });

    if (activeLoyalis.length === 0) {
      alert(selectedCategory === 'Semua'
        ? 'Tidak ada karyawan Loyalis aktif ditemukan.'
        : `Tidak ada karyawan Loyalis aktif ditemukan di unit "${selectedCategory}".`
      );
      return;
    }

    // 2. Sort by original database rowIndex to guarantee a deterministic sequence
    const sortedEmployees = [...activeLoyalis].sort((a, b) => a.rowIndex - b.rowIndex);

    // 3. Map to row data objects
    const rows: GabunganRow[] = sortedEmployees.map((emp, idx) => {
      const raw = emp.raw;
      const slip = slipStates?.[emp.id];

      // Helper to find customized earning in slipState
      const getEarningAmount = (labels: string[], fallbackVal: number): number => {
        return fallbackVal;
      };

      // Helper to find customized deduction in slipState
      const getDeductionAmount = (labels: string[], fallbackVal: number): number => {
        return fallbackVal;
      };

      // --- 1. TUNJANGAN JABATAN ---
      let tunjJabatan = 0;
      const positions = raw.employment_profile?.structural_positions || [];
      if (positions.length > 0) {
        const sortedPositions = [...positions].sort((a: any, b: any) => (Number(b.allowance) || 0) - (Number(a.allowance) || 0));
        sortedPositions.forEach((pos: any, posIdx: number) => {
          const originalAllowance = Number(pos.allowance) || 0;
          const allowanceAmount = posIdx === 0 ? originalAllowance : Math.round(originalAllowance / 2);
          tunjJabatan += allowanceAmount;
        });
      }

      // --- 2. VAKASI PIMPINAN & STAF ---
      const fallbackGapok = emp.gradeLevel && emp.gradeLevel.trim() !== '' ? calculateGapok(emp, salaryMatrix, targetDate) : 0;

      let spouseCount = 0, sd = 0, sltp = 0, slta = 0, pt = 0;
      const metrics = raw.family_allowance_metrics;
      if (metrics) {
        spouseCount = Number(metrics.spouse_count) || 0;
        sd = Number(metrics.children_sd) || 0;
        sltp = Number(metrics.children_sltp) || 0;
        slta = Number(metrics.children_slta) || 0;
        pt = Number(metrics.children_pt) || 0;
      }
      const familyPct = (spouseCount * 0.05) + (sd * 0.05) + (sltp * 0.075) + (slta * 0.1) + (pt * 0.125);
      const fallbackTunjKeluarga = fallbackGapok ? Math.round(fallbackGapok * familyPct) : 0;

      const fallbackTunjFungsional = functionalAllowanceMap[emp.id] || 0;
      const fallbackKepangkatan = kepangkatanAllowanceMap?.[emp.id] ?? (raw.kepangkatan?.t_kepangkatan || 0);
      const fallbackTHariTua = fallbackGapok ? Math.round(fallbackGapok * 0.1) : 0;
      const fallbackTBpjsTk = raw.bpjs?.t_bpjs_tk || 0;
      const fallbackTBpjsKes = raw.bpjs?.t_bpjs_kes || 0;
      const fallbackBeras = raw.salaryProfile?.tunjanganBeras || 0;

      let fallbackPresensi = 0;
      const presenceEntry = loyalisPresenceData?.entries?.[emp.id];
      if (presenceEntry && !presenceEntry.isNotFoundInExcel) {
        fallbackPresensi = getLoyalisPresensiEarning(emp.id);
      }

      const fallbackPresenceBonus = getLoyalisPresenceBonus(emp.id);

      const gapok = getEarningAmount(['Gaji Pokok', 'Gapok'], fallbackGapok);
      const tunjKeluarga = getEarningAmount(['T. Keluarga', 'Tunjangan Keluarga'], fallbackTunjKeluarga);
      const tunjFungsional = getEarningAmount(['T. Fungsional', 'Tunjangan Fungsional'], fallbackTunjFungsional);
      const kepangkatan = getEarningAmount(['Kepangkatan', 'Tunjangan Kepangkatan'], fallbackKepangkatan);
      const tHariTua = getEarningAmount(['T. Hari Tua', 'Tabungan Hari Tua'], fallbackTHariTua);
      const tBpjsTk = getEarningAmount(['T. BPJS TK', 'BPJS Tenaga Kerja', 'BPJS TK'], fallbackTBpjsTk);
      const tBpjsKes = getEarningAmount(['T. BPJS KES', 'BPJS Kesehatan', 'BPJS KES'], fallbackTBpjsKes);
      const beras = getEarningAmount(['Beras', 'Tunjangan Beras'], fallbackBeras);
      const presensiAmount = getEarningAmount(['Presensi', 'Vakasi Jam', 'Uang Presensi'], fallbackPresensi);
      const presenceBonus = getEarningAmount(['Bonus Presensi', 'Uang Kehadiran'], fallbackPresenceBonus);

      const vakasiPimpinanStaf =
        gapok +
        tunjKeluarga +
        tunjFungsional +
        kepangkatan +
        tHariTua +
        tBpjsTk +
        tBpjsKes +
        beras +
        presensiAmount +
        presenceBonus;

      // --- 3. VAKASI LAIN-LAIN ---
      const tStruktural = calculateStructuralAllowance(raw.employment_profile?.structural_positions || []);

      const tInstruksional = getEarningAmount(['Instruksional', 'Tunjangan Instruksional', 'T. Instruksional'], raw.t_instruksional || 0);

      const employeeEvents = vakasiTambahanListMap[emp.id] || [];
      let vakasiTambahan = 0;
      let endOfMonthTotal = 0;

      employeeEvents.forEach(evt => {
        if (evt.isEndOfMonth) {
          endOfMonthTotal += evt.payGiven;
        } else {
          vakasiTambahan += evt.payGiven;
        }
      });

      const vakasiLainLain = tStruktural + tInstruksional + vakasiTambahan + endOfMonthTotal;

      // --- 4. POTONGAN GAJI ---
      const fallbackKopRochmad = raw.deductions?.koperasiRochmad || 0;
      const fallbackBpjs = raw.bpjs?.deductionAmount || 0;
      const fallbackTht = raw.tht?.deductionAmount || 0;
      const fallbackTabungan = raw.savings?.deductionAmount || 0;
      const fallbackZis = raw.ziz?.deductionAmount || 0;
      const fallbackRevisi = 0;
      const fallbackPinlu = raw.pinlu?.deductionAmount || 0;
      const fallbackPinjamanKopUnipdu = koperasiDeductions?.[emp.id] || 0;
      const fallbackPotPresensi = getLoyalisPresensiDeduction ? getLoyalisPresensiDeduction(emp.id) : 0;
      const fallbackPotBonusPresensi = getLoyalisPresenceDeduction ? getLoyalisPresenceDeduction(emp.id) : 0;
      const fallbackIuranWajibKopUnipdu = koperasiSavings?.[emp.id] || 0;

      const kopRochmad = getDeductionAmount(['Koperasi Rochmad', 'Kop. Rochmad'], fallbackKopRochmad);
      const bpjsDeductionVal = getDeductionAmount(['BPJS'], fallbackBpjs);
      const tht = getDeductionAmount(['Tabungan Hari Tua BNI Simponi', 'THT', 'THT BNI Simponi'], fallbackTht);
      const tabungan = getDeductionAmount(['Tabungan'], fallbackTabungan);
      const zis = getDeductionAmount(['Zakat Infaq Sodaqoh', 'ZIS', 'Zakat Infaq Shadaqah', 'Zakat Infaq Sodaqoh'], fallbackZis);
      const revisiGaji = getDeductionAmount(['Revisi Gaji'], fallbackRevisi);
      const pinlu = getDeductionAmount(['Pinlu/Tagihan', 'Pinlu', 'Tagihan'], fallbackPinlu);
      const pinjamanKopUnipdu = getDeductionAmount(['Pinjaman Kop. UNIPDU', 'Pinjaman Koperasi UNIPDU'], fallbackPinjamanKopUnipdu);
      const potPresensi = getDeductionAmount(['Potongan Presensi'], fallbackPotPresensi);
      const potBonusPresensi = getDeductionAmount(['Potongan Bonus Presensi', 'Potongan Kehadiran'], fallbackPotBonusPresensi);
      const iuranWajibKopUnipdu = getDeductionAmount(['Iuran Wajib Kop. UNIPDU', 'Iuran Koperasi UNIPDU', 'Iuran Wajib Koperasi UNIPDU'], fallbackIuranWajibKopUnipdu);

      const potonganGaji =
        kopRochmad +
        bpjsDeductionVal +
        tht +
        tabungan +
        zis +
        revisiGaji +
        pinlu +
        pinjamanKopUnipdu +
        potPresensi +
        potBonusPresensi +
        iuranWajibKopUnipdu;

      // Net/Gaji Bersih calculation
      const gajiBersih = tunjJabatan + vakasiPimpinanStaf + vakasiLainLain - potonganGaji;

      return {
        noUrut: idx + 1,
        name: emp.name,
        tunjanganJabatan: tunjJabatan,
        vakasiPimpinanStaf,
        vakasiLainLain,
        potonganGaji,
        gajiBersih,
      };
    });

    // 4. Generate the PDF
    generateGabunganPdf({
      department: selectedCategory === 'Semua' ? 'Semua Unit' : selectedCategory,
      period: periodName,
      rows,
    });

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
                Laporan Gabungan
              </DialogTitle>
              <DialogDescription className="text-sm text-slate-500 mt-0.5">
                Pilih unit departemen untuk mencetak laporan gabungan payroll
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>

        <div className="p-6">
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">
                Unit Departemen
              </label>
              <select
                value={selectedCategory}
                onChange={(e) => setSelectedCategory(e.target.value)}
                className="w-full bg-white border border-slate-200 text-slate-600 text-sm font-semibold rounded-xl px-3 py-2.5 outline-none focus:ring-2 focus:ring-indigo-500/20 transition-all cursor-pointer shadow-sm"
              >
                <option value="Semua">Semua (Semua Unit)</option>
                {categories.map(cat => (
                  <option key={cat} value={cat}>{cat}</option>
                ))}
              </select>
            </div>
            <p className="text-xs text-slate-500 leading-relaxed">
              Laporan ini merangkum total Tunjangan Jabatan, Vakasi Pimpinan & Staf, Vakasi Lain-Lain, dan Potongan Gaji untuk menghitung Gaji Bersih bagi karyawan Loyalis di unit departemen terpilih.
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
            onClick={handlePrint}
            className="rounded-xl bg-gradient-to-r from-indigo-500 to-purple-500 text-white hover:from-indigo-600 hover:to-purple-600 shadow-md shadow-indigo-200 px-6"
          >
            <Printer className="w-4 h-4 mr-2" />
            Cetak PDF
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
