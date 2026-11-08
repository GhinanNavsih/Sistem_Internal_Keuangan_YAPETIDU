"use client";

import React, { useState, useMemo, useEffect } from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import {
  FileCode,
  FileSpreadsheet,
  Building2,
  Users,
  Wallet,
  ShieldCheck,
  CheckCircle2,
  AlertCircle,
  HelpCircle,
} from 'lucide-react';
import * as XLSX from 'xlsx';
import {
  generateCoretaxBpmpXml,
  generateCoretaxBpmpExcel,
  type CoretaxBpmpRow,
  type CoretaxExportParams,
  DEFAULT_NPWP_PEMOTONG,
  DEFAULT_NAMA_PEMOTONG,
  DEFAULT_NITKU_PEMOTONG,
  DEFAULT_NITKU_DEFAULT,
} from '@/lib/payroll/coretaxExport';
import { resolveEmployeePtkpStatus, resolveTerCategory } from '@/lib/payroll/payrollTax';

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

interface CetakCoretaxDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  periodName: string; // e.g. "November 2026" or "2026_11"
  targetDate: Date;
  payrollCollar: 'loyalis' | 'blue' | 'blue-collar';
  employees: EmployeeRow[];
  getFreshSlipData: (emp: EmployeeRow) => {
    earnings: { label: string; amount: number }[];
    deductions: { label: string; amount: number }[];
    taxes?: { label: string; amount: number }[];
  };
}

const STORAGE_KEY_WITHHOLDER_NPWP = 'coretax_withholder_npwp';
const STORAGE_KEY_WITHHOLDER_NAME = 'coretax_withholder_name';
const STORAGE_KEY_WITHHOLDER_NITKU = 'coretax_withholder_nitku';
const LEGACY_NPWP_PEMOTONG = '0000000000000000';
const LEGACY_NAMA_PEMOTONG = "UNIVERSITAS PESANTREN TINGGI DARUL 'ULUM";
const LEGACY_NITKU_PEMOTONG = '0000000000000000';

export default function CetakCoretaxDialog({
  open,
  onOpenChange,
  periodName,
  targetDate,
  payrollCollar,
  employees,
  getFreshSlipData,
}: CetakCoretaxDialogProps) {
  // Withholder (Pemotong Pajak) settings with persistent defaults
  const [withholderNpwp, setWithholderNpwp] = useState<string>(DEFAULT_NPWP_PEMOTONG);
  const [withholderName, setWithholderName] = useState<string>(DEFAULT_NAMA_PEMOTONG);
  const [withholderNitku, setWithholderNitku] = useState<string>(DEFAULT_NITKU_PEMOTONG);

  // Filter option: 'all' or 'taxable_only'
  const [filterMode, setFilterMode] = useState<'all' | 'taxable_only'>('all');
  const [downloadSuccess, setDownloadSuccess] = useState<string | null>(null);

  // Load saved withholder info from localStorage when opened
  useEffect(() => {
    if (open && typeof window !== 'undefined') {
      const savedNpwp = localStorage.getItem(STORAGE_KEY_WITHHOLDER_NPWP);
      const savedName = localStorage.getItem(STORAGE_KEY_WITHHOLDER_NAME);
      const savedNitku = localStorage.getItem(STORAGE_KEY_WITHHOLDER_NITKU);

      if (savedNpwp) {
        const value = savedNpwp === LEGACY_NPWP_PEMOTONG ? DEFAULT_NPWP_PEMOTONG : savedNpwp;
        setWithholderNpwp(value);
        if (value !== savedNpwp) localStorage.setItem(STORAGE_KEY_WITHHOLDER_NPWP, value);
      }
      if (savedName) {
        const value = savedName === LEGACY_NAMA_PEMOTONG ? DEFAULT_NAMA_PEMOTONG : savedName;
        setWithholderName(value);
        if (value !== savedName) localStorage.setItem(STORAGE_KEY_WITHHOLDER_NAME, value);
      }
      if (savedNitku) {
        const value = savedNitku === LEGACY_NITKU_PEMOTONG ? DEFAULT_NITKU_PEMOTONG : savedNitku;
        setWithholderNitku(value);
        if (value !== savedNitku) localStorage.setItem(STORAGE_KEY_WITHHOLDER_NITKU, value);
      }
      setDownloadSuccess(null);
    }
  }, [open]);

  // Persist withholder settings whenever changed
  const handleNpwpChange = (val: string) => {
    setWithholderNpwp(val);
    if (typeof window !== 'undefined') {
      localStorage.setItem(STORAGE_KEY_WITHHOLDER_NPWP, val);
    }
  };

  const handleNameChange = (val: string) => {
    setWithholderName(val);
    if (typeof window !== 'undefined') {
      localStorage.setItem(STORAGE_KEY_WITHHOLDER_NAME, val);
    }
  };

  const handleNitkuChange = (val: string) => {
    setWithholderNitku(val);
    if (typeof window !== 'undefined') {
      localStorage.setItem(STORAGE_KEY_WITHHOLDER_NITKU, val);
    }
  };

  const year = targetDate.getFullYear();
  const month = targetDate.getMonth() + 1;
  const periodKey = `${year}_${String(month).padStart(2, '0')}`;

  // Build rows from employees and current fresh slip calculations
  const allRows: CoretaxBpmpRow[] = useMemo(() => {
    return employees
      .filter((emp) => emp.isActive)
      .map((emp, index) => {
        const fresh = getFreshSlipData(emp);
        const grossEarnings = (fresh.earnings || []).reduce((acc, curr) => acc + (Number(curr.amount) || 0), 0);
        const ptkp = resolveEmployeePtkpStatus(emp.raw, periodKey);
        const terCat = resolveTerCategory(ptkp);

        const taxItem = (fresh.taxes || []).find((t) =>
          t.label?.toLowerCase().includes('pph 21') || t.label?.toLowerCase().includes('pajak')
        );
        const pphDipotong = taxItem ? Math.round(Number(taxItem.amount) || 0) : 0;
        const tarifPersen = grossEarnings > 0 && pphDipotong > 0
          ? Number(((pphDipotong / grossEarnings) * 100).toFixed(2))
          : 0;

        const nik = emp.raw?.personal_info?.nik || emp.raw?.nik || '';
        const npwp = emp.raw?.personal_info?.npwp || emp.raw?.npwp || '';
        const nitku = emp.raw?.personal_info?.nitku || emp.raw?.nitku || DEFAULT_NITKU_DEFAULT;
        const gender = emp.raw?.personal_info?.gender || emp.raw?.gender || null;

        return {
          no: index + 1,
          id: emp.id,
          name: emp.name,
          nik,
          npwp,
          nitku,
          ptkp,
          terCategory: terCat,
          kodeObjekPajak: '21-100-01',
          penghasilanBruto: grossEarnings,
          tarifPersen,
          pphDipotong,
          gender,
        };
      });
  }, [employees, getFreshSlipData, periodKey]);

  // Filtered rows for export
  const exportRows = useMemo(() => {
    const list = filterMode === 'taxable_only'
      ? allRows.filter((r) => r.pphDipotong > 0)
      : allRows;
    return list.map((r, i) => ({ ...r, no: i + 1 }));
  }, [allRows, filterMode]);

  // Aggregate metrics
  const totalEmployees = allRows.length;
  const taxableEmployees = allRows.filter((r) => r.pphDipotong > 0).length;
  const zeroTaxEmployees = allRows.filter((r) => r.pphDipotong === 0).length;
  const totalGross = allRows.reduce((sum, r) => sum + r.penghasilanBruto, 0);
  const totalPph = allRows.reduce((sum, r) => sum + r.pphDipotong, 0);

  const exportParams: CoretaxExportParams = {
    periodKey,
    periodLabel: periodName,
    year,
    month,
    withholderNpwp,
    withholderNitku,
    withholderName,
    rows: exportRows,
  };

  const handleDownloadXml = () => {
    try {
      const xmlString = generateCoretaxBpmpXml(exportParams);
      const blob = new Blob([xmlString], { type: 'application/xml;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `Coretax_BPMP_${periodKey}_${payrollCollar}_${filterMode}.xml`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      setDownloadSuccess('XML Coretax BPMP berhasil diunduh. Siap diimpor ke aplikasi Coretax DJP.');
    } catch (err: any) {
      console.error('Error exporting Coretax XML:', err);
      alert('Gagal mengekspor XML: ' + (err?.message || 'Unknown error'));
    }
  };

  const handleDownloadExcel = () => {
    try {
      const wb = generateCoretaxBpmpExcel(exportParams);
      const filename = `Coretax_BPMP_${periodKey}_${payrollCollar}_${filterMode}.xlsx`;
      XLSX.writeFile(wb, filename);
      setDownloadSuccess('File Excel Coretax BPMP & Rekap TER berhasil diunduh.');
    } catch (err: any) {
      console.error('Error exporting Coretax Excel:', err);
      alert('Gagal mengekspor Excel: ' + (err?.message || 'Unknown error'));
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[720px] max-h-[92vh] flex flex-col p-0 overflow-hidden bg-white border border-slate-200 shadow-2xl rounded-lg">
        {/* Header */}
        <div className="px-6 py-5 bg-gradient-to-r from-blue-900 via-indigo-900 to-slate-900 text-white shrink-0">
          <DialogHeader className="text-left">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="p-2.5 rounded-lg bg-blue-500/20 border border-blue-400/30 text-blue-200">
                  <FileCode className="w-6 h-6" />
                </div>
                <div>
                  <DialogTitle className="text-lg font-bold text-white tracking-tight">
                    Ekspor PPh 21 Coretax DJP (BPMP)
                  </DialogTitle>
                  <DialogDescription className="text-blue-200 text-xs mt-0.5">
                    Bukti Pemotongan Bulanan Pegawai Tetap (PP 58/2023 & PMK 168/2023)
                  </DialogDescription>
                </div>
              </div>
              <span className="px-2.5 py-1 rounded-full text-[11px] font-bold bg-blue-500/20 text-blue-200 border border-blue-400/30">
                {periodName}
              </span>
            </div>
          </DialogHeader>
        </div>

        {/* Scrollable Body */}
        <div className="flex-1 overflow-y-auto px-6 py-5 space-y-5 text-slate-700">
          {/* Summary Metric Cards */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <div className="p-3 rounded-lg border border-slate-200 bg-slate-50/70">
              <span className="text-[11px] font-medium text-slate-500 flex items-center gap-1.5">
                <Users className="w-3.5 h-3.5 text-slate-400" />
                Total Pegawai
              </span>
              <p className="text-lg font-bold text-slate-900 mt-1">{totalEmployees}</p>
              <span className="text-[10px] text-slate-400">{payrollCollar === 'loyalis' ? 'Kelompok Loyalis' : 'Kelompok Pekarya'}</span>
            </div>

            <div className="p-3 rounded-lg border border-amber-200 bg-amber-50/50">
              <span className="text-[11px] font-medium text-amber-800 flex items-center gap-1.5">
                <ShieldCheck className="w-3.5 h-3.5 text-amber-600" />
                Kena PPh 21
              </span>
              <p className="text-lg font-bold text-amber-900 mt-1">{taxableEmployees}</p>
              <span className="text-[10px] text-amber-700">{zeroTaxEmployees} Pegawai Tarif 0%</span>
            </div>

            <div className="p-3 rounded-lg border border-slate-200 bg-slate-50/70">
              <span className="text-[11px] font-medium text-slate-500 flex items-center gap-1.5">
                <Wallet className="w-3.5 h-3.5 text-slate-400" />
                Total Bruto
              </span>
              <p className="text-sm font-bold text-slate-900 mt-1 truncate" title={`Rp ${totalGross.toLocaleString('id-ID')}`}>
                Rp {totalGross.toLocaleString('id-ID')}
              </p>
              <span className="text-[10px] text-slate-400">Dasar Pengenaan</span>
            </div>

            <div className="p-3 rounded-lg border border-emerald-200 bg-emerald-50/50">
              <span className="text-[11px] font-medium text-emerald-800 flex items-center gap-1.5">
                <Building2 className="w-3.5 h-3.5 text-emerald-600" />
                Total PPh 21
              </span>
              <p className="text-sm font-bold text-emerald-900 mt-1 truncate" title={`Rp ${totalPph.toLocaleString('id-ID')}`}>
                Rp {totalPph.toLocaleString('id-ID')}
              </p>
              <span className="text-[10px] text-emerald-700">Pajak Disetor</span>
            </div>
          </div>

          {/* Withholder Configuration Box */}
          <div className="p-4 rounded-lg border border-slate-200 bg-slate-50/40 space-y-3">
            <div className="flex items-center gap-2 text-xs font-bold text-slate-800 uppercase tracking-wider">
              <Building2 className="w-4 h-4 text-indigo-600" />
              Identitas Pemotong Pajak (Instansi / Universitas)
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div>
                <label className="text-[11px] font-medium text-slate-600 block mb-1">
                  NPWP Pemotong
                </label>
                <input
                  type="text"
                  inputMode="numeric"
                  maxLength={16}
                  value={withholderNpwp}
                  onChange={(e) => handleNpwpChange(e.target.value)}
                  placeholder={DEFAULT_NPWP_PEMOTONG}
                  className="w-full text-xs font-mono font-medium px-2.5 py-1.5 rounded border border-slate-300 bg-white focus:outline-none focus:ring-1 focus:ring-blue-500"
                />
              </div>

              <div>
                <label className="text-[11px] font-medium text-slate-600 block mb-1">
                  Nama Pemotong Pajak
                </label>
                <input
                  type="text"
                  value={withholderName}
                  onChange={(e) => handleNameChange(e.target.value)}
                  placeholder="Nama Universitas"
                  className="w-full text-xs font-medium px-2.5 py-1.5 rounded border border-slate-300 bg-white focus:outline-none focus:ring-1 focus:ring-blue-500"
                />
              </div>

              <div>
                <label className="text-[11px] font-medium text-slate-600 block mb-1">
                  NITKU Pemotong (22 Digit)
                </label>
                <input
                  type="text"
                  inputMode="numeric"
                  maxLength={22}
                  value={withholderNitku}
                  onChange={(e) => handleNitkuChange(e.target.value)}
                  placeholder={DEFAULT_NITKU_PEMOTONG}
                  className="w-full text-xs font-mono font-medium px-2.5 py-1.5 rounded border border-slate-300 bg-white focus:outline-none focus:ring-1 focus:ring-blue-500"
                />
              </div>
            </div>
          </div>

          {/* Scope Selector */}
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 p-3 rounded-lg border border-slate-200 bg-white">
            <div>
              <span className="text-xs font-semibold text-slate-800 block">Cakupan Data yang Diekspor</span>
              <span className="text-[11px] text-slate-500">
                Memilih pegawai yang akan disertakan dalam file ekspor BPMP
              </span>
            </div>
            <div className="inline-flex rounded-md shadow-sm border border-slate-200 p-0.5 bg-slate-50 text-xs">
              <button
                type="button"
                onClick={() => setFilterMode('all')}
                className={`px-3 py-1 font-medium rounded transition-colors ${
                  filterMode === 'all'
                    ? 'bg-white text-indigo-700 font-bold shadow-xs'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                Semua ({allRows.length})
              </button>
              <button
                type="button"
                onClick={() => setFilterMode('taxable_only')}
                className={`px-3 py-1 font-medium rounded transition-colors ${
                  filterMode === 'taxable_only'
                    ? 'bg-white text-indigo-700 font-bold shadow-xs'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                Kena Pajak Saja ({taxableEmployees})
              </button>
            </div>
          </div>

          {/* Success Banner */}
          {downloadSuccess && (
            <div className="flex items-center gap-2 p-3 rounded-lg bg-emerald-50 border border-emerald-200 text-emerald-800 text-xs">
              <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
              <span>{downloadSuccess}</span>
            </div>
          )}

          {/* Help & Guidelines Accordion / Box */}
          <div className="p-3.5 rounded-lg border border-blue-100 bg-blue-50/40 text-xs text-blue-900 space-y-1.5">
            <div className="flex items-center gap-1.5 font-bold text-blue-950">
              <HelpCircle className="w-4 h-4 text-blue-600" />
              Panduan Impor Coretax DJP:
            </div>
            <ol className="list-decimal list-inside space-y-1 text-[11px] text-blue-800 pl-1 leading-relaxed">
              <li>
                <strong>Format XML (.xml)</strong>: Siap diunggah langsung ke web <strong>Coretax DJP</strong> pada menu <em>e-Bupot 21/26 &gt; Impor Bukti Potong &gt; BPMP</em>.
              </li>
              <li>
                <strong>Format Excel (.xlsx)</strong>: Berisi lembar <strong>DATA</strong> &amp; <strong>REKAP_TER</strong> untuk arsip, rekonsiliasi akuntansi, atau DJP Excel-to-XML converter.
              </li>
              <li>
                <strong>Ketentuan PTKP Pegawai Wanita</strong>: Seluruh pegawai wanita berstatus <strong>TK/0 (Kategori A)</strong> sesuai PMK 168/2023 Pasal 9 ayat (2).
              </li>
            </ol>
          </div>
        </div>

        {/* Footer Actions */}
        <div className="px-6 py-4 bg-slate-50 border-t border-slate-200 flex flex-col sm:flex-row items-center justify-between gap-3 shrink-0">
          <Button
            type="button"
            variant="outline"
            onClick={() => onOpenChange(false)}
            className="w-full sm:w-auto text-xs font-semibold"
          >
            Tutup
          </Button>

          <div className="flex items-center gap-2.5 w-full sm:w-auto">
            <Button
              type="button"
              onClick={handleDownloadExcel}
              className="flex-1 sm:flex-none inline-flex items-center gap-2 text-xs font-semibold bg-emerald-600 hover:bg-emerald-700 text-white shadow-sm"
            >
              <FileSpreadsheet className="w-4 h-4" />
              Unduh Excel (.xlsx)
            </Button>

            <Button
              type="button"
              onClick={handleDownloadXml}
              className="flex-1 sm:flex-none inline-flex items-center gap-2 text-xs font-semibold bg-blue-600 hover:bg-blue-700 text-white shadow-sm"
            >
              <FileCode className="w-4 h-4" />
              Unduh XML Coretax (.xml)
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
