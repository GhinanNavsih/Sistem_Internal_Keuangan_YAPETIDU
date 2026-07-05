"use client"

import React, { useState, useEffect, useMemo, Suspense } from 'react';
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
import {
  ScanLine, Banknote, ClipboardCheck, FileSpreadsheet, LogOut, ArrowLeft
} from 'lucide-react';
import { collection, getDocs } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { SUPPORTED_CATEGORIES, MONTHS_ID } from '@/utils/rekapConfig';

const YEARS = Array.from({ length: 5 }, (_, i) => new Date().getFullYear() - i);

function UraianLayoutContent({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const { profile, logout } = useAuth();

  // Read params or set defaults
  const month = parseInt(searchParams.get('month') || String(new Date().getMonth() + 1), 10);
  const year = parseInt(searchParams.get('year') || String(new Date().getFullYear()), 10);
  const category = searchParams.get('category') || "";

  const [dynamicCategories, setDynamicCategories] = useState<string[]>(SUPPORTED_CATEGORIES);

  // Sync Categories from DB Blue Collar
  useEffect(() => {
    const fetchCats = async () => {
      try {
        const allEmpSnap = await getDocs(collection(db, 'Employees_BlueCollar'));
        const cats = new Set<string>(SUPPORTED_CATEGORIES);
        allEmpSnap.docs.forEach(d => {
          const cat = d.data()?.employment?.jobCategory;
          if (cat) cats.add(cat);
        });
        setDynamicCategories(Array.from(cats).sort());
      } catch (err) {
        console.error(err);
      }
    };
    fetchCats();
  }, []);

  const allowedCategories = useMemo(() => {
    if (!profile) return [];
    if (profile.role === 'super_admin') return dynamicCategories;
    return dynamicCategories.filter(cat => profile.permittedCategories?.includes(cat));
  }, [profile, dynamicCategories]);

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
    if (pathname.includes('/rekap-pekarya')) return 'presensi';
    if (pathname.includes('/vakasi-loyalis')) return 'vakasi_loyalis';
    if (pathname.includes('/pelaporan-kegiatan')) return 'pelaporan_kegiatan';
    if (pathname.includes('/presensi-loyalis')) return 'presensi_loyalis';
    if (pathname.includes('/spj-pekarya')) return 'kegiatan_spj';
    return '';
  }, [pathname]);

  // Auto-redirect unauthorized routes on load
  useEffect(() => {
    if (!profile || !activeTab) return;

    if (profile.role === 'satker_head_loyalis') {
      if (activeTab !== 'vakasi_loyalis' && activeTab !== 'pelaporan_kegiatan') {
        router.replace(`/dashboard/payroll/uraian/vakasi-loyalis?${searchParams.toString()}`);
      }
    } else if (profile.role !== 'super_admin') {
      // Satker Head Pekarya / other roles
      if (activeTab !== 'presensi' && activeTab !== 'kegiatan_spj') {
        router.replace(`/dashboard/payroll/uraian/rekap-pekarya?${searchParams.toString()}`);
      }
    }
  }, [profile, activeTab, router, searchParams]);

  // Set default category for Pekarya views
  useEffect(() => {
    if (allowedCategories.length > 0 && !category && (activeTab === 'presensi' || activeTab === 'kegiatan_spj')) {
      setCategory(allowedCategories[0]);
    }
  }, [allowedCategories, category, activeTab]);

  const pageTitle = useMemo(() => {
    switch (activeTab) {
      case 'presensi':
        return 'Rekap Uraian Pekarya';
      case 'vakasi_loyalis':
        return 'Vakasi Tambahan (Loyalis)';
      case 'presensi_loyalis':
        return 'Kalkulator Presensi Loyalis';
      case 'pelaporan_kegiatan':
        return 'Pelaporan Kegiatan';
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
      case 'vakasi_loyalis':
        return 'Kelola pembayaran kegiatan variabel loyalis bulanan';
      case 'presensi_loyalis':
        return 'Hitung strata dan bonus presensi loyalis';
      case 'pelaporan_kegiatan':
        return 'Buat dan cetak laporan pertanggungjawaban kegiatan loyalis';
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

  const showCategorySelector = activeTab === 'presensi' || activeTab === 'kegiatan_spj';

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 via-indigo-50/80 to-slate-100 p-6 lg:p-8 pb-24 lg:pb-32 font-sans selection:bg-indigo-100 relative overflow-hidden">
      {/* Subtle decorative blobs */}
      <div className="absolute top-0 right-0 w-[600px] h-[600px] rounded-full bg-indigo-100/40 blur-[120px] pointer-events-none" />
      <div className="absolute bottom-0 left-0 w-[500px] h-[500px] rounded-full bg-purple-100/30 blur-[100px] pointer-events-none" />
      <div className="max-w-[1600px] mx-auto space-y-8 relative z-10">
        <GlobalHeader />

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
                  {activeTab === 'vakasi_loyalis' || activeTab === 'presensi_loyalis' ? (
                    `${MONTHS_ID[month - 1]} (1 – ${new Date(year, month, 0).getDate()} ${MONTHS_ID[month - 1].slice(0, 3)})`
                  ) : (
                    `${MONTHS_ID[month - 1]} (26 ${MONTHS_ID[(month - 2 + 12) % 12].slice(0, 3)} – 25 ${MONTHS_ID[month - 1].slice(0, 3)})`
                  )}
                </SelectValue>
              </SelectTrigger>
              <SelectContent className="w-72">
                {MONTHS_ID.map((m, i) => {
                  const prevMonth = MONTHS_ID[(i - 1 + 12) % 12];
                  const nextMonth = MONTHS_ID[(i + 1) % 12];
                  const lastDay = new Date(year, i + 1, 0).getDate();
                  return (
                    <SelectItem key={i + 1} value={String(i + 1)}>
                      <div className="flex flex-col py-0.5">
                        <span className="font-semibold">{m}</span>
                        {activeTab === 'vakasi_loyalis' || activeTab === 'presensi_loyalis' ? (
                          <span className="text-[11px] text-slate-400">1 – {lastDay} {m}</span>
                        ) : (
                          <span className="text-[11px] text-slate-400">26 {prevMonth.slice(0, 3)} – 25 {m.slice(0, 3)} · Bayar 5 {nextMonth.slice(0, 3)}</span>
                        )}
                      </div>
                    </SelectItem>
                  );
                })}
              </SelectContent>
            </Select>
            <Select value={String(year)} onValueChange={(v) => v && setYear(parseInt(v, 10))}>
              <SelectTrigger className="w-28 bg-white shadow-sm border-slate-200 rounded-xl font-semibold hover:border-indigo-300 transition-all">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {YEARS.map(y => (
                  <SelectItem key={y} value={String(y)}>{y}</SelectItem>
                ))}
              </SelectContent>
            </Select>

            {showCategorySelector && category && allowedCategories.length > 0 && (
              <Select value={category} onValueChange={(v) => v && setCategory(v)}>
                <SelectTrigger className="w-48 bg-white shadow-sm border-slate-200 rounded-xl font-semibold hover:border-indigo-300 transition-all">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {allowedCategories.map(c => (
                    <SelectItem key={c} value={c}>{c}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}

            {(profile?.role === 'satker_head' || profile?.role === 'satker_head_loyalis') && (
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

        {/* Tab Switcher */}
        {profile && (
          <div className="flex flex-wrap items-center justify-between gap-4 w-full">
            <div className="flex bg-white p-1 rounded-xl w-fit shadow-sm border border-slate-200/60">
              {profile.role === 'super_admin' && (
                <button
                  onClick={() => router.push(`/dashboard/payroll/uraian/rekap-pekarya?${searchParams.toString()}`)}
                  className={`px-5 py-2.5 rounded-lg text-xs font-bold transition-all flex items-center gap-2 cursor-pointer ${
                    activeTab === 'presensi'
                      ? 'bg-indigo-600 text-white shadow-sm'
                      : 'text-slate-500 hover:text-slate-800 hover:bg-slate-50'
                  }`}
                >
                  <ScanLine className="w-4.5 h-4.5" />
                  Rekap Uraian (Pekarya)
                </button>
              )}

              {(profile.role === 'super_admin' || profile.role === 'satker_head_loyalis') && (
                <>
                  <button
                    onClick={() => router.push(`/dashboard/payroll/uraian/vakasi-loyalis?${searchParams.toString()}`)}
                    className={`px-5 py-2.5 rounded-lg text-xs font-bold transition-all flex items-center gap-2 cursor-pointer ${
                      activeTab === 'vakasi_loyalis'
                        ? 'bg-indigo-600 text-white shadow-sm'
                        : 'text-slate-500 hover:text-slate-800 hover:bg-slate-50'
                    }`}
                  >
                    <Banknote className="w-4.5 h-4.5" />
                    Vakasi Tambahan (Loyalis)
                  </button>
                  <button
                    onClick={() => router.push(`/dashboard/payroll/uraian/pelaporan-kegiatan?${searchParams.toString()}`)}
                    className={`px-5 py-2.5 rounded-lg text-xs font-bold transition-all flex items-center gap-2 cursor-pointer ${
                      activeTab === 'pelaporan_kegiatan'
                        ? 'bg-indigo-600 text-white shadow-sm'
                        : 'text-slate-500 hover:text-slate-800 hover:bg-slate-50'
                    }`}
                  >
                    <ClipboardCheck className="w-4.5 h-4.5" />
                    Pelaporan Kegiatan
                  </button>
                </>
              )}

              {profile.role === 'super_admin' && (
                <button
                  onClick={() => router.push(`/dashboard/payroll/uraian/presensi-loyalis?${searchParams.toString()}`)}
                  className={`px-5 py-2.5 rounded-lg text-xs font-bold transition-all flex items-center gap-2 cursor-pointer ${
                    activeTab === 'presensi_loyalis'
                      ? 'bg-indigo-600 text-white shadow-sm'
                      : 'text-slate-500 hover:text-slate-800 hover:bg-slate-50'
                  }`}
                >
                  <FileSpreadsheet className="w-4.5 h-4.5" />
                  Presensi Loyalis
                </button>
              )}

              {/* Show Kegiatan SPJ for Super Admin & Pekarya heads (Commented out for now) */}
              {/*
              {(profile.role === 'super_admin' || profile.role === 'satker_head') && (
                <button
                  onClick={() => router.push(`/dashboard/payroll/uraian/spj-pekarya?${searchParams.toString()}`)}
                  className={`px-5 py-2.5 rounded-lg text-xs font-bold transition-all flex items-center gap-2 cursor-pointer ${
                    activeTab === 'kegiatan_spj'
                      ? 'bg-indigo-600 text-white shadow-sm'
                      : 'text-slate-500 hover:text-slate-800 hover:bg-slate-50'
                  }`}
                >
                  <ClipboardCheck className="w-4.5 h-4.5" />
                  Kegiatan SPJ (Pekarya)
                </button>
              )}
              */}
            </div>
          </div>
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
