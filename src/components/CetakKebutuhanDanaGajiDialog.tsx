"use client";

import React from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import { FileText, FileSpreadsheet } from 'lucide-react';

interface CetakKebutuhanDanaGajiDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  periodName: string;
  onPrintPdf: () => void;
  onExportXlsx: () => void;
}

export default function CetakKebutuhanDanaGajiDialog({
  open,
  onOpenChange,
  periodName,
  onPrintPdf,
  onExportXlsx,
}: CetakKebutuhanDanaGajiDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md rounded-[28px] border-none shadow-2xl p-0 bg-white overflow-hidden">
        <DialogHeader className="p-6 pb-4 bg-gradient-to-r from-emerald-50/80 to-teal-50/60 border-b border-slate-100">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-tr from-emerald-500 to-teal-400 flex items-center justify-center shadow-sm">
              <FileSpreadsheet className="w-5 h-5 text-white" />
            </div>
            <div>
              <DialogTitle className="text-xl font-bold tracking-tight text-slate-800">
                Format Kebutuhan Dana Gaji
              </DialogTitle>
              <DialogDescription className="text-sm text-slate-500 mt-0.5">
                Silahkan pilih format laporan Kebutuhan Dana Gaji untuk periode {periodName}
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
              <p className="text-[11px] text-slate-400 max-w-[140px] leading-normal">Laporan rekap kebutuhan dana gaji format PDF siap cetak.</p>
            </button>

            {/* Option XLSX */}
            <button
              onClick={() => {
                onExportXlsx();
                onOpenChange(false);
              }}
              className="group flex flex-col items-center justify-center p-6 bg-white border border-slate-200 rounded-[20px] hover:border-emerald-300 hover:bg-emerald-50/30 transition-all text-center focus:outline-none cursor-pointer"
            >
              <div className="w-16 h-16 rounded-2xl bg-emerald-50 text-emerald-500 flex items-center justify-center mb-4 group-hover:scale-110 transition-transform duration-300">
                <FileSpreadsheet className="w-8 h-8" />
              </div>
              <h4 className="font-bold text-slate-800 text-sm mb-1">Unduh Excel (XLSX)</h4>
              <p className="text-[11px] text-slate-400 max-w-[140px] leading-normal">Format spreadsheet XLSX untuk analisis data mandiri.</p>
            </button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
