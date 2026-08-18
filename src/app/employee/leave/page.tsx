"use client";

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { AlertCircle, Loader2, LogOut, ShieldCheck } from 'lucide-react';
import EmployeeNavigationMenu from '@/components/EmployeeNavigationMenu';
import { PekaryaOfficialLeavePanel } from '@/components/pekarya/PekaryaOfficialLeavePanel';
import { SatpamAbsencePanel } from '@/components/satpam/SatpamDutyAndAbsencePanels';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { useAuth } from '@/lib/AuthContext';
import { authenticatedJson } from '@/lib/payroll/client';
import { isPekaryaOfficialLeaveCategory } from '@/lib/payroll/pekaryaOfficialLeave';

type OpenPeriod = {
  period: string;
  startDate: string;
  endDate: string;
};

export default function EmployeeLeavePage() {
  const {
    profile: rawProfile,
    activeProfile,
    loading: authLoading,
    logout,
  } = useAuth();
  const profile = activeProfile || rawProfile;
  const [openPeriods, setOpenPeriods] = useState<OpenPeriod[]>([]);
  const [loadingPeriods, setLoadingPeriods] = useState(true);
  const [periodError, setPeriodError] = useState('');

  const isSatpam = Boolean(
    profile?.role === 'ketua_shift_satpam' ||
      profile?.permittedCategories?.some(
        (category) => category.trim().toUpperCase() === 'SATPAM',
      ),
  );
  const jobCategory =
    profile?.permittedCategories?.[0]?.trim().toUpperCase() || '';
  const isSupportedEmployee = Boolean(
    profile &&
      ['honorer', 'ketua_shift_satpam'].includes(profile.role) &&
      (isSatpam || isPekaryaOfficialLeaveCategory(jobCategory)),
  );

  const loadOpenPeriods = useCallback(async () => {
    if (!profile?.linkedEmployeeId || !isSupportedEmployee) {
      setLoadingPeriods(false);
      return;
    }
    setLoadingPeriods(true);
    setPeriodError('');
    try {
      const response = await authenticatedJson<{ openPeriods: OpenPeriod[] }>(
        '/api/payroll/periods',
        { method: 'GET' },
      );
      setOpenPeriods(response.openPeriods || []);
    } catch (cause) {
      setPeriodError(
        cause instanceof Error
          ? cause.message
          : 'Periode payroll terbuka gagal dimuat.',
      );
    } finally {
      setLoadingPeriods(false);
    }
  }, [isSupportedEmployee, profile?.linkedEmployeeId]);

  useEffect(() => {
    const timer = window.setTimeout(() => void loadOpenPeriods(), 0);
    return () => window.clearTimeout(timer);
  }, [loadOpenPeriods]);

  if (authLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-gradient-to-br from-slate-50 via-indigo-50/80 to-slate-100">
        <Loader2 className="h-8 w-8 animate-spin text-indigo-500" />
      </div>
    );
  }

  if (!profile || !profile.linkedEmployeeId || !isSupportedEmployee) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-gradient-to-br from-slate-50 via-indigo-50/80 to-slate-100 p-6">
        <Card className="w-full max-w-md rounded-3xl border-none bg-white shadow-xl">
          <CardContent className="space-y-4 p-8 text-center">
            <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-2xl bg-rose-50">
              <AlertCircle className="h-8 w-8 text-rose-500" />
            </div>
            <h1 className="text-xl font-bold text-slate-900">
              Pengajuan Tidak Tersedia
            </h1>
            <p className="text-sm leading-relaxed text-slate-500">
              Akun ini belum terhubung ke pegawai Pekarya yang dapat mengajukan
              presensi atau izin.
            </p>
            <Button variant="outline" render={<Link href="/employee/activities" />}>
              Kembali ke Laporan Kegiatan
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 via-indigo-50/80 to-slate-100 text-slate-900">
      <header className="sticky top-0 z-40 border-b border-slate-200/80 bg-white/95 shadow-sm backdrop-blur">
        <div className="mx-auto flex max-w-3xl items-center gap-3 px-4 py-3 sm:px-6">
          <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br from-amber-500 to-orange-600 text-white shadow-lg shadow-amber-200/60">
            <ShieldCheck className="h-6 w-6" />
          </div>
          <div className="min-w-0 flex-1">
            <h1 className="truncate text-lg font-extrabold">Ajukan Izin</h1>
            <p className="truncate text-sm text-slate-500">
              {profile.displayName || profile.email}
            </p>
          </div>
          <EmployeeNavigationMenu />
          <Button
            type="button"
            variant="outline"
            size="icon"
            onClick={() => void logout()}
            className="h-9 w-9 shrink-0 rounded-xl border-slate-200 bg-white shadow-sm"
            title="Keluar"
            aria-label="Keluar"
          >
            <LogOut className="h-4.5 w-4.5 text-slate-500" />
          </Button>
        </div>
      </header>

      <main className="mx-auto max-w-3xl px-4 py-6 sm:px-6 sm:py-8">
        {loadingPeriods ? (
          <Card className="rounded-3xl border-none bg-white shadow-lg">
            <CardContent className="flex min-h-44 items-center justify-center gap-2 text-slate-500">
              <Loader2 className="h-5 w-5 animate-spin" />
              Memuat periode pengajuan…
            </CardContent>
          </Card>
        ) : periodError ? (
          <Card className="rounded-3xl border-rose-200 bg-rose-50 shadow-sm">
            <CardContent className="space-y-4 p-5 text-rose-800">
              <p>{periodError}</p>
              <Button variant="outline" onClick={() => void loadOpenPeriods()}>
                Coba Lagi
              </Button>
            </CardContent>
          </Card>
        ) : isSatpam ? (
          <SatpamAbsencePanel
            employeeId={profile.linkedEmployeeId}
            openPeriods={openPeriods}
          />
        ) : (
          <PekaryaOfficialLeavePanel
            employeeId={profile.linkedEmployeeId}
            openPeriods={openPeriods}
          />
        )}
      </main>
    </div>
  );
}
