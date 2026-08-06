"use client";

import React from 'react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import {
  AlertCircle,
  ArrowLeft,
  ArrowRight,
  CheckCircle2,
  FileText,
  Layers,
  Link2,
  Pencil,
  Plus,
  Trash2,
} from 'lucide-react';
import {
  ExpenseReport,
  ExpenseReportType,
  ProposalExpenseRow,
  getExpenseReportDefinition,
  getExpenseReportRowCount,
  getExpenseReportTotal,
  createStableId,
} from '@/lib/payroll/proposalExpenseReports';

interface EmployeeOption {
  id: string;
  name: string;
  role?: string;
}

interface ExpenseReportStageProps {
  expenseRows: ProposalExpenseRow[];
  expenseReports: ExpenseReport[];
  employees: EmployeeOption[];
  unlocked: boolean;
  selectedReportId: string | null;
  onSelectReport: (reportId: string | null) => void;
  onOpenLink: (rowIndex: number) => void;
  onUpdateReport: (reportId: string, updater: (report: ExpenseReport) => ExpenseReport) => void;
  onPrintReport: (report: ExpenseReport) => void;
  onBackToLpj: () => void;
  fmtRp: (amount: number) => string;
  parseQty: (value: string) => number;
}

const accentClasses: Record<ExpenseReport['reportType'], { card: string; badge: string; border: string; button: string }> = {
  proposal_examiner: {
    card: 'bg-blue-50/50 border-blue-100',
    badge: 'bg-blue-100 text-blue-700 border-blue-200',
    border: 'border-blue-200',
    button: 'bg-blue-600 hover:bg-blue-700',
  },
  munaqosyah_examiner: {
    card: 'bg-indigo-50/50 border-indigo-100',
    badge: 'bg-indigo-100 text-indigo-700 border-indigo-200',
    border: 'border-indigo-200',
    button: 'bg-indigo-600 hover:bg-indigo-700',
  },
  pembimbing: {
    card: 'bg-emerald-50/50 border-emerald-100',
    badge: 'bg-emerald-100 text-emerald-700 border-emerald-200',
    border: 'border-emerald-200',
    button: 'bg-emerald-600 hover:bg-emerald-700',
  },
  pedoman_kti: {
    card: 'bg-violet-50/50 border-violet-100',
    badge: 'bg-violet-100 text-violet-700 border-violet-200',
    border: 'border-violet-200',
    button: 'bg-violet-600 hover:bg-violet-700',
  },
  committee: {
    card: 'bg-rose-50/50 border-rose-100',
    badge: 'bg-rose-100 text-rose-700 border-rose-200',
    border: 'border-rose-200',
    button: 'bg-rose-600 hover:bg-rose-700',
  },
  receipt: {
    card: 'bg-amber-50/50 border-amber-100',
    badge: 'bg-amber-100 text-amber-700 border-amber-200',
    border: 'border-amber-200',
    button: 'bg-amber-600 hover:bg-amber-700',
  },
};

const parseMoney = (value: string): number => parseInt(value.replace(/\D/g, ''), 10) || 0;

function ReportTypeBadge({ type }: { type: ExpenseReportType }) {
  const definition = getExpenseReportDefinition(type);
  const classes = accentClasses[type];
  return (
    <span className={`inline-flex items-center rounded-md border px-2 py-0.5 text-[10px] font-bold ${classes.badge}`}>
      {definition.shortLabel}
    </span>
  );
}

function EmployeeField({
  listId,
  employees,
  value,
  onChange,
}: {
  listId: string;
  employees: EmployeeOption[];
  value: string;
  onChange: (name: string, employeeId: string) => void;
}) {
  return (
    <>
      <Input
        list={listId}
        type="text"
        value={value}
        placeholder="Cari / ketik nama..."
        onChange={(event) => {
          const nextName = event.target.value;
          const match = employees.find((employee) => employee.name.toLowerCase() === nextName.toLowerCase());
          onChange(nextName, match?.id || '');
        }}
        className="h-8 rounded-lg border-slate-200 text-xs font-semibold text-slate-900"
      />
      <datalist id={listId}>
        {employees.map((employee) => (
          <option key={employee.id} value={employee.name}>{employee.role || employee.id}</option>
        ))}
      </datalist>
    </>
  );
}

function EmptyState({ onOpenLink }: { onOpenLink: () => void }) {
  return (
    <div className="rounded-2xl border border-dashed border-indigo-200 bg-indigo-50/30 p-8 text-center">
      <Link2 className="mx-auto h-8 w-8 text-indigo-300" />
      <h4 className="mt-3 text-sm font-bold text-slate-800">Belum ada laporan yang terhubung</h4>
      <p className="mx-auto mt-1 max-w-xl text-xs leading-relaxed text-slate-500">
        Hubungkan setiap pos pengeluaran ke jenis laporan yang sesuai. Setelah terhubung, rincian penerima atau bukti pembelian diisi di sini dan tetap terkait dengan pos anggarannya.
      </p>
      <Button type="button" onClick={onOpenLink} className="mt-4 h-9 rounded-xl bg-indigo-600 px-4 text-xs font-bold hover:bg-indigo-700">
        <Link2 className="mr-1.5 h-3.5 w-3.5" /> Hubungkan Pos Pengeluaran
      </Button>
    </div>
  );
}

export default function ExpenseReportStage({
  expenseRows,
  expenseReports,
  employees,
  unlocked,
  selectedReportId,
  onSelectReport,
  onOpenLink,
  onUpdateReport,
  onPrintReport,
  onBackToLpj,
  fmtRp,
  parseQty,
}: ExpenseReportStageProps) {
  const visibleExpenseRows = expenseRows
    .map((row, index) => ({ row, index }))
    .filter(({ row }) => row.uraian.trim());

  const getRowBudget = (row: ProposalExpenseRow, index: number): number => {
    if (row.type === 'item') return parseQty(row.rincianQty) * (row.rincianRate || 0);
    let total = 0;
    for (let cursor = index + 1; cursor < expenseRows.length; cursor += 1) {
      if (expenseRows[cursor].type === 'group_header') break;
      total += parseQty(expenseRows[cursor].rincianQty) * (expenseRows[cursor].rincianRate || 0);
    }
    return total;
  };

  const updateReport = (report: ExpenseReport, updater: (current: ExpenseReport) => ExpenseReport) => {
    onUpdateReport(report.id, updater);
  };

  const selectedReport = expenseReports.find((report) => report.id === selectedReportId) || null;
  const selectedDefinition = selectedReport ? getExpenseReportDefinition(selectedReport.reportType) : null;
  const selectedAccent = selectedReport ? accentClasses[selectedReport.reportType] : null;

  const reportStatus = (report: ExpenseReport) => {
    const hasData = (() => {
      if (report.reportType === 'proposal_examiner' || report.reportType === 'munaqosyah_examiner') {
        return report.examinerRows.some((row) => row.employeeName.trim() || row.studentCount > 0);
      }
      if (report.reportType === 'pembimbing') {
        return report.pembimbingRows.some((row) => row.employeeName.trim() || row.studentCount > 0);
      }
      if (report.reportType === 'pedoman_kti') {
        return report.pedomanRows.some((row) => row.employeeName.trim() || row.task.trim() || row.amount > 0);
      }
      if (report.reportType === 'committee') {
        return report.committeeRows.some((row) => row.employeeName.trim() || row.amount > 0);
      }
      return report.receiptRows.some((row) => row.itemName.trim() || row.unitPrice > 0);
    })();
    return hasData ? 'Draft terisi' : 'Belum diisi';
  };

  const renderExaminerTable = (report: ExpenseReport) => (
    <div className="overflow-x-auto rounded-2xl border border-slate-150">
      <table className="w-full min-w-[820px] border-collapse text-left">
        <thead>
          <tr className="border-b border-slate-100 bg-slate-50">
            <th className="w-10 px-3 py-2.5 text-center text-[10px] font-bold uppercase text-slate-500">No</th>
            <th className="min-w-[230px] px-3 py-2.5 text-[10px] font-bold uppercase text-slate-500">Nama</th>
            <th className="w-[170px] px-3 py-2.5 text-[10px] font-bold uppercase text-slate-500">Peran</th>
            <th className="w-[110px] px-3 py-2.5 text-center text-[10px] font-bold uppercase text-slate-500">Mhs</th>
            <th className="w-[150px] px-3 py-2.5 text-right text-[10px] font-bold uppercase text-slate-500">Vakasi</th>
            <th className="w-[160px] px-3 py-2.5 text-right text-[10px] font-bold uppercase text-slate-500">Jumlah</th>
            <th className="w-10 px-2" />
          </tr>
        </thead>
        <tbody>
          {report.examinerRows.map((row, index) => (
            <tr key={row.id} className="border-b border-slate-50 hover:bg-slate-50/30">
              <td className="px-3 py-2 text-center text-xs font-bold text-slate-400">{index + 1}</td>
              <td className="px-3 py-2">
                <EmployeeField
                  listId={`employees-${report.id}`}
                  employees={employees}
                  value={row.employeeName}
                  onChange={(employeeName, employeeId) => updateReport(report, (current) => ({
                    ...current,
                    examinerRows: current.examinerRows.map((item) => item.id === row.id ? { ...item, employeeName, employeeId } : item),
                  }))}
                />
              </td>
              <td className="px-3 py-2">
                <Input type="text" value={row.role} onChange={(event) => updateReport(report, (current) => ({
                  ...current,
                  examinerRows: current.examinerRows.map((item) => item.id === row.id ? { ...item, role: event.target.value } : item),
                }))} className="h-8 rounded-lg border-slate-200 text-xs font-semibold" />
              </td>
              <td className="px-3 py-2">
                <Input type="number" min={0} value={row.studentCount || ''} onChange={(event) => updateReport(report, (current) => ({
                  ...current,
                  examinerRows: current.examinerRows.map((item) => item.id === row.id ? { ...item, studentCount: parseInt(event.target.value, 10) || 0 } : item),
                }))} className="h-8 rounded-lg border-slate-200 text-center text-xs font-bold" />
              </td>
              <td className="px-3 py-2">
                <Input type="text" inputMode="numeric" value={row.rate > 0 ? fmtRp(row.rate) : ''} onChange={(event) => updateReport(report, (current) => ({
                  ...current,
                  examinerRows: current.examinerRows.map((item) => item.id === row.id ? { ...item, rate: parseMoney(event.target.value) } : item),
                }))} className="h-8 rounded-lg border-slate-200 text-right text-xs font-bold" />
              </td>
              <td className="px-3 py-2 text-right font-mono text-xs font-black text-slate-800">{fmtRp(row.studentCount * row.rate)}</td>
              <td className="px-2 py-2 text-center">
                <Button type="button" variant="ghost" size="icon-xs" onClick={() => updateReport(report, (current) => ({ ...current, examinerRows: current.examinerRows.filter((item) => item.id !== row.id) }))} className="text-rose-400 hover:bg-rose-50 hover:text-rose-600">
                  <Trash2 />
                </Button>
              </td>
            </tr>
          ))}
          <tr>
            <td colSpan={5} className="px-3 py-2.5">
              <Button type="button" size="sm" onClick={() => updateReport(report, (current) => ({
                ...current,
                examinerRows: [...current.examinerRows, {
                  id: createStableId('examiner-row'), employeeId: '', employeeName: '', role: report.reportType === 'munaqosyah_examiner' ? 'Sekretaris' : 'Penguji', studentCount: 0, rate: 0,
                }],
              }))} className={`rounded-xl px-3 text-xs font-bold text-white ${selectedAccent?.button || 'bg-indigo-600 hover:bg-indigo-700'}`}>
                <Plus className="mr-1 h-3.5 w-3.5" /> Tambah Penguji
              </Button>
            </td>
            <td colSpan={2} className="px-3 py-2.5 text-right text-xs font-black text-slate-900">Total {fmtRp(getExpenseReportTotal(report))}</td>
          </tr>
        </tbody>
      </table>
    </div>
  );

  const renderPembimbingTable = (report: ExpenseReport) => (
    <div className="overflow-x-auto rounded-2xl border border-slate-150">
      <table className="w-full min-w-[820px] border-collapse text-left">
        <thead>
          <tr className="border-b border-slate-100 bg-slate-50">
            <th className="w-10 px-3 py-2.5 text-center text-[10px] font-bold uppercase text-slate-500">No</th>
            <th className="min-w-[260px] px-3 py-2.5 text-[10px] font-bold uppercase text-slate-500">Nama</th>
            <th className="w-[170px] px-3 py-2.5 text-[10px] font-bold uppercase text-slate-500">Peran</th>
            <th className="w-[110px] px-3 py-2.5 text-center text-[10px] font-bold uppercase text-slate-500">Mhs</th>
            <th className="w-[150px] px-3 py-2.5 text-right text-[10px] font-bold uppercase text-slate-500">Vakasi</th>
            <th className="w-[160px] px-3 py-2.5 text-right text-[10px] font-bold uppercase text-slate-500">Jumlah</th>
            <th className="w-10 px-2" />
          </tr>
        </thead>
        <tbody>
          {report.pembimbingRows.map((row, index) => (
            <tr key={row.id} className="border-b border-slate-50 hover:bg-slate-50/30">
              <td className="px-3 py-2 text-center text-xs font-bold text-slate-400">{index + 1}</td>
              <td className="px-3 py-2">
                <EmployeeField
                  listId={`employees-${report.id}`}
                  employees={employees}
                  value={row.employeeName}
                  onChange={(employeeName, employeeId) => updateReport(report, (current) => ({
                    ...current,
                    pembimbingRows: current.pembimbingRows.map((item) => item.id === row.id ? { ...item, employeeName, employeeId } : item),
                  }))}
                />
              </td>
              <td className="px-3 py-2"><Input type="text" value={row.role} onChange={(event) => updateReport(report, (current) => ({ ...current, pembimbingRows: current.pembimbingRows.map((item) => item.id === row.id ? { ...item, role: event.target.value } : item) }))} className="h-8 rounded-lg border-slate-200 text-xs font-semibold" /></td>
              <td className="px-3 py-2"><Input type="number" min={0} value={row.studentCount || ''} onChange={(event) => updateReport(report, (current) => ({ ...current, pembimbingRows: current.pembimbingRows.map((item) => item.id === row.id ? { ...item, studentCount: parseInt(event.target.value, 10) || 0 } : item) }))} className="h-8 rounded-lg border-slate-200 text-center text-xs font-bold" /></td>
              <td className="px-3 py-2"><Input type="text" inputMode="numeric" value={row.rate > 0 ? fmtRp(row.rate) : ''} onChange={(event) => updateReport(report, (current) => ({ ...current, pembimbingRows: current.pembimbingRows.map((item) => item.id === row.id ? { ...item, rate: parseMoney(event.target.value) } : item) }))} className="h-8 rounded-lg border-slate-200 text-right text-xs font-bold" /></td>
              <td className="px-3 py-2 text-right font-mono text-xs font-black text-slate-800">{fmtRp(row.studentCount * row.rate)}</td>
              <td className="px-2 py-2 text-center"><Button type="button" variant="ghost" size="icon-xs" onClick={() => updateReport(report, (current) => ({ ...current, pembimbingRows: current.pembimbingRows.filter((item) => item.id !== row.id) }))} className="text-rose-400 hover:bg-rose-50 hover:text-rose-600"><Trash2 /></Button></td>
            </tr>
          ))}
          <tr>
            <td colSpan={5} className="px-3 py-2.5"><Button type="button" size="sm" onClick={() => updateReport(report, (current) => ({ ...current, pembimbingRows: [...current.pembimbingRows, { id: createStableId('pembimbing-row'), employeeId: '', employeeName: '', role: 'Pembimbing', studentCount: 0, rate: 0 }] }))} className={`rounded-xl px-3 text-xs font-bold text-white ${selectedAccent?.button || 'bg-emerald-600 hover:bg-emerald-700'}`}><Plus className="mr-1 h-3.5 w-3.5" /> Tambah Pembimbing</Button></td>
            <td colSpan={2} className="px-3 py-2.5 text-right text-xs font-black text-slate-900">Total {fmtRp(getExpenseReportTotal(report))}</td>
          </tr>
        </tbody>
      </table>
    </div>
  );

  const renderPedomanTable = (report: ExpenseReport) => (
    <div className="overflow-x-auto rounded-2xl border border-slate-150">
      <table className="w-full min-w-[760px] border-collapse text-left">
        <thead><tr className="border-b border-slate-100 bg-slate-50">
          <th className="w-10 px-3 py-2.5 text-center text-[10px] font-bold uppercase text-slate-500">No</th>
          <th className="min-w-[280px] px-3 py-2.5 text-[10px] font-bold uppercase text-slate-500">Nama</th>
          <th className="min-w-[220px] px-3 py-2.5 text-[10px] font-bold uppercase text-slate-500">Tugas</th>
          <th className="w-[180px] px-3 py-2.5 text-right text-[10px] font-bold uppercase text-slate-500">Jumlah</th>
          <th className="w-10 px-2" />
        </tr></thead>
        <tbody>
          {report.pedomanRows.map((row, index) => (
            <tr key={row.id} className="border-b border-slate-50 hover:bg-slate-50/30">
              <td className="px-3 py-2 text-center text-xs font-bold text-slate-400">{index + 1}</td>
              <td className="px-3 py-2"><EmployeeField listId={`employees-${report.id}`} employees={employees} value={row.employeeName} onChange={(employeeName, employeeId) => updateReport(report, (current) => ({ ...current, pedomanRows: current.pedomanRows.map((item) => item.id === row.id ? { ...item, employeeName, employeeId } : item) }))} /></td>
              <td className="px-3 py-2"><Input type="text" value={row.task} placeholder="Penanggung Jawab / Ketua / Anggota" onChange={(event) => updateReport(report, (current) => ({ ...current, pedomanRows: current.pedomanRows.map((item) => item.id === row.id ? { ...item, task: event.target.value } : item) }))} className="h-8 rounded-lg border-slate-200 text-xs font-semibold" /></td>
              <td className="px-3 py-2"><Input type="text" inputMode="numeric" value={row.amount > 0 ? fmtRp(row.amount) : ''} onChange={(event) => updateReport(report, (current) => ({ ...current, pedomanRows: current.pedomanRows.map((item) => item.id === row.id ? { ...item, amount: parseMoney(event.target.value) } : item) }))} className="h-8 rounded-lg border-slate-200 text-right text-xs font-bold" /></td>
              <td className="px-2 py-2 text-center"><Button type="button" variant="ghost" size="icon-xs" onClick={() => updateReport(report, (current) => ({ ...current, pedomanRows: current.pedomanRows.filter((item) => item.id !== row.id) }))} className="text-rose-400 hover:bg-rose-50 hover:text-rose-600"><Trash2 /></Button></td>
            </tr>
          ))}
          <tr><td colSpan={3} className="px-3 py-2.5"><Button type="button" size="sm" onClick={() => updateReport(report, (current) => ({ ...current, pedomanRows: [...current.pedomanRows, { id: createStableId('pedoman-row'), employeeId: '', employeeName: '', task: '', amount: 0 }] }))} className={`rounded-xl px-3 text-xs font-bold text-white ${selectedAccent?.button || 'bg-violet-600 hover:bg-violet-700'}`}><Plus className="mr-1 h-3.5 w-3.5" /> Tambah Penyusun</Button></td><td className="px-3 py-2.5 text-right text-xs font-black text-slate-900">Total {fmtRp(getExpenseReportTotal(report))}</td><td /></tr>
        </tbody>
      </table>
    </div>
  );

  const renderCommitteeTable = (report: ExpenseReport) => (
    <div className="overflow-x-auto rounded-2xl border border-slate-150">
      <table className="w-full min-w-[620px] border-collapse text-left">
        <thead><tr className="border-b border-slate-100 bg-slate-50">
          <th className="w-10 px-3 py-2.5 text-center text-[10px] font-bold uppercase text-slate-500">No</th>
          <th className="min-w-[330px] px-3 py-2.5 text-[10px] font-bold uppercase text-slate-500">Nama</th>
          <th className="w-[190px] px-3 py-2.5 text-right text-[10px] font-bold uppercase text-slate-500">Jumlah</th>
          <th className="w-10 px-2" />
        </tr></thead>
        <tbody>
          {report.committeeRows.map((row, index) => (
            <tr key={row.id} className="border-b border-slate-50 hover:bg-slate-50/30">
              <td className="px-3 py-2 text-center text-xs font-bold text-slate-400">{index + 1}</td>
              <td className="px-3 py-2"><EmployeeField listId={`employees-${report.id}`} employees={employees} value={row.employeeName} onChange={(employeeName, employeeId) => updateReport(report, (current) => ({ ...current, committeeRows: current.committeeRows.map((item) => item.id === row.id ? { ...item, employeeName, employeeId } : item) }))} /></td>
              <td className="px-3 py-2"><Input type="text" inputMode="numeric" value={row.amount > 0 ? fmtRp(row.amount) : ''} onChange={(event) => updateReport(report, (current) => ({ ...current, committeeRows: current.committeeRows.map((item) => item.id === row.id ? { ...item, amount: parseMoney(event.target.value) } : item) }))} className="h-8 rounded-lg border-slate-200 text-right text-xs font-bold" /></td>
              <td className="px-2 py-2 text-center"><Button type="button" variant="ghost" size="icon-xs" onClick={() => updateReport(report, (current) => ({ ...current, committeeRows: current.committeeRows.filter((item) => item.id !== row.id) }))} className="text-rose-400 hover:bg-rose-50 hover:text-rose-600"><Trash2 /></Button></td>
            </tr>
          ))}
          <tr><td colSpan={2} className="px-3 py-2.5"><Button type="button" size="sm" onClick={() => updateReport(report, (current) => ({ ...current, committeeRows: [...current.committeeRows, { id: createStableId('committee-row'), employeeId: '', employeeName: '', amount: 0 }] }))} className={`rounded-xl px-3 text-xs font-bold text-white ${selectedAccent?.button || 'bg-rose-600 hover:bg-rose-700'}`}><Plus className="mr-1 h-3.5 w-3.5" /> Tambah Panitia</Button></td><td className="px-3 py-2.5 text-right text-xs font-black text-slate-900">Total {fmtRp(getExpenseReportTotal(report))}</td><td /></tr>
        </tbody>
      </table>
    </div>
  );

  const renderReceiptTable = (report: ExpenseReport) => (
    <div className="overflow-x-auto rounded-2xl border border-slate-150">
      <table className="w-full min-w-[820px] border-collapse text-left">
        <thead><tr className="border-b border-slate-100 bg-slate-50">
          <th className="w-10 px-3 py-2.5 text-center text-[10px] font-bold uppercase text-slate-500">No</th>
          <th className="min-w-[280px] px-3 py-2.5 text-[10px] font-bold uppercase text-slate-500">Nama Item / Bukti</th>
          <th className="w-[90px] px-3 py-2.5 text-center text-[10px] font-bold uppercase text-slate-500">Qty</th>
          <th className="w-[170px] px-3 py-2.5 text-right text-[10px] font-bold uppercase text-slate-500">Harga Satuan</th>
          <th className="w-[170px] px-3 py-2.5 text-right text-[10px] font-bold uppercase text-slate-500">Total</th>
          <th className="min-w-[170px] px-3 py-2.5 text-[10px] font-bold uppercase text-slate-500">Keterangan</th>
          <th className="w-10 px-2" />
        </tr></thead>
        <tbody>
          {report.receiptRows.map((row, index) => (
            <tr key={row.id} className="border-b border-slate-50 hover:bg-slate-50/30">
              <td className="px-3 py-2 text-center text-xs font-bold text-slate-400">{index + 1}</td>
              <td className="px-3 py-2"><Input type="text" value={row.itemName} placeholder="Konsumsi / ATK / Nota..." onChange={(event) => updateReport(report, (current) => ({ ...current, receiptRows: current.receiptRows.map((item) => item.id === row.id ? { ...item, itemName: event.target.value } : item) }))} className="h-8 rounded-lg border-slate-200 text-xs font-semibold" /></td>
              <td className="px-3 py-2"><Input type="number" min={1} value={row.qty || ''} onChange={(event) => updateReport(report, (current) => ({ ...current, receiptRows: current.receiptRows.map((item) => item.id === row.id ? { ...item, qty: parseInt(event.target.value, 10) || 1 } : item) }))} className="h-8 rounded-lg border-slate-200 text-center text-xs font-bold" /></td>
              <td className="px-3 py-2"><Input type="text" inputMode="numeric" value={row.unitPrice > 0 ? fmtRp(row.unitPrice) : ''} onChange={(event) => updateReport(report, (current) => ({ ...current, receiptRows: current.receiptRows.map((item) => item.id === row.id ? { ...item, unitPrice: parseMoney(event.target.value) } : item) }))} className="h-8 rounded-lg border-slate-200 text-right text-xs font-bold" /></td>
              <td className="px-3 py-2 text-right font-mono text-xs font-black text-slate-800">{fmtRp(row.qty * row.unitPrice)}</td>
              <td className="px-3 py-2"><Input type="text" value={row.note} placeholder="No. nota / tanggal..." onChange={(event) => updateReport(report, (current) => ({ ...current, receiptRows: current.receiptRows.map((item) => item.id === row.id ? { ...item, note: event.target.value } : item) }))} className="h-8 rounded-lg border-slate-200 text-xs" /></td>
              <td className="px-2 py-2 text-center"><Button type="button" variant="ghost" size="icon-xs" onClick={() => updateReport(report, (current) => ({ ...current, receiptRows: current.receiptRows.filter((item) => item.id !== row.id) }))} className="text-rose-400 hover:bg-rose-50 hover:text-rose-600"><Trash2 /></Button></td>
            </tr>
          ))}
          <tr><td colSpan={4} className="px-3 py-2.5"><Button type="button" size="sm" onClick={() => updateReport(report, (current) => ({ ...current, receiptRows: [...current.receiptRows, { id: createStableId('receipt-row'), itemName: '', qty: 1, unitPrice: 0, note: '' }] }))} className={`rounded-xl px-3 text-xs font-bold text-white ${selectedAccent?.button || 'bg-amber-600 hover:bg-amber-700'}`}><Plus className="mr-1 h-3.5 w-3.5" /> Tambah Item</Button></td><td colSpan={2} className="px-3 py-2.5 text-right text-xs font-black text-slate-900">Total {fmtRp(getExpenseReportTotal(report))}</td><td /></tr>
        </tbody>
      </table>
    </div>
  );

  const renderReportEditor = () => {
    if (!selectedReport || !selectedDefinition || !selectedAccent) return null;

    return (
      <Card className={`rounded-2xl border p-0 shadow-sm ${selectedAccent.border}`}>
        <div className={`flex flex-wrap items-start justify-between gap-3 border-b p-4 ${selectedAccent.card}`}>
          <div className="min-w-0">
            <div className="mb-1 flex flex-wrap items-center gap-2">
              <ReportTypeBadge type={selectedReport.reportType} />
              <span className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">Terhubung ke pos pengeluaran</span>
            </div>
            <h3 className="text-sm font-black uppercase text-slate-900">{selectedReport.expenseLabel}</h3>
            <p className="mt-1 text-xs text-slate-500">Format data mengikuti {selectedDefinition.sourceDocument}.</p>
          </div>
          <div className="flex items-center gap-2">
            <Button type="button" variant="outline" size="sm" onClick={() => onPrintReport(selectedReport)} className="h-8 rounded-lg border-slate-200 bg-white/80 px-2.5 text-[11px] font-bold text-indigo-700 hover:bg-white">
              <FileText className="mr-1 h-3.5 w-3.5" /> Cetak PDF
            </Button>
            <div className="rounded-xl border border-white/70 bg-white/70 px-3 py-2 text-right">
              <span className="block text-[10px] font-bold uppercase tracking-wider text-slate-400">Total laporan</span>
              <span className="font-mono text-base font-black text-slate-900">{fmtRp(getExpenseReportTotal(selectedReport))}</span>
            </div>
          </div>
        </div>

        <div className="space-y-4 p-4 md:p-5">
          <div className="grid grid-cols-1 gap-4 md:grid-cols-[1fr_240px]">
            <div>
              <label className="mb-1.5 block text-[10px] font-bold uppercase tracking-wider text-slate-500">Judul laporan</label>
              <Input type="text" value={selectedReport.title} onChange={(event) => updateReport(selectedReport, (current) => ({ ...current, title: event.target.value }))} className="h-10 rounded-xl border-slate-200 text-xs font-bold uppercase text-slate-900" />
            </div>
            <div className="rounded-xl border border-slate-100 bg-slate-50/70 px-3 py-2">
              <span className="block text-[10px] font-bold uppercase tracking-wider text-slate-400">Anggaran terhubung</span>
              <span className="font-mono text-sm font-black text-slate-800">{fmtRp(getRowBudget(expenseRows.find((row) => row.rowId === selectedReport.expenseRowId) || { type: 'item', uraian: '', rincianQty: '', rincianRate: 0 }, expenseRows.findIndex((row) => row.rowId === selectedReport.expenseRowId)))}</span>
            </div>
          </div>

          {selectedReport.reportType === 'proposal_examiner' || selectedReport.reportType === 'munaqosyah_examiner'
            ? renderExaminerTable(selectedReport)
            : selectedReport.reportType === 'pembimbing'
              ? renderPembimbingTable(selectedReport)
              : selectedReport.reportType === 'pedoman_kti'
                ? renderPedomanTable(selectedReport)
                : selectedReport.reportType === 'committee'
                  ? renderCommitteeTable(selectedReport)
                  : renderReceiptTable(selectedReport)}

          <div>
            <label className="mb-1.5 block text-[10px] font-bold uppercase tracking-wider text-slate-500">Catatan laporan / referensi bukti</label>
            <textarea value={selectedReport.notes} onChange={(event) => updateReport(selectedReport, (current) => ({ ...current, notes: event.target.value }))} placeholder="Contoh: bukti pembayaran disimpan pada berkas LPJ halaman 1-18..." className="min-h-20 w-full rounded-xl border border-slate-200 p-3 text-xs font-medium text-slate-800 outline-none focus:border-indigo-300 focus:ring-3 focus:ring-indigo-100" />
          </div>
        </div>
      </Card>
    );
  };

  if (!unlocked) {
    return (
      <div className="space-y-5 animate-in fade-in duration-300">
        <div className="rounded-2xl border border-amber-200/80 bg-amber-50/60 p-8 text-center">
          <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-amber-100 text-amber-700">
            <Link2 className="h-6 w-6" />
          </div>
          <h3 className="mt-3 text-sm font-bold text-slate-800">Rincian laporan masih terkunci</h3>
          <p className="mx-auto mt-1 max-w-xl text-xs leading-relaxed text-slate-500">Setujui proposal anggaran terlebih dahulu. Setelah itu setiap pos pengeluaran dapat dihubungkan ke laporan vakasi atau kwitansi yang sesuai.</p>
          <Button type="button" onClick={onBackToLpj} variant="outline" className="mt-4 h-9 rounded-xl border-amber-300 px-4 text-xs font-bold text-amber-800 hover:bg-amber-100"><ArrowLeft className="mr-1.5 h-4 w-4" /> Kembali ke Realisasi</Button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6 animate-in fade-in duration-300">
      <div className="rounded-2xl border border-indigo-100 bg-gradient-to-br from-indigo-50/80 via-white to-slate-50 p-5 md:p-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="flex items-start gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-indigo-600 text-white shadow-sm"><FileText className="h-5 w-5" /></div>
            <div>
              <h3 className="text-base font-black text-slate-900">Rincian Laporan per Pos Pengeluaran</h3>
              <p className="mt-1 max-w-2xl text-xs leading-relaxed text-slate-500">Hubungkan pos utama pada anggaran dengan format laporan akhirnya. Satu pos memiliki satu laporan utama, sehingga nominal laporan dapat ditelusuri kembali ke anggaran dan realisasi.</p>
            </div>
          </div>
          <div className="flex items-center gap-2 rounded-xl border border-indigo-100 bg-white px-3 py-2 text-xs font-bold text-indigo-700">
            <CheckCircle2 className="h-4 w-4" /> {expenseReports.length} laporan terhubung
          </div>
        </div>
        <div className="mt-4 grid grid-cols-2 gap-3 md:grid-cols-4">
          <div className="rounded-xl border border-slate-100 bg-white p-3"><span className="block text-[10px] font-bold uppercase tracking-wider text-slate-400">Pos pengeluaran</span><span className="mt-1 block text-lg font-black text-slate-900">{visibleExpenseRows.length}</span></div>
          <div className="rounded-xl border border-slate-100 bg-white p-3"><span className="block text-[10px] font-bold uppercase tracking-wider text-slate-400">Sudah terhubung</span><span className="mt-1 block text-lg font-black text-indigo-700">{visibleExpenseRows.filter(({ row }) => row.reportId).length}</span></div>
          <div className="rounded-xl border border-slate-100 bg-white p-3"><span className="block text-[10px] font-bold uppercase tracking-wider text-slate-400">Total anggaran</span><span className="mt-1 block font-mono text-sm font-black text-slate-900">{fmtRp(visibleExpenseRows.reduce((sum, { row, index }) => sum + getRowBudget(row, index), 0))}</span></div>
          <div className="rounded-xl border border-slate-100 bg-white p-3"><span className="block text-[10px] font-bold uppercase tracking-wider text-slate-400">Total laporan</span><span className="mt-1 block font-mono text-sm font-black text-emerald-700">{fmtRp(expenseReports.reduce((sum, report) => sum + getExpenseReportTotal(report), 0))}</span></div>
        </div>
      </div>

      {visibleExpenseRows.length === 0 ? (
        <EmptyState onOpenLink={() => onOpenLink(0)} />
      ) : (
        <div className="space-y-3">
          <div className="flex items-center justify-between gap-3">
            <div><h4 className="text-xs font-black uppercase tracking-wider text-slate-700">Pemetaan Pos & Laporan</h4><p className="mt-0.5 text-[11px] text-slate-400">Gunakan Hubungkan Laporan pada setiap pos yang memerlukan rincian.</p></div>
            <div className="hidden items-center gap-1.5 text-[10px] font-semibold text-slate-400 md:flex"><Layers className="h-3.5 w-3.5" /> Sumber dari tabel pengeluaran</div>
          </div>
          <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
            {visibleExpenseRows.map(({ row, index }) => {
              const report = expenseReports.find((item) => item.id === row.reportId);
              const definition = report ? getExpenseReportDefinition(report.reportType) : null;
              const classes = report ? accentClasses[report.reportType] : null;
              return (
                <div key={row.rowId || `${row.type}-${index}`} className={`rounded-2xl border p-4 transition-all ${classes?.card || 'border-slate-150 bg-white'} ${selectedReportId === report?.id ? 'ring-2 ring-indigo-200' : ''}`}>
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="rounded-md bg-white/80 px-2 py-0.5 text-[10px] font-black uppercase tracking-wider text-slate-400">{row.type === 'group_header' ? 'Pos Utama' : 'Rincian'}</span>
                        {definition && <ReportTypeBadge type={report!.reportType} />}
                      </div>
                      <h5 className="mt-2 line-clamp-2 text-sm font-black text-slate-900">{row.uraian}</h5>
                      <p className="mt-1 text-[11px] font-medium text-slate-500">Anggaran tersambung: <span className="font-mono font-bold text-slate-700">{fmtRp(getRowBudget(row, index))}</span></p>
                    </div>
                    <div className="shrink-0 text-right">
                      {report ? <span className={`inline-flex items-center gap-1 text-[10px] font-bold ${reportStatus(report) === 'Draft terisi' ? 'text-emerald-700' : 'text-amber-700'}`}><CheckCircle2 className="h-3.5 w-3.5" /> {reportStatus(report)}</span> : <span className="inline-flex items-center gap-1 text-[10px] font-bold text-slate-400"><AlertCircle className="h-3.5 w-3.5" /> Belum terhubung</span>}
                    </div>
                  </div>
                  <div className="mt-4 flex flex-wrap items-center justify-between gap-2 border-t border-white/70 pt-3">
                    {report ? <span className="text-[11px] font-semibold text-slate-500">Total rincian: <span className="font-mono font-black text-slate-800">{fmtRp(getExpenseReportTotal(report))}</span> · {getExpenseReportRowCount(report)} baris</span> : <span className="text-[11px] font-medium text-slate-400">Belum ada format laporan yang dipilih</span>}
                    <div className="flex items-center gap-2">
                      <Button type="button" variant="outline" size="sm" onClick={() => onOpenLink(index)} className="h-8 rounded-lg border-slate-200 px-2.5 text-[11px] font-bold text-slate-700 hover:border-indigo-200 hover:bg-indigo-50 hover:text-indigo-700"><Pencil className="mr-1 h-3.5 w-3.5" /> {report ? 'Ganti' : 'Hubungkan Laporan'}</Button>
                      {report && <Button type="button" size="sm" onClick={() => onSelectReport(report.id)} className={`h-8 rounded-lg px-2.5 text-[11px] font-bold text-white ${classes?.button || 'bg-indigo-600 hover:bg-indigo-700'}`}>Buka Laporan <ArrowRight className="ml-1 h-3.5 w-3.5" /></Button>}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {selectedReport ? renderReportEditor() : expenseReports.length > 0 ? (
        <div className="rounded-2xl border border-slate-150 bg-white p-6 text-center text-xs text-slate-400">Pilih <span className="font-bold text-indigo-600">Buka Laporan</span> pada salah satu pos untuk mengisi rincian.</div>
      ) : null}
    </div>
  );
}
