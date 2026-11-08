"use client";

import React, { useState, useEffect, useCallback, useMemo } from 'react';
import Image from 'next/image';
import { useAuth } from '@/lib/AuthContext';
import { canManageSuratMenyurat } from '@/lib/payroll/roles';
import { SuratMasuk, SuratKeluar, SuratStats, DisposisiSurat, InstitutionScope } from '@/lib/surat-menyurat/types';
import { exportBukuAgendaToExcel } from '@/lib/surat-menyurat/excel';
import {
  SIFAT_SURAT_OPTIONS,
  STATUS_SURAT_MASUK_OPTIONS,
  STATUS_SURAT_KELUAR_OPTIONS,
  INSTITUTION_SCOPES,
} from '@/lib/surat-menyurat/constants';
import SuratMasukPanel from '@/components/surat-menyurat/SuratMasukPanel';
import SuratKeluarPanel from '@/components/surat-menyurat/SuratKeluarPanel';
import SuratDisposisiDialog from '@/components/surat-menyurat/SuratDisposisiDialog';
import SuratDetailDialog from '@/components/surat-menyurat/SuratDetailDialog';
import SuratComposerModal from '@/components/surat-menyurat/SuratComposerModal';
import LembarDisposisiView from '@/components/surat-menyurat/LembarDisposisiView';
import LabelArsipView from '@/components/surat-menyurat/LabelArsipView';
import BukuAgendaTable from '@/components/surat-menyurat/BukuAgendaTable';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { FloatingSnackbar, type SnackbarMessage } from '@/components/ui/floating-snackbar';
import GlobalHeader from '@/components/GlobalHeader';
import {
  FileDown,
  FileText,
  Inbox,
  Loader2,
  Plus,
  RefreshCw,
  Search,
  Send,
  Wand2,
  AlertTriangle,
  X,
  FileCheck,
  Tag,
  BookOpen,
  BarChart3,
  Building2,
} from 'lucide-react';

type Tab = 'masuk' | 'keluar' | 'agenda' | 'disposisi' | 'label' | 'rekap';

export default function SuratMenyuratPage() {
  const { user, profile } = useAuth();

  const [activeTab, setActiveTab] = useState<Tab>('masuk');
  const [scopeFilter, setScopeFilter] = useState<'all' | 'UNIPDU' | 'YAPETIDU'>('all');
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [suratMasuk, setSuratMasuk] = useState<SuratMasuk[]>([]);
  const [suratKeluar, setSuratKeluar] = useState<SuratKeluar[]>([]);
  const [stats, setStats] = useState<SuratStats>({
    totalMasuk: 0,
    totalKeluar: 0,
    menungguDisposisi: 0,
    diproses: 0,
    selesaiMasuk: 0,
    draftKeluar: 0,
    terkirimKeluar: 0,
    suratBulanIni: 0,
  });
  const [satkerList, setSatkerList] = useState<{ id: string; name: string }[]>([]);
  const [selectedSatkerFilter, setSelectedSatkerFilter] = useState<string>('all');
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [sifatFilter, setSifatFilter] = useState<string>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [snackbar, setSnackbar] = useState<SnackbarMessage | null>(null);

  // Inline form state
  const [isAddingMasuk, setIsAddingMasuk] = useState(false);
  const [masukToEdit, setMasukToEdit] = useState<SuratMasuk | null>(null);

  const [isAddingKeluar, setIsAddingKeluar] = useState(false);
  const [keluarToEdit, setKeluarToEdit] = useState<SuratKeluar | null>(null);

  const [disposisiModalOpen, setDisposisiModalOpen] = useState(false);
  const [disposisiTarget, setDisposisiTarget] = useState<SuratMasuk | null>(null);

  // Lembar Disposisi Tab Active Target (replicates Cell A1 in Excel)
  const [selectedDisposisiId, setSelectedDisposisiId] = useState<string | null>(null);

  const [detailModalOpen, setDetailModalOpen] = useState(false);
  const [detailTarget, setDetailTarget] = useState<SuratMasuk | SuratKeluar | null>(null);
  const [detailType, setDetailType] = useState<'masuk' | 'keluar'>('masuk');

  const [composerModalOpen, setComposerModalOpen] = useState(false);

  const isSuperAdmin = profile?.role === 'super_admin';
  const satkerDisplayName = profile?.satkerName || profile?.displayName || 'Satuan Kerja Loyalis';

  const fetchData = useCallback(async (isSilent = false) => {
    if (!user) return;
    try {
      if (!isSilent) setLoading(true);
      else setRefreshing(true);

      const idToken = await user.getIdToken();
      let url = '/api/satker-surat';
      if (isSuperAdmin && selectedSatkerFilter !== 'all') {
        url += `?satkerId=${encodeURIComponent(selectedSatkerFilter)}`;
      }

      const res = await fetch(url, {
        headers: {
          Authorization: `Bearer ${idToken}`,
        },
      });

      const json = await res.json();
      if (!res.ok || !json.ok) {
        throw new Error(json.error || 'Gagal memuat data surat-menyurat.');
      }

      setSuratMasuk(json.suratMasuk || []);
      setSuratKeluar(json.suratKeluar || []);
      if (json.stats) setStats(json.stats);
      if (json.satkerList) setSatkerList(json.satkerList);
    } catch (err: unknown) {
      setSnackbar({
        type: 'error',
        text: err instanceof Error ? err.message : 'Gagal memuat data surat.',
      });
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [user, isSuperAdmin, selectedSatkerFilter]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  // Reset status & sifat filters and inline forms when switching tabs
  const handleTabChange = (newTab: Tab) => {
    setActiveTab(newTab);
    setStatusFilter('all');
    setSifatFilter('all');
    setIsAddingMasuk(false);
    setMasukToEdit(null);
    setIsAddingKeluar(false);
    setKeluarToEdit(null);
  };

  // Human-readable labels for toolbar filter dropdowns
  const satkerFilterLabel = useMemo(() => {
    if (selectedSatkerFilter === 'all') return 'Semua SatKer';
    return satkerList.find((s) => s.id === selectedSatkerFilter)?.name || selectedSatkerFilter;
  }, [selectedSatkerFilter, satkerList]);

  const statusFilterLabel = useMemo(() => {
    if (statusFilter === 'all') return 'Semua Status';
    if (activeTab === 'masuk') {
      return STATUS_SURAT_MASUK_OPTIONS.find((opt) => opt.value === statusFilter)?.label || statusFilter;
    }
    return STATUS_SURAT_KELUAR_OPTIONS.find((opt) => opt.value === statusFilter)?.label || statusFilter;
  }, [statusFilter, activeTab]);

  const sifatFilterLabel = useMemo(() => {
    if (sifatFilter === 'all') return 'Semua Sifat';
    return SIFAT_SURAT_OPTIONS.find((opt) => opt.value === sifatFilter)?.label || sifatFilter;
  }, [sifatFilter]);

  // Filtered by institution scope
  const filteredSuratMasuk = useMemo(() => {
    if (scopeFilter === 'all') return suratMasuk;
    return suratMasuk.filter((m) => (m.institutionScope || 'UNIPDU') === scopeFilter);
  }, [suratMasuk, scopeFilter]);

  const filteredSuratKeluar = useMemo(() => {
    if (scopeFilter === 'all') return suratKeluar;
    return suratKeluar.filter((k) => (k.institutionScope || 'UNIPDU') === scopeFilter);
  }, [suratKeluar, scopeFilter]);

  // Disposisi Save
  const handleSaveDisposisi = async (suratId: string, disposisi: DisposisiSurat) => {
    if (!user) return;
    const idToken = await user.getIdToken();
    const res = await fetch('/api/satker-surat', {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${idToken}`,
      },
      body: JSON.stringify({
        id: suratId,
        disposisi,
      }),
    });

    const json = await res.json();
    if (!res.ok || !json.ok) {
      throw new Error(json.error || 'Gagal menyimpan disposisi.');
    }

    setSnackbar({ type: 'success', text: 'Disposisi berhasil disimpan dan diperbarui.' });
    fetchData(true);
  };

  // Delete handler
  const handleDeleteLetter = async (id: string) => {
    if (!user) return;
    const idToken = await user.getIdToken();
    const res = await fetch(`/api/satker-surat?id=${encodeURIComponent(id)}`, {
      method: 'DELETE',
      headers: {
        Authorization: `Bearer ${idToken}`,
      },
    });

    const json = await res.json();
    if (!res.ok || !json.ok) {
      throw new Error(json.error || 'Gagal menghapus surat.');
    }

    setSnackbar({ type: 'success', text: 'Surat berhasil dihapus.' });
    fetchData(true);
  };

  // Next sequence number for Surat Keluar
  const nextSequence = useMemo(() => {
    return filteredSuratKeluar.length + 1;
  }, [filteredSuratKeluar]);

  // Export Agenda to Excel (Matches APLIKASI PERSURATAN 2026.xlsx)
  const handleExportExcel = () => {
    try {
      exportBukuAgendaToExcel({
        satkerName: scopeFilter === 'YAPETIDU'
          ? "YAYASAN PESANTREN TINGGI DARUL 'ULUM JOMBANG"
          : "UNIVERSITAS PESANTREN TINGGI DARUL 'ULUM JOMBANG",
        suratMasukList: filteredSuratMasuk,
        suratKeluarList: filteredSuratKeluar,
      });
      setSnackbar({ type: 'success', text: 'Buku agenda persuratan berhasil diekspor ke Excel.' });
    } catch {
      setSnackbar({ type: 'error', text: 'Gagal mengekspor data ke Excel.' });
    }
  };

  if (!profile || !canManageSuratMenyurat(profile.role)) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-50 via-indigo-50/80 to-slate-100 p-8 flex items-center justify-center font-sans">
        <div className="bg-white rounded-md p-8 shadow-sm border border-slate-200 text-center max-w-md">
          <AlertTriangle className="w-8 h-8 text-rose-500 mb-2 mx-auto" />
          <p className="font-semibold text-slate-800 text-base">Akses Terbatas</p>
          <p className="text-xs text-slate-500 mt-1">
            Halaman ini khusus untuk Kepala SatKer Loyalis dan Super Admin.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 via-indigo-50/80 to-slate-100 p-8 font-sans selection:bg-indigo-100 relative overflow-hidden text-slate-800">
      {/* Decorative soft blurred background blobs */}
      <div className="absolute top-0 right-0 w-[600px] h-[600px] rounded-full bg-indigo-100/40 blur-[120px] pointer-events-none" />
      <div className="absolute bottom-0 left-0 w-[500px] h-[500px] rounded-full bg-purple-100/30 blur-[100px] pointer-events-none" />

      <div className="relative z-10">
        <GlobalHeader />

        {/* Main Card */}
        <Card className="bg-white rounded-md shadow-[0_8px_30px_rgb(0,0,0,0.04)] border-none overflow-hidden">
          <div className="p-8 pb-0">
            {/* Title & Info Header */}
            <div className="flex justify-between items-start mb-6">
              <div>
                <div className="flex items-center gap-3 mb-4">
                  <div className="flex items-center gap-3 filter drop-shadow-sm">
                    {/* Dynamic Logo rendering based on Scope Filter */}
                    {scopeFilter === 'YAPETIDU' ? (
                      <Image
                        src="/Logo YAPETIDU (Transparent bg).png"
                        alt="Logo YAPETIDU"
                        width={512}
                        height={474}
                        priority
                        className="h-11 w-auto object-contain hover:scale-105 transition-transform duration-300"
                      />
                    ) : scopeFilter === 'UNIPDU' ? (
                      <Image
                        src="/Logo UNIPDU.png"
                        alt="Logo UNIPDU"
                        width={300}
                        height={304}
                        priority
                        className="h-11 w-auto object-contain hover:scale-105 transition-transform duration-300"
                      />
                    ) : (
                      <>
                        <Image
                          src="/Logo YAPETIDU (Transparent bg).png"
                          alt="Logo YAPETIDU"
                          width={512}
                          height={474}
                          priority
                          className="h-10 w-auto object-contain hover:scale-105 transition-transform duration-300 cursor-pointer"
                        />
                        <div className="w-px h-6 bg-slate-200" />
                        <Image
                          src="/Logo UNIPDU.png"
                          alt="Logo UNIPDU"
                          width={300}
                          height={304}
                          priority
                          className="h-10 w-auto object-contain hover:scale-105 transition-transform duration-300 cursor-pointer"
                        />
                      </>
                    )}
                  </div>

                  <div className="ml-2">
                    <div className="flex items-center gap-2">
                      <h1 className="text-3xl font-bold tracking-tight text-slate-900">
                        Aplikasi Persuratan 2026
                      </h1>
                      <Badge variant="outline" className="rounded-sm border-indigo-200 bg-indigo-50 text-indigo-700 text-[10px] font-bold">
                        {scopeFilter === 'YAPETIDU' ? 'YAPETIDU' : scopeFilter === 'UNIPDU' ? 'REKTORAT UNIPDU' : 'ALL SCOPES'}
                      </Badge>
                    </div>
                    <p className="text-xs text-slate-500 mt-0.5">
                      {scopeFilter === 'YAPETIDU'
                        ? "Yayasan Pesantren Tinggi Darul 'Ulum Jombang"
                        : scopeFilter === 'UNIPDU'
                        ? "Universitas Pesantren Tinggi Darul 'Ulum — Sekretariat Rektorat"
                        : "Sistem Buku Agenda Persuratan, Penomoran Naskah, & Lembar Disposisi Digital"}
                    </p>
                  </div>
                </div>

                {/* Filter Controls Row */}
                <div className="flex flex-wrap items-center gap-4 mb-6">
                  {/* Segmented Tab Switcher replicating the Excel Worksheets */}
                  <div className="flex flex-wrap bg-slate-100 p-1 rounded-md gap-0.5">
                    <button
                      type="button"
                      onClick={() => handleTabChange('masuk')}
                      className={`px-3 py-1.5 rounded-sm text-xs font-semibold transition-all cursor-pointer flex items-center gap-1.5 ${
                        activeTab === 'masuk'
                          ? 'bg-white text-sky-700 shadow-sm font-bold'
                          : 'text-slate-500 hover:text-slate-700'
                      }`}
                    >
                      <Inbox className="w-3.5 h-3.5" />
                      Surat Masuk ({filteredSuratMasuk.length})
                    </button>

                    <button
                      type="button"
                      onClick={() => handleTabChange('keluar')}
                      className={`px-3 py-1.5 rounded-sm text-xs font-semibold transition-all cursor-pointer flex items-center gap-1.5 ${
                        activeTab === 'keluar'
                          ? 'bg-white text-indigo-600 shadow-sm font-bold'
                          : 'text-slate-500 hover:text-slate-700'
                      }`}
                    >
                      <Send className="w-3.5 h-3.5" />
                      Surat Keluar ({filteredSuratKeluar.length})
                    </button>

                    <button
                      type="button"
                      onClick={() => handleTabChange('agenda')}
                      className={`px-3 py-1.5 rounded-sm text-xs font-semibold transition-all cursor-pointer flex items-center gap-1.5 ${
                        activeTab === 'agenda'
                          ? 'bg-white text-slate-800 shadow-sm font-bold'
                          : 'text-slate-500 hover:text-slate-700'
                      }`}
                    >
                      <BookOpen className="w-3.5 h-3.5" />
                      Buku Agenda
                    </button>

                    <button
                      type="button"
                      onClick={() => handleTabChange('disposisi')}
                      className={`px-3 py-1.5 rounded-sm text-xs font-semibold transition-all cursor-pointer flex items-center gap-1.5 ${
                        activeTab === 'disposisi'
                          ? 'bg-white text-amber-700 shadow-sm font-bold'
                          : 'text-slate-500 hover:text-slate-700'
                      }`}
                    >
                      <FileCheck className="w-3.5 h-3.5" />
                      Lembar Disposisi
                    </button>

                    <button
                      type="button"
                      onClick={() => handleTabChange('label')}
                      className={`px-3 py-1.5 rounded-sm text-xs font-semibold transition-all cursor-pointer flex items-center gap-1.5 ${
                        activeTab === 'label'
                          ? 'bg-white text-emerald-700 shadow-sm font-bold'
                          : 'text-slate-500 hover:text-slate-700'
                      }`}
                    >
                      <Tag className="w-3.5 h-3.5" />
                      Label Arsip
                    </button>

                    <button
                      type="button"
                      onClick={() => handleTabChange('rekap')}
                      className={`px-3 py-1.5 rounded-sm text-xs font-semibold transition-all cursor-pointer flex items-center gap-1.5 ${
                        activeTab === 'rekap'
                          ? 'bg-white text-indigo-600 shadow-sm font-bold'
                          : 'text-slate-500 hover:text-slate-700'
                      }`}
                    >
                      <BarChart3 className="w-3.5 h-3.5" />
                      Statistik
                    </button>
                  </div>

                  {/* Institution Scope Switcher */}
                  <div className="flex bg-slate-100 p-1 rounded-md border border-slate-200">
                    <button
                      type="button"
                      onClick={() => setScopeFilter('all')}
                      className={`px-2.5 py-1 rounded-sm text-xs font-semibold transition-all cursor-pointer ${
                        scopeFilter === 'all'
                          ? 'bg-white text-slate-800 shadow-xs font-bold'
                          : 'text-slate-500 hover:text-slate-800'
                      }`}
                    >
                      Semua
                    </button>
                    <button
                      type="button"
                      onClick={() => setScopeFilter('UNIPDU')}
                      className={`px-2.5 py-1 rounded-sm text-xs font-semibold transition-all cursor-pointer ${
                        scopeFilter === 'UNIPDU'
                          ? 'bg-white text-indigo-600 shadow-xs font-bold'
                          : 'text-slate-500 hover:text-slate-800'
                      }`}
                    >
                      UNIPDU (Rektorat)
                    </button>
                    <button
                      type="button"
                      onClick={() => setScopeFilter('YAPETIDU')}
                      className={`px-2.5 py-1 rounded-sm text-xs font-semibold transition-all cursor-pointer ${
                        scopeFilter === 'YAPETIDU'
                          ? 'bg-white text-emerald-700 shadow-xs font-bold'
                          : 'text-slate-500 hover:text-slate-800'
                      }`}
                    >
                      YAPETIDU (Yayasan)
                    </button>
                  </div>

                  {/* Super Admin SatKer Filter */}
                  {isSuperAdmin && satkerList.length > 0 && (
                    <Select value={selectedSatkerFilter} onValueChange={(v) => v && setSelectedSatkerFilter(v)}>
                      <SelectTrigger className="bg-white border-slate-200 text-slate-700 text-xs font-semibold rounded-sm px-3 py-2.5 h-9 outline-none focus:ring-2 focus:ring-indigo-500/20 transition-all cursor-pointer shadow-sm w-auto min-w-[150px]">
                        <SelectValue>{satkerFilterLabel}</SelectValue>
                      </SelectTrigger>
                      <SelectContent className="rounded-md border border-slate-200 bg-white p-1 shadow-xl ring-0 max-h-60">
                        <SelectItem
                          value="all"
                          className="rounded-sm py-2 pr-8 pl-3 text-xs font-medium text-slate-700 focus:bg-indigo-50 focus:text-indigo-900 data-[selected]:font-semibold data-[selected]:text-indigo-700"
                        >
                          Semua SatKer
                        </SelectItem>
                        {satkerList.map((s) => (
                          <SelectItem
                            key={s.id}
                            value={s.id}
                            className="rounded-sm py-2 pr-8 pl-3 text-xs font-medium text-slate-700 focus:bg-indigo-50 focus:text-indigo-900 data-[selected]:font-semibold data-[selected]:text-indigo-700"
                          >
                            {s.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  )}

                  {/* Status Filter */}
                  {(activeTab === 'masuk' || activeTab === 'keluar') && (
                    <Select value={statusFilter} onValueChange={(v) => v && setStatusFilter(v)}>
                      <SelectTrigger className="bg-white border-slate-200 text-slate-700 text-xs font-semibold rounded-sm px-3 py-2.5 h-9 outline-none focus:ring-2 focus:ring-indigo-500/20 transition-all cursor-pointer shadow-sm w-auto min-w-[130px]">
                        <SelectValue>{statusFilterLabel}</SelectValue>
                      </SelectTrigger>
                      <SelectContent className="rounded-md border border-slate-200 bg-white p-1 shadow-xl ring-0">
                        <SelectItem
                          value="all"
                          className="rounded-sm py-2 pr-8 pl-3 text-xs font-medium text-slate-700 focus:bg-indigo-50 focus:text-indigo-900 data-[selected]:font-semibold data-[selected]:text-indigo-700"
                        >
                          Semua Status
                        </SelectItem>
                        {activeTab === 'masuk'
                          ? STATUS_SURAT_MASUK_OPTIONS.map((opt) => (
                              <SelectItem
                                key={opt.value}
                                value={opt.value}
                                className="rounded-sm py-2 pr-8 pl-3 text-xs font-medium text-slate-700 focus:bg-indigo-50 focus:text-indigo-900 data-[selected]:font-semibold data-[selected]:text-indigo-700"
                              >
                                {opt.label}
                              </SelectItem>
                            ))
                          : STATUS_SURAT_KELUAR_OPTIONS.map((opt) => (
                              <SelectItem
                                key={opt.value}
                                value={opt.value}
                                className="rounded-sm py-2 pr-8 pl-3 text-xs font-medium text-slate-700 focus:bg-indigo-50 focus:text-indigo-900 data-[selected]:font-semibold data-[selected]:text-indigo-700"
                              >
                                {opt.label}
                              </SelectItem>
                            ))}
                      </SelectContent>
                    </Select>
                  )}

                  {/* Sifat Filter */}
                  {(activeTab === 'masuk' || activeTab === 'keluar') && (
                    <Select value={sifatFilter} onValueChange={(v) => v && setSifatFilter(v)}>
                      <SelectTrigger className="bg-white border-slate-200 text-slate-700 text-xs font-semibold rounded-sm px-3 py-2.5 h-9 outline-none focus:ring-2 focus:ring-indigo-500/20 transition-all cursor-pointer shadow-sm w-auto min-w-[120px]">
                        <SelectValue>{sifatFilterLabel}</SelectValue>
                      </SelectTrigger>
                      <SelectContent className="rounded-md border border-slate-200 bg-white p-1 shadow-xl ring-0">
                        <SelectItem
                          value="all"
                          className="rounded-sm py-2 pr-8 pl-3 text-xs font-medium text-slate-700 focus:bg-indigo-50 focus:text-indigo-900 data-[selected]:font-semibold data-[selected]:text-indigo-700"
                        >
                          Semua Sifat
                        </SelectItem>
                        {SIFAT_SURAT_OPTIONS.map((opt) => (
                          <SelectItem
                            key={opt.value}
                            value={opt.value}
                            className="rounded-sm py-2 pr-8 pl-3 text-xs font-medium text-slate-700 focus:bg-indigo-50 focus:text-indigo-900 data-[selected]:font-semibold data-[selected]:text-indigo-700"
                          >
                            {opt.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  )}

                  {/* Search Input Bar */}
                  {(activeTab === 'masuk' || activeTab === 'keluar') && (
                    <div className="relative flex-1 min-w-[200px]">
                      <span className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none text-slate-400">
                        <Search className="w-4 h-4" />
                      </span>
                      <input
                        type="text"
                        placeholder="Cari nomor, pihak, perihal..."
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                        className="w-full bg-white border border-slate-200 text-slate-700 placeholder:text-slate-400 text-xs font-semibold rounded-sm pl-10 pr-4 py-2 outline-none focus:border-indigo-500 focus:ring-4 focus:ring-indigo-100 transition-all shadow-sm"
                      />
                    </div>
                  )}
                </div>

                {/* Summary Stats Row */}
                <div className="flex flex-wrap gap-8 text-sm mb-6">
                  <div>
                    <span className="text-slate-500 block mb-1">Surat Masuk</span>
                    <span className="font-medium text-slate-800">{loading ? '...' : filteredSuratMasuk.length}</span>
                  </div>
                  <div>
                    <span className="text-slate-500 block mb-1">Perlu Disposisi</span>
                    <span className={`font-medium ${stats.menungguDisposisi > 0 ? 'text-amber-600 font-semibold' : 'text-slate-600'}`}>
                      {loading ? '...' : stats.menungguDisposisi}
                    </span>
                  </div>
                  <div>
                    <span className="text-slate-500 block mb-1">Surat Keluar</span>
                    <span className="font-medium text-slate-800">
                      {loading ? '...' : `${filteredSuratKeluar.length}`}
                    </span>
                  </div>
                  <div>
                    <span className="text-slate-500 block mb-1">Surat Bulan Ini</span>
                    <span className="font-bold text-indigo-600">{loading ? '...' : stats.suratBulanIni}</span>
                  </div>
                  <div>
                    <span className="text-slate-500 block mb-1">Total Arsip</span>
                    <span className="font-medium text-slate-800">
                      {loading ? '...' : filteredSuratMasuk.length + filteredSuratKeluar.length}
                    </span>
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* Table / Content Section */}
          <div className="p-0">
            {/* Section Bar */}
            <div className="px-8 py-4 flex flex-wrap justify-between items-center gap-4 border-b border-slate-100">
              <span className="font-semibold text-lg text-slate-900">
                {activeTab === 'masuk'
                  ? 'Agenda Surat Masuk'
                  : activeTab === 'keluar'
                  ? 'Agenda Surat Keluar'
                  : activeTab === 'agenda'
                  ? 'Buku Agenda Persuratan (Lengkap)'
                  : activeTab === 'disposisi'
                  ? 'Lembar Disposisi Dinamis (VLOOKUP A1)'
                  : activeTab === 'label'
                  ? 'Label Stiker Arsip (Binder & Box File)'
                  : 'Statistik Persuratan'}
              </span>

              <div className="flex items-center gap-3">
                {/* Outline Soft Emerald Button */}
                <button
                  type="button"
                  onClick={handleExportExcel}
                  className="inline-flex items-center gap-2 px-4 py-2 text-xs font-semibold rounded-sm border border-emerald-200 text-emerald-700 bg-emerald-50 hover:bg-emerald-100 hover:shadow-sm transition-all duration-150 cursor-pointer shadow-sm"
                >
                  <FileDown className="w-4 h-4 text-emerald-600" />
                  Ekspor Excel (Format Template)
                </button>

                {/* Outline Soft Indigo Button */}
                <button
                  type="button"
                  onClick={() => setComposerModalOpen(true)}
                  className="inline-flex items-center gap-2 px-4 py-2 text-xs font-semibold rounded-sm border border-indigo-200 text-indigo-600 bg-indigo-50 hover:bg-indigo-100 hover:shadow-sm transition-all duration-150 cursor-pointer shadow-sm"
                >
                  <Wand2 className="w-4 h-4 text-indigo-500" />
                  Buat Surat (Template)
                </button>

                {/* Solid Primary Button */}
                {activeTab === 'masuk' && (
                  <Button
                    type="button"
                    onClick={() => {
                      if (isAddingMasuk) {
                        setIsAddingMasuk(false);
                      } else {
                        setMasukToEdit(null);
                        setIsAddingMasuk(true);
                      }
                    }}
                    className="rounded-sm bg-sky-600 hover:bg-sky-700 text-white font-semibold flex items-center gap-2 shadow-md shadow-sky-100"
                  >
                    {isAddingMasuk ? (
                      <>
                        <X className="w-4 h-4" />
                        Tutup Formulir
                      </>
                    ) : (
                      <>
                        <Plus className="w-4 h-4" />
                        Tambah Surat Masuk
                      </>
                    )}
                  </Button>
                )}

                {activeTab === 'keluar' && (
                  <Button
                    type="button"
                    onClick={() => {
                      if (isAddingKeluar) {
                        setIsAddingKeluar(false);
                      } else {
                        setKeluarToEdit(null);
                        setIsAddingKeluar(true);
                      }
                    }}
                    className="rounded-sm bg-indigo-600 hover:bg-indigo-700 text-white font-semibold flex items-center gap-2 shadow-md shadow-indigo-100"
                  >
                    {isAddingKeluar ? (
                      <>
                        <X className="w-4 h-4" />
                        Tutup Formulir
                      </>
                    ) : (
                      <>
                        <Plus className="w-4 h-4" />
                        Catat Surat Keluar
                      </>
                    )}
                  </Button>
                )}

                {/* Neutral Outline Button */}
                <button
                  type="button"
                  onClick={() => fetchData(true)}
                  disabled={refreshing}
                  className="inline-flex items-center justify-center w-8 h-8 rounded-sm border border-slate-200 text-slate-700 bg-white hover:bg-slate-50 transition-all shadow-sm cursor-pointer"
                  title="Segarkan data"
                >
                  <RefreshCw className={`w-3.5 h-3.5 text-slate-500 ${refreshing ? 'animate-spin' : ''}`} />
                </button>
              </div>
            </div>

            {/* Tab Views */}
            {loading ? (
              <div className="p-20 flex flex-col items-center justify-center text-slate-400">
                <Loader2 className="w-8 h-8 animate-spin text-indigo-600 mb-3" />
                <span className="text-xs font-semibold">Memuat data persuratan...</span>
              </div>
            ) : activeTab === 'masuk' ? (
              <SuratMasukPanel
                data={filteredSuratMasuk}
                searchQuery={searchQuery}
                statusFilter={statusFilter}
                sifatFilter={sifatFilter}
                isAdding={isAddingMasuk}
                editingItem={masukToEdit}
                defaultSatkerName={satkerDisplayName}
                targetSatkerId={isSuperAdmin && selectedSatkerFilter !== 'all' ? selectedSatkerFilter : undefined}
                onCancelForm={() => {
                  setIsAddingMasuk(false);
                  setMasukToEdit(null);
                }}
                onSaveSuccess={() => {
                  const wasEditing = Boolean(masukToEdit);
                  setIsAddingMasuk(false);
                  setMasukToEdit(null);
                  fetchData(true);
                  setSnackbar({
                    type: 'success',
                    text: wasEditing ? 'Surat masuk berhasil diperbarui.' : 'Surat masuk berhasil dicatat.',
                  });
                }}
                onOpenEdit={(surat) => {
                  setIsAddingMasuk(false);
                  setMasukToEdit(surat);
                }}
                onOpenDetail={(surat) => {
                  setDetailTarget(surat);
                  setDetailType('masuk');
                  setDetailModalOpen(true);
                }}
                onOpenDisposisi={(surat) => {
                  setSelectedDisposisiId(surat.id);
                  setActiveTab('disposisi');
                }}
                onDelete={handleDeleteLetter}
              />
            ) : activeTab === 'keluar' ? (
              <SuratKeluarPanel
                data={filteredSuratKeluar}
                searchQuery={searchQuery}
                statusFilter={statusFilter}
                sifatFilter={sifatFilter}
                isAdding={isAddingKeluar}
                editingItem={keluarToEdit}
                defaultSatkerName={satkerDisplayName}
                defaultKepalaName={profile?.displayName || ''}
                nextSequence={nextSequence}
                targetSatkerId={isSuperAdmin && selectedSatkerFilter !== 'all' ? selectedSatkerFilter : undefined}
                onCancelForm={() => {
                  setIsAddingKeluar(false);
                  setKeluarToEdit(null);
                }}
                onSaveSuccess={() => {
                  const wasEditing = Boolean(keluarToEdit);
                  setIsAddingKeluar(false);
                  setKeluarToEdit(null);
                  fetchData(true);
                  setSnackbar({
                    type: 'success',
                    text: wasEditing ? 'Surat keluar berhasil diperbarui.' : 'Surat keluar berhasil dicatat.',
                  });
                }}
                onOpenEdit={(surat) => {
                  setIsAddingKeluar(false);
                  setKeluarToEdit(surat);
                }}
                onOpenDetail={(surat) => {
                  setDetailTarget(surat);
                  setDetailType('keluar');
                  setDetailModalOpen(true);
                }}
                onDelete={handleDeleteLetter}
              />
            ) : activeTab === 'agenda' ? (
              /* Unified Buku Agenda Ledger View */
              <BukuAgendaTable
                suratMasukList={filteredSuratMasuk}
                suratKeluarList={filteredSuratKeluar}
                scopeFilter={scopeFilter}
                onOpenDetail={(surat, type) => {
                  setDetailTarget(surat);
                  setDetailType(type);
                  setDetailModalOpen(true);
                }}
                onOpenDisposisi={(surat) => {
                  setSelectedDisposisiId(surat.id);
                  setActiveTab('disposisi');
                }}
              />
            ) : activeTab === 'disposisi' ? (
              /* Official Printable Lembar Disposisi Sheet View */
              <LembarDisposisiView
                suratList={filteredSuratMasuk}
                selectedSuratId={selectedDisposisiId}
                onSelectSuratId={(id) => setSelectedDisposisiId(id)}
                onSaveDisposisi={handleSaveDisposisi}
                defaultScope={scopeFilter === 'YAPETIDU' ? 'YAPETIDU' : 'UNIPDU'}
                currentUserName={profile?.displayName || 'Rektor UNIPDU'}
              />
            ) : activeTab === 'label' ? (
              /* Printable Archive Labels Grid */
              <LabelArsipView
                suratMasukList={filteredSuratMasuk}
                suratKeluarList={filteredSuratKeluar}
                defaultScope={scopeFilter === 'YAPETIDU' ? 'YAPETIDU' : 'UNIPDU'}
              />
            ) : (
              /* Rekap & Breakdown Summary */
              <div className="p-8 space-y-6">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  {/* Status Breakdown Surat Masuk */}
                  <div className="bg-slate-50/50 rounded-md p-6 border border-slate-200 space-y-3">
                    <span className="text-sm font-semibold text-slate-800 flex items-center gap-2">
                      <Inbox className="w-4 h-4 text-sky-600" />
                      Penanganan Surat Masuk
                    </span>
                    <div className="space-y-2 text-xs">
                      <div className="flex justify-between items-center bg-white p-3 rounded-sm border border-slate-200">
                        <span className="text-slate-600 font-medium">Menunggu Disposisi:</span>
                        <Badge variant="outline" className="rounded-sm border-amber-200 bg-amber-50 text-amber-700 font-semibold">
                          {stats.menungguDisposisi} surat
                        </Badge>
                      </div>
                      <div className="flex justify-between items-center bg-white p-3 rounded-sm border border-slate-200">
                        <span className="text-slate-600 font-medium">Sedang Diproses:</span>
                        <Badge variant="outline" className="rounded-sm border-indigo-200 bg-indigo-50 text-indigo-700 font-semibold">
                          {stats.diproses} surat
                        </Badge>
                      </div>
                      <div className="flex justify-between items-center bg-white p-3 rounded-sm border border-slate-200">
                        <span className="text-slate-600 font-medium">Selesai Ditindaklanjuti:</span>
                        <Badge variant="outline" className="rounded-sm border-emerald-200 bg-emerald-50 text-emerald-700 font-semibold">
                          {stats.selesaiMasuk} surat
                        </Badge>
                      </div>
                    </div>
                  </div>

                  {/* Status Breakdown Surat Keluar */}
                  <div className="bg-slate-50/50 rounded-md p-6 border border-slate-200 space-y-3">
                    <span className="text-sm font-semibold text-slate-800 flex items-center gap-2">
                      <Send className="w-4 h-4 text-indigo-600" />
                      Penerbitan Surat Keluar
                    </span>
                    <div className="space-y-2 text-xs">
                      <div className="flex justify-between items-center bg-white p-3 rounded-sm border border-slate-200">
                        <span className="text-slate-600 font-medium">Draft Naskah:</span>
                        <Badge variant="outline" className="rounded-sm border-slate-200 bg-slate-100 text-slate-700 font-semibold">
                          {stats.draftKeluar} surat
                        </Badge>
                      </div>
                      <div className="flex justify-between items-center bg-white p-3 rounded-sm border border-slate-200">
                        <span className="text-slate-600 font-medium">Terkirim Resmi:</span>
                        <Badge variant="outline" className="rounded-sm border-emerald-200 bg-emerald-50 text-emerald-700 font-semibold">
                          {stats.terkirimKeluar} surat
                        </Badge>
                      </div>
                      <div className="flex justify-between items-center bg-white p-3 rounded-sm border border-slate-200">
                        <span className="text-slate-600 font-medium">Total Surat Keluar:</span>
                        <Badge variant="outline" className="rounded-sm border-indigo-200 bg-indigo-50 text-indigo-700 font-semibold">
                          {stats.totalKeluar} surat
                        </Badge>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            )}
          </div>
        </Card>
      </div>

      {/* Disposisi Modal (Quick edit popup) */}
      <SuratDisposisiDialog
        open={disposisiModalOpen}
        onOpenChange={setDisposisiModalOpen}
        surat={disposisiTarget}
        currentUserName={profile?.displayName || 'Kepala SatKer'}
        onSave={handleSaveDisposisi}
      />

      {/* Detail Dialog */}
      <SuratDetailDialog
        open={detailModalOpen}
        onOpenChange={setDetailModalOpen}
        surat={detailTarget}
        type={detailType}
        onOpenDisposisi={(s) => {
          setSelectedDisposisiId(s.id);
          setActiveTab('disposisi');
        }}
      />

      {/* Surat Composer Live Template Generator */}
      <SuratComposerModal
        open={composerModalOpen}
        onOpenChange={setComposerModalOpen}
        defaultSatkerName={satkerDisplayName}
        defaultKepalaName={profile?.displayName || ''}
        nextSequence={nextSequence}
        onSavedToSuratKeluar={() => {
          fetchData(true);
        }}
      />

      {snackbar && (
        <FloatingSnackbar
          message={snackbar}
          onDismiss={() => setSnackbar(null)}
        />
      )}
    </div>
  );
}
