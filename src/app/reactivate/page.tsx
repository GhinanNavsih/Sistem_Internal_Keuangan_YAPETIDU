"use client";

import React, { useEffect, useState, Suspense } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import {
  Loader2, CheckCircle2, XCircle, ShieldAlert, ArrowRight, Home
} from 'lucide-react';

function ReactivateContent() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const token = searchParams.get('token');

  const [status, setStatus] = useState<'idle' | 'loading' | 'success' | 'error'>('idle');
  const [message, setMessage] = useState<string>('');

  useEffect(() => {
    if (!token) {
      setStatus('error');
      setMessage('Token reaktivasi tidak ditemukan. Harap periksa kembali tautan di email Anda.');
      return;
    }

    const performReactivation = async () => {
      setStatus('loading');
      try {
        const response = await fetch('/api/auth/reactivate', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ token }),
        });

        const data = await response.json();

        if (response.ok && data.success) {
          setStatus('success');
          setMessage(data.message || 'Akun Anda telah berhasil diaktifkan kembali.');
        } else {
          setStatus('error');
          setMessage(data.error || 'Gagal mengaktifkan kembali akun Anda.');
        }
      } catch (err) {
        console.error('Reactivation error:', err);
        setStatus('error');
        setMessage('Terjadi kesalahan jaringan atau server saat mencoba mengaktifkan kembali akun Anda.');
      }
    };

    performReactivation();
  }, [token]);

  return (
    <div className="relative w-full max-w-md">
      {/* Premium Glassmorphic Card */}
      <div className="bg-white/80 dark:bg-slate-900/80 backdrop-blur-xl border border-slate-200/50 dark:border-slate-800/50 shadow-2xl rounded-3xl p-8 sm:p-10 transition-all duration-300">
        
        {/* Header Logo section */}
        <div className="flex flex-col items-center text-center mb-8">
          <div className="flex gap-3 items-center justify-center filter drop-shadow-[0_4px_6px_rgba(0,0,0,0.05)] mb-6">
            <img
              src="/Logo YAPETIDU (Transparent bg).png"
              alt="Logo YAPETIDU"
              className="h-12 w-auto object-contain"
            />
            <div className="w-px h-6 bg-slate-300/60 dark:bg-slate-700/60" />
            <img
              src="/Logo UNIPDU.png"
              alt="Logo UNIPDU"
              className="h-12 w-auto object-contain"
            />
          </div>
          <h2 className="text-2xl font-extrabold text-slate-800 dark:text-slate-100 tracking-tight">
            Reaktivasi Akun
          </h2>
          <p className="text-slate-500 dark:text-slate-400 text-xs mt-1">
            Biro Administrasi Keuangan (BAK) YAPETIDU UNIPDU
          </p>
        </div>

        {/* Dynamic Status Content */}
        <div className="space-y-6 flex flex-col items-center">
          {status === 'loading' && (
            <div className="flex flex-col items-center text-center py-6 space-y-4">
              <div className="relative flex items-center justify-center">
                <div className="w-16 h-16 rounded-full border-4 border-indigo-100 dark:border-indigo-950/50 animate-pulse absolute" />
                <Loader2 className="w-10 h-10 text-indigo-600 dark:text-indigo-400 animate-spin relative" />
              </div>
              <div className="space-y-1">
                <p className="font-semibold text-slate-800 dark:text-slate-200">Sedang Memproses...</p>
                <p className="text-sm text-slate-500 dark:text-slate-400">Harap tunggu, kami sedang mengaktifkan akun Anda.</p>
              </div>
            </div>
          )}

          {status === 'success' && (
            <div className="flex flex-col items-center text-center py-4 space-y-4">
              <div className="w-16 h-16 rounded-full bg-emerald-50 dark:bg-emerald-950/30 flex items-center justify-center text-emerald-600 dark:text-emerald-400 border border-emerald-100 dark:border-emerald-900/50 shadow-sm animate-bounce">
                <CheckCircle2 className="w-10 h-10" />
              </div>
              <div className="space-y-2">
                <p className="font-bold text-slate-900 dark:text-white text-lg">Aktivasi Berhasil!</p>
                <p className="text-sm text-slate-600 dark:text-slate-300 leading-relaxed px-2">
                  {message}
                </p>
              </div>
              <div className="pt-4 w-full">
                <Button
                  id="btn-login-redirect"
                  className="w-full bg-indigo-600 hover:bg-indigo-700 text-white font-semibold py-2.5 h-11 flex items-center justify-center gap-2 shadow-md hover:shadow-indigo-500/20 active:scale-[0.98] transition-all"
                  onClick={() => router.push('/login')}
                >
                  Masuk Sekarang
                  <ArrowRight className="w-4 h-4" />
                </Button>
              </div>
            </div>
          )}

          {status === 'error' && (
            <div className="flex flex-col items-center text-center py-4 space-y-4">
              <div className="w-16 h-16 rounded-full bg-rose-50 dark:bg-rose-950/30 flex items-center justify-center text-rose-600 dark:text-rose-400 border border-rose-100 dark:border-rose-900/50 shadow-sm">
                {token ? <XCircle className="w-10 h-10" /> : <ShieldAlert className="w-10 h-10" />}
              </div>
              <div className="space-y-2">
                <p className="font-bold text-slate-900 dark:text-white text-lg">Aktivasi Gagal</p>
                <p className="text-sm text-rose-600 dark:text-rose-400 bg-rose-500/5 dark:bg-rose-500/10 px-4 py-3 rounded-2xl border border-rose-500/10 leading-relaxed">
                  {message}
                </p>
              </div>
              <div className="pt-4 w-full space-y-2">
                <Button
                  id="btn-back-home"
                  variant="outline"
                  className="w-full font-semibold py-2.5 h-11 flex items-center justify-center gap-2 active:scale-[0.98] transition-all"
                  onClick={() => router.push('/')}
                >
                  <Home className="w-4 h-4" />
                  Kembali ke Beranda
                </Button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export default function ReactivatePage() {
  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 via-indigo-50/80 to-slate-100 dark:from-slate-950 dark:via-slate-900 dark:to-slate-950 flex items-center justify-center p-6 relative overflow-hidden font-sans">
      {/* Decorative Blob backgrounds */}
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        <div className="absolute -top-40 -right-40 w-96 h-96 rounded-full bg-indigo-100/40 dark:bg-indigo-950/20 blur-[120px]" />
        <div className="absolute -bottom-40 -left-40 w-80 h-80 rounded-full bg-purple-100/30 dark:bg-purple-950/15 blur-[100px]" />
      </div>

      <Suspense fallback={
        <div className="bg-white/80 dark:bg-slate-900/80 backdrop-blur-xl border border-slate-200/50 dark:border-slate-800/50 shadow-2xl rounded-3xl p-10 flex items-center justify-center w-full max-w-md h-64">
          <Loader2 className="w-8 h-8 text-indigo-500 animate-spin" />
        </div>
      }>
        <ReactivateContent />
      </Suspense>
    </div>
  );
}
