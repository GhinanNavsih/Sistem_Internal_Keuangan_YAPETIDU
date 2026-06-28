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
import { generateVakasiPimpinanStafPdf, VakasiPimpinanStafRow } from '@/utils/generateVakasiPimpinanStafPdf';
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

interface CetakVakasiPimpinanStafDialogProps {
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
}

export default function CetakVakasiPimpinanStafDialog({
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
}: CetakVakasiPimpinanStafDialogProps) {
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
    const rows: VakasiPimpinanStafRow[] = sortedEmployees.map((emp, idx) => {
      const raw = emp.raw;
      
      // Gaji Pokok
      const hasGapok = emp.gradeLevel && emp.gradeLevel.trim() !== '';
      const gapok = hasGapok ? calculateGapok(emp, salaryMatrix, targetDate) : undefined;

      // T. Keluarga
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
      const tunjKeluarga = gapok ? Math.round(gapok * familyPct) : 0;

      // T. Fungsional
      const tunjFungsional = functionalAllowanceMap[emp.id] || 0;

      // Kepangkatan
      const kepangkatan = kepangkatanAllowanceMap?.[emp.id] ?? (raw.kepangkatan?.t_kepangkatan || 0);

      // T. Hari Tua
      const tHariTua = gapok ? Math.round(gapok * 0.1) : undefined;

      // BPJS TK & KES
      const tBpjsTk = raw.bpjs?.t_bpjs_tk || 0;
      const tBpjsKes = raw.bpjs?.t_bpjs_kes || 0;

      // Beras
      const beras = raw.salaryProfile?.tunjanganBeras || 0;

      // Presensi (Working hours and amount)
      const presenceEntry = loyalisPresenceData?.entries?.[emp.id];
      let workedMinutes = 0;
      let presensiAmount = 0;
      let presensiHours = 0;

      if (presenceEntry && !presenceEntry.isNotFoundInExcel) {
        const workingDays = loyalisPresenceData?.workingDays || 25;
        const expectedHours = loyalisPresenceData?.expectedHours || 6.5;
        const expectedMinutes = workingDays * expectedHours * 60;
        const absenceMinutes = presenceEntry.absenceMinutes || 0;
        workedMinutes = Math.max(0, expectedMinutes - absenceMinutes);
        presensiAmount = getLoyalisPresensiEarning(emp.id);
        presensiHours = Math.round(expectedMinutes / 60);
      }

      // Bonus Presensi
      const presenceBonus = getLoyalisPresenceBonus(emp.id);

      // Jabatan
      const structPositions = raw.employment_profile?.structural_positions || [];
      const position = structPositions.length > 0
        ? structPositions.map((p: any) => p.name).join(', ')
        : (raw.employment_profile?.job_role || 'Staf');

      // Total Jumlah
      const jumlah = 
        (gapok || 0) +
        tunjKeluarga +
        tunjFungsional +
        (kepangkatan || 0) +
        (tHariTua || 0) +
        tBpjsTk +
        tBpjsKes +
        beras +
        presensiAmount +
        presenceBonus;

      return {
        noUrut: idx + 1,
        name: emp.name,
        position,
        gapok,
        tunjKeluarga,
        tunjFungsional,
        kepangkatan,
        tHariTua,
        tBpjsTk,
        tBpjsKes,
        beras,
        presensiHours,
        presensiAmount,
        presenceBonus,
        jumlah
      };
    });

    // 4. Generate the PDF
    generateVakasiPimpinanStafPdf({
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
                Laporan Vakasi Pimpinan & Staf
              </DialogTitle>
              <DialogDescription className="text-sm text-slate-500 mt-0.5">
                Pilih unit departemen untuk mencetak rekapitulasi vakasi
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
              Laporan ini merangkum seluruh rincian slip gaji bulanan, BPJS, beras, presensi jam kerja, dan bonus presensi untuk pimpinan dan staf di unit departemen terpilih.
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
