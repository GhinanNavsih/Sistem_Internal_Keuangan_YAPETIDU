'use client';

import { useId, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { authenticatedJson } from '@/lib/payroll/client';
import { isDateOnly } from '@/lib/payroll/familyAllowance';
import { estimateLoyalisBirthDate } from '@/lib/payroll/loyalisRetirement';
import { MONTHS_ID } from '@/utils/rekapConfig';

interface BirthDateRecord {
  birthDate: string | null;
  birthMonth: string | null;
}

export default function LoyalisBirthDateField({ employeeId, nik, today, userId, onUnsavedChange }: {
  employeeId: string;
  nik: unknown;
  today: string;
  userId: string;
  onUnsavedChange: (unsaved: boolean) => void;
}) {
  const id = useId();
  const [draft, setDraft] = useState<string>();
  const queryClient = useQueryClient();
  const endpoint = '/api/admin/loyalis-retirement';
  const queryKey = ['employees', 'loyalis-birth-date', userId, employeeId] as const;
  const record = useQuery({
    queryKey,
    queryFn: ({ signal }) => authenticatedJson<BirthDateRecord>(`${endpoint}?${new URLSearchParams({ employeeId })}`, { signal }),
  });
  const savedDate = record.data?.birthDate;
  const savedMonth = record.data?.birthMonth;
  const estimate = estimateLoyalisBirthDate(nik, today);
  const suggestedDate = savedMonth && estimate?.slice(0, 7) !== savedMonth ? undefined : estimate;
  const initialValue = savedDate ?? suggestedDate ?? '';
  const value = draft ?? initialValue;
  const dirty = draft !== undefined && draft !== initialValue;
  const valid = isDateOnly(value) && value <= today;
  const save = useMutation({
    mutationFn: (birthDate: string) => authenticatedJson<BirthDateRecord>(endpoint, {
      method: 'PUT', body: JSON.stringify({ employeeId, birthDate }),
    }),
    onSuccess: async result => {
      await queryClient.cancelQueries({ queryKey });
      queryClient.setQueryData(queryKey, result);
      void queryClient.invalidateQueries({ queryKey: ['employees', 'loyalis-retirement-birth-months', userId] });
    },
  });

  return (
    <div className="space-y-2">
      <Label htmlFor={id}>Tanggal Lahir</Label>
      <Input id={id} type="date" max={today} value={record.data ? value : ''} disabled={!record.data || save.isPending}
        className="rounded-sm border-slate-200" onChange={event => {
          const next = event.target.value;
          setDraft(next);
          onUnsavedChange(next !== initialValue);
          save.reset();
        }} />
      {record.isPending && <p role="status" className="text-xs text-slate-500">Memuat tanggal lahir…</p>}
      {record.isError && !record.data && (
        <Button type="button" variant="outline" size="sm" onClick={() => void record.refetch()}>Muat ulang tanggal lahir</Button>
      )}
      {record.data && !savedDate && suggestedDate && value === suggestedDate && (
        <p className="text-xs text-amber-700">Tanggal dari NIK. Periksa tanggalnya sebelum menyimpan.</p>
      )}
      {record.data && !savedDate && !suggestedDate && savedMonth && (
        <p className="text-xs text-slate-500">Bulan lahir tercatat: {MONTHS_ID[Number(savedMonth.slice(5)) - 1]} {savedMonth.slice(0, 4)}.</p>
      )}
      {dirty && !valid && <p className="text-xs text-red-700">Masukkan tanggal lahir yang valid.</p>}
      {save.isError && <p role="alert" className="text-xs text-red-700">{save.error.message}</p>}
      {save.isSuccess && <p role="status" className="text-xs text-emerald-700">Tanggal lahir tersimpan.</p>}
      {record.data && (dirty || (valid && value !== savedDate)) && (
        <div className="flex flex-wrap gap-2">
          <Button type="button" size="sm" variant="outline" disabled={!valid || save.isPending} onClick={() => {
            onUnsavedChange(true);
            save.mutate(value, {
              onSuccess: () => {
                setDraft(undefined);
                onUnsavedChange(false);
              },
              onError: () => onUnsavedChange(dirty),
            });
          }}>{save.isPending ? 'Menyimpan…' : 'Simpan tanggal lahir'}</Button>
          {dirty && <Button type="button" size="sm" variant="ghost" disabled={save.isPending} onClick={() => {
            setDraft(undefined);
            onUnsavedChange(false);
            save.reset();
          }}>Batalkan</Button>}
        </div>
      )}
    </div>
  );
}
