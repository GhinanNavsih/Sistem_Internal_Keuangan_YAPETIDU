"use client";

import React, { useEffect, useMemo, useState } from 'react';
import { useBulkEmail } from '@/lib/BulkEmailContext';
import { authenticatedJson } from '@/lib/payroll/client';
import {
  mergeEmailDetail,
  type EmailDetailRow,
  type EmailHistoryRow,
} from '@/lib/payroll/emailHistory';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription
} from '@/components/ui/dialog';
import {
  Mail,
  AlertCircle,
  AlertTriangle,
  CheckCircle2,
  Loader2,
  X,
  RefreshCw,
  Pause,
  Play,
  Search,
  Copy,
  Check,
  ChevronUp,
  Ban,
  Circle,
} from 'lucide-react';

function formatEta(seconds: number | null): string {
  if (seconds === null || !Number.isFinite(seconds) || seconds <= 0) return '';
  if (seconds < 60) return `± ${Math.max(1, Math.round(seconds))} detik lagi`;
  const minutes = Math.round(seconds / 60);
  return `± ${minutes} menit lagi`;
}

export default function BulkEmailGlobalUI() {
  const {
    bulkEmailProgress,
    emailTargetCount,
    currentBulkEmailName,
    currentBulkEmailAddress,
    successCount,
    failedCount,
    remainingCount,
    etaSeconds,
    fatalError,
    showBulkSnackbar,
    showBulkDetailModal,
    setShowBulkDetailModal,
    detailPeriod,
    bulkEmailDone,
    isBulkEmailPaused,
    pauseBulkEmailJob,
    resumeBulkEmailJob,
    retryFailedEmails,
    cancelBulkEmailJob,
    dismissJob,
    period,
    dbPeriod,
  } = useBulkEmail();

  const [confirmingCancel, setConfirmingCancel] = useState(false);

  const percent = emailTargetCount > 0 ? Math.round((bulkEmailProgress / emailTargetCount) * 100) : 0;
  const hasFailures = failedCount > 0;

  const handleClose = () => {
    if (!bulkEmailDone) {
      // Closing mid-run would silently drop the rest of the roster.
      setConfirmingCancel(true);
      return;
    }
    dismissJob();
  };

  const viewDbPeriod = detailPeriod?.dbPeriod || dbPeriod;

  return (
    <>
      {/* ─── Bulk Email Floating Snackbar ───────────────────── */}
      {showBulkSnackbar && (
      <div className={`fixed inset-x-0 top-0 flex justify-center px-4 pt-[max(1rem,env(safe-area-inset-top))] ${fatalError || hasFailures ? 'z-[2147483647]' : 'z-[9998]'}`}>
        <div
          className={`relative overflow-hidden rounded-2xl border shadow-xl transition-all duration-300 ${
            bulkEmailDone
              ? hasFailures
                ? 'bg-amber-50 border-amber-200'
                : 'bg-emerald-50 border-emerald-200'
              : fatalError
                ? 'bg-rose-50 border-rose-200'
                : 'bg-white border-slate-200'
          }`}
        >
          {/* Progress rail */}
          <div className="absolute bottom-0 left-0 right-0 h-1 bg-slate-100">
            <div
              role="progressbar"
              aria-valuenow={percent}
              aria-valuemin={0}
              aria-valuemax={100}
              aria-label="Progres pengiriman email slip gaji"
              className={`h-full transition-all duration-500 ease-out bg-gradient-to-r ${
                bulkEmailDone
                  ? hasFailures
                    ? 'from-amber-400 to-amber-500'
                    : 'from-emerald-400 to-emerald-500'
                  : isBulkEmailPaused
                    ? 'from-amber-400 to-amber-500'
                    : 'from-indigo-500 to-violet-500'
              }`}
              style={{ width: `${percent}%` }}
            />
          </div>

          <div className="flex items-center justify-between gap-3 px-4 py-3">
            <button
              type="button"
              onClick={() => setShowBulkDetailModal(true)}
              className="flex items-center gap-3 min-w-0 flex-1 text-left cursor-pointer outline-none rounded-xl focus-visible:ring-2 focus-visible:ring-indigo-400"
              aria-label="Lihat detail pengiriman email"
            >
              {bulkEmailDone ? (
                hasFailures ? (
                  <AlertCircle className="w-5 h-5 text-amber-600 flex-shrink-0" />
                ) : (
                  <CheckCircle2 className="w-5 h-5 text-emerald-600 flex-shrink-0" />
                )
              ) : isBulkEmailPaused ? (
                <Pause className="w-5 h-5 text-amber-500 flex-shrink-0" />
              ) : (
                <Loader2 className="w-5 h-5 text-indigo-600 animate-spin flex-shrink-0" />
              )}

              <div className="min-w-0 flex-1">
                {bulkEmailDone ? (
                  <>
                    <p className="text-sm font-semibold text-slate-800">
                      Selesai — {successCount} berhasil
                      {hasFailures ? `, ${failedCount} gagal` : ''}
                      {period ? ` · ${period}` : ''}
                    </p>
                    <p className="text-xs text-slate-500 mt-0.5">
                      {hasFailures ? 'Klik untuk meninjau & kirim ulang' : 'Klik untuk melihat detail'}
                    </p>
                  </>
                ) : (
                  <>
                    <div className="flex items-baseline gap-2">
                      <p className="text-sm font-semibold text-slate-800 truncate">
                        {isBulkEmailPaused ? 'Pengiriman dijeda' : 'Mengirim slip gaji'}
                      </p>
                      <span className="text-xs font-semibold text-slate-500 tabular-nums flex-shrink-0">
                        {bulkEmailProgress}/{emailTargetCount} · {percent}%
                      </span>
                    </div>
                    <p className="text-xs text-slate-500 truncate mt-0.5">
                      {isBulkEmailPaused
                        ? `${remainingCount} email menunggu — klik untuk melanjutkan`
                        : currentBulkEmailName
                          ? `${currentBulkEmailName} · ${currentBulkEmailAddress}`
                          : 'Mempersiapkan antrean...'}
                      {!isBulkEmailPaused && etaSeconds ? ` · ${formatEta(etaSeconds)}` : ''}
                    </p>
                  </>
                )}
              </div>
            </button>

            <div className="flex items-center gap-1 flex-shrink-0">
              {!bulkEmailDone &&
                (isBulkEmailPaused ? (
                  <button
                    type="button"
                    onClick={resumeBulkEmailJob}
                    title="Lanjutkan pengiriman"
                    aria-label="Lanjutkan pengiriman"
                    className="p-1.5 rounded-lg text-indigo-600 hover:bg-indigo-50 transition-colors cursor-pointer"
                  >
                    <Play className="w-4 h-4" />
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={pauseBulkEmailJob}
                    title="Jeda pengiriman"
                    aria-label="Jeda pengiriman"
                    className="p-1.5 rounded-lg text-slate-500 hover:text-slate-700 hover:bg-slate-100 transition-colors cursor-pointer"
                  >
                    <Pause className="w-4 h-4" />
                  </button>
                ))}
              {bulkEmailDone && hasFailures && (
                <button
                  type="button"
                  onClick={retryFailedEmails}
                  title={`Kirim ulang ${failedCount} yang gagal`}
                  aria-label="Kirim ulang yang gagal"
                  className="p-1.5 rounded-lg text-amber-600 hover:bg-amber-100 transition-colors cursor-pointer"
                >
                  <RefreshCw className="w-4 h-4" />
                </button>
              )}
              <button
                type="button"
                onClick={handleClose}
                title={bulkEmailDone ? 'Tutup' : 'Batalkan pengiriman'}
                aria-label={bulkEmailDone ? 'Tutup' : 'Batalkan pengiriman'}
                className="p-1.5 rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-100 transition-colors cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          </div>

          {/* Systemic failure banner */}
          {fatalError && !bulkEmailDone && (
            <div className="flex items-start gap-2 px-4 pb-3 -mt-1">
              <AlertTriangle className="w-4 h-4 text-rose-500 flex-shrink-0 mt-0.5" />
              <p className="text-xs text-rose-600 leading-relaxed">{fatalError}</p>
            </div>
          )}
        </div>
      </div>
      )}

      {/* ─── Cancel Confirmation ────────────────────────────── */}
      <Dialog open={confirmingCancel} onOpenChange={setConfirmingCancel}>
        <DialogContent className="sm:max-w-md rounded-2xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-lg">
              <Ban className="w-5 h-5 text-rose-600" />
              Batalkan Pengiriman?
            </DialogTitle>
            <DialogDescription className="text-slate-500 text-sm pt-2">
              <strong className="text-slate-700">{remainingCount} email</strong> belum terkirim dan akan
              dilewati. {successCount} email yang sudah terkirim tidak dapat ditarik kembali. Anda bisa
              mengirim sisanya nanti lewat tombol <em>Kirim Email ke Semua</em>.
            </DialogDescription>
          </DialogHeader>
          <div className="flex justify-end gap-3 pt-4">
            <Button
              variant="outline"
              onClick={() => setConfirmingCancel(false)}
              className="rounded-xl border-slate-200 text-slate-600 hover:bg-slate-50"
            >
              Lanjutkan Mengirim
            </Button>
            <Button
              onClick={() => {
                cancelBulkEmailJob();
                setConfirmingCancel(false);
              }}
              className="rounded-xl bg-rose-600 hover:bg-rose-700 text-white"
            >
              Ya, Batalkan
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* ─── Detail Pengiriman Email ───────────────────────── */}
      {/* Mounted only while open, so each opening reads the history afresh. */}
      {showBulkDetailModal && viewDbPeriod && (
        <EmailDetailDialog
          key={viewDbPeriod}
          dbPeriod={viewDbPeriod}
          periodLabel={detailPeriod?.label || period}
        />
      )}
    </>
  );
}

const DATE_TIME = new Intl.DateTimeFormat('id-ID', {
  day: 'numeric',
  month: 'short',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
});

function formatSentAt(iso: string | null): string {
  if (!iso) return '';
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? '' : DATE_TIME.format(date);
}

/**
 * Who received their payslip email for one period: the server's record, with
 * the running bulk send (when it is for this period) laid over it. It also
 * opens with no job at all, so the history survives a crashed or closed run.
 */
function EmailDetailDialog({ dbPeriod, periodLabel }: { dbPeriod: string; periodLabel: string }) {
  const {
    bulkEmailResults,
    bulkEmailProgress,
    emailTargetCount,
    etaSeconds,
    fatalError,
    bulkEmailDone,
    isBulkEmailActive,
    isBulkEmailPaused,
    sendingBulkEmail,
    pauseBulkEmailJob,
    resumeBulkEmailJob,
    retryFailedEmails,
    cancelBulkEmailJob,
    dismissJob,
    closeEmailDetail,
    dbPeriod: jobDbPeriod,
  } = useBulkEmail();

  const [history, setHistory] = useState<EmailHistoryRow[] | null>(null);
  const [historyError, setHistoryError] = useState<string | null>(null);
  const [historyLoading, setHistoryLoading] = useState(true);
  const [reloadKey, setReloadKey] = useState(0);
  const [search, setSearch] = useState('');
  const [copied, setCopied] = useState(false);
  const [confirmingCancel, setConfirmingCancel] = useState(false);

  useEffect(() => {
    let cancelled = false;
    authenticatedJson<{ rows: EmailHistoryRow[] }>(
      `/api/payroll/send-email?dbPeriod=${encodeURIComponent(dbPeriod)}`,
    )
      .then((result) => {
        if (cancelled) return;
        setHistory(Array.isArray(result.rows) ? result.rows : []);
        setHistoryError(null);
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        setHistoryError(error instanceof Error ? error.message : 'Riwayat pengiriman gagal dimuat.');
      })
      .finally(() => {
        if (!cancelled) setHistoryLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [dbPeriod, reloadKey]);

  const reloadHistory = () => {
    setHistoryLoading(true);
    setReloadKey((key) => key + 1);
  };

  // The job's controls belong here only when it is sending this period.
  const jobHere = jobDbPeriod === dbPeriod && bulkEmailResults.length > 0;
  const rows = useMemo(
    () => mergeEmailDetail(history, jobHere ? bulkEmailResults : null),
    [history, jobHere, bulkEmailResults],
  );
  const jobFailedCount = jobHere
    ? bulkEmailResults.filter((item) => item.status === 'failed').length
    : 0;

  const filtered = useMemo(() => {
    const needle = search.trim().toLowerCase();
    if (!needle) return rows;
    return rows.filter(
      (row) =>
        row.employeeName.toLowerCase().includes(needle) ||
        row.email.toLowerCase().includes(needle),
    );
  }, [rows, search]);

  const groups = useMemo(
    () => ({
      failed: filtered.filter((row) => row.status === 'failed'),
      sending: filtered.filter((row) => row.status === 'sending'),
      pending: filtered.filter((row) => row.status === 'pending'),
      sent: filtered.filter((row) => row.status === 'sent'),
      notSent: filtered.filter((row) => row.status === 'not_sent'),
    }),
    [filtered],
  );
  const counts = {
    sent: rows.filter((row) => row.status === 'sent').length,
    failed: rows.filter((row) => row.status === 'failed').length,
    waiting: rows.filter((row) => row.status !== 'sent' && row.status !== 'failed').length,
  };

  const handleCopyFailed = async () => {
    const text = rows
      .filter((row) => row.status === 'failed')
      .map((row) => `${row.employeeName}\t${row.email}\t${row.note || ''}`)
      .join('\n');
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.error('Gagal menyalin daftar gagal:', err);
    }
  };

  let description: string;
  if (jobHere && isBulkEmailActive) {
    description = isBulkEmailPaused
      ? `Dijeda pada ${bulkEmailProgress} dari ${emailTargetCount} email.`
      : `Mengirim ${bulkEmailProgress} dari ${emailTargetCount}${etaSeconds ? ` · ${formatEta(etaSeconds)}` : ''}.`;
  } else {
    description = `Riwayat pengiriman slip gaji${periodLabel ? ` periode ${periodLabel}` : ''}.`;
  }

  return (
    <>
      <Dialog open onOpenChange={(open) => { if (!open) closeEmailDetail(); }}>
        <DialogContent className="sm:max-w-lg max-h-[85vh] rounded-2xl flex flex-col">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-lg">
              <Mail className="w-5 h-5 text-indigo-600" />
              Detail Pengiriman Email
            </DialogTitle>
            <DialogDescription className="text-slate-500 text-sm">
              {description}
            </DialogDescription>
          </DialogHeader>

          {jobHere && fatalError && (
            <div className="flex items-start gap-2 px-3 py-2.5 rounded-xl bg-rose-50 border border-rose-100">
              <AlertTriangle className="w-4 h-4 text-rose-500 flex-shrink-0 mt-0.5" />
              <p className="text-xs text-rose-700 leading-relaxed">{fatalError}</p>
            </div>
          )}

          {historyError && (
            <div className="flex items-start gap-2 px-3 py-2.5 rounded-xl bg-amber-50 border border-amber-100">
              <AlertCircle className="w-4 h-4 text-amber-600 flex-shrink-0 mt-0.5" />
              <p className="text-xs text-amber-800 leading-relaxed flex-1">
                Riwayat dari server gagal dimuat: {historyError}
              </p>
              <button
                type="button"
                onClick={reloadHistory}
                className="text-xs font-semibold text-amber-800 underline underline-offset-2 cursor-pointer"
              >
                Coba lagi
              </button>
            </div>
          )}

          <div className="grid grid-cols-3 gap-2">
            <div className="rounded-xl border border-emerald-100 bg-emerald-50 px-3 py-2">
              <p className="text-[11px] font-semibold text-emerald-700">Terkirim</p>
              <p className="text-lg font-bold text-emerald-800 tabular-nums leading-tight">{counts.sent}</p>
            </div>
            <div className="rounded-xl border border-rose-100 bg-rose-50 px-3 py-2">
              <p className="text-[11px] font-semibold text-rose-700">Gagal</p>
              <p className="text-lg font-bold text-rose-800 tabular-nums leading-tight">{counts.failed}</p>
            </div>
            <div className="rounded-xl border border-slate-100 bg-slate-50 px-3 py-2">
              <p className="text-[11px] font-semibold text-slate-500">Belum terkirim</p>
              <p className="text-lg font-bold text-slate-700 tabular-nums leading-tight">{counts.waiting}</p>
            </div>
          </div>

          {rows.length > 8 && (
            <div className="relative">
              <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
              <input
                type="text"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Cari nama atau email..."
                className="w-full rounded-xl border border-slate-200 bg-white pl-9 pr-3 py-2 text-sm text-slate-700 placeholder:text-slate-400 outline-none focus:border-indigo-300 focus:ring-2 focus:ring-indigo-100 transition"
              />
            </div>
          )}

          <div className="flex-1 overflow-y-auto space-y-4 pr-1 min-h-[120px]">
            {historyLoading && rows.length === 0 && (
              <p className="text-sm text-slate-400 text-center py-8 flex items-center justify-center gap-2">
                <Loader2 className="w-4 h-4 animate-spin" />
                Memuat riwayat...
              </p>
            )}
            {!historyLoading && rows.length === 0 && !historyError && (
              <p className="text-sm text-slate-400 text-center py-8">Belum ada slip terkunci pada periode ini.</p>
            )}
            {rows.length > 0 && filtered.length === 0 && (
              <p className="text-sm text-slate-400 text-center py-8">Tidak ada hasil untuk “{search}”.</p>
            )}

            <Section title="Gagal" count={groups.failed.length} dotClass="bg-rose-500" labelClass="text-rose-700">
              {groups.failed.map((row) => (
                <Row
                  key={`fail-${row.employeeId}`}
                  row={row}
                  wrapperClass="bg-rose-50 border-rose-100"
                  icon={<AlertCircle className="w-4 h-4 text-rose-500 flex-shrink-0" />}
                  noteClass="text-rose-600"
                />
              ))}
            </Section>

            <Section title="Sedang dikirim" count={groups.sending.length} dotClass="bg-indigo-500" labelClass="text-indigo-700">
              {groups.sending.map((row) => (
                <Row
                  key={`sending-${row.employeeId}`}
                  row={row}
                  wrapperClass="bg-indigo-50 border-indigo-100"
                  icon={<Loader2 className="w-4 h-4 text-indigo-500 animate-spin flex-shrink-0" />}
                />
              ))}
            </Section>

            <Section title="Menunggu" count={groups.pending.length} dotClass="bg-slate-400" labelClass="text-slate-600">
              {groups.pending.map((row) => (
                <Row
                  key={`pending-${row.employeeId}`}
                  row={row}
                  wrapperClass="bg-slate-50 border-slate-100"
                  muted
                  icon={<div className="w-4 h-4 rounded-full border-2 border-slate-300 flex-shrink-0" />}
                />
              ))}
            </Section>

            <Section title="Terkirim" count={groups.sent.length} dotClass="bg-emerald-500" labelClass="text-emerald-700">
              {groups.sent.map((row) => (
                <Row
                  key={`sent-${row.employeeId}`}
                  row={row}
                  wrapperClass="bg-emerald-50 border-emerald-100"
                  icon={<CheckCircle2 className="w-4 h-4 text-emerald-500 flex-shrink-0" />}
                />
              ))}
            </Section>

            <Section title="Belum dikirim" count={groups.notSent.length} dotClass="bg-slate-300" labelClass="text-slate-500">
              {groups.notSent.map((row) => (
                <Row
                  key={`not-sent-${row.employeeId}`}
                  row={row}
                  wrapperClass="bg-white border-slate-100"
                  muted
                  icon={<Circle className="w-4 h-4 text-slate-300 flex-shrink-0" />}
                />
              ))}
            </Section>
          </div>

          <div className="flex flex-wrap justify-end items-center gap-2 pt-4 border-t border-slate-100">
            <div className="flex items-center gap-1 mr-auto">
              <Button
                variant="ghost"
                onClick={reloadHistory}
                disabled={historyLoading}
                title="Muat ulang riwayat dari server"
                className="rounded-xl text-slate-500 hover:bg-slate-50"
              >
                <RefreshCw className={`w-4 h-4 ${historyLoading ? 'animate-spin' : ''}`} />
              </Button>
              {counts.failed > 0 && (
                <Button
                  variant="outline"
                  onClick={handleCopyFailed}
                  className="rounded-xl border-slate-200 text-slate-600 hover:bg-slate-50"
                >
                  {copied ? <Check className="w-4 h-4 mr-2 text-emerald-600" /> : <Copy className="w-4 h-4 mr-2" />}
                  {copied ? 'Tersalin' : 'Salin daftar gagal'}
                </Button>
              )}
            </div>

            {jobHere && isBulkEmailActive && (
              <>
                <Button
                  variant="outline"
                  onClick={() => setConfirmingCancel(true)}
                  className="rounded-xl border-rose-200 text-rose-600 hover:bg-rose-50"
                >
                  <Ban className="w-4 h-4 mr-2" />
                  Batalkan
                </Button>
                {isBulkEmailPaused ? (
                  <Button
                    onClick={resumeBulkEmailJob}
                    className="rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white"
                  >
                    <Play className="w-4 h-4 mr-2" />
                    Lanjutkan
                  </Button>
                ) : (
                  <Button
                    onClick={pauseBulkEmailJob}
                    className="rounded-xl bg-slate-700 hover:bg-slate-800 text-white"
                  >
                    <Pause className="w-4 h-4 mr-2" />
                    Jeda Sementara
                  </Button>
                )}
              </>
            )}

            {jobHere && bulkEmailDone && jobFailedCount > 0 && (
              <Button
                onClick={retryFailedEmails}
                className="rounded-xl bg-amber-500 hover:bg-amber-600 text-white"
              >
                <RefreshCw className="w-4 h-4 mr-2" />
                Kirim Ulang yang Gagal ({jobFailedCount})
              </Button>
            )}

            {(!jobHere || !isBulkEmailActive) && (
              <Button
                variant="outline"
                onClick={jobHere && bulkEmailDone ? dismissJob : closeEmailDetail}
                className="rounded-xl border-slate-200 text-slate-600 hover:bg-slate-50"
              >
                Tutup
              </Button>
            )}
          </div>

          {jobHere && sendingBulkEmail && (
            <p className="text-[11px] text-slate-400 text-center flex items-center justify-center gap-1">
              <ChevronUp className="w-3 h-3" />
              Anda dapat menutup jendela ini — pengiriman tetap berjalan, juga setelah halaman dimuat ulang.
            </p>
          )}
        </DialogContent>
      </Dialog>

      <Dialog open={confirmingCancel} onOpenChange={setConfirmingCancel}>
        <DialogContent className="sm:max-w-md rounded-2xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-lg">
              <Ban className="w-5 h-5 text-rose-600" />
              Batalkan Pengiriman?
            </DialogTitle>
            <DialogDescription className="text-slate-500 text-sm pt-2">
              Email yang belum terkirim akan dilewati. Email yang sudah terkirim tidak dapat ditarik
              kembali. Anda bisa mengirim sisanya nanti lewat tombol <em>Kirim Email ke Semua</em>;
              slip yang sudah terkirim tidak akan dikirim ulang.
            </DialogDescription>
          </DialogHeader>
          <div className="flex justify-end gap-3 pt-4">
            <Button
              variant="outline"
              onClick={() => setConfirmingCancel(false)}
              className="rounded-xl border-slate-200 text-slate-600 hover:bg-slate-50"
            >
              Lanjutkan Mengirim
            </Button>
            <Button
              onClick={() => {
                cancelBulkEmailJob();
                setConfirmingCancel(false);
              }}
              className="rounded-xl bg-rose-600 hover:bg-rose-700 text-white"
            >
              Ya, Batalkan
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}

function Section({
  title,
  count,
  dotClass,
  labelClass,
  children,
}: {
  title: string;
  count: number;
  dotClass: string;
  labelClass: string;
  children: React.ReactNode;
}) {
  if (count === 0) return null;
  return (
    <div>
      <div className="flex items-center gap-2 mb-2">
        <div className={`w-2 h-2 rounded-full ${dotClass}`} />
        <span className={`text-sm font-semibold ${labelClass}`}>
          {title} ({count})
        </span>
      </div>
      <div className="space-y-1.5">{children}</div>
    </div>
  );
}

function Row({
  row,
  icon,
  wrapperClass,
  noteClass,
  muted,
}: {
  row: EmailDetailRow;
  icon: React.ReactNode;
  wrapperClass: string;
  noteClass?: string;
  muted?: boolean;
}) {
  const sentAt = row.status === 'sent' ? formatSentAt(row.sentAt) : '';
  return (
    <div className={`flex items-center gap-3 px-3 py-2 border rounded-xl ${wrapperClass}`}>
      {icon}
      <div className="min-w-0 flex-1">
        <p className={`text-sm font-medium truncate ${muted ? 'text-slate-500' : 'text-slate-800'}`}>
          {row.employeeName}
        </p>
        <p className={`text-xs truncate ${muted ? 'text-slate-400' : 'text-slate-500'}`}>
          {row.email || 'Email belum terdaftar'}
          {sentAt ? ` · ${sentAt}` : ''}
        </p>
        {row.note && <p className={`text-[11px] mt-0.5 ${noteClass || 'text-slate-500'}`}>{row.note}</p>}
      </div>
    </div>
  );
}
