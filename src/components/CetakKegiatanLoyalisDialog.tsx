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
import { generateKegiatanLoyalisPdf, KegiatanLoyalisGroup, KegiatanLoyalisWorker } from '@/utils/generateKegiatanLoyalisPdf';

interface LoyalisEmployee {
  id: string;
  name: string;
  role: string;
  department: string;
}

interface CetakKegiatanLoyalisDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  periodName: string; // e.g. "Mei 2026"
  existingEvents: any[];
  departments: string[];
  loyalisEmployees: LoyalisEmployee[];
}

export default function CetakKegiatanLoyalisDialog({
  open,
  onOpenChange,
  periodName,
  existingEvents,
  departments,
  loyalisEmployees,
}: CetakKegiatanLoyalisDialogProps) {
  const [selectedDept, setSelectedDept] = useState<string>('');

  // Dynamically compute unique departments with active Loyalis employees as options
  const activeDepartments = React.useMemo(() => {
    const list = Array.from(new Set(loyalisEmployees.map(emp => emp.department).filter(Boolean))).sort();
    return list.length > 0 ? list : departments;
  }, [loyalisEmployees, departments]);

  React.useEffect(() => {
    if (open && activeDepartments.length > 0) {
      setSelectedDept(activeDepartments[0]);
    }
  }, [open, activeDepartments]);

  const handlePrint = () => {
    if (!selectedDept) return;

    // 1. Get all active Loyalis employee IDs in the selected department unit
    const deptEmployees = loyalisEmployees.filter(emp => emp.department === selectedDept);
    const deptEmployeeIds = new Set(deptEmployees.map(emp => emp.id));

    if (deptEmployees.length === 0) {
      alert(`Tidak ada karyawan Loyalis ditemukan di unit "${selectedDept}".`);
      return;
    }

    // 2. Filter existing events and map worker payout rows
    const groups: KegiatanLoyalisGroup[] = [];

    existingEvents.forEach(evt => {
      const workersMap = evt.eventWorkers || {};
      const workers: KegiatanLoyalisWorker[] = Object.entries(workersMap)
        .filter(([empId]) => deptEmployeeIds.has(empId))
        .map(([empId, w]: [string, any]) => ({
          name: w.employeeName || '',
          payout: Number(w.payGiven) || 0,
        }))
        .filter(w => w.payout > 0)
        .sort((a, b) => a.name.localeCompare(b.name));

      if (workers.length > 0) {
        const subtotal = workers.reduce((sum, w) => sum + w.payout, 0);
        groups.push({
          eventName: evt.eventName || 'Kegiatan Tanpa Nama',
          workers,
          subtotal,
        });
      }
    });

    if (groups.length === 0) {
      alert(`Tidak ada rincian kegiatan dengan payout ditemukan untuk unit "${selectedDept}" pada periode ${periodName}.`);
      return;
    }

    // Sort groups by eventName to make the output predictable
    groups.sort((a, b) => a.eventName.localeCompare(b.eventName));

    // Calculate grand total
    const grandTotal = groups.reduce((sum, g) => sum + g.subtotal, 0);

    // 3. Generate the PDF
    generateKegiatanLoyalisPdf({
      department: selectedDept,
      period: periodName,
      groups,
      grandTotal,
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
                Laporan Kegiatan Loyalis
              </DialogTitle>
              <DialogDescription className="text-sm text-slate-500 mt-0.5">
                Cetak laporan rincian kegiatan terverifikasi per unit departemen
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
                value={selectedDept}
                onChange={(e) => setSelectedDept(e.target.value)}
                className="w-full bg-white border border-slate-200 text-slate-600 text-sm font-semibold rounded-xl px-3 py-2.5 outline-none focus:ring-2 focus:ring-indigo-500/20 transition-all cursor-pointer shadow-sm"
              >
                {activeDepartments.map(dept => (
                  <option key={dept} value={dept}>{dept}</option>
                ))}
              </select>
            </div>
            <p className="text-xs text-slate-500 leading-relaxed">
              Laporan ini merinci seluruh kegiatan/acara (Tengah Bulan & Akhir Bulan) yang telah disetujui, mengelompokkannya per kegiatan beserta daftar nama pegawai loyalis penerima dan total subtotalnya.
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
