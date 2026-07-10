"use client";

import React, { useState, useEffect, useCallback } from 'react';
import { useAuth } from '@/lib/AuthContext';
import { db } from '@/lib/firebase';
import {
  collection,
  getDocs,
  getDoc,
  doc,
  setDoc,
  updateDoc,
  query,
  where,
  orderBy,
  serverTimestamp
} from 'firebase/firestore';
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription
} from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import {
  Loader2,
  Calendar,
  Clock,
  AlertCircle,
  CheckCircle2,
  ChevronLeft,
  FileText,
  XCircle,
  Check,
  X,
  FileSpreadsheet
} from 'lucide-react';
import Link from 'next/link';
import { MONTHS_ID } from '@/utils/rekapConfig';

const parseDateToDDMMYYYY = (dateStr: string) => {
  const [y, m, d] = dateStr.split('-');
  return `${d}-${m}-${y}`;
};

export default function PresenceCorrectionsAdminPage() {
  const { profile } = useAuth();
  const [loading, setLoading] = useState(false);
  const [requests, setRequests] = useState<any[]>([]);
  const [allList, setAllList] = useState<any[]>([]);
  const [selectedStatus, setSelectedStatus] = useState<'pending' | 'approved' | 'rejected' | 'all'>('pending');
  const [selectedPeriod, setSelectedPeriod] = useState(() => {
    const now = new Date();
    const m = String(now.getMonth() + 1).padStart(2, '0');
    return `${now.getFullYear()}-${m}`;
  });
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  // Rejection dialog states
  const [rejectingReqId, setRejectingReqId] = useState<string | null>(null);
  const [rejectionReason, setRejectionReason] = useState('');
  const [actionLoading, setActionLoading] = useState<string | null>(null);

  const fetchRequests = useCallback(async () => {
    setLoading(true);
    try {
      let q = query(
        collection(db, 'LoyalisPresenceCorrections'),
        orderBy('createdAt', 'desc')
      );
      
      const snap = await getDocs(q);
      const list = snap.docs.map(doc => ({ id: doc.id, ...doc.data() }));
      setAllList(list);

      // Apply client-side filters
      const filtered = list.filter((req: any) => {
        // Status filter
        if (selectedStatus !== 'all' && req.status !== selectedStatus) {
          return false;
        }
        // Period filter (matches YYYY-MM)
        if (selectedPeriod) {
          const reqMonth = req.date.substring(0, 7); // e.g. "2026-06"
          if (reqMonth !== selectedPeriod) {
            return false;
          }
        }
        return true;
      });

      setRequests(filtered);
    } catch (err) {
      console.error('Error fetching requests:', err);
      setMessage({ type: 'error', text: 'Gagal memuat daftar pengajuan koreksi.' });
    } finally {
      setLoading(false);
    }
  }, [selectedStatus, selectedPeriod]);

  useEffect(() => {
    fetchRequests();
  }, [fetchRequests]);

  // Compute live statistics for the selected period
  const stats = React.useMemo(() => {
    const periodList = allList.filter((req: any) => {
      if (selectedPeriod) {
        return req.date.substring(0, 7) === selectedPeriod;
      }
      return true;
    });
    return {
      total: periodList.length,
      pending: periodList.filter(r => r.status === 'pending').length,
      approved: periodList.filter(r => r.status === 'approved').length,
      rejected: periodList.filter(r => r.status === 'rejected').length,
    };
  }, [allList, selectedPeriod]);

  // Helper to generate dynamic premium avatar colors
  const getAvatarGradient = (name: string) => {
    const code = name.charCodeAt(0) % 4;
    switch (code) {
      case 0: return 'from-indigo-500 to-purple-600';
      case 1: return 'from-emerald-400 to-teal-600';
      case 2: return 'from-amber-400 to-orange-500';
      default: return 'from-pink-500 to-rose-600';
    }
  };

  // Recalculate helper functions copied directly from presensi-loyalis-raw
  const recalculateSummary = (dailyLogs: any[], expHours: number) => {
    let totalWorkedMinutes = 0;
    let activeDaysCount = 0;
    let incompleteDaysCount = 0;
    let absentDaysCount = 0;

    const updatedLogs = dailyLogs.map(dayRow => {
      const status = String(dayRow['Jam kerja'] || '').trim();
      const statusUpper = status.toUpperCase();
      const inStr = dayRow['Scan masuk'] ? String(dayRow['Scan masuk']).trim() : '';
      const outStr = dayRow['Scan pulang'] ? String(dayRow['Scan pulang']).trim() : '';

      let dailyDuration = 0;
      if (statusUpper === 'MASUK') {
        if (inStr && outStr) {
          const [hIn, mIn] = inStr.split(':').map(Number);
          const [hOut, mOut] = outStr.split(':').map(Number);

          if (!isNaN(hIn) && !isNaN(hOut)) {
            const minutesIn = hIn * 60 + mIn;
            const minutesOut = hOut * 60 + mOut;
            const duration = Math.max(0, minutesOut - minutesIn);
            dailyDuration = Math.min(expHours * 60, duration);
            totalWorkedMinutes += dailyDuration;
            activeDaysCount += 1;
          } else {
            incompleteDaysCount += 1;
          }
        } else {
          incompleteDaysCount += 1;
        }
      } else if (statusUpper === 'TIDAK HADIR') {
        absentDaysCount += 1;
      }

      return {
        ...dayRow,
        duration: dailyDuration
      };
    });

    return {
      minutes: totalWorkedMinutes,
      activeDaysCount,
      incompleteDaysCount,
      absentDaysCount,
      dailyLogs: updatedLogs,
    };
  };

  const calculatePresenceStratum = (minutes: number, mode: 'worked' | 'absent', days: number, hours: number) => {
    const expectedTotal = days * hours * 60;
    let x = 0;
    if (mode === 'worked') {
      x = expectedTotal - minutes;
      if (x < 0) x = 0;
    } else {
      x = minutes;
    }

    let stratum = 5;
    let deduction = 250000;
    let netBonus = 0;

    if (x === 0) {
      stratum = 1;
      deduction = 0;
      netBonus = 250000;
    } else if (x <= days * 30) {
      stratum = 2;
      deduction = 100000;
      netBonus = 150000;
    } else if (x <= days * 35) {
      stratum = 3;
      deduction = 150000;
      netBonus = 100000;
    } else if (x <= days * 40) {
      stratum = 4;
      deduction = 200000;
      netBonus = 50000;
    } else {
      stratum = 5;
      deduction = 250000;
      netBonus = 0;
    }

    return {
      absenceMinutes: x,
      stratum,
      deduction,
      netBonus,
    };
  };

  const handleApprove = async (req: any) => {
    setActionLoading(req.id);
    setMessage(null);
    try {
      const periodToken = req.date.substring(0, 7); // e.g. "2026-06"
      const dateKey = parseDateToDDMMYYYY(req.date); // e.g. "01-06-2026"

      // 1. Retrieve the existing monthly raw presence log document
      const presenceRef = doc(db, 'LoyalisPresence', periodToken);
      const presenceSnap = await getDoc(presenceRef);

      if (!presenceSnap.exists()) {
        throw new Error(`Data presensi untuk periode ${periodToken} belum dikonfigurasi/diunggah. Silakan minta admin mengunggah logs raw Excel terlebih dahulu.`);
      }

      const presenceData = presenceSnap.data();
      const workingDays = presenceData.workingDays || 25;
      const expectedHours = presenceData.expectedHours || 6.5;
      const calcMode = presenceData.mode || 'worked';
      const entries = presenceData.entries || {};

      let employeeEntry = entries[req.employeeId];

      if (!employeeEntry) {
        // If employee entry doesn't exist, build a default mock shell
        employeeEntry = {
          employeeId: req.employeeId,
          employeeName: req.employeeName,
          excelName: req.employeeName,
          minutes: 0,
          absenceMinutes: workingDays * expectedHours * 60,
          stratum: 5,
          deduction: 250000,
          netBonus: 0,
          isNotFoundInExcel: true,
          activeDaysCount: 0,
          incompleteDaysCount: 0,
          absentDaysCount: 0,
          dailyLogs: []
        };
      }

      const dailyLogs = [...(employeeEntry.dailyLogs || [])];
      
      // Find matching date log in dailyLogs
      let dayLogIdx = dailyLogs.findIndex(log => log.Tanggal === dateKey);

      if (dayLogIdx > -1) {
        // Update existing daily logs
        dailyLogs[dayLogIdx] = {
          ...dailyLogs[dayLogIdx],
          'Jam kerja': 'MASUK',
          'Scan masuk': req.type !== 'tap_out' ? req.checkInTime : (dailyLogs[dayLogIdx]['Scan masuk'] || ''),
          'Scan pulang': req.type !== 'tap_in' ? req.checkOutTime : (dailyLogs[dayLogIdx]['Scan pulang'] || ''),
        };
      } else {
        // Add new log row if date does not exist
        dailyLogs.push({
          Tanggal: dateKey,
          'Jam kerja': 'MASUK',
          'Scan masuk': req.type !== 'tap_out' ? req.checkInTime : '',
          'Scan pulang': req.type !== 'tap_in' ? req.checkOutTime : '',
        });
      }

      // Sort logs by date again just in case
      dailyLogs.sort((a, b) => {
        const [d1, m1, y1] = a.Tanggal.split('-').map(Number);
        const [d2, m2, y2] = b.Tanggal.split('-').map(Number);
        return (y1 * 365 + m1 * 31 + d1) - (y2 * 365 + m2 * 31 + d2);
      });

      // Recalculate summary details
      const summary = recalculateSummary(dailyLogs, expectedHours);
      const stratumCalc = calculatePresenceStratum(summary.minutes, calcMode, workingDays, expectedHours);

      const updatedEmployeeEntry = {
        ...employeeEntry,
        ...summary,
        ...stratumCalc,
        isNotFoundInExcel: false
      };

      // Save updated presence map back to database
      const updatedEntries = {
        ...entries,
        [req.employeeId]: updatedEmployeeEntry
      };

      await updateDoc(presenceRef, {
        entries: updatedEntries,
        updatedAt: serverTimestamp()
      });

      // 2. Automatically update corresponding PayrollSlipStates
      const slipRef = doc(db, 'PayrollSlipStates', `${periodToken}_${req.employeeId}`);
      const slipSnap = await getDoc(slipRef);
      if (slipSnap.exists()) {
        const slipData = slipSnap.data();
        const currentDeductions = slipData.deductions || [];
        
        const newPresensiDeduct = Math.round(((updatedEmployeeEntry.absenceMinutes || 0) / 60) * 1650);
        const newPresenceBonusDeduct = updatedEmployeeEntry.deduction || 0;
        
        let updatedDeductions = [...currentDeductions];
        
        const presensiIdx = updatedDeductions.findIndex(d => d.label === 'Potongan Presensi');
        if (presensiIdx > -1) {
          updatedDeductions[presensiIdx] = { ...updatedDeductions[presensiIdx], amount: newPresensiDeduct };
        } else {
          updatedDeductions.push({ label: 'Potongan Presensi', amount: newPresensiDeduct });
        }

        const presenceIdx = updatedDeductions.findIndex(d => d.label === 'Potongan Bonus Presensi');
        if (presenceIdx > -1) {
          updatedDeductions[presenceIdx] = { ...updatedDeductions[presenceIdx], amount: newPresenceBonusDeduct };
        } else {
          updatedDeductions.push({ label: 'Potongan Bonus Presensi', amount: newPresenceBonusDeduct });
        }
        
        await updateDoc(slipRef, {
          deductions: updatedDeductions
        });
      }

      // 3. Mark request as approved
      const requestRef = doc(db, 'LoyalisPresenceCorrections', req.id);
      await updateDoc(requestRef, {
        status: 'approved',
        resolvedBy: profile?.email || 'Admin',
        updatedAt: serverTimestamp()
      });

      setMessage({ type: 'success', text: `Koreksi presensi ${req.employeeName} untuk tanggal ${dateKey} berhasil disetujui dan diterapkan.` });
      fetchRequests();
    } catch (err: any) {
      console.error(err);
      setMessage({ type: 'error', text: err.message || 'Gagal menyetujui koreksi presensi.' });
    } finally {
      setActionLoading(null);
    }
  };

  const handleReject = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!rejectingReqId) return;
    if (!rejectionReason.trim()) {
      setMessage({ type: 'error', text: 'Masukkan alasan penolakan koreksi presensi.' });
      return;
    }

    setActionLoading(rejectingReqId);
    try {
      const requestRef = doc(db, 'LoyalisPresenceCorrections', rejectingReqId);
      await updateDoc(requestRef, {
        status: 'rejected',
        rejectionReason: rejectionReason.trim(),
        resolvedBy: profile?.email || 'Admin',
        updatedAt: serverTimestamp()
      });

      setMessage({ type: 'success', text: 'Pengajuan koreksi presensi berhasil ditolak.' });
      setRejectingReqId(null);
      setRejectionReason('');
      fetchRequests();
    } catch (err: any) {
      console.error(err);
      setMessage({ type: 'error', text: err.message || 'Gagal menolak koreksi presensi.' });
    } finally {
      setActionLoading(null);
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 via-slate-100 to-indigo-50/50 py-8 px-8 font-sans selection:bg-indigo-100">
      <div className="max-w-[1600px] mx-auto space-y-8">
        
        {/* Modern Header Section */}
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 bg-white/70 backdrop-blur-md rounded-3xl p-6 border border-slate-200/50 shadow-sm">
          <div className="space-y-1.5">
            <Link href="/dashboard/payroll/uraian/presensi-loyalis-raw">
              <Button variant="ghost" className="group -ml-2 text-slate-500 hover:text-indigo-700 hover:bg-indigo-50/80 rounded-xl transition-all font-bold text-xs flex items-center gap-2 cursor-pointer">
                <ChevronLeft className="w-4 h-4 group-hover:-translate-x-0.5 transition-transform" />
                Kembali ke Presensi Raw
              </Button>
            </Link>
            <h1 className="text-2xl font-black text-slate-900 uppercase tracking-tight flex items-center gap-2.5 mt-1">
              <span className="w-2.5 h-6 bg-indigo-600 rounded-full inline-block" />
              Koreksi Presensi Loyalis
            </h1>
            <p className="text-xs text-slate-450 font-semibold tracking-wide ml-4">
              Persetujuan &amp; Manajemen Koreksi Absen Pegawai YAPETIDU
            </p>
          </div>
          
          <div className="flex items-center gap-3">
            <div className="text-right hidden lg:block mr-2">
              <div className="text-[10px] font-bold text-slate-400 uppercase">Status Akses</div>
              <div className="text-xs font-extrabold text-slate-700">{profile?.email || 'Administrator'}</div>
            </div>
            <div className="h-10 w-10 rounded-2xl bg-indigo-600 flex items-center justify-center text-white font-black text-sm shadow-md shadow-indigo-200">
              {profile?.email ? profile.email.charAt(0).toUpperCase() : 'A'}
            </div>
          </div>
        </div>

        {message && (
          <div className={`flex items-start gap-3 px-5 py-4 rounded-2xl text-sm font-semibold border shadow-sm animate-in fade-in slide-in-from-top-2 duration-300 ${
            message.type === 'success' 
              ? 'bg-emerald-50 text-emerald-800 border-emerald-200' 
              : 'bg-rose-50 text-rose-800 border-rose-200'
          }`}>
            {message.type === 'success' ? (
              <CheckCircle2 className="w-5 h-5 shrink-0 text-emerald-600 mt-0.5" />
            ) : (
              <AlertCircle className="w-5 h-5 shrink-0 text-rose-600 mt-0.5" />
            )}
            <span>{message.text}</span>
          </div>
        )}

        {/* Dashboard Grid (Desktop Optimized) */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">
          
          {/* LEFT PANEL: Filters, Quick Actions, and Statistics */}
          <div className="lg:col-span-4 space-y-6">
            
            {/* Filter Card */}
            <Card className="bg-white rounded-3xl border-none shadow-[0_4px_30px_rgba(0,0,0,0.03)] p-6 space-y-6 border border-slate-100">
              <div>
                <h2 className="font-extrabold text-slate-800 text-sm uppercase tracking-wider">Filter Pengajuan</h2>
                <p className="text-[10px] text-slate-400 font-semibold mt-0.5">Saring data berdasarkan status &amp; periode bulan</p>
              </div>

              <div className="space-y-4">
                <div className="space-y-2">
                  <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wider block">Status Koreksi</label>
                  <Select value={selectedStatus} onValueChange={(val: any) => setSelectedStatus(val)}>
                    <SelectTrigger className="rounded-xl border-slate-200 bg-white h-11 text-xs font-semibold text-slate-700 hover:border-indigo-300 focus:ring-2 focus:ring-indigo-500/20 transition-all">
                      <SelectValue placeholder="Pilih status..." />
                    </SelectTrigger>
                    <SelectContent className="bg-white rounded-xl border border-slate-100 shadow-xl font-sans">
                      <SelectItem value="pending">Tertunda (Pending)</SelectItem>
                      <SelectItem value="approved">Disetujui (Approved)</SelectItem>
                      <SelectItem value="rejected">Ditolak (Rejected)</SelectItem>
                      <SelectItem value="all">Semua Status</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-2">
                  <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wider block">Periode Bulan</label>
                  <div className="relative">
                    <Input
                      type="month"
                      value={selectedPeriod}
                      onChange={(e) => setSelectedPeriod(e.target.value)}
                      className="rounded-xl border-slate-200 bg-white h-11 text-xs font-semibold text-slate-700 hover:border-indigo-300 focus:ring-2 focus:ring-indigo-500/20 transition-all font-mono text-center"
                    />
                  </div>
                </div>
              </div>
            </Card>

            {/* Interactive Statistics / Status Counters */}
            <Card className="bg-white rounded-3xl border-none shadow-[0_4px_30px_rgba(0,0,0,0.03)] p-6 space-y-4 border border-slate-100">
              <div>
                <h3 className="font-extrabold text-slate-800 text-sm uppercase tracking-wider">Statistik Bulan Ini</h3>
                <p className="text-[10px] text-slate-400 font-semibold mt-0.5">Klik kotak di bawah untuk memfilter cepat</p>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <button
                  onClick={() => setSelectedStatus('pending')}
                  className={`p-4 rounded-2xl text-left transition-all border cursor-pointer ${
                    selectedStatus === 'pending'
                      ? 'bg-amber-50/70 border-amber-300 ring-2 ring-amber-300/20'
                      : 'bg-slate-50/50 border-slate-100 hover:bg-slate-50'
                  }`}
                >
                  <div className="text-[10px] font-bold text-amber-600 uppercase tracking-wider">Pending</div>
                  <div className="text-2xl font-black text-amber-700 mt-1 font-mono">{stats.pending}</div>
                </button>

                <button
                  onClick={() => setSelectedStatus('approved')}
                  className={`p-4 rounded-2xl text-left transition-all border cursor-pointer ${
                    selectedStatus === 'approved'
                      ? 'bg-emerald-50/70 border-emerald-300 ring-2 ring-emerald-300/20'
                      : 'bg-slate-50/50 border-slate-100 hover:bg-slate-50'
                  }`}
                >
                  <div className="text-[10px] font-bold text-emerald-600 uppercase tracking-wider">Approved</div>
                  <div className="text-2xl font-black text-emerald-700 mt-1 font-mono">{stats.approved}</div>
                </button>

                <button
                  onClick={() => setSelectedStatus('rejected')}
                  className={`p-4 rounded-2xl text-left transition-all border cursor-pointer ${
                    selectedStatus === 'rejected'
                      ? 'bg-rose-50/70 border-rose-300 ring-2 ring-rose-300/20'
                      : 'bg-slate-50/50 border-slate-100 hover:bg-slate-50'
                  }`}
                >
                  <div className="text-[10px] font-bold text-rose-600 uppercase tracking-wider">Rejected</div>
                  <div className="text-2xl font-black text-rose-700 mt-1 font-mono">{stats.rejected}</div>
                </button>

                <button
                  onClick={() => setSelectedStatus('all')}
                  className={`p-4 rounded-2xl text-left transition-all border cursor-pointer ${
                    selectedStatus === 'all'
                      ? 'bg-indigo-50/70 border-indigo-300 ring-2 ring-indigo-300/20'
                      : 'bg-slate-50/50 border-slate-100 hover:bg-slate-50'
                  }`}
                >
                  <div className="text-[10px] font-bold text-indigo-600 uppercase tracking-wider">Total</div>
                  <div className="text-2xl font-black text-indigo-700 mt-1 font-mono">{stats.total}</div>
                </button>
              </div>
            </Card>
          </div>

          {/* RIGHT PANEL: Correction Submissions List */}
          <div className="lg:col-span-8 space-y-6">
            
            {loading ? (
              <Card className="bg-white rounded-[32px] border-none p-16 flex flex-col items-center justify-center text-slate-400 shadow-[0_4px_30px_rgba(0,0,0,0.03)] min-h-[400px]">
                <Loader2 className="w-10 h-10 animate-spin text-indigo-500 mb-3" />
                <p className="text-xs font-bold tracking-wider uppercase animate-pulse">Memuat daftar pengajuan...</p>
              </Card>
            ) : requests.length === 0 ? (
              <Card className="bg-white rounded-[32px] border-none p-16 text-center text-slate-400 shadow-[0_4px_30px_rgba(0,0,0,0.03)] border border-slate-100/50 min-h-[400px] flex flex-col items-center justify-center">
                <div className="w-16 h-16 rounded-3xl bg-slate-50 flex items-center justify-center mb-4 border border-slate-100">
                  <Clock className="w-7 h-7 text-slate-300" />
                </div>
                <h3 className="text-sm font-extrabold text-slate-700 uppercase tracking-wider">Tidak Ada Pengajuan</h3>
                <p className="text-xs text-slate-400 mt-1 max-w-xs mx-auto leading-relaxed">
                  Tidak ditemukan pengajuan koreksi presensi yang cocok dengan filter aktif Anda.
                </p>
              </Card>
            ) : (
              <div className="space-y-4">
                {requests.map((req) => {
                  const isPdf = req.proofUrl && req.proofUrl.toLowerCase().split('?')[0].endsWith('.pdf');
                  
                  return (
                    <Card 
                      key={req.id} 
                      className={`bg-white rounded-3xl border-none shadow-[0_4px_25px_rgba(0,0,0,0.02)] overflow-hidden transition-all duration-300 hover:shadow-[0_10px_35px_rgba(99,102,241,0.06)] border border-slate-100 hover:border-indigo-100 ${
                        rejectingReqId === req.id ? 'ring-2 ring-rose-200' : ''
                      }`}
                    >
                      {/* Top Bar / Header of Request */}
                      <div className="p-6 flex items-center justify-between border-b border-slate-50 bg-slate-50/20">
                        <div className="flex items-center gap-4">
                          {/* Premium Avatar */}
                          <div className={`w-11 h-11 rounded-2xl bg-gradient-to-tr ${getAvatarGradient(req.employeeName)} flex items-center justify-center text-white font-extrabold text-sm shadow-sm`}>
                            {req.employeeName ? req.employeeName.split(' ').map((n: string) => n[0]).slice(0, 2).join('').toUpperCase() : 'KY'}
                          </div>

                          <div className="space-y-0.5">
                            <div className="flex items-center gap-2">
                              <span className="text-sm font-extrabold text-slate-800 uppercase tracking-tight">{req.employeeName}</span>
                              <span className={`inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[9px] font-bold uppercase tracking-wider border ${
                                req.status === 'approved' 
                                  ? 'bg-emerald-50 text-emerald-700 border-emerald-100' 
                                  : req.status === 'rejected' 
                                  ? 'bg-rose-50 text-rose-700 border-rose-100' 
                                  : 'bg-amber-50 text-amber-750 border-amber-100'
                              }`}>
                                {req.status === 'approved' && <Check className="w-2.5 h-2.5" />}
                                {req.status === 'rejected' && <X className="w-2.5 h-2.5" />}
                                {req.status === 'pending' && <Clock className="w-2.5 h-2.5 animate-pulse" />}
                                {req.status}
                              </span>
                            </div>
                            <div className="text-[10px] text-slate-400 font-semibold">
                              Diajukan pada: <span className="font-mono text-slate-500">{req.createdAt ? new Date(req.createdAt.seconds * 1000).toLocaleString('id-ID') : '-'}</span>
                            </div>
                          </div>
                        </div>

                        <div className="flex items-center gap-2 bg-white px-3 py-1.5 rounded-2xl border border-slate-100 shadow-2xs">
                          <Calendar className="w-4 h-4 text-indigo-500" />
                          <span className="text-xs font-black text-slate-700 font-mono">
                            {new Date(req.date).toLocaleDateString('id-ID', { year: 'numeric', month: 'short', day: 'numeric' })}
                          </span>
                        </div>
                      </div>

                      {/* Content Panel */}
                      <CardContent className="p-6 space-y-5">
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 items-start">
                          
                          {/* Left Half: Submission Data Details */}
                          <div className="space-y-4">
                            <div className="space-y-1.5">
                              <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block">Permintaan Koreksi:</span>
                              {req.type === 'both' ? (
                                <div className="inline-flex items-center gap-2.5">
                                  <span className="bg-slate-100 text-slate-700 px-2 py-0.5 rounded-lg text-[10px] font-extrabold uppercase tracking-wide">Masuk &amp; Pulang</span>
                                  <span className="font-mono text-xs font-bold text-indigo-700 bg-indigo-50/50 px-2.5 py-0.5 rounded-lg border border-indigo-100/50">{req.checkInTime} — {req.checkOutTime}</span>
                                </div>
                              ) : req.type === 'tap_in' ? (
                                <div className="inline-flex items-center gap-2.5">
                                  <span className="bg-indigo-50 text-indigo-700 px-2 py-0.5 rounded-lg text-[10px] font-extrabold uppercase tracking-wide border border-indigo-100/30">Masuk Saja</span>
                                  <span className="font-mono text-xs font-bold text-indigo-700 bg-indigo-50/50 px-2.5 py-0.5 rounded-lg border border-indigo-100/50">{req.checkInTime}</span>
                                </div>
                              ) : (
                                <div className="inline-flex items-center gap-2.5">
                                  <span className="bg-amber-50 text-amber-700 px-2 py-0.5 rounded-lg text-[10px] font-extrabold uppercase tracking-wide border border-amber-100/30">Pulang Saja</span>
                                  <span className="font-mono text-xs font-bold text-amber-700 bg-amber-50/50 px-2.5 py-0.5 rounded-lg border border-amber-100/50">{req.checkOutTime}</span>
                                </div>
                              )}
                            </div>

                            {req.proofUrl && (
                              <div className="space-y-2">
                                <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block">Lampiran Bukti:</span>
                                {isPdf ? (
                                  <a
                                    href={req.proofUrl}
                                    target="_blank"
                                    rel="noreferrer"
                                    className="inline-flex items-center gap-2 text-xs text-indigo-600 font-extrabold hover:text-indigo-800 transition-colors bg-indigo-50/50 hover:bg-indigo-50 px-4 py-2 rounded-xl border border-indigo-100/60 shadow-2xs cursor-pointer"
                                  >
                                    <FileText className="w-4 h-4 text-indigo-500" />
                                    Buka Dokumen PDF
                                  </a>
                                ) : (
                                  <div className="relative group max-w-xs overflow-hidden rounded-xl border border-slate-200 bg-slate-50 hover:border-indigo-300 transition-all shadow-2xs">
                                    <img
                                      src={req.proofUrl}
                                      alt="Bukti Lampiran"
                                      className="max-h-32 w-auto object-cover hover:scale-102 transition-transform duration-300"
                                    />
                                    <a
                                      href={req.proofUrl}
                                      target="_blank"
                                      rel="noreferrer"
                                      className="absolute inset-0 bg-slate-950/45 opacity-0 group-hover:opacity-100 flex items-center justify-center text-white text-[10px] font-extrabold tracking-wider uppercase transition-opacity duration-200 gap-1.5 cursor-pointer"
                                    >
                                      <FileText className="w-4 h-4" />
                                      Lihat Penuh
                                    </a>
                                  </div>
                                )}
                              </div>
                            )}
                          </div>

                          {/* Right Half: Reason Box */}
                          <div className="space-y-1.5 bg-slate-50/50 p-4 rounded-2xl border border-slate-100/70 h-full">
                            <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block">Alasan Pengajuan:</span>
                            <p className="text-xs text-slate-650 font-semibold leading-relaxed mt-1 break-words">
                              "{req.reason}"
                            </p>
                          </div>
                        </div>

                        {req.status === 'rejected' && req.rejectionReason && (
                          <div className="bg-rose-50/60 border border-rose-100/80 rounded-2xl p-4 text-xs text-rose-800 font-semibold leading-relaxed flex items-start gap-2 animate-in fade-in duration-200">
                            <AlertCircle className="w-4 h-4 text-rose-500 shrink-0 mt-0.5" />
                            <div>
                              <strong className="uppercase text-[9px] tracking-wide text-rose-900 block mb-0.5">Catatan Penolakan Admin:</strong> 
                              <span>{req.rejectionReason}</span>
                            </div>
                          </div>
                        )}

                        {req.status === 'pending' && (
                          <div className="flex justify-end gap-3 pt-4 border-t border-slate-50">
                            {rejectingReqId === req.id ? (
                              <form onSubmit={handleReject} className="flex gap-2 w-full max-w-lg items-center animate-in slide-in-from-right-2 duration-200">
                                <Input
                                  type="text"
                                  value={rejectionReason}
                                  onChange={(e) => setRejectionReason(e.target.value)}
                                  placeholder="Masukkan alasan penolakan..."
                                  required
                                  className="rounded-xl border-slate-200 text-xs h-10 bg-white w-full focus:border-rose-400 focus:ring-rose-500/10"
                                />
                                <Button
                                  type="submit"
                                  disabled={actionLoading === req.id}
                                  className="bg-rose-600 hover:bg-rose-700 text-white font-extrabold rounded-xl text-xs h-10 px-4 shrink-0 flex items-center gap-1.5 cursor-pointer shadow-sm shadow-rose-100 transition-all hover:scale-[1.02] active:scale-95"
                                >
                                  {actionLoading === req.id ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <X className="w-3.5 h-3.5" />}
                                  Kirim
                                </Button>
                                <Button
                                  type="button"
                                  onClick={() => {
                                    setRejectingReqId(null);
                                    setRejectionReason('');
                                  }}
                                  variant="ghost"
                                  className="rounded-xl text-slate-450 hover:bg-slate-100 hover:text-slate-700 text-xs h-10 px-3.5 shrink-0 cursor-pointer transition-colors"
                                >
                                  Batal
                                </Button>
                              </form>
                            ) : (
                              <>
                                <Button
                                  onClick={() => setRejectingReqId(req.id)}
                                  disabled={actionLoading !== null}
                                  variant="outline"
                                  className="text-rose-600 border-rose-200 hover:bg-rose-50/80 rounded-xl text-xs h-10 px-4.5 font-bold flex items-center gap-1.5 cursor-pointer shadow-2xs transition-all hover:scale-[1.01] active:scale-95 hover:border-rose-300"
                                >
                                  <X className="w-3.5 h-3.5 text-rose-500" />
                                  Tolak
                                </Button>
                                <Button
                                  onClick={() => handleApprove(req)}
                                  disabled={actionLoading !== null}
                                  className="bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl text-xs h-10 px-5.5 font-extrabold flex items-center gap-1.5 cursor-pointer shadow-md shadow-indigo-100 transition-all hover:scale-[1.01] active:scale-95 hover:shadow-indigo-200"
                                >
                                  {actionLoading === req.id ? (
                                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                                  ) : (
                                    <Check className="w-3.5 h-3.5" />
                                  )}
                                  Setujui &amp; Terapkan
                                </Button>
                              </>
                            )}
                          </div>
                        )}
                      </CardContent>
                    </Card>
                  );
                })}
              </div>
            )}
          </div>

        </div>
      </div>
    </div>
  );
}
