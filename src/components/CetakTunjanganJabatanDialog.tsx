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
import { FileText, Printer } from 'lucide-react';
import { generateTunjanganJabatanPdf } from '@/utils/generateTunjanganJabatanPdf';

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

interface CetakTunjanganJabatanDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  employees: EmployeeRow[];
  categories: string[]; // Unique department units for Loyalis
  periodName: string; // e.g. "Mei 2026"
}

export default function CetakTunjanganJabatanDialog({
  open,
  onOpenChange,
  employees,
  categories,
  periodName,
}: CetakTunjanganJabatanDialogProps) {
  const [selectedCategory, setSelectedCategory] = useState<string>('');

  React.useEffect(() => {
    if (open && categories.length > 0) {
      setSelectedCategory(categories[0]);
    }
  }, [open, categories]);

  const handlePrint = () => {
    if (!selectedCategory) return;

    // 1. Get all active Loyalis employees
    const activeLoyalis = employees.filter(emp => {
      const raw = emp.raw;
      const isLoyalis = emp.id?.startsWith('Loyalis_') || raw.employeeId?.startsWith('Loyalis_') || !!raw.personal_info;
      return isLoyalis && emp.isActive;
    });

    if (activeLoyalis.length === 0) {
      alert('Tidak ada karyawan Loyalis aktif ditemukan.');
      return;
    }

    // 2. Sort by original database rowIndex to guarantee a deterministic global sequence
    const sortedEmployees = [...activeLoyalis].sort((a, b) => a.rowIndex - b.rowIndex);

    const globalPositions: {
      noUrut: number;
      name: string;
      positionName: string;
      amount: number;
      departmentUnit: string;
    }[] = [];

    let runningNum = 1;

    sortedEmployees.forEach(emp => {
      const raw = emp.raw;
      const positions = raw.employment_profile?.structural_positions || [];
      if (positions.length === 0) return;

      // Sort by allowance descending to apply descending-halving rule
      const sortedPositions = [...positions].sort((a: any, b: any) => (Number(b.allowance) || 0) - (Number(a.allowance) || 0));

      sortedPositions.forEach((pos: any, posIdx: number) => {
        const originalAllowance = Number(pos.allowance) || 0;
        // Primary position (idx === 0) gets 100%, secondary positions (idx > 0) get 50%
        const allowanceAmount = posIdx === 0 ? originalAllowance : Math.round(originalAllowance / 2);

        globalPositions.push({
          noUrut: runningNum++,
          name: emp.name,
          positionName: pos.name,
          amount: allowanceAmount,
          departmentUnit: emp.role || 'Staf', // Home department unit
        });
      });
    });

    // 3. Filter by the selected department unit and non-zero amount
    const filteredRows = globalPositions.filter(p => p.departmentUnit === selectedCategory && p.amount > 0);

    if (filteredRows.length === 0) {
      alert(`Tidak ada karyawan dengan tunjangan jabatan di unit "${selectedCategory}"`);
      return;
    }

    // Assign sequential No. Urut starting at 1 for the filtered rows
    const sequentialRows = filteredRows.map((row, idx) => ({
      ...row,
      noUrut: idx + 1
    }));

    // 4. Generate the PDF
    generateTunjanganJabatanPdf({
      department: selectedCategory,
      period: periodName,
      rows: sequentialRows,
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
                Laporan Tunjangan Jabatan
              </DialogTitle>
              <DialogDescription className="text-sm text-slate-500 mt-0.5">
                Pilih unit departemen untuk mencetak tunjangan jabatan
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
              Laporan ini merangkum seluruh tunjangan jabatan struktural karyawan di unit departemen terpilih, lengkap dengan detail pembagian porsi tunjangan utama dan tambahan.
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
