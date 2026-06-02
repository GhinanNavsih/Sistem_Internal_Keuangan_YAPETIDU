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
  FileDown, Plus, Calendar,
} from 'lucide-react';
import { useAuth } from '@/lib/AuthContext';
import {
  collection, getDocs, doc, setDoc, getDoc, serverTimestamp, query, where, deleteDoc
} from 'firebase/firestore';
import { db } from '@/lib/firebase';
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

const YEARS = Array.from({ length: 5 }, (_, i) => new Date().getFullYear() - i);

export default function UraianPage() {
  const router = useRouter();
  const { profile, logout } = useAuth();

  // ── Filters & UI State ────────────────────────────────────────────────────
  const [month, setMonth] = useState(new Date().getMonth() + 1);
  const [year, setYear] = useState(new Date().getFullYear());
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
  const [activeTab, setActiveTab] = useState<'presensi' | 'vakasi_loyalis'>('presensi');

  // ── Vakasi Tambahan States ──
  const [loyalisEmployees, setLoyalisEmployees] = useState<any[]>([]);
  const [loadingLoyalis, setLoadingLoyalis] = useState(false);
  const [existingEvents, setExistingEvents] = useState<any[]>([]);
  const [loadingEvents, setLoadingEvents] = useState(false);
  const [activeSuggestionIndex, setActiveSuggestionIndex] = useState<number>(0);

  // Form States
  const [selectedEventId, setSelectedEventId] = useState<string | null>(null);
  const [eventName, setEventName] = useState('');
  const [workerRows, setWorkerRows] = useState<{
    employeeId: string;
    employeeName: string;
    payGiven: number;
    showDropdown?: boolean;
    searchText?: string;
  }[]>([{ employeeId: '', employeeName: '', payGiven: 0, searchText: '', showDropdown: false }]);

  // ─── Custom Column Dialog States ──────────────────────────────────────────
  const [customColumns, setCustomColumns] = useState<RekapColumn[]>([]);
  const [isCustomColDialogOpen, setIsCustomColDialogOpen] = useState(false);
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

  // ── Fetch Vakasi Tambahan Events ──
  const fetchEvents = useCallback(async () => {
    setLoadingEvents(true);
    try {
      const periodToken = `${year}-${String(month).padStart(2, '0')}`;
      const q = query(
        collection(db, 'VakasiTambahan'),
        where('period', '==', periodToken)
      );
      const snap = await getDocs(q);
      const list = snap.docs.map(d => ({
        id: d.id,
        ...d.data()
      }));
      setExistingEvents(list);
    } catch (err) {
      console.error('Error fetching events:', err);
    } finally {
      setLoadingEvents(false);
    }
  }, [month, year]);

  useEffect(() => {
    fetchEvents();
  }, [fetchEvents]);

  // ID Sanitizer
  const sanitizeEventId = (name: string): string => {
    const clean = name.replace(/[^a-zA-Z0-9]/g, '');
    return clean.slice(0, 10);
  };

  // Submit Handler
  const handleSaveEvent = async () => {
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

    setSaving(true);
    try {
      const periodToken = `${year}-${String(month).padStart(2, '0')}`;
      const eventSeg = sanitizeEventId(eventName);
      const documentId = selectedEventId || `${periodToken}_${eventSeg}`;

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
        eventWorkers: workersMap,
        updatedAt: serverTimestamp(),
      };

      await setDoc(doc(db, 'VakasiTambahan', documentId), payload);
      setMessage({ type: 'success', text: `Event "${eventName}" berhasil disimpan.` });

      setSelectedEventId(null);
      setEventName('');
      setWorkerRows([{ employeeId: '', employeeName: '', payGiven: 0, searchText: '', showDropdown: false }]);
      fetchEvents();
    } catch (err) {
      console.error(err);
      setMessage({ type: 'error', text: 'Gagal menyimpan Event Vakasi Tambahan.' });
    } finally {
      setSaving(false);
    }
  };

  // Delete Handler
  const handleDeleteEvent = async (eventId: string) => {
    if (!confirm('Apakah Anda yakin ingin menghapus event ini?')) return;
    setSaving(true);
    try {
      await deleteDoc(doc(db, 'VakasiTambahan', eventId));
      setMessage({ type: 'success', text: 'Event Vakasi Tambahan berhasil dihapus.' });
      setSelectedEventId(null);
      setEventName('');
      setWorkerRows([{ employeeId: '', employeeName: '', payGiven: 0, searchText: '', showDropdown: false }]);
      fetchEvents();
    } catch (err) {
      console.error(err);
      setMessage({ type: 'error', text: 'Gagal menghapus event.' });
    } finally {
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
  const handleAutosave = async (currentRows = workerRows, currentEventName = eventName, activeId = selectedEventId) => {
    if (!currentEventName.trim()) return;
    const activeWorkers = currentRows.filter(w => w.employeeId);
    const ids = activeWorkers.map(w => w.employeeId);
    if (new Set(ids).size !== ids.length) return;

    try {
      const periodToken = `${year}-${String(month).padStart(2, '0')}`;
      const eventSeg = sanitizeEventId(currentEventName);
      const documentId = activeId || `${periodToken}_${eventSeg}`;

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
        eventName: currentEventName,
        period: periodToken,
        totalPayout,
        eventWorkers: workersMap,
        updatedAt: serverTimestamp(),
      };

      await setDoc(doc(db, 'VakasiTambahan', documentId), payload);
      if (!activeId) {
        setSelectedEventId(documentId);
      }
      fetchEvents();
    } catch (err) {
      console.error('Autosave error:', err);
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
  const [saved, setSaved] = useState(false);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [showPreviewModal, setShowPreviewModal] = useState(false);

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
      const storedValues = { ...rawValues };
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
    setShowSaveConfirm(false);
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
    finally { setSaving(false); }
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
        const rawVal = rawValues[col.key] ?? 0;
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
      const computedValues = { ...rawValues };
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
            {profile?.role === 'super_admin' ? (
              <Button variant="ghost" onClick={() => router.back()} className="group -ml-2 mb-2 text-slate-500 hover:text-indigo-600">
                <ArrowLeft className="w-4 h-4 mr-2 group-hover:-translate-x-1 transition-transform" />
                Kembali
              </Button>
            ) : (
              <div className="h-2" />
            )}
            <h1 className="text-3xl font-bold text-slate-900">
              {activeTab === 'presensi' ? 'Rekap Presensi Pekarya' : 'Vakasi Tambahan (Loyalis)'}
            </h1>
            <p className="text-slate-500 text-sm">
              {activeTab === 'presensi'
                ? 'Upload rekap PDF/Gambar untuk auto-input'
                : 'Kelola pembayaran kegiatan variabel loyalis bulanan'}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <Select value={String(month)} onValueChange={(v) => v && setMonth(parseInt(v))}>
              <SelectTrigger className="w-56 bg-white shadow-sm border-slate-200">
                <SelectValue>
                  {MONTHS_ID[month - 1]} ({`26 ${MONTHS_ID[(month - 2 + 12) % 12].slice(0, 3)} – 25 ${MONTHS_ID[month - 1].slice(0, 3)}`})
                </SelectValue>
              </SelectTrigger>
              <SelectContent className="w-72">
                {MONTHS_ID.map((m, i) => {
                  const prevMonth = MONTHS_ID[(i - 1 + 12) % 12];
                  const nextMonth = MONTHS_ID[(i + 1) % 12];
                  return (
                    <SelectItem key={i + 1} value={String(i + 1)}>
                      <div className="flex flex-col py-0.5">
                        <span className="font-semibold">{m}</span>
                        <span className="text-[11px] text-slate-400">26 {prevMonth.slice(0, 3)} – 25 {m.slice(0, 3)} · Bayar 5 {nextMonth.slice(0, 3)}</span>
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

            {activeTab === 'presensi' && (
              <>
                {category && allowedCategories.length > 0 && (
                  <Select value={category} onValueChange={(v) => v && setCategory(v)}>
                    <SelectTrigger className="w-48 bg-white shadow-sm border-slate-200"><SelectValue /></SelectTrigger>
                    <SelectContent>{allowedCategories.map(c => (<SelectItem key={c} value={c}>{c}</SelectItem>))}</SelectContent>
                  </Select>
                )}
                <div className="flex gap-2 ml-2">
                  <Button
                    variant={showScanPanel ? 'secondary' : 'outline'}
                    onClick={() => setShowScanPanel(p => !p)}
                    className={`rounded-xl flex items-center gap-2 font-semibold transition-all ${showScanPanel ? 'bg-indigo-100 text-indigo-700 border-indigo-200' : 'border-slate-200 text-slate-600 hover:border-indigo-200 hover:text-indigo-600'}`}
                  >
                    <Sparkles className="w-4 h-4" />
                    Scan AI
                  </Button>
                  <Button
                    variant="outline"
                    onClick={() => setIsCustomColDialogOpen(true)}
                    disabled={!category || employees.length === 0}
                    className="rounded-xl border-slate-200 text-slate-600 hover:text-indigo-600 hover:border-indigo-200 flex items-center gap-2 font-semibold transition-all shadow-sm cursor-pointer"
                  >
                    <Plus className="w-4 h-4 text-indigo-500" />
                    Tambah Kolom
                  </Button>
                  <Button variant="outline" size="icon" onClick={() => setShowSavePreview(true)} disabled={!category || employees.length === 0} className="rounded-xl border-slate-200 text-slate-500 hover:text-indigo-600 hover:border-indigo-200"><Database className="w-4 h-4" /></Button>
                  <Button onClick={handleSave} disabled={saving || !category || employees.length === 0} className="rounded-xl px-6 bg-indigo-600 shadow-lg shadow-indigo-200 text-white font-bold transition-all hover:bg-indigo-700 hover:shadow-indigo-300 flex items-center gap-2">
                    {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <ShieldCheck className="w-4 h-4" />}
                    Simpan
                  </Button>
                  {/* ── Export PDF button — shown after a successful save ── */}
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
              </>
            )}
            {profile?.role === 'satker_head' && (
              <Button
                variant="outline"
                onClick={logout}
                className="rounded-xl text-rose-600 border-slate-200 hover:bg-rose-50 hover:text-rose-700 hover:border-rose-100 transition-all cursor-pointer flex items-center gap-2"
              >
                <LogOut className="w-4 h-4" />
                Keluar
              </Button>
            )}
          </div>
        </div>

        {/* Premium Tab Switcher */}
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

        {message && (
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
                        <th className={`px-6 py-4 text-[10px] font-bold uppercase text-slate-950 tracking-wider sticky top-0 z-20 bg-[#F8FAFC] ${!hasScanData ? 'border-b border-slate-300' : ''}`}>Nama</th>
                        {columns.map(col => {
                          const hasMultiplier = col.type === 'count' && col.multiplier;
                          const isCustom = col.key.startsWith('custom_');
                          return (
                            <th
                              key={col.key}
                              className={`px-4 py-4 text-[10px] font-bold uppercase text-center tracking-wider sticky top-0 z-20 bg-[#F8FAFC] ${!hasScanData ? 'border-b border-slate-300' : ''}`}
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
                            <td className={`px-6 py-5 ${hasScanData ? `mx-2 border-l-2 border-y-2 border-slate-400 ${!bounds ? 'rounded-l-2xl' : ''} bg-white shadow-sm ring-1 ring-black/15` : 'border-b border-slate-300'}`}>
                              <div className="text-sm font-bold text-slate-800 leading-none">{emp.name}</div>
                              <div className="text-[10px] text-slate-400 font-mono mt-1.5 flex items-center gap-1"><Code2 className="w-2.5 h-2.5 opacity-50" /> {emp.employeeId}</div>
                            </td>
                            {columns.map((col, colIdx) => (
                              <td key={col.key} className={`px-3 py-5 ${hasScanData ? 'border-y-2 border-slate-400 bg-white shadow-sm ring-1 ring-black/15' : 'border-b border-slate-300'}`}>
                                <Input
                                  id={`cell-${empIdx}-${colIdx}`}
                                  type="text"
                                  value={tableData[emp.employeeId]?.[col.key] ?? ''}
                                  onChange={(e) => updateCell(emp.employeeId, col.key, e.target.value)}
                                  className={`h-10 text-center font-bold transition-all ${hasScanData ? 'rounded-xl border-slate-400 bg-slate-50/50 focus:bg-white focus:border-indigo-500 focus:ring-4 focus:ring-indigo-500/10' : 'bg-white border-slate-400 focus:border-indigo-400 focus:ring-4 focus:ring-indigo-500/10'}`}
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
                            ))}
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
        ) : (
          /* Tab 2: Vakasi Tambahan (Loyalis) UI */
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
                      setWorkerRows([{ employeeId: '', employeeName: '', payGiven: 0, searchText: '', showDropdown: false }]);
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
                          <span className="text-[10px] text-indigo-400 font-bold bg-indigo-50/50 px-2 py-0.5 rounded border border-indigo-100">
                            {workerRows.filter(r => r.employeeId).length} Orang
                          </span>
                          <span className="text-xs font-bold text-indigo-600">
                            {fmtRp(workerRows.reduce((sum, r) => sum + (r.payGiven || 0), 0))}
                          </span>
                        </div>
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
                          }}
                          className={`p-4 rounded-2xl border transition-all cursor-pointer ${isActive
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
            <Card className="xl:col-span-8 bg-white rounded-[20px] shadow-[0_8px_30px_rgb(0,0,0,0.04)] border-none overflow-visible min-h-[500px] flex flex-col p-6 space-y-6 animate-in fade-in duration-500">
              <div className="flex justify-between items-center border-b border-slate-50 pb-4">
                <div>
                  <h3 className="font-bold text-slate-800 text-sm flex items-center gap-2">
                    <Banknote className="w-4 h-4 text-indigo-500" />
                    {selectedEventId ? 'Ubah Kegiatan' : 'Buat Kegiatan Baru'}
                  </h3>
                  <p className="text-slate-400 text-xs mt-0.5">Input detail kegiatan dan daftarkan pegawai loyalis penerima payout.</p>
                </div>
                {selectedEventId && (
                  <Button
                    variant="ghost"
                    onClick={() => handleDeleteEvent(selectedEventId)}
                    className="text-rose-500 hover:text-rose-600 hover:bg-rose-50 rounded-xl"
                  >
                    <Trash2 className="w-4 h-4 mr-2" />
                    Hapus
                  </Button>
                )}
              </div>

              {/* Event Name Input */}
              <div className="space-y-2">
                <label className="text-xs font-bold text-slate-500 uppercase tracking-wider block">Nama Kegiatan</label>
                <Input
                  type="text"
                  placeholder="Contoh: Vakasi Kepanitiaan Kerja Praktek 2025/26"
                  value={eventName}
                  onChange={(e) => setEventName(e.target.value)}
                  onBlur={() => {
                    handleAutosave(workerRows, eventName, selectedEventId);
                  }}
                  className="rounded-xl border-slate-200 font-bold text-slate-800 text-sm focus:border-indigo-500 focus:ring-4 focus:ring-indigo-100 h-11"
                />
              </div>

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
                        <th className="px-4 py-3 text-[10px] font-bold text-slate-500 uppercase w-16 text-center">AKSI</th>
                      </tr>
                    </thead>
                    <tbody>
                      {workerRows.length === 0 ? (
                        <tr>
                          <td colSpan={4} className="text-center py-12 text-slate-400 text-xs font-semibold">
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
                                              className={`px-4 py-2.5 text-xs font-semibold cursor-pointer transition-colors text-left ${
                                                isActive
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
                                  value={row.payGiven || ''}
                                  onChange={(e) => {
                                    const rawVal = e.target.value.replace(/\D/g, '');
                                    const val = parseInt(rawVal, 10) || 0;
                                    setWorkerRows(prev => {
                                      const copy = [...prev];
                                      copy[rowIdx] = { ...copy[rowIdx], payGiven: val };
                                      return copy;
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
                                {row.payGiven > 0 && (
                                  <span className="text-[9px] font-bold text-slate-400 mt-1 block text-right">
                                    {fmtRp(row.payGiven)}
                                  </span>
                                )}
                              </td>
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
                    onClick={handleAddRow}
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
                    setSelectedEventId(null);
                    setEventName('');
                    setWorkerRows([{ employeeId: '', employeeName: '', payGiven: 0, searchText: '', showDropdown: false }]);
                  }}
                  className="rounded-xl border-slate-200 text-slate-600"
                >
                  Batal
                </Button>
                <Button
                  type="button"
                  onClick={handleSaveEvent}
                  disabled={saving || !eventName.trim()}
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
                          <div className="flex-1 flex items-center gap-2">
                            <span className="inline-flex items-center gap-1 px-2.5 py-1 bg-slate-50 text-slate-700 border border-slate-200 rounded-lg text-xs font-bold">
                              <Banknote className="w-3 h-3" />
                              {fmtRp(value)}
                            </span>
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
    </div>
  );
}
