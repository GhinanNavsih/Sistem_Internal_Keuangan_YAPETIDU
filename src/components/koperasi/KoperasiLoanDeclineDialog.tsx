"use client";

import { useState } from 'react';
import { Loader2, XCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { authenticatedJson } from '@/lib/payroll/client';
import {
  validateKoperasiDeclineReason,
  KOPERASI_ADMIN_DECLINE_STATUS,
  KOPERASI_MAX_NOTE_LENGTH,
} from '@/lib/payroll/koperasiLoanApplication';

export interface DeclinableLoan {
  id: string;
  status: string;
  borrowerName: string;
  jumlahPinjaman: number;
  restructuredFromLoanId?: string;
}

const rupiah = (value: unknown) => `Rp ${Math.round(Number(value) || 0).toLocaleString('id-ID')}`;
const newRequestId = () => crypto.randomUUID();

/**
 * Asks Super Admin for a reason, then declines the application in the Koperasi
 * project. Render with `key={loan?.id}` so each opened loan starts fresh.
 */
export default function KoperasiLoanDeclineDialog({ loan, onClose, onDeclined }: {
  loan: DeclinableLoan | null;
  onClose: () => void;
  onDeclined: (text: string) => Promise<void> | void;
}) {
  const [reason, setReason] = useState('');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  // One id per opened dialog (the parent keys this component by loan id), so a
  // retried submit is recognised server-side instead of applied twice.
  const [requestId] = useState(newRequestId);

  const close = () => {
    if (!submitting) onClose();
  };

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!loan || submitting) return;
    const reasonError = validateKoperasiDeclineReason(reason);
    if (reasonError) { setError(reasonError); return; }
    setSubmitting(true);
    setError('');
    try {
      await authenticatedJson('/api/admin/koperasi-loans/decline', {
        method: 'POST',
        body: JSON.stringify({ loanId: loan.id, expectedStatus: loan.status, reason: reason.trim(), requestId }),
      });
      const who = loan.borrowerName ? ` ${loan.borrowerName}` : '';
      await onDeclined(`Pinjaman${who} ditolak. Anggota dapat mengajukan pinjaman baru.`);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Gagal menolak pinjaman.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={loan !== null} onOpenChange={open => { if (!open) close(); }}>
      {loan && (
        <DialogContent className="sm:max-w-md w-[95vw] p-6 rounded-md border-none shadow-2xl bg-white">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-base font-bold text-slate-900">
              <XCircle className="size-5 text-rose-600" />
              Tolak pengajuan pinjaman
            </DialogTitle>
            <DialogDescription className="text-xs text-slate-500">
              Status menjadi {KOPERASI_ADMIN_DECLINE_STATUS} di SAKU dan aplikasi Koperasi. Anggota dapat mengajukan pinjaman baru setelah ini.
            </DialogDescription>
          </DialogHeader>

          <form onSubmit={submit} className="space-y-4">
            <div className="space-y-2 rounded-md border border-slate-100 bg-slate-50/70 p-3.5 text-xs">
              <div className="flex justify-between gap-3"><span className="text-slate-500">Peminjam</span><span className="text-right font-semibold text-slate-800">{loan.borrowerName || '—'}</span></div>
              <div className="flex justify-between gap-3"><span className="text-slate-500">Jumlah</span><span className="text-right font-semibold tabular-nums text-slate-800">{rupiah(loan.jumlahPinjaman)}</span></div>
              <div className="flex justify-between gap-3"><span className="text-slate-500">Status saat ini</span><span className="text-right font-semibold text-slate-800">{loan.status}</span></div>
            </div>

            {loan.restructuredFromLoanId && (
              <p className="rounded-md border border-purple-200 bg-purple-50 px-3.5 py-2.5 text-xs text-purple-800">
                Ini pengajuan restrukturisasi. Pinjaman lama dikembalikan ke status Disetujui dan Aktif.
              </p>
            )}

            <div className="space-y-1.5">
              <Label htmlFor="decline-reason" className="text-xs font-semibold text-slate-600">Alasan penolakan</Label>
              <textarea
                id="decline-reason"
                value={reason}
                onChange={event => setReason(event.target.value.slice(0, KOPERASI_MAX_NOTE_LENGTH))}
                rows={3}
                required
                placeholder="Alasan ini ditampilkan kepada anggota"
                className="w-full resize-none rounded-sm border border-slate-200 px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-rose-500/40"
              />
              <p className="text-[11px] text-slate-400">{reason.length}/{KOPERASI_MAX_NOTE_LENGTH} karakter</p>
            </div>

            {error && <p role="alert" className="rounded-md bg-rose-50 p-3 text-xs text-rose-700">{error}</p>}

            <div className="flex justify-end gap-2">
              <Button type="button" variant="outline" onClick={close} disabled={submitting} className="h-9 rounded-sm border-slate-200 px-4 text-xs font-semibold text-slate-600">
                Batal
              </Button>
              <Button type="submit" disabled={submitting || !reason.trim()} className="h-9 rounded-sm bg-rose-600 px-4 text-xs font-semibold text-white hover:bg-rose-700">
                {submitting ? <><Loader2 className="size-3.5 animate-spin" /> Memproses...</> : 'Tolak pinjaman'}
              </Button>
            </div>
          </form>
        </DialogContent>
      )}
    </Dialog>
  );
}
