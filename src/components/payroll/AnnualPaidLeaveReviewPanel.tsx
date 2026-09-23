"use client";

import { useCallback, useEffect, useMemo, useState } from 'react';
import { CalendarDays, Check, Loader2, RefreshCw, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
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

interface ManagedBalanceEmployee {
  employeeId: string;
  employeeName: string;
  employeeKind: AnnualPaidLeaveEmployeeKind;
  category: string;
  serviceDate: string;
  qualifyingDate: string;
  entitlementDays: number;
  reservedDays: number;
  usedDays: number;
  manualUsedDays: number;
  availableDays: number;
  maxSettableRemainingDays: number;
  revision: number;
}

interface BalanceRosterResponse {
  employees: ManagedBalanceEmployee[];
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
  const [balanceEmployees, setBalanceEmployees] = useState<ManagedBalanceEmployee[]>([]);
  const [balanceLoading, setBalanceLoading] = useState(true);
  const [balanceError, setBalanceError] = useState('');
  const [balanceSearch, setBalanceSearch] = useState('');
  const [selectedBalanceKey, setSelectedBalanceKey] = useState('');
  const [remainingDaysInput, setRemainingDaysInput] = useState('');
  const [balanceReason, setBalanceReason] = useState('');
  const [balanceSaving, setBalanceSaving] = useState(false);
  const [balanceMessage, setBalanceMessage] = useState<{
    type: 'success' | 'error';
    text: string;
  } | null>(null);
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
      ['super_admin', 'satker_head', 'loyalis_presence_admin'].includes(profile.role),
  );
  const balanceScopeDescription = profile?.role === 'loyalis_presence_admin'
    ? 'Anda dapat mengatur sisa cuti pegawai Loyalis.'
    : profile?.role === 'satker_head'
      ? `Anda dapat mengatur sisa cuti pegawai Pekarya pada kategori: ${(profile.permittedCategories || []).join(', ') || 'belum ada kategori yang ditetapkan pada akun Anda'}.`
      : 'Anda dapat mengatur sisa cuti pegawai Loyalis dan Pekarya.';
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

  const loadBalanceRoster = useCallback(async (): Promise<boolean> => {
    if (!allowed) return false;
    setBalanceLoading(true);
    setBalanceError('');
    try {
      const response = await authenticatedJson<BalanceRosterResponse>(
        `/api/payroll/paid-leave/balances?year=${year}`,
      );
      setBalanceEmployees(response.employees || []);
      return true;
    } catch (error) {
      setBalanceError(
        error instanceof Error ? error.message : 'Gagal memuat saldo pegawai.',
      );
      return false;
    } finally {
      setBalanceLoading(false);
    }
  }, [allowed, year]);

  useEffect(() => {
    const timer = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  useEffect(() => {
    const timer = window.setTimeout(() => void loadBalanceRoster(), 0);
    return () => window.clearTimeout(timer);
  }, [loadBalanceRoster]);

  const selectedBalanceEmployee = balanceEmployees.find(
    (employee) => `${employee.employeeKind}:${employee.employeeId}` === selectedBalanceKey,
  ) || null;
  const filteredBalanceEmployees = useMemo(() => {
    const search = balanceSearch.trim().toLocaleLowerCase('id');
    if (!search) return balanceEmployees;
    return balanceEmployees.filter((employee) =>
      [employee.employeeName, employee.employeeId, employee.category]
        .some((value) => value.toLocaleLowerCase('id').includes(search)),
    );
  }, [balanceEmployees, balanceSearch]);

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

  const saveRemainingBalance = async () => {
    if (!selectedBalanceEmployee) return;
    if (remainingDaysInput.trim() === '') {
      setBalanceMessage({ type: 'error', text: 'Masukkan jumlah sisa cuti.' });
      return;
    }
    const remainingDays = Number(remainingDaysInput);
    if (
      !Number.isSafeInteger(remainingDays) ||
      remainingDays < 0 ||
      remainingDays > selectedBalanceEmployee.maxSettableRemainingDays
    ) {
      setBalanceMessage({
        type: 'error',
        text: `Sisa cuti harus berupa bilangan bulat 0–${selectedBalanceEmployee.maxSettableRemainingDays}.`,
      });
      return;
    }
    const reason = balanceReason.trim();
    if (reason.length < 8 || reason.length > 500) {
      setBalanceMessage({
        type: 'error',
        text: 'Alasan wajib diisi antara 8 dan 500 karakter.',
      });
      return;
    }

    setBalanceSaving(true);
    setBalanceMessage(null);
    setProgress({
      title: 'Memperbarui sisa cuti',
      completed: 0,
      total: 1,
      detail: `${selectedBalanceEmployee.employeeName} · ${year}`,
    });
    try {
      const result = await authenticatedJson<{
        remainingDays: number;
        revision: number;
      }>('/api/payroll/paid-leave/balances', {
        method: 'POST',
        body: JSON.stringify({
          employeeId: selectedBalanceEmployee.employeeId,
          employeeKind: selectedBalanceEmployee.employeeKind,
          year,
          remainingDays,
          expectedRevision: selectedBalanceEmployee.revision,
          reason,
          requestId: createFinancialRequestId('annual-paid-leave-balance'),
        }),
      });
      const rosterLoaded = await loadBalanceRoster();
      setRemainingDaysInput(String(result.remainingDays));
      setBalanceReason('');
      setBalanceMessage({
        type: 'success',
        text: `Sisa cuti ${selectedBalanceEmployee.employeeName} ditetapkan menjadi ${result.remainingDays} hari.${rosterLoaded ? '' : ' Saldo sudah tersimpan, tetapi daftar belum berhasil diperbarui; tekan Coba Lagi.'}`,
      });
    } catch (error) {
      setBalanceMessage({
        type: 'error',
        text: error instanceof Error ? error.message : 'Sisa cuti gagal diperbarui.',
      });
    } finally {
      setProgress(null);
      setBalanceSaving(false);
    }
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
                onValueChange={(value) => {
                  setYear(Number(value));
                  setSelectedBalanceKey('');
                  setBalanceSearch('');
                  setRemainingDaysInput('');
                  setBalanceReason('');
                  setBalanceMessage(null);
                }}
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
                        Mulai kerja {formatDate(item.serviceDate)} · berhak sejak {formatDate(item.qualifyingDate)}
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

      <Card className="mt-4 border-none bg-white shadow-sm">
        <CardContent className="space-y-4 p-5">
          <div>
            <h2 className="font-bold text-slate-800">Atur Sisa Cuti Tahunan</h2>
            <p className="mt-1 text-sm text-slate-500">
              Catat sisa cuti berdasarkan pemakaian sebelum aplikasi digunakan. Cuti yang sudah disetujui atau sedang menunggu di aplikasi tetap diperhitungkan.
            </p>
            <p className="mt-1 text-sm font-medium text-slate-600">{balanceScopeDescription}</p>
          </div>

          {balanceMessage ? (
            <div
              role="status"
              className={`rounded-xl px-4 py-3 text-sm font-medium ${balanceMessage.type === 'success' ? 'bg-emerald-50 text-emerald-700' : 'bg-rose-50 text-rose-800'}`}
            >
              {balanceMessage.text}
            </div>
          ) : null}
          {balanceError ? (
            <div className="rounded-xl bg-rose-50 px-4 py-3 text-sm font-medium text-rose-800">
              {balanceError}
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="ml-3"
                onClick={() => void loadBalanceRoster()}
              >
                Coba Lagi
              </Button>
            </div>
          ) : null}

          {balanceLoading ? (
            <div className="flex min-h-24 items-center justify-center text-slate-500">
              <Loader2 className="mr-2 h-5 w-5 animate-spin" /> Memuat daftar pegawai...
            </div>
          ) : balanceEmployees.length === 0 ? (
            <div className="rounded-xl border border-dashed border-slate-200 p-6 text-center text-sm text-slate-500">
              Tidak ada pegawai aktif yang memenuhi syarat cuti pada tahun {year} dalam cakupan Anda.
            </div>
          ) : (
            <div className="space-y-4">
              <div className="grid gap-4 md:grid-cols-2">
                <div className="space-y-2">
                  <label htmlFor="paid-leave-balance-search" className="text-sm font-semibold text-slate-700">
                    Cari pegawai
                  </label>
                  <Input
                    id="paid-leave-balance-search"
                    value={balanceSearch}
                    onChange={(event) => setBalanceSearch(event.target.value)}
                    placeholder="Nama, ID, atau kategori"
                    autoComplete="off"
                  />
                </div>
                <div className="space-y-2">
                  <label htmlFor="paid-leave-balance-employee" className="text-sm font-semibold text-slate-700">
                    Pegawai
                  </label>
                  <Select
                    value={selectedBalanceKey}
                    onValueChange={(value) => {
                      const employee = balanceEmployees.find(
                        (item) => `${item.employeeKind}:${item.employeeId}` === value,
                      );
                      setSelectedBalanceKey(value || '');
                      setRemainingDaysInput(employee ? String(employee.availableDays) : '');
                      setBalanceReason('');
                      setBalanceMessage(null);
                    }}
                  >
                    <SelectTrigger id="paid-leave-balance-employee" className="h-11 w-full rounded-xl border-slate-200 bg-white">
                      <SelectValue placeholder="Pilih pegawai" />
                    </SelectTrigger>
                    <SelectContent className="max-h-80 bg-white">
                      {filteredBalanceEmployees.map((employee) => (
                        <SelectItem
                          key={`${employee.employeeKind}:${employee.employeeId}`}
                          value={`${employee.employeeKind}:${employee.employeeId}`}
                        >
                          {employee.employeeName} · {employee.category} · Sisa {employee.availableDays}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  {filteredBalanceEmployees.length === 0 ? (
                    <p className="text-xs text-slate-500">Tidak ada pegawai yang cocok dengan pencarian.</p>
                  ) : null}
                </div>
              </div>

              {selectedBalanceEmployee ? (
                <div className="space-y-4 rounded-2xl border border-slate-200 bg-slate-50 p-4">
                  <div>
                    <p className="font-bold text-slate-900">{selectedBalanceEmployee.employeeName}</p>
                    <p className="mt-1 text-sm text-slate-600">
                      {selectedBalanceEmployee.employeeKind === 'loyalis' ? 'Loyalis' : selectedBalanceEmployee.category}
                      {' · ID '}{selectedBalanceEmployee.employeeId}
                      {' · Berhak sejak '}{formatDate(selectedBalanceEmployee.qualifyingDate)}
                    </p>
                  </div>

                  <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                    {[
                      ['Hak', selectedBalanceEmployee.entitlementDays],
                      ['Menunggu', selectedBalanceEmployee.reservedDays],
                      ['Terpakai', selectedBalanceEmployee.usedDays],
                      ['Sisa sekarang', selectedBalanceEmployee.availableDays],
                    ].map(([label, value]) => (
                      <div key={String(label)} className="rounded-xl border border-slate-200 bg-white p-3 text-center">
                        <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">{label}</p>
                        <p className="mt-1 text-xl font-black text-slate-800">{value}</p>
                      </div>
                    ))}
                  </div>
                  <p className="text-xs text-slate-500">
                    Terpakai sebelum aplikasi: {selectedBalanceEmployee.manualUsedDays} hari. Angka ini disesuaikan agar Sisa sesuai catatan cuti manual.
                  </p>

                  <div className="grid gap-4 md:grid-cols-2">
                    <div className="space-y-2">
                      <label htmlFor="paid-leave-balance-remaining" className="text-sm font-semibold text-slate-700">
                        Sisa cuti yang ditetapkan
                      </label>
                      <Input
                        id="paid-leave-balance-remaining"
                        type="number"
                        min={0}
                        max={selectedBalanceEmployee.maxSettableRemainingDays}
                        step={1}
                        value={remainingDaysInput}
                        onChange={(event) => setRemainingDaysInput(event.target.value)}
                      />
                      <p className="text-xs text-slate-500">
                        Maksimal {selectedBalanceEmployee.maxSettableRemainingDays} hari setelah menghitung cuti yang sudah disetujui atau sedang menunggu di aplikasi.
                      </p>
                    </div>
                    <div className="space-y-2">
                      <label htmlFor="paid-leave-balance-reason" className="text-sm font-semibold text-slate-700">
                        Alasan perubahan
                      </label>
                      <textarea
                        id="paid-leave-balance-reason"
                        value={balanceReason}
                        maxLength={500}
                        onChange={(event) => setBalanceReason(event.target.value)}
                        placeholder="Contoh: Penyesuaian berdasarkan catatan cuti manual tahun ini"
                        className="min-h-24 w-full resize-y rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm outline-none focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100"
                      />
                      <p className="text-right text-xs text-slate-400">{balanceReason.length}/500</p>
                    </div>
                  </div>

                  <div className="flex justify-end">
                    <Button
                      type="button"
                      onClick={() => void saveRemainingBalance()}
                      disabled={balanceSaving || balanceLoading || !selectedBalanceEmployee}
                    >
                      {balanceSaving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Check className="mr-2 h-4 w-4" />}
                      Simpan Sisa Cuti
                    </Button>
                  </div>
                </div>
              ) : null}
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
