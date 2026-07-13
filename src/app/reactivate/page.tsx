"use client";

import React, { useEffect, useState, Suspense } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Loader2, CheckCircle2, XCircle, ShieldAlert, ArrowRight, Home, Lock, Eye, EyeOff
} from 'lucide-react';

function ReactivateContent() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const token = searchParams.get('token');

  // Page States: 'loading' (initial check), 'input_password', 'submitting', 'success', 'error'
  const [status, setStatus] = useState<'loading' | 'input_password' | 'submitting' | 'success' | 'error'>('loading');
  const [message, setMessage] = useState<string>('');
  const [displayName, setDisplayName] = useState<string>('');
  
  // Form States
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  // 1. Validate token on mount
  useEffect(() => {
    if (!token) {
      setStatus('error');
      setMessage('Token reaktivasi tidak ditemukan. Harap periksa kembali tautan di email Anda.');
      return;
    }

    const verifyToken = async () => {
      try {
        const response = await fetch(`/api/auth/reactivate?token=${token}`);
        const data = await response.json();

        if (response.ok && data.valid) {
          setDisplayName(data.displayName || 'Karyawan Loyalis');
          setStatus('input_password');
        } else {
          setStatus('error');
          setMessage(data.error || 'Tautan reaktivasi tidak valid atau telah kedaluwarsa.');
        }
      } catch (err) {
        console.error('Token verification error:', err);
        setStatus('error');
        setMessage('Terjadi kesalahan koneksi saat memverifikasi tautan Anda.');
      }
    };

    verifyToken();
  }, [token]);

  // 2. Handle form submission
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);

    if (password.length < 6) {
      setFormError('Kata sandi harus minimal 6 karakter.');
      return;
    }

    if (password !== confirmPassword) {
      setFormError('Konfirmasi kata sandi tidak cocok.');
      return;
    }

    setStatus('submitting');
    try {
      const response = await fetch('/api/auth/reactivate', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ token, password }),
      });

      const data = await response.json();

      if (response.ok && data.success) {
        setStatus('success');
        setMessage(data.message || 'Akun Anda telah berhasil diaktifkan kembali.');
      } else {
        setStatus('input_password');
        setFormError(data.error || 'Gagal mengaktifkan kembali akun Anda.');
      }
    } catch (err) {
      console.error('Reactivation error:', err);
      setStatus('input_password');
      setFormError('Terjadi kesalahan jaringan atau server saat mencoba memproses.');
    }
  };

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
        <div className="space-y-6">
          {status === 'loading' && (
            <div className="flex flex-col items-center text-center py-6 space-y-4">
              <div className="relative flex items-center justify-center">
                <div className="w-16 h-16 rounded-full border-4 border-indigo-100 dark:border-indigo-950/50 animate-pulse absolute" />
                <Loader2 className="w-10 h-10 text-indigo-600 dark:text-indigo-400 animate-spin relative" />
              </div>
              <div className="space-y-1">
                <p className="font-semibold text-slate-800 dark:text-slate-200">Memverifikasi Tautan...</p>
                <p className="text-sm text-slate-500 dark:text-slate-400">Harap tunggu, kami sedang memeriksa keamanan tautan Anda.</p>
              </div>
            </div>
          )}

          {(status === 'input_password' || status === 'submitting') && (
            <div>
              <div className="mb-6 bg-indigo-50/50 dark:bg-indigo-950/30 border border-indigo-100/50 dark:border-indigo-900/30 rounded-2xl p-4 text-center">
                <p className="text-xs text-indigo-500 dark:text-indigo-400 uppercase tracking-wider font-bold mb-1">
                  Halo, Selamat Datang Kembali
                </p>
                <p className="font-bold text-slate-800 dark:text-slate-100">
                  {displayName}
                </p>
                <p className="text-xs text-slate-500 dark:text-slate-400 mt-2 leading-relaxed">
                  Silakan buat kata sandi baru untuk mengaktifkan kembali akun Anda.
                </p>
              </div>

              {formError && (
                <div className="mb-4 flex items-start gap-2 p-3 bg-red-50 dark:bg-red-950/20 border border-red-200/50 dark:border-red-900/30 rounded-xl animate-in fade-in slide-in-from-top-1">
                  <XCircle className="w-4 h-4 text-red-500 shrink-0 mt-0.5" />
                  <span className="text-xs text-red-700 dark:text-red-400 font-medium leading-relaxed">
                    {formError}
                  </span>
                </div>
              )}

              <form onSubmit={handleSubmit} className="space-y-4">
                {/* Password input */}
                <div className="space-y-1.5">
                  <label htmlFor="new-password" className="text-xs font-semibold text-slate-600 dark:text-slate-400 uppercase tracking-wide">
                    Kata Sandi Baru
                  </label>
                  <div className="relative">
                    <Lock className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400 pointer-events-none" />
                    <Input
                      id="new-password"
                      type={showPassword ? 'text' : 'password'}
                      placeholder="Minimal 6 karakter"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      className="pl-11 pr-10 h-11 rounded-xl border-slate-200 focus:border-indigo-500 focus:ring-indigo-500/20 bg-white dark:bg-slate-950"
                      disabled={status === 'submitting'}
                      required
                    />
                    <button
                      type="button"
                      onClick={() => setShowPassword(!showPassword)}
                      className="absolute right-4 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 focus:outline-none"
                    >
                      {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                    </button>
                  </div>
                </div>

                {/* Confirm Password input */}
                <div className="space-y-1.5">
                  <label htmlFor="confirm-password" className="text-xs font-semibold text-slate-600 dark:text-slate-400 uppercase tracking-wide">
                    Konfirmasi Kata Sandi Baru
                  </label>
                  <div className="relative">
                    <Lock className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400 pointer-events-none" />
                    <Input
                      id="confirm-password"
                      type={showPassword ? 'text' : 'password'}
                      placeholder="Ketik ulang kata sandi baru"
                      value={confirmPassword}
                      onChange={(e) => setConfirmPassword(e.target.value)}
                      className="pl-11 pr-10 h-11 rounded-xl border-slate-200 focus:border-indigo-500 focus:ring-indigo-500/20 bg-white dark:bg-slate-950"
                      disabled={status === 'submitting'}
                      required
                    />
                  </div>
                </div>

                <Button
                  id="btn-submit-reactivation"
                  type="submit"
                  disabled={status === 'submitting'}
                  className="w-full bg-indigo-600 hover:bg-indigo-700 text-white font-semibold py-2.5 h-11 flex items-center justify-center gap-2 shadow-md hover:shadow-indigo-500/20 active:scale-[0.98] transition-all mt-6"
                >
                  {status === 'submitting' ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin" />
                      Memproses...
                    </>
                  ) : (
                    <>
                      Simpan & Aktifkan Akun
                      <ArrowRight className="w-4 h-4" />
                    </>
                  )}
                </Button>
              </form>
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
