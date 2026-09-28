"use client";

import { Suspense, useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { CheckCircle2, XCircle } from 'lucide-react';

type Result = { verified: boolean; unitName?: string; academicYear?: string; month?: number; submittedName?: string; bakApprovedName?: string; rectorApprovedName?: string; income?: number; expense?: number; endingCash?: number };

function Verification() {
  const params = useSearchParams();
  const [result, setResult] = useState<Result | null>(null);
  useEffect(() => {
    const query = new URLSearchParams({ unitId: params.get('unitId') || '', academicYear: params.get('academicYear') || '', month: params.get('month') || '', code: params.get('code') || '' });
    void fetch(`/api/satker-finance/verify?${query}`, { cache: 'no-store' }).then((response) => response.json()).then(setResult).catch(() => setResult({ verified: false }));
  }, [params]);
  return <main className="flex min-h-screen items-center justify-center bg-slate-50 p-4"><section className="w-full max-w-lg rounded-2xl border border-slate-200 bg-white p-8 shadow-lg"><p className="text-xs font-bold uppercase tracking-widest text-indigo-600">Internal BAK · UNIPDU</p><h1 className="mt-2 text-2xl font-extrabold text-slate-900">Verifikasi Laporan Keuangan SatKer</h1>{!result ? <p className="mt-6 text-slate-500">Memeriksa tanda pengesahan...</p> : result.verified ? <div className="mt-6 space-y-4"><div className="flex items-center gap-2 font-bold text-emerald-700"><CheckCircle2 /> Laporan sah dan telah disahkan Rektorat</div><p className="text-sm text-slate-600">{result.unitName} · Tahun akademik {result.academicYear} · Bulan {result.month}</p><div className="grid grid-cols-2 gap-3 rounded-xl bg-slate-50 p-4 text-sm"><span>Penerimaan</span><strong className="text-right">Rp {new Intl.NumberFormat('id-ID').format(result.income || 0)}</strong><span>Pengeluaran</span><strong className="text-right">Rp {new Intl.NumberFormat('id-ID').format(result.expense || 0)}</strong><span>Saldo kas</span><strong className="text-right">Rp {new Intl.NumberFormat('id-ID').format(result.endingCash || 0)}</strong></div><div className="text-xs text-slate-500">Disusun: {result.submittedName || '—'}<br />BAK: {result.bakApprovedName || '—'}<br />Rektorat: {result.rectorApprovedName || '—'}</div></div> : <div className="mt-6 flex items-center gap-2 font-bold text-rose-700"><XCircle /> Laporan atau kode verifikasi tidak valid.</div>}</section></main>;
}

export default function VerifyPage() { return <Suspense fallback={<main className="min-h-screen bg-slate-50" />}><Verification /></Suspense>; }
