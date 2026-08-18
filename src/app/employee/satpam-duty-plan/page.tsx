'use client';

import React, { useCallback, useEffect, useState } from 'react';
import {
  CalendarDays,
  Loader2,
  LogOut,
  RefreshCw,
} from 'lucide-react';
import { useAuth } from '@/lib/AuthContext';
import { authenticatedJson } from '@/lib/payroll/client';
import { Button } from '@/components/ui/button';
import EmployeeNavigationMenu from '@/components/EmployeeNavigationMenu';
import {
  SatpamDutyPlanPanel,
  type EmployeeOption,
  type OpenPeriod,
  type Team,
} from '@/components/satpam/SatpamDutyAndAbsencePanels';

function jakartaToday(): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Jakarta',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
}

export default function SatpamDutyPlanPage() {
  const { profile, logout } = useAuth();
  const isKetuaShiftSatpam = (profile?.role as string) === 'ketua_shift_satpam';

  const [team, setTeam] = useState<Team | null>(null);
  const [employees, setEmployees] = useState<EmployeeOption[]>([]);
  const [planningPeriods, setPlanningPeriods] = useState<OpenPeriod[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const loadConfig = useCallback(async () => {
    if (!isKetuaShiftSatpam || !profile?.linkedEmployeeId) return;
    setLoading(true);
    setError('');
    try {
      const config = await authenticatedJson<{
        team: Team | null;
        employees: EmployeeOption[];
        openPeriods: OpenPeriod[];
        planningPeriods: OpenPeriod[];
      }>(`/api/satpam/config?dutyDate=${encodeURIComponent(jakartaToday())}`, {
        method: 'GET',
      });
      setTeam(config.team);
      setEmployees(config.employees || []);
      setPlanningPeriods(config.planningPeriods || config.openPeriods || []);
    } catch (cause) {
      console.error('Error loading Satpam duty plan configuration:', cause);
      setError(
        cause instanceof Error
          ? cause.message
          : 'Konfigurasi regu Satpam gagal dimuat.',
      );
    } finally {
      setLoading(false);
    }
  }, [isKetuaShiftSatpam, profile?.linkedEmployeeId]);

  useEffect(() => {
    void loadConfig();
  }, [loadConfig]);

  if (!profile) return null;

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 via-indigo-50/80 to-slate-100 font-sans text-slate-800">
      <div className="sticky top-0 z-30 bg-white/80 backdrop-blur-xl border-b border-slate-100 shadow-sm">
        <div className="max-w-2xl mx-auto px-4 py-3.5 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-indigo-500 to-purple-600 flex items-center justify-center shadow-lg shadow-indigo-200/50">
              <CalendarDays className="w-4.5 h-4.5 text-white" />
            </div>
            <div>
              <h1 className="text-sm font-bold text-slate-900 leading-tight">
                Jadwal Regu
              </h1>
              <p className="text-[11px] text-slate-400 font-medium">
                {profile.displayName || 'Ketua Shift'}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-1.5 sm:gap-2">
            <Button
              variant="outline"
              size="icon"
              onClick={() => void loadConfig()}
              disabled={loading}
              className="text-slate-600 hover:text-indigo-650 hover:bg-slate-50 border border-slate-200 bg-white rounded-xl h-9 w-9 flex items-center justify-center shadow-sm cursor-pointer"
              title="Muat Ulang"
            >
              <RefreshCw
                className={`w-4.5 h-4.5 text-indigo-500 ${loading ? 'animate-spin' : ''}`}
              />
            </Button>
            <EmployeeNavigationMenu />
            <Button
              onClick={() => logout()}
              variant="ghost"
              size="icon"
              className="text-slate-400 hover:text-rose-500 rounded-xl h-9 w-9 border border-slate-150/40 bg-white shadow-sm flex items-center justify-center cursor-pointer"
              title="Keluar"
            >
              <LogOut className="w-4.5 h-4.5" />
            </Button>
          </div>
        </div>
      </div>

      <div className="max-w-2xl mx-auto px-4 py-5 space-y-5">
        {!isKetuaShiftSatpam ? (
          <div className="rounded-2xl border border-amber-200 bg-amber-50 p-5 text-base font-semibold text-amber-900">
            Halaman ini khusus untuk Ketua Shift Satpam.
          </div>
        ) : error ? (
          <div className="space-y-3 rounded-2xl border border-rose-200 bg-rose-50 p-5">
            <p className="text-base font-semibold text-rose-800">{error}</p>
            <Button
              type="button"
              variant="outline"
              className="min-h-11 gap-2"
              onClick={() => void loadConfig()}
            >
              <RefreshCw className="h-4 w-4" />
              Coba Lagi
            </Button>
          </div>
        ) : loading ? (
          <div className="flex flex-col items-center justify-center gap-2 py-16 text-slate-400">
            <Loader2 className="h-6 w-6 animate-spin text-indigo-600" />
            <span className="text-base font-semibold">Memuat data regu...</span>
          </div>
        ) : (
          <SatpamDutyPlanPanel
            team={team}
            employees={employees}
            openPeriods={planningPeriods}
          />
        )}
        <div className="h-8" />
      </div>
    </div>
  );
}
