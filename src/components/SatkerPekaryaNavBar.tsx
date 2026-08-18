"use client";

import React from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useAuth } from '@/lib/AuthContext';
import { ClipboardCheck, ScanLine, LogOut, Compass, BarChart3, Banknote, FileText, UsersRound, Wrench } from 'lucide-react';
import { Button } from '@/components/ui/button';

export default function SatkerPekaryaNavBar() {
  const { profile, logout } = useAuth();
  const pathname = usePathname();
  const router = useRouter();
  const searchParams = useSearchParams();

  // Only show for satker_head (Pekarya) or satker_head_loyalis
  if (profile?.role !== 'satker_head' && profile?.role !== 'satker_head_loyalis') return null;

  const month = searchParams.get('month') || String(new Date().getMonth() + 1);
  const year = searchParams.get('year') || String(new Date().getFullYear());
  const attendanceCategory =
    searchParams.get('category') ||
    profile?.permittedCategories?.[0] ||
    '';
  // Uraian pages resolve their own default period (previous month before the
  // 6th, unless closed) when the URL carries none at all. Forcing "now" in
  // here — like the non-uraian links below still do — would pre-empt that,
  // so a period is only carried over when the current page already has one.
  const monthParam = searchParams.get('month');
  const yearParam = searchParams.get('year');
  const periodQuery = monthParam && yearParam ? `month=${monthParam}&year=${yearParam}` : '';
  const withPeriod = (query: string) =>
    query ? `?${periodQuery ? `${periodQuery}&${query}` : query}` : periodQuery ? `?${periodQuery}` : '';
  const uraianUrl = `/dashboard/payroll/uraian/rekap-pekarya${withPeriod('')}`;
  const attendanceUrl = `/dashboard/payroll/uraian/presensi-pekarya${withPeriod(
    attendanceCategory ? `category=${encodeURIComponent(attendanceCategory)}` : '',
  )}`;
  const activityUrl = `/dashboard/payroll/activity-review?month=${month}&year=${year}`;
  const journeysUrl = `/dashboard/payroll/driver-journeys?month=${month}&year=${year}`;
  const dashboardUrl = `/dashboard/payroll/journey-dashboard?month=${month}&year=${year}`;
  const facilityUrl = '/dashboard/payroll/facility-reports';
  const vakasiUrl = `/dashboard/payroll/uraian/vakasi-loyalis${withPeriod('')}`;
  const proposalUrl = `/dashboard/payroll/uraian/proposal-kegiatan${withPeriod('')}`;
  const pelaporanUrl = `/dashboard/payroll/uraian/pelaporan-kegiatan${withPeriod('')}`;

  const isActivity = pathname.startsWith('/dashboard/payroll/activity-review');
  const isJourneys = pathname.startsWith('/dashboard/payroll/driver-journeys');
  const isDashboard = pathname.startsWith('/dashboard/payroll/journey-dashboard');
  const isFacility = pathname.startsWith('/dashboard/payroll/facility-reports');
  const isUraian =
    pathname.startsWith('/dashboard/payroll/uraian/rekap-pekarya') ||
    (pathname.startsWith('/dashboard/payroll/uraian') &&
      !pathname.includes('presensi-pekarya') &&
      !pathname.includes('vakasi-loyalis') &&
      !pathname.includes('pelaporan-kegiatan') &&
      !pathname.includes('proposal-kegiatan'));
  const isAttendance = pathname.startsWith('/dashboard/payroll/uraian/presensi-pekarya');
  const isVakasi = pathname.startsWith('/dashboard/payroll/uraian/vakasi-loyalis');
  const isProposal = pathname.startsWith('/dashboard/payroll/uraian/proposal-kegiatan');
  const isPelaporan = pathname.startsWith('/dashboard/payroll/uraian/pelaporan-kegiatan');

  const permittedCategories = profile?.permittedCategories ?? [];
  const canSeeFacility =
    permittedCategories.includes('KEBERSIHAN') || permittedCategories.includes('TEKNISI');
  const canSeeJourneys = permittedCategories.includes('SOPIR');

  const navBtnClass = (active: boolean) =>
    `px-3.5 py-1.5 sm:px-4 sm:py-2 rounded-lg text-xs font-bold transition-all flex items-center gap-1.5 sm:gap-2 cursor-pointer whitespace-nowrap ${
      active
        ? 'bg-indigo-600 text-white shadow-sm'
        : 'text-slate-600 hover:text-slate-900 hover:bg-slate-200/60'
    }`;

  const defaultBrandRedirect = profile?.role === 'satker_head_loyalis' ? vakasiUrl : activityUrl;

  return (
    <header className="sticky top-0 z-50 w-full bg-white/85 backdrop-blur-md border-b border-slate-200/80 shadow-xs">
      <div className="max-w-[1600px] mx-auto px-4 sm:px-6 lg:px-8 py-2.5 flex items-center justify-between gap-4 w-full">
        {/* Brand */}
        <div
          onClick={() => router.push(defaultBrandRedirect)}
          className="flex items-center gap-2.5 cursor-pointer shrink-0"
        >
          <img
            src="/Logo YAPETIDU (Transparent bg).png"
            alt="Logo"
            className="w-8 h-8 object-contain"
          />
          <div className="flex flex-col">
            <span className="text-sm font-extrabold bg-gradient-to-r from-indigo-600 to-purple-600 bg-clip-text text-transparent tracking-tight leading-none">
              YAPETIDU
            </span>
            <span className="text-[10px] font-semibold text-slate-400 leading-tight hidden sm:block">
              Sistem Internal Keuangan
            </span>
          </div>
        </div>

        {/* Navigation Tabs */}
        <div className="flex items-center bg-slate-100/90 p-1 rounded-xl gap-1 shadow-inner border border-slate-200/50 overflow-x-auto max-w-full scrollbar-none">
          {profile?.role === 'satker_head_loyalis' ? (
            <>
              <button
                onClick={() => router.push(proposalUrl)}
                className={navBtnClass(isProposal)}
              >
                <FileText className="w-4 h-4" />
                <span>Pengajuan Anggaran</span>
              </button>
              <button
                onClick={() => router.push(vakasiUrl)}
                className={navBtnClass(isVakasi)}
              >
                <Banknote className="w-4 h-4" />
                <span>Vakasi Tambahan</span>
              </button>
              <button
                onClick={() => router.push(pelaporanUrl)}
                className={navBtnClass(isPelaporan)}
              >
                <ClipboardCheck className="w-4 h-4" />
                <span>Pelaporan Kegiatan</span>
              </button>
            </>
          ) : (
            <>
              <button
                onClick={() => router.push(activityUrl)}
                className={navBtnClass(isActivity)}
              >
                <ClipboardCheck className="w-4 h-4" />
                <span>Review Kegiatan</span>
              </button>
              {canSeeFacility && (
                <button
                  onClick={() => router.push(facilityUrl)}
                  className={navBtnClass(isFacility)}
                >
                  <Wrench className="w-4 h-4" />
                  <span>Fasilitas Rusak</span>
                </button>
              )}
              {canSeeJourneys && (
                <button
                  onClick={() => router.push(journeysUrl)}
                  className={navBtnClass(isJourneys)}
                >
                  <Compass className="w-4 h-4" />
                  <span>Pre-Otorisasi</span>
                </button>
              )}
              <button
                onClick={() => router.push(dashboardUrl)}
                className={navBtnClass(isDashboard)}
              >
                <BarChart3 className="w-4 h-4" />
                <span>Dashboard Pekarya</span>
              </button>
              <button
                onClick={() => router.push(attendanceUrl)}
                className={navBtnClass(isAttendance)}
              >
                <UsersRound className="w-4 h-4" />
                <span>Presensi Pekarya</span>
              </button>
              <button
                onClick={() => router.push(uraianUrl)}
                className={navBtnClass(isUraian)}
              >
                <ScanLine className="w-4 h-4" />
                <span>Rekap Uraian</span>
              </button>
            </>
          )}
        </div>

        {/* User + Logout */}
        <div className="flex items-center gap-3 shrink-0">
          <div className="hidden md:block text-right">
            <p className="text-xs font-bold text-slate-700 leading-tight truncate max-w-[150px]">
              {profile?.displayName || (profile?.role === 'satker_head_loyalis' ? 'SatKer Loyalis' : 'SatKer Pekarya')}
            </p>
            <p className="text-[10px] font-semibold text-indigo-600 bg-indigo-50 px-2 py-0.5 rounded-md w-fit mt-0.5 ml-auto border border-indigo-100">
              {profile?.role === 'satker_head_loyalis' ? 'Kepala SatKer Loyalis' : 'Kepala SatKer Pekarya'}
            </p>
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={logout}
            className="rounded-xl text-rose-600 border-rose-200 bg-rose-50 hover:bg-rose-100 hover:text-rose-700 hover:border-rose-300 transition-all cursor-pointer flex items-center gap-1.5 shadow-sm font-semibold"
          >
            <LogOut className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">Keluar</span>
          </Button>
        </div>
      </div>
    </header>
  );
}
