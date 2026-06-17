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
import { generateVakasiLainLainPdf, VakasiLainLainRow } from '@/utils/generateVakasiLainLainPdf';
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

interface CetakVakasiLainLainDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  employees: EmployeeRow[];
  categories: string[]; // Unique department units for Loyalis
  periodName: string; // e.g. "Mei 2026"
  vakasiTambahanMap: Record<string, number>;
}

export default function CetakVakasiLainLainDialog({
  open,
  onOpenChange,
  employees,
  categories,
  periodName,
  vakasiTambahanMap,
}: CetakVakasiLainLainDialogProps) {
  const [selectedCategory, setSelectedCategory] = useState<string>('');

  React.useEffect(() => {
    if (open && categories.length > 0) {
      setSelectedCategory(categories[0]);
    }
  }, [open, categories]);

  const handlePrint = () => {
    if (!selectedCategory) return;

    // 1. Get all active Loyalis employees in the selected department unit
    const activeLoyalis = employees.filter(emp => {
      const raw = emp.raw;
      const isLoyalis = emp.id?.startsWith('Loyalis_') || raw.employeeId?.startsWith('Loyalis_') || !!raw.personal_info;
      return isLoyalis && emp.isActive && emp.role === selectedCategory;
    });

    if (activeLoyalis.length === 0) {
      alert(`Tidak ada karyawan Loyalis aktif ditemukan di unit "${selectedCategory}".`);
      return;
    }

    // 2. Sort by original database rowIndex to guarantee a deterministic sequence
    const sortedEmployees = [...activeLoyalis].sort((a, b) => a.rowIndex - b.rowIndex);

    // 3. Map to row data objects
    const rows: VakasiLainLainRow[] = sortedEmployees.map((emp, idx) => {
      const raw = emp.raw;
      
      // Tunjangan Struktural
      const tStruktural = calculateStructuralAllowance(raw.employment_profile?.structural_positions || []);

      // Vakasi Tambahan
      const vakasiTambahan = vakasiTambahanMap[emp.id] || 0;

      // Net/Jumlah of this section
      const jumlah = tStruktural + vakasiTambahan;

      return {
        noUrut: idx + 1,
        name: emp.name,
        position: raw.employment_profile?.structural_positions?.[0]?.name || raw.employment_profile?.job_role || 'Staf',
        tStruktural,
        vakasiTambahan,
        jumlah
      };
    });

    // 4. Generate the PDF
    generateVakasiLainLainPdf({
      department: selectedCategory,
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
                Laporan Vakasi Lain-Lain
              </DialogTitle>
              <DialogDescription className="text-sm text-slate-500 mt-0.5">
                Pilih unit departemen untuk mencetak rincian vakasi struktural & tambahan
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
                {categories.map(cat => (
                  <option key={cat} value={cat}>{cat}</option>
                ))}
              </select>
            </div>
            <p className="text-xs text-slate-500 leading-relaxed">
              Laporan ini merangkum seluruh tunjangan struktural dan vakasi tambahan untuk pimpinan dan staf di unit departemen terpilih.
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
