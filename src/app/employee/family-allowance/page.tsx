"use client";

import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import Link from 'next/link';
import { CalendarDays, ChevronLeft, GraduationCap, Loader2, LogOut } from 'lucide-react';
import EmployeeNavigationMenu from '@/components/EmployeeNavigationMenu';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { OptionSelect } from '@/components/ui/option-select';
import FamilyProofUploadCard from '@/components/employee/FamilyProofUploadCard';
import { useAuth } from '@/lib/AuthContext';
import { useConfirmLogout } from '@/components/LogoutConfirmProvider';
import { auth } from '@/lib/firebase';
import { graduationDate, nextDependentLevel, todayInJakarta, type DependentLevel } from '@/lib/payroll/familyAllowance';
import { createFinancialRequestId, authenticatedJson } from '@/lib/payroll/client';
import { FAMILY_PROOF_MAX_BYTES, type FamilyAllowanceRequest, type FamilyRequestChildOption } from '@/lib/payroll/familyAllowanceRequests';
import { gantiLiburAttachmentContentType } from '@/lib/payroll/gantiLiburAttachments';

const LEVELS: { value: DependentLevel; label: string }[] = [
  { value: 'SD', label: 'SD' },
  { value: 'SLTP', label: 'SLTP' },
  { value: 'SLTA', label: 'SLTA' },
  { value: 'S1', label: 'Kuliah S1' },
  { value: 'S2', label: 'Kuliah S2' },
];

interface FamilyRequestData {
  employeeId: string;
  employeeName: string;
  children: FamilyRequestChildOption[];
  requests: FamilyAllowanceRequest[];
}

function formatDate(value: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
  const [year, month, day] = value.split('-');
  return `${day}-${month}-${year}`;
}

async function submitWithProof(form: FormData) {
  const user = auth.currentUser;
  if (!user) throw new Error('Sesi tidak tersedia. Silakan masuk kembali.');
  let token = await user.getIdToken();
  let response = await fetch('/api/employee/family-allowance', {
    method: 'POST', headers: { Authorization: `Bearer ${token}` }, body: form,
  });
  if (response.status === 401) {
    token = await user.getIdToken(true);
    response = await fetch('/api/employee/family-allowance', {
      method: 'POST', headers: { Authorization: `Bearer ${token}` }, body: form,
    });
  }
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error || 'Pengajuan gagal dikirim.');
  return payload as { requestId: string; status: string };
}

export default function FamilyAllowanceRequestPage() {
  const { profile: rawProfile, activeProfile, loading: authLoading} = useAuth();
  const requestLogout = useConfirmLogout();
  const profile = activeProfile || rawProfile;
  const role = profile?.role;
  const linkedEmployeeId = profile?.linkedEmployeeId;
  const [data, setData] = useState<FamilyRequestData | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [withdrawingId, setWithdrawingId] = useState('');
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [targetChildId, setTargetChildId] = useState('new');
  const [level, setLevel] = useState<DependentLevel>('SD');
  const [enrolledAt, setEnrolledAt] = useState('');
  const [proof, setProof] = useState<File | null>(null);
  const submissionIdRef = useRef<string | null>(null);
  const today = todayInJakarta();

  const load = useCallback(async () => {
    if (role !== 'loyalis' || !linkedEmployeeId) {
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const result = await authenticatedJson<FamilyRequestData>('/api/employee/family-allowance');
      setData(result);
      setError('');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Data pengajuan gagal dimuat.');
    } finally {
      setLoading(false);
    }
  }, [role, linkedEmployeeId]);

  useEffect(() => {
    const timer = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  const selectedChild = data?.children.find(child => child.id === targetChildId);
  const nextLevel = selectedChild?.graduatedAt ? nextDependentLevel(selectedChild.level as DependentLevel) : null;
  const selectableLevels = targetChildId === 'new' || !selectedChild
    ? LEVELS
    : !selectedChild.enrolledAt
      ? LEVELS.filter(option => option.value === selectedChild.level ||
          option.value === nextDependentLevel(selectedChild.level as DependentLevel) ||
          (selectedChild.level === 'PT' && (option.value === 'S1' || option.value === 'S2')))
      : LEVELS.filter(option => option.value === nextLevel);
  const projectedGraduation = enrolledAt ? (() => {
    try { return graduationDate(enrolledAt, level); } catch { return ''; }
  })() : '';
  // Typing a date bypasses the field's min/max, so say what is wrong right away.
  const enrolledMessage = enrolledAt && enrolledAt > today
    ? 'Tanggal pertama masuk tidak boleh setelah hari ini.'
    : enrolledAt && selectedChild?.graduatedAt && enrolledAt < selectedChild.graduatedAt
      ? `Tanggal harus setelah jenjang sebelumnya selesai (${formatDate(selectedChild.graduatedAt)}).`
      : '';
  const pendingChildIds = new Set(data?.requests.filter(item => item.status === 'pending').map(item => item.requestedChildId) || []);

  const chooseChild = (id: string) => {
    setTargetChildId(id);
    submissionIdRef.current = null;
    const child = data?.children.find(item => item.id === id);
    const suggested = child?.graduatedAt ? nextDependentLevel(child.level as DependentLevel) :
      child?.level === 'PT' ? 'S1' : child?.level as DependentLevel | undefined;
    setLevel(suggested || 'SD');
    setEnrolledAt('');
    setError('');
  };

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (busy) return;
    setError('');
    setSuccess('');
    if (!data || !proof) {
      setError('Bukti pertama masuk sekolah wajib diunggah.');
      return;
    }
    if (proof.size < 1 || proof.size > FAMILY_PROOF_MAX_BYTES ||
      !gantiLiburAttachmentContentType(proof.name, proof.type)) {
      setError('Pilih foto atau PDF maksimal 5 MB.');
      return;
    }
    if (!enrolledAt || enrolledAt > today || !projectedGraduation || projectedGraduation <= today ||
      (selectedChild?.graduatedAt && enrolledAt < selectedChild.graduatedAt)) {
      setError('Isi tanggal pertama masuk yang valid untuk jenjang yang masih aktif.');
      return;
    }
    const form = new FormData();
    submissionIdRef.current ||= createFinancialRequestId('family-enrollment');
    form.set('requestId', submissionIdRef.current);
    form.set('targetChildId', targetChildId);
    form.set('level', level);
    form.set('enrolledAt', enrolledAt);
    form.set('file', proof);
    setBusy(true);
    try {
      await submitWithProof(form);
      submissionIdRef.current = null;
      setTargetChildId('new');
      setLevel('SD');
      setEnrolledAt('');
      setProof(null);
      setSuccess('Pengajuan terkirim dan menunggu pemeriksaan admin. T. Keluarga belum berubah.');
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Pengajuan gagal dikirim.');
    } finally {
      setBusy(false);
    }
  };

  const withdraw = async (requestId: string) => {
    if (withdrawingId) return;
    setWithdrawingId(requestId);
    setError('');
    try {
      await authenticatedJson(`/api/employee/family-allowance?requestId=${encodeURIComponent(requestId)}`, { method: 'DELETE' });
      setSuccess('Pengajuan ditarik.');
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Pengajuan gagal ditarik.');
    } finally {
      setWithdrawingId('');
    }
  };

  if (authLoading) return <div className="min-h-screen bg-slate-50" />;
  if (profile?.role !== 'loyalis' || !profile.linkedEmployeeId) {
    return <div className="flex min-h-screen items-center justify-center bg-slate-50 p-6">
      <Card className="w-full max-w-md"><CardContent className="space-y-4 p-8 text-center">
        <h1 className="text-xl font-bold">Pengajuan T. Keluarga Tidak Tersedia</h1>
        <p className="text-sm text-slate-500">Halaman ini hanya tersedia untuk akun Loyalis yang terhubung ke data pegawai.</p>
        <Button variant="outline" render={<Link href="/employee/payslip" />}>Kembali ke Slip Gaji</Button>
      </CardContent></Card>
    </div>;
  }

  return <div className="min-h-screen bg-gradient-to-br from-slate-50 via-indigo-50/70 to-slate-100 text-slate-900">
    <header className="sticky top-0 z-40 border-b border-slate-200 bg-white/95 shadow-sm backdrop-blur">
      <div className="mx-auto flex max-w-3xl items-center gap-3 px-4 py-3 sm:px-6">
        <Link href="/employee/payslip" aria-label="Kembali ke Slip Gaji" className="rounded-lg p-2 text-slate-500 hover:bg-slate-100"><ChevronLeft className="size-5" /></Link>
        <div className="flex size-9 items-center justify-center rounded-xl bg-indigo-600 text-white"><GraduationCap className="size-5" /></div>
        <div className="min-w-0 flex-1"><h1 className="truncate text-sm font-bold">Pengajuan T. Keluarga</h1><p className="truncate text-xs text-slate-500">{profile.displayName || profile.email}</p></div>
        <EmployeeNavigationMenu />
        <Button type="button" variant="ghost" size="icon" onClick={requestLogout} aria-label="Keluar"><LogOut className="size-4" /></Button>
      </div>
    </header>
    <main className="mx-auto max-w-3xl space-y-6 px-4 py-6 sm:px-6 sm:py-8">
      <div><h2 className="text-2xl font-bold">Anak yang Sedang Sekolah</h2>
        <p className="mt-1 text-sm text-slate-600">Ajukan satu anak per formulir. Biro SDM akan memeriksa bukti sebelum anak tersebut masuk perhitungan T. Keluarga.</p></div>
      {error && <p role="alert" className="rounded-xl border border-rose-200 bg-rose-50 p-3 text-sm text-rose-800">{error}</p>}
      {success && <p role="status" className="rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-800">{success}</p>}
      <Card className="rounded-2xl border-slate-200 bg-white shadow-sm"><CardContent className="p-5 sm:p-6">
        {loading ? <div className="flex items-center gap-2 text-sm text-slate-500"><Loader2 className="size-4 animate-spin" /> Memuat data anak...</div> :
        <form onSubmit={submit} className="space-y-5">
          <div className="space-y-2"><label htmlFor="family-child" className="text-sm font-semibold">Anak yang diajukan</label>
            <OptionSelect id="family-child" value={targetChildId} onValueChange={chooseChild}
              options={[
                { value: 'new', label: 'Anak baru (Tambahkan Tanggungan Baru' },
                ...(data?.children.map(child => ({
                  value: child.id,
                  label: `Anak ${child.number} · ${child.level}${child.eligibleToday && child.enrolledAt ? ' (sudah aktif)' : ''}${pendingChildIds.has(child.id) ? ' (menunggu admin)' : ''}`,
                  disabled: !child.requestable || pendingChildIds.has(child.id),
                })) || []),
              ]} />
            <p className="text-xs text-slate-500">Pilih Anak 1, Anak 2, dan seterusnya bila sudah tercatat. Pilih Anak baru hanya untuk anak yang belum ada.</p>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2"><label htmlFor="family-level" className="text-sm font-semibold">Jenjang Sekolah</label>
              <OptionSelect id="family-level" value={level}
                onValueChange={value => { setLevel(value as DependentLevel); submissionIdRef.current = null; }}
                options={selectableLevels} /></div>
            <div className="space-y-2"><label htmlFor="family-enrolled" className="text-sm font-semibold">Tanggal Pertama Masuk</label>
              <Input id="family-enrolled" type="date" required max={today} min={selectedChild?.graduatedAt || undefined}
                value={enrolledAt} aria-invalid={enrolledMessage ? true : undefined}
                aria-describedby={enrolledMessage ? 'family-enrolled-message' : undefined}
                onChange={event => { setEnrolledAt(event.target.value); submissionIdRef.current = null; }}
                className="h-11 rounded-xl border-slate-200" />
              {enrolledMessage && <p id="family-enrolled-message" role="alert" className="text-xs text-rose-700">{enrolledMessage}</p>}
            </div>
          </div>
          {projectedGraduation && <p className="flex items-center gap-2 text-xs text-slate-600"><CalendarDays className="size-4" /> Perkiraan akhir jenjang: {formatDate(projectedGraduation)}</p>}
          <div className="space-y-3"><span className="block text-sm font-semibold">Bukti pertama masuk sekolah</span>
            <FamilyProofUploadCard file={proof} onFileChange={file => { submissionIdRef.current = null; setProof(file); }} /></div>
          <Button type="submit" disabled={busy || !data} className="h-11 w-full rounded-xl bg-indigo-600 text-white hover:bg-indigo-700">
            {busy ? <><Loader2 className="mr-2 size-4 animate-spin" /> Mengirim...</> : 'Kirim Pengajuan'}
          </Button>
        </form>}
      </CardContent></Card>
      <section className="space-y-3"><h3 className="text-lg font-bold">Riwayat Pengajuan</h3>
        {!loading && (data?.requests.length || 0) === 0 && <p className="rounded-xl border border-slate-200 bg-white p-5 text-sm text-slate-500">Belum ada pengajuan.</p>}
        {data?.requests.map(item => <Card key={item.id} className="rounded-xl border-slate-200 bg-white"><CardContent className="space-y-2 p-4">
          <div className="flex flex-wrap items-start justify-between gap-2"><p className="font-semibold">{LEVELS.find(option => option.value === item.level)?.label || item.level} · masuk {formatDate(item.enrolledAt)}</p>
            <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${item.status === 'approved' ? 'bg-emerald-100 text-emerald-800' : item.status === 'rejected' ? 'bg-rose-100 text-rose-800' : item.status === 'withdrawn' ? 'bg-slate-100 text-slate-600' : 'bg-amber-100 text-amber-800'}`}>
              {item.status === 'approved' ? 'Disetujui' : item.status === 'rejected' ? 'Ditolak' : item.status === 'withdrawn' ? 'Ditarik' : 'Menunggu admin'}
            </span></div>
          <p className="text-xs text-slate-500">{item.requestedChildId === 'new' ? 'Anak baru' : `Anak ${data?.children.find(child => child.id === item.requestedChildId)?.number || 'tercatat'}`} · dikirim {item.submittedAt ? new Date(item.submittedAt).toLocaleDateString('id-ID') : '—'}</p>
          {item.reviewReason && <p className="text-sm text-slate-700">Catatan admin: {item.reviewReason}</p>}
          <div className="flex flex-wrap items-center gap-3"><a href={item.proofUrl} target="_blank" rel="noopener noreferrer" className="text-sm font-medium text-indigo-700 underline">Lihat bukti</a>
            {item.status === 'pending' && <Button type="button" variant="outline" size="sm" disabled={!!withdrawingId} onClick={() => void withdraw(item.id)}>
              {withdrawingId === item.id ? 'Menarik...' : 'Tarik pengajuan'}
            </Button>}</div>
        </CardContent></Card>)}
      </section>
    </main>
  </div>;
}
