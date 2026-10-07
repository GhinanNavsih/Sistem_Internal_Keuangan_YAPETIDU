"use client";

import { useCallback, useEffect, useRef, useState } from 'react';
import { AlertCircle, HandHeart, Loader2 } from 'lucide-react';
import { Card } from '@/components/ui/card';
import BansosReviewTable, { type BansosDecisionInput } from '@/components/bansos/BansosReviewTable';
import { formatBansosPeriod, formatRupiah } from '@/components/bansos/BansosParts';
import {
  BANSOS_KIND_LABELS,
  bansosCounts,
  type BansosKind,
  type BansosRequest,
} from '@/lib/payroll/bansos';
import { authenticatedJson, createFinancialRequestId } from '@/lib/payroll/client';

interface Props {
  period: string;
  kind: BansosKind;
  /** The event document's revision; a change (from any reviewer) reloads the list. */
  eventRevision: number;
  /** Super Admin decides; Badan Keuangan only looks. */
  canDecide: boolean;
  onMessage: (message: { type: 'success' | 'error'; text: string }) => void;
}

/**
 * The "Rincian Kegiatan" of a BanSos event: every Ajuan Duka or Ajuan
 * Melahirkan of the month, each decided on its own. It replaces the usual
 * event form, since the recipients come from the employees' ajuan rather than
 * being typed in, and each one is paid only once Admin Karyawan has accepted
 * it too.
 */
export default function BansosEventPanel({ period, kind, eventRevision, canDecide, onMessage }: Props) {
  const [requests, setRequests] = useState<BansosRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const sequence = useRef(0);

  const load = useCallback(async (silent = false) => {
    const current = ++sequence.current;
    if (!silent) setLoading(true);
    try {
      const result = await authenticatedJson<{ requests: BansosRequest[] }>(
        `/api/payroll/bansos?period=${encodeURIComponent(period)}&kind=${kind}`,
      );
      if (current !== sequence.current) return;
      setRequests(result.requests);
      setError('');
    } catch (cause) {
      if (current !== sequence.current) return;
      setError(cause instanceof Error ? cause.message : 'Daftar ajuan gagal dimuat.');
    } finally {
      if (current === sequence.current) setLoading(false);
    }
  }, [period, kind]);

  useEffect(() => {
    const timer = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  // The event changes when either reviewer decides; follow it quietly.
  const firstRevision = useRef(eventRevision);
  useEffect(() => {
    if (eventRevision === firstRevision.current) return;
    firstRevision.current = eventRevision;
    void load(true);
  }, [eventRevision, load]);

  const decide = async (request: BansosRequest, input: BansosDecisionInput) => {
    try {
      const result = await authenticatedJson<{ status: string; paidPeriod?: string; propagationSummary?: Record<string, number> }>(
        '/api/payroll/bansos',
        {
          method: 'POST',
          body: JSON.stringify({
            requestId: createFinancialRequestId('bansos_finance'),
            bansosRequestId: request.id,
            expectedRevision: request.revision,
            ...input,
          }),
        },
      );
      const blocked = (result.propagationSummary?.blocked_status || 0) + (result.propagationSummary?.immutable || 0);
      const text = input.action === 'reset'
        ? 'Keputusan dibatalkan.'
        : input.action === 'reject'
          ? 'Ajuan ditolak.'
          : result.status === 'paid'
            ? `Ajuan disetujui${result.paidPeriod ? `. Periode asalnya sudah ditutup, jadi dibayar di periode ${formatBansosPeriod(result.paidPeriod)}` : ''}.${blocked > 0 ? ` ${blocked} slip terkunci tidak diubah.` : ''}`
            : 'Ajuan diterima. Menunggu verifikasi Admin Karyawan.';
      onMessage({ type: 'success', text });
    } catch (cause) {
      onMessage({ type: 'error', text: cause instanceof Error ? cause.message : 'Keputusan gagal disimpan.' });
    }
    await load(true);
  };

  const counts = bansosCounts(requests);
  const totalPaid = requests
    .filter((request) => request.status === 'paid')
    .reduce((sum, request) => sum + request.amount, 0);

  return (
    <Card className="bg-white rounded-md shadow-[0_8px_30px_rgb(0,0,0,0.04)] border-none p-6 space-y-6">
      <div className="flex flex-wrap justify-between items-start gap-3 pb-4 border-b border-slate-100">
        <div>
          <h3 className="font-bold text-slate-800 text-sm flex items-center gap-2">
            <HandHeart className="size-4 text-indigo-500" /> Rincian Kegiatan · {BANSOS_KIND_LABELS[kind]}
          </h3>
          <p className="text-xs text-slate-500 mt-1">
            Ajuan BanSos {formatBansosPeriod(period)}. Santunan dibayar setelah Admin Karyawan dan Super Admin sama-sama menerima.
            {canDecide ? ' Nominal terisi otomatis dan dapat diubah sebelum menerima.' : ''}
          </p>
        </div>
        <div className="flex flex-wrap gap-2 text-xs font-semibold">
          <span className="px-2.5 py-1 rounded-sm bg-amber-50 text-amber-700 border border-amber-200">{counts.waiting} menunggu</span>
          <span className="px-2.5 py-1 rounded-sm bg-emerald-50 text-emerald-700 border border-emerald-200">{counts.paid} disetujui · {formatRupiah(totalPaid)}</span>
          {counts.rejected > 0 && (
            <span className="px-2.5 py-1 rounded-sm bg-rose-50 text-rose-700 border border-rose-200">{counts.rejected} ditolak</span>
          )}
        </div>
      </div>

      {error && (
        <div role="alert" className="flex items-center gap-2 px-4 py-3 rounded-md text-sm font-medium bg-red-50 text-red-700 border border-red-200">
          <AlertCircle className="size-4 shrink-0" /> {error}
        </div>
      )}

      {loading ? (
        <div className="py-12 flex justify-center items-center text-slate-400 text-xs">
          <Loader2 className="size-4 animate-spin mr-2" /> Memuat ajuan...
        </div>
      ) : requests.length === 0 ? (
        <p className="py-12 text-center text-xs text-slate-400">Belum ada ajuan pada periode ini.</p>
      ) : (
        <BansosReviewTable
          requests={requests}
          side="finance"
          canDecide={canDecide}
          period={period}
          showKind={false}
          onDecide={decide}
        />
      )}
    </Card>
  );
}
