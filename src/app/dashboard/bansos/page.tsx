"use client";

import { useCallback, useEffect, useRef, useState } from 'react';
import { AlertCircle, HandHeart, Info, Loader2, RefreshCw } from 'lucide-react';
import BansosReviewTable, { type BansosDecisionInput } from '@/components/bansos/BansosReviewTable';
import { FloatingSnackbar, type SnackbarMessage } from '@/components/ui/floating-snackbar';
import { useAuth } from '@/lib/AuthContext';
import type { BansosRequest } from '@/lib/payroll/bansos';
import { authenticatedJson, createFinancialRequestId } from '@/lib/payroll/client';

/**
 * Verifikasi BanSos: Admin Karyawan's side of each Ajuan Duka / Melahirkan.
 * Super Admin decides the other side (and the amount) in the Vakasi page, so
 * here Super Admin only looks.
 */

type Tab = 'waiting' | 'decided' | 'all';

const TABS: { value: Tab; label: string }[] = [
  { value: 'waiting', label: 'Menunggu Verifikasi' },
  { value: 'decided', label: 'Sudah Diputuskan' },
  { value: 'all', label: 'Semua' },
];

export default function BansosVerificationPage() {
  const { profile } = useAuth();
  const canDecide = profile?.role === 'loyalis_admin';
  const [tab, setTab] = useState<Tab>('waiting');
  const [requests, setRequests] = useState<BansosRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState<SnackbarMessage | null>(null);
  const sequence = useRef(0);

  const load = useCallback(async (silent = false) => {
    const current = ++sequence.current;
    if (!silent) setLoading(true);
    try {
      const result = await authenticatedJson<{ requests: BansosRequest[] }>(`/api/payroll/bansos?tab=${tab}`);
      if (current !== sequence.current) return;
      setRequests(result.requests);
      setError('');
    } catch (cause) {
      if (current !== sequence.current) return;
      setError(cause instanceof Error ? cause.message : 'Daftar ajuan gagal dimuat.');
    } finally {
      if (current === sequence.current) setLoading(false);
    }
  }, [tab]);

  useEffect(() => {
    const timer = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  const decide = async (request: BansosRequest, input: BansosDecisionInput) => {
    try {
      const result = await authenticatedJson<{ status: string }>('/api/payroll/bansos', {
        method: 'POST',
        body: JSON.stringify({
          requestId: createFinancialRequestId('bansos_admin'),
          bansosRequestId: request.id,
          expectedRevision: request.revision,
          ...input,
        }),
      });
      setNotice({
        type: 'success',
        text: input.action === 'reset'
          ? 'Keputusan dibatalkan.'
          : input.action === 'reject'
            ? 'Ajuan ditolak.'
            : result.status === 'paid'
              ? 'Ajuan diterima dan santunan masuk ke slip/SPJ.'
              : 'Ajuan diterima. Menunggu keputusan Super Admin.',
      });
    } catch (cause) {
      setNotice({ type: 'error', text: cause instanceof Error ? cause.message : 'Keputusan gagal disimpan.' });
    }
    await load(true);
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 via-indigo-50/80 to-slate-100 p-6 lg:p-8 pb-24 lg:pb-32 font-sans selection:bg-indigo-100 relative overflow-hidden">
      <div className="absolute top-0 right-0 w-[600px] h-[600px] rounded-full bg-indigo-100/40 blur-[120px] pointer-events-none" />
      <div className="absolute bottom-0 left-0 w-[500px] h-[500px] rounded-full bg-purple-100/30 blur-[100px] pointer-events-none" />
      <FloatingSnackbar message={notice} onDismiss={() => setNotice(null)} />

      <div className="max-w-[1600px] mx-auto space-y-8 relative z-10">
        <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
          <div className="space-y-1">
            <h1 className="text-3xl font-bold text-slate-800 flex items-center gap-3">
              <HandHeart className="size-7 text-indigo-500" /> Verifikasi BanSos
            </h1>
            <p className="text-slate-500 text-sm">
              Periksa bukti Ajuan Duka dan Ajuan Melahirkan pegawai. Santunan dibayar setelah Anda dan Super Admin sama-sama menerima.
            </p>
          </div>
          <button
            type="button"
            onClick={() => void load()}
            className="rounded-sm border border-slate-200 text-slate-600 hover:text-indigo-600 hover:border-indigo-200 bg-white font-semibold transition-all shadow-sm flex items-center gap-2 px-4 h-10 text-sm cursor-pointer w-fit"
          >
            <RefreshCw className="size-4" /> Muat ulang
          </button>
        </div>

        {!canDecide && (
          <div className="flex items-center gap-2 px-4 py-3 rounded-md text-sm font-medium bg-indigo-50 text-indigo-700 border border-indigo-200">
            <Info className="size-4 shrink-0" />
            Halaman ini hanya untuk dilihat. Verifikasi dilakukan Admin Karyawan; keputusan Super Admin ada di halaman Vakasi Tambahan.
          </div>
        )}

        <div className="flex bg-white p-1 rounded-md w-fit shadow-sm border border-slate-200/60 overflow-x-auto max-w-full">
          {TABS.map((option) => (
            <button
              key={option.value}
              type="button"
              onClick={() => setTab(option.value)}
              className={`px-5 py-2.5 rounded-sm text-xs font-bold transition-all flex items-center gap-2 whitespace-nowrap cursor-pointer ${
                tab === option.value
                  ? 'bg-indigo-600 text-white shadow-sm'
                  : 'text-slate-500 hover:text-slate-800 hover:bg-slate-50'
              }`}
            >
              {option.label}
            </button>
          ))}
        </div>

        {error && (
          <div role="alert" className="flex items-center gap-2 px-4 py-3 rounded-md text-sm font-medium bg-red-50 text-red-700 border border-red-200">
            <AlertCircle className="size-4 shrink-0" /> {error}
          </div>
        )}

        <div className="bg-white rounded-md shadow-[0_8px_30px_rgb(0,0,0,0.04)] p-6 space-y-4">
          <h2 className="text-lg font-bold text-slate-800">{TABS.find((option) => option.value === tab)?.label}</h2>
          {loading ? (
            <div className="py-12 flex justify-center items-center text-slate-400 text-sm">
              <Loader2 className="size-4 animate-spin mr-2" /> Memuat ajuan...
            </div>
          ) : requests.length === 0 ? (
            <p className="py-12 text-center text-sm text-slate-400">
              {tab === 'waiting' ? 'Tidak ada ajuan yang menunggu verifikasi.' : 'Belum ada ajuan.'}
            </p>
          ) : (
            <BansosReviewTable requests={requests} side="admin" canDecide={canDecide} onDecide={decide} />
          )}
        </div>
      </div>
    </div>
  );
}
