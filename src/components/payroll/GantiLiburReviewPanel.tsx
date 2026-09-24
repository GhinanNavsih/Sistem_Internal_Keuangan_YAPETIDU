"use client";

import { useCallback, useEffect, useState } from 'react';
import { CalendarClock, Check, Loader2, RefreshCw, X } from 'lucide-react';
import { GantiLiburAttachmentLinks } from '@/components/GantiLiburAttachmentLinks';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useAuth } from '@/lib/AuthContext';
import {
  authenticatedJson,
  createFinancialRequestId,
  propagateUraianToSlips,
} from '@/lib/payroll/client';
import {
  gantiLiburDeclineSuggestion,
  gantiLiburVerdictLabel,
  type GantiLiburAttendanceCheck,
  type GantiLiburRequest,
} from '@/lib/payroll/gantiLibur';

type ReviewStatus = 'pending' | 'approved' | 'declined' | 'withdrawn' | 'all';

const REVIEW_STATUS_LABELS: Record<ReviewStatus, string> = {
  pending: 'Menunggu',
  approved: 'Disetujui',
  declined: 'Ditolak',
  withdrawn: 'Ditarik',
  all: 'Semua',
};

function formatDate(value: string): string {
  const date = new Date(`${value}T00:00:00`);
  return Number.isFinite(date.getTime())
    ? new Intl.DateTimeFormat('id-ID', {
        weekday: 'short',
        day: '2-digit',
        month: 'long',
        year: 'numeric',
      }).format(date)
    : value;
}

function formatMonth(value: string): string {
  const date = new Date(`${value}-01T00:00:00`);
  return Number.isFinite(date.getTime())
    ? new Intl.DateTimeFormat('id-ID', { month: 'long', year: 'numeric' }).format(date)
    : value;
}

function checkClass(check: GantiLiburAttendanceCheck): string {
  if (check.verdict === 'eligible') return 'border-emerald-200 bg-emerald-50 text-emerald-800';
  if (check.verdict === 'awaiting_upload') return 'border-slate-200 bg-slate-50 text-slate-600';
  if (check.verdict === 'absent') return 'border-rose-200 bg-rose-50 text-rose-800';
  return 'border-amber-200 bg-amber-50 text-amber-800';
}

function AttendanceCheckBadge({
  check,
  workedDate,
}: {
  check: GantiLiburAttendanceCheck;
  workedDate: string;
}) {
  const scans = check.scanIn || check.scanOut
    ? ` · Scan ${check.scanIn || '--:--'} – ${check.scanOut || '--:--'}`
    : '';
  return (
    <div className={`mt-2 inline-flex rounded-xl border px-3 py-1.5 text-sm font-semibold ${checkClass(check)}`}>
      {check.verdict === 'awaiting_upload'
        ? `Menunggu data presensi ${formatMonth(workedDate.slice(0, 7))}`
        : `${gantiLiburVerdictLabel(check.verdict)}${scans}`}
    </div>
  );
}

export default function GantiLiburReviewPanel() {
  const { profile } = useAuth();
  const [status, setStatus] = useState<ReviewStatus>('pending');
  const [items, setItems] = useState<GantiLiburRequest[]>([]);
  const [loading, setLoading] = useState(true);
  // Absent key: show the suggested reason for the verdict; '' once cleared.
  const [decisionReasons, setDecisionReasons] = useState<Record<string, string>>({});
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [progress, setProgress] = useState<{
    title: string;
    completed: number;
    total: number;
    detail: string;
  } | null>(null);

  const role = profile?.role || '';
  const allowed = ['super_admin', 'loyalis_admin', 'satker_head_loyalis'].includes(role);
  const canDecide = role === 'super_admin' || role === 'loyalis_admin';

  const load = useCallback(async () => {
    if (!allowed) return;
    setLoading(true);
    try {
      const response = await authenticatedJson<{ requests: GantiLiburRequest[] }>(
        `/api/payroll/ganti-libur/review?status=${status}`,
      );
      setItems(response.requests || []);
    } catch (error) {
      setMessage({
        type: 'error',
        text: error instanceof Error ? error.message : 'Gagal memuat pengajuan ganti libur.',
      });
    } finally {
      setLoading(false);
    }
  }, [allowed, status]);

  useEffect(() => {
    const timer = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  const reasonFor = (item: GantiLiburRequest) =>
    decisionReasons[item.id] ??
    (item.attendanceCheck ? gantiLiburDeclineSuggestion(item.attendanceCheck.verdict) : '');

  const decide = async (item: GantiLiburRequest, action: 'approve' | 'decline') => {
    const reason = reasonFor(item).trim();
    if (action === 'decline' && !reason) {
      throw new Error('Alasan penolakan wajib diisi.');
    }
    await authenticatedJson('/api/payroll/ganti-libur/review', {
      method: 'POST',
      body: JSON.stringify({
        gantiLiburRequestId: item.id,
        action,
        reason,
        expectedRevision: item.revision,
        requestId: createFinancialRequestId(`ganti-libur-${action}`),
      }),
    });
    if (action === 'approve') {
      try {
        await propagateUraianToSlips({ scope: 'loyalis', period: item.dayOffPeriod });
      } catch (error) {
        console.error('Ganti libur payroll propagation failed:', error);
        return ' Sinkronisasi slip draf perlu dijalankan ulang.';
      }
    }
    return '';
  };

  const handleDecision = async (item: GantiLiburRequest, action: 'approve' | 'decline') => {
    setProgress({
      title: action === 'approve' ? 'Menyetujui ganti libur' : 'Menolak ganti libur',
      completed: 0,
      total: 1,
      detail: `${item.employeeName} · ${formatDate(item.dayOffDate)}`,
    });
    try {
      const warning = await decide(item, action);
      setMessage({
        type: warning ? 'error' : 'success',
        text: `${action === 'approve' ? 'Ganti libur disetujui; tanggal libur dihitung hadir penuh.' : 'Pengajuan ganti libur ditolak.'}${warning}`,
      });
      await load();
    } catch (error) {
      setMessage({
        type: 'error',
        text: error instanceof Error ? error.message : 'Keputusan ganti libur gagal diproses.',
      });
    } finally {
      setProgress(null);
    }
  };

  const eligiblePending = items.filter(
    (item) => item.status === 'pending' && item.attendanceCheck?.verdict === 'eligible',
  );

  const approveAllEligible = async () => {
    if (eligiblePending.length === 0) return;
    let completed = 0;
    const failures: string[] = [];
    let propagationWarning = '';
    for (const item of eligiblePending) {
      setProgress({
        title: 'Menyetujui ganti libur',
        completed,
        total: eligiblePending.length,
        detail: `${item.employeeName} · ${formatDate(item.dayOffDate)}`,
      });
      try {
        propagationWarning ||= await decide(item, 'approve');
      } catch (error) {
        failures.push(`${item.employeeName}: ${error instanceof Error ? error.message : 'gagal'}`);
      }
      completed += 1;
    }
    setProgress(null);
    setMessage({
      type: failures.length > 0 || propagationWarning ? 'error' : 'success',
      text: failures.length > 0
        ? `${completed - failures.length} dari ${eligiblePending.length} pengajuan disetujui. ${failures.join('; ')}${propagationWarning}`
        : `${eligiblePending.length} pengajuan ganti libur disetujui.${propagationWarning}`,
    });
    await load();
  };

  if (!allowed) return null;

  return (
    <>
      <Card className="border-none bg-white shadow-sm">
        <CardContent className="space-y-4 p-5">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
            <div>
              <div className="flex items-center gap-2">
                <CalendarClock className="h-5 w-5 text-sky-600" />
                <h2 className="font-bold text-slate-800">Ganti Libur Loyalis</h2>
              </div>
              <p className="mt-1 text-sm text-slate-500">
                Setujui hanya jika presensi di hari libur menunjukkan 07.30–14.00 WIB. Kurang dari itu
                dihitung lembur. Tanggal ganti libur yang disetujui dihitung hadir penuh.
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Select value={status} onValueChange={(value) => setStatus(value as ReviewStatus)}>
                <SelectTrigger className="h-10 w-36 rounded-xl border-slate-200 bg-white">
                  <SelectValue>{REVIEW_STATUS_LABELS[status]}</SelectValue>
                </SelectTrigger>
                <SelectContent className="bg-white">
                  {(Object.keys(REVIEW_STATUS_LABELS) as ReviewStatus[]).map((option) => (
                    <SelectItem key={option} value={option}>{REVIEW_STATUS_LABELS[option]}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Button variant="outline" size="sm" onClick={() => void load()} disabled={loading}>
                <RefreshCw className={`mr-2 h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
                Segarkan
              </Button>
              {canDecide && status === 'pending' && eligiblePending.length > 1 ? (
                <Button size="sm" onClick={() => void approveAllEligible()} disabled={loading}>
                  <Check className="mr-2 h-4 w-4" /> Setujui Semua yang Memenuhi ({eligiblePending.length})
                </Button>
              ) : null}
            </div>
          </div>

          {message ? (
            <div className={`rounded-xl px-4 py-3 text-sm font-medium ${message.type === 'success' ? 'bg-emerald-50 text-emerald-700' : 'bg-amber-50 text-amber-800'}`}>
              {message.text}
            </div>
          ) : null}

          {loading ? (
            <div className="flex min-h-28 items-center justify-center text-slate-500">
              <Loader2 className="mr-2 h-5 w-5 animate-spin" /> Memuat ganti libur...
            </div>
          ) : items.length === 0 ? (
            <div className="rounded-xl border border-dashed border-slate-200 p-8 text-center text-sm text-slate-500">
              Tidak ada pengajuan ganti libur pada filter ini.
            </div>
          ) : (
            <div className="space-y-3">
              {items.map((item) => {
                const check = item.attendanceCheck || null;
                const approvable = check?.verdict === 'eligible';
                return (
                  <div key={item.id} className="rounded-2xl border border-slate-200 p-4">
                    <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                      <div className="min-w-0">
                        <div className="font-bold text-slate-800">{item.employeeName || item.employeeId}</div>
                        <div className="mt-1 text-sm text-slate-600">
                          Masuk hari libur <span className="font-semibold">{formatDate(item.workedDate)}</span>
                          {' → '}libur <span className="font-semibold">{formatDate(item.dayOffDate)}</span>
                        </div>
                        {item.reason ? (
                          <div className="mt-1 text-sm text-slate-500">Keterangan: {item.reason}</div>
                        ) : null}
                        {item.attachments && item.attachments.length > 0 ? (
                          <div className="mt-2">
                            <div className="text-xs font-semibold text-slate-500">
                              Surat resmi ({item.attachments.length})
                            </div>
                            <GantiLiburAttachmentLinks attachments={item.attachments} className="mt-1" />
                          </div>
                        ) : (
                          <div className="mt-2 text-xs text-slate-400">Tanpa surat resmi</div>
                        )}
                        {check ? <AttendanceCheckBadge check={check} workedDate={item.workedDate} /> : null}
                        {item.decisionReason ? (
                          <div className="mt-2 text-sm text-slate-600">Catatan keputusan: {item.decisionReason}</div>
                        ) : null}
                      </div>
                      {item.status === 'pending' && canDecide ? (
                        <div className="w-full space-y-2 lg:w-80">
                          <textarea
                            value={reasonFor(item)}
                            onChange={(event) => setDecisionReasons((current) => ({
                              ...current,
                              [item.id]: event.target.value.slice(0, 500),
                            }))}
                            placeholder="Catatan keputusan; wajib untuk penolakan"
                            className="min-h-20 w-full resize-y rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm outline-none focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100"
                          />
                          <div className="flex justify-end gap-2">
                            <Button variant="outline" size="sm" onClick={() => void handleDecision(item, 'decline')}>
                              <X className="mr-2 h-4 w-4" /> Tolak
                            </Button>
                            <Button
                              size="sm"
                              disabled={!approvable}
                              title={approvable ? undefined : 'Presensi hari libur belum memenuhi 07.30–14.00 WIB.'}
                              onClick={() => void handleDecision(item, 'approve')}
                            >
                              <Check className="mr-2 h-4 w-4" /> Setujui
                            </Button>
                          </div>
                        </div>
                      ) : (
                        <span className="self-start rounded-full bg-slate-100 px-3 py-1 text-xs font-bold uppercase text-slate-600">
                          {REVIEW_STATUS_LABELS[item.status]}
                        </span>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>

      {progress ? (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-950/55 p-4 backdrop-blur-sm">
          <div className="w-full max-w-md rounded-2xl bg-white p-6 text-center shadow-2xl">
            <Loader2 className="mx-auto h-9 w-9 animate-spin text-indigo-600" />
            <h3 className="mt-4 text-lg font-bold text-slate-900">{progress.title}</h3>
            <p className="mt-2 text-sm text-slate-600">{progress.detail}</p>
            <div className="mt-4 h-2 overflow-hidden rounded-full bg-slate-100">
              <div
                className="h-full rounded-full bg-indigo-600 transition-all"
                style={{ width: `${Math.max(5, (progress.completed / progress.total) * 100)}%` }}
              />
            </div>
            <p className="mt-2 text-xs font-semibold text-slate-500">
              {progress.completed} dari {progress.total} selesai. Jangan tutup halaman.
            </p>
          </div>
        </div>
      ) : null}
    </>
  );
}
