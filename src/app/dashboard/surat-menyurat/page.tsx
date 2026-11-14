"use client";

import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { useAuth } from '@/lib/AuthContext';
import { canManageSuratMenyurat } from '@/lib/payroll/roles';
import { SuratMasuk, SuratKeluar, SuratStats, InstitutionScope } from '@/lib/surat-menyurat/types';
import { exportBukuAgendaToExcel } from '@/lib/surat-menyurat/excel';
import {
  INSTITUTION_SCOPES,
} from '@/lib/surat-menyurat/constants';
import SuratMasukPanel from '@/components/surat-menyurat/SuratMasukPanel';
import SuratKeluarPanel from '@/components/surat-menyurat/SuratKeluarPanel';
import SuratDetailDialog from '@/components/surat-menyurat/SuratDetailDialog';
import SuratComposerModal from '@/components/surat-menyurat/SuratComposerModal';
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
  Search,
  Send,
  Wand2,
  AlertTriangle,
  X,
  Tag,
  BookOpen,
  BarChart3,
  Building2,
} from 'lucide-react';

type Tab = 'masuk' | 'keluar' | 'agenda' | 'label' | 'rekap';

export default function SuratMenyuratPage() {
  const { user, profile } = useAuth();

  const [activeTab, setActiveTab] = useState<Tab>('masuk');
  const [scopeFilter, setScopeFilter] = useState<'all' | 'UNIPDU' | 'YAPETIDU'>('UNIPDU');
  const [loading, setLoading] = useState(true);
  const [suratMasuk, setSuratMasuk] = useState<SuratMasuk[]>([]);
  const [suratKeluar, setSuratKeluar] = useState<SuratKeluar[]>([]);
  const [stats, setStats] = useState<SuratStats>({
    totalMasuk: 0,
    totalKeluar: 0,
    suratBulanIni: 0,
  });
  const [satkerList, setSatkerList] = useState<{ id: string; name: string; initials?: string }[]>([]);
  const [selectedSatkerFilter, setSelectedSatkerFilter] = useState<string>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [snackbar, setSnackbar] = useState<SnackbarMessage | null>(null);
  const [userContact, setUserContact] = useState<{ email: string; phone: string }>({ email: '', phone: '' });

  // Inline form state
  const [isAddingMasuk, setIsAddingMasuk] = useState(false);
  const [masukToEdit, setMasukToEdit] = useState<SuratMasuk | null>(null);

  const [keluarToEdit, setKeluarToEdit] = useState<SuratKeluar | null>(null);

  const [detailModalOpen, setDetailModalOpen] = useState(false);
  const [detailTarget, setDetailTarget] = useState<SuratMasuk | SuratKeluar | null>(null);
  const [detailType, setDetailType] = useState<'masuk' | 'keluar'>('masuk');

  const [composerModalOpen, setComposerModalOpen] = useState(false);
  const [inlineComposerOpen, setInlineComposerOpen] = useState(false);
  const keluarComposerRef = useRef<HTMLDivElement>(null);

  const isSuperAdmin = profile?.role === 'super_admin';
  const satkerDisplayName = profile?.satkerName || profile?.displayName || 'Satuan Kerja Loyalis';
  // Super Admin writes for the SatKer picked in the filter; a head writes for their own.
  const satkerInitials = isSuperAdmin
    ? satkerList.find((s) => s.id === selectedSatkerFilter)?.initials
    : profile?.satkerInitials;

  const fetchData = useCallback(async (isSilent = false) => {
    if (!user) return;
    try {
      if (!isSilent) setLoading(true);

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
      if (json.userContact) setUserContact(json.userContact);
    } catch (err: unknown) {
      setSnackbar({
        type: 'error',
        text: err instanceof Error ? err.message : 'Gagal memuat data surat.',
      });
    } finally {
      setLoading(false);
    }
  }, [user, isSuperAdmin, selectedSatkerFilter]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  // The edit form opens above the table, so bring it into view from any row.
  useEffect(() => {
    if (keluarToEdit) keluarComposerRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, [keluarToEdit]);

  // Reset inline forms when switching tabs
  const handleTabChange = (newTab: Tab) => {
    setActiveTab(newTab);
    setIsAddingMasuk(false);
    setMasukToEdit(null);
    setInlineComposerOpen(false);
    setKeluarToEdit(null);
  };

  // Human-readable labels for toolbar filter dropdowns
  const satkerFilterLabel = useMemo(() => {
    if (selectedSatkerFilter === 'all') return 'Semua SatKer';
    return satkerList.find((s) => s.id === selectedSatkerFilter)?.name || selectedSatkerFilter;
  }, [selectedSatkerFilter, satkerList]);

  // Filtered by institution scope
  const filteredSuratMasuk = useMemo(() => {
    if (scopeFilter === 'all') return suratMasuk;
    return suratMasuk.filter((m) => (m.institutionScope || 'UNIPDU') === scopeFilter);
  }, [suratMasuk, scopeFilter]);

  const filteredSuratKeluar = useMemo(() => {
    if (scopeFilter === 'all') return suratKeluar;
    return suratKeluar.filter((k) => (k.institutionScope || 'UNIPDU') === scopeFilter);
  }, [suratKeluar, scopeFilter]);

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

        <h1 className="mb-8 text-3xl font-bold text-slate-800">Surat Menyurat</h1>

        {/* Main Card */}
        <Card className="gap-0 bg-white rounded-md shadow-[0_8px_30px_rgb(0,0,0,0.04)] border-none overflow-hidden">
          <div className="p-8 pb-0">
            {/* Title & Info Header */}
            <div className="flex justify-between items-start">
              <div className="w-full min-w-0">
                {/* Filter Controls Row */}
                <div className="flex flex-wrap items-center gap-4">
                  {/* Segmented Tab Switcher replicating the Excel Worksheets */}
                  <div className="flex flex-wrap bg-slate-100 p-1 rounded-md gap-0.5">
                    <button
                      type="button"
                      onClick={() => handleTabChange('masuk')}
                      className={`px-4 py-2 rounded-sm text-sm font-semibold transition-all cursor-pointer flex items-center gap-1.5 ${
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
                      className={`px-4 py-2 rounded-sm text-sm font-semibold transition-all cursor-pointer flex items-center gap-1.5 ${
                        activeTab === 'keluar'
                          ? 'bg-white text-indigo-600 shadow-sm font-bold'
                          : 'text-slate-500 hover:text-slate-700'
                      }`}
                    >
                      <Send className="w-3.5 h-3.5" />
                      Surat Keluar ({filteredSuratKeluar.length})
                    </button>

                    <div hidden>
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
                  </div>

                  {/* Institution Scope Switcher */}
                  <div className="hidden bg-slate-100 p-1 rounded-md border border-slate-200">
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
                      <SelectContent className="w-max min-w-(--anchor-width) max-w-[calc(100vw-2rem)] rounded-md border border-slate-200 bg-white p-1 shadow-xl ring-0 max-h-60">
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
                  Ekspor Arsip (xlsx)
                </button>

                {/* Outline Soft Indigo Button */}
                {activeTab !== 'masuk' && (
                  <button
                    type="button"
                    onClick={() => setComposerModalOpen(true)}
                    className="inline-flex items-center gap-2 px-4 py-2 text-xs font-semibold rounded-sm border border-indigo-200 text-indigo-600 bg-indigo-50 hover:bg-indigo-100 hover:shadow-sm transition-all duration-150 cursor-pointer shadow-sm"
                  >
                    <Wand2 className="w-4 h-4 text-indigo-500" />
                    Atur Template Surat
                  </button>
                )}

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
                      setKeluarToEdit(null);
                      setInlineComposerOpen((open) => !open);
                    }}
                    className="rounded-sm bg-indigo-600 hover:bg-indigo-700 text-white font-semibold flex items-center gap-2 shadow-md shadow-indigo-100"
                  >
                    <Plus className="w-4 h-4" />
                    {inlineComposerOpen || keluarToEdit ? 'Tutup Formulir' : 'Catat Surat Keluar'}
                  </Button>
                )}

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
                sifatFilter="all"
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
                onDelete={handleDeleteLetter}
              />
            ) : activeTab === 'keluar' ? (
              <>
              {(inlineComposerOpen || keluarToEdit) && <div ref={keluarComposerRef} className="p-6"><SuratComposerModal
                key={keluarToEdit?.id ?? 'new'}
                inline
                open
                surat={keluarToEdit}
                onOpenChange={() => {
                  setInlineComposerOpen(false);
                  setKeluarToEdit(null);
                }}
                defaultSatkerName={satkerDisplayName}
                defaultSatkerInitials={satkerInitials}
                defaultKepalaName={profile?.displayName || ''}
                defaultKepalaEmail={userContact.email || profile?.email || user?.email || ''}
                defaultKepalaPhone={userContact.phone || profile?.phoneNumber || profile?.phone || ''}
                nextSequence={nextSequence}
                targetSatkerId={isSuperAdmin && selectedSatkerFilter !== 'all' ? selectedSatkerFilter : undefined}
                onSavedToSuratKeluar={() => {
                  const wasEditing = Boolean(keluarToEdit);
                  setInlineComposerOpen(false);
                  setKeluarToEdit(null);
                  fetchData(true);
                  setSnackbar({
                    type: 'success',
                    text: wasEditing ? 'Surat keluar berhasil diperbarui.' : 'Surat keluar berhasil dicatat.',
                  });
                }}
              /></div>}
              <SuratKeluarPanel
                data={filteredSuratKeluar}
                searchQuery={searchQuery}
                sifatFilter="all"
                onOpenEdit={(surat) => {
                  setInlineComposerOpen(false);
                  setKeluarToEdit(surat);
                }}
                onOpenDetail={(surat) => {
                  setDetailTarget(surat);
                  setDetailType('keluar');
                  setDetailModalOpen(true);
                }}
                onDelete={handleDeleteLetter}
              />
              </>
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
                  {/* Surat Masuk */}
                  <div className="bg-slate-50/50 rounded-md p-6 border border-slate-200 space-y-3">
                    <span className="text-sm font-semibold text-slate-800 flex items-center gap-2">
                      <Inbox className="w-4 h-4 text-sky-600" />
                      Surat Masuk
                    </span>
                    <div className="space-y-2 text-xs">
                      <div className="flex justify-between items-center bg-white p-3 rounded-sm border border-slate-200">
                        <span className="text-slate-600 font-medium">Total Surat Masuk:</span>
                        <Badge variant="outline" className="rounded-sm border-sky-200 bg-sky-50 text-sky-700 font-semibold">
                          {stats.totalMasuk} surat
                        </Badge>
                      </div>
                    </div>
                  </div>

                  {/* Surat Keluar */}
                  <div className="bg-slate-50/50 rounded-md p-6 border border-slate-200 space-y-3">
                    <span className="text-sm font-semibold text-slate-800 flex items-center gap-2">
                      <Send className="w-4 h-4 text-indigo-600" />
                      Surat Keluar
                    </span>
                    <div className="space-y-2 text-xs">
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

      {/* Detail Dialog */}
      <SuratDetailDialog
        open={detailModalOpen}
        onOpenChange={setDetailModalOpen}
        surat={detailTarget}
        type={detailType}
      />

      {/* Surat Composer Live Template Generator */}
      {composerModalOpen && <SuratComposerModal
        open={composerModalOpen}
        onOpenChange={setComposerModalOpen}
        defaultSatkerName={satkerDisplayName}
        defaultSatkerInitials={satkerInitials}
        defaultKepalaName={profile?.displayName || ''}
        defaultKepalaEmail={userContact.email || profile?.email || user?.email || ''}
        defaultKepalaPhone={userContact.phone || profile?.phoneNumber || profile?.phone || ''}
        nextSequence={nextSequence}
        targetSatkerId={isSuperAdmin && selectedSatkerFilter !== 'all' ? selectedSatkerFilter : undefined}
        onSavedToSuratKeluar={() => {
          fetchData(true);
        }}
      />}

      {snackbar && (
        <FloatingSnackbar
          message={snackbar}
          onDismiss={() => setSnackbar(null)}
        />
      )}
    </div>
  );
}
