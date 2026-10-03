'use client';

import { useMemo, useState } from 'react';
import { ChevronDown, ChevronUp, UserRoundX } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { suggestLinkCandidate } from '@/lib/payroll/attendanceLinkSuggestion';

export interface UnroutedAttendanceRow {
  sourceKey: string;
  sourceNipy: string;
  sourceName: string;
  dates: string[];
}

export interface UnroutedLinkCandidate {
  employeeId: string;
  name: string;
  nipy: string;
  category: string;
}

/**
 * Attendance rows the monthly file carries with no department and no matching
 * employee. Nothing routes them to a page on its own, so this lists them for an
 * admin to pick out the blue-collar staff and link each to the right person.
 * Most of them are Loyalis staff, who are handled on the Loyalis page — rows
 * with a likely blue-collar match are shown first, with that match suggested.
 */
export function UnroutedAttendanceRows({
  rows,
  candidates,
  disabled,
  onLink,
}: {
  rows: readonly UnroutedAttendanceRow[];
  candidates: readonly UnroutedLinkCandidate[];
  disabled: boolean;
  onLink: (row: UnroutedAttendanceRow, suggestion: UnroutedLinkCandidate | null) => void;
}) {
  const [open, setOpen] = useState(false);
  const ordered = useMemo(
    () =>
      rows
        .map((row) => ({
          row,
          suggestion: suggestLinkCandidate(row.sourceName, candidates),
        }))
        .sort(
          (left, right) =>
            Number(Boolean(right.suggestion)) - Number(Boolean(left.suggestion)) ||
            left.row.sourceName.localeCompare(right.row.sourceName, 'id'),
        ),
    [rows, candidates],
  );
  const likely = ordered.filter((item) => item.suggestion).length;
  if (rows.length === 0) return null;

  return (
    <section className="overflow-hidden rounded-md border border-amber-200 bg-white shadow-sm">
      <button
        type="button"
        onClick={() => setOpen((current) => !current)}
        aria-expanded={open}
        className="flex w-full items-start justify-between gap-3 bg-amber-50 p-5 text-left text-amber-900"
      >
        <div>
          <p className="flex items-center gap-2 font-bold">
            <UserRoundX className="h-5 w-5 shrink-0" />
            {rows.length} baris presensi tanpa departemen belum terhubung
            {likely > 0 && (
              <span className="rounded-sm bg-amber-200 px-2 py-0.5 text-xs">
                {likely} kemungkinan pegawai blue collar
              </span>
            )}
          </p>
          <p className="mt-1 text-sm">
            Berkas presensi tidak mencantumkan departemen untuk baris ini dan
            tidak ada pegawai yang cocok, sehingga tidak masuk ke halaman mana
            pun. Hubungkan yang termasuk pegawai blue collar agar hari kerjanya
            ikut dihitung; sisanya biasanya pegawai Loyalis.
          </p>
        </div>
        {open ? (
          <ChevronUp className="mt-1 h-5 w-5 shrink-0" />
        ) : (
          <ChevronDown className="mt-1 h-5 w-5 shrink-0" />
        )}
      </button>
      {open && (
        <div className="divide-y divide-slate-100">
          {ordered.map(({ row, suggestion }) => (
            <div
              key={row.sourceKey}
              className="flex flex-col gap-3 p-5 sm:flex-row sm:items-center sm:justify-between"
            >
              <div>
                <p className="font-bold text-slate-900">
                  {row.sourceName || 'Tanpa nama'}
                </p>
                <p className="text-sm text-slate-500">
                  Pengenal {row.sourceNipy || 'kosong'} · {row.dates.length} hari presensi
                </p>
                {suggestion && (
                  <p className="mt-1 text-sm font-semibold text-emerald-700">
                    Kemungkinan: {suggestion.name} ({suggestion.category || 'tanpa kategori'})
                  </p>
                )}
              </div>
              <Button
                variant="outline"
                className="rounded-sm min-h-12 shrink-0"
                disabled={disabled}
                onClick={() => onLink(row, suggestion)}
              >
                Hubungkan Pegawai Manual…
              </Button>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
