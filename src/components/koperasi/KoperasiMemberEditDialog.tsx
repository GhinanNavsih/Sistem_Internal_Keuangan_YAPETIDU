"use client";

import { useState } from 'react';
import { AlertTriangle, Banknote, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { CurrencyInput } from '@/components/ui/currency-input';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import {
  KOPERASI_MEMBERSHIP_STATUSES, KOPERASI_PAYMENT_LABELS, KOPERASI_PAYMENT_STATUSES,
  KOPERASI_ROLES, KOPERASI_STAFF_ROLES, koperasiMemberSnapshot, koperasiMonthlyIuranWajib,
  sakuBankDetails, validateKoperasiMemberEdit,
  type KoperasiEmployee, type KoperasiMember, type KoperasiMemberEdit,
} from '@/lib/koperasiMembers';
import { useKoperasiMutation } from './useKoperasiMutation';

const rupiah = (value: number) => `Rp${value.toLocaleString('id-ID')}`;

function Choice({ id, label, value, options, onChange }: { id: string; label: string; value: string; options: readonly string[]; onChange: (value: string) => void }) {
  return <div className="space-y-2"><Label htmlFor={id} className="text-xs font-semibold text-slate-700">{label}</Label>
    <Select value={value || null} onValueChange={value => onChange(value || '')}>
      <SelectTrigger id={id} className="h-10 w-full rounded-xl border-slate-200 bg-slate-50/60 shadow-none focus-visible:border-indigo-400 focus-visible:ring-indigo-500/20"><SelectValue placeholder="Pilih...">{KOPERASI_PAYMENT_LABELS[value] || value || 'Pilih...'}</SelectValue></SelectTrigger>
      <SelectContent>{options.map(option => <SelectItem key={option} value={option}>{KOPERASI_PAYMENT_LABELS[option] || option}</SelectItem>)}</SelectContent>
    </Select>
  </div>;
}

export default function KoperasiMemberEditDialog({ member, employee, onClose, onSaved, onLink, onReload }: {
  member: KoperasiMember; employee?: KoperasiEmployee; onClose: () => void;
  onSaved: () => Promise<void>; onLink: () => void; onReload: () => Promise<void>;
}) {
  const [form, setForm] = useState<KoperasiMemberEdit>(() => ({
    paymentStatus: member.paymentStatus || '',
    membershipStatus: (member.membershipStatus ?? member.status) === 'pending' ? 'Pending' : member.membershipStatus ?? member.status ?? 'Pending',
    iuranPokok: member.iuranPokok || 250_000, iuranWajib: member.iuranWajib || 25_000,
    role: member.role || 'Member', confirmStaffRole: false, note: '',
  }));
  const { saving, error, stale, submit } = useKoperasiMutation();
  const [validation, setValidation] = useState('');
  const update = <K extends keyof KoperasiMemberEdit>(key: K, value: KoperasiMemberEdit[K]) => setForm(previous => ({ ...previous, [key]: value }));
  const bank = employee ? sakuBankDetails(employee, employee.collection) : member.bankDetails;
  return <Dialog open onOpenChange={open => { if (!open && !saving) onClose(); }}>
    <DialogContent showCloseButton={!saving} className="max-h-[90vh] overflow-y-auto rounded-[24px] border-slate-200 p-5 shadow-2xl sm:max-w-2xl sm:p-6">
      <DialogHeader className="mb-1"><DialogTitle className="text-xl font-bold tracking-tight text-slate-900">Ubah anggota Koperasi</DialogTitle><DialogDescription className="text-slate-500">{member.nama || member.id} · No. Anggota {member.nomorAnggota || '—'}</DialogDescription></DialogHeader>
      <form className="space-y-5" onSubmit={event => {
        event.preventDefault();
        const errors = validateKoperasiMemberEdit(form, member);
        setValidation(Object.values(errors)[0] || '');
        if (Object.keys(errors).length) return;
        void submit('/api/admin/koperasi-members', 'PATCH', { memberId: member.id, input: form, expected: koperasiMemberSnapshot(member) }, onSaved);
      }}>
        <fieldset disabled={saving || stale} className="space-y-5">
          <div className="grid gap-4 rounded-2xl border border-slate-100 bg-slate-50/60 p-4 sm:grid-cols-2">
            <Choice id="member-payment" label="Status Pembayaran" value={form.paymentStatus} options={KOPERASI_PAYMENT_STATUSES.filter(status => status !== 'Pending Verification' || member.paymentStatus === status)} onChange={value => update('paymentStatus', value)} />
            <Choice id="member-status" label="Status keanggotaan" value={form.membershipStatus} options={KOPERASI_MEMBERSHIP_STATUSES} onChange={value => update('membershipStatus', value)} />
            <div className="space-y-2"><Label htmlFor="member-pokok" className="text-xs font-semibold text-slate-700">Iuran Pokok</Label><CurrencyInput id="member-pokok" className="h-10 rounded-xl border-slate-200 bg-white pl-10 shadow-none focus-visible:border-indigo-400 focus-visible:ring-indigo-500/20" value={form.iuranPokok} onValue={value => update('iuranPokok', value)} /></div>
            <div className="space-y-2"><Label htmlFor="member-wajib" className="text-xs font-semibold text-slate-700">Iuran Wajib</Label><CurrencyInput id="member-wajib" className="h-10 rounded-xl border-slate-200 bg-white pl-10 shadow-none focus-visible:border-indigo-400 focus-visible:ring-indigo-500/20" value={form.iuranWajib} onValue={value => update('iuranWajib', value)} /></div>
          </div>
          <p className="-mt-2 text-xs leading-relaxed text-slate-500">Isi rupiah utuh, minimal Rp1. Untuk menghentikan potongan, ubah Status Pembayaran.</p>
          <Choice id="member-role" label="Role" value={form.role} options={KOPERASI_ROLES} onChange={value => setForm(previous => ({ ...previous, role: value, confirmStaffRole: false }))} />
          {KOPERASI_STAFF_ROLES.includes(form.role) && <div className="space-y-3 rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
            <p className="flex items-center gap-2 font-semibold"><AlertTriangle className="size-4 shrink-0" />Perubahan hak akses staf</p>
            <p>Role {form.role} memberikan akses staf di aplikasi Koperasi pada login berikutnya.</p>
            <label className="flex cursor-pointer items-start gap-2"><input type="checkbox" className="mt-1 accent-indigo-600" checked={form.confirmStaffRole} onChange={event => update('confirmStaffRole', event.target.checked)} /><span>Saya paham role ini memberi hak akses staf Koperasi dan menyetujui perubahan ini.</span></label>
          </div>}
          <div className="flex items-start gap-3 rounded-2xl border border-indigo-100 bg-indigo-50/80 p-4 text-sm text-indigo-900" aria-live="polite">
            <span className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-xl bg-white text-indigo-600 shadow-sm"><Banknote className="size-4" /></span>
            <span><span className="block text-xs font-semibold uppercase tracking-wide text-indigo-700">Dampak ke payroll</span><span className="mt-1 block font-semibold">Potongan Iuran Wajib: <span className="tabular-nums">{rupiah(koperasiMonthlyIuranWajib(member))} → {rupiah(koperasiMonthlyIuranWajib(form))}</span></span><span className="mt-1 block text-xs text-indigo-700/80">Berlaku setelah Refresh draf.</span></span>
          </div>
          <div className="space-y-3 rounded-2xl border border-slate-200 bg-white p-4 text-sm shadow-sm shadow-slate-900/[0.02]">
            <div className="flex flex-wrap items-center justify-between gap-2"><p className="text-slate-600">Pegawai SAKU: <strong className="text-slate-900">{employee?.name || 'Belum tertaut'}</strong></p><Button type="button" variant="outline" size="sm" className="h-8 rounded-lg border-indigo-200 text-xs font-semibold text-indigo-700 hover:bg-indigo-50 hover:text-indigo-800" onClick={onLink}>{employee ? 'Ganti / lepas tautan' : 'Tautkan'}</Button></div>
            <div className="rounded-xl bg-slate-50 px-3 py-2.5"><p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Rekening · ikut data SAKU</p><p className="mt-1 font-medium text-slate-800">{bank?.bank || '—'} <span className="text-slate-400">·</span> <span className="tabular-nums">{bank?.nomorRekening || '—'}</span></p>{!employee && <p className="mt-1 text-xs text-slate-500">Tautkan pegawai untuk mengikuti data rekening SAKU.</p>}</div>
          </div>
          <div className="space-y-2"><Label htmlFor="member-note" className="text-xs font-semibold text-slate-700">Catatan (opsional)</Label><textarea id="member-note" maxLength={500} value={form.note} onChange={event => update('note', event.target.value)} className="min-h-20 w-full rounded-xl border border-slate-200 bg-slate-50/50 p-3 text-sm outline-none transition focus:border-indigo-400 focus:bg-white focus:ring-2 focus:ring-indigo-500/20" placeholder="Tambahkan alasan perubahan bila diperlukan" /></div>
        </fieldset>
        {(validation || error) && <p role="alert" className="rounded-xl border border-rose-100 bg-rose-50 px-3 py-2.5 text-sm text-rose-700">{error || validation}</p>}
        <div className="flex justify-end gap-2 border-t border-slate-100 pt-4">
          <Button type="button" variant="outline" className="h-10 rounded-xl border-slate-200 px-4 text-slate-700 hover:bg-slate-50" disabled={saving} onClick={onClose}>Batal</Button>
          {stale ? <Button type="button" className="h-10 rounded-xl bg-indigo-600 px-4 font-semibold text-white hover:bg-indigo-700" onClick={() => void onReload()}>Muat ulang data</Button> : <Button type="submit" className="h-10 rounded-xl bg-indigo-600 px-4 font-semibold text-white shadow-sm hover:bg-indigo-700" disabled={saving}>{saving && <Loader2 className="size-4 animate-spin" />}{saving ? 'Menyimpan...' : 'Simpan perubahan'}</Button>}
        </div>
      </form>
    </DialogContent>
  </Dialog>;
}
