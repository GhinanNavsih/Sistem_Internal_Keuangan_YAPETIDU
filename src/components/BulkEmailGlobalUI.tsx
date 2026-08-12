"use client";

import React, { useMemo, useState } from 'react';
import { useBulkEmail, type QueueItem } from '@/lib/BulkEmailContext';
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
  Ban
} from 'lucide-react';

function formatEta(seconds: number | null): string {
  if (seconds === null || !Number.isFinite(seconds) || seconds <= 0) return '';
  if (seconds < 60) return `± ${Math.max(1, Math.round(seconds))} detik lagi`;
  const minutes = Math.round(seconds / 60);
  return `± ${minutes} menit lagi`;
}

export default function BulkEmailGlobalUI() {
  const {
    sendingBulkEmail,
    bulkEmailProgress,
    emailTargetCount,
    currentBulkEmailName,
    currentBulkEmailAddress,
    bulkEmailResults,
    successCount,
    failedCount,
    remainingCount,
    etaSeconds,
    fatalError,
    showBulkSnackbar,
    showBulkDetailModal,
    setShowBulkDetailModal,
    bulkEmailDone,
    isBulkEmailPaused,
    pauseBulkEmailJob,
    resumeBulkEmailJob,
    retryFailedEmails,
    cancelBulkEmailJob,
    dismissJob,
    period,
  } = useBulkEmail();

  const [confirmingCancel, setConfirmingCancel] = useState(false);
  const [search, setSearch] = useState('');
  const [copied, setCopied] = useState(false);

  const percent = emailTargetCount > 0 ? Math.round((bulkEmailProgress / emailTargetCount) * 100) : 0;
  const hasFailures = failedCount > 0;

  const filtered = useMemo(() => {
    const needle = search.trim().toLowerCase();
    if (!needle) return bulkEmailResults;
    return bulkEmailResults.filter(
      (item) =>
        item.employeeName.toLowerCase().includes(needle) ||
        item.email.toLowerCase().includes(needle),
    );
  }, [bulkEmailResults, search]);

  const groups = useMemo(
    () => ({
      failed: filtered.filter((item) => item.status === 'failed'),
      sending: filtered.filter((item) => item.status === 'sending'),
      success: filtered.filter((item) => item.status === 'success'),
      pending: filtered.filter((item) => item.status === 'pending'),
    }),
    [filtered],
  );

  const handleCopyFailed = async () => {
    const text = bulkEmailResults
      .filter((item) => item.status === 'failed')
      .map((item) => `${item.employeeName}\t${item.email}\t${item.error || ''}`)
      .join('\n');
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.error('Gagal menyalin daftar gagal:', err);
    }
  };

  const handleClose = () => {
    if (!bulkEmailDone) {
      // Closing mid-run would silently drop the rest of the roster.
      setConfirmingCancel(true);
      return;
    }
    dismissJob();
  };

  if (!showBulkSnackbar) return null;

  return (
    <>
      {/* ─── Bulk Email Floating Snackbar ───────────────────── */}
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

      {/* ─── Bulk Email Detail Modal ────────────────────────── */}
      <Dialog open={showBulkDetailModal} onOpenChange={setShowBulkDetailModal}>
        <DialogContent className="sm:max-w-lg max-h-[85vh] rounded-2xl flex flex-col">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-lg">
              <Mail className="w-5 h-5 text-indigo-600" />
              Detail Pengiriman Email
            </DialogTitle>
            <DialogDescription className="text-slate-500 text-sm">
              {bulkEmailDone
                ? `${successCount} berhasil, ${failedCount} gagal dari ${emailTargetCount} total`
                : isBulkEmailPaused
                  ? `Dijeda pada ${bulkEmailProgress} dari ${emailTargetCount} email.`
                  : `Mengirim ${bulkEmailProgress} dari ${emailTargetCount}${etaSeconds ? ` · ${formatEta(etaSeconds)}` : ''}`}
              {period ? ` · Periode ${period}` : ''}
            </DialogDescription>
          </DialogHeader>

          {fatalError && (
            <div className="flex items-start gap-2 px-3 py-2.5 rounded-xl bg-rose-50 border border-rose-100">
              <AlertTriangle className="w-4 h-4 text-rose-500 flex-shrink-0 mt-0.5" />
              <p className="text-xs text-rose-700 leading-relaxed">{fatalError}</p>
            </div>
          )}

          {/* Summary chips */}
          <div className="grid grid-cols-3 gap-2">
            <div className="rounded-xl border border-emerald-100 bg-emerald-50 px-3 py-2">
              <p className="text-[11px] font-semibold text-emerald-700">Berhasil</p>
              <p className="text-lg font-bold text-emerald-800 tabular-nums leading-tight">{successCount}</p>
            </div>
            <div className="rounded-xl border border-rose-100 bg-rose-50 px-3 py-2">
              <p className="text-[11px] font-semibold text-rose-700">Gagal</p>
              <p className="text-lg font-bold text-rose-800 tabular-nums leading-tight">{failedCount}</p>
            </div>
            <div className="rounded-xl border border-slate-100 bg-slate-50 px-3 py-2">
              <p className="text-[11px] font-semibold text-slate-500">Menunggu</p>
              <p className="text-lg font-bold text-slate-700 tabular-nums leading-tight">{remainingCount}</p>
            </div>
          </div>

          {emailTargetCount > 8 && (
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
            {filtered.length === 0 && (
              <p className="text-sm text-slate-400 text-center py-8">Tidak ada hasil untuk “{search}”.</p>
            )}

            <Section
              title="Gagal"
              count={groups.failed.length}
              dotClass="bg-rose-500"
              labelClass="text-rose-700"
              items={groups.failed}
              renderItem={(item) => (
                <Row
                  key={`fail-${item.employeeId}`}
                  item={item}
                  wrapperClass="bg-rose-50 border-rose-100"
                  icon={<AlertCircle className="w-4 h-4 text-rose-500 flex-shrink-0" />}
                  errorClass="text-rose-600"
                />
              )}
            />

            <Section
              title="Sedang dikirim"
              count={groups.sending.length}
              dotClass="bg-indigo-500"
              labelClass="text-indigo-700"
              items={groups.sending}
              renderItem={(item) => (
                <Row
                  key={`sending-${item.employeeId}`}
                  item={item}
                  wrapperClass="bg-indigo-50 border-indigo-100"
                  icon={<Loader2 className="w-4 h-4 text-indigo-500 animate-spin flex-shrink-0" />}
                />
              )}
            />

            <Section
              title="Berhasil"
              count={groups.success.length}
              dotClass="bg-emerald-500"
              labelClass="text-emerald-700"
              items={groups.success}
              renderItem={(item) => (
                <Row
                  key={`success-${item.employeeId}`}
                  item={item}
                  wrapperClass="bg-emerald-50 border-emerald-100"
                  icon={<CheckCircle2 className="w-4 h-4 text-emerald-500 flex-shrink-0" />}
                />
              )}
            />

            <Section
              title="Menunggu"
              count={groups.pending.length}
              dotClass="bg-slate-300"
              labelClass="text-slate-500"
              items={groups.pending}
              renderItem={(item) => (
                <Row
                  key={`pending-${item.employeeId}`}
                  item={item}
                  wrapperClass="bg-slate-50 border-slate-100"
                  muted
                  icon={<div className="w-4 h-4 rounded-full border-2 border-slate-300 flex-shrink-0" />}
                />
              )}
            />
          </div>

          <div className="flex flex-wrap justify-end items-center gap-2 pt-4 border-t border-slate-100">
            {hasFailures && (
              <Button
                variant="outline"
                onClick={handleCopyFailed}
                className="rounded-xl border-slate-200 text-slate-600 hover:bg-slate-50 mr-auto"
              >
                {copied ? <Check className="w-4 h-4 mr-2 text-emerald-600" /> : <Copy className="w-4 h-4 mr-2" />}
                {copied ? 'Tersalin' : 'Salin daftar gagal'}
              </Button>
            )}

            {!bulkEmailDone && (
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

            {bulkEmailDone && (
              <>
                {hasFailures && (
                  <Button
                    onClick={retryFailedEmails}
                    className="rounded-xl bg-amber-500 hover:bg-amber-600 text-white"
                  >
                    <RefreshCw className="w-4 h-4 mr-2" />
                    Kirim Ulang yang Gagal ({failedCount})
                  </Button>
                )}
                <Button
                  variant="outline"
                  onClick={dismissJob}
                  className="rounded-xl border-slate-200 text-slate-600 hover:bg-slate-50"
                >
                  Tutup
                </Button>
              </>
            )}
          </div>

          {sendingBulkEmail && (
            <p className="text-[11px] text-slate-400 text-center flex items-center justify-center gap-1">
              <ChevronUp className="w-3 h-3" />
              Anda dapat menutup jendela ini — pengiriman tetap berjalan selama tab tidak ditutup.
            </p>
          )}
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
  items,
  renderItem,
}: {
  title: string;
  count: number;
  dotClass: string;
  labelClass: string;
  items: QueueItem[];
  renderItem: (item: QueueItem) => React.ReactNode;
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
      <div className="space-y-1.5">{items.map(renderItem)}</div>
    </div>
  );
}

function Row({
  item,
  icon,
  wrapperClass,
  errorClass,
  muted,
}: {
  item: QueueItem;
  icon: React.ReactNode;
  wrapperClass: string;
  errorClass?: string;
  muted?: boolean;
}) {
  return (
    <div className={`flex items-center gap-3 px-3 py-2 border rounded-xl ${wrapperClass}`}>
      {icon}
      <div className="min-w-0 flex-1">
        <p className={`text-sm font-medium truncate ${muted ? 'text-slate-500' : 'text-slate-800'}`}>
          {item.employeeName}
        </p>
        <p className={`text-xs truncate ${muted ? 'text-slate-400' : 'text-slate-500'}`}>{item.email}</p>
        {item.error && <p className={`text-[11px] mt-0.5 ${errorClass || 'text-slate-500'}`}>{item.error}</p>}
      </div>
    </div>
  );
}
