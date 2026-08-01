"use client";

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  CalendarDays,
  ClipboardList,
  FileText,
  Loader2,
  Pencil,
  Printer,
  RefreshCw,
  Save,
  Send,
  ShieldCheck,
  Upload,
  X,
} from 'lucide-react';
import { ref, uploadBytes, getDownloadURL } from 'firebase/storage';
import { storage } from '@/lib/firebase';
import {
  SATPAM_POSTS,
  type SatpamPostId,
  type SatpamShiftName,
} from '@/lib/payroll/domain';
import {
  SATPAM_ROTATION_SLOTS,
  type SatpamRotationSlot,
  type SatpamRotationSlotAssignment,
} from '@/lib/payroll/satpamDutyPlan';
import {
  authenticatedJson,
  createFinancialRequestId,
} from '@/lib/payroll/client';
import { generateSatpamDutyPlanPdf } from '@/utils/generateSatpamDutyPlanPdf';
import { compressProofImage } from '@/lib/photoEvidence';
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

export type EmployeeOption = {
  id: string;
  name: string;
  isActive?: boolean;
};

export type OpenPeriod = {
  period: string;
  startDate: string;
  endDate: string;
  planningOnly?: boolean;
};

export type Team = {
  id: string;
  ketuaShiftId: string;
  memberEmployeeIds: string[];
};

type PlannedAssignment = {
  postId: SatpamPostId;
  employeeId: string;
};

type PlanDay = {
  dutyDate: string;
  shiftName: SatpamShiftName;
  assignments: PlannedAssignment[];
  offDutyEmployeeId: string;
  sourceSeedDate?: string;
  sourceSeedIndex?: number;
  cycleNumber?: number;
  overridden?: boolean;
  started?: boolean;
};

type DutyPlan = {
  id: string;
  period: string;
  teamId: string;
  status: string;
  revision: number;
  schemaVersion?: number;
  rotationVersion?: string;
  fixedPost9EmployeeId?: string;
  rotatingEmployeeIds?: string[];
  firstDayAssignments?: SatpamRotationSlotAssignment[];
  rotationStartMode?: 'manual' | 'continued';
  continuedFromPlanId?: string | null;
  continuedFromRevision?: number | null;
  seedDays?: PlanDay[];
  generatedDays?: PlanDay[];
  lateBackfillDates?: string[];
  acknowledgedBackfillDates?: string[];
};

type DutyPlanResponse = {
  period: string;
  enabled: boolean;
  attendanceStatus: string;
  window: { startsOn: string; endsOn: string };
  continuation?: {
    sourcePlanId: string;
    sourceRevision: number;
    fixedPost9EmployeeId: string;
    firstDayAssignments: SatpamRotationSlotAssignment[];
  } | null;
  plans: Array<DutyPlan | { id: string; teamId: string; status: 'missing' }>;
};

type AbsenceRequest = {
  id: string;
  dutyDate: string;
  shiftName: string;
  postId: string;
  absenceType: string;
  reason: string;
  evidenceUrl?: string | null;
  late?: boolean;
  status: 'pending' | 'approved' | 'declined' | 'withdrawn';
  revision: number;
  decisionReason?: string;
  approvedAmount?: number;
};

type ScheduledDuty = {
  dutyDate: string;
  shiftName: string;
  postId: string;
};

function formatSatpamPostLabel(postId: string): string {
  const post = SATPAM_POSTS.find((p) => p.id === postId);
  if (!post) return postId;
  const cleanName = post.name.replace(/^Pos\s*/i, '');
  return `${post.id} ${cleanName}`;
}

function LargeSelect(props: {
  id?: string;
  value: string;
  options: Array<{ value: string; label: string }>;
  onValueChange: (value: string) => void;
}) {
  const selectedOption = props.options.find(
    (option) => option.value === props.value,
  );
  return (
    <Select
      value={props.value}
      onValueChange={(value) => {
        if (value) props.onValueChange(value);
      }}
    >
      <SelectTrigger
        id={props.id}
        className="h-14 w-full min-w-0 rounded-xl border-slate-300 bg-white px-4 text-left text-base font-bold text-slate-800"
      >
        <SelectValue>{selectedOption?.label || props.value}</SelectValue>
      </SelectTrigger>
      <SelectContent
        align="start"
        className="max-h-[min(60vh,24rem)] rounded-xl p-1"
      >
        {props.options.map((option) => (
          <SelectItem
            key={option.value}
            value={option.value}
            className="min-h-12 rounded-lg px-4 pr-11 text-base font-semibold"
          >
            {option.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

function payrollPeriodLabel(period: string) {
  const [year, month] = period.split('-').map(Number);
  if (!year || !month) return period;
  return new Intl.DateTimeFormat('id-ID', {
    month: 'long',
    year: 'numeric',
    timeZone: 'Asia/Jakarta',
  }).format(new Date(Date.UTC(year, month - 1, 1)));
}

function employeeName(
  employees: readonly EmployeeOption[],
  employeeId: string,
) {
  return employees.find((employee) => employee.id === employeeId)?.name ||
    employeeId ||
    'Belum dipilih';
}

function statusLabel(status: string) {
  if (status === 'published') return 'Dipublikasikan';
  if (status === 'pending_backfill_review') return 'Menunggu Konfirmasi Backfill';
  if (status === 'approved') return 'Disetujui';
  if (status === 'declined') return 'Ditolak';
  if (status === 'withdrawn') return 'Ditarik';
  if (status === 'pending') return 'Menunggu Kepala SatKer';
  return status;
}

function buildManualFirstDayAssignments(
  team: Team,
  fixedPost9EmployeeId: string,
): SatpamRotationSlotAssignment[] {
  const rotatingIds = team.memberEmployeeIds.filter(
    (employeeId) => employeeId !== fixedPost9EmployeeId,
  );
  return SATPAM_ROTATION_SLOTS.map((slot, index) => ({
    slot,
    employeeId: rotatingIds[index] || '',
  }));
}

function rotationSlotLabel(slot: SatpamRotationSlot): string {
  return slot === 'Off-Duty' ? 'Libur' : formatSatpamPostLabel(slot);
}

export function SatpamDutyPlanPanel(props: {
  team: Team | null;
  employees: EmployeeOption[];
  openPeriods: OpenPeriod[];
  /** Drop the Card chrome when a page or dialog already supplies its own. */
  embedded?: boolean;
}) {
  const { team, employees, openPeriods, embedded } = props;
  const [selectedPeriod, setPeriod] = useState('');
  const defaultPeriod = useMemo(() => {
    const activePeriods = openPeriods.filter((p) => !p.planningOnly);
    if (activePeriods.length > 0) {
      return activePeriods[activePeriods.length - 1].period;
    }
    return openPeriods[openPeriods.length - 1]?.period || '';
  }, [openPeriods]);
  const period = selectedPeriod || defaultPeriod;
  const [view, setView] = useState<DutyPlanResponse | null>(null);
  const [fixedPost9EmployeeId, setFixedPost9EmployeeId] = useState('');
  const [rotationStartMode, setRotationStartMode] = useState<
    'manual' | 'continued'
  >('manual');
  const [firstDayAssignments, setFirstDayAssignments] = useState<
    SatpamRotationSlotAssignment[]
  >([]);
  const [previewHash, setPreviewHash] = useState('');
  const [previewDays, setPreviewDays] = useState<PlanDay[]>([]);
  const [previewLateBackfillDates, setPreviewLateBackfillDates] = useState<
    string[]
  >([]);
  const [editingDay, setEditingDay] = useState<PlanDay | null>(null);
  const [loading, setLoading] = useState(false);
  const [working, setWorking] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  const rosterIds = useMemo(
    () =>
      team
        ? [team.ketuaShiftId, ...team.memberEmployeeIds]
        : [],
    [team],
  );
  const rosterEmployees = useMemo(
    () =>
      rosterIds.map((employeeId) => ({
        id: employeeId,
        name: employeeName(employees, employeeId),
      })),
    [employees, rosterIds],
  );
  const selectedOpenPeriod = openPeriods.find(
    (candidate) => candidate.period === period,
  );
  const plan = (view?.plans.find(
    (candidate) => candidate.teamId === team?.id,
  ) || null) as DutyPlan | null;
  const hasPublishedPlan = Boolean(
    plan && plan.status !== 'missing' && plan.status !== 'stale',
  );
  const storageKey =
    team && period ? `unipdu:satpam-duty-seed-v2:${team.id}:${period}` : '';

  const load = useCallback(async () => {
    if (!team || !period) return;
    setLoading(true);
    setError('');
    try {
      const response = await authenticatedJson<DutyPlanResponse>(
        `/api/satpam/duty-plans?period=${encodeURIComponent(period)}`,
        { method: 'GET' },
      );
      setView(response);
      const current = response.plans.find(
        (candidate) => candidate.teamId === team.id,
      ) as DutyPlan | undefined;
      if (
        current?.schemaVersion === 2 &&
        current.fixedPost9EmployeeId &&
        current.firstDayAssignments?.length === SATPAM_ROTATION_SLOTS.length
      ) {
        setFixedPost9EmployeeId(current.fixedPost9EmployeeId);
        setRotationStartMode(current.rotationStartMode || 'manual');
        setFirstDayAssignments(current.firstDayAssignments);
      } else {
        const saved = storageKey
          ? window.localStorage.getItem(storageKey)
          : null;
        let restored = false;
        if (saved) {
          try {
            const parsed = JSON.parse(saved) as {
              schemaVersion?: number;
              fixedPost9EmployeeId?: string;
              rotationStartMode?: 'manual' | 'continued';
              firstDayAssignments?: SatpamRotationSlotAssignment[];
            };
            if (
              parsed.schemaVersion === 2 &&
              parsed.fixedPost9EmployeeId &&
              parsed.firstDayAssignments?.length === SATPAM_ROTATION_SLOTS.length
            ) {
              const canContinue =
                parsed.rotationStartMode === 'continued' &&
                response.continuation?.fixedPost9EmployeeId ===
                  parsed.fixedPost9EmployeeId;
              setFixedPost9EmployeeId(parsed.fixedPost9EmployeeId);
              setRotationStartMode(canContinue ? 'continued' : 'manual');
              setFirstDayAssignments(
                canContinue
                  ? response.continuation!.firstDayAssignments
                  : parsed.firstDayAssignments,
              );
              restored = true;
            }
          } catch {
            window.localStorage.removeItem(storageKey);
          }
        }
        if (!restored && response.continuation) {
          setFixedPost9EmployeeId(response.continuation.fixedPost9EmployeeId);
          setRotationStartMode('continued');
          setFirstDayAssignments(response.continuation.firstDayAssignments);
        } else if (!restored) {
          setFixedPost9EmployeeId('');
          setRotationStartMode('manual');
          setFirstDayAssignments([]);
        }
      }
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : 'Rencana dinas gagal dimuat.',
      );
    } finally {
      setLoading(false);
    }
  }, [period, storageKey, team]);

  useEffect(() => {
    const timer = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  useEffect(() => {
    if (
      !storageKey ||
      !fixedPost9EmployeeId ||
      firstDayAssignments.length !== SATPAM_ROTATION_SLOTS.length ||
      hasPublishedPlan
    ) return;
    window.localStorage.setItem(
      storageKey,
      JSON.stringify({
        schemaVersion: 2,
        fixedPost9EmployeeId,
        rotationStartMode,
        firstDayAssignments,
      }),
    );
  }, [
    firstDayAssignments,
    fixedPost9EmployeeId,
    hasPublishedPlan,
    rotationStartMode,
    storageKey,
  ]);

  const resetPreview = () => {
    setPreviewHash('');
    setPreviewDays([]);
    setPreviewLateBackfillDates([]);
  };

  const selectFixedPost9Employee = (employeeId: string) => {
    if (!team) return;
    setFixedPost9EmployeeId(employeeId);
    if (view?.continuation?.fixedPost9EmployeeId === employeeId) {
      setRotationStartMode('continued');
      setFirstDayAssignments(view.continuation.firstDayAssignments);
    } else {
      setRotationStartMode('manual');
      setFirstDayAssignments(buildManualFirstDayAssignments(team, employeeId));
    }
    resetPreview();
  };

  const updateFirstDayAssignment = (
    slot: SatpamRotationSlot,
    employeeId: string,
  ) => {
    setRotationStartMode('manual');
    setFirstDayAssignments((current) =>
      current.map((assignment) =>
        assignment.slot === slot
          ? { ...assignment, employeeId }
          : assignment,
      ),
    );
    resetPreview();
  };

  const firstDayEmployeeIds = firstDayAssignments
    .map((assignment) => assignment.employeeId)
    .filter(Boolean);
  const firstDayHasDuplicate =
    firstDayEmployeeIds.length !== new Set(firstDayEmployeeIds).size;
  const firstDayReady =
    Boolean(fixedPost9EmployeeId) &&
    firstDayAssignments.length === SATPAM_ROTATION_SLOTS.length &&
    firstDayEmployeeIds.length === SATPAM_ROTATION_SLOTS.length &&
    !firstDayHasDuplicate;

  const preview = async () => {
    if (!period || !firstDayReady) return;
    setWorking(true);
    setError('');
    try {
      const result = await authenticatedJson<{
        previewHash: string;
        generatedDays: PlanDay[];
        lateBackfillDates: string[];
      }>('/api/satpam/duty-plans', {
        method: 'POST',
        body: JSON.stringify({
          action: 'preview',
          period,
          fixedPost9EmployeeId,
          rotationStartMode,
          firstDayAssignments,
        }),
      });
      setPreviewHash(result.previewHash);
      setPreviewDays(result.generatedDays);
      setPreviewLateBackfillDates(result.lateBackfillDates || []);
      setMessage(
        `Pratinjau siap: ${result.generatedDays.length} tanggal dibuat dari rotasi delapan hari.`,
      );
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : 'Pola belum dapat dipratinjau.',
      );
    } finally {
      setWorking(false);
    }
  };

  const publish = async () => {
    if (!previewHash || !period) return;
    if (
      (!plan || plan.status === 'missing') &&
      previewLateBackfillDates.length > 0 &&
      !window.confirm(
        `${previewLateBackfillDates.length} tanggal sudah dimulai. ` +
          'Saat rencana pertama diterbitkan, laporan lama yang sudah disetujui pada tanggal tersebut akan dibuka kembali untuk pemeriksaan Kepala SatKer. Lanjutkan?',
      )
    ) {
      return;
    }
    setWorking(true);
    setError('');
    try {
      await authenticatedJson('/api/satpam/duty-plans', {
        method: 'POST',
        body: JSON.stringify({
          action: 'publish',
          period,
          fixedPost9EmployeeId,
          rotationStartMode,
          firstDayAssignments,
          previewHash,
          expectedRevision: plan?.revision || 0,
          requestId: createFinancialRequestId('satpam-plan'),
        }),
      });
      if (storageKey) window.localStorage.removeItem(storageKey);
      setMessage('Rencana dinas berhasil diterbitkan.');
      await load();
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : 'Rencana dinas gagal diterbitkan.',
      );
    } finally {
      setWorking(false);
    }
  };

  const saveEditedDay = async () => {
    if (!editingDay || !plan || !period) return;
    setWorking(true);
    setError('');
    try {
      await authenticatedJson('/api/satpam/duty-plans', {
        method: 'PATCH',
        body: JSON.stringify({
          action: 'edit_day',
          period,
          teamId: plan.teamId,
          expectedRevision: plan.revision,
          requestId: createFinancialRequestId('satpam-plan-day'),
          reason: '',
          day: editingDay,
        }),
      });
      setEditingDay(null);
      setMessage('Jadwal mendatang berhasil diperbarui.');
      await load();
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : 'Jadwal tidak dapat diperbarui.',
      );
    } finally {
      setWorking(false);
    }
  };

  if (!team) return null;

  const body = (
    <CardContent className="space-y-5 p-4 sm:p-5">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
          <div className="min-w-0 flex-1 space-y-2">
            <Label htmlFor="satpam-plan-period">Periode payroll</Label>
            <LargeSelect
              id="satpam-plan-period"
              value={period}
              onValueChange={setPeriod}
              options={openPeriods.map((item) => ({
                value: item.period,
                label: `${payrollPeriodLabel(item.period)} — ${
                  item.planningOnly ? 'Perencanaan awal' : 'Aktif'
                }`,
              }))}
            />
            {selectedOpenPeriod && (
              <p className="break-words text-sm leading-5 text-slate-600">
                Tanggal payroll: {selectedOpenPeriod.startDate} s.d.{' '}
                {selectedOpenPeriod.endDate}
              </p>
            )}
          </div>
          <Button
            type="button"
            variant="outline"
            className="min-h-12 gap-2"
            onClick={() => void load()}
            disabled={loading}
          >
            <RefreshCw className={`h-5 w-5 ${loading ? 'animate-spin' : ''}`} />
            Muat Ulang
          </Button>
        </div>

        {period === '2026-07' && (
          <div className="rounded-xl border border-blue-200 bg-blue-50 p-4 text-blue-900">
            <p className="font-bold">Mode Uji Coba Juli 2026</p>
            <p className="mt-1 text-sm">
              Alur rencana dinas Satpam diaktifkan lebih awal untuk latihan
              sebelum penerapan Agustus. Jendela yang dipakai tetap jendela
              payroll Juli yang ditampilkan di atas.
            </p>
          </div>
        )}

        {selectedOpenPeriod?.planningOnly && (
          <div className="rounded-xl border border-indigo-200 bg-indigo-50 p-4 text-indigo-900">
            <p className="font-bold">Perencanaan Bulan Berikutnya</p>
            <p className="mt-1 text-sm">
              Rencana boleh disiapkan dan diterbitkan sekarang. Laporan harian,
              izin, dan pembayaran baru aktif setelah Superadmin membuka
              periode tersebut.
            </p>
          </div>
        )}

        {(message || error) && (
          <div
            role="status"
            className={`rounded-xl border p-4 text-base ${
              error
                ? 'border-rose-200 bg-rose-50 text-rose-800'
                : 'border-emerald-200 bg-emerald-50 text-emerald-800'
            }`}
          >
            {error || message}
          </div>
        )}

        {loading ? (
          <div className="flex min-h-32 items-center justify-center gap-2 text-slate-500">
            <Loader2 className="h-5 w-5 animate-spin" />
            Memuat rencana dinas…
          </div>
        ) : view && !view.enabled ? (
          <div className="rounded-xl border border-slate-200 bg-slate-50 p-4 text-slate-700">
            Periode ini masih memakai alur lama. Rencana dinas mulai wajib pada
            periode berikutnya yang dibuka setelah fitur diaktifkan.
          </div>
        ) : hasPublishedPlan && plan ? (
          <>
            <div
              className={`rounded-xl border p-4 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 ${
                plan.status === 'published'
                  ? 'border-emerald-200 bg-emerald-50 text-emerald-900'
                  : 'border-amber-200 bg-amber-50 text-amber-900'
              }`}
            >
              <div>
                <p className="font-bold">
                  {statusLabel(plan.status)} · revisi {plan.revision}
                </p>
                {plan.status === 'pending_backfill_review' && (
                  <p className="mt-1 text-sm">
                    {plan.lateBackfillDates?.length || 0} tanggal yang sudah
                    dimulai menunggu konfirmasi Kepala SatKer.
                  </p>
                )}
              </div>
              <Button
                type="button"
                variant="outline"
                className="h-10 px-3.5 gap-2 rounded-xl border-emerald-300 bg-white text-emerald-800 hover:bg-emerald-100 font-bold text-xs shadow-xs shrink-0 cursor-pointer"
                onClick={() => {
                  generateSatpamDutyPlanPdf({
                    period,
                    ketuaShiftName: employeeName(rosterEmployees, team?.ketuaShiftId || ''),
                    status: plan.status,
                    revision: plan.revision,
                    employees: rosterEmployees,
                    days: plan.generatedDays || [],
                  });
                }}
              >
                <Printer className="h-4 w-4 text-emerald-600" />
                Cetak PDF (Horizontal)
              </Button>
            </div>
            <div className="space-y-3">
              {(plan.generatedDays || []).map((day) => {
                const started = day.started === true;
                return (
                  <article
                    key={day.dutyDate}
                    className="rounded-xl border border-slate-200 p-4"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <p className="font-bold text-slate-900">
                          {day.dutyDate} · Shift {day.shiftName}
                        </p>
                        <p className="mt-1 text-sm text-slate-600">
                          Libur:{' '}
                          <strong>
                            {employeeName(
                              rosterEmployees,
                              day.offDutyEmployeeId,
                            )}
                          </strong>
                        </p>
                        <p className="mt-1 text-xs text-slate-500">
                          {day.assignments
                            .map(
                              (assignment) =>
                                `${formatSatpamPostLabel(assignment.postId)}: ${employeeName(
                                  rosterEmployees,
                                  assignment.employeeId,
                                )}`,
                            )
                            .join(' · ')}
                        </p>
                      </div>
                      <Button
                        type="button"
                        variant="outline"
                        className="min-h-12 shrink-0 gap-2"
                        disabled={started}
                        onClick={() =>
                          setEditingDay(JSON.parse(JSON.stringify(day)))
                        }
                      >
                        <Pencil className="h-4 w-4" />
                        Ubah
                      </Button>
                    </div>
                  </article>
                );
              })}
            </div>
          </>
        ) : (
          <>
            {plan?.status === 'stale' && (
              <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-amber-900">
                <p className="font-bold">Susunan regu berubah</p>
                <p className="mt-1 text-sm">
                  Periksa ulang rotasi delapan hari lalu terbitkan revisi baru
                  untuk tanggal mendatang.
                </p>
              </div>
            )}
            <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
              <p className="font-bold text-slate-900">
                Langkah 1 · Periksa 10 anggota regu
              </p>
              <div className="mt-3 flex flex-wrap gap-2">
                {rosterEmployees.map((employee, index) => (
                  <span
                    key={employee.id}
                    className="rounded-full border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-700"
                  >
                    {index + 1}. {employee.name}
                  </span>
                ))}
              </div>
              <p className="mt-3 text-sm text-slate-500">
                Jika nama belum tepat, minta Superadmin memperbaiki regu
                sebelum menerbitkan.
              </p>
            </div>
            <div className="space-y-3">
              <p className="font-bold text-slate-900">
                Langkah 2 · Pilih petugas tetap Pos 9
              </p>
              <div className="rounded-xl border border-violet-200 bg-violet-50 p-4">
                <Label htmlFor="satpam-fixed-pos-9">
                  Pos 9 Hurun-inn — Petugas Tetap
                </Label>
                <div className="mt-2">
                  <LargeSelect
                    id="satpam-fixed-pos-9"
                    value={fixedPost9EmployeeId}
                    onValueChange={selectFixedPost9Employee}
                    options={rosterEmployees
                      .filter((employee) => employee.id !== team.ketuaShiftId)
                      .map((employee) => ({
                        value: employee.id,
                        label: employee.name,
                      }))}
                  />
                </div>
                <p className="mt-2 text-sm text-violet-800">
                  Petugas ini dijadwalkan di Pos 9 pada setiap tanggal periode.
                </p>
              </div>
              <div className="rounded-xl border border-blue-200 bg-blue-50 p-4">
                <p className="font-bold text-blue-950">
                  Pos 2 Stasiun — Ketua Shift / Keliling
                </p>
                <p className="mt-1 text-base text-blue-900">
                  {employeeName(rosterEmployees, team.ketuaShiftId)}
                </p>
                <p className="mt-1 text-sm text-blue-800">
                  Pos 2 tercatat atas nama Ketua. Ketua tetap berkeliling,
                  mengambil foto, dan mengirim laporan seluruh regu.
                </p>
              </div>
            </div>

            {fixedPost9EmployeeId && (
              <div className="space-y-4">
                <div>
                  <p className="font-bold text-slate-900">
                    Langkah 3 · Susunan tanggal pertama
                  </p>
                  <p className="mt-1 text-sm text-slate-600">
                    Urutan harian: Pos 1 → Pos 8 → Pos 6 → Pos 5 → Pos 7 →
                    Pos 4 → Pos 3 → Libur.
                  </p>
                </div>
                {rotationStartMode === 'continued' && view?.continuation && (
                  <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-emerald-900">
                    <p className="font-bold">Dilanjutkan dari periode sebelumnya</p>
                    <p className="mt-1 text-sm">
                      Susunan tanggal pertama sudah maju satu langkah dari revisi{' '}
                      {view.continuation.sourceRevision}. Mengubah pilihan di bawah
                      akan menjadikannya susunan manual.
                    </p>
                  </div>
                )}
                <div className="rounded-xl border border-indigo-200 p-4">
                  <p className="mb-4 text-lg font-bold">
                    {selectedOpenPeriod?.startDate || view?.window.startsOn}
                  </p>
                  <div className="space-y-4">
                    {firstDayAssignments.map((assignment) => (
                      <div
                        key={assignment.slot}
                        className={
                          assignment.slot === 'Off-Duty'
                            ? 'space-y-2 rounded-xl border border-amber-200 bg-amber-50 p-3'
                            : 'space-y-2'
                        }
                      >
                        <Label>{rotationSlotLabel(assignment.slot)}</Label>
                        <LargeSelect
                          value={assignment.employeeId}
                          onValueChange={(employeeId) =>
                            updateFirstDayAssignment(assignment.slot, employeeId)
                          }
                          options={rosterEmployees
                            .filter(
                              (employee) =>
                                employee.id !== team.ketuaShiftId &&
                                employee.id !== fixedPost9EmployeeId,
                            )
                            .map((employee) => ({
                              value: employee.id,
                              label: employee.name,
                            }))}
                        />
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            )}

            {firstDayHasDuplicate && (
                <div className="mt-4 flex gap-2 rounded-xl border border-rose-200 bg-rose-50 p-3 text-rose-800">
                  <AlertTriangle className="h-5 w-5 shrink-0" />
                  Satu petugas dipilih lebih dari sekali. Setiap orang harus
                  mengisi tepat satu pos atau Libur.
                </div>
            )}
            {previewDays.length > 0 && (
              <div className="space-y-3 rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-emerald-900">
                <div>
                  <p className="font-bold">
                    Pratinjau {previewDays.length} tanggal siap diterbitkan.
                  </p>
                  <p className="text-sm">
                    Hari ke-9 mengulang penugasan hari pertama; shift tetap
                    mengikuti saran rota pada tanggal aktual.
                  </p>
                  {(!plan || plan.status === 'missing') &&
                    previewLateBackfillDates.length > 0 && (
                    <p className="mt-2 font-semibold text-amber-800">
                      {previewLateBackfillDates.length} tanggal merupakan
                      backfill dan memerlukan konfirmasi Kepala SatKer.
                    </p>
                  )}
                </div>
                <div className="max-h-96 space-y-2 overflow-y-auto pr-1">
                  {previewDays.map((day) => (
                    <div
                      key={day.dutyDate}
                      className="rounded-xl border border-emerald-200 bg-white p-3 text-slate-800"
                    >
                      <p className="font-bold">
                        {day.dutyDate} · {day.shiftName}
                      </p>
                      <p className="text-sm">
                        Libur:{' '}
                        {employeeName(
                          rosterEmployees,
                          day.offDutyEmployeeId,
                        )}
                      </p>
                      <p className="mt-1 text-xs text-slate-500">
                        {day.assignments
                          .map(
                            (assignment) =>
                              `${formatSatpamPostLabel(assignment.postId)}: ${employeeName(
                                rosterEmployees,
                                assignment.employeeId,
                              )}`,
                          )
                          .join(' · ')}
                      </p>
                    </div>
                  ))}
                </div>
              </div>
            )}
            <p className="font-bold text-slate-900">
              Langkah 4 · Periksa semua tanggal lalu terbitkan
            </p>
            <div className="grid gap-3 sm:grid-cols-3">
              <Button
                type="button"
                variant="outline"
                className="min-h-12 gap-2"
                disabled={working || !firstDayReady}
                onClick={() => void preview()}
              >
                {working ? (
                  <Loader2 className="h-5 w-5 animate-spin" />
                ) : (
                  <ClipboardList className="h-5 w-5" />
                )}
                Periksa Rotasi
              </Button>
              <Button
                type="button"
                variant="outline"
                className="min-h-12 gap-2 text-indigo-700 border-indigo-200 bg-indigo-50/50 hover:bg-indigo-100 font-bold"
                disabled={working || previewDays.length === 0}
                onClick={() => {
                  generateSatpamDutyPlanPdf({
                    period,
                    ketuaShiftName: employeeName(rosterEmployees, team?.ketuaShiftId || ''),
                    status: 'Draft Pratinjau',
                    revision: (plan?.revision || 0) + 1,
                    employees: rosterEmployees,
                    days: previewDays,
                  });
                }}
              >
                <Printer className="h-5 w-5 text-indigo-600" />
                Cetak PDF
              </Button>
              <Button
                type="button"
                className="min-h-12 gap-2 bg-indigo-600 hover:bg-indigo-700 font-bold"
                disabled={working || !previewHash}
                onClick={() => void publish()}
              >
                <Send className="h-5 w-5" />
                Terbitkan Rencana
              </Button>
            </div>
          </>
        )}
      </CardContent>
  );

  // A fixed-position overlay escapes the Card either way, so the embedded and
  // card-wrapped renders can share it verbatim.
  const dayEditor = editingDay && (
        <div className="fixed inset-0 z-50 overflow-y-auto bg-slate-950/60 p-3">
          <div className="mx-auto my-4 max-w-xl rounded-2xl bg-white p-5 shadow-xl">
            <div className="mb-4 flex items-center justify-between">
              <div>
                <p className="text-xl font-bold">Ubah Jadwal Mendatang</p>
                <p className="text-sm text-slate-500">
                  {editingDay.dutyDate} · Shift {editingDay.shiftName}
                </p>
              </div>
              <Button
                type="button"
                variant="ghost"
                className="h-12 w-12"
                onClick={() => setEditingDay(null)}
              >
                <X className="h-5 w-5" />
              </Button>
            </div>
            <div className="space-y-4">
              {editingDay.assignments.map((assignment) => (
                <div key={assignment.postId} className="space-y-2">
                  <Label>{formatSatpamPostLabel(assignment.postId)}</Label>
                  {assignment.postId === 'Pos 2' || assignment.postId === 'Pos 9' ? (
                    <div className="min-h-14 rounded-xl border border-slate-200 bg-slate-100 px-4 py-4 text-base font-bold text-slate-700">
                      {employeeName(rosterEmployees, assignment.employeeId)}
                      <span className="mt-1 block text-sm font-medium text-slate-500">
                        {assignment.postId === 'Pos 2'
                          ? 'Ketua Shift / Keliling'
                          : 'Petugas tetap periode ini'}
                      </span>
                    </div>
                  ) : (
                    <LargeSelect
                      value={assignment.employeeId}
                      onValueChange={(employeeId) =>
                        setEditingDay((current) =>
                          current
                            ? {
                                ...current,
                                assignments: current.assignments.map((item) =>
                                  item.postId === assignment.postId
                                    ? {
                                        ...item,
                                        employeeId,
                                      }
                                    : item,
                                ),
                              }
                            : current,
                        )
                      }
                      options={rosterEmployees
                        .filter(
                          (employee) =>
                            employee.id !== team.ketuaShiftId &&
                            employee.id !== plan?.fixedPost9EmployeeId,
                        )
                        .map((employee) => ({
                          value: employee.id,
                          label: employee.name,
                        }))}
                    />
                  )}
                </div>
              ))}
              <div className="space-y-2 rounded-xl bg-amber-50 p-3">
                <Label>Libur</Label>
                <LargeSelect
                  value={editingDay.offDutyEmployeeId}
                  onValueChange={(employeeId) =>
                    setEditingDay((current) =>
                      current
                        ? {
                            ...current,
                            offDutyEmployeeId: employeeId,
                          }
                        : current,
                    )
                  }
                  options={rosterEmployees
                    .filter(
                      (employee) =>
                        employee.id !== team.ketuaShiftId &&
                        employee.id !== plan?.fixedPost9EmployeeId,
                    )
                    .map((employee) => ({
                      value: employee.id,
                      label: employee.name,
                    }))}
                />
              </div>
              <Button
                type="button"
                className="min-h-12 w-full gap-2"
                disabled={working}
                onClick={() => void saveEditedDay()}
              >
                <Save className="h-5 w-5" />
                Simpan Perubahan
              </Button>
            </div>
          </div>
        </div>
  );

  if (embedded) {
    return (
      <>
        {body}
        {dayEditor}
      </>
    );
  }

  return (
    <Card className="overflow-hidden rounded-2xl border-indigo-200 bg-white shadow-sm">
      <CardHeader className="border-b border-indigo-100 bg-indigo-50/70 p-5">
        <CardTitle className="flex items-center gap-2 text-xl">
          <CalendarDays className="h-6 w-6 text-indigo-700" />
          Jadwal Regu Satu Periode
        </CardTitle>
        <p className="text-base text-slate-600">
          Pilih petugas tetap Pos 9 dan susunan awal. Sistem melanjutkan
          rotasi delapan hari untuk seluruh jendela payroll.
        </p>
      </CardHeader>
      {body}
      {dayEditor}
    </Card>
  );
}

export function SatpamAbsencePanel(props: {
  employeeId: string;
  openPeriods: OpenPeriod[];
  /** Drop the Card chrome when a page or dialog already supplies its own. */
  embedded?: boolean;
}) {
  const { employeeId, openPeriods, embedded } = props;
  const [selectedPeriod, setPeriod] = useState('');
  const period =
    selectedPeriod || openPeriods[openPeriods.length - 1]?.period || '';
  const [requests, setRequests] = useState<AbsenceRequest[]>([]);
  const [scheduledDuties, setScheduledDuties] = useState<ScheduledDuty[]>([]);
  const [dutyDate, setDutyDate] = useState('');
  const [absenceType, setAbsenceType] = useState('sakit');
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
        requests: AbsenceRequest[];
        scheduledDuties: ScheduledDuty[];
      }>(`/api/satpam/absences?period=${encodeURIComponent(period)}`, {
        method: 'GET',
      });
      setRequests(response.requests || []);
      setScheduledDuties(response.scheduledDuties || []);
      setDutyDate((current) =>
        response.scheduledDuties.some((duty) => duty.dutyDate === current)
          ? current
          : response.scheduledDuties[0]?.dutyDate || '',
      );
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : 'Pengajuan izin gagal dimuat.',
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
    if (!dutyDate || reason.trim().length < 8) return;
    setWorking(true);
    setError('');
    try {
      let evidenceUrl: string | null = null;
      if (evidenceFile) {
        const compressed = await compressProofImage(evidenceFile);
        const fileRef = ref(
          storage,
          `activity_proofs/${employeeId}/izin_${dutyDate}_${Date.now()}.jpg`,
        );
        await uploadBytes(fileRef, compressed);
        evidenceUrl = await getDownloadURL(fileRef);
      }
      const previous = requests.find(
        (request) => request.dutyDate === dutyDate,
      );
      await authenticatedJson('/api/satpam/absences', {
        method: 'POST',
        body: JSON.stringify({
          action: 'submit',
          requestId: createFinancialRequestId('satpam-absence'),
          dutyDate,
          absenceType,
          reason,
          evidenceUrl,
          expectedRevision: previous?.revision || 0,
        }),
      });
      setReason('');
      setEvidenceFile(null);
      setMessage(
        'Pengajuan dikirim kepada Kepala SatKer. Pengajuan terlambat tetap diterima dan akan diberi tanda.',
      );
      await load();
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : 'Pengajuan izin gagal dikirim.',
      );
    } finally {
      setWorking(false);
    }
  };

  const withdraw = async (request: AbsenceRequest) => {
    setWorking(true);
    setError('');
    try {
      await authenticatedJson('/api/satpam/absences', {
        method: 'POST',
        body: JSON.stringify({
          action: 'withdraw',
          requestId: createFinancialRequestId('satpam-absence-withdraw'),
          dutyDate: request.dutyDate,
          expectedRevision: request.revision,
        }),
      });
      setMessage('Pengajuan yang masih menunggu berhasil ditarik.');
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
        <div className="space-y-2">
          <Label htmlFor="absence-period">Periode payroll</Label>
          <LargeSelect
            id="absence-period"
            value={period}
            onValueChange={setPeriod}
            options={openPeriods.map((item) => ({
              value: item.period,
              label: payrollPeriodLabel(item.period),
            }))}
          />
        </div>
        {loading ? (
          <div className="flex min-h-24 items-center justify-center gap-2 text-slate-500">
            <Loader2 className="h-5 w-5 animate-spin" />
            Memuat jadwal Anda…
          </div>
        ) : scheduledDuties.length === 0 ? (
          <div className="rounded-xl border border-slate-200 bg-slate-50 p-4 text-slate-700">
            Belum ada kewajiban dinas yang dapat dipilih pada periode ini.
          </div>
        ) : (
          <>
            <div className="space-y-2">
              <Label htmlFor="absence-duty-date">Tanggal kewajiban dinas</Label>
              <LargeSelect
                id="absence-duty-date"
                value={dutyDate}
                onValueChange={setDutyDate}
                options={scheduledDuties.map((duty) => ({
                  value: duty.dutyDate,
                  label: `${duty.dutyDate} · ${duty.shiftName} · ${formatSatpamPostLabel(duty.postId)}`,
                }))}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="absence-type">Jenis alasan</Label>
              <LargeSelect
                id="absence-type"
                value={absenceType}
                onValueChange={setAbsenceType}
                options={[
                  { value: 'sakit', label: 'Sakit' },
                  { value: 'izin_resmi', label: 'Izin Resmi' },
                  { value: 'darurat', label: 'Keperluan Darurat' },
                  { value: 'lainnya', label: 'Lainnya' },
                ]}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="absence-reason">Alasan lengkap</Label>
              <textarea
                id="absence-reason"
                className="min-h-28 w-full rounded-xl border border-slate-300 p-3 text-base"
                value={reason}
                onChange={(event) => setReason(event.target.value)}
                placeholder="Contoh: Sakit demam dan sudah memberi kabar kepada Ketua Shift."
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="absence-evidence">Foto bukti (opsional)</Label>
              <Input
                id="absence-evidence"
                type="file"
                accept="image/*"
                className="min-h-12"
                onChange={(event) =>
                  setEvidenceFile(event.target.files?.[0] || null)
                }
              />
            </div>
            <Button
              type="button"
              className="min-h-12 w-full gap-2 bg-amber-600 hover:bg-amber-700"
              disabled={working || reason.trim().length < 8}
              onClick={() => void submit()}
            >
              {working ? (
                <Loader2 className="h-5 w-5 animate-spin" />
              ) : (
                <Upload className="h-5 w-5" />
              )}
              Kirim Pengajuan ke Kepala SatKer
            </Button>
          </>
        )}

        {requests.length > 0 && (
          <section className="space-y-3 border-t border-slate-200 pt-5">
            <h3 className="font-bold">Riwayat Pengajuan</h3>
            {requests.map((request) => (
              <article
                key={request.id}
                className="rounded-xl border border-slate-200 p-4"
              >
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="font-bold">
                      {request.dutyDate} · {statusLabel(request.status)}
                    </p>
                    <p className="mt-1 text-sm text-slate-600">
                      {request.reason}
                    </p>
                    <p className="mt-1 text-xs text-slate-500">
                      {request.late ? 'Diajukan setelah shift dimulai · ' : ''}
                      Revisi {request.revision}
                      {request.status === 'approved'
                        ? ' · Dibayar Rp12.500'
                        : ''}
                    </p>
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
        )}
      </CardContent>
  );

  if (embedded) return body;

  return (
    <Card className="overflow-hidden rounded-2xl border-amber-200 bg-white shadow-sm">
      <CardHeader className="border-b border-amber-100 bg-amber-50/70 p-5">
        <CardTitle className="flex items-center gap-2 text-xl">
          <ShieldCheck className="h-6 w-6 text-amber-700" />
          Ajukan Izin Satpam
        </CardTitle>
        <p className="text-base text-slate-600">
          Anda sendiri yang mengajukan alasan kepada Kepala SatKer. Bukti foto
          boleh dikosongkan.
        </p>
      </CardHeader>
      {body}
    </Card>
  );
}
