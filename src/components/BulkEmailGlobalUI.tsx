"use client";

import React from 'react';
import { useBulkEmail } from '@/lib/BulkEmailContext';
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
  CheckCircle2,
  Loader2,
  X,
  RefreshCw,
  Pause,
  Play
} from 'lucide-react';

export default function BulkEmailGlobalUI() {
  const {
    sendingBulkEmail,
    bulkEmailProgress,
    emailTargetCount,
    currentBulkEmailAddress,
    bulkEmailResults,
    showBulkSnackbar,
    setShowBulkSnackbar,
    showBulkDetailModal,
    setShowBulkDetailModal,
    bulkEmailDone,
    isBulkEmailPaused,
    pauseBulkEmailJob,
    resumeBulkEmailJob,
    retryFailedEmails,
    dismissJob
  } = useBulkEmail();

  if (!showBulkSnackbar) return null;

  return (
    <>
      {/* ─── Bulk Email Floating Snackbar ───────────────────── */}
      <div
        onClick={() => setShowBulkDetailModal(true)}
        className="fixed bottom-6 left-1/2 -translate-x-1/2 z-[9998] w-[480px] max-w-[calc(100vw-2rem)] cursor-pointer group"
      >
        <div className={`relative overflow-hidden rounded-2xl border shadow-xl transition-all duration-300 ${
          bulkEmailDone
            ? (bulkEmailResults.some(r => r.status === 'failed')
              ? 'bg-amber-50 border-amber-200'
              : 'bg-emerald-50 border-emerald-200')
            : 'bg-white border-slate-200'
        }`}>
          {/* Progress bar */}
          {!bulkEmailDone && (
            <div
              className={`absolute bottom-0 left-0 h-1 transition-all duration-500 ease-out bg-gradient-to-r ${
                isBulkEmailPaused
                  ? 'from-amber-400 to-amber-500'
                  : 'from-indigo-500 to-violet-500'
              }`}
              style={{ width: `${emailTargetCount > 0 ? (bulkEmailProgress / emailTargetCount) * 100 : 0}%` }}
            />
          )}

          <div className="flex items-center justify-between px-4 py-3">
            <div className="flex items-center gap-3 min-w-0 flex-1">
              {bulkEmailDone ? (
                bulkEmailResults.some(r => r.status === 'failed') ? (
                  <AlertCircle className="w-5 h-5 text-amber-600 flex-shrink-0" />
                ) : (
                  <CheckCircle2 className="w-5 h-5 text-emerald-600 flex-shrink-0" />
                )
              ) : isBulkEmailPaused ? (
                <Pause className="w-5 h-5 text-amber-500 flex-shrink-0 animate-pulse" />
              ) : (
                <Loader2 className="w-5 h-5 text-indigo-600 animate-spin flex-shrink-0" />
              )}
              <div className="min-w-0 flex-1">
                {bulkEmailDone ? (
                  <>
                    <p className="text-sm font-semibold text-slate-800">
                      Selesai — {bulkEmailResults.filter(r => r.status === 'success').length} berhasil, {bulkEmailResults.filter(r => r.status === 'failed').length} gagal
                    </p>
                    <p className="text-xs text-slate-500 mt-0.5">Klik untuk melihat detail</p>
                  </>
                ) : (
                  <>
                    <p className="text-sm font-semibold text-slate-800">
                      {isBulkEmailPaused ? 'Pengiriman Ditangguhkan' : 'Mengirim Email'} ({bulkEmailProgress}/{emailTargetCount})
                    </p>
                    <p className="text-xs text-slate-500 truncate mt-0.5">
                      {isBulkEmailPaused ? 'Dihentikan sementara (Klik untuk detail)' : (currentBulkEmailAddress || 'Mempersiapkan...')}
                    </p>
                  </>
                )}
              </div>
            </div>
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                dismissJob();
              }}
              className="ml-2 p-1 rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-100 transition-colors flex-shrink-0"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>
      </div>

      {/* ─── Bulk Email Detail Modal ────────────────────────── */}
      <Dialog open={showBulkDetailModal} onOpenChange={setShowBulkDetailModal}>
        <DialogContent className="sm:max-w-lg max-h-[80vh] rounded-2xl flex flex-col">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-lg">
              <Mail className="w-5 h-5 text-indigo-600" />
              Detail Pengiriman Email
            </DialogTitle>
            <DialogDescription className="text-slate-500 text-sm">
              {bulkEmailDone
                ? `${bulkEmailResults.filter(r => r.status === 'success').length} berhasil, ${bulkEmailResults.filter(r => r.status === 'failed').length} gagal dari ${bulkEmailResults.length} total`
                : isBulkEmailPaused
                  ? `Pengiriman dihentikan sementara pada ${bulkEmailProgress} dari ${emailTargetCount} email.`
                  : `Mengirim ${bulkEmailProgress} dari ${emailTargetCount}...`
              }
            </DialogDescription>
          </DialogHeader>

          <div className="flex-1 overflow-y-auto space-y-4 mt-2 pr-1">
            {/* Failed section */}
            {bulkEmailResults.some(r => r.status === 'failed') && (
              <div>
                <div className="flex items-center gap-2 mb-2">
                  <div className="w-2 h-2 rounded-full bg-rose-500" />
                  <span className="text-sm font-semibold text-rose-700">Gagal ({bulkEmailResults.filter(r => r.status === 'failed').length})</span>
                </div>
                <div className="space-y-1.5">
                  {bulkEmailResults.filter(r => r.status === 'failed').map((r, idx) => (
                    <div key={`fail-${idx}`} className="flex items-center gap-3 px-3 py-2 bg-rose-50 border border-rose-100 rounded-xl">
                      <AlertCircle className="w-4 h-4 text-rose-500 flex-shrink-0" />
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-medium text-slate-800 truncate">{r.employeeName}</p>
                        <p className="text-xs text-slate-500 truncate">{r.email}</p>
                        {r.error && <p className="text-[10px] text-rose-600 mt-0.5">{r.error}</p>}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Success section */}
            {bulkEmailResults.some(r => r.status === 'success') && (
              <div>
                <div className="flex items-center gap-2 mb-2">
                  <div className="w-2 h-2 rounded-full bg-emerald-500" />
                  <span className="text-sm font-semibold text-emerald-700">Berhasil ({bulkEmailResults.filter(r => r.status === 'success').length})</span>
                </div>
                <div className="space-y-1.5">
                  {bulkEmailResults.filter(r => r.status === 'success').map((r, idx) => (
                    <div key={`success-${idx}`} className="flex items-center gap-3 px-3 py-2 bg-emerald-50 border border-emerald-100 rounded-xl">
                      <CheckCircle2 className="w-4 h-4 text-emerald-500 flex-shrink-0" />
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-medium text-slate-800 truncate">{r.employeeName}</p>
                        <p className="text-xs text-slate-500 truncate">{r.email}</p>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Pending section */}
            {bulkEmailResults.some(r => r.status === 'pending') && (
              <div>
                <div className="flex items-center gap-2 mb-2">
                  <div className="w-2 h-2 rounded-full bg-slate-300" />
                  <span className="text-sm font-semibold text-slate-500">Menunggu ({bulkEmailResults.filter(r => r.status === 'pending').length})</span>
                </div>
                <div className="space-y-1.5">
                  {bulkEmailResults.filter(r => r.status === 'pending').map((r, idx) => (
                    <div key={`pending-${idx}`} className="flex items-center gap-3 px-3 py-2 bg-slate-50 border border-slate-100 rounded-xl">
                      <div className="w-4 h-4 rounded-full border-2 border-slate-300 flex-shrink-0" />
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-medium text-slate-500 truncate">{r.employeeName}</p>
                        <p className="text-xs text-slate-400 truncate">{r.email}</p>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* Pause / Resume Controls during execution */}
          {!bulkEmailDone && (
            <div className="flex justify-end gap-2 pt-4 border-t border-slate-100 mt-2">
              {isBulkEmailPaused ? (
                <Button
                  onClick={resumeBulkEmailJob}
                  className="rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white"
                >
                  <Play className="w-4 h-4 mr-2" />
                  Continue (Lanjutkan)
                </Button>
              ) : (
                <Button
                  onClick={pauseBulkEmailJob}
                  className="rounded-xl bg-rose-600 hover:bg-rose-700 text-white"
                >
                  <Pause className="w-4 h-4 mr-2" />
                  Stop (Hentikan Sementara)
                </Button>
              )}
            </div>
          )}

          {/* Retry button */}
          {bulkEmailDone && bulkEmailResults.some(r => r.status === 'failed') && (
            <div className="flex justify-end pt-4 border-t border-slate-100 mt-2">
              <Button
                onClick={retryFailedEmails}
                className="rounded-xl bg-amber-500 hover:bg-amber-600 text-white"
              >
                <RefreshCw className="w-4 h-4 mr-2" />
                Kirim Ulang yang Gagal ({bulkEmailResults.filter(r => r.status === 'failed').length})
              </Button>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
