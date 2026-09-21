/**
 * Rules behind the "Reservasi Ruang Baru" form: its steps, what each step needs
 * before "Lanjut", and the small defaults that save people typing. Follows
 * `combating_form_fatigue_guide.md`: a few easy questions per screen, the phone
 * number last, and errors only after a field has been left or "Lanjut" is tapped.
 *
 * React-free and Firebase-free so it can be unit-tested. Whether a booking can
 * really be made (room free, equipment in stock) stays in `venueReservation.ts`;
 * this file only decides what the form asks for and when it lets you move on.
 */
import {
  addDays,
  contactNumberError,
  getDateRangeList,
  isValidDateString,
  MAX_KEGIATAN_LENGTH,
  MAX_MULTI_DAY_RANGE,
  MAX_PEMOHON_LENGTH,
  parseClock,
  RESERVATION_HORIZON_DAYS,
  textFieldError,
  type SimpelBuilding,
  type SimpelRoom,
} from './venueReservation';

// ─── Steps ──────────────────────────────────────────────────────────────────

/** Easy question first, phone number last. */
export const RESERVATION_STEPS = [
  { id: 'acara', label: 'Kegiatan', title: 'Kegiatan apa dan kapan?' },
  { id: 'tempat', label: 'Tempat', title: 'Di ruangan mana?' },
  { id: 'konfirmasi', label: 'Konfirmasi', title: 'Periksa, lalu konfirmasi' },
] as const;

export type ReservationStepId = (typeof RESERVATION_STEPS)[number]['id'];

export function stepIndex(id: ReservationStepId): number {
  return RESERVATION_STEPS.findIndex((step) => step.id === id);
}

/**
 * Counts the step you are on as already under way, so the first screen shows
 * a third instead of 0% (the "endowed progress" effect: a head start feels finishable).
 */
export function progressPercent(index: number): number {
  return Math.round(((index + 1) / RESERVATION_STEPS.length) * 100);
}

// ─── What each step needs ───────────────────────────────────────────────────

export interface ReservationDraft {
  kegiatan: string;
  waktu: string;
  isMultiDay?: boolean;
  waktuSelesai?: string;
  jamMulai: string;
  jamSelesai: string;
  gedungId: string;
  ruangan: string;
  pemohon: string;
  kontak: string;
}

export type ReservationField =
  | 'kegiatan'
  | 'waktu'
  | 'waktuSelesai'
  | 'jam'
  | 'gedung'
  | 'ruangan'
  | 'ketersediaan'
  | 'pemohon'
  | 'kontak';

export interface StepIssue {
  field: ReservationField;
  message: string;
}

/** What the form knows beyond the fields themselves. */
export interface StepContext {
  /** Campus date (Asia/Jakarta); '' until SIMPEL's catalog has loaded. */
  today: string;
  /** Minutes since midnight on the campus clock. */
  nowMinutes: number;
  building?: SimpelBuilding;
  room?: SimpelRoom;
  /** Whether SIMPEL's bookings for the chosen date have been loaded. */
  scheduleReady: boolean;
  /** Bookings that already hold this room at overlapping hours. */
  conflictCount: number;
  /** Equipment that runs short at these hours, ready to show; null when all is in stock. */
  shortageText: string | null;
}

/** Empty when the step is complete. */
export function validateStep(
  step: ReservationStepId,
  draft: ReservationDraft,
  context: StepContext,
): StepIssue[] {
  const issues: StepIssue[] = [];
  const add = (field: ReservationField, message: string | null) => {
    if (message) issues.push({ field, message });
  };

  switch (step) {
    case 'acara': {
      add('kegiatan', textFieldError(draft.kegiatan.trim(), 'Nama kegiatan', MAX_KEGIATAN_LENGTH));

      if (!isValidDateString(draft.waktu)) {
        add('waktu', 'Pilih tanggal kegiatan.');
      } else if (context.today && draft.waktu < context.today) {
        add('waktu', 'Tanggal ini sudah lewat.');
      } else if (context.today && draft.waktu > addDays(context.today, RESERVATION_HORIZON_DAYS)) {
        add('waktu', 'Reservasi paling lama satu tahun ke depan.');
      }

      if (draft.isMultiDay) {
        if (!draft.waktuSelesai) {
          add('waktuSelesai', 'Pilih tanggal selesai kegiatan.');
        } else if (!isValidDateString(draft.waktuSelesai)) {
          add('waktuSelesai', 'Tanggal selesai tidak valid.');
        } else if (draft.waktuSelesai < draft.waktu) {
          add('waktuSelesai', 'Tanggal selesai harus setelah tanggal mulai.');
        } else if (context.today && draft.waktuSelesai > addDays(context.today, RESERVATION_HORIZON_DAYS)) {
          add('waktuSelesai', 'Reservasi paling lama satu tahun ke depan.');
        } else {
          const dates = getDateRangeList(draft.waktu, draft.waktuSelesai);
          if (dates.length === 0 || dates.length > MAX_MULTI_DAY_RANGE) {
            add('waktuSelesai', `Rentang multi-hari maksimal ${MAX_MULTI_DAY_RANGE} hari berturut-turut.`);
          }
        }
      }

      const start = parseClock(draft.jamMulai);
      const end = parseClock(draft.jamSelesai);
      if (start === null || end === null) {
        add('jam', 'Isi jam mulai dan jam selesai.');
      } else if (end <= start) {
        add('jam', 'Jam selesai harus setelah jam mulai.');
      } else if (draft.waktu === context.today && end <= context.nowMinutes) {
        add('jam', 'Jam ini sudah lewat hari ini.');
      }
      break;
    }

    case 'tempat':
      if (!context.building) {
        add('gedung', 'Pilih gedung.');
      } else if (!context.room) {
        add('ruangan', 'Pilih ruangan.');
      } else if (context.room.status.toLowerCase() === 'maintenance') {
        add('ruangan', `${context.room.nama} sedang dalam perawatan dan tidak dapat dipesan.`);
      } else if (!context.scheduleReady) {
        add('ketersediaan', 'Jadwal SIMPEL masih dimuat. Coba lagi sebentar.');
      } else if (context.conflictCount > 0) {
        add('ketersediaan', 'Jam yang dipilih bentrok dengan jadwal ruangan ini. Ganti jam atau ruangan.');
      } else if (context.shortageText) {
        add('ketersediaan', `Peralatan tidak mencukupi pada jam ini: ${context.shortageText}.`);
      }
      break;

    case 'konfirmasi':
      add('pemohon', textFieldError(draft.pemohon.trim(), 'Pemohon / unit', MAX_PEMOHON_LENGTH));
      add('kontak', contactNumberError(draft.kontak));
      break;
  }
  return issues;
}

/** The earliest step that is still incomplete, or null when the whole form is ready. */
export function firstInvalidStep(
  draft: ReservationDraft,
  context: StepContext,
): ReservationStepId | null {
  for (const step of RESERVATION_STEPS) {
    if (validateStep(step.id, draft, context).length > 0) return step.id;
  }
  return null;
}

// ─── Time ───────────────────────────────────────────────────────────────────

/**
 * Shapes what is typed into a time box: digits only, at most HH:MM, hours up to
 * 23, minutes up to 59, and the ":" put in after the hour ("0930" becomes "09:30").
 * Same behaviour as the time boxes in the employee activity report form.
 */
export function maskTimeInput(raw: string): string {
  let digits = raw.replace(/\D/g, '').slice(0, 4);
  if (digits.length === 1 && Number(digits) > 2) digits = `0${digits}`;
  if (digits.length >= 2 && Number(digits.slice(0, 2)) > 23) digits = `23${digits.slice(2)}`;
  if (digits.length === 4 && Number(digits.slice(2)) > 59) digits = `${digits.slice(0, 2)}59`;
  return digits.length > 2 ? `${digits.slice(0, 2)}:${digits.slice(2)}` : digits;
}

/** Finishes a half-typed time when the box is left: "8" becomes "08:00", "08:3" becomes "08:30". */
export function completeTime(value: string): string {
  if (!value) return '';
  const [hours, minutes] = value.split(':');
  return `${hours.padStart(2, '0')}:${(minutes ?? '').padEnd(2, '0')}`;
}

/** Tomorrow on the campus clock; '' until that clock is known. */
export function defaultReservationDate(today: string): string {
  return isValidDateString(today) ? addDays(today, 1) : '';
}

/** "2 jam", "1 jam 30 menit", "45 menit"; null when the range is not valid. */
export function durationLabel(jamMulai: string, jamSelesai: string): string | null {
  const start = parseClock(jamMulai);
  const end = parseClock(jamSelesai);
  if (start === null || end === null || end <= start) return null;
  const minutes = end - start;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  if (hours === 0) return `${rest} menit`;
  return rest === 0 ? `${hours} jam` : `${hours} jam ${rest} menit`;
}

/** e.g. "Kamis, 1 Oktober 2026". */
export function formatReservationDate(waktu: string): string {
  const date = new Date(`${waktu}T00:00:00`);
  if (Number.isNaN(date.getTime())) return waktu;
  return date.toLocaleDateString('id-ID', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  });
}

/**
 * Formats a date range, e.g. "Kamis, 1 Okt – Sabtu, 3 Okt 2026 (3 hari)".
 * If endDate is omitted or matches startDate, formats as a single date.
 */
export function formatReservationDateRange(startDate: string, endDate?: string | null): string {
  if (!startDate) return '';
  if (!endDate || endDate === startDate) return formatReservationDate(startDate);
  const start = new Date(`${startDate}T00:00:00`);
  const end = new Date(`${endDate}T00:00:00`);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return `${startDate} – ${endDate}`;
  const dates = getDateRangeList(startDate, endDate);
  const count = dates.length > 0 ? dates.length : Math.max(1, Math.round((end.getTime() - start.getTime()) / (24 * 3600 * 1000)) + 1);

  const startFormatted = start.toLocaleDateString('id-ID', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
  });
  const endFormatted = end.toLocaleDateString('id-ID', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
  return `${startFormatted} – ${endFormatted} (${count} hari)`;
}

// ─── Defaults that save taps and typing ─────────────────────────────────────

/** The only room that can be booked in this building, so it can be picked for the user. */
export function soleBookableRoom(building: SimpelBuilding | undefined): SimpelRoom | undefined {
  const bookable = building?.ruanganList.filter((room) => room.status.toLowerCase() !== 'maintenance') ?? [];
  return bookable.length === 1 ? bookable[0] : undefined;
}

// ─── Saved progress ─────────────────────────────────────────────────────────

/**
 * What is kept when someone closes the form half-way, so it can be picked up
 * again: only what they entered, never a phone number.
 */
export interface SavedDraft {
  step: number;
  kegiatan: string;
  /** null while the date is still the default (tomorrow). */
  waktuInput: string | null;
  isMultiDay?: boolean;
  waktuSelesai?: string | null;
  jamMulai: string;
  jamSelesai: string;
  gedungId: string;
  ruangan: string;
  quantities: Record<string, number>;
}

export const DRAFT_MAX_AGE_DAYS = 7;
const DRAFT_VERSION = 1;
const DAY_MS = 24 * 60 * 60 * 1000;
const MAX_DRAFT_EQUIPMENT_LINES = 60;

/** Nothing entered yet, so there is nothing worth keeping. */
export function isBlankDraft(draft: SavedDraft): boolean {
  return (
    !draft.kegiatan.trim() &&
    !draft.waktuInput &&
    !draft.waktuSelesai &&
    !draft.jamMulai &&
    !draft.jamSelesai &&
    !draft.gedungId &&
    !draft.ruangan &&
    Object.values(draft.quantities).every((qty) => !(qty > 0))
  );
}

export function serializeDraft(draft: SavedDraft, now: Date | string = new Date()): string {
  const dateObj = typeof now === 'string' ? new Date(now) : now;
  return JSON.stringify({ v: DRAFT_VERSION, savedAt: dateObj.toISOString(), ...draft });
}

/**
 * Reads a stored draft back. Anything unreadable, too old, blank, or not in the
 * shape written by `serializeDraft` is treated as "no draft", so a stale or
 * damaged entry can never break the form.
 */
export function parseSavedDraft(raw: string | null, now: Date = new Date()): SavedDraft | null {
  if (!raw) return null;
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!data || typeof data !== 'object' || Array.isArray(data)) return null;
  const entry = data as Record<string, unknown>;
  if (entry.v !== DRAFT_VERSION) return null;

  const savedAt = typeof entry.savedAt === 'string' ? Date.parse(entry.savedAt) : Number.NaN;
  const age = now.getTime() - savedAt;
  if (!Number.isFinite(savedAt) || age > DRAFT_MAX_AGE_DAYS * DAY_MS || age < -60_000) return null;

  const text = (value: unknown, maxLength: number): string | null =>
    typeof value === 'string' && value.length <= maxLength ? value : null;
  const clock = (value: unknown): string | null => {
    const candidate = text(value, 5);
    return candidate !== null && /^\d{0,2}(?::\d{0,2})?$/.test(candidate) ? candidate : null;
  };

  const kegiatan = text(entry.kegiatan, MAX_KEGIATAN_LENGTH);
  const jamMulai = clock(entry.jamMulai);
  const jamSelesai = clock(entry.jamSelesai);
  const gedungId = text(entry.gedungId, 120);
  const ruangan = text(entry.ruangan, 200);
  if (kegiatan === null || jamMulai === null || jamSelesai === null || gedungId === null || ruangan === null) {
    return null;
  }

  const waktuInput =
    typeof entry.waktuInput === 'string' && (entry.waktuInput === '' || isValidDateString(entry.waktuInput))
      ? entry.waktuInput
      : null;
  const isMultiDay = entry.isMultiDay === true ? true : undefined;
  const waktuSelesai =
    typeof entry.waktuSelesai === 'string' && (entry.waktuSelesai === '' || isValidDateString(entry.waktuSelesai))
      ? entry.waktuSelesai
      : null;
  const step =
    typeof entry.step === 'number' && Number.isInteger(entry.step) && entry.step >= 0 && entry.step < RESERVATION_STEPS.length
      ? entry.step
      : 0;

  const quantities: Record<string, number> = {};
  const rawQuantities = entry.quantities && typeof entry.quantities === 'object' ? Object.entries(entry.quantities) : [];
  for (const [name, qty] of rawQuantities.slice(0, MAX_DRAFT_EQUIPMENT_LINES)) {
    if (name.length <= 200 && typeof qty === 'number' && Number.isInteger(qty) && qty > 0 && qty <= 100_000) {
      quantities[name] = qty;
    }
  }

  const draft: SavedDraft = {
    step,
    kegiatan,
    waktuInput,
    jamMulai,
    jamSelesai,
    gedungId,
    ruangan,
    quantities,
    ...(isMultiDay ? { isMultiDay: true } : {}),
    ...(waktuSelesai ? { waktuSelesai } : {}),
  };
  return isBlankDraft(draft) ? null : draft;
}

// ─── Equipment quantities ───────────────────────────────────────────────────

export function clampQuantity(value: number, max: number): number {
  return Math.max(0, Math.min(max, Math.floor(value) || 0));
}

/** Big stocks (chairs) move in tens, small ones (microphones) one at a time. */
export function stepperIncrement(max: number): number {
  return max > 30 ? 10 : 1;
}

// ─── Phone number ───────────────────────────────────────────────────────────

/**
 * Formats the WhatsApp number as it is typed, so people can enter plain digits
 * and never think about dashes or spaces (guide §3B, "Automatic Input Masking").
 *
 * Called on every keystroke with whatever is in the box: "0812", "08123456",
 * "0812-3456-78", or a pasted "+62 812 3456 7890".
 *
 * The contract (checked in venueReservationForm.test.ts):
 *  - never throws, always returns a string
 *  - idempotent: formatPhoneInput(formatPhoneInput(x)) equals formatPhoneInput(x)
 *  - a local number ("08…") keeps all of its digits; only the separators change
 *  - the result still passes contactNumberError: digits and + ( ) - space, 8 to 15 digits
 *
 * TODO(human): replace this pass-through with your masking rule. Decide how the
 * digits are grouped (0812-3456-7890? 0812 3456 7890?), what happens to a "+62"
 * or "62" prefix (keep it? turn it into 0?), and where to stop (15 digits at most).
 */
export function formatPhoneInput(raw: string): string {
  return raw;
}
