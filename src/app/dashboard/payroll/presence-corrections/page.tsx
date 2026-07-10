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
    <div className="min-h-screen bg-slate-50/50 py-8 px-4 sm:px-6">
      <div className="max-w-6xl mx-auto space-y-6">
        
        {/* Back header */}
        <div className="flex items-center justify-between">
          <Link href="/dashboard/payroll/uraian/presensi-loyalis-raw">
            <Button variant="ghost" className="rounded-xl flex items-center gap-1.5 text-slate-500 hover:text-slate-800 font-semibold cursor-pointer">
              <ChevronLeft className="w-4 h-4" />
              Kembali ke Presensi Raw
            </Button>
          </Link>
          <div className="text-right">
            <h1 className="text-lg font-extrabold text-slate-950 uppercase tracking-tight">Koreksi Presensi Loyalis</h1>
            <p className="text-xs text-slate-450 font-medium">Persetujuan & Manajemen Koreksi Absen Pegawai</p>
          </div>
        </div>

        {message && (
          <div className={`flex items-start gap-2.5 px-4 py-3 rounded-2xl text-sm font-medium border ${
            message.type === 'success' 
              ? 'bg-emerald-50 text-emerald-700 border-emerald-200' 
              : 'bg-rose-50 text-rose-700 border-rose-200'
          }`}>
            {message.type === 'success' ? <CheckCircle2 className="w-4.5 h-4.5 shrink-0 mt-0.5" /> : <AlertCircle className="w-4.5 h-4.5 shrink-0 mt-0.5" />}
            <span>{message.text}</span>
          </div>
        )}

        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
          
          {/* Filters Card */}
          <div className="lg:col-span-3">
            <Card className="bg-white rounded-3xl border-none shadow-[0_4px_25px_rgba(0,0,0,0.02)] p-5 space-y-4">
              <div className="font-bold text-slate-800 text-xs uppercase tracking-wider">Filter Pengajuan</div>
              
              <div className="space-y-1.5">
                <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block">Status</label>
                <Select value={selectedStatus} onValueChange={(val: any) => setSelectedStatus(val)}>
                  <SelectTrigger className="rounded-xl border-slate-200 bg-white h-10 text-xs font-semibold text-slate-700">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent className="bg-white rounded-xl border border-slate-100 shadow-xl">
                    <SelectItem value="pending">Tertunda (Pending)</SelectItem>
                    <SelectItem value="approved">Disetujui (Approved)</SelectItem>
                    <SelectItem value="rejected">Ditolak (Rejected)</SelectItem>
                    <SelectItem value="all">Semua Status</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-1.5">
                <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block">Periode Bulan</label>
                <Input
                  type="month"
                  value={selectedPeriod}
                  onChange={(e) => setSelectedPeriod(e.target.value)}
                  className="rounded-xl border-slate-200 bg-white h-10 text-xs font-semibold text-slate-700"
                />
              </div>
            </Card>
          </div>

          {/* List Card */}
          <div className="lg:col-span-9 space-y-4">
            {loading ? (
              <Card className="bg-white rounded-3xl border-none p-12 flex flex-col items-center justify-center text-slate-450 shadow-[0_4px_25px_rgba(0,0,0,0.02)]">
                <Loader2 className="w-8 h-8 animate-spin text-indigo-500 mb-2" />
                <p className="text-xs font-semibold animate-pulse">Memuat daftar pengajuan...</p>
              </Card>
            ) : requests.length === 0 ? (
              <Card className="bg-white rounded-3xl border-none p-16 text-center text-slate-400 shadow-[0_4px_25px_rgba(0,0,0,0.02)]">
                <Clock className="w-10 h-10 mx-auto mb-2 text-slate-250 animate-pulse" />
                <p className="text-xs font-bold">Tidak ditemukan pengajuan koreksi presensi yang cocok.</p>
              </Card>
            ) : (
              requests.map((req) => (
                <Card key={req.id} className="bg-white rounded-3xl border-none shadow-[0_4px_25px_rgba(0,0,0,0.02)] overflow-hidden">
                  <div className="p-5 flex flex-col md:flex-row justify-between items-start md:items-center gap-4 border-b border-slate-50">
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-extrabold text-slate-800 uppercase tracking-tight">{req.employeeName}</span>
                        <span className={`inline-flex px-2 py-0.5 rounded-full text-[9px] font-bold uppercase ${
                          req.status === 'approved' 
                            ? 'bg-emerald-50 text-emerald-700 border border-emerald-100' 
                            : req.status === 'rejected' 
                            ? 'bg-rose-50 text-rose-700 border border-rose-100' 
                            : 'bg-amber-50 text-amber-700 border border-amber-100'
                        }`}>
                          {req.status}
                        </span>
                      </div>
                      <p className="text-[10px] text-slate-400 font-semibold mt-0.5">
                        Diajukan pada: {req.createdAt ? new Date(req.createdAt.seconds * 1000).toLocaleString('id-ID') : '-'}
                      </p>
                    </div>

                    <div className="flex items-center gap-2">
                      <Calendar className="w-4 h-4 text-slate-400" />
                      <span className="text-xs font-bold text-slate-700 font-mono">
                        {new Date(req.date).toLocaleDateString('id-ID', { year: 'numeric', month: 'long', day: 'numeric' })}
                      </span>
                    </div>
                  </div>

                  <CardContent className="p-5 space-y-4">
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      
                      {/* Left: times and files */}
                      <div className="space-y-3">
                        <div className="space-y-1">
                          <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block">Permintaan Koreksi:</span>
                          {req.type === 'both' ? (
                            <div className="text-xs font-bold text-slate-750 flex items-center gap-1.5">
                              <span className="bg-slate-100 px-1.5 py-0.5 rounded text-[10px] font-bold">Masuk & Pulang</span>
                              <span className="font-mono text-slate-600">{req.checkInTime} - {req.checkOutTime}</span>
                            </div>
                          ) : req.type === 'tap_in' ? (
                            <div className="text-xs font-bold text-slate-750 flex items-center gap-1.5">
                              <span className="bg-indigo-50 text-indigo-700 px-1.5 py-0.5 rounded text-[10px] font-bold">Masuk Saja</span>
                              <span className="font-mono text-slate-600">{req.checkInTime}</span>
                            </div>
                          ) : (
                            <div className="text-xs font-bold text-slate-750 flex items-center gap-1.5">
                              <span className="bg-amber-50 text-amber-700 px-1.5 py-0.5 rounded text-[10px] font-bold">Pulang Saja</span>
                              <span className="font-mono text-slate-600">{req.checkOutTime}</span>
                            </div>
                          )}
                        </div>

                        {req.proofUrl && (
                          <div className="space-y-1">
                            <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block font-medium">Lampiran Bukti:</span>
                            <a
                              href={req.proofUrl}
                              target="_blank"
                              rel="noreferrer"
                              className="inline-flex items-center gap-1.5 text-xs text-indigo-500 font-bold hover:underline cursor-pointer"
                            >
                              <FileText className="w-4 h-4" />
                              Buka Dokumen Pendukung
                            </a>
                          </div>
                        )}
                      </div>

                      {/* Right: reason */}
                      <div className="space-y-1 bg-slate-50/50 p-3 rounded-2xl border border-slate-100">
                        <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block">Alasan Pengajuan:</span>
                        <p className="text-xs text-slate-650 font-medium leading-relaxed mt-0.5">{req.reason}</p>
                      </div>
                    </div>

                    {req.status === 'rejected' && req.rejectionReason && (
                      <div className="bg-rose-50/55 border border-rose-100/50 rounded-2xl p-3.5 text-xs text-rose-800 font-medium leading-normal">
                        <strong>Catatan Penolakan Admin:</strong> {req.rejectionReason}
                      </div>
                    )}

                    {req.status === 'pending' && (
                      <div className="flex justify-end gap-3 pt-3 border-t border-slate-50">
                        {rejectingReqId === req.id ? (
                          <form onSubmit={handleReject} className="flex gap-2 w-full max-w-lg items-center">
                            <Input
                              type="text"
                              value={rejectionReason}
                              onChange={(e) => setRejectionReason(e.target.value)}
                              placeholder="Masukkan alasan penolakan..."
                              required
                              className="rounded-xl border-slate-200 text-xs h-9 bg-white w-full"
                            />
                            <Button
                              type="submit"
                              disabled={actionLoading === req.id}
                              className="bg-rose-600 hover:bg-rose-700 text-white font-bold rounded-xl text-xs h-9 px-3 shrink-0 flex items-center gap-1 cursor-pointer"
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
                              className="rounded-xl text-slate-450 hover:bg-slate-50 text-xs h-9 px-3 shrink-0 cursor-pointer"
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
                              className="text-rose-600 border-rose-200 hover:bg-rose-50 rounded-xl text-xs h-9 px-4 font-bold flex items-center gap-1.5 cursor-pointer shadow-sm"
                            >
                              <X className="w-3.5 h-3.5" />
                              Tolak
                            </Button>
                            <Button
                              onClick={() => handleApprove(req)}
                              disabled={actionLoading !== null}
                              className="bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl text-xs h-9 px-5 font-bold flex items-center gap-1.5 cursor-pointer shadow-md active:scale-95 transition-all"
                            >
                              {actionLoading === req.id ? (
                                <Loader2 className="w-3.5 h-3.5 animate-spin" />
                              ) : (
                                <Check className="w-3.5 h-3.5" />
                              )}
                              Setujui & Terapkan
                            </Button>
                          </>
                        )}
                      </div>
                    )}
                  </CardContent>
                </Card>
              ))
            )}
          </div>

        </div>
      </div>
    </div>
  );
}
