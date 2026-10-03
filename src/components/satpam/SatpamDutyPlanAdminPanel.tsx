'use client';

import { useCallback, useEffect, useState } from 'react';
import { CalendarDays, ChevronDown, ChevronUp, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { authenticatedJson, createFinancialRequestId } from '@/lib/payroll/client';

type DutyPlanDay = {
  dutyDate: string;
  shiftName: string;
  offDutyEmployeeId: string;
  assignments: Array<{ postId: string; employeeId: string }>;
};

type DutyPlan = {
  id: string;
  teamId: string;
  status: string;
  revision?: number;
  lateBackfillDates?: string[];
  rosterSnapshot?: Array<{ employeeId: string; name: string }>;
  generatedDays?: DutyPlanDay[];
};

type DutyPlanView = { enabled: boolean; plans: DutyPlan[] };

type PlanCorrection = { plan: DutyPlan; day: DutyPlanDay; reason: string };

function planStatusLabel(status: string): string {
  return (
    {
      missing: 'Belum dibuat',
      draft: 'Draf',
      published: 'Diterbitkan',
      pending_backfill_review: 'Diterbitkan (Backfill)',
      stale: 'Perlu diperbarui',
    }[status] || 'Status tidak diketahui'
  );
}

/**
 * The Satpam duty plan of a period, with the Kepala SatKer's correction of a
 * single day. A correction is saved as a new plan revision with before/after
 * and reopens the shift reports it touches for financial review, which is why
 * it sits beside the shift review. Loaded when first opened, since most visits
 * to the review page never need it. Mount it with `key={period}`.
 */
export function SatpamDutyPlanAdminPanel({
  period,
  canEdit,
  onChanged,
}: {
  period: string;
  canEdit: boolean;
  /** Called after a correction, so the shift review reloads the reopened reports. */
  onChanged?: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [view, setView] = useState<DutyPlanView | null>(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [correction, setCorrection] = useState<PlanCorrection | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      setView(
        await authenticatedJson<DutyPlanView>(
          `/api/satpam/duty-plans?period=${encodeURIComponent(period)}`,
        ),
      );
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : 'Rencana dinas gagal dimuat.',
      );
    } finally {
      setLoading(false);
    }
  }, [period]);

  // Read when the panel is opened. A different period is a different plan, so
  // the caller remounts this panel per period (key={period}).
  useEffect(() => {
    if (!open) return;
    const timeout = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(timeout);
  }, [load, open]);

  const save = async () => {
    if (!correction) return;
    const reason = correction.reason.trim();
    if (reason.length < 8) {
      setError('Alasan koreksi rencana minimal delapan karakter.');
      return;
    }
    setSaving(true);
    setError('');
    try {
      await authenticatedJson('/api/satpam/duty-plans', {
        method: 'PATCH',
        body: JSON.stringify({
          requestId: createFinancialRequestId('satpam-plan-correction'),
          action: 'edit_day',
          period,
          teamId: correction.plan.teamId,
          expectedRevision: correction.plan.revision,
          reason,
          day: correction.day,
        }),
      });
      setCorrection(null);
      setMessage(
        'Koreksi rencana tersimpan. Laporan yang terdampak dibuka kembali untuk pemeriksaan finansial.',
      );
      await load();
      onChanged?.();
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : 'Koreksi rencana dinas gagal disimpan.',
      );
    } finally {
      setSaving(false);
    }
  };

  return (
    <section className="overflow-hidden rounded-md bg-white shadow-[0_8px_30px_rgb(0,0,0,0.02)]">
      <button
        type="button"
        onClick={() => setOpen((current) => !current)}
        aria-expanded={open}
        className="flex w-full items-center justify-between gap-3 px-5 py-4 text-left lg:px-6"
      >
        <div>
          <h2 className="flex items-center gap-2 font-bold text-slate-800">
            <CalendarDays className="h-5 w-5 text-indigo-600" />
            Rencana Dinas Satpam
          </h2>
          <p className="mt-0.5 text-xs text-slate-500">
            Lihat rencana dinas periode {period} dan koreksi satu tanggal bila
            petugas, pos, atau shift-nya berubah.
          </p>
        </div>
        {open ? (
          <ChevronUp className="h-5 w-5 shrink-0 text-slate-400" />
        ) : (
          <ChevronDown className="h-5 w-5 shrink-0 text-slate-400" />
        )}
      </button>

      {open && (
        <div className="space-y-3 border-t border-slate-100 p-5 lg:p-6">
          {message && (
            <p className="rounded-md border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-800">
              {message}
            </p>
          )}
          {error && !correction && (
            <p className="rounded-md border border-rose-200 bg-rose-50 p-3 text-sm text-rose-800">
              {error}
            </p>
          )}
          {loading && !view ? (
            <div className="flex items-center justify-center gap-2 py-8 text-slate-500">
              <Loader2 className="h-5 w-5 animate-spin" />
              Memuat rencana dinas…
            </div>
          ) : (
            <>
              {view && !view.enabled && (
                <div className="rounded-md border border-slate-200 bg-slate-50 p-5 text-slate-700">
                  Periode ini masih memakai alur Satpam lama. Rencana dinas
                  kanonis berlaku untuk periode pertama yang dibuka setelah
                  fitur diterapkan.
                </div>
              )}
              {view?.plans.map((plan) => {
                const backfillDates = plan.lateBackfillDates || [];
                return (
                  <article
                    key={plan.id}
                    className="rounded-md border border-slate-200 bg-white p-5"
                  >
                    <h3 className="font-bold text-slate-900">
                      {plan.teamId} ·{' '}
                      {plan.status === 'missing'
                        ? 'Belum dibuat'
                        : `Revisi ${plan.revision || 1}`}
                    </h3>
                    <p className="mt-1 text-sm text-slate-500">
                      Status: {planStatusLabel(plan.status)} ·{' '}
                      {plan.generatedDays?.length || 0} tanggal dihasilkan
                    </p>
                    {backfillDates.length > 0 && (
                      <p className="mt-2 text-sm font-semibold text-amber-700">
                        Backfill (diterbitkan setelah shift dimulai):{' '}
                        {backfillDates.join(', ')}
                      </p>
                    )}
                    {(plan.generatedDays?.length || 0) > 0 && (
                      <details className="mt-4 rounded-md border border-slate-200 bg-slate-50">
                        <summary className="min-h-12 cursor-pointer p-3 font-semibold text-slate-700">
                          Lihat dan koreksi tanggal rencana
                        </summary>
                        <div className="max-h-96 divide-y divide-slate-200 overflow-y-auto border-t border-slate-200">
                          {plan.generatedDays!.map((day) => (
                            <div
                              key={day.dutyDate}
                              className="flex flex-col gap-3 bg-white p-3 sm:flex-row sm:items-center sm:justify-between"
                            >
                              <div>
                                <p className="font-semibold text-slate-900">
                                  {day.dutyDate} · {day.shiftName}
                                </p>
                                <p className="text-sm text-slate-500">
                                  Off-duty:{' '}
                                  {plan.rosterSnapshot?.find(
                                    (employee) =>
                                      employee.employeeId === day.offDutyEmployeeId,
                                  )?.name || day.offDutyEmployeeId}
                                </p>
                              </div>
                              {canEdit && (
                                <Button
                                  variant="outline"
                                  className="rounded-sm min-h-12"
                                  onClick={() => {
                                    setError('');
                                    setCorrection({
                                      plan,
                                      day: JSON.parse(JSON.stringify(day)),
                                      reason: '',
                                    });
                                  }}
                                >
                                  Koreksi Kepala
                                </Button>
                              )}
                            </div>
                          ))}
                        </div>
                      </details>
                    )}
                  </article>
                );
              })}
            </>
          )}
        </div>
      )}

      <Dialog
        open={Boolean(correction)}
        onOpenChange={(next) => !next && !saving && setCorrection(null)}
      >
        <DialogContent className="rounded-md max-h-[90vh] max-w-xl overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Koreksi Rencana Dinas Satpam</DialogTitle>
            <DialogDescription>
              Koreksi Kepala SatKer disimpan sebagai revisi baru dengan
              sebelum/sesudah. Laporan yang sudah disetujui akan dibuka kembali
              tanpa menghapus bukti awal.
            </DialogDescription>
          </DialogHeader>
          {correction && (
            <div className="space-y-4">
              <div>
                <p className="font-bold">
                  {correction.plan.teamId} · {correction.day.dutyDate}
                </p>
                <p className="text-sm text-slate-500">
                  Rencana revisi {correction.plan.revision}
                </p>
              </div>
              <div className="space-y-2">
                <Label>Shift yang dilaporkan</Label>
                <select
                  className="min-h-12 w-full rounded-sm border border-slate-300 bg-white px-3"
                  value={correction.day.shiftName}
                  onChange={(event) =>
                    setCorrection({
                      ...correction,
                      day: { ...correction.day, shiftName: event.target.value },
                    })
                  }
                >
                  <option value="Pagi">Pagi</option>
                  <option value="Sore">Sore</option>
                  <option value="Malam">Malam</option>
                </select>
              </div>
              {correction.day.assignments.map((assignment, index) => (
                <div key={assignment.postId} className="space-y-2">
                  <Label>{assignment.postId}</Label>
                  <select
                    className="min-h-12 w-full rounded-sm border border-slate-300 bg-white px-3"
                    value={assignment.employeeId}
                    onChange={(event) =>
                      setCorrection({
                        ...correction,
                        day: {
                          ...correction.day,
                          assignments: correction.day.assignments.map(
                            (candidate, candidateIndex) =>
                              candidateIndex === index
                                ? { ...candidate, employeeId: event.target.value }
                                : candidate,
                          ),
                        },
                      })
                    }
                  >
                    {(correction.plan.rosterSnapshot || []).map((employee) => (
                      <option key={employee.employeeId} value={employee.employeeId}>
                        {employee.name}
                      </option>
                    ))}
                  </select>
                </div>
              ))}
              <div className="space-y-2 rounded-md border border-amber-200 bg-amber-50 p-3">
                <Label>Off-duty</Label>
                <select
                  className="min-h-12 w-full rounded-sm border border-slate-300 bg-white px-3"
                  value={correction.day.offDutyEmployeeId}
                  onChange={(event) =>
                    setCorrection({
                      ...correction,
                      day: { ...correction.day, offDutyEmployeeId: event.target.value },
                    })
                  }
                >
                  {(correction.plan.rosterSnapshot || []).map((employee) => (
                    <option key={employee.employeeId} value={employee.employeeId}>
                      {employee.name}
                    </option>
                  ))}
                </select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="plan-correction-reason">Alasan wajib</Label>
                <textarea
                  id="plan-correction-reason"
                  className="min-h-24 w-full rounded-sm border border-slate-300 p-3"
                  value={correction.reason}
                  onChange={(event) =>
                    setCorrection({ ...correction, reason: event.target.value })
                  }
                  placeholder="Contoh: Pertukaran jadwal telah dikonfirmasi oleh kedua petugas."
                />
              </div>
              {error && (
                <p className="rounded-md border border-rose-200 bg-rose-50 p-3 text-sm text-rose-800">
                  {error}
                </p>
              )}
            </div>
          )}
          <DialogFooter className="rounded-b-md">
            <Button
              variant="outline"
              className="rounded-sm min-h-12"
              disabled={saving}
              onClick={() => setCorrection(null)}
            >
              Batal
            </Button>
            <Button
              className="rounded-sm min-h-12 gap-2"
              disabled={saving || !correction || correction.reason.trim().length < 8}
              onClick={() => void save()}
            >
              {saving && <Loader2 className="h-4 w-4 animate-spin" />}
              Simpan Koreksi
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  );
}
