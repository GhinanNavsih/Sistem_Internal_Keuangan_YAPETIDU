"use client";

import { useCallback, useEffect, useMemo, useState } from 'react';
import { CalendarDays, Check, Loader2, RefreshCw, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useAuth } from '@/lib/AuthContext';
import {
  authenticatedJson,
  createFinancialRequestId,
  propagateUraianToSlips,
} from '@/lib/payroll/client';
import type {
  AnnualPaidLeaveEmployeeKind,
  AnnualPaidLeavePayType,
  AnnualPaidLeaveStatus,
} from '@/lib/payroll/annualPaidLeave';

interface ReviewRequest {
  id: string;
  employeeId: string;
  employeeName: string;
  employeeKind: AnnualPaidLeaveEmployeeKind;
  category: string;
  leaveDate: string;
  year: number;
  period: string;
  reason: string;
  serviceDate: string;
  qualifyingDate: string;
  status: AnnualPaidLeaveStatus;
  revision: number;
  decisionReason?: string | null;
  approvedPayType?: AnnualPaidLeavePayType | null;
  approvedAmount?: number;
}

interface ReviewResponse {
  requests: ReviewRequest[];
}

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
        day: '2-digit',
        month: 'long',
        year: 'numeric',
      }).format(date)
    : value;
}

function formatMoney(value: number): string {
  return new Intl.NumberFormat('id-ID', {
    style: 'currency',
    currency: 'IDR',
    maximumFractionDigits: 0,
  }).format(value);
}

export default function AnnualPaidLeaveReviewPanel() {
  const { profile } = useAuth();
  const currentYear = new Date().getFullYear();
  const [year, setYear] = useState(currentYear);
  const [status, setStatus] = useState<ReviewStatus>('pending');
  const [items, setItems] = useState<ReviewRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [decisionReasons, setDecisionReasons] = useState<Record<string, string>>({});
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [progress, setProgress] = useState<{
    title: string;
    completed: number;
    total: number;
    detail: string;
  } | null>(null);

  const allowed = Boolean(
    profile &&
      ['super_admin', 'satker_head', 'loyalis_admin'].includes(profile.role),
  );
  const yearOptions = useMemo(() => [currentYear - 1, currentYear, currentYear + 1], [currentYear]);

  const load = useCallback(async () => {
    if (!allowed) return;
    setLoading(true);
    try {
      const response = await authenticatedJson<ReviewResponse>(
        `/api/payroll/paid-leave/review?year=${year}&status=${status}`,
      );
      setItems(response.requests || []);
    } catch (error) {
      setMessage({
        type: 'error',
        text: error instanceof Error ? error.message : 'Gagal memuat pengajuan cuti tahunan.',
      });
    } finally {
      setLoading(false);
    }
  }, [allowed, status, year]);

  useEffect(() => {
    const timer = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  const propagate = async (item: ReviewRequest) => {
    if (item.employeeKind === 'loyalis') {
      return propagateUraianToSlips({ scope: 'loyalis', period: item.period });
    }
    return propagateUraianToSlips({
      scope: 'pekarya',
      period: item.period,
      jobCategory: item.category,
    });
  };

  const decide = async (
    item: ReviewRequest,
    action: 'approve' | 'decline',
    updateProgress = true,
  ) => {
    const reason = String(decisionReasons[item.id] || '').trim();
    if (action === 'decline' && !reason) {
      throw new Error('Alasan penolakan wajib diisi.');
    }
    if (updateProgress) {
      setProgress({
        title: action === 'approve' ? 'Menyetujui cuti tahunan' : 'Menolak cuti tahunan',
        completed: 0,
        total: 1,
        detail: `${item.employeeName} · ${formatDate(item.leaveDate)}`,
      });
    }
    const result = await authenticatedJson<{
      status: AnnualPaidLeaveStatus;
      reconciliationWarning?: string | null;
    }>('/api/payroll/paid-leave/review', {
      method: 'POST',
      body: JSON.stringify({
        annualPaidLeaveRequestId: item.id,
        action,
        reason,
        expectedRevision: item.revision,
        requestId: createFinancialRequestId(`annual-paid-leave-${action}`),
      }),
    });
    let propagationWarning = '';
    if (action === 'approve') {
      try {
        await propagate(item);
      } catch (error) {
        console.error('Annual paid leave payroll propagation failed:', error);
        propagationWarning = ' Sinkronisasi slip draf perlu dijalankan ulang.';
      }
    }
    if (updateProgress) {
      setProgress({
        title: action === 'approve' ? 'Cuti tahunan disetujui' : 'Cuti tahunan ditolak',
        completed: 1,
        total: 1,
        detail: `${item.employeeName} · ${formatDate(item.leaveDate)}`,
      });
      setMessage({
        type: result.reconciliationWarning || propagationWarning ? 'error' : 'success',
        text: `${action === 'approve' ? 'Cuti disetujui dan presensi berbayar diterapkan.' : 'Pengajuan cuti ditolak.'}${result.reconciliationWarning ? ` ${result.reconciliationWarning}` : ''}${propagationWarning}`,
      });
      setProgress(null);
      await load();
    }
  };

  const handleDecision = async (item: ReviewRequest, action: 'approve' | 'decline') => {
    try {
      await decide(item, action);
    } catch (error) {
      setProgress(null);
      setMessage({
        type: 'error',
        text: error instanceof Error ? error.message : 'Keputusan cuti gagal diproses.',
      });
    }
  };

  const approveAll = async () => {
    const pending = items.filter((item) => item.status === 'pending');
    if (pending.length === 0) return;
    let completed = 0;
    const failures: string[] = [];
    setProgress({
      title: 'Menyetujui cuti tahunan',
      completed,
      total: pending.length,
      detail: 'Menyiapkan pemeriksaan...',
    });
    for (const item of pending) {
      setProgress({
        title: 'Menyetujui cuti tahunan',
        completed,
        total: pending.length,
        detail: `${item.employeeName} · ${formatDate(item.leaveDate)}`,
      });
      try {
        await decide(item, 'approve', false);
      } catch (error) {
        failures.push(
          `${item.employeeName}: ${error instanceof Error ? error.message : 'gagal'}`,
        );
      }
      completed += 1;
    }
    setProgress(null);
    setMessage({
      type: failures.length > 0 ? 'error' : 'success',
      text: failures.length > 0
        ? `${completed - failures.length} dari ${pending.length} pengajuan disetujui. ${failures.join('; ')}`
        : `${pending.length} pengajuan cuti berhasil disetujui.`,
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
                <CalendarDays className="h-5 w-5 text-emerald-600" />
                <h2 className="font-bold text-slate-800">Cuti Tahunan</h2>
              </div>
              <p className="mt-1 text-sm text-slate-500">
                Persetujuan membuat presensi berbayar; penolakan hanya melepaskan reservasi saldo.
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Select
                value={String(year)}
                onValueChange={(value) => setYear(Number(value))}
              >
                <SelectTrigger className="h-10 w-28 rounded-xl border-slate-200 bg-white">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="bg-white">
                  {yearOptions.map((option) => (
                    <SelectItem key={option} value={String(option)}>{option}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Select value={status} onValueChange={(value) => setStatus(value as ReviewStatus)}>
                <SelectTrigger className="h-10 w-36 rounded-xl border-slate-200 bg-white">
                  <SelectValue>{REVIEW_STATUS_LABELS[status]}</SelectValue>
                </SelectTrigger>
                <SelectContent className="bg-white">
                  <SelectItem value="pending">{REVIEW_STATUS_LABELS.pending}</SelectItem>
                  <SelectItem value="approved">{REVIEW_STATUS_LABELS.approved}</SelectItem>
                  <SelectItem value="declined">{REVIEW_STATUS_LABELS.declined}</SelectItem>
                  <SelectItem value="withdrawn">{REVIEW_STATUS_LABELS.withdrawn}</SelectItem>
                  <SelectItem value="all">{REVIEW_STATUS_LABELS.all}</SelectItem>
                </SelectContent>
              </Select>
              <Button variant="outline" size="sm" onClick={() => void load()} disabled={loading}>
                <RefreshCw className={`mr-2 h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
                Segarkan
              </Button>
              {status === 'pending' && items.length > 1 ? (
                <Button size="sm" onClick={() => void approveAll()} disabled={loading}>
                  <Check className="mr-2 h-4 w-4" /> Setujui Semua
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
              <Loader2 className="mr-2 h-5 w-5 animate-spin" /> Memuat cuti tahunan...
            </div>
          ) : items.length === 0 ? (
            <div className="rounded-xl border border-dashed border-slate-200 p-8 text-center text-sm text-slate-500">
              Tidak ada pengajuan cuti tahunan pada filter ini.
            </div>
          ) : (
            <div className="space-y-3">
              {items.map((item) => (
                <div key={item.id} className="rounded-2xl border border-slate-200 p-4">
                  <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                    <div className="min-w-0">
                      <div className="font-bold text-slate-800">{item.employeeName || item.employeeId}</div>
                      <div className="mt-1 text-sm text-slate-500">
                        {item.employeeKind === 'loyalis' ? 'Loyalis' : item.category} · {formatDate(item.leaveDate)} · Periode {item.period}
                      </div>
                      <div className="mt-2 text-sm text-slate-700">
                        Alasan: {item.reason || 'Tidak ada alasan tambahan.'}
                      </div>
                      <div className="mt-1 text-xs text-slate-500">
                        Mulai kerja {formatDate(item.serviceDate)} · hak pertama mulai {formatDate(item.qualifyingDate)}
                      </div>
                      {item.status === 'approved' ? (
                        <div className="mt-2 text-sm font-semibold text-emerald-700">
                          {item.approvedPayType || 'Cuti'}{item.approvedAmount ? ` · ${formatMoney(item.approvedAmount)}` : ''}
                        </div>
                      ) : null}
                      {item.decisionReason ? (
                        <div className="mt-2 text-sm text-slate-600">Catatan keputusan: {item.decisionReason}</div>
                      ) : null}
                    </div>
                    {item.status === 'pending' ? (
                      <div className="w-full space-y-2 lg:w-80">
                        <textarea
                          value={decisionReasons[item.id] || ''}
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
                          <Button size="sm" onClick={() => void handleDecision(item, 'approve')}>
                            <Check className="mr-2 h-4 w-4" /> Setujui
                          </Button>
                        </div>
                      </div>
                    ) : (
                      <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-bold uppercase text-slate-600">
                        {REVIEW_STATUS_LABELS[item.status]}
                      </span>
                    )}
                  </div>
                </div>
              ))}
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
