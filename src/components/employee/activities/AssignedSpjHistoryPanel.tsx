"use client";

import { BadgeCheck, Banknote, CalendarDays, Loader2, Lock } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { VAKASI_PEKARYA_PROJECTION_SOURCE_KIND } from '@/lib/payroll/vakasiTambahan';
import type { AssignedSpjEvent } from '@/lib/payroll/assignedSpjEvents';
import { fmtRp } from './activityShared';

function periodLabel(period: string): string {
  const match = /^(\d{4})-(\d{2})$/.exec(period);
  if (!match) return period;
  return new Intl.DateTimeFormat('id-ID', {
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, 1)));
}

function approvedAtLabel(value: string | null): string {
  if (!value) return 'Waktu persetujuan tidak tercatat';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Waktu persetujuan tidak tercatat';
  return `Disetujui ${new Intl.DateTimeFormat('id-ID', {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: 'Asia/Jakarta',
  }).format(date)} WIB`;
}

export default function AssignedSpjHistoryPanel({
  assignedSpjEvents,
  loadingAssignedSpjEvents,
}: {
  assignedSpjEvents: AssignedSpjEvent[];
  loadingAssignedSpjEvents: boolean;
}) {
  return (
    <section className="space-y-3" aria-labelledby="assigned-spj-history-title">
      <div className="flex items-center justify-between px-1">
        <div>
          <h2 id="assigned-spj-history-title" className="text-xs font-black uppercase tracking-wider text-slate-600">
            Riwayat SPJ Penugasan
          </h2>
          <p className="mt-0.5 text-[10px] font-medium text-slate-400">
            Penugasan yang disetujui dan otomatis masuk ke pendapatan SPJ Anda.
          </p>
        </div>
        <Lock className="h-4 w-4 text-slate-300" aria-label="Hanya-baca" />
      </div>

      {loadingAssignedSpjEvents ? (
        <Card className="rounded-2xl border-none bg-white shadow-sm">
          <CardContent className="flex items-center justify-center gap-2 py-8 text-xs font-semibold text-slate-400">
            <Loader2 className="h-4 w-4 animate-spin text-teal-500" />
            Memuat riwayat SPJ...
          </CardContent>
        </Card>
      ) : assignedSpjEvents.length === 0 ? (
        <Card className="rounded-2xl border border-dashed border-slate-200 bg-white/60 shadow-none">
          <CardContent className="py-7 text-center text-xs font-medium text-slate-400">
            Belum ada SPJ penugasan yang disetujui pada periode ini.
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-2.5">
          {assignedSpjEvents.map((event) => {
            const fromVakasi =
              event.sourceKind === VAKASI_PEKARYA_PROJECTION_SOURCE_KIND;
            return (
              <Card key={event.id} className="overflow-hidden rounded-2xl border-none bg-white shadow-sm">
                <CardContent className="space-y-3 p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <h3 className="truncate text-sm font-black text-slate-800">{event.eventName}</h3>
                        <span className={`rounded-md px-2 py-0.5 text-[9px] font-black ${
                          fromVakasi
                            ? 'bg-violet-100 text-violet-700'
                            : 'bg-teal-100 text-teal-700'
                        }`}>
                          {fromVakasi ? 'Vakasi Tambahan' : 'Kegiatan SPJ'}
                        </span>
                      </div>
                      <div className="mt-1 flex items-center gap-1.5 text-[10px] font-semibold text-slate-400">
                        <CalendarDays className="h-3.5 w-3.5" />
                        Periode {periodLabel(event.period)}
                      </div>
                    </div>
                    <BadgeCheck className="h-5 w-5 shrink-0 text-emerald-500" />
                  </div>

                  <div className="flex items-end justify-between gap-3 rounded-xl border border-emerald-100 bg-emerald-50 px-3 py-2.5">
                    <div>
                      <p className="text-[9px] font-black uppercase tracking-wider text-emerald-600">SPJ Disetujui</p>
                      <p className="mt-0.5 text-[10px] font-medium text-emerald-700/70">{approvedAtLabel(event.approvedAt)}</p>
                    </div>
                    <div className="flex items-center gap-1.5 text-sm font-black text-emerald-700">
                      <Banknote className="h-4 w-4" />
                      {fmtRp(event.payGiven)}
                    </div>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </section>
  );
}
