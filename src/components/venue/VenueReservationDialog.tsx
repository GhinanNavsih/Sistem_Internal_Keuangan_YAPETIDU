"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  ArrowLeft,
  ArrowRight,
  CheckCircle2,
  Loader2,
  Minus,
  Package,
  Plus,
  Timer,
} from 'lucide-react';
import OptionPicker, { type PickerOption } from '@/components/venue/OptionPicker';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { ApiError, authenticatedJson } from '@/lib/payroll/client';
import { cn } from '@/lib/utils';
import {
  addDays,
  bookingInBuilding,
  describeShortages,
  equipmentAvailability,
  findEquipmentShortages,
  findRoom,
  findRoomConflicts,
  formatFacility,
  formatJam,
  globalEquipmentFor,
  isValidDateString,
  jamRange,
  MAX_KEGIATAN_LENGTH,
  MAX_PEMOHON_LENGTH,
  occupiesRoom,
  parseClock,
  RESERVATION_HORIZON_DAYS,
  slotsOverlap,
  type ReservationView,
  type ScheduleEntry,
  type SimpelBuilding,
  type SimpelEquipment,
  type VenuePhotos,
} from '@/lib/venueReservation';
import {
  clampQuantity,
  completeTime,
  defaultReservationDate,
  durationLabel,
  firstInvalidStep,
  formatPhoneInput,
  formatReservationDate,
  isBlankDraft,
  maskTimeInput,
  parseSavedDraft,
  progressPercent,
  RESERVATION_STEPS,
  serializeDraft,
  soleBookableRoom,
  stepIndex,
  stepperIncrement,
  validateStep,
  type ReservationDraft,
  type ReservationField,
  type ReservationStepId,
  type SavedDraft,
  type StepContext,
} from '@/lib/venueReservationForm';

interface CatalogResponse {
  buildings: SimpelBuilding[];
  equipment: SimpelEquipment[];
  date: string | null;
  schedule: ScheduleEntry[];
  today: string;
  nowMinutes: number;
}

const SCHEDULE_STATUS_LABELS: Record<string, string> = {
  disetujui: 'Terjadwal',
  menunggu_bak: 'Menunggu BAK',
  menunggu_biro_umum: 'Menunggu Biro Umum',
  menunggu_konfirmasi_mhs: 'Menunggu Konfirmasi',
  direvisi_mhs: 'Direvisi',
};

// The field look of the employee "Lapor Kegiatan Baru" dialog: tall boxes, bold sentence-case labels.
const FIELD_LABEL = 'text-base font-bold text-slate-600';
const SUBLABEL = 'text-sm font-bold text-slate-600';
const INPUT_CLASS =
  'h-12 rounded-xl border-slate-200 text-base focus:border-indigo-400 focus:ring-indigo-400/20';

interface EquipmentOption {
  name: string;
  total: number;
  group: 'building' | 'global';
}

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Whose form this is: progress is remembered per user, in this browser only. */
  uid: string;
  defaultPemohon: string;
  onCreated: (reservation: ReservationView) => void;
  /** Start over with an empty form (the parent re-mounts the dialog). */
  onRestart: () => void;
  /** Pre-fetched photos if parent component already loaded them. */
  initialPhotos?: VenuePhotos | null;
}

// ─── Remembering a half-filled form ─────────────────────────────────────────

const DRAFT_STORAGE_PREFIX = 'saku:venue-draft:';

function readDraft(uid: string): SavedDraft | null {
  if (typeof window === 'undefined' || !uid) return null;
  try {
    return parseSavedDraft(window.localStorage.getItem(`${DRAFT_STORAGE_PREFIX}${uid}`));
  } catch {
    return null;
  }
}

/** A blank form is not kept; passing null forgets the draft. */
function writeDraft(uid: string, draft: SavedDraft | null): void {
  if (typeof window === 'undefined' || !uid) return;
  try {
    const key = `${DRAFT_STORAGE_PREFIX}${uid}`;
    if (draft && !isBlankDraft(draft)) window.localStorage.setItem(key, serializeDraft(draft));
    else window.localStorage.removeItem(key);
  } catch {
    // Storage can be blocked (private window); the form works the same without it.
  }
}

/** What the server offers as a starting point (see `@/lib/venueReservationContact`). */
interface ContactResponse {
  phone: string | null;
  pemohon: string | null;
}

// ─── Small building blocks ──────────────────────────────────────────────────

function sameName(a: string, b: string): boolean {
  return a.toLowerCase().trim() === b.toLowerCase().trim();
}

/** A label above its input, a hint underneath, and a green tick once it is right. */
function Field({
  id,
  label,
  hint,
  error,
  valid,
  children,
}: {
  id: string;
  label: string;
  hint?: string;
  error?: string;
  valid: boolean;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between gap-2">
        <Label htmlFor={id} className={FIELD_LABEL}>
          {label}
        </Label>
        {valid && !error && <CheckCircle2 className="h-4 w-4 text-emerald-500" aria-hidden="true" />}
      </div>
      {children}
      {error ? (
        <p id={`${id}-message`} role="alert" className="text-[11px] font-medium text-rose-600">
          {error}
        </p>
      ) : hint ? (
        <p id={`${id}-message`} className="text-[11px] leading-relaxed text-slate-400">
          {hint}
        </p>
      ) : null}
    </div>
  );
}

/** A label for a group of choices (they are not one input), with a tick once one is chosen. */
function GroupLabel({ id, children, done }: { id: string; children: React.ReactNode; done: boolean }) {
  return (
    <div className="flex items-center justify-between gap-2">
      <p id={id} className={FIELD_LABEL}>
        {children}
      </p>
      {done && <CheckCircle2 className="h-4 w-4 text-emerald-500" aria-hidden="true" />}
    </div>
  );
}

function InlineError({ id, children }: { id?: string; children: React.ReactNode }) {
  return (
    <p id={id} role="alert" className="text-[11px] font-medium text-rose-600">
      {children}
    </p>
  );
}

/** Tap for small stocks; the number stays typeable for large ones (300 chairs). */
function EquipmentRow({
  name,
  note,
  max,
  unavailable,
  value,
  onChange,
}: {
  name: string;
  note: string;
  max: number;
  unavailable: boolean;
  value: number;
  onChange: (value: number) => void;
}) {
  const [adding, setAdding] = useState(false);
  const showStepper = value > 0 || adding;
  const increment = stepperIncrement(max);

  return (
    <li className="flex items-center justify-between gap-3 px-3.5 py-2.5">
      <span className="min-w-0">
        <span className={cn('block truncate text-sm font-semibold', unavailable && !showStepper ? 'text-slate-400' : 'text-slate-800')}>
          {name}
        </span>
        <span className="block text-[11px] text-slate-400">{note}</span>
      </span>

      {showStepper ? (
        <div
          role="group"
          aria-label={`Jumlah ${name}`}
          className="flex shrink-0 items-center gap-1.5"
          onBlur={(event) => {
            if (value === 0 && !event.currentTarget.contains(event.relatedTarget as Node | null)) setAdding(false);
          }}
        >
          <Button
            type="button"
            variant="outline"
            size="icon"
            aria-label={`Kurangi ${increment}`}
            disabled={value <= 0}
            onClick={() => onChange(Math.max(0, value - increment))}
            className="h-9 w-9 rounded-full"
          >
            <Minus />
          </Button>
          <Input
            type="text"
            inputMode="numeric"
            pattern="[0-9]*"
            aria-label={`Jumlah ${name}`}
            placeholder="0"
            value={value === 0 ? '' : String(value)}
            onChange={(event) => onChange(clampQuantity(Number(event.target.value.replace(/\D/g, '')), max))}
            className="h-9 w-14 rounded-lg px-1 text-center text-sm font-bold tabular-nums"
          />
          <Button
            type="button"
            variant="outline"
            size="icon"
            aria-label={`Tambah ${increment}`}
            autoFocus={adding}
            disabled={value >= max}
            onClick={() => onChange(Math.min(max, value + increment))}
            className="h-9 w-9 rounded-full"
          >
            <Plus />
          </Button>
        </div>
      ) : unavailable ? (
        <span className="shrink-0 text-[11px] font-semibold text-slate-400">Tidak tersedia</span>
      ) : (
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => {
            setAdding(true);
            onChange(1);
          }}
          className="shrink-0 rounded-full"
        >
          <Plus /> Tambah
        </Button>
      )}
    </li>
  );
}

// ─── The form ───────────────────────────────────────────────────────────────

/**
 * The reservation form, as three short steps (see `combating_form_fatigue_guide.md`
 * and `@/lib/venueReservationForm`). Room clashes and remaining equipment are
 * computed here with the same rules the server applies (`@/lib/venueReservation`),
 * so the form blocks what the server would refuse. The server still re-checks
 * inside a transaction, since someone else may book in the meantime.
 */
export default function VenueReservationDialog({
  open,
  onOpenChange,
  uid,
  defaultPemohon,
  onCreated,
  onRestart,
  initialPhotos,
}: Props) {
  const [catalog, setCatalog] = useState<CatalogResponse | null>(null);
  const [catalogLoading, setCatalogLoading] = useState(true);
  const [catalogError, setCatalogError] = useState<string | null>(null);
  // Cover photos of the buildings and rooms, fetched once; a nicety, so a failure just leaves placeholders.
  const [photos, setPhotos] = useState<VenuePhotos | null>(initialPhotos ?? null);
  const [photosLoading, setPhotosLoading] = useState(!initialPhotos);
  const latestRequest = useRef(0);
  const bodyRef = useRef<HTMLDivElement>(null);
  const roomsRef = useRef<HTMLDivElement>(null);
  const jamSelesaiInputRef = useRef<HTMLInputElement>(null);
  // Set when a gedung with rooms is picked: the view then moves down to those rooms.
  const scrollToRooms = useRef(false);

  const focusWaktuSelesai = useCallback(() => {
    requestAnimationFrame(() => {
      jamSelesaiInputRef.current?.focus();
      jamSelesaiInputRef.current?.select();
    });
  }, []);

  // A form closed half-way is picked up again where it was left.
  const [restored] = useState(() => readDraft(uid));
  const submitted = useRef(false);
  const [step, setStep] = useState(restored?.step ?? 0);
  // Errors stay quiet until a field has been left, or "Lanjut" was tapped on its step.
  const [touched, setTouched] = useState<Partial<Record<ReservationField, boolean>>>({});
  const [attempted, setAttempted] = useState<Partial<Record<ReservationStepId, boolean>>>({});

  const [kegiatan, setKegiatan] = useState(restored?.kegiatan ?? '');
  // null until the user picks a date themselves; until then the date is tomorrow.
  const [waktuInput, setWaktuInput] = useState<string | null>(restored?.waktuInput ?? null);
  const [jamMulai, setJamMulai] = useState(restored?.jamMulai ?? '');
  const [jamSelesai, setJamSelesai] = useState(restored?.jamSelesai ?? '');
  const [gedungId, setGedungId] = useState(restored?.gedungId ?? '');
  const [ruangan, setRuangan] = useState(restored?.ruangan ?? '');
  const [quantities, setQuantities] = useState<Record<string, number>>(restored?.quantities ?? {});
  const [pemohon, setPemohon] = useState(defaultPemohon);
  const [editPemohon, setEditPemohon] = useState(false);
  const [kontak, setKontak] = useState('');
  // The number the server offered: shown as a row while the field still holds it,
  // and as an input once the user types their own.
  const [prefill, setPrefill] = useState<string | null>(null);
  const [editKontak, setEditKontak] = useState(false);

  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [submitConflict, setSubmitConflict] = useState(false);

  const loadCatalog = useCallback(async (date: string) => {
    const requestId = ++latestRequest.current;
    setCatalogLoading(true);
    setCatalogError(null);
    try {
      const query = date ? `?date=${encodeURIComponent(date)}` : '';
      const result = await authenticatedJson<CatalogResponse>(`/api/venue-reservations/catalog${query}`);
      if (requestId === latestRequest.current) setCatalog(result);
    } catch (error) {
      if (requestId === latestRequest.current) {
        setCatalogError(error instanceof Error ? error.message : 'Gagal memuat data SIMPEL.');
      }
    } finally {
      if (requestId === latestRequest.current) setCatalogLoading(false);
    }
  }, []);

  const today = catalog?.today ?? '';
  const waktu = waktuInput ?? defaultReservationDate(today);

  // Stock and the room schedule depend on the date, so reload whenever it changes.
  useEffect(() => {
    if (!open) return;
    const timer = window.setTimeout(() => void loadCatalog(isValidDateString(waktu) ? waktu : ''), 0);
    return () => window.clearTimeout(timer);
  }, [open, waktu, loadCatalog]);

  // The WhatsApp number (and unit name) to start from. It is a convenience: if it
  // fails or arrives late, the form works the same, and it never overwrites what
  // the user has already typed.
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    const timer = window.setTimeout(() => {
      authenticatedJson<ContactResponse>('/api/venue-reservations/contact')
        .then((contact) => {
          if (cancelled) return;
          if (contact.phone) {
            const phone = formatPhoneInput(contact.phone);
            setKontak((current) => current || phone);
            setPrefill(phone);
          }
          const savedPemohon = contact.pemohon;
          if (savedPemohon) setPemohon((current) => (current === defaultPemohon ? savedPemohon : current));
        })
        .catch(() => undefined);
    }, 0);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [open, defaultPemohon]);

  useEffect(() => {
    if (initialPhotos) {
      setPhotos(initialPhotos);
      setPhotosLoading(false);
    }
  }, [initialPhotos]);

  useEffect(() => {
    if (!open || photos) return;
    const timer = window.setTimeout(() => {
      authenticatedJson<VenuePhotos>('/api/venue-reservations/photos')
        .then(setPhotos)
        .catch(() => undefined)
        .finally(() => setPhotosLoading(false));
    }, 0);
    return () => window.clearTimeout(timer);
  }, [open, photos]);

  // Save the progress a moment after each change, so closing the form loses nothing.
  useEffect(() => {
    const timer = window.setTimeout(() => {
      if (submitted.current) return;
      writeDraft(uid, { step, kegiatan, waktuInput, jamMulai, jamSelesai, gedungId, ruangan, quantities });
    }, 400);
    return () => window.clearTimeout(timer);
  }, [uid, step, kegiatan, waktuInput, jamMulai, jamSelesai, gedungId, ruangan, quantities]);

  // Every step starts at the top.
  useEffect(() => {
    bodyRef.current?.scrollTo({ top: 0 });
  }, [step]);

  // The rooms sit below the building photos, so bring them into view once a gedung is picked.
  // Someone choosing with the arrow keys is left where they are: Tab takes them to the rooms.
  useEffect(() => {
    if (!scrollToRooms.current) return;
    scrollToRooms.current = false;
    const active = document.activeElement;
    if (active instanceof HTMLElement && active.matches(':focus-visible')) return;
    const smooth = !window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    roomsRef.current?.scrollIntoView({ block: 'start', behavior: smooth ? 'smooth' : 'auto' });
  }, [gedungId]);

  const buildings = useMemo(() => catalog?.buildings ?? [], [catalog]);
  const equipment = useMemo(() => catalog?.equipment ?? [], [catalog]);
  const scheduleReady = !!catalog && isValidDateString(waktu) && catalog.date === waktu;
  const schedule = useMemo(() => (scheduleReady && catalog ? catalog.schedule : []), [catalog, scheduleReady]);

  // One building, or one bookable room, is picked for the user (a decision saved).
  const effectiveGedungId = gedungId || (buildings.length === 1 ? buildings[0].id : '');
  const building = buildings.find((candidate) => candidate.id === effectiveGedungId);
  const effectiveRuangan = ruangan || soleBookableRoom(building)?.nama || '';
  const room = findRoom(building, effectiveRuangan);

  const startMinutes = parseClock(jamMulai);
  const endMinutes = parseClock(jamSelesai);
  const timeValid = startMinutes !== null && endMinutes !== null && endMinutes > startMinutes;
  const jam = timeValid ? formatJam(jamMulai, jamSelesai) : '';
  const duration = durationLabel(jamMulai, jamSelesai);
  const roomInMaintenance = room?.status.toLowerCase() === 'maintenance';

  const roomSchedule = useMemo(() => {
    if (!building || !room) return [];
    return schedule
      .filter((entry) => occupiesRoom(entry) && sameName(entry.ruangan, room.nama) && bookingInBuilding(entry.gedung, building))
      .sort((left, right) => jamRange(left.jam).start - jamRange(right.jam).start);
  }, [building, room, schedule]);

  const conflicts = useMemo(
    () =>
      building && room && jam && scheduleReady
        ? findRoomConflicts(schedule, { waktu, jam, building, ruangan: room.nama })
        : [],
    [building, room, jam, scheduleReady, schedule, waktu],
  );

  const availabilityContext = useMemo(
    () =>
      building && room && jam && scheduleReady
        ? { buildings, equipment, bookings: schedule, waktu, jam, gedung: building.nama, ruangan: room.nama }
        : null,
    [building, room, jam, scheduleReady, buildings, equipment, schedule, waktu],
  );

  const equipmentOptions: EquipmentOption[] = useMemo(() => {
    if (!building) return [];
    return [
      ...building.inventarisList.map((item) => ({ name: item.nama, total: item.jumlah, group: 'building' as const })),
      ...globalEquipmentFor(building, equipment).map((item) => ({
        name: item.nama,
        total: item.totalStok,
        group: 'global' as const,
      })),
    ];
  }, [building, equipment]);

  const optionState = (option: EquipmentOption) => {
    if (!availabilityContext) return { max: 0, note: 'Pilih tanggal, jam & ruangan dulu', disabled: true };
    const availability = equipmentAvailability(availabilityContext, formatFacility(1, option.name));
    if (!availability) return { max: 0, note: 'Tidak dikenali SIMPEL', disabled: true };
    if (availability.source === 'room') {
      return { max: option.total, note: 'Sudah ada di ruangan', disabled: option.total < 1 };
    }
    const remaining = Math.max(0, availability.remaining);
    return {
      max: Math.min(remaining, option.total),
      note: remaining > 0 ? `Sisa ${remaining} dari ${availability.total}` : 'Habis pada jam ini',
      disabled: remaining < 1,
    };
  };

  const equipmentNames = new Set(equipmentOptions.map((option) => option.name));
  const selectedLines = Object.entries(quantities)
    .filter(([name, qty]) => qty > 0 && equipmentNames.has(name))
    .map(([name, qty]) => ({ name, qty }));
  const shortages = availabilityContext
    ? findEquipmentShortages(availabilityContext, selectedLines.map((line) => formatFacility(line.qty, line.name)))
    : [];

  // What the current step still needs.
  const stepId = RESERVATION_STEPS[step].id;
  const isLast = step === RESERVATION_STEPS.length - 1;
  const draft: ReservationDraft = {
    kegiatan,
    waktu,
    jamMulai,
    jamSelesai,
    gedungId: effectiveGedungId,
    ruangan: effectiveRuangan,
    pemohon,
    kontak,
  };
  const stepContext: StepContext = {
    today,
    nowMinutes: catalog?.nowMinutes ?? 0,
    building,
    room,
    scheduleReady,
    conflictCount: conflicts.length,
    shortageText: shortages.length > 0 ? describeShortages(shortages) : null,
  };
  const issues = validateStep(stepId, draft, stepContext);
  const issueFor = (field: ReservationField) => issues.find((issue) => issue.field === field)?.message;
  const errorFor = (field: ReservationField) =>
    touched[field] || attempted[stepId] ? issueFor(field) : undefined;
  const touch = (field: ReservationField) =>
    setTouched((current) => (current[field] ? current : { ...current, [field]: true }));

  const focusFirstProblem = () => {
    window.requestAnimationFrame(() => {
      const body = bodyRef.current;
      const input = body?.querySelector<HTMLElement>('input[aria-invalid="true"]');
      if (input) input.focus();
      else body?.querySelector<HTMLElement>('[role="alert"]')?.scrollIntoView({ block: 'center', behavior: 'smooth' });
    });
  };

  const goTo = (index: number) => {
    setStep(index);
    setSubmitError(null);
    setSubmitConflict(false);
  };

  const next = () => {
    if (issues.length > 0) {
      setAttempted((current) => ({ ...current, [stepId]: true }));
      focusFirstProblem();
      return;
    }
    goTo(step + 1);
  };

  const selectBuilding = (value: string) => {
    setGedungId(value);
    setRuangan('');
    setQuantities({});
    scrollToRooms.current = (buildings.find((candidate) => candidate.id === value)?.ruanganList.length ?? 0) > 0;
  };

  const submit = async () => {
    if (submitting) return;
    // Re-check everything: the user may have jumped back and changed something.
    const invalid = firstInvalidStep(draft, stepContext);
    if (invalid) {
      setAttempted((current) => ({ ...current, [invalid]: true }));
      setStep(stepIndex(invalid));
      focusFirstProblem();
      return;
    }
    if (!building || !room) return;

    setSubmitting(true);
    setSubmitError(null);
    setSubmitConflict(false);
    try {
      const result = await authenticatedJson<{ reservation: ReservationView }>('/api/venue-reservations', {
        method: 'POST',
        body: JSON.stringify({
          action: 'create',
          gedungId: building.id,
          ruangan: room.nama,
          waktu,
          jamMulai,
          jamSelesai,
          kegiatan: kegiatan.trim(),
          pemohon: pemohon.trim(),
          kontak: kontak.trim(),
          equipment: selectedLines,
        }),
      });
      submitted.current = true;
      writeDraft(uid, null);
      onCreated(result.reservation);
    } catch (error) {
      setSubmitError(error instanceof Error ? error.message : 'Gagal membuat reservasi.');
      // Someone else may have taken the slot or the last items; show what is left now.
      if (error instanceof ApiError && error.status === 409) {
        setSubmitConflict(true);
        void loadCatalog(waktu);
      }
    } finally {
      setSubmitting(false);
    }
  };

  const buildingOptions: PickerOption[] = buildings.map((candidate) => ({
    value: candidate.id,
    label: candidate.nama,
    image: photos?.buildings[candidate.id] ?? null,
    description: [
      candidate.lokasi,
      candidate.ruanganList.length === 0 ? 'belum ada ruangan' : `${candidate.ruanganList.length} ruangan`,
    ]
      .filter(Boolean)
      .join(' · '),
  }));

  const roomPhotos = building ? photos?.rooms[building.id] : undefined;
  const roomOptions: PickerOption[] = (building?.ruanganList ?? []).map((candidate) => {
    const inMaintenance = candidate.status.toLowerCase() === 'maintenance';
    return {
      value: candidate.nama,
      label: candidate.nama,
      image: roomPhotos?.[candidate.nama] ?? null,
      description: inMaintenance
        ? 'Sedang dalam perawatan'
        : [candidate.lantai !== null ? `Lantai ${candidate.lantai}` : '', candidate.kapasitas ? `${candidate.kapasitas} orang` : '']
            .filter(Boolean)
            .join(' · '),
      disabled: inMaintenance,
    };
  });

  const summaryRows = [
    { label: 'Kegiatan', value: kegiatan.trim(), step: stepIndex('acara') },
    {
      label: 'Waktu',
      value: `${formatReservationDate(waktu)}, ${jamMulai}–${jamSelesai} WIB${duration ? ` (${duration})` : ''}`,
      step: stepIndex('acara'),
    },
    { label: 'Tempat', value: [building?.nama, room?.nama].filter(Boolean).join(' · ') || '-', step: stepIndex('tempat') },
    {
      label: 'Peralatan',
      value: selectedLines.length > 0 ? selectedLines.map((line) => formatFacility(line.qty, line.name)).join(', ') : 'Tanpa peralatan tambahan',
      step: stepIndex('tempat'),
    },
  ];

  return (
    <Dialog open={open} onOpenChange={(nextOpen) => { if (!nextOpen && !submitting) onOpenChange(false); }}>
      <DialogContent
        className={cn(
          'flex max-h-[92vh] w-[95vw] flex-col gap-0 overflow-hidden rounded-2xl border-none bg-white p-0 shadow-2xl transition-[max-width] duration-300',
          // The venue step is two columns, so it gets nearly the whole screen; the other steps stay narrow.
          stepId === 'tempat' ? 'sm:max-w-[min(96vw,1440px)]' : 'sm:max-w-2xl',
        )}
      >
        <DialogHeader className="shrink-0 gap-2.5 border-b border-slate-100 p-5 sm:p-6">
          <DialogTitle className="text-lg font-bold text-slate-900">Reservasi Ruang Baru</DialogTitle>
          <div className="space-y-2 pt-1">
            <div className="flex items-center justify-between text-[11px] font-bold text-slate-500">
              <span aria-live="polite">
                Langkah {step + 1} dari {RESERVATION_STEPS.length} · {RESERVATION_STEPS[step].label}
              </span>
              <span>{progressPercent(step)}%</span>
            </div>
            <div
              role="progressbar"
              aria-label="Kemajuan pengisian"
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={progressPercent(step)}
              className="flex gap-1"
            >
              {RESERVATION_STEPS.map((item, index) => (
                <span
                  key={item.id}
                  className={cn('h-1.5 flex-1 rounded-full transition-colors', index <= step ? 'bg-indigo-500' : 'bg-slate-200')}
                />
              ))}
            </div>
          </div>
        </DialogHeader>

        <form
          noValidate
          onSubmit={(event) => {
            event.preventDefault();
            if (isLast) void submit();
            else next();
          }}
          className="flex min-h-0 flex-1 flex-col"
        >
          <div ref={bodyRef} className="min-h-0 flex-1 overflow-y-auto p-5 sm:p-6">
            {catalogError && (
              <div role="alert" className="mb-5 flex items-start gap-2 rounded-xl border border-rose-200 bg-rose-50 p-3 text-xs font-medium text-rose-700">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                <div className="space-y-2">
                  <p>{catalogError}</p>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => void loadCatalog(isValidDateString(waktu) ? waktu : '')}
                    className="rounded-lg border-rose-200 text-rose-700 hover:bg-rose-100"
                  >
                    Coba lagi
                  </Button>
                </div>
              </div>
            )}

            <div key={step} className="animate-in space-y-5 duration-200 fade-in-0 slide-in-from-right-2 motion-reduce:animate-none">
              <h3 className="text-base font-bold text-slate-900">{RESERVATION_STEPS[step].title}</h3>

              {/* 1 · Kegiatan & waktu: the easy questions first */}
              {stepId === 'acara' && (
                <>
                  <Field
                    id="reservasi-kegiatan"
                    label="Nama kegiatan"
                    hint="Tampil di jadwal SIMPEL dan dilihat Pekarya & Biro Umum."
                    error={errorFor('kegiatan')}
                    valid={!issueFor('kegiatan')}
                  >
                    <Input
                      id="reservasi-kegiatan"
                      name="kegiatan"
                      value={kegiatan}
                      maxLength={MAX_KEGIATAN_LENGTH}
                      placeholder="Contoh: Rapat Koordinasi Loyalis"
                      autoComplete="off"
                      enterKeyHint="next"
                      autoFocus
                      aria-invalid={!!errorFor('kegiatan') || undefined}
                      aria-describedby="reservasi-kegiatan-message"
                      onChange={(event) => setKegiatan(event.target.value)}
                      onBlur={() => touch('kegiatan')}
                      className={INPUT_CLASS}
                    />
                  </Field>
                  <Field
                    id="reservasi-tanggal"
                    label="Tanggal"
                    error={errorFor('waktu')}
                    valid={!issueFor('waktu')}
                  >
                    <Input
                      id="reservasi-tanggal"
                      name="tanggal"
                      type="date"
                      value={waktu}
                      min={today || undefined}
                      max={today ? addDays(today, RESERVATION_HORIZON_DAYS) : undefined}
                      aria-invalid={!!errorFor('waktu') || undefined}
                      aria-describedby="reservasi-tanggal-message"
                      onChange={(event) => setWaktuInput(event.target.value)}
                      onBlur={() => touch('waktu')}
                      className={INPUT_CLASS}
                    />
                  </Field>

                  <div className="space-y-2">
                    <div className="grid grid-cols-2 gap-3">
                      <Field id="reservasi-mulai" label="Waktu Mulai" valid={parseClock(jamMulai) !== null && !errorFor('jam')}>
                        <div className="relative">
                          <Timer className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" aria-hidden="true" />
                          <Input
                            id="reservasi-mulai"
                            name="jam-mulai"
                            type="text"
                            inputMode="numeric"
                            maxLength={5}
                            placeholder="JJ:MM"
                            value={jamMulai}
                            aria-invalid={!!errorFor('jam') || undefined}
                            aria-describedby={errorFor('jam') ? 'reservasi-jam-message' : undefined}
                            onChange={(event) => {
                              const masked = maskTimeInput(event.target.value);
                              setJamMulai(masked);
                              if (masked.length === 5 && parseClock(masked) !== null) {
                                focusWaktuSelesai();
                              }
                            }}
                            onKeyDown={(event) => {
                              if (event.key === 'Enter') {
                                event.preventDefault();
                                const completed = completeTime(jamMulai);
                                setJamMulai(completed);
                                if (parseClock(completed) !== null) {
                                  focusWaktuSelesai();
                                }
                              }
                            }}
                            onBlur={() => {
                              setJamMulai(completeTime(jamMulai));
                              touch('jam');
                            }}
                            className={cn(INPUT_CLASS, 'pl-9')}
                          />
                        </div>
                      </Field>
                      <Field id="reservasi-selesai" label="Waktu Selesai" valid={timeValid && !errorFor('jam')}>
                        <div className="relative">
                          <Timer className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" aria-hidden="true" />
                          <Input
                            ref={jamSelesaiInputRef}
                            id="reservasi-selesai"
                            name="jam-selesai"
                            type="text"
                            inputMode="numeric"
                            maxLength={5}
                            placeholder="JJ:MM"
                            value={jamSelesai}
                            aria-invalid={!!errorFor('jam') || undefined}
                            aria-describedby={errorFor('jam') ? 'reservasi-jam-message' : undefined}
                            onFocus={(event) => event.target.select()}
                            onChange={(event) => setJamSelesai(maskTimeInput(event.target.value))}
                            onBlur={() => {
                              setJamSelesai(completeTime(jamSelesai));
                              touch('jam');
                            }}
                            className={cn(INPUT_CLASS, 'pl-9')}
                          />
                        </div>
                      </Field>
                    </div>
                    {errorFor('jam') && <InlineError id="reservasi-jam-message">{errorFor('jam')}</InlineError>}
                  </div>
                </>
              )}

              {/* 2 · Tempat on the left, the optional equipment on the right */}
              {stepId === 'tempat' && (
                <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
                  <div className="space-y-5">
                    <div className="space-y-2">
                      <GroupLabel id="reservasi-gedung-label" done={!!building}>
                        Gedung
                      </GroupLabel>
                      {!catalog && catalogLoading ? (
                        <p className="flex items-center gap-2 text-xs text-slate-400">
                          <Loader2 className="h-3.5 w-3.5 animate-spin" /> Memuat gedung dari SIMPEL...
                        </p>
                      ) : buildings.length === 0 ? (
                        <p className="text-xs text-slate-500">SIMPEL belum memiliki data gedung.</p>
                      ) : (
                        <OptionPicker
                          name="gedung"
                          labelledBy="reservasi-gedung-label"
                          options={buildingOptions}
                          value={effectiveGedungId}
                          onChange={selectBuilding}
                          placeholder="Pilih gedung"
                          invalid={!!errorFor('gedung')}
                          photosLoading={photosLoading}
                        />
                      )}
                      {errorFor('gedung') && <InlineError>{errorFor('gedung')}</InlineError>}
                    </div>

                    {building && (
                      <div ref={roomsRef} className="scroll-mt-6 space-y-2">
                        <GroupLabel id="reservasi-ruangan-label" done={!!room}>
                          Ruangan
                        </GroupLabel>
                        {building.ruanganList.length === 0 ? (
                          <p className="text-[11px] font-medium leading-relaxed text-amber-700">
                            {building.nama} belum memiliki ruangan di SIMPEL, jadi belum bisa dipesan. Minta Biro Umum
                            menambahkannya lewat menu Gedung &amp; Ruangan di SIMPEL.
                          </p>
                        ) : (
                          <OptionPicker
                            name="ruangan"
                            labelledBy="reservasi-ruangan-label"
                            options={roomOptions}
                            value={effectiveRuangan}
                            onChange={setRuangan}
                            placeholder="Pilih ruangan"
                            invalid={!!errorFor('ruangan')}
                            photosLoading={photosLoading}
                          />
                        )}
                        {errorFor('ruangan') && <InlineError>{errorFor('ruangan')}</InlineError>}
                        {room && room.fasilitasBawaan.length > 0 && (
                          <p className="text-[11px] leading-relaxed text-slate-500">
                            Sudah termasuk: {room.fasilitasBawaan.join(', ')}
                          </p>
                        )}
                      </div>
                    )}

                    {room && !roomInMaintenance && (
                      <div className="space-y-2">
                        <p className={SUBLABEL}>Jadwal ruangan ini pada tanggal tersebut</p>
                        {!scheduleReady || catalogLoading ? (
                          <p className="flex items-center gap-2 text-xs text-slate-400">
                            <Loader2 className="h-3.5 w-3.5 animate-spin" /> Memuat jadwal SIMPEL...
                          </p>
                        ) : (
                          <>
                            {roomSchedule.length > 0 && (
                              <ul className="space-y-1.5">
                                {roomSchedule.map((entry) => {
                                  const clash = timeValid && slotsOverlap(entry.jam, jam);
                                  return (
                                    <li
                                      key={entry.id}
                                      className={cn(
                                        'flex items-start justify-between gap-3 rounded-lg border p-2.5 text-xs',
                                        clash ? 'border-rose-200 bg-rose-50 text-rose-800' : 'border-slate-200 bg-white text-slate-700',
                                      )}
                                    >
                                      <span>
                                        <span className="font-bold">{entry.jam} WIB</span> · {entry.kegiatan || 'Kegiatan'}
                                        <span className="block text-[11px] text-slate-500">{entry.pemohon}</span>
                                      </span>
                                      <span className={cn('shrink-0 text-[10px] font-bold uppercase', clash ? 'text-rose-700' : 'text-slate-400')}>
                                        {clash ? 'Bentrok' : SCHEDULE_STATUS_LABELS[entry.status] || entry.status}
                                      </span>
                                    </li>
                                  );
                                })}
                              </ul>
                            )}
                            {conflicts.length > 0 ? (
                              <InlineError>Jam yang dipilih bentrok dengan jadwal di atas. Ganti jam atau pilih ruangan lain.</InlineError>
                            ) : (
                              <p className="flex items-center gap-2 rounded-lg border border-emerald-200 bg-emerald-50 p-2.5 text-xs font-semibold text-emerald-700">
                                <CheckCircle2 className="h-4 w-4" aria-hidden="true" />
                                {roomSchedule.length === 0
                                  ? 'Belum ada jadwal lain di ruangan ini.'
                                  : 'Tidak bentrok dengan jadwal di atas.'}
                              </p>
                            )}
                          </>
                        )}
                      </div>
                    )}
                    {errorFor('ketersediaan') && <InlineError>{errorFor('ketersediaan')}</InlineError>}
                  </div>

                  <aside
                    aria-label="Peralatan tambahan"
                    className="space-y-3 rounded-xl border border-slate-200 bg-slate-50/60 p-4 lg:sticky lg:top-6 lg:max-h-[calc(92vh-15rem)] lg:overflow-y-auto"
                  >
                    <div className="flex items-center justify-between gap-3">
                      <h4 className={cn(FIELD_LABEL, 'flex items-center gap-2')}>
                        <Package className="h-4 w-4 text-slate-400" aria-hidden="true" />
                        Peralatan tambahan
                        <span className="text-xs font-medium text-slate-400">(opsional)</span>
                      </h4>
                      {selectedLines.length > 0 && (
                        <span className="rounded-full bg-indigo-50 px-2 py-0.5 text-[11px] font-bold text-indigo-700">
                          {selectedLines.length} dipilih
                        </span>
                      )}
                    </div>

                    {!room || roomInMaintenance ? (
                      <p className="text-xs text-slate-400">Pilih ruangan terlebih dahulu.</p>
                    ) : equipmentOptions.length === 0 ? (
                      <p className="text-xs text-slate-400">SIMPEL belum mencatat peralatan untuk gedung ini.</p>
                    ) : (
                      (['building', 'global'] as const).map((group) => {
                        const options = equipmentOptions.filter((option) => option.group === group);
                        if (options.length === 0) return null;
                        return (
                          <div key={group} className="space-y-1.5">
                            <p className={SUBLABEL}>
                              {group === 'building' ? `Inventaris ${building?.singkatan || building?.nama}` : 'Logistik umum kampus'}
                            </p>
                            <ul className="divide-y divide-slate-100 rounded-xl border border-slate-200 bg-white">
                              {options.map((option) => {
                                const state = optionState(option);
                                return (
                                  <EquipmentRow
                                    key={`${group}-${option.name}`}
                                    name={option.name}
                                    note={state.note}
                                    max={state.max}
                                    unavailable={state.disabled}
                                    value={quantities[option.name] ?? 0}
                                    onChange={(value) => setQuantities((current) => ({ ...current, [option.name]: value }))}
                                  />
                                );
                              })}
                            </ul>
                          </div>
                        );
                      })
                    )}
                    {shortages.length > 0 && (
                      <InlineError>Tidak mencukupi pada jam ini: {describeShortages(shortages)}.</InlineError>
                    )}
                  </aside>
                </div>
              )}

              {/* 3 · Konfirmasi: the phone number comes last */}
              {stepId === 'konfirmasi' && (
                <>
                  {submitError && (
                    <div role="alert" className="flex items-start gap-2 rounded-xl border border-rose-200 bg-rose-50 p-3 text-xs font-medium text-rose-700">
                      <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                      <div className="space-y-2">
                        <p>{submitError}</p>
                        {submitConflict && (
                          <div className="flex flex-wrap gap-2">
                            <Button type="button" variant="outline" size="sm" onClick={() => goTo(stepIndex('acara'))} className="rounded-lg border-rose-200 text-rose-700 hover:bg-rose-100">
                              Ubah jam
                            </Button>
                            <Button type="button" variant="outline" size="sm" onClick={() => goTo(stepIndex('tempat'))} className="rounded-lg border-rose-200 text-rose-700 hover:bg-rose-100">
                              Ubah ruangan atau peralatan
                            </Button>
                          </div>
                        )}
                      </div>
                    </div>
                  )}

                  <dl className="divide-y divide-slate-100 rounded-xl border border-slate-200">
                    {summaryRows.map((row) => (
                      <div key={row.label} className="flex items-start justify-between gap-3 px-3.5 py-2.5">
                        <div className="min-w-0">
                          <dt className="text-[11px] font-bold uppercase text-slate-500">{row.label}</dt>
                          <dd className="text-sm font-semibold leading-snug text-slate-800 break-words">{row.value}</dd>
                        </div>
                        <button
                          type="button"
                          onClick={() => goTo(row.step)}
                          aria-label={`Ubah ${row.label}`}
                          className="shrink-0 text-xs font-semibold text-indigo-600 hover:underline cursor-pointer"
                        >
                          Ubah
                        </button>
                      </div>
                    ))}
                  </dl>

                  {editPemohon || issueFor('pemohon') ? (
                    <Field
                      id="reservasi-pemohon"
                      label="Atas nama (pemohon / unit)"
                      hint="Nama yang tampil di SIMPEL."
                      error={errorFor('pemohon')}
                      valid={!issueFor('pemohon')}
                    >
                      <Input
                        id="reservasi-pemohon"
                        name="pemohon"
                        value={pemohon}
                        maxLength={MAX_PEMOHON_LENGTH}
                        autoComplete="organization"
                        enterKeyHint="next"
                        aria-invalid={!!errorFor('pemohon') || undefined}
                        aria-describedby="reservasi-pemohon-message"
                        onChange={(event) => setPemohon(event.target.value)}
                        onBlur={() => touch('pemohon')}
                        className={INPUT_CLASS}
                      />
                    </Field>
                  ) : (
                    <div className="flex items-center justify-between gap-3 rounded-xl border border-slate-200 bg-slate-50/70 px-3.5 py-2.5">
                      <div className="min-w-0">
                        <p className="text-[11px] font-bold uppercase text-slate-500">Atas nama</p>
                        <p className="truncate text-sm font-semibold text-slate-800">{pemohon}</p>
                      </div>
                      <button
                        type="button"
                        onClick={() => setEditPemohon(true)}
                        className="shrink-0 text-xs font-semibold text-indigo-600 hover:underline cursor-pointer"
                      >
                        Ubah
                      </button>
                    </div>
                  )}

                  {/* A number filled in for the user is shown, not asked for; the input only
                      appears if there is none, or they want to change it. */}
                  {prefill !== null && kontak === prefill && !editKontak && !issueFor('kontak') ? (
                    <div className="flex items-center justify-between gap-3 rounded-xl border border-slate-200 bg-slate-50/70 px-3.5 py-2.5">
                      <div className="min-w-0">
                        <p className="text-[11px] font-bold uppercase text-slate-500">Nomor WhatsApp</p>
                        <p className="text-sm font-semibold text-slate-800">{kontak}</p>
                      </div>
                      <button
                        type="button"
                        onClick={() => setEditKontak(true)}
                        className="shrink-0 text-xs font-semibold text-indigo-600 hover:underline cursor-pointer"
                      >
                        Ubah
                      </button>
                    </div>
                  ) : (
                    <Field
                      id="reservasi-kontak"
                      label="Nomor WhatsApp"
                      hint="Dipakai Pekarya untuk koordinasi serah terima. Cukup sekali: nomor ini disimpan di akun Anda untuk reservasi berikutnya."
                      error={errorFor('kontak')}
                      valid={!issueFor('kontak')}
                    >
                      <Input
                        id="reservasi-kontak"
                        name="tel"
                        type="tel"
                        inputMode="tel"
                        autoComplete="tel"
                        enterKeyHint="done"
                        placeholder="0812-3456-7890"
                        value={kontak}
                        autoFocus={!kontak || editKontak}
                        aria-invalid={!!errorFor('kontak') || undefined}
                        aria-describedby="reservasi-kontak-message"
                        onChange={(event) => setKontak(formatPhoneInput(event.target.value))}
                        onBlur={() => touch('kontak')}
                        className={INPUT_CLASS}
                      />
                    </Field>
                  )}
                </>
              )}
            </div>
          </div>

          <div className="shrink-0 border-t border-slate-100 bg-white px-5 py-4 sm:px-6">
            <div className="flex items-center justify-between gap-3">
              {step > 0 ? (
                <Button
                  type="button"
                  variant="ghost"
                  onClick={() => goTo(step - 1)}
                  disabled={submitting}
                  className="h-12 rounded-xl px-4 text-base font-bold text-slate-600"
                >
                  <ArrowLeft /> Kembali
                </Button>
              ) : restored ? (
                <Button
                  type="button"
                  variant="ghost"
                  onClick={() => {
                    submitted.current = true;
                    writeDraft(uid, null);
                    onRestart();
                  }}
                  disabled={submitting}
                  className="h-12 rounded-xl px-4 text-base font-bold text-slate-500"
                >
                  Mulai dari awal
                </Button>
              ) : (
                <span />
              )}
              <Button
                type="submit"
                disabled={submitting}
                className="h-12 rounded-xl bg-indigo-600 px-6 text-base font-bold text-white hover:bg-indigo-700"
              >
                {submitting && <Loader2 className="animate-spin" />}
                {isLast ? 'Buat Reservasi' : 'Lanjut'}
                {!isLast && <ArrowRight />}
              </Button>
            </div>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
