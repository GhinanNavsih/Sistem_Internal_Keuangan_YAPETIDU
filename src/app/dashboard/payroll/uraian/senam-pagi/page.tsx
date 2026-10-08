"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useSearchParams } from 'next/navigation';
import { CalendarPlus, Check, Loader2, Search, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Callout } from '@/components/ui/callout';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { FloatingSnackbar, type SnackbarMessage } from '@/components/ui/floating-snackbar';
import { Input } from '@/components/ui/input';
import { StatusDot } from '@/components/ui/status-dot';
import { useAuth } from '@/lib/AuthContext';
import {
  BONUS_TRIWULAN_START_PERIOD,
  periodLabel,
  periodMonthName,
  type BonusTriwulanEvaluation,
  type BonusTriwulanRow,
  type BonusTriwulanMonthStanding,
  type SenamPagiStanding,
} from '@/lib/payroll/bonusTriwulan';
import { authenticatedJson, createFinancialRequestId } from '@/lib/payroll/client';
import { canRecordSenamPagi } from '@/lib/payroll/roles';
import { cn } from '@/lib/utils';

/**
 * Senam Pagi roll calls and the Bonus Triwulan they decide. Admin Karyawan
 * records; Super Admin can too; Badan Keuangan only looks. Every figure comes
 * from /api/payroll/senam-pagi and /api/payroll/bonus-triwulan.
 */

interface RosterEntry {
  employeeId: string;
  employeeName: string;
  nipy: string;
  unit: string;
  standing: SenamPagiStanding;
}

interface SenamView {
  period: string;
  periodClosed: boolean;
  readOnlyReason: string | null;
  month: {
    source: 'saku' | 'paper';
    noSessions: boolean;
    sessions: Array<{ date: string; presentEmployeeIds: string[] }>;
    revision: number;
  } | null;
  roster: RosterEntry[];
}

interface BonusView {
  period: string;
  periodClosed: boolean;
  amount: number;
  paper: boolean;
  evaluation: BonusTriwulanEvaluation | null;
  stored: {
    recipients: Array<{ employeeId: string; employeeName: string }>;
    missing: string[];
    evaluatedAt: string | null;
    evaluatedByName: string | null;
  } | null;
  stale: boolean;
}

interface WriteResult {
  view: SenamView;
  bonusNote: string | null;
}

type Tab = 'absensi' | 'bonus';

const rupiah = (value: number) => `Rp${value.toLocaleString('id-ID')}`;

function formatSessionDate(date: string, withYear = false): string {
  return new Intl.DateTimeFormat('id-ID', {
    weekday: withYear ? 'long' : 'short',
    day: 'numeric',
    month: withYear ? 'long' : 'short',
    ...(withYear ? { year: 'numeric' as const } : {}),
    timeZone: 'UTC',
  }).format(new Date(`${date}T00:00:00Z`));
}

function formatTimestamp(value: string | null): string {
  if (!value) return '';
  return new Intl.DateTimeFormat('id-ID', {
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'Asia/Jakarta',
  }).format(new Date(value));
}

function jakartaToday(): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Jakarta',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
}

function matchesSearch(entry: { employeeName: string; nipy?: string; unit?: string }, query: string) {
  const needle = query.trim().toLocaleLowerCase('id-ID');
  if (!needle) return true;
  return [entry.employeeName, entry.nipy || '', entry.unit || '']
    .some((value) => value.toLocaleLowerCase('id-ID').includes(needle));
}

function standingStatus(standing: SenamPagiStanding) {
  if (!standing.recorded) return <StatusDot tone="neutral" className="whitespace-nowrap">Belum dicatat</StatusDot>;
  return standing.met
    ? <StatusDot tone="success" className="whitespace-nowrap">Memenuhi</StatusDot>
    : <StatusDot tone="danger" className="whitespace-nowrap">Tidak memenuhi</StatusDot>;
}

export default function SenamPagiPage() {
  const { profile } = useAuth();
  const searchParams = useSearchParams();
  const month = parseInt(searchParams.get('month') || String(new Date().getMonth() + 1), 10);
  const year = parseInt(searchParams.get('year') || String(new Date().getFullYear()), 10);
  const period = `${year}-${String(month).padStart(2, '0')}`;
  const isPaperOrEarlier = period < BONUS_TRIWULAN_START_PERIOD;

  const [tab, setTab] = useState<Tab>('absensi');
  const [loadedSenam, setSenam] = useState<SenamView | null>(null);
  const [loadedBonus, setBonus] = useState<BonusView | null>(null);
  // What was loaded for another month never shows under this one.
  const senam = loadedSenam?.period === period ? loadedSenam : null;
  const bonus = loadedBonus?.period === period ? loadedBonus : null;
  const [loading, setLoading] = useState(true);
  const [bonusLoading, setBonusLoading] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState<SnackbarMessage | null>(null);
  const [rollCall, setRollCall] = useState<{ date: string | null } | null>(null);
  const [savingNoSessions, setSavingNoSessions] = useState(false);
  const [recalculating, setRecalculating] = useState(false);
  const sequence = useRef(0);
  const bonusSequence = useRef(0);

  const canEdit = canRecordSenamPagi(profile?.role) && Boolean(senam) && !senam?.readOnlyReason;

  const loadSenam = useCallback(async () => {
    const current = ++sequence.current;
    setLoading(true);
    try {
      const view = await authenticatedJson<SenamView>(`/api/payroll/senam-pagi?period=${period}`);
      if (current !== sequence.current) return;
      setSenam(view);
      setError('');
    } catch (cause) {
      if (current !== sequence.current) return;
      setError(cause instanceof Error ? cause.message : 'Data Senam Pagi gagal dimuat.');
    } finally {
      if (current === sequence.current) setLoading(false);
    }
  }, [period]);

  const loadBonus = useCallback(async () => {
    const current = ++bonusSequence.current;
    setBonusLoading(true);
    try {
      const view = await authenticatedJson<BonusView>(`/api/payroll/bonus-triwulan?period=${period}`);
      if (current !== bonusSequence.current) return;
      setBonus(view);
    } catch (cause) {
      if (current !== bonusSequence.current) return;
      setNotice({ type: 'error', text: cause instanceof Error ? cause.message : 'Bonus Triwulan gagal dimuat.' });
    } finally {
      if (current === bonusSequence.current) setBonusLoading(false);
    }
  }, [period]);

  useEffect(() => {
    const timer = window.setTimeout(() => void loadSenam(), 0);
    return () => window.clearTimeout(timer);
  }, [loadSenam]);

  useEffect(() => {
    if (tab !== 'bonus' || bonus) return;
    const timer = window.setTimeout(() => void loadBonus(), 0);
    return () => window.clearTimeout(timer);
  }, [tab, bonus, loadBonus]);

  const write = useCallback(async (body: Record<string, unknown>, success: string) => {
    if (!senam) return false;
    try {
      const result = await authenticatedJson<WriteResult>('/api/payroll/senam-pagi', {
        method: 'POST',
        body: JSON.stringify({
          period,
          requestId: createFinancialRequestId('senam_pagi'),
          expectedRevision: senam.month?.revision ?? 0,
          ...body,
        }),
      });
      setSenam(result.view);
      setBonus(null);
      setNotice(result.bonusNote
        ? { type: 'warning', text: result.bonusNote }
        : { type: 'success', text: success });
      return true;
    } catch (cause) {
      setNotice({ type: 'error', text: cause instanceof Error ? cause.message : 'Senam Pagi gagal disimpan.' });
      return false;
    }
  }, [period, senam]);

  const setNoSessions = async (noSessions: boolean) => {
    setSavingNoSessions(true);
    await write(
      { action: 'set_no_sessions', noSessions },
      noSessions ? 'Bulan ini ditandai tanpa Senam Pagi.' : 'Tanda tanpa Senam Pagi dibatalkan.',
    );
    setSavingNoSessions(false);
  };

  const recalculate = async () => {
    setRecalculating(true);
    try {
      const result = await authenticatedJson<{ view: BonusView }>('/api/payroll/bonus-triwulan', {
        method: 'POST',
        body: JSON.stringify({ period, requestId: createFinancialRequestId('bonus_triwulan') }),
      });
      setBonus(result.view);
      setNotice({ type: 'success', text: 'Bonus Triwulan dihitung ulang dan slip draf diperbarui.' });
    } catch (cause) {
      setNotice({ type: 'error', text: cause instanceof Error ? cause.message : 'Bonus Triwulan gagal dihitung ulang.' });
    } finally {
      setRecalculating(false);
    }
  };

  const sessions = senam?.month?.sessions ?? [];

  return (
    <div className="space-y-6">
      <FloatingSnackbar message={notice} onDismiss={() => setNotice(null)} />

      <div className="flex flex-col-reverse gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div role="tablist" className="grid grid-cols-2 gap-1 rounded-md border border-slate-200/60 bg-white p-1 shadow-sm sm:flex sm:w-fit">
          {([
            { value: 'absensi', label: 'Absensi senam' },
            { value: 'bonus', label: 'Bonus Triwulan' },
          ] as const).map((option) => (
            <button
              key={option.value}
              type="button"
              role="tab"
              aria-selected={tab === option.value}
              onClick={() => setTab(option.value)}
              className={cn(
                'h-11 rounded-sm px-4 text-sm font-medium transition-colors cursor-pointer sm:h-auto sm:py-2',
                tab === option.value
                  ? 'bg-indigo-600 text-white'
                  : 'text-slate-600 hover:bg-slate-50 active:bg-slate-100',
              )}
            >
              {option.label}
            </button>
          ))}
        </div>
        {tab === 'absensi' && canEdit && !senam?.month?.noSessions && (
          <Button variant="accent" size="lg" className="h-11 w-full rounded-sm sm:h-9 sm:w-fit" onClick={() => setRollCall({ date: null })}>
            <CalendarPlus /> Tambah sesi
          </Button>
        )}
      </div>

      {error && <Callout tone="error">{error}</Callout>}

      {tab === 'absensi' ? (
        loading && !senam ? (
          <LoadingLine text="Memuat Senam Pagi..." />
        ) : senam ? (
          <AttendanceSection
            view={senam}
            canEdit={canEdit}
            isPaperOrEarlier={isPaperOrEarlier}
            savingNoSessions={savingNoSessions}
            onOpenSession={(date) => setRollCall({ date })}
            onSetNoSessions={setNoSessions}
          />
        ) : null
      ) : bonusLoading && !bonus ? (
        <LoadingLine text="Menghitung Bonus Triwulan..." />
      ) : bonus ? (
        <BonusSection
          view={bonus}
          recalculating={recalculating}
          canRecalculate={Boolean(profile) && !bonus.periodClosed && !bonus.paper}
          onRecalculate={recalculate}
        />
      ) : null}

      {senam && rollCall && (
        <RollCallDialog
          period={period}
          date={rollCall.date}
          roster={senam.roster}
          sessions={sessions}
          readOnly={!canEdit}
          onClose={() => setRollCall(null)}
          onSave={async (date, presentEmployeeIds) => {
            const saved = await write(
              { action: 'save_session', date, presentEmployeeIds },
              `Sesi ${formatSessionDate(date)} disimpan.`,
            );
            if (saved) setRollCall(null);
          }}
          onDelete={async (date) => {
            const deleted = await write({ action: 'delete_session', date }, `Sesi ${formatSessionDate(date)} dihapus.`);
            if (deleted) setRollCall(null);
          }}
        />
      )}
    </div>
  );
}

function LoadingLine({ text }: { text: string }) {
  return (
    <div className="py-12 flex justify-center items-center text-slate-400 text-sm">
      <Loader2 className="size-4 animate-spin mr-2" /> {text}
    </div>
  );
}

function SearchBox({
  value,
  onChange,
  placeholder,
  className,
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
  className?: string;
}) {
  return (
    <div className={cn('relative', className)}>
      <Search aria-hidden className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-slate-400" />
      <Input
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        aria-label={placeholder}
        autoComplete="off"
        enterKeyHint="search"
        className="h-11 bg-white pl-9 sm:h-9"
      />
    </div>
  );
}

/** A toggle styled as a chip: big enough to hit with a thumb. */
function FilterChip({
  active,
  onClick,
  children,
  className,
}: {
  active: boolean;
  onClick: () => void;
  children: ReactNode;
  className?: string;
}) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={cn(
        'h-11 shrink-0 whitespace-nowrap rounded-md border px-3 text-sm transition-colors cursor-pointer sm:h-9',
        active
          ? 'border-indigo-300 bg-indigo-50 font-medium text-indigo-700'
          : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50 active:bg-slate-100',
        className,
      )}
    >
      {children}
    </button>
  );
}

function AttendanceSection({
  view,
  canEdit,
  isPaperOrEarlier,
  savingNoSessions,
  onOpenSession,
  onSetNoSessions,
}: {
  view: SenamView;
  canEdit: boolean;
  isPaperOrEarlier: boolean;
  savingNoSessions: boolean;
  onOpenSession: (date: string) => void;
  onSetNoSessions: (noSessions: boolean) => void;
}) {
  const [query, setQuery] = useState('');
  const [onlyProblems, setOnlyProblems] = useState(false);
  const sessions = view.month?.sessions ?? [];
  const isPaper = view.month?.source === 'paper';
  const rosterSize = view.roster.length;
  const notMet = view.roster.filter((entry) => entry.standing.recorded && !entry.standing.met).length;
  const rows = view.roster.filter((entry) =>
    matchesSearch(entry, query) && (!onlyProblems || (entry.standing.recorded && !entry.standing.met)),
  );
  // Phones get two columns (name, status); from sm up the misses get their own.
  const columns = isPaper
    ? 'sm:grid-cols-[minmax(0,1fr)_11rem]'
    : 'sm:grid-cols-[minmax(0,1fr)_7rem_11rem]';
  const markButtonClass =
    'h-auto min-h-11 w-full whitespace-normal py-2 text-center sm:h-8 sm:min-h-0 sm:w-auto sm:whitespace-nowrap sm:py-0';

  return (
    <div className="bg-white rounded-md border border-slate-200 p-4 sm:p-6 space-y-6">
      {view.readOnlyReason && <Callout tone="info">{view.readOnlyReason}</Callout>}

      {!isPaper && !isPaperOrEarlier && (
        <section className="space-y-3">
          <h2 className="text-base font-semibold text-slate-900">Sesi Bulan Ini</h2>
          {view.month?.noSessions ? (
            <div className="flex flex-col gap-3 text-sm text-slate-700 sm:flex-row sm:items-center">
              <StatusDot tone="neutral">Tidak ada Senam Pagi bulan ini</StatusDot>
              {canEdit && (
                <Button
                  variant="outline"
                  className={markButtonClass}
                  disabled={savingNoSessions}
                  onClick={() => onSetNoSessions(false)}
                >
                  Batalkan tanda
                </Button>
              )}
            </div>
          ) : sessions.length === 0 ? (
            <div className="flex flex-col gap-3 text-sm text-slate-500 sm:flex-row sm:items-center">
              <span>Belum ada sesi yang dicatat.</span>
              {canEdit && (
                <Button
                  variant="outline"
                  className={markButtonClass}
                  disabled={savingNoSessions}
                  onClick={() => onSetNoSessions(true)}
                >
                  {savingNoSessions ? <Loader2 className="animate-spin" /> : null}
                  Tandai tidak ada Senam Pagi bulan ini
                </Button>
              )}
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-2 sm:flex sm:flex-wrap">
              {sessions.map((session) => (
                <button
                  key={session.date}
                  type="button"
                  onClick={() => onOpenSession(session.date)}
                  className="min-h-14 rounded-md border border-slate-200 px-3 py-2 text-left transition-colors cursor-pointer hover:border-indigo-300 hover:bg-indigo-50/40 active:bg-indigo-50"
                >
                  <span className="block text-sm font-medium text-slate-800">{formatSessionDate(session.date)}</span>
                  <span className="block text-xs text-slate-500 tabular-nums">
                    {session.presentEmployeeIds.length} dari {rosterSize} hadir
                  </span>
                </button>
              ))}
            </div>
          )}
        </section>
      )}

      <section className="space-y-3">
        <h2 className="text-base font-semibold text-slate-900">Rekap Pegawai</h2>
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          {notMet > 0 ? (
            <FilterChip
              active={onlyProblems}
              onClick={() => setOnlyProblems((current) => !current)}
              className="order-2 sm:order-1"
            >
              Tidak memenuhi ({notMet})
            </FilterChip>
          ) : (
            <span className="hidden sm:order-1 sm:block" />
          )}
          <SearchBox
            className="order-1 sm:order-2 sm:w-64"
            value={query}
            onChange={setQuery}
            placeholder="Cari nama, NIPY atau unit"
          />
        </div>

        {rows.length === 0 ? (
          <p className="py-8 text-center text-sm text-slate-400">
            {rosterSize === 0 ? 'Belum ada Loyalis aktif.' : 'Tidak ada pegawai yang cocok.'}
          </p>
        ) : (
          <div>
            <div className={cn('hidden gap-4 border-b border-slate-200 py-2 text-xs font-medium text-slate-500 sm:grid', columns)}>
              <span>Pegawai</span>
              {!isPaper && <span>Tidak hadir</span>}
              <span>Status</span>
            </div>
            <ul className="divide-y divide-slate-100">
              {rows.map((entry) => (
                <li
                  key={entry.employeeId}
                  className={cn('grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 py-3 sm:py-2.5', columns)}
                >
                  <div className="min-w-0">
                    <span className="block text-sm text-slate-800">{entry.employeeName}</span>
                  </div>
                  {!isPaper && (
                    <span className="hidden text-sm tabular-nums text-slate-700 sm:block">
                      {entry.standing.sessionCount > 0 ? `${entry.standing.misses} dari ${entry.standing.sessionCount}` : '–'}
                    </span>
                  )}
                  <div className="flex flex-col items-end gap-0.5 sm:items-start">
                    {standingStatus(entry.standing)}
                    {!isPaper && entry.standing.sessionCount > 0 && (
                      <span className="text-xs tabular-nums text-slate-500 sm:hidden">
                        tidak hadir {entry.standing.misses} dari {entry.standing.sessionCount}
                      </span>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          </div>
        )}
      </section>
    </div>
  );
}

/** One employee in the roll call: the whole row is the tap target. */
function RollCallRow({
  entry,
  checked,
  disabled,
  onToggle,
}: {
  entry: RosterEntry;
  checked: boolean;
  disabled: boolean;
  onToggle: (employeeId: string, checked: boolean) => void;
}) {
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={checked}
      disabled={disabled}
      onClick={() => onToggle(entry.employeeId, !checked)}
      className={cn(
        'flex min-h-14 w-full items-center gap-3 px-1 py-2.5 text-left transition-colors cursor-pointer disabled:cursor-default',
        checked ? 'bg-indigo-50/40' : 'hover:bg-slate-50 active:bg-slate-100',
      )}
    >
      <span
        aria-hidden
        className={cn(
          'flex size-6 shrink-0 items-center justify-center rounded-md border transition-colors',
          checked ? 'border-indigo-600 bg-indigo-600 text-white' : 'border-slate-300 bg-white',
        )}
      >
        {checked ? <Check className="size-4" /> : null}
      </span>
      <span className="min-w-0 flex-1 text-sm text-slate-800">{entry.employeeName}</span>
    </button>
  );
}

/**
 * The roll call. A full-screen sheet on phones (the list is long and the
 * keyboard takes half the screen), a centred dialog from sm up. The count and
 * the save buttons stay pinned at the bottom while the list scrolls.
 */
function RollCallDialog({
  period,
  date: initialDate,
  roster,
  sessions,
  readOnly,
  onClose,
  onSave,
  onDelete,
}: {
  period: string;
  date: string | null;
  roster: RosterEntry[];
  sessions: Array<{ date: string; presentEmployeeIds: string[] }>;
  readOnly: boolean;
  onClose: () => void;
  onSave: (date: string, presentEmployeeIds: string[]) => Promise<void>;
  onDelete: (date: string) => Promise<void>;
}) {
  const existing = initialDate ? sessions.find((session) => session.date === initialDate) : undefined;
  const isNew = !existing;
  const firstDay = `${period}-01`;
  const lastDay = `${period}-${String(new Date(Number(period.slice(0, 4)), Number(period.slice(5, 7)), 0).getDate()).padStart(2, '0')}`;
  const today = jakartaToday();
  const maxDay = today < lastDay ? today : lastDay;
  const [date, setDate] = useState(initialDate ?? (maxDay >= firstDay ? maxDay : firstDay));
  // Someone who left since the session was saved is no longer on the roster
  // and would make the save fail, so they are dropped here.
  const [present, setPresent] = useState<Set<string>>(() => {
    const rosterIds = new Set(roster.map((entry) => entry.employeeId));
    return new Set((existing?.presentEmployeeIds ?? []).filter((employeeId) => rosterIds.has(employeeId)));
  });
  const [query, setQuery] = useState('');
  const [absentOnly, setAbsentOnly] = useState(false);
  const [saving, setSaving] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const absentCount = roster.length - present.size;
  const duplicate = isNew && sessions.some((session) => session.date === date);
  const dateInvalid = !date || date < firstDay || date > maxDay;
  const visible = useMemo(
    () => roster.filter((entry) =>
      matchesSearch(entry, query) && (!absentOnly || !present.has(entry.employeeId)),
    ),
    [roster, query, absentOnly, present],
  );

  const toggle = (employeeId: string, checked: boolean) => {
    if (readOnly) return;
    setPresent((current) => {
      const next = new Set(current);
      if (checked) next.add(employeeId);
      else next.delete(employeeId);
      return next;
    });
  };

  const save = async () => {
    setSaving(true);
    await onSave(date, [...present]);
    setSaving(false);
  };

  return (
    <>
      <Dialog open onOpenChange={(open) => { if (!open && !saving) onClose(); }}>
        <DialogContent
          showCloseButton={false}
          className="gap-3 overflow-hidden rounded-md grid-rows-[auto_auto_minmax(0,1fr)_auto] max-sm:top-0 max-sm:left-0 max-sm:h-dvh max-sm:max-h-none max-sm:w-full max-sm:max-w-none max-sm:translate-x-0 max-sm:translate-y-0 max-sm:rounded-none sm:max-h-[90vh] sm:max-w-xl"
        >
          <DialogHeader className="flex-row items-center justify-between gap-2">
            <DialogTitle className="text-base font-semibold text-slate-900">
              {isNew ? 'Sesi Senam Pagi Baru' : `Senam Pagi ${formatSessionDate(existing.date, true)}`}
            </DialogTitle>
            <Button
              type="button"
              variant="ghost"
              aria-label="Tutup"
              disabled={saving}
              onClick={onClose}
              className="-mr-2 size-11 shrink-0 text-slate-500 sm:mr-0 sm:size-8"
            >
              <X />
            </Button>
          </DialogHeader>

          <div className="space-y-3">
            {isNew && (
              <div className="space-y-1">
                <div className="flex items-center gap-3">
                  <label htmlFor="senam-date" className="shrink-0 text-sm font-medium text-slate-700">Tanggal</label>
                  <Input
                    id="senam-date"
                    type="date"
                    value={date}
                    min={firstDay}
                    max={maxDay}
                    onChange={(event) => setDate(event.target.value)}
                    className="h-11 min-w-0 flex-1 bg-white sm:h-9 sm:w-48 sm:flex-none"
                  />
                </div>
                {duplicate && (
                  <p className="text-xs text-amber-700">Tanggal ini sudah punya sesi; menyimpan akan mengganti daftar hadirnya.</p>
                )}
              </div>
            )}
            <div className="flex gap-2">
              <SearchBox className="min-w-0 flex-1" value={query} onChange={setQuery} placeholder="Cari pegawai" />
              <FilterChip active={absentOnly} onClick={() => setAbsentOnly((current) => !current)}>
                Tidak hadir <span className="tabular-nums">{absentCount}</span>
              </FilterChip>
            </div>
            {!readOnly && (
              <div className="grid grid-cols-2 gap-2">
                <Button
                  type="button"
                  variant="outline"
                  className="h-10 rounded-sm"
                  onClick={() => setPresent(new Set(roster.map((entry) => entry.employeeId)))}
                >
                  Tandai semua hadir
                </Button>
                <Button type="button" variant="outline" className="h-10 rounded-sm" onClick={() => setPresent(new Set())}>
                  Kosongkan
                </Button>
              </div>
            )}
          </div>

          <div className="-mx-4 min-h-0 divide-y divide-slate-100 overflow-y-auto overscroll-contain border-y border-slate-100 px-4">
            {visible.map((entry) => (
              <RollCallRow
                key={entry.employeeId}
                entry={entry}
                checked={present.has(entry.employeeId)}
                disabled={readOnly}
                onToggle={toggle}
              />
            ))}
            {visible.length === 0 && (
              <p className="py-8 text-center text-sm text-slate-400">
                {absentOnly && !query ? 'Semua pegawai hadir.' : 'Tidak ada pegawai yang cocok.'}
              </p>
            )}
          </div>

          <DialogFooter className="flex-col gap-3 rounded-b-md max-sm:rounded-none max-sm:pb-[calc(1rem+env(safe-area-inset-bottom))] sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-center justify-between gap-3 sm:justify-start sm:gap-4">
              <p className="text-sm font-medium tabular-nums text-slate-700">
                {present.size} dari {roster.length} hadir
              </p>
              {!readOnly && !isNew && (
                <Button
                  type="button"
                  variant="danger-ghost"
                  className="h-9"
                  disabled={saving}
                  onClick={() => setConfirmDelete(true)}
                >
                  Hapus sesi
                </Button>
              )}
            </div>
            <div className={cn('grid gap-2 sm:flex', readOnly ? 'grid-cols-1' : 'grid-cols-[1fr_2fr]')}>
              <Button
                type="button"
                variant="outline"
                className="h-12 rounded-sm sm:h-9"
                disabled={saving}
                onClick={onClose}
              >
                {readOnly ? 'Tutup' : 'Batal'}
              </Button>
              {!readOnly && (
                <Button
                  type="button"
                  variant="accent"
                  className="h-12 rounded-sm sm:h-9"
                  disabled={saving || dateInvalid}
                  onClick={() => void save()}
                >
                  {saving ? <Loader2 className="animate-spin" /> : null}
                  {dateInvalid ? 'Tanggal di luar bulan ini' : 'Simpan'}
                </Button>
              )}
            </div>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {existing && (
        <ConfirmDialog
          open={confirmDelete}
          onOpenChange={setConfirmDelete}
          title="Hapus sesi ini?"
          description={`Daftar hadir Senam Pagi ${formatSessionDate(existing.date, true)} dihapus dan Bonus Triwulan dihitung ulang tanpa sesi ini.`}
          confirmLabel="Hapus sesi"
          destructive
          loading={deleting}
          onConfirm={async () => {
            setDeleting(true);
            await onDelete(existing.date);
            setDeleting(false);
            setConfirmDelete(false);
          }}
        />
      )}
    </>
  );
}

function MonthCell({ standing, inline = false }: { standing: BonusTriwulanMonthStanding; inline?: boolean }) {
  const strataText = standing.stratum === null ? 'Tanpa presensi' : `Strata ${standing.stratum}`;
  const senamText = !standing.senam.recorded
    ? 'senam belum dicatat'
    : standing.senam.sessionCount > 0
      ? `absen senam ${standing.senam.misses}×`
      : standing.senam.met ? 'senam memenuhi' : 'senam tidak memenuhi';
  return (
    <StatusDot tone={standing.qualifies ? 'success' : standing.senam.recorded && standing.stratum !== null ? 'danger' : 'neutral'}>
      {inline ? (
        <span className="text-sm">
          {strataText}
          <span className="text-slate-500"> · {senamText}</span>
        </span>
      ) : (
        <span className="text-sm">
          {strataText}
          <span className="block text-xs text-slate-500">{senamText}</span>
        </span>
      )}
    </StatusDot>
  );
}

/** One month of a row: the cell, or a note when that month already paid a bonus. */
function monthContent(row: BonusTriwulanRow, month: BonusTriwulanMonthStanding, inline = false) {
  return row.paidIn && month.period <= row.paidIn ? (
    <span className="text-xs text-slate-500">Terpakai untuk bonus {periodMonthName(row.paidIn)}</span>
  ) : (
    <MonthCell standing={month} inline={inline} />
  );
}

function BonusSection({
  view,
  recalculating,
  canRecalculate,
  onRecalculate,
}: {
  view: BonusView;
  recalculating: boolean;
  canRecalculate: boolean;
  onRecalculate: () => void;
}) {
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<'awarded' | 'all'>('awarded');

  if (view.paper || !view.evaluation) {
    const recipients = (view.stored?.recipients ?? []).filter((entry) => matchesSearch(entry, query));
    return (
      <div className="bg-white rounded-md border border-slate-200 p-4 sm:p-6 space-y-4">
        <Callout tone="info">
          {view.stored
            ? 'Penerima bulan ini diambil dari arsip kertas.'
            : `Bonus Triwulan dihitung otomatis mulai ${periodLabel(BONUS_TRIWULAN_START_PERIOD)}.`}
        </Callout>
        {view.stored && (
          <ul className="divide-y divide-slate-100">
            {recipients.map((entry) => (
              <li key={entry.employeeId} className="py-3 text-sm text-slate-800 sm:py-2">{entry.employeeName}</li>
            ))}
            {recipients.length === 0 && <li className="py-6 text-center text-sm text-slate-400">Tidak ada penerima.</li>}
          </ul>
        )}
      </div>
    );
  }

  const evaluation = view.evaluation;
  const awardedCount = evaluation.recipients.length;
  const rows = evaluation.rows.filter((row) =>
    (filter === 'all' || row.awarded) && matchesSearch(row, query),
  );
  const monthPeriods = evaluation.rows[0]?.months.map((month) => month.period) ?? [];
  const recalculateButton = (className: string) => (
    <Button variant="accent" size="sm" className={className} disabled={recalculating} onClick={onRecalculate}>
      {recalculating ? <Loader2 className="animate-spin" /> : null}
      Hitung ulang
    </Button>
  );

  return (
    <div className="bg-white rounded-md border border-slate-200 p-4 sm:p-6 space-y-5">
      {evaluation.missing.length > 0 && (
        <Callout tone="warning">
          <span className="font-medium">Belum bisa diputuskan.</span>{' '}
          {evaluation.missing.join(' ')}
        </Callout>
      )}
      {view.stale && !view.periodClosed && (
        <Callout
          tone="warning"
          action={canRecalculate ? recalculateButton('rounded-sm max-sm:hidden') : null}
        >
          Penerima di slip belum sesuai data terbaru.
          {canRecalculate && recalculateButton('mt-2 h-11 w-full rounded-sm sm:hidden')}
        </Callout>
      )}

      <div className="flex flex-col gap-1">
        <p className="text-sm text-slate-800">
          <span className="font-semibold tabular-nums">{awardedCount}</span> pegawai mendapat Bonus Triwulan
          {awardedCount > 0 && <> · <span className="tabular-nums">{rupiah(awardedCount * view.amount)}</span></>}
        </p>
        {view.stored?.evaluatedAt && (
          <p className="text-xs text-slate-500">
            Terakhir dihitung {formatTimestamp(view.stored.evaluatedAt)}
            {view.stored.evaluatedByName ? ` oleh ${view.stored.evaluatedByName}` : ''}
          </p>
        )}
      </div>

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="grid grid-cols-2 gap-1 rounded-md border border-slate-200/60 bg-slate-50 p-1 sm:flex sm:w-fit">
          {([
            { value: 'awarded', label: `Dapat ${awardedCount}` },
            { value: 'all', label: `Semua ${evaluation.rows.length}` },
          ] as const).map((option) => (
            <button
              key={option.value}
              type="button"
              aria-pressed={filter === option.value}
              onClick={() => setFilter(option.value)}
              className={cn(
                'h-10 rounded-sm px-3 text-sm transition-colors cursor-pointer sm:h-auto sm:py-1.5',
                filter === option.value
                  ? 'bg-white font-medium text-slate-900 shadow-sm'
                  : 'text-slate-500 hover:text-slate-800 active:bg-slate-100',
              )}
            >
              {option.label}
            </button>
          ))}
        </div>
        <SearchBox className="sm:w-64" value={query} onChange={setQuery} placeholder="Cari nama" />
      </div>

      {rows.length === 0 ? (
        <p className="py-8 text-center text-sm text-slate-400">
          {filter === 'awarded' && !query ? 'Belum ada penerima bulan ini.' : 'Tidak ada pegawai yang cocok.'}
        </p>
      ) : (
        <>
          {/* Phones: one card per person, months stacked, so nothing scrolls sideways. */}
          <ul className="divide-y divide-slate-100 sm:hidden">
            {rows.map((row) => (
              <li key={row.employeeId} className="space-y-2 py-3">
                <div className="flex items-start justify-between gap-3">
                  <span className="min-w-0 text-sm font-medium text-slate-900">{row.employeeName}</span>
                  {row.awarded && (
                    <StatusDot tone="success" className="shrink-0 whitespace-nowrap">
                      Dapat {rupiah(view.amount)}
                    </StatusDot>
                  )}
                </div>
                {!row.awarded && <p className="text-xs text-slate-500">{row.reason}</p>}
                <dl className="space-y-1.5 rounded-md bg-slate-50 px-3 py-2">
                  {row.months.map((month) => (
                    <div key={month.period} className="flex items-start gap-3">
                      <dt className="w-16 shrink-0 text-xs leading-5 text-slate-500">{periodMonthName(month.period)}</dt>
                      <dd className="min-w-0">{monthContent(row, month, true)}</dd>
                    </div>
                  ))}
                </dl>
              </li>
            ))}
          </ul>

          <div className="hidden overflow-x-auto sm:block">
            <table className="w-full min-w-[720px] text-sm">
              <thead>
                <tr className="border-b border-slate-200 text-left text-xs text-slate-500">
                  <th className="py-2 pr-4 font-medium">Pegawai</th>
                  {monthPeriods.map((month) => (
                    <th key={month} className="py-2 pr-4 font-medium">{periodMonthName(month)}</th>
                  ))}
                  <th className="py-2 font-medium">Hasil</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.employeeId} className="border-b border-slate-100 last:border-0 align-top">
                    <td className="py-2.5 pr-4 text-slate-800">{row.employeeName}</td>
                    {row.months.map((month) => (
                      <td key={month.period} className="py-2.5 pr-4">{monthContent(row, month)}</td>
                    ))}
                    <td className="py-2.5">
                      {row.awarded ? (
                        <StatusDot tone="success">Dapat {rupiah(view.amount)}</StatusDot>
                      ) : (
                        <span className="text-sm text-slate-500">{row.reason}</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}
