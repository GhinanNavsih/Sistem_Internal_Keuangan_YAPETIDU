"use client";

import { useMemo, useState } from 'react';
import { AlertTriangle, ArrowUpRight, BadgeCheck, Building2, CircleDollarSign, Landmark, Link2Off, Search, UsersRound } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Card } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import {
  bankDetailsDiffer, employeeLinkedToMember, hasSakuBank, KOPERASI_PAYMENT_LABELS,
  koperasiMemberApproved, sakuBankDetails, type KoperasiEmployee, type KoperasiMember,
} from '@/lib/koperasiMembers';
import KoperasiMemberEditDialog from './KoperasiMemberEditDialog';
import KoperasiLinkDialog from './KoperasiLinkDialog';
import KoperasiBankSyncDialog from './KoperasiBankSyncDialog';

const FILTERS = ['Semua', 'Potong Gaji', 'Subsidi Yayasan', 'Lainnya', 'Belum tertaut', 'Rekening berbeda'] as const;
type Filter = (typeof FILTERS)[number];
const rupiah = (value?: number | null) => value == null ? '—' : `Rp${Number(value).toLocaleString('id-ID')}`;
const PAYMENT_TONES: Record<string, string> = {
  'Payroll Deduction': 'border-indigo-100 bg-indigo-50 text-indigo-700',
  'Yayasan Subsidy': 'border-emerald-100 bg-emerald-50 text-emerald-700',
  Transfer: 'border-sky-100 bg-sky-50 text-sky-700',
  'Pending Verification': 'border-amber-100 bg-amber-50 text-amber-700',
};
const MEMBERSHIP_TONES: Record<string, string> = {
  approved: 'border-emerald-100 bg-emerald-50 text-emerald-700',
  Pending: 'border-amber-100 bg-amber-50 text-amber-700',
  pending: 'border-amber-100 bg-amber-50 text-amber-700',
  inactive: 'border-slate-200 bg-slate-100 text-slate-600',
  rejected: 'border-rose-100 bg-rose-50 text-rose-700',
  removed: 'border-slate-200 bg-slate-100 text-slate-500',
};
const memberName = (member: KoperasiMember) => member.nama || member.name || member.fullName || member.displayName || 'Nama belum tersedia';
const memberNumber = (member: KoperasiMember) => member.nomorAnggota || member.memberNumber;

export default function KoperasiMembersView({ members, employees, reload, disabled }: {
  members: KoperasiMember[]; employees: KoperasiEmployee[]; reload: () => Promise<void>; disabled: boolean;
}) {
  const [filter, setFilter] = useState<Filter>('Semua');
  const [search, setSearch] = useState('');
  const [editing, setEditing] = useState<KoperasiMember | null>(null);
  const [linking, setLinking] = useState<KoperasiMember | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [message, setMessage] = useState('');
  const rows = useMemo(() => members.map(member => {
    const employee = employees.find(employee => employeeLinkedToMember(member, employee));
    const bank = employee ? sakuBankDetails(employee, employee.collection) : null;
    return { member, employee, bank, different: Boolean(bank && bankDetailsDiffer(member.bankDetails, bank)) };
  }).sort((a, b) => memberName(a.member).localeCompare(memberName(b.member), 'id')), [members, employees]);
  const unlinked = (row: (typeof rows)[number]) => row.member.role === 'Member' && !row.employee;
  const bankRows = rows.flatMap(row => row.different && row.employee ? [{ member: row.member, employee: row.employee }] : []);
  const syncCount = bankRows.filter(row => hasSakuBank(sakuBankDetails(row.employee, row.employee.collection))).length;
  const stats = [
    { label: 'Anggota aktif', count: rows.filter(row => row.member.role === 'Member' && koperasiMemberApproved(row.member)).length, icon: BadgeCheck, iconStyle: 'bg-indigo-50 text-indigo-600', detail: 'Status keanggotaan disetujui' },
    { label: 'Potong Gaji', count: rows.filter(row => row.member.paymentStatus === 'Payroll Deduction').length, icon: CircleDollarSign, iconStyle: 'bg-blue-50 text-blue-600', detail: 'Iuran melalui payroll' },
    { label: 'Subsidi Yayasan', count: rows.filter(row => row.member.paymentStatus === 'Yayasan Subsidy').length, icon: Landmark, iconStyle: 'bg-emerald-50 text-emerald-600', detail: 'Iuran ditanggung yayasan' },
    { label: 'Belum tertaut', count: rows.filter(unlinked).length, icon: Link2Off, iconStyle: 'bg-amber-50 text-amber-600', detail: 'Role Member tanpa pegawai SAKU' },
    { label: 'Rekening berbeda', count: bankRows.length, icon: AlertTriangle, iconStyle: 'bg-rose-50 text-rose-600', detail: 'Berbeda dari rekening SAKU' },
  ];
  const filtered = rows.filter(row => {
    const { member, employee } = row;
    if (filter === 'Potong Gaji' && member.paymentStatus !== 'Payroll Deduction') return false;
    if (filter === 'Subsidi Yayasan' && member.paymentStatus !== 'Yayasan Subsidy') return false;
    if (filter === 'Lainnya' && ['Payroll Deduction', 'Yayasan Subsidy'].includes(member.paymentStatus || '')) return false;
    if (filter === 'Belum tertaut' && !unlinked(row)) return false;
    if (filter === 'Rekening berbeda' && !row.different) return false;
    return [member.nama, member.name, member.fullName, member.displayName, member.nomorAnggota, member.memberNumber,
      member.kantor, member.office, member.satuanKerja, member.unit, employee?.name, employee?.id,
      employee?.employment_profile?.department_unit, employee?.employment?.jobCategory].join(' ').toLowerCase().includes(search.toLowerCase().trim());
  });
  async function saved(text = 'Perubahan anggota tersimpan. Jalankan Refresh di Payroll untuk memperbarui draf.') {
    setEditing(null); setLinking(null); setSyncing(false); setMessage(text);
    await reload();
  }
  async function staleReload() { setEditing(null); setLinking(null); setSyncing(false); await reload(); }
  return <div className="space-y-7 pb-10">
    <div className="flex flex-col gap-4 rounded-[24px] border border-white/10 bg-gradient-to-r from-slate-900 via-indigo-950 to-slate-900 p-5 text-white shadow-lg shadow-indigo-950/10 sm:flex-row sm:items-center sm:justify-between sm:p-7">
      <div className="flex items-start gap-4"><div className="flex size-12 shrink-0 items-center justify-center rounded-2xl border border-indigo-300/20 bg-white/10 text-indigo-200"><UsersRound className="size-6" /></div><div><div className="mb-1 flex items-center gap-2"><span className="text-[10px] font-bold uppercase tracking-[0.18em] text-indigo-300">Koperasi UNIPDU</span><span className="rounded-full border border-indigo-300/25 bg-white/10 px-2 py-0.5 text-[10px] font-semibold text-indigo-100">SUPER ADMIN</span></div><h1 className="text-xl font-bold tracking-tight sm:text-2xl">Anggota Koperasi</h1><p className="mt-1 text-sm text-slate-300">Kelola status pembayaran, keanggotaan, iuran, dan tautan pegawai SAKU.</p></div></div>
      <Button variant="outline" className="h-10 shrink-0 rounded-xl border-white/20 bg-white/10 px-4 text-sm font-semibold text-white shadow-none hover:border-white/30 hover:bg-white/15 hover:text-white" disabled={disabled || bankRows.length === 0} onClick={() => setSyncing(true)}><Landmark className="size-4 text-indigo-200" />Samakan rekening <span className="rounded-md bg-white/15 px-1.5 py-0.5 tabular-nums">{syncCount}</span></Button>
    </div>
    {message && <p role="status" className="flex items-start gap-2 rounded-2xl border border-indigo-100 bg-indigo-50 p-4 text-sm leading-relaxed text-indigo-800"><BadgeCheck className="mt-0.5 size-4 shrink-0" />{message}</p>}
    <div className="grid grid-cols-2 gap-3 xl:grid-cols-5">{stats.map(stat => <Card key={stat.label} className="gap-0 rounded-[20px] border-0 bg-white p-4 shadow-[0_8px_30px_rgb(15,23,42,0.04)] ring-1 ring-slate-200/70 sm:p-5"><div className="flex items-start justify-between gap-2"><div><p className="text-xs font-semibold text-slate-500">{stat.label}</p><p className="mt-2 text-2xl font-extrabold tabular-nums tracking-tight text-slate-900">{stat.count}</p></div><div className={`flex size-9 shrink-0 items-center justify-center rounded-xl ${stat.iconStyle}`}><stat.icon className="size-[18px]" /></div></div><p className="mt-3 hidden text-[11px] text-slate-400 sm:block">{stat.detail}</p></Card>)}</div>
    <section className="overflow-hidden rounded-[24px] border border-slate-200/70 bg-white shadow-[0_12px_40px_rgb(15,23,42,0.045)]" aria-label="Daftar anggota Koperasi">
      <div className="border-b border-slate-100 p-4 sm:p-5">
        <div className="flex flex-col gap-4 xl:flex-row xl:items-center xl:justify-between">
          <div><h2 className="flex items-center gap-2 text-base font-bold text-slate-800"><Building2 className="size-4 text-indigo-600" />Direktori anggota</h2><p className="mt-1 text-xs text-slate-500">{filtered.length} dari {rows.length} akun ditampilkan. Belum tertaut menghitung akun dengan role Member.</p></div>
          <div className="relative w-full xl:max-w-sm"><Search className="pointer-events-none absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-slate-400" /><Input aria-label="Cari anggota Koperasi" className="h-10 rounded-xl border-slate-200 bg-slate-50/60 pl-10 text-sm shadow-none transition-colors placeholder:text-slate-400 focus-visible:border-indigo-400 focus-visible:bg-white focus-visible:ring-indigo-500/20" placeholder="Cari nama, No. Anggota, unit, atau pegawai SAKU..." value={search} onChange={event => setSearch(event.target.value)} /></div>
        </div>
        <div className="mt-4 flex gap-2 overflow-x-auto pb-1" aria-label="Filter anggota">{FILTERS.map(value => <Button key={value} size="sm" variant={filter === value ? 'default' : 'outline'} className={`h-8 shrink-0 rounded-lg px-3 text-xs font-semibold transition-colors ${filter === value ? 'border-indigo-600 bg-indigo-600 text-white shadow-sm hover:border-indigo-700 hover:bg-indigo-700' : 'border-slate-200 bg-white text-slate-600 hover:border-indigo-200 hover:bg-indigo-50 hover:text-indigo-700'}`} aria-pressed={filter === value} onClick={() => setFilter(value)}>{value}</Button>)}</div>
      </div>
      <div className="max-w-full overflow-x-auto"><Table className="min-w-[1120px]"><TableHeader className="bg-slate-50/75"><TableRow className="border-slate-100 hover:bg-transparent">
      {['Nama / No. Anggota', 'Kantor / SatKer', 'Status keanggotaan', 'Status Pembayaran', 'Iuran Pokok / Wajib', 'Role', 'Pegawai SAKU', 'Rekening', ''].map((label, index) => <TableHead key={index}>{label}</TableHead>)}
    </TableRow></TableHeader><TableBody>
      {filtered.map(({ member, employee, bank, different }) => {
        const membershipStatus = member.membershipStatus ?? member.status;
        return <TableRow key={member.id} className="border-slate-100 transition-colors hover:bg-indigo-50/30">
        <TableCell className="py-3.5"><p className="font-semibold text-slate-800">{memberName(member)}</p><p className="mt-0.5 text-xs text-slate-400">No. Anggota {memberNumber(member) || '—'}</p></TableCell>
        <TableCell><p className="font-medium text-slate-700">{member.kantor || member.office || '—'}</p><p className="mt-0.5 text-xs text-slate-500">{member.satuanKerja || member.unit || '—'}</p></TableCell>
        <TableCell><Badge variant="outline" className={`rounded-full px-2.5 py-1 text-[11px] font-semibold ${MEMBERSHIP_TONES[membershipStatus || ''] || 'border-slate-200 bg-slate-50 text-slate-600'}`}>{membershipStatus || 'Belum diatur'}</Badge></TableCell>
        <TableCell>{member.paymentStatus ? <Badge variant="outline" className={`rounded-full px-2.5 py-1 text-[11px] font-semibold ${PAYMENT_TONES[member.paymentStatus] || 'border-slate-200 bg-slate-50 text-slate-600'}`}>{KOPERASI_PAYMENT_LABELS[member.paymentStatus] || member.paymentStatus}</Badge> : <span className="text-xs font-medium text-slate-400">Belum diatur</span>}</TableCell>
        <TableCell><div className="space-y-1"><p className="text-xs text-slate-500">Pokok <span className="font-medium tabular-nums text-slate-700">{rupiah(member.iuranPokok)}</span></p><p className="text-xs text-slate-500">Wajib <span className="font-semibold tabular-nums text-slate-800">{rupiah(member.iuranWajib)}</span></p></div></TableCell>
        <TableCell>{member.role && member.role !== 'Member' ? <Badge variant="secondary" className="rounded-full border border-slate-200 bg-slate-100 px-2.5 text-[11px] font-semibold text-slate-700">{member.role}</Badge> : <span className="text-xs text-slate-300">—</span>}</TableCell>
        <TableCell>{employee ? <><p className="font-medium text-slate-800">{employee.name}</p><Badge variant="outline" className={`mt-1 rounded-full px-2 py-0.5 text-[10px] font-semibold ${employee.collection === 'Employees_Loyalis' ? 'border-indigo-100 bg-indigo-50 text-indigo-700' : 'border-amber-100 bg-amber-50 text-amber-800'}`}>{employee.collection === 'Employees_Loyalis' ? 'Loyalis' : 'Pekarya'}</Badge></> : <div className="space-y-1.5"><p className="flex items-center gap-1.5 text-xs text-slate-500"><Link2Off className="size-3.5" />Belum tertaut</p><Button size="sm" variant="outline" className="h-7 rounded-lg border-indigo-200 bg-white px-2.5 text-xs font-semibold text-indigo-700 hover:bg-indigo-50" disabled={disabled} onClick={() => setLinking(member)}>Tautkan <ArrowUpRight className="size-3.5" /></Button></div>}</TableCell>
        <TableCell>{!employee || !bank || (!hasSakuBank(bank) && !different) ? <span className="text-xs text-slate-300">—</span> : <Badge variant="outline" className={`rounded-full px-2.5 py-1 text-[11px] font-semibold ${different ? 'border-amber-100 bg-amber-50 text-amber-700' : 'border-emerald-100 bg-emerald-50 text-emerald-700'}`}><span className={`mr-1.5 size-1.5 rounded-full ${different ? 'bg-amber-500' : 'bg-emerald-500'}`} />{different ? 'Berbeda' : 'Sama'}</Badge>}</TableCell>
        <TableCell><Button size="sm" variant="outline" className="h-8 rounded-lg border-indigo-200 bg-white px-3 text-xs font-semibold text-indigo-700 hover:bg-indigo-50" disabled={disabled} onClick={() => setEditing(member)}>Ubah</Button></TableCell>
      </TableRow>;
      })}
      {!filtered.length && <TableRow><TableCell colSpan={9} className="py-16 text-center"><div className="mx-auto flex max-w-xs flex-col items-center"><div className="mb-3 flex size-11 items-center justify-center rounded-2xl bg-slate-100 text-slate-400"><UsersRound className="size-5" /></div><p className="font-semibold text-slate-700">Tidak ada anggota yang cocok</p><p className="mt-1 text-xs text-slate-500">Ubah pencarian atau pilih filter lain untuk melihat akun.</p></div></TableCell></TableRow>}
    </TableBody></Table></div>
    </section>
    {editing && <KoperasiMemberEditDialog key={editing.id} member={editing} employee={rows.find(row => row.member.id === editing.id)?.employee} onClose={() => setEditing(null)} onSaved={() => saved()} onReload={staleReload} onLink={() => { setLinking(editing); setEditing(null); }} />}
    {linking && <KoperasiLinkDialog key={linking.id} member={linking} employees={employees} current={rows.find(row => row.member.id === linking.id)?.employee} onClose={() => setLinking(null)} onSaved={warning => saved(warning || 'Tautan anggota tersimpan. Rekening mengikuti data SAKU.')} onReload={staleReload} />}
    {syncing && <KoperasiBankSyncDialog rows={bankRows} onClose={() => setSyncing(false)} onSaved={saved} onReload={staleReload} />}
  </div>;
}
