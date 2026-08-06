"use client";

import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { useAuth } from '@/lib/AuthContext';
import { db, storage } from '@/lib/firebase';
import {
  collection,
  getDocs,
  query,
  where,
  serverTimestamp,
  doc,
  setDoc
} from 'firebase/firestore';
import { ref, uploadBytesResumable, getDownloadURL } from 'firebase/storage';
import {
  Card,
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
  XCircle,
  HelpCircle,
  X,
  MoreVertical,
  Pencil,
  Trash2
} from 'lucide-react';
import Link from 'next/link';
import {
  asPresenceCorrectionRequest,
  correctionTimeLabel,
  formatPresenceDate,
  isPresenceCorrectionType,
  parseDateOnly,
  timestampToMillis,
  type PresenceCorrectionRequest,
} from '@/lib/payroll/presenceCorrections';

const CLOCK_TIME_PATTERN = /^([01]\d|2[0-3]):([0-5]\d)$/;

function isValidClockTime(value: string): boolean {
  return CLOCK_TIME_PATTERN.test(value);
}

export default function PresensiCorrectionPage() {
  const { profile: rawProfile, activeProfile } = useAuth();
  const profile = activeProfile || rawProfile;
  const [loading, setLoading] = useState(false);
  const [submitLoading, setSubmitLoading] = useState(false);
  const [requests, setRequests] = useState<PresenceCorrectionRequest[]>([]);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  // Form states
  const [date, setDate] = useState(() => {
    const today = new Date();
    const y = today.getFullYear();
    const m = String(today.getMonth() + 1).padStart(2, '0');
    const d = String(today.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  });
  const [type, setType] = useState<'tap_in' | 'tap_out' | 'both' | 'izin_resmi'>('both');
  const [checkInTime, setCheckInTime] = useState('');
  const [checkOutTime, setCheckOutTime] = useState('');
  const [reason, setReason] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [uploadProgress, setUploadProgress] = useState<number | null>(null);
  const [checkInFocused, setCheckInFocused] = useState(false);
  const [checkOutFocused, setCheckOutFocused] = useState(false);
  const [filePreview, setFilePreview] = useState<string | null>(null);

  // Actions states
  const [activeMenuId, setActiveMenuId] = useState<string | null>(null);
  const [editingRequestId, setEditingRequestId] = useState<string | null>(null);
  const [existingProofUrl, setExistingProofUrl] = useState<string | null>(null);

  // Check if existing file is a PDF
  const isExistingProofPdf = useMemo(() => {
    return existingProofUrl?.toLowerCase().includes('.pdf') || false;
  }, [existingProofUrl]);

  // Cleanup object URL to prevent memory leaks
  useEffect(() => {
    return () => {
      if (filePreview) {
        URL.revokeObjectURL(filePreview);
      }
    };
  }, [filePreview]);

  // Calculate current month boundaries
  const { minDate, maxDate } = useMemo(() => {
    const today = new Date();
    const y = today.getFullYear();
    const m = today.getMonth(); // 0-indexed

    // First day of current month
    const firstDay = new Date(y, m, 1);
    const minStr = `${firstDay.getFullYear()}-${String(firstDay.getMonth() + 1).padStart(2, '0')}-01`;

    // Last day of current month
    const lastDay = new Date(y, m + 1, 0);
    const maxStr = `${lastDay.getFullYear()}-${String(lastDay.getMonth() + 1).padStart(2, '0')}-${String(lastDay.getDate()).padStart(2, '0')}`;

    return { minDate: minStr, maxDate: maxStr };
  }, []);

  // Check if check-out time is earlier than check-in time when type is 'both'
  const isTimeRangeInvalid = useMemo(() => {
    if (type === 'izin_resmi') return false;
    if (type !== 'both' || !checkInTime || !checkOutTime) return false;
    if (!isValidClockTime(checkInTime) || !isValidClockTime(checkOutTime)) return false;
    const [hIn, mIn] = checkInTime.split(':').map(Number);
    const [hOut, mOut] = checkOutTime.split(':').map(Number);
    return (hOut * 60 + mOut) <= (hIn * 60 + mIn);
  }, [type, checkInTime, checkOutTime]);

  const employeeId = profile?.linkedEmployeeId || profile?.uid;

  // Fetch employee's submitted requests. The list is sorted in memory so the
  // employee query does not require a composite Firestore index.
  const fetchRequests = useCallback(async (showError = true) => {
    if (!employeeId) return;
    setLoading(true);
    try {
      const q = query(
        collection(db, 'LoyalisPresenceCorrections'),
        where('employeeId', '==', employeeId),
      );
      const snap = await getDocs(q);
      const list = snap.docs
        .map((snapshot) => asPresenceCorrectionRequest(snapshot.id, snapshot.data()))
        .sort((a, b) => timestampToMillis(b.createdAt) - timestampToMillis(a.createdAt));
      setRequests(list);
    } catch (err) {
      console.error('Error fetching requests:', err);
      if (showError) {
        setMessage({ type: 'error', text: 'Gagal memuat riwayat koreksi presensi.' });
      }
    } finally {
      setLoading(false);
    }
  }, [employeeId]);

  useEffect(() => {
    // This effect intentionally starts an async data load; the loader updates
    // state when the Firestore request resolves.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void fetchRequests();
  }, [fetchRequests]);

  const handleStartEdit = (req: PresenceCorrectionRequest) => {
    setActiveMenuId(null);
    setEditingRequestId(req.id);
    setDate(req.date);
    setType(isPresenceCorrectionType(req.type) ? req.type : 'both');
    setCheckInTime(req.checkInTime || '');
    setCheckOutTime(req.checkOutTime || '');
    setReason(req.reason || '');
    setFile(null);
    setFilePreview(null);
    setExistingProofUrl(req.proofUrl || null);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const handleCancelEdit = () => {
    setEditingRequestId(null);
    setExistingProofUrl(null);
    const today = new Date();
    const y = today.getFullYear();
    const m = String(today.getMonth() + 1).padStart(2, '0');
    const d = String(today.getDate()).padStart(2, '0');
    setDate(`${y}-${m}-${d}`);
    setType('both');
    setReason('');
    setCheckInTime('');
    setCheckOutTime('');
    setFile(null);
    setFilePreview(null);
    setUploadProgress(null);
    setCheckInFocused(false);
    setCheckOutFocused(false);
  };

  const handleDeleteRequest = async (id: string) => {
    setActiveMenuId(null);
    void id;
    setMessage({
      type: 'error',
      text: 'Penghapusan pengajuan dinonaktifkan agar riwayat koreksi tetap utuh.',
    });
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      const selectedFile = e.target.files[0];
      const allowedTypes = ['image/jpeg', 'image/jpg', 'image/png', 'application/pdf'];
      const fileExtension = selectedFile.name.split('.').pop()?.toLowerCase();
      const allowedExtensions = ['jpeg', 'jpg', 'png', 'pdf'];

      if (!allowedTypes.includes(selectedFile.type) && !allowedExtensions.includes(fileExtension || '')) {
        setMessage({ type: 'error', text: 'Format file tidak didukung. Unggah file JPEG, JPG, PNG, atau PDF.' });
        setFile(null);
        setFilePreview(null);
        e.target.value = '';
        return;
      }

      if (selectedFile.size > 5 * 1024 * 1024) {
        setMessage({ type: 'error', text: 'Ukuran file tidak boleh melebihi 5MB.' });
        setFile(null);
        setFilePreview(null);
        e.target.value = '';
        return;
      }
      setFile(selectedFile);
      if (selectedFile.type.startsWith('image/')) {
        setFilePreview(URL.createObjectURL(selectedFile));
      } else {
        setFilePreview(null);
      }
      setMessage(null);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!date || !parseDateOnly(date)) {
      setMessage({ type: 'error', text: 'Pilih tanggal terlebih dahulu.' });
      return;
    }

    const today = new Date();
    const currentMonthToken = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}`;
    if (date.slice(0, 7) !== currentMonthToken) {
      setMessage({ type: 'error', text: 'Pengajuan koreksi hanya diizinkan untuk periode bulan berjalan.' });
      return;
    }
    if (!reason.trim()) {
      setMessage({ type: 'error', text: 'Masukkan alasan koreksi presensi Anda.' });
      return;
    }

    const checkIn = type === 'izin_resmi' ? '07:30' : (checkInTime.trim() || '08:00');
    const checkOut = type === 'izin_resmi' ? '14:00' : (checkOutTime.trim() || '14:00');

    if (type !== 'tap_out' && !isValidClockTime(checkIn)) {
      setMessage({ type: 'error', text: 'Masukkan jam masuk dalam format HH:MM yang valid.' });
      return;
    }
    if (type !== 'tap_in' && !isValidClockTime(checkOut)) {
      setMessage({ type: 'error', text: 'Masukkan jam pulang dalam format HH:MM yang valid.' });
      return;
    }

    if (type === 'both') {
      const [hIn, mIn] = checkIn.split(':').map(Number);
      const [hOut, mOut] = checkOut.split(':').map(Number);
      if ((hOut * 60 + mOut) <= (hIn * 60 + mIn)) {
        setMessage({ type: 'error', text: 'Jam Pulang harus lebih lambat dari Jam Masuk.' });
        return;
      }
    }

    setSubmitLoading(true);
    setUploadProgress(null);
    setMessage(null);

    try {
      const empId = profile?.linkedEmployeeId || profile?.uid || 'unknown';
      let proofUrl = existingProofUrl || '';
      let overwriteDocId: string | null = null;

      // Check for duplicate submission for the same date (only if not currently editing)
      if (!editingRequestId) {
        const q = query(
          collection(db, 'LoyalisPresenceCorrections'),
          where('employeeId', '==', empId),
          where('date', '==', date)
        );
        const querySnap = await getDocs(q);
        if (!querySnap.empty) {
          const existingDoc = querySnap.docs[0];
          const confirmDate = new Date(date).toLocaleDateString('id-ID', { day: 'numeric', month: 'long', year: 'numeric' });
          const confirmOverwrite = window.confirm(
            `Anda sudah mengajukan koreksi presensi untuk tanggal ${confirmDate}. Apakah Anda yakin ingin menimpa pengajuan tersebut dengan data baru?`
          );
          if (!confirmOverwrite) {
            setSubmitLoading(false);
            return;
          }
          overwriteDocId = existingDoc.id;
          if (!file) {
            proofUrl = existingDoc.data().proofUrl || '';
          }
        }
      }

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
              try {
                proofUrl = await getDownloadURL(uploadTask.snapshot.ref);
                setUploadProgress(100);
                resolve();
              } catch (error) {
                console.error('Failed to resolve uploaded file URL:', error);
                reject(error);
              }
            }
          );
        });
      }

      // Convert date "2026-07-11" to "260711" (yymmdd)
      const dateParts = date.split('-');
      const yy = dateParts[0].slice(-2);
      const mm = dateParts[1];
      const dd = dateParts[2];
      const customDocId = `${empId}_${yy}${mm}${dd}`;

      // 2. Save document to Firestore
      const requestData: Record<string, unknown> = {
        period: date.slice(0, 7),
        date,
        type,
        checkInTime: type === 'tap_out' ? null : checkIn,
        checkOutTime: type === 'tap_in' ? null : checkOut,
        reason: reason.trim(),
        proofUrl,
        updatedAt: serverTimestamp(),
      };

      const targetId = editingRequestId || overwriteDocId;

      if (targetId) {
        // Reset status to pending and clear rejection reason when updating/overwriting
        requestData.status = 'pending';
        requestData.rejectionReason = null;
        requestData.employeeId = empId;
        requestData.employeeName = profile?.displayName || 'Karyawan';

        // Preserve the original document identity so editing a date never
        // requires deleting the historical correction document.
        await setDoc(
          doc(db, 'LoyalisPresenceCorrections', targetId),
          requestData,
          { merge: true },
        );

        setMessage({
          type: 'success',
          text: editingRequestId ? 'Pengajuan koreksi berhasil diperbarui!' : 'Pengajuan koreksi sebelumnya berhasil ditimpa!'
        });
      } else {
        const newRequest = {
          ...requestData,
          employeeId: empId,
          employeeName: profile?.displayName || 'Karyawan',
          status: 'pending',
          createdAt: serverTimestamp(),
        };
        await setDoc(doc(db, 'LoyalisPresenceCorrections', customDocId), newRequest);
        setMessage({ type: 'success', text: 'Koreksi presensi berhasil diajukan!' });
      }

      // Reset form
      handleCancelEdit();

      await fetchRequests(false);
    } catch (err: unknown) {
      console.error(err);
      setMessage({
        type: 'error',
        text: err instanceof Error ? err.message : 'Gagal mengajukan koreksi presensi. Silakan coba lagi.',
      });
    } finally {
      setSubmitLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-50/50 py-8 px-4 sm:px-6">
      <style>{`
        input[type="time"]::-webkit-datetime-edit {
          display: inline-flex;
          justify-content: center;
          width: 100%;
          text-align: center;
        }
      `}</style>
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
          <div className={`flex items-start gap-2.5 px-4 py-3 rounded-2xl text-sm font-medium border ${message.type === 'success'
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
                  {editingRequestId ? 'Ubah Koreksi' : 'Ajukan Koreksi'}
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
                    min={minDate}
                    max={maxDate}
                    onChange={(e) => setDate(e.target.value)}
                    className="rounded-xl border-slate-200 bg-white shadow-none h-11 text-sm font-semibold focus:ring-2 focus:ring-indigo-500/20"
                  />
                </div>

                <div className="space-y-1.5">
                  <label className="text-[11px] font-bold text-slate-500 uppercase tracking-wider block">Tipe Koreksi</label>
                  <Select
                    value={type}
                    onValueChange={(value) => {
                      if (isPresenceCorrectionType(value)) setType(value);
                    }}
                  >
                    <SelectTrigger className="w-full rounded-xl border-slate-200 bg-white h-11 text-sm font-semibold focus:ring-2 focus:ring-indigo-500/20">
                      <SelectValue>
                        {type === 'both' && 'Keduanya (Masuk & Pulang)'}
                        {type === 'tap_in' && 'Hanya Scan Masuk'}
                        {type === 'tap_out' && 'Hanya Scan Pulang'}
                        {type === 'izin_resmi' && 'Izin Resmi (Hari Penuh)'}
                      </SelectValue>
                    </SelectTrigger>
                    <SelectContent className="bg-white rounded-xl border border-slate-100 shadow-xl">
                      <SelectItem value="both">Keduanya (Masuk & Pulang)</SelectItem>
                      <SelectItem value="tap_in">Hanya Scan Masuk</SelectItem>
                      <SelectItem value="tap_out">Hanya Scan Pulang</SelectItem>
                      <SelectItem value="izin_resmi">Izin Resmi (Hari Penuh)</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <div className="grid grid-cols-2 gap-4">
                  {type === 'izin_resmi' ? (
                    <div className="col-span-2 flex items-center gap-2 p-3.5 rounded-2xl text-[11px] font-bold bg-emerald-50 text-emerald-700 border border-emerald-200">
                      <Clock className="w-4 h-4 text-emerald-600 shrink-0" />
                      <span>Izin Resmi akan otomatis dihitung sebagai hari penuh: <strong className="font-mono">07:30 — 14:00</strong></span>
                    </div>
                  ) : type !== 'tap_out' && (
                    <div className="space-y-1.5">
                      <label className="text-[11px] font-bold text-slate-500 uppercase tracking-wider block">Jam Masuk</label>
                      <Input
                        type={checkInFocused || checkInTime ? "time" : "text"}
                        value={checkInTime}
                        onChange={(e) => setCheckInTime(e.target.value)}
                        onFocus={() => setCheckInFocused(true)}
                        onBlur={() => setCheckInFocused(false)}
                        placeholder="07:30"
                        className="rounded-xl border-slate-200 bg-white shadow-none h-11 text-sm font-semibold font-mono text-center focus:ring-2 focus:ring-indigo-500/20"
                      />
                    </div>
                  )}
                  {type !== 'tap_in' && type !== 'izin_resmi' && (
                    <div className="space-y-1.5">
                      <label className="text-[11px] font-bold text-slate-500 uppercase tracking-wider block">Jam Pulang</label>
                      <Input
                        type={checkOutFocused || checkOutTime ? "time" : "text"}
                        value={checkOutTime}
                        onChange={(e) => setCheckOutTime(e.target.value)}
                        onFocus={() => setCheckOutFocused(true)}
                        onBlur={() => setCheckOutFocused(false)}
                        placeholder="14:00"
                        className="rounded-xl border-slate-200 bg-white shadow-none h-11 text-sm font-semibold font-mono text-center focus:ring-2 focus:ring-indigo-500/20"
                      />
                    </div>
                  )}
                  {isTimeRangeInvalid && (
                    <div className="col-span-2 flex items-center gap-2 p-3.5 rounded-2xl text-[11px] font-bold bg-amber-50 text-amber-700 border border-amber-200 animate-in fade-in duration-200">
                      <AlertCircle className="w-4 h-4 text-amber-600 shrink-0" />
                      <span>Peringatan: Jam Pulang harus lebih lambat dari Jam Masuk.</span>
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
                  <label className="text-[11px] font-bold text-slate-500 uppercase tracking-wider block">Bukti Kehadiran</label>
                  {!file && !existingProofUrl ? (
                    <div className="relative border-2 border-dashed border-slate-200 rounded-2xl p-4 flex flex-col items-center justify-center hover:bg-slate-50/50 transition-colors">
                      <input
                        type="file"
                        accept=".jpeg,.jpg,.png,.pdf,image/jpeg,image/png,application/pdf"
                        onChange={handleFileChange}
                        className="absolute inset-0 opacity-0 cursor-pointer w-full h-full"
                      />
                      <Upload className="w-6 h-6 text-slate-400 mb-2" />
                      <span className="text-xs font-bold text-slate-650 text-center">
                        Klik atau seret file PDF / Foto di sini
                      </span>
                      <span className="text-[10px] text-slate-400 mt-1">Maks. 5MB (PDF, JPG, PNG)</span>
                    </div>
                  ) : (
                    <div className="relative border border-slate-150 rounded-2xl p-3 bg-slate-50 flex items-center gap-3 animate-in zoom-in-95 duration-150">
                      {filePreview ? (
                        <div className="relative w-12 h-12 rounded-lg overflow-hidden border border-slate-200 shrink-0 bg-white">
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img src={filePreview} alt="Preview" className="w-full h-full object-cover" />
                        </div>
                      ) : existingProofUrl && !isExistingProofPdf ? (
                        <div className="relative w-12 h-12 rounded-lg overflow-hidden border border-slate-200 shrink-0 bg-white">
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img src={existingProofUrl} alt="Preview" className="w-full h-full object-cover" />
                        </div>
                      ) : (
                        <div className="w-12 h-12 rounded-lg bg-indigo-50 border border-indigo-100 flex items-center justify-center shrink-0">
                          <FileText className="w-6 h-6 text-indigo-550" />
                        </div>
                      )}
                      <div className="flex-1 min-w-0">
                        <p className="text-xs font-bold text-slate-750 truncate">
                          {file ? file.name : 'Bukti Terlampir (Sebelumnya)'}
                        </p>
                        <p className="text-[10px] text-slate-400 font-semibold mt-0.5">
                          {file ? `${(file.size / 1024).toFixed(0)} KB` : 'Lampiran Terunggah'}
                        </p>
                      </div>
                      <Button
                        type="button"
                        variant="ghost"
                        onClick={() => {
                          setFile(null);
                          setFilePreview(null);
                          setExistingProofUrl(null);
                        }}
                        className="h-8 w-8 p-0 rounded-full hover:bg-slate-200/60 text-slate-450 hover:text-slate-750 shrink-0 flex items-center justify-center cursor-pointer"
                      >
                        <X className="w-4 h-4" />
                      </Button>
                    </div>
                  )}
                  {uploadProgress !== null && (
                    <div className="w-full bg-slate-100 h-1.5 rounded-full overflow-hidden mt-2">
                      <div className="bg-indigo-500 h-full transition-all duration-150" style={{ width: `${uploadProgress}%` }} />
                    </div>
                  )}
                </div>

                <div className="flex gap-2.5">
                  {editingRequestId && (
                    <Button
                      type="button"
                      variant="outline"
                      onClick={handleCancelEdit}
                      className="flex-1 border-slate-200 text-slate-600 font-bold h-11 rounded-2xl active:scale-[0.98] transition-all cursor-pointer"
                    >
                      Batal
                    </Button>
                  )}
                  <Button
                    type="submit"
                    disabled={submitLoading}
                    className={`bg-indigo-600 hover:bg-indigo-700 text-white font-bold h-11 rounded-2xl flex items-center justify-center gap-1.5 cursor-pointer shadow-md active:scale-[0.98] transition-all ${editingRequestId ? 'flex-1' : 'w-full'}`}
                  >
                    {submitLoading ? (
                      <>
                        <Loader2 className="w-4 h-4 animate-spin" />
                        {uploadProgress !== null ? `Mengunggah (${uploadProgress}%)...` : 'Menyimpan...'}
                      </>
                    ) : (
                      editingRequestId ? 'Simpan Perubahan' : 'Kirim Pengajuan'
                    )}
                  </Button>
                </div>
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
                <div className="space-y-3">
                  {requests.map((req) => (
                    <div
                      key={req.id}
                      className={`relative rounded-2xl border p-4 transition-colors ${editingRequestId === req.id
                        ? 'border-indigo-200 bg-indigo-50/30 ring-1 ring-indigo-100'
                        : 'border-slate-100 bg-slate-50/30 hover:bg-slate-50/60'
                        }`}
                    >
                      {/* Top row: Date + Status + Action */}
                      <div className="flex items-center justify-between mb-2.5">
                        <div className="flex items-center gap-2">
                          <span className="text-xs font-bold text-slate-700 font-mono">
                            {formatPresenceDate(req.date, { day: 'numeric', month: 'short', year: 'numeric' })}
                          </span>
                          {req.type === 'izin_resmi' ? (
                            <span className="text-[10px] bg-emerald-100/60 text-emerald-700 px-1.5 py-0.5 rounded font-bold">Izin Resmi</span>
                          ) : req.type === 'both' ? (
                            <span className="text-[10px] bg-slate-200/60 text-slate-600 px-1.5 py-0.5 rounded font-bold">Masuk & Pulang</span>
                          ) : req.type === 'tap_in' ? (
                            <span className="text-[10px] bg-indigo-100/60 text-indigo-700 px-1.5 py-0.5 rounded font-bold">Masuk Saja</span>
                          ) : (
                            <span className="text-[10px] bg-amber-100/60 text-amber-700 px-1.5 py-0.5 rounded font-bold">Pulang Saja</span>
                          )}
                        </div>
                        <div className="flex items-center gap-1.5">
                          <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold ${req.status === 'approved'
                            ? 'bg-emerald-50 text-emerald-700 border border-emerald-100'
                            : req.status === 'rejected'
                              ? 'bg-rose-50 text-rose-700 border border-rose-100'
                              : 'bg-amber-50 text-amber-700 border border-amber-100'
                            }`}>
                            {req.status === 'approved' ? (
                              <><CheckCircle2 className="w-3 h-3" /> Disetujui</>
                            ) : req.status === 'rejected' ? (
                              <><XCircle className="w-3 h-3" /> Ditolak</>
                            ) : (
                              <><Clock className="w-3 h-3" /> Pending</>
                            )}
                          </span>
                          {(req.status === 'pending' || req.status === 'rejected') && (
                            <div className="relative">
                              <Button
                                type="button"
                                variant="ghost"
                                onClick={() => setActiveMenuId(activeMenuId === req.id ? null : req.id)}
                                className="h-7 w-7 p-0 rounded-full hover:bg-slate-200/50 text-slate-400 hover:text-slate-700 flex items-center justify-center cursor-pointer"
                              >
                                <MoreVertical className="w-4 h-4" />
                              </Button>

                              {activeMenuId === req.id && (
                                <>
                                  <div
                                    className="fixed inset-0 z-40"
                                    onClick={() => setActiveMenuId(null)}
                                  />
                                  <div className="absolute right-0 mt-1 w-28 bg-white rounded-xl border border-slate-100 shadow-xl py-1 z-50 animate-in fade-in zoom-in-95 duration-100">
                                    <button
                                      type="button"
                                      onClick={() => handleStartEdit(req)}
                                      className="w-full px-3 py-2 text-left text-xs font-semibold text-slate-650 hover:bg-slate-50 flex items-center gap-2 cursor-pointer"
                                    >
                                      <Pencil className="w-3.5 h-3.5 text-indigo-500" />
                                      Ubah
                                    </button>
                                    <button
                                      type="button"
                                      onClick={() => handleDeleteRequest(req.id)}
                                      className="w-full px-3 py-2 text-left text-xs font-semibold text-rose-600 hover:bg-rose-50 flex items-center gap-2 cursor-pointer border-t border-slate-50"
                                    >
                                      <Trash2 className="w-3.5 h-3.5 text-rose-500" />
                                      Hapus
                                    </button>
                                  </div>
                                </>
                              )}
                            </div>
                          )}
                        </div>
                      </div>

                      {/* Time row */}
                      <div className="flex items-center gap-2 mb-2">
                        <Clock className="w-3.5 h-3.5 text-slate-350 shrink-0" />
                        <span className="text-[11px] font-semibold font-mono text-slate-500">
                          {correctionTimeLabel(req)}
                        </span>
                      </div>

                      {/* Reason */}
                      <p className="text-xs text-slate-500 font-medium leading-relaxed">{req.reason}</p>

                      {/* Proof link */}
                      {req.proofUrl && (
                        <a
                          href={req.proofUrl}
                          target="_blank"
                          rel="noreferrer"
                          className="inline-flex items-center gap-1 text-[10px] text-indigo-500 font-bold hover:underline mt-2 cursor-pointer"
                        >
                          <FileText className="w-3.5 h-3.5" />
                          Lihat Lampiran Bukti
                        </a>
                      )}

                      {/* Rejection reason */}
                      {req.rejectionReason && (
                        <div className="text-[10px] text-rose-600 bg-rose-50 border border-rose-100/50 p-2.5 rounded-xl mt-2.5 font-medium">
                          <strong>Catatan Penolakan:</strong> {req.rejectionReason}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </Card>
          </div>

        </div>
      </div>
    </div>
  );
}
