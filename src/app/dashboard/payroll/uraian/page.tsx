"use client"

import { useEffect, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useAuth } from '@/lib/AuthContext';
import { Loader2 } from 'lucide-react';

function RedirectContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { profile } = useAuth();

  useEffect(() => {
    if (!profile) return;

    const queryString = searchParams.toString();
    const suffix = queryString ? `?${queryString}` : '';

    if (profile.role === 'satker_head_loyalis') {
      router.replace(`/dashboard/payroll/uraian/vakasi-loyalis${suffix}`);
    } else {
      // Default for super_admin and satker_head (Pekarya)
      router.replace(`/dashboard/payroll/uraian/rekap-pekarya${suffix}`);
    }
  }, [profile, router, searchParams]);

  return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-slate-50">
      <Loader2 className="w-8 h-8 animate-spin text-indigo-500 mb-3" />
      <span className="text-slate-500 font-semibold animate-pulse text-sm">Mengarahkan Halaman...</span>
    </div>
  );
}

export default function UraianIndexPage() {
  return (
    <Suspense fallback={
      <div className="min-h-screen flex flex-col items-center justify-center bg-slate-50">
        <Loader2 className="w-8 h-8 animate-spin text-indigo-500 mb-3" />
        <span className="text-slate-500 font-semibold animate-pulse text-sm">Mengarahkan Halaman...</span>
      </div>
    }>
      <RedirectContent />
    </Suspense>
  );
}
