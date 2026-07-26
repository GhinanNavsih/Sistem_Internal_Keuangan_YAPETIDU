"use client"

import React, { useState, useEffect, useRef, useMemo } from 'react';
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
  Loader2, CheckCircle2, FileText, AlertCircle, Trash2, Eye, Plus, Save,
  Building2, PlusCircle, Check, X, Users, Layers, Send, CheckCircle,
  RotateCcw, AlertTriangle, XCircle, Search, Copy, Sparkles, Clock, FileDown, Banknote
} from 'lucide-react';
import { useAuth } from '@/lib/AuthContext';
import {
  collection, getDocs, doc, setDoc, deleteDoc, getDoc, serverTimestamp, query, where, onSnapshot
} from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { MONTHS_ID } from '@/utils/rekapConfig';
import { generateProposalKegiatanPdf } from '@/utils/generateProposalKegiatanPdf';

export default function ProposalKegiatanPage() {
  const { profile } = useAuth();
  const searchParams = useSearchParams();

  // Read params from URL search parameters
  const month = parseInt(searchParams.get('month') || String(new Date().getMonth() + 1), 10);
  const year = parseInt(searchParams.get('year') || String(new Date().getFullYear()), 10);

  const periodToken = `${year}-${String(month).padStart(2, '0')}`;

  // ── States ──
  const [proposalList, setProposalList] = useState<any[]>([]);
  const [loadingProposal, setLoadingProposal] = useState(false);
  
  // Editor States
  const [selectedProposalId, setSelectedProposalId] = useState<string | null>(null);
  const [reportName, setReportName] = useState('');
  const [departmentUnit, setDepartmentUnit] = useState('');
  const [signatures, setSignatures] = useState<{
    label: string;
    name: string;
    title: string;
    searchText?: string;
    showDropdown?: boolean;
  }[]>([
    { label: '', name: '', title: 'Wakil Rektor Bid. Keuangan, SDM dan Umum', searchText: '', showDropdown: false },
    { label: '', name: '', title: 'Ketua BAK', searchText: '', showDropdown: false },
    { label: '', name: '', title: 'Kepala SatKer', searchText: '', showDropdown: false },
  ]);
  const [saving, setSaving] = useState(false);

  // Status & Review States
  const [currentProposalStatus, setCurrentProposalStatus] = useState<string | null>(null);
  const [currentReviewNote, setCurrentReviewNote] = useState<string | null>(null);
  const [currentSubmittedByName, setCurrentSubmittedByName] = useState<string | null>(null);
  const [currentSubmittedByEmail, setCurrentSubmittedByEmail] = useState<string | null>(null);
  const [currentProposalQueueNo, setCurrentProposalQueueNo] = useState<number | null>(null);

  // Review Dialog for Super Admin
  const [showReviewDialog, setShowReviewDialog] = useState(false);
  const [reviewAction, setReviewAction] = useState<'proposal_approved' | 'proposal_revision' | 'declined'>('proposal_approved');
  const [reviewNoteInput, setReviewNoteInput] = useState('');

  // Historical Baseline Clone Dialog States
  const [showCloneModal, setShowCloneModal] = useState(false);
  const [historicalItems, setHistoricalItems] = useState<any[]>([]);
  const [loadingHistorical, setLoadingHistorical] = useState(false);
  const [cloneSearchQuery, setCloneSearchQuery] = useState('');

  // Proposed Expenses (Rencana Anggaran Pengeluaran)
  const [pengeluaranRows, setPengeluaranRows] = useState<{
    type: 'item' | 'group_header';
    uraian: string;
    rincianQty: string;
    rincianRate: number;
    realisasi: number; // Used as Estimasi Biaya
  }[]>([{ type: 'item', uraian: '', rincianQty: '', rincianRate: 0, realisasi: 0 }]);

  // Proposed Kepanitiaan/Vakasi allocations
  const [kepanitiaanRows, setKepanitiaanRows] = useState<{
    name: string;
    employeeId?: string;
    amount: number;
    searchText?: string;
    showDropdown?: boolean;
  }[]>([{ name: '', amount: 0, searchText: '', showDropdown: false }]);

  // Suggestions Data
  const [loyalisEmployees, setLoyalisEmployees] = useState<any[]>([]);
  const [departments, setDepartments] = useState<string[]>([]);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  // Fetch departments
  useEffect(() => {
    const fetchDept = async () => {
      try {
        const deptDoc = await getDoc(doc(db, 'Settings', 'departments'));
        if (deptDoc.exists() && deptDoc.data().list) {
          setDepartments(deptDoc.data().list);
        } else {
          setDepartments(['BAK', 'FEB', 'FBS', 'FIK', 'FIP', 'FKI', 'FSP', 'FT', 'Rektorat', 'Satpam', 'Yayasan'].sort());
        }
      } catch (err) {
        console.error(err);
      }
    };
    fetchDept();
  }, []);

  // Fetch Loyalis employees
  useEffect(() => {
    const fetchLoyalis = async () => {
      try {
        const snap = await getDocs(query(collection(db, 'Employees_Loyalis'), where('personal_info.status', '==', 'AKTIF')));
        const list = snap.docs.map(d => ({
          id: d.id,
          name: d.data().personal_info?.name || '',
          role: d.data().employment_profile?.job_role || 'Pegawai',
          department: d.data().employment_profile?.department_unit || '',
        })).sort((a, b) => a.name.localeCompare(b.name));
        setLoyalisEmployees(list);
      } catch (err) {
        console.error(err);
      }
    };
    fetchLoyalis();
  }, []);

  // Live Sync ProposalKegiatan collection
  useEffect(() => {
    if (!profile) return;
    setLoadingProposal(true);
    const q = query(
      collection(db, 'ProposalKegiatan'),
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

      setProposalList(list);
      setLoadingProposal(false);
    }, (err) => {
      console.error('Error listening to ProposalKegiatan:', err);
      setLoadingProposal(false);
    });

    return () => unsubscribe();
  }, [periodToken, profile]);

  const resetForm = () => {
    setSelectedProposalId(null);
    setReportName('');
    setDepartmentUnit('');
    setCurrentProposalStatus('proposal_draft');
    setCurrentReviewNote(null);
    setCurrentSubmittedByName(null);
    setCurrentSubmittedByEmail(null);
    setCurrentProposalQueueNo(null);
    setPengeluaranRows([{ type: 'item', uraian: '', rincianQty: '', rincianRate: 0, realisasi: 0 }]);
    setKepanitiaanRows([{ name: '', amount: 0, searchText: '', showDropdown: false }]);
  };

  const handleSelectProposal = (item: any) => {
    setSelectedProposalId(item.id);
    setReportName(item.reportName || '');
    setDepartmentUnit(item.departmentUnit || '');
    setCurrentProposalStatus(item.status || 'proposal_draft');
    setCurrentReviewNote(item.reviewNote || null);
    setCurrentSubmittedByName(item.submittedByName || null);
    setCurrentSubmittedByEmail(item.submittedByEmail || null);
    setCurrentProposalQueueNo(item.proposalQueueNumber || null);

    if (item.pengeluaranRows && item.pengeluaranRows.length > 0) {
      setPengeluaranRows(item.pengeluaranRows);
    } else {
      setPengeluaranRows([{ type: 'item', uraian: '', rincianQty: '', rincianRate: 0, realisasi: 0 }]);
    }

    if (item.kepanitiaanRows && item.kepanitiaanRows.length > 0) {
      setKepanitiaanRows(item.kepanitiaanRows);
    } else {
      setKepanitiaanRows([{ name: '', amount: 0, searchText: '', showDropdown: false }]);
    }
  };

  // ── Fetch Historical Proposals & LPJs for Baseline Clone ──
  const fetchHistoricalBaselines = async () => {
    setLoadingHistorical(true);
    try {
      // Query both historical proposals & historical LPJ reports
      const snapProp = await getDocs(collection(db, 'ProposalKegiatan'));
      const snapLpj = await getDocs(collection(db, 'PelaporanKegiatan'));

      const listProp = snapProp.docs.map(d => ({ id: d.id, sourceType: 'PROPOSAL', ...d.data() }));
      const listLpj = snapLpj.docs.map(d => ({ id: d.id, sourceType: 'LPJ', ...d.data() }));

      const combined = [...listProp, ...listLpj].filter((e: any) => (e.reportName || '').trim() !== '');
      combined.sort((a: any, b: any) => (b.period || '').localeCompare(a.period || ''));

      setHistoricalItems(combined);
    } catch (err) {
      console.error('Error fetching historical baselines:', err);
    } finally {
      setLoadingHistorical(false);
    }
  };

  const handleOpenCloneModal = () => {
    setShowCloneModal(true);
    fetchHistoricalBaselines();
  };

  const handleCloneTemplate = (pastItem: any) => {
    resetForm();
    let nextName = pastItem.reportName || '';
    if (nextName.includes('2025')) {
      nextName = nextName.replace('2025', '2026');
    } else if (nextName.includes('2024')) {
      nextName = nextName.replace('2024', '2026');
    } else {
      nextName = `${nextName} ${year}`;
    }

    setReportName(nextName);
    setDepartmentUnit(pastItem.departmentUnit || '');

    if (pastItem.pengeluaranRows && pastItem.pengeluaranRows.length > 0) {
      setPengeluaranRows(pastItem.pengeluaranRows);
    }
    if (pastItem.kepanitiaanRows && pastItem.kepanitiaanRows.length > 0) {
      setKepanitiaanRows(pastItem.kepanitiaanRows);
    }

    setShowCloneModal(false);
    setMessage({
      type: 'success',
      text: `Berhasil mengkloning template anggaran dari "${pastItem.reportName}". Silakan sesuaikan rincian proposal.`
    });
  };

  // Save Proposal Draft
  const handleSaveProposalDraft = async () => {
    if (!reportName.trim()) {
      setMessage({ type: 'error', text: 'Nama Kegiatan / Proposal wajib diisi.' });
      return;
    }

    setSaving(true);
    try {
      const docId = selectedProposalId || `${periodToken}_prop_${Date.now()}`;
      const totalBudget = pengeluaranRows.reduce((sum, r) => sum + (r.realisasi || 0), 0);

      const payload = {
        reportName,
        departmentUnit,
        period: periodToken,
        totalBudget,
        pengeluaranRows,
        kepanitiaanRows,
        signatures,
        status: currentProposalStatus || 'proposal_draft',
        submittedBy: profile?.uid || null,
        submittedByName: profile?.displayName || null,
        submittedByEmail: profile?.email || null,
        updatedAt: serverTimestamp(),
      };

      await setDoc(doc(db, 'ProposalKegiatan', docId), payload, { merge: true });
      setSelectedProposalId(docId);
      setMessage({ type: 'success', text: `Draft Proposal "${reportName}" berhasil disimpan.` });
    } catch (err) {
      console.error(err);
      setMessage({ type: 'error', text: 'Gagal menyimpan proposal.' });
    } finally {
      setSaving(false);
    }
  };

  // Submit Proposal to FIFO Queue
  const handleSubmitProposalToQueue = async () => {
    if (!reportName.trim()) {
      setMessage({ type: 'error', text: 'Nama Kegiatan / Proposal wajib diisi.' });
      return;
    }

    setSaving(true);
    try {
      const docId = selectedProposalId || `${periodToken}_prop_${Date.now()}`;
      const totalBudget = pengeluaranRows.reduce((sum, r) => sum + (r.realisasi || 0), 0);

      // Compute FIFO queue number
      const existingQueues = proposalList
        .map(p => p.proposalQueueNumber)
        .filter((q): q is number => typeof q === 'number');
      const nextProposalQueueNo = existingQueues.length > 0 ? Math.max(...existingQueues) + 1 : 1;

      const payload = {
        reportName,
        departmentUnit,
        period: periodToken,
        totalBudget,
        pengeluaranRows,
        kepanitiaanRows,
        signatures,
        status: 'proposal_submitted',
        proposalQueueNumber: nextProposalQueueNo,
        submittedBy: profile?.uid || null,
        submittedByName: profile?.displayName || null,
        submittedByEmail: profile?.email || null,
        proposalSubmittedAt: serverTimestamp(),
        reviewNote: null,
        reviewedBy: null,
        reviewedAt: null,
        updatedAt: serverTimestamp(),
      };

      await setDoc(doc(db, 'ProposalKegiatan', docId), payload, { merge: true });
      setSelectedProposalId(docId);
      setCurrentProposalStatus('proposal_submitted');
      setCurrentProposalQueueNo(nextProposalQueueNo);
      setMessage({
        type: 'success',
        text: `Proposal Anggaran "${reportName}" berhasil disubmit ke antrean verifikasi Super Admin (Antrean #${nextProposalQueueNo}).`
      });
    } catch (err) {
      console.error(err);
      setMessage({ type: 'error', text: 'Gagal mengajukan proposal anggaran.' });
    } finally {
      setSaving(false);
    }
  };

  // Super Admin Review Handler
  const handleReviewProposal = async (
    proposalId: string,
    action: 'proposal_approved' | 'proposal_revision' | 'declined',
    note: string
  ) => {
    setSaving(true);
    try {
      const updatePayload: Record<string, any> = {
        status: action,
        reviewedBy: profile?.uid || null,
        reviewedAt: serverTimestamp(),
        reviewNote: note || null,
        updatedAt: serverTimestamp(),
      };

      await setDoc(doc(db, 'ProposalKegiatan', proposalId), updatePayload, { merge: true });

      let actionLabel = '';
      if (action === 'proposal_approved') actionLabel = 'Proposal Disetujui (Event Siap Dilaksanakan)';
      else if (action === 'proposal_revision') actionLabel = 'Proposal Diminta Revisi';
      else actionLabel = 'Proposal Ditolak';

      setMessage({ type: 'success', text: `Status proposal berhasil diubah: ${actionLabel}.` });

      // Trigger Email Notification
      if (currentSubmittedByEmail) {
        try {
          await fetch('/api/events/notification-email', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              recipientEmail: currentSubmittedByEmail,
              recipientName: currentSubmittedByName || 'Kepala SatKer',
              eventName: reportName,
              status: action,
              reviewNote: note,
            }),
          });
        } catch (emailErr) {
          console.error('Failed sending email notification:', emailErr);
        }
      }

      setShowReviewDialog(false);
      setReviewNoteInput('');
      setCurrentProposalStatus(action);
      setCurrentReviewNote(note || null);
    } catch (err) {
      console.error(err);
      setMessage({ type: 'error', text: 'Gagal memproses review proposal.' });
    } finally {
      setSaving(false);
    }
  };

  const getStatusBadge = (item?: any) => {
    if (!item) return null;
    const st = typeof item === 'string' ? item : (item.status || 'proposal_draft');
    const qNo = typeof item === 'object' ? item.proposalQueueNumber : null;

    switch (st) {
      case 'proposal_draft':
      case 'draft':
        return <span className="text-[10px] font-bold px-2 py-0.5 rounded border bg-slate-50 text-slate-600 border-slate-200">Draft Proposal</span>;
      case 'proposal_submitted':
        return (
          <span className="text-[10px] font-bold px-2 py-0.5 rounded border bg-indigo-50 text-indigo-700 border-indigo-200 animate-pulse flex items-center gap-1">
            <Clock className="w-3 h-3 text-indigo-500" /> Antrean Proposal {qNo ? `#${qNo}` : ''}
          </span>
        );
      case 'proposal_revision':
        return <span className="text-[10px] font-bold px-2 py-0.5 rounded border bg-orange-50 text-orange-700 border-orange-200">Revisi Proposal</span>;
      case 'proposal_approved':
        return <span className="text-[10px] font-bold px-2 py-0.5 rounded border bg-teal-50 text-teal-700 border-teal-200">Proposal Disetujui</span>;
      case 'declined':
        return <span className="text-[10px] font-bold px-2 py-0.5 rounded border bg-rose-50 text-rose-700 border-rose-200">Ditolak</span>;
      default:
        return null;
    }
  };

  const totalProposedBudget = useMemo(() => {
    return pengeluaranRows.reduce((sum, r) => sum + (r.realisasi || 0), 0);
  }, [pengeluaranRows]);

  const fmtRp = (n: number) => 'Rp\u00a0' + Math.round(n).toLocaleString('id-ID');

  const isReadOnly = profile?.role === 'satker_head_loyalis' &&
    (currentProposalStatus === 'proposal_approved' || currentProposalStatus === 'proposal_submitted');

  return (
    <div className="space-y-6">
      {/* Top Bar */}
      <div className="flex flex-wrap items-center justify-between gap-4 bg-white p-4 rounded-[20px] border border-slate-200/60 shadow-sm">
        <div className="flex items-center gap-3">
          <Button
            onClick={handleOpenCloneModal}
            variant="outline"
            className="rounded-xl border-purple-200 text-purple-700 bg-purple-50 hover:bg-purple-100 hover:border-purple-300 transition-all font-semibold flex items-center gap-2 shadow-sm cursor-pointer text-xs h-9"
          >
            <Copy className="w-4 h-4 text-purple-600" />
            Kloning Anggaran Event Lalu
          </Button>
        </div>

        <div className="flex items-center gap-2">
          <Button
            onClick={() => {
              generateProposalKegiatanPdf({
                reportName: reportName || 'Proposal Event',
                period: `${MONTHS_ID[month - 1]} ${year}`,
                departmentUnit,
                queueNumber: currentProposalQueueNo || undefined,
                pengeluaranRows,
                signatures,
              });
            }}
            variant="outline"
            className="rounded-xl border-indigo-200 text-indigo-700 bg-indigo-50 hover:bg-indigo-100 font-semibold flex items-center gap-2 shadow-sm text-xs h-9"
          >
            <FileDown className="w-4 h-4 text-indigo-600" /> Cetak Proposal (PDF)
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
        {/* Left Side: Proposal List */}
        <div className="xl:col-span-4 space-y-6">
          <Card className="bg-white rounded-[20px] shadow-[0_8px_30px_rgb(0,0,0,0.04)] border-none p-6">
            <div className="flex justify-between items-center mb-4">
              <h3 className="font-bold text-slate-800 text-sm">Pengajuan Proposal Anggaran</h3>
              <Button
                onClick={resetForm}
                size="sm"
                className="bg-indigo-50 text-indigo-600 hover:bg-indigo-100 rounded-xl font-bold flex items-center gap-1.5"
              >
                <Plus className="w-4.5 h-4.5" /> Proposal Baru
              </Button>
            </div>

            {loadingProposal ? (
              <div className="py-12 flex justify-center items-center text-slate-400 text-xs">
                <Loader2 className="w-4 h-4 animate-spin mr-2" /> Memuat proposal...
              </div>
            ) : proposalList.length === 0 ? (
              <div className="py-12 text-center text-slate-400 text-xs">Belum ada pengajuan proposal anggaran periode ini.</div>
            ) : (
              <div className="space-y-3 max-h-[500px] overflow-y-auto pr-1">
                {proposalList.map(item => {
                  const isActive = selectedProposalId === item.id;
                  return (
                    <div
                      key={item.id}
                      onClick={() => handleSelectProposal(item)}
                      className={`p-4 rounded-xl border transition-all duration-200 cursor-pointer ${isActive ? 'bg-indigo-50/70 border-indigo-300 shadow-sm ring-1 ring-indigo-300/20' : 'bg-white border-slate-100 hover:border-indigo-100'}`}
                    >
                      <div className="flex justify-between items-start gap-2">
                        <div className="font-bold text-slate-800 text-xs line-clamp-1">{item.reportName}</div>
                        {getStatusBadge(item)}
                      </div>
                      <div className="flex items-center justify-between mt-3 text-[10px] text-slate-400 font-medium">
                        <span className="bg-slate-100 px-2 py-0.5 rounded text-slate-600 font-bold uppercase tracking-wider">{item.departmentUnit || 'UMUM'}</span>
                        <span className="font-bold text-slate-700">{fmtRp(item.totalBudget || 0)}</span>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </Card>
        </div>

        {/* Right Side: Proposal Editor */}
        <div className="xl:col-span-8">
          <Card className="bg-white rounded-[20px] shadow-[0_8px_30px_rgb(0,0,0,0.04)] border-none p-6 space-y-6">
            <div className="flex justify-between items-center pb-4 border-b border-slate-100">
              <h3 className="font-bold text-slate-800 text-sm">
                {selectedProposalId ? 'Edit Proposal Anggaran Event' : 'Form Pengajuan Anggaran Event Baru'}
              </h3>
              {selectedProposalId && (
                <div className="flex items-center gap-2">
                  {getStatusBadge(proposalList.find(p => p.id === selectedProposalId) || currentProposalStatus)}
                </div>
              )}
            </div>

            {/* Revision Note Banner */}
            {currentProposalStatus === 'proposal_revision' && currentReviewNote && (
              <div className="p-4 bg-orange-50 border border-orange-200 rounded-2xl flex gap-3 text-orange-900 text-xs shadow-sm">
                <AlertTriangle className="w-5 h-5 text-orange-500 shrink-0 mt-0.5" />
                <div>
                  <p className="font-bold text-orange-800 text-sm mb-1">Catatan Revisi Proposal dari Super Admin</p>
                  <p className="leading-relaxed font-semibold">{currentReviewNote}</p>
                </div>
              </div>
            )}

            {/* Proposal Approved Banner */}
            {currentProposalStatus === 'proposal_approved' && (
              <div className="p-4 bg-teal-50 border border-teal-200 rounded-2xl flex gap-3 text-teal-900 text-xs shadow-sm">
                <CheckCircle2 className="w-5 h-5 text-teal-600 shrink-0 mt-0.5" />
                <div>
                  <p className="font-bold text-teal-800 text-sm mb-0.5">Proposal Disetujui!</p>
                  <p className="leading-relaxed font-medium">Proposal anggaran kegiatan disetujui. SatKer siap menjalankan kegiatan ini.</p>
                </div>
              </div>
            )}

            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div className="space-y-1.5">
                <label className="text-xs font-bold text-slate-500 uppercase tracking-wider block">Nama Event / Kegiatan</label>
                <Input
                  type="text"
                  placeholder="Contoh: Reuni SainTek 2026"
                  value={reportName}
                  disabled={isReadOnly}
                  onChange={(e) => setReportName(e.target.value)}
                  className="rounded-xl border-slate-200 font-semibold text-slate-800 text-sm h-10"
                />
              </div>

              <div className="space-y-1.5">
                <label className="text-xs font-bold text-slate-500 uppercase tracking-wider block">Unit Kerja Pelaksana</label>
                <Select
                  value={departmentUnit}
                  disabled={isReadOnly}
                  onValueChange={(v) => setDepartmentUnit(v || '')}
                >
                  <SelectTrigger className="w-full bg-white border-slate-200 rounded-xl font-semibold text-xs h-10">
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

            {/* Proposed Budget Summary */}
            <div className="bg-gradient-to-r from-indigo-50/60 to-purple-50/40 rounded-[20px] border border-indigo-100/40 p-4 shadow-sm flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-indigo-500 text-white flex items-center justify-center shadow-md">
                  <Banknote className="w-5 h-5" />
                </div>
                <div>
                  <span className="text-[9px] font-bold uppercase tracking-wider text-slate-400">Total Pengajuan Anggaran</span>
                  <h3 className="text-xl font-black text-slate-800 tracking-tight mt-0.5">
                    {fmtRp(totalProposedBudget)}
                  </h3>
                </div>
              </div>
            </div>

            {/* Rencana Rincian Pengeluaran Table */}
            <div className="space-y-3">
              <div className="flex justify-between items-center">
                <h4 className="font-bold text-slate-700 text-xs uppercase tracking-wider">Rencana Rincian Pengeluaran & Biaya</h4>
                {!isReadOnly && (
                  <Button
                    onClick={() => setPengeluaranRows(prev => [...prev, { type: 'item', uraian: '', rincianQty: '', rincianRate: 0, realisasi: 0 }])}
                    size="sm"
                    variant="outline"
                    className="rounded-xl border-slate-200 text-slate-600 text-xs h-8"
                  >
                    <Plus className="w-3.5 h-3.5 mr-1" /> Tambah Baris
                  </Button>
                )}
              </div>

              <div className="border border-slate-150 rounded-2xl overflow-hidden bg-white shadow-sm divide-y divide-slate-100">
                {pengeluaranRows.map((row, idx) => (
                  <div key={idx} className="p-3 flex flex-col md:flex-row items-center gap-3">
                    <Input
                      type="text"
                      placeholder="Uraian (contoh: Perlengkapan panggung, Konsumsi panitia)..."
                      value={row.uraian}
                      disabled={isReadOnly}
                      onChange={(e) => {
                        const val = e.target.value;
                        setPengeluaranRows(prev => {
                          const updated = [...prev];
                          updated[idx].uraian = val;
                          return updated;
                        });
                      }}
                      className="flex-1 rounded-xl border-slate-200 text-xs h-9 font-semibold"
                    />
                    <Input
                      type="text"
                      placeholder="Volume (contoh: 50 kotak)"
                      value={row.rincianQty}
                      disabled={isReadOnly}
                      onChange={(e) => {
                        const val = e.target.value;
                        setPengeluaranRows(prev => {
                          const updated = [...prev];
                          updated[idx].rincianQty = val;
                          return updated;
                        });
                      }}
                      className="w-full md:w-36 rounded-xl border-slate-200 text-xs h-9"
                    />
                    <Input
                      type="number"
                      placeholder="Estimasi Total (Rp)"
                      value={row.realisasi || ''}
                      disabled={isReadOnly}
                      onChange={(e) => {
                        const val = parseInt(e.target.value, 10) || 0;
                        setPengeluaranRows(prev => {
                          const updated = [...prev];
                          updated[idx].realisasi = val;
                          return updated;
                        });
                      }}
                      className="w-full md:w-44 rounded-xl border-slate-200 text-xs h-9 font-bold text-right"
                    />
                    {!isReadOnly && (
                      <Button
                        type="button"
                        variant="ghost"
                        onClick={() => {
                          const next = pengeluaranRows.filter((_, i) => i !== idx);
                          setPengeluaranRows(next.length > 0 ? next : [{ type: 'item', uraian: '', rincianQty: '', rincianRate: 0, realisasi: 0 }]);
                        }}
                        className="text-red-500 hover:bg-red-50 rounded-xl h-9 w-9 p-0"
                      >
                        <Trash2 className="w-4 h-4" />
                      </Button>
                    )}
                  </div>
                ))}
              </div>
            </div>

            {/* Footer Actions */}
            <div className="flex flex-wrap justify-end items-center gap-3 pt-4 border-t border-slate-100">
              {!isReadOnly && (
                <Button
                  onClick={handleSaveProposalDraft}
                  disabled={saving}
                  className="rounded-xl px-5 bg-slate-700 hover:bg-slate-800 text-white font-bold text-xs h-10 flex items-center gap-1.5"
                >
                  {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />} Simpan Draft
                </Button>
              )}

              {profile?.role === 'satker_head_loyalis' && (!currentProposalStatus || currentProposalStatus === 'proposal_draft' || currentProposalStatus === 'proposal_revision') && (
                <Button
                  onClick={handleSubmitProposalToQueue}
                  disabled={saving}
                  className="rounded-xl px-6 bg-indigo-600 hover:bg-indigo-700 text-white font-bold text-xs h-10 flex items-center gap-2 shadow-lg shadow-indigo-100 cursor-pointer"
                >
                  {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
                  Submit Proposal ke Admin (FIFO Queue)
                </Button>
              )}

              {/* Super Admin Review Actions */}
              {profile?.role === 'super_admin' && selectedProposalId && currentProposalStatus === 'proposal_submitted' && (
                <div className="flex gap-2">
                  <Button
                    onClick={() => { setReviewAction('proposal_approved'); handleReviewProposal(selectedProposalId, 'proposal_approved', ''); }}
                    disabled={saving}
                    className="rounded-xl px-5 bg-teal-600 hover:bg-teal-700 text-white font-bold text-xs h-10 flex items-center gap-1.5 shadow-md"
                  >
                    <CheckCircle className="w-4 h-4" /> Setujui Proposal
                  </Button>
                  <Button
                    onClick={() => { setReviewAction('proposal_revision'); setReviewNoteInput(''); setShowReviewDialog(true); }}
                    disabled={saving}
                    className="rounded-xl px-5 bg-orange-500 hover:bg-orange-600 text-white font-bold text-xs h-10 flex items-center gap-1.5 shadow-md"
                  >
                    <RotateCcw className="w-4 h-4" /> Minta Revisi Proposal
                  </Button>
                </div>
              )}
            </div>
          </Card>
        </div>
      </div>

      {/* Historical Baseline Clone Dialog */}
      <Dialog open={showCloneModal} onOpenChange={setShowCloneModal}>
        <DialogContent className="sm:max-w-2xl max-w-full overflow-hidden flex flex-col p-0 border-none bg-white shadow-2xl rounded-3xl">
          <DialogHeader className="p-6 pb-4 bg-gradient-to-r from-purple-50 to-indigo-50 border-b border-slate-100">
            <DialogTitle className="text-slate-800 flex items-center gap-2.5 font-bold text-lg">
              <Copy className="w-5 h-5 text-purple-600" /> Kloning Anggaran dari Event Lalu
            </DialogTitle>
            <p className="text-slate-500 text-xs mt-1">Pilih event dari proposal/LPJ sebelumnya untuk mengkloning struktur anggaran & rincian pengeluaran ke proposal baru.</p>
          </DialogHeader>
          <div className="p-6 space-y-4 max-h-[60vh] overflow-y-auto">
            <div className="relative">
              <Search className="w-4 h-4 text-slate-400 absolute left-3.5 top-3" />
              <Input
                type="text"
                placeholder="Cari event historis (contoh: Reuni SainTek 2025)..."
                value={cloneSearchQuery}
                onChange={(e) => setCloneSearchQuery(e.target.value)}
                className="pl-10 rounded-xl border-slate-200 font-semibold text-xs h-10"
              />
            </div>

            {loadingHistorical ? (
              <div className="py-12 flex justify-center items-center text-slate-400 text-xs">
                <Loader2 className="w-5 h-5 animate-spin mr-2 text-purple-600" /> Memuat histori event...
              </div>
            ) : (() => {
              const queryStr = cloneSearchQuery.toLowerCase();
              const filteredList = historicalItems.filter(e =>
                (e.reportName || e.eventName || '').toLowerCase().includes(queryStr) ||
                (e.departmentUnit || '').toLowerCase().includes(queryStr)
              );

              if (filteredList.length === 0) {
                return <div className="py-12 text-center text-slate-400 text-xs">Tidak ada event historis ditemukan.</div>;
              }

              return (
                <div className="space-y-3">
                  {filteredList.map((hItem) => {
                    const name = hItem.reportName || hItem.eventName;
                    return (
                      <div
                        key={hItem.id}
                        className="p-4 rounded-2xl border border-slate-150 bg-slate-50/50 hover:bg-purple-50/40 hover:border-purple-200 transition-all flex items-center justify-between gap-4"
                      >
                        <div>
                          <div className="flex items-center gap-2">
                            <span className="text-[9px] font-bold px-2 py-0.5 rounded bg-purple-100 text-purple-700 uppercase">{hItem.sourceType}</span>
                            <h4 className="font-bold text-slate-800 text-xs">{name}</h4>
                          </div>
                          <p className="text-[10px] text-slate-400 font-medium mt-1">
                            Periode {hItem.period || 'Historis'} · {hItem.departmentUnit || 'UMUM'}
                          </p>
                        </div>
                        <Button
                          onClick={() => handleCloneTemplate(hItem)}
                          className="rounded-xl px-4 bg-purple-600 hover:bg-purple-700 text-white font-bold text-xs h-9 flex items-center gap-1.5 shadow-sm shrink-0"
                        >
                          <Sparkles className="w-3.5 h-3.5" /> Gunakan Baseline Ini
                        </Button>
                      </div>
                    );
                  })}
                </div>
              );
            })()}
          </div>
          <div className="p-4 bg-slate-50 border-t border-slate-100 flex justify-end shrink-0 rounded-b-3xl">
            <Button variant="ghost" onClick={() => setShowCloneModal(false)} className="rounded-xl text-slate-500">Tutup</Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Review Dialog */}
      <Dialog open={showReviewDialog} onOpenChange={setShowReviewDialog}>
        <DialogContent className="sm:max-w-md max-w-full p-0 border-none bg-white shadow-2xl rounded-3xl overflow-hidden">
          <DialogHeader className="p-6 pb-4 bg-gradient-to-r from-orange-50 to-rose-50 border-b border-slate-100">
            <DialogTitle className="text-slate-800 flex items-center gap-2.5 font-bold text-lg">
              <AlertCircle className="w-5 h-5 text-orange-500" /> Minta Revisi Proposal Anggaran
            </DialogTitle>
            <p className="text-slate-500 text-xs mt-1">Berikan rincian perbaikan proposal untuk Kepala SatKer.</p>
          </DialogHeader>
          <div className="p-6 space-y-4">
            <textarea
              placeholder="Catatan revisi proposal (contoh: Biaya konsumsi terlalu tinggi)..."
              value={reviewNoteInput}
              onChange={(e) => setReviewNoteInput(e.target.value)}
              className="w-full rounded-xl border border-slate-200 p-3 text-xs font-semibold h-28 focus:outline-none focus:ring-2 focus:ring-indigo-100"
            />
          </div>
          <div className="p-4 bg-slate-50 border-t border-slate-100 flex justify-end gap-2 rounded-b-3xl">
            <Button variant="ghost" onClick={() => setShowReviewDialog(false)} className="rounded-xl text-slate-500">Batal</Button>
            <Button
              onClick={() => {
                if (selectedProposalId) {
                  handleReviewProposal(selectedProposalId, reviewAction, reviewNoteInput);
                }
              }}
              disabled={saving || !reviewNoteInput.trim()}
              className="rounded-xl px-5 bg-orange-500 hover:bg-orange-600 text-white font-bold text-xs h-9 flex items-center gap-1.5"
            >
              {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle className="w-4 h-4" />} Konfirmasi & Send Email
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
