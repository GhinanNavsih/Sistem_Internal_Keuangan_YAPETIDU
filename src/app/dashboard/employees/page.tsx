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
  // { key: 'white', label: 'White Collar', collection: 'Employees_WhiteCollar', prefix: 'WC' },
];

type FormData = Partial<BlueCollarEmployee>;

export default function EmployeesPage() {
  const [activeTab] = useState('blue');
  const [employees, setEmployees] = useState<BlueCollarEmployee[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [editingEmployee, setEditingEmployee] = useState<BlueCollarEmployee | null>(null);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  const currentTab = COLLAR_TABS.find(t => t.key === activeTab)!;

  const [formData, setFormData] = useState<FormData>({
    name: '',
    nik: '',
    collarType: 'blue_collar',
    employment: {
      status: 'active',
      jobCategory: 'OTHER',
      startDate: '',
      endDate: null,
    },
    salaryProfile: {
      salaryGradeCode: '',
      baseSalaryAmount: 0,
      salaryMatrixVersion: '2026_v1',
    },
    bankAccount: { bankName: 'BSI', accountNumber: '', accountHolderName: '' },
    bpjs: { allowanceAmount: 0, deductionAmount: 0 },
    deductions: { koperasiRochmad: 0 },
    flags: { isActive: true, isPayrollEligible: true },
  });

  useEffect(() => { fetchEmployees(); }, [activeTab]);

  const fetchEmployees = async () => {
    try {
      setLoading(true);
      const snap = await getDocs(collection(db, currentTab.collection));
      const list = snap.docs.map(d => d.data() as BlueCollarEmployee);
      setEmployees(list.sort((a, b) => a.employeeId.localeCompare(b.employeeId)));
    } catch (err) {
      console.error('Error fetching employees:', err);
    } finally {
      setLoading(false);
    }
  };

  const resetForm = (): FormData => ({
    name: '',
    nik: '',
    collarType: 'blue_collar',
    employment: { status: 'active', jobCategory: 'OTHER', startDate: '', endDate: null },
    salaryProfile: { salaryGradeCode: '', baseSalaryAmount: 0, salaryMatrixVersion: '2026_v1' },
    bankAccount: { bankName: 'BSI', accountNumber: '', accountHolderName: '' },
    bpjs: { allowanceAmount: 0, deductionAmount: 0 },
    deductions: { koperasiRochmad: 0 },
    flags: { isActive: true, isPayrollEligible: true },
  });

  const handleOpenAdd = () => {
    setEditingEmployee(null);
    setFormData(resetForm());
    setIsDialogOpen(true);
  };

  const handleOpenEdit = (emp: BlueCollarEmployee) => {
    setEditingEmployee(emp);
    setFormData({ ...emp });
    setIsDialogOpen(true);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      setSaving(true);
      setMessage(null);

      let employeeId = editingEmployee?.employeeId;
      if (!employeeId) {
        const sorted = [...employees].sort((a, b) => b.employeeId.localeCompare(a.employeeId));
        const lastNum = sorted.length > 0 ? parseInt(sorted[0].employeeId.split('_')[1]) : 0;
        employeeId = `${currentTab.prefix}_${String(lastNum + 1).padStart(3, '0')}`;
      }

      const final: BlueCollarEmployee = {
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
        // @ts-ignore
        audit: {
          updatedAt: serverTimestamp(),
          ...(editingEmployee ? {} : { createdAt: serverTimestamp(), sourceFile: 'Web Dashboard' }),
        },
      };

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

  const filtered = employees.filter(emp =>
    emp.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
    (emp.nik && emp.nik.includes(searchQuery)) ||
    emp.employeeId.includes(searchQuery)
  );

  const statsCards = [
    { label: 'Total Pegawai', value: employees.length, icon: <Users className="w-5 h-5" />, color: 'indigo' },
    { label: 'Aktif', value: employees.filter(e => e.flags.isActive).length, icon: <CheckCircle2 className="w-5 h-5" />, color: 'emerald' },
    { label: 'Non-Aktif', value: employees.filter(e => !e.flags.isActive).length, icon: <AlertCircle className="w-5 h-5" />, color: 'amber' },
    { label: 'Payroll Eligible', value: employees.filter(e => e.flags.isPayrollEligible).length, icon: <CreditCard className="w-5 h-5" />, color: 'purple' },
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
              <div className={`flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-medium ${
                message.type === 'success' ? 'bg-emerald-50 text-emerald-700' : 'bg-red-50 text-red-700'
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
            <div key={tab.key} className="px-4 py-1.5 rounded-full text-sm font-medium bg-indigo-600 text-white shadow-md shadow-indigo-100">
              {tab.label}
            </div>
          ))}
          <div className="px-4 py-1.5 rounded-full text-sm font-medium bg-slate-100 text-slate-400 cursor-not-allowed">
            White Collar <span className="text-xs ml-1">(coming soon)</span>
          </div>
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
                  <TableHead className="font-semibold text-slate-900">Nama Lengkap</TableHead>
                  <TableHead className="font-semibold text-slate-900">Kategori</TableHead>
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
                  <TableRow key={emp.employeeId} className="hover:bg-slate-50/30 transition-colors border-slate-50">
                    <TableCell className="font-bold text-slate-400 pl-8 font-mono text-xs">{emp.employeeId}</TableCell>
                    <TableCell>
                      <div className="flex flex-col">
                        <span className="font-bold text-slate-900">{emp.name}</span>
                        <span className="text-xs text-slate-400 font-mono">NIK: {emp.nik || '-'}</span>
                      </div>
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-1.5 text-sm font-medium text-slate-700">
                        {JOB_ICONS[emp.employment.jobCategory] || null}
                        {emp.employment.jobCategory}
                      </div>
                    </TableCell>
                    <TableCell>
                      {emp.salaryProfile.salaryGradeCode
                        ? <span className="font-bold text-indigo-600">{emp.salaryProfile.salaryGradeCode}</span>
                        : <span className="text-slate-300">-</span>
                      }
                    </TableCell>
                    <TableCell className="text-center">
                      <Badge className={`rounded-full px-3 font-normal border-none ${
                        emp.flags.isActive ? 'bg-emerald-50 text-emerald-600' : 'bg-slate-100 text-slate-500'
                      }`}>
                        {emp.flags.isActive ? 'Aktif' : 'Non-Aktif'}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-slate-500 text-sm">
                      {emp.employment.startDate
                        ? new Date(emp.employment.startDate).toLocaleDateString('id-ID', { year: 'numeric', month: 'short' })
                        : '-'}
                    </TableCell>
                    <TableCell className="text-right pr-8">
                      <div className="flex justify-end gap-1">
                        <Button variant="ghost" size="icon" onClick={() => handleOpenEdit(emp)} className="h-8 w-8 text-slate-400 hover:text-indigo-600 rounded-lg">
                          <Pencil className="w-4 h-4" />
                        </Button>
                        <Button variant="ghost" size="icon" onClick={() => handleDelete(emp.employeeId)} className="h-8 w-8 text-slate-400 hover:text-red-600 rounded-lg">
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
        <DialogContent className="max-w-2xl rounded-[28px] border-none shadow-2xl p-0 overflow-hidden bg-white">
          <form onSubmit={handleSubmit}>
            <DialogHeader className="p-6 bg-slate-50/50 border-b border-slate-100">
              <DialogTitle className="text-xl font-bold flex items-center gap-2">
                {editingEmployee ? <Pencil className="w-5 h-5 text-indigo-500" /> : <UserPlus className="w-5 h-5 text-indigo-500" />}
                {editingEmployee ? 'Edit Data Pegawai' : 'Tambah Pegawai Blue Collar'}
              </DialogTitle>
            </DialogHeader>

            <div className="p-8 grid grid-cols-2 gap-6 max-h-[70vh] overflow-y-auto">
              {/* Basic Info */}
              <div className="col-span-2 grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="name">Nama Lengkap</Label>
                  <Input id="name" required value={formData.name || ''} onChange={e => setFormData({ ...formData, name: e.target.value })} className="rounded-xl border-slate-200" />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="nik">NIK (Nomor Induk Kependudukan)</Label>
                  <Input id="nik" value={formData.nik || ''} onChange={e => setFormData({ ...formData, nik: e.target.value })} className="rounded-xl border-slate-200" />
                </div>
              </div>

              {/* Employment */}
              <div className="space-y-4">
                <h3 className="text-sm font-bold text-indigo-600 uppercase tracking-wider">Pekerjaan</h3>
                <div className="space-y-2">
                  <Label>Kategori</Label>
                  <Select 
                    value={formData.employment?.jobCategory} 
                    onValueChange={val => setFormData(prev => ({ 
                      ...prev, 
                      employment: {
                        ...(prev.employment || { status: 'active', startDate: '', endDate: null }),
                        jobCategory: val
                      } as any
                    }))}
                  >
                    <SelectTrigger className="rounded-xl border-slate-200"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {JOB_CATEGORIES.map(cat => <SelectItem key={cat} value={cat}>{cat}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="startDate">Tanggal Mulai</Label>
                  <Input 
                    id="startDate" 
                    type="date" 
                    value={formData.employment?.startDate || ''} 
                    onChange={e => setFormData(prev => ({ 
                      ...prev, 
                      employment: {
                        ...(prev.employment || { status: 'active', jobCategory: 'OTHER', endDate: null }),
                        startDate: e.target.value
                      } as any
                    }))} 
                    className="rounded-xl border-slate-200" 
                  />
                </div>
                <div className="space-y-2">
                  <Label>Golongan (Grade)</Label>
                  <Input 
                    value={formData.salaryProfile?.salaryGradeCode || ''} 
                    onChange={e => setFormData(prev => ({ 
                      ...prev, 
                      salaryProfile: {
                        ...(prev.salaryProfile || { baseSalaryAmount: 0, salaryMatrixVersion: '2026_v1' }),
                        salaryGradeCode: e.target.value
                      } as any
                    }))} 
                    className="rounded-xl border-slate-200" 
                    placeholder="D, F, K..." 
                  />
                </div>
              </div>

              {/* Financial */}
              <div className="space-y-4">
                <h3 className="text-sm font-bold text-indigo-600 uppercase tracking-wider">Finansial</h3>
                <div className="space-y-2">
                  <Label>Nama Bank</Label>
                  <Input value={formData.bankAccount?.bankName || ''} onChange={e => setFormData({ ...formData, bankAccount: { ...formData.bankAccount!, bankName: e.target.value } })} className="rounded-xl border-slate-200" />
                </div>
                <div className="space-y-2">
                  <Label>Nomor Rekening</Label>
                  <Input value={formData.bankAccount?.accountNumber || ''} onChange={e => setFormData({ ...formData, bankAccount: { ...formData.bankAccount!, accountNumber: e.target.value } })} className="rounded-xl border-slate-200" />
                </div>
                <div className="space-y-2">
                  <Label>Kode Koperasi Rochmad</Label>
                  <Input 
                    type="number" 
                    value={formData.deductions?.koperasiRochmad ?? 0} 
                    onChange={e => setFormData(prev => ({ 
                      ...prev, 
                      deductions: {
                        ...(prev.deductions || {}),
                        koperasiRochmad: Number(e.target.value)
                      } as any
                    }))} 
                    className="rounded-xl border-slate-200" 
                  />
                </div>
              </div>

              {/* Status toggle */}
              <div className="col-span-2 p-4 bg-slate-50 rounded-2xl border border-slate-100 flex items-center justify-between">
                <div>
                  <h4 className="font-bold text-slate-800">Status Kepegawaian</h4>
                  <p className="text-xs text-slate-500">Tentukan apakah pegawai masih aktif.</p>
                </div>
                <Badge
                  onClick={() => setFormData(prev => ({ 
                    ...prev, 
                    flags: { 
                      ...prev.flags!, 
                      isActive: !prev.flags?.isActive, 
                      isPayrollEligible: !prev.flags?.isActive 
                    } 
                  }))}
                  className={`cursor-pointer px-4 py-1.5 rounded-xl border-none ${formData.flags?.isActive ? 'bg-indigo-600 text-white shadow-lg shadow-indigo-100' : 'bg-slate-200 text-slate-600'}`}
                >
                  {formData.flags?.isActive ? 'Aktif' : 'Non-Aktif'}
                </Badge>
              </div>
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
