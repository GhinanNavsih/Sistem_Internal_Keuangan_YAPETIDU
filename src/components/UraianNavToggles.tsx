"use client";

import React, { useMemo, useCallback } from 'react';
import { useRouter, usePathname, useSearchParams } from 'next/navigation';
import { useAuth } from '@/lib/AuthContext';
import {
  ScanLine,
  Banknote,
  ClipboardCheck,
  FileSpreadsheet,
  Clock,
  Car,
  FileText,
} from 'lucide-react';

/**
 * Shared navigation toggles for Loyalis & Pekarya uraian-related payroll pages.
 * Renders two rows:
 *   1. Loyalis row – visible to super_admin and loyalis_presence_admin
 *   2. Pekarya row – visible to super_admin only
 *
 * This component is self-contained: it reads the current pathname and
 * search params to determine the active tab and builds clean navigation URLs.
 */
export default function UraianNavToggles() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const { profile } = useAuth();

  // Derive the active tab from the current pathname
  const activeTab = useMemo(() => {
    if (pathname.includes('/rekap-pekarya')) return 'presensi';
    if (pathname.includes('/vakasi-loyalis')) return 'vakasi_loyalis';
    if (pathname.includes('/proposal-kegiatan')) return 'proposal_kegiatan';
    if (pathname.includes('/pelaporan-kegiatan')) return 'pelaporan_kegiatan';
    if (pathname.includes('/presensi-loyalis-raw')) return 'presensi_loyalis_raw';
    if (pathname.includes('/presensi-loyalis')) return 'presensi_loyalis';
    if (pathname.includes('/presence-corrections')) return 'presence_corrections';
    if (pathname.includes('/spj-pekarya')) return 'kegiatan_spj';
    if (pathname.includes('/activity-review')) return 'activity_review';
    if (pathname.includes('/driver-journeys')) return 'driver_journeys';
    return '';
  }, [pathname]);

  // Read month/year from search params for constructing links
  const month = parseInt(searchParams.get('month') || String(new Date().getMonth() + 1), 10);
  const year = parseInt(searchParams.get('year') || String(new Date().getFullYear()), 10);

  // Build a clean query string, stripping category for tabs that don't use it
  const getCleanParamsString = useCallback((tab: string) => {
    const params = new URLSearchParams(searchParams.toString());
    if (
      tab === 'vakasi_loyalis' ||
      tab === 'proposal_kegiatan' ||
      tab === 'pelaporan_kegiatan' ||
      tab === 'presensi_loyalis' ||
      tab === 'presensi_loyalis_raw' ||
      tab === 'presence_corrections' ||
      tab === 'driver-journeys' ||
      tab === 'activity-review'
    ) {
      params.delete('category');
    }
    const str = params.toString();
    return str ? `?${str}` : '';
  }, [searchParams]);

  // Only render for roles that should see the navigation
  if (!profile) return null;
  if (
    profile.role !== 'super_admin' &&
    profile.role !== 'loyalis_presence_admin'
  ) {
    return null;
  }

  const btnCls = (isActive: boolean) =>
    `px-4 py-2 rounded-lg text-xs font-bold transition-all flex items-center gap-2 cursor-pointer ${
      isActive
        ? 'bg-indigo-600 text-white shadow-sm'
        : 'text-slate-500 hover:text-slate-800 hover:bg-slate-50'
    }`;

  return (
    <div className="flex flex-col gap-2.5 w-full">
      {/* Row 1: Loyalis Pay Navigation */}
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-[10px] font-extrabold uppercase tracking-wider text-indigo-500 px-1 shrink-0 bg-indigo-50/80 border border-indigo-100 py-1 rounded-md">
          Loyalis
        </span>
        <div className="flex bg-white p-1 rounded-xl w-fit shadow-sm border border-slate-200/60 overflow-x-auto max-w-full">
          {profile.role === 'super_admin' && (
            <>
              <button
                onClick={() => router.push(`/dashboard/payroll/uraian/proposal-kegiatan${getCleanParamsString('proposal_kegiatan')}`)}
                className={btnCls(activeTab === 'proposal_kegiatan')}
              >
                <FileText className="w-4 h-4" />
                Pengajuan Anggaran (Proposal)
              </button>
              <button
                onClick={() => router.push(`/dashboard/payroll/uraian/vakasi-loyalis${getCleanParamsString('vakasi_loyalis')}`)}
                className={btnCls(activeTab === 'vakasi_loyalis')}
              >
                <Banknote className="w-4 h-4" />
                Vakasi Tambahan (Loyalis)
              </button>
              <button
                onClick={() => router.push(`/dashboard/payroll/uraian/pelaporan-kegiatan${getCleanParamsString('pelaporan_kegiatan')}`)}
                className={btnCls(activeTab === 'pelaporan_kegiatan')}
              >
                <ClipboardCheck className="w-4 h-4" />
                Pelaporan Kegiatan
              </button>
              <button
                onClick={() => router.push(`/dashboard/payroll/uraian/presensi-loyalis${getCleanParamsString('presensi_loyalis')}`)}
                className={btnCls(activeTab === 'presensi_loyalis')}
              >
                <FileSpreadsheet className="w-4 h-4" />
                Presensi Loyalis
              </button>
            </>
          )}

          {(profile.role === 'super_admin' || profile.role === 'loyalis_presence_admin') && (
            <>
              <button
                onClick={() => router.push(`/dashboard/payroll/uraian/presensi-loyalis-raw${getCleanParamsString('presensi_loyalis_raw')}`)}
                className={btnCls(activeTab === 'presensi_loyalis_raw')}
              >
                <Clock className="w-4 h-4" />
                Presensi Loyalis (Raw)
              </button>
              <button
                onClick={() => router.push(`/dashboard/payroll/uraian/presence-corrections${getCleanParamsString('presence_corrections')}`)}
                className={btnCls(activeTab === 'presence_corrections')}
              >
                <ClipboardCheck className="w-4 h-4" />
                Review Koreksi Presensi
              </button>
            </>
          )}
        </div>
      </div>

      {/* Row 2: Pekarya Pay Navigation */}
      {profile.role === 'super_admin' && (
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-[10px] font-extrabold uppercase tracking-wider text-emerald-600 px-1 shrink-0 bg-emerald-50/80 border border-emerald-100 py-1 rounded-md">
            Pekarya
          </span>
          <div className="flex bg-white p-1 rounded-xl w-fit shadow-sm border border-slate-200/60 overflow-x-auto max-w-full">
            <button
              onClick={() => router.push(`/dashboard/payroll/activity-review?month=${month}&year=${year}`)}
              className={btnCls(activeTab === 'activity_review')}
            >
              <ClipboardCheck className="w-4 h-4" />
              Review Kegiatan
            </button>
            <button
              onClick={() => router.push(`/dashboard/payroll/uraian/rekap-pekarya${getCleanParamsString('presensi')}`)}
              className={btnCls(activeTab === 'presensi')}
            >
              <ScanLine className="w-4 h-4" />
              Rekap Uraian (Pekarya)
            </button>
            <button
              onClick={() => router.push(`/dashboard/payroll/driver-journeys${getCleanParamsString('driver-journeys')}`)}
              className={btnCls(activeTab === 'driver_journeys')}
            >
              <Car className="w-4 h-4" />
              Perjalanan Driver
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
