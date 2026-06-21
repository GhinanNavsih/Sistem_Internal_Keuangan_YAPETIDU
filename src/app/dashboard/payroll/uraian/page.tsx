"use client"

import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import {
  Card,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@/components/ui/select';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  ArrowLeft, Upload, ScanLine, Loader2, CheckCircle2,
  FileText, AlertCircle, ImageIcon, Trash2, Eye, RotateCw, Sparkles, X,
  Crop, Building2, Code2, Database, ShieldCheck, Hash, Banknote, LogOut,
  FileDown, Plus, Calendar, ClipboardCheck, FileSpreadsheet, Send, Clock, XCircle, RotateCcw, Save,
} from 'lucide-react';
import { useAuth } from '@/lib/AuthContext';
import {
  collection, getDocs, doc, setDoc, getDoc, serverTimestamp, query, where, deleteDoc, onSnapshot
} from 'firebase/firestore';
import { db, storage } from '@/lib/firebase';
import { ref, uploadBytes, getDownloadURL } from 'firebase/storage';
import * as XLSX from 'xlsx';
import { normalizeName, MANUAL_OVERRIDES } from '@/utils/payrollLogic';
import {
  REKAP_COLUMNS, SUPPORTED_CATEGORIES, MONTHS_ID,
} from '@/utils/rekapConfig';
import {
  renderFileToCanvas, runOcr, parseRekapRows, matchEmployee, cropCanvas,
} from '@/utils/ocrParser';
import type {
  BlueCollarEmployee, UraianEntry, UraianGajiDocument, RekapColumn
} from '@/types';
import {
  generateRekapPresensiKebersihanyPdf,
  type KebersihanyEmployee,
} from '@/utils/generateRekapPresensiKebersihan';
import CetakKegiatanLoyalisDialog from '@/components/CetakKegiatanLoyalisDialog';

const YEARS = Array.from({ length: 5 }, (_, i) => new Date().getFullYear() - i);

export default function UraianPage() {
  const router = useRouter();
  const { profile, logout } = useAuth();

  // ── Filters & UI State ────────────────────────────────────────────────────
  const [month, setMonth] = useState(new Date().getMonth() + 1);
  const [year, setYear] = useState(new Date().getFullYear());

  useEffect(() => {
    if (typeof window !== 'undefined') {
      const params = new URLSearchParams(window.location.search);
      const queryMonth = params.get('month');
      const queryYear = params.get('year');
      if (queryMonth) {
        const parsedM = parseInt(queryMonth, 10);
        if (!isNaN(parsedM) && parsedM >= 1 && parsedM <= 12) {
          setMonth(parsedM);
        }
      }
      if (queryYear) {
        const parsedY = parseInt(queryYear, 10);
        if (!isNaN(parsedY) && parsedY >= 2000 && parsedY <= 2100) {
          setYear(parsedY);
        }
      }
    }
  }, []);
  const [category, setCategory] = useState<string>("");
  const [dynamicCategories, setDynamicCategories] = useState<string[]>(SUPPORTED_CATEGORIES);

  // Expose permitted categories only for SatKer Heads
  const allowedCategories = useMemo(() => {
    if (!profile) return [];
    if (profile.role === 'super_admin') return dynamicCategories;
    return dynamicCategories.filter(cat => profile.permittedCategories?.includes(cat));
  }, [profile, dynamicCategories]);

  // Set initial category to the first permitted one
  useEffect(() => {
    if (allowedCategories.length > 0 && (!category || !allowedCategories.includes(category))) {
      setCategory(allowedCategories[0]);
    }
  }, [allowedCategories, category]);

  // ── Tab State ──
  const [activeTab, setActiveTab] = useState<'presensi' | 'vakasi_loyalis' | 'kegiatan_spj'>('vakasi_loyalis');

  useEffect(() => {
    if (profile) {
      if (profile.role === 'satker_head_loyalis' && activeTab !== 'vakasi_loyalis') {
        setActiveTab('vakasi_loyalis');
      } else if (profile.role !== 'super_admin' && profile.role !== 'satker_head_loyalis' && activeTab === 'vakasi_loyalis') {
        setActiveTab('presensi');
      }
    }
  }, [profile, activeTab]);

  // Force isEndOfMonth to false for SatKer Loyalis
  useEffect(() => {
    if (profile?.role === 'satker_head_loyalis') {
      setIsEndOfMonth(false);
    }
  }, [profile]);

  useEffect(() => {
    const handlePopState = (event: PopStateEvent) => {
      if (activeTab === 'kegiatan_spj') {
        const fromTab = event.state?.from || 'presensi';
        setActiveTab(fromTab);
      }
    };
    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  }, [activeTab]);

  // ── Vakasi Tambahan States ──
  const [loyalisEmployees, setLoyalisEmployees] = useState<any[]>([]);
  const [loadingLoyalis, setLoadingLoyalis] = useState(false);
  const [existingEvents, setExistingEvents] = useState<any[]>([]);
  const [loadingEvents, setLoadingEvents] = useState(false);
  const [activeSuggestionIndex, setActiveSuggestionIndex] = useState<number>(0);

  // ── Loyalis Presence Calculator States ──
  const [uploadedData, setUploadedData] = useState<any[] | null>(null);
  const [calcMode, setCalcMode] = useState<'worked' | 'absent'>('worked');
  const [workingDays, setWorkingDays] = useState<number>(25);
  const [expectedHours, setExpectedHours] = useState<number>(6.5);
  const [savingPresence, setSavingPresence] = useState(false);
  const isSavingPresenceRef = useRef(false);
  const [existingPresence, setExistingPresence] = useState<any>(null);
  const [loadingPresence, setLoadingPresence] = useState(false);

  // Form States
  const [selectedEventId, setSelectedEventId] = useState<string | null>(null);
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

  // ── Kegiatan SPJ States ──
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

  // ─── Approval Workflow States ──────────────────────────────────────────────
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

  // Current event status (loaded from Firestore)
  const [currentEventStatus, setCurrentEventStatus] = useState<string | null>(null);
  const [currentEventReviewNote, setCurrentEventReviewNote] = useState<string | null>(null);
  const [currentEventSubmittedBy, setCurrentEventSubmittedBy] = useState<string | null>(null);
  const [currentEventSubmittedByName, setCurrentEventSubmittedByName] = useState<string | null>(null);

  // Status Badge Helper for UI cards
  const getStatusBadge = (status?: string) => {
    const currentStatus = status || 'approved'; // default legacy events to approved
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

  // Helper for background colors in event cards based on status and active state
  const getCardBgClass = (status?: string, active?: boolean) => {
    const currentStatus = status || 'approved';
    if (active) {
      switch (currentStatus) {
        case 'approved':
          return 'bg-emerald-50/70 border-emerald-300 shadow-sm ring-1 ring-emerald-300/20';
        case 'pending_review':
          return 'bg-amber-50/70 border-amber-300 shadow-sm ring-1 ring-amber-300/20';
        case 'declined':
          return 'bg-rose-50/70 border-rose-300 shadow-sm ring-1 ring-rose-300/20';
        case 'revision_needed':
          return 'bg-orange-50/70 border-orange-300 shadow-sm ring-1 ring-orange-300/20';
        case 'draft':
        default:
          return 'bg-indigo-50/50 border-indigo-300 shadow-sm ring-1 ring-indigo-300/20';
      }
    } else {
      switch (currentStatus) {
        case 'approved':
          return 'bg-emerald-50/30 border-emerald-100 hover:border-emerald-200';
        case 'pending_review':
          return 'bg-amber-50/30 border-amber-100 hover:border-amber-200';
        case 'declined':
          return 'bg-rose-50/30 border-rose-100 hover:border-rose-200';
        case 'revision_needed':
          return 'bg-orange-50/30 border-orange-100 hover:border-orange-200';
        case 'draft':
        default:
          return 'bg-white border-slate-100 hover:border-indigo-100';
      }
    }
  };

  // Determine if the current event form should be read-only (SatKer Loyalis when approved, declined, or pending review)
  const isReadOnly = profile?.role === 'satker_head_loyalis' &&
    (currentEventStatus === 'approved' || currentEventStatus === 'declined' || currentEventStatus === 'pending_review');

  // ─── Custom Column Dialog States ──────────────────────────────────────────
  const [customColumns, setCustomColumns] = useState<RekapColumn[]>([]);
  const [isCustomColDialogOpen, setIsCustomColDialogOpen] = useState(false);
  const [cetakKegiatanDialogOpen, setCetakKegiatanDialogOpen] = useState(false);
  const [newColLabel, setNewColLabel] = useState('');
  const [newColSlipLabel, setNewColSlipLabel] = useState('');
  const [newColType, setNewColType] = useState<'count' | 'currency'>('currency');
  const [newColMultiplier, setNewColMultiplier] = useState<number | ''>('');

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

  // ── Fetch Blue Collar Employees for SPJ ──
  useEffect(() => {
    const fetchBlueCollar = async () => {
      setLoadingBlueCollar(true);
      try {
        const q = query(
          collection(db, 'Employees_BlueCollar'),
          where('employment.status', '==', 'active')
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
  }, []);

  // ── Live Sync Vakasi Tambahan Events ──
  const fetchEvents = useCallback(async () => {
    // Keep as a dummy callback for backwards compatibility with call sites in save/delete/review handlers
  }, []);

  useEffect(() => {
    if (!profile) return;
    setLoadingEvents(true);
    const periodToken = `${year}-${String(month).padStart(2, '0')}`;
    const q = query(
      collection(db, 'VakasiTambahan'),
      where('period', '==', periodToken)
    );

    const unsubscribe = onSnapshot(q, (snap) => {
      let list = snap.docs.map(d => ({
        id: d.id,
        ...d.data()
      })) as any[];

      // Filter: if user is satker_head_loyalis, only show events created by them
      if (profile.role === 'satker_head_loyalis') {
        list = list.filter(evt => evt.submittedBy === profile.uid);
      }

      // Sort from latest to oldest using updatedAt
      list.sort((a, b) => {
        const getMs = (val: any) => {
          if (!val) return Date.now(); // Fallback for new unsaved objects
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
  }, [month, year, profile]);

  // ── Fetch Existing Loyalis Presence Data ──
  const fetchExistingPresence = useCallback(async () => {
    setLoadingPresence(true);
    try {
      const periodToken = `${year}_${String(month).padStart(2, '0')}`;
      const docRef = doc(db, 'LoyalisPresence', periodToken);
      const docSnap = await getDoc(docRef);
      if (docSnap.exists()) {
        const data = docSnap.data();
        setExistingPresence(data);
        if (data.mode) setCalcMode(data.mode);
        if (data.workingDays) setWorkingDays(data.workingDays);
        if (data.expectedHours) setExpectedHours(data.expectedHours);
      } else {
        setExistingPresence(null);
      }
    } catch (err) {
      console.error('Error fetching existing presence:', err);
    } finally {
      setLoadingPresence(false);
    }
  }, [month, year]);

  useEffect(() => {
    fetchExistingPresence();
  }, [fetchExistingPresence]);

  // ── Fetch Kegiatan SPJ Events ──
  const fetchSpjEvents = useCallback(async () => {
    if (!category) return;
    setLoadingSpjEvents(true);
    try {
      const periodToken = `${year}-${String(month).padStart(2, '0')}`;
      const q = query(
        collection(db, 'KegiatanSpj'),
        where('period', '==', periodToken)
      );
      const snap = await getDocs(q);
      const list = snap.docs.map(d => ({
        id: d.id,
        ...d.data()
      }));
      setSpjEvents(list);

      // Also fetch approved ActivityReports for the same period
      try {
        const prevMonthDate = new Date(year, month - 2, 26);
        const currentMonthDate = new Date(year, month - 1, 25);
        
        const formatDate = (d: Date) => {
          return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
        };
        
        const startDateStr = formatDate(prevMonthDate);
        const endDateStr = formatDate(currentMonthDate);
        const prevMonthToken = `${prevMonthDate.getFullYear()}-${String(prevMonthDate.getMonth() + 1).padStart(2, '0')}`;

        const [arSnap1, arSnap2] = await Promise.all([
          getDocs(query(
            collection(db, 'ActivityReports'),
            where('period', '==', prevMonthToken),
            where('status', '==', 'approved'),
            where('jobCategory', '==', category),
          )),
          getDocs(query(
            collection(db, 'ActivityReports'),
            where('period', '==', periodToken),
            where('status', '==', 'approved'),
            where('jobCategory', '==', category),
          ))
        ]);

        const allAr = [
          ...arSnap1.docs.map(d => ({ id: d.id, ...d.data() })),
          ...arSnap2.docs.map(d => ({ id: d.id, ...d.data() }))
        ];

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
  }, [month, year, category]);

  useEffect(() => {
    fetchSpjEvents();
  }, [fetchSpjEvents]);

  // Helper: compute accumulated SPJ payout for an employee
  // Combines KegiatanSpj events + approved ActivityReports
  const getComputedSpj = useCallback((empId: string) => {
    const kegiatanTotal = spjEvents.reduce((sum, evt) => {
      const workerInfo = evt.eventWorkers?.[empId];
      if (workerInfo) {
        return sum + (workerInfo.payGiven || 0);
      }
      return sum;
    }, 0);

    const activityTotal = approvedActivityReports.reduce((sum, ar) => {
      if (ar.employeeId === empId) {
        return sum + (ar.fee || 0);
      }
      return sum;
    }, 0);

    return kegiatanTotal + activityTotal;
  }, [spjEvents, approvedActivityReports]);

  // ID Sanitizer
  const sanitizeEventId = (name: string): string => {
    const clean = name.replace(/[^a-zA-Z0-9]/g, '');
    return clean.slice(0, 10);
  };

  // ── Upload Report File to Firebase Storage ──
  const uploadReportFile = async (file: File, period: string, eventSeg: string): Promise<{ url: string; name: string }> => {
    const ext = file.name.split('.').pop() || 'pdf';
    const path = `vakasi_reports/${period}/${eventSeg}_${Date.now()}.${ext}`;
    const storageRef = ref(storage, path);
    await uploadBytes(storageRef, file);
    const url = await getDownloadURL(storageRef);
    return { url, name: file.name };
  };

  // ── Handle Report File Selection ──
  const handleReportFileChange = async (file: File) => {
    const validTypes = ['application/pdf', 'image/jpeg', 'image/jpg', 'image/png'];
    if (!validTypes.includes(file.type)) {
      setMessage({ type: 'error', text: 'Format file tidak valid. Gunakan PDF, JPG, JPEG, atau PNG.' });
      return;
    }
    if (file.size > 10 * 1024 * 1024) {
      setMessage({ type: 'error', text: 'Ukuran file terlalu besar (maks 10MB).' });
      return;
    }
    setReportFile(file);
    setReportFileName(file.name);

    // Upload immediately
    setUploadingReport(true);
    try {
      const periodToken = `${year}-${String(month).padStart(2, '0')}`;
      const eventSeg = sanitizeEventId(eventName || 'unnamed');
      const result = await uploadReportFile(file, periodToken, eventSeg);
      setReportFileUrl(result.url);
      setMessage({ type: 'success', text: `File "${result.name}" berhasil diunggah.` });
    } catch (err) {
      console.error('Error uploading report file:', err);
      setMessage({ type: 'error', text: 'Gagal mengunggah file laporan.' });
      setReportFile(null);
      setReportFileName(null);
    } finally {
      setUploadingReport(false);
    }
  };

  // ── Submit for Review (SatKer Loyalis) ──
  const handleSubmitForReview = async () => {
    if (isSavingRef.current) return;
    if (!eventName.trim()) {
      setMessage({ type: 'error', text: 'Nama Kegiatan harus diisi.' });
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
      const periodToken = `${year}-${String(month).padStart(2, '0')}`;
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

      const payload = {
        eventName,
        period: periodToken,
        totalPayout,
        isEndOfMonth: false, // SatKer Loyalis can only create Tengah Bulan
        departmentUnit: selectedDept || null,
        eventWorkers: workersMap,
        updatedAt: serverTimestamp(),
        // Approval workflow fields
        status: 'pending_review',
        submittedBy: profile?.uid || null,
        submittedByName: profile?.displayName || null,
        reportFileUrl: reportFileUrl,
        reportFileName: reportFileName,
        submittedAt: serverTimestamp(),
        // Clear any previous review data on re-submit
        reviewNote: null,
        reviewedBy: null,
        reviewedAt: null,
      };

      await setDoc(doc(db, 'VakasiTambahan', documentId), payload);
      setMessage({ type: 'success', text: `Kegiatan "${eventName}" berhasil disubmit untuk review.` });

      setSelectedEventId(documentId);
      setCurrentEventStatus('pending_review');
      setCurrentEventReviewNote(null);
      setCurrentEventSubmittedBy(profile?.uid || null);
      setCurrentEventSubmittedByName(profile?.displayName || null);
      setReportFile(null);
      fetchEvents();
    } catch (err) {
      console.error(err);
      setMessage({ type: 'error', text: 'Gagal mensubmit kegiatan untuk review.' });
    } finally {
      isSavingRef.current = false;
      setSaving(false);
    }
  };

  // ── Review Event (Super Admin) ──
  const handleReviewEvent = async (eventId: string, action: 'approved' | 'revision_needed' | 'declined', note: string) => {
    if (isSavingRef.current) return;
    isSavingRef.current = true;
    setSaving(true);
    try {
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

      setShowReviewDialog(false);
      setReviewNote('');
      setReviewingEventId(null);
      setCurrentEventStatus(action);
      setCurrentEventReviewNote(note || null);
      fetchEvents();
    } catch (err) {
      console.error(err);
      setMessage({ type: 'error', text: 'Gagal memproses review.' });
    } finally {
      isSavingRef.current = false;
      setSaving(false);
    }
  };

  // Submit Handler
  const handleSaveEvent = async () => {
    if (isSavingRef.current) return;
    if (!eventName.trim()) {
      setMessage({ type: 'error', text: 'Nama Kegiatan harus diisi.' });
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

    isSavingRef.current = true;
    setSaving(true);
    try {
      const periodToken = `${year}-${String(month).padStart(2, '0')}`;
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

      const isSuperAdmin = profile?.role === 'super_admin';
      const finalSubmittedBy = selectedEventId
        ? currentEventSubmittedBy
        : (isSuperAdmin ? null : (profile?.uid || null));
      const finalSubmittedByName = selectedEventId
        ? currentEventSubmittedByName
        : (isSuperAdmin ? null : (profile?.displayName || null));

      const payload: Record<string, any> = {
        eventName,
        period: periodToken,
        totalPayout,
        isEndOfMonth,
        departmentUnit: !isEndOfMonth ? selectedDept : null,
        eventWorkers: workersMap,
        updatedAt: serverTimestamp(),
        // Super Admin events are auto-approved; SatKer Loyalis uses handleSubmitForReview for pending_review
        status: isSuperAdmin ? 'approved' : (currentEventStatus || 'draft'),
        submittedBy: finalSubmittedBy,
        submittedByName: finalSubmittedByName,
      };
      // Preserve report file info if present
      if (reportFileUrl) {
        payload.reportFileUrl = reportFileUrl;
        payload.reportFileName = reportFileName;
      }

      await setDoc(doc(db, 'VakasiTambahan', documentId), payload);
      setMessage({ type: 'success', text: `Event "${eventName}" berhasil disimpan.` });

      setSelectedEventId(documentId);
      setCurrentEventStatus(isSuperAdmin ? 'approved' : (currentEventStatus || 'draft'));
      setCurrentEventSubmittedBy(finalSubmittedBy);
      setCurrentEventSubmittedByName(finalSubmittedByName);
      setReportFile(null);
      fetchEvents();
    } catch (err) {
      console.error(err);
      setMessage({ type: 'error', text: 'Gagal menyimpan Event Vakasi Tambahan.' });
    } finally {
      isSavingRef.current = false;
      setSaving(false);
    }
  };

  // Delete Handler
  const handleDeleteEvent = async (eventId: string) => {
    if (isSavingRef.current) return;
    if (!confirm('Apakah Anda yakin ingin menghapus event ini?')) return;
    try {
      isSavingRef.current = true;
      setSaving(true);
      await deleteDoc(doc(db, 'VakasiTambahan', eventId));
      setMessage({ type: 'success', text: 'Event Vakasi Tambahan berhasil dihapus.' });
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
      fetchEvents();
    } catch (err) {
      console.error(err);
      setMessage({ type: 'error', text: 'Gagal menghapus event.' });
    } finally {
      isSavingRef.current = false;
      setSaving(false);
    }
  };

  // Add Row Handler
  const handleAddRow = () => {
    setWorkerRows(prev => [...prev, { employeeId: '', employeeName: '', payGiven: 0, searchText: '', showDropdown: false }]);
    setTimeout(() => {
      const nextIndex = workerRows.length;
      const nextInput = document.getElementById(`search-input-${nextIndex}`);
      if (nextInput) {
        nextInput.focus();
      }
    }, 50);
  };

  // Autosave Handler
  const handleAutosave = async (
    currentRows = workerRows,
    currentEventName = eventName,
    activeId = selectedEventId,
    currentIsEndOfMonth = isEndOfMonth,
    currentDept = selectedDept
  ) => {
    if (!currentEventName.trim()) return;
    const activeWorkers = currentRows.filter(w => w.employeeId);
    const ids = activeWorkers.map(w => w.employeeId);
    if (new Set(ids).size !== ids.length) return;

    try {
      const periodToken = `${year}-${String(month).padStart(2, '0')}`;
      const eventSeg = sanitizeEventId(currentEventName);
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

      const isSuperAdmin = profile?.role === 'super_admin';
      const finalSubmittedBy = activeId
        ? currentEventSubmittedBy
        : (isSuperAdmin ? null : (profile?.uid || null));
      const finalSubmittedByName = activeId
        ? currentEventSubmittedByName
        : (isSuperAdmin ? null : (profile?.displayName || null));

      const payload: Record<string, any> = {
        eventName: currentEventName,
        period: periodToken,
        totalPayout,
        isEndOfMonth: currentIsEndOfMonth,
        departmentUnit: !currentIsEndOfMonth ? currentDept : null,
        eventWorkers: workersMap,
        updatedAt: serverTimestamp(),
        // Autosave: Super Admin = approved, SatKer Loyalis = draft
        status: isSuperAdmin ? 'approved' : (currentEventStatus || 'draft'),
        submittedBy: finalSubmittedBy,
        submittedByName: finalSubmittedByName,
      };
      if (reportFileUrl) {
        payload.reportFileUrl = reportFileUrl;
        payload.reportFileName = reportFileName;
      }

      await setDoc(doc(db, 'VakasiTambahan', documentId), payload);
      if (!activeId) {
        setSelectedEventId(documentId);
      }
      fetchEvents();
    } catch (err) {
      console.error('Autosave error:', err);
    }
  };

  // ── Kegiatan SPJ Submit Handler ──
  const handleSaveSpjEvent = async () => {
    if (isSavingRef.current) return;
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
      const periodToken = `${year}-${String(month).padStart(2, '0')}`;
      const eventSeg = sanitizeEventId(spjEventName);
      const documentId = selectedSpjEventId || `${periodToken}_${eventSeg}_${Math.random().toString(36).substring(2, 8)}`;

      let totalPayout = 0;
      const workersMap: Record<string, { employeeName: string, payGiven: number }> = {};

      activeWorkers.forEach(w => {
        workersMap[w.employeeId] = {
          employeeName: w.employeeName,
          payGiven: spjEventFee,
        };
        totalPayout += spjEventFee;
      });

      const payload = {
        eventName: spjEventName,
        period: periodToken,
        totalPayout,
        eventFee: spjEventFee,
        eventWorkers: workersMap,
        updatedAt: serverTimestamp(),
      };

      await setDoc(doc(db, 'KegiatanSpj', documentId), payload);
      setMessage({ type: 'success', text: `Kegiatan SPJ "${spjEventName}" berhasil disimpan.` });

      setSelectedSpjEventId(null);
      setSpjEventName('');
      setSpjEventFee(0);
      setSpjWorkerRows([{ employeeId: '', employeeName: '', payGiven: 0, searchText: '', showDropdown: false }]);
      setMobileSpjView('list');
      fetchSpjEvents();
    } catch (err) {
      console.error(`Error saving Kegiatan SPJ "${spjEventName}" with document ID "${selectedSpjEventId || 'new'}":`, err);
      setMessage({ type: 'error', text: 'Gagal menyimpan Kegiatan SPJ.' });
    } finally {
      isSavingRef.current = false;
      setSaving(false);
    }
  };

  // ── Kegiatan SPJ Delete Handler ──
  const handleDeleteSpjEvent = async (eventId: string) => {
    if (isSavingRef.current) return;
    if (!confirm('Apakah Anda yakin ingin menghapus kegiatan SPJ ini?')) return;
    try {
      isSavingRef.current = true;
      setSaving(true);
      await deleteDoc(doc(db, 'KegiatanSpj', eventId));
      setMessage({ type: 'success', text: 'Kegiatan SPJ berhasil dihapus.' });
      setSelectedSpjEventId(null);
      setSpjEventName('');
      setSpjEventFee(0);
      setSpjWorkerRows([{ employeeId: '', employeeName: '', payGiven: 0, searchText: '', showDropdown: false }]);
      setMobileSpjView('list');
      fetchSpjEvents();
    } catch (err) {
      console.error(`Error deleting Kegiatan SPJ with event ID "${eventId}":`, err);
      setMessage({ type: 'error', text: 'Gagal menghapus kegiatan SPJ.' });
    } finally {
      isSavingRef.current = false;
      setSaving(false);
    }
  };

  // ── Kegiatan SPJ Add Row Handler ──
  const handleSpjAddRow = () => {
    setSpjWorkerRows(prev => [...prev, { employeeId: '', employeeName: '', payGiven: spjEventFee, searchText: '', showDropdown: false }]);
    setTimeout(() => {
      const nextIndex = spjWorkerRows.length;
      const nextInput = document.getElementById(`spj-search-input-${nextIndex}`);
      if (nextInput) {
        nextInput.focus();
      }
    }, 50);
  };

  // ── Kegiatan SPJ Autosave Handler ──
  const handleSpjAutosave = async (currentRows = spjWorkerRows, currentEventName = spjEventName, activeId = selectedSpjEventId, currentFee = spjEventFee) => {
    if (!currentEventName.trim()) return;
    if (currentRows.some(w => w.isInvalid || (w.searchText && !w.employeeId))) return;
    const activeWorkers = currentRows.filter(w => w.employeeId);
    const ids = activeWorkers.map(w => w.employeeId);
    if (new Set(ids).size !== ids.length) return;

    try {
      const periodToken = `${year}-${String(month).padStart(2, '0')}`;
      const eventSeg = sanitizeEventId(currentEventName);
      const documentId = activeId || `${periodToken}_${eventSeg}_${Math.random().toString(36).substring(2, 8)}`;

      let totalPayout = 0;
      const workersMap: Record<string, { employeeName: string, payGiven: number }> = {};

      activeWorkers.forEach(w => {
        workersMap[w.employeeId] = {
          employeeName: w.employeeName,
          payGiven: currentFee,
        };
        totalPayout += currentFee;
      });

      const payload = {
        eventName: currentEventName,
        period: periodToken,
        totalPayout,
        eventFee: currentFee,
        eventWorkers: workersMap,
        updatedAt: serverTimestamp(),
      };

      await setDoc(doc(db, 'KegiatanSpj', documentId), payload);
      if (!activeId) {
        setSelectedSpjEventId(documentId);
      }
      fetchSpjEvents();
    } catch (err) {
      console.error('SPJ Autosave error:', err);
    }
  };

  // ── Presence Calculator Helper functions ──
  
  const matchExcelName = useCallback((excelName: string, employees: any[]) => {
    if (!excelName) return null;
    const cleanExcel = normalizeName(excelName);
    
    // 1. Direct match on normalized name
    let found = employees.find(emp => normalizeName(emp.name) === cleanExcel);
    if (found) return found;
    
    // 2. Manual overrides check
    const overridden = MANUAL_OVERRIDES[excelName.trim()];
    if (overridden) {
      const cleanOverridden = normalizeName(overridden);
      found = employees.find(emp => normalizeName(emp.name) === cleanOverridden);
      if (found) return found;
    }
    
    // 3. Containment match (fallback)
    found = employees.find(emp => {
      const dbNorm = normalizeName(emp.name);
      return dbNorm.includes(cleanExcel) || cleanExcel.includes(dbNorm);
    });
    
    return found || null;
  }, []);

  const calculatePresenceStratum = useCallback((
    minutes: number,
    mode: 'worked' | 'absent',
    days: number,
    hours: number
  ) => {
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
  }, []);

  const displayRows = useMemo(() => {
    if (uploadedData) {
      const matchedIds = new Set(uploadedData.map(r => r.employeeId).filter(Boolean));
      const uploadedRows = uploadedData.map((row, idx) => {
        const calc = calculatePresenceStratum(row.minutes, calcMode, workingDays, expectedHours);
        return {
          idx,
          excelName: row.excelName,
          employeeId: row.employeeId,
          employeeName: row.employeeName,
          minutes: row.minutes,
          absenceMinutes: calc.absenceMinutes,
          stratum: calc.stratum,
          deduction: calc.deduction,
          netBonus: calc.netBonus,
          isMatched: !!row.employeeId,
          isNotFoundInExcel: false,
        };
      });

      const unmatchedEmployees = loyalisEmployees.filter(emp => !matchedIds.has(emp.id));
      const unmatchedRows = unmatchedEmployees.map((emp, uidx) => {
        return {
          idx: uploadedRows.length + uidx,
          excelName: '-',
          employeeId: emp.id,
          employeeName: emp.name,
          minutes: 0,
          absenceMinutes: 0,
          stratum: 5,
          deduction: 0,
          netBonus: 0,
          isMatched: true,
          isNotFoundInExcel: true,
        };
      });

      return [...uploadedRows, ...unmatchedRows];
    }
    if (existingPresence && existingPresence.entries) {
      return Object.values(existingPresence.entries).map((entry: any, idx) => {
        return {
          idx,
          excelName: entry.excelName,
          employeeId: entry.employeeId,
          employeeName: entry.employeeName,
          minutes: entry.minutes,
          absenceMinutes: entry.absenceMinutes,
          stratum: entry.stratum,
          deduction: entry.deduction,
          netBonus: entry.netBonus,
          isMatched: true,
          isNotFoundInExcel: !!entry.isNotFoundInExcel,
        };
      }).sort((a, b) => a.employeeName.localeCompare(b.employeeName));
    }
    return null;
  }, [uploadedData, loyalisEmployees, existingPresence, calcMode, workingDays, expectedHours, calculatePresenceStratum]);

  const handleExcelUpload = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (evt) => {
      try {
        const data = evt.target?.result;
        const workbook = XLSX.read(data, { type: 'binary' });
        const sheetName = workbook.SheetNames[0];
        const worksheet = workbook.Sheets[sheetName];
        const rows = XLSX.utils.sheet_to_json(worksheet, { header: 1 }) as any[][];

        if (rows.length === 0) {
          setMessage({ type: 'error', text: 'File Excel kosong.' });
          return;
        }

        // Auto-detect Name and Minutes columns
        let nameColIndex = 0;
        let minColIndex = 1;

        for (let r = 0; r < Math.min(rows.length, 10); r++) {
          const row = rows[r];
          if (!row) continue;
          const nameIdx = row.findIndex(cell => typeof cell === 'string' && cell.trim().length > 2 && isNaN(Number(cell)));
          const valIdx = row.findIndex(cell => typeof cell === 'number' || (typeof cell === 'string' && !isNaN(Number(cell.trim())) && cell.trim() !== ''));
          if (nameIdx !== -1 && valIdx !== -1 && nameIdx !== valIdx) {
            nameColIndex = nameIdx;
            minColIndex = valIdx;
            break;
          }
        }

        const parsedData: any[] = [];
        rows.forEach((row) => {
          if (!row) return;
          const nameVal = row[nameColIndex];
          const minVal = row[minColIndex];

          if (!nameVal) return;
          const nameStr = String(nameVal).trim();

          // Skip header row if it is a known header title (matches from the start)
          const lowerName = nameStr.toLowerCase();
          if (
            /^(nama|staff|employee|total|rekap)/i.test(lowerName) ||
            lowerName === 'nama/nik' ||
            lowerName === 'nama / nik'
          ) {
            return;
          }

          const minutes = Number(minVal) || 0;
          const match = matchExcelName(nameStr, loyalisEmployees);

          parsedData.push({
            excelName: nameStr,
            employeeId: match?.id || null,
            employeeName: match?.name || null,
            minutes,
          });
        });

        if (parsedData.length === 0) {
          setMessage({ type: 'error', text: 'Tidak ada data pegawai yang dapat diproses di Excel ini.' });
          return;
        }

        setUploadedData(parsedData);
        setMessage({ type: 'success', text: `Berhasil mengunggah ${parsedData.length} baris data.` });
      } catch (err) {
        console.error(err);
        setMessage({ type: 'error', text: 'Gagal membaca file Excel. Pastikan format benar.' });
      }
    };
    reader.readAsBinaryString(file);
  }, [loyalisEmployees, matchExcelName]);

  const handleSavePresence = async () => {
    if (isSavingPresenceRef.current || !uploadedData || uploadedData.length === 0) return;

    isSavingPresenceRef.current = true;
    setSavingPresence(true);
    try {
      const periodToken = `${year}_${String(month).padStart(2, '0')}`;
      const entriesMap: Record<string, any> = {};

      // 1. Process matched employees from Excel
      uploadedData.forEach(row => {
        if (!row.employeeId) return;
        
        const calc = calculatePresenceStratum(row.minutes, calcMode, workingDays, expectedHours);
        entriesMap[row.employeeId] = {
          employeeId: row.employeeId,
          employeeName: row.employeeName,
          excelName: row.excelName,
          minutes: row.minutes,
          absenceMinutes: calc.absenceMinutes,
          stratum: calc.stratum,
          deduction: calc.deduction,
          netBonus: calc.netBonus,
          isNotFoundInExcel: false,
        };
      });

      // 2. Process unmatched active Loyalis employees
      const matchedIds = new Set(uploadedData.map(r => r.employeeId).filter(Boolean));
      loyalisEmployees.forEach(emp => {
        if (!matchedIds.has(emp.id)) {
          entriesMap[emp.id] = {
            employeeId: emp.id,
            employeeName: emp.name,
            excelName: '-',
            minutes: 0,
            absenceMinutes: 0,
            stratum: 5,
            deduction: 0,
            netBonus: 0,
            isNotFoundInExcel: true,
          };
        }
      });

      const payload = {
        period: periodToken,
        workingDays,
        expectedHours,
        mode: calcMode,
        entries: entriesMap,
        updatedAt: serverTimestamp(),
      };

      await setDoc(doc(db, 'LoyalisPresence', periodToken), payload);
      setMessage({ type: 'success', text: 'Data bonus presensi berhasil disimpan.' });
      setUploadedData(null);
      fetchExistingPresence();
    } catch (err) {
      console.error(err);
      setMessage({ type: 'error', text: 'Gagal menyimpan data presensi.' });
    } finally {
      isSavingPresenceRef.current = false;
      setSavingPresence(false);
    }
  };

  const handleDeletePresence = async () => {
    if (isSavingPresenceRef.current) return;
    if (!confirm('Apakah Anda yakin ingin menghapus data presensi periode ini?')) return;
    try {
      isSavingPresenceRef.current = true;
      setSavingPresence(true);
      const periodToken = `${year}_${String(month).padStart(2, '0')}`;
      await deleteDoc(doc(db, 'LoyalisPresence', periodToken));
      setMessage({ type: 'success', text: 'Data presensi berhasil dihapus.' });
      setExistingPresence(null);
    } catch (err) {
      console.error(err);
      setMessage({ type: 'error', text: 'Gagal menghapus data presensi.' });
    } finally {
      isSavingPresenceRef.current = false;
      setSavingPresence(false);
    }
  };

  const [imageStats, setImageStats] = useState<{ w: number, h: number, size: number, type: string } | null>(null);
  const [loadingEmps, setLoadingEmps] = useState(false);
  const [lastScanResult, setLastScanResult] = useState<any>(null);
  const [showDebugModal, setShowDebugModal] = useState(false);
  const [showSavePreview, setShowSavePreview] = useState(false);
  const [showSaveConfirm, setShowSaveConfirm] = useState(false);
  const [employees, setEmployees] = useState<BlueCollarEmployee[]>([]);
  const [tableData, setTableData] = useState<Record<string, Record<string, number>>>({});
  const [rowBounds, setRowBounds] = useState<Record<string, { top: number, bottom: number }>>({});
  const [detectedColumnOrder, setDetectedColumnOrder] = useState<string[] | null>(null);
  const [scanImgDims, setScanImgDims] = useState<{ w: number, h: number } | null>(null);

  const [scanning, setScanning] = useState(false);
  const [scanProgress, setScanProgress] = useState(0);
  const [showScanPanel, setShowScanPanel] = useState(false);
  const [saving, setSaving] = useState(false);
  const isSavingRef = useRef(false);
  const [saved, setSaved] = useState(false);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [showPreviewModal, setShowPreviewModal] = useState(false);

  const spjDiscrepancies = useMemo(() => {
    return employees.map(emp => {
      const rawVal = tableData[emp.employeeId]?.spj;
      const computedVal = getComputedSpj(emp.employeeId);
      if (rawVal !== undefined && rawVal !== computedVal) {
        return {
          name: emp.name,
          employeeId: emp.employeeId,
          manual: rawVal,
          computed: computedVal,
        };
      }
      return null;
    }).filter(Boolean) as { name: string; employeeId: string; manual: number; computed: number }[];
  }, [employees, tableData, getComputedSpj]);

  // ── Columns logic ────────────────────────────────────────────────────────
  const columns = useMemo(() => {
    if (!category) return [];
    const baseCols = REKAP_COLUMNS[category] || REKAP_COLUMNS.KEBERSIHAN;
    const allCols = [...baseCols, ...customColumns];
    if (detectedColumnOrder) {
      return detectedColumnOrder
        .map(key => allCols.find(c => c.key === key))
        .filter((c): c is RekapColumn => !!c);
    }
    return allCols;
  }, [category, detectedColumnOrder, customColumns]);

  const docId = `${year}_${String(month).padStart(2, '0')}_${category}`;

  // ── File state
  const [file, setFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [rotation, setRotation] = useState(0);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [crop, setCrop] = useState({ x: 0, y: 0, w: 100, h: 100 });
  const [croppedPreviewUrl, setCroppedPreviewUrl] = useState<string | null>(null);
  const [isCropping, setIsCropping] = useState(false);

  const [dragMode, setDragMode] = useState<'none' | 'move' | 't' | 'b' | 'l' | 'r' | 'tl' | 'tr' | 'bl' | 'br'>('none');
  const [startPos, setStartPos] = useState({ x: 0, y: 0 });
  const [startCrop, setStartCrop] = useState({ x: 0, y: 0, w: 100, h: 100 });
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const fetch = async () => {
      try {
        const allEmpSnap = await getDocs(collection(db, 'Employees_BlueCollar'));
        const cats = new Set<string>(SUPPORTED_CATEGORIES);
        allEmpSnap.docs.forEach(d => {
          const cat = d.data()?.employment?.jobCategory;
          if (cat) cats.add(cat);
        });
        setDynamicCategories(Array.from(cats).sort());
      } catch (err) { console.error(err); }
    };
    fetch();
  }, []);

  useEffect(() => {
    if (!category) return;
    // Security Access check: Make sure this category is allowed
    if (profile && profile.role !== 'super_admin' && !profile.permittedCategories?.includes(category)) {
      return;
    }
    setDetectedColumnOrder(null);
    setMessage(null);
    setSaved(false);
    const fetchData = async () => {
      setLoadingEmps(true);
      try {
        const q2 = query(collection(db, 'Employees_BlueCollar'), where('employment.status', '==', 'active'), where('employment.jobCategory', '==', category));
        const empSnap = await getDocs(q2);
        const empList = empSnap.docs.map(d => ({ employeeId: d.id, ...d.data() } as BlueCollarEmployee));
        const sortedEmps = empList.sort((a, b) => a.employeeId.localeCompare(b.employeeId));
        setEmployees(sortedEmps);

        const initialTable: Record<string, Record<string, number>> = {};
        const uraianSnap = await getDoc(doc(db, 'UraianGaji', docId));
        if (uraianSnap.exists()) {
          setSaved(true);
          const docData = uraianSnap.data() as any;
          const loadedCustomCols = docData.customColumns || [];
          setCustomColumns(loadedCustomCols);

          Object.values(docData.entries).forEach((entry: any) => {
            const rawValues = { ...entry.values };
            const empCols = [...(REKAP_COLUMNS[category] || REKAP_COLUMNS.KEBERSIHAN), ...loadedCustomCols];
            empCols.forEach(col => {
              const isDualMap = ['harian', 'jumatLibur', 'lemburSendiri', 'lemburCover', 'bonusMutlak', 'bonusBulanan', 'bonusLainnya', 'bonusPresensiBulanan', 'bonusPresensiTriwulanan', 'piket'].includes(col.key);
              if (isDualMap && col.multiplier) {
                if (entry.counts?.[col.key] !== undefined) rawValues[col.key] = entry.counts[col.key];
                else if (rawValues[col.key] && rawValues[col.key] > 31) rawValues[col.key] = Math.round(rawValues[col.key] / col.multiplier);
              } else if (col.type === 'count' && col.multiplier) {
                if (entry.counts?.[col.key] !== undefined) rawValues[col.key] = entry.counts[col.key];
                else if (rawValues[col.key]) rawValues[col.key] = rawValues[col.key] / col.multiplier;
              }
            });
            initialTable[entry.employeeId] = rawValues;
          });
        } else {
          setCustomColumns([]);
          setSaved(false);
        }
        setTableData(initialTable);
      } catch (err) { console.error(err); }
      finally { setLoadingEmps(false); }
    };
    fetchData();
  }, [category, month, year, docId]);

  const handleFileUpload = useCallback(async (newFile: File, rot: number = rotation) => {
    setFile(newFile); setDetectedColumnOrder(null);
    const url = URL.createObjectURL(newFile); setPreviewUrl(url);
    const img = new Image();
    img.onload = () => setImageStats({ w: img.width, h: img.height, size: newFile.size, type: newFile.type });
    img.src = url;
    try {
      const canvas = await renderFileToCanvas(newFile, rot);
      canvasRef.current = canvas; setPreviewUrl(canvas.toDataURL('image/png'));
      setCroppedPreviewUrl(null); setCrop({ x: 0, y: 0, w: 100, h: 100 });
    } catch (err) { setMessage({ type: 'error', text: 'Gagal memproses file.' }); }
  }, [rotation]);

  useEffect(() => {
    const handlePaste = (e: ClipboardEvent) => {
      const items = e.clipboardData?.items;
      if (!items) return;
      for (let i = 0; i < items.length; i++) {
        if (items[i].type.indexOf('image') !== -1) {
          const blob = items[i].getAsFile(); if (blob) handleFileUpload(blob);
        }
      }
    };
    window.addEventListener('paste', handlePaste);
    return () => window.removeEventListener('paste', handlePaste);
  }, [handleFileUpload]);

  const handleRotate = () => {
    const nextRot = (rotation + 90) % 360;
    setRotation(nextRot); if (file) handleFileUpload(file, nextRot);
  };

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault(); const droppedFile = e.dataTransfer.files[0];
    if (droppedFile) handleFileUpload(droppedFile);
  }, [handleFileUpload]);

  const handleClearFile = () => {
    setFile(null); setPreviewUrl(null); setCroppedPreviewUrl(null);
    setRowBounds({}); setCrop({ x: 0, y: 0, w: 100, h: 100 }); setDetectedColumnOrder(null);
  };

  const handleDoneCropping = () => {
    setIsCropping(false);
    if (canvasRef.current) {
      const cropped = cropCanvas(canvasRef.current, crop);
      setCroppedPreviewUrl(cropped.toDataURL('image/png'));
    }
  };

  const getDisplayRect = () => {
    if (!containerRef.current || !canvasRef.current) return { x: 0, y: 0, w: 1, h: 1 };
    const container = containerRef.current.getBoundingClientRect();
    const canvas = canvasRef.current;
    const containerRatio = container.width / container.height;
    const canvasRatio = canvas.width / canvas.height;
    let w, h, x, y;
    if (canvasRatio > containerRatio) { w = container.width; h = container.width / canvasRatio; x = 0; y = (container.height - h) / 2; }
    else { h = container.height; w = container.height * canvasRatio; y = 0; x = (container.width - w) / 2; }
    return { x, y, w, h };
  };

  const onMouseDown = (e: React.MouseEvent, mode: typeof dragMode) => {
    if (!isCropping) return;
    e.stopPropagation(); setDragMode(mode);
    setStartPos({ x: e.clientX, y: e.clientY }); setStartCrop({ ...crop });
  };

  const onMouseMove = (e: React.MouseEvent) => {
    if (dragMode === 'none' || !containerRef.current) return;
    const display = getDisplayRect();
    const dx = ((e.clientX - startPos.x) / display.w) * 100;
    const dy = ((e.clientY - startPos.y) / display.h) * 100;
    setCrop(prev => {
      let next = { ...prev };
      if (dragMode === 'move') {
        next.x = Math.max(0, Math.min(100 - prev.w, startCrop.x + dx));
        next.y = Math.max(0, Math.min(100 - prev.h, startCrop.y + dy));
      } else {
        if (dragMode.includes('t')) { const newY = Math.max(0, Math.min(startCrop.y + startCrop.h - 5, startCrop.y + dy)); next.h = startCrop.h - (newY - startCrop.y); next.y = newY; }
        else if (dragMode.includes('b')) { next.h = Math.max(5, Math.min(100 - prev.y, startCrop.h + dy)); }
        if (dragMode.includes('l')) { const newX = Math.max(0, Math.min(startCrop.x + startCrop.w - 5, startCrop.x + dx)); next.w = startCrop.w - (newX - startCrop.x); next.x = newX; }
        else if (dragMode.includes('r')) { next.w = Math.max(5, Math.min(100 - prev.x, startCrop.w + dx)); }
      }
      return next;
    });
  };

  const sanitizeAiValue = (val: any): number => {
    if (typeof val === 'number') return val;
    if (!val || val === '-' || val === 'Rp -') return 0;

    // 1. Remove Rp, spaces, and any non-numeric/non-separator characters
    let clean = String(val).replace(/Rp|\s/gi, '');

    // 2. Handle decimals: If it ends with ,00 or .00, remove the decimal part entirely
    clean = clean.replace(/[,\.]00$/, '');

    // 3. Remove all thousand separators (both . and ,)
    // We only do this if there's more than one separator OR if it's followed by 3 digits
    // e.g., 50,000 -> 50000, 674.500 -> 674500
    const parts = clean.split(/[,\.]/);
    if (parts.length > 1) {
      // If the last part has exactly 3 digits, it was likely a thousand separator
      if (parts[parts.length - 1].length === 3) {
        clean = parts.join('');
      } else {
        // Otherwise, treat the last separator as a decimal point
        const lastPart = parts.pop();
        clean = parts.join('') + '.' + lastPart;
      }
    }

    const parsed = parseFloat(clean);
    return isNaN(parsed) ? 0 : Math.round(parsed);
  };

  const handleScan = async () => {
    if (!file || !canvasRef.current) return;
    setScanning(true); setScanProgress(10);
    try {
      const targetCanvas = cropCanvas(canvasRef.current, crop);
      const { words } = await runOcr(targetCanvas, (p) => setScanProgress(20 + Math.round(p * 0.8)));
      const empList = employees.map(e => ({ employeeId: e.employeeId, name: e.name }));
      const parsed = parseRekapRows(words, empList, columns);

      const foundOrder: string[] = [];
      setTableData(prev => {
        const next = { ...prev };
        for (const row of parsed) {
          if (row.employeeId && next[row.employeeId]) {
            const sanitized: Record<string, number> = {};
            Object.entries(row.values).forEach(([k, v]) => { sanitized[k] = sanitizeAiValue(v); });
            next[row.employeeId] = { ...next[row.employeeId], ...sanitized };
            Object.keys(row.values).forEach(k => { if (!foundOrder.includes(k)) foundOrder.push(k); });
          }
        }
        return next;
      });
      setDetectedColumnOrder(foundOrder);
      if (parsed.length === 0) setMessage({ type: 'error', text: 'Gagal mendeteksi data.' });
      else setMessage({ type: 'success', text: `Scan selesai — ${parsed.length} karyawan terdeteksi.` });
    } catch (err) { setMessage({ type: 'error', text: 'Gagal menjalankan OCR.' }); }
    finally { setScanning(false); setScanProgress(0); }
  };

  const handleAiScan = async () => {
    if (!file || !canvasRef.current) return;
    setScanning(true); setScanProgress(30);
    try {
      const targetCanvas = cropCanvas(canvasRef.current, crop);
      const blob = await new Promise<Blob>((resolve) => targetCanvas.toBlob((b) => resolve(b!), 'image/png'));
      const formData = new FormData();
      formData.append('file', blob, 'cropped.png');
      const baseCols = REKAP_COLUMNS[category] || REKAP_COLUMNS.KEBERSIHAN;
      formData.append('columns', JSON.stringify(baseCols.map(c => ({ key: c.key, label: c.label }))));
      const res = await fetch('/api/parse-rekap', { method: 'POST', body: formData });
      if (!res.ok) throw new Error('AI Scan failed');
      const { data } = await res.json();
      setLastScanResult(data);
      const structured = data?.structured;
      const aiDetectedOrder = data?.detected_column_order;

      if (structured && structured.length > 0) {
        const empList = employees.map(e => ({ employeeId: e.employeeId, name: e.name }));
        let matchedCount = 0;
        const newTableData = { ...tableData };
        const newRowBounds: Record<string, { top: number, bottom: number }> = {};
        for (const entry of structured) {
          const match = matchEmployee(entry.name, empList);
          if (match) {
            matchedCount++;
            const sanitized: Record<string, number> = {};
            Object.entries(entry.values).forEach(([k, v]) => { sanitized[k] = sanitizeAiValue(v); });
            newTableData[match.employeeId] = { ...newTableData[match.employeeId], ...sanitized };
            if (entry.y_top !== undefined && entry.y_bottom !== undefined) newRowBounds[match.employeeId] = { top: entry.y_top, bottom: entry.y_bottom };
          }
        }
        setTableData(newTableData); setRowBounds(newRowBounds);
        if (Array.isArray(aiDetectedOrder) && aiDetectedOrder.length > 0) setDetectedColumnOrder(aiDetectedOrder);
        if (data.img_w && data.img_h) setScanImgDims({ w: data.img_w, h: data.img_h });
        setMessage({ type: 'success', text: `AI Scan selesai — ${matchedCount} karyawan terdeteksi.` });
      } else throw new Error('AI tidak menemukan data.');
    } catch (err: any) { setMessage({ type: 'error', text: `AI Scan gagal: ${err.message}` }); }
    finally { setScanning(false); setScanProgress(0); }
  };

  const updateCell = (employeeId: string, key: string, value: string) => {
    if (key === 'spj' && value.trim() === '') {
      setTableData(prev => {
        const copy = { ...prev };
        if (copy[employeeId]) {
          const rowCopy = { ...copy[employeeId] };
          delete rowCopy.spj;
          copy[employeeId] = rowCopy;
        }
        return copy;
      });
      setSaved(false);
      return;
    }
    const num = parseInt(value, 10) || 0;
    setTableData(prev => ({ ...prev, [employeeId]: { ...prev[employeeId], [key]: num } }));
    setSaved(false);
  };

  const generateSavePayload = () => {
    const period = `${year}-${String(month).padStart(2, '0')}`;
    const periodLabel = `${MONTHS_ID[month - 1]} ${year}`;
    const entries: Record<string, UraianEntry> = {};
    for (const emp of employees) {
      const rawValues = tableData[emp.employeeId] ?? {};
      const storedValues: Record<string, number> = { 
        ...rawValues,
        spj: rawValues.spj !== undefined ? rawValues.spj : getComputedSpj(emp.employeeId),
      };
      const storedCounts: Record<string, number> = {};
      const empCols = [...(REKAP_COLUMNS[category] || REKAP_COLUMNS.KEBERSIHAN), ...customColumns];
      empCols.forEach(col => {
        const rawVal = storedValues[col.key]; if (rawVal === undefined || rawVal === null) return;
        const isDualMap = ['harian', 'jumatLibur', 'lemburSendiri', 'lemburCover', 'bonusMutlak', 'bonusBulanan', 'bonusLainnya', 'bonusPresensiBulanan', 'bonusPresensiTriwulanan', 'piket'].includes(col.key);
        if (isDualMap && col.multiplier) {
          if (rawVal > 31) { storedCounts[col.key] = Math.round(rawVal / col.multiplier); storedValues[col.key] = rawVal; }
          else { storedCounts[col.key] = rawVal; storedValues[col.key] = rawVal * col.multiplier; }
        } else if (col.type === 'count' && col.multiplier) { storedCounts[col.key] = rawVal; storedValues[col.key] = rawVal * col.multiplier; }
      });
      entries[emp.employeeId] = { employeeId: emp.employeeId, name: emp.name, values: storedValues, ...(Object.keys(storedCounts).length > 0 && { counts: storedCounts }) };
    }

    // Sanitize customColumns to remove undefined properties (like multiplier: undefined) before writing to Firestore
    const sanitizedCustomCols = customColumns.map(col => {
      const cleaned = { ...col };
      if (cleaned.multiplier === undefined) {
        delete cleaned.multiplier;
      }
      if (cleaned.slipLabel === undefined) {
        delete cleaned.slipLabel;
      }
      return cleaned;
    });

    return { period, periodLabel, jobCategory: category, entries, customColumns: sanitizedCustomCols, updatedAt: "ServerTimestamp" };
  };

  // Opens the confirmation modal instead of writing directly
  const handleSave = () => {
    setShowSaveConfirm(true);
  };

  // Called only when user clicks "Konfirmasi & Simpan" inside the modal
  const handleConfirmSave = async () => {
    if (isSavingRef.current) return;
    setShowSaveConfirm(false);
    isSavingRef.current = true;
    setSaving(true);
    try {
      const payload = generateSavePayload();
      await setDoc(doc(db, 'UraianGaji', docId), { ...payload, updatedAt: serverTimestamp() }, { merge: true });
      const catLabel = category.replace('_', ' ').toUpperCase();
      setMessage({ type: 'success', text: `Data rekapitulasi presensi ${catLabel} berhasil disimpan.` });
      setSaved(true);
    } catch (err) {
      setMessage({ type: 'error', text: 'Gagal menyimpan.' });
    }
    finally {
      isSavingRef.current = false;
      setSaving(false);
    }
  };

  // Helper: format to IDR string (e.g. 250000 -> "Rp 250.000")
  const fmtRp = (n: number) =>
    'Rp\u00a0' + Math.round(n).toLocaleString('id-ID');

  const handleAddCustomColumn = () => {
    if (!newColLabel.trim()) {
      alert('Nama kolom wajib diisi!');
      return;
    }
    const cleanLabel = newColLabel.trim();
    const cleanSlipLabel = newColSlipLabel.trim() || cleanLabel;

    // Generate a clean safe key
    const uniqueKey = `custom_${cleanLabel.toLowerCase().replace(/[^a-z0-9]/g, '_')}_${Date.now().toString().slice(-4)}`;

    const newCol: RekapColumn = {
      key: uniqueKey,
      label: cleanLabel,
      type: newColType,
      multiplier: newColType === 'count' ? (Number(newColMultiplier) || 1) : undefined,
      slipLabel: cleanSlipLabel,
    };

    setCustomColumns(prev => [...prev, newCol]);

    // Reset form states
    setNewColLabel('');
    setNewColSlipLabel('');
    setNewColType('currency');
    setNewColMultiplier('');
    setIsCustomColDialogOpen(false);

    setMessage({ type: 'success', text: `Kolom kustom "${cleanLabel}" berhasil ditambahkan ke tabel.` });
    setTimeout(() => setMessage(null), 3000);
  };

  const handleRemoveCustomColumn = (key: string) => {
    if (window.confirm('Apakah Anda yakin ingin menghapus kolom kustom ini beserta semua data di dalamnya?')) {
      setCustomColumns(prev => prev.filter(c => c.key !== key));
      setTableData(prev => {
        const copy = { ...prev };
        Object.keys(copy).forEach(empId => {
          if (copy[empId]) {
            const rowCopy = { ...copy[empId] };
            delete rowCopy[key];
            copy[empId] = rowCopy;
          }
        });
        return copy;
      });
      setSaved(false);
    }
  };

  // Build the per-employee summary rows for the confirmation modal
  const DUAL_MAP_KEYS = ['harian', 'jumatLibur', 'lemburSendiri', 'lemburCover', 'bonusMutlak', 'bonusBulanan', 'bonusLainnya', 'bonusPresensiBulanan', 'bonusPresensiTriwulanan', 'piket'] as const;

  const buildConfirmRows = () => {
    if (!category) return [];
    const baseCols = REKAP_COLUMNS[category] || REKAP_COLUMNS.KEBERSIHAN;
    const empCols = [...baseCols, ...customColumns];
    return employees.map(emp => {
      const rawValues = tableData[emp.employeeId] ?? {};
      const fields = empCols.map(col => {
        let rawVal = rawValues[col.key] ?? 0;
        if (col.key === 'spj') {
          rawVal = rawValues.spj !== undefined ? rawValues.spj : getComputedSpj(emp.employeeId);
        }
        if (rawVal === 0) return { col, count: 0, value: 0, isDual: false };
        const isDual = (DUAL_MAP_KEYS as readonly string[]).includes(col.key) && !!col.multiplier;
        if (isDual && col.multiplier) {
          const count = rawVal > 31 ? Math.round(rawVal / col.multiplier) : rawVal;
          const value = rawVal > 31 ? rawVal : rawVal * col.multiplier;
          return { col, count, value, isDual: true };
        }
        return { col, count: null, value: rawVal, isDual: false };
      }).filter(f => f.value !== 0);
      return { emp, fields };
    }).filter(row => row.fields.length > 0);
  };

  const display = getDisplayRect();
  const hasScanData = Object.keys(rowBounds).length > 0;

  const handleExportPdf = async () => {
    if (!category || employees.length === 0) return;

    const empRows = employees.map((emp, idx) => {
      const rawValues = tableData[emp.employeeId] ?? {};
      const computedValues: Record<string, number> = { 
        ...rawValues,
        spj: rawValues.spj !== undefined ? rawValues.spj : getComputedSpj(emp.employeeId),
      };
      const computedCounts: Record<string, number> = {};
      const baseCols = REKAP_COLUMNS[category] || REKAP_COLUMNS.KEBERSIHAN;
      const empCols = [...baseCols, ...customColumns];
      empCols.forEach(col => {
        const rawVal = computedValues[col.key]; if (rawVal === undefined || rawVal === null) return;
        const isDualMap = ['harian', 'jumatLibur', 'lemburSendiri', 'lemburCover', 'bonusMutlak', 'bonusBulanan', 'bonusLainnya', 'bonusPresensiBulanan', 'bonusPresensiTriwulanan', 'piket'].includes(col.key);
        if (isDualMap && col.multiplier) {
          if (rawVal > 31) {
            computedCounts[col.key] = Math.round(rawVal / col.multiplier);
            computedValues[col.key] = rawVal;
          } else {
            computedCounts[col.key] = rawVal;
            computedValues[col.key] = rawVal * col.multiplier;
          }
        } else if (col.type === 'count' && col.multiplier) {
          computedCounts[col.key] = rawVal;
          computedValues[col.key] = rawVal * col.multiplier;
        }
      });

      return {
        no: idx + 1,
        name: emp.name,
        values: computedValues,
        counts: computedCounts,
      };
    });

    await generateRekapPresensiKebersihanyPdf({
      period: `${MONTHS_ID[month - 1]} ${year}`,
      category,
      employees: empRows,
      customColumns,
    });
  };

  const handleExportEmptyPdf = async () => {
    if (!category || employees.length === 0) return;

    const empRows = employees.map((emp, idx) => {
      return {
        no: idx + 1,
        name: emp.name,
        values: {},
        counts: {},
      };
    });

    await generateRekapPresensiKebersihanyPdf({
      period: `${MONTHS_ID[month - 1]} ${year}`,
      category,
      employees: empRows,
      isEmptyTemplate: true,
      customColumns,
    });
  };

  return (
    <div className="min-h-screen bg-[#F8FAFC] p-6 lg:p-8 pb-24 lg:pb-32 font-sans selection:bg-indigo-100">
      <div className="max-w-[1600px] mx-auto space-y-8">

        <div className="flex flex-col md:flex-row md:items-center justify-between gap-6">
          <div className="space-y-1">
            {profile?.role === 'super_admin' || activeTab === 'kegiatan_spj' ? (
              <Button
                variant="ghost"
                onClick={() => {
                  if (activeTab === 'kegiatan_spj') {
                    window.history.back();
                  } else {
                    router.back();
                  }
                }}
                className="group -ml-2 mb-2 text-slate-500 hover:text-indigo-600"
              >
                <ArrowLeft className="w-4 h-4 mr-2 group-hover:-translate-x-1 transition-transform" />
                Kembali
              </Button>
            ) : (
              <div className="h-2" />
            )}
            <h1 className="text-3xl font-bold text-slate-900">
              {activeTab === 'presensi'
                ? 'Rekap Presensi Pekarya'
                : activeTab === 'vakasi_loyalis'
                  ? 'Vakasi Tambahan (Loyalis)'
                  : 'Kegiatan SPJ (Pekarya)'}
            </h1>
            <p className="text-slate-500 text-sm">
              {activeTab === 'presensi'
                ? 'Upload rekap PDF/Gambar untuk auto-input'
                : activeTab === 'vakasi_loyalis'
                  ? 'Kelola pembayaran kegiatan variabel loyalis bulanan'
                  : 'Kelola pembayaran kegiatan variabel pekarya bulanan'}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <Select value={String(month)} onValueChange={(v) => v && setMonth(parseInt(v))}>
              <SelectTrigger className="w-56 bg-white shadow-sm border-slate-200">
                <SelectValue>
                  {activeTab === 'vakasi_loyalis' ? (
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
                        {activeTab === 'vakasi_loyalis' ? (
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
            <Select value={String(year)} onValueChange={(v) => v && setYear(parseInt(v))}>
              <SelectTrigger className="w-28 bg-white shadow-sm border-slate-200"><SelectValue /></SelectTrigger>
              <SelectContent>{YEARS.map(y => (<SelectItem key={y} value={String(y)}>{y}</SelectItem>))}</SelectContent>
            </Select>

            {activeTab === 'presensi' && category && allowedCategories.length > 0 && (
              <Select value={category} onValueChange={(v) => v && setCategory(v)}>
                <SelectTrigger className="w-48 bg-white shadow-sm border-slate-200"><SelectValue /></SelectTrigger>
                <SelectContent>{allowedCategories.map(c => (<SelectItem key={c} value={c}>{c}</SelectItem>))}</SelectContent>
              </Select>
            )}

            {profile?.role === 'satker_head_loyalis' && (
              <Button
                onClick={() => setCetakKegiatanDialogOpen(true)}
                variant="outline"
                className="rounded-xl border-indigo-200 text-indigo-700 bg-indigo-50 hover:bg-indigo-100 hover:border-indigo-300 transition-all font-semibold flex items-center gap-2 shadow-sm cursor-pointer"
              >
                <FileText className="w-4 h-4 text-indigo-600" />
                Laporan Kegiatan Loyalis
              </Button>
            )}

            {(profile?.role === 'satker_head' || profile?.role === 'satker_head_loyalis') && (
              <Button
                variant="outline"
                onClick={logout}
                className="rounded-xl text-rose-600 border-slate-200 hover:bg-rose-50 hover:text-rose-700 hover:border-rose-100 transition-all cursor-pointer flex items-center gap-2 shadow-sm"
              >
                <LogOut className="w-4 h-4" />
                Keluar
              </Button>
            )}
          </div>
        </div>

        {/* Global Action Bar (only shown on Presensi tab) */}
        {activeTab === 'presensi' && (
          <div className="flex flex-wrap items-center gap-3 bg-white p-4 rounded-[20px] border border-slate-200/60 shadow-sm">
            <Button
              onClick={() => {
                setActiveTab('kegiatan_spj');
                setMobileSpjView('list');
                window.history.pushState({ tab: 'kegiatan_spj', from: activeTab }, '');
              }}
              variant="outline"
              className="rounded-xl border-indigo-200 text-indigo-700 bg-indigo-50 hover:bg-indigo-100 hover:border-indigo-300 transition-all font-semibold flex items-center gap-2 shadow-sm"
            >
              <Calendar className="w-4 h-4" />
              Kegiatan SPJ
            </Button>
            {['KEBERSIHAN', 'KEBERSIHAN_IC'].includes(category) && (
              <Button
                onClick={() => router.push('/dashboard/payroll/activity-review')}
                variant="outline"
                className="rounded-xl border-teal-200 text-teal-700 bg-teal-50 hover:bg-teal-100 hover:border-teal-300 transition-all font-semibold flex items-center gap-2 shadow-sm cursor-pointer"
              >
                <ClipboardCheck className="w-4 h-4 text-teal-600" />
                Review Laporan Kegiatan
              </Button>
            )}
            <Button
              variant="outline"
              onClick={() => setIsCustomColDialogOpen(true)}
              disabled={!category || employees.length === 0}
              className="rounded-xl border-slate-200 text-slate-600 hover:text-indigo-600 hover:border-indigo-200 flex items-center gap-2 font-semibold transition-all shadow-sm cursor-pointer"
            >
              <Plus className="w-4 h-4 text-indigo-500" />
              Tambah Kolom
            </Button>
            <Button onClick={handleSave} disabled={saving || !category || employees.length === 0} className="rounded-xl px-6 bg-indigo-600 shadow-lg shadow-indigo-200 text-white font-bold transition-all hover:bg-indigo-700 hover:shadow-indigo-300 flex items-center gap-2">
              {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <ShieldCheck className="w-4 h-4" />}
              Simpan
            </Button>
            {saved && (
              <Button
                onClick={handleExportPdf}
                variant="outline"
                className="rounded-xl border-emerald-200 text-emerald-700 bg-emerald-50 hover:bg-emerald-100 hover:border-emerald-300 transition-all font-semibold flex items-center gap-2 shadow-sm"
              >
                <FileDown className="w-4 h-4" />
                Ekspor Laporan PDF
              </Button>
            )}
            {category && employees.length > 0 && (
              <Button
                onClick={handleExportEmptyPdf}
                variant="outline"
                className="rounded-xl border-amber-200 text-amber-700 bg-amber-50 hover:bg-amber-100 hover:border-amber-300 transition-all font-semibold flex items-center gap-2 shadow-sm"
              >
                <FileText className="w-4 h-4" />
                Ekspor Templat Kosong (Darurat)
              </Button>
            )}
          </div>
        )}

        {/* Premium Tab Switcher - Only shown for Super Admin */}
        {profile?.role === 'super_admin' && (
          <div className="flex flex-wrap items-center justify-between gap-4 w-full">
            <div className="flex bg-slate-100 p-1 rounded-xl w-fit shadow-sm border border-slate-200">
              <button
                onClick={() => setActiveTab('presensi')}
                className={`px-5 py-2.5 rounded-lg text-xs font-bold transition-all flex items-center gap-2 ${activeTab === 'presensi'
                  ? 'bg-white text-indigo-600 shadow-sm border border-slate-200/50'
                  : 'text-slate-500 hover:text-slate-800'
                  }`}
              >
                <ScanLine className="w-4.5 h-4.5" />
                Rekap Presensi (Pekarya)
              </button>
              <button
                onClick={() => setActiveTab('vakasi_loyalis')}
                className={`px-5 py-2.5 rounded-lg text-xs font-bold transition-all flex items-center gap-2 ${activeTab === 'vakasi_loyalis'
                  ? 'bg-white text-indigo-600 shadow-sm border border-slate-200/50'
                  : 'text-slate-500 hover:text-slate-800'
                  }`}
              >
                <Banknote className="w-4.5 h-4.5" />
                Vakasi Tambahan (Loyalis)
              </button>
            </div>

            <Button
              onClick={() => setCetakKegiatanDialogOpen(true)}
              variant="outline"
              className="rounded-xl border-indigo-200 text-indigo-700 bg-indigo-50 hover:bg-indigo-100 hover:border-indigo-300 transition-all font-semibold flex items-center gap-2 shadow-sm cursor-pointer"
            >
              <FileText className="w-4 h-4 text-indigo-600" />
              Laporan Kegiatan Loyalis
            </Button>
          </div>
        )}

        {message && activeTab !== 'vakasi_loyalis' && (
          <div className={`mb-4 flex items-center gap-2 px-4 py-3 rounded-xl text-sm font-medium ${message.type === 'success' ? 'bg-emerald-50 text-emerald-700 border border-emerald-200' : 'bg-red-50 text-red-700 border border-red-200'}`}>
            {message.type === 'success' ? <CheckCircle2 className="w-4 h-4" /> : <AlertCircle className="w-4 h-4" />} {message.text}
          </div>
        )}

        {activeTab === 'presensi' ? (
          <div className="grid grid-cols-1 xl:grid-cols-12 gap-8 items-start">
            {showScanPanel && <div className="xl:col-span-4 space-y-6">
              <Card className="bg-white rounded-[20px] shadow-[0_8px_30px_rgb(0,0,0,0.04)] border-none p-6">
                <div className={`relative p-4 border-2 border-dashed rounded-[20px] transition-all duration-300 ${file ? 'border-indigo-100 bg-indigo-50/20' : 'border-slate-200 hover:border-indigo-300'}`} onDragOver={(e) => e.preventDefault()} onDrop={handleDrop}>
                  {file ? (
                    <div className="space-y-4">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2 text-xs text-slate-600"><FileText className="w-3.5 h-3.5 text-indigo-500" /><span className="truncate max-w-[120px] font-medium">{file.name}</span></div>
                        <div className="flex gap-1">
                          {lastScanResult && <Button variant="ghost" size="icon" onClick={() => setShowDebugModal(true)} className="h-7 w-7 rounded-lg text-indigo-500"><Code2 className="w-3.5 h-3.5" /></Button>}
                          <Button variant={isCropping ? "secondary" : "ghost"} size="icon" onClick={() => setIsCropping(!isCropping)} className="h-7 w-7 rounded-lg"><Crop className={`w-3.5 h-3.5 ${isCropping ? 'text-indigo-600' : 'text-slate-400'}`} /></Button>
                          <Button variant="ghost" size="icon" onClick={handleRotate} className="h-7 w-7 rounded-lg"><RotateCw className="w-3.5 h-3.5" /></Button>
                          <Button variant="ghost" size="icon" onClick={handleClearFile} className="h-7 w-7 rounded-lg text-red-500"><Trash2 className="w-3.5 h-3.5" /></Button>
                        </div>
                      </div>
                      <div ref={containerRef} onMouseMove={onMouseMove} onMouseUp={() => setDragMode('none')} onMouseLeave={() => setDragMode('none')} className="relative aspect-[3/4] w-full bg-white rounded-xl border border-slate-200 overflow-hidden select-none cursor-crosshair">
                        {previewUrl ? (
                          <>
                            <img src={isCropping ? previewUrl : (croppedPreviewUrl || previewUrl)} alt="Preview" className="w-full h-full object-contain pointer-events-none" />
                            {isCropping && (
                              <div className="absolute pointer-events-auto" style={{ left: display.x, top: display.y, width: display.w, height: display.h }}>
                                <div className="absolute top-0 left-0 w-full bg-slate-900/60" style={{ height: `${crop.y}%` }} />
                                <div className="absolute bottom-0 left-0 w-full bg-slate-900/60" style={{ height: `${100 - crop.y - crop.h}%` }} />
                                <div className="absolute top-0 left-0 h-full bg-slate-900/60" style={{ top: `${crop.y}%`, height: `${crop.h}%`, width: `${crop.x}%` }} />
                                <div className="absolute top-0 right-0 h-full bg-slate-900/60" style={{ top: `${crop.y}%`, height: `${crop.h}%`, width: `${100 - crop.x - crop.w}%` }} />
                                <div onMouseDown={(e) => onMouseDown(e, 'move')} className="absolute border-2 border-indigo-400 shadow-[0_0_0_1px_rgba(255,255,255,0.3)] cursor-move" style={{ left: `${crop.x}%`, top: `${crop.y}%`, width: `${crop.w}%`, height: `${crop.h}%` }}>
                                  <div onMouseDown={(e) => onMouseDown(e, 't')} className="absolute -top-1 left-0 w-full h-2 cursor-ns-resize" />
                                  <div onMouseDown={(e) => onMouseDown(e, 'b')} className="absolute -bottom-1 left-0 w-full h-2 cursor-ns-resize" />
                                  <div onMouseDown={(e) => onMouseDown(e, 'l')} className="absolute top-0 -left-1 h-full w-2 cursor-ew-resize" />
                                  <div onMouseDown={(e) => onMouseDown(e, 'r')} className="absolute top-0 -right-1 h-full w-2 cursor-ew-resize" />
                                  <div onMouseDown={(e) => onMouseDown(e, 'tl')} className="absolute -top-2 -left-2 w-4 h-4 cursor-nwse-resize" />
                                  <div onMouseDown={(e) => onMouseDown(e, 'tr')} className="absolute -top-2 -right-2 w-4 h-4 cursor-nesw-resize" />
                                  <div onMouseDown={(e) => onMouseDown(e, 'bl')} className="absolute -bottom-2 -left-2 w-4 h-4 cursor-nesw-resize" />
                                  <div onMouseDown={(e) => onMouseDown(e, 'br')} className="absolute -bottom-2 -right-2 w-4 h-4 cursor-nwse-resize" />
                                </div>
                              </div>
                            )}
                            {isCropping && (<div className="absolute bottom-4 left-4 right-4 bg-white/95 backdrop-blur-md p-2 rounded-xl border border-indigo-100 shadow-2xl z-50 animate-in fade-in slide-in-from-bottom-2"><Button size="sm" className="w-full h-8 text-xs bg-indigo-600 text-white font-bold" onClick={handleDoneCropping}>Confirm Crop</Button></div>)}
                          </>
                        ) : <div className="aspect-[3/4] w-full flex items-center justify-center bg-slate-50 rounded-xl animate-pulse"><Loader2 className="w-6 h-6 animate-spin text-slate-200" /></div>}
                      </div>
                      <div className="pt-2">
                        <Button onClick={handleAiScan} disabled={scanning || !file || !category} className="w-full rounded-xl bg-indigo-600 text-white font-semibold shadow-md shadow-indigo-100 hover:bg-indigo-700 transition-all"><Sparkles className="w-4 h-4 mr-2" /> Scan AI</Button>
                      </div>
                    </div>
                  ) : (
                    <div className="flex flex-col items-center justify-center py-12 text-center cursor-pointer group" onClick={() => fileInputRef.current?.click()}>
                      <div className="w-16 h-16 bg-indigo-50 text-indigo-600 rounded-2xl flex items-center justify-center mb-4 group-hover:scale-110 transition-transform duration-300"><Upload className="w-8 h-8" /></div>
                      <h3 className="text-slate-900 font-semibold mb-1 text-sm">Upload Rekap</h3>
                      <p className="text-slate-500 text-xs mb-6 px-4">Tempel gambar atau tarik file rekap (PDF/PNG/JPG) ke sini.</p>
                      <input type="file" className="hidden" ref={fileInputRef} onChange={(e) => e.target.files?.[0] && handleFileUpload(e.target.files[0])} accept=".pdf,image/*" />
                      <Button variant="outline" className="rounded-xl border-slate-200 text-xs font-semibold group-hover:border-indigo-300 group-hover:text-indigo-600 transition-colors">Pilih File</Button>
                    </div>
                  )}
                </div>
              </Card>
            </div>}

            <Card className={`${showScanPanel ? 'xl:col-span-8' : 'xl:col-span-12'} bg-white rounded-[20px] shadow-[0_8px_30px_rgb(0,0,0,0.04)] border-none overflow-hidden min-h-[500px] flex flex-col transition-all`}>
              <div className="p-5 flex items-center justify-between border-b border-slate-100 bg-white/50 backdrop-blur-sm z-10">
                <h2 className="text-sm font-semibold text-slate-700 flex items-center gap-2"><ImageIcon className="w-4 h-4 text-indigo-500" /> Preview Uraian Gaji — {MONTHS_ID[month - 1]} {year}</h2>
                {category && <span className="text-xs text-slate-400 font-medium bg-slate-50 px-2 py-1 rounded-lg border border-slate-100">{employees.length} Karyawan</span>}
              </div>

              {!category ? (
                <div className="flex-1 flex flex-col items-center justify-center p-12 text-center space-y-6 animate-in fade-in zoom-in-95 duration-500">
                  <div className="w-20 h-20 bg-indigo-50 rounded-full flex items-center justify-center text-indigo-600 shadow-inner">
                    <Building2 className="w-10 h-10" />
                  </div>
                  <div className="space-y-2 max-w-xs">
                    <h3 className="text-lg font-bold text-slate-900 leading-tight">Pilih Satuan Kerja</h3>
                    <p className="text-sm text-slate-500 leading-relaxed">Silahkan pilih unit kerja terlebih dahulu untuk melihat dan mengolah data payroll.</p>
                  </div>

                  <Select value={category} onValueChange={(v) => v && setCategory(v)}>
                    <SelectTrigger className="w-64 h-12 bg-white shadow-xl border-slate-200 rounded-2xl text-indigo-600 font-bold hover:border-indigo-400 transition-all ring-offset-background focus:ring-2 focus:ring-indigo-500/20">
                      <SelectValue placeholder="Pilih Satuan Kerja" />
                    </SelectTrigger>
                    <SelectContent className="rounded-2xl border-slate-100 shadow-2xl overflow-hidden">
                      {allowedCategories.map(c => (
                        <SelectItem key={c} value={c} className="py-3 focus:bg-indigo-50 focus:text-indigo-600 rounded-xl mx-1 my-0.5 transition-colors">
                          <div className="flex items-center gap-2">
                            <div className="w-2 h-2 rounded-full bg-indigo-400" />
                            {c}
                          </div>
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              ) : loadingEmps ? (
                <div className="p-20 flex-1 flex flex-col items-center justify-center text-slate-400"><Loader2 className="w-8 h-8 animate-spin mb-3 text-indigo-400" /><p className="font-medium animate-pulse">Memuat data...</p></div>
              ) : (
                <div className={`overflow-x-auto max-h-[700px] overflow-y-auto ${hasScanData ? 'bg-slate-50/50 p-6' : ''} transition-all duration-500`}>
                  <table className={`w-full text-left ${hasScanData ? 'border-separate border-spacing-y-4' : 'border-collapse'}`}>
                    <thead className="sticky top-0 z-20 bg-[#F8FAFC]">
                      <tr>
                        <th 
                          className={`px-6 py-4 text-[10px] font-bold uppercase text-slate-950 tracking-wider sticky top-0 z-20 bg-[#F8FAFC] ${!hasScanData ? 'border-b border-slate-300' : ''}`}
                          style={{ width: '220px', minWidth: '220px' }}
                        >
                          Nama
                        </th>
                        {columns.map(col => {
                          const hasMultiplier = col.type === 'count' && col.multiplier;
                          const isCustom = col.key.startsWith('custom_');
                          return (
                            <th
                              key={col.key}
                              className={`px-4 py-4 text-[10px] font-bold uppercase text-center tracking-wider sticky top-0 z-20 bg-[#F8FAFC] ${!hasScanData ? 'border-b border-slate-300' : ''}`}
                              style={{ width: '160px', minWidth: '160px' }}
                            >
                              <div className="flex flex-col items-center justify-center gap-0.5 relative group/header">
                                <div className="flex items-center justify-center gap-1">
                                  <span className="text-slate-950">{col.label}</span>
                                  {isCustom && (
                                    <button
                                      onClick={() => handleRemoveCustomColumn(col.key)}
                                      className="text-slate-400 hover:text-red-500 rounded-full hover:bg-slate-100 p-0.5 transition-colors opacity-0 group-hover/header:opacity-100 cursor-pointer flex-shrink-0"
                                      title="Hapus kolom kustom"
                                    >
                                      <X className="w-3 h-3" />
                                    </button>
                                  )}
                                </div>
                                {hasMultiplier && (
                                  <span className="text-[9px] font-bold text-blue-700 normal-case tracking-normal italic">
                                    (xRp{col.multiplier?.toLocaleString('id-ID')})
                                  </span>
                                )}
                              </div>
                            </th>
                          );
                        })}
                        {hasScanData && <th className="w-10 sticky top-0 z-20 bg-[#F8FAFC]"></th>}
                      </tr>
                    </thead>
                    {employees.map((emp, empIdx) => {
                      const bounds = rowBounds[emp.employeeId];
                      const content = (
                        <>
                          {hasScanData && bounds && (croppedPreviewUrl || previewUrl) && scanImgDims && (
                            <tr className="animate-in fade-in slide-in-from-top-4 duration-500">
                              <td colSpan={columns.length + 2} className="p-0">
                                <div className="mx-2 border-x-2 border-t-2 border-slate-400 rounded-t-2xl overflow-hidden bg-white shadow-sm ring-1 ring-black/15">
                                  <div className="px-4 py-1.5 bg-slate-50 flex items-center justify-between border-b border-slate-300">
                                    <div className="flex items-center gap-2">
                                      <div className="w-5 h-5 rounded-full bg-indigo-600 text-white text-[10px] flex items-center justify-center font-bold shadow-sm">{empIdx + 1}</div>
                                      <span className="text-[10px] font-bold text-slate-500 uppercase tracking-tight">Source Image Row</span>
                                    </div>
                                    <div className="text-[10px] text-indigo-600 font-bold opacity-70 flex items-center gap-1"><Eye className="w-3 h-3" /> REF: {emp.name}</div>
                                  </div>
                                  <div className="relative w-full overflow-hidden bg-white" style={{ aspectRatio: `${scanImgDims.w} / ${bounds.bottom - bounds.top + 20}` }}>
                                    <img src={croppedPreviewUrl || previewUrl || ''} alt="Slice" className="absolute left-0 w-full max-w-none" style={{ transform: `translateY(-${((bounds.top - 10) / scanImgDims.h) * 100}%)`, filter: 'contrast(1.1) brightness(1.02)' }} />
                                  </div>
                                </div>
                              </td>
                            </tr>
                          )}
                          <tr className={`${hasScanData ? 'group-hover/row:bg-indigo-50/30' : 'hover:bg-slate-50'} transition-all duration-200`}>
                            <td 
                              className={`px-6 py-5 ${hasScanData ? `mx-2 border-l-2 border-y-2 border-slate-400 ${!bounds ? 'rounded-l-2xl' : ''} bg-white shadow-sm ring-1 ring-black/15` : 'border-b border-slate-300'}`}
                              style={{ width: '220px', minWidth: '220px' }}
                            >
                              <div className="text-sm font-bold text-slate-800 leading-none">{emp.name}</div>
                              <div className="text-[10px] text-slate-400 font-mono mt-1.5 flex items-center gap-1"><Code2 className="w-2.5 h-2.5 opacity-50" /> {emp.employeeId}</div>
                            </td>
                            {columns.map((col, colIdx) => {
                              const isSpj = col.key === 'spj';
                              const cellValue = (isSpj && tableData[emp.employeeId]?.[col.key] === undefined)
                                ? (getComputedSpj(emp.employeeId) || 0) 
                                : (tableData[emp.employeeId]?.[col.key] ?? '');
                              return (
                                <td 
                                  key={col.key} 
                                  className={`px-3 py-5 ${hasScanData ? 'border-y-2 border-slate-400 bg-white shadow-sm ring-1 ring-black/15' : 'border-b border-slate-300'}`}
                                  style={{ width: '160px', minWidth: '160px' }}
                                >
                                  <Input
                                    id={`cell-${empIdx}-${colIdx}`}
                                    type="text"
                                    value={cellValue}
                                    onChange={(e) => updateCell(emp.employeeId, col.key, e.target.value)}
                                    className={`h-10 text-center font-bold transition-all ${
                                      isSpj
                                        ? 'bg-indigo-50/30 border-indigo-200 focus:bg-white focus:border-indigo-500 focus:ring-4 focus:ring-indigo-500/10'
                                        : hasScanData
                                          ? 'rounded-xl border-slate-400 bg-slate-50/50 focus:bg-white focus:border-indigo-500 focus:ring-4 focus:ring-indigo-500/10'
                                          : 'bg-white border-slate-400 focus:border-indigo-400 focus:ring-4 focus:ring-indigo-500/10'
                                    }`}
                                    onKeyDown={(e) => {
                                      let nextRow = empIdx, nextCol = colIdx, shouldMove = false;
                                      if (e.key === 'Enter') { e.preventDefault(); shouldMove = true; if (e.shiftKey) { nextCol = colIdx + 1; if (nextCol >= columns.length) { nextCol = 0; nextRow = empIdx + 1; } } else nextRow = empIdx + 1; }
                                      else if (e.key === 'ArrowDown') { e.preventDefault(); nextRow = empIdx + 1; shouldMove = true; }
                                      else if (e.key === 'ArrowUp') { e.preventDefault(); nextRow = empIdx - 1; shouldMove = true; }
                                      else if (e.key === 'ArrowRight') { const target = e.target as HTMLInputElement; if (target.selectionStart === target.value.length) { e.preventDefault(); nextCol = colIdx + 1; shouldMove = true; } }
                                      else if (e.key === 'ArrowLeft') { const target = e.target as HTMLInputElement; if (target.selectionStart === 0) { e.preventDefault(); nextCol = colIdx - 1; shouldMove = true; } }
                                      if (shouldMove) {
                                        const nextId = `cell-${nextRow}-${nextCol}`, nextEl = document.getElementById(nextId);
                                        if (nextEl) { nextEl.focus(); (nextEl as HTMLInputElement).select(); }
                                      }
                                    }}
                                  />
                                </td>
                              );
                            })}
                            {hasScanData && <td className="p-0 border-r-2 border-y-2 border-slate-400 rounded-r-2xl bg-white shadow-sm ring-1 ring-black/15" />}
                          </tr>
                        </>
                      );
                      return hasScanData ? (<tbody key={emp.employeeId} className="group/row">{content}</tbody>) : (<tbody key={emp.employeeId}>{content}</tbody>);
                    })}
                  </table>
                </div>
              )}
            </Card>
          </div>
        ) : activeTab === 'vakasi_loyalis' ? (
          /* Tab 2: Vakasi Tambahan (Loyalis) UI */
          <div className="space-y-8 animate-in fade-in duration-500">
            <div className="grid grid-cols-1 xl:grid-cols-12 gap-8 items-start">
            {/* Left side list of existing events */}
            <div className="xl:col-span-4 space-y-6">
              <Card className="bg-white rounded-[20px] shadow-[0_8px_30px_rgb(0,0,0,0.04)] border-none p-6">
                <div className="flex justify-between items-center mb-4">
                  <h3 className="font-bold text-slate-800 text-sm">Daftar Kegiatan</h3>
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
                    }}
                    size="sm"
                    className="bg-indigo-50 text-indigo-600 hover:bg-indigo-100 rounded-xl font-bold flex items-center gap-1.5"
                  >
                    <Plus className="w-3.5 h-3.5" />
                    Baru
                  </Button>
                </div>

                {loadingEvents ? (
                  <div className="py-12 flex justify-center text-slate-400">
                    <Loader2 className="w-6 h-6 animate-spin" />
                  </div>
                ) : existingEvents.length === 0 && selectedEventId !== null ? (
                  <div className="py-12 text-center text-slate-400 text-xs font-semibold">
                    <Calendar className="w-8 h-8 mx-auto mb-2 opacity-30" />
                    Belum ada kegiatan terdaftar di periode ini.
                  </div>
                ) : (
                  <div className="space-y-3 max-h-[500px] overflow-y-auto pr-1">
                    {/* Empty / Draft Kegiatan Card */}
                    {!selectedEventId && (
                      <div
                        className="p-4 rounded-2xl border bg-indigo-50/30 border-indigo-200 shadow-sm border-dashed animate-in fade-in"
                      >
                        <p className="font-bold text-indigo-600 text-sm line-clamp-1 italic">
                          {eventName.trim() !== '' ? eventName : 'Kegiatan Baru (Tanpa Nama)'}
                        </p>
                        <div className="flex items-center justify-between mt-3">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="text-[10px] text-indigo-400 font-bold bg-indigo-50/50 px-2 py-0.5 rounded border border-indigo-100">
                              {workerRows.filter(r => r.employeeId).length} Orang
                            </span>
                            <span className={`text-[10px] font-bold px-2 py-0.5 rounded border ${
                              isEndOfMonth 
                                ? 'bg-amber-50 text-amber-700 border-amber-100' 
                                : 'bg-emerald-50 text-emerald-700 border-emerald-100'
                            }`}>
                              {isEndOfMonth ? 'Akhir Bulan' : 'Tengah Bulan'}
                            </span>
                          </div>
                          <span className="text-xs font-bold text-indigo-600">
                            {fmtRp(workerRows.reduce((sum, r) => sum + (r.payGiven || 0), 0))}
                          </span>
                        </div>
                        {!isEndOfMonth && selectedDept && (
                          <div className="mt-2 flex items-center gap-1.5">
                            <span className="inline-flex items-center gap-1 text-[10px] font-bold text-indigo-600 bg-indigo-50 border border-indigo-200 px-2 py-0.5 rounded-full">
                              <Building2 className="w-2.5 h-2.5" />
                              {selectedDept}
                            </span>
                          </div>
                        )}
                      </div>
                    )}

                    {existingEvents.map(evt => {
                      const isActive = selectedEventId === evt.id;
                      return (
                        <div
                          key={evt.id}
                          onClick={() => {
                            setSelectedEventId(evt.id);
                            setEventName(evt.eventName);
                            setIsEndOfMonth(!!evt.isEndOfMonth);
                            setSelectedDept(evt.departmentUnit || '');
                            // Load workers
                            const workers = evt.eventWorkers || {};
                            const rows = Object.entries(workers).map(([id, w]: [string, any]) => ({
                              employeeId: id,
                                  employeeName: w.employeeName,
                              payGiven: w.payGiven,
                              searchText: w.employeeName,
                              showDropdown: false,
                            }));
                            setWorkerRows(rows);
                            setReportFileUrl(evt.reportFileUrl || null);
                            setReportFileName(evt.reportFileName || null);
                            setReportFile(null);
                            setCurrentEventStatus(evt.status || null);
                            setCurrentEventReviewNote(evt.reviewNote || null);
                            setCurrentEventSubmittedBy(evt.submittedBy || null);
                            setCurrentEventSubmittedByName(evt.submittedByName || null);
                          }}
                          className={`p-4 rounded-2xl border transition-all cursor-pointer outline-none focus:outline-none ${getCardBgClass(evt.status, isActive)}`}
                        >
                          <p className="font-bold text-slate-800 text-sm line-clamp-1">{evt.eventName}</p>
                          <div className="flex items-center justify-between mt-3">
                            <div className="flex items-center gap-2 flex-wrap">
                              <span className="text-[10px] text-slate-400 font-bold bg-slate-50 px-2 py-0.5 rounded border border-slate-100">
                                {Object.keys(evt.eventWorkers || {}).length} Orang
                              </span>
                              <span className={`text-[10px] font-bold px-2 py-0.5 rounded border ${
                                evt.isEndOfMonth 
                                  ? 'bg-amber-50 text-amber-700 border-amber-100' 
                                  : 'bg-emerald-50 text-emerald-700 border-emerald-100'
                              }`}>
                                {evt.isEndOfMonth ? 'Akhir Bulan' : 'Tengah Bulan'}
                              </span>
                              {!evt.isEndOfMonth && getStatusBadge(evt.status)}
                            </div>
                            <span className="text-xs font-bold text-indigo-600">
                              {fmtRp(evt.totalPayout || 0)}
                            </span>
                          </div>
                          {!evt.isEndOfMonth && ['revision_needed', 'declined'].includes(evt.status) && evt.reviewNote && (
                            <div className="mt-2 text-[10px] text-rose-600 bg-rose-50/50 border border-rose-100 rounded-lg p-2 font-medium line-clamp-2">
                              <strong>Catatan:</strong> {evt.reviewNote}
                            </div>
                          )}
                          {!evt.isEndOfMonth && evt.departmentUnit && (
                            <div className="mt-2 flex items-center gap-1.5">
                              <span className="inline-flex items-center gap-1 text-[10px] font-bold text-indigo-600 bg-indigo-50 border border-indigo-200 px-2 py-0.5 rounded-full">
                                <Building2 className="w-2.5 h-2.5" />
                                {evt.departmentUnit}
                              </span>
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </Card>
            </div>

            {/* Right side form */}
            <Card className={`xl:col-span-8 rounded-[20px] shadow-[0_8px_30px_rgb(0,0,0,0.04)] overflow-visible min-h-[500px] flex flex-col p-6 space-y-6 animate-in fade-in duration-500 transition-colors duration-300 ${
              currentEventStatus === 'pending_review'
                ? 'bg-amber-50/40 border border-amber-200/50'
                : 'bg-white border-none'
            }`}>
               <div className="flex justify-between items-center border-b border-slate-50 pb-4">
                <div className="flex items-center gap-3">
                  <div>
                    <h3 className="font-bold text-slate-800 text-sm flex items-center gap-2">
                      <Banknote className="w-4 h-4 text-indigo-500" />
                      {selectedEventId ? 'Ubah Kegiatan' : 'Buat Kegiatan Baru'}
                    </h3>
                    <p className="text-slate-400 text-xs mt-0.5">Input detail kegiatan dan daftarkan pegawai loyalis penerima payout.</p>
                  </div>
                  {selectedEventId && (
                    <div className="self-start mt-0.5">
                      {getStatusBadge(currentEventStatus || undefined)}
                    </div>
                  )}
                </div>
                {selectedEventId && (profile?.role === 'super_admin' || !currentEventStatus || ['draft', 'pending_review', 'revision_needed'].includes(currentEventStatus)) && (
                  <Button
                    variant="ghost"
                    onClick={() => handleDeleteEvent(selectedEventId)}
                    disabled={saving}
                    className="text-rose-500 hover:text-rose-600 hover:bg-rose-50 rounded-xl"
                  >
                    <Trash2 className="w-4 h-4 mr-2" />
                    Hapus
                  </Button>
                )}
              </div>

              {/* Revision note banner */}
              {selectedEventId && currentEventStatus === 'revision_needed' && currentEventReviewNote && (
                <div className="p-4 bg-orange-50 border border-orange-100 rounded-2xl flex gap-3 text-orange-800 text-xs animate-in slide-in-from-top-1 duration-200">
                  <AlertCircle className="w-5 h-5 text-orange-500 shrink-0" />
                  <div>
                    <p className="font-bold">Revisi Diperlukan dari Super Admin</p>
                    <p className="mt-1 font-medium text-orange-700">{currentEventReviewNote}</p>
                  </div>
                </div>
              )}
              {selectedEventId && currentEventStatus === 'declined' && currentEventReviewNote && (
                <div className="p-4 bg-rose-50 border border-rose-100 rounded-2xl flex gap-3 text-rose-800 text-xs animate-in slide-in-from-top-1 duration-200">
                  <XCircle className="w-5 h-5 text-rose-500 shrink-0" />
                  <div>
                    <p className="font-bold">Kegiatan ini Ditolak</p>
                    <p className="mt-1 font-medium text-rose-700">{currentEventReviewNote}</p>
                  </div>
                </div>
              )}

              {/* Event Name Input */}
              <div className="space-y-2">
                <label className="text-xs font-bold text-slate-500 uppercase tracking-wider block">Nama Kegiatan</label>
                <Input
                  type="text"
                  placeholder="Contoh: Vakasi Kepanitiaan Kerja Praktek 2025/26"
                  value={eventName}
                  disabled={isReadOnly}
                  onChange={(e) => setEventName(e.target.value)}
                  onBlur={() => {
                    handleAutosave(workerRows, eventName, selectedEventId);
                  }}
                  className="rounded-xl border-slate-200 font-bold text-slate-800 text-sm focus:border-indigo-500 focus:ring-4 focus:ring-indigo-100 h-11"
                />
              </div>

              {/* Event Period Type Segmented Toggle */}
              {profile?.role !== 'satker_head_loyalis' && (
                <div className="space-y-2">
                  <label className="text-xs font-bold text-slate-500 uppercase tracking-wider block">Tipe Kegiatan</label>
                  <div className="grid grid-cols-2 gap-2 bg-slate-50 p-1.5 rounded-2xl border border-slate-100/80">
                    <button
                      type="button"
                      disabled={isReadOnly}
                      onClick={() => {
                        setIsEndOfMonth(false);
                        handleAutosave(workerRows, eventName, selectedEventId, false);
                      }}
                      className={`py-2.5 px-4 rounded-xl text-xs font-bold transition-all duration-200 ${
                        !isEndOfMonth
                          ? 'bg-white text-indigo-600 shadow-sm border border-slate-200/50'
                          : 'text-slate-500 hover:text-slate-800'
                      }`}
                    >
                      Tengah Bulan (Vakasi Tambahan)
                    </button>
                    <button
                      type="button"
                      disabled={isReadOnly}
                      onClick={() => {
                        setIsEndOfMonth(true);
                        handleAutosave(workerRows, eventName, selectedEventId, true);
                      }}
                      className={`py-2.5 px-4 rounded-xl text-xs font-bold transition-all duration-200 ${
                        isEndOfMonth
                          ? 'bg-white text-indigo-600 shadow-sm border border-slate-200/50'
                          : 'text-slate-500 hover:text-slate-800'
                      }`}
                    >
                      Akhir Bulan (Kolom Tersendiri)
                    </button>
                  </div>
                </div>
              )}

              {/* Department Selector & File Upload (only visible when Tengah Bulan is active) */}
              {!isEndOfMonth && (
                <div className="space-y-6">
                  {/* Department Selector */}
                  <div className="space-y-2 animate-in fade-in slide-in-from-top-1 duration-300">
                    <label className="text-xs font-bold text-slate-500 uppercase tracking-wider flex items-center gap-1.5">
                      <Building2 className="w-3.5 h-3.5 text-indigo-400" />
                      Unit Kerja (Department)
                    </label>
                    <Select
                      value={selectedDept}
                      disabled={isReadOnly}
                      onValueChange={(val) => {
                        setSelectedDept(val || '');
                        handleAutosave(workerRows, eventName, selectedEventId, false, val || undefined);
                      }}
                    >
                      <SelectTrigger className={`rounded-xl text-sm font-bold h-11 transition-all duration-200 border focus:ring-4 focus:ring-indigo-100 focus:border-indigo-300 ${
                        selectedDept
                          ? 'bg-indigo-50/60 border-indigo-200 text-indigo-700'
                          : 'bg-white border-slate-200 text-slate-400'
                      }`}>
                        <div className="flex items-center gap-2 min-w-0">
                          <Building2 className={`w-4 h-4 shrink-0 ${selectedDept ? 'text-indigo-500' : 'text-slate-300'}`} />
                          <SelectValue placeholder="Pilih Unit Kerja..." />
                        </div>
                      </SelectTrigger>
                      <SelectContent alignItemWithTrigger={false} sideOffset={4} className="rounded-2xl border border-slate-100 shadow-2xl bg-white p-1.5 max-h-64 overflow-y-auto w-max min-w-[var(--radix-select-trigger-width)]">
                        {/* Clear / All option */}
                        <SelectItem
                          value=""
                          className="rounded-xl text-xs font-bold text-slate-500 hover:bg-slate-50 focus:bg-slate-50 focus:text-slate-700 flex items-center gap-2 mb-1 border border-dashed border-slate-200 data-[highlighted]:bg-slate-50 data-[highlighted]:text-slate-700"
                        >
                          <span className="flex items-center gap-1.5">
                            <span className="w-4 h-4 flex items-center justify-center rounded-full bg-slate-100 text-slate-400 text-[9px] font-black">✕</span>
                            Semua Unit Kerja
                          </span>
                        </SelectItem>
                        <div className="h-px bg-slate-100 my-1" />
                        {departments.map(dept => (
                          <SelectItem
                            key={dept}
                            value={dept}
                            className="rounded-xl text-xs font-bold uppercase text-slate-700 data-[highlighted]:bg-indigo-50 data-[highlighted]:text-indigo-700 data-[state=checked]:bg-indigo-50 data-[state=checked]:text-indigo-700 focus:bg-indigo-50 focus:text-indigo-700 cursor-pointer"
                          >
                            <span className="flex items-center gap-2">
                              <span className="w-1.5 h-1.5 rounded-full bg-indigo-300 shrink-0" />
                              {dept}
                            </span>
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    {selectedDept && (
                      <p className="text-[10px] text-indigo-500 font-bold flex items-center gap-1 animate-in fade-in duration-200">
                        <span className="w-1.5 h-1.5 rounded-full bg-indigo-400 inline-block" />
                        Unit Kerja terpilih: <span className="underline underline-offset-2">{selectedDept}</span> (Daftar pegawai tidak dibatasi)
                      </p>
                    )}
                  </div>

                  {/* File Upload Area for SatKer Loyalis scanned report */}
                  {(profile?.role === 'satker_head_loyalis' || reportFileUrl) && (
                    <div className="space-y-2 animate-in fade-in slide-in-from-top-1 duration-300">
                      <label className="text-xs font-bold text-slate-500 uppercase tracking-wider flex items-center gap-1.5">
                        <FileText className="w-3.5 h-3.5 text-indigo-400" />
                        Laporan Resmi yang Ditandatangani (Scanned Report)
                      </label>
                      
                      {reportFileUrl ? (
                        /* Show Preview/FileInfo */
                        <div className="flex items-center justify-between p-3.5 bg-indigo-50/50 border border-indigo-100 rounded-2xl">
                          <div className="flex items-center gap-3 min-w-0">
                            <div className="w-10 h-10 rounded-xl bg-indigo-100 flex items-center justify-center text-indigo-600 shrink-0">
                              {reportFileName?.toLowerCase().endsWith('.pdf') ? (
                                <FileText className="w-5 h-5" />
                              ) : (
                                <ImageIcon className="w-5 h-5" />
                              )}
                            </div>
                            <div className="min-w-0">
                              <p className="text-xs font-bold text-slate-700 truncate max-w-[200px] md:max-w-xs">
                                {reportFileName || 'Laporan_Vakasi.pdf'}
                              </p>
                              <p className="text-[10px] text-indigo-500 font-medium">Berhasil diunggah</p>
                            </div>
                          </div>
                          
                          <div className="flex items-center gap-2">
                            {/* Preview button */}
                            <Button
                              type="button"
                              variant="ghost"
                              size="sm"
                              onClick={() => {
                                if (reportFileUrl.toLowerCase().includes('.pdf') || reportFileName?.toLowerCase().endsWith('.pdf')) {
                                  window.open(reportFileUrl, '_blank');
                                } else {
                                  setLightboxUrl(reportFileUrl);
                                }
                              }}
                              className="h-8 text-xs font-bold text-indigo-600 hover:text-indigo-700 hover:bg-indigo-100/50 rounded-lg px-2.5 flex items-center gap-1"
                            >
                              <Eye className="w-3.5 h-3.5" />
                              Buka
                            </Button>
                            
                            {/* Remove file button */}
                            {!isReadOnly && profile?.role === 'satker_head_loyalis' && (
                              <Button
                                type="button"
                                variant="ghost"
                                size="icon"
                                onClick={() => {
                                  setReportFile(null);
                                  setReportFileUrl(null);
                                  setReportFileName(null);
                                }}
                                className="h-8 w-8 text-rose-500 hover:text-rose-600 hover:bg-rose-50 rounded-lg"
                              >
                                <X className="w-4 h-4" />
                              </Button>
                            )}
                          </div>
                        </div>
                      ) : (
                        /* Show Upload Drag-and-Drop Area */
                        profile?.role === 'satker_head_loyalis' && (
                          <div className="border-2 border-dashed border-slate-200 hover:border-indigo-400 rounded-2xl p-6 text-center transition-all bg-slate-50/50 cursor-pointer relative group">
                            <input
                              type="file"
                              accept=".pdf,image/jpeg,image/jpg,image/png"
                              onChange={(e) => {
                                const file = e.target.files?.[0];
                                if (file) handleReportFileChange(file);
                              }}
                              disabled={uploadingReport}
                              className="absolute inset-0 w-full h-full opacity-0 cursor-pointer animate-none"
                            />
                            <div className="flex flex-col items-center justify-center space-y-2">
                              {uploadingReport ? (
                                <>
                                  <Loader2 className="w-8 h-8 text-indigo-500 animate-spin" />
                                  <p className="text-xs font-bold text-slate-600">Mengunggah file...</p>
                                </>
                              ) : (
                                <>
                                  <Upload className="w-8 h-8 text-slate-400 group-hover:text-indigo-500 transition-colors" />
                                  <p className="text-xs font-bold text-slate-600">
                                    <span className="text-indigo-600 underline">Pilih file</span> atau seret ke sini
                                  </p>
                                  <p className="text-[10px] text-slate-400 font-medium">Format: PDF, JPG, JPEG, PNG (Maks 10MB)</p>
                                </>
                              )}
                            </div>
                          </div>
                        )
                      )}
                    </div>
                  )}
                </div>
              )}

              {/* Live Running Total header mockup in Excel screenshot */}
              <div className="bg-blue-50/20 backdrop-blur-sm rounded-2xl p-6 text-blue-900 shadow-[0_4px_20px_rgba(59,130,246,0.05)] flex items-center justify-between border-2 border-blue-500 transition-all duration-300">
                <div>
                  <span className="text-[10px] text-blue-600 font-bold uppercase tracking-widest">Aggregate Validation</span>
                  <h4 className="text-xl font-black mt-1 text-blue-900">JUMLAH</h4>
                </div>
                <div className="text-right">
                  <span className="text-[10px] text-blue-600 font-bold uppercase tracking-widest">Total Payout</span>
                  <p className="text-3xl font-black text-blue-800 mt-1 tracking-tight">
                    {fmtRp(workerRows.reduce((sum, r) => sum + (r.payGiven || 0), 0))}
                  </p>
                </div>
              </div>

              {/* Iterative Workers grid */}
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold text-slate-500 uppercase tracking-wider">Daftar Pegawai &amp; Jumlah</span>
                </div>

                <div className="border border-slate-100 rounded-2xl shadow-sm overflow-visible bg-white">
                  <table className="w-full text-left border-collapse">
                    <thead>
                      <tr className="bg-slate-50 border-b border-slate-100">
                        <th className="px-4 py-3 text-[10px] font-bold text-slate-500 uppercase w-12 text-center">NO</th>
                        <th className="px-4 py-3 text-[10px] font-bold text-slate-500 uppercase">NAMA PEGAWAI</th>
                        <th className="px-4 py-3 text-[10px] font-bold text-slate-500 uppercase w-[220px]">JUMLAH (RP)</th>
                        {!isReadOnly && <th className="px-4 py-3 text-[10px] font-bold text-slate-500 uppercase w-16 text-center">AKSI</th>}
                      </tr>
                    </thead>
                    <tbody>
                      {workerRows.length === 0 ? (
                        <tr>
                          <td colSpan={isReadOnly ? 3 : 4} className="text-center py-12 text-slate-400 text-xs font-semibold">
                            Belum ada pegawai ditambahkan. Klik tombol di bawah untuk menambahkan.
                          </td>
                        </tr>
                      ) : (
                        workerRows.map((row, rowIdx) => {
                          const handleEmployeeSearch = (index: number, text: string) => {
                            setWorkerRows(prev => {
                              const copy = [...prev];
                              copy[index] = { ...copy[index], searchText: text, showDropdown: true };
                              return copy;
                            });
                            setActiveSuggestionIndex(0);
                          };
                          const selectEmployee = (index: number, emp: any) => {
                            setWorkerRows(prev => {
                              const copy = [...prev];
                              copy[index] = {
                                ...copy[index],
                                employeeId: emp.id,
                                employeeName: emp.name,
                                searchText: emp.name,
                                showDropdown: false,
                              };
                              if (copy[index].employeeId && copy[index].payGiven > 0) {
                                handleAutosave(copy, eventName, selectedEventId);
                              }
                              return copy;
                            });
                            setTimeout(() => {
                              const inputEl = document.getElementById(`pay-input-${index}`);
                              if (inputEl) {
                                inputEl.focus();
                                (inputEl as HTMLInputElement).select();
                              }
                            }, 50);
                          };

                          return (
                            <tr key={rowIdx} className={`border-b border-slate-50 hover:bg-slate-50/30 transition-colors animate-in fade-in slide-in-from-top-1 ${row.showDropdown ? 'relative z-50' : 'relative z-0'}`}>
                              <td className="px-4 py-4 text-xs font-bold text-slate-400 text-center">
                                {rowIdx + 1}
                              </td>
                              <td className="px-4 py-4 relative">
                                <div className="relative">
                                  <Input
                                    id={`search-input-${rowIdx}`}
                                    type="text"
                                    placeholder="Cari nama pegawai..."
                                    value={row.searchText || ''}
                                    disabled={isReadOnly}
                                    onChange={(e) => handleEmployeeSearch(rowIdx, e.target.value)}
                                    onFocus={() => {
                                      setWorkerRows(prev => {
                                        const copy = [...prev];
                                        copy[rowIdx] = { ...copy[rowIdx], showDropdown: true };
                                        return copy;
                                      });
                                      setActiveSuggestionIndex(0);
                                    }}
                                    onBlur={() => {
                                      setTimeout(() => {
                                        setWorkerRows(prev => {
                                          const copy = [...prev];
                                          if (copy[rowIdx]) {
                                            copy[rowIdx] = { ...copy[rowIdx], showDropdown: false };
                                          }
                                          return copy;
                                        });
                                      }, 200);
                                    }}
                                    onKeyDown={(e) => {
                                      const otherSelectedIds = workerRows
                                        .filter((_, i) => i !== rowIdx)
                                        .map(w => w.employeeId)
                                        .filter(Boolean);
                                      const filtered = loyalisEmployees
                                        .filter(emp => !otherSelectedIds.includes(emp.id))
                                        
                                        .filter(emp =>
                                          emp.name.toLowerCase().includes((row.searchText || '').toLowerCase())
                                        );
                                      if (row.showDropdown && filtered.length > 0) {
                                        if (e.key === 'ArrowDown') {
                                          e.preventDefault();
                                          setActiveSuggestionIndex(prev => (prev + 1) % filtered.length);
                                        } else if (e.key === 'ArrowUp') {
                                          e.preventDefault();
                                          setActiveSuggestionIndex(prev => (prev - 1 + filtered.length) % filtered.length);
                                        } else if (e.key === 'Enter') {
                                          e.preventDefault();
                                          const selectedEmp = filtered[activeSuggestionIndex];
                                          if (selectedEmp) {
                                            selectEmployee(rowIdx, selectedEmp);
                                          }
                                        }
                                      }
                                    }}
                                    className="rounded-xl border-slate-200 font-bold text-slate-700 text-xs h-10 w-full"
                                  />
                                  {row.showDropdown && (
                                    <div className="absolute left-0 right-0 mt-1 bg-white border border-slate-200 rounded-xl shadow-2xl z-[999] max-h-48 overflow-y-auto divide-y divide-slate-50 animate-in fade-in slide-in-from-top-1">
                                      {(() => {
                                        const otherSelectedIds = workerRows
                                          .filter((_, i) => i !== rowIdx)
                                          .map(w => w.employeeId)
                                          .filter(Boolean);
                                        const filtered = loyalisEmployees
                                          .filter(emp => !otherSelectedIds.includes(emp.id))
                                          .filter(emp =>
                                            emp.name.toLowerCase().includes((row.searchText || '').toLowerCase())
                                          );

                                        if (filtered.length === 0) {
                                          return <div className="p-4 text-center text-slate-400 text-xs font-semibold">Pegawai tidak ditemukan</div>;
                                        }

                                        return filtered.map((emp, empIdx) => {
                                          const isActive = empIdx === activeSuggestionIndex;
                                          return (
                                            <div
                                              key={emp.id}
                                              onClick={() => selectEmployee(rowIdx, emp)}
                                              className={`px-4 py-2.5 text-xs font-semibold cursor-pointer transition-colors text-left ${isActive
                                                ? 'bg-indigo-50 text-indigo-600 font-bold'
                                                : 'hover:bg-indigo-50 hover:text-indigo-600 text-slate-700'
                                                }`}
                                            >
                                              <p className={isActive ? 'text-indigo-700' : 'text-slate-800'}>{emp.name}</p>
                                              <p className={`text-[10px] font-mono mt-0.5 ${isActive ? 'text-indigo-400' : 'text-slate-400'}`}>{emp.role} · {emp.id}</p>
                                            </div>
                                          );
                                        });
                                      })()}
                                    </div>
                                  )}
                                </div>
                                {row.employeeId && (
                                  <span className="text-[9px] font-bold text-indigo-500 font-mono mt-1 block">ID: {row.employeeId}</span>
                                )}
                              </td>
                              <td className="px-4 py-4">
                                <Input
                                  id={`pay-input-${rowIdx}`}
                                  type="text"
                                  inputMode="numeric"
                                  pattern="[0-9]*"
                                  placeholder="0"
                                  value={row.payGiven > 0 ? fmtRp(row.payGiven) : ''}
                                  disabled={isReadOnly}
                                  onChange={(e) => {
                                    const inputEl = e.target;
                                    const rawVal = inputEl.value.replace(/\D/g, '');
                                    const val = parseInt(rawVal, 10) || 0;

                                    const selectionStart = inputEl.selectionStart || 0;
                                    const valueBefore = inputEl.value;
                                    const digitsBeforeCursor = valueBefore.slice(0, selectionStart).replace(/\D/g, '').length;

                                    setWorkerRows(prev => {
                                      const copy = [...prev];
                                      copy[rowIdx] = { ...copy[rowIdx], payGiven: val };
                                      return copy;
                                    });

                                    requestAnimationFrame(() => {
                                      if (!inputEl) return;
                                      const newValue = inputEl.value;
                                      let newSelectionStart = selectionStart;
                                      if (digitsBeforeCursor > 0) {
                                        let digitsFound = 0;
                                        for (let i = 0; i < newValue.length; i++) {
                                          if (/\d/.test(newValue[i])) {
                                            digitsFound++;
                                          }
                                          if (digitsFound === digitsBeforeCursor) {
                                            newSelectionStart = i + 1;
                                            break;
                                          }
                                        }
                                      }
                                      inputEl.setSelectionRange(newSelectionStart, newSelectionStart);
                                    });
                                  }}
                                  onBlur={() => {
                                    if (row.employeeId && row.payGiven > 0) {
                                      handleAutosave(workerRows, eventName, selectedEventId);
                                    }
                                  }}
                                  onKeyDown={(e) => {
                                    if (e.key === 'Enter') {
                                      e.preventDefault();
                                      if (row.employeeId && row.payGiven > 0) {
                                        handleAutosave(workerRows, eventName, selectedEventId);
                                      }
                                      handleAddRow();
                                    }
                                  }}
                                  className="rounded-xl border-slate-200 font-bold text-slate-700 text-xs h-10 w-full text-right"
                                />
                              </td>
                              {!isReadOnly && (
                                <td className="px-4 py-4 text-center">
                                  <Button
                                    type="button"
                                    variant="ghost"
                                    size="icon"
                                    onClick={() => {
                                      setWorkerRows(prev => {
                                        const copy = prev.filter((_, i) => i !== rowIdx);
                                        handleAutosave(copy, eventName, selectedEventId);
                                        return copy;
                                      });
                                    }}
                                    className="text-rose-500 hover:text-rose-600 hover:bg-rose-50 rounded-xl h-8 w-8"
                                  >
                                    <Trash2 className="w-3.5 h-3.5" />
                                  </Button>
                                </td>
                              )}
                            </tr>
                          );
                        })
                      )}
                    </tbody>
                  </table>
                </div>

                {/* Add Employee button below the table */}
                {!isReadOnly && (
                  <div className="flex justify-end">
                    <Button
                      type="button"
                      onClick={handleAddRow}
                      className="bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl text-xs font-bold px-4 h-9.5 shadow-md flex items-center gap-1.5 transition-all active:scale-95"
                    >
                      <Plus className="w-3.5 h-3.5" />
                      Tambah Pegawai
                    </Button>
                  </div>
                )}
              </div>

              {/* Error indicator bar below +Tambah Pegawai button */}
              {message && (
                <div className={`flex items-center gap-2 px-4 py-3 rounded-xl text-sm font-medium ${message.type === 'success' ? 'bg-emerald-50 text-emerald-700 border border-emerald-200' : 'bg-red-50 text-red-700 border border-red-200'} animate-in fade-in duration-300`}>
                  {message.type === 'success' ? <CheckCircle2 className="w-4 h-4" /> : <AlertCircle className="w-4 h-4" />} {message.text}
                </div>
              )}

              {/* Form submit footer actions */}
              <div className="flex justify-between items-center pt-4 border-t border-slate-50 shrink-0">
                {/* Left side: Review actions for Super Admin on pending events */}
                <div>
                  {profile?.role === 'super_admin' && selectedEventId && currentEventStatus === 'pending_review' && (
                    <div className="flex gap-2">
                      <Button
                        type="button"
                        onClick={() => handleReviewEvent(selectedEventId, 'approved', '')}
                        disabled={saving}
                        className="bg-emerald-600 hover:bg-emerald-700 text-white font-bold rounded-xl text-xs px-4 h-10 flex items-center gap-1.5 shadow-sm transition-all"
                      >
                        <CheckCircle2 className="w-4 h-4" />
                        Setujui
                      </Button>
                      <Button
                        type="button"
                        onClick={() => {
                          setReviewingEventId(selectedEventId);
                          setReviewAction('revision_needed');
                          setReviewNote('');
                          setShowReviewDialog(true);
                        }}
                        disabled={saving}
                        className="bg-orange-500 hover:bg-orange-600 text-white font-bold rounded-xl text-xs px-4 h-10 flex items-center gap-1.5 shadow-sm transition-all"
                      >
                        <AlertCircle className="w-4 h-4" />
                        Minta Revisi
                      </Button>
                      <Button
                        type="button"
                        onClick={() => {
                          setReviewingEventId(selectedEventId);
                          setReviewAction('declined');
                          setReviewNote('');
                          setShowReviewDialog(true);
                        }}
                        disabled={saving}
                        className="bg-rose-600 hover:bg-rose-700 text-white font-bold rounded-xl text-xs px-4 h-10 flex items-center gap-1.5 shadow-sm transition-all"
                      >
                        <XCircle className="w-4 h-4" />
                        Tolak
                      </Button>
                    </div>
                  )}
                </div>

                {/* Right side: Save / Submit / Batal buttons */}
                <div className="flex gap-3">
                  <Button
                    type="button"
                    variant="outline"
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
                    }}
                    className="rounded-xl border-slate-200 text-slate-600 text-xs h-10 font-bold px-4"
                  >
                    {isReadOnly ? 'Kembali' : 'Batal'}
                  </Button>

                  {!isReadOnly && (
                    <>
                      {/* For SatKer Loyalis, show "Simpan Draft" and "Submit untuk Review" */}
                      {profile?.role === 'satker_head_loyalis' ? (
                        <>
                          <Button
                            type="button"
                            onClick={handleSaveEvent}
                            disabled={saving || !eventName.trim()}
                            className="bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold rounded-xl text-xs px-4 h-10 transition-all border border-slate-200/60"
                          >
                            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4 mr-1.5" />}
                            Simpan Draft
                          </Button>
                          <Button
                            type="button"
                            onClick={handleSubmitForReview}
                            disabled={saving || !eventName.trim() || !reportFileUrl}
                            className="bg-indigo-600 hover:bg-indigo-700 text-white font-bold rounded-xl text-xs px-5 h-10 shadow-md flex items-center gap-1.5 transition-all active:scale-95"
                          >
                            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
                            {currentEventStatus === 'revision_needed' ? 'Re-submit untuk Review' : 'Submit untuk Review'}
                          </Button>
                        </>
                      ) : (
                        /* For Super Admin (or others), show standard "Simpan Kegiatan" which auto-approves */
                        <Button
                          type="button"
                          onClick={handleSaveEvent}
                          disabled={saving || !eventName.trim()}
                          className="bg-indigo-600 hover:bg-indigo-700 text-white font-bold rounded-xl text-xs px-6 h-10 shadow-md flex items-center gap-1.5 transition-all"
                        >
                          {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <ShieldCheck className="w-4 h-4" />}
                          Simpan Kegiatan
                        </Button>
                      )}
                    </>
                  )}
                </div>
              </div>
            </Card>
          </div>

          {/* Loyalis Presence Calculator Section */}
          {profile?.role !== 'satker_head_loyalis' && (
            <Card className="bg-white rounded-[20px] shadow-[0_8px_30px_rgb(0,0,0,0.04)] border-none p-6 space-y-6">
            <div className="flex justify-between items-center border-b border-slate-50 pb-4">
              <div>
                <h3 className="font-bold text-slate-800 text-sm flex items-center gap-2">
                  <FileSpreadsheet className="w-4 h-4 text-emerald-500" />
                  Kalkulator Bonus Presensi Loyalis via Excel
                </h3>
                <p className="text-slate-400 text-xs mt-0.5">Unggah data rekap kehadiran bulanan untuk menghitung strata dan bonus presensi.</p>
              </div>
              {existingPresence && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={handleDeletePresence}
                  disabled={savingPresence}
                  className="text-rose-500 hover:text-rose-600 hover:bg-rose-50 rounded-xl"
                >
                  <Trash2 className="w-4 h-4 mr-2" />
                  Hapus Data
                </Button>
              )}
            </div>

            {/* Status Indicator */}
            {existingPresence && !uploadedData && (
              <div className="bg-emerald-50 border border-emerald-100 rounded-2xl p-4 flex items-start gap-3">
                <CheckCircle2 className="w-5 h-5 text-emerald-500 shrink-0 mt-0.5" />
                <div>
                  <h4 className="text-emerald-800 text-xs font-bold">Data Presensi Telah Disimpan</h4>
                  <p className="text-emerald-600/90 text-[11px] mt-0.5 leading-relaxed">
                    Periode ini ({MONTHS_ID[month - 1]} {year}) sudah memiliki data presensi dengan {Object.keys(existingPresence.entries || {}).length} pegawai terdaftar. 
                    Jika ingin memperbarui data, silakan hapus data saat ini terlebih dahulu.
                  </p>
                  <div className="mt-3 flex flex-wrap gap-4 text-[10px] text-emerald-700 font-bold bg-white/50 px-3 py-1.5 rounded-xl border border-emerald-100/50 w-fit">
                    <span>Hari Kerja: {existingPresence.workingDays || 25} hari</span>
                    <span>Target: 390 menit/hari</span>
                    <span>Mode Input: {existingPresence.mode === 'worked' ? 'Menit Kerja' : 'Menit Absen'}</span>
                  </div>
                </div>
              </div>
            )}

            {/* Settings and File Upload Input */}
            {!existingPresence && (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6 items-end">
                {/* 1. Working Days */}
                <div className="space-y-2">
                  <label className="text-xs font-bold text-slate-500 uppercase tracking-wider block">Jumlah Hari Kerja (n)</label>
                  <Input
                    type="number"
                    min={1}
                    max={31}
                    value={workingDays}
                    onChange={(e) => setWorkingDays(Math.max(1, parseInt(e.target.value) || 0))}
                    className="rounded-xl border-slate-200 font-bold text-slate-700 text-xs h-10 w-full"
                  />
                </div>

                {/* 2. File Upload */}
                <div className="relative">
                  <Input
                    type="file"
                    accept=".xlsx, .xls"
                    id="presence-excel-file"
                    onChange={handleExcelUpload}
                    className="hidden"
                  />
                  <Button
                    type="button"
                    onClick={() => document.getElementById('presence-excel-file')?.click()}
                    className="w-full bg-slate-50 hover:bg-slate-100 border border-slate-200 text-slate-700 rounded-xl text-xs font-bold h-10 flex items-center justify-center gap-2 transition-all"
                  >
                    <Upload className="w-4 h-4 text-slate-400" />
                    Pilih File Excel
                  </Button>
                </div>
              </div>
            )}

            {/* Review Table */}
            {displayRows && (
              <div className="space-y-4 pt-4 border-t border-slate-100 animate-in fade-in">
                <div className="flex flex-wrap justify-between items-center gap-4">
                  <div className="flex flex-col gap-1.5">
                    <span className="text-xs font-bold text-slate-500 uppercase tracking-wider">
                      {uploadedData ? 'Preview Hasil Perhitungan Strata' : 'Data Perhitungan Strata Tersimpan'}
                    </span>
                    <div className="flex flex-wrap items-center gap-2 mt-1">
                      <span className="text-[10px] bg-slate-50 text-slate-600 border border-slate-200/60 px-2 py-0.5 rounded-full font-semibold">
                        Total Menit Kerja Kehadiran Penuh: {(workingDays * expectedHours * 60).toLocaleString('id-ID')} menit
                      </span>
                      <span className="text-[10px] bg-emerald-50 text-emerald-700 border border-emerald-100 px-2 py-0.5 rounded-full font-semibold">
                        Gaji Standar Presensi: {fmtRp(workingDays * expectedHours * 1650)}
                      </span>
                    </div>
                  </div>
                  <span className="text-[10px] text-slate-400 font-semibold">
                    Total Data: {displayRows.length} baris ({displayRows.filter(r => r.employeeId).length} Terhubung)
                  </span>
                </div>

                <div className="border border-slate-100 rounded-2xl overflow-auto shadow-sm max-h-[800px] bg-white">
                  <table className="w-full text-left border-collapse">
                    <thead className="sticky top-0 bg-slate-50 z-10 shadow-[0_1px_0_0_rgba(241,245,249,1)]">
                      <tr className="bg-slate-50 border-b border-slate-100">
                        <th className="px-4 py-3 text-[10px] font-bold text-slate-500 uppercase w-12 text-center">NO</th>
                        <th className="px-4 py-3 text-[10px] font-bold text-slate-500 uppercase">NAMA EXCEL</th>
                        <th className="px-4 py-3 text-[10px] font-bold text-slate-500 uppercase">PEGAWAI TERHUBUNG</th>
                        <th className="px-4 py-3 text-[10px] font-bold text-slate-500 uppercase w-32 text-center">MENIT KERJA EXCEL</th>
                        <th className="px-4 py-3 text-[10px] font-bold text-slate-500 uppercase w-32 text-center">ABSEN (MENIT)</th>
                        <th className="px-4 py-3 text-[10px] font-bold text-slate-500 uppercase w-24 text-center">STRATA</th>
                        <th className="px-4 py-3 text-[10px] font-bold text-slate-500 uppercase w-32 text-right">POT. BONUS</th>
                        <th className="px-4 py-3 text-[10px] font-bold text-slate-500 uppercase w-32 text-right">NET BONUS</th>
                        <th className="px-4 py-3 text-[10px] font-bold text-slate-500 uppercase w-36 text-right">POT. PRESENSI</th>
                      </tr>
                    </thead>
                    <tbody>
                      {displayRows.map((row, idx) => {
                        return (
                          <tr key={idx} className="border-b border-slate-50 hover:bg-slate-50/50 transition-colors">
                            <td className="px-4 py-3 text-xs text-slate-400 text-center font-mono">{idx + 1}</td>
                            <td className="px-4 py-3 text-xs font-bold text-slate-700">{row.excelName}</td>
                            <td className="px-4 py-3 text-xs">
                              {row.isMatched ? (
                                <div>
                                  <p className="font-bold text-indigo-600">{row.employeeName}</p>
                                  <p className="text-[10px] text-slate-400 font-mono">ID: {row.employeeId}</p>
                                </div>
                              ) : (
                                <span className="inline-flex items-center gap-1 text-rose-500 bg-rose-50 border border-rose-100 text-[10px] font-bold px-2 py-0.5 rounded-full">
                                  <AlertCircle className="w-3 h-3" />
                                  Tidak cocok
                                </span>
                              )}
                            </td>
                            <td className="px-4 py-3 text-xs font-bold text-slate-600 text-center font-mono">{row.minutes}</td>
                            <td className="px-4 py-3 text-xs text-slate-600 text-center font-mono">{row.isMatched && !row.isNotFoundInExcel ? row.absenceMinutes : 0}</td>
                            <td className="px-4 py-3 text-center">
                              {row.isMatched && !row.isNotFoundInExcel ? (
                                <span className={`inline-flex text-[10px] font-bold px-2 py-0.5 rounded-full ${
                                  row.stratum === 1 ? 'bg-emerald-50 text-emerald-600 border border-emerald-100' :
                                  row.stratum === 2 ? 'bg-blue-50 text-blue-600 border border-blue-100' :
                                  row.stratum === 3 ? 'bg-amber-50 text-amber-600 border border-amber-100' :
                                  row.stratum === 4 ? 'bg-orange-50 text-orange-600 border border-orange-100' :
                                  'bg-rose-50 text-rose-600 border border-rose-100'
                                }`}>
                                  Strata {row.stratum}
                                </span>
                              ) : '-'}
                            </td>
                            <td className="px-4 py-3 text-xs font-bold text-slate-600 text-right font-mono">
                              {row.isMatched && !row.isNotFoundInExcel ? fmtRp(row.deduction) : fmtRp(0)}
                            </td>
                            <td className="px-4 py-3 text-xs font-black text-indigo-600 text-right font-mono">
                              {row.isMatched && !row.isNotFoundInExcel ? fmtRp(row.netBonus) : fmtRp(0)}
                            </td>
                            <td className="px-4 py-3 text-xs font-bold text-red-500 text-right font-mono">
                              {row.isMatched && !row.isNotFoundInExcel ? fmtRp((row.absenceMinutes / 60) * 1650) : fmtRp(0)}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>

                {/* Actions Footer */}
                {uploadedData && (
                  <div className="flex justify-end gap-3 pt-4 border-t border-slate-50">
                    <Button
                      type="button"
                      variant="outline"
                      onClick={() => setUploadedData(null)}
                      className="rounded-xl border-slate-200 text-slate-600 text-xs font-bold"
                    >
                      Batal
                    </Button>
                    <Button
                      type="button"
                      onClick={handleSavePresence}
                      disabled={savingPresence || uploadedData.filter(r => r.employeeId).length === 0}
                      className="bg-indigo-600 hover:bg-indigo-700 text-white font-bold rounded-xl px-6 text-xs flex items-center gap-2 shadow-md active:scale-95 transition-all"
                    >
                      {savingPresence ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle2 className="w-4 h-4" />}
                      Simpan Data Presensi
                    </Button>
                  </div>
                )}
              </div>
            )}
          </Card>
          )}
        </div>
      ) : (
          /* Tab 3: Kegiatan SPJ UI */
          <div className="grid grid-cols-1 xl:grid-cols-12 gap-8 items-start">
            {/* Left side list of existing events */}
            <div className={`xl:col-span-4 space-y-6 ${mobileSpjView === 'list' ? 'block' : 'hidden xl:block'}`}>
              <Card className="bg-white rounded-[20px] shadow-[0_8px_30px_rgb(0,0,0,0.04)] border-none p-6">
                <div className="flex justify-between items-center mb-4">
                  <h3 className="font-bold text-slate-800 text-sm">Daftar Kegiatan SPJ</h3>
                  <Button
                    onClick={() => {
                      setSelectedSpjEventId(null);
                      setSpjEventName('');
                      setSpjWorkerRows([{ employeeId: '', employeeName: '', payGiven: 0, searchText: '', showDropdown: false }]);
                      setMobileSpjView('form');
                    }}
                    size="sm"
                    className="bg-indigo-50 text-indigo-600 hover:bg-indigo-100 rounded-xl font-bold flex items-center gap-1.5"
                  >
                    <Plus className="w-3.5 h-3.5" />
                    Baru
                  </Button>
                </div>

                {loadingSpjEvents ? (
                  <div className="py-12 flex justify-center text-slate-400">
                    <Loader2 className="w-6 h-6 animate-spin" />
                  </div>
                ) : spjEvents.length === 0 && selectedSpjEventId !== null ? (
                  <div className="py-12 text-center text-slate-400 text-xs font-semibold">
                    <Calendar className="w-8 h-8 mx-auto mb-2 opacity-30" />
                    Belum ada kegiatan SPJ terdaftar di periode ini.
                  </div>
                ) : (
                  <div className="space-y-3 max-h-[500px] overflow-y-auto pr-1">
                    {/* Empty / Draft Kegiatan Card */}
                    {!selectedSpjEventId && (
                      <div
                        className="p-4 rounded-2xl border bg-indigo-50/30 border-indigo-200 shadow-sm border-dashed animate-in fade-in"
                      >
                        <p className="font-bold text-indigo-600 text-sm line-clamp-1 italic">
                          {spjEventName.trim() !== '' ? spjEventName : 'Kegiatan Baru (Tanpa Nama)'}
                        </p>
                        <div className="flex items-center justify-between mt-3">
                          <span className="text-[10px] text-indigo-400 font-bold bg-indigo-50/50 px-2 py-0.5 rounded border border-indigo-100">
                            {spjWorkerRows.filter(r => r.employeeId).length} Orang
                          </span>
                          <span className="text-xs font-bold text-indigo-600">
                            {fmtRp(spjWorkerRows.reduce((sum, r) => sum + (r.payGiven || 0), 0))}
                          </span>
                        </div>
                      </div>
                    )}

                    {spjEvents.map(evt => {
                      const isActive = selectedSpjEventId === evt.id;
                      return (
                        <div
                          key={evt.id}
                          onClick={() => {
                            setSelectedSpjEventId(evt.id);
                            setSpjEventName(evt.eventName);
                            const fee = evt.eventFee || (Object.values(evt.eventWorkers || {})[0] as any)?.payGiven || 0;
                            setSpjEventFee(fee);
                            // Load workers
                            const workers = evt.eventWorkers || {};
                            const rows = Object.entries(workers).map(([id, w]: [string, any]) => ({
                              employeeId: id,
                              employeeName: w.employeeName,
                              payGiven: w.payGiven || fee,
                              searchText: w.employeeName,
                              showDropdown: false,
                            }));
                            setSpjWorkerRows(rows);
                            setMobileSpjView('form');
                          }}
                          className={`p-4 rounded-2xl border transition-all cursor-pointer outline-none focus:outline-none ${isActive
                            ? 'bg-indigo-50/50 border-indigo-200 shadow-sm animate-in fade-in'
                            : 'bg-white border-slate-100 hover:border-indigo-100'
                            }`}
                        >
                          <p className="font-bold text-slate-800 text-sm line-clamp-1">{evt.eventName}</p>
                          <div className="flex items-center justify-between mt-3">
                            <span className="text-[10px] text-slate-400 font-bold bg-slate-50 px-2 py-0.5 rounded border border-slate-100">
                              {Object.keys(evt.eventWorkers || {}).length} Orang
                            </span>
                            <span className="text-xs font-bold text-indigo-600">
                              {fmtRp(evt.totalPayout || 0)}
                            </span>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </Card>
            </div>

            {/* Right side form */}
            <Card className={`xl:col-span-8 bg-white rounded-[20px] shadow-[0_8px_30px_rgb(0,0,0,0.04)] border-none overflow-visible min-h-[500px] flex flex-col p-4 md:p-6 space-y-4 md:space-y-6 animate-in fade-in duration-500 ${mobileSpjView === 'form' ? 'block' : 'hidden xl:block'}`}>
              <div className="flex justify-between items-center border-b border-slate-50 pb-4">
                <div className="flex items-center">
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => setMobileSpjView('list')}
                    className="xl:hidden -ml-2 rounded-xl text-slate-500 hover:text-indigo-600 mr-2"
                  >
                    <ArrowLeft className="w-5 h-5" />
                  </Button>
                  <div>
                    <h3 className="font-bold text-slate-800 text-xs md:text-sm flex items-center gap-2">
                      <Calendar className="w-4 h-4 text-indigo-500" />
                      {selectedSpjEventId ? 'Ubah Kegiatan SPJ' : 'Buat Kegiatan SPJ Baru'}
                    </h3>
                    <p className="text-slate-400 text-[10px] md:text-xs mt-0.5">Input detail kegiatan dan daftarkan pegawai pekarya penerima payout.</p>
                  </div>
                </div>
                {selectedSpjEventId && (
                  <Button
                    variant="ghost"
                    onClick={() => handleDeleteSpjEvent(selectedSpjEventId)}
                    className="text-rose-500 hover:text-rose-600 hover:bg-rose-50 rounded-xl text-xs"
                  >
                    <Trash2 className="w-4 h-4 mr-2" />
                    Hapus
                  </Button>
                )}
              </div>
 
              {/* Event Details Grid */}
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div className="md:col-span-2 space-y-2">
                  <label className="text-[10px] md:text-xs font-bold text-slate-500 uppercase tracking-wider block">Nama Kegiatan SPJ</label>
                  <Input
                    type="text"
                    placeholder="Contoh: Piket Rektorat"
                    value={spjEventName}
                    onChange={(e) => setSpjEventName(e.target.value)}
                    onBlur={() => {
                      handleSpjAutosave(spjWorkerRows, spjEventName, selectedSpjEventId, spjEventFee);
                    }}
                    className="rounded-xl border-slate-200 font-bold text-slate-800 text-xs md:text-sm focus:border-indigo-500 focus:ring-4 focus:ring-indigo-100 h-9 md:h-11"
                  />
                </div>
                <div className="space-y-2">
                  <label className="text-[10px] md:text-xs font-bold text-slate-500 uppercase tracking-wider block">Tarif per Orang (Rp)</label>
                  <Input
                    type="text"
                    inputMode="numeric"
                    pattern="[0-9]*"
                    placeholder="Rp 0"
                    value={spjEventFee > 0 ? fmtRp(spjEventFee) : ''}
                    onChange={(e) => {
                      const rawVal = e.target.value.replace(/\D/g, '');
                      const val = parseInt(rawVal, 10) || 0;
                      setSpjEventFee(val);
                      setSpjWorkerRows(prev => prev.map(row => ({ ...row, payGiven: val })));
                    }}
                    onBlur={() => {
                      handleSpjAutosave(spjWorkerRows.map(row => ({ ...row, payGiven: spjEventFee })), spjEventName, selectedSpjEventId, spjEventFee);
                    }}
                    className="rounded-xl border-slate-200 font-bold text-slate-800 text-xs md:text-sm focus:border-indigo-500 focus:ring-4 focus:ring-indigo-100 h-9 md:h-11"
                  />
                </div>
              </div>
 
              {/* Live Running Total */}
              <div className="bg-blue-50/20 backdrop-blur-sm rounded-2xl p-4 md:p-6 text-blue-900 shadow-[0_4px_20px_rgba(59,130,246,0.05)] flex items-center justify-between border-2 border-blue-500 transition-all duration-300">
                <div>
                  <span className="text-[9px] md:text-[10px] text-blue-600 font-bold uppercase tracking-widest">Aggregate Validation</span>
                  <h4 className="text-sm md:text-xl font-black mt-1 text-blue-900">JUMLAH</h4>
                </div>
                <div className="text-right">
                  <span className="text-[9px] md:text-[10px] text-blue-600 font-bold uppercase tracking-widest">Total Payout</span>
                  <p className="text-xl md:text-3xl font-black text-blue-800 mt-1 tracking-tight">
                    {fmtRp(spjWorkerRows.reduce((sum, r) => sum + (r.payGiven || 0), 0))}
                  </p>
                </div>
              </div>

              {/* Iterative Workers grid */}
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <span className="text-[10px] md:text-xs font-bold text-slate-500 uppercase tracking-wider">Daftar Pegawai</span>
                </div>

                <div className="border border-slate-100 rounded-2xl shadow-sm overflow-visible bg-white">
                  <table className="w-full text-left border-collapse">
                    <thead>
                      <tr className="bg-slate-50 border-b border-slate-100">
                        <th className="px-4 py-3 text-[10px] font-bold text-slate-500 uppercase w-12 text-center">NO</th>
                        <th className="px-4 py-3 text-[10px] font-bold text-slate-500 uppercase">NAMA PEGAWAI</th>
                        <th className="px-4 py-3 text-[10px] font-bold text-slate-500 uppercase w-16 text-center">AKSI</th>
                      </tr>
                    </thead>
                    <tbody>
                      {spjWorkerRows.length === 0 ? (
                        <tr>
                          <td colSpan={3} className="text-center py-12 text-slate-400 text-xs font-semibold">
                            Belum ada pegawai ditambahkan. Klik tombol di bawah untuk menambahkan.
                          </td>
                        </tr>
                      ) : (
                        spjWorkerRows.map((row, rowIdx) => {
                          const handleEmployeeSearch = (index: number, text: string) => {
                            setSpjWorkerRows(prev => {
                              const copy = [...prev];
                              copy[index] = { ...copy[index], searchText: text, showDropdown: true };
                              return copy;
                            });
                            setActiveSpjSuggestionIndex(0);
                          };
                          const selectEmployee = (index: number, emp: any) => {
                            setSpjWorkerRows(prev => {
                              const copy = [...prev];
                              copy[index] = {
                                ...copy[index],
                                employeeId: emp.id,
                                employeeName: emp.name,
                                searchText: emp.name,
                                showDropdown: false,
                                payGiven: spjEventFee,
                              };
                              if (copy[index].employeeId && spjEventFee > 0) {
                                handleSpjAutosave(copy, spjEventName, selectedSpjEventId, spjEventFee);
                              }
                              return copy;
                            });
                          };

                          return (
                            <tr key={rowIdx} className={`border-b border-slate-50 hover:bg-slate-50/30 transition-colors animate-in fade-in slide-in-from-top-1 ${row.showDropdown ? 'relative z-50' : 'relative z-0'}`}>
                              <td className="px-4 py-4 text-xs font-bold text-slate-400 text-center">
                                {rowIdx + 1}
                              </td>
                              <td className="px-4 py-4 relative">
                                <div className="relative">
                                  <Input
                                    id={`spj-search-input-${rowIdx}`}
                                    type="text"
                                    placeholder="Cari nama pegawai..."
                                    value={row.searchText || ''}
                                    onChange={(e) => handleEmployeeSearch(rowIdx, e.target.value)}
                                    onFocus={() => {
                                      setSpjWorkerRows(prev => {
                                        const copy = [...prev];
                                        copy[rowIdx] = { ...copy[rowIdx], showDropdown: true };
                                        return copy;
                                      });
                                      setActiveSpjSuggestionIndex(0);
                                    }}
                                    onBlur={() => {
                                      setTimeout(() => {
                                        setSpjWorkerRows(prev => {
                                          const copy = [...prev];
                                          if (copy[rowIdx]) {
                                            const text = copy[rowIdx].searchText || '';
                                            if (text.trim() === '') {
                                              copy[rowIdx] = { ...copy[rowIdx], employeeId: '', employeeName: '', showDropdown: false, isInvalid: false };
                                            } else {
                                              const match = blueCollarEmployees
                                                .filter(emp => {
                                                  if (!profile) return false;
                                                  if (profile.role === 'super_admin') return true;
                                                  return profile.permittedCategories?.includes(emp.category);
                                                })
                                                .find(emp => emp.name.toLowerCase() === text.toLowerCase());
                                              
                                              if (match) {
                                                copy[rowIdx] = {
                                                  ...copy[rowIdx],
                                                  employeeId: match.id,
                                                  employeeName: match.name,
                                                  searchText: match.name,
                                                  showDropdown: false,
                                                  isInvalid: false,
                                                };
                                                handleSpjAutosave(copy, spjEventName, selectedSpjEventId, spjEventFee);
                                              } else {
                                                copy[rowIdx] = {
                                                  ...copy[rowIdx],
                                                  employeeId: '',
                                                  employeeName: '',
                                                  showDropdown: false,
                                                  isInvalid: true,
                                                };
                                              }
                                            }
                                          }
                                          return copy;
                                        });
                                      }, 200);
                                    }}
                                    onKeyDown={(e) => {
                                      const otherSelectedIds = spjWorkerRows
                                        .filter((_, i) => i !== rowIdx)
                                        .map(w => w.employeeId)
                                        .filter(Boolean);
                                      const filtered = blueCollarEmployees
                                        .filter(emp => !otherSelectedIds.includes(emp.id))
                                        .filter(emp => {
                                          if (!profile) return false;
                                          if (profile.role === 'super_admin') return true;
                                          return profile.permittedCategories?.includes(emp.category);
                                        })
                                        .filter(emp =>
                                          emp.name.toLowerCase().includes((row.searchText || '').toLowerCase())
                                        );
                                      if (row.showDropdown && filtered.length > 0) {
                                        if (e.key === 'ArrowDown') {
                                          e.preventDefault();
                                          setActiveSpjSuggestionIndex(prev => (prev + 1) % filtered.length);
                                        } else if (e.key === 'ArrowUp') {
                                          e.preventDefault();
                                          setActiveSpjSuggestionIndex(prev => (prev - 1 + filtered.length) % filtered.length);
                                        } else if (e.key === 'Enter') {
                                          e.preventDefault();
                                          const selectedEmp = filtered[activeSpjSuggestionIndex];
                                          if (selectedEmp) {
                                            selectEmployee(rowIdx, selectedEmp);
                                          }
                                        }
                                      }
                                    }}
                                    className={`rounded-xl font-bold text-slate-700 text-xs h-10 w-full transition-all ${
                                      row.isInvalid
                                        ? 'border-red-500 focus:border-red-500 focus:ring-red-100 ring-2 ring-red-100'
                                        : 'border-slate-200 focus:border-indigo-500 focus:ring-indigo-100'
                                    }`}
                                  />
                                  {row.showDropdown && (
                                    <div className="absolute left-0 right-0 mt-1 bg-white border border-slate-200 rounded-xl shadow-2xl z-[999] max-h-48 overflow-y-auto divide-y divide-slate-50 animate-in fade-in slide-in-from-top-1">
                                      {(() => {
                                        const otherSelectedIds = spjWorkerRows
                                          .filter((_, i) => i !== rowIdx)
                                          .map(w => w.employeeId)
                                          .filter(Boolean);
                                        const filtered = blueCollarEmployees
                                          .filter(emp => !otherSelectedIds.includes(emp.id))
                                          .filter(emp => {
                                            if (!profile) return false;
                                            if (profile.role === 'super_admin') return true;
                                            return profile.permittedCategories?.includes(emp.category);
                                          })
                                          .filter(emp =>
                                            emp.name.toLowerCase().includes((row.searchText || '').toLowerCase())
                                          );

                                        if (filtered.length === 0) {
                                          return <div className="p-4 text-center text-slate-400 text-xs font-semibold">Pegawai tidak ditemukan</div>;
                                        }

                                        return filtered.map((emp, empIdx) => {
                                          const isActive = empIdx === activeSpjSuggestionIndex;
                                          return (
                                            <div
                                              key={emp.id}
                                              onClick={() => selectEmployee(rowIdx, emp)}
                                              className={`px-4 py-2.5 text-xs font-semibold cursor-pointer transition-colors text-left ${isActive
                                                ? 'bg-indigo-50 text-indigo-600 font-bold'
                                                : 'hover:bg-indigo-50 hover:text-indigo-600 text-slate-700'
                                                }`}
                                            >
                                              <p className={isActive ? 'text-indigo-700' : 'text-slate-800'}>{emp.name}</p>
                                              <p className={`text-[10px] font-mono mt-0.5 ${isActive ? 'text-indigo-400' : 'text-slate-400'}`}>{emp.category} · {emp.id}</p>
                                            </div>
                                          );
                                        });
                                      })()}
                                    </div>
                                  )}
                                </div>
                                {row.isInvalid && (
                                  <span className="text-[9px] font-bold text-red-500 mt-1 block">Nama tidak terdaftar di database</span>
                                )}
                              </td>
                              <td className="px-4 py-4 text-center">
                                <Button
                                  type="button"
                                  variant="ghost"
                                  size="icon"
                                  onClick={() => {
                                    setSpjWorkerRows(prev => {
                                      const copy = prev.filter((_, i) => i !== rowIdx);
                                      handleSpjAutosave(copy, spjEventName, selectedSpjEventId, spjEventFee);
                                      return copy;
                                    });
                                  }}
                                  className="text-rose-500 hover:text-rose-600 hover:bg-rose-50 rounded-xl h-8 w-8"
                                >
                                  <Trash2 className="w-3.5 h-3.5" />
                                </Button>
                              </td>
                            </tr>
                          );
                        })
                      )}
                    </tbody>
                  </table>
                </div>

                {/* Add Employee button below the table */}
                <div className="flex justify-end">
                  <Button
                    type="button"
                    onClick={handleSpjAddRow}
                    className="bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl text-xs font-bold px-4 h-9.5 shadow-md flex items-center gap-1.5 transition-all active:scale-95"
                  >
                    <Plus className="w-3.5 h-3.5" />
                    Tambah Pegawai
                  </Button>
                </div>
              </div>

              {/* Form submit footer actions */}
              <div className="flex justify-end gap-3 pt-4 border-t border-slate-50 shrink-0">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => {
                    setSelectedSpjEventId(null);
                    setSpjEventName('');
                    setSpjEventFee(0);
                    setSpjWorkerRows([{ employeeId: '', employeeName: '', payGiven: 0, searchText: '', showDropdown: false }]);
                    setMobileSpjView('list');
                  }}
                  className="rounded-xl border-slate-200 text-slate-600"
                >
                  Batal
                </Button>
                <Button
                  type="button"
                  onClick={handleSaveSpjEvent}
                  disabled={saving || !spjEventName.trim()}
                  className="bg-indigo-600 hover:bg-indigo-700 text-white font-bold rounded-xl px-6 flex items-center gap-2"
                >
                  {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <ShieldCheck className="w-4 h-4" />}
                  Simpan Kegiatan
                </Button>
              </div>
            </Card>
          </div>
        )}
      </div>

      <Dialog open={showPreviewModal} onOpenChange={setShowPreviewModal}>
        <DialogContent className="max-w-[95vw] max-h-[95vh] p-0 overflow-hidden bg-slate-900/95 border-none shadow-2xl">
          <div className="relative w-full h-[90vh] flex items-center justify-center p-4">
            <Button variant="ghost" size="icon" onClick={() => setShowPreviewModal(false)} className="absolute top-4 right-4 z-50 text-white rounded-full bg-white/10 backdrop-blur-md hover:bg-white/20"><X className="w-6 h-6" /></Button>
            {previewUrl && <img src={previewUrl} alt="Preview" className="max-w-full max-h-full object-contain" />}
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={showDebugModal} onOpenChange={setShowDebugModal}>
        <DialogContent className="sm:max-w-3xl max-w-full max-h-[85vh] overflow-hidden flex flex-col p-0 border-none bg-slate-900 shadow-2xl rounded-3xl">
          <DialogHeader className="p-6 pb-4 bg-slate-800/50 backdrop-blur-md border-b border-white/5"><DialogTitle className="text-white flex items-center gap-3 font-bold text-xl"><Code2 className="w-6 h-6 text-indigo-400" />Raw AI Capture Output</DialogTitle></DialogHeader>
          <div className="flex-1 overflow-auto p-6 bg-[#0B0E14]"><pre className="p-4 rounded-2xl text-[12px] font-mono text-indigo-300/90 leading-relaxed overflow-x-auto whitespace-pre-wrap selection:bg-indigo-500/30">{JSON.stringify(lastScanResult, null, 2)}</pre></div>
          <div className="p-4 bg-slate-900 border-t border-white/5 flex justify-end gap-3">
            <Button variant="ghost" className="text-slate-400 hover:text-white hover:bg-white/5 font-bold" onClick={() => { navigator.clipboard.writeText(JSON.stringify(lastScanResult, null, 2)); setMessage({ type: 'success', text: 'Copied to clipboard' }); }}>Copy JSON</Button>
            <Button onClick={() => setShowDebugModal(false)} className="bg-indigo-600 text-white px-8 font-bold rounded-xl hover:bg-indigo-700 transition-all">Close</Button>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={showSavePreview} onOpenChange={setShowSavePreview}>
        <DialogContent className="sm:max-w-3xl max-w-full max-h-[85vh] overflow-hidden flex flex-col p-0 border-none bg-[#0F172A] shadow-2xl rounded-3xl">
          <DialogHeader className="p-6 pb-4 bg-slate-800/50 border-b border-white/5"><DialogTitle className="text-white flex items-center gap-3 font-bold text-xl"><Database className="w-6 h-6 text-emerald-400" />Preview Database Payload</DialogTitle></DialogHeader>
          <div className="flex-1 overflow-auto p-6 bg-[#020617]"><pre className="p-4 rounded-2xl text-[12px] font-mono text-emerald-300/90 leading-relaxed overflow-x-auto whitespace-pre-wrap">{JSON.stringify(generateSavePayload(), null, 2)}</pre></div>
          <div className="p-4 bg-slate-900 border-t border-white/5 flex justify-end gap-3">
            <Button variant="ghost" className="text-slate-400 hover:text-white hover:bg-white/5 font-bold" onClick={() => { navigator.clipboard.writeText(JSON.stringify(generateSavePayload(), null, 2)); setMessage({ type: 'success', text: 'Payload copied' }); }}>Copy Payload</Button>
            <Button onClick={() => setShowSavePreview(false)} className="bg-emerald-600 text-white px-8 font-bold rounded-xl hover:bg-emerald-700 transition-all">Understood</Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* ── Save Confirmation Modal ──────────────────────────────────────────── */}
      <Dialog open={showSaveConfirm} onOpenChange={setShowSaveConfirm}>
        <DialogContent className="sm:max-w-3xl max-w-full max-h-[88vh] overflow-hidden flex flex-col p-0 border-none bg-white shadow-2xl rounded-3xl">
          {/* Header */}
          <DialogHeader className="p-6 pb-4 bg-gradient-to-r from-indigo-600 to-violet-600 rounded-t-3xl shrink-0">
            <DialogTitle className="text-white flex items-center gap-3 font-bold text-xl">
              <ShieldCheck className="w-6 h-6" />
              Konfirmasi Penyimpanan Data
            </DialogTitle>
            <p className="text-indigo-100 text-sm mt-1">
              Tinjau hasil kalkulasi di bawah sebelum menyimpan ke database.
            </p>
          </DialogHeader>

          {/* Body */}
          <div className="flex-1 overflow-y-auto px-6 py-5 space-y-4 bg-[#F8FAFC]">
            {/* Period badge */}
            <div className="flex items-center gap-2 text-xs text-slate-500 font-semibold uppercase tracking-wider mb-2">
              <span className="px-3 py-1 bg-indigo-50 text-indigo-600 rounded-full border border-indigo-100">
                {MONTHS_ID[month - 1]} {year}
              </span>
              <span className="px-3 py-1 bg-violet-50 text-violet-600 rounded-full border border-violet-100">
                {category}
              </span>
            </div>

            {spjDiscrepancies.length > 0 && (
              <div className="p-4 bg-amber-50 border border-amber-200 rounded-2xl flex gap-3 text-amber-900 text-xs">
                <AlertCircle className="w-5 h-5 text-amber-500 shrink-0 mt-0.5" />
                <div>
                  <p className="font-bold text-amber-800 text-sm mb-1">Peringatan: Terdapat Perbedaan Nilai SPJ</p>
                  <p className="leading-relaxed mb-2">
                    Nilai SPJ yang dimasukkan secara manual berbeda dengan total kalkulasi Kegiatan SPJ untuk beberapa karyawan berikut:
                  </p>
                  <ul className="list-disc list-inside space-y-1 font-semibold text-amber-800">
                    {spjDiscrepancies.map(d => (
                      <li key={d.employeeId}>
                        {d.name}: Manual {fmtRp(d.manual)} (Kalkulasi Kegiatan: {fmtRp(d.computed)})
                      </li>
                    ))}
                  </ul>
                </div>
              </div>
            )}

            {buildConfirmRows().length === 0 ? (
              <div className="flex flex-col items-center justify-center py-16 text-slate-400 space-y-2">
                <AlertCircle className="w-10 h-10 opacity-40" />
                <p className="font-medium">Tidak ada data untuk ditampilkan.</p>
              </div>
            ) : (
              buildConfirmRows().map(({ emp, fields }) => (
                <div key={emp.employeeId} className="bg-white rounded-2xl border border-slate-100 shadow-sm overflow-hidden">
                  {/* Employee name bar */}
                  <div className="flex items-center gap-3 px-4 py-3 border-b border-slate-100 bg-slate-50/60">
                    <div className="w-7 h-7 rounded-xl bg-indigo-600 text-white text-xs font-bold flex items-center justify-center shrink-0">
                      {emp.name.charAt(0)}
                    </div>
                    <div>
                      <p className="text-sm font-bold text-slate-800 leading-none">{emp.name}</p>
                      <p className="text-[10px] text-slate-400 font-mono mt-0.5">{emp.employeeId}</p>
                    </div>
                  </div>

                  {/* Fields grid */}
                  <div className="divide-y divide-slate-50">
                    {fields.map(({ col, count, value, isDual }) => (
                      <div key={col.key} className="flex items-center px-4 py-3 gap-4">
                        {/* Label */}
                        <span className="text-xs font-semibold text-slate-600 w-36 shrink-0">{col.label}</span>

                        {isDual && count !== null ? (
                          /* Dual-map: show count pill → Rp value */
                          <div className="flex items-center gap-2 flex-1 flex-wrap">
                            <span className="inline-flex items-center gap-1 px-2.5 py-1 bg-amber-50 text-amber-700 border border-amber-200 rounded-lg text-xs font-bold">
                              <Hash className="w-3 h-3" />
                              {count} hari
                            </span>
                            <span className="text-slate-300 text-sm">→</span>
                            <span className="inline-flex items-center gap-1 px-2.5 py-1 bg-emerald-50 text-emerald-700 border border-emerald-200 rounded-lg text-xs font-bold">
                              <Banknote className="w-3 h-3" />
                              {fmtRp(value)}
                            </span>
                            <span className="text-[10px] text-slate-400 ml-auto">
                              @{fmtRp(col.multiplier ?? 0)}/hari
                            </span>
                          </div>
                        ) : (
                          /* Regular currency field */
                          <div className="flex-1 flex items-center justify-between gap-2">
                            <span className="inline-flex items-center gap-1 px-2.5 py-1 bg-slate-50 text-slate-700 border border-slate-200 rounded-lg text-xs font-bold">
                              <Banknote className="w-3 h-3" />
                              {fmtRp(value)}
                            </span>
                            {col.key === 'spj' && tableData[emp.employeeId]?.spj !== undefined && tableData[emp.employeeId]?.spj !== getComputedSpj(emp.employeeId) && (
                              <span className="inline-flex items-center gap-1 px-2.5 py-1 bg-rose-50 text-rose-700 border border-rose-200 rounded-lg text-[10px] font-bold animate-pulse">
                                <AlertCircle className="w-3.5 h-3.5 shrink-0" />
                                Perbedaan: Seharusnya {fmtRp(getComputedSpj(emp.employeeId))}
                              </span>
                            )}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              ))
            )}
          </div>

          {/* Footer actions */}
          <div className="shrink-0 p-5 bg-white border-t border-slate-100 flex items-center justify-between gap-3 rounded-b-3xl">
            <p className="text-xs text-slate-400 leading-snug max-w-[55%]">
              Pastikan semua angka sudah benar sebelum menyimpan.
            </p>
            <div className="flex gap-2">
              <Button
                variant="outline"
                onClick={() => setShowSaveConfirm(false)}
                className="rounded-xl border-slate-200 text-slate-600 font-semibold hover:bg-slate-50"
              >
                Batal
              </Button>
              <Button
                onClick={handleConfirmSave}
                disabled={saving}
                className="rounded-xl px-6 bg-indigo-600 text-white font-bold shadow-lg shadow-indigo-200 hover:bg-indigo-700 transition-all flex items-center gap-2"
              >
                {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <ShieldCheck className="w-4 h-4" />}
                Konfirmasi &amp; Simpan
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* ── Cetak Rincian Kegiatan Dialog ───────────────────────────────────── */}
      <CetakKegiatanLoyalisDialog
        open={cetakKegiatanDialogOpen}
        onOpenChange={setCetakKegiatanDialogOpen}
        periodName={MONTHS_ID[month - 1] + ' ' + year}
        existingEvents={existingEvents}
        departments={departments}
        loyalisEmployees={loyalisEmployees}
      />

      {/* ── Add Custom Column Dialog ────────────────────────────────────────── */}
      <Dialog open={isCustomColDialogOpen} onOpenChange={setIsCustomColDialogOpen}>
        <DialogContent className="sm:max-w-md max-w-full overflow-hidden flex flex-col p-0 border-none bg-white shadow-2xl rounded-3xl animate-in fade-in duration-300">
          <DialogHeader className="p-6 pb-4 bg-gradient-to-r from-indigo-50/80 to-purple-50/60 border-b border-slate-100 shrink-0">
            <DialogTitle className="text-slate-800 flex items-center gap-3 font-bold text-lg">
              <Plus className="w-5 h-5 text-indigo-500" />
              Tambah Kolom Kustom Baru
            </DialogTitle>
            <p className="text-slate-500 text-xs mt-1">
              Tambahkan detail pembayaran kustom (tunjangan atau vakasi) ke dalam lembar payroll ini.
            </p>
          </DialogHeader>

          <div className="p-6 space-y-4 bg-white">
            <div className="space-y-1.5">
              <label className="text-xs font-bold text-slate-500 uppercase tracking-wider block">Nama Kolom (Label di Tabel)</label>
              <Input
                type="text"
                placeholder="Contoh: Tunjangan Khusus"
                value={newColLabel}
                onChange={(e) => setNewColLabel(e.target.value)}
                className="rounded-xl border-slate-200 font-semibold text-slate-800 text-sm focus:border-indigo-500 focus:ring-4 focus:ring-indigo-100 h-10"
              />
            </div>

            <div className="space-y-1.5">
              <label className="text-xs font-bold text-slate-500 uppercase tracking-wider block">Label di Slip Gaji (Opsional)</label>
              <Input
                type="text"
                placeholder="Contoh: T. Khusus (Kosongkan jika ingin disamakan)"
                value={newColSlipLabel}
                onChange={(e) => setNewColSlipLabel(e.target.value)}
                className="rounded-xl border-slate-200 font-semibold text-slate-800 text-sm focus:border-indigo-500 focus:ring-4 focus:ring-indigo-100 h-10"
              />
            </div>

            <div className="space-y-1.5">
              <label className="text-xs font-bold text-slate-500 uppercase tracking-wider block">Tipe Kolom</label>
              <Select value={newColType} onValueChange={(v: any) => setNewColType(v)}>
                <SelectTrigger className="w-full bg-white shadow-sm border-slate-200 rounded-xl h-10 text-slate-700 font-semibold">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="rounded-xl border-slate-100 shadow-xl">
                  <SelectItem value="currency" className="py-2.5 rounded-lg mx-1 focus:bg-indigo-50">Nominal Uang Langsung (Rupiah)</SelectItem>
                  <SelectItem value="count" className="py-2.5 rounded-lg mx-1 focus:bg-indigo-50">Jumlah Unit/Hari (Dikalikan Rate)</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {newColType === 'count' && (
              <div className="space-y-1.5 animate-in slide-in-from-top-1 duration-200">
                <label className="text-xs font-bold text-slate-500 uppercase tracking-wider block">Rate/Multiplier (Rp per Unit/Hari)</label>
                <Input
                  type="text"
                  inputMode="numeric"
                  pattern="[0-9]*"
                  placeholder="Contoh: 20000"
                  value={newColMultiplier}
                  onChange={(e) => {
                    const rawVal = e.target.value.replace(/\D/g, '');
                    setNewColMultiplier(parseInt(rawVal, 10) || '');
                  }}
                  className="rounded-xl border-slate-200 font-semibold text-slate-800 text-sm focus:border-indigo-500 focus:ring-4 focus:ring-indigo-100 h-10 text-right"
                />
              </div>
            )}
          </div>

          <div className="p-5 bg-slate-50 border-t border-slate-100 flex justify-end gap-2.5 shrink-0 rounded-b-3xl">
            <Button
              variant="ghost"
              onClick={() => setIsCustomColDialogOpen(false)}
              className="rounded-xl text-slate-500 hover:bg-slate-100"
            >
              Batal
            </Button>
            <Button
              onClick={handleAddCustomColumn}
              className="rounded-xl px-6 bg-indigo-600 text-white font-bold shadow-lg shadow-indigo-200 hover:bg-indigo-700 transition-all flex items-center gap-2 cursor-pointer"
            >
              <Plus className="w-4 h-4" />
              Tambah Kolom
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* ── Review Dialog (Super Admin reason entry) ── */}
      <Dialog open={showReviewDialog} onOpenChange={setShowReviewDialog}>
        <DialogContent className="sm:max-w-md max-w-full overflow-hidden flex flex-col p-0 border-none bg-white shadow-2xl rounded-3xl animate-in fade-in duration-300">
          <DialogHeader className="p-6 pb-4 bg-gradient-to-r from-orange-50/80 to-rose-50/60 border-b border-slate-100 shrink-0">
            <DialogTitle className="text-slate-800 flex items-center gap-3 font-bold text-lg">
              {reviewAction === 'revision_needed' ? (
                <>
                  <AlertCircle className="w-5 h-5 text-orange-500" />
                  Minta Revisi Kegiatan
                </>
              ) : (
                <>
                  <XCircle className="w-5 h-5 text-rose-500" />
                  Tolak Kegiatan
                </>
              )}
            </DialogTitle>
            <p className="text-slate-500 text-xs mt-1">
              Berikan alasan mengapa kegiatan ini memerlukan revisi atau ditolak. Catatan ini akan ditampilkan kepada Kepala SatKer.
            </p>
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
            <Button
              variant="ghost"
              onClick={() => {
                setShowReviewDialog(false);
                setReviewNote('');
              }}
              className="rounded-xl text-slate-500 hover:bg-slate-100"
            >
              Batal
            </Button>
            <Button
              onClick={() => {
                if (reviewingEventId) {
                  handleReviewEvent(reviewingEventId, reviewAction, reviewNote);
                }
              }}
              disabled={saving || !reviewNote.trim()}
              className={`rounded-xl px-6 text-white font-bold shadow-lg transition-all flex items-center gap-2 cursor-pointer ${
                reviewAction === 'revision_needed'
                  ? 'bg-orange-500 shadow-orange-100 hover:bg-orange-600'
                  : 'bg-rose-600 shadow-rose-100 hover:bg-rose-700'
              }`}
            >
              {saving ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                reviewAction === 'revision_needed' ? <AlertCircle className="w-4 h-4" /> : <XCircle className="w-4 h-4" />
              )}
              Konfirmasi
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* ── Image Lightbox Overlay ── */}
      {lightboxUrl && (
        <div
          className="fixed inset-0 bg-slate-900/80 backdrop-blur-md z-[9999] flex items-center justify-center p-4 animate-in fade-in duration-300"
          onClick={() => setLightboxUrl(null)}
        >
          <div className="relative max-w-4xl w-full max-h-[85vh] flex flex-col items-center justify-center" onClick={e => e.stopPropagation()}>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              onClick={() => setLightboxUrl(null)}
              className="absolute -top-12 right-0 text-white hover:bg-white/20 rounded-full h-10 w-10"
            >
              <X className="w-6 h-6" />
            </Button>
            <img
              src={lightboxUrl}
              alt="File Laporan Scan"
              className="max-w-full max-h-[80vh] rounded-2xl object-contain shadow-2xl border border-white/10"
            />
          </div>
        </div>
      )}
    </div>
  );
}
