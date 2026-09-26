"use client";

import { ArrowRight, Landmark, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { hasSakuBank, sakuBankDetails, type KoperasiEmployee, type KoperasiMember } from '@/lib/koperasiMembers';
import { useKoperasiMutation } from './useKoperasiMutation';

export interface BankSyncRow { member: KoperasiMember; employee: KoperasiEmployee }
export default function KoperasiBankSyncDialog({ rows, onClose, onSaved, onReload }: {
  rows: BankSyncRow[]; onClose: () => void; onSaved: (message: string) => Promise<void>; onReload: () => Promise<void>;
}) {
  const { saving, error, stale, submit } = useKoperasiMutation();
  const count = rows.filter(row => hasSakuBank(sakuBankDetails(row.employee, row.employee.collection))).length;
  return <Dialog open onOpenChange={open => { if (!open && !saving) onClose(); }}>
    <DialogContent showCloseButton={!saving} className="max-h-[90vh] overflow-y-auto rounded-[24px] border-slate-200 p-5 shadow-2xl sm:max-w-3xl sm:p-6">
      <DialogHeader className="mb-1"><DialogTitle className="flex items-center gap-2 text-xl font-bold tracking-tight text-slate-900"><span className="flex size-9 items-center justify-center rounded-xl bg-indigo-50 text-indigo-600"><Landmark className="size-4" /></span>Samakan rekening ({count})</DialogTitle><DialogDescription className="text-slate-500">Rekening di bawah akan disalin dari SAKU ke Koperasi. Rekening SAKU yang kosong dilewati. Nilai terbaru dibaca kembali saat konfirmasi.</DialogDescription></DialogHeader>
      <div className="max-h-96 space-y-2 overflow-y-auto rounded-2xl border border-slate-200 bg-slate-50/50 p-2">
        {rows.map(({ member, employee }) => { const bank = sakuBankDetails(employee, employee.collection); return <div key={member.id} className="space-y-1 p-3 text-sm">
          <p className="mb-2 font-semibold text-slate-800">{member.nama || member.id} <span className="font-normal text-slate-500">· {employee.name}</span></p>
          <div className="grid gap-2 sm:grid-cols-[1fr_auto_1fr] sm:items-center"><div className="rounded-xl border border-slate-200 bg-white px-3 py-2"><span className="block text-[10px] font-bold uppercase tracking-wide text-slate-400">Koperasi saat ini</span><span className="mt-1 block text-xs text-slate-700">{member.bankDetails?.bank || '—'} · {member.bankDetails?.nomorRekening || '—'}</span></div><ArrowRight className="hidden size-4 text-slate-400 sm:block" /><div className={`rounded-xl border px-3 py-2 ${hasSakuBank(bank) ? 'border-indigo-100 bg-indigo-50/70' : 'border-amber-100 bg-amber-50'}`}><span className={`block text-[10px] font-bold uppercase tracking-wide ${hasSakuBank(bank) ? 'text-indigo-600' : 'text-amber-700'}`}>SAKU{!hasSakuBank(bank) && ' · dilewati'}</span><span className={`mt-1 block text-xs ${hasSakuBank(bank) ? 'text-indigo-900' : 'text-amber-900'}`}>{bank.bank || '—'} · {bank.nomorRekening || '—'}</span></div></div>
        </div>; })}
      </div>
      {error && <p role="alert" className="rounded-xl border border-rose-100 bg-rose-50 px-3 py-2.5 text-sm text-rose-700">{error}</p>}
      <div className="flex justify-end gap-2 border-t border-slate-100 pt-4"><Button variant="outline" className="h-10 rounded-xl border-slate-200 px-4 text-slate-700 hover:bg-slate-50" disabled={saving} onClick={onClose}>Batal</Button>{stale ? <Button className="h-10 rounded-xl bg-indigo-600 px-4 font-semibold text-white hover:bg-indigo-700" onClick={() => void onReload()}>Muat ulang data</Button> : <Button className="h-10 rounded-xl bg-indigo-600 px-4 font-semibold text-white shadow-sm hover:bg-indigo-700" disabled={saving || count === 0} onClick={() => void submit<{ synced: number; skipped: unknown[] }>('/api/admin/koperasi-members/bank-sync', 'POST', { memberIds: rows.map(row => row.member.id) }, result => onSaved(`${result.synced} rekening disamakan.${result.skipped.length ? ` ${result.skipped.length} anggota dilewati.` : ''}`))}>
        {saving && <Loader2 className="size-4 animate-spin" />}{saving ? 'Menyamakan rekening...' : `Konfirmasi samakan ${count} rekening`}
      </Button>}</div>
    </DialogContent>
  </Dialog>;
}
