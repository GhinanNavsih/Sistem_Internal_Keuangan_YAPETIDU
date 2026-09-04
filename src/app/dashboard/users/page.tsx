"use client";

import React, { useState, useEffect, useMemo, useRef } from 'react';
import { FloatingSnackbar } from '@/components/ui/floating-snackbar';
import GlobalHeader from '@/components/GlobalHeader';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { getEmployeeActivitiesPath } from '@/lib/employeeActivities';
import { useAuth } from '@/lib/AuthContext';
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
} from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
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
  DialogFooter,
} from '@/components/ui/dialog';
import {
  ArrowLeft,
  UserPlus,
  Users,
  Search,
  Pencil,
  UserX,
  Loader2,
  CheckCircle2,
  AlertTriangle,
  AlertCircle,
  UserCog,
  Mail,
  Lock,
  User,
  Shield,
  Layers,
  ChevronRight,
  RefreshCw,
  Eye,
  EyeOff,
  KeyRound,
} from 'lucide-react';
import { db } from '@/lib/firebase';
import { usePayrollCacheInvalidation } from '@/lib/queries/hooks';
import { collection, getDocsFromServer } from 'firebase/firestore';
import { SUPPORTED_CATEGORIES } from '@/utils/rekapConfig';
import { getSatpamShiftForTeam } from '@/utils/satpamRotation';
import { UserRole } from '@/lib/payroll/roles';

interface ManagedUser {
  uid: string;
  email: string;
  displayName?: string;
  role: UserRole;
  permittedCategories: string[];
  linkedEmployeeId?: string;
  createdAt?: string;
  disabled?: boolean;
}

interface CleaningEmployee {
  id: string;
  name: string;
  category: string;
}

interface DropdownEmployee {
  id: string;
  name: string;
  type?: 'Pekarya' | 'Loyalis' | 'Lainnya';
  detail?: string;
  category?: string;
  email?: string;
}

export default function UserManagementPage() {
  const router = useRouter();
  const {
    user,
    profile,
    realProfile,
    loading: authLoading,
    startUiImpersonation,
    startCustomTokenImpersonation,
    isCustomTokenImpersonating,
  } = useAuth();
  const { invalidateReference } = usePayrollCacheInvalidation();

  const [impersonatingUid, setImpersonatingUid] = useState<string | null>(null);
  const [previewingUid, setPreviewingUid] = useState<string | null>(null);

  const actualRole = realProfile?.role || profile?.role;

  // Redirect if not super admin (additional client guard beyond ProtectedRoute)
  useEffect(() => {
    if (!authLoading && (!user || (actualRole !== 'super_admin' && !isCustomTokenImpersonating))) {
      router.replace('/dashboard/payroll');
    }
  }, [user, profile, realProfile, actualRole, authLoading, isCustomTokenImpersonating, router]);

  const handleCustomTokenLogin = async (targetUser: ManagedUser) => {
    try {
      setImpersonatingUid(targetUser.uid);
      await startCustomTokenImpersonation(targetUser.uid);
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Gagal melakukan impersonasi custom token.');
    } finally {
      setImpersonatingUid(null);
    }
  };

  const handleStartUiImpersonation = async (targetUser: ManagedUser) => {
    try {
      setPreviewingUid(targetUser.uid);
      const previewProfile = await startUiImpersonation(targetUser as any);

      const roleStr = (previewProfile?.role || targetUser.role) as string;
      if (roleStr === 'honorer' || roleStr === 'ketua_shift_satpam') {
        router.push(getEmployeeActivitiesPath(previewProfile || targetUser));
      } else if (roleStr === 'loyalis') {
        router.push('/employee/payslip');
      } else if (roleStr === 'satker_head') {
        router.push('/dashboard/payroll/activity-review');
      } else if (roleStr === 'satker_head_loyalis') {
        router.push('/dashboard/payroll/uraian');
      } else if (roleStr === 'loyalis_presence_admin') {
        router.push('/dashboard/payroll/uraian/presensi-loyalis-raw');
      } else if (roleStr === 'employee_admin') {
        router.push('/dashboard/employees');
      } else {
        router.push('/dashboard/payroll');
      }
    } catch (error) {
      console.error('Unable to start UI preview:', error);
      setErrorMsg(error instanceof Error ? error.message : 'Gagal memulai Preview UI.');
    } finally {
      setPreviewingUid(null);
    }
  };

  // Page states
  const [users, setUsers] = useState<ManagedUser[]>([]);
  const [loadingUsers, setLoadingUsers] = useState(true);
  const [dynamicCategories, setDynamicCategories] = useState<string[]>(SUPPORTED_CATEGORIES);
  const [searchQuery, setSearchQuery] = useState('');

  // Combined active employees for selection
  const [allEmployees, setAllEmployees] = useState<DropdownEmployee[]>([]);
  
  // Suggestion visibility states
  const [showNewNameSuggestions, setShowNewNameSuggestions] = useState(false);
  const [showEditNameSuggestions, setShowEditNameSuggestions] = useState(false);

  // Notifications
  const [successMsg, setSuccessMsg] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [actionLoading, setActionLoading] = useState(false);
  const isActionLoadingRef = useRef(false);

  // New User form state
  const [showAddForm, setShowAddForm] = useState(false);
  const [newEmail, setNewEmail] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [showNewPassword, setShowNewPassword] = useState(false);
  const [newDisplayName, setNewDisplayName] = useState('');
  const [newRole, setNewRole] = useState<UserRole>('satker_head');
  const [newPermitted, setNewPermitted] = useState<string[]>([]);
  const [newLinkedEmployeeId, setNewLinkedEmployeeId] = useState('');
  const [newEmployeeSearchText, setNewEmployeeSearchText] = useState('');
  const [showNewEmployeeSuggestions, setShowNewEmployeeSuggestions] = useState(false);

  // Cleaning employees for honorer linking
  const [cleaningEmployees, setCleaningEmployees] = useState<CleaningEmployee[]>([]);

  // Edit User modal state
  const [editingUser, setEditingUser] = useState<ManagedUser | null>(null);
  const [editDisplayName, setEditDisplayName] = useState('');
  const [editEmail, setEditEmail] = useState('');
  const [editRole, setEditRole] = useState<UserRole>('satker_head');
  const [editPermitted, setEditPermitted] = useState<string[]>([]);
  const [editLinkedEmployeeId, setEditLinkedEmployeeId] = useState('');
  const [editEmployeeSearchText, setEditEmployeeSearchText] = useState('');
  const [showEditEmployeeSuggestions, setShowEditEmployeeSuggestions] = useState(false);

  // Satpam Shift Teams dynamic configuration states
  const [shiftTeams, setShiftTeams] = useState<any[]>([]);
  const [newTeamNumber, setNewTeamNumber] = useState<string>('1');
  const [newTeamMembers, setNewTeamMembers] = useState<string[]>([]);
  const [editTeamNumber, setEditTeamNumber] = useState<string>('1');
  const [editTeamMembers, setEditTeamMembers] = useState<string[]>([]);

  // Delete User modal state
  const [deletingUser, setDeletingUser] = useState<ManagedUser | null>(null);

  // Fetch users & categories
  const fetchData = async () => {
    if (!user) return;
    setLoadingUsers(true);
    setErrorMsg(null);
    try {
      // 1. Fetch available categories from Employees and build dropdown choices
      const [empSnapshot, loyalisSnapshot] = await Promise.all([
        getDocsFromServer(collection(db, 'Employees_BlueCollar')),
        getDocsFromServer(collection(db, 'Employees_Loyalis'))
      ]);

      const cats = new Set<string>(SUPPORTED_CATEGORIES);
      empSnapshot.docs.forEach(docSnap => {
        const cat = docSnap.data()?.employment?.jobCategory;
        if (cat) cats.add(cat);
      });
      setDynamicCategories(Array.from(cats).sort());

      // Also build list of Pekarya employees for honorer linking
      const cleaningList: CleaningEmployee[] = empSnapshot.docs
        .map(docSnap => ({
          id: docSnap.id,
          name: docSnap.data()?.name || '',
          category: docSnap.data()?.employment?.jobCategory || '',
        }))
        .sort((a, b) => a.name.localeCompare(b.name));
      setCleaningEmployees(cleaningList);

      // Build consolidated list of employees for dropdown selection
      const dropdownEmps: DropdownEmployee[] = [];
      empSnapshot.docs.forEach(docSnap => {
        const data = docSnap.data();
        if (data?.employment?.status === 'active') {
          dropdownEmps.push({
            id: docSnap.id,
            name: data.name || '',
            type: 'Pekarya',
            detail: data.employment?.jobCategory || '',
            email: data.email || '',
          });
        }
      });

      loyalisSnapshot.docs.forEach(docSnap => {
        const data = docSnap.data();
        if (data?.personal_info?.status === 'AKTIF') {
          dropdownEmps.push({
            id: docSnap.id,
            name: data.personal_info?.name || '',
            type: 'Loyalis',
            detail: data.employment_profile?.department_unit || '',
            email: data.personal_info?.email || '',
          });
        }
      });
      dropdownEmps.sort((a, b) => a.name.localeCompare(b.name));
      setAllEmployees(dropdownEmps);

      // 2. Fetch all user profiles from our API
      const idToken = await user.getIdToken();
      const res = await fetch(`/api/admin/users?t=${Date.now()}`, {
        headers: {
          'Authorization': `Bearer ${idToken}`,
        },
        cache: 'no-store',
      });

      if (!res.ok) {
        const errData = await res.json();
        throw new Error(errData.error || 'Gagal memuat daftar pengguna.');
      }

      const data = await res.json();
      setUsers(data.users || []);

      // 3. Fetch Satpam shift teams
      const shiftTeamsSnap = await getDocsFromServer(collection(db, 'SatpamShiftTeams'));
      const teamsList = shiftTeamsSnap.docs.map(docSnap => ({
        id: docSnap.id,
        ...docSnap.data()
      }));
      setShiftTeams(teamsList);
    } catch (err: any) {
      console.error('Error fetching data:', err);
      setErrorMsg(err.message || 'Terjadi kesalahan saat memuat data.');
    } finally {
      setLoadingUsers(false);
    }
  };

  useEffect(() => {
    if (user && profile?.role === 'super_admin') {
      fetchData();
    }
  }, [user, profile]);

  // Handle auto-clearing notifications
  useEffect(() => {
    if (successMsg) {
      const timer = setTimeout(() => setSuccessMsg(null), 5000);
      return () => clearTimeout(timer);
    }
  }, [successMsg]);

  useEffect(() => {
    if (errorMsg) {
      const timer = setTimeout(() => setErrorMsg(null), 7000);
      return () => clearTimeout(timer);
    }
  }, [errorMsg]);

  // Filtered users computed property
  const filteredUsers = useMemo(() => {
    return users.filter(u => {
      const query = searchQuery.toLowerCase();
      return (
        u.email.toLowerCase().includes(query) ||
        (u.displayName || '').toLowerCase().includes(query) ||
        u.role.toLowerCase().includes(query)
      );
    });
  }, [users, searchQuery]);

  // Handle multi-category selection toggle for NEW user
  const handleToggleNewPermitted = (cat: string) => {
    setNewPermitted(prev =>
      prev.includes(cat) ? prev.filter(c => c !== cat) : [...prev, cat]
    );
  };

  // Handle multi-category selection toggle for EDIT user
  const handleToggleEditPermitted = (cat: string) => {
    setEditPermitted(prev =>
      prev.includes(cat) ? prev.filter(c => c !== cat) : [...prev, cat]
    );
  };

  // Add User submit handler
  const handleAddUser = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user || isActionLoadingRef.current) return;
    if (!newEmail || !newPassword) {
      setErrorMsg('Email dan Password wajib diisi.');
      return;
    }
    if (newRole === 'ketua_shift_satpam') {
      if (!newLinkedEmployeeId) {
        setErrorMsg('Konfigurasi Regu Satpam belum lengkap: Pilih 1 Ketua Shift Satpam terlebih dahulu.');
        return;
      }
      if (newTeamMembers.length !== 9) {
        setErrorMsg(`Konfigurasi Regu Satpam belum lengkap: Wajib memilih tepat 9 anggota regu (saat ini terpilih ${newTeamMembers.length} anggota).`);
        return;
      }
    }

    isActionLoadingRef.current = true;
    setActionLoading(true);
    setErrorMsg(null);
    setSuccessMsg(null);

    try {
      const idToken = await user.getIdToken();
      const res = await fetch('/api/admin/users', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${idToken}`,
        },
        body: JSON.stringify({
          email: newEmail,
          password: newPassword,
          displayName: newDisplayName,
          role: newRole,
          permittedCategories: (newRole === 'honorer' || newRole === 'loyalis' || newRole === 'ketua_shift_satpam') ? (newLinkedEmployeeId ? [allEmployees.find(e => e.id === newLinkedEmployeeId)?.detail || ''] : []) : newPermitted,
          linkedEmployeeId: (newRole === 'honorer' || newRole === 'loyalis' || newRole === 'ketua_shift_satpam') ? newLinkedEmployeeId : undefined,
        }),
      });

      if (!res.ok) {
        const errData = await res.json();
        throw new Error(errData.error || 'Gagal membuat pengguna baru.');
      }

      if (newRole === 'ketua_shift_satpam') {
        const teamResponse = await fetch('/api/admin/satpam-teams', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${idToken}`,
          },
          body: JSON.stringify({
            teamId: `team_${newTeamNumber}`,
            ketuaShiftId: newLinkedEmployeeId,
            memberEmployeeIds: newTeamMembers,
            reason: 'Konfigurasi regu untuk akun Ketua Shift baru',
          }),
        });
        if (!teamResponse.ok) {
          const teamError = await teamResponse.json();
          throw new Error(
            `${teamError.error || 'Konfigurasi regu gagal.'} Akun sudah dibuat; perbaiki konfigurasi regu lalu simpan ulang.`,
          );
        }
        // The rekap page reads shift teams from the reference cache.
        void invalidateReference();
      }

      setSuccessMsg(`Akun ${newEmail} berhasil dibuat!`);
      // Reset form
      setNewEmail('');
      setNewPassword('');
      setNewDisplayName('');
      setNewRole('satker_head');
      setNewPermitted([]);
      setNewLinkedEmployeeId('');
      setNewEmployeeSearchText('');
      setNewTeamNumber('1');
      setNewTeamMembers([]);
      setShowAddForm(false);

      // Refresh list
      router.refresh();
      await fetchData();
    } catch (err: any) {
      setErrorMsg(err.message || 'Terjadi kesalahan saat memproses data.');
    } finally {
      isActionLoadingRef.current = false;
      setActionLoading(false);
    }
  };

  // Open Edit Dialog and pre-populate state
  const openEditDialog = (u: ManagedUser) => {
    setErrorMsg(null);
    setEditingUser(u);
    setEditDisplayName(u.displayName || '');
    setEditEmail(u.email || '');
    setEditRole(u.role);
    setEditPermitted(u.permittedCategories || []);
    setEditLinkedEmployeeId(u.linkedEmployeeId || '');

    // Find the employee in cleaningEmployees
    const matchedEmp = cleaningEmployees.find(emp => emp.id === u.linkedEmployeeId);
    if (matchedEmp) {
      setEditEmployeeSearchText(`${matchedEmp.name} (${matchedEmp.category})`);
    } else {
      setEditEmployeeSearchText('');
    }

    // Set Satpam shift team details if applicable
    const matchedTeam = shiftTeams.find(team => team.ketuaShiftId === u.linkedEmployeeId);
    if (matchedTeam) {
      const num = matchedTeam.id.split('_')[1] || '1';
      setEditTeamNumber(num);
      setEditTeamMembers(matchedTeam.memberEmployeeIds || []);
    } else {
      setEditTeamNumber('1');
      const team1 = shiftTeams.find(t => t.id === 'team_1');
      setEditTeamMembers(team1?.memberEmployeeIds || []);
    }
  };

  // Submit Edit changes
  const handleUpdateUser = async () => {
    if (!user || !editingUser || isActionLoadingRef.current) return;
    if (editRole === 'ketua_shift_satpam') {
      if (!editLinkedEmployeeId) {
        setErrorMsg('Konfigurasi Regu Satpam belum lengkap: Silakan pilih 1 Ketua Shift Satpam terlebih dahulu.');
        return;
      }
      if (editTeamMembers.length !== 9) {
        setErrorMsg(`Konfigurasi Regu Satpam belum lengkap: Wajib memilih tepat 9 anggota regu (saat ini terpilih ${editTeamMembers.length} anggota).`);
        return;
      }
    }
    isActionLoadingRef.current = true;
    setActionLoading(true);
    setErrorMsg(null);

    try {
      const idToken = await user.getIdToken();
      const res = await fetch('/api/admin/users', {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${idToken}`,
        },
        body: JSON.stringify({
          uid: editingUser.uid,
          email: editEmail,
          displayName: editDisplayName,
          role: editRole,
          permittedCategories: (editRole === 'honorer' || editRole === 'loyalis' || editRole === 'ketua_shift_satpam') ? (editLinkedEmployeeId ? [allEmployees.find(e => e.id === editLinkedEmployeeId)?.detail || ''] : []) : editPermitted,
          linkedEmployeeId: (editRole === 'honorer' || editRole === 'loyalis' || editRole === 'ketua_shift_satpam') ? editLinkedEmployeeId : undefined,
        }),
      });

      if (!res.ok) {
        const errData = await res.json();
        throw new Error(errData.error || 'Gagal memperbarui pengguna.');
      }

      if (editRole === 'ketua_shift_satpam') {
        const teamResponse = await fetch('/api/admin/satpam-teams', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${idToken}`,
          },
          body: JSON.stringify({
            teamId: `team_${editTeamNumber}`,
            ketuaShiftId: editLinkedEmployeeId,
            memberEmployeeIds: editTeamMembers,
            reason: 'Perubahan konfigurasi regu oleh Super Administrator',
          }),
        });
        if (!teamResponse.ok) {
          const teamError = await teamResponse.json();
          throw new Error(teamError.error || 'Gagal menyimpan konfigurasi regu.');
        }
        // The rekap page reads shift teams from the reference cache.
        void invalidateReference();
      }

      const updatedCategories = (editRole === 'honorer' || editRole === 'loyalis' || editRole === 'ketua_shift_satpam')
        ? (editLinkedEmployeeId ? [allEmployees.find(e => e.id === editLinkedEmployeeId)?.detail || ''] : [])
        : editPermitted;

      // Update local state directly so UI updates instantly
      setUsers(prevUsers =>
        prevUsers.map(u =>
          u.uid === editingUser.uid
            ? {
                ...u,
                displayName: editDisplayName,
                email: editEmail,
                role: editRole,
                permittedCategories: updatedCategories,
                linkedEmployeeId: (editRole === 'honorer' || editRole === 'loyalis' || editRole === 'ketua_shift_satpam') ? editLinkedEmployeeId : undefined,
              }
            : u
        )
      );

      setSuccessMsg(`Profil ${editingUser.email} berhasil diperbarui.`);
      setEditingUser(null);
      router.refresh();
      await fetchData();
    } catch (err: any) {
      setErrorMsg(err.message || 'Terjadi kesalahan saat menyimpan perubahan.');
    } finally {
      isActionLoadingRef.current = false;
      setActionLoading(false);
    }
  };

  // Open account deactivation confirmation dialog
  const openDeleteDialog = (u: ManagedUser) => {
    setDeletingUser(u);
  };

  // Deactivate the account while retaining its historical profile and references.
  const handleDeleteUser = async () => {
    if (!user || !deletingUser || isActionLoadingRef.current) return;
    isActionLoadingRef.current = true;
    setActionLoading(true);
    setErrorMsg(null);

    try {
      const idToken = await user.getIdToken();
      const res = await fetch(`/api/admin/users?uid=${deletingUser.uid}`, {
        method: 'DELETE',
        headers: {
          'Authorization': `Bearer ${idToken}`,
        },
      });

      if (!res.ok) {
        const errData = await res.json();
        throw new Error(errData.error || 'Gagal menonaktifkan pengguna.');
      }

      setSuccessMsg(`Akun ${deletingUser.email} dinonaktifkan; seluruh riwayat tetap disimpan.`);
      setDeletingUser(null);
      router.refresh();
      await fetchData();
    } catch (err: any) {
      setErrorMsg(err.message || 'Terjadi kesalahan saat menonaktifkan pengguna.');
    } finally {
      isActionLoadingRef.current = false;
      setActionLoading(false);
    }
  };

  if (authLoading || (user && !profile)) {
    return (
      <div className="min-h-screen bg-[#F8FAFC] flex items-center justify-center">
        <div className="flex flex-col items-center gap-4">
          <div className="w-12 h-12 rounded-2xl bg-gradient-to-tr from-indigo-500 to-purple-400 flex items-center justify-center shadow-lg shadow-indigo-200">
            <Loader2 className="w-6 h-6 text-white animate-spin" />
          </div>
          <p className="text-sm text-slate-500 font-medium animate-pulse">Memeriksa hak akses...</p>
        </div>
      </div>
    );
  }

  if (profile?.role !== 'super_admin') return null;

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 via-indigo-50/80 to-slate-100 p-6 lg:p-8 font-sans selection:bg-indigo-100 relative overflow-hidden text-slate-800">
      {/* Subtle decorative blobs */}
      <div className="absolute top-0 right-0 w-[600px] h-[600px] rounded-full bg-indigo-100/40 blur-[120px] pointer-events-none" />
      <div className="absolute bottom-0 left-0 w-[500px] h-[500px] rounded-full bg-purple-100/30 blur-[100px] pointer-events-none" />
      <div className="max-w-[1400px] mx-auto space-y-8 relative z-10">
        <GlobalHeader />
        
        {/* Navigation & Header */}
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-6">
          <div className="space-y-1.5">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-indigo-50 flex items-center justify-center text-indigo-600 shadow-inner">
                <UserCog className="w-5 h-5" />
              </div>
              <div>
                <h1 className="text-3xl font-bold text-slate-900 tracking-tight">Manajemen Akses Pengguna</h1>
                <p className="text-slate-500 text-sm">Kelola akun administrator Badan Administrasi Keuangan (BAK) dan Kepala Satuan Kerja (SatKer)</p>
              </div>
            </div>
          </div>
          
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              onClick={fetchData}
              disabled={loadingUsers}
              className="rounded-xl border-slate-200 bg-white text-slate-600 hover:bg-slate-50 shadow-sm"
            >
              <RefreshCw className={`w-4 h-4 mr-2 ${loadingUsers ? 'animate-spin' : ''}`} />
              Segarkan
            </Button>
            <Button
              onClick={() => setShowAddForm(!showAddForm)}
              className="rounded-xl px-5 bg-gradient-to-r from-indigo-600 to-violet-600 text-white font-bold hover:shadow-lg hover:shadow-indigo-200 transition-all transform active:scale-95 flex items-center gap-2"
            >
              <UserPlus className="w-4 h-4" />
              Buat Akun Baru
            </Button>
          </div>
        </div>

        {/* Notifications */}
        <FloatingSnackbar
          message={errorMsg
            ? { type: 'error', text: errorMsg }
            : successMsg
              ? { type: 'success', text: successMsg }
              : null}
          onDismiss={errorMsg ? () => setErrorMsg(null) : undefined}
        />

        {/* Add User Section */}
        {showAddForm && (
          <Card className="bg-white rounded-3xl shadow-[0_8px_30px_rgb(0,0,0,0.03)] border-none overflow-hidden animate-in slide-in-from-top-5 duration-300">
            <CardHeader className="bg-gradient-to-r from-indigo-50/50 to-purple-50/50 border-b border-slate-100 p-6">
              <CardTitle className="text-xl font-bold flex items-center gap-2">
                <UserPlus className="w-5 h-5 text-indigo-600" />
                Registrasi Akun Baru
              </CardTitle>
              <CardDescription>
                Daftarkan akun resmi untuk Kepala SatKer Pekarya, Kepala SatKer Loyalis, atau Tim Administrasi BAK UNIPDU. Akun baru akan langsung terdaftar di Firebase Authentication dan Firestore.
              </CardDescription>
            </CardHeader>
            <CardContent className="p-6">
              <form onSubmit={handleAddUser} className="space-y-6">
                <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                  
                  {/* Personal details */}
                  <div className="space-y-4">
                    <h3 className="text-sm font-bold text-slate-400 uppercase tracking-wider flex items-center gap-1.5"><User className="w-3.5 h-3.5" /> Data Kredensial</h3>
                    <div className="space-y-3">
                      <div>
                        <Label htmlFor="displayName" className="text-xs font-semibold text-slate-500 block mb-1.5">Nama Lengkap</Label>
                        <div className="relative">
                          <User className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400 z-10" />
                          <Input
                            id="displayName"
                            placeholder="Ketik nama pegawai..."
                            value={newDisplayName}
                            onChange={(e) => {
                              setNewDisplayName(e.target.value);
                              setShowNewNameSuggestions(true);
                            }}
                            onFocus={() => setShowNewNameSuggestions(true)}
                            onBlur={() => {
                              setTimeout(() => setShowNewNameSuggestions(false), 200);
                            }}
                            className="pl-9 rounded-xl border-slate-200 focus:border-indigo-500 focus:ring-indigo-500/20 h-[42px]"
                            autoComplete="off"
                          />
                          {showNewNameSuggestions && (
                            <div className="absolute left-0 right-0 mt-1 bg-white border border-slate-200 rounded-xl shadow-2xl z-[999] max-h-48 overflow-y-auto divide-y divide-slate-50 animate-in fade-in slide-in-from-top-1">
                              {allEmployees
                                .filter(emp => emp.name.toLowerCase().includes(newDisplayName.toLowerCase()))
                                .map(emp => (
                                  <div
                                    key={emp.id}
                                    onMouseDown={() => {
                                      setNewDisplayName(emp.name);
                                      if (emp.email) {
                                        setNewEmail(emp.email);
                                      }
                                      setShowNewNameSuggestions(false);
                                    }}
                                    className="p-3 text-xs font-bold text-slate-700 hover:bg-indigo-50/50 cursor-pointer transition-colors"
                                  >
                                    {emp.name} ({emp.type === 'Pekarya' ? `Pekarya - ${emp.detail}` : `Loyalis - ${emp.detail}`})
                                  </div>
                                ))}
                              {allEmployees.filter(emp => emp.name.toLowerCase().includes(newDisplayName.toLowerCase())).length === 0 && (
                                <div className="p-3 text-xs italic text-slate-400 bg-slate-50">Nama tidak ditemukan. Tetap gunakan "{newDisplayName}"</div>
                              )}
                            </div>
                          )}
                        </div>
                      </div>
                      <div>
                        <Label htmlFor="email" className="text-xs font-semibold text-slate-500">Alamat Email</Label>
                        <div className="relative mt-1">
                          <Mail className="absolute left-3 top-3 w-4 h-4 text-slate-400" />
                          <Input
                            id="email"
                            type="email"
                            required
                            placeholder="satpam@unipdu.ac.id"
                            value={newEmail}
                            onChange={(e) => setNewEmail(e.target.value)}
                            className="pl-9 rounded-xl border-slate-200 focus:border-indigo-500 focus:ring-indigo-500/20"
                          />
                        </div>
                      </div>
                      <div>
                        <Label htmlFor="pass" className="text-xs font-semibold text-slate-500">Kata Sandi (Min. 6 Karakter)</Label>
                        <div className="relative mt-1">
                          <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400 pointer-events-none" />
                          <Input
                            id="pass"
                            type={showNewPassword ? 'text' : 'password'}
                            required
                            placeholder="••••••••"
                            value={newPassword}
                            onChange={(e) => setNewPassword(e.target.value)}
                            className="pl-9 pr-10 rounded-xl border-slate-200 focus:border-indigo-500 focus:ring-indigo-500/20"
                          />
                          <button
                            type="button"
                            onClick={() => setShowNewPassword(!showNewPassword)}
                            className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 focus:outline-none focus:text-slate-600 cursor-pointer flex items-center justify-center"
                            aria-label={showNewPassword ? 'Sembunyikan kata sandi' : 'Tampilkan kata sandi'}
                          >
                            {showNewPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                          </button>
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* Role Selection */}
                  <div className="space-y-4">
                    <h3 className="text-sm font-bold text-slate-400 uppercase tracking-wider flex items-center gap-1.5"><Shield className="w-3.5 h-3.5" /> Peran & Wewenang</h3>
                    <div>
                      <Label className="text-xs font-semibold text-slate-500 block mb-2">Tingkat Otoritas</Label>
                      <select
                        value={newRole}
                        onChange={(e) => {
                          const role = e.target.value as any;
                          setNewRole(role);
                          if (role !== 'satker_head') {
                            setNewPermitted([]);
                          }
                          if (role !== 'honorer' && role !== 'loyalis') {
                            setNewLinkedEmployeeId('');
                          }
                        }}
                        className="w-full text-sm font-bold text-slate-700 bg-white rounded-xl border border-slate-200 px-4 py-3 focus:outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20"
                      >
                        <option value="satker_head">Kepala Satuan Kerja Pekarya (SatKer Pekarya)</option>
                        <option value="satker_head_loyalis">Kepala Satuan Kerja Loyalis (SatKer Loyalis)</option>
                        <option value="employee_admin">Staf Master Data Pegawai (Employee Admin)</option>
                        <option value="super_admin">Super Administrator (BAK)</option>
                        <option value="finance_verifier">Badan Keuangan (Verifikator)</option>
                        <option value="honorer">Karyawan Honorer (Lapor Kegiatan)</option>
                        <option value="loyalis">Karyawan Loyalis (Lihat Slip Gaji)</option>
                        <option value="loyalis_presence_admin">Penanggung Jawab Presensi Loyalis</option>
                        <option value="ketua_shift_satpam">Ketua Shift SATPAM (Lapor Shift Regu)</option>
                      </select>
                      
                      {/* Description Helper based on selected role */}
                      <div className="mt-3 p-3.5 rounded-xl border border-slate-200 bg-slate-50/50">
                        {newRole === 'satker_head' && <span className="text-xs text-slate-600 leading-relaxed block">Dapat login dan melakukan scan presensi HANYA pada job category yang diberikan akses. Dilarang membuka menu dashboard lain.</span>}
                        {newRole === 'satker_head_loyalis' && <span className="text-xs text-slate-600 leading-relaxed block">Dapat login dan mengelola data vakasi/kehadiran Loyalis pada halaman Vakasi Tambahan. Dilarang membuka menu dashboard lain.</span>}
                        {newRole === 'employee_admin' && <span className="text-xs text-slate-600 leading-relaxed block">Hanya memiliki wewenang untuk mengelola data induk pegawai (Master Data Pegawai). Dilarang membuka menu payroll/uraian/lainnya.</span>}
                        {newRole === 'super_admin' && <span className="text-xs text-slate-600 leading-relaxed block">Akses penuh dan bebas ke semua fitur sistem payroll, Legalitas, dan manajemen user.</span>}
                        {newRole === 'finance_verifier' && <span className="text-xs text-slate-600 leading-relaxed block">Memverifikasi sekaligus mengunci draf payroll, lalu membuat instruksi pembayaran.</span>}
                        {newRole === 'honorer' && <span className="text-xs text-slate-600 leading-relaxed block">Akun untuk karyawan kebersihan yang hanya dapat mengakses halaman lapor kegiatan harian. Harus dihubungkan ke data pegawai.</span>}
                        {newRole === 'loyalis' && <span className="text-xs text-slate-600 leading-relaxed block">Akun untuk karyawan Loyalis (white collar) yang hanya dapat mengakses halaman slip gaji. Harus dihubungkan ke data pegawai.</span>}
                        {newRole === 'loyalis_presence_admin' && <span className="text-xs text-slate-600 leading-relaxed block">Memiliki wewenang khusus HANYA untuk menghitung dan mengelola kehadiran Loyalis bulanan via raw daily logs. Dilarang membuka menu dashboard lain.</span>}
                        {newRole === 'ketua_shift_satpam' && <span className="text-xs text-slate-600 leading-relaxed block">Akun untuk Ketua Shift SATPAM. Memiliki wewenang untuk melaporkan kegiatan harian seluruh anggota shift regunya.</span>}
                      </div>
                    </div>
                  </div>

                  {/* Permitted Categories */}
                  <div className="space-y-4">
                    <h3 className="text-sm font-bold text-slate-400 uppercase tracking-wider flex items-center gap-1.5"><Layers className="w-3.5 h-3.5" /> {
                      newRole === 'honorer' ? 'Hubungkan Karyawan' :
                      newRole === 'loyalis' ? 'Hubungkan Karyawan' :
                      newRole === 'super_admin' ? 'Hak Akses' :
                      newRole === 'employee_admin' ? 'Hak Akses' :
                      newRole === 'satker_head_loyalis' ? 'Hak Akses' :
                      newRole === 'loyalis_presence_admin' ? 'Hak Akses' :
                      'Unit Kerja Diijinkan'
                    }</h3>
                    <div className="space-y-3">
                      <Label className="text-xs font-semibold text-slate-500 block leading-tight">{
                        newRole === 'honorer' ? 'Pilih karyawan Pekarya yang akan dihubungkan' :
                        newRole === 'loyalis' ? 'Pilih karyawan Loyalis yang akan dihubungkan' :
                        newRole === 'super_admin' ? 'Akses otomatis ke seluruh sistem' :
                        newRole === 'employee_admin' ? 'Akses otomatis ke data pegawai' :
                        newRole === 'satker_head_loyalis' ? 'Akses otomatis ke data Loyalis' :
                        newRole === 'loyalis_presence_admin' ? 'Akses otomatis ke kalkulator presensi loyalis' :
                        'Pilih Satuan Kerja (Khusus Kepala SatKer)'
                      }</Label>
                      {newRole === 'super_admin' ? (
                        <div className="p-4 rounded-2xl bg-amber-50/50 border border-amber-100 text-amber-800 text-xs leading-relaxed font-medium">
                          Super Administrator secara otomatis memiliki akses penuh ke <strong>seluruh</strong> Satuan Kerja. Checkbox dinonaktifkan.
                        </div>
                      ) : newRole === 'employee_admin' ? (
                        <div className="p-4 rounded-2xl bg-emerald-50/50 border border-emerald-100 text-emerald-800 text-xs leading-relaxed font-medium">
                          Employee Administrator secara otomatis memiliki akses penuh ke <strong>seluruh</strong> data pegawai (Master Data Pegawai). Checkbox dinonaktifkan.
                        </div>
                      ) : newRole === 'satker_head_loyalis' ? (
                        <div className="p-4 rounded-2xl bg-violet-50/50 border border-violet-100 text-violet-800 text-xs leading-relaxed font-medium">
                          Kepala Satuan Kerja Loyalis secara otomatis memiliki wewenang untuk <strong>seluruh</strong> data Loyalis. Checkbox dinonaktifkan.
                        </div>
                      ) : newRole === 'loyalis_presence_admin' ? (
                        <div className="p-4 rounded-2xl bg-pink-50/50 border border-pink-100 text-pink-800 text-xs leading-relaxed font-medium">
                          Penanggung Jawab Presensi Loyalis memiliki akses khusus ke halaman kalkulator presensi loyalis via raw daily logs. Checkbox dinonaktifkan.
                        </div>
                      ) : newRole === 'ketua_shift_satpam' ? (
                        <div className="space-y-4">
                          <div className="p-3.5 rounded-xl bg-purple-50 border border-purple-100 text-purple-900 text-xs leading-relaxed font-medium">
                            Atur Ketua Shift dan alokasi <strong>tepat 9 anggota regu</strong> yang dipimpin (Total roster 10 personel).
                          </div>
                          
                          {/* 1. Pilih Ketua Shift */}
                          <div className="space-y-1.5">
                            <Label className="text-xs font-semibold text-slate-500">Pilih Ketua Shift</Label>
                            <select
                              value={newLinkedEmployeeId}
                              onChange={(e) => {
                                setNewLinkedEmployeeId(e.target.value);
                                setNewTeamMembers(prev => prev.filter(id => id !== e.target.value));
                              }}
                              className={`w-full text-sm font-bold text-slate-700 bg-white rounded-xl border px-3 py-2.5 focus:outline-none ${
                                !newLinkedEmployeeId ? 'border-rose-300 focus:border-rose-500 focus:ring-2 focus:ring-rose-500/20' : 'border-slate-200 focus:border-purple-500 focus:ring-2 focus:ring-purple-500/20'
                              }`}
                            >
                              <option value="">-- Pilih Ketua Shift --</option>
                              {allEmployees
                                .filter(emp => emp.type === 'Pekarya' && emp.detail === 'SATPAM')
                                .map(emp => (
                                  <option key={emp.id} value={emp.id}>
                                    {emp.name}
                                  </option>
                                ))}
                            </select>
                            {!newLinkedEmployeeId && (
                              <div className="p-2.5 rounded-xl bg-rose-50 border border-rose-200/80 text-rose-800 text-xs font-medium flex items-center gap-2">
                                <AlertCircle className="w-4 h-4 text-rose-600 shrink-0" />
                                <span>Ketua Shift belum dipilih. Silakan pilih 1 Ketua Shift Satpam.</span>
                              </div>
                            )}
                          </div>

                          {/* 2. Pilih Nomor Regu */}
                          <div className="space-y-1.5">
                            <Label className="text-xs font-semibold text-slate-500">Nomor Regu (Roster Team Slot)</Label>
                            <select
                              value={newTeamNumber}
                              onChange={(e) => {
                                const selectedTeamNum = e.target.value;
                                setNewTeamNumber(selectedTeamNum);
                                const matchedTeam = shiftTeams.find(t => t.id === `team_${selectedTeamNum}`);
                                if (matchedTeam) {
                                  setNewTeamMembers(matchedTeam.memberEmployeeIds || []);
                                }
                              }}
                              className="w-full text-sm font-bold text-slate-700 bg-white rounded-xl border border-slate-200 px-3 py-2.5 focus:outline-none focus:border-purple-500"
                            >
                              <option value="1">Regu 1 (Slot: Shift {getSatpamShiftForTeam(1, new Date())})</option>
                              <option value="2">Regu 2 (Slot: Shift {getSatpamShiftForTeam(2, new Date())})</option>
                              <option value="3">Regu 3 (Slot: Shift {getSatpamShiftForTeam(3, new Date())})</option>
                            </select>
                          </div>

                          {/* Warning Banner for Team Conflict / Reorganization */}
                          {(() => {
                            const selectedTeam = shiftTeams.find(t => t.id === `team_${newTeamNumber}`);
                            const currentLeaderId = selectedTeam?.ketuaShiftId;
                            const currentLeaderName = selectedTeam?.ketuaShiftName;
                            const isConflict = currentLeaderId && currentLeaderId !== newLinkedEmployeeId;
                            const selectedEmpName = allEmployees.find(e => e.id === newLinkedEmployeeId)?.name || 'Pengguna baru ini';
                            const otherTeam = shiftTeams.find(t => t.ketuaShiftId === newLinkedEmployeeId && t.id !== `team_${newTeamNumber}`);

                            const overlappingMembers = newTeamMembers.map(empId => {
                              const emp = allEmployees.find(e => e.id === empId);
                              const other = shiftTeams.find(t => t.id !== `team_${newTeamNumber}` && (t.ketuaShiftId === empId || t.memberEmployeeIds?.includes(empId)));
                              return other ? { name: emp?.name || empId, teamNum: other.id.split('_')[1] } : null;
                            }).filter((item): item is { name: string; teamNum: string } => item !== null);

                            return (
                              <>
                                {isConflict && (
                                  <div className="p-3.5 rounded-xl bg-amber-50 border border-amber-200/80 text-amber-900 text-xs font-medium space-y-1 shadow-xs">
                                    <div className="flex items-center gap-2 font-bold text-amber-800">
                                      <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0" />
                                      <span>Perhatian: Reorganisasi Ketua Shift</span>
                                    </div>
                                    <p className="leading-relaxed text-[11px] text-amber-700">
                                      Regu {newTeamNumber} saat ini dipimpin oleh <strong className="font-bold underline decoration-amber-400">{currentLeaderName}</strong>. Membuat akun Ketua Shift baru ini akan menetapkan <strong className="font-bold">{selectedEmpName}</strong> sebagai Ketua Shift Regu {newTeamNumber} menggantikan {currentLeaderName}.
                                    </p>
                                  </div>
                                )}

                                {otherTeam && (
                                  <div className="p-3 rounded-xl bg-blue-50 border border-blue-200/80 text-blue-900 text-xs font-medium space-y-1 shadow-xs">
                                    <div className="flex items-center gap-2 font-bold text-blue-800">
                                      <Shield className="w-4 h-4 text-blue-600 shrink-0" />
                                      <span>Pemindahan Kepemimpinan Regu</span>
                                    </div>
                                    <p className="leading-relaxed text-[11px] text-blue-700">
                                      {selectedEmpName} masih tercatat di Regu {otherTeam.id.split('_')[1]}. Simpan akan ditolak sampai konfigurasi regu lama diselesaikan agar tidak ada keanggotaan ganda.
                                    </p>
                                  </div>
                                )}

                                {overlappingMembers.length > 0 && (
                                  <div className="p-3 rounded-xl bg-rose-50 border border-rose-200/80 text-rose-900 text-xs font-medium space-y-1 shadow-xs">
                                    <div className="flex items-center gap-2 font-bold text-rose-800">
                                      <AlertCircle className="w-4 h-4 text-rose-600 shrink-0" />
                                      <span>Konflik Keanggotaan Regu Ganda</span>
                                    </div>
                                    <p className="leading-relaxed text-[11px] text-rose-700">
                                      Anggota berikut masih terdaftar di regu lain: <strong>{overlappingMembers.map(m => `${m.name} (Regu ${m.teamNum})`).join(', ')}</strong>. Lepaskan keanggotaan regu lama agar simpan tidak ditolak.
                                    </p>
                                  </div>
                                )}
                              </>
                            );
                          })()}

                          {/* 3. Pilih Anggota Regu */}
                          <div className="space-y-1.5">
                            <Label className="text-xs font-semibold text-slate-500 flex justify-between items-center">
                              <span>Pilih Anggota Regu</span>
                              <span className={newTeamMembers.length === 9 ? "text-emerald-700 bg-emerald-100 border border-emerald-200 px-2 py-0.5 rounded-md font-bold text-xs flex items-center gap-1" : "text-rose-700 bg-rose-100 border border-rose-200 px-2 py-0.5 rounded-md font-bold text-xs flex items-center gap-1"}>
                                {newTeamMembers.length === 9 ? <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" /> : <AlertCircle className="w-3.5 h-3.5 text-rose-600" />}
                                {newTeamMembers.length} / 9 Terpilih
                              </span>
                            </Label>
                            
                            {newTeamMembers.length !== 9 && (
                              <div className="p-2.5 rounded-xl bg-rose-50 border border-rose-200/80 text-rose-800 text-xs font-medium flex items-center gap-2">
                                <AlertCircle className="w-4 h-4 text-rose-600 shrink-0" />
                                <span>
                                  {newTeamMembers.length < 9 
                                    ? `Jumlah anggota kurang. Pilih ${9 - newTeamMembers.length} anggota regu lagi.`
                                    : `Jumlah anggota kelebihan. Hapus ${newTeamMembers.length - 9} anggota regu.`}
                                </span>
                              </div>
                            )}

                            <div className="p-4 rounded-2xl bg-slate-50 border border-slate-100 max-h-[220px] overflow-y-auto space-y-2.5">
                              {allEmployees
                                .filter(emp => emp.type === 'Pekarya' && emp.detail === 'SATPAM' && emp.id !== newLinkedEmployeeId)
                                .map(emp => {
                                  const isChecked = newTeamMembers.includes(emp.id);
                                  const assignedOtherTeam = shiftTeams.find(t => t.id !== `team_${newTeamNumber}` && (t.ketuaShiftId === emp.id || t.memberEmployeeIds?.includes(emp.id)));

                                  return (
                                    <div key={emp.id} className="flex items-center justify-between hover:bg-slate-100/60 p-1 rounded-lg transition-colors">
                                      <div className="flex items-center space-x-2.5">
                                        <Checkbox
                                          id={`new-member-${emp.id}`}
                                          checked={isChecked}
                                          onCheckedChange={() => {
                                            setNewTeamMembers(prev => 
                                              prev.includes(emp.id)
                                                ? prev.filter(id => id !== emp.id)
                                                : [...prev, emp.id]
                                            );
                                          }}
                                          className="rounded border-slate-300 data-[state=checked]:bg-purple-600 data-[state=checked]:border-purple-600"
                                        />
                                        <Label htmlFor={`new-member-${emp.id}`} className="text-xs font-bold text-slate-700 cursor-pointer select-none">
                                          {emp.name}
                                        </Label>
                                      </div>
                                      {assignedOtherTeam && (
                                        <span className="text-[10px] font-bold text-amber-700 bg-amber-100 border border-amber-200 px-1.5 py-0.5 rounded shrink-0">
                                          Regu {assignedOtherTeam.id.split('_')[1]}
                                        </span>
                                      )}
                                    </div>
                                  );
                                })}
                            </div>
                          </div>
                        </div>
                      ) : newRole === 'honorer' ? (
                        <div className="space-y-3">
                          <div className="p-4 rounded-2xl bg-teal-50/50 border border-teal-100 text-teal-800 text-xs leading-relaxed font-medium">
                            Pilih karyawan Pekarya yang akan dihubungkan ke akun ini. Akun honorer hanya bisa mengakses halaman lapor kegiatan.
                          </div>
                          <div className="relative">
                            <Input
                              placeholder="Cari nama karyawan Pekarya..."
                              value={newEmployeeSearchText}
                              onChange={(e) => {
                                setNewEmployeeSearchText(e.target.value);
                                if (!e.target.value) {
                                  setNewLinkedEmployeeId('');
                                }
                                setShowNewEmployeeSuggestions(true);
                              }}
                              onFocus={() => setShowNewEmployeeSuggestions(true)}
                              onBlur={() => {
                                setTimeout(() => setShowNewEmployeeSuggestions(false), 200);
                              }}
                              className="rounded-xl border-slate-200 focus:border-teal-400 focus:ring-teal-400/20 h-[42px]"
                              autoComplete="off"
                            />
                            {showNewEmployeeSuggestions && (
                              <div className="absolute left-0 right-0 mt-1 bg-white border border-slate-200 rounded-xl shadow-2xl z-[999] max-h-48 overflow-y-auto divide-y divide-slate-50 animate-in fade-in slide-in-from-top-1">
                                {cleaningEmployees
                                  .filter(emp => emp.name.toLowerCase().includes(newEmployeeSearchText.toLowerCase()))
                                  .map(emp => (
                                    <div
                                      key={emp.id}
                                      onMouseDown={() => {
                                        setNewLinkedEmployeeId(emp.id);
                                        setNewEmployeeSearchText(`${emp.name} (${emp.category})`);
                                        setShowNewEmployeeSuggestions(false);
                                      }}
                                      className="p-3 text-xs font-bold text-slate-700 hover:bg-teal-50/50 cursor-pointer transition-colors"
                                    >
                                      {emp.name} ({emp.category})
                                    </div>
                                  ))}
                                {cleaningEmployees.filter(emp => emp.name.toLowerCase().includes(newEmployeeSearchText.toLowerCase())).length === 0 && (
                                  <div className="p-3 text-xs italic text-slate-400 bg-slate-50">Karyawan tidak ditemukan.</div>
                                )}
                              </div>
                            )}
                          </div>
                        </div>
                      ) : newRole === 'loyalis' ? (
                        <div className="space-y-3">
                          <div className="p-4 rounded-2xl bg-sky-50/50 border border-sky-100 text-sky-800 text-xs leading-relaxed font-medium">
                            Pilih karyawan Loyalis yang akan dihubungkan ke akun ini. Akun Loyalis hanya bisa mengakses halaman slip gaji.
                          </div>
                          <select
                            value={newLinkedEmployeeId}
                            onChange={(e) => setNewLinkedEmployeeId(e.target.value)}
                            className="w-full text-sm font-bold text-slate-700 bg-white rounded-xl border border-slate-200 px-3 py-2.5 focus:outline-none focus:border-sky-400 focus:ring-2 focus:ring-sky-400/20"
                          >
                            <option value="">-- Pilih Karyawan --</option>
                            {allEmployees
                              .filter(emp => emp.type === 'Loyalis')
                              .map(emp => (
                                <option key={emp.id} value={emp.id}>
                                  {emp.name} ({emp.detail})
                                </option>
                              ))}
                          </select>
                        </div>
                      ) : (
                        <div className="p-4 rounded-2xl bg-slate-50 border border-slate-100 max-h-[160px] overflow-y-auto space-y-2.5">
                          {dynamicCategories.map(cat => {
                            const isChecked = newPermitted.includes(cat);
                            return (
                              <div key={cat} className="flex items-center space-x-2.5">
                                <Checkbox
                                  id={`cat-${cat}`}
                                  checked={isChecked}
                                  onCheckedChange={() => handleToggleNewPermitted(cat)}
                                  className="rounded border-slate-300 data-[state=checked]:bg-indigo-600"
                                />
                                <Label htmlFor={`cat-${cat}`} className="text-xs font-bold text-slate-700 uppercase cursor-pointer select-none">
                                  {cat}
                                </Label>
                              </div>
                            );
                          })}
                          {dynamicCategories.length === 0 && (
                            <div className="text-xs text-slate-400 italic">Tidak ada kategori ditemukan.</div>
                          )}
                        </div>
                      )}
                      <p className="text-[11px] text-slate-400 leading-normal">
                        * Anda dapat menetapkan lebih dari satu SatKer jika kepala unit tersebut mengurus beberapa kategori sekaligus secara sementara.
                      </p>
                    </div>
                  </div>
                </div>

                <div className="border-t border-slate-100 pt-4 flex justify-end gap-3 shrink-0">
                  <Button
                    type="button"
                    variant="ghost"
                    onClick={() => setShowAddForm(false)}
                    className="rounded-xl font-bold text-slate-500 hover:bg-slate-50"
                  >
                    Batal
                  </Button>
                  <Button
                    type="submit"
                    disabled={actionLoading}
                    className="rounded-xl px-6 bg-indigo-600 text-white font-bold hover:bg-indigo-700 shadow-md shadow-indigo-100 flex items-center gap-2"
                  >
                    {actionLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <UserPlus className="w-4 h-4" />}
                    Simpan Akun
                  </Button>
                </div>
              </form>
            </CardContent>
          </Card>
        )}

        {/* Super Admin Impersonation Feature Header Card */}
        <Card className="bg-gradient-to-r from-slate-900 via-indigo-950 to-slate-900 text-white rounded-[24px] shadow-lg border-none p-6 relative overflow-hidden">
          <div className="absolute right-0 top-0 translate-x-4 -translate-y-4 opacity-10 pointer-events-none">
            <UserCog className="w-64 h-64 text-indigo-300" />
          </div>
          <div className="relative z-10 flex flex-col md:flex-row items-start md:items-center justify-between gap-6">
            <div className="space-y-1.5 max-w-2xl">
              <div className="flex items-center gap-2">
                <Badge className="bg-amber-500/20 text-amber-300 border-amber-400/30 px-2.5 py-0.5 font-bold text-xs uppercase tracking-wider">
                  Super Admin Feature
                </Badge>
                <Badge className="bg-rose-500/20 text-rose-300 border-rose-400/30 px-2.5 py-0.5 font-bold text-xs uppercase tracking-wider">
                  Dual-Mode Active
                </Badge>
              </div>
              <h3 className="text-xl font-bold tracking-tight text-white flex items-center gap-2">
                <UserCog className="w-5 h-5 text-indigo-400" />
                Impersonasi & Akses Pengguna ("View-As")
              </h3>
              <p className="text-slate-300 text-xs md:text-sm leading-relaxed">
                Super Admin dapat mensimulasikan tampilan aplikasi (UI/UX) atau melakukan switch sesi penuh ke akun pegawai manapun (seperti <em>Miftakhul Arif</em> - Honorer, <em>Teguh Priyo Utomo</em> - Karyawan Loyalis, atau <em>Hj. Suspa Hariati</em> - Employee Admin) tanpa perlu mengisi password.
              </p>
            </div>

            <div className="flex flex-col sm:flex-row gap-3 bg-white/10 p-3.5 rounded-2xl backdrop-blur-md border border-white/10 shrink-0 text-xs">
              <div className="flex items-center gap-2.5 text-amber-200">
                <div className="w-7 h-7 rounded-xl bg-amber-500/20 border border-amber-400/30 flex items-center justify-center shrink-0">
                  <Eye className="w-4 h-4 text-amber-300" />
                </div>
                <div>
                  <div className="font-bold text-white">1. Mode Preview UI (<Eye className="w-3 h-3 inline" />)</div>
                  <div className="text-[11px] text-slate-300">Preview UI cepat tanpa ubah sesi auth.</div>
                </div>
              </div>

              <div className="flex items-center gap-2.5 text-rose-200">
                <div className="w-7 h-7 rounded-xl bg-rose-500/20 border border-rose-400/30 flex items-center justify-center shrink-0">
                  <KeyRound className="w-4 h-4 text-rose-300" />
                </div>
                <div>
                  <div className="font-bold text-white">2. Sesi Penuh (<KeyRound className="w-3 h-3 inline" />)</div>
                  <div className="text-[11px] text-slate-300">Switch Firebase token resmi.</div>
                </div>
              </div>
            </div>
          </div>
        </Card>

        {/* Users Table List */}
        <Card className="bg-white rounded-[24px] shadow-[0_8px_30px_rgb(0,0,0,0.02)] border-none overflow-hidden">
          <CardHeader className="p-6 border-b border-slate-50 flex flex-col md:flex-row md:items-center justify-between gap-4">
            <div>
              <CardTitle className="text-lg font-bold flex items-center gap-2">
                <Users className="w-5 h-5 text-indigo-500" />
                Daftar Akun Terdaftar
              </CardTitle>
              <CardDescription>
                Total terdaftar: {loadingUsers ? '...' : users.length} pengguna
              </CardDescription>
            </div>

            {/* Search Bar */}
            <div className="relative w-full md:w-80">
              <Search className="absolute left-3.5 top-3 w-4 h-4 text-slate-400" />
              <Input
                type="text"
                placeholder="Cari email, nama, peran..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-10 pr-4 py-2.5 text-sm rounded-2xl border-slate-200 focus:border-indigo-500 focus:ring-indigo-500/20 bg-slate-50/50 w-full"
              />
            </div>
          </CardHeader>
          <CardContent className="p-0">
            {loadingUsers ? (
              <div className="p-24 flex flex-col items-center justify-center text-slate-400">
                <Loader2 className="w-8 h-8 animate-spin mb-4 text-indigo-500" />
                <p className="font-semibold text-sm animate-pulse">Mengambil data pengguna...</p>
              </div>
            ) : filteredUsers.length === 0 ? (
              <div className="p-24 flex flex-col items-center justify-center text-slate-400 text-center">
                <Users className="w-12 h-12 mb-4 opacity-20 text-slate-500" />
                <h4 className="text-slate-700 font-bold text-base">Tidak ada pengguna</h4>
                <p className="text-xs text-slate-400 max-w-xs mt-1">Gunakan tombol 'Buat Akun Baru' di atas untuk mendaftarkan akun perdana Kepala SatKer.</p>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader className="bg-slate-50/60">
                    <TableRow className="border-slate-100">
                      <TableHead className="font-bold text-slate-500 pl-8">Nama Lengkap</TableHead>
                      <TableHead className="font-bold text-slate-500">Email Akun</TableHead>
                      <TableHead className="font-bold text-slate-500">Peran</TableHead>
                      <TableHead className="font-bold text-slate-500">Akses Unit Kerja (SatKer)</TableHead>
                      <TableHead className="font-bold text-slate-500 text-right pr-8">Aksi</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filteredUsers.map((u) => {
                      const isMe = u.email === user?.email;

                      return (
                        <TableRow key={u.uid} className="border-slate-50 hover:bg-slate-50/40 transition-colors">
                          <TableCell className="font-bold pl-8 py-4.5">
                            <div className="flex items-center gap-3">
                              <div className={`w-8 h-8 rounded-full flex items-center justify-center font-bold text-sm shadow-sm ${
                                u.role === 'super_admin' ? 'bg-amber-100 text-amber-700' : 
                                u.role === 'employee_admin' ? 'bg-emerald-100 text-emerald-700' : 
                                u.role === 'honorer' ? 'bg-teal-100 text-teal-700' : 
                                u.role === 'loyalis' ? 'bg-sky-100 text-sky-700' : 
                                u.role === 'loyalis_presence_admin' ? 'bg-pink-100 text-pink-700' :
                                'bg-indigo-100 text-indigo-700'
                              }`}>
                                {(u.displayName || u.email).substring(0, 2).toUpperCase()}
                              </div>
                              <div>
                                <span className="text-slate-800 text-sm block leading-tight">{u.displayName || '-'}</span>
                                {isMe && <span className="text-[10px] font-bold text-emerald-600 block mt-0.5">Sesi Anda</span>}
                                {u.disabled && (
                                  <span className="text-[10px] font-bold text-rose-600 block mt-0.5">
                                    Dinonaktifkan — riwayat disimpan
                                  </span>
                                )}
                              </div>
                            </div>
                          </TableCell>
                          <TableCell className="text-slate-600 text-sm font-medium">{u.email}</TableCell>
                          <TableCell className="py-4.5">
                            {u.role === 'super_admin' ? (
                              <Badge variant="secondary" className="bg-amber-50 text-amber-700 hover:bg-amber-100 font-bold px-2.5 py-0.5 rounded-full border-none">
                                Super Admin
                              </Badge>
                            ) : u.role === 'employee_admin' ? (
                              <Badge variant="secondary" className="bg-emerald-50 text-emerald-700 hover:bg-emerald-100 font-bold px-2.5 py-0.5 rounded-full border-none">
                                Employee Admin
                              </Badge>
                            ) : u.role === 'honorer' ? (
                              <Badge variant="secondary" className="bg-teal-50 text-teal-700 hover:bg-teal-100 font-bold px-2.5 py-0.5 rounded-full border-none">
                                Honorer
                              </Badge>
                            ) : u.role === 'satker_head_loyalis' ? (
                              <Badge variant="secondary" className="bg-violet-50 text-violet-700 hover:bg-violet-100 font-bold px-2.5 py-0.5 rounded-full border-none">
                                Kepala SatKer Loyalis
                              </Badge>
                            ) : u.role === 'loyalis' ? (
                              <Badge variant="secondary" className="bg-sky-50 text-sky-700 hover:bg-sky-100 font-bold px-2.5 py-0.5 rounded-full border-none">
                                Karyawan Loyalis
                              </Badge>
                            ) : u.role === 'loyalis_presence_admin' ? (
                              <Badge variant="secondary" className="bg-pink-50 text-pink-700 hover:bg-pink-100 font-bold px-2.5 py-0.5 rounded-full border-none">
                                PJ Presensi Loyalis
                              </Badge>
                            ) : u.role === 'ketua_shift_satpam' ? (
                              <Badge variant="secondary" className="bg-purple-50 text-purple-700 hover:bg-purple-100 font-bold px-2.5 py-0.5 rounded-full border-none">
                                Ketua Shift SATPAM
                              </Badge>
                            ) : (
                              <Badge variant="secondary" className="bg-indigo-50 text-indigo-700 hover:bg-indigo-100 font-bold px-2.5 py-0.5 rounded-full border-none">
                                Kepala SatKer Pekarya
                              </Badge>
                            )}
                          </TableCell>
                          <TableCell className="py-4.5">
                            {u.role === 'super_admin' ? (
                              <span className="text-xs text-amber-600 font-bold italic">Semua Unit (Akses Penuh)</span>
                            ) : u.role === 'employee_admin' ? (
                              <span className="text-xs text-emerald-600 font-bold italic">Pegawai (Akses Penuh)</span>
                            ) : u.role === 'satker_head_loyalis' ? (
                              <span className="text-xs text-violet-600 font-bold italic">Loyalis (Akses Penuh)</span>
                            ) : u.role === 'loyalis_presence_admin' ? (
                              <span className="text-xs text-pink-600 font-bold italic">Presensi Loyalis Raw (Akses Khusus)</span>
                            ) : u.role === 'honorer' ? (
                              <span className="text-xs text-teal-600 font-bold">
                                {u.linkedEmployeeId
                                  ? cleaningEmployees.find(e => e.id === u.linkedEmployeeId)?.name || u.linkedEmployeeId
                                  : <span className="text-rose-500 italic">Belum Terhubung</span>
                                }
                              </span>
                            ) : u.role === 'loyalis' ? (
                              <span className="text-xs text-sky-600 font-bold">
                                {u.linkedEmployeeId
                                  ? allEmployees.find(e => e.id === u.linkedEmployeeId)?.name || u.linkedEmployeeId
                                  : <span className="text-rose-500 italic">Belum Terhubung</span>
                                }
                              </span>
                            ) : u.role === 'ketua_shift_satpam' ? (
                              <span className="text-xs text-purple-600 font-bold">
                                {u.linkedEmployeeId
                                  ? allEmployees.find(e => e.id === u.linkedEmployeeId)?.name || u.linkedEmployeeId
                                  : <span className="text-rose-500 italic">Belum Terhubung</span>
                                }
                                {(() => {
                                  const t = shiftTeams.find(team => team.ketuaShiftId === u.linkedEmployeeId);
                                  return t ? ` (Regu ${t.id.split('_')[1]})` : '';
                                })()}
                              </span>
                            ) : (
                              <div className="flex flex-wrap gap-1 max-w-[320px]">
                                {u.permittedCategories && u.permittedCategories.length > 0 ? (
                                  u.permittedCategories.map(cat => (
                                    <Badge key={cat} variant="outline" className="bg-slate-50 text-slate-700 border-slate-200 text-[10px] font-bold uppercase rounded-md px-1.5 py-px">
                                      {cat}
                                    </Badge>
                                  ))
                                ) : (
                                  <span className="text-xs text-rose-500 font-bold">Tanpa Akses (Blokir)</span>
                                )}
                              </div>
                            )}
                          </TableCell>
                          <TableCell className="text-right pr-8 py-4.5">
                            <div className="flex justify-end gap-1.5 items-center">
                              {/* UI Preview Mode Button */}
                              <Button
                                variant="ghost"
                                size="icon"
                                disabled={isMe || u.disabled || previewingUid === u.uid}
                                onClick={() => handleStartUiImpersonation(u)}
                                title={`Preview UI/UX sebagai ${u.displayName || u.email}`}
                                className="h-8 w-8 rounded-lg text-amber-600 hover:text-amber-700 hover:bg-amber-50 border border-amber-200/60 shadow-2xs transition-all disabled:opacity-30 disabled:pointer-events-none cursor-pointer"
                              >
                                {previewingUid === u.uid ? (
                                  <Loader2 className="w-4 h-4 animate-spin text-amber-600" />
                                ) : (
                                  <Eye className="w-4 h-4" />
                                )}
                              </Button>

                              {/* Custom Token Real Session Button */}
                              <Button
                                variant="ghost"
                                size="icon"
                                disabled={isMe || u.disabled || impersonatingUid === u.uid}
                                onClick={() => handleCustomTokenLogin(u)}
                                title={`Login Sesi Penuh via Custom Token sebagai ${u.displayName || u.email}`}
                                className="h-8 w-8 rounded-lg text-rose-600 hover:text-rose-700 hover:bg-rose-50 border border-rose-200/60 shadow-2xs transition-all disabled:opacity-30 disabled:pointer-events-none"
                              >
                                {impersonatingUid === u.uid ? (
                                  <Loader2 className="w-4 h-4 animate-spin text-rose-600" />
                                ) : (
                                  <KeyRound className="w-4 h-4" />
                                )}
                              </Button>

                              {/* Edit User Button */}
                              <Button
                                variant="ghost"
                                size="icon"
                                onClick={() => openEditDialog(u)}
                                className="h-8 w-8 rounded-lg text-slate-400 hover:text-indigo-600 hover:bg-indigo-50/50"
                              >
                                <Pencil className="w-4 h-4" />
                              </Button>

                              {/* Disable Account Button */}
                              <Button
                                variant="ghost"
                                size="icon"
                                disabled={isMe || u.disabled}
                                onClick={() => openDeleteDialog(u)}
                                className="h-8 w-8 rounded-lg text-slate-400 hover:text-rose-600 hover:bg-rose-50/50 disabled:opacity-30 disabled:pointer-events-none"
                              >
                                <UserX className="w-4 h-4" />
                              </Button>
                            </div>
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </div>
            )}
          </CardContent>
        </Card>

      </div>

      {/* Edit User Modal Dialog */}
      <Dialog open={editingUser !== null} onOpenChange={(open) => {
        if (!open) {
          setEditingUser(null);
          setErrorMsg(null);
        }
      }}>
        <DialogContent className="w-[96vw] max-w-[96vw] sm:max-w-[96vw] h-[92vh] max-h-[92vh] rounded-[28px] border-none shadow-2xl bg-white p-5 sm:p-7 flex flex-col justify-between overflow-hidden">
          <DialogHeader className="pb-3 border-b border-slate-100 shrink-0">
            <DialogTitle className="text-xl font-extrabold flex items-center gap-2.5 text-slate-800">
              <UserCog className="w-6 h-6 text-indigo-500 shrink-0" />
              <span>Edit Otoritas Pengguna</span>
            </DialogTitle>
            <DialogDescription className="text-xs text-slate-400">
              Perbarui nama lengkap, level otoritas, atau izin unit kerja untuk <strong className="text-slate-700 font-semibold">{editingUser?.email}</strong>.
            </DialogDescription>
          </DialogHeader>

          {editingUser && (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 flex-1 min-h-0 py-3 overflow-y-auto lg:overflow-hidden">
              {/* LEFT COLUMN: Data Kredensial & Tingkat Otoritas */}
              <div className="flex flex-col gap-5 overflow-y-auto pr-1">
                {/* Card 1: Data Kredensial */}
                <div className="p-4 rounded-2xl bg-slate-50 border border-slate-100 space-y-4 shadow-xs">
                  <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest block flex items-center gap-1.5">
                    <User className="w-3.5 h-3.5 text-indigo-500" />
                    Data Kredensial
                  </span>

                  {/* Nama Lengkap Input */}
                  <div>
                    <Label htmlFor="editName" className="text-xs font-semibold text-slate-600 block mb-1.5">Nama Lengkap</Label>
                    <div className="relative">
                      <Input
                        id="editName"
                        placeholder="Ketik nama pegawai..."
                        value={editDisplayName}
                        onChange={(e) => {
                          setEditDisplayName(e.target.value);
                          setShowEditNameSuggestions(true);
                        }}
                        onFocus={() => setShowEditNameSuggestions(true)}
                        onBlur={() => {
                          setTimeout(() => setShowEditNameSuggestions(false), 200);
                        }}
                        className="rounded-xl border-slate-200 focus:border-indigo-500 focus:ring-indigo-500/20 h-[42px] bg-white text-sm font-semibold"
                        autoComplete="off"
                      />
                      {showEditNameSuggestions && (
                        <div className="absolute left-0 right-0 mt-1 bg-white border border-slate-200 rounded-xl shadow-2xl z-[999] max-h-48 overflow-y-auto divide-y divide-slate-50 animate-in fade-in slide-in-from-top-1">
                          {allEmployees
                            .filter(emp => emp.name.toLowerCase().includes(editDisplayName.toLowerCase()))
                            .map(emp => (
                              <div
                                key={emp.id}
                                onMouseDown={() => {
                                  setEditDisplayName(emp.name);
                                  setShowEditNameSuggestions(false);
                                }}
                                className="p-3 text-xs font-bold text-slate-700 hover:bg-indigo-50/50 cursor-pointer transition-colors"
                              >
                                {emp.name} ({emp.type === 'Pekarya' ? `Pekarya - ${emp.detail}` : `Loyalis - ${emp.detail}`})
                              </div>
                            ))}
                          {allEmployees.filter(emp => emp.name.toLowerCase().includes(editDisplayName.toLowerCase())).length === 0 && (
                            <div className="p-3 text-xs italic text-slate-400 bg-slate-50">Nama tidak ditemukan. Tetap gunakan "{editDisplayName}"</div>
                          )}
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Alamat Email Input */}
                  <div>
                    <Label htmlFor="editEmail" className="text-xs font-semibold text-slate-600 block mb-1.5">Alamat Email</Label>
                    <div className="relative">
                      <Mail className="absolute left-3 top-3 w-4 h-4 text-slate-400 pointer-events-none" />
                      <Input
                        id="editEmail"
                        type="email"
                        placeholder="Ketik alamat email..."
                        value={editEmail}
                        onChange={(e) => setEditEmail(e.target.value)}
                        className="pl-9 rounded-xl border-slate-200 focus:border-indigo-500 focus:ring-indigo-500/20 h-[42px] bg-white text-sm font-semibold"
                        autoComplete="off"
                      />
                    </div>
                  </div>
                </div>

                {/* Card 2: Peran & Otoritas */}
                <div className="p-4 rounded-2xl bg-slate-50 border border-slate-100 space-y-4 shadow-xs">
                  <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest block flex items-center gap-1.5">
                    <Shield className="w-3.5 h-3.5 text-indigo-500" />
                    Peran & Otoritas Sistem
                  </span>

                  <div>
                    <Label className="text-xs font-semibold text-slate-600 block mb-1.5">Tingkat Otoritas</Label>
                    <select
                      value={editRole}
                      onChange={(e) => {
                        const role = e.target.value as any;
                        setEditRole(role);
                        if (role !== 'satker_head') {
                          setEditPermitted([]);
                        }
                        if (role !== 'honorer' && role !== 'loyalis') {
                          setEditLinkedEmployeeId('');
                        }
                      }}
                      className="w-full text-sm font-bold text-slate-700 bg-white rounded-xl border border-slate-200 px-3.5 py-3 focus:outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20 shadow-xs"
                    >
                      <option value="satker_head">Kepala Satuan Kerja Pekarya (SatKer Pekarya)</option>
                      <option value="satker_head_loyalis">Kepala Satuan Kerja Loyalis (SatKer Loyalis)</option>
                      <option value="employee_admin">Staf Master Data Pegawai (Employee Admin)</option>
                      <option value="super_admin">Super Administrator (BAK)</option>
                      <option value="finance_verifier">Badan Keuangan (Verifikator)</option>
                      <option value="honorer">Karyawan Honorer (Lapor Kegiatan)</option>
                      <option value="loyalis">Karyawan Loyalis (Lihat Slip Gaji)</option>
                      <option value="loyalis_presence_admin">Penanggung Jawab Presensi Loyalis</option>
                      <option value="ketua_shift_satpam">Ketua Shift SATPAM (Lapor Shift Regu)</option>
                    </select>
                  </div>

                  {/* Role Summary Badge */}
                  <div className="p-3.5 rounded-xl bg-white border border-slate-200/80 text-xs leading-relaxed text-slate-600 space-y-1">
                    <span className="font-bold text-slate-800 text-[11px] block">Ringkasan Hak Akses:</span>
                    {editRole === 'satker_head' && <span>Dapat melakukan scan presensi dan approval kegiatan pada unit kerja yang diizinkan.</span>}
                    {editRole === 'satker_head_loyalis' && <span>Mengelola data vakasi & laporan kehadiran Loyalis secara penuh.</span>}
                    {editRole === 'employee_admin' && <span>Akses khusus pengelolaan Master Data Pegawai (White Collar & Blue Collar).</span>}
                    {editRole === 'super_admin' && <span>Akses penuh bypass ke seluruh modul payroll, legalitas, dan pengaturan pengguna.</span>}
                    {editRole === 'finance_verifier' && <span>Memverifikasi dan mengunci draf payroll, lalu membuat instruksi pembayaran.</span>}
                    {editRole === 'honorer' && <span>Akun khusus karyawan Pekarya untuk pelaporan kegiatan harian di Portal Karyawan.</span>}
                    {editRole === 'loyalis' && <span>Akun khusus karyawan Loyalis untuk melihat slip gaji digital mandiri.</span>}
                    {editRole === 'loyalis_presence_admin' && <span>Mengelola kalkulator presensi loyalis via raw daily logs.</span>}
                    {editRole === 'ketua_shift_satpam' && <span>Dapat melaporkan shift kehadiran harian seluruh anggota regunya.</span>}
                  </div>
                </div>
              </div>

              {/* RIGHT COLUMN: Hak Akses, Pengaturan Unit & Regu */}
              <div className="flex flex-col gap-4 overflow-y-auto pr-1">
                <div className="p-4 rounded-2xl bg-slate-50 border border-slate-100 space-y-4 shadow-xs h-full flex flex-col">
                  <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest block flex items-center gap-1.5">
                    <Layers className="w-3.5 h-3.5 text-indigo-500" />
                    {editRole === 'honorer' || editRole === 'loyalis' ? 'Hubungkan Data Pegawai' :
                     editRole === 'ketua_shift_satpam' ? 'Konfigurasi Regu & Shift Satpam' :
                     'Akses Unit Kerja'}
                  </span>

                  {/* Content per role */}
                  {editRole === 'super_admin' ? (
                    <div className="p-4 rounded-xl bg-amber-50/80 border border-amber-200/80 text-amber-900 text-xs font-medium leading-relaxed">
                      Super Administrator memiliki hak akses bypass ke <strong>seluruh unit kerja</strong>. Pilihan unit dinonaktifkan.
                    </div>
                  ) : editRole === 'employee_admin' ? (
                    <div className="p-4 rounded-xl bg-emerald-50/80 border border-emerald-200/80 text-emerald-900 text-xs font-medium leading-relaxed">
                      Employee Administrator memiliki hak akses penuh ke <strong>seluruh data pegawai</strong>. Pilihan unit dinonaktifkan.
                    </div>
                  ) : editRole === 'satker_head_loyalis' ? (
                    <div className="p-4 rounded-xl bg-violet-50/80 border border-violet-200/80 text-violet-900 text-xs font-medium leading-relaxed">
                      Kepala Satuan Kerja Loyalis secara otomatis memiliki hak akses penuh ke <strong>seluruh unit Loyalis</strong>.
                    </div>
                  ) : editRole === 'loyalis_presence_admin' ? (
                    <div className="p-4 rounded-xl bg-pink-50/80 border border-pink-200/80 text-pink-900 text-xs font-medium leading-relaxed">
                      Penanggung Jawab Presensi Loyalis memiliki akses khusus ke kalkulator presensi loyalis via raw daily logs.
                    </div>
                  ) : editRole === 'ketua_shift_satpam' ? (
                    <div className="space-y-4 flex-1 flex flex-col">
                      <div className="p-3.5 rounded-xl bg-purple-50 border border-purple-100 text-purple-900 text-xs leading-relaxed font-medium">
                        Atur Ketua Shift dan alokasi <strong>tepat 9 anggota regu</strong> yang dipimpin (Total roster 10 personel).
                      </div>

                      {/* 1. Pilih Ketua Shift */}
                      <div className="space-y-1.5">
                        <Label className="text-xs font-semibold text-slate-600">Pilih Ketua Shift</Label>
                        <select
                          value={editLinkedEmployeeId}
                          onChange={(e) => {
                            setEditLinkedEmployeeId(e.target.value);
                            setEditTeamMembers(prev => prev.filter(id => id !== e.target.value));
                          }}
                          className={`w-full text-sm font-bold text-slate-700 bg-white rounded-xl border px-3 py-2.5 focus:outline-none ${
                            !editLinkedEmployeeId ? 'border-rose-300 focus:border-rose-500 focus:ring-2 focus:ring-rose-500/20' : 'border-slate-200 focus:border-purple-500 focus:ring-2 focus:ring-purple-500/20'
                          }`}
                        >
                          <option value="">-- Pilih Ketua Shift --</option>
                          {allEmployees
                            .filter(emp => emp.type === 'Pekarya' && emp.detail === 'SATPAM')
                            .map(emp => (
                              <option key={emp.id} value={emp.id}>
                                {emp.name}
                              </option>
                            ))}
                        </select>
                        {!editLinkedEmployeeId && (
                          <div className="p-2.5 rounded-xl bg-rose-50 border border-rose-200/80 text-rose-800 text-xs font-medium flex items-center gap-2">
                            <AlertCircle className="w-4 h-4 text-rose-600 shrink-0" />
                            <span>Ketua Shift belum dipilih. Silakan pilih 1 Ketua Shift Satpam.</span>
                          </div>
                        )}
                      </div>

                      {/* 2. Pilih Nomor Regu */}
                      <div className="space-y-1.5">
                        <Label className="text-xs font-semibold text-slate-600">Nomor Regu (Roster Team Slot)</Label>
                        <select
                          value={editTeamNumber}
                          onChange={(e) => {
                            const selectedTeamNum = e.target.value;
                            setEditTeamNumber(selectedTeamNum);
                            const matchedTeam = shiftTeams.find(t => t.id === `team_${selectedTeamNum}`);
                            if (matchedTeam) {
                              setEditTeamMembers(matchedTeam.memberEmployeeIds || []);
                            }
                          }}
                          className="w-full text-sm font-bold text-slate-700 bg-white rounded-xl border border-slate-200 px-3 py-2.5 focus:outline-none focus:border-purple-500"
                        >
                          <option value="1">Regu 1 (Slot: Shift {getSatpamShiftForTeam(1, new Date())})</option>
                          <option value="2">Regu 2 (Slot: Shift {getSatpamShiftForTeam(2, new Date())})</option>
                          <option value="3">Regu 3 (Slot: Shift {getSatpamShiftForTeam(3, new Date())})</option>
                        </select>
                      </div>

                      {/* Warning Banner for Team Conflict / Reorganization */}
                      {(() => {
                        const selectedTeam = shiftTeams.find(t => t.id === `team_${editTeamNumber}`);
                        const currentLeaderId = selectedTeam?.ketuaShiftId;
                        const currentLeaderName = selectedTeam?.ketuaShiftName;
                        const isConflict = currentLeaderId && currentLeaderId !== editLinkedEmployeeId;
                        const selectedEmpName = allEmployees.find(e => e.id === editLinkedEmployeeId)?.name || 'Pengguna ini';
                        const otherTeam = shiftTeams.find(t => t.ketuaShiftId === editLinkedEmployeeId && t.id !== `team_${editTeamNumber}`);

                        const overlappingMembers = editTeamMembers.map(empId => {
                          const emp = allEmployees.find(e => e.id === empId);
                          const other = shiftTeams.find(t => t.id !== `team_${editTeamNumber}` && (t.ketuaShiftId === empId || t.memberEmployeeIds?.includes(empId)));
                          return other ? { name: emp?.name || empId, teamNum: other.id.split('_')[1] } : null;
                        }).filter((item): item is { name: string; teamNum: string } => item !== null);

                        return (
                          <>
                            {isConflict && (
                              <div className="p-3.5 rounded-xl bg-amber-50 border border-amber-200/80 text-amber-900 text-xs font-medium space-y-1 shadow-xs">
                                <div className="flex items-center gap-2 font-bold text-amber-800">
                                  <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0" />
                                  <span>Perhatian: Reorganisasi Ketua Shift</span>
                                </div>
                                <p className="leading-relaxed text-[11px] text-amber-700">
                                  Regu {editTeamNumber} saat ini dipimpin oleh <strong className="font-bold underline decoration-amber-400">{currentLeaderName}</strong>. Menyimpan perubahan ini akan menetapkan <strong className="font-bold">{selectedEmpName}</strong> sebagai Ketua Shift Regu {editTeamNumber} menggantikan {currentLeaderName}.
                                </p>
                              </div>
                            )}

                            {otherTeam && (
                              <div className="p-3 rounded-xl bg-blue-50 border border-blue-200/80 text-blue-900 text-xs font-medium space-y-1 shadow-xs">
                                <div className="flex items-center gap-2 font-bold text-blue-800">
                                  <Shield className="w-4 h-4 text-blue-600 shrink-0" />
                                  <span>Pemindahan Kepemimpinan Regu</span>
                                </div>
                                <p className="leading-relaxed text-[11px] text-blue-700">
                                  {selectedEmpName} masih tercatat di Regu {otherTeam.id.split('_')[1]}. Simpan akan ditolak sampai konfigurasi regu lama diselesaikan agar tidak ada keanggotaan ganda.
                                </p>
                              </div>
                            )}

                            {overlappingMembers.length > 0 && (
                              <div className="p-3 rounded-xl bg-rose-50 border border-rose-200/80 text-rose-900 text-xs font-medium space-y-1 shadow-xs">
                                <div className="flex items-center gap-2 font-bold text-rose-800">
                                  <AlertCircle className="w-4 h-4 text-rose-600 shrink-0" />
                                  <span>Konflik Keanggotaan Regu Ganda</span>
                                </div>
                                <p className="leading-relaxed text-[11px] text-rose-700">
                                  Anggota berikut masih terdaftar di regu lain: <strong>{overlappingMembers.map(m => `${m.name} (Regu ${m.teamNum})`).join(', ')}</strong>. Lepaskan keanggotaan regu lama agar simpan tidak ditolak.
                                </p>
                              </div>
                            )}
                          </>
                        );
                      })()}

                      {/* 3. Pilih Anggota Regu */}
                      <div className="space-y-1.5 flex-1 flex flex-col min-h-0">
                        <Label className="text-xs font-semibold text-slate-600 flex justify-between items-center">
                          <span>Pilih Anggota Regu</span>
                          <span className={editTeamMembers.length === 9 ? "text-emerald-700 bg-emerald-50 border border-emerald-200 px-2 py-0.5 rounded-md font-bold text-xs flex items-center gap-1" : "text-rose-700 bg-rose-50 border border-rose-200 px-2 py-0.5 rounded-md font-bold text-xs flex items-center gap-1"}>
                            {editTeamMembers.length === 9 ? <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" /> : <AlertCircle className="w-3.5 h-3.5 text-rose-600" />}
                            {editTeamMembers.length} / 9 Terpilih
                          </span>
                        </Label>
                        
                        {editTeamMembers.length !== 9 && (
                          <div className="p-2.5 rounded-xl bg-rose-50 border border-rose-200/80 text-rose-800 text-xs font-medium flex items-center gap-2">
                            <AlertCircle className="w-4 h-4 text-rose-600 shrink-0" />
                            <span>
                              {editTeamMembers.length < 9 
                                ? `Jumlah anggota kurang. Pilih ${9 - editTeamMembers.length} anggota regu lagi agar tepat 9 orang.`
                                : `Jumlah anggota kelebihan. Hapus ${editTeamMembers.length - 9} anggota regu agar tepat 9 orang.`}
                            </span>
                          </div>
                        )}

                        <div className="p-3 rounded-xl bg-white border border-slate-200/80 flex-1 min-h-[160px] overflow-y-auto space-y-2">
                          {allEmployees
                            .filter(emp => emp.type === 'Pekarya' && emp.detail === 'SATPAM' && emp.id !== editLinkedEmployeeId)
                            .map(emp => {
                              const isChecked = editTeamMembers.includes(emp.id);
                              const assignedOtherTeam = shiftTeams.find(t => t.id !== `team_${editTeamNumber}` && (t.ketuaShiftId === emp.id || t.memberEmployeeIds?.includes(emp.id)));

                              return (
                                <div key={emp.id} className="flex items-center justify-between hover:bg-slate-50 p-1 rounded-lg transition-colors">
                                  <div className="flex items-center space-x-2.5">
                                    <Checkbox
                                      id={`edit-member-${emp.id}`}
                                      checked={isChecked}
                                      onCheckedChange={() => {
                                        setEditTeamMembers(prev => 
                                          prev.includes(emp.id)
                                            ? prev.filter(id => id !== emp.id)
                                            : [...prev, emp.id]
                                        );
                                      }}
                                      className="rounded border-slate-300 data-[state=checked]:bg-purple-600 data-[state=checked]:border-purple-600"
                                    />
                                    <Label htmlFor={`edit-member-${emp.id}`} className="text-xs font-bold text-slate-700 cursor-pointer select-none">
                                      {emp.name}
                                    </Label>
                                  </div>
                                  {assignedOtherTeam && (
                                    <span className="text-[10px] font-bold text-amber-700 bg-amber-100 border border-amber-200 px-1.5 py-0.5 rounded shrink-0">
                                      Regu {assignedOtherTeam.id.split('_')[1]}
                                    </span>
                                  )}
                                </div>
                              );
                            })}
                        </div>
                      </div>
                    </div>
                  ) : editRole === 'honorer' ? (
                    <div className="space-y-3">
                      <div className="p-3 rounded-xl bg-teal-50 border border-teal-100 text-teal-800 text-[11px] font-medium leading-relaxed">
                        Pilih karyawan Pekarya yang dihubungkan ke akun ini.
                      </div>
                      <div className="relative">
                        <Input
                          placeholder="Cari nama karyawan Pekarya..."
                          value={editEmployeeSearchText}
                          onChange={(e) => {
                            setEditEmployeeSearchText(e.target.value);
                            if (!e.target.value) {
                              setEditLinkedEmployeeId('');
                            }
                            setShowEditEmployeeSuggestions(true);
                          }}
                          onFocus={() => setShowEditEmployeeSuggestions(true)}
                          onBlur={() => {
                            setTimeout(() => setShowEditEmployeeSuggestions(false), 200);
                          }}
                          className="rounded-xl border-slate-200 focus:border-teal-400 focus:ring-teal-400/20 h-[42px] bg-white font-semibold text-sm"
                          autoComplete="off"
                        />
                        {showEditEmployeeSuggestions && (
                          <div className="absolute left-0 right-0 mt-1 bg-white border border-slate-200 rounded-xl shadow-2xl z-[999] max-h-48 overflow-y-auto divide-y divide-slate-50 animate-in fade-in slide-in-from-top-1">
                            {cleaningEmployees
                              .filter(emp => emp.name.toLowerCase().includes(editEmployeeSearchText.toLowerCase()))
                              .map(emp => (
                                <div
                                  key={emp.id}
                                  onMouseDown={() => {
                                    setEditLinkedEmployeeId(emp.id);
                                    setEditEmployeeSearchText(`${emp.name} (${emp.category})`);
                                    setShowEditEmployeeSuggestions(false);
                                  }}
                                  className="p-3 text-xs font-bold text-slate-700 hover:bg-teal-50/50 cursor-pointer transition-colors"
                                >
                                  {emp.name} ({emp.category})
                                </div>
                              ))}
                            {cleaningEmployees.filter(emp => emp.name.toLowerCase().includes(editEmployeeSearchText.toLowerCase())).length === 0 && (
                              <div className="p-3 text-xs italic text-slate-400 bg-slate-50">Karyawan tidak ditemukan.</div>
                            )}
                          </div>
                        )}
                      </div>
                    </div>
                  ) : editRole === 'loyalis' ? (
                    <div className="space-y-3">
                      <div className="p-3 rounded-xl bg-sky-50 border border-sky-100 text-sky-800 text-[11px] font-medium leading-relaxed">
                        Pilih karyawan Loyalis yang dihubungkan ke akun ini.
                      </div>
                      <select
                        value={editLinkedEmployeeId}
                        onChange={(e) => setEditLinkedEmployeeId(e.target.value)}
                        className="w-full text-sm font-bold text-slate-700 bg-white rounded-xl border border-slate-200 px-3 py-2.5 focus:outline-none focus:border-sky-400 focus:ring-2 focus:ring-sky-400/20"
                      >
                        <option value="">-- Pilih Karyawan --</option>
                        {allEmployees
                          .filter(emp => emp.type === 'Loyalis')
                          .map(emp => (
                            <option key={emp.id} value={emp.id}>
                              {emp.name} ({emp.detail})
                            </option>
                          ))}
                      </select>
                    </div>
                  ) : (
                    <div className="p-3.5 rounded-xl border border-slate-200 bg-white max-h-[300px] overflow-y-auto space-y-2.5">
                      {dynamicCategories.map(cat => {
                        const isChecked = editPermitted.includes(cat);
                        return (
                          <div key={cat} className="flex items-center space-x-2.5 hover:bg-slate-50 p-1.5 rounded-lg transition-colors">
                            <Checkbox
                              id={`edit-cat-${cat}`}
                              checked={isChecked}
                              onCheckedChange={() => handleToggleEditPermitted(cat)}
                              className="rounded border-slate-300 data-[state=checked]:bg-indigo-600"
                            />
                            <Label htmlFor={`edit-cat-${cat}`} className="text-xs font-bold text-slate-700 uppercase cursor-pointer select-none">
                              {cat}
                            </Label>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}

          <DialogFooter className="pt-3 border-t border-slate-100 shrink-0 flex items-center justify-end gap-3">
            <Button
              type="button"
              variant="outline"
              onClick={() => setEditingUser(null)}
              className="rounded-xl border-slate-200 text-slate-600 font-bold hover:bg-slate-50 px-5"
            >
              Batal
            </Button>
            <Button
              type="button"
              disabled={actionLoading}
              onClick={handleUpdateUser}
              className="rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white font-bold px-6 shadow-sm shadow-indigo-200 flex items-center gap-2"
            >
              {actionLoading && <Loader2 className="w-4 h-4 animate-spin text-white" />}
              Simpan Perubahan
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete User Confirmation Modal */}
      <Dialog open={deletingUser !== null} onOpenChange={(open) => !open && setDeletingUser(null)}>
        <DialogContent className="sm:max-w-md max-w-full rounded-3xl border-none shadow-2xl bg-white p-6">
          <DialogHeader>
            <DialogTitle className="text-xl font-bold flex items-center gap-2 text-rose-600">
              <AlertTriangle className="w-6 h-6 shrink-0" />
              Nonaktifkan Akun Pengguna?
            </DialogTitle>
            <DialogDescription className="text-slate-500 text-sm mt-1 leading-relaxed">
              Akun <strong>{deletingUser?.email}</strong> akan langsung kehilangan akses login. Profil, referensi, dan seluruh riwayat audit tetap disimpan dan tidak dihapus.
            </DialogDescription>
          </DialogHeader>

          <DialogFooter className="gap-2 mt-4 shrink-0">
            <Button
              type="button"
              variant="ghost"
              onClick={() => setDeletingUser(null)}
              className="rounded-xl font-bold text-slate-500 hover:bg-slate-50"
            >
              Batal
            </Button>
            <Button
              onClick={handleDeleteUser}
              disabled={actionLoading}
              className="rounded-xl bg-rose-600 text-white font-bold hover:bg-rose-700 shadow-md shadow-rose-100 flex items-center gap-2"
            >
              {actionLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <UserX className="w-4 h-4" />}
              Ya, Nonaktifkan
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

    </div>
  );
}
