'use client';

import { useId, useMemo, useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CalendarClock } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { authenticatedJson } from '@/lib/payroll/client';
import {
  buildLoyalisRetirementReview,
  isLoyalisBirthMonth,
  type ConfirmedLoyalisBirthMonth,
  type LoyalisRetirementEmployee,
} from '@/lib/payroll/loyalisRetirement';
import { MONTHS_ID } from '@/utils/rekapConfig';

const endpoint = '/api/admin/loyalis-retirement';
type ConfirmationResponse = { birthMonths: ConfirmedLoyalisBirthMonth[] };
type BirthMonthEditor = { id: string; name: string; birthMonth?: string; estimated?: boolean };

function formatMonth(month: string): string {
  const [year, number] = month.split('-');
  return `${MONTHS_ID[Number(number) - 1]} ${year}`;
}

function ConfirmBirthMonthForm({ employee, today, pending, error, onCancel, onSave }: {
  employee: BirthMonthEditor;
  today: string;
  pending: boolean;
  error: Error | null;
  onCancel: () => void;
  onSave: (data: ConfirmedLoyalisBirthMonth) => void;
}) {
  const id = useId();
  const [year, setYear] = useState(employee.birthMonth?.slice(0, 4) ?? '');
  const [month, setMonth] = useState(employee.birthMonth?.slice(5) ?? '');
  const birthMonth = `${year}-${month}`;

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!pending && isLoyalisBirthMonth(birthMonth, today)) onSave({ employeeId: employee.id, birthMonth });
  }

  return (
    <form onSubmit={submit} className="space-y-4">
      {employee.estimated && <p className="text-sm text-amber-700">Periksa bulan dan tahun lahir dari dokumen pegawai sebelum menyimpan.</p>}
      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1.5">
          <Label id={`${id}-month-label`} htmlFor={`${id}-month`}>Bulan Lahir</Label>
          <Select value={month} onValueChange={value => setMonth(value ?? '')} disabled={pending}>
            <SelectTrigger id={`${id}-month`} aria-labelledby={`${id}-month-label`} className="w-full">
              <SelectValue placeholder="Pilih bulan">{month ? MONTHS_ID[Number(month) - 1] : 'Pilih bulan'}</SelectValue>
            </SelectTrigger>
            <SelectContent>
              {MONTHS_ID.map((name, index) => (
                <SelectItem key={name} value={String(index + 1).padStart(2, '0')}>{name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor={`${id}-year`}>Tahun Lahir</Label>
          <Input id={`${id}-year`} inputMode="numeric" maxLength={4} value={year} disabled={pending}
            onChange={event => setYear(event.target.value.replace(/\D/g, ''))} required />
        </div>
      </div>
      {error && <p role="alert" className="text-sm text-red-700">{error.message}</p>}
      <div className="flex justify-end gap-2">
        <Button variant="outline" type="button" disabled={pending} onClick={onCancel}>Kembali</Button>
        <Button type="submit" disabled={pending || !isLoyalisBirthMonth(birthMonth, today)}>
          {pending ? 'Menyimpan…' : 'Simpan bulan lahir'}
        </Button>
      </div>
    </form>
  );
}

export default function LoyalisRetirementCard({ employees, today, userId, rosterLoading, rosterUnavailable, retryRoster, onEditType }: {
  employees: LoyalisRetirementEmployee[];
  today: string;
  userId: string;
  rosterLoading: boolean;
  rosterUnavailable: boolean;
  retryRoster: () => void;
  onEditType: (id: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [editor, setEditor] = useState<BirthMonthEditor | null>(null);
  const queryClient = useQueryClient();
  const queryKey = ['employees', 'loyalis-retirement-birth-months', userId] as const;
  const confirmations = useQuery({
    queryKey,
    queryFn: ({ signal }) => authenticatedJson<ConfirmationResponse>(endpoint, { signal }),
  });
  const save = useMutation({
    mutationFn: (data: ConfirmedLoyalisBirthMonth) => authenticatedJson<ConfirmedLoyalisBirthMonth>(endpoint, {
      method: 'PUT', body: JSON.stringify(data),
    }),
    onSuccess: async result => {
      await queryClient.cancelQueries({ queryKey });
      queryClient.setQueryData<ConfirmationResponse>(queryKey, current => ({
        birthMonths: [...(current?.birthMonths ?? []).filter(row => row.employeeId !== result.employeeId), result],
      }));
      setEditor(null);
      void queryClient.invalidateQueries({ queryKey });
    },
  });
  const { nextMonth, upcoming, overdue, incomplete } = useMemo(
    () => buildLoyalisRetirementReview(employees, confirmations.data?.birthMonths ?? [], today),
    [employees, confirmations.data, today],
  );
  const unavailable = rosterUnavailable || (confirmations.isError && !confirmations.data);
  const loading = !unavailable && (rosterLoading || confirmations.isPending);
  const ready = !unavailable && !loading;
  const dueThisMonth = nextMonth === today.slice(0, 7);
  const warning = ready && (dueThisMonth || overdue.length > 0);
  const nextLabel = nextMonth ? formatMonth(nextMonth) : 'Belum ada jadwal';
  const sections = [
    { title: 'Pensiun Berikutnya', items: upcoming },
    { title: 'Lewat Bulan Pensiun', items: overdue },
    { title: 'Data Perlu Dilengkapi', items: incomplete },
  ];

  function changeOpen(next: boolean) {
    if (save.isPending) return;
    setOpen(next);
    if (!next) setEditor(null);
  }

  return (
    <Dialog open={open} onOpenChange={changeOpen}>
      <DialogTrigger render={<button type="button" className="flex cursor-pointer items-center gap-4 rounded-md border-2 border-transparent bg-white p-5 text-left shadow-[0_8px_30px_rgb(0,0,0,0.02)] transition-all hover:bg-slate-50 hover:shadow-md focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-600" />}>
        <span className={`flex size-12 shrink-0 items-center justify-center rounded-sm ${warning ? 'bg-amber-50 text-amber-600' : 'bg-slate-100 text-slate-500'}`}>
          <CalendarClock className="size-5" aria-hidden="true" />
        </span>
        <span className="min-w-0 space-y-0.5">
          <span className="block text-xs font-medium uppercase tracking-wider text-slate-500">Pensiun Loyalis</span>
          <span className={`block text-lg leading-tight font-bold ${warning ? 'text-amber-800' : 'text-slate-900'}`}>
            {loading ? 'Memuat…' : unavailable ? 'Data tidak tersedia' : nextLabel}
          </span>
          {ready && dueThisMonth && <span className="block text-xs font-medium text-amber-800">Jatuh tempo bulan ini</span>}
          {ready && upcoming.length > 0 && (
            <span className="block break-words text-sm text-slate-700">
              {upcoming.length === 1 ? upcoming[0].name : `${upcoming.length} Loyalis`}
              {upcoming.some(row => row.estimated) && <span className="block text-xs text-amber-700">Perkiraan dari NIK</span>}
            </span>
          )}
          {ready && overdue.length > 0 && <span className="block text-xs text-amber-800">{overdue.length} lewat bulan pensiun</span>}
          {ready && incomplete.length > 0 && <span className="block text-xs text-slate-500">{incomplete.length} data perlu dilengkapi</span>}
        </span>
      </DialogTrigger>
      <DialogContent className="!max-w-2xl rounded-md p-6" showCloseButton={!save.isPending}>
        <DialogHeader className="pr-6">
          <DialogTitle className="text-lg font-bold">{editor ? `Bulan Lahir · ${editor.name}` : 'Pensiun Loyalis'}</DialogTitle>
          <DialogDescription>
            {editor ? 'Gunakan bulan dan tahun lahir yang tercatat pada dokumen pegawai.' : 'Pensiun diproses secara manual melalui Master Data Pegawai.'}
          </DialogDescription>
        </DialogHeader>
        {editor ? (
          <ConfirmBirthMonthForm key={editor.id} employee={editor} today={today} pending={save.isPending} error={save.error}
            onCancel={() => setEditor(null)} onSave={save.mutate} />
        ) : (
          <div className="max-h-[65vh] space-y-4 overflow-y-auto pr-1">
            {loading && <p role="status" className="text-slate-500">Memuat data pensiun…</p>}
            {unavailable && (
              <div className="flex flex-wrap items-center gap-3">
                <p role="alert" className="text-slate-600">Data pensiun tidak dapat dimuat.</p>
                <Button variant="outline" type="button" onClick={() => {
                  if (rosterUnavailable) retryRoster();
                  if (confirmations.isError) void confirmations.refetch();
                }}>Coba lagi</Button>
              </div>
            )}
            {ready && sections.every(section => section.items.length === 0) && (
              <p className="text-slate-500">Belum ada jadwal pensiun untuk Loyalis aktif.</p>
            )}
            {ready && sections.filter(section => section.items.length > 0).map(({ title, items }) => (
              <section key={title}>
                <h3 className="font-semibold text-slate-900">{title} <span className="font-normal text-slate-500">({items.length})</span></h3>
                <ul className="mt-1 divide-y divide-slate-100 border-y border-slate-100">
                  {items.map(row => (
                    <li key={row.id} className="flex flex-wrap items-center justify-between gap-2 py-2.5">
                      <div>
                        <p className="font-medium text-slate-900">{row.name}</p>
                        {'retirementMonth' in row ? (
                          <p className="text-xs text-slate-600">
                            {row.type} · {formatMonth(row.retirementMonth)}
                            {row.estimated && <span className="text-amber-700"> · Perkiraan dari NIK</span>}
                          </p>
                        ) : (
                          <p className="text-xs text-slate-600">{row.reason === 'type' ? 'Tipe Loyalis belum ditentukan' : 'Bulan lahir perlu dikonfirmasi'}</p>
                        )}
                      </div>
                      {'reason' in row && row.reason === 'type' ? (
                        <Button type="button" size="sm" variant="outline" onClick={() => {
                          changeOpen(false);
                          onEditType(row.id);
                        }}>Edit tipe Loyalis</Button>
                      ) : (
                        <Button type="button" size="sm" variant="outline" onClick={() => {
                          save.reset();
                          setEditor(row);
                        }}>
                          {'estimated' in row && !row.estimated ? 'Edit bulan lahir' : 'Konfirmasi bulan lahir'}
                        </Button>
                      )}
                    </li>
                  ))}
                </ul>
              </section>
            ))}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
