"use client";

import { useState } from 'react';
import { Copy, Download, FileText, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  BANSOS_SIDE_LABELS,
  BANSOS_STATUS_LABELS,
  bansosRelationshipLabel,
  type BansosRequest,
  type BansosSide,
  type BansosStatus,
} from '@/lib/payroll/bansos';
import { uploadFileTypeFor } from '@/lib/uploadFileTypes';

/** Pieces shared by the employee page, the Admin Karyawan page and the Vakasi panel. */

export function formatRupiah(amount: number): string {
  return `Rp ${Math.round(amount).toLocaleString('id-ID')}`;
}

/** "2026-10-07" → "07 Okt 2026". */
export function formatBansosDate(value: string): string {
  if (!/^\d{4}-\d{2}-\d{2}/.test(value)) return value || '—';
  return new Date(`${value.slice(0, 10)}T00:00:00`).toLocaleDateString('id-ID', {
    day: '2-digit', month: 'short', year: 'numeric',
  });
}

const MONTHS = ['Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni', 'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember'];

/** "2026-10" → "Oktober 2026". */
export function formatBansosPeriod(period: string): string {
  const [year, month] = period.split('-').map(Number);
  return MONTHS[month - 1] ? `${MONTHS[month - 1]} ${year}` : period;
}

/** "Ayah · Pak Darmo" for Duka, "Bayi: Aisyah" (or "—") for Melahirkan. */
export function bansosSubjectText(request: BansosRequest): string {
  if (request.kind === 'duka') {
    return [bansosRelationshipLabel(request), request.subjectName].filter(Boolean).join(' · ');
  }
  return request.subjectName ? `Bayi: ${request.subjectName}` : '—';
}

const STATUS_STYLES: Record<BansosStatus, string> = {
  awaiting_both: 'bg-amber-50 text-amber-700 border-amber-200',
  awaiting_admin: 'bg-amber-50 text-amber-700 border-amber-200',
  awaiting_finance: 'bg-amber-50 text-amber-700 border-amber-200',
  paid: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  rejected: 'bg-rose-50 text-rose-700 border-rose-200',
  withdrawn: 'bg-slate-100 text-slate-700 border-slate-200',
};

export function BansosStatusBadge({ status }: { status: BansosStatus }) {
  return (
    <span className={`inline-flex whitespace-nowrap px-2.5 py-1 rounded-sm text-xs font-semibold border ${STATUS_STYLES[status]}`}>
      {BANSOS_STATUS_LABELS[status]}
    </span>
  );
}

export function EmployeeClassBadge({ request }: { request: BansosRequest }) {
  return request.employeeClass === 'pekarya' ? (
    <span className="px-2 py-0.5 rounded-sm text-[10px] font-bold uppercase tracking-wider bg-teal-50 text-teal-700 border border-teal-200">
      Pekarya{request.jobCategory ? ` · ${request.jobCategory}` : ''}
    </span>
  ) : (
    <span className="px-2 py-0.5 rounded-sm text-[10px] font-bold uppercase tracking-wider bg-indigo-50 text-indigo-700 border border-indigo-200">
      Loyalis
    </span>
  );
}

/** One side's decision as a quiet line: a dot, who, and what they decided. */
export function SideDecision({ request, side }: { request: BansosRequest; side: BansosSide }) {
  const decision = side === 'admin' ? request.adminDecision : request.financeDecision;
  const reason = side === 'admin' ? request.adminReason : request.financeReason;
  const by = side === 'admin' ? request.adminByName : request.financeByName;
  const dot = decision === 'accepted' ? 'bg-emerald-500' : decision === 'rejected' ? 'bg-rose-500' : 'bg-amber-400';
  const text = decision === 'accepted' ? 'Diterima' : decision === 'rejected' ? 'Ditolak' : 'Menunggu';
  return (
    <div className="text-xs leading-relaxed">
      <span className="inline-flex items-center gap-1.5 text-slate-600">
        <span className={`size-2 rounded-full ${dot}`} aria-hidden />
        <span className="font-semibold">{BANSOS_SIDE_LABELS[side]}:</span> {text}
        {by && decision !== 'pending' ? <span className="text-slate-400">({by})</span> : null}
      </span>
      {decision === 'rejected' && reason ? <p className="mt-0.5 pl-3.5 text-rose-700">“{reason}”</p> : null}
    </div>
  );
}

/** Opens the proof: images and PDFs inline, other formats as a download. */
export function BansosProofButton({ request, className = '' }: { request: BansosRequest; className?: string }) {
  const [open, setOpen] = useState(false);
  const type = uploadFileTypeFor(request.proofContentType);
  const isPdf = type?.mime === 'application/pdf';
  return (
    <>
      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={() => setOpen(true)}
        className={`rounded-sm border-slate-200 text-slate-600 hover:text-indigo-600 hover:border-indigo-200 bg-white font-semibold shadow-sm ${className}`}
      >
        <FileText className="size-3.5" /> Lihat bukti
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="rounded-md sm:max-w-3xl">
          <DialogHeader>
            <DialogTitle className="text-base font-semibold text-slate-800">Bukti · {request.employeeName}</DialogTitle>
            <DialogDescription className="text-xs text-slate-500 truncate">{request.proofName}</DialogDescription>
          </DialogHeader>
          {type && !type.inlinePreview ? (
            <div className="rounded-md border border-slate-200 bg-slate-50 p-5 text-sm text-slate-700">
              Bukti ini berformat {type.label}, yang tidak bisa ditampilkan langsung di peramban.
            </div>
          ) : isPdf ? (
            <iframe title={`Bukti ${request.employeeName}`} src={request.proofUrl} className="h-[70vh] w-full rounded-md border border-slate-200" />
          ) : (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={request.proofUrl} alt={`Bukti ${request.employeeName}`} className="max-h-[70vh] w-full rounded-md border border-slate-200 object-contain bg-slate-50" />
          )}
          <DialogFooter>
            <Button
              variant="outline"
              className="rounded-sm border-slate-200"
              render={<a href={request.proofUrl} target="_blank" rel="noopener noreferrer" download={request.proofName} />}
            >
              <Download className="size-4" /> Unduh berkas
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

export function DuplicateHint() {
  return (
    <span
      className="inline-flex items-center gap-1 px-2 py-0.5 rounded-sm text-[10px] font-bold bg-orange-50 text-orange-700 border border-orange-200"
      title="Ada ajuan lain dari pegawai yang sama dengan jenis dan tanggal yang sama."
    >
      <Copy className="size-3" /> Mungkin ganda
    </span>
  );
}

/** Asks for the reason before a rejection; the reason is shown to the employee. */
export function BansosRejectDialog({
  request,
  loading,
  onOpenChange,
  onConfirm,
}: {
  request: BansosRequest | null;
  loading: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: (reason: string) => void;
}) {
  const [reason, setReason] = useState('');
  const tooShort = reason.trim().length < 3;
  return (
    <Dialog
      open={Boolean(request)}
      onOpenChange={(open) => {
        if (!open) setReason('');
        onOpenChange(open);
      }}
    >
      <DialogContent showCloseButton={false} className="rounded-md sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="text-base font-semibold text-slate-800">Tolak ajuan?</DialogTitle>
          <DialogDescription className="text-sm text-slate-600">
            Ajuan {request?.employeeName} tidak dibayar. Alasan di bawah ditampilkan kepada pegawai.
          </DialogDescription>
        </DialogHeader>
        <label htmlFor="bansos-reject-reason" className="text-xs font-bold text-slate-500 uppercase tracking-wider">Alasan penolakan</label>
        <textarea
          id="bansos-reject-reason"
          value={reason}
          onChange={(event) => setReason(event.target.value)}
          maxLength={500}
          rows={3}
          className="w-full rounded-sm border border-slate-200 p-3 text-sm text-slate-700 hover:border-indigo-300 focus:border-indigo-500 focus:outline-none transition-all"
          placeholder="Contoh: Bukti tidak terbaca, mohon ajukan ulang dengan surat kematian."
        />
        <DialogFooter>
          <Button variant="ghost" className="rounded-sm text-slate-500" disabled={loading} onClick={() => onOpenChange(false)}>
            Kembali
          </Button>
          <Button
            className="rounded-sm text-rose-600 border border-rose-200 bg-rose-50 hover:bg-rose-100 hover:text-rose-700 hover:border-rose-300"
            disabled={loading || tooShort}
            onClick={() => onConfirm(reason.trim())}
          >
            {loading ? <Loader2 className="size-4 animate-spin" /> : null} Tolak ajuan
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
