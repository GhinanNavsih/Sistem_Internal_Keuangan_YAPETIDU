"use client"

import React, { useState, useEffect, useMemo, Suspense, useCallback } from 'react';
import { useSearchParams, useRouter, usePathname } from 'next/navigation';
import { useAuth } from '@/lib/AuthContext';
import GlobalHeader from '@/components/GlobalHeader';
import { Button } from '@/components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@/components/ui/select';
import { LogOut, ArrowLeft } from 'lucide-react';
import { collection, getDocs, doc, getDoc, query, where } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { MONTHS_ID } from '@/utils/rekapConfig';
import SatkerPekaryaNavBar from '@/components/SatkerPekaryaNavBar';
import UraianNavToggles from '@/components/UraianNavToggles';
import { defaultPayrollPeriodToken, previousPayrollPeriodToken } from '@/lib/payroll/domain';
import { ALL_BLUE_COLLAR_CATEGORY } from '@/lib/payroll/pekaryaSpj';

const YEARS = Array.from({ length: 9 }, (_, i) => new Date().getFullYear() + 3 - i);

function UraianLayoutContent({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const { profile, logout } = useAuth();

  // Read params or set defaults
  const month = parseInt(searchParams.get('month') || String(new Date().getMonth() + 1), 10);
  const year = parseInt(searchParams.get('year') || String(new Date().getFullYear()), 10);
  const category = (searchParams.get('category') || '').trim().toUpperCase();

  // Land on the month being compiled: before the 6th that is still the
  // previous period, unless it has already been closed. Only kicks in when
  // the URL carries no period at all — a manual pick or a bookmarked deep
  // link is always honored exactly as given.
  const hasExplicitPeriod = searchParams.has('month') || searchParams.has('year');
  useEffect(() => {
    if (!profile || hasExplicitPeriod) return;
    const now = new Date();
    const previousPeriod = previousPayrollPeriodToken(now);
    if (defaultPayrollPeriodToken(now, false) !== previousPeriod) {
      // Past the cutoff day; every page's own fallback already lands on the
      // current month, so there's nothing to correct.
      return;
    }
    let cancelled = false;
    const landOnPreviousPeriod = () => {
      if (cancelled) return;
      const [y, m] = previousPeriod.split('-').map(Number);
      const params = new URLSearchParams(searchParams.toString());
      params.set('month', String(m));
      params.set('year', String(y));
      router.replace(`${pathname}?${params.toString()}`);
    };
    getDoc(doc(db, 'PayrollPeriods', previousPeriod))
      .then((snapshot) => {
        if (cancelled) return;
        const previousClosed = snapshot.data()?.attendanceStatus === 'closed';
        if (defaultPayrollPeriodToken(now, previousClosed) !== previousPeriod) return;
        landOnPreviousPeriod();
      })
      .catch(() => {
        // Most viewers here (Kepala SatKer) cannot read PayrollPeriods at
        // all. Periods are open by default throughout this app, so an
        // unreadable closure state is treated the same as "not closed"
        // rather than falling back to the current month.
        landOnPreviousPeriod();
      });
    return () => {
      cancelled = true;
    };
    // router is a stable Next.js reference, and the only part of searchParams
    // that should re-trigger this effect is hasExplicitPeriod (already
    // listed) — reacting to every param change here would also re-fire it on
    // an unrelated category pick.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profile, hasExplicitPeriod, pathname]);

  const [activeCategories, setActiveCategories] = useState<string[]>([]);
  const [categoriesLoaded, setCategoriesLoaded] = useState(false);

  // Only expose categories that have at least one active blue-collar employee.
  useEffect(() => {
    let cancelled = false;

    const fetchCats = async () => {
      try {
        const activeEmployeesQuery = query(
          collection(db, 'Employees_BlueCollar'),
          where('employment.status', '==', 'active'),
        );
        const activeEmpSnap = await getDocs(activeEmployeesQuery);
        const cats = new Set<string>();
        activeEmpSnap.docs.forEach((employeeDoc) => {
          const employee = employeeDoc.data();
          if (
            employee?.flags?.isActive === false ||
            employee?.flags?.isPayrollEligible === false
          ) {
            return;
          }
          const rawCategory = employee?.employment?.jobCategory;
          if (typeof rawCategory === 'string' && rawCategory.trim()) {
            cats.add(rawCategory.trim().toUpperCase());
          }
        });

        if (!cancelled) setActiveCategories(Array.from(cats).sort());
      } catch (err) {
        console.error('Failed to load active blue-collar categories:', err);
        if (!cancelled) setActiveCategories([]);
      } finally {
        if (!cancelled) setCategoriesLoaded(true);
      }
    };

    fetchCats();
    return () => {
      cancelled = true;
    };
  }, []);

  const allowedCategories = useMemo(() => {
    if (!profile) return [];
    if (
      profile.role === 'super_admin' ||
      profile.role === 'finance_verifier'
    ) {
      return activeCategories;
    }
    const permitted = new Set(
      (profile.permittedCategories || []).map((item) => item.trim().toUpperCase()),
    );
    return activeCategories.filter(cat => permitted.has(cat));
  }, [profile, activeCategories]);

  // Handle setting/changing query params
  const setMonth = (m: number) => {
    const params = new URLSearchParams(searchParams.toString());
    params.set('month', String(m));
    router.push(`${pathname}?${params.toString()}`);
  };

  const setYear = (y: number) => {
    const params = new URLSearchParams(searchParams.toString());
    params.set('year', String(y));
    router.push(`${pathname}?${params.toString()}`);
  };

  const setCategory = (c: string) => {
    const params = new URLSearchParams(searchParams.toString());
    params.set('category', c);
    router.push(`${pathname}?${params.toString()}`);
  };

  // Determine active tab/page based on pathname
  const activeTab = useMemo(() => {
    if (pathname.includes('/presensi-pekarya')) return 'presensi_pekarya';
    if (pathname.includes('/rekap-pekarya')) return 'presensi';
    if (pathname.includes('/vakasi-loyalis')) return 'vakasi_loyalis';
    if (pathname.includes('/proposal-kegiatan')) return 'proposal_kegiatan';
    if (pathname.includes('/pelaporan-kegiatan')) return 'pelaporan_kegiatan';
    if (pathname.includes('/presensi-loyalis-raw')) return 'presensi_loyalis_raw';
    if (pathname.includes('/presence-corrections')) return 'presence_corrections';
    if (pathname.includes('/spj-pekarya')) return 'kegiatan_spj';
    return '';
  }, [pathname]);

  const attendanceCategoryOptions = useMemo(() => {
    if (activeTab !== 'presensi_pekarya') return allowedCategories;
    const hasAttendanceCategory = allowedCategories.some(
      (item) => item !== 'SATPAM',
    );
    return hasAttendanceCategory
      ? [ALL_BLUE_COLLAR_CATEGORY, ...allowedCategories]
      : allowedCategories;
  }, [activeTab, allowedCategories]);

  const getCleanParamsString = useCallback((tab: string) => {
    const params = new URLSearchParams(searchParams.toString());
    if (
      tab === 'vakasi_loyalis' ||
      tab === 'proposal_kegiatan' ||
      tab === 'pelaporan_kegiatan' ||
      tab === 'presensi_loyalis_raw' ||
      tab === 'presence_corrections' ||
      tab === 'driver-journeys'
    ) {
      params.delete('category');
    }
    if (
      tab !== 'presensi_pekarya' &&
      params.get('category')?.trim().toUpperCase() === ALL_BLUE_COLLAR_CATEGORY
    ) {
      params.delete('category');
    }
    const str = params.toString();
    return str ? `?${str}` : '';
  }, [searchParams]);

  // Auto-redirect unauthorized routes on load
  useEffect(() => {
    if (!profile || !activeTab) return;

    if (profile.role === 'loyalis_presence_admin') {
      const params = new URLSearchParams(searchParams.toString());
      if (activeTab !== 'presensi_loyalis_raw' && activeTab !== 'presence_corrections') {
        params.delete('category');
        router.replace(`/dashboard/payroll/uraian/presensi-loyalis-raw?${params.toString()}`);
      }
    } else if (profile.role === 'satker_head_loyalis') {
      if (
        activeTab !== 'vakasi_loyalis' &&
        activeTab !== 'pelaporan_kegiatan' &&
        activeTab !== 'proposal_kegiatan' &&
        activeTab !== 'presensi_loyalis_raw'
      ) {
        router.replace(`/dashboard/payroll/uraian/vakasi-loyalis${getCleanParamsString('vakasi_loyalis')}`);
      }
    } else if (
      profile.role !== 'super_admin' &&
      profile.role !== 'finance_verifier'
    ) {
      // Satker Head Pekarya / other roles
      if (
        activeTab !== 'presensi' &&
        activeTab !== 'presensi_pekarya' &&
        activeTab !== 'kegiatan_spj' &&
        activeTab !== 'presence_corrections'
      ) {
        router.replace(`/dashboard/payroll/uraian/rekap-pekarya${getCleanParamsString('presensi')}`);
      }
    }
  }, [profile, activeTab, router, getCleanParamsString, month, year, searchParams]);

  // Set or repair the category for Pekarya views after the active categories
  // have loaded. This also handles stale bookmarked URLs such as
  // ?category=PEKARYA after that category no longer has active employees.
  useEffect(() => {
    if (
      !profile ||
      !categoriesLoaded ||
      (activeTab !== 'presensi' &&
        activeTab !== 'presensi_pekarya' &&
        activeTab !== 'kegiatan_spj')
    ) {
      return;
    }

    const params = new URLSearchParams(searchParams.toString());
    const categoryOptions =
      activeTab === 'presensi_pekarya'
        ? attendanceCategoryOptions
        : allowedCategories;
    if (categoryOptions.length > 0) {
      if (category && categoryOptions.includes(category)) return;
      const julySatpamDefault =
        activeTab === 'presensi_pekarya' &&
        year === 2026 &&
        month === 7 &&
        categoryOptions.includes('SATPAM') &&
        (profile.role === 'super_admin' ||
          profile.role === 'finance_verifier' ||
          profile.permittedCategories?.some(
            (item) => item.trim().toUpperCase() === 'SATPAM',
          ));
      params.set(
        'category',
        julySatpamDefault ? 'SATPAM' : categoryOptions[0],
      );
    } else {
      if (!category) return;
      params.delete('category');
    }

    const queryString = params.toString();
    router.replace(queryString ? `${pathname}?${queryString}` : pathname);
  }, [
    allowedCategories,
    attendanceCategoryOptions,
    category,
    activeTab,
    categoriesLoaded,
    pathname,
    profile,
    router,
    searchParams,
    month,
    year,
  ]);

  const pageTitle = useMemo(() => {
    switch (activeTab) {
      case 'presensi':
        return 'Rekap Uraian Pekarya';
      case 'presensi_pekarya':
        return 'Presensi Pekarya';
      case 'vakasi_loyalis':
        return 'Vakasi Tambahan (Loyalis)';
      case 'presensi_loyalis_raw':
        return 'Kalkulator Presensi Loyalis';
      case 'proposal_kegiatan':
        return 'Pengajuan Anggaran Event';
      case 'pelaporan_kegiatan':
        return 'Pelaporan Kegiatan';
      case 'presence_corrections':
        return 'Review Koreksi Presensi';
      case 'kegiatan_spj':
        return 'Kegiatan SPJ (Pekarya)';
      default:
        return 'Rekap & Vakasi Uraian';
    }
  }, [activeTab]);

  const pageDescription = useMemo(() => {
    switch (activeTab) {
      case 'presensi':
        return 'Upload rekap PDF/Gambar untuk auto-input';
      case 'presensi_pekarya':
        return 'Tinjau scan NIPY, peringatan, koreksi, dan publikasi upah kehadiran';
      case 'vakasi_loyalis':
        return 'Kelola pembayaran kegiatan variabel loyalis bulanan';
      case 'presensi_loyalis_raw':
        return 'Hitung strata dan bonus presensi loyalis';
      case 'proposal_kegiatan':
        return 'Buat dan ajukan proposal anggaran kegiatan loyalis sebelum pelaksanaan';
      case 'pelaporan_kegiatan':
        return 'Buat dan cetak laporan pertanggungjawaban kegiatan loyalis';
      case 'presence_corrections':
        return 'Persetujuan & Manajemen Koreksi Absen Pegawai';
      case 'kegiatan_spj':
        return 'Kelola pembayaran kegiatan variabel pekarya bulanan';
      default:
        return '';
    }
  }, [activeTab]);

  if (!profile) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50">
        <div className="animate-pulse text-slate-400 font-semibold">Memeriksa Autentikasi...</div>
      </div>
    );
  }

  const showCategorySelector =
    activeTab === 'presensi' ||
    activeTab === 'presensi_pekarya' ||
    activeTab === 'kegiatan_spj';

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 via-indigo-50/80 to-slate-100 font-sans selection:bg-indigo-100 relative text-slate-800">
      {/* Subtle decorative blobs */}
      <div className="absolute top-0 right-0 w-[600px] h-[600px] rounded-full bg-indigo-100/40 blur-[120px] pointer-events-none" />
      <div className="absolute bottom-0 left-0 w-[500px] h-[500px] rounded-full bg-purple-100/30 blur-[100px] pointer-events-none" />

      {/* Show full GlobalHeader only for super_admin; SatKer Pekarya/Loyalis gets its own top nav bar */}
      {profile.role === 'super_admin' ? (
        <GlobalHeader />
      ) : (profile.role === 'satker_head' || profile.role === 'satker_head_loyalis') ? (
        <Suspense fallback={null}>
          <SatkerPekaryaNavBar />
        </Suspense>
      ) : null}

      <div className="max-w-[1600px] mx-auto p-6 lg:p-8 pb-24 lg:pb-32 space-y-8 relative z-10">

        <div className="flex flex-col md:flex-row md:items-center justify-between gap-6">
          <div className="space-y-1">
            {profile?.role !== 'super_admin' && activeTab === 'kegiatan_spj' ? (
              <Button
                variant="ghost"
                onClick={() => {
                  window.history.back();
                }}
                className="group -ml-2 mb-2 text-slate-500 hover:text-indigo-700 hover:bg-indigo-50"
              >
                <ArrowLeft className="w-4 h-4 mr-2 group-hover:-translate-x-1 transition-transform" />
                Kembali
              </Button>
            ) : (
              <div className="h-2" />
            )}
            <h1 className="text-3xl font-bold text-slate-800">{pageTitle}</h1>
            <p className="text-slate-500 text-sm">{pageDescription}</p>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <Select value={String(month)} onValueChange={(v) => v && setMonth(parseInt(v, 10))}>
              <SelectTrigger className="w-56 bg-white shadow-sm border-slate-200 rounded-xl font-semibold hover:border-indigo-300 transition-all">
                <SelectValue>
                  {activeTab === 'vakasi_loyalis' || activeTab === 'presensi_loyalis_raw' || activeTab === 'pelaporan_kegiatan' || activeTab === 'presence_corrections' ? (
                    `${MONTHS_ID[month - 1]} (1 – ${new Date(year, month, 0).getDate()} ${MONTHS_ID[month - 1].slice(0, 3)})`
                  ) : (
                    year > 2026 || (year === 2026 && month > 7) ? (
                      `${MONTHS_ID[month - 1]} (1 – ${new Date(year, month, 0).getDate()} ${MONTHS_ID[month - 1].slice(0, 3)})`
                    ) : (year === 2026 && month === 7) ? (
                      `Juli (26 Jun – 31 Jul)`
                    ) : (
                      `${MONTHS_ID[month - 1]} (26 ${MONTHS_ID[(month - 2 + 12) % 12].slice(0, 3)} – 25 ${MONTHS_ID[month - 1].slice(0, 3)})`
                    )
                  )}
                </SelectValue>
              </SelectTrigger>
              <SelectContent className="w-72">
                {MONTHS_ID.map((m, i) => ({ name: m, index: i + 1 }))
                  .filter(item => {
                    const now = new Date();
                    const currentYear = now.getFullYear();
                    const currentMonth = now.getMonth() + 1;
                    // Allow the immediately upcoming month so attendance and
                    // NIPY readiness can be prepared before payroll starts.
                    if (year === currentYear && item.index > currentMonth + 1) return false;
                    if (year > currentYear) return false;
                    // Hide months before July 2026 for non-super_admins
                    if (profile?.role !== 'super_admin' && year === 2026 && item.index < 7) return false;
                    return true;
                  })
                  .map(({ name: m, index: val }) => {
                    const i = val - 1;
                    const prevMonth = MONTHS_ID[(i - 1 + 12) % 12];
                    const nextMonth = MONTHS_ID[(i + 1) % 12];
                    const lastDay = new Date(year, val, 0).getDate();
                    return (
                      <SelectItem key={val} value={String(val)}>
                        <div className="flex flex-col py-0.5">
                          <span className="font-semibold">{m}</span>
                          {activeTab === 'vakasi_loyalis' || activeTab === 'presensi_loyalis_raw' || activeTab === 'pelaporan_kegiatan' || activeTab === 'presence_corrections' ? (
                            <span className="text-[11px] text-slate-400">1 – {lastDay} {m}</span>
                          ) : (
                            year > 2026 || (year === 2026 && val > 7) ? (
                              <span className="text-[11px] text-slate-400">1 – {lastDay} {m.slice(0, 3)} · Bayar 5 {nextMonth.slice(0, 3)}</span>
                            ) : (year === 2026 && val === 7) ? (
                              <span className="text-[11px] text-slate-400">26 Jun – 31 Jul · Bayar 5 Agu</span>
                            ) : (
                              <span className="text-[11px] text-slate-400">26 {prevMonth.slice(0, 3)} – 25 {m.slice(0, 3)} · Bayar 5 {nextMonth.slice(0, 3)}</span>
                            )
                          )}
                        </div>
                      </SelectItem>
                    );
                  })}
              </SelectContent>
            </Select>
            <Select value={String(year)} onValueChange={(v) => v && setYear(parseInt(v, 10))}>
              <SelectTrigger className="w-28 bg-white shadow-sm border-slate-200 rounded-xl font-semibold hover:border-indigo-300 transition-all">
                <SelectValue>{year}</SelectValue>
              </SelectTrigger>
              <SelectContent>
                {YEARS.filter(y => {
                  const now = new Date();
                  const currentYear = now.getFullYear();
                  if (y > currentYear) return false;
                  // Hide years before 2026 for non-super_admins
                  if (profile?.role !== 'super_admin' && y < 2026) return false;
                  return true;
                }).map(y => (
                  <SelectItem key={y} value={String(y)}>{y}</SelectItem>
                ))}
              </SelectContent>
            </Select>

            {showCategorySelector && categoriesLoaded && category && (activeTab === 'presensi_pekarya' ? attendanceCategoryOptions : allowedCategories).length > 0 && (
              <Select value={category} onValueChange={(v) => v && setCategory(v)}>
                <SelectTrigger className="w-48 bg-white shadow-sm border-slate-200 rounded-xl font-semibold hover:border-indigo-300 transition-all">
                  <SelectValue>
                    {category === ALL_BLUE_COLLAR_CATEGORY
                      ? 'SEMUA PEKARYA'
                      : category.replace('_', ' ').toUpperCase()}
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  {(activeTab === 'presensi_pekarya'
                    ? attendanceCategoryOptions
                    : allowedCategories
                  ).map(c => (
                    <SelectItem key={c} value={c}>
                      {c === ALL_BLUE_COLLAR_CATEGORY
                        ? 'SEMUA PEKARYA'
                        : c.replace('_', ' ')}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}

            {profile?.role === 'loyalis_presence_admin' && (
              <Button
                variant="outline"
                onClick={logout}
                className="rounded-xl text-rose-600 border-rose-200 bg-rose-50 hover:bg-rose-100 hover:text-rose-700 hover:border-rose-300 transition-all cursor-pointer flex items-center gap-2 shadow-sm"
              >
                <LogOut className="w-4 h-4" />
                Keluar
              </Button>
            )}
          </div>
        </div>

        {/* Tab Switcher for Super Admin & other roles */}
        {profile && profile.role !== 'satker_head' && profile.role !== 'satker_head_loyalis' && (
          <UraianNavToggles />
        )}

        <div className="w-full">{children}</div>
      </div>
    </div>
  );
}

export default function UraianLayout({ children }: { children: React.ReactNode }) {
  return (
    <Suspense fallback={
      <div className="min-h-screen flex items-center justify-center bg-slate-50">
        <div className="animate-pulse text-slate-400 font-semibold">Memuat Halaman...</div>
      </div>
    }>
      <UraianLayoutContent>{children}</UraianLayoutContent>
    </Suspense>
  );
}
