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
  Crop, Building2, Code2, Database,
} from 'lucide-react';
import {
  collection, getDocs, doc, setDoc, getDoc, serverTimestamp, query, where,
} from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { 
  REKAP_COLUMNS, SUPPORTED_CATEGORIES, MONTHS_ID,
  RATE_HARIAN, RATE_JUMAT,
} from '@/utils/rekapConfig';
import { 
  renderFileToCanvas, runOcr, parseRekapRows, matchEmployee, cropCanvas,
} from '@/utils/ocrParser';
import type { 
  BlueCollarEmployee, UraianEntry, UraianGajiDocument, RekapColumn 
} from '@/types';

const YEARS = Array.from({ length: 5 }, (_, i) => new Date().getFullYear() - i);

export default function UraianPage() {
  const router = useRouter();

  // ── Filters & UI State ────────────────────────────────────────────────────
  const [month, setMonth] = useState(new Date().getMonth() + 1);
  const [year, setYear] = useState(new Date().getFullYear());
  const [category, setCategory] = useState<string>(""); 
  const [dynamicCategories, setDynamicCategories] = useState<string[]>(SUPPORTED_CATEGORIES);
  const [imageStats, setImageStats] = useState<{w:number, h:number, size:number, type:string} | null>(null);
  const [loadingEmps, setLoadingEmps] = useState(false);
  const [lastScanResult, setLastScanResult] = useState<any>(null);
  const [showDebugModal, setShowDebugModal] = useState(false);
  const [showSavePreview, setShowSavePreview] = useState(false);
  const [employees, setEmployees] = useState<BlueCollarEmployee[]>([]);
  const [tableData, setTableData] = useState<Record<string, Record<string, number>>>({});
  const [rowBounds, setRowBounds] = useState<Record<string, { top: number, bottom: number }>>({});
  const [detectedColumnOrder, setDetectedColumnOrder] = useState<string[] | null>(null);
  const [scanImgDims, setScanImgDims] = useState<{ w: number, h: number } | null>(null);
  
  const [scanning, setScanning] = useState(false);
  const [scanProgress, setScanProgress] = useState(0);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [showPreviewModal, setShowPreviewModal] = useState(false);

  // ── Columns logic ────────────────────────────────────────────────────────
  const columns = useMemo(() => {
    if (!category) return [];
    const baseCols = REKAP_COLUMNS[category] || REKAP_COLUMNS.KEBERSIHAN;
    if (detectedColumnOrder) {
      return detectedColumnOrder
        .map(key => baseCols.find(c => c.key === key))
        .filter((c): c is RekapColumn => !!c);
    }
    return baseCols;
  }, [category, detectedColumnOrder]);

  const docId = `${year}_${String(month).padStart(2, '0')}_${category}`;

  // ── File state
  const [file, setFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [rotation, setRotation] = useState(270); 
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
    setDetectedColumnOrder(null); 
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
          const docData = uraianSnap.data() as UraianGajiDocument;
          Object.values(docData.entries).forEach(entry => {
            const rawValues = { ...entry.values };
            const empCols = REKAP_COLUMNS[category] || REKAP_COLUMNS.KEBERSIHAN;
            empCols.forEach(col => {
              const isHarianOrJumat = col.key === 'harian' || col.key === 'jumatLibur';
              const multiplier = col.multiplier || (col.key === 'harian' ? RATE_HARIAN : RATE_JUMAT);
              if (isHarianOrJumat && multiplier) {
                if (entry.counts?.[col.key] !== undefined) rawValues[col.key] = entry.counts[col.key];
                else if (rawValues[col.key] && rawValues[col.key] > 31) rawValues[col.key] = Math.round(rawValues[col.key] / multiplier);
              } else if (col.type === 'count' && col.multiplier) {
                if (entry.counts?.[col.key] !== undefined) rawValues[col.key] = entry.counts[col.key];
                else if (rawValues[col.key]) rawValues[col.key] = rawValues[col.key] / col.multiplier;
              }
            });
            initialTable[entry.employeeId] = rawValues;
          });
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
            Object.keys(row.values).forEach(k => { if(!foundOrder.includes(k)) foundOrder.push(k); });
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
      const empCols = REKAP_COLUMNS[category] || REKAP_COLUMNS.KEBERSIHAN;
      empCols.forEach(col => {
        const rawVal = storedValues[col.key]; if (!rawVal) return;
        if (col.key === 'harian' || col.key === 'jumatLibur') {
          const multiplier = col.multiplier || (col.key === 'harian' ? RATE_HARIAN : RATE_JUMAT);
          if (rawVal > 31) { storedCounts[col.key] = Math.round(rawVal / multiplier); storedValues[col.key] = rawVal; }
          else { storedCounts[col.key] = rawVal; storedValues[col.key] = rawVal * multiplier; }
        } else if (col.type === 'count' && col.multiplier) { storedCounts[col.key] = rawVal; storedValues[col.key] = rawVal * col.multiplier; }
      });
      entries[emp.employeeId] = { employeeId: emp.employeeId, name: emp.name, values: storedValues, ...(Object.keys(storedCounts).length > 0 && { counts: storedCounts }) };
    }
    return { period, periodLabel, jobCategory: category, entries, updatedAt: "ServerTimestamp" };
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      const payload = generateSavePayload();
      await setDoc(doc(db, 'UraianGaji', docId), { ...payload, updatedAt: serverTimestamp() }, { merge: true });
      setMessage({ type: 'success', text: 'Data disimpan.' }); setSaved(true);
    } catch (err) { setMessage({ type: 'error', text: 'Gagal menyimpan.' }); }
    finally { setSaving(false); }
  };

  const display = getDisplayRect();
  const hasScanData = Object.keys(rowBounds).length > 0;

  return (
    <div className="min-h-screen bg-[#F8FAFC] p-6 lg:p-8 font-sans selection:bg-indigo-100">
      <div className="max-w-[1600px] mx-auto space-y-8">
        
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-6">
          <div className="space-y-1">
            <Button variant="ghost" onClick={() => router.back()} className="group -ml-2 mb-2 text-slate-500 hover:text-indigo-600"><ArrowLeft className="w-4 h-4 mr-2 group-hover:-translate-x-1 transition-transform" />Kembali</Button>
            <h1 className="text-3xl font-bold text-slate-900">Rekap Presensi</h1>
            <p className="text-slate-500 text-sm">Upload rekap PDF/Gambar untuk auto-input</p>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <Select value={String(month)} onValueChange={(v) => v && setMonth(parseInt(v))}>
              <SelectTrigger className="w-40 bg-white shadow-sm border-slate-200"><SelectValue>{month} ({MONTHS_ID[month - 1]})</SelectValue></SelectTrigger>
              <SelectContent>{MONTHS_ID.map((m, i) => (<SelectItem key={i + 1} value={String(i + 1)}>{i + 1} ({m})</SelectItem>))}</SelectContent>
            </Select>
            <Select value={String(year)} onValueChange={(v) => v && setYear(parseInt(v))}>
              <SelectTrigger className="w-28 bg-white shadow-sm border-slate-200"><SelectValue /></SelectTrigger>
              <SelectContent>{YEARS.map(y => (<SelectItem key={y} value={String(y)}>{y}</SelectItem>))}</SelectContent>
            </Select>
            {category && (
              <Select value={category} onValueChange={(v) => v && setCategory(v)}>
                <SelectTrigger className="w-48 bg-white shadow-sm border-slate-200"><SelectValue /></SelectTrigger>
                <SelectContent>{dynamicCategories.map(c => (<SelectItem key={c} value={c}>{c}</SelectItem>))}</SelectContent>
              </Select>
            )}
            <div className="flex gap-2 ml-2">
              <Button variant="outline" size="icon" onClick={() => setShowSavePreview(true)} disabled={!category || employees.length === 0} className="rounded-xl border-slate-200 text-slate-500 hover:text-indigo-600 hover:border-indigo-200"><Database className="w-4 h-4" /></Button>
              <Button onClick={handleSave} disabled={saving || !category || employees.length === 0} className="rounded-xl px-6 bg-indigo-600 shadow-lg shadow-indigo-200 text-white font-bold transition-all hover:bg-indigo-700 hover:shadow-indigo-300">Simpan</Button>
            </div>
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
                    <div className="grid grid-cols-2 gap-2 pt-2">
                      <Button onClick={handleScan} disabled={scanning || !file || !category} variant="outline" className="rounded-xl border-indigo-200 text-indigo-600 font-semibold hover:bg-indigo-50 transition-all"><ScanLine className="w-4 h-4 mr-2" /> Scan Cepat</Button>
                      <Button onClick={handleAiScan} disabled={scanning || !file || !category} className="rounded-xl bg-indigo-600 text-white font-semibold shadow-md shadow-indigo-100 hover:bg-indigo-700 transition-all"><Sparkles className="w-4 h-4 mr-2" /> Scan AI</Button>
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

          <Card className="xl:col-span-8 bg-white rounded-[20px] shadow-[0_8px_30px_rgb(0,0,0,0.04)] border-none overflow-hidden min-h-[500px] flex flex-col transition-all">
            <div className="p-5 flex items-center justify-between border-b border-slate-100 bg-white/50 backdrop-blur-sm z-10">
              <h2 className="text-sm font-semibold text-slate-700 flex items-center gap-2"><ImageIcon className="w-4 h-4 text-indigo-500" /> Preview Uraian Gaji — {MONTHS_ID[month - 1]} {year}</h2>
              {category && <span className="text-xs text-slate-400 font-medium bg-slate-50 px-2 py-1 rounded-lg border border-slate-100">{employees.length} karyawan</span>}
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
                    {dynamicCategories.map(c => (
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
                  <thead className={hasScanData ? 'bg-transparent' : 'bg-[#F8FAFC]'}>
                    <tr>
                      <th className={`px-6 py-4 text-[10px] font-bold uppercase text-slate-400 tracking-wider ${!hasScanData ? 'border-b border-slate-100' : ''}`}>Nama</th>
                      {columns.map(col => <th key={col.key} className={`px-4 py-4 text-[10px] font-bold uppercase text-slate-400 text-center tracking-wider ${!hasScanData ? 'border-b border-slate-100' : ''}`}>{col.label}</th>)}
                      {hasScanData && <th className="w-10"></th>}
                    </tr>
                  </thead>
                  {employees.map((emp, empIdx) => {
                    const bounds = rowBounds[emp.employeeId];
                    const content = (
                      <>
                        {hasScanData && bounds && (croppedPreviewUrl || previewUrl) && scanImgDims && (
                          <tr className="animate-in fade-in slide-in-from-top-4 duration-500">
                            <td colSpan={columns.length + 2} className="p-0">
                              <div className="mx-2 border-x-2 border-t-2 border-slate-200 rounded-t-2xl overflow-hidden bg-white shadow-sm ring-1 ring-black/5">
                                <div className="px-4 py-1.5 bg-slate-50 flex items-center justify-between border-b border-slate-100">
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
                          <td className={`px-6 py-5 ${hasScanData ? `mx-2 border-l-2 border-y-2 border-slate-200 ${!bounds ? 'rounded-l-2xl' : ''} bg-white shadow-sm ring-1 ring-black/5` : 'border-b border-slate-50'}`}>
                            <div className="text-sm font-bold text-slate-800 leading-none">{emp.name}</div>
                            <div className="text-[10px] text-slate-400 font-mono mt-1.5 flex items-center gap-1"><Code2 className="w-2.5 h-2.5 opacity-50" /> {emp.employeeId}</div>
                          </td>
                          {columns.map((col, colIdx) => (
                            <td key={col.key} className={`px-3 py-5 ${hasScanData ? 'border-y-2 border-slate-200 bg-white shadow-sm ring-1 ring-black/5' : 'border-b border-slate-50'}`}>
                              <Input
                                id={`cell-${empIdx}-${colIdx}`}
                                type="text"
                                value={tableData[emp.employeeId]?.[col.key] ?? ''}
                                onChange={(e) => updateCell(emp.employeeId, col.key, e.target.value)}
                                className={`h-10 text-center font-bold transition-all ${hasScanData ? 'rounded-xl border-slate-200 bg-slate-50/50 focus:bg-white focus:border-indigo-500 focus:ring-4 focus:ring-indigo-500/10' : 'bg-white border-slate-200 focus:border-indigo-400 focus:ring-4 focus:ring-indigo-500/10'}`}
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
                          {hasScanData && <td className="p-0 border-r-2 border-y-2 border-slate-200 rounded-r-2xl bg-white shadow-sm ring-1 ring-black/5" />}
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
        <DialogContent className="max-w-3xl max-h-[85vh] overflow-hidden flex flex-col p-0 border-none bg-slate-900 shadow-2xl rounded-3xl">
          <DialogHeader className="p-6 pb-4 bg-slate-800/50 backdrop-blur-md border-b border-white/5"><DialogTitle className="text-white flex items-center gap-3 font-bold text-xl"><Code2 className="w-6 h-6 text-indigo-400" />Raw AI Capture Output</DialogTitle></DialogHeader>
          <div className="flex-1 overflow-auto p-6 bg-[#0B0E14]"><pre className="p-4 rounded-2xl text-[12px] font-mono text-indigo-300/90 leading-relaxed overflow-x-auto whitespace-pre-wrap selection:bg-indigo-500/30">{JSON.stringify(lastScanResult, null, 2)}</pre></div>
          <div className="p-4 bg-slate-900 border-t border-white/5 flex justify-end gap-3">
            <Button variant="ghost" className="text-slate-400 hover:text-white hover:bg-white/5 font-bold" onClick={() => { navigator.clipboard.writeText(JSON.stringify(lastScanResult, null, 2)); setMessage({ type: 'success', text: 'Copied to clipboard' }); }}>Copy JSON</Button>
            <Button onClick={() => setShowDebugModal(false)} className="bg-indigo-600 text-white px-8 font-bold rounded-xl hover:bg-indigo-700 transition-all">Close</Button>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={showSavePreview} onOpenChange={setShowSavePreview}>
        <DialogContent className="max-w-3xl max-h-[85vh] overflow-hidden flex flex-col p-0 border-none bg-[#0F172A] shadow-2xl rounded-3xl">
          <DialogHeader className="p-6 pb-4 bg-slate-800/50 border-b border-white/5"><DialogTitle className="text-white flex items-center gap-3 font-bold text-xl"><Database className="w-6 h-6 text-emerald-400" />Preview Database Payload</DialogTitle></DialogHeader>
          <div className="flex-1 overflow-auto p-6 bg-[#020617]"><pre className="p-4 rounded-2xl text-[12px] font-mono text-emerald-300/90 leading-relaxed overflow-x-auto whitespace-pre-wrap">{JSON.stringify(generateSavePayload(), null, 2)}</pre></div>
          <div className="p-4 bg-slate-900 border-t border-white/5 flex justify-end gap-3">
            <Button variant="ghost" className="text-slate-400 hover:text-white hover:bg-white/5 font-bold" onClick={() => { navigator.clipboard.writeText(JSON.stringify(generateSavePayload(), null, 2)); setMessage({ type: 'success', text: 'Payload copied' }); }}>Copy Payload</Button>
            <Button onClick={() => setShowSavePreview(false)} className="bg-emerald-600 text-white px-8 font-bold rounded-xl hover:bg-emerald-700 transition-all">Understood</Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
