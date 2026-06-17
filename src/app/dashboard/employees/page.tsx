"use client";

import React, { useState, useEffect, useRef } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/lib/AuthContext';
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
  DialogDescription,
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
  FileSpreadsheet,
  FileClock,
  History,
  ClipboardCheck,
  LogOut,
  FileText,
  Building2,
  Plus,
  LayoutGrid,
} from 'lucide-react';
import * as XLSX from 'xlsx';
import {
  collection,
  getDocs,
  doc,
  getDoc,
  setDoc,
  deleteDoc,
  addDoc,
  serverTimestamp,
  Timestamp,
} from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { BlueCollarEmployee } from '@/types';

const JOB_CATEGORIES = ['SATPAM', 'SOPIR', 'KEBERSIHAN', 'TEKNISI', 'KEBERSIHAN_IC', 'KEBERSIHAN_PONTI'];



const JOB_ICONS: Record<string, React.ReactNode> = {
  SATPAM: <ShieldCheck className="w-3.5 h-3.5" />,
  SOPIR: <Truck className="w-3.5 h-3.5" />,
  TEKNISI: <Wrench className="w-3.5 h-3.5" />,
  KEBERSIHAN: <Wind className="w-3.5 h-3.5" />,
  KEBERSIHAN_IC: <Wind className="w-3.5 h-3.5" />,
  KEBERSIHAN_PONTI: <Wind className="w-3.5 h-3.5" />,
};

const COLLAR_TABS = [
  { key: 'blue', label: 'Pekarya', collection: 'Employees_BlueCollar', prefix: 'BC' },
  { key: 'loyalis', label: 'Loyalis', collection: 'Employees_Loyalis', prefix: 'Loyalis' },
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

const calculateStructuralAllowance = (positions: any[]): number => {
  if (!positions || positions.length === 0) return 0;
  const sorted = [...positions].sort((a, b) => (Number(b.allowance) || 0) - (Number(a.allowance) || 0));
  let total = 0;
  sorted.forEach((pos, idx) => {
    const amt = Number(pos.allowance) || 0;
    if (idx === 0) {
      total += amt;
    } else {
      total += Math.round(amt / 2);
    }
  });
  return total;
};

const getDebugRows = (employeesList: any[], activeTab: string) => {
  const rows: any[] = [];
  employeesList.forEach(emp => {
    if (activeTab === 'loyalis') {
      const positions = emp.employment_profile?.structural_positions || [];
      if (positions.length > 0) {
        const sortedPositions = [...positions].sort((a: any, b: any) => (Number(b.allowance) || 0) - (Number(a.allowance) || 0));
        sortedPositions.forEach((pos: any, idx: number) => {
          const originalAllowance = Number(pos.allowance) || 0;
          const adjustedAllowance = idx === 0 ? originalAllowance : Math.round(originalAllowance / 2);
          rows.push({
            ...emp,
            rowKey: `${getEmpId(emp)}_pos_${idx}`,
            debugJabatan: pos.name,
            debugSatker: pos.satker || emp.employment_profile?.department_unit || '-',
            debugTunjangan: adjustedAllowance,
            debugTunjanganLabel: idx === 0 ? formatIDR(originalAllowance) : `${formatIDR(adjustedAllowance)} (50% dari ${formatIDR(originalAllowance)})`
          });
        });
      } else {
        rows.push({
          ...emp,
          rowKey: `${getEmpId(emp)}_default`,
          debugJabatan: emp.employment_profile?.job_role || '-',
          debugSatker: emp.employment_profile?.department_unit || '-',
          debugTunjangan: 0,
          debugTunjanganLabel: 'Rp 0'
        });
      }
    } else {
      rows.push({
        ...emp,
        rowKey: `${getEmpId(emp)}_default`,
        debugJabatan: emp.employment?.jobCategory || '-',
        debugSatker: emp.employment?.jobCategory || '-',
        debugTunjangan: 0,
        debugTunjanganLabel: 'Rp 0'
      });
    }
  });
  return rows;
};

const formatIDR = (val: number) => {
  return `Rp ${val.toLocaleString('id-ID')}`;
};

interface FieldChange {
  field: string;
  oldValue: any;
  newValue: any;
}

interface PendingEdit {
  employeeId: string;
  name: string;
  tab: string;
  timestamp: string;
  changes: FieldChange[];
}

function getObjectDiff(oldObj: any, newObj: any, prefix = ''): FieldChange[] {
  const diffs: FieldChange[] = [];
  
  const getValueString = (val: any): any => {
    if (val && typeof val.toDate === 'function') {
      return val.toDate().toISOString().split('T')[0];
    }
    if (val && typeof val === 'object' && val.seconds !== undefined) {
      return new Date(val.seconds * 1000).toISOString().split('T')[0];
    }
    return val;
  };

  const keys = new Set([...Object.keys(oldObj || {}), ...Object.keys(newObj || {})]);
  
  keys.forEach(key => {
    if (key === 'audit' || key === 'id' || key === 'updatedAt' || key === 'createdAt') return;

    const oldVal = oldObj ? oldObj[key] : undefined;
    const newVal = newObj ? newObj[key] : undefined;

    const resolvedOld = getValueString(oldVal);
    const resolvedNew = getValueString(newVal);

    if (resolvedOld === resolvedNew) return;

    // If both are objects (and not null/timestamps), recurse
    if (
      resolvedOld && resolvedNew &&
      typeof resolvedOld === 'object' && typeof resolvedNew === 'object' &&
      !(oldVal && typeof oldVal.toDate === 'function') &&
      !(newVal && typeof newVal.toDate === 'function') &&
      !(oldVal && oldVal.seconds !== undefined) &&
      !(newVal && newVal.seconds !== undefined)
    ) {
      diffs.push(...getObjectDiff(oldVal, newVal, prefix ? `${prefix}.${key}` : key));
    } else {
      diffs.push({
        field: prefix ? `${prefix}.${key}` : key,
        oldValue: resolvedOld === undefined ? null : resolvedOld,
        newValue: resolvedNew === undefined ? null : resolvedNew,
      });
    }
  });

  return diffs;
}

function getLocalISOString(): string {
  const date = new Date();
  const tzo = -date.getTimezoneOffset();
  const dif = tzo >= 0 ? '+' : '-';
  const pad = (num: number) => String(Math.floor(Math.abs(num))).padStart(2, '0');
  
  const year = date.getFullYear();
  const month = pad(date.getMonth() + 1);
  const day = pad(date.getDate());
  const hours = pad(date.getHours());
  const minutes = pad(date.getMinutes());
  const seconds = pad(date.getSeconds());
  const ms = String(date.getMilliseconds()).padStart(3, '0');
  
  const offsetHours = pad(tzo / 60);
  const offsetMinutes = pad(tzo % 60);
  
  return `${year}-${month}-${day}T${hours}:${minutes}:${seconds}.${ms}${dif}${offsetHours}:${offsetMinutes}`;
}

export default function EmployeesPage() {
  const router = useRouter();
  const { user, profile, loading: authLoading, logout } = useAuth();

  const [activeTab, setActiveTab] = useState('blue');
  const [tableViewMode, setTableViewMode] = useState<'default' | 'debug'>('default');
  const [employees, setEmployees] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [editingEmployee, setEditingEmployee] = useState<any | null>(null);
  const [saving, setSaving] = useState(false);
  const isSavingRef = useRef(false);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  // Edit Log States
  const [pendingEdits, setPendingEdits] = useState<PendingEdit[]>([]);
  const [isLogOpen, setIsLogOpen] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [eduLevels, setEduLevels] = useState<string[]>([]);

  // Loyalis Structural Position form states
  const [newPosName, setNewPosName] = useState('');
  const [newPosAllowance, setNewPosAllowance] = useState<number | ''>('');
  const [newPosSatker, setNewPosSatker] = useState('');
  const [dbPositions, setDbPositions] = useState<{ id: string; name: string; satker: string; allowance: number }[]>([]);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const suggestionRef = useRef<HTMLDivElement>(null);
  const [departments, setDepartments] = useState<string[]>([]);
  const [isCustomDept, setIsCustomDept] = useState(false);
  const [customDeptValue, setCustomDeptValue] = useState('');

  // Redirect if unauthorized
  useEffect(() => {
    if (!authLoading && (!user || (profile?.role !== 'super_admin' && profile?.role !== 'employee_admin'))) {
      router.replace('/login');
    }
  }, [user, profile, authLoading, router]);

  // Load pending edits on mount
  useEffect(() => {
    const saved = localStorage.getItem('pending_employee_edits');
    if (saved) {
      try {
        setPendingEdits(JSON.parse(saved));
      } catch (e) {
        console.error('Failed to parse pending edits:', e);
      }
    }
  }, []);

  // Load unique education levels from functional salary matrix and fetch JabatanStruktural positions
  useEffect(() => {
    const fetchEduLevels = async () => {
      try {
        const funcConfigRef = doc(db, 'SalaryMatrix_Functional', '_config');
        const funcConfigSnap = await getDoc(funcConfigRef);
        let funcVersion = '2026_v1';
        if (funcConfigSnap.exists() && funcConfigSnap.data().activeVersion) {
          funcVersion = funcConfigSnap.data().activeVersion;
        }
        const funcRowsSnapshot = await getDocs(collection(db, 'SalaryMatrix_Functional', funcVersion, 'rows'));
        const levels = funcRowsSnapshot.docs.map(docSnap => docSnap.data().education_level as string).filter(Boolean);
        setEduLevels(Array.from(new Set(levels)).sort());
      } catch (err) {
        console.error('Error fetching education levels:', err);
      }
    };

    const fetchDbPositions = async () => {
      try {
        const snap = await getDocs(collection(db, 'JabatanStruktural'));
        const list = snap.docs.map(docSnap => ({
          id: docSnap.id,
          name: docSnap.data().name as string,
          satker: docSnap.data().satker as string,
          allowance: Number(docSnap.data().allowance) || 0
        }));
        list.sort((a, b) => a.name.localeCompare(b.name));
        setDbPositions(list);
      } catch (err) {
        console.error('Error fetching JabatanStruktural:', err);
      }
    };

    const fetchDepartments = async () => {
      try {
        const deptDoc = await getDoc(doc(db, 'Settings', 'departments'));
        if (deptDoc.exists() && deptDoc.data().list) {
          setDepartments(deptDoc.data().list);
        } else {
          const defaultList = [
            'FAK. AGAMA ISLAM',
            'FAK. BISNIS, BAHASA DAN PENDIDIKAN',
            'FAK. ILMU KESEHATAN',
            'FAK. SAINS DAN TEKNOLOGI',
            'PASCASARJANA',
            'REKTORAT',
            'UPT & LEMBAGA'
          ];
          setDepartments(defaultList);
          try {
            await setDoc(doc(db, 'Settings', 'departments'), { list: defaultList });
          } catch (e) {
            console.error('Failed to initialize departments in Firestore:', e);
          }
        }
      } catch (err) {
        console.error('Error fetching departments:', err);
      }
    };

    fetchEduLevels();
    fetchDbPositions();
    fetchDepartments();
  }, []);

  // Handle click outside of structural position suggestions
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (suggestionRef.current && !suggestionRef.current.contains(event.target as Node)) {
        setShowSuggestions(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, []);

  const currentTab = COLLAR_TABS.find(t => t.key === activeTab)!;

  const resetForm = (tab: string): any => {
    if (tab === 'loyalis') {
      return {
        personal_info: { name: '', employee_id_niy: '', tax_id_npwp: '', status: 'AKTIF', phone: '', email: '' },
        banking_info: { bank_name: 'BSI', account_number: '' },
        employment_profile: { job_role: '', department_unit: '', date_of_hire: '', date_recognized: '', date_exit: '', structural_positions: [] },
        academic_and_tier: { education_level: '', education_code: '', functional_tier: '', level_code: '', base_salary_tier: '' },
        family_allowance_metrics: { spouse_count: 0, children_sd: 0, children_sltp: 0, children_slta: 0, children_pt: 0 },
        ziz: { deductionAmount: 0 },
        savings: { deductionAmount: 0 },
        pinlu: { deductionAmount: 0 },
        tht: { deductionAmount: 0 },
      };
    }
    return {
      name: '',
      nik: '',
      phoneNumber: '',
      email: '',
      collarType: 'blue_collar',
      employment: { status: 'active', jobCategory: 'OTHER', startDate: '', endDate: null },
      salaryProfile: { salaryGradeCode: '', baseSalaryAmount: 0, salaryMatrixVersion: '2026_v1', tunjanganBeras: 0 },
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
    setIsCustomDept(false);
    setCustomDeptValue('');
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
    setIsCustomDept(false);
    setCustomDeptValue('');
    
    // For Loyalis, make sure structural_positions is initialized as array
    if (activeTab === 'loyalis') {
      setFormData({
        ...emp,
        employment_profile: {
          structural_positions: [],
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
    if (isSavingRef.current) return;
    try {
      isSavingRef.current = true;
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
            phone: formData.personal_info?.phone || '',
            email: formData.personal_info?.email || '',
          },
          banking_info: {
            bank_name: formData.banking_info?.bank_name || null,
            account_number: formData.banking_info?.account_number || null,
          },
          employment_profile: {
            job_role: formData.employment_profile?.job_role || null,
            department_unit: isCustomDept ? customDeptValue.trim().toUpperCase() : (formData.employment_profile?.department_unit || null),
            date_of_hire: toTimestamp(formData.employment_profile?.date_of_hire || ''),
            date_recognized: toTimestamp(formData.employment_profile?.date_recognized || ''),
            date_exit: toTimestamp(formData.employment_profile?.date_exit || ''),
            structural_positions: formData.employment_profile?.structural_positions || [],
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
          ziz: {
            deductionAmount: Number(formData.ziz?.deductionAmount) || 0,
          },
          savings: {
            deductionAmount: Number(formData.savings?.deductionAmount) || 0,
          },
          pinlu: {
            deductionAmount: Number(formData.pinlu?.deductionAmount) || 0,
          },
          tht: {
            deductionAmount: Number(formData.tht?.deductionAmount) || 0,
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

      if (editingEmployee) {
        const diffs = getObjectDiff(editingEmployee, final);
        if (diffs.length > 0) {
          const pendingChange: PendingEdit = {
            employeeId,
            name: getEmpName(editingEmployee),
            tab: activeTab,
            timestamp: getLocalISOString(),
            changes: diffs
          };
          setPendingEdits(prev => {
            const updated = [...prev, pendingChange];
            localStorage.setItem('pending_employee_edits', JSON.stringify(updated));
            return updated;
          });
        }
      }

      await setDoc(doc(db, currentTab.collection, employeeId), final, { merge: true });

      if (activeTab === 'loyalis' && isCustomDept && customDeptValue.trim()) {
        const newDept = customDeptValue.trim().toUpperCase();
        if (!departments.includes(newDept)) {
          const updatedList = [...departments, newDept].sort();
          setDepartments(updatedList);
          try {
            await setDoc(doc(db, 'Settings', 'departments'), { list: updatedList });
          } catch (e) {
            console.error('Failed to update Settings/departments:', e);
          }
        }
      }

      setMessage({ type: 'success', text: `Karyawan ${editingEmployee ? 'diperbarui' : 'ditambahkan'}!` });
      setIsDialogOpen(false);
      fetchEmployees();
      setTimeout(() => setMessage(null), 3000);
    } catch (err) {
      console.error('Error saving employee:', err);
      setMessage({ type: 'error', text: 'Gagal menyimpan data.' });
    } finally {
      isSavingRef.current = false;
      setSaving(false);
    }
  };

  const handleDelete = async (employeeId: string) => {
    if (isSavingRef.current) return;
    if (!confirm('Hapus data karyawan ini?')) return;
    try {
      isSavingRef.current = true;
      setLoading(true);
      await deleteDoc(doc(db, currentTab.collection, employeeId));
      fetchEmployees();
      setMessage({ type: 'success', text: 'Karyawan dihapus.' });
      setTimeout(() => setMessage(null), 3000);
    } catch (err) {
      console.error('Error deleting employee:', err);
      setMessage({ type: 'error', text: 'Gagal menghapus data.' });
    } finally {
      isSavingRef.current = false;
      setLoading(false);
    }
  };

  const handleConfirmChanges = async () => {
    if (pendingEdits.length === 0 || isSavingRef.current) return;
    try {
      isSavingRef.current = true;
      setConfirming(true);
      const logPayload = {
        operatorEmail: user?.email || 'Unknown Operator',
        operatorName: profile?.displayName || user?.displayName || 'Administrator',
        timestamp: serverTimestamp(),
        createdAt: getLocalISOString(),
        editsCount: pendingEdits.length,
        edits: pendingEdits
      };

      await addDoc(collection(db, 'EmpEditLog'), logPayload);
      
      setPendingEdits([]);
      localStorage.removeItem('pending_employee_edits');
      setIsLogOpen(false);
      setMessage({ type: 'success', text: 'Perubahan berhasil dikonfirmasi & dicatat ke EmpEditLog!' });
      setTimeout(() => setMessage(null), 4000);
    } catch (err) {
      console.error('Error writing edit log:', err);
      setMessage({ type: 'error', text: 'Gagal menulis log ke EmpEditLog.' });
      setTimeout(() => setMessage(null), 3000);
    } finally {
      isSavingRef.current = false;
      setConfirming(false);
    }
  };

  const handleClearChanges = () => {
    if (!confirm('Hapus seluruh daftar perubahan tanpa menyimpannya ke EmpEditLog?')) return;
    setPendingEdits([]);
    localStorage.removeItem('pending_employee_edits');
    setIsLogOpen(false);
    setMessage({ type: 'success', text: 'Daftar perubahan berhasil dibersihkan.' });
    setTimeout(() => setMessage(null), 3000);
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

  const handleExportExcel = () => {
    if (filtered.length === 0) {
      alert('Tidak ada data pegawai yang dapat diexport.');
      return;
    }

    let exportData: any[] = [];

    if (activeTab === 'loyalis') {
      exportData = filtered.map(emp => {
        const metrics = emp.family_allowance_metrics || {};
        return {
          'ID Pegawai': getEmpId(emp),
          'Nama Lengkap': getEmpName(emp),
          'NIY': getEmpNikOrNiy(emp),
          'NPWP': emp.personal_info?.tax_id_npwp || '',
          'Status': getEmpIsActive(emp) ? 'Aktif' : 'Non-Aktif',
          'Nomor Telepon': emp.personal_info?.phone || '',
          'Email': emp.personal_info?.email || '',
          'Jabatan': getEmpCategory(emp),
          'Departemen/Unit': emp.employment_profile?.department_unit || '',
          'Golongan / Level': getEmpGrade(emp),
          'Mulai Kerja': getEmpStartDate(emp),
          'Tgl Diakui': emp.employment_profile?.date_recognized || '',
          'Nama Bank': emp.banking_info?.bank_name || '',
          'Nomor Rekening': emp.banking_info?.account_number || '',
          'Pendidikan': emp.academic_and_tier?.education_level || '',
          'Pendidikan (Kode)': emp.academic_and_tier?.education_code || '',
          'Jabatan Fungsional': emp.academic_and_tier?.functional_tier || '',
          'Gaji Pokok Tier': emp.academic_and_tier?.base_salary_tier || '',
          'Jumlah Suami/Istri': Number(metrics.spouse_count) || 0,
          'Anak SD': Number(metrics.children_sd) || 0,
          'Anak SLTP': Number(metrics.children_sltp) || 0,
          'Anak SLTA': Number(metrics.children_slta) || 0,
          'Anak Perguruan Tinggi': Number(metrics.children_pt) || 0,
        };
      });
    } else {
      exportData = filtered.map(emp => {
        return {
          'ID Pegawai': getEmpId(emp),
          'Nama Lengkap': getEmpName(emp),
          'NIK': getEmpNikOrNiy(emp),
          'Status': getEmpIsActive(emp) ? 'Aktif' : 'Non-Aktif',
          'Nomor Telepon': emp.phoneNumber || '',
          'Email': emp.email || '',
          'Kategori': getEmpCategory(emp),
          'Golongan': getEmpGrade(emp),
          'Mulai Kerja': getEmpStartDate(emp),
          'Nama Bank': emp.bankAccount?.bankName || '',
          'Nomor Rekening': emp.bankAccount?.accountNumber || '',
          'Atas Nama Rekening': emp.bankAccount?.accountHolderName || '',
        };
      });
    }

    const worksheet = XLSX.utils.json_to_sheet(exportData);
    const workbook = XLSX.utils.book_new();
    const sheetName = activeTab === 'loyalis' ? 'Loyalis' : 'Pekarya';
    XLSX.utils.book_append_sheet(workbook, worksheet, sheetName);
    
    // Auto-fit column widths for premium, beautiful spreadsheet presentation!
    const colWidths = Object.keys(exportData[0] || {}).map(key => {
      const maxLength = Math.max(
        key.toString().length,
        ...exportData.map(row => (row[key] !== null && row[key] !== undefined ? row[key].toString().length : 0))
      );
      return { wch: maxLength + 3 };
    });
    worksheet['!cols'] = colWidths;

    const fileLabel = activeTab === 'loyalis' ? 'White_Collar_Loyalis' : 'Blue_Collar';
    XLSX.writeFile(workbook, `Master_Pegawai_YAPETIDU_${fileLabel}_${new Date().toISOString().split('T')[0]}.xlsx`);
  };

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
            {profile?.role === 'super_admin' && (
              <Link href="/dashboard/payroll">
                <Button variant="ghost" size="icon" className="rounded-full bg-white shadow-sm border border-slate-200 hover:bg-slate-50">
                  <ArrowLeft className="w-5 h-5 text-slate-600" />
                </Button>
              </Link>
            )}
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
            <Button onClick={handleExportExcel} variant="outline" className="rounded-xl border-slate-200 bg-white hover:bg-slate-50 text-slate-700 shadow-sm px-4 cursor-pointer">
              <FileSpreadsheet className="w-4 h-4 mr-2 text-emerald-600" /> Export Excel
            </Button>
            <Link href="/dashboard/payroll/master">
              <Button variant="outline" className="rounded-xl border-slate-200 bg-white hover:bg-slate-50 text-slate-700 shadow-sm px-4 cursor-pointer">
                <FileText className="w-4 h-4 mr-2 text-indigo-600" /> Master Gaji Pokok
              </Button>
            </Link>
            <Button onClick={handleOpenAdd} className="rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white shadow-md shadow-indigo-200 px-6 cursor-pointer">
              <UserPlus className="w-4 h-4 mr-2" /> Tambah Pegawai
            </Button>
            {profile?.role === 'employee_admin' && (
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

        {/* Collar type tabs and Search Box */}
        <div className="flex items-center gap-4 mb-6">
          <div className="flex gap-2 shrink-0">
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

          <div className="relative flex-1">
            <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <Input
              placeholder="Cari nama, NIK..."
              className="pl-10 w-full bg-white border-slate-200 rounded-xl shadow-sm"
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
            />
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

        {/* Table View Mode Toggle */}
        <div className="flex items-center justify-between mb-4 bg-slate-50/50 p-2 rounded-2xl border border-slate-100">
          <div className="flex items-center gap-2 pl-2">
            <span className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Mode Tampilan Tabel</span>
          </div>
          <div className="flex bg-white p-1 rounded-xl shadow-sm border border-slate-100 gap-1">
            <button
              onClick={() => setTableViewMode('default')}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold flex items-center gap-1.5 transition-all cursor-pointer ${
                tableViewMode === 'default'
                  ? 'bg-slate-900 text-white shadow-sm'
                  : 'text-slate-600 hover:bg-slate-50'
              }`}
            >
              <LayoutGrid className="w-3.5 h-3.5" />
              Tampilan Default
            </button>
            <button
              onClick={() => setTableViewMode('debug')}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold flex items-center gap-1.5 transition-all cursor-pointer ${
                tableViewMode === 'debug'
                  ? 'bg-indigo-600 text-white shadow-sm'
                  : 'text-slate-600 hover:bg-slate-50'
              }`}
            >
              <Building2 className="w-3.5 h-3.5" />
              Debug Jabatan
            </button>
          </div>
        </div>

        {/* Table */}
        <Card className="bg-white rounded-[24px] shadow-[0_8px_40px_-12px_rgba(0,0,0,0.06)] border-none overflow-hidden">
          <div className="overflow-x-auto">
            <Table>
              <TableHeader className="bg-slate-50/50">
                {tableViewMode === 'default' ? (
                  <TableRow className="border-slate-100">
                    <TableHead className="w-24 font-semibold text-slate-900 pl-8">ID</TableHead>
                    <TableHead className="font-semibold text-slate-900 w-[320px]">Nama Lengkap</TableHead>
                    <TableHead className="font-semibold text-slate-900 w-[320px]">Kategori</TableHead>
                    <TableHead className="font-semibold text-slate-900">Gol.</TableHead>
                    <TableHead className="font-semibold text-slate-900 text-center">Status</TableHead>
                    <TableHead className="font-semibold text-slate-900">Mulai Kerja</TableHead>
                    <TableHead className="font-semibold text-slate-900 text-right pr-8">Aksi</TableHead>
                  </TableRow>
                ) : (
                  <TableRow className="border-slate-100">
                    <TableHead className="w-24 font-semibold text-slate-900 pl-8">ID</TableHead>
                    <TableHead className="font-semibold text-slate-900 w-[300px]">Nama Lengkap</TableHead>
                    <TableHead className="font-semibold text-slate-900 w-[300px]">Nama Jabatan</TableHead>
                    <TableHead className="font-semibold text-slate-900">SatKer (department_unit)</TableHead>
                    <TableHead className="font-semibold text-slate-900 text-right">Tunjangan Jabatan</TableHead>
                    <TableHead className="font-semibold text-slate-900 text-right pr-8">Aksi</TableHead>
                  </TableRow>
                )}
              </TableHeader>
              <TableBody>
                {loading ? (
                  <TableRow>
                    <TableCell colSpan={tableViewMode === 'default' ? 7 : 6} className="h-64 text-center">
                      <div className="flex flex-col items-center gap-3 text-slate-400">
                        <Loader2 className="w-8 h-8 animate-spin text-indigo-500" />
                        <p>Memuat data pegawai...</p>
                      </div>
                    </TableCell>
                  </TableRow>
                ) : filtered.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={tableViewMode === 'default' ? 7 : 6} className="h-64 text-center">
                      <p className="text-slate-400">Tidak ada pegawai yang ditemukan.</p>
                    </TableCell>
                  </TableRow>
                ) : tableViewMode === 'default' ? (
                  filtered.map(emp => (
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
                  ))
                ) : (
                  getDebugRows(filtered, activeTab).map(empRow => (
                    <TableRow key={empRow.rowKey} className="hover:bg-slate-50/30 transition-colors border-slate-50">
                      <TableCell className="font-bold text-slate-400 pl-8 font-mono text-xs">{getEmpId(empRow)}</TableCell>
                      <TableCell className="w-[320px] max-w-[320px]">
                        <div className="flex flex-col">
                          <span className="font-bold text-slate-900 block truncate" title={getEmpName(empRow)}>{getEmpName(empRow)}</span>
                          <span className="text-xs text-slate-400 font-mono">
                            {activeTab === 'loyalis' ? 'NIY' : 'NIK'}: {getEmpNikOrNiy(empRow) || '-'}
                          </span>
                        </div>
                      </TableCell>
                      <TableCell className="w-[300px] max-w-[300px]">
                        <span className="font-medium text-slate-700 block truncate" title={empRow.debugJabatan}>
                          {empRow.debugJabatan}
                        </span>
                      </TableCell>
                      <TableCell className="text-slate-500 text-sm">
                        {empRow.debugSatker}
                      </TableCell>
                      <TableCell className="text-right font-semibold text-slate-700 text-sm whitespace-nowrap">
                        {empRow.debugTunjanganLabel}
                      </TableCell>
                      <TableCell className="text-right pr-8">
                        <div className="flex justify-end gap-1">
                          <Button variant="ghost" size="icon" onClick={() => handleOpenEdit(empRow)} className="h-8 w-8 text-slate-400 hover:text-indigo-600 rounded-lg">
                            <Pencil className="w-4 h-4" />
                          </Button>
                          <Button variant="ghost" size="icon" onClick={() => handleDelete(getEmpId(empRow))} className="h-8 w-8 text-slate-400 hover:text-red-600 rounded-lg">
                            <Trash2 className="w-4 h-4" />
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))
                )}
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
                  ? `Edit Data Karyawan (${activeTab === 'loyalis' ? 'Loyalis' : 'Pekarya'})`
                  : `Tambah Karyawan ${activeTab === 'loyalis' ? 'Loyalis' : 'Pekarya'}`
                }
              </DialogTitle>
            </DialogHeader>

            <div className="p-8 max-h-[75vh] overflow-y-auto">
              {activeTab === 'loyalis' ? (
                <div className="grid grid-cols-3 gap-6">
                  <div className="space-y-4">
                    <h3 className="text-sm font-bold text-slate-900 uppercase tracking-wider">Identitas</h3>
                    <div className="space-y-2"><Label>Nama</Label><Input value={formData.personal_info?.name || ''} onChange={e => updateNestedField('personal_info', 'name', e.target.value)} className="rounded-xl border-slate-200" /></div>
                    <div className="space-y-2"><Label>NIY</Label><Input value={formData.personal_info?.employee_id_niy || ''} onChange={e => updateNestedField('personal_info', 'employee_id_niy', e.target.value)} className="rounded-xl border-slate-200" /></div>
                    <div className="space-y-2"><Label>NPWP</Label><Input value={formData.personal_info?.tax_id_npwp || ''} onChange={e => updateNestedField('personal_info', 'tax_id_npwp', e.target.value)} className="rounded-xl border-slate-200" /></div>
                    <div className="space-y-2"><Label>Nomor WhatsApp/HP</Label><Input value={formData.personal_info?.phone || ''} onChange={e => updateNestedField('personal_info', 'phone', e.target.value)} className="rounded-xl border-slate-200" placeholder="Contoh: 08123456789" /></div>
                    <div className="space-y-2"><Label>Alamat Email</Label><Input type="email" value={formData.personal_info?.email || ''} onChange={e => updateNestedField('personal_info', 'email', e.target.value)} className="rounded-xl border-slate-200" placeholder="Contoh: nama@domain.com" /></div>
                  </div>
                  <div className="space-y-4">
                    <h3 className="text-sm font-bold text-slate-900 uppercase tracking-wider">Pekerjaan</h3>
                    <div className="space-y-2"><Label>Jabatan</Label><Input placeholder="DOSEN, TENDIK, dll." value={formData.employment_profile?.job_role || ''} onChange={e => updateNestedField('employment_profile', 'job_role', e.target.value)} /></div>
                    <div className="space-y-2">
                      <Label>Departemen / Unit</Label>
                      {!isCustomDept ? (
                        <Select
                          value={formData.employment_profile?.department_unit || ''}
                          onValueChange={(val) => {
                            if (val === '__ADD_NEW__') {
                              setIsCustomDept(true);
                              updateNestedField('employment_profile', 'department_unit', '');
                            } else {
                              updateNestedField('employment_profile', 'department_unit', val);
                            }
                          }}
                        >
                          <SelectTrigger className="rounded-xl border-slate-200 bg-white text-xs h-10 w-full">
                            <SelectValue placeholder="Pilih Departemen / Unit" />
                          </SelectTrigger>
                          <SelectContent className="bg-white rounded-xl border-slate-100 shadow-xl max-h-48 overflow-y-auto z-[9999]">
                            {(() => {
                              const listToUse = departments.length > 0 ? departments : [
                                'FAK. AGAMA ISLAM',
                                'FAK. BISNIS, BAHASA DAN PENDIDIKAN',
                                'FAK. ILMU KESEHATAN',
                                'FAK. SAINS DAN TEKNOLOGI',
                                'PASCASARJANA',
                                'REKTORAT',
                                'UPT & LEMBAGA'
                              ];
                              const currentVal = formData.employment_profile?.department_unit;
                              const options = currentVal && !listToUse.includes(currentVal)
                                ? [...listToUse, currentVal]
                                : listToUse;
                              return (
                                <>
                                  {options.map(dept => (
                                    <SelectItem key={dept} value={dept} className="text-xs">
                                      {dept}
                                    </SelectItem>
                                  ))}
                                  <SelectItem value="__ADD_NEW__" className="text-xs font-semibold text-indigo-600 focus:text-indigo-700">
                                    + Tambah Departemen Baru
                                  </SelectItem>
                                </>
                              );
                            })()}
                          </SelectContent>
                        </Select>
                      ) : (
                        <div className="space-y-2">
                          <div className="flex gap-2">
                            <Input
                              placeholder="Ketik Departemen Baru (misal: REKTORAT)"
                              value={customDeptValue}
                              onChange={(e) => setCustomDeptValue(e.target.value)}
                              className="rounded-xl border-slate-200 text-xs h-10 flex-1 bg-white"
                            />
                            <Button
                              type="button"
                              variant="outline"
                              onClick={() => {
                                setIsCustomDept(false);
                                setCustomDeptValue('');
                                updateNestedField('employment_profile', 'department_unit', '');
                              }}
                              className="rounded-xl border-slate-200 text-xs h-10 px-3 hover:bg-slate-50"
                            >
                              Batal
                            </Button>
                          </div>
                        </div>
                      )}
                    </div>
                    <div className="space-y-2"><Label>Tanggal Mulai Kerja</Label><Input type="date" value={formData.employment_profile?.date_of_hire || ''} onChange={e => updateNestedField('employment_profile', 'date_of_hire', e.target.value)} /></div>
                    <div className="space-y-2"><Label>TMT Golongan (SK)</Label><Input type="date" value={formData.employment_profile?.date_recognized || ''} onChange={e => updateNestedField('employment_profile', 'date_recognized', e.target.value)} /></div>
                  </div>
                  <div className="space-y-4">
                    <h3 className="text-sm font-bold text-slate-900 uppercase tracking-wider">Akademik &amp; Finansial</h3>
                    <div className="grid grid-cols-2 gap-3">
                      <div className="col-span-2 space-y-2">
                        <Label>Pendidikan</Label>
                        <Select
                          value={formData.academic_and_tier?.education_level || ''}
                          onValueChange={(val) => updateNestedField('academic_and_tier', 'education_level', val)}
                        >
                          <SelectTrigger className="rounded-xl border-slate-200 bg-white text-xs h-10 w-full">
                            <SelectValue placeholder="Pilih Pendidikan" />
                          </SelectTrigger>
                          <SelectContent className="bg-white rounded-xl border-slate-100 shadow-xl max-h-48 overflow-y-auto z-[9999]">
                            {(() => {
                              const currentVal = formData.academic_and_tier?.education_level;
                              const options = currentVal && !eduLevels.includes(currentVal)
                                ? [...eduLevels, currentVal]
                                : eduLevels;
                              return options.map(level => (
                                <SelectItem key={level} value={level} className="text-xs">
                                  {level}
                                </SelectItem>
                              ));
                            })()}
                          </SelectContent>
                        </Select>
                      </div>
                      <div className="space-y-2"><Label>Golongan</Label><Input placeholder="Gol. G" value={formData.academic_and_tier?.level_code || ''} onChange={e => updateNestedField('academic_and_tier', 'level_code', e.target.value)} /></div>
                      <div className="space-y-2">
                        <Label>Beban Kerja</Label>
                        <Select
                          value={formData.academic_and_tier?.functional_tier !== undefined && formData.academic_and_tier?.functional_tier !== null && formData.academic_and_tier?.functional_tier !== '' ? String(formData.academic_and_tier.functional_tier) : ''}
                          onValueChange={(val) => updateNestedField('academic_and_tier', 'functional_tier', val ? Number(val) : null)}
                        >
                          <SelectTrigger className="rounded-xl border-slate-200 bg-white text-xs h-10 w-full">
                            <SelectValue placeholder="Pilih Beban Kerja" />
                          </SelectTrigger>
                          <SelectContent className="bg-white rounded-xl border-slate-100 shadow-xl max-h-48 overflow-y-auto z-[9999]">
                            {Array.from({ length: 16 }, (_, idx) => String(idx + 1)).map((tierCode) => (
                              <SelectItem key={tierCode} value={tierCode} className="text-xs">
                                Beban {tierCode}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                    </div>
                    <div className="space-y-2"><Label>Nama Bank</Label><Input value={formData.banking_info?.bank_name || ''} onChange={e => updateNestedField('banking_info', 'bank_name', e.target.value)} /></div>
                    <div className="space-y-2"><Label>Nomor Rekening</Label><Input value={formData.banking_info?.account_number || ''} onChange={e => updateNestedField('banking_info', 'account_number', e.target.value)} /></div>
                    <div className="grid grid-cols-4 gap-3">
                      <div className="space-y-2">
                        <Label>Potongan Zakat Infaq Sodaqoh (Rp)</Label>
                        <Input 
                          type="number" 
                          value={formData.ziz?.deductionAmount ?? 0} 
                          onChange={e => updateNestedField('ziz', 'deductionAmount', e.target.value !== '' ? Number(e.target.value) : 0)} 
                          className="rounded-xl border-slate-200"
                        />
                      </div>
                      <div className="space-y-2">
                        <Label>Potongan Tabungan (Rp)</Label>
                        <Input 
                          type="number" 
                          value={formData.savings?.deductionAmount ?? 0} 
                          onChange={e => updateNestedField('savings', 'deductionAmount', e.target.value !== '' ? Number(e.target.value) : 0)} 
                          className="rounded-xl border-slate-200"
                        />
                      </div>
                      <div className="space-y-2">
                        <Label>Potongan Pinlu/Tagihan (Rp)</Label>
                        <Input 
                          type="number" 
                          value={formData.pinlu?.deductionAmount ?? 0} 
                          onChange={e => updateNestedField('pinlu', 'deductionAmount', e.target.value !== '' ? Number(e.target.value) : 0)} 
                          className="rounded-xl border-slate-200"
                        />
                      </div>
                      <div className="space-y-2">
                        <Label>Potongan BNI Simponi / THT (Rp)</Label>
                        <Input 
                          type="number" 
                          value={formData.tht?.deductionAmount ?? 0} 
                          onChange={e => updateNestedField('tht', 'deductionAmount', e.target.value !== '' ? Number(e.target.value) : 0)} 
                          className="rounded-xl border-slate-200"
                        />
                      </div>
                    </div>
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

                  <div className="col-span-3 pt-4 border-t border-slate-100 space-y-4">
                    <h3 className="text-sm font-bold text-slate-900 uppercase tracking-wider flex items-center gap-2">
                      <Building2 className="w-4 h-4 text-indigo-500" />
                      Tunjangan Jabatan Struktural Tambahan
                    </h3>
                    
                    {/* Existing positions list */}
                    <div className="space-y-2">
                      {(() => {
                        const positions = formData.employment_profile?.structural_positions || [];
                        const positionsWithIndex = positions.map((pos: any, idx: number) => ({ ...pos, originalIndex: idx }));
                        const sorted = [...positionsWithIndex].sort((a: any, b: any) => (Number(b.allowance) || 0) - (Number(a.allowance) || 0));
                        return sorted.map((pos: any, posIdx: number) => {
                          const originalAllowance = Number(pos.allowance) || 0;
                          const halvedAllowance = posIdx === 0 ? originalAllowance : Math.round(originalAllowance / 2);
                          
                          return (
                            <div key={pos.originalIndex} className="flex items-center gap-3 bg-slate-50 p-3 rounded-xl border border-slate-100">
                              <div className="flex-1 font-semibold text-slate-800 text-xs">
                                {pos.name}
                              </div>
                              <div className="w-36 text-xs text-slate-600">{pos.satker}</div>
                              <div className="w-64 text-right font-bold text-indigo-600 text-xs">
                                {posIdx === 0 ? (
                                  <span>Rp {originalAllowance.toLocaleString('id-ID')}</span>
                                ) : (
                                  <span className="flex flex-col items-end">
                                    <span className="text-[10px] text-slate-400 font-normal line-through">Rp {originalAllowance.toLocaleString('id-ID')}</span>
                                    <span className="flex items-center gap-1.5 mt-0.5">
                                      <span className="text-[10px] text-amber-600 font-medium bg-amber-50 px-1.5 py-0.5 rounded-md border border-amber-100">Dipotong 50%</span>
                                      <span>Rp {halvedAllowance.toLocaleString('id-ID')}</span>
                                    </span>
                                  </span>
                                )}
                              </div>
                              <Button
                                type="button"
                                variant="ghost"
                                size="icon"
                                onClick={() => {
                                  updateNestedField('employment_profile', 'structural_positions', positions.filter((_: any, idx: number) => idx !== pos.originalIndex));
                                }}
                                className="h-8 w-8 text-slate-400 hover:text-red-500 rounded-lg shrink-0"
                              >
                                <Trash2 className="w-4 h-4" />
                              </Button>
                            </div>
                          );
                        });
                      })()}
                      {(formData.employment_profile?.structural_positions || []).length === 0 && (
                        <p className="text-xs text-slate-400 italic">Belum ada tunjangan jabatan struktural tambahan.</p>
                      )}
                    </div>

                    {/* Form to add a new position */}
                    <div className="flex flex-wrap md:flex-nowrap gap-3 items-end bg-slate-50/50 p-4 rounded-[20px] border border-slate-100">
                      <div className="flex-1 space-y-1.5 min-w-[200px] relative" ref={suggestionRef}>
                        <Label className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">Nama Jabatan</Label>
                        <Input
                          placeholder="Contoh: Kaprodi Bahasa Inggris"
                          value={newPosName}
                          onChange={(e) => {
                            setNewPosName(e.target.value);
                            setShowSuggestions(true);
                          }}
                          onFocus={() => setShowSuggestions(true)}
                          onKeyDown={(e) => {
                            if (e.key === 'Escape') {
                              setShowSuggestions(false);
                            }
                          }}
                          className="rounded-xl border-slate-200 text-xs h-9 bg-white"
                        />
                        {showSuggestions && dbPositions.filter(pos => pos.name.toLowerCase().includes(newPosName.toLowerCase())).length > 0 && (
                          <div className="absolute left-0 right-0 top-full mt-1 bg-white border border-slate-200 rounded-xl shadow-lg max-h-60 overflow-y-auto z-[9999]">
                            {dbPositions
                              .filter(pos => pos.name.toLowerCase().includes(newPosName.toLowerCase()))
                              .map((pos) => (
                                <button
                                  key={pos.id}
                                  type="button"
                                  onClick={() => {
                                    setNewPosName(pos.name);
                                    setNewPosSatker(pos.satker);
                                    setNewPosAllowance(pos.allowance);
                                    setShowSuggestions(false);
                                  }}
                                  className="w-full text-left px-3 py-2.5 text-xs hover:bg-indigo-50/50 hover:text-indigo-600 border-b border-slate-50 last:border-0 flex justify-between items-center transition-colors"
                                >
                                  <span className="font-semibold text-slate-700">{pos.name}</span>
                                  <span className="text-[10px] text-slate-400 bg-slate-100 px-1.5 py-0.5 rounded border border-slate-200 ml-2 shrink-0">
                                    {pos.satker}
                                  </span>
                                </button>
                              ))}
                          </div>
                        )}
                      </div>
                      <div className="w-44 space-y-1.5">
                        <Label className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">Satuan Kerja (Satker)</Label>
                        <Select
                          value={newPosSatker}
                          onValueChange={(val) => setNewPosSatker(val || '')}
                        >
                          <SelectTrigger className="rounded-xl border-slate-200 bg-white text-xs h-9 w-full">
                            <SelectValue placeholder="Pilih Satker" />
                          </SelectTrigger>
                          <SelectContent className="bg-white rounded-xl border-slate-100 shadow-xl max-h-48 overflow-y-auto z-[9999]">
                            {(() => {
                              const listToUse = departments.length > 0 ? departments : [
                                'FAK. AGAMA ISLAM',
                                'FAK. BISNIS, BAHASA DAN PENDIDIKAN',
                                'FAK. ILMU KESEHATAN',
                                'FAK. SAINS DAN TEKNOLOGI',
                                'PASCASARJANA',
                                'REKTORAT',
                                'UPT & LEMBAGA'
                              ];
                              return listToUse.map(dept => (
                                <SelectItem key={dept} value={dept} className="text-xs">
                                  {dept}
                                </SelectItem>
                              ));
                            })()}
                          </SelectContent>
                        </Select>
                      </div>
                      <div className="w-36 space-y-1.5">
                        <Label className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">Tunjangan (Rp)</Label>
                        <Input
                          type="number"
                          placeholder="0"
                          value={newPosAllowance}
                          onChange={(e) => setNewPosAllowance(e.target.value !== '' ? Number(e.target.value) : '')}
                          className="rounded-xl border-slate-200 text-xs h-9 bg-white text-right font-mono"
                        />
                      </div>
                      <Button
                        type="button"
                        onClick={() => {
                          if (!newPosName.trim()) return;
                          const current = formData.employment_profile?.structural_positions || [];
                          updateNestedField('employment_profile', 'structural_positions', [
                            ...current,
                            {
                              name: newPosName.trim(),
                              allowance: Number(newPosAllowance) || 0,
                              satker: newPosSatker.trim()
                            }
                          ]);
                          setNewPosName('');
                          setNewPosAllowance('');
                          setNewPosSatker('');
                        }}
                        className="bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl text-xs font-bold h-9 px-4 cursor-pointer shrink-0"
                      >
                        <Plus className="w-4 h-4 mr-1.5" /> Tambah
                      </Button>
                    </div>
                  </div>
                </div>
              ) : (
                <div className="grid grid-cols-3 gap-6">
                  <div className="col-span-3 grid grid-cols-4 gap-4">
                    <div className="space-y-2"><Label htmlFor="name">Nama Lengkap</Label><Input id="name" required value={formData.name || ''} onChange={e => setFormData({ ...formData, name: e.target.value })} className="rounded-xl border-slate-200" /></div>
                    <div className="space-y-2"><Label htmlFor="nik">NIK (Nomor Induk Kependudukan)</Label><Input id="nik" value={formData.nik || ''} onChange={e => setFormData({ ...formData, nik: e.target.value })} className="rounded-xl border-slate-200" /></div>
                    <div className="space-y-2"><Label htmlFor="phoneNumber">Nomor WhatsApp/HP</Label><Input id="phoneNumber" value={formData.phoneNumber || ''} onChange={e => setFormData({ ...formData, phoneNumber: e.target.value })} className="rounded-xl border-slate-200" placeholder="Contoh: 08123456789" /></div>
                    <div className="space-y-2"><Label htmlFor="email">Alamat Email</Label><Input id="email" type="email" value={formData.email || ''} onChange={e => setFormData({ ...formData, email: e.target.value })} className="rounded-xl border-slate-200" placeholder="Contoh: nama@domain.com" /></div>
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
                    <div className="space-y-2"><Label>BPJS Pekarya (Rp)</Label><Input type="number" value={formData.bpjs?.allowanceAmount ?? 0} onChange={e => setFormData((prev: any) => ({ ...prev, bpjs: { ...(prev.bpjs || {}), allowanceAmount: e.target.value !== '' ? Number(e.target.value) : 0 } }))} className="rounded-xl border-slate-200" /></div>
                    <div className="space-y-2"><Label>T. Beras (Rp)</Label><Input type="number" value={formData.salaryProfile?.tunjanganBeras ?? 0} onChange={e => setFormData((prev: any) => ({ ...prev, salaryProfile: { ...(prev.salaryProfile || {}), tunjanganBeras: e.target.value !== '' ? Number(e.target.value) : 0 } }))} className="rounded-xl border-slate-200" /></div>
                    <div className="space-y-2"><Label>Potongan BPJS (Rp)</Label><Input type="number" value={formData.bpjs?.deductionAmount ?? 0} onChange={e => setFormData((prev: any) => ({ ...prev, bpjs: { ...(prev.bpjs || {}), deductionAmount: e.target.value !== '' ? Number(e.target.value) : 0 } }))} className="rounded-xl border-slate-200" /></div>
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

      {/* Sticky floating change log banner */}
      {pendingEdits.length > 0 && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-40 bg-slate-900/95 text-white backdrop-blur-md rounded-2xl shadow-2xl border border-slate-800 px-6 py-4.5 flex items-center justify-between gap-8 max-w-xl w-[90vw] animate-in slide-in-from-bottom-5 duration-300">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-indigo-500/10 border border-indigo-500/20 text-indigo-400 flex items-center justify-center shrink-0">
              <FileClock className="w-5 h-5" />
            </div>
            <div>
              <p className="text-sm font-bold text-slate-100">Daftar Perubahan Belum Disimpan</p>
              <p className="text-xs text-slate-400 mt-0.5">Terdapat <span className="font-semibold text-indigo-400">{pendingEdits.length}</span> perubahan data pegawai.</p>
            </div>
          </div>
          
          <div className="flex items-center gap-2 shrink-0">
            <Button
              variant="ghost"
              onClick={() => setIsLogOpen(true)}
              className="text-xs font-bold text-slate-300 hover:text-white rounded-xl hover:bg-slate-800"
            >
              Lihat Detail
            </Button>
            <Button
              onClick={handleConfirmChanges}
              disabled={confirming}
              className="bg-indigo-600 hover:bg-indigo-700 text-white font-bold text-xs rounded-xl shadow-lg shadow-indigo-500/10 flex items-center gap-1.5 px-4"
            >
              {confirming ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <ClipboardCheck className="w-3.5 h-3.5" />}
              Konfirmasi
            </Button>
          </div>
        </div>
      )}

      {/* Detailed log viewer dialog */}
      <Dialog open={isLogOpen} onOpenChange={setIsLogOpen}>
        <DialogContent className="sm:max-w-2xl max-w-full rounded-[28px] border-none shadow-2xl p-0 overflow-hidden bg-white">
          <DialogHeader className="p-6 bg-slate-50/50 border-b border-slate-100">
            <DialogTitle className="text-xl font-bold flex items-center gap-2 text-slate-900">
              <History className="w-5.5 h-5.5 text-indigo-500" />
              Detail Perubahan Pegawai
            </DialogTitle>
            <DialogDescription className="text-slate-500">
              Berikut adalah daftar perubahan data pegawai dalam sesi ini yang siap disimpan ke Firebase root collection <strong className="font-semibold text-slate-800">EmpEditLog</strong>.
            </DialogDescription>
          </DialogHeader>

          <div className="p-6 max-h-[50vh] overflow-y-auto space-y-4">
            {pendingEdits.map((edit, idx) => (
              <div key={idx} className="p-4 rounded-xl border border-slate-150 bg-slate-50/30 space-y-3">
                <div className="flex items-center justify-between border-b border-slate-100 pb-2">
                  <div className="flex items-center gap-2">
                    <span className="font-mono text-xs font-bold text-slate-400 bg-slate-100 px-2 py-0.5 rounded">{edit.employeeId}</span>
                    <span className="font-bold text-slate-900 text-sm">{edit.name}</span>
                  </div>
                  <Badge variant="outline" className="text-[10px] font-bold uppercase bg-white px-2 py-0.5 border-slate-200">
                    {edit.tab === 'loyalis' ? 'Loyalis' : 'Pekarya'}
                  </Badge>
                </div>
                
                <div className="space-y-2">
                  {edit.changes.map((c, cIdx) => (
                    <div key={cIdx} className="grid grid-cols-3 gap-2 text-xs items-center leading-normal">
                      <span className="font-semibold text-slate-500 font-mono break-all">{c.field}</span>
                      <div className="col-span-2 flex items-center gap-1.5 flex-wrap">
                        <span className="text-rose-600 bg-rose-50 px-2 py-0.5 rounded line-through max-w-[150px] truncate" title={String(c.oldValue)}>{String(c.oldValue) || 'empty'}</span>
                        <span className="text-slate-400">➔</span>
                        <span className="text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded font-semibold max-w-[150px] truncate" title={String(c.newValue)}>{String(c.newValue) || 'empty'}</span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>

          <DialogFooter className="p-6 bg-slate-50/50 border-t border-slate-100 flex justify-between gap-4 w-full">
            <Button
              type="button"
              variant="ghost"
              onClick={handleClearChanges}
              className="rounded-xl font-bold text-rose-600 hover:text-rose-700 hover:bg-rose-50 flex items-center gap-1.5"
            >
              <Trash2 className="w-4 h-4" />
              Bersihkan Daftar
            </Button>
            
            <div className="flex gap-2">
              <Button type="button" variant="ghost" onClick={() => setIsLogOpen(false)} className="rounded-xl">Tutup</Button>
              <Button
                onClick={handleConfirmChanges}
                disabled={confirming}
                className="rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white font-bold px-6 flex items-center gap-1.5"
              >
                {confirming ? <Loader2 className="w-4 h-4 animate-spin" /> : <ClipboardCheck className="w-4 h-4" />}
                Konfirmasi & Simpan Log
              </Button>
            </div>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
