"use client";

import { useState } from 'react';
import {
  AlertCircle,
  AlertTriangle,
  Ban,
  CheckCircle2,
  Loader2,
  Lock,
  X,
} from 'lucide-react';
import { usePayrollLockJob } from '@/lib/PayrollLockJobContext';
import { lockJobPercent } from '@/lib/payroll/lockJob';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';

/**
 * The floating bar for "Verifikasi & Kunci Semua". It sits in the dashboard
 * layout, so it stays on screen on every dashboard page while the run goes on.
 */
export default function PayrollLockGlobalUI() {
  const { job, stopPayrollLockJob, dismissPayrollLockJob } = usePayrollLockJob();
  const [confirmingStop, setConfirmingStop] = useState(false);
  const [showFailures, setShowFailures] = useState(false);

  if (!job) return null;

  const { progress } = job;
  const running = job.status === 'running';
  const percent = lockJobPercent(progress.completed, progress.total);
  const lockedCount = progress.lockedIds.length;
  const failureCount = progress.failures.length;
  const slipTotal = progress.total - 1;
  const slipsDone = Math.max(0, progress.completed - 1);
  const hasProblem = Boolean(job.fatalError) || failureCount > 0 || job.stopped;

  const tone = running
    ? 'bg-white border-slate-200'
    : job.fatalError
      ? 'bg-rose-50 border-rose-200'
      : hasProblem
        ? 'bg-amber-50 border-amber-200'
        : 'bg-emerald-50 border-emerald-200';
  const railTone = running
    ? job.stopRequested
      ? 'from-amber-400 to-amber-500'
      : 'from-emerald-500 to-teal-500'
    : job.fatalError
      ? 'from-rose-400 to-rose-500'
      : hasProblem
        ? 'from-amber-400 to-amber-500'
        : 'from-emerald-400 to-emerald-500';

  let title: string;
  let detail: string;
  if (running) {
    title = job.stopRequested
      ? 'Menghentikan setelah slip ini'
      : 'Memverifikasi & mengunci slip';
    detail = progress.phase === 'sealing'
      ? 'Menyegel roster payroll...'
      : progress.currentName
        ? `${progress.currentName} · ${slipsDone}/${slipTotal} slip`
        : `${slipsDone}/${slipTotal} slip`;
  } else if (job.fatalError) {
    title = 'Verifikasi & Kunci gagal';
    detail = job.fatalError;
  } else if (job.stopped) {
    title = `Dihentikan — ${lockedCount} slip dikunci`;
    detail = `${job.skipped} slip belum diproses dan tetap draf${failureCount > 0 ? `; ${failureCount} gagal` : ''}`;
  } else if (failureCount > 0) {
    title = `Selesai — ${lockedCount} slip dikunci, ${failureCount} gagal`;
    detail = 'Slip yang gagal tetap draf';
  } else {
    title = `Selesai — ${lockedCount} slip dikunci`;
    detail = progress.advancedLoans > 0
      ? `${progress.advancedLoans} cicilan Koperasi diproses${progress.paidOffLoans > 0 ? `; ${progress.paidOffLoans} pinjaman lunas` : ''}`
      : 'Seluruh roster sudah dikunci';
  }

  return (
    <>
      <div
        className={`fixed inset-x-0 bottom-0 flex justify-center px-4 pb-[max(1rem,env(safe-area-inset-bottom))] pointer-events-none ${
          !running && hasProblem ? 'z-[2147483646]' : 'z-[9997]'
        }`}
      >
        <div
          className={`pointer-events-auto relative w-full max-w-xl overflow-hidden rounded-2xl border shadow-xl transition-colors duration-300 ${tone}`}
        >
          <div className="absolute bottom-0 left-0 right-0 h-1 bg-slate-100">
            <div
              role="progressbar"
              aria-valuenow={percent}
              aria-valuemin={0}
              aria-valuemax={100}
              aria-label={`Kemajuan Verifikasi & Kunci ${job.periodLabel}`}
              className={`h-full transition-all duration-500 ease-out bg-gradient-to-r ${railTone}`}
              style={{ width: `${percent}%` }}
            />
          </div>

          <div className="flex items-center justify-between gap-3 px-4 py-3">
            <div className="flex items-center gap-3 min-w-0 flex-1">
              {running ? (
                <Loader2 className="w-5 h-5 text-emerald-600 animate-spin flex-shrink-0" />
              ) : job.fatalError ? (
                <AlertCircle className="w-5 h-5 text-rose-600 flex-shrink-0" />
              ) : hasProblem ? (
                <AlertTriangle className="w-5 h-5 text-amber-600 flex-shrink-0" />
              ) : (
                <CheckCircle2 className="w-5 h-5 text-emerald-600 flex-shrink-0" />
              )}
              <div className="min-w-0 flex-1">
                <div className="flex items-baseline gap-2">
                  <p className="text-sm font-semibold text-slate-800 truncate">{title}</p>
                  {running && (
                    <span className="text-xs font-semibold text-slate-500 tabular-nums flex-shrink-0">
                      {percent}%
                    </span>
                  )}
                </div>
                <p className="text-xs text-slate-500 truncate mt-0.5">
                  <span className="font-medium">{job.periodLabel}</span> · {detail}
                </p>
              </div>
            </div>

            <div className="flex items-center gap-1 flex-shrink-0">
              {running && !job.stopRequested && progress.phase === 'locking' && (
                <button
                  type="button"
                  onClick={() => setConfirmingStop(true)}
                  title="Hentikan setelah slip ini"
                  aria-label="Hentikan Verifikasi dan Kunci"
                  className="p-1.5 rounded-lg text-slate-500 hover:text-slate-700 hover:bg-slate-100 transition-colors cursor-pointer"
                >
                  <Ban className="w-4 h-4" />
                </button>
              )}
              {!running && failureCount > 0 && (
                <button
                  type="button"
                  onClick={() => setShowFailures(true)}
                  className="px-2 py-1 text-xs font-semibold rounded-lg text-amber-700 hover:bg-amber-100 transition-colors cursor-pointer"
                >
                  Lihat gagal
                </button>
              )}
              {!running && (
                <button
                  type="button"
                  onClick={dismissPayrollLockJob}
                  title="Tutup"
                  aria-label="Tutup"
                  className="p-1.5 rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-100 transition-colors cursor-pointer"
                >
                  <X className="w-4 h-4" />
                </button>
              )}
            </div>
          </div>
        </div>
      </div>

      <Dialog open={confirmingStop} onOpenChange={setConfirmingStop}>
        <DialogContent className="sm:max-w-md rounded-2xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-lg">
              <Ban className="w-5 h-5 text-rose-600" />
              Hentikan Verifikasi &amp; Kunci?
            </DialogTitle>
            <DialogDescription className="text-slate-500 text-sm pt-2">
              {lockedCount} slip sudah dikunci dan tidak dapat dibatalkan. Slip lainnya tetap draf
              dan dapat dikunci nanti lewat <em>Verifikasi &amp; Kunci Semua</em>.
            </DialogDescription>
          </DialogHeader>
          <div className="flex justify-end gap-3 pt-4">
            <Button
              variant="outline"
              onClick={() => setConfirmingStop(false)}
              className="rounded-xl border-slate-200 text-slate-600 hover:bg-slate-50"
            >
              Lanjutkan
            </Button>
            <Button
              onClick={() => {
                stopPayrollLockJob();
                setConfirmingStop(false);
              }}
              className="rounded-xl bg-rose-600 hover:bg-rose-700 text-white"
            >
              Ya, Hentikan
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={showFailures} onOpenChange={setShowFailures}>
        <DialogContent className="sm:max-w-lg max-h-[85vh] rounded-2xl flex flex-col">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-lg">
              <Lock className="w-5 h-5 text-amber-600" />
              Slip yang Gagal Dikunci
            </DialogTitle>
            <DialogDescription className="text-slate-500 text-sm">
              {failureCount} slip tetap draf. Perbaiki penyebabnya, lalu jalankan Verifikasi &amp;
              Kunci Semua lagi.
            </DialogDescription>
          </DialogHeader>
          <ul className="flex-1 overflow-y-auto space-y-1.5 pr-1">
            {progress.failures.map((failure, index) => (
              <li
                key={`${failure.name}-${index}`}
                className="px-3 py-2 border rounded-xl bg-rose-50 border-rose-100"
              >
                <p className="text-sm font-medium text-slate-800">{failure.name}</p>
                <p className="text-xs text-rose-600 mt-0.5">{failure.message}</p>
              </li>
            ))}
          </ul>
          <div className="flex justify-end pt-2">
            <Button
              variant="outline"
              onClick={() => setShowFailures(false)}
              className="rounded-xl border-slate-200 text-slate-600 hover:bg-slate-50"
            >
              Tutup
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
