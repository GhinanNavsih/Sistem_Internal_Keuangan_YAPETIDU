"use client";

import React, { useState, useEffect, useRef } from 'react';
import GlobalHeader from '@/components/GlobalHeader';
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
  SlidersHorizontal,
  Coins,
  ChevronsUpDown,
  ChevronUp,
  ChevronDown,
  Fingerprint,
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
import { useDashboardData } from '@/lib/DashboardDataContext';
import { authenticatedJson, createFinancialRequestId } from '@/lib/payroll/client';
import { normalizeNipy } from '@/lib/payroll/attendance';
import { MONTHS_ID } from '@/utils/rekapConfig';

const JOB_CATEGORIES = ['SATPAM', 'SOPIR', 'KEBERSIHAN', 'TEKNISI', 'KEBERSIHAN_PONTI'];



const JOB_ICONS: Record<string, React.ReactNode> = {
  SATPAM: <ShieldCheck className="w-3.5 h-3.5" />,
  SOPIR: <Truck className="w-3.5 h-3.5" />,
  TEKNISI: <Wrench className="w-3.5 h-3.5" />,
  KEBERSIHAN: <Wind className="w-3.5 h-3.5" />,
  KEBERSIHAN_PONTI: <Wind className="w-3.5 h-3.5" />,
};

const COLLAR_TABS = [
  { key: 'blue', label: 'Pekarya', collection: 'Employees_BlueCollar', prefix: 'BC' },
  { key: 'loyalis', label: 'Loyalis', collection: 'Employees_Loyalis', prefix: 'Loyalis' },
];

type FormData = any;

type PekaryaNipyPreviewItem = {
  employeeId: string;
  name: string;
  category: string;
  categoryGroup: string | null;
  prefixCode: string | null;
  startDate: string | null;
  sequence: number | null;
  proposedNipy: string | null;
  currentNipy: string | null;
  state: 'ready' | 'reserved' | 'existing' | 'blocked' | 'conflict';
  needsWrite: boolean;
  reasonCode: string | null;
  reason: string | null;
};

type PekaryaNipyPreview = {
  initialized: boolean;
  items: PekaryaNipyPreviewItem[];
  counters: Record<string, number>;
  summary: {
    active: number;
    ready: number;
    reserved: number;
    existing: number;
    blocked: number;
    conflicts: number;
    pendingWrites: number;
  };
  previewHash: string;
};

// Helper getters to unify rendering between blue collar and Loyalis white collar records
const getEmpId = (emp: any) => emp.employeeId || emp.id || '';
const getEmpName = (emp: any) => emp.personal_info?.name || emp.name || '';
const getEmpNikOrNiy = (emp: any) => emp.personal_info?.employee_id_niy || emp.nik || '';
const getEmpNipy = (emp: any) =>
  normalizeNipy(emp.nipy || emp.personal_info?.employee_id_niy || '');
const getEmpCategory = (emp: any) => emp.employment_profile?.job_role || emp.employment?.jobCategory || '';
const getPekaryaNipyGroup = (category: unknown) => {
  const normalized = String(category || '').trim().toUpperCase();
  if (normalized.startsWith('KEBERSIHAN')) return 'KEBERSIHAN';
  if (['SOPIR', 'SATPAM', 'TEKNISI'].includes(normalized)) return normalized;
  return '';
};
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

const getEmpRecognizedDate = (emp: any) => {
  if (emp.employment_profile?.date_recognized) {
    const d = emp.employment_profile.date_recognized;
    if (d && typeof d.toDate === 'function') {
      return d.toDate().toISOString().split('T')[0];
    }
    return d;
  }
  return '';
};

const getEmpMasaKerja = (emp: any): string => {
  const tmtVal = emp.employment_profile?.date_recognized;
  if (!tmtVal) return '-';

  let tmtDate: Date;
  if (typeof tmtVal.toDate === 'function') {
    tmtDate = tmtVal.toDate();
  } else {
    tmtDate = new Date(tmtVal);
  }

  if (isNaN(tmtDate.getTime())) return '-';

  const now = new Date();
  const nextMonth5th = new Date(now.getFullYear(), now.getMonth() + 1, 5);
  let years = nextMonth5th.getFullYear() - tmtDate.getFullYear();
  let months = nextMonth5th.getMonth() - tmtDate.getMonth();
  let days = nextMonth5th.getDate() - tmtDate.getDate();

  if (days < 0) {
    months -= 1;
    const prevMonth = new Date(nextMonth5th.getFullYear(), nextMonth5th.getMonth(), 0);
    days += prevMonth.getDate();
  }

  if (months < 0) {
    years -= 1;
    months += 12;
  }

  if (years < 0) {
    return '0 Bulan';
  }

  const parts = [];
  if (years > 0) {
    parts.push(`${years} Tahun`);
  }
  if (months > 0) {
    parts.push(`${months} Bulan`);
  }
  if (parts.length === 0) {
    return '0 Bulan';
  }
  return parts.join(' ');
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

function SortIcon({ active, direction }: { active: boolean; direction: 'asc' | 'desc' | null }) {
  if (!active || !direction) return <ChevronsUpDown className="w-3 h-3 text-slate-300 ml-1.5 inline-block shrink-0" />;
  return direction === 'asc' ? <ChevronUp className="w-3 h-3 text-indigo-500 ml-1.5 inline-block shrink-0" /> : <ChevronDown className="w-3 h-3 text-indigo-500 ml-1.5 inline-block shrink-0" />;
}

const formatNumberWithDots = (num: number): string => {
  if (num === 0) return '';
  return new Intl.NumberFormat('id-ID').format(num);
};

const parseDotsToNumber = (val: string): number => {
  const clean = val.replace(/\./g, '').replace(/[^0-9]/g, '');
  return Number(clean) || 0;
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

interface PropagationResult {
  period: string;
  outcome:
    | 'updated'
    | 'unchanged'
    | 'no_slip'
    | 'period_closed'
    | 'blocked_status'
    | 'immutable';
}

function formatPeriodLabel(period: string): string {
  const [year, month] = period.split('-').map(Number);
  return `${MONTHS_ID[month - 1]} ${year}`;
}

/**
 * Says what happened to each open period's slip. Skipped periods are named
 * explicitly — a silently stale verified slip is exactly the failure this
 * feature exists to prevent.
 */
function describePropagation(results: PropagationResult[]): string {
  const updated = results.filter(r => r.outcome === 'updated').map(r => formatPeriodLabel(r.period));
  const blocked = results
    .filter(r => r.outcome === 'blocked_status' || r.outcome === 'immutable')
    .map(r => formatPeriodLabel(r.period));

  const sentences: string[] = [];
  if (updated.length > 0) {
    sentences.push(`Slip ${updated.join(' & ')} ikut diperbarui.`);
  }
  if (blocked.length > 0) {
    sentences.push(
      `Slip ${blocked.join(' & ')} sudah diverifikasi/dikunci sehingga tidak diubah — perubahan ditandai untuk ditinjau Badan Keuangan.`,
    );
  }
  return sentences.length > 0 ? ` ${sentences.join(' ')}` : '';
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
  const { employeesLoyalis, employeesBlueCollar, gradeCodesBlue, gradeCodesWhite, loading: contextLoading, refreshData, kepangkatanAllowanceMap } = useDashboardData();

  const [activeTab, setActiveTab] = useState('loyalis');
  const [tableViewMode, setTableViewMode] = useState<'default' | 'debug' | 'constant'>('default');
  const [employees, setEmployees] = useState<any[]>([]);
  const [localLoading, setLocalLoading] = useState(false);
  const loading = contextLoading || localLoading;
  const [searchQuery, setSearchQuery] = useState('');
  const [sortConfig, setSortConfig] = useState<{ key: string; direction: 'asc' | 'desc' | null }>({ key: '', direction: null });

  const handleSort = (key: string) => {
    let direction: 'asc' | 'desc' | null = 'asc';
    if (sortConfig.key === key && sortConfig.direction === 'asc') {
      direction = 'desc';
    } else if (sortConfig.key === key && sortConfig.direction === 'desc') {
      direction = null;
    }
    setSortConfig({ key, direction });
  };

  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [editingEmployee, setEditingEmployee] = useState<any | null>(null);
  const [saving, setSaving] = useState(false);
  const isSavingRef = useRef(false);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [isNipyDialogOpen, setIsNipyDialogOpen] = useState(false);
  const [nipyPreview, setNipyPreview] = useState<PekaryaNipyPreview | null>(null);
  const [nipyLoading, setNipyLoading] = useState(false);
  const [nipyApplying, setNipyApplying] = useState(false);
  const [nipyCorrectionEmployee, setNipyCorrectionEmployee] = useState<any | null>(null);
  const [nipyCorrectionReason, setNipyCorrectionReason] = useState('');
  const [nipyCorrecting, setNipyCorrecting] = useState(false);

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
  const canEditNipy = profile?.role === 'super_admin' || profile?.role === 'employee_admin';

  const resetForm = (tab: string): any => {
    if (tab === 'loyalis') {
      return {
        nipy: '',
        personal_info: { name: '', employee_id_niy: '', nik: '', tax_id_npwp: '', status: 'AKTIF', phone: '', email: '' },
        banking_info: { bank_name: 'BSI', account_number: '' },
        employment_profile: { job_role: '', department_unit: '', date_of_hire: '', date_recognized: '', date_exit: '', structural_positions: [] },
        academic_and_tier: { education_level: '', education_code: '', functional_tier: '', level_code: '', base_salary_tier: '' },
        family_allowance_metrics: { spouse_count: 0, children_sd: 0, children_sltp: 0, children_slta: 0, children_pt: 0 },
        ziz: { deductionAmount: 0 },
        savings: { deductionAmount: 0 },
        pinlu: { deductionAmount: 0 },
        tht: { deductionAmount: 0 },
        bpjs: { t_bpjs_tk: 0, t_bpjs_kes: 0, deductionAmount: 0 },
        salaryProfile: { tunjanganBeras: 0 },
        kepangkatan: { cummulativeCredit: 0 },
        t_instruksional: 0,
      };
    }
    return {
      nipy: '',
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

  const [formData, setFormData] = useState<FormData>(resetForm('loyalis'));

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

  // Sync page employees when context data or active tab changes
  useEffect(() => {
    const list = activeTab === 'loyalis' ? employeesLoyalis : employeesBlueCollar;
    setEmployees([...list].sort((a, b) => getEmpId(a).localeCompare(getEmpId(b))));
  }, [activeTab, employeesLoyalis, employeesBlueCollar]);

  // Automatically sync job_role with the highest paying structural position for Loyalis
  useEffect(() => {
    if (activeTab === 'loyalis' && isDialogOpen) {
      const positions = formData.employment_profile?.structural_positions || [];
      const sorted = [...positions].sort((a: any, b: any) => (Number(b.allowance) || 0) - (Number(a.allowance) || 0));
      const highestPayingName = sorted[0]?.name || '';

      if (formData.employment_profile?.job_role !== highestPayingName) {
        setFormData((prev: any) => ({
          ...prev,
          employment_profile: {
            ...(prev.employment_profile || {}),
            job_role: highestPayingName
          }
        }));
      }
    }
  }, [formData.employment_profile?.structural_positions, activeTab, isDialogOpen, formData.employment_profile?.job_role]);

  const fetchEmployees = async () => {
    try {
      setLocalLoading(true);
      await refreshData();
    } catch (err) {
      console.error('Error refreshing employees:', err);
    } finally {
      setLocalLoading(false);
    }
  };

  const loadNipyPreview = async () => {
    setNipyLoading(true);
    try {
      const preview = await authenticatedJson<PekaryaNipyPreview>(
        '/api/admin/attendance-identities/pekarya',
      );
      setNipyPreview(preview);
      return preview;
    } finally {
      setNipyLoading(false);
    }
  };

  const handleOpenNipyGenerator = async () => {
    setMessage(null);
    setIsNipyDialogOpen(true);
    setNipyPreview(null);
    try {
      await loadNipyPreview();
    } catch (error) {
      setMessage({
        type: 'error',
        text:
          error instanceof Error
            ? error.message
            : 'Gagal memuat pratinjau NIPY.',
      });
    }
  };

  const handleApplyNipyPreview = async () => {
    if (!nipyPreview || nipyPreview.summary.pendingWrites < 1) return;
    setNipyApplying(true);
    setMessage(null);
    try {
      const result = await authenticatedJson<{
        issued: number;
        reserved: number;
      }>('/api/admin/attendance-identities/pekarya', {
        method: 'POST',
        body: JSON.stringify({
          operation: 'bulk_apply',
          expectedPreviewHash: nipyPreview.previewHash,
          requestId: createFinancialRequestId('pekarya-nipy-bulk'),
        }),
      });
      await Promise.all([loadNipyPreview(), fetchEmployees()]);
      setMessage({
        type: 'success',
        text: `${result.issued} NIPY diterbitkan dan ${result.reserved} nomor urut direservasi.`,
      });
    } catch (error) {
      setMessage({
        type: 'error',
        text:
          error instanceof Error
            ? error.message
            : 'Penerbitan massal NIPY gagal.',
      });
      await loadNipyPreview().catch(() => undefined);
    } finally {
      setNipyApplying(false);
    }
  };

  const handleReissueNipy = async () => {
    if (!nipyCorrectionEmployee) return;
    if (nipyCorrectionReason.trim().length < 8) {
      setMessage({
        type: 'error',
        text: 'Alasan koreksi NIPY minimal 8 karakter.',
      });
      return;
    }
    setNipyCorrecting(true);
    setMessage(null);
    try {
      const result = await authenticatedJson<{ nipy: string }>(
        '/api/admin/attendance-identities/pekarya',
        {
          method: 'PATCH',
          body: JSON.stringify({
            employeeId: getEmpId(nipyCorrectionEmployee),
            expectedNipy: getEmpNipy(nipyCorrectionEmployee),
            reason: nipyCorrectionReason.trim(),
            requestId: createFinancialRequestId('pekarya-nipy-correction'),
          }),
        },
      );
      setMessage({
        type: 'success',
        text: `NIPY dikoreksi menjadi ${result.nipy}.`,
      });
      setNipyCorrectionEmployee(null);
      setNipyCorrectionReason('');
      await fetchEmployees();
    } catch (error) {
      setMessage({
        type: 'error',
        text:
          error instanceof Error
            ? error.message
            : 'Koreksi NIPY gagal.',
      });
    } finally {
      setNipyCorrecting(false);
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
      const normalizedLevelCode = emp.academic_and_tier?.level_code
        ? emp.academic_and_tier.level_code.replace(/^Gol\.\s*/i, '').trim()
        : '';
      setFormData({
        ...emp,
        academic_and_tier: {
          ...emp.academic_and_tier,
          level_code: normalizedLevelCode,
        },
        employment_profile: {
          structural_positions: [],
          ...emp.employment_profile,
          date_of_hire: formatTimestampForInput(emp.employment_profile?.date_of_hire),
          date_recognized: formatTimestampForInput(emp.employment_profile?.date_recognized),
          date_exit: formatTimestampForInput(emp.employment_profile?.date_exit),
        },
        bpjs: {
          t_bpjs_tk: 0,
          t_bpjs_kes: 0,
          deductionAmount: 0,
          ...emp.bpjs
        },
        salaryProfile: {
          tunjanganBeras: 0,
          ...emp.salaryProfile
        },
        kepangkatan: {
          cummulativeCredit: 0,
          ...emp.kepangkatan
        },
        t_instruksional: emp.t_instruksional || 0,
      });
    } else {
      const normalizedGradeCode = emp.salaryProfile?.salaryGradeCode
        ? emp.salaryProfile.salaryGradeCode.trim()
        : '';
      setFormData({
        ...emp,
        salaryProfile: {
          ...emp.salaryProfile,
          salaryGradeCode: normalizedGradeCode,
        }
      });
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
      const desiredNipy = normalizeNipy(formData.personal_info?.employee_id_niy);
      const previousNipy = editingEmployee ? getEmpNipy(editingEmployee) : '';
      if (
        activeTab === 'blue' &&
        !editingEmployee &&
        formData.flags?.isActive !== false &&
        !formData.employment?.startDate
      ) {
        throw new Error(
          'Tanggal mulai kerja wajib diisi untuk Pekarya aktif agar NIPY dapat diterbitkan.',
        );
      }

      if (activeTab === 'loyalis') {
        const toTimestamp = (dateString: string) => {
          if (!dateString) return null;
          const d = new Date(dateString);
          return isNaN(d.getTime()) ? null : Timestamp.fromDate(d);
        };

        final = {
          ...formData,
          personal_info: {
            ...(formData.personal_info || {}),
            name: formData.personal_info?.name || '',
            employee_id_niy: desiredNipy || null,
            nik: formData.personal_info?.nik || null,
            tax_id_npwp: formData.personal_info?.tax_id_npwp || null,
            status: formData.personal_info?.status || 'AKTIF',
            phone: formData.personal_info?.phone || '',
            email: formData.personal_info?.email || '',
          },
          banking_info: {
            ...(formData.banking_info || {}),
            bank_name: formData.banking_info?.bank_name || null,
            account_number: formData.banking_info?.account_number || null,
          },
          employment_profile: {
            ...(formData.employment_profile || {}),
            job_role: formData.employment_profile?.job_role || null,
            department_unit: isCustomDept ? customDeptValue.trim().toUpperCase() : (formData.employment_profile?.department_unit || null),
            date_of_hire: toTimestamp(formData.employment_profile?.date_of_hire || ''),
            date_recognized: toTimestamp(formData.employment_profile?.date_recognized || ''),
            date_exit: toTimestamp(formData.employment_profile?.date_exit || ''),
            structural_positions: formData.employment_profile?.structural_positions || [],
          },
          academic_and_tier: {
            ...(formData.academic_and_tier || {}),
            education_level: formData.academic_and_tier?.education_level || null,
            education_code: formData.academic_and_tier?.education_code !== undefined && formData.academic_and_tier?.education_code !== '' ? Number(formData.academic_and_tier.education_code) : null,
            functional_tier: formData.academic_and_tier?.functional_tier !== undefined && formData.academic_and_tier?.functional_tier !== '' ? Number(formData.academic_and_tier.functional_tier) : null,
            level_code: formData.academic_and_tier?.level_code || null,
            base_salary_tier: formData.academic_and_tier?.base_salary_tier !== undefined && formData.academic_and_tier?.base_salary_tier !== '' ? Number(formData.academic_and_tier.base_salary_tier) : null,
          },
          family_allowance_metrics: {
            ...(formData.family_allowance_metrics || {}),
            spouse_count: Number(formData.family_allowance_metrics?.spouse_count) || 0,
            children_sd: Number(formData.family_allowance_metrics?.children_sd) || 0,
            children_sltp: Number(formData.family_allowance_metrics?.children_sltp) || 0,
            children_slta: Number(formData.family_allowance_metrics?.children_slta) || 0,
            children_pt: Number(formData.family_allowance_metrics?.children_pt) || 0,
          },
          ziz: {
            ...(formData.ziz || {}),
            deductionAmount: Number(formData.ziz?.deductionAmount) || 0,
          },
          savings: {
            ...(formData.savings || {}),
            deductionAmount: Number(formData.savings?.deductionAmount) || 0,
          },
          pinlu: {
            ...(formData.pinlu || {}),
            deductionAmount: Number(formData.pinlu?.deductionAmount) || 0,
          },
          tht: {
            ...(formData.tht || {}),
            deductionAmount: Number(formData.tht?.deductionAmount) || 0,
          },
          bpjs: {
            ...(formData.bpjs || {}),
            t_bpjs_tk: Number(formData.bpjs?.t_bpjs_tk) || 0,
            t_bpjs_kes: Number(formData.bpjs?.t_bpjs_kes) || 0,
            deductionAmount: Number(formData.bpjs?.deductionAmount) || 0,
          },
          salaryProfile: {
            ...(formData.salaryProfile || {}),
            tunjanganBeras: Number(formData.salaryProfile?.tunjanganBeras) || 0,
          },
          kepangkatan: {
            ...(formData.kepangkatan || {}),
            cummulativeCredit: Number(formData.kepangkatan?.cummulativeCredit) || 0,
          },
          t_instruksional: Number(formData.t_instruksional) || 0,
          koperasiUserId: formData.koperasiUserId !== undefined ? formData.koperasiUserId : null,
          koperasiAuthUid: formData.koperasiAuthUid !== undefined ? formData.koperasiAuthUid : null,
          audit: {
            ...(formData.audit || {}),
            updatedAt: serverTimestamp(),
            ...(editingEmployee ? {} : { createdAt: serverTimestamp(), sourceFile: 'Web Dashboard' }),
          }
        };
      } else {
        const { nipy: _nipy, nipyAssignment: _nipyAssignment, ...blueCollarForm } = formData;
        final = {
          ...blueCollarForm,
          employeeId,
          collarType: 'blue_collar',
          bankAccount: {
            accountHolderName: formData.name || '',
            ...(formData.bankAccount || {}),
          },
          flags: {
            ...(formData.flags || {}),
            isActive: formData.flags?.isActive ?? true,
            isPayrollEligible: formData.flags?.isActive ?? true,
          },
          audit: {
            ...(formData.audit || {}),
            updatedAt: serverTimestamp(),
            ...(editingEmployee ? {} : { createdAt: serverTimestamp(), sourceFile: 'Web Dashboard' }),
          },
        };
      }

      let changedFields: string[] = [];
      if (editingEmployee) {
        const diffs = getObjectDiff(editingEmployee, final);
        changedFields = diffs.map(diff => diff.field);
        if (diffs.length > 0) {
          const pendingChange: PendingEdit = {
            employeeId,
            name: getEmpName(editingEmployee),
            tab: activeTab,
            timestamp: getLocalISOString(),
            changes: diffs
          };
          setPendingEdits(prev => {
            const existingIndex = prev.findIndex(item => item.employeeId === employeeId);
            let updated: PendingEdit[];

            if (existingIndex > -1) {
              const existingEdit = prev[existingIndex];
              const mergedChanges = [...existingEdit.changes];

              pendingChange.changes.forEach(newChange => {
                const existingChangeIndex = mergedChanges.findIndex(c => c.field === newChange.field);

                if (existingChangeIndex > -1) {
                  const existingChange = mergedChanges[existingChangeIndex];
                  existingChange.newValue = newChange.newValue;

                  if (existingChange.oldValue === existingChange.newValue) {
                    mergedChanges.splice(existingChangeIndex, 1);
                  }
                } else {
                  mergedChanges.push(newChange);
                }
              });

              if (mergedChanges.length > 0) {
                updated = [...prev];
                updated[existingIndex] = {
                  ...existingEdit,
                  changes: mergedChanges,
                  timestamp: pendingChange.timestamp
                };
              } else {
                updated = prev.filter((_, idx) => idx !== existingIndex);
              }
            } else {
              updated = [...prev, pendingChange];
            }

            localStorage.setItem('pending_employee_edits', JSON.stringify(updated));
            return updated;
          });
        }
      }

      // NIPY is protected from direct client writes by Firestore rules. Keep
      // the existing protected values in the normal profile write, then let
      // the audited identity endpoint update the NIPY and its index atomically.
      let employeeWritePayload = final;
      if (activeTab === 'loyalis') {
        const { nipy: _nipy, ...loyalisPayload } = final;
        employeeWritePayload = {
          ...loyalisPayload,
          personal_info: {
            ...loyalisPayload.personal_info,
            employee_id_niy: editingEmployee
              ? editingEmployee.personal_info?.employee_id_niy ?? null
              : null,
          },
        };
      }

      await setDoc(doc(db, currentTab.collection, employeeId), employeeWritePayload, { merge: true });
      if (activeTab === 'loyalis' && desiredNipy !== previousNipy) {
        await authenticatedJson('/api/admin/attendance-identities', {
          method: 'PATCH',
          body: JSON.stringify({
            employeeId,
            employeeCollection: currentTab.collection,
            nipy: desiredNipy,
            requestId: createFinancialRequestId('employee-nipy'),
          }),
        });
      } else if (
        activeTab === 'blue' &&
        !previousNipy &&
        formData.flags?.isActive !== false &&
        formData.employment?.startDate
      ) {
        await authenticatedJson(
          '/api/admin/attendance-identities/pekarya',
          {
            method: 'POST',
            body: JSON.stringify({
              operation: 'generate_one',
              employeeId,
              requestId: createFinancialRequestId('pekarya-nipy'),
            }),
          },
        );
      }

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

      // Push the edit onto any draft slip in an open period. Amounts are
      // derived server-side from the profile, so this call carries none.
      let propagationNote = '';
      if (editingEmployee && changedFields.length > 0) {
        try {
          const propagation = await authenticatedJson<{ results: PropagationResult[] }>(
            '/api/payroll/employee-profile-propagation',
            {
              method: 'POST',
              body: JSON.stringify({
                employeeId,
                requestId: createFinancialRequestId('profile-sync'),
                changedFields,
              }),
            },
          );
          propagationNote = describePropagation(propagation.results);
        } catch (propagationErr) {
          console.error('Gagal menerapkan perubahan ke slip gaji:', propagationErr);
          propagationNote =
            ' Namun slip gaji belum diperbarui — buka Payroll › Refresh Massal.';
        }
      }

      setMessage({
        type: 'success',
        text: `Karyawan ${editingEmployee ? 'diperbarui' : 'ditambahkan'}!${propagationNote}`,
      });
      setIsDialogOpen(false);
      fetchEmployees();
      setTimeout(() => setMessage(null), propagationNote ? 8000 : 3000);
    } catch (err) {
      console.error('Error saving employee:', err);
      setMessage({
        type: 'error',
        text:
          err instanceof Error
            ? err.message
            : 'Gagal menyimpan data.',
      });
    } finally {
      isSavingRef.current = false;
      setSaving(false);
    }
  };

  const handleDelete = async (employeeId: string) => {
    void employeeId;
    setMessage({
      type: 'error',
      text: 'Penghapusan karyawan dinonaktifkan agar riwayat payroll tetap utuh. Ubah status ke nonaktif.',
    });
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

  const handleClearChanges = async () => {
    if (!confirm('Apakah Anda yakin ingin membatalkan dan mengembalikan (revert) seluruh perubahan data pegawai di sesi ini?')) return;
    try {
      setLocalLoading(true);

      const reconstructNestedObject = (changes: FieldChange[]): any => {
        const result: any = {};
        changes.forEach(c => {
          const parts = c.field.split('.');
          let current = result;
          for (let i = 0; i < parts.length - 1; i++) {
            const part = parts[i];
            if (!current[part] || typeof current[part] !== 'object') {
              current[part] = {};
            }
            current = current[part];
          }
          const lastPart = parts[parts.length - 1];
          
          let val = c.oldValue;
          // Convert ISO date strings back to Firestore Timestamps
          if (typeof val === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(val)) {
            const date = new Date(val);
            if (!isNaN(date.getTime())) {
              val = Timestamp.fromDate(date);
            }
          }
          current[lastPart] = val;
        });
        return result;
      };

      // Revert each pending edit in Firestore
      for (const edit of pendingEdits) {
        const collectionName = edit.tab === 'loyalis' ? 'Employees_Loyalis' : 'Employees_BlueCollar';
        const docRef = doc(db, collectionName, edit.employeeId);
        const revertPayload = reconstructNestedObject(edit.changes);
        await setDoc(docRef, revertPayload, { merge: true });
      }

      setPendingEdits([]);
      localStorage.removeItem('pending_employee_edits');
      setIsLogOpen(false);
      
      await fetchEmployees();
      
      setMessage({ type: 'success', text: 'Seluruh perubahan berhasil dibatalkan dan dikembalikan (revert)!' });
      setTimeout(() => setMessage(null), 4000);
    } catch (err) {
      console.error('Error reverting changes:', err);
      setMessage({ type: 'error', text: 'Gagal membatalkan dan mengembalikan perubahan.' });
      setTimeout(() => setMessage(null), 4000);
    } finally {
      setLocalLoading(false);
    }
  };

  const getFilteredAndSortedEmployees = () => {
    let list = employees.filter(emp => {
      const name = getEmpName(emp);
      const nik = getEmpNikOrNiy(emp);
      const nipy = getEmpNipy(emp);
      const id = getEmpId(emp);
      return (
        name.toLowerCase().includes(searchQuery.toLowerCase()) ||
        (nik && String(nik).includes(searchQuery)) ||
        (nipy && nipy.includes(searchQuery.toUpperCase())) ||
        id.includes(searchQuery)
      );
    });

    if (!sortConfig.key || !sortConfig.direction) {
      return list;
    }

    return [...list].sort((a, b) => {
      let aVal: any;
      let bVal: any;

      switch (sortConfig.key) {
        case 'id':
          aVal = getEmpId(a);
          bVal = getEmpId(b);
          break;
        case 'name':
          aVal = getEmpName(a).toLowerCase();
          bVal = getEmpName(b).toLowerCase();
          break;
        case 'category':
          aVal = getEmpCategory(a).toLowerCase();
          bVal = getEmpCategory(b).toLowerCase();
          break;
        case 'grade':
          aVal = getEmpGrade(a).toLowerCase();
          bVal = getEmpGrade(b).toLowerCase();
          break;
        case 'status':
          aVal = getEmpIsActive(a) ? 1 : 0;
          bVal = getEmpIsActive(b) ? 1 : 0;
          break;
        case 'startDate': {
          const aDateStr = getEmpStartDate(a);
          const bDateStr = getEmpStartDate(b);
          aVal = aDateStr ? new Date(aDateStr).getTime() : 0;
          bVal = bDateStr ? new Date(bDateStr).getTime() : 0;
          break;
        }
        case 'masaKerja': {
          const aTmt = a.employment_profile?.date_recognized;
          const bTmt = b.employment_profile?.date_recognized;
          const aTime = aTmt ? (aTmt.toDate ? aTmt.toDate().getTime() : new Date(aTmt).getTime()) : 0;
          const bTime = bTmt ? (bTmt.toDate ? bTmt.toDate().getTime() : new Date(bTmt).getTime()) : 0;
          aVal = -aTime;
          bVal = -bTime;
          break;
        }
        case 't_bpjs_tk':
          aVal = a.bpjs?.t_bpjs_tk || 0;
          bVal = b.bpjs?.t_bpjs_tk || 0;
          break;
        case 't_bpjs_kes':
          aVal = a.bpjs?.t_bpjs_kes || 0;
          bVal = b.bpjs?.t_bpjs_kes || 0;
          break;
        case 't_beras':
          aVal = a.salaryProfile?.tunjanganBeras || 0;
          bVal = b.salaryProfile?.tunjanganBeras || 0;
          break;
        case 'bpjs_pekarya':
          aVal = a.bpjs?.allowanceAmount || 0;
          bVal = b.bpjs?.allowanceAmount || 0;
          break;
        case 'pot_bpjs':
          aVal = a.bpjs?.deductionAmount || 0;
          bVal = b.bpjs?.deductionAmount || 0;
          break;
        case 't_jabatan':
          aVal = (a.employment_profile?.structural_positions || []).reduce((sum: number, pos: any) => sum + (Number(pos.allowance) || 0), 0);
          bVal = (b.employment_profile?.structural_positions || []).reduce((sum: number, pos: any) => sum + (Number(pos.allowance) || 0), 0);
          break;
        case 't_kepangkatan':
          aVal = kepangkatanAllowanceMap[a.id] || 0;
          bVal = kepangkatanAllowanceMap[b.id] || 0;
          break;
        case 't_instruksional':
          aVal = a.t_instruksional || 0;
          bVal = b.t_instruksional || 0;
          break;
        case 'pot_tabungan':
          aVal = a.savings?.deductionAmount || 0;
          bVal = b.savings?.deductionAmount || 0;
          break;
        case 'zis':
          aVal = a.ziz?.deductionAmount || 0;
          bVal = b.ziz?.deductionAmount || 0;
          break;
        case 'pot_bni':
          aVal = a.tht?.deductionAmount || 0;
          bVal = b.tht?.deductionAmount || 0;
          break;
        case 'pot_pinlu':
          aVal = a.pinlu?.deductionAmount || 0;
          bVal = b.pinlu?.deductionAmount || 0;
          break;
        default:
          return 0;
      }

      if (aVal < bVal) return sortConfig.direction === 'asc' ? -1 : 1;
      if (aVal > bVal) return sortConfig.direction === 'asc' ? 1 : -1;
      return 0;
    });
  };

  const filtered = getFilteredAndSortedEmployees();

  const getSortedDebugRows = (debugRows: any[]) => {
    if (!sortConfig.key || !sortConfig.direction) return debugRows;

    return [...debugRows].sort((a, b) => {
      let aVal: any;
      let bVal: any;

      switch (sortConfig.key) {
        case 'id':
          aVal = getEmpId(a);
          bVal = getEmpId(b);
          break;
        case 'name':
          aVal = getEmpName(a).toLowerCase();
          bVal = getEmpName(b).toLowerCase();
          break;
        case 'debugJabatan':
          aVal = (a.debugJabatan || '').toLowerCase();
          bVal = (b.debugJabatan || '').toLowerCase();
          break;
        case 'debugSatker':
          aVal = (a.debugSatker || '').toLowerCase();
          bVal = (b.debugSatker || '').toLowerCase();
          break;
        case 'debugTunjangan':
          aVal = a.debugTunjangan || 0;
          bVal = b.debugTunjangan || 0;
          break;
        default:
          return 0;
      }

      if (aVal < bVal) return sortConfig.direction === 'asc' ? -1 : 1;
      if (aVal > bVal) return sortConfig.direction === 'asc' ? 1 : -1;
      return 0;
    });
  };

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
          'NIPY / NIY Presensi': getEmpNipy(emp),
          'NPWP': emp.personal_info?.tax_id_npwp || '',
          'Status': getEmpIsActive(emp) ? 'Aktif' : 'Non-Aktif',
          'Nomor Telepon': emp.personal_info?.phone || '',
          'Email': emp.personal_info?.email || '',
          'Jabatan': getEmpCategory(emp),
          'Departemen/Unit': emp.employment_profile?.department_unit || '',
          'Golongan / Level': getEmpGrade(emp),
          'Mulai Kerja': getEmpStartDate(emp),
          'Tgl Diakui': getEmpRecognizedDate(emp),
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
          'NIPY Presensi': getEmpNipy(emp),
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
    <div className="min-h-screen bg-gradient-to-br from-slate-50 via-indigo-50/80 to-slate-100 p-8 font-sans selection:bg-indigo-100 relative overflow-hidden text-slate-800">
      {/* Subtle decorative blobs */}
      <div className="absolute top-0 right-0 w-[600px] h-[600px] rounded-full bg-indigo-100/40 blur-[120px] pointer-events-none" />
      <div className="absolute bottom-0 left-0 w-[500px] h-[500px] rounded-full bg-purple-100/30 blur-[100px] pointer-events-none" />
      <div className="max-w-[1400px] mx-auto relative z-10">
        <GlobalHeader />

        {/* Header */}
        <div className="flex justify-between items-center mb-8">
          <div className="flex items-center gap-4">
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
              <div className={`fixed top-0 left-0 right-0 z-[9999] w-full flex items-center justify-center px-6 py-4 shadow-md text-sm font-semibold transition-all duration-300 animate-in slide-in-from-top ${
                message.type === 'success' ? 'bg-emerald-600 text-white' : 'bg-rose-600 text-white'
              }`}>
                <div className="flex items-center gap-2.5">
                  {message.type === 'success' ? <CheckCircle2 className="w-5 h-5 shrink-0" /> : <AlertCircle className="w-5 h-5 shrink-0" />}
                  <span>{message.text}</span>
                </div>
              </div>
            )}
            <Button onClick={handleExportExcel} variant="outline" className="rounded-xl border-slate-200 bg-white hover:bg-slate-50 text-slate-700 shadow-sm px-4 cursor-pointer">
              <FileSpreadsheet className="w-4 h-4 mr-2 text-emerald-600" /> Export Excel
            </Button>
            {activeTab === 'blue' && (
              <Button
                onClick={handleOpenNipyGenerator}
                variant="outline"
                className="rounded-xl border-indigo-200 bg-indigo-50 hover:bg-indigo-100 text-indigo-700 shadow-sm px-4 cursor-pointer"
              >
                <Fingerprint className="w-4 h-4 mr-2" />
                Buat NIPY Pekarya
              </Button>
            )}
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
              placeholder="Cari nama, NIK/NIY, atau NIPY..."
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
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold flex items-center gap-1.5 transition-all cursor-pointer ${tableViewMode === 'default'
                ? 'bg-slate-900 text-white shadow-sm'
                : 'text-slate-600 hover:bg-slate-50'
                }`}
            >
              <LayoutGrid className="w-3.5 h-3.5" />
              Tampilan Default
            </button>
            <button
              onClick={() => setTableViewMode('debug')}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold flex items-center gap-1.5 transition-all cursor-pointer ${tableViewMode === 'debug'
                ? 'bg-indigo-600 text-white shadow-sm'
                : 'text-slate-600 hover:bg-slate-50'
                }`}
            >
              <Building2 className="w-3.5 h-3.5" />
              Debug Jabatan
            </button>
            <button
              onClick={() => setTableViewMode('constant')}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold flex items-center gap-1.5 transition-all cursor-pointer ${tableViewMode === 'constant'
                ? 'bg-emerald-600 text-white shadow-sm'
                : 'text-slate-600 hover:bg-slate-50'
                }`}
            >
              <SlidersHorizontal className="w-3.5 h-3.5" />
              Nilai Konstanta
            </button>
          </div>
        </div>

        {/* Table */}
        <Card className="bg-white rounded-[24px] shadow-[0_8px_40px_-12px_rgba(0,0,0,0.06)] border-none overflow-hidden">
          <div className="overflow-x-auto">
            <Table>
              <TableHeader className="bg-slate-50/50">
                {tableViewMode === 'default' && (
                  <TableRow className="border-slate-100">
                    <TableHead onClick={() => handleSort('id')} className="w-24 font-semibold text-slate-900 pl-8 cursor-pointer hover:text-indigo-600 transition-colors">
                      <div className="flex items-center">ID <SortIcon active={sortConfig.key === 'id'} direction={sortConfig.direction} /></div>
                    </TableHead>
                    <TableHead onClick={() => handleSort('name')} className="font-semibold text-slate-900 w-[320px] cursor-pointer hover:text-indigo-600 transition-colors">
                      <div className="flex items-center">Nama Lengkap <SortIcon active={sortConfig.key === 'name'} direction={sortConfig.direction} /></div>
                    </TableHead>
                    <TableHead onClick={() => handleSort('category')} className="font-semibold text-slate-900 w-[320px] cursor-pointer hover:text-indigo-600 transition-colors">
                      <div className="flex items-center">Kategori <SortIcon active={sortConfig.key === 'category'} direction={sortConfig.direction} /></div>
                    </TableHead>
                    <TableHead onClick={() => handleSort('grade')} className="font-semibold text-slate-900 cursor-pointer hover:text-indigo-600 transition-colors">
                      <div className="flex items-center">Gol. <SortIcon active={sortConfig.key === 'grade'} direction={sortConfig.direction} /></div>
                    </TableHead>
                    <TableHead onClick={() => handleSort('status')} className="font-semibold text-slate-900 text-center cursor-pointer hover:text-indigo-600 transition-colors">
                      <div className="flex items-center justify-center">Status <SortIcon active={sortConfig.key === 'status'} direction={sortConfig.direction} /></div>
                    </TableHead>
                    <TableHead onClick={() => handleSort('startDate')} className="font-semibold text-slate-900 cursor-pointer hover:text-indigo-600 transition-colors">
                      <div className="flex items-center">Mulai Kerja <SortIcon active={sortConfig.key === 'startDate'} direction={sortConfig.direction} /></div>
                    </TableHead>
                    <TableHead onClick={() => handleSort('masaKerja')} className="font-semibold text-slate-900 cursor-pointer hover:text-indigo-600 transition-colors">
                      <div className="flex items-center">Masa Kerja <SortIcon active={sortConfig.key === 'masaKerja'} direction={sortConfig.direction} /></div>
                    </TableHead>
                    <TableHead className="font-semibold text-slate-900 text-right pr-8 select-none">Aksi</TableHead>
                  </TableRow>
                )}
                {tableViewMode === 'debug' && (
                  <TableRow className="border-slate-100">
                    <TableHead onClick={() => handleSort('id')} className="w-24 font-semibold text-slate-900 pl-8 cursor-pointer hover:text-indigo-600 transition-colors">
                      <div className="flex items-center">ID <SortIcon active={sortConfig.key === 'id'} direction={sortConfig.direction} /></div>
                    </TableHead>
                    <TableHead onClick={() => handleSort('name')} className="font-semibold text-slate-900 w-[300px] cursor-pointer hover:text-indigo-600 transition-colors">
                      <div className="flex items-center">Nama Lengkap <SortIcon active={sortConfig.key === 'name'} direction={sortConfig.direction} /></div>
                    </TableHead>
                    <TableHead onClick={() => handleSort('debugJabatan')} className="font-semibold text-slate-900 w-[300px] cursor-pointer hover:text-indigo-600 transition-colors">
                      <div className="flex items-center">Nama Jabatan <SortIcon active={sortConfig.key === 'debugJabatan'} direction={sortConfig.direction} /></div>
                    </TableHead>
                    <TableHead onClick={() => handleSort('debugSatker')} className="font-semibold text-slate-900 cursor-pointer hover:text-indigo-600 transition-colors">
                      <div className="flex items-center">SatKer (department_unit) <SortIcon active={sortConfig.key === 'debugSatker'} direction={sortConfig.direction} /></div>
                    </TableHead>
                    <TableHead onClick={() => handleSort('debugTunjangan')} className="font-semibold text-slate-900 text-right cursor-pointer hover:text-indigo-600 transition-colors">
                      <div className="flex items-center justify-end">Tunjangan Jabatan <SortIcon active={sortConfig.key === 'debugTunjangan'} direction={sortConfig.direction} /></div>
                    </TableHead>
                    <TableHead className="font-semibold text-slate-900 text-right pr-8 select-none">Aksi</TableHead>
                  </TableRow>
                )}
                {tableViewMode === 'constant' && (
                  activeTab === 'loyalis' ? (
                    <TableRow className="border-slate-100">
                      <TableHead onClick={() => handleSort('id')} className="w-24 font-semibold text-slate-900 pl-8 cursor-pointer hover:text-indigo-600 transition-colors">
                        <div className="flex items-center">ID <SortIcon active={sortConfig.key === 'id'} direction={sortConfig.direction} /></div>
                      </TableHead>
                      <TableHead onClick={() => handleSort('name')} className="font-semibold text-slate-900 w-[200px] cursor-pointer hover:text-indigo-600 transition-colors">
                        <div className="flex items-center">Nama Lengkap <SortIcon active={sortConfig.key === 'name'} direction={sortConfig.direction} /></div>
                      </TableHead>
                      <TableHead onClick={() => handleSort('t_bpjs_tk')} className="font-semibold text-emerald-800 bg-emerald-50/40 text-right cursor-pointer hover:text-indigo-800 transition-colors">
                        <div className="flex items-center justify-end">T. BPJS TK <SortIcon active={sortConfig.key === 't_bpjs_tk'} direction={sortConfig.direction} /></div>
                      </TableHead>
                      <TableHead onClick={() => handleSort('t_bpjs_kes')} className="font-semibold text-emerald-800 bg-emerald-50/40 text-right cursor-pointer hover:text-indigo-800 transition-colors">
                        <div className="flex items-center justify-end">T. BPJS KES <SortIcon active={sortConfig.key === 't_bpjs_kes'} direction={sortConfig.direction} /></div>
                      </TableHead>
                      <TableHead onClick={() => handleSort('t_beras')} className="font-semibold text-emerald-800 bg-emerald-50/40 text-right cursor-pointer hover:text-indigo-800 transition-colors">
                        <div className="flex items-center justify-end">T. Beras <SortIcon active={sortConfig.key === 't_beras'} direction={sortConfig.direction} /></div>
                      </TableHead>
                      <TableHead onClick={() => handleSort('t_jabatan')} className="font-semibold text-emerald-800 bg-emerald-50/40 text-right cursor-pointer hover:text-indigo-800 transition-colors">
                        <div className="flex items-center justify-end">T. Jabatan <SortIcon active={sortConfig.key === 't_jabatan'} direction={sortConfig.direction} /></div>
                      </TableHead>
                      <TableHead onClick={() => handleSort('t_kepangkatan')} className="font-semibold text-emerald-800 bg-emerald-50/40 text-right cursor-pointer hover:text-indigo-800 transition-colors">
                        <div className="flex items-center justify-end">T. Kepangkatan <SortIcon active={sortConfig.key === 't_kepangkatan'} direction={sortConfig.direction} /></div>
                      </TableHead>
                      <TableHead onClick={() => handleSort('t_instruksional')} className="font-semibold text-emerald-800 bg-emerald-50/40 text-right cursor-pointer hover:text-indigo-800 transition-colors">
                        <div className="flex items-center justify-end">T. Instruksional <SortIcon active={sortConfig.key === 't_instruksional'} direction={sortConfig.direction} /></div>
                      </TableHead>
                      <TableHead onClick={() => handleSort('pot_bpjs')} className="font-semibold text-rose-800 bg-rose-50/40 text-right cursor-pointer hover:text-rose-900 transition-colors">
                        <div className="flex items-center justify-end">Pot. BPJS <SortIcon active={sortConfig.key === 'pot_bpjs'} direction={sortConfig.direction} /></div>
                      </TableHead>
                      <TableHead onClick={() => handleSort('pot_tabungan')} className="font-semibold text-rose-800 bg-rose-50/40 text-right cursor-pointer hover:text-rose-900 transition-colors">
                        <div className="flex items-center justify-end">Pot. Tabungan <SortIcon active={sortConfig.key === 'pot_tabungan'} direction={sortConfig.direction} /></div>
                      </TableHead>
                      <TableHead onClick={() => handleSort('zis')} className="font-semibold text-rose-800 bg-rose-50/40 text-right cursor-pointer hover:text-rose-900 transition-colors">
                        <div className="flex items-center justify-end">ZIS <SortIcon active={sortConfig.key === 'zis'} direction={sortConfig.direction} /></div>
                      </TableHead>
                      <TableHead onClick={() => handleSort('pot_bni')} className="font-semibold text-rose-800 bg-rose-50/40 text-right cursor-pointer hover:text-rose-900 transition-colors">
                        <div className="flex items-center justify-end">Pot. BNI Simponi <SortIcon active={sortConfig.key === 'pot_bni'} direction={sortConfig.direction} /></div>
                      </TableHead>
                      <TableHead onClick={() => handleSort('pot_pinlu')} className="font-semibold text-rose-800 bg-rose-50/40 text-right cursor-pointer hover:text-rose-900 transition-colors">
                        <div className="flex items-center justify-end">Pot. Pinlu/Tagihan <SortIcon active={sortConfig.key === 'pot_pinlu'} direction={sortConfig.direction} /></div>
                      </TableHead>
                      <TableHead className="font-semibold text-slate-900 text-right pr-8 select-none">Aksi</TableHead>
                    </TableRow>
                  ) : (
                    <TableRow className="border-slate-100">
                      <TableHead onClick={() => handleSort('id')} className="w-24 font-semibold text-slate-900 pl-8 cursor-pointer hover:text-indigo-600 transition-colors">
                        <div className="flex items-center">ID <SortIcon active={sortConfig.key === 'id'} direction={sortConfig.direction} /></div>
                      </TableHead>
                      <TableHead onClick={() => handleSort('name')} className="font-semibold text-slate-900 w-[250px] cursor-pointer hover:text-indigo-600 transition-colors">
                        <div className="flex items-center">Nama Lengkap <SortIcon active={sortConfig.key === 'name'} direction={sortConfig.direction} /></div>
                      </TableHead>
                      <TableHead onClick={() => handleSort('bpjs_pekarya')} className="font-semibold text-emerald-800 bg-emerald-50/40 text-right cursor-pointer hover:text-indigo-800 transition-colors">
                        <div className="flex items-center justify-end">BPJS Pekarya <SortIcon active={sortConfig.key === 'bpjs_pekarya'} direction={sortConfig.direction} /></div>
                      </TableHead>
                      <TableHead onClick={() => handleSort('t_beras')} className="font-semibold text-emerald-800 bg-emerald-50/40 text-right cursor-pointer hover:text-indigo-800 transition-colors">
                        <div className="flex items-center justify-end">T. Beras <SortIcon active={sortConfig.key === 't_beras'} direction={sortConfig.direction} /></div>
                      </TableHead>
                      <TableHead onClick={() => handleSort('pot_bpjs')} className="font-semibold text-rose-800 bg-rose-50/40 text-right cursor-pointer hover:text-rose-900 transition-colors">
                        <div className="flex items-center justify-end">Pot. BPJS <SortIcon active={sortConfig.key === 'pot_bpjs'} direction={sortConfig.direction} /></div>
                      </TableHead>
                      <TableHead className="font-semibold text-slate-900 text-right pr-8 select-none">Aksi</TableHead>
                    </TableRow>
                  )
                )}
              </TableHeader>
              <TableBody>
                {loading ? (
                  <TableRow>
                    <TableCell colSpan={tableViewMode === 'default' ? 8 : (tableViewMode === 'debug' ? 6 : (activeTab === 'loyalis' ? 14 : 6))} className="h-64 text-center">
                      <div className="flex flex-col items-center gap-3 text-slate-400">
                        <Loader2 className="w-8 h-8 animate-spin text-indigo-500" />
                        <p>Memuat data pegawai...</p>
                      </div>
                    </TableCell>
                  </TableRow>
                ) : filtered.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={tableViewMode === 'default' ? 8 : (tableViewMode === 'debug' ? 6 : (activeTab === 'loyalis' ? 14 : 6))} className="h-64 text-center">
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
                          {activeTab === 'loyalis' ? (
                            <span className={`text-xs font-mono font-semibold ${getEmpNipy(emp) ? 'text-emerald-600' : 'text-rose-600'}`}>
                              NIPY / NIY: {getEmpNipy(emp) || 'BELUM DIISI'}
                            </span>
                          ) : (
                            <>
                              <span className="text-xs text-slate-400 font-mono">
                                NIK: {getEmpNikOrNiy(emp) || '-'}
                              </span>
                              <span className={`text-xs font-mono font-semibold ${getEmpNipy(emp) ? 'text-emerald-600' : 'text-rose-600'}`}>
                                NIPY: {getEmpNipy(emp) || 'BELUM DIISI'}
                              </span>
                            </>
                          )}
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
                      <TableCell className="text-slate-500 text-sm">
                        {getEmpMasaKerja(emp)}
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
                ) : tableViewMode === 'debug' ? (
                  getSortedDebugRows(getDebugRows(filtered, activeTab)).map(empRow => (
                    <TableRow key={empRow.rowKey} className="hover:bg-slate-50/30 transition-colors border-slate-50">
                      <TableCell className="font-bold text-slate-400 pl-8 font-mono text-xs">{getEmpId(empRow)}</TableCell>
                      <TableCell className="w-[320px] max-w-[320px]">
                        <div className="flex flex-col">
                          <span className="font-bold text-slate-900 block truncate" title={getEmpName(empRow)}>{getEmpName(empRow)}</span>
                          <span className="text-xs text-slate-400 font-mono">
                            {activeTab === 'loyalis' ? 'NIPY / NIY' : 'NIK'}: {activeTab === 'loyalis' ? getEmpNipy(empRow) || '-' : getEmpNikOrNiy(empRow) || '-'}
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
                ) : (
                  filtered.map(emp => (
                    <TableRow key={getEmpId(emp)} className="hover:bg-slate-50/30 transition-colors border-slate-50">
                      <TableCell className="font-bold text-slate-400 pl-8 font-mono text-xs">{getEmpId(emp)}</TableCell>
                      <TableCell className="w-[180px] max-w-[180px]">
                        <div className="flex flex-col">
                          <span className="font-bold text-slate-900 block truncate" title={getEmpName(emp)}>{getEmpName(emp)}</span>
                          <span className="text-[10px] text-slate-400 font-mono">
                            {activeTab === 'loyalis' ? 'NIPY / NIY' : 'NIK'}: {activeTab === 'loyalis' ? getEmpNipy(emp) || '-' : getEmpNikOrNiy(emp) || '-'}
                          </span>
                        </div>
                      </TableCell>
                      {activeTab === 'loyalis' ? (
                        <>
                          <TableCell className="text-right font-medium text-slate-700 text-xs bg-emerald-50/10">{formatIDR(emp.bpjs?.t_bpjs_tk || 0)}</TableCell>
                          <TableCell className="text-right font-medium text-slate-700 text-xs bg-emerald-50/10">{formatIDR(emp.bpjs?.t_bpjs_kes || 0)}</TableCell>
                          <TableCell className="text-right font-medium text-slate-700 text-xs bg-emerald-50/10">{formatIDR(emp.salaryProfile?.tunjanganBeras || 0)}</TableCell>
                          <TableCell className="text-right font-medium text-slate-700 text-xs bg-emerald-50/10">
                            {formatIDR((emp.employment_profile?.structural_positions || []).reduce((sum: number, pos: any) => sum + (Number(pos.allowance) || 0), 0))}
                          </TableCell>
                          <TableCell className="text-right font-medium text-slate-700 text-xs bg-emerald-50/10">{formatIDR(kepangkatanAllowanceMap[emp.id] || 0)}</TableCell>
                          <TableCell className="text-right font-medium text-slate-700 text-xs bg-emerald-50/10">{formatIDR(emp.t_instruksional || 0)}</TableCell>
                          <TableCell className="text-right font-medium text-slate-700 text-xs bg-rose-50/10">{formatIDR(emp.bpjs?.deductionAmount || 0)}</TableCell>
                          <TableCell className="text-right font-medium text-slate-700 text-xs bg-rose-50/10">{formatIDR(emp.savings?.deductionAmount || 0)}</TableCell>
                          <TableCell className="text-right font-medium text-slate-700 text-xs bg-rose-50/10">{formatIDR(emp.ziz?.deductionAmount || 0)}</TableCell>
                          <TableCell className="text-right font-medium text-slate-700 text-xs bg-rose-50/10">{formatIDR(emp.tht?.deductionAmount || 0)}</TableCell>
                          <TableCell className="text-right font-medium text-slate-700 text-xs bg-rose-50/10">{formatIDR(emp.pinlu?.deductionAmount || 0)}</TableCell>
                        </>
                      ) : (
                        <>
                          <TableCell className="text-right font-medium text-slate-700 text-sm bg-emerald-50/10">{formatIDR(emp.bpjs?.allowanceAmount || 0)}</TableCell>
                          <TableCell className="text-right font-medium text-slate-700 text-sm bg-emerald-50/10">{formatIDR(emp.salaryProfile?.tunjanganBeras || 0)}</TableCell>
                          <TableCell className="text-right font-medium text-slate-700 text-sm bg-rose-50/10">{formatIDR(emp.bpjs?.deductionAmount || 0)}</TableCell>
                        </>
                      )}
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
                )}
              </TableBody>
            </Table>
          </div>
        </Card>
      </div>

      <Dialog
        open={Boolean(nipyCorrectionEmployee)}
        onOpenChange={open => {
          if (!open && !nipyCorrecting) {
            setNipyCorrectionEmployee(null);
            setNipyCorrectionReason('');
          }
        }}
      >
        <DialogContent className="sm:max-w-lg rounded-[24px] border-none shadow-2xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Fingerprint className="w-5 h-5 text-amber-600" />
              Koreksi Penerbitan NIPY
            </DialogTitle>
            <DialogDescription>
              Sistem menghitung ulang kode kategori dan tanggal DDMMYY, tetapi
              mempertahankan nomor urut{' '}
              {String(
                nipyCorrectionEmployee?.nipyAssignment?.sequence || '',
              ).padStart(3, '0')}
              . Tindakan ini tercatat permanen.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="rounded-2xl bg-slate-50 p-4">
              <p className="font-semibold text-slate-900">
                {getEmpName(nipyCorrectionEmployee || {})}
              </p>
              <p className="mt-1 font-mono text-sm text-slate-600">
                NIPY saat ini: {getEmpNipy(nipyCorrectionEmployee || {})}
              </p>
            </div>
            <div className="space-y-2">
              <Label htmlFor="nipy-correction-reason">Alasan koreksi</Label>
              <Input
                id="nipy-correction-reason"
                value={nipyCorrectionReason}
                onChange={event => setNipyCorrectionReason(event.target.value)}
                placeholder="Contoh: Tanggal mulai kerja telah dikoreksi sesuai SK."
                maxLength={500}
              />
              <p className="text-xs text-slate-500">
                Minimal 8 karakter. NIPY lama tetap tersimpan dalam audit.
              </p>
            </div>
          </div>
          <DialogFooter>
            <Button
              variant="ghost"
              onClick={() => setNipyCorrectionEmployee(null)}
              disabled={nipyCorrecting}
              className="rounded-xl"
            >
              Batal
            </Button>
            <Button
              onClick={handleReissueNipy}
              disabled={
                nipyCorrecting || nipyCorrectionReason.trim().length < 8
              }
              className="rounded-xl bg-amber-600 text-white hover:bg-amber-700"
            >
              {nipyCorrecting && (
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
              )}
              Hitung Ulang NIPY
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={isNipyDialogOpen} onOpenChange={setIsNipyDialogOpen}>
        <DialogContent className="!max-w-6xl w-[94vw] rounded-[28px] border-none shadow-2xl p-0 overflow-hidden bg-white">
          <DialogHeader className="p-6 bg-indigo-50/70 border-b border-indigo-100">
            <DialogTitle className="text-xl font-bold flex items-center gap-2 text-indigo-950">
              <Fingerprint className="w-5 h-5 text-indigo-600" />
              Buat NIPY Pekarya
            </DialogTitle>
            <DialogDescription className="text-indigo-800/70">
              Formula: kode kategori + tanggal mulai DDMMYY + nomor urut
              kategori. Periksa seluruh nilai sebelum diterbitkan.
            </DialogDescription>
          </DialogHeader>

          <div className="p-6 max-h-[70vh] overflow-y-auto">
            {nipyLoading && !nipyPreview ? (
              <div className="min-h-64 flex flex-col items-center justify-center gap-3 text-slate-500">
                <Loader2 className="w-8 h-8 animate-spin text-indigo-600" />
                <p>Menyiapkan pratinjau NIPY...</p>
              </div>
            ) : nipyPreview ? (
              <div className="space-y-5">
                <div className="grid grid-cols-2 md:grid-cols-6 gap-3">
                  {[
                    ['Aktif', nipyPreview.summary.active, 'text-slate-900'],
                    ['Siap', nipyPreview.summary.ready, 'text-emerald-700'],
                    ['Reservasi', nipyPreview.summary.reserved, 'text-amber-700'],
                    ['Sudah Terbit', nipyPreview.summary.existing, 'text-indigo-700'],
                    ['Terblokir', nipyPreview.summary.blocked, 'text-rose-700'],
                    ['Konflik', nipyPreview.summary.conflicts, 'text-rose-700'],
                  ].map(([label, value, color]) => (
                    <div
                      key={String(label)}
                      className="rounded-2xl border border-slate-100 bg-slate-50 p-3"
                    >
                      <p className="text-[11px] uppercase tracking-wide text-slate-500">
                        {label}
                      </p>
                      <p className={`text-2xl font-bold ${color}`}>{value}</p>
                    </div>
                  ))}
                </div>

                <div className="rounded-2xl border border-indigo-100 bg-indigo-50 px-4 py-3 text-sm text-indigo-900">
                  <p className="font-semibold">
                    Urutan terakhir: Kebersihan{' '}
                    {String(nipyPreview.counters.KEBERSIHAN || 0).padStart(3, '0')}
                    {' · '}Sopir{' '}
                    {String(nipyPreview.counters.SOPIR || 0).padStart(3, '0')}
                    {' · '}Satpam{' '}
                    {String(nipyPreview.counters.SATPAM || 0).padStart(3, '0')}
                    {' · '}Teknisi{' '}
                    {String(nipyPreview.counters.TEKNISI || 0).padStart(3, '0')}
                  </p>
                  <p className="mt-1 text-xs text-indigo-700">
                    {nipyPreview.summary.pendingWrites > 0
                      ? `${nipyPreview.summary.pendingWrites} perubahan akan dicatat dalam audit keuangan.`
                      : 'Tidak ada penerbitan atau reservasi baru.'}
                  </p>
                </div>

                <div className="rounded-2xl border border-slate-200 overflow-hidden">
                  <div className="max-h-[390px] overflow-auto">
                    <Table>
                      <TableHeader className="sticky top-0 z-10 bg-slate-50">
                        <TableRow>
                          <TableHead>ID / Nama</TableHead>
                          <TableHead>Kategori</TableHead>
                          <TableHead>Tanggal Mulai</TableHead>
                          <TableHead className="text-center">Urutan</TableHead>
                          <TableHead>NIPY</TableHead>
                          <TableHead>Status</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {[...nipyPreview.items]
                          .sort((left, right) => {
                            const rank = {
                              conflict: 0,
                              blocked: 1,
                              reserved: 2,
                              ready: 3,
                              existing: 4,
                            };
                            return (
                              rank[left.state] - rank[right.state] ||
                              left.employeeId.localeCompare(right.employeeId)
                            );
                          })
                          .map(item => (
                            <TableRow key={item.employeeId}>
                              <TableCell>
                                <p className="font-mono text-xs text-slate-400">
                                  {item.employeeId}
                                </p>
                                <p className="font-semibold text-slate-900">
                                  {item.name}
                                </p>
                              </TableCell>
                              <TableCell className="text-xs font-medium">
                                {item.category}
                              </TableCell>
                              <TableCell className="font-mono text-xs">
                                {item.startDate || 'BELUM DIISI'}
                              </TableCell>
                              <TableCell className="text-center font-mono font-bold">
                                {item.sequence
                                  ? String(item.sequence).padStart(3, '0')
                                  : '-'}
                              </TableCell>
                              <TableCell className="font-mono font-semibold">
                                {item.proposedNipy || item.currentNipy || '-'}
                              </TableCell>
                              <TableCell>
                                <Badge
                                  className={
                                    item.state === 'ready'
                                      ? 'border-none bg-emerald-100 text-emerald-800'
                                      : item.state === 'reserved'
                                        ? 'border-none bg-amber-100 text-amber-800'
                                        : item.state === 'existing'
                                          ? 'border-none bg-indigo-100 text-indigo-800'
                                          : 'border-none bg-rose-100 text-rose-800'
                                  }
                                >
                                  {item.state === 'ready'
                                    ? 'Siap diterbitkan'
                                    : item.state === 'reserved'
                                      ? item.needsWrite
                                        ? 'Akan direservasi'
                                        : 'Sudah direservasi'
                                      : item.state === 'existing'
                                        ? 'Sudah terbit'
                                        : item.state === 'conflict'
                                          ? 'Konflik'
                                          : 'Terblokir'}
                                </Badge>
                                {item.reason && (
                                  <p className="mt-1 max-w-[220px] text-[11px] leading-snug text-slate-500">
                                    {item.reason}
                                  </p>
                                )}
                              </TableCell>
                            </TableRow>
                          ))}
                      </TableBody>
                    </Table>
                  </div>
                </div>
              </div>
            ) : (
              <div className="min-h-48 flex items-center justify-center text-slate-500">
                Pratinjau tidak tersedia.
              </div>
            )}
          </div>

          <DialogFooter className="p-6 bg-slate-50 border-t border-slate-100 flex gap-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => loadNipyPreview().catch(() => undefined)}
              disabled={nipyLoading || nipyApplying}
              className="rounded-xl"
            >
              {nipyLoading && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
              Muat Ulang
            </Button>
            <Button
              type="button"
              onClick={handleApplyNipyPreview}
              disabled={
                !nipyPreview ||
                nipyApplying ||
                nipyPreview.summary.pendingWrites < 1 ||
                nipyPreview.summary.blocked > 0 ||
                nipyPreview.summary.conflicts > 0
              }
              className="rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white"
            >
              {nipyApplying ? (
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
              ) : (
                <Fingerprint className="w-4 h-4 mr-2" />
              )}
              Terbitkan dan Reservasi
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

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
                    <div className="space-y-2">
                      <Label>NIPY / NIY Presensi</Label>
                      <Input
                        value={formData.personal_info?.employee_id_niy || ''}
                        onChange={e =>
                          updateNestedField(
                            'personal_info',
                            'employee_id_niy',
                            normalizeNipy(e.target.value),
                          )
                        }
                        disabled={!canEditNipy || saving}
                        className="rounded-xl border-slate-200 font-mono"
                        placeholder="Harus sama persis dengan NIPY/PIN pada file presensi"
                      />
                    </div>
                    <div className="space-y-2">
                      <Label>NIK (Nomor Induk Kependudukan)</Label>
                      <Input
                        value={formData.personal_info?.nik || ''}
                        onChange={e => updateNestedField('personal_info', 'nik', e.target.value)}
                        className="rounded-xl border-slate-200"
                        placeholder="Contoh: 351710..."
                      />
                    </div>
                    <div className="space-y-2"><Label>NPWP</Label><Input value={formData.personal_info?.tax_id_npwp || ''} onChange={e => updateNestedField('personal_info', 'tax_id_npwp', e.target.value)} className="rounded-xl border-slate-200" /></div>
                    <div className="space-y-2"><Label>Nomor WhatsApp/HP</Label><Input value={formData.personal_info?.phone || ''} onChange={e => updateNestedField('personal_info', 'phone', e.target.value)} className="rounded-xl border-slate-200" placeholder="Contoh: 08123456789" /></div>
                    <div className="space-y-2"><Label>Alamat Email</Label><Input type="email" value={formData.personal_info?.email || ''} onChange={e => updateNestedField('personal_info', 'email', e.target.value)} className="rounded-xl border-slate-200" placeholder="Contoh: nama@domain.com" /></div>
                  </div>
                  <div className="space-y-4">
                    <h3 className="text-sm font-bold text-slate-900 uppercase tracking-wider">Pekerjaan</h3>
                    <div className="space-y-2">
                      <Label>Jabatan</Label>
                      <Input
                        placeholder="Belum ada jabatan struktural"
                        value={formData.employment_profile?.job_role || ''}
                        readOnly
                        disabled
                        className="rounded-xl border-slate-200 bg-slate-50 text-slate-500 cursor-not-allowed"
                      />
                    </div>
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
                    <div className="space-y-2"><Label>Tanggal Diakui</Label><Input type="date" value={formData.employment_profile?.date_recognized || ''} onChange={e => updateNestedField('employment_profile', 'date_recognized', e.target.value)} /></div>
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
                      <div className="space-y-2">
                        <Label>Golongan</Label>
                        <Select
                          value={formData.academic_and_tier?.level_code || ''}
                          onValueChange={(val) => updateNestedField('academic_and_tier', 'level_code', val)}
                        >
                          <SelectTrigger className="rounded-xl border-slate-200 bg-white text-xs h-10 w-full">
                            <SelectValue placeholder="Pilih Golongan" />
                          </SelectTrigger>
                          <SelectContent className="bg-white rounded-xl border-slate-100 shadow-xl max-h-48 overflow-y-auto z-[9999]">
                            {(() => {
                              const defaultWhiteGrades = [
                                'A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J', 'K', 'L',
                                'M', 'N', 'O', 'P', 'Q', 'R', 'S', 'T', 'U', 'V', 'W', 'X',
                                'Y', 'Z', 'AA', 'AB', 'AC', 'AD'
                              ];
                              const whiteGrades = gradeCodesWhite && gradeCodesWhite.length > 0 ? gradeCodesWhite : defaultWhiteGrades;
                              const currentVal = formData.academic_and_tier?.level_code;
                              const options = currentVal && !whiteGrades.includes(currentVal)
                                ? [...whiteGrades, currentVal]
                                : whiteGrades;
                              return options.map(code => (
                                <SelectItem key={code} value={code} className="text-xs">
                                  {code}
                                </SelectItem>
                              ));
                            })()}
                          </SelectContent>
                        </Select>
                      </div>
                      <div className="space-y-2">
                        <Label>Beban Kerja</Label>
                        <Select
                          value={formData.academic_and_tier?.functional_tier !== undefined && formData.academic_and_tier?.functional_tier !== null && formData.academic_and_tier?.functional_tier !== '' ? String(formData.academic_and_tier.functional_tier) : ''}
                          onValueChange={(val) => updateNestedField('academic_and_tier', 'functional_tier', val !== undefined && val !== null && val !== '' ? Number(val) : null)}
                        >
                          <SelectTrigger className="rounded-xl border-slate-200 bg-white text-xs h-10 w-full">
                            <SelectValue placeholder="Pilih Beban Kerja" />
                          </SelectTrigger>
                          <SelectContent className="bg-white rounded-xl border-slate-100 shadow-xl max-h-48 overflow-y-auto z-[9999]">
                            {Array.from({ length: 17 }, (_, idx) => String(idx)).map((tierCode) => (
                              <SelectItem key={tierCode} value={tierCode} className="text-xs">
                                Beban {tierCode}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                    </div>
                    <div className="space-y-2">
                      <Label>Kredit Kumulatif</Label>
                      <Select
                        value={formData.kepangkatan?.cummulativeCredit !== undefined && formData.kepangkatan?.cummulativeCredit !== null ? String(formData.kepangkatan.cummulativeCredit) : '0'}
                        onValueChange={(val) => updateNestedField('kepangkatan', 'cummulativeCredit', Number(val) || 0)}
                      >
                        <SelectTrigger className="rounded-xl border-slate-200 bg-white text-xs h-10 w-full">
                          <SelectValue placeholder="Pilih Kredit Kumulatif" />
                        </SelectTrigger>
                        <SelectContent className="bg-white rounded-xl border-slate-100 shadow-xl max-h-48 overflow-y-auto z-[9999]">
                          {(() => {
                            const credits = [0, 100, 150, 200, 300, 400, 550, 700, 850, 1050];
                            const creditLabels: Record<number, string> = {
                              0: '0 / Belum Ada',
                              100: '100 (Asisten Ahli)',
                              150: '150 (Asisten Ahli)',
                              200: '200 (Lektor A)',
                              300: '300 (Lektor B)',
                              400: '400 (Lektor Kepala)',
                              550: '550 (Lektor Kepala)',
                              700: '700 (Lektor Kepala)',
                              850: '850 (Guru Besar)',
                              1050: '1050 (Guru Besar)'
                            };
                            const currentVal = formData.kepangkatan?.cummulativeCredit;
                            const options = currentVal !== undefined && currentVal !== null && !credits.includes(Number(currentVal))
                              ? [...credits, Number(currentVal)].sort((a, b) => a - b)
                              : credits;
                            return options.map(val => (
                              <SelectItem key={val} value={String(val)} className="text-xs">
                                {creditLabels[val] || String(val)}
                              </SelectItem>
                            ));
                          })()}
                        </SelectContent>
                      </Select>
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
                  <div className="col-span-3 pt-4 border-t border-slate-100 space-y-4">
                    <h3 className="text-sm font-bold text-slate-900 uppercase tracking-wider flex items-center gap-2">
                      <Coins className="w-4 h-4 text-indigo-500" />
                      Nilai Konstanta Gaji &amp; Potongan
                    </h3>

                    {/* Tunjangan / Earnings */}
                    <div className="p-4 bg-emerald-50/70 rounded-2xl border border-emerald-100 space-y-3">
                      <h4 className="text-xs font-bold text-emerald-800 uppercase tracking-wider">Tunjangan Tetap (Earning)</h4>
                      <div className="grid grid-cols-5 gap-3">
                        <div className="space-y-2">
                          <Label className="text-[10px] font-semibold text-slate-500 uppercase tracking-wider">T. BPJS TK (Rp)</Label>
                          <div className="flex items-center h-8 rounded-xl bg-white border border-slate-200 px-2.5 focus-within:border-emerald-400 focus-within:ring-1 focus-within:ring-emerald-200 transition-all">
                            <span className="text-xs font-semibold text-slate-400 mr-1 select-none">Rp</span>
                            <input
                              type="text"
                              value={formData.bpjs?.t_bpjs_tk ? formatNumberWithDots(formData.bpjs.t_bpjs_tk) : ''}
                              onChange={e => updateNestedField('bpjs', 't_bpjs_tk', parseDotsToNumber(e.target.value))}
                              placeholder="0"
                              className="w-full bg-transparent border-none p-0 h-full text-right text-sm outline-none focus:outline-none focus:ring-0 focus:border-none tabular-nums text-slate-900 font-sans"
                            />
                          </div>
                        </div>
                        <div className="space-y-2">
                          <Label className="text-[10px] font-semibold text-slate-500 uppercase tracking-wider">T. BPJS KES (Rp)</Label>
                          <div className="flex items-center h-8 rounded-xl bg-white border border-slate-200 px-2.5 focus-within:border-emerald-400 focus-within:ring-1 focus-within:ring-emerald-200 transition-all">
                            <span className="text-xs font-semibold text-slate-400 mr-1 select-none">Rp</span>
                            <input
                              type="text"
                              value={formData.bpjs?.t_bpjs_kes ? formatNumberWithDots(formData.bpjs.t_bpjs_kes) : ''}
                              onChange={e => updateNestedField('bpjs', 't_bpjs_kes', parseDotsToNumber(e.target.value))}
                              placeholder="0"
                              className="w-full bg-transparent border-none p-0 h-full text-right text-sm outline-none focus:outline-none focus:ring-0 focus:border-none tabular-nums text-slate-900 font-sans"
                            />
                          </div>
                        </div>
                        <div className="space-y-2">
                          <Label className="text-[10px] font-semibold text-slate-500 uppercase tracking-wider">T. Beras (Rp)</Label>
                          <div className="flex items-center h-8 rounded-xl bg-white border border-slate-200 px-2.5 focus-within:border-emerald-400 focus-within:ring-1 focus-within:ring-emerald-200 transition-all">
                            <span className="text-xs font-semibold text-slate-400 mr-1 select-none">Rp</span>
                            <input
                              type="text"
                              value={formData.salaryProfile?.tunjanganBeras ? formatNumberWithDots(formData.salaryProfile.tunjanganBeras) : ''}
                              onChange={e => updateNestedField('salaryProfile', 'tunjanganBeras', parseDotsToNumber(e.target.value))}
                              placeholder="0"
                              className="w-full bg-transparent border-none p-0 h-full text-right text-sm outline-none focus:outline-none focus:ring-0 focus:border-none tabular-nums text-slate-900 font-sans"
                            />
                          </div>
                        </div>

                        <div className="space-y-2">
                          <Label className="text-[10px] font-semibold text-slate-500 uppercase tracking-wider">T. Instruksional (Rp)</Label>
                          <div className="flex items-center h-8 rounded-xl bg-white border border-slate-200 px-2.5 focus-within:border-emerald-400 focus-within:ring-1 focus-within:ring-emerald-200 transition-all">
                            <span className="text-xs font-semibold text-slate-400 mr-1 select-none">Rp</span>
                            <input
                              type="text"
                              value={formData.t_instruksional ? formatNumberWithDots(formData.t_instruksional) : ''}
                              onChange={e => setFormData((prev: any) => ({ ...prev, t_instruksional: parseDotsToNumber(e.target.value) }))}
                              placeholder="0"
                              className="w-full bg-transparent border-none p-0 h-full text-right text-sm outline-none focus:outline-none focus:ring-0 focus:border-none tabular-nums text-slate-900 font-sans"
                            />
                          </div>
                        </div>
                      </div>
                    </div>

                    {/* Potongan / Deductions */}
                    <div className="p-4 bg-rose-50/70 rounded-2xl border border-rose-100 space-y-3">
                      <h4 className="text-xs font-bold text-rose-800 uppercase tracking-wider">Potongan Tetap (Deduction)</h4>
                      <div className="grid grid-cols-5 gap-3">
                        <div className="space-y-2">
                          <Label className="text-[10px] font-semibold text-slate-500 uppercase tracking-wider">Potongan BPJS (Rp)</Label>
                          <div className="flex items-center h-8 rounded-xl bg-white border border-slate-200 px-2.5 focus-within:border-red-400 focus-within:ring-1 focus-within:ring-red-200 transition-all">
                            <span className="text-xs font-semibold text-slate-400 mr-1 select-none">Rp</span>
                            <input
                              type="text"
                              value={formData.bpjs?.deductionAmount ? formatNumberWithDots(formData.bpjs.deductionAmount) : ''}
                              onChange={e => updateNestedField('bpjs', 'deductionAmount', parseDotsToNumber(e.target.value))}
                              placeholder="0"
                              className="w-full bg-transparent border-none p-0 h-full text-right text-sm outline-none focus:outline-none focus:ring-0 focus:border-none tabular-nums text-slate-900 font-sans"
                            />
                          </div>
                        </div>
                        <div className="space-y-2">
                          <Label className="text-[10px] font-semibold text-slate-500 uppercase tracking-wider">Potongan Tabungan (Rp)</Label>
                          <div className="flex items-center h-8 rounded-xl bg-white border border-slate-200 px-2.5 focus-within:border-red-400 focus-within:ring-1 focus-within:ring-red-200 transition-all">
                            <span className="text-xs font-semibold text-slate-400 mr-1 select-none">Rp</span>
                            <input
                              type="text"
                              value={formData.savings?.deductionAmount ? formatNumberWithDots(formData.savings.deductionAmount) : ''}
                              onChange={e => updateNestedField('savings', 'deductionAmount', parseDotsToNumber(e.target.value))}
                              placeholder="0"
                              className="w-full bg-transparent border-none p-0 h-full text-right text-sm outline-none focus:outline-none focus:ring-0 focus:border-none tabular-nums text-slate-900 font-sans"
                            />
                          </div>
                        </div>
                        <div className="space-y-2">
                          <Label className="text-[10px] font-semibold text-slate-500 uppercase tracking-wider">Potongan Zakat Infaq (Rp)</Label>
                          <div className="flex items-center h-8 rounded-xl bg-white border border-slate-200 px-2.5 focus-within:border-red-400 focus-within:ring-1 focus-within:ring-red-200 transition-all">
                            <span className="text-xs font-semibold text-slate-400 mr-1 select-none">Rp</span>
                            <input
                              type="text"
                              value={formData.ziz?.deductionAmount ? formatNumberWithDots(formData.ziz.deductionAmount) : ''}
                              onChange={e => updateNestedField('ziz', 'deductionAmount', parseDotsToNumber(e.target.value))}
                              placeholder="0"
                              className="w-full bg-transparent border-none p-0 h-full text-right text-sm outline-none focus:outline-none focus:ring-0 focus:border-none tabular-nums text-slate-900 font-sans"
                            />
                          </div>
                        </div>
                        <div className="space-y-2">
                          <Label className="text-[10px] font-semibold text-slate-500 uppercase tracking-wider">BNI Simponi / THT (Rp)</Label>
                          <div className="flex items-center h-8 rounded-xl bg-white border border-slate-200 px-2.5 focus-within:border-red-400 focus-within:ring-1 focus-within:ring-red-200 transition-all">
                            <span className="text-xs font-semibold text-slate-400 mr-1 select-none">Rp</span>
                            <input
                              type="text"
                              value={formData.tht?.deductionAmount ? formatNumberWithDots(formData.tht.deductionAmount) : ''}
                              onChange={e => updateNestedField('tht', 'deductionAmount', parseDotsToNumber(e.target.value))}
                              placeholder="0"
                              className="w-full bg-transparent border-none p-0 h-full text-right text-sm outline-none focus:outline-none focus:ring-0 focus:border-none tabular-nums text-slate-900 font-sans"
                            />
                          </div>
                        </div>
                        <div className="space-y-2">
                          <Label className="text-[10px] font-semibold text-slate-500 uppercase tracking-wider">Potongan Pinlu (Rp)</Label>
                          <div className="flex items-center h-8 rounded-xl bg-white border border-slate-200 px-2.5 focus-within:border-red-400 focus-within:ring-1 focus-within:ring-red-200 transition-all">
                            <span className="text-xs font-semibold text-slate-400 mr-1 select-none">Rp</span>
                            <input
                              type="text"
                              value={formData.pinlu?.deductionAmount ? formatNumberWithDots(formData.pinlu.deductionAmount) : ''}
                              onChange={e => updateNestedField('pinlu', 'deductionAmount', parseDotsToNumber(e.target.value))}
                              placeholder="0"
                              className="w-full bg-transparent border-none p-0 h-full text-right text-sm outline-none focus:outline-none focus:ring-0 focus:border-none tabular-nums text-slate-900 font-sans"
                            />
                          </div>
                        </div>
                      </div>
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
                          className="rounded-xl border-slate-200 text-sm h-8 bg-white"
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
                          <SelectTrigger className="rounded-xl border-slate-200 bg-white text-sm h-8 w-full">
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
                        <div className="flex items-center h-8 rounded-xl bg-white border border-slate-200 px-2.5 focus-within:border-emerald-400 focus-within:ring-1 focus-within:ring-emerald-200 transition-all">
                          <span className="text-xs font-semibold text-slate-400 mr-1 select-none">Rp</span>
                          <input
                            type="text"
                            value={newPosAllowance ? formatNumberWithDots(newPosAllowance) : ''}
                            onChange={(e) => {
                              const parsed = parseDotsToNumber(e.target.value);
                              setNewPosAllowance(parsed || '');
                            }}
                            placeholder="0"
                            className="w-full bg-transparent border-none p-0 h-full text-right text-sm outline-none focus:outline-none focus:ring-0 focus:border-none tabular-nums text-slate-900 font-sans"
                          />
                        </div>
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
                        className="bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl text-xs font-bold h-8 px-4 cursor-pointer shrink-0"
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
                    <div className="space-y-2">
                      <Label htmlFor="nipy">NIPY Presensi</Label>
                      <Input
                        id="nipy"
                        value={
                          formData.nipy ||
                          (formData.nipyAssignment?.status === 'reserved'
                            ? `Nomor urut ${String(formData.nipyAssignment?.sequence || '').padStart(3, '0')} direservasi`
                            : 'Diterbitkan otomatis setelah data disimpan')
                        }
                        readOnly
                        className="rounded-xl border-slate-200 bg-slate-50 font-mono text-slate-600"
                      />
                      <p className="text-[11px] leading-relaxed text-slate-500">
                        {formData.nipy
                          ? `NIPY permanen · kode ${formData.nipyAssignment?.prefixCode || formData.nipy.slice(0, 2)} · urutan ${String(formData.nipyAssignment?.sequence || formData.nipy.slice(-3)).padStart(3, '0')}`
                          : formData.nipyAssignment?.status === 'reserved'
                            ? 'Isi tanggal mulai kerja untuk menyelesaikan NIPY dari nomor yang telah direservasi.'
                            : 'Formula memakai kategori, tanggal mulai kerja DDMMYY, dan urutan kategori.'}
                      </p>
                      {formData.nipy &&
                        formData.nipyAssignment &&
                        (formData.nipyAssignment.sourceStartDate !==
                          formData.employment?.startDate ||
                          formData.nipyAssignment.categoryGroup !==
                            getPekaryaNipyGroup(
                              formData.employment?.jobCategory,
                            )) && (
                          <p className="rounded-lg bg-amber-50 px-2.5 py-2 text-[11px] font-medium text-amber-800">
                            Kategori atau tanggal mulai telah berubah. NIPY tetap
                            permanen; koreksi penerbitan hanya dapat dilakukan
                            Superadmin dengan alasan audit.
                          </p>
                        )}
                      {profile?.role === 'super_admin' &&
                        editingEmployee?.nipy &&
                        editingEmployee?.nipyAssignment &&
                        (editingEmployee.nipyAssignment.sourceStartDate !==
                          editingEmployee.employment?.startDate ||
                          editingEmployee.nipyAssignment.categoryGroup !==
                            getPekaryaNipyGroup(
                              editingEmployee.employment?.jobCategory,
                            )) && (
                          <Button
                            type="button"
                            variant="outline"
                            onClick={() => {
                              setNipyCorrectionEmployee(editingEmployee);
                              setNipyCorrectionReason('');
                              setIsDialogOpen(false);
                            }}
                            className="h-9 w-full rounded-xl border-amber-200 bg-amber-50 text-xs font-semibold text-amber-800 hover:bg-amber-100"
                          >
                            Koreksi NIPY dari Data Tersimpan
                          </Button>
                        )}
                    </div>
                    <div className="space-y-2"><Label htmlFor="nik">NIK (Nomor Induk Kependudukan)</Label><Input id="nik" value={formData.nik || ''} onChange={e => setFormData({ ...formData, nik: e.target.value })} className="rounded-xl border-slate-200" /></div>
                    <div className="space-y-2"><Label htmlFor="phoneNumber">Nomor WhatsApp/HP</Label><Input id="phoneNumber" value={formData.phoneNumber || ''} onChange={e => setFormData({ ...formData, phoneNumber: e.target.value })} className="rounded-xl border-slate-200" placeholder="Contoh: 08123456789" /></div>
                    <div className="space-y-2"><Label htmlFor="email">Alamat Email</Label><Input id="email" type="email" value={formData.email || ''} onChange={e => setFormData({ ...formData, email: e.target.value })} className="rounded-xl border-slate-200" placeholder="Contoh: nama@domain.com" /></div>
                  </div>
                  <div className="space-y-4">
                    <h3 className="text-sm font-bold text-slate-900 uppercase tracking-wider">Pekerjaan</h3>
                    <div className="space-y-2">
                      <Label>Kategori</Label>
                      <Select value={formData.employment?.jobCategory} onValueChange={val => setFormData((prev: any) => ({ ...prev, employment: { ...(prev.employment || { status: 'active', startDate: '', endDate: null }), jobCategory: val } as any }))}>
                        <SelectTrigger className="rounded-xl border-slate-200">
                          <SelectValue>
                            {formData.employment?.jobCategory || 'Pilih Kategori'}
                          </SelectValue>
                        </SelectTrigger>
                        <SelectContent>{JOB_CATEGORIES.map(cat => <SelectItem key={cat} value={cat}>{cat}</SelectItem>)}</SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-2"><Label>Tanggal Mulai</Label><Input type="date" required={!editingEmployee && formData.flags?.isActive !== false} value={formData.employment?.startDate || ''} onChange={e => setFormData((prev: any) => ({ ...prev, employment: { ...(prev.employment || { status: 'active', jobCategory: 'OTHER', endDate: null }), startDate: e.target.value } as any }))} className="rounded-xl border-slate-200" /></div>
                    <div className="space-y-2">
                      <Label>Golongan (Grade)</Label>
                      <Select
                        value={formData.salaryProfile?.salaryGradeCode || ''}
                        onValueChange={(val) => setFormData((prev: any) => ({
                          ...prev,
                          salaryProfile: {
                            ...(prev.salaryProfile || { baseSalaryAmount: 0, salaryMatrixVersion: '2026_v1' }),
                            salaryGradeCode: val
                          } as any
                        }))}
                      >
                        <SelectTrigger className="rounded-xl border-slate-200 bg-white text-xs h-10 w-full">
                          <SelectValue placeholder="Pilih Golongan" />
                        </SelectTrigger>
                        <SelectContent className="bg-white rounded-xl border-slate-100 shadow-xl max-h-48 overflow-y-auto z-[9999]">
                          {(() => {
                            const defaultBlueGrades = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J', 'K', 'L', 'M', 'N', 'O', 'P', 'Q', 'R'];
                            const blueGrades = gradeCodesBlue && gradeCodesBlue.length > 0 ? gradeCodesBlue : defaultBlueGrades;
                            const currentVal = formData.salaryProfile?.salaryGradeCode;
                            const options = currentVal && !blueGrades.includes(currentVal)
                              ? [...blueGrades, currentVal]
                              : blueGrades;
                            return options.map(code => (
                              <SelectItem key={code} value={code} className="text-xs">
                                {code}
                              </SelectItem>
                            ));
                          })()}
                        </SelectContent>
                      </Select>
                    </div>
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
              Batal Simpan
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
