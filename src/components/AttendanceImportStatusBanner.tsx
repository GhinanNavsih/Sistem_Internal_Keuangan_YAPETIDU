"use client";

import React from 'react';
import { AlertTriangle, CheckCircle2, Info } from 'lucide-react';
import { ATTENDANCE_PAYROLL_START_PERIOD } from '@/lib/payroll/attendance';
import { useAttendanceImportStatus } from '@/lib/queries/hooks';

/**
 * Says whether this period's shared attendance file has been imported yet.
 *
 * The file covering both Loyalis and Pekarya is uploaded once per period,
 * near month end, so for most of the month the raw presence grid is empty by
 * design. Deciding a leave or correction never waits on it — an approval is
 * recorded as a correction and folded in automatically once the file lands —
 * so every variant below says so rather than implying the reviewer is stuck.
 */
export type AttendanceImportStatusVariant =
  | 'admin'
  | 'loyalis'
  | 'pekarya'
  | 'satpam-scan'
  | 'satpam-independent';

type EmployeeVariant = Exclude<
  AttendanceImportStatusVariant,
  'admin' | 'satpam-independent'
>;

const EMPLOYEE_COPY: Record<
  EmployeeVariant,
  { notImported: string; imported: string }
> = {
  loyalis: {
    notImported:
      'Presensi bulanan periode ini belum diimpor admin — file presensi memang diunggah sekali per bulan, biasanya menjelang akhir bulan. Koreksi Anda tetap bisa diputuskan sekarang; begitu presensi bulanan masuk, koreksi yang sudah disetujui otomatis ikut terhitung tanpa perlu diajukan ulang.',
    imported:
      'Presensi bulanan periode ini sudah diimpor. Koreksi yang disetujui langsung ikut terhitung pada presensi Anda.',
  },
  pekarya: {
    notImported:
      'Presensi bulanan periode ini belum diimpor admin — file presensi memang diunggah sekali per bulan, biasanya menjelang akhir bulan. Kepala SatKer tetap bisa memutuskan pengajuan ini sekarang; begitu presensi bulanan masuk, pengajuan yang sudah disetujui otomatis ikut terhitung tanpa perlu diajukan ulang.',
    imported:
      'Presensi bulanan periode ini sudah diimpor. Pengajuan yang disetujui langsung ikut terhitung pada presensi Anda.',
  },
  'satpam-scan': {
    notImported:
      'Presensi bulanan periode ini belum diimpor admin — file presensi memang diunggah sekali per bulan, biasanya menjelang akhir bulan. Laporan scan ini tetap bisa diputuskan Kepala SatKer sekarang; begitu presensi bulanan masuk, laporan yang sudah disetujui otomatis ikut terhitung tanpa perlu dilaporkan ulang.',
    imported:
      'Presensi bulanan periode ini sudah diimpor. Laporan scan yang disetujui langsung ikut terhitung pada presensi Anda.',
  },
};

export function AttendanceImportStatusBanner({
  period,
  variant,
}: {
  period: string;
  variant: AttendanceImportStatusVariant;
}) {
  // Izin, sakit, darurat, dan lainnya diputuskan lewat rencana dinas dan saldo
  // hak Satpam, tidak pernah menyentuh import presensi — jadi tidak perlu
  // membaca status import sama sekali.
  const independent = variant === 'satpam-independent';
  const applicable = !independent && period >= ATTENDANCE_PAYROLL_START_PERIOD;
  const { data, isLoading, isError } = useAttendanceImportStatus(
    period,
    applicable,
  );

  if (independent) {
    return (
      <div className="rounded-xl border border-blue-200 bg-blue-50 p-4 text-sm text-blue-900">
        <Info className="mr-1.5 inline h-4 w-4 align-text-bottom" />
        Izin jenis ini diputuskan langsung oleh Kepala SatKer lewat rencana
        dinas dan hak izin Anda — tidak menunggu presensi bulanan sama sekali.
      </div>
    );
  }

  if (!applicable || isLoading || isError || !data) return null;

  const isAdmin = variant === 'admin';
  const shell = isAdmin ? 'rounded-2xl p-5' : 'rounded-xl p-4';

  if (!data.imported) {
    return (
      <div className={`${shell} border border-amber-200 bg-amber-50 text-amber-900`}>
        {isAdmin ? (
          <>
            <p className="flex items-center gap-2 font-bold">
              <AlertTriangle className="h-4 w-4 shrink-0" />
              Presensi bulanan periode ini belum diimpor
            </p>
            <p className="mt-1 text-sm">
              File presensi Loyalis dan Pekarya digabung dan diunggah sekali per
              periode, biasanya menjelang akhir bulan. Menyetujui atau menolak
              pengajuan presensi dan izin tetap bisa dilakukan sekarang — begitu
              file diimpor, keputusan yang sudah diambil otomatis ikut terhitung
              tanpa perlu ditinjau ulang.
            </p>
          </>
        ) : (
          <p className="text-sm">{EMPLOYEE_COPY[variant].notImported}</p>
        )}
      </div>
    );
  }

  return (
    <div className={`${shell} border border-emerald-200 bg-emerald-50 text-emerald-900`}>
      {isAdmin ? (
        <>
          <p className="flex items-center gap-2 font-bold">
            <CheckCircle2 className="h-4 w-4 shrink-0" />
            Presensi bulanan aktif — revisi {data.revision}
          </p>
          <p className="mt-1 text-sm">
            Grid presensi, rekap, dan publikasi sudah memakai data ini.
            Keputusan yang diambil sebelum file masuk juga sudah ikut terhitung.
          </p>
          {data.stale && (
            <p className="mt-2 text-sm font-bold">
              File presensi diganti setelah Kalkulator Presensi Loyalis terakhir
              disimpan. Proses dan simpan ulang di Presensi Loyalis sebelum
              periode ditutup.
            </p>
          )}
        </>
      ) : (
        <p className="text-sm">{EMPLOYEE_COPY[variant].imported}</p>
      )}
    </div>
  );
}
