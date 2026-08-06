"use client";

import { useCallback, useEffect, useMemo, useState } from 'react';
import { CalendarDays, Loader2, ShieldCheck, Upload } from 'lucide-react';
import { ref, uploadBytes, getDownloadURL } from 'firebase/storage';
import { storage } from '@/lib/firebase';
import { compressProofImage } from '@/lib/photoEvidence';
import { ATTENDANCE_PAYROLL_START_PERIOD } from '@/lib/payroll/attendance';
import {
  PEKARYA_OFFICIAL_LEAVE_SCAN_IN,
  PEKARYA_OFFICIAL_LEAVE_SCAN_OUT,
  type PekaryaOfficialLeaveRequest,
} from '@/lib/payroll/pekaryaOfficialLeave';
import { authenticatedJson, createFinancialRequestId } from '@/lib/payroll/client';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

type OpenPeriod = {
  period: string;
  startDate: string;
  endDate: string;
};

function payrollPeriodLabel(period: string): string {
  const [year, month] = period.split('-').map(Number);
  if (!year || !month) return period;
  return new Intl.DateTimeFormat('id-ID', {
    month: 'long',
    year: 'numeric',
    timeZone: 'Asia/Jakarta',
  }).format(new Date(Date.UTC(year, month - 1, 1)));
}

function statusLabel(status: PekaryaOfficialLeaveRequest['status']): string {
  return {
    pending: 'Menunggu keputusan',
    approved: 'Disetujui',
    declined: 'Ditolak',
    withdrawn: 'Ditarik',
  }[status];
}

export function PekaryaOfficialLeavePanel(props: {
  employeeId: string;
  openPeriods: OpenPeriod[];
  embedded?: boolean;
}) {
  const { employeeId, openPeriods, embedded } = props;
  const availablePeriods = useMemo(
    () =>
      openPeriods.filter(
        (item) => item.period >= ATTENDANCE_PAYROLL_START_PERIOD,
      ),
    [openPeriods],
  );
  const [selectedPeriod, setSelectedPeriod] = useState('');
  const [date, setDate] = useState('');
  const period =
    availablePeriods.some((item) => item.period === selectedPeriod)
      ? selectedPeriod
      : availablePeriods[availablePeriods.length - 1]?.period || '';
  const selectedPeriodData = useMemo(
    () => availablePeriods.find((item) => item.period === period) || null,
    [availablePeriods, period],
  );
  const effectiveDate = date || selectedPeriodData?.startDate || '';
  const [requests, setRequests] = useState<PekaryaOfficialLeaveRequest[]>([]);
  const [reason, setReason] = useState('');
  const [evidenceFile, setEvidenceFile] = useState<File | null>(null);
  const [working, setWorking] = useState(false);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    if (!period) return;
    setLoading(true);
    setError('');
    try {
      const response = await authenticatedJson<{
        requests: PekaryaOfficialLeaveRequest[];
      }>(`/api/attendance/pekarya/official-leave?period=${encodeURIComponent(period)}`);
      setRequests(response.requests || []);
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : 'Riwayat izin resmi gagal dimuat.',
      );
    } finally {
      setLoading(false);
    }
  }, [period]);

  useEffect(() => {
    const timer = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  const submit = async () => {
    if (!period || !effectiveDate || reason.trim().length < 8) return;
    setWorking(true);
    setError('');
    setMessage('');
    try {
      let evidenceUrl: string | null = null;
      if (evidenceFile) {
        const compressed = await compressProofImage(evidenceFile);
        const fileRef = ref(
          storage,
          `activity_proofs/${employeeId}/izin_resmi_${effectiveDate}_${Date.now()}.jpg`,
        );
        await uploadBytes(fileRef, compressed);
        evidenceUrl = await getDownloadURL(fileRef);
      }
      const previous = requests.find((request) => request.date === effectiveDate);
      await authenticatedJson('/api/attendance/pekarya/official-leave', {
        method: 'POST',
        body: JSON.stringify({
          action: 'submit',
          requestId: createFinancialRequestId('pekarya-official-leave'),
          period,
          date: effectiveDate,
          reason,
          evidenceUrl,
          expectedRevision: previous?.revision || 0,
        }),
      });
      setReason('');
      setEvidenceFile(null);
      setMessage('Pengajuan izin resmi dikirim kepada Kepala SatKer.');
      await load();
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : 'Pengajuan izin resmi gagal dikirim.',
      );
    } finally {
      setWorking(false);
    }
  };

  const withdraw = async (request: PekaryaOfficialLeaveRequest) => {
    setWorking(true);
    setError('');
    setMessage('');
    try {
      await authenticatedJson('/api/attendance/pekarya/official-leave', {
        method: 'POST',
        body: JSON.stringify({
          action: 'withdraw',
          requestId: createFinancialRequestId('pekarya-official-leave-withdraw'),
          period: request.period,
          date: request.date,
          expectedRevision: request.revision,
        }),
      });
      setMessage('Pengajuan izin resmi berhasil ditarik.');
      await load();
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : 'Pengajuan tidak dapat ditarik.',
      );
    } finally {
      setWorking(false);
    }
  };

  const body = (
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
      {availablePeriods.length === 0 ? (
        <div className="rounded-xl border border-slate-200 bg-slate-50 p-4 text-slate-700">
          Belum ada periode payroll terbuka untuk pengajuan izin resmi.
        </div>
      ) : (
        <>
          <div className="space-y-2">
            <Label htmlFor="official-leave-period">Periode payroll</Label>
            <select
              id="official-leave-period"
              className="min-h-14 w-full rounded-xl border border-slate-300 bg-white px-4 text-base font-bold text-slate-800"
              value={period}
              onChange={(event) => {
                const nextPeriod = event.target.value;
                setSelectedPeriod(nextPeriod);
                const nextPeriodData = availablePeriods.find(
                  (item) => item.period === nextPeriod,
                );
                setDate(nextPeriodData?.startDate || '');
              }}
            >
              {availablePeriods.map((item) => (
                <option key={item.period} value={item.period}>
                  {payrollPeriodLabel(item.period)}
                </option>
              ))}
            </select>
          </div>
          {selectedPeriodData && (
            <div className="space-y-2">
              <Label htmlFor="official-leave-date">Tanggal izin resmi</Label>
              <Input
                id="official-leave-date"
                type="date"
                min={selectedPeriodData.startDate}
                max={selectedPeriodData.endDate}
                value={effectiveDate}
                onChange={(event) => setDate(event.target.value)}
                className="min-h-14 rounded-xl text-base"
              />
            </div>
          )}
          <div className="rounded-xl border border-indigo-100 bg-indigo-50 p-4 text-sm text-indigo-900">
            <p className="flex items-center gap-2 font-bold">
              <CalendarDays className="h-4 w-4" />
              Izin resmi dihitung sebagai hari penuh
            </p>
            <p className="mt-1">
              Jika disetujui, presensi akan dicatat otomatis pukul{' '}
              <strong>{PEKARYA_OFFICIAL_LEAVE_SCAN_IN.slice(0, 5)}</strong>–
              <strong>{PEKARYA_OFFICIAL_LEAVE_SCAN_OUT.slice(0, 5)}</strong>{' '}
              dan masuk perhitungan upah sesuai kalender payroll.
            </p>
          </div>
          <div className="space-y-2">
            <Label htmlFor="official-leave-reason">Alasan lengkap</Label>
            <textarea
              id="official-leave-reason"
              className="min-h-28 w-full rounded-xl border border-slate-300 p-3 text-base"
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              placeholder="Contoh: Mendapat tugas resmi dari unit kerja dan telah melapor kepada atasan."
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="official-leave-evidence">Foto bukti (opsional)</Label>
            <Input
              id="official-leave-evidence"
              type="file"
              accept="image/*"
              className="min-h-12"
              onChange={(event) => setEvidenceFile(event.target.files?.[0] || null)}
            />
          </div>
          <Button
            type="button"
            className="min-h-12 w-full gap-2 bg-indigo-600 hover:bg-indigo-700"
            disabled={working || !effectiveDate || reason.trim().length < 8}
            onClick={() => void submit()}
          >
            {working ? <Loader2 className="h-5 w-5 animate-spin" /> : <Upload className="h-5 w-5" />}
            Kirim Pengajuan ke Kepala SatKer
          </Button>
        </>
      )}

      {loading ? (
        <div className="flex min-h-20 items-center justify-center gap-2 text-slate-500">
          <Loader2 className="h-5 w-5 animate-spin" />
          Memuat riwayat izin…
        </div>
      ) : requests.length > 0 ? (
        <section className="space-y-3 border-t border-slate-200 pt-5">
          <h3 className="font-bold">Riwayat Pengajuan</h3>
          {requests.map((request) => (
            <article key={request.id} className="rounded-xl border border-slate-200 p-4">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="font-bold">
                    {request.date} · {statusLabel(request.status)}
                  </p>
                  <p className="mt-1 text-sm text-slate-600">{request.reason}</p>
                  <p className="mt-1 text-xs text-slate-500">
                    Revisi {request.revision}
                    {request.status === 'approved'
                      ? ` · Dibayar ${new Intl.NumberFormat('id-ID', {
                          style: 'currency',
                          currency: 'IDR',
                          maximumFractionDigits: 0,
                        }).format(request.approvedAmount || 0)}`
                      : ''}
                  </p>
                  {request.decisionReason && (
                    <p className="mt-2 rounded-lg bg-slate-50 p-2 text-sm text-slate-600">
                      Keputusan: {request.decisionReason}
                    </p>
                  )}
                </div>
                {request.status === 'pending' && (
                  <Button
                    type="button"
                    variant="outline"
                    className="min-h-12"
                    disabled={working}
                    onClick={() => void withdraw(request)}
                  >
                    Tarik
                  </Button>
                )}
              </div>
            </article>
          ))}
        </section>
      ) : null}
    </CardContent>
  );

  if (embedded) return body;

  return (
    <Card className="overflow-hidden rounded-2xl border-indigo-200 bg-white shadow-sm">
      <CardHeader className="border-b border-indigo-100 bg-indigo-50/70 p-5">
        <CardTitle className="flex items-center gap-2 text-xl">
          <ShieldCheck className="h-6 w-6 text-indigo-700" />
          Ajukan Izin Resmi
        </CardTitle>
        <p className="text-base text-slate-600">
          Pengajuan diteruskan kepada Kepala SatKer untuk diperiksa dan disetujui.
        </p>
      </CardHeader>
      {body}
    </Card>
  );
}
