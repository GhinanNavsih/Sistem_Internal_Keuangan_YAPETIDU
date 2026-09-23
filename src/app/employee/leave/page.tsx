"use client";

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { AlertCircle, ChevronLeft, LogOut, ShieldCheck } from 'lucide-react';
import EmployeeNavigationMenu from '@/components/EmployeeNavigationMenu';
import { LoyalisPresenceCorrectionPanel } from '@/components/employee/LoyalisPresenceCorrectionPanel';
import { PaidLeavePanel } from '@/components/employee/PaidLeavePanel';
import { PekaryaOfficialLeavePanel } from '@/components/pekarya/PekaryaOfficialLeavePanel';
import { SatpamAbsencePanel } from '@/components/satpam/SatpamDutyAndAbsencePanels';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { useAuth } from '@/lib/AuthContext';
import { authenticatedJson } from '@/lib/payroll/client';
import { isPekaryaOfficialLeaveCategory } from '@/lib/payroll/pekaryaOfficialLeave';
import { getEmployeeActivitiesPath } from '@/lib/employeeActivities';
import { LeavePageSkeleton, LeaveCardSkeleton } from '@/components/LeaveSkeleton';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

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
  const isLoyalis = profile?.role === 'loyalis';
  const [workflow, setWorkflow] = useState<
    'presence_correction' | 'sick_leave' | 'paid_leave'
  >('paid_leave');
  const effectiveWorkflow = workflow;

  const isSatpam = Boolean(
    profile?.role === 'ketua_shift_satpam' ||
      profile?.permittedCategories?.some(
        (category) => category.trim().toUpperCase() === 'SATPAM',
      ),
  );
  const jobCategory =
    profile?.permittedCategories?.[0]?.trim().toUpperCase() || '';
  const workflowLabels = {
    presence_correction: 'Koreksi Presensi',
    sick_leave: 'Izin Sakit',
    paid_leave: 'Ambil Cuti',
  } as const;
  const selectedWorkflowLabel = workflowLabels[effectiveWorkflow];
  const isSupportedEmployee = Boolean(
    profile &&
      (profile.role === 'loyalis' ||
        (['honorer', 'ketua_shift_satpam'].includes(profile.role) &&
          (isSatpam || isPekaryaOfficialLeaveCategory(jobCategory)))),
  );

  const loadOpenPeriods = useCallback(async () => {
    if (!profile?.linkedEmployeeId || !isSupportedEmployee || isLoyalis) {
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
  }, [isLoyalis, isSupportedEmployee, profile?.linkedEmployeeId]);

  useEffect(() => {
    const timer = window.setTimeout(() => void loadOpenPeriods(), 0);
    return () => window.clearTimeout(timer);
  }, [loadOpenPeriods]);

  if (authLoading) {
    return <LeavePageSkeleton variant="unknown" />;
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
              Akun ini belum terhubung ke pegawai yang dapat mengajukan presensi
              atau izin.
            </p>
            <Button
              variant="outline"
              render={<Link href={getEmployeeActivitiesPath(profile || {})} />}
            >
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
          <div className="flex min-w-0 flex-1 items-center gap-2">
            <Link href={getEmployeeActivitiesPath(profile)}>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="h-9 w-9 shrink-0 rounded-xl text-slate-400 hover:bg-slate-50 hover:text-slate-700"
                title="Kembali ke Laporan Kegiatan"
                aria-label="Kembali ke Laporan Kegiatan"
              >
                <ChevronLeft className="h-5 w-5" />
              </Button>
            </Link>
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-amber-500 to-orange-600 text-white shadow-lg shadow-amber-200/60">
              <ShieldCheck className="h-4.5 w-4.5" />
            </div>
            <div className="min-w-0">
              <h1 className="truncate text-sm font-bold leading-tight">Izin &amp; Cuti</h1>
              <p className="truncate text-[11px] font-medium text-slate-400">
                {profile.displayName || profile.email}
              </p>
            </div>
          </div>
          <EmployeeNavigationMenu />
          <Button
            type="button"
            variant="ghost"
            size="icon"
            onClick={() => void logout()}
            className="h-9 w-9 shrink-0 rounded-xl border border-slate-150/40 bg-white text-slate-400 shadow-sm hover:text-rose-500"
            title="Keluar"
            aria-label="Keluar"
          >
            <LogOut className="h-4.5 w-4.5" />
          </Button>
        </div>
      </header>

      <main className="mx-auto max-w-3xl px-4 py-6 sm:px-6 sm:py-8">
        <div className="mb-4 space-y-2 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
          <label htmlFor="leave-workflow" className="text-sm font-bold text-slate-700">
            Jenis pengajuan
          </label>
          <Select
            value={effectiveWorkflow}
            onValueChange={(value) => {
              if (
                value === 'presence_correction' ||
                value === 'sick_leave' ||
                value === 'paid_leave'
              ) {
                setWorkflow(value);
              }
            }}
          >
            <SelectTrigger
              id="leave-workflow"
              className="h-14 w-full rounded-xl px-4 text-base font-bold"
            >
              <SelectValue>{selectedWorkflowLabel}</SelectValue>
            </SelectTrigger>
            <SelectContent>
              <SelectItem
                value="presence_correction"
                className="min-h-12 px-3 py-3 text-base font-semibold"
              >
                Koreksi Presensi
              </SelectItem>
              <SelectItem
                value="sick_leave"
                className="min-h-12 px-3 py-3 text-base font-semibold"
              >
                Izin Sakit
              </SelectItem>
              <SelectItem
                value="paid_leave"
                className="min-h-12 px-3 py-3 text-base font-semibold"
              >
                Ambil Cuti
              </SelectItem>
            </SelectContent>
          </Select>
        </div>

        {effectiveWorkflow === 'paid_leave' ? (
          <PaidLeavePanel />
        ) : isLoyalis ? (
          <LoyalisPresenceCorrectionPanel
            key={effectiveWorkflow}
            embedded
            workflowMode={effectiveWorkflow}
          />
        ) : loadingPeriods ? (
          <LeaveCardSkeleton variant={isSatpam ? 'satpam' : 'pekarya'} />
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
            autoSaveDraft
            workflowMode={effectiveWorkflow}
          />
        ) : (
          <PekaryaOfficialLeavePanel
            employeeId={profile.linkedEmployeeId}
            openPeriods={openPeriods}
            autoSaveDraft
            workflowMode={effectiveWorkflow}
          />
        )}
      </main>
    </div>
  );
}
