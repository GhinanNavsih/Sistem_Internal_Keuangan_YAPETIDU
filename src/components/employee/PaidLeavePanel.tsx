"use client";

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  CalendarCheck2,
  CalendarDays,
  CheckCircle2,
  Clock3,
  Loader2,
  Send,
  ShieldCheck,
  Undo2,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  authenticatedJson,
  createFinancialRequestId,
} from '@/lib/payroll/client';
import type {
  AnnualPaidLeaveBalance,
  AnnualPaidLeaveRequest,
} from '@/lib/payroll/annualPaidLeave';

interface PaidLeaveResponse {
  employee: {
    id: string;
    name: string;
    kind: 'loyalis' | 'blue_collar';
    category: string;
    serviceDate: string;
    qualifyingDate: string;
    completedYearsToday: number;
    eligibleToday: boolean;
  };
  policy: {
    year: number;
    minimumCompletedYears: number;
    annualEntitlementDays: number;
    eligibleFrom: string;
  };
  balance: AnnualPaidLeaveBalance;
  requests: AnnualPaidLeaveRequest[];
}

function jakartaToday(): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Jakarta',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
}

function statusLabel(status: AnnualPaidLeaveRequest['status']): string {
  return {
    pending: 'Menunggu keputusan',
    approved: 'Disetujui',
    declined: 'Ditolak',
    withdrawn: 'Ditarik',
  }[status];
}

function statusClass(status: AnnualPaidLeaveRequest['status']): string {
  if (status === 'approved') return 'border-emerald-200 bg-emerald-50 text-emerald-800';
  if (status === 'declined') return 'border-rose-200 bg-rose-50 text-rose-800';
  if (status === 'withdrawn') return 'border-slate-200 bg-slate-50 text-slate-600';
  return 'border-amber-200 bg-amber-50 text-amber-800';
}

function formatDate(date: string): string {
  const [year, month, day] = date.split('-').map(Number);
  if (!year || !month || !day) return date;
  return new Intl.DateTimeFormat('id-ID', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: 'Asia/Jakarta',
  }).format(new Date(Date.UTC(year, month - 1, day)));
}

export function PaidLeavePanel() {
  const today = useMemo(() => jakartaToday(), []);
  const currentYear = Number(today.slice(0, 4));
  const [year, setYear] = useState(currentYear);
  const [leaveDate, setLeaveDate] = useState(today);
  const [reason, setReason] = useState('');
  const [data, setData] = useState<PaidLeaveResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [working, setWorking] = useState(false);
  const [workingLabel, setWorkingLabel] = useState('');
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const response = await authenticatedJson<PaidLeaveResponse>(
        `/api/employee/paid-leave?year=${year}`,
        { method: 'GET' },
      );
      setData(response);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Data cuti gagal dimuat.');
    } finally {
      setLoading(false);
    }
  }, [year]);

  useEffect(() => {
    const timer = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  const activeDateRequest = data?.requests.find(
    (request) =>
      request.leaveDate === leaveDate &&
      (request.status === 'pending' || request.status === 'approved'),
  );
  const eligibleForSelectedDate = Boolean(
    data && leaveDate >= data.employee.qualifyingDate,
  );
  const canSubmit = Boolean(
    data &&
      data.balance.availableDays > 0 &&
      eligibleForSelectedDate &&
      !activeDateRequest &&
      reason.trim().length <= 500,
  );

  const submit = async () => {
    if (!canSubmit) return;
    const previous = data?.requests.find((request) => request.leaveDate === leaveDate);
    setWorking(true);
    setWorkingLabel('Mengirim pengajuan cuti…');
    setError('');
    setMessage('');
    try {
      await authenticatedJson('/api/employee/paid-leave', {
        method: 'POST',
        body: JSON.stringify({
          action: 'submit',
          requestId: createFinancialRequestId('annual-paid-leave'),
          leaveDate,
          reason,
          expectedRevision: previous?.revision || 0,
        }),
      });
      setReason('');
      setMessage('Pengajuan cuti dikirim. Satu hari sekarang dicadangkan sampai diputuskan.');
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Pengajuan cuti gagal dikirim.');
    } finally {
      setWorking(false);
      setWorkingLabel('');
    }
  };

  const withdraw = async (request: AnnualPaidLeaveRequest) => {
    setWorking(true);
    setWorkingLabel('Menarik pengajuan cuti…');
    setError('');
    setMessage('');
    try {
      await authenticatedJson('/api/employee/paid-leave', {
        method: 'POST',
        body: JSON.stringify({
          action: 'withdraw',
          requestId: createFinancialRequestId('annual-paid-leave-withdraw'),
          leaveDate: request.leaveDate,
          reason: '',
          expectedRevision: request.revision,
        }),
      });
      setMessage('Pengajuan ditarik dan satu hari cadangan dikembalikan.');
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Pengajuan tidak dapat ditarik.');
    } finally {
      setWorking(false);
      setWorkingLabel('');
    }
  };

  const yearOptions = [currentYear, currentYear + 1];

  return (
    <>
      <Card className="overflow-hidden rounded-2xl border-emerald-200 bg-white shadow-sm">
        <CardHeader className="border-b border-emerald-100 bg-emerald-50/70 p-5">
          <CardTitle className="flex items-center gap-2 text-xl">
            <CalendarCheck2 className="h-6 w-6 text-emerald-700" />
            Ambil Cuti
          </CardTitle>
          <p className="text-base text-slate-600">
            Hak cuti tahunan adalah 6 hari setelah masa kerja mencapai 10 tahun.
          </p>
        </CardHeader>
        <CardContent className="space-y-5 p-4 sm:p-5">
          {(message || error) && (
            <div
              role="status"
              className={`rounded-xl border p-4 ${
                error
                  ? 'border-rose-200 bg-rose-50 text-rose-800'
                  : 'border-emerald-200 bg-emerald-50 text-emerald-800'
              }`}
            >
              {error || message}
            </div>
          )}

          <div className="space-y-2">
            <Label htmlFor="paid-leave-year">Tahun hak cuti</Label>
            <Select
              value={String(year)}
              onValueChange={(value) => {
                const nextYear = Number(value);
                setYear(nextYear);
                setLeaveDate((current) =>
                  current.startsWith(`${nextYear}-`) ? current : `${nextYear}-01-01`,
                );
              }}
            >
              <SelectTrigger id="paid-leave-year" className="h-14 w-full rounded-xl px-4 text-base font-bold">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {yearOptions.map((option) => (
                  <SelectItem key={option} value={String(option)} className="min-h-11 px-3 py-2.5">
                    {option}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {loading || !data ? (
            <div className="flex min-h-40 items-center justify-center gap-2 text-slate-500">
              <Loader2 className="h-5 w-5 animate-spin" />
              Memuat hak cuti…
            </div>
          ) : (
            <>
              <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                <div className="flex items-start gap-3">
                  <ShieldCheck className="mt-0.5 h-5 w-5 shrink-0 text-emerald-700" />
                  <div className="min-w-0">
                    <p className="font-bold text-slate-900">{data.employee.name}</p>
                    <p className="mt-1 text-sm text-slate-600">
                      Masa kerja saat ini {data.employee.completedYearsToday} tahun, dihitung sejak{' '}
                      {formatDate(data.employee.serviceDate)} · memenuhi syarat mulai{' '}
                      {formatDate(data.employee.qualifyingDate)}.
                    </p>
                  </div>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                {[
                  ['Hak', data.balance.entitlementDays, 'text-slate-900'],
                  ['Menunggu', data.balance.reservedDays, 'text-amber-700'],
                  ['Terpakai', data.balance.usedDays, 'text-indigo-700'],
                  ['Sisa', data.balance.availableDays, 'text-emerald-700'],
                ].map(([label, value, color]) => (
                  <div key={String(label)} className="rounded-2xl border border-slate-200 bg-white p-3 text-center shadow-sm">
                    <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">{label}</p>
                    <p className={`mt-1 text-2xl font-black ${color}`}>{value}</p>
                  </div>
                ))}
              </div>

              <div className="space-y-2">
                <Label htmlFor="paid-leave-date">Tanggal cuti</Label>
                <Input
                  id="paid-leave-date"
                  type="date"
                  min={`${year}-01-01`}
                  max={`${year}-12-31`}
                  value={leaveDate}
                  onChange={(event) => {
                    setLeaveDate(event.target.value);
                    setError('');
                  }}
                  className="min-h-14 rounded-xl text-base font-mono"
                />
                {!eligibleForSelectedDate && (
                  <p className="text-sm font-semibold text-amber-700">
                    Tanggal ini belum memenuhi masa kerja 10 tahun. Pilih tanggal mulai {data.employee.qualifyingDate}.
                  </p>
                )}
                {activeDateRequest && (
                  <p className="text-sm font-semibold text-amber-700">
                    Tanggal ini sudah {statusLabel(activeDateRequest.status).toLowerCase()}.
                  </p>
                )}
              </div>

              <div className="space-y-2">
                <Label htmlFor="paid-leave-reason">Alasan (opsional)</Label>
                <textarea
                  id="paid-leave-reason"
                  value={reason}
                  maxLength={500}
                  onChange={(event) => setReason(event.target.value)}
                  className="min-h-28 w-full rounded-xl border border-slate-300 p-3 text-base"
                  placeholder="Contoh: Keperluan keluarga"
                />
                <p className="text-right text-xs text-slate-400">{reason.length}/500</p>
              </div>

              <div className="rounded-xl border border-indigo-100 bg-indigo-50 p-4 text-sm text-indigo-900">
                <p className="flex items-center gap-2 font-bold">
                  <CalendarDays className="h-4 w-4" />
                  Setiap tanggal yang disetujui dibayar penuh
                </p>
                <p className="mt-1">
                  Pengajuan menunggu hanya mencadangkan saldo. Catatan kehadiran cuti dan pembayaran baru dibuat setelah disetujui.
                </p>
                <p className="mt-2">
                  Koreksi presensi dan izin sakit diajukan melalui pilihan terpisah dan tidak mengurangi saldo cuti tahunan.
                </p>
              </div>

              <Button
                type="button"
                className="min-h-12 w-full gap-2 bg-emerald-600 hover:bg-emerald-700"
                disabled={working || !canSubmit}
                onClick={() => void submit()}
              >
                {working ? <Loader2 className="h-5 w-5 animate-spin" /> : <Send className="h-5 w-5" />}
                Kirim Pengajuan Cuti
              </Button>

              {data.requests.length > 0 && (
                <section className="space-y-3 border-t border-slate-200 pt-5">
                  <h3 className="font-bold text-slate-900">Riwayat Cuti {year}</h3>
                  {data.requests.map((request) => (
                    <article key={request.id} className="rounded-xl border border-slate-200 p-4">
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <p className="font-bold text-slate-900">{formatDate(request.leaveDate)}</p>
                          <p className="mt-1 text-sm text-slate-600">{request.reason || 'Tanpa alasan tertulis'}</p>
                          <span className={`mt-2 inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-bold ${statusClass(request.status)}`}>
                            {request.status === 'approved' ? <CheckCircle2 className="h-3.5 w-3.5" /> : <Clock3 className="h-3.5 w-3.5" />}
                            {statusLabel(request.status)}
                          </span>
                          {request.decisionReason && (
                            <p className="mt-2 text-xs text-slate-500">Keputusan: {request.decisionReason}</p>
                          )}
                        </div>
                        {request.status === 'pending' && (
                          <Button
                            type="button"
                            variant="outline"
                            className="min-h-11 shrink-0 gap-2"
                            disabled={working}
                            onClick={() => void withdraw(request)}
                          >
                            <Undo2 className="h-4 w-4" />
                            Tarik
                          </Button>
                        )}
                      </div>
                    </article>
                  ))}
                </section>
              )}
            </>
          )}
        </CardContent>
      </Card>

      {working && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-950/40 p-4 backdrop-blur-sm">
          <div role="status" aria-live="assertive" className="w-full max-w-sm rounded-3xl bg-white p-6 text-center shadow-2xl">
            <Loader2 className="mx-auto h-10 w-10 animate-spin text-emerald-600" />
            <p className="mt-4 font-bold text-slate-900">{workingLabel}</p>
            <p className="mt-1 text-sm text-slate-500">Mohon jangan tutup halaman ini.</p>
          </div>
        </div>
      )}
    </>
  );
}
