"use client";

import React from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useAuth } from '@/lib/AuthContext';
import { ClipboardCheck, ScanLine, LogOut, Compass, BarChart3 } from 'lucide-react';
import { Button } from '@/components/ui/button';

export default function SatkerPekaryaNavBar() {
  const { profile, logout } = useAuth();
  const pathname = usePathname();
  const router = useRouter();
  const searchParams = useSearchParams();

  // Only show for satker_head (Pekarya)
  if (profile?.role !== 'satker_head') return null;

  const month = searchParams.get('month') || String(new Date().getMonth() + 1);
  const year = searchParams.get('year') || String(new Date().getFullYear());
  const uraianUrl = `/dashboard/payroll/uraian/rekap-pekarya?month=${month}&year=${year}`;
  const activityUrl = `/dashboard/payroll/activity-review?month=${month}&year=${year}`;
  const journeysUrl = `/dashboard/payroll/driver-journeys?month=${month}&year=${year}`;
  const dashboardUrl = `/dashboard/payroll/journey-dashboard?month=${month}&year=${year}`;

  const isActivity = pathname.startsWith('/dashboard/payroll/activity-review');
  const isUraian = pathname.startsWith('/dashboard/payroll/uraian');
  const isJourneys = pathname.startsWith('/dashboard/payroll/driver-journeys');
  const isDashboard = pathname.startsWith('/dashboard/payroll/journey-dashboard');

  const navBtnClass = (active: boolean) =>
    `px-4 py-2 rounded-lg text-xs font-bold transition-all flex items-center gap-2 cursor-pointer ${
      active
        ? 'bg-indigo-600 text-white shadow-sm'
        : 'text-slate-500 hover:text-slate-800 hover:bg-slate-100'
    }`;

  return (
    <div className="flex items-center justify-between gap-4 w-full bg-white/70 backdrop-blur-sm border border-slate-200/60 rounded-2xl px-4 py-2.5 shadow-sm">
      {/* Brand */}
      <div className="flex items-center gap-2.5">
        <img
          src="/Logo YAPETIDU (Transparent bg).png"
          alt="Logo"
          className="w-7 h-7 object-contain"
        />
        <span className="text-sm font-extrabold bg-gradient-to-r from-indigo-600 to-purple-600 bg-clip-text text-transparent tracking-tight hidden sm:block">
          YAPETIDU
        </span>
      </div>

      {/* Navigation Tabs */}
      <div className="flex bg-slate-100/80 p-1 rounded-xl gap-0.5 shadow-inner">
        <button
          onClick={() => router.push(activityUrl)}
          className={navBtnClass(isActivity)}
        >
          <ClipboardCheck className="w-4 h-4" />
          Review Kegiatan
        </button>
        <button
          onClick={() => router.push(journeysUrl)}
          className={navBtnClass(isJourneys)}
        >
          <Compass className="w-4 h-4" />
          Pre-Otorisasi
        </button>
        <button
          onClick={() => router.push(dashboardUrl)}
          className={navBtnClass(isDashboard)}
        >
          <BarChart3 className="w-4 h-4" />
          Dashboard Perjalanan
        </button>
        <button
          onClick={() => router.push(uraianUrl)}
          className={navBtnClass(isUraian)}
        >
          <ScanLine className="w-4 h-4" />
          Rekap Uraian
        </button>
      </div>

      {/* User + Logout */}
      <div className="flex items-center gap-3">
        <div className="hidden sm:block text-right">
          <p className="text-xs font-bold text-slate-700 leading-tight truncate max-w-[120px]">
            {profile?.displayName || 'SatKer Pekarya'}
          </p>
          <p className="text-[10px] font-semibold text-indigo-600 bg-indigo-50 px-1.5 py-0.5 rounded-md w-fit mt-0.5 ml-auto">
            Kepala SatKer Pekarya
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={logout}
          className="rounded-xl text-rose-600 border-rose-200 bg-rose-50 hover:bg-rose-100 hover:text-rose-700 hover:border-rose-300 transition-all cursor-pointer flex items-center gap-1.5 shadow-sm"
        >
          <LogOut className="w-3.5 h-3.5" />
          <span className="hidden sm:inline">Keluar</span>
        </Button>
      </div>
    </div>
  );
}
