"use client";

import React, { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/lib/AuthContext';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Hexagon, Mail, Lock, Eye, EyeOff, AlertCircle, Loader2, LogIn,
} from 'lucide-react';

// Inline Google icon — no external icon package needed
function GoogleIcon() {
  return (
    <svg viewBox="0 0 24 24" className="w-4 h-4" aria-hidden="true">
      <path
        d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
        fill="#4285F4"
      />
      <path
        d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
        fill="#34A853"
      />
      <path
        d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l3.66-2.84z"
        fill="#FBBC05"
      />
      <path
        d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
        fill="#EA4335"
      />
    </svg>
  );
}

// Floating decorative orb
function Orb({ className }: { className: string }) {
  return (
    <div
      className={`absolute rounded-full mix-blend-multiply blur-3xl opacity-20 animate-pulse ${className}`}
      aria-hidden="true"
    />
  );
}

const FIREBASE_ERROR_MESSAGES: Record<string, string> = {
  'auth/user-not-found': 'Email tidak terdaftar dalam sistem.',
  'auth/wrong-password': 'Password salah. Silakan coba lagi.',
  'auth/invalid-email': 'Format email tidak valid.',
  'auth/too-many-requests': 'Terlalu banyak percobaan. Silakan coba beberapa saat lagi.',
  'auth/invalid-credential': 'Email atau password salah.',
  'auth/popup-closed-by-user': 'Login Google dibatalkan.',
  'auth/cancelled-popup-request': 'Login Google dibatalkan.',
  'auth/network-request-failed': 'Gagal terhubung ke jaringan. Periksa koneksi internet Anda.',
};

function getAuthErrorMessage(code: string): string {
  return FIREBASE_ERROR_MESSAGES[code] ?? 'Terjadi kesalahan. Silakan coba lagi.';
}

export default function LoginPage() {
  const { user, loading, signInWithEmail, signInWithGoogle } = useAuth();
  const router = useRouter();

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [googleLoading, setGoogleLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Redirect if already authenticated
  useEffect(() => {
    if (!loading && user) {
      router.replace('/dashboard/payroll');
    }
  }, [user, loading, router]);

  const handleEmailLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email || !password) return;
    setError(null);
    setSubmitting(true);
    try {
      await signInWithEmail(email, password);
      router.replace('/dashboard/payroll');
    } catch (err: any) {
      setError(getAuthErrorMessage(err?.code ?? ''));
    } finally {
      setSubmitting(false);
    }
  };

  const handleGoogleLogin = async () => {
    setError(null);
    setGoogleLoading(true);
    try {
      await signInWithGoogle();
      router.replace('/dashboard/payroll');
    } catch (err: any) {
      setError(getAuthErrorMessage(err?.code ?? ''));
    } finally {
      setGoogleLoading(false);
    }
  };

  // Show loading spinner while auth state resolves
  if (loading) {
    return (
      <div className="min-h-screen bg-[#F8FAFC] flex items-center justify-center">
        <Loader2 className="w-8 h-8 text-indigo-500 animate-spin" />
      </div>
    );
  }

  // Don't flash the form if we are about to redirect
  if (user) return null;

  return (
    <div className="min-h-screen bg-[#F8FAFC] flex font-sans selection:bg-indigo-100">
      {/* ── Left decorative panel ──────────────────────────── */}
      <div className="hidden lg:flex lg:w-1/2 relative overflow-hidden bg-gradient-to-br from-indigo-600 via-purple-600 to-indigo-800 flex-col items-center justify-center p-16">
        {/* Decorative orbs */}
        <Orb className="w-96 h-96 bg-white top-[-10%] left-[-10%]" />
        <Orb className="w-64 h-64 bg-purple-300 bottom-[5%] right-[-5%]" />
        <Orb className="w-48 h-48 bg-indigo-300 top-[50%] right-[20%]" />

        {/* Grid pattern overlay */}
        <div
          className="absolute inset-0 opacity-[0.04]"
          style={{
            backgroundImage:
              'repeating-linear-gradient(0deg,#fff 0,#fff 1px,transparent 1px,transparent 60px),repeating-linear-gradient(90deg,#fff 0,#fff 1px,transparent 1px,transparent 60px)',
          }}
        />

        <div className="relative z-10 text-center max-w-md">
          {/* Logo */}
          <div className="flex justify-center mb-12">
            <div className="flex gap-6 items-center filter drop-shadow-[0_10px_15px_rgba(0,0,0,0.18)]">
              <img
                src="/Logo YAPETIDU (Transparent bg).png"
                alt="Logo YAPETIDU"
                className="h-32 w-auto object-contain hover:scale-105 transition-transform duration-300 cursor-pointer"
              />
              <div className="w-px h-10 bg-white/30" />
              <img
                src="/Logo UNIPDU.png"
                alt="Logo UNIPDU"
                className="h-32 w-auto object-contain hover:scale-105 transition-transform duration-300 cursor-pointer"
              />
            </div>
          </div>

          <h2 className="text-4xl font-extrabold text-white leading-tight mb-4 tracking-tight">
            Sistem Internal<br />Keuangan UNIPDU
          </h2>
          <p className="text-indigo-200 text-base leading-relaxed mb-12">
            Platform manajemen penggajian terpadu untuk<br />
            Biro Administrasi Keuangan UNIPDU Jombang.
          </p>

          {/* Feature pills */}
          <div className="flex flex-wrap justify-center gap-3">
            {['Penggajian Otomatis', 'Scan AI Rekap', 'Cetak Slip Gaji', 'Laporan XLSX / PDF'].map((feat) => (
              <span
                key={feat}
                className="px-4 py-2 rounded-full bg-white/10 border border-white/20 text-white/90 text-xs font-semibold backdrop-blur-sm"
              >
                {feat}
              </span>
            ))}
          </div>
        </div>
      </div>

      {/* ── Right form panel ───────────────────────────────── */}
      <div className="flex-1 flex items-center justify-center p-8 relative overflow-hidden">
        {/* Subtle background blobs */}
        <div className="absolute inset-0 overflow-hidden pointer-events-none">
          <div className="absolute -top-20 -right-20 w-80 h-80 rounded-full bg-indigo-100/60 blur-3xl" />
          <div className="absolute -bottom-20 -left-20 w-80 h-80 rounded-full bg-purple-100/60 blur-3xl" />
        </div>

        <div className="relative w-full max-w-md">
          {/* Mobile logo */}
          <div className="flex lg:hidden items-center gap-3 mb-10">
            <div className="flex items-center gap-3 filter drop-shadow-sm">
              <img
                src="/Logo YAPETIDU (Transparent bg).png"
                alt="Logo YAPETIDU"
                className="h-10 w-auto object-contain"
              />
              <div className="w-px h-6 bg-slate-200" />
              <img
                src="/Logo UNIPDU.png"
                alt="Logo UNIPDU"
                className="h-10 w-auto object-contain"
              />
            </div>
            <span className="text-lg font-bold text-slate-800">BAK UNIPDU</span>
          </div>

          <h1 className="text-3xl font-extrabold text-slate-900 tracking-tight mb-2">
            Selamat Datang
          </h1>
          <p className="text-slate-500 text-sm mb-8 leading-relaxed">
            Masuk dengan akun yang telah terdaftar untuk mengakses sistem.
          </p>

          {/* Error banner */}
          {error && (
            <div className="mb-6 flex items-start gap-3 p-4 bg-red-50 border border-red-200 rounded-2xl animate-in fade-in slide-in-from-top-2 duration-300">
              <AlertCircle className="w-4 h-4 text-red-500 mt-0.5 shrink-0" />
              <span className="text-sm text-red-700 font-medium leading-relaxed">{error}</span>
            </div>
          )}

          {/* Email / Password form */}
          <form onSubmit={handleEmailLogin} className="space-y-4">
            {/* Email */}
            <div className="space-y-1.5">
              <label htmlFor="email" className="text-xs font-semibold text-slate-600 uppercase tracking-wide">
                Email
              </label>
              <div className="relative">
                <Mail className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400 pointer-events-none" />
                <Input
                  id="email"
                  type="email"
                  autoComplete="email"
                  placeholder="nama@unipdu.ac.id"
                  value={email}
                  onChange={(e) => { setEmail(e.target.value); setError(null); }}
                  className="pl-11 h-12 bg-white border-slate-200 rounded-2xl text-sm font-medium focus:border-indigo-400 focus:ring-4 focus:ring-indigo-500/10 transition-all"
                  required
                />
              </div>
            </div>

            {/* Password */}
            <div className="space-y-1.5">
              <label htmlFor="password" className="text-xs font-semibold text-slate-600 uppercase tracking-wide">
                Password
              </label>
              <div className="relative">
                <Lock className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400 pointer-events-none" />
                <Input
                  id="password"
                  type={showPassword ? 'text' : 'password'}
                  autoComplete="current-password"
                  placeholder="••••••••"
                  value={password}
                  onChange={(e) => { setPassword(e.target.value); setError(null); }}
                  className="pl-11 pr-12 h-12 bg-white border-slate-200 rounded-2xl text-sm font-medium focus:border-indigo-400 focus:ring-4 focus:ring-indigo-500/10 transition-all"
                  required
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-4 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 transition-colors"
                  aria-label={showPassword ? 'Sembunyikan password' : 'Tampilkan password'}
                >
                  {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
            </div>

            {/* Submit */}
            <Button
              id="btn-login-email"
              type="submit"
              disabled={submitting || !email || !password}
              className="w-full h-12 rounded-2xl bg-gradient-to-r from-indigo-600 to-purple-600 hover:from-indigo-700 hover:to-purple-700 text-white font-bold text-sm shadow-lg shadow-indigo-200 hover:shadow-indigo-300 transition-all duration-300 mt-2 disabled:opacity-60"
            >
              {submitting ? (
                <><Loader2 className="w-4 h-4 mr-2 animate-spin" />Masuk...</>
              ) : (
                <><LogIn className="w-4 h-4 mr-2" />Masuk</>
              )}
            </Button>
          </form>

          {/* Divider */}
          <div className="relative my-6">
            <div className="absolute inset-0 flex items-center">
              <div className="w-full border-t border-slate-200" />
            </div>
            <div className="relative flex justify-center">
              <span className="bg-[#F8FAFC] px-4 text-xs text-slate-400 font-medium">atau lanjutkan dengan</span>
            </div>
          </div>

          {/* Google login */}
          <Button
            id="btn-login-google"
            type="button"
            variant="outline"
            onClick={handleGoogleLogin}
            disabled={googleLoading || submitting}
            className="w-full h-12 rounded-2xl border-slate-200 bg-white hover:bg-slate-50 hover:border-slate-300 text-slate-700 font-semibold text-sm shadow-sm transition-all duration-300 disabled:opacity-60"
          >
            {googleLoading ? (
              <Loader2 className="w-4 h-4 mr-2 animate-spin" />
            ) : (
              <GoogleIcon />
            )}
            <span className="ml-2">Masuk dengan Google</span>
          </Button>

          {/* Footer note */}
          <p className="text-center text-xs text-slate-400 mt-8 leading-relaxed">
            Hanya akun resmi yang telah disetujui<br />oleh administrator yang dapat mengakses sistem ini.
          </p>
        </div>
      </div>
    </div>
  );
}
