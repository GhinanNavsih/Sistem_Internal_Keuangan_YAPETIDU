"use client";

import { useMemo, useState } from 'react';
import { Check, Loader2, Search, Unlink } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { hasSakuBank, rankKoperasiLinkCandidates, sakuBankDetails, type KoperasiEmployee, type KoperasiMember } from '@/lib/koperasiMembers';
import { useKoperasiMutation } from './useKoperasiMutation';

export default function KoperasiLinkDialog({ member, employees, current, onClose, onSaved, onReload }: {
  member: KoperasiMember; employees: KoperasiEmployee[]; current?: KoperasiEmployee;
  onClose: () => void; onSaved: (warning?: string) => Promise<void>; onReload: () => Promise<void>;
}) {
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState<KoperasiEmployee | null>(null);
  const [unlink, setUnlink] = useState(false);
  const { saving, error, stale, submit } = useKoperasiMutation();
  const candidates = useMemo(() => rankKoperasiLinkCandidates(member, employees).filter(({ employee }) =>
    [employee.name, employee.id, employee.nik, employee.email, employee.employment_profile?.department_unit, employee.employment?.jobCategory]
      .join(' ').toLowerCase().includes(search.toLowerCase().trim())), [member, employees, search]);
  const bank = selected ? sakuBankDetails(selected, selected.collection) : null;
  return <Dialog open onOpenChange={open => { if (!open && !saving) onClose(); }}>
    <DialogContent showCloseButton={!saving} className="max-h-[90vh] overflow-y-auto rounded-[24px] border-slate-200 p-5 shadow-2xl sm:max-w-2xl sm:p-6">
      <DialogHeader className="mb-1"><DialogTitle className="text-xl font-bold tracking-tight text-slate-900">{current ? 'Ganti / lepas tautan' : 'Tautkan pegawai SAKU'}</DialogTitle><DialogDescription className="text-slate-500">{member.nama || member.id}. Pilih pegawai aktif yang belum tertaut; saran diurutkan menurut NIK, email, lalu nama.</DialogDescription></DialogHeader>
      {current && <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-slate-200 bg-slate-50 p-3.5 text-sm"><span><span className="block text-[11px] font-semibold uppercase tracking-wide text-slate-500">Tautan saat ini</span><strong className="text-slate-900">{current.name}</strong> <span className="text-slate-500">({current.id})</span></span><Button variant={unlink ? 'destructive' : 'outline'} className={unlink ? 'h-9 rounded-xl' : 'h-9 rounded-xl border-rose-200 text-rose-700 hover:bg-rose-50 hover:text-rose-800'} disabled={saving || stale} onClick={() => { setUnlink(!unlink); setSelected(null); }}><Unlink className="size-4" />{unlink ? 'Batal lepas' : 'Lepas tautan'}</Button></div>}
      <div className="relative"><Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-slate-400" /><Input aria-label="Cari pegawai SAKU" className="h-10 rounded-xl border-slate-200 bg-slate-50/60 pl-9 shadow-none placeholder:text-slate-400 focus-visible:border-indigo-400 focus-visible:bg-white focus-visible:ring-indigo-500/20" placeholder="Cari nama, NIK, email, unit, atau ID pegawai..." value={search} disabled={saving || stale} onChange={event => setSearch(event.target.value)} /></div>
      <div className="max-h-72 space-y-2 overflow-y-auto rounded-2xl border border-slate-100 bg-slate-50/50 p-2" aria-label="Pilihan pegawai">
        {candidates.map(({ employee, match }) => <button key={`${employee.collection}/${employee.id}`} type="button" disabled={saving || stale} aria-pressed={selected?.id === employee.id && selected.collection === employee.collection} className={`flex w-full items-center justify-between gap-3 rounded-xl border p-3 text-left text-sm hover:bg-indigo-50 disabled:opacity-50 ${selected?.id === employee.id && selected.collection === employee.collection ? 'border-indigo-500 bg-indigo-50' : 'border-slate-200'}`} onClick={() => { setSelected(employee); setUnlink(false); }}>
          <span><strong className="text-slate-800">{employee.name}</strong><span className="mt-0.5 block text-xs text-slate-500">{employee.collection === 'Employees_Loyalis' ? 'Loyalis' : 'Pekarya'} · {employee.id} · {employee.employment_profile?.department_unit || employee.employment?.jobCategory || '—'}</span></span>
          <span className="flex shrink-0 items-center gap-2">{match && <span className="rounded-full border border-indigo-100 bg-indigo-50 px-2 py-1 text-[10px] font-semibold text-indigo-700">Cocok {match}</span>}{selected?.id === employee.id && selected.collection === employee.collection && <span className="flex size-6 items-center justify-center rounded-full bg-indigo-600 text-white"><Check className="size-3.5" /></span>}</span>
        </button>)}
        {!candidates.length && <p className="p-8 text-center text-sm text-slate-500">Tidak ada pegawai aktif belum tertaut yang sesuai pencarian.</p>}
      </div>
      {selected && bank && <p className="rounded-2xl border border-indigo-100 bg-indigo-50/80 p-3.5 text-sm leading-relaxed text-indigo-900">Tautkan ke <strong>{selected.name}</strong>. {hasSakuBank(bank) ? `Rekening Koperasi akan mengikuti SAKU: ${bank.bank} · ${bank.nomorRekening}.` : 'Rekening SAKU kosong; penyalinan rekening dilewati.'}</p>}
      {unlink && <p className="rounded-2xl border border-amber-200 bg-amber-50 p-3.5 text-sm leading-relaxed text-amber-900">Lepas tautan {member.nama} dari {current?.name}? Data anggota Koperasi tetap tersimpan.</p>}
      {error && <p role="alert" className="rounded-xl border border-rose-100 bg-rose-50 px-3 py-2.5 text-sm text-rose-700">{error}</p>}
      <div className="flex justify-end gap-2 border-t border-slate-100 pt-4"><Button variant="outline" className="h-10 rounded-xl border-slate-200 px-4 text-slate-700 hover:bg-slate-50" disabled={saving} onClick={onClose}>Batal</Button>
        {stale ? <Button className="h-10 rounded-xl bg-indigo-600 px-4 font-semibold text-white hover:bg-indigo-700" onClick={() => void onReload()}>Muat ulang data</Button> : <Button className="h-10 rounded-xl bg-indigo-600 px-4 font-semibold text-white shadow-sm hover:bg-indigo-700" disabled={saving || (!selected && !unlink)} onClick={() => {
          const target = unlink ? current : selected; if (!target) return;
          void submit<{ warning?: string }>('/api/admin/koperasi-members/link', 'POST', {
            memberId: member.id, action: unlink ? 'unlink' : 'link', employeeId: target.id, employeeCollection: target.collection,
            expectedEmployeeId: current?.id || null, expectedEmployeeCollection: current?.collection || null,
          }, result => onSaved(result.warning));
        }}>{saving && <Loader2 className="size-4 animate-spin" />}{saving ? 'Menyimpan...' : unlink ? 'Konfirmasi lepas tautan' : 'Tautkan pegawai'}</Button>}
      </div>
    </DialogContent>
  </Dialog>;
}
