/**
 * Pemeriksaan Ruang: after a room has been used, a Kebersihan or Teknisi
 * Pekarya checks it in from SAKU. A port of SIMPEL UNIPDU's maintenance page
 * (`src/app/dashboard/maintenance/page.tsx` in the simpel-unipdu repo): the
 * "Pengembalian" check (built-in room fixtures, borrowed equipment, room
 * cleanliness) and the "Perbaikan" repair log it feeds.
 *
 * The data stays SIMPEL's: the check writes the same booking flags, stock
 * counts and `simpel_maintenance` logs SIMPEL's own page writes, so either app
 * can check a room in and both see the result. Differences, all on the safe
 * side: exact names are preferred over SIMPEL's contains-either-way matching,
 * damage to equipment found in no catalog is still logged, and a repair that
 * SAKU logged also puts back what the check took away (building stock, the
 * room's availability) when it is closed.
 *
 * Firebase-free: shared by the API route and the page, and unit-tested.
 */

import { isBlueCollarFacilityDashboardUser } from '@/lib/facilityReports';
import {
  buildSimpelEmailHtml,
  findBuilding,
  findRoom,
  isValidDateString,
  jakartaNow,
  jamRange,
  parseFacility,
  SIMPEL_BIRO_UMUM_EMAIL,
  SIMPEL_FIELD_STAFF_EMAIL,
  VENUE_TIME_ZONE,
  type NotificationDraft,
  type SimpelBooking,
  type SimpelBuilding,
  type SimpelEquipment,
} from '@/lib/venueReservation';

export const VENUE_INSPECTION_PATH = '/dashboard/pemeriksaan-ruang';

export function isVenueInspectionPath(pathname: string): boolean {
  return pathname === VENUE_INSPECTION_PATH || pathname.startsWith(`${VENUE_INSPECTION_PATH}/`);
}

export interface VenueInspectorProfile {
  role?: string | null;
  permittedCategories?: readonly string[] | null;
}

/**
 * Teknisi and Kebersihan (the same people who close facility reports) check
 * rooms in; Super Admin too, to test and to step in.
 */
export function canInspectVenues(profile: VenueInspectorProfile | null | undefined): boolean {
  if (!profile) return false;
  return profile.role === 'super_admin' || isBlueCollarFacilityDashboardUser(profile);
}

export const MAX_INSPECTION_NOTES_LENGTH = 500;
const MAX_UNITS = 100_000;
const SAKU_EMAIL_FOOTER =
  'Email ini dikirim otomatis oleh Sistem SIMPEL UNIPDU dari pemeriksaan melalui aplikasi SAKU. Mohon tidak membalas email ini.';

// ─── Categories and damage choices (SIMPEL's `DAMAGE_CHOICES`) ──────────────

export const INSPECTION_CATEGORIES = ['Elektronik', 'Mebel', 'Utilitas', 'Panggung', 'Gedung'] as const;
export type InspectionCategory = (typeof INSPECTION_CATEGORIES)[number];

export const DAMAGE_CHOICES: Record<InspectionCategory, readonly string[]> = {
  Elektronik: [
    'Mati Total / Konslet',
    'Kabel Putus / Hilang',
    'Suara Kresek / Noise',
    'Lensa Buram / Pecah',
    'Overheat / Fungsi Menurun',
    'AC Mati / Bocor',
    'Remote Hilang',
  ],
  Mebel: [
    'Kaki Patah / Bengkok',
    'Sandaran / Alas Retak',
    'Permukaan Coret-coret / Noda',
    'Baut Kendur / Hilang',
    'Unit Hilang / Kurang',
  ],
  Utilitas: ['Robek / Patah', 'Kotor / Noda Berat', 'Hilang / Kurang', 'Kerangka Penyok / Bengkok'],
  Panggung: ['Robek / Patah', 'Kotor / Noda Berat', 'Hilang / Kurang', 'Kerangka Penyok / Bengkok'],
  Gedung: [
    'Tembok Coret-coret / Retak',
    'Pintu / Jendela Macet',
    'AC Mati / Bocor',
    'Lampu Mati',
    'Lantai Kotor',
  ],
};

export const DAMAGE_LEVELS = ['Rusak Ringan', 'Rusak Berat'] as const;
export type DamageLevel = (typeof DAMAGE_LEVELS)[number];

export const ROOM_CONDITIONS = ['Bersih', 'Maintenance'] as const;
export type RoomCondition = (typeof ROOM_CONDITIONS)[number];

export const REPAIR_STATUSES = ['Dalam Perbaikan', 'Selesai'] as const;
export type RepairStatus = (typeof REPAIR_STATUSES)[number];

// ─── Small helpers ──────────────────────────────────────────────────────────

function lower(value: string): string {
  return value.toLowerCase().trim();
}

function eitherContains(a: string, b: string): boolean {
  if (!a || !b) return false;
  return a.includes(b) || b.includes(a);
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function count(value: unknown): number {
  const number = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(number) ? Math.max(0, Math.floor(number)) : 0;
}

/** SIMPEL looks items up by name, loosely; an exact name wins here so "Kursi" never shadows "Kursi Lipat". */
function findByName<T>(items: readonly T[], name: string, nameOf: (item: T) => string): T | undefined {
  const target = lower(name);
  if (!target) return undefined;
  return (
    items.find((item) => lower(nameOf(item)) === target) ??
    items.find((item) => eitherContains(lower(nameOf(item)), target))
  );
}

function slug(value: string): string {
  return value.toUpperCase().replace(/\s+/g, '-');
}

// ─── Reading the room's fixtures and the borrowed equipment ─────────────────

/** "AC Split (4 unit)", "2x Kursi", "2 unit Kursi" or just "Kursi". Port of SIMPEL's `parsePermanentFacility`. */
export function parsePermanentFacility(value: string): { name: string; totalQty: number } {
  const clean = value.trim();
  if (!clean) return { name: '', totalQty: 1 };
  const qty = (digits: string) => Math.min(MAX_UNITS, parseInt(digits, 10) || 1);

  const inParentheses = clean.match(/^(.*?)\s*\(\s*(\d+)[^)]*\)$/);
  if (inParentheses && inParentheses[1].trim()) {
    return { name: inParentheses[1].trim(), totalQty: qty(inParentheses[2]) };
  }
  const multiplied = clean.match(/^(\d+)\s*(?:x|unit|buah|pcs)?\s+(.*)$/i);
  if (multiplied && multiplied[2].trim()) {
    return { name: multiplied[2].trim(), totalQty: qty(multiplied[1]) };
  }
  return { name: clean, totalQty: 1 };
}

const MEBEL_WORDS = /kursi|meja|sofa|banquet/;
const ELEKTRONIK_WORDS =
  /\b(ac|tv|led)\b|\bmic|sound|videotron|projector|proyektor|speaker|komputer|monitor|cctv|mixer|audio|kamera|laptop|printer|lampu/;

function categoryFromName(name: string): InspectionCategory {
  const value = lower(name);
  if (MEBEL_WORDS.test(value)) return 'Mebel';
  if (ELEKTRONIK_WORDS.test(value)) return 'Elektronik';
  if (value.includes('panggung')) return 'Panggung';
  return 'Utilitas';
}

function asEquipmentCategory(value: string): InspectionCategory | null {
  const match = INSPECTION_CATEGORIES.find((category) => category !== 'Gedung' && lower(category) === lower(value));
  return match ?? null;
}

/** Which damage choices an item gets. Port of SIMPEL's `getFacilityCategory`. */
export function facilityCategory(
  name: string,
  building: SimpelBuilding | undefined,
  equipment: readonly SimpelEquipment[],
): InspectionCategory {
  const global = findByName(equipment, name, (item) => item.nama);
  if (global) return asEquipmentCategory(global.kategori) ?? categoryFromName(global.nama);
  const buildingItem = building ? findByName(building.inventarisList, name, (item) => item.nama) : undefined;
  return categoryFromName(buildingItem?.nama ?? name);
}

export interface PermanentCheckItem {
  /** Stable within one checklist: "p0", "p1", … */
  key: string;
  name: string;
  /** The line as SIMPEL stores it, e.g. "AC Split (4 unit)". */
  source: string;
  totalQty: number;
  category: InspectionCategory;
}

export interface MobileCheckItem {
  /** Stable within one checklist: "m0", "m1", … */
  key: string;
  name: string;
  borrowedQty: number;
  category: InspectionCategory;
}

export interface InspectionChecklist {
  permanent: PermanentCheckItem[];
  mobile: MobileCheckItem[];
}

export interface InspectionCatalog {
  buildings: SimpelBuilding[];
  equipment: SimpelEquipment[];
}

const BUILT_IN_SUFFIX = /\s*\(Bawaan Ruangan\)$/i;

/**
 * What has to be checked for a booking: the room's built-in fixtures, and the
 * equipment handed over (or, before a handover, what was requested) minus
 * anything that is really a fixture. Port of SIMPEL's `handleOpenCheckIn`.
 */
export function buildInspectionChecklist(
  booking: Pick<SimpelBooking, 'gedung' | 'ruangan' | 'fasilitasTambahan' | 'fasilitasDiserahkan'>,
  catalog: InspectionCatalog,
): InspectionChecklist {
  const building = findBuilding(catalog.buildings, booking.gedung);
  const room = findRoom(building, booking.ruangan);
  const fixtures = room?.fasilitasBawaan ?? [];

  const permanent = fixtures
    .map((source) => ({ source, ...parsePermanentFacility(source) }))
    .filter((fixture) => fixture.name)
    .map((fixture, index) => ({
      key: `p${index}`,
      name: fixture.name,
      source: fixture.source,
      totalQty: fixture.totalQty,
      category: facilityCategory(fixture.name, building, catalog.equipment),
    }));

  const handedOver = booking.fasilitasDiserahkan ?? [];
  const lines = (handedOver.length > 0 ? handedOver : booking.fasilitasTambahan).filter(
    (line) => !BUILT_IN_SUFFIX.test(line),
  );
  const mobile = lines
    .map((line) => parseFacility(line))
    .filter(({ name }) => name && !fixtures.some((fixture) => eitherContains(lower(fixture), lower(name))))
    .map(({ qty, name }, index) => ({
      key: `m${index}`,
      name,
      borrowedQty: Math.min(MAX_UNITS, Math.max(1, qty)),
      category: facilityCategory(name, building, catalog.equipment),
    }));

  return { permanent, mobile };
}

// ─── Which bookings wait for a check ────────────────────────────────────────

type ReturnFields = Pick<
  SimpelBooking,
  | 'status'
  | 'checkInSelesai'
  | 'fasilitasTambahan'
  | 'fasilitasDiserahkan'
  | 'serahTerimaSelesai'
  | 'peminjamDiterima'
  | 'peminjamSiapKembali'
  | 'waktu'
  | 'jam'
  | 'sakuGroupDates'
>;

/** SIMPEL's `activeReservations`: approved and not checked in, or finished with equipment still out. */
export function awaitsReturnCheck(booking: ReturnFields): boolean {
  if (booking.checkInSelesai) return false;
  if (booking.status === 'disetujui') return true;
  if (booking.status === 'selesai') {
    return booking.fasilitasTambahan.length > 0 || (booking.fasilitasDiserahkan?.length ?? 0) > 0;
  }
  return false;
}

/** Whether the booking's last day and hour have passed, on the campus clock. */
export function isBookingEnded(
  booking: Pick<SimpelBooking, 'waktu' | 'jam' | 'sakuGroupDates'>,
  clock: { date: string; minutes: number } = jakartaNow(),
): boolean {
  const dates = booking.sakuGroupDates && booking.sakuGroupDates.length > 0 ? booking.sakuGroupDates : [booking.waktu];
  const lastDate = dates[dates.length - 1];
  if (!isValidDateString(lastDate)) return false;
  if (clock.date !== lastDate) return clock.date > lastDate;
  return clock.minutes >= jamRange(booking.jam).end;
}

export type ReturnStage = 'belum_diserahkan' | 'sudah_diserahkan' | 'sedang_dipakai' | 'siap_dikembalikan';

export const RETURN_STAGE_LABELS: Record<ReturnStage, string> = {
  belum_diserahkan: 'Belum diserahkan',
  sudah_diserahkan: 'Sudah diserahkan',
  sedang_dipakai: 'Sedang dipakai',
  siap_dikembalikan: 'Siap dikembalikan',
};

/** Port of SIMPEL's `returnStage`. */
export function returnStage(
  booking: ReturnFields,
  clock: { date: string; minutes: number } = jakartaNow(),
): ReturnStage {
  if (booking.peminjamSiapKembali || isBookingEnded(booking, clock)) return 'siap_dikembalikan';
  if (booking.peminjamDiterima) return 'sedang_dipakai';
  if (booking.serahTerimaSelesai) return 'sudah_diserahkan';
  return 'belum_diserahkan';
}

// ─── What the page receives ─────────────────────────────────────────────────

/** "28 Sep 2026", as SIMPEL shows dates. */
export function formatInspectionDate(waktu: string): string {
  if (!isValidDateString(waktu)) return waktu;
  const [year, month, day] = waktu.split('-').map(Number);
  return new Date(Date.UTC(year, month - 1, day)).toLocaleDateString('id-ID', {
    timeZone: 'UTC',
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
}

/** SIMPEL's `lokasiLabel`: a booking without a room takes the whole building. */
export function inspectionLocationLabel(booking: { gedung: string; ruangan: string }): string {
  return booking.ruangan && booking.ruangan !== '-'
    ? `${booking.ruangan} · ${booking.gedung}`
    : `Seluruh gedung · ${booking.gedung}`;
}

export interface ReturnInspectionView {
  id: string;
  kegiatan: string;
  pemohon: string;
  /** Who booked it in SAKU, when it came from SAKU. */
  ownerName: string | null;
  source: 'saku' | 'simpel';
  gedung: string;
  ruangan: string;
  waktu: string;
  jam: string;
  stage: ReturnStage;
  groupIndex: number | null;
  groupTotal: number | null;
  /** The date the event continues on, for a day that is not the last one. */
  nextGroupDate: string | null;
  checklist: InspectionChecklist;
}

export function toReturnInspectionView(
  booking: SimpelBooking,
  catalog: InspectionCatalog,
  clock: { date: string; minutes: number } = jakartaNow(),
): ReturnInspectionView {
  const index = booking.sakuGroupIndex ?? null;
  const total = booking.sakuGroupTotal ?? null;
  const nextGroupDate =
    index && total && index < total ? booking.sakuGroupDates?.[index] ?? null : null;
  return {
    id: booking.id,
    kegiatan: booking.kegiatan,
    pemohon: booking.pemohon,
    ownerName: booking.sakuDisplayName ?? null,
    source: booking.source === 'saku' ? 'saku' : 'simpel',
    gedung: booking.gedung,
    ruangan: booking.ruangan,
    waktu: booking.waktu,
    jam: booking.jam,
    stage: returnStage(booking, clock),
    groupIndex: index,
    groupTotal: total,
    nextGroupDate,
    checklist: buildInspectionChecklist(booking, catalog),
  };
}

const STAGE_ORDER: Record<ReturnStage, number> = {
  siap_dikembalikan: 0,
  sedang_dipakai: 1,
  sudah_diserahkan: 2,
  belum_diserahkan: 3,
};

/** Rooms ready to be checked first, the longest-waiting on top; later ones by date. */
export function compareReturnInspections(left: ReturnInspectionView, right: ReturnInspectionView): number {
  return (
    STAGE_ORDER[left.stage] - STAGE_ORDER[right.stage] ||
    left.waktu.localeCompare(right.waktu) ||
    jamRange(left.jam).start - jamRange(right.jam).start ||
    left.id.localeCompare(right.id)
  );
}

// ─── The check a Pekarya submits ────────────────────────────────────────────

export interface PermanentVerdict {
  key: string;
  /** null: not checked yet. */
  status: 'baik' | 'rusak' | null;
  qtyRusak?: number;
  condition?: DamageLevel;
  damageTypes?: string[];
}

export interface MobileVerdict {
  key: string;
  /** null: not checked yet. */
  status: 'lengkap' | 'selisih' | null;
  returnedQtyBaik?: number;
  condition?: DamageLevel;
  damageTypes?: string[];
}

export interface CheckInSubmission {
  bookingId: string;
  permanent: PermanentVerdict[];
  mobile: MobileVerdict[];
  roomCondition: RoomCondition | null;
  roomDamageTypes: string[];
  notes: string;
}

function textArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === 'string') : [];
}

function optionalInteger(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? Math.trunc(value) : undefined;
}

function damageLevel(value: unknown): DamageLevel | undefined {
  return (DAMAGE_LEVELS as readonly unknown[]).includes(value) ? (value as DamageLevel) : undefined;
}

/** Reads the request body; anything malformed becomes a value the validation below refuses. */
export function parseCheckInSubmission(body: unknown): CheckInSubmission {
  const data = record(body);
  const verdicts = (value: unknown) => (Array.isArray(value) ? value.map(record) : []);
  return {
    bookingId: text(data.bookingId),
    permanent: verdicts(data.permanent).map((item) => ({
      key: text(item.key),
      status: item.status === 'baik' || item.status === 'rusak' ? item.status : null,
      qtyRusak: optionalInteger(item.qtyRusak),
      condition: damageLevel(item.condition),
      damageTypes: textArray(item.damageTypes),
    })),
    mobile: verdicts(data.mobile).map((item) => ({
      key: text(item.key),
      status: item.status === 'lengkap' || item.status === 'selisih' ? item.status : null,
      returnedQtyBaik: optionalInteger(item.returnedQtyBaik),
      condition: damageLevel(item.condition),
      damageTypes: textArray(item.damageTypes),
    })),
    roomCondition: data.roomCondition === 'Maintenance' || data.roomCondition === 'Bersih' ? data.roomCondition : null,
    roomDamageTypes: textArray(data.roomDamageTypes),
    notes: typeof data.notes === 'string' ? data.notes.trim() : '',
  };
}

export interface CheckedPermanentItem extends PermanentCheckItem {
  status: 'baik' | 'rusak';
  qtyRusak: number;
  condition: DamageLevel;
  damageTypes: string[];
}

export interface CheckedMobileItem extends MobileCheckItem {
  status: 'lengkap' | 'selisih';
  returnedQtyBaik: number;
  returnedQtyRusak: number;
  condition: DamageLevel;
  damageTypes: string[];
}

export interface ResolvedCheckIn {
  permanent: CheckedPermanentItem[];
  mobile: CheckedMobileItem[];
  roomCondition: RoomCondition;
  roomDamageTypes: string[];
  notes: string;
}

export type CheckInValidation =
  | { ok: true; value: ResolvedCheckIn }
  | { ok: false; error: string; stale?: boolean };

const STALE_CHECKLIST =
  'Daftar fasilitas peminjaman ini berubah sejak formulir dibuka. Muat ulang halaman lalu periksa lagi.';

function pickDamageTypes(chosen: string[] | undefined, category: InspectionCategory): string[] | null {
  const allowed = DAMAGE_CHOICES[category];
  const unique = Array.from(new Set(chosen ?? []));
  return unique.every((choice) => allowed.includes(choice)) ? unique : null;
}

/**
 * Matches a submitted check to the checklist the server builds from SIMPEL's
 * current data. Every item must be decided, as SIMPEL's "Selesaikan
 * pemeriksaan" button requires; quantities are checked, not clamped.
 */
export function validateCheckInSubmission(
  submission: CheckInSubmission,
  checklist: InspectionChecklist,
): CheckInValidation {
  const fail = (error: string, stale = false): CheckInValidation => ({ ok: false, error, stale });

  const sameKeys = <T extends { key: string }>(items: readonly T[], verdicts: readonly { key: string }[]) =>
    items.length === verdicts.length &&
    new Set(verdicts.map((verdict) => verdict.key)).size === verdicts.length &&
    items.every((item) => verdicts.some((verdict) => verdict.key === item.key));
  if (!sameKeys(checklist.permanent, submission.permanent) || !sameKeys(checklist.mobile, submission.mobile)) {
    return fail(STALE_CHECKLIST, true);
  }

  const permanent: CheckedPermanentItem[] = [];
  for (const item of checklist.permanent) {
    const verdict = submission.permanent.find((entry) => entry.key === item.key)!;
    if (!verdict.status) {
      return fail(`${item.name} belum diperiksa.`);
    }
    if (verdict.status === 'baik') {
      permanent.push({ ...item, status: 'baik', qtyRusak: 0, condition: 'Rusak Ringan', damageTypes: [] });
      continue;
    }
    const qtyRusak = item.totalQty > 1 ? verdict.qtyRusak : 1;
    if (qtyRusak === undefined || qtyRusak < 1 || qtyRusak > item.totalQty) {
      return fail(`Jumlah unit ${item.name} yang bermasalah harus 1 sampai ${item.totalQty}.`);
    }
    const damageTypes = pickDamageTypes(verdict.damageTypes, item.category);
    if (!damageTypes) return fail(`Detail kerusakan ${item.name} tidak dikenal.`);
    permanent.push({
      ...item,
      status: 'rusak',
      qtyRusak,
      condition: verdict.condition ?? 'Rusak Ringan',
      damageTypes,
    });
  }

  const mobile: CheckedMobileItem[] = [];
  for (const item of checklist.mobile) {
    const verdict = submission.mobile.find((entry) => entry.key === item.key)!;
    if (!verdict.status) {
      return fail(`${item.name} belum diperiksa.`);
    }
    if (verdict.status === 'lengkap') {
      mobile.push({
        ...item,
        status: 'lengkap',
        returnedQtyBaik: item.borrowedQty,
        returnedQtyRusak: 0,
        condition: 'Rusak Ringan',
        damageTypes: [],
      });
      continue;
    }
    const returnedQtyBaik = verdict.returnedQtyBaik;
    if (returnedQtyBaik === undefined || returnedQtyBaik < 0 || returnedQtyBaik > item.borrowedQty) {
      return fail(`Jumlah ${item.name} yang kembali baik harus 0 sampai ${item.borrowedQty}.`);
    }
    const returnedQtyRusak = item.borrowedQty - returnedQtyBaik;
    const damageTypes = pickDamageTypes(verdict.damageTypes, item.category);
    if (!damageTypes) return fail(`Detail kerusakan ${item.name} tidak dikenal.`);
    mobile.push({
      ...item,
      status: 'selisih',
      returnedQtyBaik,
      returnedQtyRusak,
      condition: verdict.condition ?? 'Rusak Ringan',
      damageTypes: returnedQtyRusak > 0 ? damageTypes : [],
    });
  }

  if (!submission.roomCondition) return fail('Pilih kondisi kebersihan ruangan.');
  const roomDamageTypes = pickDamageTypes(submission.roomDamageTypes, 'Gedung');
  if (!roomDamageTypes) return fail('Detail kondisi ruangan tidak dikenal.');
  if (submission.notes.length > MAX_INSPECTION_NOTES_LENGTH) {
    return fail(`Catatan pemeriksaan maksimal ${MAX_INSPECTION_NOTES_LENGTH} karakter.`);
  }

  return {
    ok: true,
    value: {
      permanent,
      mobile,
      roomCondition: submission.roomCondition,
      roomDamageTypes: submission.roomCondition === 'Maintenance' ? roomDamageTypes : [],
      notes: submission.notes,
    },
  };
}

// ─── SIMPEL's repair log (`simpel_maintenance`) ─────────────────────────────

/**
 * What a SAKU log points at, so closing it can put back what the check took.
 * SIMPEL's own logs have none and are closed the way SIMPEL closes them.
 */
export type RepairTarget =
  | { kind: 'fixture'; buildingId: string | null; roomName: string; itemName: string }
  | { kind: 'building-item'; buildingId: string; itemName: string }
  | { kind: 'equipment'; equipmentId: string }
  | { kind: 'room'; buildingId: string | null; roomName: string }
  | { kind: 'other' };

export interface SimpelMaintenanceLog {
  id: string;
  bookingId?: string;
  fasilitasId: string;
  namaBarang: string;
  jumlah: number;
  kondisi: DamageLevel;
  keterangan: string;
  status: RepairStatus;
  tanggalLapor: string;
  penanggungJawab: string;
  // Extra fields. SAKU writes these; SIMPEL ignores them.
  source?: 'saku';
  sakuTarget?: RepairTarget;
  dilaporkanOleh?: string;
  dilaporkanOlehUid?: string;
  dilaporkanAt?: string;
  selesaiOleh?: string;
  selesaiOlehUid?: string;
  selesaiAt?: string;
}

function repairTarget(value: unknown): RepairTarget | undefined {
  const data = record(value);
  const nullableText = (key: string) => text(data[key]) || null;
  switch (data.kind) {
    case 'fixture':
      return { kind: 'fixture', buildingId: nullableText('buildingId'), roomName: text(data.roomName), itemName: text(data.itemName) };
    case 'building-item':
      return text(data.buildingId)
        ? { kind: 'building-item', buildingId: text(data.buildingId), itemName: text(data.itemName) }
        : undefined;
    case 'equipment':
      return text(data.equipmentId) ? { kind: 'equipment', equipmentId: text(data.equipmentId) } : undefined;
    case 'room':
      return { kind: 'room', buildingId: nullableText('buildingId'), roomName: text(data.roomName) };
    case 'other':
      return { kind: 'other' };
    default:
      return undefined;
  }
}

export function normalizeMaintenanceLog(id: string, raw: unknown): SimpelMaintenanceLog {
  const data = record(raw);
  const optionalText = (key: string) => text(data[key]) || undefined;
  return {
    id,
    bookingId: optionalText('bookingId'),
    fasilitasId: text(data.fasilitasId),
    namaBarang: text(data.namaBarang),
    jumlah: count(data.jumlah),
    kondisi: data.kondisi === 'Rusak Berat' ? 'Rusak Berat' : 'Rusak Ringan',
    keterangan: text(data.keterangan),
    status: data.status === 'Selesai' ? 'Selesai' : 'Dalam Perbaikan',
    tanggalLapor: text(data.tanggalLapor),
    penanggungJawab: text(data.penanggungJawab),
    source: data.source === 'saku' ? 'saku' : undefined,
    sakuTarget: repairTarget(data.sakuTarget),
    dilaporkanOleh: optionalText('dilaporkanOleh'),
    dilaporkanOlehUid: optionalText('dilaporkanOlehUid'),
    dilaporkanAt: optionalText('dilaporkanAt'),
    selesaiOleh: optionalText('selesaiOleh'),
    selesaiOlehUid: optionalText('selesaiOlehUid'),
    selesaiAt: optionalText('selesaiAt'),
  };
}

export interface RepairLogView {
  id: string;
  bookingId: string | null;
  namaBarang: string;
  jumlah: number;
  kondisi: DamageLevel;
  keterangan: string;
  status: RepairStatus;
  tanggalLapor: string;
  penanggungJawab: string;
  source: 'saku' | 'simpel';
  reportedBy: string | null;
  resolvedBy: string | null;
}

export function toRepairLogView(log: SimpelMaintenanceLog): RepairLogView {
  return {
    id: log.id,
    bookingId: log.bookingId ?? null,
    namaBarang: log.namaBarang,
    jumlah: log.jumlah,
    kondisi: log.kondisi,
    keterangan: log.keterangan,
    status: log.status,
    tanggalLapor: log.tanggalLapor,
    penanggungJawab: log.penanggungJawab,
    source: log.source === 'saku' ? 'saku' : 'simpel',
    reportedBy: log.dilaporkanOleh ?? null,
    resolvedBy: log.selesaiOleh ?? null,
  };
}

/** Open repairs first, then newest first (SIMPEL sorts by id, which starts with the time for SAKU's logs). */
export function compareRepairLogs(left: RepairLogView, right: RepairLogView): number {
  const openFirst = Number(left.status === 'Selesai') - Number(right.status === 'Selesai');
  return openFirst || right.tanggalLapor.localeCompare(left.tanggalLapor) || right.id.localeCompare(left.id);
}

// ─── Planning a check-in ────────────────────────────────────────────────────

/** A `simpel_gedung` document as stored, so its arrays can be written back whole. */
export interface RawBuilding {
  id: string;
  nama: string;
  ruanganList: unknown[];
  inventarisList: unknown[];
}

export function toRawBuilding(id: string, raw: unknown): RawBuilding {
  const data = record(raw);
  return {
    id,
    nama: text(data.nama),
    ruanganList: Array.isArray(data.ruanganList) ? data.ruanganList : [],
    inventarisList: Array.isArray(data.inventarisList) ? data.inventarisList : [],
  };
}

/** A `simpel_fasilitas` document's stock fields. */
export interface EquipmentStock {
  id: string;
  nama: string;
  totalStok: number;
  terpinjam: number;
  penanggungJawab: string;
  lokasiPenyimpanan: string;
}

export function toEquipmentStock(id: string, raw: unknown): EquipmentStock {
  const data = record(raw);
  return {
    id,
    nama: text(data.nama),
    totalStok: count(data.totalStok),
    terpinjam: count(data.terpinjam),
    penanggungJawab: text(data.penanggungJawab),
    lokasiPenyimpanan: text(data.lokasiPenyimpanan),
  };
}

export interface InspectionActor {
  uid: string;
  name: string;
}

export interface CheckInPlanInput {
  booking: SimpelBooking;
  inspection: ResolvedCheckIn;
  /** The booking's building, read inside the transaction; null when SIMPEL has none by that name. */
  building: RawBuilding | null;
  /** Every campus-wide item, read inside the transaction. */
  equipment: EquipmentStock[];
  actor: InspectionActor;
  now: Date;
  /** A fresh, unique suffix for each new log id. */
  newId: () => string;
}

export interface DocumentPatch {
  id: string;
  patch: Record<string, unknown>;
}

export interface CheckInPlan {
  bookingPatch: Record<string, unknown>;
  equipmentPatches: DocumentPatch[];
  buildingPatch: DocumentPatch | null;
  logs: SimpelMaintenanceLog[];
  notifications: NotificationDraft[];
  /** One line per problem found, for the confirmation and the borrower's notice. */
  damageSummaries: string[];
}

function damageLabel(condition: DamageLevel): string {
  return condition === 'Rusak Berat' ? 'Rusak/Hilang' : 'Rusak Ringan';
}

function describeDamage(damageTypes: string[], notes: string, fallback: string): string {
  const detail = damageTypes.length > 0 ? `[Detail: ${damageTypes.join(', ')}]` : '';
  return `${detail} ${notes || fallback}`.trim();
}

/** SIMPEL's address for a borrower's bell: the name, letters and digits only. */
export function borrowerNotificationEmail(pemohon: string): string {
  return `${pemohon.toLowerCase().replace(/[^a-z0-9]/g, '') || 'pemohon'}@unipdu.ac.id`;
}

function jakartaTimestamp(date: Date): string {
  return date.toLocaleString('id-ID', { timeZone: VENUE_TIME_ZONE });
}

/**
 * Everything a check-in writes, worked out from data read inside the
 * transaction. Port of SIMPEL's `submitCheckIn`:
 *  - the booking becomes `selesai` with `checkInSelesai`;
 *  - a damaged fixture is logged for Teknisi;
 *  - borrowed building equipment: damage logged; "Rusak Berat" units leave the building's stock;
 *  - borrowed campus equipment: `terpinjam` drops by what was borrowed; damage logged;
 *    "Rusak Berat" units leave `totalStok`; `tersedia` is recomputed;
 *  - a room needing care is set to "Maintenance" (no new bookings) and logged for Kebersihan.
 */
export function planCheckIn(input: CheckInPlanInput): CheckInPlan {
  const { booking, inspection, building, actor, now } = input;
  const nowIso = now.toISOString();
  const today = jakartaNow(now).date;
  const notes = inspection.notes;
  const logs: SimpelMaintenanceLog[] = [];
  const notifications: NotificationDraft[] = [];
  const damageSummaries: string[] = [];

  const newLog = (
    prefix: string,
    fields: Pick<SimpelMaintenanceLog, 'fasilitasId' | 'namaBarang' | 'jumlah' | 'kondisi' | 'keterangan' | 'penanggungJawab' | 'sakuTarget'>,
  ): SimpelMaintenanceLog => {
    const log: SimpelMaintenanceLog = {
      id: `${prefix}-${input.newId()}`,
      bookingId: booking.id,
      ...fields,
      status: 'Dalam Perbaikan',
      tanggalLapor: today,
      source: 'saku',
      dilaporkanOleh: actor.name,
      dilaporkanOlehUid: actor.uid,
      dilaporkanAt: nowIso,
    };
    logs.push(log);
    return log;
  };

  const email = (to: string, subject: string, title: string, intro: string, details: { label: string; value: string }[], alert?: string) =>
    notifications.push({ to, subject, bodyHtml: buildSimpelEmailHtml(title, intro, details, alert, SAKU_EMAIL_FOOTER) });

  // A. Fixtures built into the room.
  for (const item of inspection.permanent) {
    if (item.status !== 'rusak') continue;
    const keterangan = describeDamage(
      item.damageTypes,
      notes,
      `Kerusakan fasilitas bawaan ruangan dilaporkan saat pengembalian ${booking.id}`,
    );
    newLog('MNT-FIX', {
      fasilitasId: `FIX-${slug(booking.ruangan)}-${slug(item.name)}`,
      namaBarang: `Fasilitas Ruangan: ${item.name} (${booking.ruangan})`,
      jumlah: item.qtyRusak,
      kondisi: item.condition,
      keterangan,
      penanggungJawab: 'Penanggung Jawab Gedung & Teknisi',
      sakuTarget: { kind: 'fixture', buildingId: building?.id ?? null, roomName: booking.ruangan, itemName: item.name },
    });
    damageSummaries.push(`Fasilitas ruangan: ${item.qtyRusak}x ${item.name} (${damageLabel(item.condition)})`);
    email(
      SIMPEL_FIELD_STAFF_EMAIL,
      `[SIMPEL] Perbaikan Fasilitas Ruangan: ${item.name}`,
      'Tugas Servis Fasilitas Ruangan',
      `Yth. Tim Pemeliharaan & Teknisi, fasilitas bawaan ruangan dilaporkan bermasalah saat pemeriksaan pengembalian ${booking.id}.`,
      [
        { label: 'Nomor PJM', value: booking.id },
        { label: 'Ruangan & Gedung', value: `${booking.gedung} - ${booking.ruangan}` },
        { label: 'Fasilitas', value: `${item.qtyRusak}x ${item.name} (dari total ${item.totalQty} unit)` },
        { label: 'Tingkat Kerusakan', value: item.condition },
        { label: 'Detail Kerusakan', value: keterangan },
        { label: 'Diperiksa Oleh', value: actor.name },
        { label: 'Status', value: 'RUSAK / BUTUH SERVIS' },
      ],
    );
  }

  // B. Borrowed equipment: the building's own first, then campus-wide stock.
  const inventory = building ? building.inventarisList.map((item) => ({ ...record(item) })) : [];
  let inventoryChanged = false;
  const stock = new Map(input.equipment.map((item) => [item.id, { ...item }]));
  const changedStock = new Set<string>();

  for (const item of inspection.mobile) {
    const keterangan = describeDamage(
      item.damageTypes,
      notes,
      `Kerusakan/hilang dilaporkan saat pengembalian ${booking.id}`,
    );
    const buildingItem = building ? findByName(inventory, item.name, (entry) => text(entry.nama)) : undefined;

    if (building && buildingItem) {
      if (item.returnedQtyRusak <= 0) continue;
      const itemName = text(buildingItem.nama);
      const log = newLog('MNT', {
        fasilitasId: `GDG-${slug(booking.gedung)}-${slug(itemName)}`,
        namaBarang: `${booking.gedung} - ${itemName}`,
        jumlah: item.returnedQtyRusak,
        kondisi: item.condition,
        keterangan,
        penanggungJawab: 'Penanggung Jawab Gedung & Logistik',
        sakuTarget: { kind: 'building-item', buildingId: building.id, itemName },
      });
      if (item.condition === 'Rusak Berat') {
        buildingItem.jumlah = Math.max(0, count(buildingItem.jumlah) - item.returnedQtyRusak);
        inventoryChanged = true;
      }
      damageSummaries.push(`${item.returnedQtyRusak}x ${itemName} (${damageLabel(item.condition)})`);
      email(
        SIMPEL_FIELD_STAFF_EMAIL,
        `[SIMPEL] Perbaikan Diperlukan (Gedung): ${log.id}`,
        'Tugas Pemeliharaan Barang Baru',
        `Yth. Tim Pemeliharaan & Logistik, terdapat laporan barang rusak/kurang (inventaris gedung) saat pengembalian peminjaman ${booking.id}.`,
        [
          { label: 'ID Log Servis', value: log.id },
          { label: 'Nama Barang', value: log.namaBarang },
          { label: 'Jumlah Unit', value: `${item.returnedQtyRusak} unit` },
          { label: 'Kondisi', value: item.condition },
          { label: 'Keterangan', value: keterangan },
          { label: 'Diperiksa Oleh', value: actor.name },
        ],
      );
      continue;
    }

    const match = findByName(input.equipment, item.name, (entry) => entry.nama);
    if (match) {
      const current = stock.get(match.id)!;
      current.terpinjam = Math.max(0, current.terpinjam - item.borrowedQty);
      changedStock.add(match.id);
      if (item.returnedQtyRusak > 0) {
        const log = newLog('MNT', {
          fasilitasId: match.id,
          namaBarang: match.nama,
          jumlah: item.returnedQtyRusak,
          kondisi: item.condition,
          keterangan,
          penanggungJawab: match.penanggungJawab || 'Penanggung Jawab Logistik',
          sakuTarget: { kind: 'equipment', equipmentId: match.id },
        });
        if (item.condition === 'Rusak Berat') {
          current.totalStok = Math.max(0, current.totalStok - item.returnedQtyRusak);
        }
        damageSummaries.push(`${item.returnedQtyRusak}x ${match.nama} (${damageLabel(item.condition)})`);
        email(
          SIMPEL_FIELD_STAFF_EMAIL,
          `[SIMPEL] Perbaikan Diperlukan: ${log.id}`,
          'Tugas Pemeliharaan Barang Baru',
          `Yth. Tim Pemeliharaan & Logistik, terdapat laporan barang rusak/kurang saat pengembalian peminjaman ${booking.id}.`,
          [
            { label: 'ID Log Servis', value: log.id },
            { label: 'Nama Barang', value: match.nama },
            { label: 'Jumlah Unit', value: `${item.returnedQtyRusak} unit` },
            { label: 'Kondisi', value: item.condition },
            { label: 'Keterangan', value: keterangan },
            { label: 'Diperiksa Oleh', value: actor.name },
          ],
        );
      }
      continue;
    }

    // In no catalog: SIMPEL drops this damage silently; it is logged here so it is not lost.
    if (item.returnedQtyRusak > 0) {
      const log = newLog('MNT', {
        fasilitasId: `LAIN-${slug(item.name)}`,
        namaBarang: item.name,
        jumlah: item.returnedQtyRusak,
        kondisi: item.condition,
        keterangan,
        penanggungJawab: 'Biro Umum / Logistik',
        sakuTarget: { kind: 'other' },
      });
      damageSummaries.push(`${item.returnedQtyRusak}x ${item.name} (${damageLabel(item.condition)})`);
      email(
        SIMPEL_FIELD_STAFF_EMAIL,
        `[SIMPEL] Perbaikan Diperlukan: ${log.id}`,
        'Tugas Pemeliharaan Barang Baru',
        `Yth. Tim Pemeliharaan & Logistik, terdapat laporan barang rusak/kurang saat pengembalian peminjaman ${booking.id}. Barang ini tidak ditemukan di daftar fasilitas SIMPEL.`,
        [
          { label: 'ID Log Servis', value: log.id },
          { label: 'Nama Barang', value: item.name },
          { label: 'Jumlah Unit', value: `${item.returnedQtyRusak} unit` },
          { label: 'Kondisi', value: item.condition },
          { label: 'Keterangan', value: keterangan },
          { label: 'Diperiksa Oleh', value: actor.name },
        ],
      );
    }
  }

  // C. The room itself.
  let rooms: Record<string, unknown>[] | null = null;
  if (inspection.roomCondition === 'Maintenance') {
    const keterangan = describeDamage(
      inspection.roomDamageTypes,
      notes,
      'Ruangan dilaporkan kotor / butuh perawatan pasca kegiatan.',
    );
    const roomIndex = building
      ? building.ruanganList.findIndex((room) => lower(text(record(room).nama)) === lower(booking.ruangan))
      : -1;
    if (building && roomIndex >= 0) {
      rooms = building.ruanganList.map((room) => ({ ...record(room) }));
      rooms[roomIndex].status = 'Maintenance';
    }
    newLog('MNT-RM', {
      fasilitasId: `ROOM-${slug(booking.ruangan)}`,
      namaBarang: `Ruangan: ${booking.gedung} - ${booking.ruangan}`,
      jumlah: 1,
      kondisi: 'Rusak Ringan',
      keterangan,
      penanggungJawab: 'Biro Umum / Kebersihan',
      sakuTarget: { kind: 'room', buildingId: building?.id ?? null, roomName: booking.ruangan },
    });
    damageSummaries.push(
      rooms
        ? `Ruangan ${booking.ruangan} dinonaktifkan (Status: Maintenance)`
        : `Ruangan ${booking.ruangan} butuh pembersihan / perawatan`,
    );
    email(
      SIMPEL_FIELD_STAFF_EMAIL,
      `[SIMPEL] Perawatan Ruangan Diperlukan: ${booking.ruangan}`,
      'Tugas Pemeliharaan Ruang Baru',
      `Yth. Tim Kebersihan & Pemeliharaan, ruangan ${booking.ruangan} di ${booking.gedung} dilaporkan memerlukan pembersihan mendalam / perbaikan fasilitas bawaan.`,
      [
        { label: 'Nomor PJM', value: booking.id },
        { label: 'Gedung & Ruang', value: `${booking.gedung} - ${booking.ruangan}` },
        { label: 'Keterangan', value: keterangan },
        { label: 'Diperiksa Oleh', value: actor.name },
        { label: 'Status Baru', value: rooms ? 'MAINTENANCE (DINONAKTIFKAN)' : 'BUTUH PERAWATAN' },
      ],
    );
  }

  // D. The borrower's notice.
  const hasDamage = damageSummaries.length > 0;
  email(
    borrowerNotificationEmail(booking.pemohon),
    hasDamage
      ? `[SIMPEL] Pengembalian Fasilitas Selesai dengan Catatan: PJM ${booking.id}`
      : `[SIMPEL] Pengembalian Sukses & Lengkap: PJM ${booking.id}`,
    hasDamage ? 'Pemeriksaan Pengembalian (Kerusakan/Selisih Terdeteksi)' : 'Laporan Pengembalian Sukses & Lengkap',
    hasDamage
      ? `Halo ${booking.pemohon}, pengembalian fasilitas untuk kegiatan "${booking.kegiatan}" telah diverifikasi oleh petugas. Terdapat catatan kerusakan atau barang kurang.`
      : `Halo ${booking.pemohon}, seluruh fasilitas yang Anda pinjam untuk kegiatan "${booking.kegiatan}" telah kembali dengan lengkap, tepat jumlah, dan kondisi baik. Terima kasih atas kerja samanya.`,
    [
      { label: 'Nomor PJM', value: booking.id },
      { label: 'Waktu Check-in', value: jakartaTimestamp(now) },
      { label: 'Petugas Pemeriksa', value: actor.name },
      { label: 'Status Pengembalian', value: hasDamage ? 'SELESAI DENGAN CATATAN' : 'LENGKAP & BERSIH' },
      { label: 'Rincian Masalah', value: hasDamage ? damageSummaries.join(', ') : 'Tidak ada (Semua Sesuai)' },
    ],
    hasDamage
      ? 'Harap berkoordinasi dengan pihak Biro Umum atau Penanggung Jawab Logistik terkait penyelesaian administrasi atau denda ganti rugi barang yang bersangkutan.'
      : 'Akun peminjaman Anda saat ini memiliki reputasi yang baik. Sampai jumpa di kegiatan peminjaman selanjutnya!',
  );

  const equipmentPatches = Array.from(changedStock).map((id) => {
    const item = stock.get(id)!;
    return {
      id,
      patch: {
        terpinjam: item.terpinjam,
        totalStok: item.totalStok,
        tersedia: Math.max(0, item.totalStok - item.terpinjam),
      },
    };
  });

  const buildingFields: Record<string, unknown> = {};
  if (inventoryChanged) buildingFields.inventarisList = inventory;
  if (rooms) buildingFields.ruanganList = rooms;

  return {
    bookingPatch: {
      status: 'selesai',
      checkInSelesai: true,
      checkInAt: nowIso,
      checkInOleh: actor.name,
      checkInOlehUid: actor.uid,
      checkInSource: 'saku',
      ...(notes ? { checkInCatatan: notes } : {}),
    },
    equipmentPatches,
    buildingPatch: building && Object.keys(buildingFields).length > 0 ? { id: building.id, patch: buildingFields } : null,
    logs,
    notifications,
    damageSummaries,
  };
}

// ─── Closing a repair ───────────────────────────────────────────────────────

export interface RepairResolutionInput {
  log: SimpelMaintenanceLog;
  /** The campus item whose id is the log's `fasilitasId`, if any (SIMPEL's rule). */
  equipment: EquipmentStock | null;
  /** The building a SAKU log points at, when closing it changes the building. */
  building: RawBuilding | null;
  /** Other open logs for the same room; the room stays closed until the last one is done. */
  otherOpenRoomLogs: number;
  actor: InspectionActor;
  now: Date;
}

export interface RepairResolutionPlan {
  logPatch: Record<string, unknown>;
  equipmentPatch: DocumentPatch | null;
  buildingPatch: DocumentPatch | null;
  notifications: NotificationDraft[];
  /** What was put back, for the confirmation. */
  restored: string[];
}

/**
 * Port of SIMPEL's `handleResolveRepair`: the log becomes "Selesai" and a
 * campus item's "Rusak Berat" units go back into `totalStok`. For a log SAKU
 * wrote, building stock taken for "Rusak Berat" goes back too, and a room is
 * reopened for bookings once its last open log is closed.
 */
export function planRepairResolution(input: RepairResolutionInput): RepairResolutionPlan {
  const { log, equipment, building, actor, now } = input;
  const restored: string[] = [];
  let equipmentPatch: DocumentPatch | null = null;
  let buildingPatch: DocumentPatch | null = null;

  if (equipment && equipment.id === log.fasilitasId) {
    const totalStok = equipment.totalStok + (log.kondisi === 'Rusak Berat' ? log.jumlah : 0);
    equipmentPatch = {
      id: equipment.id,
      patch: { totalStok, tersedia: Math.max(0, totalStok - equipment.terpinjam) },
    };
    if (log.kondisi === 'Rusak Berat') restored.push(`${log.jumlah} unit ${equipment.nama} kembali ke stok`);
  }

  const target = log.source === 'saku' ? log.sakuTarget : undefined;
  if (target && building) {
    if (target.kind === 'building-item' && target.buildingId === building.id && log.kondisi === 'Rusak Berat') {
      const inventory = building.inventarisList.map((item) => ({ ...record(item) }));
      const item = inventory.find((entry) => lower(text(entry.nama)) === lower(target.itemName));
      if (item) {
        item.jumlah = count(item.jumlah) + log.jumlah;
        buildingPatch = { id: building.id, patch: { inventarisList: inventory } };
        restored.push(`${log.jumlah} unit ${text(item.nama)} kembali ke inventaris ${building.nama}`);
      }
    }
    if (target.kind === 'room' && target.buildingId === building.id && input.otherOpenRoomLogs === 0) {
      const rooms = building.ruanganList.map((room) => ({ ...record(room) }));
      const room = rooms.find((entry) => lower(text(entry.nama)) === lower(target.roomName));
      if (room && lower(text(room.status)) === 'maintenance') {
        room.status = 'Tersedia';
        buildingPatch = { id: building.id, patch: { ruanganList: rooms } };
        restored.push(`Ruangan ${text(room.nama)} kembali tersedia`);
      }
    }
  }

  const details = [
    { label: 'ID Log Servis', value: log.id },
    { label: 'Nama Barang', value: log.namaBarang },
    { label: 'Jumlah', value: `${log.jumlah} unit` },
    { label: 'Diselesaikan Oleh', value: actor.name },
    { label: 'Hasil', value: restored.length > 0 ? restored.join('; ') : 'Selesai diperbaiki' },
  ];
  if (equipment?.lokasiPenyimpanan) details.push({ label: 'Lokasi Penyimpanan', value: equipment.lokasiPenyimpanan });

  return {
    logPatch: {
      status: 'Selesai',
      selesaiAt: now.toISOString(),
      selesaiOleh: actor.name,
      selesaiOlehUid: actor.uid,
    },
    equipmentPatch,
    buildingPatch,
    notifications: [
      {
        to: SIMPEL_BIRO_UMUM_EMAIL,
        subject: `[SIMPEL] Pemeliharaan Selesai: ${log.id}`,
        bodyHtml: buildSimpelEmailHtml(
          'Notifikasi Pemeliharaan Selesai',
          'Informasi bahwa barang atau ruangan yang terdaftar di log pemeliharaan telah selesai diperbaiki melalui aplikasi SAKU.',
          details,
          undefined,
          SAKU_EMAIL_FOOTER,
        ),
      },
    ],
    restored,
  };
}
