"use client";

import React, { useState, useEffect, useCallback } from 'react';
import { useAuth } from '@/lib/AuthContext';
import { db, storage } from '@/lib/firebase';
import {
  collection,
  addDoc,
  getDocs,
  query,
  where,
  orderBy,
  serverTimestamp
} from 'firebase/firestore';
import { ref, uploadBytesResumable, getDownloadURL } from 'firebase/storage';
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
  Upload,
  AlertCircle,
  CheckCircle2,
  ChevronLeft,
  FileText,
  FileSpreadsheet,
  XCircle,
  HelpCircle,
  MessageCircle
} from 'lucide-react';
import Link from 'next/link';

export default function PresensiCorrectionPage() {
  const { profile } = useAuth();
  const [loading, setLoading] = useState(false);
  const [submitLoading, setSubmitLoading] = useState(false);
  const [requests, setRequests] = useState<any[]>([]);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  // Form states
  const [date, setDate] = useState(() => {
    const today = new Date();
    const y = today.getFullYear();
    const m = String(today.getMonth() + 1).padStart(2, '0');
    const d = String(today.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  });
  const [type, setType] = useState<'tap_in' | 'tap_out' | 'both'>('both');
  const [checkInTime, setCheckInTime] = useState('08:00');
  const [checkOutTime, setCheckOutTime] = useState('16:00');
  const [reason, setReason] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [uploadProgress, setUploadProgress] = useState<number | null>(null);

  // Fetch employee's submitted requests for the current month
  const fetchRequests = useCallback(async () => {
    if (!profile?.uid) return;
    setLoading(true);
    try {
      const q = query(
        collection(db, 'LoyalisPresenceCorrections'),
        where('employeeId', '==', profile.linkedEmployeeId || profile.uid),
        orderBy('createdAt', 'desc')
      );
      const snap = await getDocs(q);
      const list = snap.docs.map(doc => ({ id: doc.id, ...doc.data() }));
      setRequests(list);
    } catch (err) {
      console.error('Error fetching requests:', err);
    } finally {
      setLoading(false);
    }
  }, [profile]);

  useEffect(() => {
    fetchRequests();
  }, [fetchRequests]);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      const selectedFile = e.target.files[0];
      if (selectedFile.size > 5 * 1024 * 1024) {
        setMessage({ type: 'error', text: 'Ukuran file tidak boleh melebihi 5MB.' });
        return;
      }
      setFile(selectedFile);
      setMessage(null);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!date) {
      setMessage({ type: 'error', text: 'Pilih tanggal terlebih dahulu.' });
      return;
    }
    if (!reason.trim()) {
      setMessage({ type: 'error', text: 'Masukkan alasan koreksi presensi Anda.' });
      return;
    }

    setSubmitLoading(true);
    setUploadProgress(null);
    setMessage(null);

    try {
      let proofUrl = '';
      const empId = profile?.linkedEmployeeId || profile?.uid || 'unknown';

      // 1. Optional File Upload to Firebase Storage
      if (file) {
        const storageRef = ref(storage, `presence_corrections/${empId}/${Date.now()}_${file.name}`);
        const uploadTask = uploadBytesResumable(storageRef, file);

        await new Promise<void>((resolve, reject) => {
          uploadTask.on(
            'state_changed',
            (snapshot) => {
              const progress = Math.round((snapshot.bytesTransferred / snapshot.totalBytes) * 100);
              setUploadProgress(progress);
            },
            (error) => {
              console.error('File upload failed:', error);
              reject(error);
            },
            async () => {
              proofUrl = await getDownloadURL(uploadTask.snapshot.ref);
              resolve();
            }
          );
        });
      }

      // 2. Save document to Firestore
      const newRequest = {
        employeeId: empId,
        employeeName: profile?.displayName || 'Karyawan',
        date,
        type,
        checkInTime: type === 'tap_out' ? null : checkInTime,
        checkOutTime: type === 'tap_in' ? null : checkOutTime,
        reason: reason.trim(),
        proofUrl,
        status: 'pending',
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      };

      await addDoc(collection(db, 'LoyalisPresenceCorrections'), newRequest);
      
      setMessage({ type: 'success', text: 'Koreksi presensi berhasil diajukan!' });
      
      // Reset form
      const today = new Date();
      const y = today.getFullYear();
      const m = String(today.getMonth() + 1).padStart(2, '0');
      const d = String(today.getDate()).padStart(2, '0');
      setDate(`${y}-${m}-${d}`);
      setReason('');
      setFile(null);
      setUploadProgress(null);
      
      fetchRequests();
    } catch (err: any) {
      console.error(err);
      setMessage({ type: 'error', text: err.message || 'Gagal mengajukan koreksi presensi. Silakan coba lagi.' });
    } finally {
      setSubmitLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-50/50 py-8 px-4 sm:px-6">
      <div className="max-w-6xl mx-auto space-y-6">
        
        {/* Back header */}
        <div className="flex items-center justify-between">
          <Link href="/employee/payslip">
            <Button variant="ghost" className="rounded-xl flex items-center gap-1.5 text-slate-500 hover:text-slate-800 font-semibold cursor-pointer">
              <ChevronLeft className="w-4 h-4" />
              Kembali ke Slip Gaji
            </Button>
          </Link>
          <div className="text-right">
            <h1 className="text-lg font-extrabold text-slate-950 uppercase tracking-tight">Koreksi Presensi</h1>
            <p className="text-xs text-slate-400 font-medium">Pegawai Loyalis YAPETIDU</p>
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
          
          {/* Form Card */}
          <div className="lg:col-span-5">
            <Card className="bg-white rounded-3xl border-none shadow-[0_4px_25px_rgba(0,0,0,0.02)] p-6 space-y-6">
              <div>
                <CardTitle className="text-base font-extrabold text-slate-850 tracking-wide uppercase flex items-center gap-2">
                  <Calendar className="w-5 h-5 text-indigo-500" />
                  Ajukan Koreksi
                </CardTitle>
                <CardDescription className="text-xs text-slate-450 mt-1">
                  Koreksi hanya diizinkan untuk periode bulan berjalan.
                </CardDescription>
              </div>

              <form onSubmit={handleSubmit} className="space-y-4">
                <div className="space-y-1.5">
                  <label className="text-[11px] font-bold text-slate-500 uppercase tracking-wider block">Tanggal Presensi</label>
                  <Input
                    type="date"
                    value={date}
                    onChange={(e) => setDate(e.target.value)}
                    className="rounded-xl border-slate-200 bg-white shadow-none h-11 text-sm font-semibold focus:ring-2 focus:ring-indigo-500/20"
                  />
                </div>

                <div className="space-y-1.5">
                  <label className="text-[11px] font-bold text-slate-500 uppercase tracking-wider block">Tipe Koreksi</label>
                  <Select value={type} onValueChange={(val: any) => setType(val)}>
                    <SelectTrigger className="w-full rounded-xl border-slate-200 bg-white h-11 text-sm font-semibold focus:ring-2 focus:ring-indigo-500/20">
                      <SelectValue>
                        {type === 'both' && 'Keduanya (Masuk & Pulang)'}
                        {type === 'tap_in' && 'Hanya Scan Masuk'}
                        {type === 'tap_out' && 'Hanya Scan Pulang'}
                      </SelectValue>
                    </SelectTrigger>
                    <SelectContent className="bg-white rounded-xl border border-slate-100 shadow-xl">
                      <SelectItem value="both">Keduanya (Masuk & Pulang)</SelectItem>
                      <SelectItem value="tap_in">Hanya Scan Masuk</SelectItem>
                      <SelectItem value="tap_out">Hanya Scan Pulang</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <div className="grid grid-cols-2 gap-4">
                  {type !== 'tap_out' && (
                    <div className="space-y-1.5">
                      <label className="text-[11px] font-bold text-slate-500 uppercase tracking-wider block">Jam Masuk (Rencana)</label>
                      <Input
                        type="time"
                        value={checkInTime}
                        onChange={(e) => setCheckInTime(e.target.value)}
                        className="rounded-xl border-slate-200 bg-white shadow-none h-11 text-sm font-semibold font-mono text-center focus:ring-2 focus:ring-indigo-500/20"
                      />
                    </div>
                  )}
                  {type !== 'tap_in' && (
                    <div className="space-y-1.5">
                      <label className="text-[11px] font-bold text-slate-500 uppercase tracking-wider block">Jam Pulang (Rencana)</label>
                      <Input
                        type="time"
                        value={checkOutTime}
                        onChange={(e) => setCheckOutTime(e.target.value)}
                        className="rounded-xl border-slate-200 bg-white shadow-none h-11 text-sm font-semibold font-mono text-center focus:ring-2 focus:ring-indigo-500/20"
                      />
                    </div>
                  )}
                </div>

                <div className="space-y-1.5">
                  <label className="text-[11px] font-bold text-slate-500 uppercase tracking-wider block">Alasan / Keterangan</label>
                  <textarea
                    rows={3}
                    value={reason}
                    onChange={(e) => setReason(e.target.value)}
                    placeholder="Contoh: Terburu-buru karena rapat yayasan pukul 08:00 WIB..."
                    className="w-full p-3 rounded-xl border border-slate-200 bg-white shadow-none text-sm font-medium focus:outline-none focus:ring-2 focus:ring-indigo-500/20 placeholder:text-slate-350"
                  />
                </div>

                <div className="space-y-1.5">
                  <label className="text-[11px] font-bold text-slate-500 uppercase tracking-wider block">Bukti Kehadiran (Opsional)</label>
                  <div className="relative border-2 border-dashed border-slate-200 rounded-2xl p-4 flex flex-col items-center justify-center hover:bg-slate-50/50 transition-colors">
                    <input
                      type="file"
                      accept="image/*,application/pdf"
                      onChange={handleFileChange}
                      className="absolute inset-0 opacity-0 cursor-pointer w-full h-full"
                    />
                    <Upload className="w-6 h-6 text-slate-400 mb-2" />
                    <span className="text-xs font-bold text-slate-650 text-center">
                      {file ? file.name : 'Klik atau seret file PDF / Foto di sini'}
                    </span>
                    <span className="text-[10px] text-slate-400 mt-1">Maks. 5MB (PDF, JPG, PNG)</span>
                  </div>
                  {uploadProgress !== null && (
                    <div className="w-full bg-slate-100 h-1.5 rounded-full overflow-hidden mt-2">
                      <div className="bg-indigo-500 h-full transition-all duration-150" style={{ width: `${uploadProgress}%` }} />
                    </div>
                  )}
                </div>

                <Button
                  type="submit"
                  disabled={submitLoading}
                  className="w-full bg-indigo-600 hover:bg-indigo-700 text-white font-bold h-11 rounded-2xl flex items-center justify-center gap-1.5 cursor-pointer shadow-md active:scale-[0.98] transition-all"
                >
                  {submitLoading ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin" />
                      {uploadProgress !== null ? `Mengunggah (${uploadProgress}%)...` : 'Mengirim...'}
                    </>
                  ) : (
                    'Kirim Pengajuan'
                  )}
                </Button>
              </form>
            </Card>
          </div>

          {/* History Card */}
          <div className="lg:col-span-7 space-y-6">
            <Card className="bg-white rounded-3xl border-none shadow-[0_4px_25px_rgba(0,0,0,0.02)] p-6">
              <div className="mb-4">
                <CardTitle className="text-base font-extrabold text-slate-850 tracking-wide uppercase flex items-center gap-2">
                  <Clock className="w-5 h-5 text-indigo-500" />
                  Riwayat Koreksi
                </CardTitle>
                <CardDescription className="text-xs text-slate-450 mt-1">
                  Semua pengajuan koreksi presensi yang pernah diajukan.
                </CardDescription>
              </div>

              {loading ? (
                <div className="py-12 flex flex-col items-center justify-center text-slate-400">
                  <Loader2 className="w-8 h-8 animate-spin text-indigo-500 mb-2" />
                  <p className="text-xs font-semibold animate-pulse">Memuat riwayat...</p>
                </div>
              ) : requests.length === 0 ? (
                <div className="py-16 text-center border border-dashed border-slate-100 rounded-2xl text-slate-400">
                  <HelpCircle className="w-10 h-10 mx-auto mb-2 text-slate-300" />
                  <p className="text-xs font-bold">Belum ada pengajuan koreksi presensi.</p>
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-left border-collapse text-xs">
                    <thead>
                      <tr className="border-b border-slate-100 text-slate-400 font-bold uppercase tracking-wider">
                        <th className="pb-3 pr-2 w-28">Tanggal</th>
                        <th className="pb-3 px-2 w-32">Koreksi</th>
                        <th className="pb-3 px-2">Alasan</th>
                        <th className="pb-3 px-2 w-28 text-center">Status</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-50">
                      {requests.map((req) => (
                        <tr key={req.id} className="hover:bg-slate-50/20">
                          <td className="py-3 pr-2 font-semibold text-slate-700 font-mono">
                            {new Date(req.date).toLocaleDateString('id-ID', { year: 'numeric', month: 'short', day: 'numeric' })}
                          </td>
                          <td className="py-3 px-2 font-medium text-slate-600">
                            {req.type === 'both' ? (
                              <div className="space-y-0.5">
                                <span className="text-[10px] bg-slate-100 px-1.5 py-0.5 rounded font-bold">Masuk & Pulang</span>
                                <div className="text-[10px] text-slate-400 font-mono mt-0.5">{req.checkInTime} - {req.checkOutTime}</div>
                              </div>
                            ) : req.type === 'tap_in' ? (
                              <div className="space-y-0.5">
                                <span className="text-[10px] bg-indigo-50 text-indigo-700 px-1.5 py-0.5 rounded font-bold">Masuk Saja</span>
                                <div className="text-[10px] text-slate-450 font-mono mt-0.5">{req.checkInTime}</div>
                              </div>
                            ) : (
                              <div className="space-y-0.5">
                                <span className="text-[10px] bg-amber-50 text-amber-700 px-1.5 py-0.5 rounded font-bold">Pulang Saja</span>
                                <div className="text-[10px] text-slate-450 font-mono mt-0.5">{req.checkOutTime}</div>
                              </div>
                            )}
                          </td>
                          <td className="py-3 px-2 text-slate-500 font-medium">
                            <div>{req.reason}</div>
                            {req.proofUrl && (
                              <a
                                href={req.proofUrl}
                                target="_blank"
                                rel="noreferrer"
                                className="inline-flex items-center gap-1 text-[10px] text-indigo-500 font-bold hover:underline mt-1 cursor-pointer"
                              >
                                <FileText className="w-3.5 h-3.5" />
                                Lihat Lampiran Bukti
                              </a>
                            )}
                            {req.rejectionReason && (
                              <div className="text-[10px] text-rose-600 bg-rose-50 border border-rose-100/50 p-2 rounded-xl mt-2 font-medium">
                                <strong>Catatan Penolakan:</strong> {req.rejectionReason}
                              </div>
                            )}
                          </td>
                          <td className="py-3 px-2 text-center">
                            <span className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[10px] font-bold ${
                              req.status === 'approved' 
                                ? 'bg-emerald-50 text-emerald-700 border border-emerald-100' 
                                : req.status === 'rejected' 
                                ? 'bg-rose-50 text-rose-700 border border-rose-100' 
                                : 'bg-amber-50 text-amber-700 border border-amber-100 animate-pulse'
                            }`}>
                              {req.status === 'approved' ? (
                                <>
                                  <CheckCircle2 className="w-3 h-3" />
                                  Disetujui
                                </>
                              ) : req.status === 'rejected' ? (
                                <>
                                  <XCircle className="w-3 h-3" />
                                  Ditolak
                                </>
                              ) : (
                                <>
                                  <Loader2 className="w-3 h-3 animate-spin" />
                                  Pending
                                </>
                              )}
                            </span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </Card>
          </div>

        </div>
      </div>
    </div>
  );
}
