"use client"

import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { useSearchParams } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card } from '@/components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@/components/ui/select';
import {
  Upload, Loader2, CheckCircle2, FileText, AlertCircle, ImageIcon, Trash2, Eye,
  RotateCw, Sparkles, X, Building2, Code2, ShieldCheck, FileDown, Plus, Save,
  LogOut, Calendar, Clock, Send, CheckCircle, RotateCcw, AlertTriangle, Users,
  XCircle, Lock, FileSpreadsheet, Banknote, ExternalLink
} from 'lucide-react';
import { useAuth } from '@/lib/AuthContext';
import {
  collection, getDocs, doc, setDoc, getDoc, serverTimestamp, query, where, deleteDoc, onSnapshot
} from 'firebase/firestore';
import { db, storage } from '@/lib/firebase';
import { ref, uploadBytes, getDownloadURL } from 'firebase/storage';
import { MONTHS_ID } from '@/utils/rekapConfig';
import CetakKegiatanLoyalisDialog from '@/components/CetakKegiatanLoyalisDialog';
import { generateKegiatanLoyalisRecapPdf } from '@/utils/generateKegiatanLoyalisRecapPdf';
import { generateKegiatanLoyalisRecapXlsx } from '@/utils/generateKegiatanLoyalisRecapXlsx';

export default function VakasiLoyalisPage() {
  const { profile } = useAuth();
  const searchParams = useSearchParams();

  // Read params from URL search parameters
  const month = parseInt(searchParams.get('month') || String(new Date().getMonth() + 1), 10);
  const year = parseInt(searchParams.get('year') || String(new Date().getFullYear()), 10);

  const periodToken = `${year}-${String(month).padStart(2, '0')}`;

  // ── States ──
  const [loyalisEmployees, setLoyalisEmployees] = useState<any[]>([]);
  const [loadingLoyalis, setLoadingLoyalis] = useState(false);
  const [existingEvents, setExistingEvents] = useState<any[]>([]);
  const [loadingEvents, setLoadingEvents] = useState(false);
  const [filterDept, setFilterDept] = useState<string>('');
  const [activeSuggestionIndex, setActiveSuggestionIndex] = useState<number>(0);
  const [cetakKegiatanDialogOpen, setCetakKegiatanDialogOpen] = useState(false);

  // Form States
  const [selectedEventId, _setSelectedEventId] = useState<string | null>(null);
  const selectedEventIdRef = useRef<string | null>(null);
  const setSelectedEventId = (id: string | null) => {
    _setSelectedEventId(id);
    selectedEventIdRef.current = id;
  };
  const [eventName, setEventName] = useState('');
  const [isEndOfMonth, setIsEndOfMonth] = useState(false);
  const [selectedDept, setSelectedDept] = useState<string>('');
  const [departments, setDepartments] = useState<string[]>([]);
  const [workerRows, setWorkerRows] = useState<{
    employeeId: string;
    employeeName: string;
    payGiven: number;
    showDropdown?: boolean;
    searchText?: string;
  }[]>([{ employeeId: '', employeeName: '', payGiven: 0, searchText: '', showDropdown: false }]);

  // Autosave status
  const [autosaveMessage, setAutosaveMessage] = useState<string>('');
  
  // File upload for SatKer Loyalis scanned report
  const [reportFile, setReportFile] = useState<File | null>(null);
  const [reportFileUrl, setReportFileUrl] = useState<string | null>(null);
  const [reportFileName, setReportFileName] = useState<string | null>(null);
  const [uploadingReport, setUploadingReport] = useState(false);

  // Review dialog for Super Admin
  const [showReviewDialog, setShowReviewDialog] = useState(false);
  const [reviewAction, setReviewAction] = useState<'approved' | 'revision_needed' | 'declined'>('approved');
  const [reviewNote, setReviewNote] = useState('');
  const [reviewingEventId, setReviewingEventId] = useState<string | null>(null);

  // Lightbox for file preview
  const [lightboxUrl, setLightboxUrl] = useState<string | null>(null);

  // Current event status
  const [currentEventStatus, setCurrentEventStatus] = useState<string | null>(null);
  const [currentEventReviewNote, setCurrentEventReviewNote] = useState<string | null>(null);
  const [currentEventSubmittedBy, setCurrentEventSubmittedBy] = useState<string | null>(null);
  const [currentEventSubmittedByName, setCurrentEventSubmittedByName] = useState<string | null>(null);
  const [currentEventSubmittedByEmail, setCurrentEventSubmittedByEmail] = useState<string | null>(null);

  const [saving, setSaving] = useState(false);
  const isSavingRef = useRef(false);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  // ── Fetch Signature Configurations ──
  const [signatureConfig, setSignatureConfig] = useState<Record<string, { name: string, title: string }>>({});
  useEffect(() => {
    const fetchSignatures = async () => {
      try {
        const docRef = doc(db, 'Settings', 'signatures');
        const docSnap = await getDoc(docRef);
        if (docSnap.exists()) {
          setSignatureConfig(docSnap.data());
        }
      } catch (err) {
        console.error('Error fetching signatures:', err);
      }
    };
    fetchSignatures();
  }, []);

  // ── Fetch Loyalis Employees ──
  useEffect(() => {
    const fetchLoyalis = async () => {
      setLoadingLoyalis(true);
      try {
        const q = query(
          collection(db, 'Employees_Loyalis'),
          where('personal_info.status', '==', 'AKTIF')
        );
        const snap = await getDocs(q);
        const list = snap.docs.map(d => {
          const data = d.data();
          return {
            id: d.id,
            name: data.personal_info?.name || '',
            role: data.employment_profile?.job_role || '',
            department: data.employment_profile?.department_unit || '',
          };
        }).sort((a, b) => a.name.localeCompare(b.name));
        setLoyalisEmployees(list);
      } catch (err) {
        console.error('Error fetching Loyalis employees:', err);
      } finally {
        setLoadingLoyalis(false);
      }
    };
    fetchLoyalis();
  }, []);

  // ── Fetch Departments ──
  useEffect(() => {
    const fetchDepartments = async () => {
      try {
        const deptDoc = await getDoc(doc(db, 'Settings', 'departments'));
        if (deptDoc.exists() && deptDoc.data().list) {
          setDepartments(deptDoc.data().list);
        } else {
          const defaultList = [
            'BAK', 'FEB', 'FBS', 'FIK', 'FIP', 'FKI', 'FSP', 'FT', 'Rektorat', 'Satpam', 'Yayasan'
          ].sort();
          setDepartments(defaultList);
        }
      } catch (err) {
        console.error('Error fetching departments:', err);
      }
    };
    fetchDepartments();
  }, []);

  // ── Live Sync Vakasi Tambahan Events ──
  useEffect(() => {
    if (!profile) return;
    setLoadingEvents(true);
    const q = query(
      collection(db, 'VakasiTambahan'),
      where('period', '==', periodToken)
    );

    const unsubscribe = onSnapshot(q, (snap) => {
      let list = snap.docs.map(d => ({
        id: d.id,
        ...d.data()
      })) as any[];

      if (profile.role === 'satker_head_loyalis') {
        list = list.filter(evt => evt.submittedBy === profile.uid);
      }

      list.sort((a, b) => {
        const getMs = (val: any) => {
          if (!val) return Date.now();
          if (typeof val.toMillis === 'function') return val.toMillis();
          if (val.seconds) return val.seconds * 1000;
          return 0;
        };
        return getMs(b.updatedAt) - getMs(a.updatedAt);
      });

      setExistingEvents(list);
      setLoadingEvents(false);
    }, (err) => {
      console.error('Error listening to events:', err);
      setLoadingEvents(false);
    });

    return () => unsubscribe();
  }, [periodToken, profile]);

  const filteredEvents = useMemo(() => {
    if (!filterDept) return existingEvents;
    return existingEvents.filter(evt => evt.departmentUnit === filterDept);
  }, [existingEvents, filterDept]);

  const syncEmployeeVakasiPay = async (
    workerId: string,
    periodVal: string,
    deletedEventName?: string,
    updatedEvent?: { id: string; eventName: string; status: string; eventWorkers: Record<string, any> }
  ) => {
    // Retain this awaited hook for callers, but never mutate a payslip here.
    // Finance refreshes affected drafts from VakasiTambahan and saves them via
    // /api/payroll/slips. Final snapshots are immutable.
    void workerId;
    void periodVal;
    void deletedEventName;
    void updatedEvent;
  };

  const sanitizeEventId = (name: string): string => {
    return name.replace(/[^a-zA-Z0-9]/g, '').slice(0, 10);
  };

  const uploadReportFile = async (fileToUpload: File, period: string, eventSeg: string): Promise<{ url: string; name: string }> => {
    const ext = fileToUpload.name.split('.').pop() || 'pdf';
    const path = `vakasi_reports/${period}/${eventSeg}_${Date.now()}.${ext}`;
    const storageRef = ref(storage, path);
    await uploadBytes(storageRef, fileToUpload);
    const url = await getDownloadURL(storageRef);
    return { url, name: fileToUpload.name };
  };

  const handleReportFileChange = async (fileToUpload: File) => {
    const validTypes = ['application/pdf', 'image/jpeg', 'image/jpg', 'image/png'];
    if (!validTypes.includes(fileToUpload.type)) {
      setMessage({ type: 'error', text: 'Format file tidak valid. Gunakan PDF, JPG, JPEG, atau PNG.' });
      return;
    }
    if (fileToUpload.size > 10 * 1024 * 1024) {
      setMessage({ type: 'error', text: 'Ukuran file terlalu besar (maks 10MB).' });
      return;
    }
    setReportFile(fileToUpload);
    setReportFileName(fileToUpload.name);

    setUploadingReport(true);
    try {
      const eventSeg = sanitizeEventId(eventName || 'unnamed');
      const result = await uploadReportFile(fileToUpload, periodToken, eventSeg);
      setReportFileUrl(result.url);
      setMessage({ type: 'success', text: `File "${result.name}" berhasil diunggah.` });
      triggerAutosave(workerRows, eventName, selectedEventIdRef.current, isEndOfMonth, selectedDept, result.url, result.name);
    } catch (err) {
      console.error('Error uploading report file:', err);
      setMessage({ type: 'error', text: 'Gagal mengunggah file laporan.' });
      setReportFile(null);
      setReportFileName(null);
    } finally {
      setUploadingReport(false);
    }
  };

  const handleSubmitForReview = async () => {
    if (isSavingRef.current) return;
    if (!eventName.trim()) {
      setMessage({ type: 'error', text: 'Nama Kegiatan harus diisi.' });
      return;
    }
    const invalidWorker = workerRows.find(w => w.searchText?.trim() && !w.employeeId);
    if (invalidWorker) {
      setMessage({
        type: 'error',
        text: `Pegawai "${invalidWorker.searchText}" belum dipilih secara valid dari daftar dropdown. Silakan cari dan klik nama pegawai dari dropdown.`
      });
      return;
    }

    const activeWorkers = workerRows.filter(w => w.employeeId);
    if (activeWorkers.length === 0) {
      setMessage({ type: 'error', text: 'Minimal harus ada 1 pegawai.' });
      return;
    }
    if (!reportFileUrl) {
      setMessage({ type: 'error', text: 'Laporan yang ditandatangani harus diunggah sebelum submit.' });
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
      const eventSeg = sanitizeEventId(eventName);
      const documentId = selectedEventId || `${periodToken}_${eventSeg}_${Math.random().toString(36).substring(2, 8)}`;

      let totalPayout = 0;
      const workersMap: Record<string, { employeeName: string, payGiven: number }> = {};

      activeWorkers.forEach(w => {
        workersMap[w.employeeId] = {
          employeeName: w.employeeName,
          payGiven: w.payGiven,
        };
        totalPayout += w.payGiven;
      });

      let previousWorkerIds: string[] = [];
      if (selectedEventId) {
        const prevSnap = await getDoc(doc(db, 'VakasiTambahan', selectedEventId));
        if (prevSnap.exists()) {
          const prevData = prevSnap.data() as any;
          previousWorkerIds = Object.keys(prevData.eventWorkers || {});
        }
      }

      const allAffectedIds = Array.from(new Set([
        ...activeWorkers.map(w => w.employeeId),
        ...previousWorkerIds
      ]));

      const dbPeriod = `${year}_${String(month).padStart(2, '0')}`;
      const lockedNames: string[] = [];

      await Promise.all(
        allAffectedIds.map(async (empId) => {
          const slipDocId = `${dbPeriod}_${empId}`;
          const snap = await getDoc(doc(db, 'PayrollSlipStates', slipDocId));
          if (snap.exists() && snap.data()?.status === 'locked') {
            const wName = activeWorkers.find(w => w.employeeId === empId)?.employeeName || empId;
            lockedNames.push(wName);
          }
        })
      );

      if (lockedNames.length > 0) {
        isSavingRef.current = false;
        setSaving(false);
        setMessage({
          type: 'error',
          text: `Gagal mensubmit: Slip gaji untuk karyawan berikut telah terkunci. Harap hubungi admin BAK untuk membuka kunci slip mereka terlebih dahulu sebelum mengajukan kegiatan ini:\n- ${lockedNames.join('\n- ')}`
        });
        return;
      }

      const payload = {
        eventName,
        period: periodToken,
        totalPayout,
        isEndOfMonth: false,
        departmentUnit: selectedDept || null,
        eventWorkers: workersMap,
        updatedAt: serverTimestamp(),
        status: 'pending_review',
        submittedBy: profile?.uid || null,
        submittedByName: profile?.displayName || null,
        submittedByEmail: profile?.email || null,
        reportFileUrl: reportFileUrl,
        reportFileName: reportFileName,
        submittedAt: serverTimestamp(),
        reviewNote: null,
        reviewedBy: null,
        reviewedAt: null,
      };

      await setDoc(doc(db, 'VakasiTambahan', documentId), payload);
      setMessage({ type: 'success', text: `Kegiatan "${eventName}" berhasil disubmit untuk review.` });
      setAutosaveMessage('');

      setSelectedEventId(documentId);
      setCurrentEventStatus('pending_review');
      setCurrentEventReviewNote(null);
      setCurrentEventSubmittedBy(profile?.uid || null);
      setCurrentEventSubmittedByName(profile?.displayName || null);
      setCurrentEventSubmittedByEmail(profile?.email || null);
      setReportFile(null);
    } catch (err) {
      console.error(err);
      setMessage({ type: 'error', text: 'Gagal mensubmit kegiatan untuk review.' });
    } finally {
      isSavingRef.current = false;
      setSaving(false);
    }
  };

  const handleReviewEvent = async (eventId: string, action: 'approved' | 'revision_needed' | 'declined', note: string) => {
    if (isSavingRef.current) return;
    isSavingRef.current = true;
    setSaving(true);
    try {
      const eventSnap = await getDoc(doc(db, 'VakasiTambahan', eventId));
      if (!eventSnap.exists()) {
        throw new Error("Event tidak ditemukan.");
      }
      const eventData = eventSnap.data() as any;
      const periodVal = eventData.period;
      const workers = eventData.eventWorkers || {};

      if (action === 'approved') {
        const [yearStr, monthStr] = periodVal.split('-');
        const dbPeriod = `${yearStr}_${monthStr}`;
        const lockedNames: string[] = [];

        await Promise.all(
          Object.entries(workers).map(async ([empId, w]: [string, any]) => {
            const slipDocId = `${dbPeriod}_${empId}`;
            const snap = await getDoc(doc(db, 'PayrollSlipStates', slipDocId));
            if (snap.exists() && snap.data()?.status === 'locked') {
              lockedNames.push(w.employeeName || empId);
            }
          })
        );

        if (lockedNames.length > 0) {
          isSavingRef.current = false;
          setSaving(false);
          setMessage({
            type: 'error',
            text: `Gagal memproses review: Slip gaji untuk karyawan berikut telah terkunci. Harap buka kunci slip mereka di dashboard terlebih dahulu:\n- ${lockedNames.join('\n- ')}`
          });
          return;
        }
      }

      const updatePayload: Record<string, any> = {
        status: action,
        reviewedBy: profile?.uid || null,
        reviewedAt: serverTimestamp(),
        reviewNote: note || null,
        updatedAt: serverTimestamp(),
      };

      await setDoc(doc(db, 'VakasiTambahan', eventId), updatePayload, { merge: true });
      const actionLabel = action === 'approved' ? 'disetujui' : action === 'revision_needed' ? 'diminta revisi' : 'ditolak';
      setMessage({ type: 'success', text: `Kegiatan berhasil ${actionLabel}.` });

      if (action === 'approved') {
        const updatedEventPayload = {
          id: eventId,
          eventName: eventData.eventName,
          status: 'approved',
          eventWorkers: workers
        };
        await Promise.all(
          Object.keys(workers).map(empId => syncEmployeeVakasiPay(empId, periodVal, undefined, updatedEventPayload))
        );
      }

      setShowReviewDialog(false);
      setReviewNote('');
      setReviewingEventId(null);
      setCurrentEventStatus(action);
      setCurrentEventReviewNote(note || null);
    } catch (err) {
      console.error(err);
      setMessage({ type: 'error', text: 'Gagal memproses review.' });
    } finally {
      isSavingRef.current = false;
      setSaving(false);
    }
  };

  const handleUnverifyEvent = async (eventId: string) => {
    if (isSavingRef.current) return;
    if (!confirm('Apakah Anda yakin ingin membatalkan persetujuan kegiatan ini? Status akan kembali menjadi Menunggu Review.')) return;
    isSavingRef.current = true;
    setSaving(true);
    try {
      const updatePayload: Record<string, any> = {
        status: 'pending_review',
        updatedAt: serverTimestamp(),
      };

      await setDoc(doc(db, 'VakasiTambahan', eventId), updatePayload, { merge: true });
      setMessage({ type: 'success', text: 'Persetujuan kegiatan berhasil dibatalkan.' });
      setCurrentEventStatus('pending_review');
    } catch (err) {
      console.error(err);
      setMessage({ type: 'error', text: 'Gagal membatalkan persetujuan.' });
    } finally {
      isSavingRef.current = false;
      setSaving(false);
    }
  };

  const handleSaveEvent = async () => {
    if (isSavingRef.current) return;
    if (!eventName.trim()) {
      setMessage({ type: 'error', text: 'Nama Kegiatan harus diisi.' });
      return;
    }
    const invalidWorker = workerRows.find(w => w.searchText?.trim() && !w.employeeId);
    if (invalidWorker) {
      setMessage({
        type: 'error',
        text: `Pegawai "${invalidWorker.searchText}" belum dipilih secara valid dari daftar dropdown. Silakan cari dan klik nama pegawai dari dropdown.`
      });
      return;
    }

    const activeWorkers = workerRows.filter(w => w.employeeId);
    if (activeWorkers.length === 0) {
      setMessage({ type: 'error', text: 'Minimal harus ada 1 pegawai.' });
      return;
    }
    const ids = activeWorkers.map(w => w.employeeId);
    if (new Set(ids).size !== ids.length) {
      setMessage({ type: 'error', text: 'Ada duplikasi pegawai dalam kegiatan ini.' });
      return;
    }

    if (autosaveTimerRef.current) {
      clearTimeout(autosaveTimerRef.current);
    }

    isSavingRef.current = true;
    setSaving(true);
    try {
      const eventSeg = sanitizeEventId(eventName);
      const activeId = selectedEventIdRef.current;
      const documentId = activeId || `${periodToken}_${eventSeg}_${Math.random().toString(36).substring(2, 8)}`;

      let totalPayout = 0;
      const workersMap: Record<string, { employeeName: string, payGiven: number }> = {};

      activeWorkers.forEach(w => {
        workersMap[w.employeeId] = {
          employeeName: w.employeeName,
          payGiven: w.payGiven,
        };
        totalPayout += w.payGiven;
      });

      let previousWorkerIds: string[] = [];
      if (activeId) {
        const prevSnap = await getDoc(doc(db, 'VakasiTambahan', activeId));
        if (prevSnap.exists()) {
          const prevData = prevSnap.data() as any;
          previousWorkerIds = Object.keys(prevData.eventWorkers || {});
        }
      }

      const allAffectedIds = Array.from(new Set([
        ...activeWorkers.map(w => w.employeeId),
        ...previousWorkerIds
      ]));

      const dbPeriod = `${year}_${String(month).padStart(2, '0')}`;
      const lockedNames: string[] = [];

      await Promise.all(
        allAffectedIds.map(async (empId) => {
          const slipDocId = `${dbPeriod}_${empId}`;
          const snap = await getDoc(doc(db, 'PayrollSlipStates', slipDocId));
          if (snap.exists() && snap.data()?.status === 'locked') {
            const wName = activeWorkers.find(w => w.employeeId === empId)?.employeeName || empId;
            lockedNames.push(wName);
          }
        })
      );

      if (lockedNames.length > 0) {
        isSavingRef.current = false;
        setSaving(false);
        setMessage({
          type: 'error',
          text: `Gagal menyimpan: Slip gaji untuk karyawan berikut telah terkunci. Harap buka kunci slip mereka di dashboard terlebih dahulu sebelum menyimpan event ini:\n- ${lockedNames.join('\n- ')}`
        });
        return;
      }

      const isSuperAdmin = profile?.role === 'super_admin';
      const finalSubmittedBy = activeId ? currentEventSubmittedBy : (profile?.uid || null);
      const finalSubmittedByName = activeId ? currentEventSubmittedByName : (profile?.displayName || null);
      const finalSubmittedByEmail = activeId ? currentEventSubmittedByEmail : (profile?.email || null);

      const payload: Record<string, any> = {
        eventName,
        period: periodToken,
        totalPayout,
        isEndOfMonth,
        departmentUnit: !isEndOfMonth ? selectedDept : null,
        eventWorkers: workersMap,
        updatedAt: serverTimestamp(),
        status: isSuperAdmin ? 'approved' : (currentEventStatus || 'draft'),
        submittedBy: finalSubmittedBy,
        submittedByName: finalSubmittedByName,
        submittedByEmail: finalSubmittedByEmail,
      };
      if (reportFileUrl) {
        payload.reportFileUrl = reportFileUrl;
        payload.reportFileName = reportFileName;
      }

      await setDoc(doc(db, 'VakasiTambahan', documentId), payload);
      
      const newStatus = isSuperAdmin ? 'approved' : (currentEventStatus || 'draft');
      if (newStatus === 'approved') {
        const updatedEventPayload = {
          id: documentId,
          eventName,
          status: 'approved',
          eventWorkers: workersMap
        };
        await Promise.all(
          allAffectedIds.map(empId => syncEmployeeVakasiPay(empId, periodToken, undefined, updatedEventPayload))
        );
      }

      setMessage({ type: 'success', text: `Event "${eventName}" berhasil disimpan.` });
      setAutosaveMessage('');
      setSelectedEventId(documentId);
      setCurrentEventStatus(newStatus);
      setCurrentEventSubmittedBy(finalSubmittedBy);
      setCurrentEventSubmittedByName(finalSubmittedByName);
      setCurrentEventSubmittedByEmail(finalSubmittedByEmail);
      setReportFile(null);
    } catch (err) {
      console.error(err);
      setMessage({ type: 'error', text: 'Gagal menyimpan Event Vakasi Tambahan.' });
    } finally {
      isSavingRef.current = false;
      setSaving(false);
    }
  };

  const handleDeleteEvent = async (eventId: string) => {
    void eventId;
    setMessage({
      type: 'error',
      text: 'Penghapusan event dinonaktifkan agar riwayat tetap utuh. Gunakan koreksi atau status pembatalan beralasan.',
    });
  };

  const handleAddRow = () => {
    setWorkerRows(prev => [...prev, { employeeId: '', employeeName: '', payGiven: 0, searchText: '', showDropdown: false }]);
  };

  const autosaveTimerRef = useRef<NodeJS.Timeout | null>(null);

  const triggerAutosave = (
    currentRows = workerRows,
    currentEventName = eventName,
    activeId = selectedEventIdRef.current,
    currentIsEndOfMonth = isEndOfMonth,
    currentDept = selectedDept,
    currentReportFileUrl = reportFileUrl,
    currentReportFileName = reportFileName
  ) => {
    if (autosaveTimerRef.current) {
      clearTimeout(autosaveTimerRef.current);
    }
    if (isSavingRef.current) return;
    autosaveTimerRef.current = setTimeout(() => {
      handleAutosave(currentRows, currentEventName, activeId, currentIsEndOfMonth, currentDept, currentReportFileUrl, currentReportFileName);
    }, 1000);
  };

  const handleAutosave = async (
    currentRows = workerRows,
    currentEventName = eventName,
    activeId = selectedEventIdRef.current,
    currentIsEndOfMonth = isEndOfMonth,
    currentDept = selectedDept,
    currentReportFileUrl = reportFileUrl,
    currentReportFileName = reportFileName
  ) => {
    if (isSavingRef.current) return;
    if (!currentEventName.trim()) return;
    const activeWorkers = currentRows.filter(w => w.employeeId);
    const ids = activeWorkers.map(w => w.employeeId);
    if (new Set(ids).size !== ids.length) {
      setAutosaveMessage('Belum tersimpan otomatis: ada pegawai yang ganda dalam daftar.');
      return;
    }

    setAutosaveMessage('Menyimpan otomatis...');
    try {
      const eventSeg = sanitizeEventId(currentEventName);
      const isNewDocument = !activeId;
      const documentId = activeId || `${periodToken}_${eventSeg}_${Math.random().toString(36).substring(2, 8)}`;

      // Claim the new document id synchronously (before the write resolves) so a
      // second autosave firing while this one is still in flight reuses the same
      // id instead of minting another random one for the same in-progress event.
      if (isNewDocument) {
        setSelectedEventId(documentId);
      }

      let totalPayout = 0;
      const workersMap: Record<string, { employeeName: string, payGiven: number }> = {};

      activeWorkers.forEach(w => {
        workersMap[w.employeeId] = {
          employeeName: w.employeeName,
          payGiven: w.payGiven,
        };
        totalPayout += w.payGiven;
      });

      const isSuperAdmin = profile?.role === 'super_admin';
      const finalSubmittedBy = activeId ? currentEventSubmittedBy : (profile?.uid || null);
      const finalSubmittedByName = activeId ? currentEventSubmittedByName : (profile?.displayName || null);
      const finalSubmittedByEmail = activeId ? currentEventSubmittedByEmail : (profile?.email || null);

      const payload: Record<string, any> = {
        eventName: currentEventName,
        period: periodToken,
        totalPayout,
        isEndOfMonth: currentIsEndOfMonth,
        departmentUnit: !currentIsEndOfMonth ? currentDept : null,
        eventWorkers: workersMap,
        updatedAt: serverTimestamp(),
        status: isSuperAdmin ? 'approved' : (currentEventStatus || 'draft'),
        submittedBy: finalSubmittedBy,
        submittedByName: finalSubmittedByName,
        submittedByEmail: finalSubmittedByEmail,
      };
      if (currentReportFileUrl) {
        payload.reportFileUrl = currentReportFileUrl;
        payload.reportFileName = currentReportFileName;
      }

      await setDoc(doc(db, 'VakasiTambahan', documentId), payload);
      if (isNewDocument) {
        setCurrentEventStatus(isSuperAdmin ? 'approved' : (currentEventStatus || 'draft'));
        setCurrentEventSubmittedBy(finalSubmittedBy);
        setCurrentEventSubmittedByName(finalSubmittedByName);
        setCurrentEventSubmittedByEmail(finalSubmittedByEmail);
      }
      const now = new Date();
      setAutosaveMessage(`Tersimpan otomatis pukul ${now.toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' })}`);
    } catch (err) {
      console.error('Autosave error:', err);
      setAutosaveMessage('Gagal menyimpan otomatis. Periksa koneksi Anda dan klik "Simpan Event".');
    }
  };

  const handlePrintLoyalisRecap = () => {
    const approvedEvents = (existingEvents || []).filter(evt => !evt.status || evt.status === 'approved');
    if (approvedEvents.length === 0) {
      alert('Tidak ada rincian kegiatan disetujui (accepted) ditemukan untuk periode ini.');
      return;
    }
    generateKegiatanLoyalisRecapPdf({
      period: MONTHS_ID[month - 1] + ' ' + year,
      existingEvents: approvedEvents,
      loyalisEmployees,
    });
  };

  const handleExportLoyalisRecapXlsx = () => {
    const approvedEvents = (existingEvents || []).filter(evt => !evt.status || evt.status === 'approved');
    if (approvedEvents.length === 0) {
      alert('Tidak ada rincian kegiatan disetujui (accepted) ditemukan untuk periode ini.');
      return;
    }
    generateKegiatanLoyalisRecapXlsx({
      period: MONTHS_ID[month - 1] + ' ' + year,
      existingEvents: approvedEvents,
      loyalisEmployees,
    });
  };

  const getStatusBadge = (status?: string) => {
    const currentStatus = status || 'approved';
    switch (currentStatus) {
      case 'draft':
        return <span className="text-[10px] font-bold px-2 py-0.5 rounded border bg-slate-50 text-slate-600 border-slate-200">Draft</span>;
      case 'pending_review':
        return <span className="text-[10px] font-bold px-2 py-0.5 rounded border bg-amber-50 text-amber-700 border-amber-200 animate-pulse">Menunggu Review</span>;
      case 'approved':
        return <span className="text-[10px] font-bold px-2 py-0.5 rounded border bg-emerald-50 text-emerald-700 border-emerald-200">Disetujui</span>;
      case 'revision_needed':
        return <span className="text-[10px] font-bold px-2 py-0.5 rounded border bg-orange-50 text-orange-700 border-orange-200">Perlu Revisi</span>;
      case 'declined':
        return <span className="text-[10px] font-bold px-2 py-0.5 rounded border bg-rose-50 text-rose-700 border-rose-200">Ditolak</span>;
      default:
        return null;
    }
  };

  const getCardBgClass = (status?: string, active?: boolean) => {
    const currentStatus = status || 'approved';
    if (active) {
      switch (currentStatus) {
        case 'approved': return 'bg-emerald-50/70 border-emerald-300 shadow-sm ring-1 ring-emerald-300/20';
        case 'pending_review': return 'bg-amber-50/70 border-amber-300 shadow-sm ring-1 ring-amber-300/20';
        case 'declined': return 'bg-rose-50/70 border-rose-300 shadow-sm ring-1 ring-rose-300/20';
        case 'revision_needed': return 'bg-orange-50/70 border-orange-300 shadow-sm ring-1 ring-orange-300/20';
        case 'draft':
        default: return 'bg-indigo-50/50 border-indigo-300 shadow-sm ring-1 ring-indigo-300/20';
      }
    } else {
      switch (currentStatus) {
        case 'approved': return 'bg-emerald-50/30 border-emerald-100 hover:border-emerald-200';
        case 'pending_review': return 'bg-amber-50/30 border-amber-100 hover:border-amber-200';
        case 'declined': return 'bg-rose-50/30 border-rose-100 hover:border-rose-200';
        case 'revision_needed': return 'bg-orange-50/30 border-orange-100 hover:border-orange-200';
        case 'draft':
        default: return 'bg-white border-slate-100 hover:border-indigo-100';
      }
    }
  };

  const isReadOnly = profile?.role === 'satker_head_loyalis' &&
    (currentEventStatus === 'approved' || currentEventStatus === 'declined' || currentEventStatus === 'pending_review');

  const fmtRp = (n: number) =>
    'Rp\u00a0' + Math.round(n).toLocaleString('id-ID');

  const formatCurrencyInput = (num: number): string => {
    if (num === 0) return '';
    const formatted = Math.round(num).toLocaleString('id-ID');
    return `Rp. ${formatted}`;
  };

  return (
    <div className="space-y-6">
      {/* Action panel */}
      <div className="flex flex-wrap items-center justify-between gap-4 bg-white p-4 rounded-[20px] border border-slate-200/60 shadow-sm">
        <div className="flex bg-slate-50 p-1 rounded-xl w-fit border border-slate-200/40">
          <Select value={filterDept} onValueChange={(v) => setFilterDept(v || '')}>
            <SelectTrigger className="w-56 bg-white shadow-sm border-slate-200 rounded-lg font-semibold hover:border-indigo-300 transition-all h-9 text-xs">
              <SelectValue placeholder="Semua Unit Kerja" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="">Semua Unit Kerja</SelectItem>
              {departments.map(d => (
                <SelectItem key={d} value={d}>{d}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button
            onClick={() => setCetakKegiatanDialogOpen(true)}
            variant="outline"
            className="rounded-xl border-indigo-200 text-indigo-700 bg-indigo-50 hover:bg-indigo-100 hover:border-indigo-300 transition-all font-semibold flex items-center gap-2 shadow-sm cursor-pointer text-xs h-9"
          >
            <FileText className="w-4 h-4 text-indigo-600" />
            Laporan Kegiatan Loyalis
          </Button>
          <Button
            onClick={handlePrintLoyalisRecap}
            variant="outline"
            className="rounded-xl border-slate-200 text-slate-700 bg-slate-50 hover:bg-slate-100 hover:border-slate-300 transition-all font-semibold flex items-center gap-2 shadow-sm cursor-pointer text-xs h-9"
          >
            <FileText className="w-4 h-4 text-indigo-500" />
            Rekap Kegiatan (PDF)
          </Button>
          <Button
            onClick={handleExportLoyalisRecapXlsx}
            variant="outline"
            className="rounded-xl border-emerald-200 text-emerald-700 bg-emerald-50 hover:bg-emerald-100 hover:border-emerald-300 transition-all font-semibold flex items-center gap-2 shadow-sm cursor-pointer text-xs h-9"
          >
            <FileSpreadsheet className="w-4 h-4 text-emerald-600" />
            Rekap Kegiatan (Excel)
          </Button>
        </div>
      </div>

      {message && (
        <div className={`mb-4 flex items-center gap-2 px-4 py-3 rounded-xl text-sm font-medium ${message.type === 'success' ? 'bg-emerald-50 text-emerald-700 border border-emerald-200' : 'bg-red-50 text-red-700 border border-red-200'}`}>
          {message.type === 'success' ? <CheckCircle2 className="w-4 h-4" /> : <AlertCircle className="w-4 h-4" />}
          <div className="whitespace-pre-line">{message.text}</div>
        </div>
      )}

      <div className="grid grid-cols-1 xl:grid-cols-12 gap-8 items-start">
        {/* Left side list of existing events */}
        <div className="xl:col-span-4 space-y-6">
          <Card className="bg-white rounded-[20px] shadow-[0_8px_30px_rgb(0,0,0,0.04)] border-none p-6">
            <div className="flex justify-between items-center mb-4">
              <h3 className="font-bold text-slate-800 text-sm">Daftar Kegiatan Loyalis</h3>
              {(!isReadOnly || profile?.role === 'super_admin') && (
                <Button
                  onClick={() => {
                    setSelectedEventId(null);
                    setEventName('');
                    setIsEndOfMonth(false);
                    setSelectedDept('');
                    setWorkerRows([{ employeeId: '', employeeName: '', payGiven: 0, searchText: '', showDropdown: false }]);
                    setReportFile(null);
                    setReportFileUrl(null);
                    setReportFileName(null);
                    setCurrentEventStatus(null);
                    setCurrentEventReviewNote(null);
                    setCurrentEventSubmittedBy(null);
                    setCurrentEventSubmittedByName(null);
                    setCurrentEventSubmittedByEmail(null);
                    setAutosaveMessage('');
                  }}
                  size="sm"
                  className="bg-indigo-50 text-indigo-600 hover:bg-indigo-100 rounded-xl font-bold flex items-center gap-1.5"
                >
                  <Plus className="w-4.5 h-4.5" /> Baru
                </Button>
              )}
            </div>

            {loadingEvents ? (
              <div className="py-12 flex justify-center items-center text-slate-400 text-xs">
                <Loader2 className="w-4 h-4 animate-spin mr-2" /> Memuat daftar kegiatan...
              </div>
            ) : filteredEvents.length === 0 ? (
              <div className="py-12 text-center text-slate-400 text-xs">Belum ada kegiatan untuk unit terpilih periode ini.</div>
            ) : (
              <div className="space-y-3 max-h-[500px] overflow-y-auto pr-1">
                {filteredEvents.map(evt => {
                  const isActive = selectedEventId === evt.id;
                  const wCount = Object.keys(evt.eventWorkers || {}).length;
                  return (
                    <div
                      key={evt.id}
                      onClick={() => {
                        setSelectedEventId(evt.id);
                        setEventName(evt.eventName);
                        setIsEndOfMonth(!!evt.isEndOfMonth);
                        setSelectedDept(evt.departmentUnit || '');
                        setCurrentEventStatus(evt.status || null);
                        setCurrentEventReviewNote(evt.reviewNote || null);
                        setCurrentEventSubmittedBy(evt.submittedBy || null);
                        setCurrentEventSubmittedByName(evt.submittedByName || null);
                        setCurrentEventSubmittedByEmail(evt.submittedByEmail || null);
                        setReportFileUrl(evt.reportFileUrl || null);
                        setReportFileName(evt.reportFileName || null);
                        setAutosaveMessage('');

                        const rows = Object.entries(evt.eventWorkers || {}).map(([id, w]: [string, any]) => ({
                          employeeId: id,
                          employeeName: w.employeeName || '',
                          payGiven: w.payGiven || 0,
                          searchText: w.employeeName || '',
                          showDropdown: false,
                        }));
                        setWorkerRows(rows.length > 0 ? rows : [{ employeeId: '', employeeName: '', payGiven: 0, searchText: '', showDropdown: false }]);
                      }}
                      className={`p-4 rounded-xl border transition-all duration-200 cursor-pointer ${getCardBgClass(evt.status, isActive)}`}
                    >
                      <div className="flex justify-between items-start gap-2">
                        <div className="font-bold text-slate-800 text-xs line-clamp-1">{evt.eventName}</div>
                        {getStatusBadge(evt.status)}
                      </div>
                      <div className="flex items-center justify-between mt-3 text-[10px] text-slate-400 font-medium">
                        <span className="bg-slate-100 px-2 py-0.5 rounded text-slate-600 font-bold uppercase tracking-wider">{evt.departmentUnit || 'UMUM'}</span>
                        <span>{wCount} Pegawai · {fmtRp(evt.totalPayout || 0)}</span>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </Card>
        </div>

        {/* Right side form */}
        <div className="xl:col-span-8">
          <Card className="bg-white rounded-[20px] shadow-[0_8px_30px_rgb(0,0,0,0.04)] border-none p-6 space-y-6">
            <div className="flex justify-between items-center pb-4 border-b border-slate-100">
              <div>
                <h3 className="font-bold text-slate-800 text-sm">
                  {selectedEventId ? 'Ubah Rincian Kegiatan' : 'Buat Rincian Kegiatan Baru'}
                </h3>
                {!isReadOnly && autosaveMessage && (
                  <p className={`text-[10px] font-medium mt-0.5 ${autosaveMessage.startsWith('Gagal') || autosaveMessage.startsWith('Belum') ? 'text-rose-500' : 'text-slate-400'}`}>
                    {autosaveMessage}
                  </p>
                )}
              </div>
              {selectedEventId && (
                <div className="flex items-center gap-2">
                  {getStatusBadge(currentEventStatus || undefined)}
                  {currentEventSubmittedByName && (
                    <span className="text-[10px] text-slate-400 font-medium">
                      Oleh: {currentEventSubmittedByName}
                    </span>
                  )}
                </div>
              )}
            </div>

            {currentEventStatus === 'revision_needed' && currentEventReviewNote && (
              <div className="p-4 bg-orange-50 border border-orange-200 rounded-2xl flex gap-3 text-orange-900 text-xs">
                <AlertTriangle className="w-5 h-5 text-orange-500 shrink-0 mt-0.5" />
                <div>
                  <p className="font-bold text-orange-800 text-sm mb-1">Catatan Revisi dari Admin</p>
                  <p className="leading-relaxed font-semibold">{currentEventReviewNote}</p>
                </div>
              </div>
            )}

            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div className="space-y-1.5">
                <label className="text-xs font-bold text-slate-500 uppercase tracking-wider block">Nama Kegiatan</label>
                <Input
                  type="text"
                  placeholder="Contoh: Panitia PMB 2026 Gel 1"
                  value={eventName}
                  disabled={isReadOnly}
                  onChange={(e) => {
                    setEventName(e.target.value);
                    triggerAutosave(workerRows, e.target.value, selectedEventIdRef.current, isEndOfMonth, selectedDept);
                  }}
                  className="rounded-xl border-slate-200 font-semibold text-slate-800 text-sm focus:border-indigo-500 focus:ring-4 focus:ring-indigo-100 h-10"
                />
              </div>

              <div className="space-y-1.5">
                <label className="text-xs font-bold text-slate-500 uppercase tracking-wider block">Unit Kerja Pelaksana</label>
                <Select
                  value={selectedDept}
                  disabled={isReadOnly || isEndOfMonth}
                  onValueChange={(v) => {
                    setSelectedDept(v || '');
                    triggerAutosave(workerRows, eventName, selectedEventIdRef.current, isEndOfMonth, v || '');
                  }}
                >
                  <SelectTrigger className="w-full bg-white border-slate-200 rounded-xl font-semibold hover:border-indigo-300 transition-all text-xs h-10">
                    <SelectValue placeholder="Pilih Unit Kerja" />
                  </SelectTrigger>
                  <SelectContent>
                    {departments.map(d => (
                      <SelectItem key={d} value={d}>{d}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            {/* Total Summary Card */}
            <div className="bg-gradient-to-r from-indigo-50/60 to-purple-50/40 rounded-[20px] border border-indigo-100/40 p-4 shadow-sm flex flex-col sm:flex-row sm:items-center justify-between gap-4">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-indigo-500 text-white flex items-center justify-center shadow-md shadow-indigo-100">
                  <Banknote className="w-5 h-5" />
                </div>
                <div>
                  <span className="text-[9px] font-bold uppercase tracking-wider text-slate-400">Total Nominal Vakasi</span>
                  <h3 className="text-xl font-black text-slate-800 tracking-tight mt-0.5">
                    {fmtRp(workerRows.reduce((sum, r) => sum + (r.payGiven || 0), 0))}
                  </h3>
                </div>
              </div>
              
              <div className="hidden sm:block h-8 w-px bg-slate-200/80" />

              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-purple-500 text-white flex items-center justify-center shadow-md shadow-purple-100">
                  <Users className="w-5 h-5" />
                </div>
                <div>
                  <span className="text-[9px] font-bold uppercase tracking-wider text-slate-400">Total Penerima</span>
                  <h3 className="text-xl font-black text-slate-800 tracking-tight mt-0.5">
                    {workerRows.filter(r => r.employeeId).length} <span className="text-xs font-semibold text-slate-500 font-sans tracking-normal">Pegawai</span>
                  </h3>
                </div>
              </div>
            </div>

            {/* List of Workers */}
            <div className="space-y-4 pt-2">
              <h4 className="font-bold text-slate-700 text-xs uppercase tracking-wider">Daftar Penerima Vakasi</h4>
              <div className="border border-slate-100 rounded-[20px] bg-slate-50/50 p-4 space-y-3">
                {workerRows.map((row, idx) => (
                  <div key={idx} className="flex flex-col md:flex-row md:items-center gap-3">
                    <div className="flex-1 relative">
                      <Input
                        id={`search-input-${idx}`}
                        type="text"
                        placeholder="Cari Pegawai..."
                        value={row.searchText}
                        disabled={isReadOnly}
                        autoComplete="new-password"
                        onChange={(e) => {
                          const val = e.target.value;
                          setWorkerRows(prev => {
                            const updated = [...prev];
                            updated[idx].searchText = val;
                            updated[idx].showDropdown = true;
                            return updated;
                          });
                        }}
                        onFocus={() => {
                          setWorkerRows(prev => {
                            const updated = [...prev];
                            updated[idx].showDropdown = true;
                            return updated;
                          });
                        }}
                        onBlur={() => {
                          setTimeout(() => {
                            setWorkerRows(prev => {
                              const updated = [...prev];
                              updated[idx].showDropdown = false;
                              return updated;
                            });
                          }, 200);
                        }}
                        className="rounded-xl border-slate-200 font-semibold text-slate-800 text-xs h-9 bg-white"
                      />
                      {row.showDropdown && (
                        <div className="absolute left-0 right-0 top-10 max-h-40 overflow-y-auto bg-white border border-slate-100 rounded-xl shadow-2xl z-50 divide-y divide-slate-50">
                          {(() => {
                            const search = (row.searchText || '').toLowerCase();
                            const takenIds = new Set(
                              workerRows
                                .filter((r, rIdx) => rIdx !== idx && r.employeeId)
                                .map(r => r.employeeId)
                            );
                            const filtered = loyalisEmployees.filter(emp =>
                              emp.name.toLowerCase().includes(search) && !takenIds.has(emp.id)
                            );
                            if (filtered.length === 0) return <div className="p-3 text-[10px] text-slate-400">Pegawai tidak ditemukan atau sudah ditambahkan pada baris lain</div>;
                            return filtered.map(emp => (
                              <button
                                key={emp.id}
                                type="button"
                                onClick={() => {
                                  setWorkerRows(prev => {
                                    const updated = [...prev];
                                    updated[idx].employeeId = emp.id;
                                    updated[idx].employeeName = emp.name;
                                    updated[idx].searchText = emp.name;
                                    updated[idx].showDropdown = false;
                                    return updated;
                                  });
                                  triggerAutosave(
                                    workerRows.map((r, rIdx) => rIdx === idx ? { ...r, employeeId: emp.id, employeeName: emp.name } : r),
                                    eventName,
                                    selectedEventIdRef.current,
                                    isEndOfMonth,
                                    selectedDept
                                  );
                                }}
                                className="w-full text-left px-4 py-2 hover:bg-slate-50 text-[11px] font-semibold text-slate-700 flex justify-between"
                              >
                                <span>{emp.name}</span>
                                <span className="text-[9px] text-slate-400 font-normal uppercase">{emp.role} · {emp.department}</span>
                              </button>
                            ));
                          })()}
                        </div>
                      )}
                    </div>
                    <div className="w-full md:w-48">
                      <Input
                        type="text"
                        inputMode="numeric"
                        pattern="[0-9]*"
                        placeholder="Rupiah (Contoh: 100000)"
                        value={formatCurrencyInput(row.payGiven)}
                        disabled={isReadOnly}
                        onChange={(e) => {
                          const val = parseInt(e.target.value.replace(/\D/g, ''), 10) || 0;
                          setWorkerRows(prev => {
                            const updated = [...prev];
                            updated[idx].payGiven = val;
                            return updated;
                          });
                          triggerAutosave(
                            workerRows.map((r, rIdx) => rIdx === idx ? { ...r, payGiven: val } : r),
                            eventName,
                            selectedEventIdRef.current,
                            isEndOfMonth,
                            selectedDept
                          );
                        }}
                        className="rounded-xl border-slate-200 font-bold text-slate-800 text-xs h-9 bg-white text-right"
                      />
                    </div>
                    {(!isReadOnly || profile?.role === 'super_admin') && (
                      <Button
                        type="button"
                        variant="ghost"
                        onClick={() => {
                          const nextRows = workerRows.filter((_, i) => i !== idx);
                          setWorkerRows(nextRows.length > 0 ? nextRows : [{ employeeId: '', employeeName: '', payGiven: 0, searchText: '', showDropdown: false }]);
                          triggerAutosave(nextRows, eventName, selectedEventIdRef.current, isEndOfMonth, selectedDept);
                        }}
                        className="text-red-500 hover:text-red-700 hover:bg-red-50 rounded-xl h-9 w-9 shrink-0 flex items-center justify-center p-0"
                      >
                        <Trash2 className="w-4 h-4" />
                      </Button>
                    )}
                  </div>
                ))}
                {(!isReadOnly || profile?.role === 'super_admin') && (
                  <Button
                    type="button"
                    onClick={handleAddRow}
                    variant="outline"
                    className="w-full rounded-xl border-slate-200 text-slate-500 hover:bg-slate-100 text-xs font-semibold h-9 flex items-center justify-center gap-1.5"
                  >
                    <Plus className="w-4.5 h-4.5 text-indigo-500" /> Tambah Pegawai
                  </Button>
                )}
              </div>
            </div>

            {/* Signed report upload section for Satker Loyalis */}
            {profile?.role === 'satker_head_loyalis' && selectedEventId && (
              <div className="border border-slate-100 rounded-[20px] overflow-hidden bg-slate-50/50 p-4 space-y-3">
                <h4 className="font-bold text-slate-700 text-xs uppercase tracking-wider">Unggah Laporan Bertandatangan</h4>
                <p className="text-[10px] text-slate-400">Silakan cetak laporan, minta tanda tangan pimpinan, lalu pindai/foto dan unggah file PDF/JPG/PNG ke sini sebelum mengajukan review.</p>
                <div className="flex flex-col md:flex-row items-center gap-4">
                  <div className="flex-1 w-full">
                    {uploadingReport ? (
                      <div className="flex items-center gap-2 text-xs text-indigo-600 font-semibold py-2">
                        <Loader2 className="w-4 h-4 animate-spin" /> Mengunggah berkas...
                      </div>
                    ) : reportFileUrl ? (
                      <div className="flex items-center justify-between bg-white border border-slate-150 p-2.5 rounded-xl">
                        <div className="flex items-center gap-2 text-xs font-semibold text-slate-700 truncate max-w-[250px]">
                          <FileText className="w-4 h-4 text-indigo-500 flex-shrink-0" />
                          <span className="truncate">{reportFileName || 'File Unggahan'}</span>
                        </div>
                        <div className="flex gap-1.5">
                          <Button size="icon" variant="ghost" onClick={() => setLightboxUrl(reportFileUrl)} className="h-7 w-7 rounded-lg text-indigo-600"><Eye className="w-4 h-4" /></Button>
                          {!isReadOnly && (
                            <Button
                              size="icon"
                              variant="ghost"
                              onClick={() => {
                                setReportFileUrl(null);
                                setReportFileName(null);
                                triggerAutosave(workerRows, eventName, selectedEventIdRef.current, isEndOfMonth, selectedDept, null, null);
                              }}
                              className="h-7 w-7 rounded-lg text-red-500"
                            ><Trash2 className="w-4 h-4" /></Button>
                          )}
                        </div>
                      </div>
                    ) : (
                      <div className="relative border-2 border-dashed border-slate-200 hover:border-indigo-300 rounded-xl p-6 text-center bg-white cursor-pointer transition-colors" onClick={() => document.getElementById('report-upload-input')?.click()}>
                        <Upload className="w-6 h-6 text-slate-400 mx-auto mb-1" />
                        <span className="text-[11px] font-bold text-slate-500">Pilih Berkas Laporan</span>
                        <input id="report-upload-input" type="file" className="hidden" accept=".pdf,image/*" onChange={(e) => e.target.files?.[0] && handleReportFileChange(e.target.files[0])} />
                      </div>
                    )}
                  </div>
                </div>
              </div>
            )}

            {/* View Uploaded File for Admin / Reviewer */}
            {profile?.role !== 'satker_head_loyalis' && reportFileUrl && (
              <div className="border border-slate-100 rounded-[20px] overflow-hidden bg-slate-50/50 p-4 space-y-3">
                <h4 className="font-bold text-slate-700 text-xs uppercase tracking-wider">Berkas Laporan Pertanggungjawaban</h4>
                <div className="flex items-center justify-between bg-white border border-slate-150 p-2.5 rounded-xl max-w-md">
                  <div className="flex items-center gap-2 text-xs font-semibold text-slate-700 truncate">
                    <FileText className="w-4 h-4 text-indigo-500" />
                    <span className="truncate">{reportFileName || 'Lihat berkas pertanggungjawaban...'}</span>
                  </div>
                  <Button size="icon" variant="ghost" onClick={() => setLightboxUrl(reportFileUrl)} className="h-7 w-7 rounded-lg text-indigo-600"><Eye className="w-4 h-4" /></Button>
                </div>
              </div>
            )}

            {/* Submitter Info Card */}
            {selectedEventId && (
              <div className="text-[10px] text-slate-400 bg-slate-50 p-3.5 rounded-xl space-y-1">
                {currentEventSubmittedByName && <div><strong>Dibuat oleh:</strong> {currentEventSubmittedByName} ({currentEventSubmittedByEmail || 'No Email'})</div>}
                {currentEventStatus === 'approved' && <div><strong>Status:</strong> Disetujui (Sinkron ke slip gaji berjalan)</div>}
                {currentEventStatus === 'revision_needed' && <div><strong>Status:</strong> Perlu Revisi</div>}
              </div>
            )}

            {/* Footer Buttons */}
            <div className="flex justify-end items-center gap-3 pt-4 border-t border-slate-100">
              {selectedEventId && (!isReadOnly || profile?.role === 'super_admin') && (
                <Button
                  onClick={() => handleDeleteEvent(selectedEventId)}
                  variant="ghost"
                  className="rounded-xl text-rose-500 hover:text-rose-700 hover:bg-rose-50 font-bold px-5 text-xs h-10 flex items-center gap-1.5"
                >
                  <Trash2 className="w-4 h-4" /> Hapus
                </Button>
              )}

              {/* Submit for Review (Satker Loyalis only) */}
              {profile?.role === 'satker_head_loyalis' && (
                <Button
                  onClick={handleSubmitForReview}
                  disabled={saving || isReadOnly || !reportFileUrl}
                  className="rounded-xl px-6 bg-indigo-600 hover:bg-indigo-700 text-white font-bold shadow-lg shadow-indigo-100 transition-all flex items-center gap-2 h-10 text-xs cursor-pointer"
                >
                  {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
                  Submit ke Admin
                </Button>
              )}

              {/* Save Event (Admin or editable states) */}
              {(!isReadOnly || profile?.role === 'super_admin') && (
                <Button
                  onClick={handleSaveEvent}
                  disabled={saving}
                  className="rounded-xl px-6 bg-emerald-600 hover:bg-emerald-700 text-white font-bold shadow-lg shadow-emerald-100 transition-all flex items-center gap-2 h-10 text-xs cursor-pointer"
                >
                  {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <ShieldCheck className="w-4 h-4" />}
                  Simpan Event
                </Button>
              )}

              {/* Super Admin Action Box */}
              {profile?.role === 'super_admin' && selectedEventId && currentEventStatus === 'pending_review' && (
                <div className="flex gap-2">
                  <Button
                    onClick={() => { setReviewAction('approved'); handleReviewEvent(selectedEventId, 'approved', ''); }}
                    disabled={saving}
                    className="rounded-xl px-5 bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xs h-10 flex items-center gap-1.5 shadow-md"
                  >
                    <CheckCircle className="w-4 h-4" /> Setujui
                  </Button>
                  <Button
                    onClick={() => { setReviewAction('revision_needed'); setReviewingEventId(selectedEventId); setReviewNote(''); setShowReviewDialog(true); }}
                    disabled={saving}
                    className="rounded-xl px-5 bg-orange-500 hover:bg-orange-600 text-white font-bold text-xs h-10 flex items-center gap-1.5 shadow-md"
                  >
                    <RotateCcw className="w-4 h-4" /> Minta Revisi
                  </Button>
                  <Button
                    onClick={() => { setReviewAction('declined'); setReviewingEventId(selectedEventId); setReviewNote(''); setShowReviewDialog(true); }}
                    disabled={saving}
                    className="rounded-xl px-5 bg-rose-600 hover:bg-rose-700 text-white font-bold text-xs h-10 flex items-center gap-1.5 shadow-md"
                  >
                    <XCircle className="w-4 h-4" /> Tolak
                  </Button>
                </div>
              )}

              {/* Cancel Approval (Super Admin only) */}
              {profile?.role === 'super_admin' && selectedEventId && currentEventStatus === 'approved' && (
                <Button
                  onClick={() => handleUnverifyEvent(selectedEventId)}
                  disabled={saving}
                  className="rounded-xl px-5 bg-orange-500 hover:bg-orange-600 text-white font-bold text-xs h-10 flex items-center gap-1.5 shadow-md cursor-pointer"
                >
                  <RotateCcw className="w-4 h-4" /> Batalkan Persetujuan
                </Button>
              )}
            </div>
          </Card>
        </div>
      </div>

      {cetakKegiatanDialogOpen && (
        <CetakKegiatanLoyalisDialog
          open={cetakKegiatanDialogOpen}
          onOpenChange={setCetakKegiatanDialogOpen}
          periodName={`${MONTHS_ID[month - 1]} ${year}`}
          existingEvents={existingEvents}
          departments={departments}
          loyalisEmployees={loyalisEmployees}
        />
      )}

      {/* Review Dialog */}
      <Dialog open={showReviewDialog} onOpenChange={setShowReviewDialog}>
        <DialogContent className="sm:max-w-md max-w-full overflow-hidden flex flex-col p-0 border-none bg-white shadow-2xl rounded-3xl animate-in fade-in duration-300">
          <DialogHeader className="p-6 pb-4 bg-gradient-to-r from-orange-50/80 to-rose-50/60 border-b border-slate-100 shrink-0">
            <DialogTitle className="text-slate-800 flex items-center gap-3 font-bold text-lg">
              {reviewAction === 'revision_needed' ? (
                <>
                  <AlertCircle className="w-5 h-5 text-orange-500" /> Minta Revisi Kegiatan
                </>
              ) : (
                <>
                  <XCircle className="w-5 h-5 text-rose-500" /> Tolak Kegiatan
                </>
              )}
            </DialogTitle>
            <p className="text-slate-500 text-xs mt-1">Berikan alasan mengapa kegiatan ini memerlukan revisi atau ditolak. Catatan ini akan ditampilkan kepada Kepala SatKer.</p>
          </DialogHeader>
          <div className="p-6 space-y-4 bg-white">
            <div className="space-y-1.5">
              <label className="text-xs font-bold text-slate-500 uppercase tracking-wider block">Alasan/Catatan</label>
              <textarea
                placeholder="Contoh: Lampiran berkas kurang jelas, mohon upload ulang..."
                value={reviewNote}
                onChange={(e) => setReviewNote(e.target.value)}
                className="w-full rounded-xl border border-slate-200 p-3 font-semibold text-slate-800 text-sm focus:border-indigo-500 focus:ring-4 focus:ring-indigo-100 h-28 resize-none focus:outline-none"
              />
            </div>
          </div>
          <div className="p-5 bg-slate-50 border-t border-slate-100 flex justify-end gap-2.5 shrink-0 rounded-b-3xl">
            <Button variant="ghost" onClick={() => { setShowReviewDialog(false); setReviewNote(''); }} className="rounded-xl text-slate-500 hover:bg-slate-100">Batal</Button>
            <Button
              onClick={() => {
                if (reviewingEventId) {
                  handleReviewEvent(reviewingEventId, reviewAction, reviewNote);
                }
              }}
              disabled={saving || !reviewNote.trim()}
              className={`rounded-xl px-6 text-white font-bold shadow-lg transition-all flex items-center gap-2 cursor-pointer ${reviewAction === 'revision_needed' ? 'bg-orange-500 hover:bg-orange-600' : 'bg-rose-600 hover:bg-rose-700'}`}
            >
              {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle className="w-4 h-4" />}
              Konfirmasi
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Image / PDF Lightbox Viewer */}
      {lightboxUrl && (() => {
        const isPdf = Boolean(
          reportFileName?.toLowerCase().endsWith('.pdf') ||
          lightboxUrl.toLowerCase().includes('.pdf') ||
          lightboxUrl.toLowerCase().includes('application/pdf')
        );

        return (
          <div
            className="fixed inset-0 bg-slate-900/80 backdrop-blur-md z-[9999] flex flex-col items-center justify-center p-4 sm:p-6"
            onClick={() => setLightboxUrl(null)}
          >
            <div
              className="relative max-w-5xl w-full h-[88vh] flex flex-col bg-slate-900/95 p-4 rounded-3xl border border-white/10 shadow-2xl overflow-hidden"
              onClick={e => e.stopPropagation()}
            >
              {/* Header Bar */}
              <div className="flex items-center justify-between w-full pb-3 mb-3 border-b border-white/10 px-2 shrink-0">
                <div className="flex items-center gap-2.5 min-w-0 pr-4">
                  <FileText className="w-5 h-5 text-indigo-400 shrink-0" />
                  <span className="text-white font-semibold text-xs sm:text-sm truncate">
                    {reportFileName || 'Berkas Laporan Pertanggungjawaban'}
                  </span>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <a
                    href={lightboxUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold transition-all shadow-md"
                  >
                    <ExternalLink className="w-3.5 h-3.5" />
                    <span className="hidden sm:inline">Buka di Tab Baru</span>
                    <span className="sm:hidden">Buka</span>
                  </a>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    onClick={() => setLightboxUrl(null)}
                    className="text-slate-400 hover:text-white hover:bg-white/10 rounded-full h-8 w-8 transition-colors"
                  >
                    <X className="w-5 h-5" />
                  </Button>
                </div>
              </div>

              {/* Content Area */}
              <div className="w-full flex-1 flex items-center justify-center overflow-hidden rounded-2xl bg-slate-950/60 relative">
                {isPdf ? (
                  <iframe
                    src={lightboxUrl}
                    className="w-full h-full rounded-2xl border-none bg-white"
                    title={reportFileName || 'File LPJ PDF'}
                  />
                ) : (
                  <img
                    src={lightboxUrl}
                    alt={reportFileName || 'File LPJ'}
                    className="max-w-full max-h-full rounded-2xl object-contain shadow-2xl"
                  />
                )}
              </div>
            </div>
          </div>
        );
      })()}
    </div>
  );
}
