"use client";

import React, { useState, useEffect, useMemo, useRef } from 'react';
import Link from 'next/link';
import { db } from '@/lib/firebase';
import { collection, getDocs, doc, updateDoc } from 'firebase/firestore';
import { useAuth } from '@/lib/AuthContext';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
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
  ArrowLeft,
  Search,
  AlertCircle,
  Users,
  Coins,
  Wheat,
  SlidersHorizontal,
  Loader2,
  RefreshCw,
  Pencil,
  Shield,
} from 'lucide-react';

const formatCurrencyInput = (val: string | number) => {
  if (val === undefined || val === null || val === '') return '';
  const clean = String(val).replace(/\D/g, '');
  if (!clean) return '';
  return Number(clean).toLocaleString('id-ID');
};

const parseCurrencyInput = (val: string): number => {
  const clean = val.replace(/\D/g, '');
  return Number(clean) || 0;
};

interface EmployeeConstantRecord {
  id: string;
  name: string;
  role: string;
  type: 'loyalis' | 'pekarya';
  isActive: boolean;
  tBpjsTk: number;
  tBpjsKes: number;
  tBeras: number;
  potBpjs: number;
  potTabungan: number;
  potZiz: number;
  tBpjsPekarya?: number;
  potPinlu?: number;
  potTht?: number;
  tJabatan?: number;
  tKepangkatan?: number;
  cummulativeCredit?: number;
  tInstruksional?: number;
}

export default function ConstantValuesDebugPage() {
  const { profile, loading: authLoading } = useAuth();
  
  const [employees, setEmployees] = useState<EmployeeConstantRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [activeTab, setActiveTab] = useState<'loyalis' | 'pekarya'>('loyalis');
  const [valueFilter, setValueFilter] = useState<'all' | 'pay' | 'deduction'>('all');

  const [editingEmployee, setEditingEmployee] = useState<EmployeeConstantRecord | null>(null);
  const [editForm, setEditForm] = useState({
    tBpjsTk: 0,
    tBpjsKes: 0,
    tBeras: 0,
    potBpjs: 0,
    potTabungan: 0,
    potZiz: 0,
    tBpjsPekarya: 0,
    potPinlu: 0,
    potTht: 0,
    tKepangkatan: 0,
    cummulativeCredit: 0,
    tInstruksional: 0,
  });
  const [saving, setSaving] = useState(false);
  const isSavingRef = useRef(false);

  const handleStartEdit = (emp: EmployeeConstantRecord) => {
    setEditingEmployee(emp);
    setEditForm({
      tBpjsTk: emp.tBpjsTk,
      tBpjsKes: emp.tBpjsKes,
      tBeras: emp.tBeras,
      potBpjs: emp.potBpjs,
      potTabungan: emp.potTabungan || 0,
      potZiz: emp.potZiz || 0,
      tBpjsPekarya: emp.tBpjsPekarya || 0,
      potPinlu: emp.potPinlu || 0,
      potTht: emp.potTht || 0,
      tKepangkatan: emp.tKepangkatan || 0,
      cummulativeCredit: emp.cummulativeCredit || 0,
      tInstruksional: emp.tInstruksional || 0,
    });
  };

  const handleSaveEdit = async () => {
    if (!editingEmployee || isSavingRef.current) return;
    try {
      isSavingRef.current = true;
      setSaving(true);
      const collectionName = editingEmployee.type === 'loyalis' ? 'Employees_Loyalis' : 'Employees_BlueCollar';
      const docRef = doc(db, collectionName, editingEmployee.id);
      
      const updateData: any = {
        'salaryProfile.tunjanganBeras': editForm.tBeras,
        'bpjs.deductionAmount': editForm.potBpjs,
        'savings.deductionAmount': editForm.potTabungan,
        'ziz.deductionAmount': editForm.potZiz,
        'pinlu.deductionAmount': editForm.potPinlu,
        'tht.deductionAmount': editForm.potTht,
        'updatedAt': new Date(),
        'audit.updatedAt': new Date(),
      };

      if (editingEmployee.type === 'loyalis') {
        updateData['bpjs.t_bpjs_tk'] = editForm.tBpjsTk;
        updateData['bpjs.t_bpjs_kes'] = editForm.tBpjsKes;
        updateData['kepangkatan.t_kepangkatan'] = editForm.tKepangkatan;
        updateData['kepangkatan.cummulativeCredit'] = editForm.cummulativeCredit;
        updateData['t_instruksional'] = editForm.tInstruksional;
      } else {
        updateData['bpjs.allowanceAmount'] = editForm.tBpjsPekarya;
      }

      await updateDoc(docRef, updateData);
      
      setEmployees(prev => prev.map(emp => {
        if (emp.id === editingEmployee.id) {
          const type = editingEmployee.type;
          const tBpjsTk = type === 'loyalis' ? editForm.tBpjsTk : 0;
          const tBpjsKes = type === 'loyalis' ? editForm.tBpjsKes : 0;
          const tKepangkatan = type === 'loyalis' ? editForm.tKepangkatan : 0;
          const cummulativeCredit = type === 'loyalis' ? editForm.cummulativeCredit : 0;
          const tInstruksional = type === 'loyalis' ? editForm.tInstruksional : 0;
          const tBeras = editForm.tBeras;
          const potBpjs = editForm.potBpjs;
          const potTabungan = editForm.potTabungan;
          const potZiz = editForm.potZiz;
          const potPinlu = editForm.potPinlu;
          const potTht = editForm.potTht;
          const tBpjsPekarya = type === 'pekarya' ? editForm.tBpjsPekarya : 0;

          return {
            ...emp,
            tBpjsTk,
            tBpjsKes,
            tBeras,
            potBpjs,
            potTabungan,
            potZiz,
            potPinlu,
            potTht,
            tBpjsPekarya,
            tKepangkatan,
            cummulativeCredit,
            tInstruksional,
          };
        }
        return emp;
      }));

      setEditingEmployee(null);
    } catch (error) {
      console.error('Error saving edits:', error);
      alert('Gagal menyimpan perubahan.');
    } finally {
      isSavingRef.current = false;
      setSaving(false);
    }
  };

  const fetchEmployeeData = async () => {
    try {
      setLoading(true);
      const [loyalisSnap, blueCollarSnap] = await Promise.all([
        getDocs(collection(db, 'Employees_Loyalis')),
        getDocs(collection(db, 'Employees_BlueCollar')),
      ]);

      const records: EmployeeConstantRecord[] = [];

      // 1. Process Loyalis Employees
      loyalisSnap.docs.forEach(docSnap => {
        const data = docSnap.data();
        const name = data.personal_info?.name || '';
        const status = data.personal_info?.status || '';
        const role = data.employment_profile?.department_unit || 'Staf';
        const isActive = status === 'AKTIF';

        if (name && isActive) {
          const tBpjsTk = data.bpjs?.t_bpjs_tk || 0;
          const tBpjsKes = data.bpjs?.t_bpjs_kes || 0;
          const tBeras = data.salaryProfile?.tunjanganBeras || 0;
          const potBpjs = data.bpjs?.deductionAmount || 0;
          const potTabungan = data.savings?.deductionAmount || 0;
          const potZiz = data.ziz?.deductionAmount || 0;
          const potPinlu = data.pinlu?.deductionAmount || 0;
          const potTht = data.tht?.deductionAmount || 0;
          const tJabatan = (data.employment_profile?.structural_positions || []).reduce((sum: number, pos: any) => sum + (Number(pos.allowance) || 0), 0);
          const tKepangkatan = data.kepangkatan?.t_kepangkatan || 0;
          const cummulativeCredit = data.kepangkatan?.cummulativeCredit || 0;
          const tInstruksional = data.t_instruksional || 0;

          records.push({
            id: docSnap.id,
            name,
            role,
            type: 'loyalis',
            isActive,
            tBpjsTk,
            tBpjsKes,
            tBeras,
            potBpjs,
            potTabungan,
            potZiz,
            potPinlu,
            potTht,
            tJabatan,
            tKepangkatan,
            cummulativeCredit,
            tInstruksional,
          });
        }
      });

      // 2. Process Pekarya Employees
      blueCollarSnap.docs.forEach(docSnap => {
        const data = docSnap.data();
        const name = data.name || '';
        const role = data.employment?.jobCategory || '';
        const isActive = data.flags?.isActive ?? true;

        if (name && isActive) {
          const tBpjsPekarya = data.bpjs?.allowanceAmount || 0;
          const tBeras = data.salaryProfile?.tunjanganBeras || 0;
          const potBpjs = data.bpjs?.deductionAmount || 0;
          const potTabungan = 0;
          const potZiz = 0;

          records.push({
            id: docSnap.id,
            name,
            role,
            type: 'pekarya',
            isActive,
            tBpjsTk: 0,
            tBpjsKes: 0,
            tBeras,
            potBpjs,
            potTabungan,
            potZiz,
            potTht: 0,
            tBpjsPekarya,
            tJabatan: 0,
          });
        }
      });

      setEmployees(records);
    } catch (error) {
      console.error('Error fetching constant values:', error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchEmployeeData();
  }, []);

  // Filtered & Searched Data
  const filteredEmployees = useMemo(() => {
    return employees.filter(emp => {
      const matchesSearch = 
        emp.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
        emp.role.toLowerCase().includes(searchQuery.toLowerCase());
      
      if (!matchesSearch) return false;

      return emp.type === activeTab;
    });
  }, [employees, searchQuery, activeTab]);

  // General Metrics
  const metrics = useMemo(() => {
    const totalAll = employees.length;
    const loyalisCountAll = employees.filter(e => e.type === 'loyalis').length;
    const pekaryaCountAll = employees.filter(e => e.type === 'pekarya').length;
    
    // Filter employees based on activeTab for card calculation
    const filteredForMetrics = employees.filter(e => e.type === activeTab);

    const total = filteredForMetrics.length;
    const loyalisCount = filteredForMetrics.filter(e => e.type === 'loyalis').length;
    const pekaryaCount = filteredForMetrics.filter(e => e.type === 'pekarya').length;
    
    const totalBpjsDeductions = filteredForMetrics.reduce((sum, e) => sum + e.potBpjs, 0);
    const totalBerasAllowance = filteredForMetrics.reduce((sum, e) => sum + e.tBeras, 0);
    const totalBpjsAllowances = filteredForMetrics.reduce((sum, e) => sum + (e.tBpjsTk || 0) + (e.tBpjsKes || 0) + (e.tBpjsPekarya || 0), 0);

    return {
      total,
      loyalisCount,
      pekaryaCount,
      totalAll,
      loyalisCountAll,
      pekaryaCountAll,
      totalBpjsDeductions,
      totalBerasAllowance,
      totalBpjsAllowances,
    };
  }, [employees, activeTab]);

  // Column visibility flags based on activeTab and valueFilter
  const showBpjsTk = activeTab !== 'pekarya' && (valueFilter === 'all' || valueFilter === 'pay');
  const showBpjsKes = activeTab !== 'pekarya' && (valueFilter === 'all' || valueFilter === 'pay');
  const showBpjsPekarya = activeTab !== 'loyalis' && (valueFilter === 'all' || valueFilter === 'pay');
  const showBeras = valueFilter === 'all' || valueFilter === 'pay';
  const showTJabatan = activeTab !== 'pekarya' && (valueFilter === 'all' || valueFilter === 'pay');
  const showTKepangkatan = activeTab !== 'pekarya' && (valueFilter === 'all' || valueFilter === 'pay');
  const showTInstruksional = activeTab !== 'pekarya' && (valueFilter === 'all' || valueFilter === 'pay');
  const showPotBpjs = valueFilter === 'all' || valueFilter === 'deduction';
  const showPotTabungan = activeTab !== 'pekarya' && (valueFilter === 'all' || valueFilter === 'deduction');
  const showZiz = activeTab !== 'pekarya' && (valueFilter === 'all' || valueFilter === 'deduction');
  const showTht = activeTab !== 'pekarya' && (valueFilter === 'all' || valueFilter === 'deduction');
  const showPinlu = activeTab !== 'pekarya' && (valueFilter === 'all' || valueFilter === 'deduction');

  const visibleColsCount = 
    3 + // Pegawai, Kategori, Aksi
    (showBpjsTk ? 1 : 0) +
    (showBpjsKes ? 1 : 0) +
    (showBpjsPekarya ? 1 : 0) +
    (showBeras ? 1 : 0) +
    (showTJabatan ? 1 : 0) +
    (showTKepangkatan ? 1 : 0) +
    (showTInstruksional ? 1 : 0) +
    (showPotBpjs ? 1 : 0) +
    (showPotTabungan ? 1 : 0) +
    (showZiz ? 1 : 0) +
    (showTht ? 1 : 0) +
    (showPinlu ? 1 : 0);

  if (authLoading || loading) {
    return (
      <div className="flex flex-col items-center justify-center min-h-screen bg-slate-50 text-slate-600 gap-4">
        <Loader2 className="w-8 h-8 animate-spin text-indigo-600" />
        <p className="text-sm font-medium animate-pulse">Memuat data detail tunjangan & potongan...</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-50/50 p-6 md:p-10 font-sans">
      <div className="max-w-7xl mx-auto space-y-8">
        
        {/* Header */}
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div className="space-y-1">
            <div className="flex items-center gap-3">
              <Link href="/dashboard/payroll">
                <Button variant="outline" size="icon" className="rounded-xl bg-white shadow-sm border-slate-200 text-slate-600 hover:text-indigo-600 hover:border-indigo-100 transition-all">
                  <ArrowLeft className="w-4 h-4" />
                </Button>
              </Link>
              <h1 className="text-2xl font-bold tracking-tight">Audit Tunjangan & Potongan Tetap</h1>
            </div>
            <p className="text-slate-500 text-sm pl-11">
              Verifikasi nilai tunjangan & potongan BPJS serta Beras yang konstan di database internal.
            </p>
          </div>
          
          <div className="flex items-center gap-2">
            <Button 
              variant="outline" 
              onClick={fetchEmployeeData}
              className="rounded-xl bg-white shadow-sm border-slate-200 text-slate-600 hover:text-indigo-600 hover:border-indigo-100 transition-all gap-2"
            >
              <RefreshCw className="w-4 h-4" /> Refresh Data
            </Button>
          </div>
        </div>

        {/* Metrics Grid */}
        <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
          <Card className="p-6 bg-white border-none shadow-[0_8px_30px_rgb(0,0,0,0.02)] rounded-2xl flex flex-row items-center justify-between hover:translate-y-[-2px] transition-transform duration-300">
            <div>
              <p className="text-slate-400 text-xs font-semibold uppercase tracking-wider mb-1">Total Staf Aktif</p>
              <h3 className="text-2xl font-bold text-slate-800">{metrics.total}</h3>
              <p className="text-[11px] text-slate-400 mt-1">
                {activeTab === 'loyalis' ? `${metrics.loyalisCountAll} Loyalis` : `${metrics.pekaryaCountAll} Pekarya`}
              </p>
            </div>
            <div className="p-3 bg-indigo-50 text-indigo-600 rounded-xl">
              <Users className="w-5 h-5" />
            </div>
          </Card>

          <Card className="p-6 bg-white border-none shadow-[0_8px_30px_rgb(0,0,0,0.02)] rounded-2xl flex flex-row items-center justify-between hover:translate-y-[-2px] transition-transform duration-300">
            <div>
              <p className="text-slate-400 text-xs font-semibold uppercase tracking-wider mb-1">Total T. BPJS</p>
              <h3 className="text-2xl font-bold text-slate-800">
                Rp {metrics.totalBpjsAllowances.toLocaleString('id-ID')}
              </h3>
              <p className="text-[11px] text-blue-600 mt-1 font-medium">
                {activeTab === 'loyalis' ? 'Tunjangan total Loyalis' : 'Tunjangan total Pekarya'}
              </p>
            </div>
            <div className="p-3 bg-blue-50 text-blue-600 rounded-xl">
              <Shield className="w-5 h-5" />
            </div>
          </Card>

          <Card className="p-6 bg-white border-none shadow-[0_8px_30px_rgb(0,0,0,0.02)] rounded-2xl flex flex-row items-center justify-between hover:translate-y-[-2px] transition-transform duration-300">
            <div>
              <p className="text-slate-400 text-xs font-semibold uppercase tracking-wider mb-1">Total Potongan BPJS</p>
              <h3 className="text-2xl font-bold text-slate-800">
                Rp {metrics.totalBpjsDeductions.toLocaleString('id-ID')}
              </h3>
              <p className="text-[11px] text-emerald-600 mt-1 font-medium">
                {activeTab === 'loyalis' ? 'Beban total Loyalis' : 'Beban total Pekarya'}
              </p>
            </div>
            <div className="p-3 bg-emerald-50 text-emerald-600 rounded-xl">
              <Coins className="w-5 h-5" />
            </div>
          </Card>

          <Card className="p-6 bg-white border-none shadow-[0_8px_30px_rgb(0,0,0,0.02)] rounded-2xl flex flex-row items-center justify-between hover:translate-y-[-2px] transition-transform duration-300">
            <div>
              <p className="text-slate-400 text-xs font-semibold uppercase tracking-wider mb-1">Total T. Beras</p>
              <h3 className="text-2xl font-bold text-slate-800">
                Rp {metrics.totalBerasAllowance.toLocaleString('id-ID')}
              </h3>
              <p className="text-[11px] text-slate-400 mt-1">
                {activeTab === 'loyalis' ? 'Kategori Loyalis' : 'Kategori Pekarya'}
              </p>
            </div>
            <div className="p-3 bg-amber-50 text-amber-600 rounded-xl">
              <Wheat className="w-5 h-5" />
            </div>
          </Card>
        </div>

        {/* Content Section */}
        <Card className="bg-white rounded-[20px] shadow-[0_8px_30px_rgb(0,0,0,0.03)] border-none overflow-hidden">
          
          {/* Table Toolbar */}
          <div className="p-6 md:p-8 pb-4 border-b border-slate-100 flex flex-col xl:flex-row xl:items-center justify-between gap-4 bg-slate-50/20">
            
            <div className="flex flex-wrap items-center gap-4">
              {/* Filter Tabs */}
              <div className="flex gap-1.5 p-1 bg-slate-100 rounded-xl w-fit">
                <button
                  onClick={() => setActiveTab('loyalis')}
                  className={`px-4 py-2 text-xs font-semibold rounded-lg transition-all ${activeTab === 'loyalis' ? 'bg-white text-indigo-600 shadow-sm' : 'text-slate-500 hover:text-slate-800'}`}
                >
                  Loyalis ({metrics.loyalisCountAll})
                </button>
                <button
                  onClick={() => setActiveTab('pekarya')}
                  className={`px-4 py-2 text-xs font-semibold rounded-lg transition-all ${activeTab === 'pekarya' ? 'bg-white text-indigo-600 shadow-sm' : 'text-slate-500 hover:text-slate-800'}`}
                >
                  Pekarya ({metrics.pekaryaCountAll})
                </button>
              </div>

              {/* Pay or Deduction Filter */}
              <div className="flex gap-1.5 p-1 bg-slate-100 rounded-xl w-fit">
                <button
                  onClick={() => setValueFilter('all')}
                  className={`px-4 py-2 text-xs font-semibold rounded-lg transition-all ${valueFilter === 'all' ? 'bg-white text-indigo-600 shadow-sm' : 'text-slate-500 hover:text-slate-800'}`}
                >
                  Semua Data
                </button>
                <button
                  onClick={() => setValueFilter('pay')}
                  className={`px-4 py-2 text-xs font-semibold rounded-lg transition-all ${valueFilter === 'pay' ? 'bg-white text-indigo-600 shadow-sm' : 'text-slate-500 hover:text-slate-800'}`}
                >
                  Hanya Tunjangan (Pay)
                </button>
                <button
                  onClick={() => setValueFilter('deduction')}
                  className={`px-4 py-2 text-xs font-semibold rounded-lg transition-all ${valueFilter === 'deduction' ? 'bg-white text-indigo-600 shadow-sm' : 'text-slate-500 hover:text-slate-800'}`}
                >
                  Hanya Potongan
                </button>
              </div>
            </div>

            {/* Search Input */}
            <div className="relative w-full xl:w-80">
              <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
              <Input
                type="text"
                placeholder="Cari nama atau jabatan..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-10 rounded-xl bg-white border-slate-200 shadow-sm focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 transition-all text-sm h-10"
              />
            </div>

          </div>

          {/* Table */}
          <div className="overflow-x-auto">
            <Table>
              <TableHeader className="bg-slate-50/70 border-b border-slate-100">
                <TableRow>
                  <TableHead className="py-4 pl-8 font-semibold text-slate-700 text-xs uppercase tracking-wider">Pegawai</TableHead>
                  <TableHead className="py-4 font-semibold text-slate-700 text-xs uppercase tracking-wider">Kategori</TableHead>
                  
                  {showBpjsTk && <TableHead className="py-4 font-semibold text-emerald-800 bg-emerald-50/40 text-xs uppercase tracking-wider text-right">T. BPJS TK</TableHead>}
                  {showBpjsKes && <TableHead className="py-4 font-semibold text-emerald-800 bg-emerald-50/40 text-xs uppercase tracking-wider text-right">T. BPJS KES</TableHead>}
                  {showBpjsPekarya && <TableHead className="py-4 font-semibold text-emerald-800 bg-emerald-50/40 text-xs uppercase tracking-wider text-right">BPJS Pekarya</TableHead>}
                  {showBeras && <TableHead className="py-4 font-semibold text-emerald-800 bg-emerald-50/40 text-xs uppercase tracking-wider text-right">T. Beras</TableHead>}
                  {showTJabatan && <TableHead className="py-4 font-semibold text-emerald-800 bg-emerald-50/40 text-xs uppercase tracking-wider text-right">T. Jabatan</TableHead>}
                  {showTKepangkatan && <TableHead className="py-4 font-semibold text-emerald-800 bg-emerald-50/40 text-xs uppercase tracking-wider text-right">T. Kepangkatan</TableHead>}
                  {showTInstruksional && <TableHead className="py-4 font-semibold text-emerald-800 bg-emerald-50/40 text-xs uppercase tracking-wider text-right">T. Instruksional</TableHead>}
                  
                  {showPotBpjs && <TableHead className="py-4 font-semibold text-rose-800 bg-rose-50/40 text-xs uppercase tracking-wider text-right">Potongan BPJS</TableHead>}
                  {showPotTabungan && <TableHead className="py-4 font-semibold text-rose-800 bg-rose-50/40 text-xs uppercase tracking-wider text-right">Pot. Tabungan</TableHead>}
                  {showZiz && <TableHead className="py-4 font-semibold text-rose-800 bg-rose-50/40 text-xs uppercase tracking-wider text-right">Zakat Infaq Sodaqoh</TableHead>}
                  {showTht && <TableHead className="py-4 font-semibold text-rose-800 bg-rose-50/40 text-xs uppercase tracking-wider text-right">Pot. BNI Simponi</TableHead>}
                  {showPinlu && <TableHead className="py-4 font-semibold text-rose-800 bg-rose-50/40 text-xs uppercase tracking-wider text-right">Pot. Pinlu/Tagihan</TableHead>}

                  <TableHead className="py-4 pr-8 font-semibold text-slate-700 text-xs uppercase tracking-wider text-center">Aksi</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredEmployees.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={visibleColsCount} className="py-12 text-center text-slate-400">
                      <div className="flex flex-col items-center justify-center gap-3">
                        <AlertCircle className="w-8 h-8 text-slate-300" />
                        <p className="text-sm">Tidak ditemukan data pegawai yang sesuai filter.</p>
                      </div>
                    </TableCell>
                  </TableRow>
                ) : (
                  filteredEmployees.map((emp) => (
                    <TableRow 
                      key={emp.id}
                      className="hover:bg-slate-50/50 transition-colors border-b border-slate-100/80"
                    >
                      <TableCell className="py-4 pl-8">
                        <div>
                          <div className="font-semibold text-slate-800 text-sm">{emp.name}</div>
                          <div className="text-xs text-slate-400 mt-0.5">{emp.role || '-'}</div>
                        </div>
                      </TableCell>
                      
                      <TableCell className="py-4">
                        <Badge 
                          className={`rounded-lg font-semibold text-[10px] tracking-wider uppercase px-2 py-0.5 border-none shadow-sm ${
                            emp.type === 'loyalis' 
                              ? 'bg-indigo-50 text-indigo-600 hover:bg-indigo-50' 
                              : 'bg-amber-50 text-amber-600 hover:bg-amber-50'
                          }`}
                        >
                          {emp.type === 'loyalis' ? 'Loyalis' : 'Pekarya'}
                        </Badge>
                      </TableCell>

                      {showBpjsTk && (
                        <TableCell className="py-4 text-right font-medium text-slate-700 text-sm bg-emerald-50/10">
                          {emp.type === 'loyalis' ? (
                            <span>
                              Rp {emp.tBpjsTk.toLocaleString('id-ID')}
                            </span>
                          ) : (
                            <span className="text-slate-300 text-xs font-normal">N/A</span>
                          )}
                        </TableCell>
                      )}

                      {showBpjsKes && (
                        <TableCell className="py-4 text-right font-medium text-slate-700 text-sm bg-emerald-50/10">
                          {emp.type === 'loyalis' ? (
                            <span>
                              Rp {emp.tBpjsKes.toLocaleString('id-ID')}
                            </span>
                          ) : (
                            <span className="text-slate-300 text-xs font-normal">N/A</span>
                          )}
                        </TableCell>
                      )}

                      {showBpjsPekarya && (
                        <TableCell className="py-4 text-right font-medium text-slate-700 text-sm bg-emerald-50/10">
                          {emp.type === 'pekarya' ? (
                            <span>Rp {(emp.tBpjsPekarya || 0).toLocaleString('id-ID')}</span>
                          ) : (
                            <span className="text-slate-300 text-xs font-normal">N/A</span>
                          )}
                        </TableCell>
                      )}

                      {showBeras && (
                        <TableCell className="py-4 text-right font-medium text-slate-700 text-sm bg-emerald-50/10">
                          <span>
                            Rp {emp.tBeras.toLocaleString('id-ID')}
                          </span>
                        </TableCell>
                      )}

                      {showTJabatan && (
                        <TableCell className="py-4 text-right font-medium text-slate-700 text-sm bg-emerald-50/10">
                          {emp.type === 'loyalis' ? (
                            <span>
                              Rp {(emp.tJabatan || 0).toLocaleString('id-ID')}
                            </span>
                          ) : (
                            <span className="text-slate-300 text-xs font-normal">N/A</span>
                          )}
                        </TableCell>
                      )}

                      {showTKepangkatan && (
                        <TableCell className="py-4 text-right font-medium text-slate-700 text-sm bg-emerald-50/10">
                          {emp.type === 'loyalis' ? (
                            <span>
                              Rp {(emp.tKepangkatan || 0).toLocaleString('id-ID')}
                            </span>
                          ) : (
                            <span className="text-slate-300 text-xs font-normal">N/A</span>
                          )}
                        </TableCell>
                      )}

                      {showTInstruksional && (
                        <TableCell className="py-4 text-right font-medium text-slate-700 text-sm bg-emerald-50/10">
                          {emp.type === 'loyalis' ? (
                            <span>
                              Rp {(emp.tInstruksional || 0).toLocaleString('id-ID')}
                            </span>
                          ) : (
                            <span className="text-slate-300 text-xs font-normal">N/A</span>
                          )}
                        </TableCell>
                      )}

                      {showPotBpjs && (
                        <TableCell className="py-4 text-right font-medium text-slate-700 text-sm bg-rose-50/10">
                          <span>
                            Rp {emp.potBpjs.toLocaleString('id-ID')}
                          </span>
                        </TableCell>
                      )}

                      {showPotTabungan && (
                        <TableCell className="py-4 text-right font-medium text-slate-700 text-sm bg-rose-50/10">
                          {emp.type === 'loyalis' ? (
                            <span>
                              Rp {emp.potTabungan.toLocaleString('id-ID')}
                            </span>
                          ) : (
                            <span className="text-slate-300 text-xs font-normal">N/A</span>
                          )}
                        </TableCell>
                      )}

                      {showZiz && (
                        <TableCell className="py-4 text-right font-medium text-slate-700 text-sm bg-rose-50/10">
                          {emp.type === 'loyalis' ? (
                            <span>
                              Rp {emp.potZiz.toLocaleString('id-ID')}
                            </span>
                          ) : (
                            <span className="text-slate-300 text-xs font-normal">N/A</span>
                          )}
                        </TableCell>
                      )}

                      {showTht && (
                        <TableCell className="py-4 text-right font-medium text-slate-700 text-sm bg-rose-50/10">
                          {emp.type === 'loyalis' ? (
                            <span>
                              Rp {(emp.potTht || 0).toLocaleString('id-ID')}
                            </span>
                          ) : (
                            <span className="text-slate-300 text-xs font-normal">N/A</span>
                          )}
                        </TableCell>
                      )}

                      {showPinlu && (
                        <TableCell className="py-4 text-right font-medium text-slate-700 text-sm bg-rose-50/10">
                          {emp.type === 'loyalis' ? (
                            <span>
                              Rp {(emp.potPinlu || 0).toLocaleString('id-ID')}
                            </span>
                          ) : (
                            <span className="text-slate-300 text-xs font-normal">N/A</span>
                          )}
                        </TableCell>
                      )}

                      <TableCell className="py-4 pr-8 text-center">
                        <Button 
                          variant="outline" 
                          size="icon" 
                          className="rounded-lg h-8 w-8 hover:text-indigo-600 hover:border-indigo-100 transition-all shadow-sm"
                          onClick={() => handleStartEdit(emp)}
                        >
                          <Pencil className="w-3.5 h-3.5" />
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </div>

          {/* Table Footer / Info */}
          <div className="p-6 border-t border-slate-100 bg-slate-50/20 text-xs text-slate-400 flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
            <div>
              Menampilkan <strong>{filteredEmployees.length}</strong> dari <strong>{employees.length}</strong> data staf terdaftar.
            </div>
            <div className="flex items-center gap-4">
              <span className="flex items-center gap-1.5"><div className="w-2 h-2 rounded-full bg-indigo-600" /> Acuan Loyalis:</span>
              <span>T. BPJS TK = Rp 207.216</span>
              <span>T. BPJS KES = Rp 166.038</span>
              <span>Beras = Rp 100.000</span>
              <span>Pot. BPJS = Dinamis (Sesuai Excel)</span>
              <span>Pot. Tabungan = Dinamis (Sesuai Excel)</span>
            </div>
          </div>

        </Card>

      </div>

      {/* Edit Dialog */}
      <Dialog open={editingEmployee !== null} onOpenChange={(open) => !open && setEditingEmployee(null)}>
        <DialogContent className="max-w-md rounded-[20px] bg-white p-6 shadow-2xl border-none">
          <DialogHeader className="space-y-1">
            <DialogTitle className="text-xl font-bold tracking-tight">Edit Tunjangan & Potongan</DialogTitle>
            <DialogDescription className="text-slate-500 text-xs">
              Ubah data tunjangan & potongan tetap untuk {editingEmployee?.name}.
            </DialogDescription>
          </DialogHeader>

          {editingEmployee && (
            <div className="space-y-4 py-4">
              <div className="p-3 bg-slate-50 rounded-xl space-y-0.5">
                <div className="text-xs font-semibold text-slate-500">{editingEmployee.name}</div>
                <div className="text-[11px] text-slate-400 capitalize">{editingEmployee.role} • {editingEmployee.type}</div>
              </div>

              {editingEmployee.type === 'loyalis' ? (
                <>
                  <div className="space-y-1.5">
                    <label className="text-xs font-semibold text-slate-600">Tunjangan BPJS TK</label>
                    <div className="relative">
                      <span className="absolute left-3.5 top-1/2 -translate-y-1/2 text-sm text-slate-400 font-medium select-none">Rp</span>
                      <Input
                        type="text"
                        value={formatCurrencyInput(editForm.tBpjsTk)}
                        onChange={(e) => setEditForm(prev => ({ ...prev, tBpjsTk: parseCurrencyInput(e.target.value) }))}
                        className="pl-9 rounded-xl border-slate-200 focus:ring-1 focus:ring-indigo-500 focus:border-indigo-500 text-sm h-10 shadow-sm"
                      />
                    </div>
                  </div>

                  <div className="space-y-1.5">
                    <label className="text-xs font-semibold text-slate-600">Tunjangan BPJS KES</label>
                    <div className="relative">
                      <span className="absolute left-3.5 top-1/2 -translate-y-1/2 text-sm text-slate-400 font-medium select-none">Rp</span>
                      <Input
                        type="text"
                        value={formatCurrencyInput(editForm.tBpjsKes)}
                        onChange={(e) => setEditForm(prev => ({ ...prev, tBpjsKes: parseCurrencyInput(e.target.value) }))}
                        className="pl-9 rounded-xl border-slate-200 focus:ring-1 focus:ring-indigo-500 focus:border-indigo-500 text-sm h-10 shadow-sm"
                      />
                    </div>
                  </div>

                  <div className="space-y-1.5">
                    <label className="text-xs font-semibold text-slate-600">Potongan Tabungan</label>
                    <div className="relative">
                      <span className="absolute left-3.5 top-1/2 -translate-y-1/2 text-sm text-slate-400 font-medium select-none">Rp</span>
                      <Input
                        type="text"
                        value={formatCurrencyInput(editForm.potTabungan)}
                        onChange={(e) => setEditForm(prev => ({ ...prev, potTabungan: parseCurrencyInput(e.target.value) }))}
                        className="pl-9 rounded-xl border-slate-200 focus:ring-1 focus:ring-indigo-500 focus:border-indigo-500 text-sm h-10 shadow-sm"
                      />
                    </div>
                  </div>

                  <div className="space-y-1.5">
                    <label className="text-xs font-semibold text-slate-600">Potongan Zakat Infaq Sodaqoh</label>
                    <div className="relative">
                      <span className="absolute left-3.5 top-1/2 -translate-y-1/2 text-sm text-slate-400 font-medium select-none">Rp</span>
                      <Input
                        type="text"
                        value={formatCurrencyInput(editForm.potZiz)}
                        onChange={(e) => setEditForm(prev => ({ ...prev, potZiz: parseCurrencyInput(e.target.value) }))}
                        className="pl-9 rounded-xl border-slate-200 focus:ring-1 focus:ring-indigo-500 focus:border-indigo-500 text-sm h-10 shadow-sm"
                      />
                    </div>
                  </div>

                  <div className="space-y-1.5">
                    <label className="text-xs font-semibold text-slate-600">Potongan BNI Simponi / THT</label>
                    <div className="relative">
                      <span className="absolute left-3.5 top-1/2 -translate-y-1/2 text-sm text-slate-400 font-medium select-none">Rp</span>
                      <Input
                        type="text"
                        value={formatCurrencyInput(editForm.potTht)}
                        onChange={(e) => setEditForm(prev => ({ ...prev, potTht: parseCurrencyInput(e.target.value) }))}
                        className="pl-9 rounded-xl border-slate-200 focus:ring-1 focus:ring-indigo-500 focus:border-indigo-500 text-sm h-10 shadow-sm"
                      />
                    </div>
                  </div>

                  <div className="space-y-1.5">
                    <label className="text-xs font-semibold text-slate-600">Potongan Pinlu/Tagihan</label>
                    <div className="relative">
                      <span className="absolute left-3.5 top-1/2 -translate-y-1/2 text-sm text-slate-400 font-medium select-none">Rp</span>
                      <Input
                        type="text"
                        value={formatCurrencyInput(editForm.potPinlu)}
                        onChange={(e) => setEditForm(prev => ({ ...prev, potPinlu: parseCurrencyInput(e.target.value) }))}
                        className="pl-9 rounded-xl border-slate-200 focus:ring-1 focus:ring-indigo-500 focus:border-indigo-500 text-sm h-10 shadow-sm"
                      />
                    </div>
                  </div>

                  <div className="space-y-1.5">
                    <label className="text-xs font-semibold text-slate-600">Tunjangan Kepangkatan</label>
                    <div className="relative">
                      <span className="absolute left-3.5 top-1/2 -translate-y-1/2 text-sm text-slate-400 font-medium select-none">Rp</span>
                      <Input
                        type="text"
                        value={formatCurrencyInput(editForm.tKepangkatan)}
                        onChange={(e) => setEditForm(prev => ({ ...prev, tKepangkatan: parseCurrencyInput(e.target.value) }))}
                        className="pl-9 rounded-xl border-slate-200 focus:ring-1 focus:ring-indigo-500 focus:border-indigo-500 text-sm h-10 shadow-sm"
                      />
                    </div>
                  </div>

                  <div className="space-y-1.5">
                    <label className="text-xs font-semibold text-slate-600">Tunjangan Instruksional</label>
                    <div className="relative">
                      <span className="absolute left-3.5 top-1/2 -translate-y-1/2 text-sm text-slate-400 font-medium select-none">Rp</span>
                      <Input
                        type="text"
                        value={formatCurrencyInput(editForm.tInstruksional)}
                        onChange={(e) => setEditForm(prev => ({ ...prev, tInstruksional: parseCurrencyInput(e.target.value) }))}
                        className="pl-9 rounded-xl border-slate-200 focus:ring-1 focus:ring-indigo-500 focus:border-indigo-500 text-sm h-10 shadow-sm"
                      />
                    </div>
                  </div>

                  <div className="space-y-1.5">
                    <label className="text-xs font-semibold text-slate-600">Angka Kredit Kumulatif</label>
                    <Input
                      type="number"
                      value={editForm.cummulativeCredit}
                      onChange={(e) => setEditForm(prev => ({ ...prev, cummulativeCredit: Number(e.target.value) || 0 }))}
                      className="rounded-xl border-slate-200 focus:ring-1 focus:ring-indigo-500 focus:border-indigo-500 text-sm h-10 shadow-sm"
                    />
                  </div>
                </>
              ) : (
                <div className="space-y-1.5">
                  <label className="text-xs font-semibold text-slate-600">Tunjangan BPJS Pekarya</label>
                  <div className="relative">
                    <span className="absolute left-3.5 top-1/2 -translate-y-1/2 text-sm text-slate-400 font-medium select-none">Rp</span>
                    <Input
                      type="text"
                      value={formatCurrencyInput(editForm.tBpjsPekarya)}
                      onChange={(e) => setEditForm(prev => ({ ...prev, tBpjsPekarya: parseCurrencyInput(e.target.value) }))}
                      className="pl-9 rounded-xl border-slate-200 focus:ring-1 focus:ring-indigo-500 focus:border-indigo-500 text-sm h-10 shadow-sm"
                    />
                  </div>
                </div>
              )}

              <div className="space-y-1.5">
                <label className="text-xs font-semibold text-slate-600">Tunjangan Beras</label>
                <div className="relative">
                  <span className="absolute left-3.5 top-1/2 -translate-y-1/2 text-sm text-slate-400 font-medium select-none">Rp</span>
                  <Input
                    type="text"
                    value={formatCurrencyInput(editForm.tBeras)}
                    onChange={(e) => setEditForm(prev => ({ ...prev, tBeras: parseCurrencyInput(e.target.value) }))}
                    className="pl-9 rounded-xl border-slate-200 focus:ring-1 focus:ring-indigo-500 focus:border-indigo-500 text-sm h-10 shadow-sm"
                  />
                </div>
              </div>

              <div className="space-y-1.5">
                <label className="text-xs font-semibold text-slate-600">Potongan BPJS</label>
                <div className="relative">
                  <span className="absolute left-3.5 top-1/2 -translate-y-1/2 text-sm text-slate-400 font-medium select-none">Rp</span>
                  <Input
                    type="text"
                    value={formatCurrencyInput(editForm.potBpjs)}
                    onChange={(e) => setEditForm(prev => ({ ...prev, potBpjs: parseCurrencyInput(e.target.value) }))}
                    className="pl-9 rounded-xl border-slate-200 focus:ring-1 focus:ring-indigo-500 focus:border-indigo-500 text-sm h-10 shadow-sm"
                  />
                </div>
              </div>

              <div className="flex items-center justify-end gap-2 pt-2">
                <Button
                  variant="outline"
                  onClick={() => setEditingEmployee(null)}
                  disabled={saving}
                  className="rounded-xl border-slate-200 text-slate-600 hover:bg-slate-50 transition-all text-sm h-10"
                >
                  Batal
                </Button>
                <Button
                  onClick={handleSaveEdit}
                  disabled={saving}
                  className="rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white transition-all text-sm h-10 px-5 gap-2"
                >
                  {saving ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin" />
                      Menyimpan...
                    </>
                  ) : (
                    'Simpan Perubahan'
                  )}
                </Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
