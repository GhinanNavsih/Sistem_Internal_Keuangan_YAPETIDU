"use client"

import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
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
  RotateCw, Sparkles, X, Crop, Building2, Code2, ShieldCheck, FileDown, Plus, Save,
  Lock, Unlock
} from 'lucide-react';
import { useAuth } from '@/lib/AuthContext';
import {
  collection, getDocs, doc, setDoc, getDoc, serverTimestamp, query, where
} from 'firebase/firestore';
import { db } from '@/lib/firebase';
import {
  REKAP_COLUMNS, SUPPORTED_CATEGORIES, MONTHS_ID,
} from '@/utils/rekapConfig';
import {
  renderFileToCanvas, runOcr, parseRekapRows, matchEmployee, cropCanvas,
} from '@/utils/ocrParser';
import type {
  BlueCollarEmployee, UraianEntry, RekapColumn
} from '@/types';
import { generateRekapPresensiKebersihanyPdf } from '@/utils/generateRekapPresensiKebersihan';
import { dedupeSatpamActivityReports } from '@/lib/payroll/domain';
import { authenticatedJson } from '@/lib/payroll/client';
import {
  pekaryaPayrollWindow,
  sumApprovedActivitySpj,
  sumApprovedEventSpj,
} from '@/lib/payroll/pekaryaSpj';
import { DriverPiketSchedule, countDriverPiketInPeriod } from '@/lib/payroll/driverPiket';

export default function RekapPekaryaPage() {
  const router = useRouter();
  const { user, profile } = useAuth();
  const searchParams = useSearchParams();

  // Read params from URL search parameters
  const month = parseInt(searchParams.get('month') || String(new Date().getMonth() + 1), 10);
  const year = parseInt(searchParams.get('year') || String(new Date().getFullYear()), 10);
  const category = searchParams.get('category') || "";

  const docId = `${year}_${String(month).padStart(2, '0')}_${category}`;

  // ── States ──
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
  const [isLocked, setIsLocked] = useState(false);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  // ── Custom Column Dialog States ──
  const [customColumns, setCustomColumns] = useState<RekapColumn[]>([]);
  const [isCustomColDialogOpen, setIsCustomColDialogOpen] = useState(false);
  const [newColLabel, setNewColLabel] = useState('');
  const [newColSlipLabel, setNewColSlipLabel] = useState('');
  const [newColType, setNewColType] = useState<'count' | 'currency'>('currency');
  const [newColMultiplier, setNewColMultiplier] = useState<number | ''>('');

  // ── Custom Signature Dialog States ──
  const [signatureConfig, setSignatureConfig] = useState<Record<string, { name: string, title: string }>>({});
  const [showSignatureModal, setShowSignatureModal] = useState(false);
  const [sigModalName, setSigModalName] = useState('');
  const [sigModalTitle, setSigModalTitle] = useState('');
  const [sigModalSearch, setSigModalSearch] = useState('');
  const [selectedSigEmpId, setSelectedSigEmpId] = useState('');
  const [employeesForSignature, setEmployeesForSignature] = useState<{ id: string, name: string, role: string, collection: string }[]>([]);
  const [loadingSigEmployees, setLoadingSigEmployees] = useState(false);

  const longPressTimerRef = useRef<NodeJS.Timeout | null>(null);
  const isLongPressRef = useRef(false);

  // ── Fetch Signature Configurations ──
  useEffect(() => {
    const fetchSignatures = async () => {
      try {
        const docRef = doc(db, 'Settings', 'signatures');
        const docSnap = await getDoc(docRef);
        if (docSnap.exists()) {
          setSignatureConfig(docSnap.data());
        }
      } catch (err) {
        console.error('Error fetching signature settings:', err);
      }
    };
    fetchSignatures();
  }, []);

  const fetchEmployeesForSignature = async () => {
    setLoadingSigEmployees(true);
    try {
      const [loyalisSnap, blueCollarSnap] = await Promise.all([
        getDocs(query(collection(db, 'Employees_Loyalis'), where('personal_info.status', '==', 'AKTIF'))),
        getDocs(query(collection(db, 'Employees_BlueCollar'), where('employment.status', '==', 'active')))
      ]);

      const loyalisList = loyalisSnap.docs.map(d => {
        const data = d.data();
        return {
          id: d.id,
          name: data.personal_info?.name || '',
          role: data.employment_profile?.job_role || 'Pegawai Loyalis',
          collection: 'Employees_Loyalis'
        };
      });

      const blueCollarList = blueCollarSnap.docs.map(d => {
        const data = d.data();
        return {
          id: d.id,
          name: data.name || '',
          role: data.employment?.jobCategory || 'Pekarya',
          collection: 'Employees_BlueCollar'
        };
      });

      const combined = [...loyalisList, ...blueCollarList].sort((a, b) => a.name.localeCompare(b.name));
      setEmployeesForSignature(combined);
    } catch (err) {
      console.error('Error loading signature employees:', err);
    } finally {
      setLoadingSigEmployees(false);
    }
  };

  const handleSelectEmployeeForSignature = (emp: { id: string, name: string, role: string }) => {
    setSelectedSigEmpId(emp.id);
    setSigModalName(emp.name);
    setSigModalTitle(emp.role);
    setSigModalSearch('');
  };

  const handleOpenSignatureModal = () => {
    fetchEmployeesForSignature();
    const currentSig = signatureConfig[category];
    if (currentSig) {
      setSigModalName(currentSig.name);
      setSigModalTitle(currentSig.title);
    } else {
      const isSatpam = category === 'SATPAM';
      setSigModalName(isSatpam ? 'H. Rohmatul Akbar, ST' : 'Harun Arrosyid, S. Pd. I');
      setSigModalTitle(isSatpam ? 'Majlis Kamtib' : 'KA. Biro Administrasi Umum');
    }
    setSigModalSearch('');
    setSelectedSigEmpId('');
    setShowSignatureModal(true);
  };

  const handleSaveSignature = async () => {
    try {
      const updatedConfig = {
        ...signatureConfig,
        [category]: {
          name: sigModalName,
          title: sigModalTitle
        }
      };
      await setDoc(doc(db, 'Settings', 'signatures'), updatedConfig, { merge: true });
      setSignatureConfig(updatedConfig);
      setMessage({ type: 'success', text: `Tanda tangan untuk kategori ${category} berhasil diperbarui.` });
      setShowSignatureModal(false);
    } catch (err) {
      console.error('Error saving signature:', err);
      setMessage({ type: 'error', text: 'Gagal menyimpan pengaturan tanda tangan.' });
    }
  };

  // ── SPJ Integration States (to compute SPJ discrepancies) ──
  const [spjEvents, setSpjEvents] = useState<any[]>([]);
  const [approvedActivityReports, setApprovedActivityReports] = useState<any[]>([]);
  const [ketuaShiftIds, setKetuaShiftIds] = useState<Set<string>>(new Set());

  // ── Fetch Kegiatan SPJ Events & ActivityReports ──
  const fetchSpjEvents = useCallback(async () => {
    if (!category) return;
    try {
      const periodToken = `${year}-${String(month).padStart(2, '0')}`;
      const eventResult = await authenticatedJson<{ events: any[] }>(
        `/api/pekarya/spj-events?period=${encodeURIComponent(periodToken)}&category=${encodeURIComponent(category)}`,
        { method: 'GET' },
      );
      setSpjEvents(eventResult.events);

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

        setApprovedActivityReports(
          category === 'SATPAM' ? dedupeSatpamActivityReports(filteredAr) : filteredAr,
        );
      } catch (arErr) {
        console.error('Error fetching ActivityReports:', arErr);
      }
    } catch (err) {
      console.error('Error fetching SPJ events:', err);
    }
  }, [month, year, category]);

  useEffect(() => {
    fetchSpjEvents();
  }, [fetchSpjEvents]);

  // Helper: compute accumulated SPJ payout for an employee
  const getComputedSpj = useCallback((empId: string) => {
    const periodToken = `${year}-${String(month).padStart(2, '0')}`;
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
  }, [spjEvents, approvedActivityReports, category, month, year]);

  const getComputedSatpamShiftCount = useCallback((empId: string, shiftTypeKey: string) => {
    let targetShiftType = '';
    if (shiftTypeKey === 'harian') targetShiftType = 'Harian';
    else if (shiftTypeKey === 'jumatLibur') targetShiftType = 'Jumat & Libur';
    else if (shiftTypeKey === 'lemburSendiri') targetShiftType = 'Lembur Sendiri';
    else if (shiftTypeKey === 'lemburCover') targetShiftType = 'Lembur Cover';
    
    if (!targetShiftType) return 0;
    
    return approvedActivityReports.filter(ar => 
      ar.employeeId === empId && 
      ar.jobCategory === 'SATPAM' &&
      ar.shiftType === targetShiftType
    ).length;
  }, [approvedActivityReports]);

  const [driverPiketSchedules, setDriverPiketSchedules] = useState<DriverPiketSchedule[]>([]);

  const getComputedSopirPiketCount = useCallback((empId: string) => {
    const periodToken = `${year}-${String(month).padStart(2, '0')}`;
    return countDriverPiketInPeriod(empId, periodToken, driverPiketSchedules);
  }, [year, month, driverPiketSchedules]);

  // ── File states ──
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

  // ── Fetch Employees & Uraian Presensi Data ──
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
        try {
          const teamsSnap = await getDocs(collection(db, 'SatpamShiftTeams'));
          const ids = new Set(teamsSnap.docs.map(d => d.data().ketuaShiftId).filter(Boolean) as string[]);
          setKetuaShiftIds(ids);
        } catch (err) {
          console.error('Error fetching Satpam shift teams:', err);
        }

        if (category === 'SOPIR') {
          try {
            const piketPeriod = `${year}-${String(month).padStart(2, '0')}`;
            const piketQ = query(
              collection(db, 'DriverPiketSchedules'),
              where('period', '==', piketPeriod)
            );
            const piketSnap = await getDocs(piketQ);
            const piketList = piketSnap.docs.map(d => ({ id: d.id, ...d.data() } as DriverPiketSchedule));
            setDriverPiketSchedules(piketList);
          } catch (err) {
            console.error('Error fetching driver piket schedules:', err);
          }
        }

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

          const lockState = docData.isLocked === true || docData.status === 'locked' || (docData.isLocked !== false && docData.status !== 'draft');
          setIsLocked(lockState);

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
          setIsLocked(false);
        }
        setTableData(initialTable);
      } catch (err) {
        console.error(err);
      } finally {
        setLoadingEmps(false);
      }
    };
    fetchData();
  }, [category, month, year, docId, profile]);

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
    return;
  };

  const sanitizeAiValue = (val: any): number => {
    if (typeof val === 'number') return val;
    if (!val || val === '-' || val === 'Rp -') return 0;
    let clean = String(val).replace(/Rp|\s/gi, '');
    clean = clean.replace(/[,\.]00$/, '');
    const parts = clean.split(/[,\.]/);
    if (parts.length > 1) {
      if (parts[parts.length - 1].length === 3) {
        clean = parts.join('');
      } else {
        const lastPart = parts.pop();
        clean = parts.join('') + '.' + lastPart;
      }
    }
    const parsed = parseFloat(clean);
    return isNaN(parsed) ? 0 : Math.round(parsed);
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
      if (!user) throw new Error('Sesi tidak ditemukan.');
      const token = await user.getIdToken();
      const res = await fetch('/api/parse-rekap', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
        body: formData,
      });
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
    if (isLocked) return;
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
        spj: getComputedSpj(emp.employeeId),
      };
      if (category === 'SATPAM' && (year > 2026 || (year === 2026 && month >= 7))) {
        const satpamShiftKeys = ['harian', 'jumatLibur', 'lemburSendiri', 'lemburCover'];
        satpamShiftKeys.forEach(k => {
          if (storedValues[k] === undefined) {
            storedValues[k] = getComputedSatpamShiftCount(emp.employeeId, k);
          }
        });
        if (storedValues.tunjanganJabatan === undefined) {
          storedValues.tunjanganJabatan = ketuaShiftIds.has(emp.employeeId) ? 100000 : 0;
        }
      }
      if (category === 'SOPIR' && storedValues.piket === undefined) {
        storedValues.piket = getComputedSopirPiketCount(emp.employeeId);
      }
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

    const sanitizedCustomCols = customColumns.map(col => {
      const cleaned = { ...col };
      if (cleaned.multiplier === undefined) delete cleaned.multiplier;
      if (cleaned.slipLabel === undefined) delete cleaned.slipLabel;
      return cleaned;
    });

    return { period, periodLabel, jobCategory: category, entries, customColumns: sanitizedCustomCols, isLocked: true, status: 'locked', updatedAt: "ServerTimestamp" };
  };

  const handleSave = () => {
    setShowSaveConfirm(true);
  };

  const handleConfirmSave = async () => {
    if (isSavingRef.current) return;
    setShowSaveConfirm(false);
    isSavingRef.current = true;
    setSaving(true);
    try {
      const payload = generateSavePayload();
      await setDoc(doc(db, 'UraianGaji', docId), { ...payload, isLocked: true, status: 'locked', updatedAt: serverTimestamp() }, { merge: true });
      const catLabel = category.replace('_', ' ').toUpperCase();
      setMessage({ type: 'success', text: `Data rekapitulasi presensi ${catLabel} berhasil disimpan dan dikunci.` });
      setSaved(true);
      setIsLocked(true);
    } catch (err) {
      setMessage({ type: 'error', text: 'Gagal menyimpan.' });
    } finally {
      isSavingRef.current = false;
      setSaving(false);
    }
  };

  const fmtRp = (n: number) =>
    'Rp\u00a0' + Math.round(n).toLocaleString('id-ID');

  const handleAddCustomColumn = () => {
    if (!newColLabel.trim()) {
      alert('Nama kolom wajib diisi!');
      return;
    }
    const cleanLabel = newColLabel.trim();
    const cleanSlipLabel = newColSlipLabel.trim() || cleanLabel;
    const uniqueKey = `custom_${cleanLabel.toLowerCase().replace(/[^a-z0-9]/g, '_')}_${Date.now().toString().slice(-4)}`;

    const newCol: RekapColumn = {
      key: uniqueKey,
      label: cleanLabel,
      type: newColType,
      multiplier: newColType === 'count' ? (Number(newColMultiplier) || 1) : undefined,
      slipLabel: cleanSlipLabel,
    };

    setCustomColumns(prev => [...prev, newCol]);
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
          rawVal = getComputedSpj(emp.employeeId);
        }
        if (category === 'SATPAM' && (year > 2026 || (year === 2026 && month >= 7)) && ['harian', 'jumatLibur', 'lemburSendiri', 'lemburCover'].includes(col.key)) {
          if (rawValues[col.key] === undefined) {
            rawVal = getComputedSatpamShiftCount(emp.employeeId, col.key);
          }
        }
        if (category === 'SATPAM' && (year > 2026 || (year === 2026 && month >= 7)) && col.key === 'tunjanganJabatan') {
          if (rawValues[col.key] === undefined) {
            rawVal = ketuaShiftIds.has(emp.employeeId) ? 100000 : 0;
          }
        }
        if (category === 'SOPIR' && col.key === 'piket' && rawValues[col.key] === undefined) {
          rawVal = getComputedSopirPiketCount(emp.employeeId);
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
        spj: getComputedSpj(emp.employeeId),
      };
      if (category === 'SATPAM' && (year > 2026 || (year === 2026 && month >= 7))) {
        const satpamShiftKeys = ['harian', 'jumatLibur', 'lemburSendiri', 'lemburCover'];
        satpamShiftKeys.forEach(k => {
          if (computedValues[k] === undefined) {
            computedValues[k] = getComputedSatpamShiftCount(emp.employeeId, k);
          }
        });
        if (computedValues.tunjanganJabatan === undefined) {
          computedValues.tunjanganJabatan = ketuaShiftIds.has(emp.employeeId) ? 100000 : 0;
        }
      }
      if (category === 'SOPIR' && computedValues.piket === undefined) {
        computedValues.piket = getComputedSopirPiketCount(emp.employeeId);
      }
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
      signature: signatureConfig[category],
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
      signature: signatureConfig[category],
    });
  };

  const startPress = () => {
    isLongPressRef.current = false;
    longPressTimerRef.current = setTimeout(() => {
      isLongPressRef.current = true;
      handleOpenSignatureModal();
    }, 800);
  };

  const endPress = (e: React.MouseEvent | React.TouchEvent) => {
    if (longPressTimerRef.current) clearTimeout(longPressTimerRef.current);
    if (isLongPressRef.current) {
      e.preventDefault();
      e.stopPropagation();
    }
  };

  const handlePdfClick = (e: React.MouseEvent) => {
    if (isLongPressRef.current) {
      e.preventDefault(); e.stopPropagation(); return;
    }
    handleExportPdf();
  };

  const handleEmptyPdfClick = (e: React.MouseEvent) => {
    if (isLongPressRef.current) {
      e.preventDefault(); e.stopPropagation(); return;
    }
    handleExportEmptyPdf();
  };

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

  const [lightboxUrl, setLightboxUrl] = useState<string | null>(null);

  return (
    <div className="space-y-6">
      {/* Global Action Bar */}
      <div className="flex flex-wrap items-center gap-3 bg-white p-4 rounded-[20px] border border-slate-200/60 shadow-sm">
        {category !== 'SATPAM' && SUPPORTED_CATEGORIES.includes(category) && (
          <Button
            onClick={() => router.push(`/dashboard/payroll/activity-review?month=${month}&year=${year}`)}
            variant="outline"
            className="rounded-xl border-teal-200 text-teal-700 bg-teal-50 hover:bg-teal-100 hover:border-teal-300 transition-all font-semibold flex items-center gap-2 shadow-sm cursor-pointer"
          >
            <CheckCircle2 className="w-4 h-4 text-teal-600" />
            Review Laporan Kegiatan
          </Button>
        )}
        <Button
          variant="outline"
          onClick={() => setIsCustomColDialogOpen(true)}
          disabled={isLocked || !category || employees.length === 0}
          className="rounded-xl border-slate-200 text-slate-600 hover:text-indigo-600 hover:border-indigo-200 flex items-center gap-2 font-semibold transition-all shadow-sm cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
        >
          <Plus className="w-4 h-4 text-indigo-500" />
          Tambah Kolom
        </Button>
        <Button
          onClick={handleSave}
          disabled={saving || isLocked || !category || employees.length === 0}
          className="rounded-xl px-6 bg-indigo-600 shadow-lg shadow-indigo-200 text-white font-bold transition-all hover:bg-indigo-700 hover:shadow-indigo-300 flex items-center gap-2 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <ShieldCheck className="w-4 h-4" />}
          Simpan rekap
        </Button>
        {isLocked ? (
          <Button
            onClick={() => setIsLocked(false)}
            variant="outline"
            className="rounded-xl border-amber-300 text-amber-800 bg-amber-50 hover:bg-amber-100 hover:border-amber-400 font-bold transition-all flex items-center gap-2 shadow-sm cursor-pointer"
          >
            <Unlock className="w-4 h-4 text-amber-600" />
            Buka Kunci
          </Button>
        ) : (
          <Button
            onClick={() => setIsLocked(true)}
            disabled={!category || employees.length === 0}
            variant="outline"
            className="rounded-xl border-slate-200 text-slate-700 hover:bg-slate-50 hover:border-slate-300 font-semibold transition-all flex items-center gap-2 shadow-sm cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <Lock className="w-4 h-4 text-slate-500" />
            Kunci
          </Button>
        )}
        {saved && (
          <Button
            onMouseDown={startPress}
            onMouseUp={endPress}
            onMouseLeave={() => {
              if (longPressTimerRef.current) clearTimeout(longPressTimerRef.current);
            }}
            onTouchStart={startPress}
            onTouchEnd={endPress}
            onClick={handlePdfClick}
            variant="outline"
            className="rounded-xl border-emerald-200 text-emerald-700 bg-emerald-50 hover:bg-emerald-100 hover:border-emerald-300 transition-all font-semibold flex items-center gap-2 shadow-sm cursor-pointer select-none"
          >
            <FileDown className="w-4 h-4" />
            Ekspor Laporan PDF
          </Button>
        )}
        {category && employees.length > 0 && (
          <Button
            onMouseDown={startPress}
            onMouseUp={endPress}
            onMouseLeave={() => {
              if (longPressTimerRef.current) clearTimeout(longPressTimerRef.current);
            }}
            onTouchStart={startPress}
            onTouchEnd={endPress}
            onClick={handleEmptyPdfClick}
            variant="outline"
            className="rounded-xl border-amber-200 text-amber-700 bg-amber-50 hover:bg-amber-100 hover:border-amber-300 transition-all font-semibold flex items-center gap-2 shadow-sm cursor-pointer select-none"
          >
            <FileText className="w-4 h-4" />
            Ekspor Templat Kosong
          </Button>
        )}
        <Button
          variant="outline"
          onClick={() => setShowScanPanel(!showScanPanel)}
          disabled={isLocked || !category || employees.length === 0}
          className="rounded-xl border-indigo-200 text-indigo-700 bg-indigo-50 hover:bg-indigo-100 hover:border-indigo-300 transition-all font-semibold flex items-center gap-2 shadow-sm cursor-pointer ml-auto disabled:opacity-50 disabled:cursor-not-allowed"
        >
          <Sparkles className="w-4 h-4 text-indigo-600" />
          {showScanPanel ? 'Sembunyikan Panel Scan' : 'Buka Panel Scan'}
        </Button>
      </div>

      {message && (
        <div className={`mb-4 flex items-center gap-2 px-4 py-3 rounded-xl text-sm font-medium ${message.type === 'success' ? 'bg-emerald-50 text-emerald-700 border border-emerald-200' : 'bg-red-50 text-red-700 border border-red-200'}`}>
          {message.type === 'success' ? <CheckCircle2 className="w-4 h-4" /> : <AlertCircle className="w-4 h-4" />} {message.text}
        </div>
      )}

      <div className="grid grid-cols-1 xl:grid-cols-12 gap-8 items-start">
        {showScanPanel && (
          <div className="xl:col-span-4 space-y-6">
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
          </div>
        )}

        <Card className={`${showScanPanel ? 'xl:col-span-8' : 'xl:col-span-12'} bg-white rounded-[20px] shadow-[0_8px_30px_rgb(0,0,0,0.04)] border-none overflow-hidden min-h-[500px] flex flex-col transition-all`}>
          <div className="p-5 flex items-center justify-between border-b border-slate-100 bg-white/50 backdrop-blur-sm z-10">
            <div className="flex items-center gap-3">
              <h2 className="text-sm font-semibold text-slate-700 flex items-center gap-2"><ImageIcon className="w-4 h-4 text-indigo-500" /> Preview Uraian Gaji — {MONTHS_ID[month - 1]} {year}</h2>
              {isLocked && (
                <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-md text-[11px] font-bold bg-amber-50 text-amber-800 border border-amber-200/80 shadow-2xs">
                  <Lock className="w-3 h-3 text-amber-600" />
                  Terkunci
                </span>
              )}
            </div>
            {category && <span className="text-xs text-slate-400 font-medium bg-slate-50 px-2 py-1 rounded-lg border border-slate-100">{employees.length} Karyawan</span>}
          </div>

          {!category ? (
            <div className="flex-1 flex flex-col items-center justify-center p-12 text-center space-y-6">
              <div className="w-20 h-20 bg-indigo-50 rounded-full flex items-center justify-center text-indigo-600 shadow-inner">
                <Building2 className="w-10 h-10" />
              </div>
              <div className="space-y-2 max-w-xs">
                <h3 className="text-lg font-bold text-slate-900 leading-tight">Pilih Kategori Kerja</h3>
                <p className="text-sm text-slate-500 leading-relaxed">Silahkan pilih unit kerja terlebih dahulu untuk melihat dan mengolah data payroll.</p>
              </div>
            </div>
          ) : loadingEmps ? (
            <div className="p-20 flex-1 flex flex-col items-center justify-center text-slate-400"><Loader2 className="w-8 h-8 animate-spin mb-3 text-indigo-400" /><p className="font-medium animate-pulse">Memuat data...</p></div>
          ) : (
            <div className={`overflow-x-auto max-h-[700px] overflow-y-auto ${hasScanData ? 'bg-slate-50/50 p-6' : ''} transition-all duration-500`}>
              <table className={`w-full text-left ${hasScanData ? 'border-separate border-spacing-y-4' : 'border-collapse'}`}>
                <thead className="sticky top-0 z-20 bg-[#F8FAFC]">
                  <tr>
                    <th className={`px-6 py-4 text-[10px] font-bold uppercase text-slate-950 tracking-wider sticky top-0 z-20 bg-[#F8FAFC] ${!hasScanData ? 'border-b border-slate-300' : ''}`} style={{ width: '220px', minWidth: '220px' }}>Nama Pegawai</th>
                    {columns.map(col => {
                      const isCustom = col.key.startsWith('custom_');
                      const hasMultiplier = !!col.multiplier;
                      return (
                        <th
                          key={col.key}
                          className={`px-4 py-4 text-[10px] font-bold uppercase text-center tracking-wider sticky top-0 z-20 bg-[#F8FAFC] ${!hasScanData ? 'border-b border-slate-300' : ''}`}
                          style={{ width: '160px', minWidth: '160px' }}
                        >
                          <div className="flex flex-col items-center justify-center gap-0.5 relative group/header">
                            <div className="flex items-center justify-center gap-1">
                              <span className="text-slate-950">{col.label}</span>
                              {isCustom && !isLocked && (
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
                          const isSatpamShift = category === 'SATPAM' && (year > 2026 || (year === 2026 && month >= 7)) && ['harian', 'jumatLibur', 'lemburSendiri', 'lemburCover'].includes(col.key);
                          const isTunjanganJabatan = category === 'SATPAM' && (year > 2026 || (year === 2026 && month >= 7)) && col.key === 'tunjanganJabatan';
                          const isSopirPiket = category === 'SOPIR' && col.key === 'piket';
                          const cellValue = isSpj
                            ? (getComputedSpj(emp.employeeId) || 0)
                            : (isSatpamShift && tableData[emp.employeeId]?.[col.key] === undefined)
                              ? (getComputedSatpamShiftCount(emp.employeeId, col.key) || 0)
                              : (isTunjanganJabatan && tableData[emp.employeeId]?.[col.key] === undefined)
                                ? (ketuaShiftIds.has(emp.employeeId) ? 100000 : 0)
                                : (isSopirPiket && tableData[emp.employeeId]?.[col.key] === undefined)
                                  ? (getComputedSopirPiketCount(emp.employeeId) || 0)
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
                                disabled={isLocked || isSpj}
                                title={isLocked ? 'Tabel rekap sedang dikunci. Klik "Buka Kunci" jika ingin mengubah data.' : isSpj ? 'SPJ dihitung otomatis dari kegiatan yang disetujui.' : undefined}
                                className={`h-10 text-center font-extrabold transition-all ${isLocked
                                  ? 'bg-slate-50/60 border-slate-200/80 text-slate-900 disabled:opacity-100 cursor-default shadow-2xs'
                                  : isSpj || isSatpamShift || isSopirPiket || (isTunjanganJabatan && ketuaShiftIds.has(emp.employeeId))
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

      {/* Custom Column Dialog */}
      <Dialog open={isCustomColDialogOpen} onOpenChange={setIsCustomColDialogOpen}>
        <DialogContent className="sm:max-w-md max-w-full overflow-hidden flex flex-col p-0 border-none bg-white shadow-2xl rounded-3xl animate-in fade-in duration-300">
          <DialogHeader className="p-6 pb-4 bg-gradient-to-r from-indigo-50/80 to-purple-50/60 border-b border-slate-100 shrink-0">
            <DialogTitle className="text-slate-800 flex items-center gap-3 font-bold text-lg">
              <Plus className="w-5 h-5 text-indigo-500" />
              Tambah Kolom Uraian Baru
            </DialogTitle>
          </DialogHeader>
          <div className="p-6 space-y-4 bg-white">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <label className="text-xs font-bold text-slate-500 uppercase tracking-wider block">Nama Kolom (Tabel)</label>
                <Input type="text" placeholder="Contoh: Rapat Wali murid" value={newColLabel} onChange={(e) => setNewColLabel(e.target.value)} className="rounded-xl border-slate-200 font-semibold text-slate-800 text-sm focus:border-indigo-500" />
              </div>
              <div className="space-y-1.5">
                <label className="text-xs font-bold text-slate-500 uppercase tracking-wider block">Label Slip Gaji (Cetak)</label>
                <Input type="text" placeholder="Kosongkan jika sama dengan tabel" value={newColSlipLabel} onChange={(e) => setNewColSlipLabel(e.target.value)} className="rounded-xl border-slate-200 font-semibold text-slate-800 text-sm focus:border-indigo-500" />
              </div>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <label className="text-xs font-bold text-slate-500 uppercase tracking-wider block">Tipe Input data</label>
                <Select value={newColType} onValueChange={(v: any) => setNewColType(v)}>
                  <SelectTrigger className="w-full bg-white border-slate-200 rounded-xl font-semibold"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="currency">Mata Uang (Rupiah Langsung)</SelectItem>
                    <SelectItem value="count">Frekuensi (Jumlah x Rate Pengali)</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              {newColType === 'count' && (
                <div className="space-y-1.5">
                  <label className="text-xs font-bold text-slate-500 uppercase tracking-wider block">Rate/Multiplier (Rp per Unit)</label>
                  <Input type="text" inputMode="numeric" pattern="[0-9]*" placeholder="Contoh: 20000" value={newColMultiplier} onChange={(e) => setNewColMultiplier(parseInt(e.target.value.replace(/\D/g, ''), 10) || '')} className="rounded-xl border-slate-200 font-semibold text-slate-800 text-sm focus:border-indigo-500 text-right" />
                </div>
              )}
            </div>
          </div>
          <div className="p-5 bg-slate-50 border-t border-slate-100 flex justify-end gap-2.5 shrink-0 rounded-b-3xl">
            <Button variant="ghost" onClick={() => setIsCustomColDialogOpen(false)} className="rounded-xl text-slate-500 hover:bg-slate-100">Batal</Button>
            <Button onClick={handleAddCustomColumn} className="rounded-xl px-6 bg-indigo-600 text-white font-bold shadow-lg hover:bg-indigo-700">Tambah Kolom</Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Signature Dialog */}
      <Dialog open={showSignatureModal} onOpenChange={setShowSignatureModal}>
        <DialogContent className="sm:max-w-md max-w-full overflow-hidden flex flex-col p-0 border-none bg-white shadow-2xl rounded-3xl animate-in fade-in duration-300">
          <DialogHeader className="p-6 pb-4 bg-gradient-to-r from-indigo-50/80 to-purple-50/60 border-b border-slate-100 shrink-0">
            <DialogTitle className="text-slate-800 flex items-center gap-3 font-bold text-lg"><FileText className="w-5 h-5 text-indigo-500" />Tanda Tangan Laporan PDF</DialogTitle>
            <p className="text-slate-500 text-xs mt-1">Pilih pegawai dan jabatan yang akan menandatangani laporan PDF untuk Kategori: <span className="font-bold text-indigo-600">{category}</span>.</p>
          </DialogHeader>
          <div className="p-6 space-y-4 bg-white overflow-y-auto max-h-[50vh]">
            <div className="space-y-1.5">
              <label className="text-xs font-bold text-slate-500 uppercase tracking-wider block">Cari Pegawai</label>
              <Input type="text" placeholder="Masukkan nama pegawai untuk mencari..." value={sigModalSearch} onChange={(e) => setSigModalSearch(e.target.value)} className="rounded-xl border-slate-200 font-semibold text-slate-800 text-sm" />
            </div>
            {sigModalSearch.trim().length > 0 && (
              <div className="border border-slate-100 rounded-xl overflow-hidden shadow-inner max-h-40 overflow-y-auto divide-y divide-slate-100">
                {loadingSigEmployees ? (
                  <div className="p-4 text-xs text-slate-500 text-center flex items-center justify-center gap-2"><Loader2 className="w-3.5 h-3.5 animate-spin" /> Memuat data...</div>
                ) : (() => {
                  const filtered = employeesForSignature.filter(emp => emp.name.toLowerCase().includes(sigModalSearch.toLowerCase()));
                  if (filtered.length === 0) return <div className="p-4 text-xs text-slate-500 text-center">Tidak ditemukan pegawai dengan nama tersebut.</div>;
                  return filtered.map(emp => (
                    <button key={emp.id} type="button" onClick={() => handleSelectEmployeeForSignature(emp)} className={`w-full text-left p-3 text-xs font-semibold hover:bg-slate-50 flex justify-between items-center ${selectedSigEmpId === emp.id ? 'bg-indigo-50 text-indigo-700' : 'text-slate-700'}`}>
                      <span>{emp.name}</span>
                      <span className="text-[10px] text-slate-400 font-normal uppercase">{emp.role} ({emp.collection === 'Employees_Loyalis' ? 'Loyalis' : 'Pekarya'})</span>
                    </button>
                  ));
                })()}
              </div>
            )}
            <div className="space-y-1.5">
              <label className="text-xs font-bold text-slate-500 uppercase tracking-wider block">Nama Penandatangan</label>
              <Input type="text" placeholder="Nama Lengkap beserta gelar..." value={sigModalName} onChange={(e) => { setSigModalName(e.target.value); setSelectedSigEmpId(''); }} className="rounded-xl font-semibold text-slate-800 text-sm border-slate-200" />
            </div>
            <div className="space-y-1.5">
              <label className="text-xs font-bold text-slate-500 uppercase tracking-wider block">Jabatan Penandatangan</label>
              <Input type="text" placeholder="Jabatan..." value={sigModalTitle} onChange={(e) => { setSigModalTitle(e.target.value); setSelectedSigEmpId(''); }} className="rounded-xl font-semibold text-slate-800 text-sm border-slate-200" />
            </div>
          </div>
          <div className="p-5 bg-slate-50 border-t border-slate-100 flex justify-end gap-2.5 shrink-0 rounded-b-3xl">
            <Button variant="ghost" onClick={() => setShowSignatureModal(false)} className="rounded-xl text-slate-500 hover:bg-slate-100">Batal</Button>
            <Button onClick={handleSaveSignature} disabled={!sigModalName.trim() || !sigModalTitle.trim()} className="rounded-xl px-6 bg-indigo-600 text-white font-bold shadow-lg hover:bg-indigo-700">Simpan</Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Save Confirm Dialog */}
      <Dialog open={showSaveConfirm} onOpenChange={setShowSaveConfirm}>
        <DialogContent className="sm:max-w-lg max-w-full overflow-hidden flex flex-col p-0 border-none bg-white shadow-2xl rounded-3xl animate-in fade-in duration-300">
          <DialogHeader className="p-6 pb-4 bg-gradient-to-r from-indigo-50/80 to-purple-50/60 border-b border-slate-100 shrink-0">
            <DialogTitle className="text-slate-800 flex items-center gap-3 font-bold text-lg">Konfirmasi & Simpan Rekap</DialogTitle>
          </DialogHeader>
          <div className="p-6 max-h-[50vh] overflow-y-auto space-y-4">
            <div className="p-3 bg-indigo-50/70 border border-indigo-100 rounded-xl text-indigo-900 text-xs flex items-center gap-2 font-medium">
              <Lock className="w-4 h-4 text-indigo-600 shrink-0" />
              <span>Setelah Anda mengonfirmasi <strong>Simpan rekap</strong>, tabel presensi akan otomatis dikunci untuk mencegah perubahan yang tidak disengaja.</span>
            </div>
            <p className="text-xs text-slate-500">Anda akan menyimpan data rekapitulasi presensi berikut ke database. Harap periksa rincian sebelum konfirmasi:</p>
            {spjDiscrepancies.length > 0 && (
              <div className="p-4 bg-amber-50 border border-amber-200 rounded-2xl flex gap-3 text-amber-900 text-xs">
                <AlertCircle className="w-5 h-5 text-amber-500 shrink-0 mt-0.5" />
                <div>
                  <p className="font-bold text-amber-800 text-sm mb-1">Peringatan: Terdapat Perbedaan Nilai SPJ</p>
                  <p className="leading-relaxed mb-2">Nilai SPJ yang dimasukkan secara manual berbeda dengan total kalkulasi Kegiatan SPJ untuk beberapa karyawan berikut:</p>
                  <ul className="list-disc list-inside space-y-1 font-semibold text-amber-800">
                    {spjDiscrepancies.map(d => (
                      <li key={d.employeeId}>{d.name}: Manual {fmtRp(d.manual)} (Kalkulasi Kegiatan: {fmtRp(d.computed)})</li>
                    ))}
                  </ul>
                </div>
              </div>
            )}
            <div className="space-y-3">
              {buildConfirmRows().length === 0 ? (
                <div className="text-center py-6 text-slate-400 text-xs">Tidak ada data untuk disimpan.</div>
              ) : (
                buildConfirmRows().map(({ emp, fields }) => (
                  <div key={emp.employeeId} className="bg-slate-50 p-4 rounded-2xl border border-slate-100">
                    <div className="font-bold text-slate-700 text-sm">{emp.name}</div>
                    <div className="text-[10px] text-slate-400 font-mono mt-0.5">{emp.employeeId}</div>
                    <div className="mt-2.5 grid grid-cols-2 md:grid-cols-3 gap-2">
                      {fields.map(f => (
                        <div key={f.col.key} className="bg-white p-2 rounded-xl border border-slate-100 flex flex-col">
                          <span className="text-[9px] text-slate-400 uppercase font-bold tracking-wider truncate">{f.col.label}</span>
                          <span className="text-slate-700 font-bold text-xs mt-0.5">
                            {f.isDual ? `${f.count} Unit (${fmtRp(f.value)})` : f.col.type === 'count' ? `${f.value / (f.col.multiplier || 1)} Unit` : fmtRp(f.value)}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
          <div className="p-5 bg-slate-50 border-t border-slate-100 flex justify-end gap-2.5 shrink-0 rounded-b-3xl">
            <Button variant="ghost" onClick={() => setShowSaveConfirm(false)} className="rounded-xl text-slate-500 hover:bg-slate-100">Batal</Button>
            <Button onClick={handleConfirmSave} disabled={saving} className="rounded-xl px-6 bg-indigo-600 text-white font-bold shadow-lg hover:bg-indigo-700 flex items-center gap-2">
              {saving && <Loader2 className="w-4 h-4 animate-spin" />}
              Konfirmasi & Simpan
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
