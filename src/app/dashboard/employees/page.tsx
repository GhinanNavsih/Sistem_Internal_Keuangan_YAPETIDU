"use client";

import React, { useState, useEffect } from 'react';
import Link from 'next/link';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Search,
  UserPlus,
  Pencil,
  Trash2,
  ArrowLeft,
  Loader2,
  Users,
  CreditCard,
  CheckCircle2,
  AlertCircle,
  ShieldCheck,
  Truck,
  Wrench,
  Wind,
  Save,
} from 'lucide-react';
import {
  collection,
  getDocs,
  doc,
  setDoc,
  deleteDoc,
  serverTimestamp,
  Timestamp,
} from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { BlueCollarEmployee } from '@/types';

const JOB_CATEGORIES = ['SATPAM', 'SOPIR', 'KEBERSIHAN', 'TEKNISI', 'KEBERSIHAN_IC'];

const JOB_ICONS: Record<string, React.ReactNode> = {
  SATPAM: <ShieldCheck className="w-3.5 h-3.5" />,
  SOPIR: <Truck className="w-3.5 h-3.5" />,
  TEKNISI: <Wrench className="w-3.5 h-3.5" />,
  KEBERSIHAN: <Wind className="w-3.5 h-3.5" />,
  KEBERSIHAN_IC: <Wind className="w-3.5 h-3.5" />,
};

const COLLAR_TABS = [
  { key: 'blue', label: 'Blue Collar', collection: 'Employees_BlueCollar', prefix: 'BC' },
  { key: 'loyalis', label: 'White Collar (Loyalis)', collection: 'Employees_Loyalis', prefix: 'Loyalis' },
];

type FormData = any;

// Helper getters to unify rendering between blue collar and Loyalis white collar records
const getEmpId = (emp: any) => emp.employeeId || emp.id || '';
const getEmpName = (emp: any) => emp.personal_info?.name || emp.name || '';
const getEmpNikOrNiy = (emp: any) => emp.personal_info?.employee_id_niy || emp.nik || '';
const getEmpCategory = (emp: any) => emp.employment_profile?.job_role || emp.employment?.jobCategory || '';
const getEmpGrade = (emp: any) => emp.academic_and_tier?.level_code || emp.salaryProfile?.salaryGradeCode || '';
const getEmpIsActive = (emp: any) => {
  if (emp.personal_info?.status !== undefined) {
    return emp.personal_info.status === 'AKTIF';
  }
  return emp.flags?.isActive ?? true;
};
const getEmpStartDate = (emp: any) => {
  if (emp.employment_profile?.date_of_hire) {
    const d = emp.employment_profile.date_of_hire;
    if (d && typeof d.toDate === 'function') {
      return d.toDate().toISOString().split('T')[0];
    }
    return d;
  }
  return emp.employment?.startDate || '';
};

export default function EmployeesPage() {
  const [activeTab, setActiveTab] = useState('blue');
  const [employees, setEmployees] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [editingEmployee, setEditingEmployee] = useState<any | null>(null);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  const currentTab = COLLAR_TABS.find(t => t.key === activeTab)!;

  const resetForm = (tab: string): any => {
    if (tab === 'loyalis') {
      return {
        personal_info: { name: '', employee_id_niy: '', tax_id_npwp: '', status: 'AKTIF' },
        banking_info: { bank_name: 'BSI', account_number: '' },
        employment_profile: { job_role: '', department_unit: '', date_of_hire: '', date_recognized: '', date_exit: '' },
        academic_and_tier: { education_level: '', education_code: '', functional_tier: '', level_code: '', base_salary_tier: '' },
        family_allowance_metrics: { spouse_count: 0, children_sd: 0, children_sltp: 0, children_slta: 0, children_pt: 0 },
      };
    }
    return {
      name: '',
      nik: '',
      collarType: 'blue_collar',
      employment: { status: 'active', jobCategory: 'OTHER', startDate: '', endDate: null },
      salaryProfile: { salaryGradeCode: '', baseSalaryAmount: 0, salaryMatrixVersion: '2026_v1' },
      bankAccount: { bankName: 'BSI', accountNumber: '', accountHolderName: '' },
      bpjs: { allowanceAmount: 0, deductionAmount: 0 },
      deductions: { koperasiRochmad: 0 },
      flags: { isActive: true, isPayrollEligible: true },
    };
  };

  const [formData, setFormData] = useState<FormData>(resetForm('blue'));

  const updateNestedField = (section: string, field: string, value: any) => {
    setFormData((prev: any) => ({
      ...prev,
      [section]: {
        ...(prev[section] || {}),
        [field]: value
      }
    }));
  };

  // Sync default form data when active tab changes
  useEffect(() => {
    setFormData(resetForm(activeTab));
  }, [activeTab]);

  useEffect(() => { fetchEmployees(); }, [activeTab]);

  const fetchEmployees = async () => {
    try {
      setLoading(true);
      const snap = await getDocs(collection(db, currentTab.collection));
      const list = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      setEmployees(list.sort((a, b) => getEmpId(a).localeCompare(getEmpId(b))));
    } catch (err) {
      console.error('Error fetching employees:', err);
    } finally {
      setLoading(false);
    }
  };

  const handleOpenAdd = () => {
    setEditingEmployee(null);
    setFormData(resetForm(activeTab));
    setIsDialogOpen(true);
  };

  const formatTimestampForInput = (ts: any) => {
    if (!ts) return '';
    if (ts.toDate && typeof ts.toDate === 'function') {
      return ts.toDate().toISOString().split('T')[0];
    }
    if (typeof ts === 'string') return ts.split('T')[0];
    return '';
  };

  const handleOpenEdit = (emp: any) => {
    setEditingEmployee(emp);
    if (activeTab === 'loyalis') {
      setFormData({
        ...emp,
        employment_profile: {
          ...emp.employment_profile,
          date_of_hire: formatTimestampForInput(emp.employment_profile?.date_of_hire),
          date_recognized: formatTimestampForInput(emp.employment_profile?.date_recognized),
          date_exit: formatTimestampForInput(emp.employment_profile?.date_exit),
        }
      });
    } else {
      setFormData({ ...emp });
    }
    setIsDialogOpen(true);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      setSaving(true);
      setMessage(null);

      let employeeId = editingEmployee ? getEmpId(editingEmployee) : '';
      if (!employeeId) {
        const sorted = [...employees].sort((a, b) => getEmpId(b).localeCompare(getEmpId(a)));
        const lastNum = sorted.length > 0 ? parseInt(getEmpId(sorted[0]).split('_')[1]) : 0;
        employeeId = `${currentTab.prefix}_${String(lastNum + 1).padStart(3, '0')}`;
      }

      let final: any;

      if (activeTab === 'loyalis') {
        const toTimestamp = (dateString: string) => {
          if (!dateString) return null;
          const d = new Date(dateString);
          return isNaN(d.getTime()) ? null : Timestamp.fromDate(d);
        };

        final = {
          personal_info: {
            name: formData.personal_info?.name || '',
            employee_id_niy: formData.personal_info?.employee_id_niy || null,
            tax_id_npwp: formData.personal_info?.tax_id_npwp || null,
            status: formData.personal_info?.status || 'AKTIF',
          },
          banking_info: {
            bank_name: formData.banking_info?.bank_name || null,
            account_number: formData.banking_info?.account_number || null,
          },
          employment_profile: {
            job_role: formData.employment_profile?.job_role || null,
            department_unit: formData.employment_profile?.department_unit || null,
            date_of_hire: toTimestamp(formData.employment_profile?.date_of_hire || ''),
            date_recognized: toTimestamp(formData.employment_profile?.date_recognized || ''),
            date_exit: toTimestamp(formData.employment_profile?.date_exit || ''),
          },
          academic_and_tier: {
            education_level: formData.academic_and_tier?.education_level || null,
            education_code: formData.academic_and_tier?.education_code !== undefined && formData.academic_and_tier?.education_code !== '' ? Number(formData.academic_and_tier.education_code) : null,
            functional_tier: formData.academic_and_tier?.functional_tier !== undefined && formData.academic_and_tier?.functional_tier !== '' ? Number(formData.academic_and_tier.functional_tier) : null,
            level_code: formData.academic_and_tier?.level_code || null,
            base_salary_tier: formData.academic_and_tier?.base_salary_tier !== undefined && formData.academic_and_tier?.base_salary_tier !== '' ? Number(formData.academic_and_tier.base_salary_tier) : null,
          },
          family_allowance_metrics: {
            spouse_count: Number(formData.family_allowance_metrics?.spouse_count) || 0,
            children_sd: Number(formData.family_allowance_metrics?.children_sd) || 0,
            children_sltp: Number(formData.family_allowance_metrics?.children_sltp) || 0,
            children_slta: Number(formData.family_allowance_metrics?.children_slta) || 0,
            children_pt: Number(formData.family_allowance_metrics?.children_pt) || 0,
          },
          audit: {
            updatedAt: serverTimestamp(),
            ...(editingEmployee ? {} : { createdAt: serverTimestamp(), sourceFile: 'Web Dashboard' }),
          }
        };
      } else {
        final = {
          ...(formData as BlueCollarEmployee),
          employeeId,
          collarType: 'blue_collar',
          bankAccount: {
            ...formData.bankAccount!,
            accountHolderName: formData.name || '',
          },
          flags: {
            isActive: formData.flags?.isActive ?? true,
            isPayrollEligible: formData.flags?.isActive ?? true,
          },
          audit: {
            updatedAt: serverTimestamp(),
            ...(editingEmployee ? {} : { createdAt: serverTimestamp(), sourceFile: 'Web Dashboard' }),
          },
        };
      }

      await setDoc(doc(db, currentTab.collection, employeeId), final, { merge: true });

      setMessage({ type: 'success', text: `Karyawan ${editingEmployee ? 'diperbarui' : 'ditambahkan'}!` });
      setIsDialogOpen(false);
      fetchEmployees();
      setTimeout(() => setMessage(null), 3000);
    } catch (err) {
      console.error('Error saving employee:', err);
      setMessage({ type: 'error', text: 'Gagal menyimpan data.' });
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (employeeId: string) => {
    if (!confirm('Hapus data karyawan ini?')) return;
    try {
      setLoading(true);
      await deleteDoc(doc(db, currentTab.collection, employeeId));
      fetchEmployees();
      setMessage({ type: 'success', text: 'Karyawan dihapus.' });
      setTimeout(() => setMessage(null), 3000);
    } catch (err) {
      console.error('Error deleting employee:', err);
      setMessage({ type: 'error', text: 'Gagal menghapus data.' });
    } finally {
      setLoading(false);
    }
  };

  const filtered = employees.filter(emp => {
    const name = getEmpName(emp);
    const nik = getEmpNikOrNiy(emp);
    const id = getEmpId(emp);
    return (
      name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      (nik && String(nik).includes(searchQuery)) ||
      id.includes(searchQuery)
    );
  });

  const statsCards = [
    { label: 'Total Pegawai', value: employees.length, icon: <Users className="w-5 h-5" />, color: 'indigo' },
    { label: 'Aktif', value: employees.filter(e => getEmpIsActive(e)).length, icon: <CheckCircle2 className="w-5 h-5" />, color: 'emerald' },
    { label: 'Non-Aktif', value: employees.filter(e => !getEmpIsActive(e)).length, icon: <AlertCircle className="w-5 h-5" />, color: 'amber' },
    { label: 'Payroll Eligible', value: employees.filter(e => activeTab === 'loyalis' ? getEmpIsActive(e) : (e.flags?.isPayrollEligible ?? true)).length, icon: <CreditCard className="w-5 h-5" />, color: 'purple' },
  ];

  return (
    <div className="min-h-screen bg-gradient-to-br from-indigo-50/50 via-white to-purple-50/50 p-8 font-sans text-slate-800">
      <div className="max-w-[1400px] mx-auto">

        {/* Header */}
        <div className="flex justify-between items-center mb-8">
          <div className="flex items-center gap-4">
            <Link href="/dashboard/payroll">
              <Button variant="ghost" size="icon" className="rounded-full bg-white shadow-sm border border-slate-200 hover:bg-slate-50">
                <ArrowLeft className="w-5 h-5 text-slate-600" />
              </Button>
            </Link>
            <div>
              <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
                <Users className="w-6 h-6 text-indigo-500" />
                Master Data Pegawai
              </h1>
              <p className="text-slate-500 text-sm">Kelola data induk pegawai unit BAK</p>
            </div>
          </div>

          <div className="flex items-center gap-3">
            {message && (
              <div className={`flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-medium ${message.type === 'success' ? 'bg-emerald-50 text-emerald-700' : 'bg-red-50 text-red-700'
                }`}>
                {message.type === 'success' ? <CheckCircle2 className="w-4 h-4" /> : <AlertCircle className="w-4 h-4" />}
                {message.text}
              </div>
            )}
            <div className="relative">
              <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
              <Input
                placeholder="Cari nama, NIK..."
                className="pl-10 w-64 bg-white border-slate-200 rounded-xl shadow-sm"
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
              />
            </div>
            <Button onClick={handleOpenAdd} className="rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white shadow-md shadow-indigo-200 px-6">
              <UserPlus className="w-4 h-4 mr-2" /> Tambah Pegawai
            </Button>
          </div>
        </div>

        {/* Collar type tabs */}
        <div className="flex gap-2 mb-6">
          {COLLAR_TABS.map(tab => (
            <button
              key={tab.key}
              onClick={() => setActiveTab(tab.key)}
              className={`px-4 py-1.5 rounded-full text-sm font-medium transition-all ${activeTab === tab.key
                ? 'bg-indigo-600 text-white shadow-md shadow-indigo-100'
                : 'bg-white text-slate-600 border border-slate-200 hover:bg-slate-50'
                }`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {/* Stats */}
        <div className="grid grid-cols-1 md:grid-cols-4 gap-6 mb-8">
          {statsCards.map((stat, i) => (
            <Card key={i} className="p-5 bg-white border-none shadow-[0_8px_30px_rgb(0,0,0,0.02)] rounded-2xl flex items-center gap-4">
              <div className={`w-12 h-12 rounded-xl bg-${stat.color}-50 text-${stat.color}-500 flex items-center justify-center`}>
                {stat.icon}
              </div>
              <div>
                <p className="text-xs text-slate-500 font-medium uppercase tracking-wider">{stat.label}</p>
                <p className="text-2xl font-bold">{stat.value}</p>
              </div>
            </Card>
          ))}
        </div>

        {/* Table */}
        <Card className="bg-white rounded-[24px] shadow-[0_8px_40px_-12px_rgba(0,0,0,0.06)] border-none overflow-hidden">
          <div className="overflow-x-auto">
            <Table>
              <TableHeader className="bg-slate-50/50">
                <TableRow className="border-slate-100">
                  <TableHead className="w-24 font-semibold text-slate-900 pl-8">ID</TableHead>
                  <TableHead className="font-semibold text-slate-900 w-[320px]">Nama Lengkap</TableHead>
                  <TableHead className="font-semibold text-slate-900 w-[320px]">Kategori</TableHead>
                  <TableHead className="font-semibold text-slate-900">Gol.</TableHead>
                  <TableHead className="font-semibold text-slate-900 text-center">Status</TableHead>
                  <TableHead className="font-semibold text-slate-900">Mulai Kerja</TableHead>
                  <TableHead className="font-semibold text-slate-900 text-right pr-8">Aksi</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {loading ? (
                  <TableRow>
                    <TableCell colSpan={7} className="h-64 text-center">
                      <div className="flex flex-col items-center gap-3 text-slate-400">
                        <Loader2 className="w-8 h-8 animate-spin text-indigo-500" />
                        <p>Memuat data pegawai...</p>
                      </div>
                    </TableCell>
                  </TableRow>
                ) : filtered.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={7} className="h-64 text-center">
                      <p className="text-slate-400">Tidak ada pegawai yang ditemukan.</p>
                    </TableCell>
                  </TableRow>
                ) : filtered.map(emp => (
                  <TableRow key={getEmpId(emp)} className="hover:bg-slate-50/30 transition-colors border-slate-50">
                    <TableCell className="font-bold text-slate-400 pl-8 font-mono text-xs">{getEmpId(emp)}</TableCell>
                    <TableCell className="w-[320px] max-w-[320px]">
                      <div className="flex flex-col">
                        <span className="font-bold text-slate-900 block truncate" title={getEmpName(emp)}>{getEmpName(emp)}</span>
                        <span className="text-xs text-slate-400 font-mono">
                          {activeTab === 'loyalis' ? 'NIY' : 'NIK'}: {getEmpNikOrNiy(emp) || '-'}
                        </span>
                      </div>
                    </TableCell>
                    <TableCell className="w-[320px] max-w-[320px]">
                      <div className="flex items-center gap-1.5 text-sm font-medium text-slate-700">
                        <span className="shrink-0">{JOB_ICONS[getEmpCategory(emp)] || null}</span>
                        <span className="truncate" title={getEmpCategory(emp)}>{getEmpCategory(emp)}</span>
                      </div>
                    </TableCell>
                    <TableCell>
                      {getEmpGrade(emp)
                        ? <span className="font-bold text-indigo-600">{getEmpGrade(emp)}</span>
                        : <span className="text-slate-300">-</span>
                      }
                    </TableCell>
                    <TableCell className="text-center">
                      <Badge className={`rounded-full px-3 font-normal border-none ${getEmpIsActive(emp) ? 'bg-emerald-50 text-emerald-600' : 'bg-slate-100 text-slate-500'
                        }`}>
                        {getEmpIsActive(emp) ? 'Aktif' : 'Non-Aktif'}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-slate-500 text-sm">
                      {getEmpStartDate(emp)
                        ? new Date(getEmpStartDate(emp)).toLocaleDateString('id-ID', { year: 'numeric', month: 'short' })
                        : '-'}
                    </TableCell>
                    <TableCell className="text-right pr-8">
                      <div className="flex justify-end gap-1">
                        <Button variant="ghost" size="icon" onClick={() => handleOpenEdit(emp)} className="h-8 w-8 text-slate-400 hover:text-indigo-600 rounded-lg">
                          <Pencil className="w-4 h-4" />
                        </Button>
                        <Button variant="ghost" size="icon" onClick={() => handleDelete(getEmpId(emp))} className="h-8 w-8 text-slate-400 hover:text-red-600 rounded-lg">
                          <Trash2 className="w-4 h-4" />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </Card>
      </div>

      {/* CRUD Dialog */}
      <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
        <DialogContent className="!max-w-5xl w-[90vw] rounded-[28px] border-none shadow-2xl p-0 overflow-hidden bg-white">
          <form onSubmit={handleSubmit}>
            <DialogHeader className="p-6 bg-slate-50/50 border-b border-slate-100">
              <DialogTitle className="text-xl font-bold flex items-center gap-2">
                {editingEmployee ? <Pencil className="w-5 h-5 text-indigo-500" /> : <UserPlus className="w-5 h-5 text-indigo-500" />}
                {editingEmployee
                  ? `Edit Data Karyawan (${activeTab === 'loyalis' ? 'White Collar' : 'Blue Collar'})`
                  : `Tambah Karyawan ${activeTab === 'loyalis' ? 'White Collar (Loyalis)' : 'Blue Collar'}`
                }
              </DialogTitle>
            </DialogHeader>

            <div className="p-8 max-h-[75vh] overflow-y-auto">
              {activeTab === 'loyalis' ? (
                <div className="grid grid-cols-3 gap-6">
                  <div className="space-y-4">
                    <h3 className="text-sm font-bold text-slate-900 uppercase tracking-wider">Identitas</h3>
                    <div className="space-y-2"><Label>Nama</Label><Input value={formData.personal_info?.name || ''} onChange={e => updateNestedField('personal_info', 'name', e.target.value)} /></div>
                    <div className="space-y-2"><Label>NIY</Label><Input value={formData.personal_info?.employee_id_niy || ''} onChange={e => updateNestedField('personal_info', 'employee_id_niy', e.target.value)} /></div>
                    <div className="space-y-2"><Label>NPWP</Label><Input value={formData.personal_info?.tax_id_npwp || ''} onChange={e => updateNestedField('personal_info', 'tax_id_npwp', e.target.value)} /></div>
                  </div>
                  <div className="space-y-4">
                    <h3 className="text-sm font-bold text-slate-900 uppercase tracking-wider">Pekerjaan</h3>
                    <div className="space-y-2"><Label>Jabatan</Label><Input placeholder="DOSEN, TENDIK, dll." value={formData.employment_profile?.job_role || ''} onChange={e => updateNestedField('employment_profile', 'job_role', e.target.value)} /></div>
                    <div className="space-y-2"><Label>Departemen / Unit</Label><Input value={formData.employment_profile?.department_unit || ''} onChange={e => updateNestedField('employment_profile', 'department_unit', e.target.value)} /></div>
                    <div className="space-y-2"><Label>Tanggal Mulai Kerja</Label><Input type="date" value={formData.employment_profile?.date_of_hire || ''} onChange={e => updateNestedField('employment_profile', 'date_of_hire', e.target.value)} /></div>
                    <div className="space-y-2"><Label>TMT Golongan (SK)</Label><Input type="date" value={formData.employment_profile?.date_recognized || ''} onChange={e => updateNestedField('employment_profile', 'date_recognized', e.target.value)} /></div>
                  </div>
                  <div className="space-y-4">
                    <h3 className="text-sm font-bold text-slate-900 uppercase tracking-wider">Akademik &amp; Finansial</h3>
                    <div className="grid grid-cols-2 gap-3">
                      <div className="space-y-2"><Label>Pendidikan</Label><Input placeholder="S1, S2, D3" value={formData.academic_and_tier?.education_level || ''} onChange={e => updateNestedField('academic_and_tier', 'education_level', e.target.value)} /></div>
                      <div className="space-y-2"><Label>Golongan</Label><Input placeholder="Gol. G" value={formData.academic_and_tier?.level_code || ''} onChange={e => updateNestedField('academic_and_tier', 'level_code', e.target.value)} /></div>
                      <div className="space-y-2"><Label>Kode Pend.</Label><Input type="number" value={formData.academic_and_tier?.education_code ?? ''} onChange={e => updateNestedField('academic_and_tier', 'education_code', e.target.value)} /></div>
                      <div className="space-y-2"><Label>Tunj. Kofu</Label><Input type="number" value={formData.academic_and_tier?.functional_tier ?? ''} onChange={e => updateNestedField('academic_and_tier', 'functional_tier', e.target.value)} /></div>
                    </div>
                    <div className="space-y-2"><Label>Nama Bank</Label><Input value={formData.banking_info?.bank_name || ''} onChange={e => updateNestedField('banking_info', 'bank_name', e.target.value)} /></div>
                    <div className="space-y-2"><Label>Nomor Rekening</Label><Input value={formData.banking_info?.account_number || ''} onChange={e => updateNestedField('banking_info', 'account_number', e.target.value)} /></div>
                  </div>
                  <div className="col-span-3 pt-2 border-t border-slate-100 space-y-4">
                    <h3 className="text-sm font-bold text-slate-900 uppercase tracking-wider">Tanggungan Keluarga (Untuk Tunjangan)</h3>
                    <div className="grid grid-cols-5 gap-3">
                      <div className="space-y-2"><Label>Pasangan</Label><Input type="number" value={formData.family_allowance_metrics?.spouse_count ?? 0} onChange={e => updateNestedField('family_allowance_metrics', 'spouse_count', e.target.value)} className="rounded-xl border-slate-200" /></div>
                      <div className="space-y-2"><Label>Anak SD</Label><Input type="number" value={formData.family_allowance_metrics?.children_sd ?? 0} onChange={e => updateNestedField('family_allowance_metrics', 'children_sd', e.target.value)} className="rounded-xl border-slate-200" /></div>
                      <div className="space-y-2"><Label>Anak SLTP</Label><Input type="number" value={formData.family_allowance_metrics?.children_sltp ?? 0} onChange={e => updateNestedField('family_allowance_metrics', 'children_sltp', e.target.value)} className="rounded-xl border-slate-200" /></div>
                      <div className="space-y-2"><Label>Anak SLTA</Label><Input type="number" value={formData.family_allowance_metrics?.children_slta ?? 0} onChange={e => updateNestedField('family_allowance_metrics', 'children_slta', e.target.value)} className="rounded-xl border-slate-200" /></div>
                      <div className="space-y-2"><Label>Anak Kuliah</Label><Input type="number" value={formData.family_allowance_metrics?.children_pt ?? 0} onChange={e => updateNestedField('family_allowance_metrics', 'children_pt', e.target.value)} className="rounded-xl border-slate-200" /></div>
                    </div>
                  </div>
                  <div className="col-span-3">
                    <div className="p-4 bg-slate-50 rounded-2xl border border-slate-100 flex items-center justify-between">
                      <div><h4 className="font-semibold text-slate-800 text-sm">Status Kepegawaian</h4><p className="text-xs text-slate-500 mt-0.5">Aktif atau sudah keluar?</p></div>
                      <Badge onClick={() => updateNestedField('personal_info', 'status', formData.personal_info?.status === 'AKTIF' ? 'KELUAR' : 'AKTIF')} className={`cursor-pointer px-4 py-1.5 rounded-xl border-none transition-all ${formData.personal_info?.status === 'AKTIF' ? 'bg-indigo-600 text-white shadow-lg shadow-indigo-100' : 'bg-slate-200 text-slate-600'}`}>
                        {formData.personal_info?.status === 'AKTIF' ? 'Aktif' : 'Non-Aktif / Keluar'}
                      </Badge>
                    </div>
                  </div>
                </div>
              ) : (
                <div className="grid grid-cols-3 gap-6">
                  <div className="col-span-3 grid grid-cols-3 gap-4">
                    <div className="space-y-2"><Label htmlFor="name">Nama Lengkap</Label><Input id="name" required value={formData.name || ''} onChange={e => setFormData({ ...formData, name: e.target.value })} className="rounded-xl border-slate-200" /></div>
                    <div className="space-y-2"><Label htmlFor="nik">NIK (Nomor Induk Kependudukan)</Label><Input id="nik" value={formData.nik || ''} onChange={e => setFormData({ ...formData, nik: e.target.value })} className="rounded-xl border-slate-200" /></div>
                  </div>
                  <div className="space-y-4">
                    <h3 className="text-sm font-bold text-slate-900 uppercase tracking-wider">Pekerjaan</h3>
                    <div className="space-y-2">
                      <Label>Kategori</Label>
                      <Select value={formData.employment?.jobCategory} onValueChange={val => setFormData((prev: any) => ({ ...prev, employment: { ...(prev.employment || { status: 'active', startDate: '', endDate: null }), jobCategory: val } as any }))}>
                        <SelectTrigger className="rounded-xl border-slate-200"><SelectValue /></SelectTrigger>
                        <SelectContent>{JOB_CATEGORIES.map(cat => <SelectItem key={cat} value={cat}>{cat}</SelectItem>)}</SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-2"><Label>Tanggal Mulai</Label><Input type="date" value={formData.employment?.startDate || ''} onChange={e => setFormData((prev: any) => ({ ...prev, employment: { ...(prev.employment || { status: 'active', jobCategory: 'OTHER', endDate: null }), startDate: e.target.value } as any }))} className="rounded-xl border-slate-200" /></div>
                    <div className="space-y-2"><Label>Golongan (Grade)</Label><Input value={formData.salaryProfile?.salaryGradeCode || ''} onChange={e => setFormData((prev: any) => ({ ...prev, salaryProfile: { ...(prev.salaryProfile || { baseSalaryAmount: 0, salaryMatrixVersion: '2026_v1' }), salaryGradeCode: e.target.value } as any }))} className="rounded-xl border-slate-200" placeholder="D, F, K..." /></div>
                  </div>
                  <div className="space-y-4">
                    <h3 className="text-sm font-bold text-slate-900 uppercase tracking-wider">Finansial</h3>
                    <div className="space-y-2"><Label>Nama Bank</Label><Input value={formData.bankAccount?.bankName || ''} onChange={e => setFormData({ ...formData, bankAccount: { ...formData.bankAccount!, bankName: e.target.value } })} className="rounded-xl border-slate-200" /></div>
                    <div className="space-y-2"><Label>Nomor Rekening</Label><Input value={formData.bankAccount?.accountNumber || ''} onChange={e => setFormData({ ...formData, bankAccount: { ...formData.bankAccount!, accountNumber: e.target.value } })} className="rounded-xl border-slate-200" /></div>
                    <div className="space-y-2"><Label>Kode Koperasi Rochmad</Label><Input type="number" value={formData.deductions?.koperasiRochmad ?? 0} onChange={e => setFormData((prev: any) => ({ ...prev, deductions: { ...(prev.deductions || {}), koperasiRochmad: Number(e.target.value) } as any }))} className="rounded-xl border-slate-200" /></div>
                  </div>
                  <div className="space-y-4">
                    <h3 className="text-sm font-bold text-slate-900 uppercase tracking-wider">Status</h3>
                    <div className="p-4 bg-slate-50 rounded-2xl border border-slate-100 flex items-center justify-between">
                      <div><h4 className="font-semibold text-slate-800 text-sm">Status Kepegawaian</h4><p className="text-xs text-slate-500 mt-0.5">Aktif atau sudah keluar?</p></div>
                      <Badge onClick={() => setFormData((prev: any) => ({ ...prev, flags: { ...prev.flags!, isActive: !prev.flags?.isActive, isPayrollEligible: !prev.flags?.isActive } }))} className={`cursor-pointer px-4 py-1.5 rounded-xl border-none transition-all ${formData.flags?.isActive ? 'bg-indigo-600 text-white shadow-lg shadow-indigo-100' : 'bg-slate-200 text-slate-600'}`}>
                        {formData.flags?.isActive ? 'Aktif' : 'Non-Aktif'}
                      </Badge>
                    </div>
                  </div>
                </div>
              )}
            </div>

            <DialogFooter className="p-6 bg-slate-50/50 border-t border-slate-100">
              <Button type="button" variant="ghost" onClick={() => setIsDialogOpen(false)} className="rounded-xl">Batal</Button>
              <Button type="submit" disabled={saving} className="rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white px-8">
                {saving ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <Save className="w-4 h-4 mr-2" />}
                Simpan Data
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
