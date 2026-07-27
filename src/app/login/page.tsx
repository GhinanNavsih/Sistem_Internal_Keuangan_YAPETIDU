"use client";

import React, { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/lib/AuthContext';
import { auth } from '@/lib/firebase';
import { sendPasswordResetEmail } from 'firebase/auth';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Hexagon, Mail, Lock, Eye, EyeOff, AlertCircle, Loader2, LogIn, CheckCircle2,
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
  'auth/user-disabled': 'Akun Anda ditangguhkan sementara. Silakan buka kotak masuk email Anda dan klik tautan reaktivasi untuk mengaktifkan kembali akun Anda.',
  'auth/network-request-failed': 'Gagal terhubung ke jaringan. Periksa koneksi internet Anda.',
};

function getAuthErrorMessage(code: string): string {
  return FIREBASE_ERROR_MESSAGES[code] ?? 'Terjadi kesalahan. Silakan coba lagi.';
}

export default function LoginPage() {
  const { user, profile, loading, signInWithEmail, signInWithGoogle } = useAuth();
  const router = useRouter();

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [googleLoading, setGoogleLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [forgotPasswordLoading, setForgotPasswordLoading] = useState(false);
  const [isDisabledAccount, setIsDisabledAccount] = useState(false);
  const [reactivationLoading, setReactivationLoading] = useState(false);

  // Redirect if already authenticated
  useEffect(() => {
    if (!loading && user && profile) {
      const roleStr = profile.role as string;
      if (roleStr === 'honorer' || roleStr === 'ketua_shift_satpam') {
        router.replace('/employee/activities');
      } else if (roleStr === 'loyalis') {
        router.replace('/employee/payslip');
      } else if (roleStr === 'satker_head') {
        router.replace('/dashboard/payroll/activity-review');
      } else if (roleStr === 'satker_head_loyalis') {
        router.replace('/dashboard/payroll/uraian');
      } else if (roleStr === 'loyalis_presence_admin') {
        router.replace('/dashboard/payroll/uraian/presensi-loyalis-raw');
      } else {
        router.replace('/dashboard/payroll');
      }
    }
  }, [user, profile, loading, router]);

  // Real-time email check: automatically detects disabled accounts as the user inputs email
  useEffect(() => {
    const trimmedEmail = email.trim().toLowerCase();
    if (!trimmedEmail || !trimmedEmail.includes('@') || trimmedEmail.length < 5) {
      setIsDisabledAccount(false);
      return;
    }

    const timer = setTimeout(async () => {
      try {
        const res = await fetch(`/api/auth/check-email?email=${encodeURIComponent(trimmedEmail)}`);
        const data = await res.json();
        if (data.disabled === true) {
          setIsDisabledAccount(true);
        } else {
          setIsDisabledAccount(false);
        }
      } catch (e) {
        console.warn('Failed to check email status:', e);
      }
    }, 400);

    return () => clearTimeout(timer);
  }, [email]);

  const handleEmailLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email || !password) return;
    setError(null);
    setSuccessMessage(null);
    setIsDisabledAccount(false);
    setSubmitting(true);
    try {
      await signInWithEmail(email, password);
      // Redirect is handled by the useEffect above once profile loads
    } catch (err: any) {
      if (err?.code === 'auth/user-disabled') {
        setIsDisabledAccount(true);
      }
      setError(getAuthErrorMessage(err?.code ?? ''));
    } finally {
      setSubmitting(false);
    }
  };

  const handleGoogleLogin = async () => {
    setError(null);
    setSuccessMessage(null);
    setIsDisabledAccount(false);
    setGoogleLoading(true);
    try {
      await signInWithGoogle();
    } catch (err: any) {
      if (err?.code === 'auth/user-disabled') {
        setIsDisabledAccount(true);
      }
      setError(getAuthErrorMessage(err?.code ?? ''));
    } finally {
      setGoogleLoading(false);
    }
  };

  const handleRequestReactivation = async () => {
    const targetEmail = email.trim().toLowerCase();
    if (!targetEmail) {
      setError('Silakan masukkan email Anda terlebih dahulu pada kolom Email.');
      return;
    }

    setReactivationLoading(true);
    setError(null);
    setSuccessMessage(null);

    try {
      const res = await fetch('/api/auth/request-reactivation', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: targetEmail }),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Gagal mengirimkan tautan reaktivasi.');
      }

      setSuccessMessage(
        `Tautan reaktivasi telah dikirimkan ke ${targetEmail}. Silakan periksa pesan email Anda dan klik tautan untuk mengaktifkan kembali akun Anda.`
      );
      setIsDisabledAccount(false);
    } catch (err: any) {
      setError(err?.message || 'Gagal mengirimkan tautan reaktivasi.');
    } finally {
      setReactivationLoading(false);
    }
  };

  const handleForgotPassword = async () => {
    if (!email) {
      setError('Silakan masukkan email Anda terlebih dahulu pada kolom Email.');
      setSuccessMessage(null);
      return;
    }

    setError(null);
    setSuccessMessage(null);
    setForgotPasswordLoading(true);

    try {
      await sendPasswordResetEmail(auth, email);
      setSuccessMessage(`Email pemulihan kata sandi telah dikirim ke ${email}. Silakan periksa kotak masuk (atau folder spam) Anda.`);
    } catch (err: any) {
      console.error('Error sending password reset email:', err);
      if (err?.code === 'auth/user-not-found') {
        setError('Email tidak terdaftar dalam sistem.');
      } else if (err?.code === 'auth/invalid-email') {
        setError('Format email tidak valid.');
      } else if (err?.code === 'auth/too-many-requests') {
        setError('Terlalu banyak permintaan reset password. Silakan coba beberapa saat lagi.');
      } else {
        setError('Gagal mengirim email pemulihan. Pastikan email Anda benar atau coba lagi nanti.');
      }
    } finally {
      setForgotPasswordLoading(false);
    }
  };

  // Show loading spinner while auth state resolves
  if (loading) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-50 via-indigo-50/80 to-slate-100 flex items-center justify-center relative overflow-hidden">
        {/* Subtle decorative blobs */}
        <div className="absolute top-0 right-0 w-[600px] h-[600px] rounded-full bg-indigo-100/40 blur-[120px] pointer-events-none" />
        <div className="absolute bottom-0 left-0 w-[500px] h-[500px] rounded-full bg-purple-100/30 blur-[100px] pointer-events-none" />
        <Loader2 className="w-8 h-8 text-indigo-500 animate-spin relative z-10" />
      </div>
    );
  }

  // Don't flash the form if we are about to redirect
  if (user) return null;

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 via-indigo-50/80 to-slate-100 flex font-sans selection:bg-indigo-100 relative overflow-hidden">
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
            Sistem Administrasi<br />Keuangan UNIPDU
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
          <div className="absolute -top-20 -right-20 w-96 h-96 rounded-full bg-indigo-100/40 blur-[120px]" />
          <div className="absolute -bottom-20 -left-20 w-80 h-80 rounded-full bg-purple-100/30 blur-[100px]" />
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

          {/* Smart Reactivation Card for Disabled Accounts */}
          {isDisabledAccount && (
            <div className="mb-6 p-5 bg-gradient-to-br from-amber-50 via-orange-50 to-amber-100/50 border border-amber-300/80 rounded-2xl shadow-sm animate-in fade-in slide-in-from-top-2 duration-300 space-y-3">
              <div className="flex items-center gap-2.5 text-amber-900 font-bold text-sm">
                <div className="w-7 h-7 rounded-xl bg-amber-500/20 flex items-center justify-center shrink-0">
                  <Mail className="w-4 h-4 text-amber-700" />
                </div>
                <span>Akun Terdaftar Dalam Status Non-Aktif</span>
              </div>
              <p className="text-xs text-amber-800 leading-relaxed">
                Email <strong>{email || 'akun ini'}</strong> terdaftar di Sistem namun saat ini dalam status ditangguhkan/non-aktif. Klik tombol di bawah untuk menerima tautan reaktivasi instan.
              </p>
              <Button
                type="button"
                onClick={handleRequestReactivation}
                disabled={reactivationLoading}
                className="w-full bg-gradient-to-r from-amber-600 to-amber-700 hover:from-amber-700 hover:to-amber-800 text-white font-bold rounded-2xl text-xs md:text-sm py-3.5 px-5 h-auto flex items-center justify-center gap-2.5 shadow-md shadow-amber-600/20 border border-amber-500/30 transition-all cursor-pointer leading-normal active:scale-[0.98] mt-1"
              >
                {reactivationLoading ? (
                  <>
                    <Loader2 className="w-4.5 h-4.5 animate-spin text-white shrink-0" />
                    <span>Mengirim Tautan Reaktivasi...</span>
                  </>
                ) : (
                  <>
                    <Mail className="w-4.5 h-4.5 text-amber-100 shrink-0" />
                    <span>Kirim Email Tautan Reaktivasi</span>
                  </>
                )}
              </Button>
            </div>
          )}

          {/* Error banner */}
          {error && !isDisabledAccount && (
            <div className="mb-6 flex items-start gap-3 p-4 bg-red-50 border border-red-200 rounded-2xl animate-in fade-in slide-in-from-top-2 duration-300">
              <AlertCircle className="w-4 h-4 text-red-500 mt-0.5 shrink-0" />
              <span className="text-sm text-red-700 font-medium leading-relaxed">
                {error}
              </span>
            </div>
          )}

          {/* Success banner */}
          {successMessage && (
            <div className="mb-6 flex items-start gap-3 p-4 bg-emerald-50 border border-emerald-200 rounded-2xl animate-in fade-in slide-in-from-top-2 duration-300">
              <CheckCircle2 className="w-4 h-4 text-emerald-500 mt-0.5 shrink-0" />
              <span className="text-sm text-emerald-700 font-medium leading-relaxed">
                {successMessage}
              </span>
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
              <div className="flex justify-between items-center">
                <label htmlFor="password" className="text-xs font-semibold text-slate-600 uppercase tracking-wide">
                  Password
                </label>
                <button
                  type="button"
                  onClick={handleForgotPassword}
                  disabled={forgotPasswordLoading}
                  className="text-xs font-semibold text-indigo-600 hover:text-indigo-800 hover:underline transition-colors focus:outline-none disabled:opacity-50 cursor-pointer"
                >
                  {forgotPasswordLoading ? 'Mengirim...' : 'Lupa Password?'}
                </button>
              </div>
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
