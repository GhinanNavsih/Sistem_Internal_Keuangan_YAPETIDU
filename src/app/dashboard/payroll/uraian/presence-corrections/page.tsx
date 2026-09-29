"use client";

import { useEffect } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useAuth } from '@/lib/AuthContext';
import { Loader2 } from 'lucide-react';

export default function PresenceCorrectionsRedirectPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { profile, loading } = useAuth();

  useEffect(() => {
    if (loading) return;

    const queryString = searchParams?.toString();
    const query = queryString ? `?${queryString}` : '';

    if (profile?.role === 'loyalis_admin') {
      router.replace(`/dashboard/payroll/uraian/presensi-loyalis-raw${query}`);
    } else {
      router.replace(`/dashboard/payroll/uraian/presensi-pekarya${query}`);
    }
  }, [loading, profile, router, searchParams]);

  return (
    <div className="flex h-64 flex-col items-center justify-center gap-3">
      <Loader2 className="h-6 w-6 animate-spin text-indigo-600" />
      <p className="text-sm font-medium text-slate-500">Mengalihkan ke halaman presensi...</p>
    </div>
  );
}
