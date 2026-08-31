"use client"

import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { FloatingSnackbar } from '@/components/ui/floating-snackbar';
import { useSearchParams } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card } from '@/components/ui/card';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@/components/ui/select';
import {
  Loader2, CheckCircle2, FileText, AlertCircle, Trash2, Plus, Save,
  Calendar, Check, ShieldCheck, FileSpreadsheet, Users, Info, Settings, Clock,
  Upload, Trash, UserCircle2, Sparkles, Building2, Code2, Lock
} from 'lucide-react';
import { useAuth } from '@/lib/AuthContext';
import {
  collection, getDocs, query, where
} from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { MONTHS_ID } from '@/utils/rekapConfig';
import { authenticatedJson, createFinancialRequestId } from '@/lib/payroll/client';
import { syncActivityToPayslip } from '@/utils/payslipSync';
import {
  pekaryaPayrollWindow,
  sumApprovedActivitySpj,
  sumApprovedEventSpj,
} from '@/lib/payroll/pekaryaSpj';
import { VAKASI_PEKARYA_PROJECTION_SOURCE_KIND } from '@/lib/payroll/vakasiTambahan';

export default function SpjPekaryaPage() {
  const { profile } = useAuth();
  const searchParams = useSearchParams();

  // Read params from URL search parameters
  const month = parseInt(searchParams.get('month') || String(new Date().getMonth() + 1), 10);
  const year = parseInt(searchParams.get('year') || String(new Date().getFullYear()), 10);
  const category = searchParams.get('category') || "";

  const periodToken = `${year}-${String(month).padStart(2, '0')}`;

  // ── States ──
  const [blueCollarEmployees, setBlueCollarEmployees] = useState<any[]>([]);
  const [loadingBlueCollar, setLoadingBlueCollar] = useState(false);
  const [spjEvents, setSpjEvents] = useState<any[]>([]);
  const [loadingSpjEvents, setLoadingSpjEvents] = useState(false);
  const [approvedActivityReports, setApprovedActivityReports] = useState<any[]>([]);
  const [activeSpjSuggestionIndex, setActiveSpjSuggestionIndex] = useState<number>(0);

  // SPJ Form States
  const [selectedSpjEventId, setSelectedSpjEventId] = useState<string | null>(null);
  const [spjEventName, setSpjEventName] = useState('');
  const [spjEventFee, setSpjEventFee] = useState<number>(0);
  const [spjWorkerRows, setSpjWorkerRows] = useState<{
    employeeId: string;
    employeeName: string;
    payGiven: number;
    showDropdown?: boolean;
    searchText?: string;
    isInvalid?: boolean;
  }[]>([{ employeeId: '', employeeName: '', payGiven: 0, searchText: '', showDropdown: false }]);
  
  const [mobileSpjView, setMobileSpjView] = useState<'list' | 'form'>('list');

  const [saving, setSaving] = useState(false);
  const isSavingRef = useRef(false);
  const spjSaveRequestIdRef = useRef<string | null>(null);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const selectedSpjEvent = selectedSpjEventId
    ? spjEvents.find((event) => event.id === selectedSpjEventId)
    : null;
  const isVakasiProjection =
    selectedSpjEvent?.sourceKind === VAKASI_PEKARYA_PROJECTION_SOURCE_KIND;

  // ── Fetch Blue Collar Employees for SPJ ──
  useEffect(() => {
    const fetchBlueCollar = async () => {
      setLoadingBlueCollar(true);
      try {
        if (!category) {
          setBlueCollarEmployees([]);
          return;
        }
        const q = query(
          collection(db, 'Employees_BlueCollar'),
          where('employment.status', '==', 'active'),
          where('employment.jobCategory', '==', category),
        );
        const snap = await getDocs(q);
        const list = snap.docs.map(d => {
          const data = d.data();
          return {
            id: d.id,
            name: data.name || '',
            category: data.employment?.jobCategory || '',
          };
        }).sort((a, b) => a.name.localeCompare(b.name));
        setBlueCollarEmployees(list);
      } catch (err) {
        console.error('Error fetching Blue Collar employees for SPJ:', err);
      } finally {
        setLoadingBlueCollar(false);
      }
    };
    fetchBlueCollar();
  }, [category]);

  // ── Fetch Kegiatan SPJ Events & ActivityReports ──
  const fetchSpjEvents = useCallback(async () => {
    if (!category) return;
    setLoadingSpjEvents(true);
    try {
      const eventResult = await authenticatedJson<{
        events: any[];
        employees: { id: string; name: string }[];
      }>(
        `/api/pekarya/spj-events?period=${encodeURIComponent(periodToken)}&category=${encodeURIComponent(category)}`,
        { method: 'GET' },
      );
      setSpjEvents(eventResult.events);
      setBlueCollarEmployees(
        eventResult.employees.map((employee) => ({ ...employee, category })),
      );

      // Also fetch approved ActivityReports for the same period
      try {
        // Boundaries come from the shared rule (26th-25th through June 2026,
        // 26 Jun-31 Jul for the transition, calendar month from August 2026)
        // so this recap can never disagree with what lands on the payslip.
        const { startsOn: startDateStr, endsOn: endDateStr, sourceMonths } =
          pekaryaPayrollWindow(periodToken);

        const arSnaps = await Promise.all(
          sourceMonths.map(monthToken => getDocs(query(
            collection(db, 'ActivityReports'),
            where('period', '==', monthToken),
            where('status', '==', 'approved'),
            where('jobCategory', '==', category),
          ))),
        );

        const seenArIds = new Set<string>();
        const allAr = arSnaps
          .flatMap(snap => snap.docs.map(d => ({ id: d.id, ...d.data() })))
          .filter(doc => {
            if (seenArIds.has(doc.id)) return false;
            seenArIds.add(doc.id);
            return true;
          });

        const filteredAr = allAr.filter((ar: any) => {
          return ar.activityDate >= startDateStr && ar.activityDate <= endDateStr;
        });

        setApprovedActivityReports(filteredAr);
      } catch (arErr) {
        console.error('Error fetching ActivityReports:', arErr);
      }
    } catch (err) {
      console.error('Error fetching SPJ events:', err);
    } finally {
      setLoadingSpjEvents(false);
    }
  }, [category, periodToken]);

  useEffect(() => {
    fetchSpjEvents();
  }, [fetchSpjEvents]);

  // Helper: compute accumulated SPJ payout for an employee
  const getComputedSpj = useCallback((empId: string) => {
    const kegiatanTotal = sumApprovedEventSpj(
      spjEvents,
      empId,
      category,
      periodToken,
    );
    const activityTotal = sumApprovedActivitySpj(
      approvedActivityReports,
      empId,
      category,
      periodToken,
    );

    return kegiatanTotal + activityTotal;
  }, [spjEvents, approvedActivityReports, category, periodToken]);

  const handleSaveSpjEvent = async () => {
    if (isSavingRef.current) return;
    if (isVakasiProjection) {
      setMessage({
        type: 'error',
        text: 'SPJ proyeksi Vakasi hanya dapat diubah dari halaman Vakasi Tambahan.',
      });
      return;
    }
    if (!spjEventName.trim()) {
      setMessage({ type: 'error', text: 'Nama Kegiatan SPJ harus diisi.' });
      return;
    }
    const hasInvalid = spjWorkerRows.some(w => w.isInvalid || (w.searchText && !w.employeeId));
    if (hasInvalid) {
      setMessage({ type: 'error', text: 'Terdapat nama pegawai yang tidak terdaftar di database.' });
      return;
    }
    const activeWorkers = spjWorkerRows.filter(w => w.employeeId);
    if (activeWorkers.length === 0) {
      setMessage({ type: 'error', text: 'Minimal harus ada 1 pegawai.' });
      return;
    }
    const ids = activeWorkers.map(w => w.employeeId);
    if (new Set(ids).size !== ids.length) {
      setMessage({ type: 'error', text: 'Ada duplikasi pegawai dalam kegiatan ini.' });
      return;
    }

    isSavingRef.current = true;
    setSaving(true);
    try {
      const requestId =
        spjSaveRequestIdRef.current || createFinancialRequestId('spj_event_save');
      spjSaveRequestIdRef.current = requestId;
      const existing = selectedSpjEvent;
      await authenticatedJson('/api/pekarya/spj-events', {
        method: 'POST',
        body: JSON.stringify({
          requestId,
          eventId: selectedSpjEventId || undefined,
          period: periodToken,
          jobCategory: category,
          eventName: spjEventName,
          eventFee: spjEventFee,
          employeeIds: activeWorkers.map((worker) => worker.employeeId),
          expectedRevision: existing?.revision,
          reason: selectedSpjEventId
            ? 'Pembaruan rincian kegiatan SPJ oleh Kepala SatKer'
            : 'Pembuatan kegiatan SPJ oleh Kepala SatKer',
        }),
      });
      spjSaveRequestIdRef.current = null;
      const affectedEmployees = new Set([
        ...activeWorkers.map((worker) => worker.employeeId),
        ...Object.keys(existing?.eventWorkers || {}),
      ]);
      await Promise.all(
        Array.from(affectedEmployees).map((employeeId) =>
          syncActivityToPayslip(db, employeeId, periodToken),
        ),
      );
      setMessage({ type: 'success', text: `Kegiatan SPJ "${spjEventName}" berhasil disimpan.` });

      setSelectedSpjEventId(null);
      setSpjEventName('');
      setSpjEventFee(0);
      setSpjWorkerRows([{ employeeId: '', employeeName: '', payGiven: 0, searchText: '', showDropdown: false }]);
      setMobileSpjView('list');
      fetchSpjEvents();
    } catch (err) {
      console.error('Error saving SPJ event:', err);
      setMessage({
        type: 'error',
        text: err instanceof Error ? err.message : 'Gagal menyimpan Kegiatan SPJ.',
      });
    } finally {
      isSavingRef.current = false;
      setSaving(false);
    }
  };

  const handleDeleteSpjEvent = async (eventId: string) => {
    void eventId;
    setMessage({
      type: 'error',
      text: 'Penghapusan kegiatan SPJ dinonaktifkan agar riwayat tetap utuh. Gunakan alur koreksi.',
    });
  };

  const handleSpjAddRow = () => {
    setSpjWorkerRows(prev => [...prev, { employeeId: '', employeeName: '', payGiven: spjEventFee, searchText: '', showDropdown: false }]);
  };

  const fmtRp = (n: number) => 'Rp\u00a0' + Math.round(n).toLocaleString('id-ID');

  return (
    <div className="space-y-6">
      <FloatingSnackbar message={message} />

      {!category ? (
        <Card className="bg-white rounded-[20px] p-12 text-center flex flex-col items-center justify-center min-h-[400px] border-none shadow-sm">
          <Building2 className="w-12 h-12 text-slate-300 mb-4 animate-pulse" />
          <h4 className="text-slate-700 font-bold text-sm">Pilih Unit/Kategori Terlebih Dahulu</h4>
          <p className="text-xs text-slate-400 mt-1.5 max-w-xs">Silakan pilih kategori satuan kerja di bar filter atas untuk melihat dan membuat kegiatan SPJ Pekarya.</p>
        </Card>
      ) : (
        <div className="grid grid-cols-1 xl:grid-cols-12 gap-8 items-start">
          
          {/* Left Side List */}
          <div className={`xl:col-span-4 space-y-6 ${mobileSpjView === 'list' ? 'block' : 'hidden xl:block'}`}>
            <Card className="bg-white rounded-[20px] shadow-[0_8px_30px_rgb(0,0,0,0.04)] border-none p-6">
              <div className="flex justify-between items-center mb-4">
                <h3 className="font-bold text-slate-800 text-sm">Daftar Kegiatan SPJ</h3>
                <Button
                  onClick={() => {
                    spjSaveRequestIdRef.current = null;
                    setSelectedSpjEventId(null);
                    setSpjEventName('');
                    setSpjWorkerRows([{ employeeId: '', employeeName: '', payGiven: 0, searchText: '', showDropdown: false }]);
                    setMobileSpjView('form');
                  }}
                  size="sm"
                  className="bg-indigo-50 text-indigo-600 hover:bg-indigo-100 rounded-xl font-bold flex items-center gap-1.5"
                >
                  <Plus className="w-4.5 h-4.5" /> Baru
                </Button>
              </div>

              {loadingSpjEvents ? (
                <div className="py-12 flex justify-center items-center text-slate-400 text-xs">
                  <Loader2 className="w-4 h-4 animate-spin mr-2" /> Memuat data...
                </div>
              ) : spjEvents.length === 0 ? (
                <div className="py-12 text-center text-slate-400 text-xs">Belum ada kegiatan SPJ untuk unit {category}.</div>
              ) : (
                <div className="space-y-3 max-h-[500px] overflow-y-auto pr-1">
                  {spjEvents.map(evt => {
                    const isActive = selectedSpjEventId === evt.id;
                    const wCount = Object.keys(evt.eventWorkers || {}).length;
                    return (
                      <div
                        key={evt.id}
                        onClick={() => {
                          spjSaveRequestIdRef.current = null;
                          setSelectedSpjEventId(evt.id);
                          setSpjEventName(evt.eventName);
                          setSpjEventFee(evt.eventFee || 0);
                          const rows = Object.entries(evt.eventWorkers || {}).map(([id, w]: [string, any]) => ({
                            employeeId: id,
                            employeeName: w.employeeName || '',
                            payGiven: w.payGiven || 0,
                            searchText: w.employeeName || '',
                            showDropdown: false,
                          }));
                          setSpjWorkerRows(rows.length > 0 ? rows : [{ employeeId: '', employeeName: '', payGiven: 0, searchText: '', showDropdown: false }]);
                          setMobileSpjView('form');
                        }}
                        className={`p-4 rounded-xl border transition-all duration-200 cursor-pointer ${
                          isActive
                            ? 'bg-indigo-50/50 border-indigo-300 shadow-sm'
                            : 'bg-white border-slate-100 hover:border-indigo-100'
                        }`}
                      >
                        <div className="flex items-center justify-between gap-2">
                          <div className="font-bold text-slate-800 text-xs line-clamp-1">{evt.eventName}</div>
                          {evt.sourceKind === VAKASI_PEKARYA_PROJECTION_SOURCE_KIND && (
                            <span className="shrink-0 rounded-md bg-violet-100 px-2 py-0.5 text-[8px] font-black uppercase tracking-wide text-violet-700">
                              Vakasi Tambahan
                            </span>
                          )}
                        </div>
                        <div className="flex items-center justify-between mt-3 text-[10px] text-slate-400 font-medium">
                          <span className="bg-slate-100 px-2 py-0.5 rounded text-slate-600 font-bold uppercase tracking-wider">
                            {evt.variablePay ? 'Nominal per penerima' : `${fmtRp(evt.eventFee || 0)} / org`}
                          </span>
                          <span>{wCount} Pegawai · {fmtRp(evt.totalPayout || 0)}</span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </Card>
          </div>

          {/* Right Side Form */}
          <div className={`xl:col-span-8 ${mobileSpjView === 'form' ? 'block' : 'hidden xl:block'}`}>
            <Card className="bg-white rounded-[20px] shadow-[0_8px_30px_rgb(0,0,0,0.04)] border-none p-6 space-y-6">
              <div className="flex justify-between items-center pb-4 border-b border-slate-100">
                <h3 className="font-bold text-slate-800 text-sm">
                  {selectedSpjEventId ? 'Ubah Rincian Kegiatan SPJ' : 'Formulir Kegiatan SPJ Baru'}
                </h3>
                {selectedSpjEventId && (
                  <Button variant="ghost" size="sm" onClick={() => setMobileSpjView('list')} className="xl:hidden text-slate-500 text-xs">
                    Lihat Daftar
                  </Button>
                )}
              </div>

              {isVakasiProjection && (
                <div className="flex items-start gap-3 rounded-2xl border border-violet-200 bg-violet-50 p-4 text-xs text-violet-900">
                  <Lock className="mt-0.5 h-4 w-4 shrink-0 text-violet-600" />
                  <div>
                    <p className="font-black">Proyeksi otomatis Vakasi Tambahan</p>
                    <p className="mt-1 text-[11px] leading-relaxed text-violet-700">
                      Data ini hanya-baca. Nama penerima dan nominal mengikuti event Vakasi sumber agar SPJ tidak terhitung ganda.
                    </p>
                  </div>
                </div>
              )}

              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div className="space-y-1.5">
                  <label className="text-xs font-bold text-slate-500 uppercase tracking-wider block">Nama Kegiatan SPJ</label>
                  <Input
                    type="text"
                    placeholder="Contoh: Kerja Bakti Massal"
                    value={spjEventName}
                    disabled={isVakasiProjection}
                    onChange={(e) => setSpjEventName(e.target.value)}
                    className="rounded-xl border-slate-200 font-semibold text-slate-800 text-sm focus:border-indigo-500 h-10"
                  />
                </div>

                <div className="space-y-1.5">
                  <label className="text-xs font-bold text-slate-500 uppercase tracking-wider block">Nominal SPJ Per Orang (Rp)</label>
                  <Input
                    type="text"
                    inputMode="numeric"
                    pattern="[0-9]*"
                    placeholder="Contoh: 50000"
                    value={spjEventFee === 0 ? '' : String(spjEventFee)}
                    disabled={isVakasiProjection}
                    onChange={(e) => {
                      const val = parseInt(e.target.value.replace(/\D/g, ''), 10) || 0;
                      setSpjEventFee(val);
                      setSpjWorkerRows(prev => prev.map(r => ({ ...r, payGiven: val })));
                    }}
                    className="rounded-xl border-slate-200 font-bold text-slate-800 text-sm focus:border-indigo-500 text-right h-10"
                  />
                </div>
              </div>

              {/* Workers Rows */}
              <div className="space-y-4 pt-2">
                <h4 className="font-bold text-slate-700 text-xs uppercase tracking-wider">Daftar Penerima SPJ Pekarya</h4>
                <div className="border border-slate-100 rounded-[20px] bg-slate-50/50 p-4 space-y-3">
                  {spjWorkerRows.map((row, idx) => (
                    <div key={idx} className="flex items-center gap-3">
                      <div className="flex-1 relative">
                        <Input
                          id={`spj-search-input-${idx}`}
                          type="text"
                          placeholder="Cari Nama Pegawai Pekarya..."
                          value={row.searchText}
                          disabled={isVakasiProjection}
                          onChange={(e) => {
                            const val = e.target.value;
                            setSpjWorkerRows(prev => {
                              const u = [...prev];
                              u[idx].searchText = val;
                              u[idx].showDropdown = true;
                              return u;
                            });
                          }}
                          onFocus={() => {
                            setSpjWorkerRows(prev => {
                              const u = [...prev];
                              u[idx].showDropdown = true;
                              return u;
                            });
                          }}
                          onBlur={() => {
                            setTimeout(() => {
                              setSpjWorkerRows(prev => {
                                const u = [...prev];
                                u[idx].showDropdown = false;
                                return u;
                              });
                            }, 200);
                          }}
                          className={`rounded-xl border-slate-200 font-semibold text-slate-800 text-xs h-9 bg-white pr-8 ${row.isInvalid ? 'border-red-300 bg-red-50 text-red-800' : ''}`}
                        />
                        {row.showDropdown && (
                          <div className="absolute left-0 right-0 top-10 max-h-40 overflow-y-auto bg-white border border-slate-100 rounded-xl shadow-2xl z-50 divide-y divide-slate-50">
                            {(() => {
                              const search = (row.searchText || '').toLowerCase();
                              const filtered = blueCollarEmployees.filter(emp =>
                                emp.name.toLowerCase().includes(search)
                              );
                              if (filtered.length === 0) return <div className="p-3 text-[10px] text-slate-400">Pegawai tidak ditemukan</div>;
                              return filtered.map(emp => (
                                <button
                                  key={emp.id}
                                  type="button"
                                  onClick={() => {
                                    setSpjWorkerRows(prev => {
                                      const u = [...prev];
                                      u[idx].employeeId = emp.id;
                                      u[idx].employeeName = emp.name;
                                      u[idx].searchText = emp.name;
                                      u[idx].isInvalid = false;
                                      u[idx].showDropdown = false;
                                      return u;
                                    });
                                  }}
                                  className="w-full text-left px-4 py-2 hover:bg-slate-50 text-[11px] font-semibold text-slate-700 flex justify-between"
                                >
                                  <span>{emp.name}</span>
                                  <span className="text-[9px] text-slate-400 font-normal uppercase">{emp.category}</span>
                                </button>
                              ));
                            })()}
                          </div>
                        )}
                      </div>
                      {!isVakasiProjection && <Button
                        type="button"
                        variant="ghost"
                        onClick={() => {
                          const nextRows = spjWorkerRows.filter((_, i) => i !== idx);
                          setSpjWorkerRows(nextRows.length > 0 ? nextRows : [{ employeeId: '', employeeName: '', payGiven: 0, searchText: '', showDropdown: false }]);
                        }}
                        className="text-red-500 hover:text-red-700 hover:bg-red-50 rounded-xl h-9 w-9 p-0 flex items-center justify-center"
                      >
                        <Trash className="w-4 h-4" />
                      </Button>}
                    </div>
                  ))}
                  {!isVakasiProjection && <Button
                    type="button"
                    onClick={handleSpjAddRow}
                    variant="outline"
                    className="w-full rounded-xl border-slate-200 text-slate-500 hover:bg-slate-100 text-xs font-semibold h-9 flex items-center justify-center gap-1.5"
                  >
                    <Plus className="w-4.5 h-4.5 text-indigo-500" /> Tambah Pegawai
                  </Button>}
                </div>
              </div>

              {/* Form actions */}
              <div className="flex justify-end items-center gap-3 pt-4 border-t border-slate-100">
                {selectedSpjEventId && !isVakasiProjection && (
                  <Button
                    onClick={() => handleDeleteSpjEvent(selectedSpjEventId)}
                    variant="ghost"
                    className="rounded-xl text-rose-500 hover:text-rose-700 hover:bg-rose-50 font-bold px-5 text-xs h-10 flex items-center gap-1.5"
                  >
                    <Trash className="w-4 h-4" /> Hapus
                  </Button>
                )}
                <Button
                  onClick={handleSaveSpjEvent}
                  disabled={saving || isVakasiProjection}
                  className="rounded-xl px-6 bg-indigo-600 hover:bg-indigo-700 text-white font-bold shadow-lg shadow-indigo-100 transition-all flex items-center gap-2 h-10 text-xs cursor-pointer"
                >
                  {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <ShieldCheck className="w-4 h-4" />}
                  {isVakasiProjection ? 'Dikelola dari Vakasi' : 'Simpan SPJ'}
                </Button>
              </div>
            </Card>
          </div>

        </div>
      )}
    </div>
  );
}
