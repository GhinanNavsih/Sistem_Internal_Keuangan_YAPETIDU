"use client";

import { Suspense, useCallback } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useRouter, useSearchParams } from 'next/navigation';
import { collection, getDocsFromServer } from 'firebase/firestore';
import { Loader2, RefreshCw } from 'lucide-react';
import GlobalHeader from '@/components/GlobalHeader';
import { Button } from '@/components/ui/button';
import SimpanPinjamAuditView, { type SimpanPinjamDoc } from '@/components/koperasi/SimpanPinjamAuditView';
import KoperasiMembersView from '@/components/koperasi/KoperasiMembersView';
import { useAuth } from '@/lib/AuthContext';
import { db, secondaryDb } from '@/lib/firebase';
import { isConvertedAway } from '@/lib/employeeConversion';
import { toKoperasiEmployee, type KoperasiMember } from '@/lib/koperasiMembers';
import { usePayrollCacheInvalidation } from '@/lib/queries/hooks';

function Loading() {
  return <div className="flex min-h-[60vh] items-center justify-center gap-3 text-slate-500"><Loader2 className="size-6 animate-spin" />Memuat data Koperasi...</div>;
}

function KoperasiPageContent() {
  const { profile, loading: authLoading } = useAuth();
  const searchParams = useSearchParams();
  const router = useRouter();
  const view = searchParams.get('view') === 'simpan-pinjam' ? 'simpan-pinjam' : 'koperasi';
  const { invalidateKoperasi, invalidateEmployees } = usePayrollCacheInvalidation();
  const { data, error, isFetching: loading, refetch } = useQuery({
    queryKey: ['koperasi-member-management', profile?.uid],
    enabled: !authLoading && profile?.role === 'super_admin',
    queryFn: async () => {
      const [loans, users, loyalis, pekarya] = await Promise.all([
        getDocsFromServer(collection(secondaryDb, 'simpanPinjam')),
        getDocsFromServer(collection(secondaryDb, 'users')),
        getDocsFromServer(collection(db, 'Employees_Loyalis')),
        getDocsFromServer(collection(db, 'Employees_BlueCollar')),
      ]);
      return {
        loans: loans.docs.map(doc => ({ ...doc.data(), id: doc.id } as SimpanPinjamDoc)),
        members: users.docs.map(doc => ({ ...doc.data(), id: doc.id } as KoperasiMember)),
        employees: [
          ...loyalis.docs.map(doc => toKoperasiEmployee(doc.id, 'Employees_Loyalis', doc.data())),
          ...pekarya.docs.filter(doc => !isConvertedAway(doc.data())).map(doc => toKoperasiEmployee(doc.id, 'Employees_BlueCollar', doc.data())),
        ],
      };
    },
  });
  const reload = useCallback(async () => {
    if (profile?.role !== 'super_admin') return;
    await Promise.all([refetch(), invalidateKoperasi(), invalidateEmployees()]);
  }, [profile?.role, refetch, invalidateKoperasi, invalidateEmployees]);

  if (authLoading) return <Loading />;
  if (profile?.role !== 'super_admin') return <div className="p-10 text-center"><h1 className="text-xl font-bold">Akses Ditolak</h1><p>Halaman Koperasi hanya untuk Super Admin.</p></div>;

  const navigation = <div className="mb-6 space-y-3">
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div className="inline-flex gap-1 rounded-xl border border-slate-200/70 bg-white p-1 shadow-sm" aria-label="Tampilan Koperasi">
        {(['koperasi', 'simpan-pinjam'] as const).map(value => <Button key={value} variant={view === value ? 'default' : 'ghost'} className={view === value ? 'rounded-lg bg-indigo-600 text-white shadow-sm hover:bg-indigo-700' : 'rounded-lg text-slate-600 hover:bg-indigo-50 hover:text-indigo-700'} aria-pressed={view === value} onClick={() => {
          const params = new URLSearchParams(searchParams.toString()); params.set('view', value);
          router.push(`/dashboard/payroll/koperasi?${params}`, { scroll: false });
        }}>{value === 'koperasi' ? 'Koperasi' : 'Simpan Pinjam'}</Button>)}
      </div>
      <Button variant="outline" className="h-9 rounded-xl border-slate-200 bg-white px-4 text-xs font-semibold text-slate-700 shadow-sm hover:border-indigo-200 hover:bg-indigo-50 hover:text-indigo-700" disabled={loading} onClick={() => void reload()}><RefreshCw className={loading ? 'size-4 animate-spin text-indigo-600' : 'size-4 text-indigo-600'} />Muat ulang</Button>
    </div>
    {error && <p role="alert" className="rounded-xl bg-rose-50 p-3 text-sm text-rose-700">{error.message} Gunakan Muat ulang sebelum mengubah data.</p>}
  </div>;

  if (data && view === 'simpan-pinjam') return <SimpanPinjamAuditView loans={data.loans} kopUsers={data.members.map(member => ({ ...member, uid: member.uid || undefined, nama: member.nama || '', nik: member.nik || '', email: member.email || '' }))} employees={data.employees.filter(employee => employee.name)} navigation={navigation} />;
  return <div className="min-h-screen bg-[radial-gradient(ellipse_at_top,_var(--tw-gradient-stops))] from-indigo-50/80 via-slate-50 to-slate-100 p-4 text-slate-800 md:p-8">
    <div className="relative mx-auto max-w-7xl"><GlobalHeader />{navigation}
      {data ? <KoperasiMembersView members={data.members} employees={data.employees} reload={reload} disabled={loading || Boolean(error)} /> : loading ? <Loading /> : null}
    </div>
  </div>;
}

export default function KoperasiPage() {
  return <Suspense fallback={<Loading />}><KoperasiPageContent /></Suspense>;
}
