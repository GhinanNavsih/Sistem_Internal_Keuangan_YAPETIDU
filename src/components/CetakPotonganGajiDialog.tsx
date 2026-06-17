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
import { generatePotonganGajiPdf, PotonganGajiRow } from '@/utils/generatePotonganGajiPdf';

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

interface CetakPotonganGajiDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  employees: EmployeeRow[];
  categories: string[]; // Unique department units for Loyalis
  periodName: string; // e.g. "Mei 2026"
  slipStates?: Record<string, any>;
  koperasiDeductions?: Record<string, number>;
  koperasiSavings?: Record<string, number>;
  getLoyalisPresenceDeduction?: (empId: string) => number;
  getLoyalisPresensiDeduction?: (empId: string) => number;
}

export default function CetakPotonganGajiDialog({
  open,
  onOpenChange,
  employees,
  categories,
  periodName,
  slipStates,
  koperasiDeductions,
  koperasiSavings,
  getLoyalisPresenceDeduction,
  getLoyalisPresensiDeduction,
}: CetakPotonganGajiDialogProps) {
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
    const rows: PotonganGajiRow[] = sortedEmployees.map((emp, idx) => {
      const raw = emp.raw;
      const slip = slipStates?.[emp.id];

      // Helper to find customized deduction in slipState
      const getDeductionAmount = (labels: string[], fallbackVal: number): number => {
        if (slip && slip.deductions) {
          const match = slip.deductions.find((d: any) =>
            labels.some(lbl => lbl.toLowerCase() === d.label?.toLowerCase())
          );
          if (match) return match.amount;
        }
        return fallbackVal;
      };

      // Fallbacks
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

      // Actual values matching names in slip
      const kopRochmad = getDeductionAmount(['Koperasi Rochmad', 'Kop. Rochmad'], fallbackKopRochmad);
      const bpjs = getDeductionAmount(['BPJS'], fallbackBpjs);
      const tht = getDeductionAmount(['Tabungan Hari Tua BNI Simponi', 'THT', 'THT BNI Simponi'], fallbackTht);
      const tabungan = getDeductionAmount(['Tabungan'], fallbackTabungan);
      const zis = getDeductionAmount(['Zakat Infaq Sodaqoh', 'ZIS', 'Zakat Infaq Shadaqah', 'Zakat Infaq Sodaqoh'], fallbackZis);
      const revisiGaji = getDeductionAmount(['Revisi Gaji'], fallbackRevisi);
      const pinlu = getDeductionAmount(['Pinlu/Tagihan', 'Pinlu', 'Tagihan'], fallbackPinlu);
      const pinjamanKopUnipdu = getDeductionAmount(['Pinjaman Kop. UNIPDU', 'Pinjaman Koperasi UNIPDU'], fallbackPinjamanKopUnipdu);
      const potPresensi = getDeductionAmount(['Potongan Presensi'], fallbackPotPresensi);
      const potBonusPresensi = getDeductionAmount(['Potongan Bonus Presensi', 'Potongan Kehadiran'], fallbackPotBonusPresensi);
      const iuranWajibKopUnipdu = getDeductionAmount(['Iuran Wajib Kop. UNIPDU', 'Iuran Koperasi UNIPDU', 'Iuran Wajib Koperasi UNIPDU'], fallbackIuranWajibKopUnipdu);

      const jumlah =
        kopRochmad +
        bpjs +
        tht +
        tabungan +
        zis +
        revisiGaji +
        pinlu +
        pinjamanKopUnipdu +
        potPresensi +
        potBonusPresensi +
        iuranWajibKopUnipdu;

      return {
        noUrut: idx + 1,
        name: emp.name,
        kopRochmad,
        bpjs,
        tht,
        tabungan,
        zis,
        revisiGaji,
        pinlu,
        pinjamanKopUnipdu,
        potPresensi,
        potBonusPresensi,
        iuranWajibKopUnipdu,
        jumlah,
      };
    });

    // 4. Generate the PDF
    generatePotonganGajiPdf({
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
                Laporan Potongan Gaji
              </DialogTitle>
              <DialogDescription className="text-sm text-slate-500 mt-0.5">
                Pilih unit departemen untuk mencetak rincian potongan gaji
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
              Laporan ini merangkum seluruh rincian potongan gaji (Koperasi, BPJS, Tabungan, ZIS, Pinlu, presensi, dll.) untuk karyawan Loyalis di unit departemen terpilih.
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
