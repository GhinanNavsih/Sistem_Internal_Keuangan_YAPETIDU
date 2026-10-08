"use client";

import Link from 'next/link';
import { PersonStanding } from 'lucide-react';
import { Card } from '@/components/ui/card';
import { periodLabel, SENAM_PAGI_PATH } from '@/lib/payroll/bonusTriwulan';

interface Props {
  period: string;
  workers: Record<string, { employeeName?: string; payGiven?: number }>;
  /** Only roles that may open the Senam Pagi page get the link. */
  showSenamPagiLink: boolean;
}

const rupiah = (value: number) => `Rp${value.toLocaleString('id-ID')}`;

/**
 * The "Rincian Kegiatan" of a Bonus Triwulan event. Read-only: who is paid is
 * worked out from presence strata and Senam Pagi, so it is changed there.
 */
export default function BonusTriwulanEventPanel({ period, workers, showSenamPagiLink }: Props) {
  const rows = Object.entries(workers)
    .map(([employeeId, worker]) => ({
      employeeId,
      employeeName: String(worker?.employeeName || employeeId),
      payGiven: Number(worker?.payGiven || 0),
    }))
    .sort((left, right) => left.employeeName.localeCompare(right.employeeName, 'id-ID'));
  const total = rows.reduce((sum, row) => sum + row.payGiven, 0);
  const [year, month] = period.split('-');

  return (
    <Card className="bg-white rounded-md shadow-[0_8px_30px_rgb(0,0,0,0.04)] border-none p-6 space-y-6">
      <div className="flex flex-wrap justify-between items-start gap-3 pb-4 border-b border-slate-100">
        <div>
          <h3 className="font-bold text-slate-800 text-sm flex items-center gap-2">
            <PersonStanding className="size-4 text-indigo-500" /> Rincian Kegiatan · Bonus Triwulan
          </h3>
          <p className="text-sm text-slate-500 mt-1">
            Dihitung otomatis dari Strata 1 presensi dan Senam Pagi tiga bulan berturut-turut.
            {showSenamPagiLink ? (
              <>
                {' '}
                <Link
                  href={`${SENAM_PAGI_PATH}?month=${Number(month)}&year=${year}`}
                  className="text-indigo-600 hover:underline"
                >
                  Buka Senam Pagi
                </Link>
              </>
            ) : null}
          </p>
        </div>
        <span className="text-sm text-slate-700 tabular-nums">
          {rows.length} pegawai · {rupiah(total)}
        </span>
      </div>

      {rows.length === 0 ? (
        <p className="py-8 text-center text-sm text-slate-400">
          Tidak ada penerima Bonus Triwulan {periodLabel(period)}.
        </p>
      ) : (
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-slate-200 text-left text-xs text-slate-500">
              <th className="py-2 pr-4 font-medium">Pegawai</th>
              <th className="py-2 text-right font-medium">Nominal</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.employeeId} className="border-b border-slate-100 last:border-0">
                <td className="py-2 pr-4 text-slate-800">{row.employeeName}</td>
                <td className="py-2 text-right tabular-nums text-slate-700">{rupiah(row.payGiven)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </Card>
  );
}
