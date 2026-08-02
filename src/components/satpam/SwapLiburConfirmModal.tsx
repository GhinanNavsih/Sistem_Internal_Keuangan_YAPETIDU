"use client";

import { AlertTriangle, Banknote, CalendarDays, Loader2, Repeat2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';

export type SwapLiburPrompt = {
  dateX: string;
  dateY: string | null;
  guardAName: string;
  guardBName: string;
};

export function SwapLiburConfirmModal(props: {
  open: boolean;
  prompt: SwapLiburPrompt | null;
  working?: boolean;
  error?: string;
  planningMode?: boolean;
  onSwap: () => void;
  onCover: () => void;
  onCancel?: () => void;
}) {
  const {
    open,
    prompt,
    working = false,
    error = '',
    planningMode = false,
    onSwap,
    onCover,
    onCancel,
  } = props;
  if (!prompt) return null;

  const handleDismiss = () => {
    if (working) return;
    if (onCancel) {
      onCancel();
    } else {
      onCover();
    }
  };

  const hasSwapDate = Boolean(prompt.dateY);
  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        if (!nextOpen) handleDismiss();
      }}
    >
      <DialogContent
        showCloseButton={!working}
        className="max-h-[calc(100dvh-2rem)] max-w-[calc(100%-2rem)] overflow-y-auto rounded-3xl border-none bg-white p-0 shadow-2xl sm:max-w-lg"
      >
        <div
          className={`p-5 text-white ${
            hasSwapDate
              ? 'bg-gradient-to-r from-indigo-600 to-violet-600'
              : 'bg-gradient-to-r from-amber-500 to-orange-600'
          }`}
        >
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-xl font-black text-white">
              {hasSwapDate ? (
                <Repeat2 className="h-6 w-6" />
              ) : (
                <AlertTriangle className="h-6 w-6" />
              )}
              {hasSwapDate ? 'Tukar Tanggal Libur?' : 'Libur Tidak Dapat Ditukar'}
            </DialogTitle>
            <DialogDescription className="text-base leading-6 text-white/90">
              {hasSwapDate
                ? `Apakah Anda ingin menukar tanggal libur ${prompt.guardAName} dengan ${prompt.guardBName}?`
                : 'Tidak ada tanggal libur tersisa untuk ditukar pada periode ini.'}
            </DialogDescription>
          </DialogHeader>
        </div>

        <div className="space-y-4 p-5">
          {hasSwapDate ? (
            <div className="space-y-3">
              <div className="rounded-2xl border border-indigo-200 bg-indigo-50 p-4">
                <div className="flex items-center gap-2 font-black text-indigo-950">
                  <CalendarDays className="h-5 w-5" />
                  {prompt.dateX}
                </div>
                <p className="mt-2 text-base leading-6 text-indigo-900">
                  <strong>{prompt.guardBName}</strong> bekerja dan{' '}
                  <strong>{prompt.guardAName}</strong> menjadi Libur.
                </p>
              </div>
              <div className="rounded-2xl border border-violet-200 bg-violet-50 p-4">
                <div className="flex items-center gap-2 font-black text-violet-950">
                  <CalendarDays className="h-5 w-5" />
                  {prompt.dateY}
                </div>
                <p className="mt-2 text-base leading-6 text-violet-900">
                  <strong>{prompt.guardAName}</strong> bekerja dan{' '}
                  <strong>{prompt.guardBName}</strong> menjadi Libur.
                </p>
              </div>
              <p className="text-sm leading-5 text-slate-600">
                Jumlah hari kerja dan Libur keduanya tetap sama. Penugasan
                reguler mengikuti kalender upah pada masing-masing tanggal.
              </p>
            </div>
          ) : (
            <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4 text-amber-950">
              <div className="flex items-start gap-3">
                <Banknote className="mt-0.5 h-6 w-6 shrink-0" />
                <p className="text-base leading-6">
                  Shift ini otomatis dicatat sebagai <strong>Lembur Cover</strong>{' '}
                  (Rp50.000) untuk <strong>{prompt.guardBName}</strong>, menggantikan{' '}
                  <strong>{prompt.guardAName}</strong>.
                </p>
              </div>
            </div>
          )}

          {error && (
            <div role="alert" className="rounded-xl border border-rose-200 bg-rose-50 p-3 text-sm font-semibold text-rose-800">
              {error}
            </div>
          )}
        </div>

        <DialogFooter className="m-0 gap-3 rounded-none px-5 pb-5 pt-4 sm:flex-row">
          {hasSwapDate && (
            <Button
              type="button"
              variant="outline"
              className="min-h-12 flex-1 border-amber-300 bg-amber-50 text-base font-black text-amber-900 hover:bg-amber-100"
              disabled={working}
              onClick={onCover}
            >
              <Banknote className="h-5 w-5" />
              {planningMode ? 'Lembur Cover Saat Laporan' : 'Lembur Cover'}
            </Button>
          )}
          <Button
            type="button"
            className={`min-h-12 flex-1 text-base font-black ${
              hasSwapDate
                ? 'bg-indigo-600 hover:bg-indigo-700'
                : 'bg-amber-600 hover:bg-amber-700'
            }`}
            disabled={working}
            onClick={hasSwapDate ? onSwap : onCover}
          >
            {working ? (
              <Loader2 className="h-5 w-5 animate-spin" />
            ) : hasSwapDate ? (
              <Repeat2 className="h-5 w-5" />
            ) : (
              <Banknote className="h-5 w-5" />
            )}
            {working
              ? 'Menyimpan…'
              : hasSwapDate
                ? 'Tukar Libur'
                : planningMode
                  ? 'Mengerti'
                  : 'Catat Lembur Cover'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
