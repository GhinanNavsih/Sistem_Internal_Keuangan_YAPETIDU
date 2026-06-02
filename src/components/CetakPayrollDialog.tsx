"use client";

import React from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import { FileText, Printer, FileSpreadsheet } from 'lucide-react';
import * as XLSX from 'xlsx';
import { calculateGapok } from '@/utils/payrollLogic';
import { calculateTotalEarnings, calculateTotalDeductions, calculateNetSalary } from '@/utils/salaryCalculator';
import { BlueCollarEmployee, SalaryMatrix, UraianGajiDocument } from '@/types';

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

interface CetakPayrollDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  employees: EmployeeRow[];
  salaryMatrix: SalaryMatrix;
  targetDate: Date;
  uraianMap: Record<string, UraianGajiDocument>;
  periodName: string;
  onPrintPdf: () => void;
  vakasiTambahanMap?: Record<string, number>;
  functionalAllowanceMap?: Record<string, number>;
  slipStates?: Record<string, any>;
}

export default function CetakPayrollDialog({
  open,
  onOpenChange,
  employees,
  salaryMatrix,
  targetDate,
  uraianMap,
  periodName,
  onPrintPdf,
  vakasiTambahanMap,
  functionalAllowanceMap,
  slipStates,
}: CetakPayrollDialogProps) {

  const handleExportXlsx = () => {
    const activeEmployees = employees.filter(e => e.isActive);
    
    const roleOrder = ['REKTORAT', 'DOSEN', 'TENDIK', 'STAF', 'SATPAM', 'SOPIR', 'PEKARYA', 'TEKNISI', 'KEBERSIHAN_IC', 'PONTI'];
    const sortedEmployees = [...activeEmployees].sort((a, b) => {
      const roleA = roleOrder.indexOf(a.role) !== -1 ? roleOrder.indexOf(a.role) : 99;
      const roleB = roleOrder.indexOf(b.role) !== -1 ? roleOrder.indexOf(b.role) : 99;
      if (roleA !== roleB) return roleA - roleB;
      return a.name.localeCompare(b.name);
    });
    
    const rows = sortedEmployees.map((emp, idx) => {
      const cat = emp.role;
      const periodKey = `${targetDate.getFullYear()}_${String(targetDate.getMonth() + 1).padStart(2, '0')}`;
      const uraianDoc = uraianMap[`${periodKey}_${cat}`];
      const gapok = calculateGapok(emp, salaryMatrix, targetDate);
      const uraianEntry = uraianDoc?.entries?.[emp.id];
      const vakasiSum = vakasiTambahanMap?.[emp.id] ?? 0;
      const fAllowance = functionalAllowanceMap?.[emp.id] ?? 0;
      
      const slip = slipStates?.[emp.id];
      let earnings = 0;
      let totalDeductions = 0;
      let netSalary = 0;

      if (slip && slip.earnings && slip.deductions) {
        earnings = slip.earnings.reduce((sum: number, e: any) => sum + e.amount, 0);
        totalDeductions = slip.deductions.reduce((sum: number, d: any) => sum + d.amount, 0);
        netSalary = earnings - totalDeductions;
      } else {
        earnings = calculateTotalEarnings(emp.raw, gapok, uraianEntry, vakasiSum, fAllowance);
        totalDeductions = calculateTotalDeductions(emp.raw);
        netSalary = calculateNetSalary(earnings, totalDeductions);
      }

      let satker = cat;
      if (satker === 'KEBERSIHAN_IC') satker = 'KEBERSIHAN IC';
      if (satker === 'KEBERSIHAN_PT') satker = 'KEBERSIHAN PONDOK TINGGI';

      return {
        'No': idx + 1,
        'Nama Karyawan': emp.name,
        'Satuan Kerja': satker,
        'No. Rekening': emp.raw.banking_info?.account_number || emp.raw.bankAccount?.accountNumber || '',
        'Gaji Bersih': netSalary
      };
    });

    const totalNet = rows.reduce((sum, r) => sum + r['Gaji Bersih'], 0);

    const worksheetData = [
      ['REKAPITULASI PAYROLL BULANAN'],
      [`Periode: ${periodName}`],
      [], 
      ['No', 'Nama Karyawan', 'Satuan Kerja', 'No. Rekening', 'Gaji Bersih'],
      ...rows.map(r => [r['No'], r['Nama Karyawan'], r['Satuan Kerja'], r['No. Rekening'], r['Gaji Bersih']]),
      [], 
      ['', 'TOTAL PAYROLL', '', '', totalNet]
    ];

    const worksheet = XLSX.utils.aoa_to_sheet(worksheetData);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, 'Laporan Payroll');

    XLSX.writeFile(workbook, `Payroll_Statement_${periodName.replace(' ', '_')}.xlsx`);
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md rounded-[28px] border-none shadow-2xl p-0 bg-white overflow-hidden">
        <DialogHeader className="p-6 pb-4 bg-gradient-to-r from-indigo-50/80 to-purple-50/60 border-b border-slate-100">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-tr from-indigo-500 to-purple-400 flex items-center justify-center shadow-sm">
              <Printer className="w-5 h-5 text-white" />
            </div>
            <div>
              <DialogTitle className="text-xl font-bold tracking-tight text-slate-800">
                Pilih Format Unduhan
              </DialogTitle>
              <DialogDescription className="text-sm text-slate-500 mt-0.5">
                Silahkan pilih format laporan payroll untuk periode {periodName}
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>

        <div className="p-6">
          <div className="grid grid-cols-2 gap-4">
            {/* Option PDF */}
            <button
              onClick={() => {
                onPrintPdf();
                onOpenChange(false);
              }}
              className="group flex flex-col items-center justify-center p-6 bg-white border border-slate-200 rounded-[20px] hover:border-rose-300 hover:bg-rose-50/30 transition-all text-center focus:outline-none cursor-pointer"
            >
              <div className="w-16 h-16 rounded-2xl bg-rose-50 text-rose-500 flex items-center justify-center mb-4 group-hover:scale-110 transition-transform duration-300">
                <FileText className="w-8 h-8" />
              </div>
              <h4 className="font-bold text-slate-800 text-sm mb-1">Unduh PDF</h4>
              <p className="text-[11px] text-slate-400 max-w-[140px] leading-normal">Laporan format PDF rapi, siap untuk dicetak fisik.</p>
            </button>

            {/* Option XLSX */}
            <button
              onClick={handleExportXlsx}
              className="group flex flex-col items-center justify-center p-6 bg-white border border-slate-200 rounded-[20px] hover:border-emerald-300 hover:bg-emerald-50/30 transition-all text-center focus:outline-none cursor-pointer"
            >
              <div className="w-16 h-16 rounded-2xl bg-emerald-50 text-emerald-500 flex items-center justify-center mb-4 group-hover:scale-110 transition-transform duration-300">
                <FileSpreadsheet className="w-8 h-8" />
              </div>
              <h4 className="font-bold text-slate-800 text-sm mb-1">Unduh Excel (XLSX)</h4>
              <p className="text-[11px] text-slate-400 max-w-[140px] leading-normal">Format spreadsheet XLSX untuk analisis & olah data mandiri.</p>
            </button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
