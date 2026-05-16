"use client"

import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { 
  Card, 
  CardContent, 
  CardHeader, 
  CardTitle, 
  CardDescription 
} from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
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
  ArrowLeft, Upload, ScanLine, Save, Loader2, CheckCircle2,
  FileText, AlertCircle, ImageIcon, Trash2, Eye, RotateCw, Sparkles, X,
  Crop,
} from 'lucide-react';
import {
  collection, getDocs, doc, setDoc, getDoc, serverTimestamp, query, where,
} from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { 
  REKAP_COLUMNS, SUPPORTED_CATEGORIES, MONTHS_ID, computeSlipAmount,
  RATE_HARIAN, RATE_JUMAT,
} from '@/utils/rekapConfig';
import { 
  renderFileToCanvas, runOcr, parseRekapRows, detectBestRotation, matchEmployee, cropCanvas,
} from '@/utils/ocrParser';
import type { 
  BlueCollarEmployee, UraianEntry, UraianGajiDocument, RekapColumn 
} from '@/types';

// ─── Helpers ────────────────────────────────────────────────────────────────

const YEARS = Array.from({ length: 5 }, (_, i) => new Date().getFullYear() - i);

export default function UraianPage() {
  const router = useRouter();

  // ── Filters & UI State ────────────────────────────────────────────────────
  const [month, setMonth] = useState(new Date().getMonth() + 1);
  const [year, setYear] = useState(new Date().getFullYear());
  const [category, setCategory] = useState('All');
  const [dynamicCategories, setDynamicCategories] = useState<string[]>(['All', ...SUPPORTED_CATEGORIES]);
  const [imageStats, setImageStats] = useState<{w:number, h:number, size:number, type:string} | null>(null);
  const [loadingEmps, setLoadingEmps] = useState(false);
  const [lastScanResult, setLastScanResult] = useState<any>(null);
  const [showDebugModal, setShowDebugModal] = useState(false);
  const [employees, setEmployees] = useState<BlueCollarEmployee[]>([]);
  const [tableData, setTableData] = useState<Record<string, Record<string, number>>>({});
  const [rowBounds, setRowBounds] = useState<Record<string, { top: number, bottom: number }>>({});
  const [scanImgDims, setScanImgDims] = useState<{ w: number, h: number } | null>(null);
  
  const [scanning, setScanning] = useState(false);
  const [scanProgress, setScanProgress] = useState(0);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [rawOcrText, setRawOcrText] = useState<string>('');
  const [showRawText, setShowRawText] = useState(false);
  const [showPreviewModal, setShowPreviewModal] = useState(false);

  // ── Columns logic ────────────────────────────────────────────────────────
  const columns = useMemo(() => {
    if (category !== 'All') return REKAP_COLUMNS[category] || REKAP_COLUMNS.KEBERSIHAN;
    
    // Union of all possible columns
    const all: RekapColumn[] = [];
    const seen = new Set<string>();
    Object.values(REKAP_COLUMNS).flat().forEach(col => {
      if (!seen.has(col.key)) {
        seen.add(col.key);
        all.push(col);
      }
    });
    return all;
  }, [category]);

  const docId = `${year}_${String(month).padStart(2, '0')}_${category}`;

  // ── File state
  const [file, setFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [rotation, setRotation] = useState(270); 
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // ── Crop state (percentages of the IMAGE, not the container)
  const [crop, setCrop] = useState({ x: 0, y: 0, w: 100, h: 100 });
  const [croppedPreviewUrl, setCroppedPreviewUrl] = useState<string | null>(null);
  const [isCropping, setIsCropping] = useState(false);
  
  // ── Dragging logic
  const [dragMode, setDragMode] = useState<'none' | 'move' | 't' | 'b' | 'l' | 'r' | 'tl' | 'tr' | 'bl' | 'br'>('none');
  const [startPos, setStartPos] = useState({ x: 0, y: 0 });
  const [startCrop, setStartCrop] = useState({ x: 0, y: 0, w: 100, h: 100 });
  const containerRef = useRef<HTMLDivElement>(null);

  // ── Fetch Employees & Existing Data ───────────────────────────────────────
  useEffect(() => {
    const fetch = async () => {
      setLoadingEmps(true);
      try {
        // Fetch Unique Categories first to populate dropdown
        const allEmpSnap = await getDocs(collection(db, 'Employees_BlueCollar'));
        const cats = new Set<string>(SUPPORTED_CATEGORIES);
        allEmpSnap.docs.forEach(d => {
          const cat = d.data()?.employment?.jobCategory;
          if (cat) cats.add(cat);
        });
        const sortedCats = Array.from(cats).sort();
        setDynamicCategories(['All', ...sortedCats]);

        // Fetch employees for selected category
        let q2;
        if (category === 'All') {
          q2 = query(
            collection(db, 'Employees_BlueCollar'),
            where('employment.status', '==', 'active')
          );
        } else {
          q2 = query(
            collection(db, 'Employees_BlueCollar'),
            where('employment.status', '==', 'active'),
            where('employment.jobCategory', '==', category)
          );
        }
        const empSnap = await getDocs(q2);
        const empList = empSnap.docs.map(d => ({ employeeId: d.id, ...d.data() } as BlueCollarEmployee));
        const sortedEmps = empList.sort((a, b) => a.employeeId.localeCompare(b.employeeId));
        setEmployees(sortedEmps);

        // Fetch existing data
        const initialTable: Record<string, Record<string, number>> = {};
        const periodStr = `${year}-${String(month).padStart(2, '0')}`;
        
        let docsToProcess: UraianGajiDocument[] = [];
        if (category === 'All') {
          const q = query(
            collection(db, 'UraianGaji'),
            where('period', '==', periodStr)
          );
          const snap = await getDocs(q);
          docsToProcess = snap.docs.map(d => d.data() as UraianGajiDocument);
        } else {
          const uraianSnap = await getDoc(doc(db, 'UraianGaji', docId));
          if (uraianSnap.exists()) {
            docsToProcess = [uraianSnap.data() as UraianGajiDocument];
          }
        }

        docsToProcess.forEach(docData => {
          Object.values(docData.entries).forEach(entry => {
            const rawValues = { ...entry.values };
            
            // Resolve the specific column config for this employee's category
            // to correctly handle count-to-nominal conversion
            const emp = sortedEmps.find(e => e.employeeId === entry.employeeId);
            const empCat = emp?.employment?.jobCategory || docData.jobCategory;
            const empCols = REKAP_COLUMNS[empCat] || REKAP_COLUMNS.KEBERSIHAN;

            empCols.forEach(col => {
              const isHarianOrJumat = col.key === 'harian' || col.key === 'jumatLibur';
              const multiplier = col.multiplier || (col.key === 'harian' ? RATE_HARIAN : (col.key === 'jumatLibur' ? RATE_JUMAT : null));

              if (isHarianOrJumat && multiplier) {
                if (entry.counts?.[col.key] !== undefined) {
                  rawValues[col.key] = entry.counts[col.key];
                } else if (rawValues[col.key] && rawValues[col.key] > 31) {
                  rawValues[col.key] = Math.round(rawValues[col.key] / multiplier);
                }
              } else if (col.type === 'count' && col.multiplier) {
                if (entry.counts?.[col.key] !== undefined) {
                  rawValues[col.key] = entry.counts[col.key];
                } else if (rawValues[col.key]) {
                  rawValues[col.key] = rawValues[col.key] / col.multiplier;
                }
              }
            });
            initialTable[entry.employeeId] = rawValues;
          });
        });
        setTableData(initialTable);
      } catch (err) {
        console.error('Error fetching data:', err);
      } finally {
        setLoadingEmps(false);
      }
    };
    fetch();
  }, [category, month, year, docId]);

  // ── File Upload handler ───────────────────────────────────────────────────
  const handleFileUpload = useCallback(async (newFile: File, rot: number = rotation) => {
    setFile(newFile);
    const url = URL.createObjectURL(newFile);
    setPreviewUrl(url);

    // Capture Image Stats
    const img = new Image();
    img.onload = () => {
      setImageStats({ w: img.width, h: img.height, size: newFile.size, type: newFile.type });
    };
    img.src = url;

    try {
      const canvas = await renderFileToCanvas(newFile, rot);
      canvasRef.current = canvas;
      setPreviewUrl(canvas.toDataURL('image/png'));
      setCroppedPreviewUrl(null);
      setCrop({ x: 0, y: 0, w: 100, h: 100 });
    } catch (err) {
      console.error('Error rendering file:', err);
      setMessage({ type: 'error', text: 'Gagal memproses file.' });
    }
  }, [rotation]);

  // ── Paste Image from Clipboard ──────────────────────────────────────────
  useEffect(() => {
    const handlePaste = (e: ClipboardEvent) => {
      const items = e.clipboardData?.items;
      if (!items) return;

      for (let i = 0; i < items.length; i++) {
        if (items[i].type.indexOf('image') !== -1) {
          const blob = items[i].getAsFile();
          if (blob) {
            handleFileUpload(blob);
            break;
          }
        }
      }
    };

    window.addEventListener('paste', handlePaste);
    return () => window.removeEventListener('paste', handlePaste);
  }, [handleFileUpload]);


  const handleRotate = () => {
    const nextRot = (rotation + 90) % 360;
    setRotation(nextRot);
    if (file) handleFileUpload(file, nextRot);
  };

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    const droppedFile = e.dataTransfer.files[0];
    if (droppedFile) handleFileUpload(droppedFile);
  }, [handleFileUpload]);

  const handleClearFile = () => {
    setFile(null);
    setPreviewUrl(null);
    setCroppedPreviewUrl(null);
    setRawOcrText('');
    setRowBounds({});
    setCrop({ x: 0, y: 0, w: 100, h: 100 });
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
    if (canvasRatio > containerRatio) {
      w = container.width; h = container.width / canvasRatio; x = 0; y = (container.height - h) / 2;
    } else {
      h = container.height; w = container.height * canvasRatio; y = 0; x = (container.width - w) / 2;
    }
    return { x, y, w, h };
  };

  // ── Mouse Drag Handlers ──────────────────────────────────────────────────
  const onMouseDown = (e: React.MouseEvent, mode: typeof dragMode) => {
    if (!isCropping) return;
    e.stopPropagation();
    setDragMode(mode);
    setStartPos({ x: e.clientX, y: e.clientY });
    setStartCrop({ ...crop });
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
        // Vertical
        if (dragMode.includes('t')) {
          const newY = Math.max(0, Math.min(startCrop.y + startCrop.h - 5, startCrop.y + dy));
          next.h = startCrop.h - (newY - startCrop.y); next.y = newY;
        } else if (dragMode.includes('b')) {
          next.h = Math.max(5, Math.min(100 - prev.y, startCrop.h + dy));
        }
        // Horizontal
        if (dragMode.includes('l')) {
          const newX = Math.max(0, Math.min(startCrop.x + startCrop.w - 5, startCrop.x + dx));
          next.w = startCrop.w - (newX - startCrop.x); next.x = newX;
        } else if (dragMode.includes('r')) {
          next.w = Math.max(5, Math.min(100 - prev.x, startCrop.w + dx));
        }
      }
      return next;
    });
  };

  const onMouseUp = () => setDragMode('none');

  // ── OCR Scan ──────────────────────────────────────────────────────────────
  const handleScan = async () => {
    if (!file || !canvasRef.current) return;
    setScanning(true);
    setScanProgress(10);
    setMessage(null);

    try {
      const targetCanvas = cropCanvas(canvasRef.current, crop);
      const { words, text } = await runOcr(targetCanvas, (p) => setScanProgress(20 + Math.round(p * 0.8)));
      setRawOcrText(text);
      const empList = employees.map(e => ({ employeeId: e.employeeId, name: e.name }));
      const parsed = parseRekapRows(words, empList, columns);
      setTableData(prev => {
        const next = { ...prev };
        for (const row of parsed) {
          if (row.employeeId && next[row.employeeId]) {
            next[row.employeeId] = { ...next[row.employeeId], ...row.values };
          }
        }
        return next;
      });
      if (parsed.length === 0) {
        setMessage({ type: 'error', text: 'Gagal mendeteksi baris data. Sesuaikan "Scan Area" atau gunakan "Scan AI".' });
      } else {
        setMessage({ type: 'success', text: `OCR selesai — ${parsed.length} karyawan terdeteksi.` });
      }
    } catch (err) {
      console.error('OCR error:', err);
      setMessage({ type: 'error', text: 'Gagal menjalankan OCR.' });
    } finally {
      setScanning(false);
      setScanProgress(0);
    }
  };

  const handleAiScan = async () => {
    if (!file || !canvasRef.current) return;
    setScanning(true);
    setScanProgress(30);
    setMessage(null);

    try {
      const targetCanvas = cropCanvas(canvasRef.current, crop);
      const blob = await new Promise<Blob>((resolve) => targetCanvas.toBlob((b) => resolve(b!), 'image/png'));
      const formData = new FormData();
      formData.append('file', blob, 'cropped.png');
      const res = await fetch('/api/parse-rekap', { method: 'POST', body: formData });
      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        throw new Error(errData.error || 'AI Scan failed');
      }
      const { data } = await res.json();
      setLastScanResult(data);
      
      // New structured format from Python
      const structured = data?.structured as { name: string; values: Record<string, number> }[] | undefined;
      
      if (structured && structured.length > 0) {
        const empList = employees.map(e => ({ employeeId: e.employeeId, name: e.name }));
        let matchedCount = 0;
        const newTableData = { ...tableData };
        const newRowBounds: Record<string, { top: number, bottom: number }> = {};
        
        for (const entry of (structured as any[])) {
          const match = matchEmployee(entry.name, empList);
          if (match) {
            matchedCount++;
            newTableData[match.employeeId] = { ...newTableData[match.employeeId], ...entry.values };
            if (entry.y_top !== undefined && entry.y_bottom !== undefined) {
              newRowBounds[match.employeeId] = { top: entry.y_top, bottom: entry.y_bottom };
            }
          }
        }
        
        if (matchedCount === 0) {
          throw new Error('AI terdeteksi teks, tapi tidak ada nama karyawan yang cocok. Coba sesuaikan area scan.');
        }

        setTableData(newTableData);
        setRowBounds(newRowBounds);
        if (data.img_w && data.img_h) {
          setScanImgDims({ w: data.img_w, h: data.img_h });
        }
        setMessage({ type: 'success', text: `AI Scan selesai — ${matchedCount} karyawan terdeteksi.` });
      } else {
        throw new Error('AI tidak menemukan data tabel di area ini. Pastikan header dan nama karyawan terlihat jelas.');
      }
    } catch (err: any) {
      console.error('AI error:', err);
      setMessage({ type: 'error', text: `AI Scan gagal: ${err.message}` });
    } finally {
      setScanning(false);
      setScanProgress(0);
    }
  };

  const updateCell = (employeeId: string, key: string, value: string) => {
    const num = parseInt(value, 10) || 0;
    setTableData(prev => ({ ...prev, [employeeId]: { ...prev[employeeId], [key]: num } }));
    setSaved(false);
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      const period = `${year}-${String(month).padStart(2, '0')}`;
      const periodLabel = `${MONTHS_ID[month - 1]} ${year}`;

      // Group entries by category
      const entriesByCategory: Record<string, Record<string, UraianEntry>> = {};
      
      for (const emp of employees) {
        const cat = emp.employment?.jobCategory || 'KEBERSIHAN';
        if (!entriesByCategory[cat]) entriesByCategory[cat] = {};

        const rawValues = tableData[emp.employeeId] ?? {};
        const storedValues = { ...rawValues };
        const storedCounts: Record<string, number> = {};
        
        // Use the columns of THIS employee's category for storage logic
        const empCols = REKAP_COLUMNS[cat] || REKAP_COLUMNS.KEBERSIHAN;
        
        empCols.forEach(col => {
          const rawVal = storedValues[col.key];
          if (!rawVal) return;

          const isHarianOrJumat = col.key === 'harian' || col.key === 'jumatLibur';
          
          if (isHarianOrJumat) {
            const multiplier = col.multiplier || (col.key === 'harian' ? RATE_HARIAN : RATE_JUMAT);
            
            // Auto-detect: if value > 31, treat as nominal and compute count.
            // Otherwise, treat as count and compute nominal.
            if (rawVal > 31) {
              storedCounts[col.key] = Math.round(rawVal / multiplier);
              storedValues[col.key] = rawVal;
            } else {
              storedCounts[col.key] = rawVal;
              storedValues[col.key] = rawVal * multiplier;
            }
          } else if (col.type === 'count' && col.multiplier) {
            // Other count columns
            storedCounts[col.key] = rawVal;
            storedValues[col.key] = rawVal * col.multiplier;
          }
        });

        entriesByCategory[cat][emp.employeeId] = { 
          employeeId: emp.employeeId, 
          name: emp.name, 
          values: storedValues,
          ...(Object.keys(storedCounts).length > 0 && { counts: storedCounts }),
        };
      }

      // If category is a specific one, we only save that one. 
      // If category is 'All', we save all that were modified/present.
      const categoriesToSave = category === 'All' ? Object.keys(entriesByCategory) : [category];

      for (const cat of categoriesToSave) {
        const catDocId = `${year}_${String(month).padStart(2, '0')}_${cat}`;
        const docData: UraianGajiDocument = {
          period,
          periodLabel,
          jobCategory: cat,
          entries: entriesByCategory[cat] || {},
          updatedAt: serverTimestamp(),
        } as any;
        await setDoc(doc(db, 'UraianGaji', catDocId), docData, { merge: true });
      }

      setMessage({ type: 'success', text: 'Data berhasil disimpan.' });
      setSaved(true);
    } catch (err) {
      console.error('Save error:', err);
      setMessage({ type: 'error', text: 'Gagal menyimpan data.' });
    } finally {
      setSaving(false);
    }
  };

  const display = getDisplayRect();

  return (
    <div className="min-h-screen bg-[#F8FAFC] p-6 lg:p-8 font-sans selection:bg-indigo-100">
      <div className="max-w-[1600px] mx-auto space-y-8">
        
        {/* Header */}
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-6">
          <div className="space-y-1">
            <Button variant="ghost" onClick={() => router.back()} className="group -ml-2 mb-2 text-slate-500 hover:text-indigo-600">
              <ArrowLeft className="w-4 h-4 mr-2 group-hover:-translate-x-1 transition-transform" />
              Kembali
            </Button>
            <h1 className="text-3xl font-bold text-slate-900">Rekap Presensi</h1>
            <p className="text-slate-500 text-sm">Upload rekap PDF/Gambar untuk auto-input</p>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <Select value={String(month)} onValueChange={(v) => setMonth(parseInt(v))}>
              <SelectTrigger className="w-40 bg-white">
                <SelectValue>{month} ({MONTHS_ID[month - 1]})</SelectValue>
              </SelectTrigger>
              <SelectContent>
                {MONTHS_ID.map((m, i) => (
                  <SelectItem key={i + 1} value={String(i + 1)}>
                    {i + 1} ({m})
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={String(year)} onValueChange={(v) => setYear(parseInt(v))}>
              <SelectTrigger className="w-28 bg-white">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {YEARS.map(y => (
                  <SelectItem key={y} value={String(y)}>
                    {y}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={category} onValueChange={(v) => { if (v) setCategory(v); }}>
              <SelectTrigger className="w-48 bg-white shadow-sm border-slate-200">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {dynamicCategories.map(c => (
                  <SelectItem key={c} value={c}>{c}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button onClick={handleSave} disabled={saving || employees.length === 0} className="rounded-xl px-6 bg-indigo-600 shadow-lg shadow-indigo-200 text-white">
              Simpan
            </Button>
          </div>
        </div>

        {message && (
          <div className={`mb-4 flex items-center gap-2 px-4 py-3 rounded-xl text-sm font-medium ${message.type === 'success' ? 'bg-emerald-50 text-emerald-700 border border-emerald-200' : 'bg-red-50 text-red-700 border border-red-200'}`}>
            {message.type === 'success' ? <CheckCircle2 className="w-4 h-4" /> : <AlertCircle className="w-4 h-4" />} {message.text}
          </div>
        )}

        <div className="grid grid-cols-1 xl:grid-cols-12 gap-8 items-start">
          <div className="xl:col-span-4 space-y-6">
            <Card className="bg-white rounded-[20px] shadow-[0_8px_30px_rgb(0,0,0,0.04)] border-none p-6">
              <div className={`relative p-4 border-2 border-dashed rounded-[20px] transition-all duration-300 ${file ? 'border-indigo-100 bg-indigo-50/20' : 'border-slate-200 hover:border-indigo-300'}`} onDragOver={(e) => e.preventDefault()} onDrop={handleDrop}>
                {file ? (
                  <div className="space-y-4">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2 text-xs text-slate-600">
                        <FileText className="w-3.5 h-3.5 text-indigo-500" />
                        <span className="truncate max-w-[120px] font-medium">{file.name}</span>
                      </div>
                      <div className="flex gap-1">
                        <Button variant={isCropping ? "secondary" : "ghost"} size="icon" onClick={() => setIsCropping(!isCropping)} className="h-7 w-7 rounded-lg">
                          <Crop className={`w-3.5 h-3.5 ${isCropping ? 'text-indigo-600' : 'text-slate-400'}`} />
                        </Button>
                        <Button variant="ghost" size="icon" onClick={handleRotate} className="h-7 w-7 rounded-lg"><RotateCw className="w-3.5 h-3.5" /></Button>
                        <Button variant="ghost" size="icon" onClick={handleClearFile} className="h-7 w-7 rounded-lg text-red-500"><Trash2 className="w-3.5 h-3.5" /></Button>
                      </div>
                    </div>

                    <div 
                      ref={containerRef}
                      onMouseMove={onMouseMove}
                      onMouseUp={onMouseUp}
                      onMouseLeave={onMouseUp}
                      className="relative aspect-[3/4] w-full bg-white rounded-xl border border-slate-200 overflow-hidden group/preview select-none"
                    >
                      {previewUrl ? (
                        <>
                          <img src={isCropping ? previewUrl : (croppedPreviewUrl || previewUrl)} alt="Preview" className="w-full h-full object-contain pointer-events-none" />
                          
                          {isCropping && (
                            <div className="absolute pointer-events-auto" style={{ left: display.x, top: display.y, width: display.w, height: display.h }}>
                              <div className="absolute top-0 left-0 w-full bg-slate-900/60" style={{ height: `${crop.y}%` }} />
                              <div className="absolute bottom-0 left-0 w-full bg-slate-900/60" style={{ height: `${100 - crop.y - crop.h}%` }} />
                              <div className="absolute top-0 left-0 h-full bg-slate-900/60" style={{ top: `${crop.y}%`, height: `${crop.h}%`, width: `${crop.x}%` }} />
                              <div className="absolute top-0 right-0 h-full bg-slate-900/60" style={{ top: `${crop.y}%`, height: `${crop.h}%`, width: `${100 - crop.x - crop.w}%` }} />

                              <div 
                                onMouseDown={(e) => onMouseDown(e, 'move')}
                                className="absolute border-2 border-indigo-400 shadow-[0_0_0_1px_rgba(255,255,255,0.3)] cursor-move"
                                style={{ left: `${crop.x}%`, top: `${crop.y}%`, width: `${crop.w}%`, height: `${crop.h}%` }}
                              >
                                {/* Edges */}
                                <div onMouseDown={(e) => onMouseDown(e, 't')} className="absolute -top-1 left-0 w-full h-2 cursor-ns-resize" />
                                <div onMouseDown={(e) => onMouseDown(e, 'b')} className="absolute -bottom-1 left-0 w-full h-2 cursor-ns-resize" />
                                <div onMouseDown={(e) => onMouseDown(e, 'l')} className="absolute top-0 -left-1 h-full w-2 cursor-ew-resize" />
                                <div onMouseDown={(e) => onMouseDown(e, 'r')} className="absolute top-0 -right-1 h-full w-2 cursor-ew-resize" />
                                
                                {/* Corners */}
                                <div onMouseDown={(e) => onMouseDown(e, 'tl')} className="absolute -top-2 -left-2 w-4 h-4 cursor-nwse-resize z-10" />
                                <div onMouseDown={(e) => onMouseDown(e, 'tr')} className="absolute -top-2 -right-2 w-4 h-4 cursor-nesw-resize z-10" />
                                <div onMouseDown={(e) => onMouseDown(e, 'bl')} className="absolute -bottom-2 -left-2 w-4 h-4 cursor-nesw-resize z-10" />
                                <div onMouseDown={(e) => onMouseDown(e, 'br')} className="absolute -bottom-2 -right-2 w-4 h-4 cursor-nwse-resize z-10" />

                                <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                                  <div className="bg-indigo-600 text-white text-[7px] font-bold px-1 py-0.5 rounded shadow-sm opacity-80">SCAN AREA</div>
                                </div>
                              </div>
                            </div>
                          )}

                          {isCropping && (
                            <div className="absolute bottom-4 left-4 right-4 bg-white/95 backdrop-blur-md p-2 rounded-xl border border-indigo-100 shadow-2xl z-50">
                              <Button size="sm" className="w-full h-8 text-xs bg-indigo-600 hover:bg-indigo-700 font-semibold text-white" onClick={handleDoneCropping}>Done</Button>
                            </div>
                          )}

                          {!isCropping && (
                            <div className="absolute inset-0 bg-slate-900/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center backdrop-blur-[2px]">
                              <Button variant="secondary" size="sm" className="rounded-lg font-medium" onClick={() => setShowPreviewModal(true)}>
                                <Eye className="w-4 h-4 mr-2" /> View Full
                              </Button>
                            </div>
                          )}
                        </>
                      ) : <div className="aspect-[3/4] w-full flex items-center justify-center bg-slate-50 rounded-xl animate-pulse"><Loader2 className="w-6 h-6 animate-spin text-slate-200" /></div>}
                    </div>

                    <div className="grid grid-cols-2 gap-2 pt-2">
                      <Button onClick={handleScan} disabled={scanning || !file} variant="outline" className="rounded-xl border-indigo-200 text-indigo-600"><ScanLine className="w-4 h-4 mr-2" /> Scan Cepat</Button>
                      <Button onClick={handleAiScan} disabled={scanning || !file} className="rounded-xl bg-indigo-600 shadow-md text-white"><Sparkles className="w-4 h-4 mr-2" /> Scan AI</Button>
                    </div>

                    {imageStats && (
                      <div className="flex flex-col items-center justify-center p-3 bg-indigo-50/30 rounded-xl border border-indigo-100/50 mt-2">
                        <div className="text-[10px] font-bold text-indigo-600 uppercase tracking-widest mb-2 opacity-70">Source Quality</div>
                        <div className="grid grid-cols-2 gap-x-6 gap-y-1.5 w-full text-[10px]">
                          <div className="flex justify-between text-slate-400"><span>Resolution:</span> <span className="text-slate-700 font-semibold">{imageStats.w}x{imageStats.h}</span></div>
                          <div className="flex justify-between text-slate-400"><span>File Size:</span> <span className="text-slate-700 font-semibold">{(imageStats.size / 1024).toFixed(0)} KB</span></div>
                          <div className="flex justify-between text-slate-400"><span>Format:</span> <span className="text-slate-700 font-semibold uppercase">{imageStats.type.split('/')[1]}</span></div>
                          <div className="flex justify-between text-slate-400"><span>Status:</span> <span className={`${imageStats.w > 1500 ? 'text-emerald-600' : 'text-amber-500'} font-bold`}>{imageStats.w > 1500 ? 'HIGH-RES' : 'LOW-RES'}</span></div>
                        </div>
                      </div>
                    )}

                    {lastScanResult && (
                      <Button 
                        variant="ghost" 
                        size="sm" 
                        onClick={() => setShowDebugModal(true)}
                        className="w-full mt-2 text-[10px] text-slate-400 hover:text-indigo-600"
                      >
                        <AlertCircle className="w-3 h-3 mr-1" /> View Raw AI Result (Debug)
                      </Button>
                    )}
                  </div>
                ) : (
                  <div className="flex flex-col items-center justify-center py-12 text-center cursor-pointer" onClick={() => fileInputRef.current?.click()}>
                    <div className="w-16 h-16 bg-indigo-50 text-indigo-600 rounded-2xl flex items-center justify-center mb-4"><Upload className="w-8 h-8" /></div>
                    <h3 className="text-slate-900 font-semibold mb-1 text-sm">Upload Rekap</h3>
                    <p className="text-slate-500 text-xs mb-6">Support PDF, JPG, PNG.</p>
                    <input type="file" className="hidden" ref={fileInputRef} onChange={(e) => e.target.files?.[0] && handleFileUpload(e.target.files[0])} accept=".pdf,image/*" />
                    <Button variant="outline" className="rounded-xl border-slate-200 text-xs">Pilih File</Button>
                  </div>
                )}
              </div>
            </Card>

            <div className="text-[10px] text-slate-400 bg-slate-50 rounded-xl p-3 border border-slate-100 leading-relaxed">
              <strong>Tips:</strong> Drag <strong>tengah</strong> untuk pindah. Drag <strong>tepi/pojok</strong> untuk ubah ukuran (lebar & tinggi).
            </div>
          </div>

          <Card className="xl:col-span-8 bg-white rounded-[20px] shadow-[0_8px_30px_rgb(0,0,0,0.04)] border-none overflow-hidden">
            <div className="p-5 flex items-center justify-between border-b border-slate-100">
              <h2 className="text-sm font-semibold text-slate-700 flex items-center gap-2">
                <ImageIcon className="w-4 h-4 text-indigo-500" />
                Preview Uraian Gaji — {MONTHS_ID[month]} {year}
              </h2>
              <span className="text-xs text-slate-400">{employees.length} karyawan</span>
            </div>

            {loadingEmps ? (
              <div className="p-20 flex flex-col items-center text-slate-400"><Loader2 className="w-8 h-8 animate-spin mb-3 text-indigo-400" /><p>Memuat data...</p></div>
            ) : (
              <div className="overflow-x-auto max-h-[700px] overflow-y-auto">
                <table className="w-full text-left border-collapse min-w-[800px]">
                  <thead className="sticky top-0 z-20 bg-[#F8FAFC]">
                    <tr>
                      <th className="px-6 py-4 text-[10px] font-bold uppercase text-slate-400 border-b border-slate-100">Nama</th>
                      {columns.map(col => <th key={col.key} className="px-4 py-4 text-[10px] font-bold uppercase text-slate-400 border-b border-slate-100 text-center">{col.label}</th>)}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-50">
                    {employees.map((emp, empIdx) => {
                      const bounds = rowBounds[emp.employeeId];
                      return (
                        <React.Fragment key={emp.employeeId}>
                          {bounds && (croppedPreviewUrl || previewUrl) && scanImgDims && (
                            <tr className="bg-slate-50/50 border-t border-slate-100">
                              <td colSpan={columns.length + 1} className="p-0">
                                <div 
                                  className="relative w-full overflow-hidden bg-white border-b border-slate-200"
                                  style={{
                                    // Dynamically set container height based on the row's original aspect ratio
                                    // Added 20px to the height difference for a little vertical padding
                                    aspectRatio: `${scanImgDims.w} / ${bounds.bottom - bounds.top + 20}`
                                  }}
                                >
                                  <img 
                                    src={croppedPreviewUrl || previewUrl || ''} 
                                    alt="Reference Slice" 
                                    className="absolute left-0 w-full max-w-none"
                                    style={{
                                      // We use percentage-based transform to avoid scaling issues.
                                      // Subtracting a bit from the top to center the text better.
                                      transform: `translateY(-${((bounds.top - 10) / scanImgDims.h) * 100}%)`,
                                      filter: 'contrast(1.15) brightness(1.05) saturate(1.1)',
                                    }}
                                  />
                                  <div className="absolute inset-0 bg-gradient-to-r from-white/40 via-transparent to-transparent w-40 pointer-events-none" />
                                </div>
                              </td>
                            </tr>
                          )}
                          
                          {/* Data Input Row */}
                          <tr className="hover:bg-indigo-50/30 transition-colors">
                            <td className="px-6 py-4">
                              <div className="text-sm font-medium text-slate-700">{emp.name}</div>
                              <div className="text-[10px] text-slate-400 font-mono">{emp.employeeId}</div>
                            </td>
                            {columns.map((col, colIdx) => (
                              <td key={col.key} className="px-2 py-4">
                                <Input 
                                  id={`cell-${empIdx}-${colIdx}`}
                                  type="text" 
                                  value={tableData[emp.employeeId]?.[col.key] ?? ''} 
                                  onChange={(e) => updateCell(emp.employeeId, col.key, e.target.value)} 
                                  onKeyDown={(e) => {
                                    let nextRow = empIdx;
                                    let nextCol = colIdx;
                                    let shouldMove = false;

                                    if (e.key === 'Enter') {
                                      e.preventDefault();
                                      shouldMove = true;
                                      if (e.shiftKey) {
                                        // Shift + Enter -> Move Right
                                        nextCol = colIdx + 1;
                                        if (nextCol >= columns.length) {
                                          nextCol = 0;
                                          nextRow = empIdx + 1;
                                        }
                                      } else {
                                        // Enter -> Move Down
                                        nextRow = empIdx + 1;
                                      }
                                    } else if (e.key === 'ArrowDown') {
                                      e.preventDefault();
                                      nextRow = empIdx + 1;
                                      shouldMove = true;
                                    } else if (e.key === 'ArrowUp') {
                                      e.preventDefault();
                                      nextRow = empIdx - 1;
                                      shouldMove = true;
                                    } else if (e.key === 'ArrowRight') {
                                      const target = e.target as HTMLInputElement;
                                      if (target.selectionStart === target.value.length) {
                                        e.preventDefault();
                                        nextCol = colIdx + 1;
                                        shouldMove = true;
                                      }
                                    } else if (e.key === 'ArrowLeft') {
                                      const target = e.target as HTMLInputElement;
                                      if (target.selectionStart === 0) {
                                        e.preventDefault();
                                        nextCol = colIdx - 1;
                                        shouldMove = true;
                                      }
                                    }
                                    
                                    if (shouldMove) {
                                      const nextId = `cell-${nextRow}-${nextCol}`;
                                      const nextEl = document.getElementById(nextId);
                                      if (nextEl) {
                                        nextEl.focus();
                                        (nextEl as HTMLInputElement).select();
                                      }
                                    }
                                  }}
                                  className="w-full h-8 px-2 text-center text-xs rounded-lg border-slate-200 bg-white/50 focus:bg-white focus:ring-2 focus:ring-indigo-500/20 transition-all" 
                                />
                              </td>
                            ))}
                          </tr>
                        </React.Fragment>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </Card>
        </div>
      </div>

      <Dialog open={showPreviewModal} onOpenChange={setShowPreviewModal}>
        <DialogContent className="max-w-[95vw] max-h-[95vh] p-0 overflow-hidden bg-slate-900/95 border-none">
          <div className="relative w-full h-[90vh] flex items-center justify-center p-4">
            <Button variant="ghost" size="icon" onClick={() => setShowPreviewModal(false)} className="absolute top-4 right-4 z-50 text-white rounded-full"><X className="w-6 h-6" /></Button>
            {previewUrl && <img src={previewUrl} alt="Full Preview" className="max-w-full max-h-full object-contain" />}
          </div>
        </DialogContent>
      </Dialog>

      {/* Debug Modal */}
      <Dialog open={showDebugModal} onOpenChange={setShowDebugModal}>
        <DialogContent className="max-w-2xl max-h-[80vh] overflow-hidden flex flex-col p-0 border-none bg-slate-900 shadow-2xl">
          <DialogHeader className="p-6 pb-0">
            <DialogTitle className="text-white flex items-center gap-2">
              <Sparkles className="w-5 h-5 text-indigo-400" />
              Raw AI Scan Output
            </DialogTitle>
          </DialogHeader>
          <div className="flex-1 overflow-auto p-6">
            <pre className="bg-slate-950 p-4 rounded-xl text-[11px] font-mono text-indigo-300 border border-slate-800 leading-relaxed overflow-x-auto whitespace-pre-wrap">
              {JSON.stringify(lastScanResult, null, 2)}
            </pre>
          </div>
          <div className="p-4 bg-slate-950/50 border-t border-slate-800 flex justify-end gap-2">
            <Button 
              variant="outline" 
              className="border-slate-700 text-slate-300 hover:bg-slate-800"
              onClick={() => {
                navigator.clipboard.writeText(JSON.stringify(lastScanResult, null, 2));
                alert('JSON copied to clipboard!');
              }}
            >
              Copy JSON
            </Button>
            <Button onClick={() => setShowDebugModal(false)} className="bg-indigo-600 hover:bg-indigo-700 text-white">Close</Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
