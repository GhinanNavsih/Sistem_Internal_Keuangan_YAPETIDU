'use client';

import Link from 'next/link';
import { AlertTriangle, Check, ChevronDown, ChevronUp, ExternalLink, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import type {
  SatpamAttendanceDetailEmployee,
  SatpamAttendanceDetailRow,
  SatpamAttendanceDetailStatus,
} from '@/lib/payroll/satpamAttendanceDetail';

function rupiah(value: number) {
  return new Intl.NumberFormat('id-ID', {
    style: 'currency',
    currency: 'IDR',
    maximumFractionDigits: 0,
  }).format(value);
}

const STATUS_BADGE: Record<
  SatpamAttendanceDetailStatus,
  { label: string; className: string }
> = {
  leave: { label: 'Izin Resmi', className: 'bg-emerald-50 text-emerald-700' },
  complete: { label: 'Lengkap', className: 'bg-emerald-50 text-emerald-700' },
  late: { label: 'Telat', className: 'bg-orange-50 text-orange-700' },
  partial: { label: 'Scan satu sisi', className: 'bg-amber-50 text-amber-700' },
  no_scan: { label: 'Tanpa scan', className: 'bg-amber-50 text-amber-700' },
  pending: { label: 'Menunggu review', className: 'bg-indigo-50 text-indigo-700' },
  declined: { label: 'Ditolak', className: 'bg-rose-50 text-rose-700' },
  covered: { label: 'Digantikan', className: 'bg-slate-100 text-slate-600' },
  absent: { label: 'Tidak hadir', className: 'bg-slate-100 text-slate-600' },
  upcoming: { label: 'Terjadwal', className: 'bg-slate-100 text-slate-600' },
  scan_only: { label: 'Scan tanpa laporan', className: 'bg-amber-50 text-amber-700' },
};

function ShiftTypeCell({ row }: { row: SatpamAttendanceDetailRow }) {
  return (
    <>
      <span className="block font-semibold">{row.payType || '—'}</span>
      <span className="block text-xs text-slate-500">
        {row.shiftName && row.expectedScanIn && row.expectedScanOut
          ? `${row.shiftName} · ${row.expectedScanIn}–${row.expectedScanOut}`
          : '—'}
      </span>
    </>
  );
}

export function SatpamAttendanceDetailCard({
  employee,
  index,
  expanded,
  onToggle,
  canEdit,
  working,
  reviewHref,
  canReviewAbsence,
  onApproveAbsence,
  onDeclineAbsence,
}: {
  employee: SatpamAttendanceDetailEmployee;
  index: number;
  expanded: boolean;
  onToggle: () => void;
  canEdit: boolean;
  working: boolean;
  /** Where to check the shift report behind a row, or null when none exists yet. */
  reviewHref: (row: SatpamAttendanceDetailRow) => string | null;
  /** Whether the pending request behind a row can be decided from this screen. */
  canReviewAbsence: (absenceId: string) => boolean;
  onApproveAbsence: (absenceId: string) => void;
  onDeclineAbsence: (absenceId: string, employeeName: string) => void;
}) {
  return (
    <article
      className={`border-2 rounded-md shadow-sm bg-white transition-all hover:border-indigo-300 overflow-hidden ${
        expanded
          ? 'ring-4 ring-indigo-50 border-indigo-400 bg-indigo-50/40'
          : 'border-indigo-200/80 bg-indigo-50/20'
      }`}
    >
      <div
        onClick={onToggle}
        className="p-4 flex flex-wrap lg:flex-nowrap items-center justify-between gap-4 cursor-pointer hover:bg-slate-50/20 transition-colors"
      >
        <div className="flex items-center gap-3 w-full lg:w-[280px] xl:w-[300px] shrink-0 min-w-0">
          <div className="w-8 h-8 rounded-sm bg-slate-50 border border-slate-100 flex items-center justify-center text-[10px] font-bold text-slate-500 font-mono shrink-0">
            {index + 1}
          </div>
          <div className="space-y-1 min-w-0 flex-1">
            <div className="flex items-center gap-2 flex-wrap">
              <h4
                className="font-bold text-slate-800 text-xs tracking-wide truncate max-w-full"
                title={employee.name}
              >
                {employee.name}
              </h4>
              <span className="inline-flex text-[9px] font-bold text-indigo-700 bg-indigo-50 border border-indigo-100 px-2 py-0.5 rounded-sm shrink-0">
                Satpam
              </span>
            </div>
            <div className="flex items-center gap-1 min-w-0 truncate">
              <span className="text-[9px] text-slate-400 font-mono shrink-0">
                (ID: {employee.employeeId})
              </span>
              <span className="text-[9px] text-emerald-600 font-mono shrink-0">
                NIPY {employee.nipy || 'belum diisi'}
              </span>
            </div>
          </div>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-x-2 gap-y-2 flex-1 items-center justify-items-center min-w-0">
          <div className="flex flex-col text-center w-full">
            <span className="text-[9px] font-bold text-slate-400 uppercase tracking-wider">
              Hari Aktif
            </span>
            <span className="text-xs font-bold text-slate-700 mt-0.5 font-mono">
              {employee.paidDays} hari
            </span>
          </div>

          <div className="flex flex-col text-center w-full">
            <span className="text-[9px] font-bold text-slate-400 uppercase tracking-wider">
              Hari Tidak Lengkap
            </span>
            <div className="mt-0.5 font-mono flex justify-center">
              {employee.incompleteDays > 0 ? (
                <span className="inline-flex items-center gap-1 text-[9px] text-amber-600 bg-amber-50 border border-amber-100 px-2 py-0.5 rounded-sm font-bold">
                  <AlertTriangle className="w-3 h-3 shrink-0" />
                  {employee.incompleteDays} hari
                </span>
              ) : (
                <span className="text-xs text-slate-400 font-semibold">-</span>
              )}
            </div>
          </div>

          <div className="flex flex-col text-center w-full">
            <span className="text-[9px] font-bold text-slate-400 uppercase tracking-wider">
              Lembur
            </span>
            <span className="text-xs font-bold text-slate-700 mt-0.5 font-mono">
              {rupiah(employee.lemburAmount)}
            </span>
            <span className="text-[9px] text-slate-400 font-semibold">
              {employee.lemburCount} shift
            </span>
          </div>

          <div className="flex flex-col text-center w-full">
            <span className="text-[9px] font-bold text-slate-400 uppercase tracking-wider">
              Harian
            </span>
            <span className="text-xs font-bold text-slate-700 mt-0.5 font-mono">
              {rupiah(employee.harianAmount)}
            </span>
            <span className="text-[9px] text-slate-400 font-semibold">
              {employee.harianCount} hari
            </span>
          </div>

          <div className="flex flex-col text-center w-full">
            <span className="text-[9px] font-bold text-slate-400 uppercase tracking-wider">
              Jumat &amp; Libur
            </span>
            <span className="text-xs font-bold text-slate-700 mt-0.5 font-mono">
              {rupiah(employee.jumatLiburAmount)}
            </span>
            <span className="text-[9px] text-slate-400 font-semibold">
              {employee.jumatLiburCount} hari
            </span>
          </div>

          <div className="flex flex-col text-center w-full">
            <span className="text-[9px] font-bold text-slate-400 uppercase tracking-wider">
              Total Upah Presensi
            </span>
            <span className="text-xs font-bold text-indigo-700 mt-0.5 font-mono">
              {rupiah(employee.totalAmount)}
            </span>
          </div>
        </div>

        <div className="flex items-center justify-end shrink-0 pl-1">
          {expanded ? (
            <ChevronUp className="w-4 h-4 text-slate-400" />
          ) : (
            <ChevronDown className="w-4 h-4 text-slate-400" />
          )}
        </div>
      </div>

      {expanded && (
        <div className="border-t border-slate-200 bg-white p-4">
          <p className="mb-3 text-xs text-slate-500">
            Upah Satpam dihitung dari laporan shift dan izin resmi yang
            disetujui, bukan dari scan. Scan ditampilkan sebagai bukti kehadiran.
          </p>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[700px] text-sm">
              <thead>
                <tr className="border-b text-left text-slate-500">
                  <th className="p-3">Tanggal</th>
                  <th className="p-3">Tipe Shift</th>
                  <th className="p-3">Scan Masuk</th>
                  <th className="p-3">Scan Keluar</th>
                  <th className="p-3">Upah</th>
                  <th className="p-3">Status</th>
                  {canEdit && <th className="p-3">Tindakan</th>}
                </tr>
              </thead>
              <tbody>
                {employee.days.length === 0 && (
                  <tr>
                    <td
                      colSpan={canEdit ? 7 : 6}
                      className="p-3 text-center text-slate-500"
                    >
                      Belum ada jadwal, laporan, atau scan pada periode ini.
                    </td>
                  </tr>
                )}
                {employee.days.map((row) => {
                  const badge = STATUS_BADGE[row.status];
                  const reviewable = Boolean(
                    row.pendingAbsenceId && canReviewAbsence(row.pendingAbsenceId),
                  );
                  const checkHref = reviewHref(row);
                  return (
                    <tr key={row.key} className="border-b border-slate-100">
                      <td className="p-3 font-semibold">{row.date}</td>
                      <td className="p-3">
                        <ShiftTypeCell row={row} />
                      </td>
                      <td className="p-3">{row.scanIn || '—'}</td>
                      <td className="p-3">{row.scanOut || '—'}</td>
                      <td className="p-3">
                        {row.amount > 0 ? (
                          <span className="font-semibold">{rupiah(row.amount)}</span>
                        ) : (
                          'Tidak dibayar'
                        )}
                      </td>
                      <td className="p-3">
                        <span
                          className={`inline-flex items-center gap-1 rounded-sm px-2 py-1 text-xs font-semibold ${badge.className}`}
                        >
                          {badge.label}
                        </span>
                        {row.coveredByName && (
                          <span className="block text-xs text-slate-500">
                            oleh {row.coveredByName}
                          </span>
                        )}
                        {row.pendingAbsenceId && (
                          <span className="block text-xs text-amber-700">
                            Ada pengajuan menunggu
                          </span>
                        )}
                      </td>
                      {canEdit && (
                        <td className="p-3">
                          {checkHref || reviewable ? (
                            <div className="flex flex-wrap gap-2">
                              {checkHref && (
                                <Button
                                  variant="outline"
                                  className="rounded-sm min-h-12 gap-1.5 border-amber-300 text-amber-800 hover:bg-amber-50"
                                  render={<Link href={checkHref} />}
                                >
                                  <ExternalLink className="h-3.5 w-3.5" /> Periksa
                                </Button>
                              )}
                              {reviewable && (
                                <>
                                  <Button
                                    type="button"
                                    variant="outline"
                                    disabled={working}
                                    className="rounded-sm min-h-12 gap-1.5 border-rose-200 text-rose-600 hover:bg-rose-50"
                                    onClick={() =>
                                      onDeclineAbsence(
                                        row.pendingAbsenceId as string,
                                        employee.name,
                                      )
                                    }
                                  >
                                    <X className="h-3.5 w-3.5" /> Tolak
                                  </Button>
                                  <Button
                                    type="button"
                                    disabled={working}
                                    className="rounded-sm min-h-12 gap-1.5 bg-indigo-600 hover:bg-indigo-700"
                                    onClick={() =>
                                      onApproveAbsence(row.pendingAbsenceId as string)
                                    }
                                  >
                                    <Check className="h-3.5 w-3.5" /> Setujui
                                  </Button>
                                </>
                              )}
                            </div>
                          ) : (
                            <span className="text-slate-400">—</span>
                          )}
                        </td>
                      )}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </article>
  );
}
