"use client";

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { authenticatedJson } from '@/lib/payroll/client';
import { employeeLinkedToMember, koperasiEmployeeActive, koperasiMemberApproved, sakuBankDetails, type KoperasiEmployee, type KoperasiMember } from '@/lib/koperasiMembers';
import { useKoperasiMutation } from './useKoperasiMutation';

interface Preview {
  firstPayrollPeriod: string;
  authExists: boolean;
  matches: Array<{ id: string; nama: string; email: string; role: string; membershipStatus: string }>;
}
const rupiah = (amount: number) => `Rp${amount.toLocaleString('id-ID')}`;
export default function KoperasiEnrollmentDialog({ employees, members, onClose, onSaved }: {
  employees: KoperasiEmployee[]; members: KoperasiMember[];
  onClose: () => void; onSaved: (message: string) => Promise<void>;
}) {
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState<KoperasiEmployee | null>(null);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [paymentStatus, setPaymentStatus] = useState('Payroll Deduction');
  const [existingMemberId, setExistingMemberId] = useState('');
  const [reload, setReload] = useState(0);
  const { saving, error, submit } = useKoperasiMutation();
  const candidates = employees.filter(employee => koperasiEmployeeActive(employee, employee.collection) &&
    !members.some(member => employeeLinkedToMember(member, employee) && koperasiMemberApproved(member)) &&
    [employee.name, employee.email, employee.employment_profile?.department_unit, employee.employment?.jobCategory].join(' ').toLowerCase().includes(search.trim().toLowerCase()));
  const context = useQuery({
    queryKey: ['koperasi-enrollment-preview', selected?.collection, selected?.id, email, reload],
    enabled: !saving && (!selected || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)),
    retry: false,
    queryFn: async () => {
      const params = new URLSearchParams();
      if (selected) { params.set('employeeId', selected.id); params.set('employeeCollection', selected.collection); params.set('email', email); }
      return authenticatedJson<Preview>(`/api/admin/koperasi-members?${params}`);
    },
  });
  const preview = context.data;
  const checking = context.isFetching;
  const loadError = context.error?.message || '';
  const existing = members.find(member => member.id === existingMemberId);
  const initial = existing?.payrollSavings?.initialPaid || (!existing?.payrollSavings && existing && koperasiMemberApproved(existing)) ? 0 : existing?.iuranPokok || 250000;
  const monthly = existing?.iuranWajib || 25000;
  const bank = selected ? sakuBankDetails(selected, selected.collection) : null;
  const needsPassword = !preview?.authExists;
  const ready = selected && preview && !checking && !loadError && preview.matches.length <= 1 &&
    (!preview.matches.length || preview.matches[0].id === existingMemberId) &&
    (!needsPassword || password.length >= 6);
  return <Dialog open onOpenChange={open => { if (!open && !saving) onClose(); }}>
    <DialogContent showCloseButton={!saving} className="max-h-[90dvh] overflow-y-auto sm:max-w-xl">
      <DialogHeader><DialogTitle>Daftarkan Pegawai</DialogTitle><DialogDescription>Keanggotaan langsung aktif setelah pendaftaran tersimpan.</DialogDescription></DialogHeader>
      <form className="space-y-4" onSubmit={event => {
        event.preventDefault(); if (!ready || saving) return;
        void submit<{ firstPayrollPeriod: string }>('/api/admin/koperasi-members', 'POST', {
          employeeId: selected.id, employeeCollection: selected.collection, email, paymentStatus,
          ...(needsPassword ? { initialPassword: password } : {}), ...(existingMemberId ? { existingMemberId } : {}),
        }, async result => { setPassword(''); await onSaved(`Pegawai terdaftar. Iuran dimulai pada payroll ${result.firstPayrollPeriod}. Jalankan Refresh untuk memperbarui draf.`); });
      }}>
        <div className="space-y-2"><Label htmlFor="enrollment-search">Pegawai</Label><Input id="enrollment-search" placeholder="Cari nama atau unit..." value={search} disabled={saving} onChange={event => setSearch(event.target.value)} />
          <div className="max-h-48 overflow-y-auto rounded-md border" aria-label="Pegawai yang dapat didaftarkan">
            {candidates.map(employee => <button key={`${employee.collection}/${employee.id}`} type="button" disabled={saving} aria-pressed={selected?.id === employee.id && selected.collection === employee.collection} className={`block w-full border-b p-3 text-left text-sm last:border-b-0 hover:bg-slate-50 ${selected?.id === employee.id && selected.collection === employee.collection ? 'bg-indigo-50 ring-1 ring-inset ring-indigo-400' : ''}`} onClick={() => { setSelected(employee); setEmail(employee.email || ''); setPassword(''); setExistingMemberId(''); }}>
              <span className="block font-medium">{employee.name}</span><span className="text-xs text-slate-500">{employee.collection === 'Employees_Loyalis' ? 'Loyalis' : 'Pekarya'} · {employee.employment_profile?.department_unit || employee.employment?.jobCategory || '—'}</span>
            </button>)}
            {!candidates.length && <p className="p-4 text-sm text-slate-500">Tidak ada pegawai yang sesuai.</p>}
          </div>
        </div>
        {selected && <>
          <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm"><dt className="text-slate-500">NIK</dt><dd>{selected.nik || '—'}</dd><dt className="text-slate-500">Kontak</dt><dd>{selected.phoneNumber || selected.personal_info?.phone || '—'}</dd><dt className="text-slate-500">Rekening</dt><dd className="break-all">{bank?.bank || '—'} · {bank?.nomorRekening || '—'}</dd></dl>
          <div className="space-y-2"><Label htmlFor="enrollment-email">Email Koperasi</Label><Input id="enrollment-email" type="email" autoComplete="off" required value={email} disabled={saving} onChange={event => { setEmail(event.target.value); setExistingMemberId(''); }} /></div>
          {checking && <p role="status" className="text-sm text-slate-500">Memeriksa akun...</p>}
          {preview && preview.matches.length > 1 && <p role="alert" className="rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">Identitas cocok dengan beberapa akun Koperasi. Perbaiki data ganda sebelum mendaftarkan pegawai.</p>}
          {preview?.matches.map(member => <label key={member.id} className="flex gap-3 rounded-md border bg-slate-50 p-3 text-sm"><input type="radio" name="existingMember" checked={existingMemberId === member.id} disabled={saving} onChange={() => { setExistingMemberId(member.id); if (member.email && member.email !== email) setEmail(member.email); }} /><span>Gunakan akun <strong className="font-medium">{member.nama}</strong><span className="block text-slate-500">{member.email} · {member.membershipStatus || 'Belum terdaftar'}</span></span></label>)}
          {preview && !checking && needsPassword && <div className="space-y-2"><Label htmlFor="enrollment-password">Password Awal</Label><Input id="enrollment-password" type="password" autoComplete="new-password" minLength={6} maxLength={128} required value={password} disabled={saving} onChange={event => setPassword(event.target.value)} /><p className="text-xs text-slate-500">Minimal 6 karakter. Sampaikan password kepada pegawai.</p></div>}
          {preview?.authExists && <p className="text-sm text-slate-500">Akun login sudah ada; password tetap berlaku.</p>}
          <div className="space-y-2"><Label htmlFor="enrollment-payment">Status Pembayaran</Label><select id="enrollment-payment" className="h-10 w-full rounded-md border bg-white px-3 text-sm" value={paymentStatus} disabled={saving} onChange={event => setPaymentStatus(event.target.value)}><option value="Payroll Deduction">Potong Gaji</option><option value="Yayasan Subsidy">Subsidi Yayasan</option></select></div>
          {preview && <div className="rounded-md border bg-slate-50 p-3 text-sm"><p className="font-medium">Payroll Pertama: {preview.firstPayrollPeriod}</p>{paymentStatus === 'Payroll Deduction' ? <><p className="mt-1">Iuran pokok {rupiah(initial)} + iuran wajib {rupiah(monthly)} = {rupiah(initial + monthly)}.</p><p className="mt-1 text-slate-600">Bulan berikutnya {rupiah(monthly)}. Tabungan bertambah saat Verifikasi &amp; Kunci.</p></> : <p className="mt-1">Tanpa potongan gaji dan penambahan tabungan otomatis.</p>}</div>}
        </>}
        {(loadError || error) && <p role="alert" className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700">{loadError || error}</p>}
        {(loadError || error) && <Button type="button" variant="outline" disabled={saving} onClick={() => setReload(value => value + 1)}>Periksa ulang</Button>}
        <div className="flex justify-end gap-2 border-t pt-4"><Button type="button" variant="outline" disabled={saving} onClick={onClose}>Batal</Button><Button type="submit" disabled={!ready || saving}>{saving && <Loader2 className="size-4 animate-spin" />}{saving ? 'Mendaftarkan...' : 'Daftarkan pegawai'}</Button></div>
      </form>
    </DialogContent>
  </Dialog>;
}
