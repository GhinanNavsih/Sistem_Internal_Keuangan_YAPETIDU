"use client";

import React, { useState, useEffect, useMemo, useRef } from 'react';
import GlobalHeader from '@/components/GlobalHeader';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
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
  Trash2,
  Loader2,
  CheckCircle2,
  AlertTriangle,
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
} from 'lucide-react';
import { db } from '@/lib/firebase';
import { collection, getDocs, doc, setDoc } from 'firebase/firestore';
import { SUPPORTED_CATEGORIES } from '@/utils/rekapConfig';

interface ManagedUser {
  uid: string;
  email: string;
  displayName?: string;
  role: 'super_admin' | 'satker_head' | 'satker_head_loyalis' | 'employee_admin' | 'honorer' | 'loyalis' | 'loyalis_presence_admin' | 'ketua_shift_satpam';
  permittedCategories: string[];
  linkedEmployeeId?: string;
  createdAt?: string;
}

interface CleaningEmployee {
  id: string;
  name: string;
  category: string;
}

interface DropdownEmployee {
  id: string;
  name: string;
  type: 'Pekarya' | 'Loyalis' | 'Lainnya';
  detail?: string;
  email?: string;
}

export default function UserManagementPage() {
  const router = useRouter();
  const { user, profile, loading: authLoading } = useAuth();

  // Redirect if not super admin (additional client guard beyond ProtectedRoute)
  useEffect(() => {
    if (!authLoading && (!user || profile?.role !== 'super_admin')) {
      router.replace('/dashboard/payroll');
    }
  }, [user, profile, authLoading, router]);

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
  const [newRole, setNewRole] = useState<'super_admin' | 'satker_head' | 'satker_head_loyalis' | 'employee_admin' | 'honorer' | 'loyalis' | 'loyalis_presence_admin' | 'ketua_shift_satpam'>('satker_head');
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
  const [editRole, setEditRole] = useState<'super_admin' | 'satker_head' | 'satker_head_loyalis' | 'employee_admin' | 'honorer' | 'loyalis' | 'loyalis_presence_admin' | 'ketua_shift_satpam'>('satker_head');
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
        getDocs(collection(db, 'Employees_BlueCollar')),
        getDocs(collection(db, 'Employees_Loyalis'))
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
      const shiftTeamsSnap = await getDocs(collection(db, 'SatpamShiftTeams'));
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
        const selectedEmp = allEmployees.find(e => e.id === newLinkedEmployeeId);
        await setDoc(doc(db, 'SatpamShiftTeams', `team_${newTeamNumber}`), {
          ketuaShiftId: newLinkedEmployeeId,
          ketuaShiftName: selectedEmp ? selectedEmp.name : '',
          memberEmployeeIds: newTeamMembers,
          updatedAt: new Date().toISOString(),
        });
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
      setEditTeamMembers([]);
    }
  };

  // Submit Edit changes
  const handleUpdateUser = async () => {
    if (!user || !editingUser || isActionLoadingRef.current) return;
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
        const selectedEmp = allEmployees.find(e => e.id === editLinkedEmployeeId);
        await setDoc(doc(db, 'SatpamShiftTeams', `team_${editTeamNumber}`), {
          ketuaShiftId: editLinkedEmployeeId,
          ketuaShiftName: selectedEmp ? selectedEmp.name : '',
          memberEmployeeIds: editTeamMembers,
          updatedAt: new Date().toISOString(),
        });
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

  // Open Delete confirmation dialog
  const openDeleteDialog = (u: ManagedUser) => {
    setDeletingUser(u);
  };

  // Execute Delete
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
        throw new Error(errData.error || 'Gagal menghapus pengguna.');
      }

      setSuccessMsg(`Akun ${deletingUser.email} berhasil dihapus dari sistem.`);
      setDeletingUser(null);
      router.refresh();
      await fetchData();
    } catch (err: any) {
      setErrorMsg(err.message || 'Terjadi kesalahan saat menghapus pengguna.');
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
        {successMsg && (
          <div className="flex items-center gap-2.5 px-4 py-3.5 rounded-2xl text-sm font-semibold bg-emerald-50 text-emerald-800 border border-emerald-100 shadow-sm animate-in fade-in slide-in-from-top-2 duration-300">
            <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
            <span>{successMsg}</span>
          </div>
        )}

        {errorMsg && (
          <div className="flex items-center gap-2.5 px-4 py-3.5 rounded-2xl text-sm font-semibold bg-rose-50 text-rose-800 border border-rose-100 shadow-sm animate-in fade-in slide-in-from-top-2 duration-300">
            <AlertTriangle className="w-4 h-4 text-rose-600 shrink-0" />
            <span>{errorMsg}</span>
          </div>
        )}

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
                          <div className="p-4 rounded-2xl bg-purple-50/50 border border-purple-100 text-purple-800 text-xs leading-relaxed font-medium">
                            Pilih Ketua Shift dan atur regu anggotanya (maksimal 9 anggota).
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
                              className="w-full text-sm font-bold text-slate-700 bg-white rounded-xl border border-slate-200 px-3 py-2.5 focus:outline-none focus:border-purple-500 focus:ring-2 focus:ring-purple-500/20"
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
                          </div>

                          {/* 2. Pilih Nomor Regu */}
                          <div className="space-y-1.5">
                            <Label className="text-xs font-semibold text-slate-500">Nomor Regu (Roster Team Slot)</Label>
                            <select
                              value={newTeamNumber}
                              onChange={(e) => setNewTeamNumber(e.target.value)}
                              className="w-full text-sm font-bold text-slate-700 bg-white rounded-xl border border-slate-200 px-3 py-2.5 focus:outline-none focus:border-purple-500"
                            >
                              <option value="1">Regu 1 (Slot: {(shiftTeams.find(t => t.id === 'team_1')?.ketuaShiftName || 'BASTOMI').toUpperCase()})</option>
                              <option value="2">Regu 2 (Slot: {(shiftTeams.find(t => t.id === 'team_2')?.ketuaShiftName || 'MUJIONO').toUpperCase()})</option>
                              <option value="3">Regu 3 (Slot: {(shiftTeams.find(t => t.id === 'team_3')?.ketuaShiftName || 'SUHARIONO').toUpperCase()})</option>
                            </select>
                          </div>

                          {/* 3. Pilih Anggota Regu */}
                          <div className="space-y-1.5">
                            <Label className="text-xs font-semibold text-slate-500 flex justify-between">
                              <span>Pilih Anggota Regu</span>
                              <span className="text-purple-600 font-bold">Terpilih: {newTeamMembers.length}</span>
                            </Label>
                            
                            <div className="p-4 rounded-2xl bg-slate-50 border border-slate-100 max-h-[220px] overflow-y-auto space-y-2.5">
                              {allEmployees
                                .filter(emp => emp.type === 'Pekarya' && emp.detail === 'SATPAM' && emp.id !== newLinkedEmployeeId)
                                .map(emp => {
                                  const isChecked = newTeamMembers.includes(emp.id);
                                  return (
                                    <div key={emp.id} className="flex items-center space-x-2.5">
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
                            <div className="flex justify-end gap-1.5">
                              <Button
                                variant="ghost"
                                size="icon"
                                onClick={() => openEditDialog(u)}
                                className="h-8 w-8 rounded-lg text-slate-400 hover:text-indigo-600 hover:bg-indigo-50/50"
                              >
                                <Pencil className="w-4 h-4" />
                              </Button>
                              <Button
                                variant="ghost"
                                size="icon"
                                disabled={isMe}
                                onClick={() => openDeleteDialog(u)}
                                className="h-8 w-8 rounded-lg text-slate-400 hover:text-rose-600 hover:bg-rose-50/50 disabled:opacity-30 disabled:pointer-events-none"
                              >
                                <Trash2 className="w-4 h-4" />
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
      <Dialog open={editingUser !== null} onOpenChange={(open) => !open && setEditingUser(null)}>
        <DialogContent className="sm:max-w-md max-w-full rounded-3xl border-none shadow-2xl bg-white p-6">
          <DialogHeader>
            <DialogTitle className="text-xl font-bold flex items-center gap-2 text-slate-900">
              <UserCog className="w-5.5 h-5.5 text-indigo-600" />
              Edit Otoritas Pengguna
            </DialogTitle>
            <DialogDescription className="text-slate-500">
              Perbarui nama lengkap, level otoritas, atau izin unit kerja untuk <strong>{editingUser?.email}</strong>.
            </DialogDescription>
          </DialogHeader>

          {editingUser && (
            <div className="space-y-5 py-4">
              {/* Display Name */}
              <div>
                <Label htmlFor="editName" className="text-xs font-semibold text-slate-500 block mb-1.5">Nama Lengkap</Label>
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
                    className="rounded-xl border-slate-200 mt-0 focus:border-indigo-500 focus:ring-indigo-500/20 h-[42px]"
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

              {/* Email Address */}
              <div>
                <Label htmlFor="editEmail" className="text-xs font-semibold text-slate-500 block mb-1.5">Alamat Email</Label>
                <Input
                  id="editEmail"
                  type="email"
                  placeholder="Ketik alamat email..."
                  value={editEmail}
                  onChange={(e) => setEditEmail(e.target.value)}
                  className="rounded-xl border-slate-200 mt-0 focus:border-indigo-500 focus:ring-indigo-500/20 h-[42px]"
                  autoComplete="off"
                />
              </div>

              {/* Role */}
              <div>
                <Label className="text-xs font-semibold text-slate-500">Tingkat Otoritas</Label>
                <div className="mt-1.5">
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
                    className="w-full text-sm font-bold text-slate-700 bg-white rounded-xl border border-slate-200 px-3 py-2.5 focus:outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20"
                  >
                    <option value="satker_head">Kepala Satuan Kerja Pekarya (SatKer Pekarya)</option>
                    <option value="satker_head_loyalis">Kepala Satuan Kerja Loyalis (SatKer Loyalis)</option>
                    <option value="employee_admin">Staf Master Data Pegawai (Employee Admin)</option>
                    <option value="super_admin">Super Administrator (BAK)</option>
                    <option value="honorer">Karyawan Honorer (Lapor Kegiatan)</option>
                    <option value="loyalis">Karyawan Loyalis (Lihat Slip Gaji)</option>
                    <option value="loyalis_presence_admin">Penanggung Jawab Presensi Loyalis</option>
                    <option value="ketua_shift_satpam">Ketua Shift SATPAM (Lapor Shift Regu)</option>
                  </select>
                </div>
              </div>

              {/* Permitted Categories */}
              <div>
                <Label className="text-xs font-semibold text-slate-500">Akses Satuan Kerja (Unit)</Label>
                {editRole === 'super_admin' ? (
                  <div className="p-3 rounded-xl bg-amber-50 border border-amber-100 text-amber-800 text-[11px] font-medium leading-relaxed mt-1.5">
                    Super Administrator memiliki hak akses bypass ke seluruh unit. Pilihan dinonaktifkan.
                  </div>
                ) : editRole === 'employee_admin' ? (
                  <div className="p-3 rounded-xl bg-emerald-50 border border-emerald-100 text-emerald-800 text-[11px] font-medium leading-relaxed mt-1.5">
                    Employee Administrator memiliki hak akses penuh ke seluruh data pegawai. Pilihan dinonaktifkan.
                  </div>
                ) : editRole === 'satker_head_loyalis' ? (
                  <div className="p-3 rounded-xl bg-violet-50 border border-violet-100 text-violet-800 text-[11px] font-medium leading-relaxed mt-1.5">
                    Kepala Satuan Kerja Loyalis secara otomatis memiliki hak akses penuh ke seluruh data Loyalis. Pilihan dinonaktifkan.
                  </div>
                ) : editRole === 'loyalis_presence_admin' ? (
                  <div className="p-3 rounded-xl bg-pink-50 border border-pink-100 text-pink-800 text-[11px] font-medium leading-relaxed mt-1.5">
                    Penanggung Jawab Presensi Loyalis memiliki akses khusus ke halaman kalkulator presensi loyalis via raw daily logs. Pilihan dinonaktifkan.
                  </div>
                ) : editRole === 'ketua_shift_satpam' ? (
                  <div className="space-y-4 mt-1.5">
                    <div className="p-3 rounded-xl bg-purple-50 border border-purple-100 text-purple-800 text-[11px] font-medium leading-relaxed">
                      Pilih Ketua Shift dan atur regu anggotanya (maksimal 9 anggota).
                    </div>
                    
                    {/* 1. Pilih Ketua Shift */}
                    <div className="space-y-1.5">
                      <Label className="text-xs font-semibold text-slate-500">Pilih Ketua Shift</Label>
                      <select
                        value={editLinkedEmployeeId}
                        onChange={(e) => {
                          setEditLinkedEmployeeId(e.target.value);
                          setEditTeamMembers(prev => prev.filter(id => id !== e.target.value));
                        }}
                        className="w-full text-sm font-bold text-slate-700 bg-white rounded-xl border border-slate-200 px-3 py-2 focus:outline-none focus:border-purple-500 focus:ring-2 focus:ring-purple-500/20"
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
                    </div>

                    {/* 2. Pilih Nomor Regu */}
                    <div className="space-y-1.5">
                      <Label className="text-xs font-semibold text-slate-500">Nomor Regu (Roster Team Slot)</Label>
                      <select
                        value={editTeamNumber}
                        onChange={(e) => setEditTeamNumber(e.target.value)}
                        className="w-full text-sm font-bold text-slate-700 bg-white rounded-xl border border-slate-200 px-3 py-2 focus:outline-none focus:border-purple-500"
                      >
                        <option value="1">Regu 1 (Slot: {(shiftTeams.find(t => t.id === 'team_1')?.ketuaShiftName || 'BASTOMI').toUpperCase()})</option>
                        <option value="2">Regu 2 (Slot: {(shiftTeams.find(t => t.id === 'team_2')?.ketuaShiftName || 'MUJIONO').toUpperCase()})</option>
                        <option value="3">Regu 3 (Slot: {(shiftTeams.find(t => t.id === 'team_3')?.ketuaShiftName || 'SUHARIONO').toUpperCase()})</option>
                      </select>
                    </div>

                    {/* 3. Pilih Anggota Regu */}
                    <div className="space-y-1.5">
                      <Label className="text-xs font-semibold text-slate-500 flex justify-between">
                        <span>Pilih Anggota Regu</span>
                        <span className="text-purple-600 font-bold">Terpilih: {editTeamMembers.length}</span>
                      </Label>
                      
                      <div className="p-3 rounded-xl bg-slate-50 border border-slate-100 max-h-[180px] overflow-y-auto space-y-2">
                        {allEmployees
                          .filter(emp => emp.type === 'Pekarya' && emp.detail === 'SATPAM' && emp.id !== editLinkedEmployeeId)
                          .map(emp => {
                            const isChecked = editTeamMembers.includes(emp.id);
                            return (
                              <div key={emp.id} className="flex items-center space-x-2.5">
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
                            );
                          })}
                      </div>
                    </div>
                  </div>
                ) : editRole === 'honorer' ? (
                  <div className="space-y-3 mt-1.5">
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
                        className="rounded-xl border-slate-200 focus:border-teal-400 focus:ring-teal-400/20 h-[42px]"
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
                  <div className="space-y-3 mt-1.5">
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
                  <div className="p-3.5 rounded-xl border border-slate-100 bg-slate-50 max-h-[140px] overflow-y-auto space-y-2 mt-1.5">
                    {dynamicCategories.map(cat => {
                      const isChecked = editPermitted.includes(cat);
                      return (
                        <div key={cat} className="flex items-center space-x-2.5">
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
          )}

          <DialogFooter className="gap-2">
            <Button
              type="button"
              variant="ghost"
              autoFocus
              onClick={() => setEditingUser(null)}
              className="rounded-xl font-bold text-slate-500 hover:bg-slate-50"
            >
              Batal
            </Button>
            <Button
              onClick={handleUpdateUser}
              disabled={actionLoading}
              className="rounded-xl bg-indigo-600 text-white font-bold hover:bg-indigo-700 shadow-md shadow-indigo-100 flex items-center gap-2"
            >
              {actionLoading && <Loader2 className="w-4 h-4 animate-spin" />}
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
              Hapus Akun Pengguna?
            </DialogTitle>
            <DialogDescription className="text-slate-500 text-sm mt-1 leading-relaxed">
              Tindakan ini bersifat **permanen**. Akun dengan email <strong>{deletingUser?.email}</strong> akan dihapus sepenuhnya dari Firebase Authentication (sehingga mereka tidak bisa login lagi) dan profil di Firestore akan dihapus.
            </DialogDescription>
          </DialogHeader>

          <DialogFooter className="gap-2 mt-4 shrink-0">
            <Button
              type="button"
              variant="ghost"
              onClick={() => setDeletingUser(null)}
              className="rounded-xl font-bold text-slate-500 hover:bg-slate-50"
            >
              Batal, Simpan Akun
            </Button>
            <Button
              onClick={handleDeleteUser}
              disabled={actionLoading}
              className="rounded-xl bg-rose-600 text-white font-bold hover:bg-rose-700 shadow-md shadow-rose-100 flex items-center gap-2"
            >
              {actionLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Trash2 className="w-4 h-4" />}
              Ya, Hapus Permanen
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

    </div>
  );
}
