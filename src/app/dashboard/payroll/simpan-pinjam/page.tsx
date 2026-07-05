"use client";

import React, { useState, useEffect, useMemo } from 'react';
import GlobalHeader from '@/components/GlobalHeader';
import Link from 'next/link';
import { db, secondaryDb } from '@/lib/firebase';
import { collection, getDocs } from 'firebase/firestore';
import { useAuth } from '@/lib/AuthContext';
import { normalizeName, MANUAL_OVERRIDES } from '../../../../utils/payrollLogic';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import {
  ArrowLeft,
  Banknote,
  Search,
  AlertCircle,
  CheckCircle2,
  Info,
  Clock,
  HelpCircle,
  Loader2,
  User,
  Activity,
  History,
  FileText,
} from 'lucide-react';

interface KoperasiUser {
  id: string;
  uid?: string;
  nama: string;
  email: string;
  nik: string;
  satuanKerja?: string;
  nomorWhatsapp?: string;
}

interface LoanHistory {
  status: string;
  notes?: string;
  updatedBy?: string;
  timestamp?: {
    seconds: number;
    nanoseconds: number;
  };
}

interface SimpanPinjamDoc {
  id: string;
  userId: string;
  status: string;
  jumlahPinjaman: number;
  tenor: number;
  sisaHutang: number;
  jumlahMenyicil: number;
  tanggalPengajuan?: {
    seconds: number;
    nanoseconds: number;
  };
  userData?: {
    namaLengkap?: string;
    email?: string;
    nik?: string;
    satuanKerja?: string;
    nomorWhatsapp?: string;
  };
  bankDetails?: {
    bank?: string;
    nomorRekening?: string;
  };
  history?: LoanHistory[];
  catatanTambahan?: string[];
  alasanPenolakan?: string;
}

interface InternalEmployee {
  id: string;
  name: string;
  normalizedName: string;
  collection: 'Employees_Loyalis' | 'Employees_BlueCollar';
  koperasiAuthUid?: string | null;
  koperasiUserId?: string | null;
  email?: string;
  nik?: string;
}

interface ProcessedLoan extends SimpanPinjamDoc {
  borrowerName: string;
  borrowerEmail: string;
  borrowerNik: string;
  borrowerWhatsapp: string;
  borrowerSatuanKerja: string;
  matchedEmployee: InternalEmployee | undefined;
  matchType: 'direct' | 'fallback_name' | 'none';
  warnings: string[];
  monthlyInstallment: number;
}

export default function SimpanPinjamReviewPage() {
  const { profile, loading: authLoading } = useAuth();
  
  const [loans, setLoans] = useState<SimpanPinjamDoc[]>([]);
  const [kopUsers, setKopUsers] = useState<KoperasiUser[]>([]);
  const [employees, setEmployees] = useState<InternalEmployee[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [activeTab, setActiveTab] = useState<'all' | 'active' | 'warnings' | 'completed'>('active');
  const [selectedLoan, setSelectedLoan] = useState<ProcessedLoan | null>(null);

  // 1. Fetch All Data
  useEffect(() => {
    const fetchData = async () => {
      try {
        setLoading(true);
        // Fetch Koperasi loans & users
        const [loanSnap, userSnap, loyalisSnap, blueCollarSnap] = await Promise.all([
          getDocs(collection(secondaryDb, 'simpanPinjam')),
          getDocs(collection(secondaryDb, 'users')),
          getDocs(collection(db, 'Employees_Loyalis')),
          getDocs(collection(db, 'Employees_BlueCollar')),
        ]);

        const loansList = loanSnap.docs.map(docSnap => ({
          id: docSnap.id,
          ...docSnap.data(),
        })) as SimpanPinjamDoc[];

        const usersList = userSnap.docs.map(docSnap => ({
          id: docSnap.id,
          ...docSnap.data(),
        })) as KoperasiUser[];

        const employeesList: InternalEmployee[] = [];

        loyalisSnap.docs.forEach(docSnap => {
          const data = docSnap.data();
          const name = data.personal_info?.name || '';
          if (name) {
            employeesList.push({
              id: docSnap.id,
              name,
              normalizedName: normalizeName(name),
              collection: 'Employees_Loyalis',
              koperasiAuthUid: data.koperasiAuthUid || null,
              koperasiUserId: data.koperasiUserId || null,
              email: data.personal_info?.email || '',
              nik: data.personal_info?.nik || '',
            });
          }
        });

        blueCollarSnap.docs.forEach(docSnap => {
          const data = docSnap.data();
          const name = data.name || '';
          if (name) {
            employeesList.push({
              id: docSnap.id,
              name,
              normalizedName: normalizeName(name),
              collection: 'Employees_BlueCollar',
              koperasiAuthUid: data.koperasiAuthUid || null,
              koperasiUserId: data.koperasiUserId || null,
              email: data.email || '',
              nik: data.nik || '',
            });
          }
        });

        setLoans(loansList);
        setKopUsers(usersList);
        setEmployees(employeesList);
      } catch (err) {
        console.error('Error fetching data for loan review page:', err);
      } finally {
        setLoading(false);
      }
    };

    fetchData();
  }, []);

  // 2. Perform Linkage Match
  const processedLoans = useMemo<ProcessedLoan[]>(() => {
    return loans.map(loan => {
      // Find Koperasi User profile
      const kopUser = kopUsers.find(
        u => u.uid === loan.userId || u.id === loan.userId
      );

      // Determine borrower info (from loan doc or from Koperasi user collection)
      const borrowerName = loan.userData?.namaLengkap || kopUser?.nama || '';
      const borrowerEmail = loan.userData?.email || kopUser?.email || '';
      const borrowerNik = loan.userData?.nik || kopUser?.nik || '';
      const borrowerWhatsapp = loan.userData?.nomorWhatsapp || kopUser?.nomorWhatsapp || '';
      const borrowerSatuanKerja = loan.userData?.satuanKerja || kopUser?.satuanKerja || '';

      const normalizedBorrowerName = normalizeName(borrowerName);

      // Try exact UID Match
      let matchedEmployee = employees.find(
        emp => emp.koperasiAuthUid && emp.koperasiAuthUid === loan.userId
      );
      let matchType: 'direct' | 'fallback_name' | 'none' = 'direct';

      if (!matchedEmployee) {
        // Fallback 1: Name-string normalization match
        matchedEmployee = employees.find(emp => emp.normalizedName === normalizedBorrowerName);
        matchType = matchedEmployee ? 'fallback_name' : 'none';
      }

      if (!matchedEmployee) {
        // Fallback 2: Manual overrides
        const overrideName = MANUAL_OVERRIDES[borrowerName.trim()];
        if (overrideName) {
          matchedEmployee = employees.find(emp => emp.name === overrideName);
          matchType = matchedEmployee ? 'fallback_name' : 'none';
        }
      }

      // Resolve status based on the latest history status entry
      let resolvedStatus = loan.status;
      if (loan.history && Array.isArray(loan.history) && loan.history.length > 0) {
        const sortedHistory = [...loan.history].sort((a, b) => {
          const tA = (a.timestamp as any)?.toMillis ? (a.timestamp as any).toMillis() : (a.timestamp?.seconds ? a.timestamp.seconds * 1000 : 0);
          const tB = (b.timestamp as any)?.toMillis ? (b.timestamp as any).toMillis() : (b.timestamp?.seconds ? b.timestamp.seconds * 1000 : 0);
          return tB - tA; // Latest first
        });
        if (sortedHistory[0]?.status) {
          resolvedStatus = sortedHistory[0].status;
        }
      }

      // Identify warnings / anomalies
      const warnings: string[] = [];
      if (matchType === 'none') {
        warnings.push('Unmatched: Borrower not linked to any internal employee record.');
      }
      if (resolvedStatus === 'Disetujui dan Aktif' && (loan.sisaHutang || 0) === 0) {
        warnings.push('Anomaly: Status is active, but remaining debt is Rp 0.');
      }
      if (resolvedStatus === 'Lunas' && (loan.sisaHutang || 0) > 0) {
        warnings.push('Anomaly: Status is fully paid (Lunas), but sisaHutang is greater than 0.');
      }

      const monthlyInstallment = Math.round(loan.jumlahPinjaman / loan.tenor);

      return {
        ...loan,
        status: resolvedStatus,
        borrowerName,
        borrowerEmail,
        borrowerNik,
        borrowerWhatsapp,
        borrowerSatuanKerja,
        matchedEmployee,
        matchType,
        warnings,
        monthlyInstallment,
      };
    });
  }, [loans, kopUsers, employees]);

  // 3. Stats calculation
  const stats = useMemo(() => {
    const active = processedLoans.filter(l => l.status === 'Disetujui dan Aktif' && (l.sisaHutang || 0) > 0);
    const matchedActive = active.filter(l => l.matchType !== 'none');
    const totalDeductions = active.reduce((acc, curr) => acc + curr.monthlyInstallment, 0);
    
    // Warning count is loans with status active & sisaHutang > 0 that have warning indicators, plus unmatched active ones
    const activeWithWarnings = processedLoans.filter(l => 
      (l.status === 'Disetujui dan Aktif' && l.sisaHutang > 0 && l.warnings.length > 0) ||
      (l.status === 'Disetujui dan Aktif' && l.matchType === 'none')
    );

    return {
      activeLoansCount: active.length,
      matchedLoansCount: matchedActive.length,
      unmatchedLoansCount: active.length - matchedActive.length,
      totalDeductions,
      warningsCount: activeWithWarnings.length,
    };
  }, [processedLoans]);

  // 4. Filtering and Sorting
  const filteredLoans = useMemo<ProcessedLoan[]>(() => {
    return processedLoans.filter(loan => {
      // Tab filter
      if (activeTab === 'active') {
        // Loan must be active with sisaHutang > 0
        if (loan.status !== 'Disetujui dan Aktif' || (loan.sisaHutang || 0) <= 0) return false;
      } else if (activeTab === 'warnings') {
        // Must have at least 1 warning indicator
        if (loan.warnings.length === 0) return false;
      } else if (activeTab === 'completed') {
        // Loan is completed or has 0 sisaHutang
        if (loan.status !== 'Lunas' && (loan.sisaHutang || 0) > 0) return false;
      }

      // Search Query filter
      if (searchQuery.trim()) {
        const queryLower = searchQuery.toLowerCase();
        const nameMatch = loan.borrowerName.toLowerCase().includes(queryLower);
        const satkerMatch = loan.borrowerSatuanKerja.toLowerCase().includes(queryLower);
        const idMatch = loan.id.toLowerCase().includes(queryLower);
        const matchedEmpMatch = loan.matchedEmployee?.name.toLowerCase().includes(queryLower) || false;
        
        return nameMatch || satkerMatch || idMatch || matchedEmpMatch;
      }

      return true;
    });
  }, [processedLoans, activeTab, searchQuery]);

  if (authLoading || loading) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-50 via-indigo-50/80 to-slate-100 flex items-center justify-center flex-col relative overflow-hidden">
        {/* Subtle decorative blobs */}
        <div className="absolute top-0 right-0 w-[600px] h-[600px] rounded-full bg-indigo-100/40 blur-[120px] pointer-events-none" />
        <div className="absolute bottom-0 left-0 w-[500px] h-[500px] rounded-full bg-purple-100/30 blur-[100px] pointer-events-none" />
        <div className="flex flex-col items-center gap-3 relative z-10">
          <Loader2 className="w-10 h-10 animate-spin text-indigo-600 mb-4" />
          <p className="text-slate-500 font-medium">Memuat data simpan pinjam...</p>
        </div>
      </div>
    );
  }

  // Auth Guard check (Only super_admin can view)
  if (profile?.role !== 'super_admin') {
    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-50 via-indigo-50/80 to-slate-100 flex items-center justify-center p-6 relative overflow-hidden">
        {/* Subtle decorative blobs */}
        <div className="absolute top-0 right-0 w-[600px] h-[600px] rounded-full bg-indigo-100/40 blur-[120px] pointer-events-none" />
        <div className="absolute bottom-0 left-0 w-[500px] h-[500px] rounded-full bg-purple-100/30 blur-[100px] pointer-events-none" />
        <Card className="max-w-md w-full p-8 text-center bg-white rounded-2xl shadow-md border-none relative z-10">
          <AlertCircle className="w-12 h-12 text-rose-500 mx-auto mb-4" />
          <h2 className="text-xl font-bold text-slate-800 mb-2">Akses Ditolak</h2>
          <p className="text-slate-500 mb-6">Anda tidak memiliki izin yang cukup untuk mengakses halaman audit simpan pinjam koperasi.</p>
          <Link href="/dashboard/payroll">
            <Button className="rounded-xl px-6 bg-indigo-600 hover:bg-indigo-700">← Kembali ke Payroll</Button>
          </Link>
        </Card>
      </div>
    );
  }

  // Format date helper
  const formatDate = (ts?: { seconds: number }) => {
    if (!ts) return '-';
    return new Date(ts.seconds * 1000).toLocaleDateString('id-ID', {
      day: 'numeric',
      month: 'long',
      year: 'numeric',
    });
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 via-indigo-50/80 to-slate-100 p-8 font-sans selection:bg-indigo-100 relative overflow-hidden text-slate-800">
      {/* Subtle decorative blobs */}
      <div className="absolute top-0 right-0 w-[600px] h-[600px] rounded-full bg-indigo-100/40 blur-[120px] pointer-events-none" />
      <div className="absolute bottom-0 left-0 w-[500px] h-[500px] rounded-full bg-purple-100/30 blur-[100px] pointer-events-none" />
      <div className="max-w-7xl mx-auto relative z-10">
        <GlobalHeader />
        
        {/* Header navigation bar */}
        <div className="flex flex-wrap justify-between items-center gap-4 mb-8">
          <div className="flex items-center gap-3">
            {profile?.role !== 'super_admin' && (
              <Link href="/dashboard/payroll">
                <Button variant="outline" className="rounded-xl bg-white shadow-sm border-slate-200 text-slate-600 hover:bg-slate-50 cursor-pointer">
                  <ArrowLeft className="w-4 h-4 mr-2" /> Kembali
                </Button>
              </Link>
            )}
            <div className="flex items-center gap-2 px-3 py-1 bg-indigo-50 border border-indigo-100 rounded-xl">
              <Banknote className="w-5 h-5 text-indigo-600" />
              <span className="text-xs font-semibold text-indigo-700 uppercase tracking-wider">Audit Panel</span>
            </div>
          </div>
          <div className="text-right">
            <h1 className="text-2xl font-bold text-slate-900 tracking-tight">Audit Simpan Pinjam Koperasi</h1>
            <p className="text-sm text-slate-500">Rekonsiliasi database koperasi unipdu dengan payroll YAPETIDU</p>
          </div>
        </div>

        {/* Stats Metrics Cards */}
        <div className="grid grid-cols-1 md:grid-cols-4 gap-6 mb-8">
          <Card className="p-6 bg-white border-none rounded-2xl shadow-[0_8px_30px_rgb(0,0,0,0.02)] flex flex-row items-center justify-between">
            <div>
              <p className="text-xs font-semibold uppercase tracking-wider text-slate-400 mb-1">Pinjaman Aktif</p>
              <p className="text-2xl font-bold text-slate-900">{stats.activeLoansCount}</p>
            </div>
            <div className="p-3 bg-blue-50 text-blue-600 rounded-xl">
              <Activity className="w-5 h-5" />
            </div>
          </Card>

          <Card className="p-6 bg-white border-none rounded-2xl shadow-[0_8px_30px_rgb(0,0,0,0.02)] flex flex-row items-center justify-between">
            <div>
              <p className="text-xs font-semibold uppercase tracking-wider text-slate-400 mb-1">Total Cicilan Bulanan</p>
              <p className="text-2xl font-bold text-slate-900">Rp {stats.totalDeductions.toLocaleString('id-ID')}</p>
            </div>
            <div className="p-3 bg-emerald-50 text-emerald-600 rounded-xl">
              <Banknote className="w-5 h-5" />
            </div>
          </Card>

          <Card className="p-6 bg-white border-none rounded-2xl shadow-[0_8px_30px_rgb(0,0,0,0.02)] flex flex-row items-center justify-between">
            <div>
              <p className="text-xs font-semibold uppercase tracking-wider text-slate-400 mb-1">Tautan Akurat (UID)</p>
              <p className="text-2xl font-bold text-slate-900">{stats.matchedLoansCount}</p>
            </div>
            <div className="p-3 bg-indigo-50 text-indigo-600 rounded-xl">
              <CheckCircle2 className="w-5 h-5" />
            </div>
          </Card>

          <Card className={`p-6 bg-white border-none rounded-2xl shadow-[0_8px_30px_rgb(0,0,0,0.02)] flex flex-row items-center justify-between ${stats.warningsCount > 0 ? 'bg-amber-50/20' : ''}`}>
            <div>
              <p className="text-xs font-semibold uppercase tracking-wider text-slate-400 mb-1">Warnings / Anomali</p>
              <p className={`text-2xl font-bold ${stats.warningsCount > 0 ? 'text-amber-600' : 'text-slate-900'}`}>{stats.warningsCount}</p>
            </div>
            <div className={`p-3 rounded-xl ${stats.warningsCount > 0 ? 'bg-amber-100/50 text-amber-600' : 'bg-slate-50 text-slate-400'}`}>
              <AlertCircle className="w-5 h-5" />
            </div>
          </Card>
        </div>

        {/* Main Section */}
        <Card className="bg-white rounded-2xl shadow-[0_8px_30px_rgb(0,0,0,0.03)] border-none overflow-hidden">
          
          {/* Filter Bar */}
          <div className="px-8 py-5 border-b border-slate-100 flex flex-wrap justify-between items-center gap-4 bg-slate-50/30">
            {/* Tabs */}
            <div className="flex gap-1 bg-slate-100/60 p-1 rounded-xl">
              <button
                type="button"
                onClick={() => setActiveTab('active')}
                className={`px-4 py-2 text-xs font-bold rounded-lg transition-all cursor-pointer ${activeTab === 'active' ? 'bg-white text-indigo-600 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}
              >
                Aktif & Berjalan ({processedLoans.filter(l => l.status === 'Disetujui dan Aktif' && l.sisaHutang > 0).length})
              </button>
              <button
                type="button"
                onClick={() => setActiveTab('warnings')}
                className={`px-4 py-2 text-xs font-bold rounded-lg transition-all cursor-pointer ${activeTab === 'warnings' ? 'bg-amber-500 text-white shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}
              >
                Warnings / Anomali ({processedLoans.filter(l => l.warnings.length > 0).length})
              </button>
              <button
                type="button"
                onClick={() => setActiveTab('completed')}
                className={`px-4 py-2 text-xs font-bold rounded-lg transition-all cursor-pointer ${activeTab === 'completed' ? 'bg-white text-indigo-600 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}
              >
                Lunas / Selesai ({processedLoans.filter(l => l.status === 'Lunas' || l.sisaHutang <= 0).length})
              </button>
              <button
                type="button"
                onClick={() => setActiveTab('all')}
                className={`px-4 py-2 text-xs font-bold rounded-lg transition-all cursor-pointer ${activeTab === 'all' ? 'bg-white text-indigo-600 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}
              >
                Semua ({processedLoans.length})
              </button>
            </div>

            {/* Search */}
            <div className="relative w-full sm:w-72">
              <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
              <Input
                type="text"
                placeholder="Cari peminjam, ID, unit..."
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
                className="pl-10 pr-4 py-2 text-xs rounded-xl border-slate-200 bg-white focus-visible:ring-indigo-500 shadow-sm"
              />
            </div>
          </div>

          {/* Table Container */}
          <div className="overflow-x-auto">
            {filteredLoans.length === 0 ? (
              <div className="py-20 text-center text-slate-400">
                <Info className="w-12 h-12 mx-auto opacity-20 mb-3" />
                <p className="font-medium">Tidak ada data simpan pinjam yang cocok.</p>
              </div>
            ) : (
              <Table>
                <TableHeader className="bg-slate-50/50">
                  <TableRow className="border-slate-100">
                    <TableHead className="font-semibold text-slate-500 pl-8 w-[240px]">Peminjam (Koperasi)</TableHead>
                    <TableHead className="font-semibold text-slate-500">Satuan Kerja</TableHead>
                    <TableHead className="font-semibold text-slate-500 text-right">Total Pinjaman</TableHead>
                    <TableHead className="font-semibold text-slate-500 text-right">Cicilan / Bulan</TableHead>
                    <TableHead className="font-semibold text-slate-500 text-right">Sisa Hutang</TableHead>
                    <TableHead className="font-semibold text-slate-500 text-center">Tenor / Cicilan</TableHead>
                    <TableHead className="font-semibold text-slate-500">Kesesuaian YAPETIDU</TableHead>
                    <TableHead className="font-semibold text-slate-500 pr-8 text-center">Tindakan</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredLoans.map(loan => (
                    <TableRow key={loan.id} className="hover:bg-slate-50/40 border-slate-100 transition-colors">
                      
                      {/* Borrower identity */}
                      <TableCell className="pl-8 font-semibold text-slate-900 w-[240px]">
                        <div>
                          <span>{loan.borrowerName}</span>
                          <div className="text-[10px] font-normal text-slate-400 font-mono mt-0.5">ID: {loan.id}</div>
                        </div>
                      </TableCell>

                      {/* Satuan Kerja */}
                      <TableCell className="text-slate-600 font-medium">
                        {loan.borrowerSatuanKerja || '-'}
                      </TableCell>

                      {/* Total Loan */}
                      <TableCell className="text-right font-medium text-slate-700">
                        Rp {loan.jumlahPinjaman.toLocaleString('id-ID')}
                      </TableCell>

                      {/* Installment */}
                      <TableCell className="text-right font-semibold text-indigo-600">
                        Rp {loan.monthlyInstallment.toLocaleString('id-ID')}
                      </TableCell>

                      {/* Remaining Debt */}
                      <TableCell className={`text-right font-medium ${loan.sisaHutang > 0 ? 'text-amber-700' : 'text-slate-400'}`}>
                        Rp {loan.sisaHutang.toLocaleString('id-ID')}
                      </TableCell>

                      {/* Tenor count */}
                      <TableCell className="text-center font-medium text-slate-600">
                        <Badge variant="secondary" className="bg-slate-100 text-slate-700 font-mono text-[10px] rounded-lg">
                          {loan.jumlahMenyicil} / {loan.tenor} Bln
                        </Badge>
                      </TableCell>

                      {/* Matches Status */}
                      <TableCell>
                        {loan.matchedEmployee ? (
                          <div className="flex flex-col gap-1 items-start">
                            <span className="font-semibold text-xs text-slate-700 truncate max-w-[180px]">
                              {loan.matchedEmployee.name}
                            </span>
                            <div className="flex gap-1.5 items-center">
                              <Badge className={`text-[10px] px-1.5 py-0.5 rounded-lg border font-bold ${
                                loan.matchType === 'direct' 
                                  ? 'bg-emerald-50 text-emerald-700 border-emerald-100'
                                  : 'bg-amber-50 text-amber-700 border-amber-100'
                              }`}>
                                {loan.matchType === 'direct' ? 'Direct ID Match' : 'Name Fallback'}
                              </Badge>
                              <Badge className={`text-[9px] px-1.5 py-0 rounded bg-slate-100 text-slate-500 font-normal border-slate-200 border`}>
                                {loan.matchedEmployee.collection === 'Employees_Loyalis' ? 'Loyalis' : 'Pekarya'}
                              </Badge>
                            </div>
                          </div>
                        ) : (
                          <Badge className="bg-rose-50 text-rose-700 border-rose-100 border text-[10px] font-bold rounded-lg">
                            Unmatched (Warning)
                          </Badge>
                        )}
                      </TableCell>

                      {/* Action trigger details modal */}
                      <TableCell className="pr-8 text-center">
                        <Button
                          type="button"
                          variant="ghost"
                          onClick={() => setSelectedLoan(loan)}
                          className="h-8 px-3 text-xs font-semibold border border-slate-200 text-slate-700 hover:text-indigo-600 hover:bg-slate-50 rounded-xl transition-all shadow-sm bg-white cursor-pointer"
                        >
                          Audit Details
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </div>

        </Card>
      </div>

      {/* Audit Detail Modal Dialog */}
      <Dialog open={selectedLoan !== null} onOpenChange={open => !open && setSelectedLoan(null)}>
        {selectedLoan && (
          <DialogContent className="sm:max-w-5xl w-[95vw] p-8 rounded-2xl border-none shadow-2xl bg-white max-h-[90vh] overflow-y-auto">
            <DialogHeader className="mb-6">
              <div className="flex items-center justify-between pr-4">
                <DialogTitle className="text-xl font-bold text-slate-900 flex items-center gap-2">
                  <Banknote className="w-5 h-5 text-indigo-600 animate-pulse" />
                  Audit Simpan Pinjam #{selectedLoan.id}
                </DialogTitle>
                <Badge className={`font-bold rounded-lg text-xs ${
                  selectedLoan.status === 'Disetujui dan Aktif' 
                    ? 'bg-emerald-50 text-emerald-700 border-emerald-100 border'
                    : selectedLoan.status === 'Lunas'
                    ? 'bg-slate-50 text-slate-500 border-slate-200 border'
                    : 'bg-rose-50 text-rose-700 border-rose-100 border'
                }`}>
                  {selectedLoan.status}
                </Badge>
              </div>
              <DialogDescription className="text-xs text-slate-400 mt-1">
                Audit data history pengajuan dan relasi payroll karyawan
              </DialogDescription>
            </DialogHeader>

            {/* Warnings Alert Callout */}
            {selectedLoan.warnings.length > 0 && (
              <div className="p-4 bg-amber-50 border border-amber-100 rounded-xl mb-6 flex gap-3 items-start">
                <AlertCircle className="w-5 h-5 text-amber-600 shrink-0 mt-0.5" />
                <div>
                  <h4 className="text-xs font-bold text-amber-800">Review Diperlukan (Warning Peringatan)</h4>
                  <ul className="list-disc list-inside text-xs text-amber-700 font-medium mt-1 space-y-1">
                    {selectedLoan.warnings.map((w: any, idx: number) => (
                      <li key={idx}>{w}</li>
                    ))}
                  </ul>
                </div>
              </div>
            )}

            <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
              {/* Left Column: Loan & Koperasi Profile */}
              <div className="space-y-6">
                <div>
                  <h3 className="text-xs font-bold text-indigo-600 uppercase tracking-wider mb-3 flex items-center gap-1.5">
                    <User className="w-4 h-4" /> Koperasi Borrower Info
                  </h3>
                  <div className="bg-slate-50/70 p-4 rounded-xl space-y-2 border border-slate-100/50">
                    <div className="flex justify-between items-center text-xs">
                      <span className="text-slate-400">Nama Lengkap</span>
                      <span className="font-semibold text-slate-800">{selectedLoan.borrowerName}</span>
                    </div>
                    <div className="flex justify-between items-center text-xs">
                      <span className="text-slate-400">Satuan Kerja</span>
                      <span className="font-semibold text-slate-800">{selectedLoan.borrowerSatuanKerja || '-'}</span>
                    </div>
                    <div className="flex justify-between items-center text-xs">
                      <span className="text-slate-400">Nomor WhatsApp</span>
                      <span className="font-semibold text-slate-800">{selectedLoan.borrowerWhatsapp || '-'}</span>
                    </div>
                    <div className="flex justify-between items-center text-xs">
                      <span className="text-slate-400">Email Anggota</span>
                      <span className="font-semibold text-slate-800 truncate max-w-[150px]">{selectedLoan.borrowerEmail || '-'}</span>
                    </div>
                    <div className="flex justify-between items-center text-xs">
                      <span className="text-slate-400">NIK (KTP)</span>
                      <span className="font-semibold text-slate-800">{selectedLoan.borrowerNik || '-'}</span>
                    </div>
                  </div>
                </div>

                <div>
                  <h3 className="text-xs font-bold text-indigo-600 uppercase tracking-wider mb-3 flex items-center gap-1.5">
                    <FileText className="w-4 h-4" /> Loan Financial Parameters
                  </h3>
                  <div className="bg-slate-50/70 p-4 rounded-xl space-y-2 border border-slate-100/50">
                    <div className="flex justify-between items-center text-xs">
                      <span className="text-slate-400">Total Pinjaman</span>
                      <span className="font-bold text-slate-800">Rp {selectedLoan.jumlahPinjaman.toLocaleString('id-ID')}</span>
                    </div>
                    <div className="flex justify-between items-center text-xs">
                      <span className="text-slate-400">Tenor Pinjaman</span>
                      <span className="font-semibold text-slate-800">{selectedLoan.tenor} Bulan</span>
                    </div>
                    <div className="flex justify-between items-center text-xs">
                      <span className="text-slate-400">Cicilan Bulanan</span>
                      <span className="font-bold text-indigo-600">Rp {selectedLoan.monthlyInstallment.toLocaleString('id-ID')}</span>
                    </div>
                    <div className="flex justify-between items-center text-xs">
                      <span className="text-slate-400">Sisa Hutang</span>
                      <span className="font-bold text-amber-700">Rp {selectedLoan.sisaHutang.toLocaleString('id-ID')}</span>
                    </div>
                    <div className="flex justify-between items-center text-xs">
                      <span className="text-slate-400">Jumlah Terbayar</span>
                      <span className="font-semibold text-slate-800">{selectedLoan.jumlahMenyicil} Cicilan</span>
                    </div>
                    <div className="flex justify-between items-center text-xs">
                      <span className="text-slate-400">Tanggal Pengajuan</span>
                      <span className="font-semibold text-slate-800">{formatDate(selectedLoan.tanggalPengajuan)}</span>
                    </div>
                    {selectedLoan.bankDetails && (
                      <div className="pt-2 border-t border-slate-200/50 flex justify-between items-center text-xs">
                        <span className="text-slate-400">Rekening Transfer</span>
                        <span className="font-semibold text-slate-800">{selectedLoan.bankDetails.bank} - {selectedLoan.bankDetails.nomorRekening}</span>
                      </div>
                    )}
                  </div>
                </div>
              </div>

              {/* Right Column: Internal Matching & Approval History */}
              <div className="space-y-6">
                <div>
                  <h3 className="text-xs font-bold text-indigo-600 uppercase tracking-wider mb-3 flex items-center gap-1.5">
                    <CheckCircle2 className="w-4 h-4" /> Internal Match Info (YAPETIDU)
                  </h3>
                  {selectedLoan.matchedEmployee ? (
                    <div className="bg-indigo-50/30 p-4 rounded-xl border border-indigo-100/50 space-y-2">
                      <div className="flex justify-between items-center text-xs">
                        <span className="text-slate-500">Nama Internal</span>
                        <span className="font-bold text-indigo-950">{selectedLoan.matchedEmployee.name}</span>
                      </div>
                      <div className="flex justify-between items-center text-xs">
                        <span className="text-slate-500">Kategori Karyawan</span>
                        <span className="font-semibold text-indigo-950">
                          {selectedLoan.matchedEmployee.collection === 'Employees_Loyalis' ? 'Loyalis' : 'Pekarya'}
                        </span>
                      </div>
                      <div className="flex justify-between items-center text-xs">
                        <span className="text-slate-500">Document ID</span>
                        <span className="font-mono text-indigo-950">{selectedLoan.matchedEmployee.id}</span>
                      </div>
                      <div className="flex justify-between items-center text-xs">
                        <span className="text-slate-500">NIK (Database)</span>
                        <span className="font-semibold text-indigo-950">{selectedLoan.matchedEmployee.nik || '-'}</span>
                      </div>
                      <div className="flex justify-between items-center text-xs">
                        <span className="text-slate-500">Email Link</span>
                        <span className="font-semibold text-indigo-950 truncate max-w-[150px]">{selectedLoan.matchedEmployee.email || '-'}</span>
                      </div>
                      <div className="pt-2 border-t border-indigo-200/20 flex justify-between items-center text-xs">
                        <span className="text-slate-500">Match Accuracy</span>
                        <Badge className="bg-indigo-600 text-white font-bold text-[9px] px-2 py-0.5 rounded-lg">
                          {selectedLoan.matchType === 'direct' ? 'Direct ID Reference Match' : 'Name String Match Fallback'}
                        </Badge>
                      </div>
                    </div>
                  ) : (
                    <div className="bg-rose-50/30 p-4 rounded-xl border border-rose-100/40 text-center text-slate-500 text-xs">
                      <HelpCircle className="w-8 h-8 text-rose-500 mx-auto mb-2 opacity-50" />
                      Tidak ada record karyawan internal yang cocok dengan peminjam koperasi.
                    </div>
                  )}
                </div>

                {/* Loan History Trail */}
                <div>
                  <h3 className="text-xs font-bold text-indigo-600 uppercase tracking-wider mb-3 flex items-center gap-1.5">
                    <History className="w-4 h-4" /> Koperasi Loan History Trail
                  </h3>
                  <div className="bg-slate-50/70 p-4 rounded-xl border border-slate-100/50 max-h-[160px] overflow-y-auto space-y-3">
                    {selectedLoan.history && selectedLoan.history.length > 0 ? (
                      selectedLoan.history.map((h, idx) => (
                        <div key={idx} className="text-xs flex gap-2.5 items-start">
                          <div className="w-2 h-2 rounded-full bg-indigo-500 shrink-0 mt-1" />
                          <div className="space-y-0.5">
                            <div className="flex items-center gap-1.5">
                              <span className="font-bold text-slate-700">{h.status}</span>
                              <span className="text-[9px] text-slate-400">{formatDate(h.timestamp)}</span>
                            </div>
                            {h.notes && <p className="text-[11px] text-slate-500">{h.notes}</p>}
                          </div>
                        </div>
                      ))
                    ) : (
                      <span className="text-xs text-slate-400 block text-center">Tidak ada riwayat history yang tercatat.</span>
                    )}
                  </div>
                </div>
              </div>
            </div>

            <div className="mt-8 pt-4 border-t border-slate-100 flex justify-end gap-3">
              <Button
                type="button"
                variant="outline"
                onClick={() => setSelectedLoan(null)}
                className="rounded-xl px-5 border-slate-200 text-slate-600 hover:bg-slate-50 cursor-pointer"
              >
                Close Audit
              </Button>
            </div>
          </DialogContent>
        )}
      </Dialog>
    </div>
  );
}
