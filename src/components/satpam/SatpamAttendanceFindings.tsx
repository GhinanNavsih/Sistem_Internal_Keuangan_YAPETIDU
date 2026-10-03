'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { AlertTriangle, ExternalLink } from 'lucide-react';
import { Button } from '@/components/ui/button';
import type { SatpamAttendanceDetailEmployee } from '@/lib/payroll/satpamAttendanceDetail';
import {
  collectSatpamFindings,
  SATPAM_FINDING_LABELS,
  type SatpamFinding,
  type SatpamFindingKind,
} from '@/lib/payroll/satpamAttendanceFindings';

type Filter = 'all' | SatpamFindingKind;

const FILTERS: Filter[] = [
  'all',
  'report_without_scan',
  'scan_without_report',
  'one_sided_scan',
  'leave_conflict',
  'identity',
];

const KIND_BADGE: Record<SatpamFindingKind, string> = {
  report_without_scan: 'bg-amber-50 text-amber-700',
  scan_without_report: 'bg-amber-50 text-amber-700',
  one_sided_scan: 'bg-amber-50 text-amber-700',
  leave_conflict: 'bg-rose-50 text-rose-700',
  identity: 'bg-rose-50 text-rose-700',
};

/**
 * Every Satpam attendance discrepancy of the period in one list: a shift
 * report with no scan behind it, a scan with no report, a one-sided scan, a
 * leave that a work report or scan still contradicts, and a NIPY that cannot be
 * matched. They explain nothing about pay — Satpam are paid from approved shift
 * reports and approved leave — they are what to check before trusting it.
 */
export function SatpamAttendanceFindings({
  employees,
  attendanceImported,
  reviewHref,
}: {
  employees: readonly SatpamAttendanceDetailEmployee[];
  /** False while the monthly attendance file has not been imported. */
  attendanceImported: boolean;
  /** Where to check the shift report behind a finding, or null. */
  reviewHref: (finding: SatpamFinding) => string | null;
}) {
  const [filter, setFilter] = useState<Filter>('all');
  const findings = useMemo(() => collectSatpamFindings(employees), [employees]);
  const counts = useMemo(() => {
    const result: Record<Filter, number> = {
      all: findings.length,
      report_without_scan: 0,
      scan_without_report: 0,
      one_sided_scan: 0,
      leave_conflict: 0,
      identity: 0,
    };
    for (const finding of findings) result[finding.kind] += 1;
    return result;
  }, [findings]);
  const visible = useMemo(
    () =>
      filter === 'all'
        ? findings
        : findings.filter((finding) => finding.kind === filter),
    [findings, filter],
  );

  return (
    <section className="overflow-hidden rounded-md border border-slate-200 bg-white shadow-sm">
      <div className="flex flex-col gap-3 border-b border-slate-200 p-5 lg:flex-row lg:items-center lg:justify-between">
        <div>
          <h2 className="font-bold">Temuan Presensi Satpam</h2>
          <p className="text-sm text-slate-500">
            {findings.length} temuan · tidak memengaruhi upah, hanya untuk
            diperiksa
          </p>
        </div>
        <div className="flex flex-wrap gap-1 rounded-md bg-slate-100/80 p-1 text-xs font-semibold">
          {FILTERS.map((value) => (
            <button
              key={value}
              type="button"
              onClick={() => setFilter(value)}
              className={`flex items-center gap-1.5 rounded-sm px-2.5 py-1.5 transition-all ${
                filter === value
                  ? 'bg-white text-slate-800 shadow-sm'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              {value === 'all' ? 'Semua' : SATPAM_FINDING_LABELS[value]}
              <span className="text-[10px] font-bold text-slate-400">
                ({counts[value]})
              </span>
            </button>
          ))}
        </div>
      </div>

      {!attendanceImported && (
        <div className="flex items-start gap-2 border-b border-amber-100 bg-amber-50 p-4 text-sm text-amber-900">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <p>
            Presensi bulanan periode ini belum diimpor, jadi belum ada data scan
            untuk dicocokkan.
            {findings.length === 0
              ? ' Angka 0 di atas belum berarti aman — periksa ulang setelah presensi bulanan diimpor.'
              : ' Temuan di bawah baru berdasarkan laporan dan koreksi yang sudah masuk.'}
          </p>
        </div>
      )}

      {visible.length === 0 ? (
        <div className="p-8 text-center text-slate-500">
          Tidak ada perbedaan yang ditemukan.
        </div>
      ) : (
        <div className="max-h-[36rem] overflow-auto">
          <table className="w-full min-w-[760px] text-sm">
            <thead className="sticky top-0 z-10 bg-slate-50">
              <tr className="border-b border-slate-200 text-left text-slate-500">
                <th className="p-3">Satpam</th>
                <th className="p-3">Tanggal</th>
                <th className="p-3">Temuan</th>
                <th className="p-3">Keterangan</th>
                <th className="p-3">Tindakan</th>
              </tr>
            </thead>
            <tbody>
              {visible.map((finding) => {
                const href = reviewHref(finding);
                return (
                  <tr key={finding.key} className="border-b border-slate-100 align-top">
                    <td className="p-3 font-semibold text-slate-900">
                      {finding.employeeName}
                    </td>
                    <td className="p-3 whitespace-nowrap">
                      {finding.date ? (
                        <>
                          <span className="font-semibold">{finding.date}</span>
                          {finding.shiftName && (
                            <span className="block text-xs text-slate-500">
                              {finding.shiftName}
                            </span>
                          )}
                        </>
                      ) : (
                        '—'
                      )}
                    </td>
                    <td className="p-3">
                      <span
                        className={`inline-flex rounded-sm px-2 py-1 text-xs font-semibold ${KIND_BADGE[finding.kind]}`}
                      >
                        {SATPAM_FINDING_LABELS[finding.kind]}
                      </span>
                    </td>
                    <td className="p-3 text-slate-600">{finding.message}</td>
                    <td className="p-3">
                      {href ? (
                        <Button
                          variant="outline"
                          className="rounded-sm min-h-12 gap-1.5 border-amber-300 text-amber-800 hover:bg-amber-50"
                          nativeButton={false}
                          render={<Link href={href} />}
                        >
                          <ExternalLink className="h-3.5 w-3.5" /> Periksa
                        </Button>
                      ) : (
                        <span className="text-slate-400">—</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
