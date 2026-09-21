/**
 * Venue reservations: a Kepala SatKer Loyalis books a campus room (plus extra
 * equipment) in SIMPEL UNIPDU, the campus facility-lending app, from inside
 * SAKU.
 *
 * SIMPEL owns the data (its own Firebase project, see `@/lib/simpel-admin`) and
 * its staff do the physical work: Pekarya hand over keys and equipment, then
 * check them back in. SAKU only writes bookings into SIMPEL's collections, in
 * exactly the shape SIMPEL's own pages read and write (`SimpelBooking`), plus a
 * few extra fields SIMPEL ignores.
 *
 * A reservation is approved automatically when the room and equipment are free
 * for the requested hours, so these rules are the only check a booking gets
 * before Pekarya act on it. They mirror SIMPEL's own checks
 * (`checkRoomConflict` / `checkFacilityStockAvailability` in its pages and
 * `src/app/utils/timeSlots.ts` in the simpel-unipdu repo), so both apps agree on
 * what "free" means. Where the two differ, SAKU is the stricter one.
 *
 * Firebase-free: shared by the API routes and the page, and unit-tested.
 */

export const VENUE_RESERVATION_PATH = '/dashboard/reservasi-ruang';

export function isVenueReservationPath(pathname: string): boolean {
  return pathname === VENUE_RESERVATION_PATH || pathname.startsWith(`${VENUE_RESERVATION_PATH}/`);
}

/** SIMPEL's inboxes. Its in-app bell shows notifications addressed to these. */
export const SIMPEL_BIRO_UMUM_EMAIL = 'biroumum@unipdu.ac.id';
export const SIMPEL_FIELD_STAFF_EMAIL = 'maintenance@unipdu.ac.id';
const SIMPEL_SENDER_EMAIL = 'simpel-system@unipdu.ac.id';

export const VENUE_TIME_ZONE = 'Asia/Jakarta';
export const MAX_KEGIATAN_LENGTH = 150;
export const MAX_PEMOHON_LENGTH = 120;
export const MAX_CANCEL_REASON_LENGTH = 300;
export const MAX_EQUIPMENT_LINES = 30;
export const RESERVATION_HORIZON_DAYS = 366;

// ─── SIMPEL data shapes ─────────────────────────────────────────────────────

/** Every status SIMPEL uses. SAKU reservations start at `disetujui`. */
export type SimpelBookingStatus =
  | 'menunggu_bak'
  | 'menunggu_biro_umum'
  | 'menunggu_konfirmasi_mhs'
  | 'direvisi_mhs'
  | 'disetujui'
  | 'ditolak'
  | 'selesai'
  | 'dikembalikan';

/** A document in SIMPEL's `simpel_bookings`, as SIMPEL's pages read it. */
export interface SimpelBooking {
  id: string;
  pemohon: string;
  tipePemohon: string;
  kontak: string;
  gedung: string;
  ruangan: string;
  /** YYYY-MM-DD */
  waktu: string;
  /** Free text, e.g. "08:00 - 10:00" or "07:30 - 11:45 WIB". */
  jam: string;
  kegiatan: string;
  /** A `SimpelBookingStatus`, kept as a string so unknown values survive a read. */
  status: string;
  /** Lines like "500x Kursi Lipat Plastik (Chitose)". */
  fasilitasTambahan: string[];
  tanggalDibuat: string;
  createdByEmail?: string;
  alasanPenolakan?: string;
  fasilitasDiserahkan?: string[];
  serahTerimaSelesai?: boolean;
  peminjamDiterima?: boolean;
  peminjamSiapKembali?: boolean;
  // Extra fields. SAKU writes these; SIMPEL only reads `source` and `cancelledBy`.
  source?: string;
  sakuUid?: string;
  sakuRole?: string;
  sakuDisplayName?: string;
  sakuEventId?: string;
  autoApproved?: boolean;
  createdAt?: string;
  cancelledBy?: 'pemohon' | 'biro_umum';
  cancelledAt?: string;
  peminjamDiterimaAt?: string;
  peminjamSiapKembaliAt?: string;
}

/** The fields the availability rules need from a booking. */
export type BookingSlot = Pick<
  SimpelBooking,
  'id' | 'status' | 'waktu' | 'jam' | 'gedung' | 'ruangan' | 'fasilitasTambahan'
>;

export interface SimpelRoom {
  nama: string;
  tipe: string;
  kapasitas: number | null;
  lantai: number | null;
  /** "Tersedia" | "Digunakan" | "Maintenance" */
  status: string;
  /** Built-in facilities, handed over automatically with the room. */
  fasilitasBawaan: string[];
}

export interface SimpelInventoryItem {
  nama: string;
  jumlah: number;
  kondisi: string;
}

/** A document in `simpel_gedung`, without its (large, base64) photos. */
export interface SimpelBuilding {
  id: string;
  nama: string;
  singkatan: string;
  lokasi: string;
  ruanganList: SimpelRoom[];
  /** Equipment kept in (and only lent within) this building. */
  inventarisList: SimpelInventoryItem[];
}

/** A document in `simpel_fasilitas`: campus-wide equipment. */
export interface SimpelEquipment {
  id: string;
  nama: string;
  kategori: string;
  totalStok: number;
}

// ─── Reading SIMPEL documents defensively ───────────────────────────────────

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function wholeNumber(value: unknown): number | null {
  const number = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(number) ? Math.floor(number) : null;
}

function textList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.map(text).filter(Boolean);
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' ? (value as Record<string, unknown>) : {};
}

export function normalizeSimpelBuilding(id: string, raw: unknown): SimpelBuilding {
  const data = record(raw);
  const rooms = Array.isArray(data.ruanganList) ? data.ruanganList : [];
  const items = Array.isArray(data.inventarisList) ? data.inventarisList : [];
  return {
    id,
    nama: text(data.nama),
    singkatan: text(data.singkatan),
    lokasi: text(data.lokasi),
    ruanganList: rooms
      .map(record)
      .map((room) => ({
        nama: text(room.nama),
        tipe: text(room.tipe),
        kapasitas: wholeNumber(room.kapasitas),
        lantai: wholeNumber(room.lantai),
        status: text(room.status) || 'Tersedia',
        fasilitasBawaan: textList(room.fasilitasBawaan),
      }))
      .filter((room) => room.nama),
    inventarisList: items
      .map(record)
      .map((item) => ({
        nama: text(item.nama),
        jumlah: Math.max(0, wholeNumber(item.jumlah) ?? 0),
        kondisi: text(item.kondisi),
      }))
      .filter((item) => item.nama),
  };
}

export function normalizeSimpelEquipment(id: string, raw: unknown): SimpelEquipment {
  const data = record(raw);
  return {
    id,
    nama: text(data.nama),
    kategori: text(data.kategori),
    totalStok: Math.max(0, wholeNumber(data.totalStok) ?? 0),
  };
}

export function normalizeSimpelBooking(id: string, raw: unknown): SimpelBooking {
  const data = record(raw);
  const optionalText = (key: string) => text(data[key]) || undefined;
  const optionalFlag = (key: string) => (data[key] === true ? true : undefined);
  const cancelledBy = data.cancelledBy === 'pemohon' || data.cancelledBy === 'biro_umum'
    ? data.cancelledBy
    : undefined;
  return {
    id,
    pemohon: text(data.pemohon),
    tipePemohon: text(data.tipePemohon),
    kontak: text(data.kontak),
    gedung: text(data.gedung),
    ruangan: text(data.ruangan),
    waktu: text(data.waktu),
    jam: text(data.jam),
    kegiatan: text(data.kegiatan),
    status: text(data.status),
    fasilitasTambahan: textList(data.fasilitasTambahan),
    tanggalDibuat: text(data.tanggalDibuat),
    createdByEmail: optionalText('createdByEmail'),
    alasanPenolakan: optionalText('alasanPenolakan'),
    fasilitasDiserahkan: Array.isArray(data.fasilitasDiserahkan) ? textList(data.fasilitasDiserahkan) : undefined,
    serahTerimaSelesai: optionalFlag('serahTerimaSelesai'),
    peminjamDiterima: optionalFlag('peminjamDiterima'),
    peminjamSiapKembali: optionalFlag('peminjamSiapKembali'),
    source: optionalText('source'),
    sakuUid: optionalText('sakuUid'),
    sakuRole: optionalText('sakuRole'),
    sakuDisplayName: optionalText('sakuDisplayName'),
    sakuEventId: optionalText('sakuEventId'),
    autoApproved: optionalFlag('autoApproved'),
    createdAt: optionalText('createdAt'),
    cancelledBy,
    cancelledAt: optionalText('cancelledAt'),
    peminjamDiterimaAt: optionalText('peminjamDiterimaAt'),
    peminjamSiapKembaliAt: optionalText('peminjamSiapKembaliAt'),
  };
}

/** Firestore rejects `undefined`; drop those keys before any write. */
export function withoutUndefined<T extends object>(value: T): T {
  return Object.fromEntries(
    Object.entries(value).filter(([, entry]) => entry !== undefined),
  ) as T;
}

// ─── Venue photos ───────────────────────────────────────────────────────────

/** SIMPEL keeps its photos inside the documents, as small embedded images (a few tens of KB each). */
const PHOTO_DATA_URL = /^data:image\/(?:png|jpe?g|webp|gif);base64,[A-Za-z0-9+/=]+$/;
const PHOTO_HTTPS_URL = /^https:\/\/[^\s"'<>]+$/;
export const MAX_PHOTO_CHARS = 300_000;

/**
 * The first usable photo among the candidates (single values or lists). Only
 * embedded raster images and https links qualify, since the value goes straight
 * into an <img>, and an oversized one would weigh down every reservation form.
 */
export function pickVenuePhoto(...candidates: unknown[]): string | null {
  for (const candidate of candidates.flat()) {
    if (typeof candidate !== 'string') continue;
    const value = candidate.trim();
    if (!value || value.length > MAX_PHOTO_CHARS) continue;
    if (PHOTO_DATA_URL.test(value) || PHOTO_HTTPS_URL.test(value)) return value;
  }
  return null;
}

/** One cover photo per building and per room, keyed the way the form and cards look them up. */
export interface VenuePhotos {
  buildings: Record<string, string | null>;
  /** building id → room name → photo */
  rooms: Record<string, Record<string, string | null>>;
  /** normalized building name or abbreviation → building cover photo */
  byBuildingName?: Record<string, string | null>;
  /** normalized building name or abbreviation → normalized room name → room photo */
  byRoomName?: Record<string, Record<string, string | null>>;
}

export function normVenueKey(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, ' ');
}

export function buildVenuePhotos(docs: { id: string; data: unknown }[]): VenuePhotos {
  const photos: VenuePhotos = {
    buildings: {},
    rooms: {},
    byBuildingName: {},
    byRoomName: {},
  };
  for (const { id, data } of docs) {
    const doc = record(data);
    const buildingPhoto = pickVenuePhoto(doc.imageUrl, doc.images);
    photos.buildings[id] = buildingPhoto;

    const buildingName = text(doc.nama);
    const buildingAbbr = text(doc.singkatan);
    const buildingKeys = [
      buildingName ? normVenueKey(buildingName) : '',
      buildingAbbr ? normVenueKey(buildingAbbr) : '',
    ].filter(Boolean);

    for (const key of buildingKeys) {
      photos.byBuildingName![key] = buildingPhoto;
    }

    const rooms: Record<string, string | null> = {};
    const normRooms: Record<string, string | null> = {};
    for (const entry of Array.isArray(doc.ruanganList) ? doc.ruanganList : []) {
      const room = record(entry);
      const name = text(room.nama);
      if (name) {
        const roomPhoto = pickVenuePhoto(room.images, room.imageUrl);
        rooms[name] = roomPhoto;
        normRooms[normVenueKey(name)] = roomPhoto;
      }
    }
    photos.rooms[id] = rooms;
    for (const key of buildingKeys) {
      photos.byRoomName![key] = { ...normRooms };
    }
  }
  return photos;
}

/**
 * Resolves the best available photo for a venue reservation.
 * Tries the specific room photo first, then falls back to the building cover photo.
 */
export function resolveVenuePhoto(
  photos: VenuePhotos | null | undefined,
  gedung: string,
  ruangan?: string,
): string | null {
  if (!photos) return null;
  const gKey = normVenueKey(gedung || '');
  const rKey = ruangan ? normVenueKey(ruangan) : '';

  // 1. Check room photo via building name or abbreviation
  if (rKey && photos.byRoomName?.[gKey]?.[rKey]) {
    return photos.byRoomName[gKey][rKey];
  }

  // 2. Check room photo via building ID
  if (rKey && photos.rooms?.[gedung]?.[ruangan!]) {
    return photos.rooms[gedung][ruangan!];
  }

  // 3. Fallback: search across buildings for the room name if building name slightly differs
  if (rKey && photos.byRoomName) {
    for (const [bKey, roomMap] of Object.entries(photos.byRoomName)) {
      if ((bKey.includes(gKey) || gKey.includes(bKey)) && roomMap[rKey]) {
        return roomMap[rKey];
      }
    }
  }

  // 4. Fallback: building photo via building name or abbreviation
  if (photos.byBuildingName?.[gKey]) {
    return photos.byBuildingName[gKey];
  }

  // 5. Fallback: partial match on building name
  if (photos.byBuildingName) {
    for (const [bKey, photo] of Object.entries(photos.byBuildingName)) {
      if ((bKey.includes(gKey) || gKey.includes(bKey)) && photo) {
        return photo;
      }
    }
  }

  // 6. Fallback: building photo via building ID
  if (photos.buildings?.[gedung]) {
    return photos.buildings[gedung];
  }

  return null;
}

// ─── Time ───────────────────────────────────────────────────────────────────

export interface TimeRange {
  /** Minutes since midnight. */
  start: number;
  end: number;
}

const MINUTES_PER_DAY = 24 * 60;
export const WHOLE_DAY: TimeRange = { start: 0, end: MINUTES_PER_DAY };
const JAM_PATTERN = /^(\d{1,2})[:.](\d{2})\s*-\s*(\d{1,2})[:.](\d{2})$/;
const CLOCK_PATTERN = /^([01]\d|2[0-3]):([0-5]\d)$/;

/**
 * Reads SIMPEL's free-text `jam`. Returns null when it can't: callers treat that
 * as the whole day, so an unreadable entry can block too much but never lets a
 * clash through.
 */
export function parseJam(jam: string | null | undefined): TimeRange | null {
  if (!jam) return null;
  const normalized = jam
    .replace(/wib/gi, '')
    .replace(/[‒-―]/g, '-')
    .replace(/\s*(s\/d|s\.d\.?|sampai(\s+dengan)?)\s*/gi, ' - ')
    .trim();
  const match = normalized.match(JAM_PATTERN);
  if (!match) return null;

  const [startHour, startMinute, endHour, endMinute] = match.slice(1).map(Number);
  if (startMinute > 59 || endMinute > 59) return null;
  const start = startHour * 60 + startMinute;
  const end = endHour * 60 + endMinute;
  if (start >= MINUTES_PER_DAY || end > MINUTES_PER_DAY || end <= start) return null;
  return { start, end };
}

export function jamRange(jam: string | null | undefined): TimeRange {
  return parseJam(jam) ?? WHOLE_DAY;
}

/** Touching ends do not clash: 08:00-10:00 and 10:00-12:00 can both be booked. */
export function slotsOverlap(a: string | null | undefined, b: string | null | undefined): boolean {
  const first = jamRange(a);
  const second = jamRange(b);
  return first.start < second.end && second.start < first.end;
}

/** Strict "HH:MM" (00:00-23:59), the format of an `<input type="time">`. */
export function parseClock(value: string): number | null {
  const match = value.trim().match(CLOCK_PATTERN);
  return match ? Number(match[1]) * 60 + Number(match[2]) : null;
}

/** The `jam` SAKU writes; SIMPEL shows it with " WIB" appended. */
export function formatJam(start: string, end: string): string {
  return `${start.trim()} - ${end.trim()}`;
}

/** Today's date and the minutes since midnight, on the campus clock. */
export function jakartaNow(date: Date = new Date()): { date: string; minutes: number } {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: VENUE_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(date);
  const part = (type: string) => parts.find((entry) => entry.type === type)?.value ?? '';
  return {
    date: `${part('year')}-${part('month')}-${part('day')}`,
    minutes: Number(part('hour')) * 60 + Number(part('minute')),
  };
}

export function isValidDateString(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return (
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day
  );
}

export function addDays(dateString: string, days: number): string {
  const [year, month, day] = dateString.split('-').map(Number);
  return new Date(Date.UTC(year, month - 1, day + days)).toISOString().slice(0, 10);
}

// ─── Equipment lines ────────────────────────────────────────────────────────

/** SIMPEL always writes a quantity, including "1x". */
export function formatFacility(qty: number, name: string): string {
  return `${qty}x ${name}`;
}

export function parseFacility(line: string): { qty: number; name: string } {
  const match = line.match(/^(\d+)x\s*(.*)$/);
  if (match) return { qty: parseInt(match[1], 10), name: match[2].trim() };
  return { qty: 1, name: line.trim() };
}

// ─── Matching, the way SIMPEL does it ───────────────────────────────────────
// SIMPEL stores names, not ids, and compares them loosely: two names match when
// one contains the other. These helpers reproduce that so both apps count the
// same bookings.

function lower(value: string): string {
  return value.toLowerCase().trim();
}

function eitherContains(a: string, b: string): boolean {
  if (!a || !b) return false;
  return a.includes(b) || b.includes(a);
}

function withoutQuantity(line: string): string {
  return lower(line.replace(/^\d+x\s*/, ''));
}

/** SIMPEL's lookup of the building behind a booking's free-text `gedung`. */
export function findBuilding(
  buildings: SimpelBuilding[],
  gedungName: string,
): SimpelBuilding | undefined {
  const target = lower(gedungName);
  if (!target) return undefined;
  return buildings.find(
    (building) =>
      eitherContains(lower(building.nama), target) ||
      (lower(building.singkatan) !== '' && lower(building.singkatan).includes(target)),
  );
}

export function findRoom(building: SimpelBuilding | undefined, roomName: string): SimpelRoom | undefined {
  const target = lower(roomName);
  return building?.ruanganList.find((room) => lower(room.nama) === target);
}

/**
 * Whether a booking's `gedung` refers to this building. Older SIMPEL bookings
 * use short names ("GOR Unipdu", "Gedung GKB A"), so besides SIMPEL's own
 * contains-either-way rule this also accepts the abbreviation. Matching too
 * much only blocks more, which is the safe direction.
 */
export function bookingInBuilding(
  bookingGedung: string,
  building: Pick<SimpelBuilding, 'nama' | 'singkatan'>,
): boolean {
  const target = lower(bookingGedung);
  const nama = lower(building.nama);
  if (!target || !nama) return false;
  if (eitherContains(target, nama)) return true;
  if (target.replace(/\s+/g, '') === nama.replace(/\s+/g, '')) return true;
  const singkatan = lower(building.singkatan);
  return singkatan.length >= 3 && eitherContains(target, singkatan);
}

// ─── Availability ───────────────────────────────────────────────────────────

/** Rejected, finished and returned bookings no longer hold the room. */
const RELEASED_STATUSES = new Set(['ditolak', 'selesai', 'dikembalikan']);

/**
 * Pending requests hold the room too, as they do in SIMPEL's booking form: a
 * request made first keeps its claim while Biro Umum reviews it.
 */
export function occupiesRoom(booking: Pick<SimpelBooking, 'status'>): boolean {
  return !RELEASED_STATUSES.has(booking.status);
}

export interface SlotRequest {
  waktu: string;
  jam: string;
  building: Pick<SimpelBuilding, 'nama' | 'singkatan'>;
  ruangan: string;
}

/** Bookings that already hold this room at overlapping hours on that date. */
export function findRoomConflicts<T extends BookingSlot>(
  bookings: T[],
  request: SlotRequest,
  excludeId?: string,
): T[] {
  const room = lower(request.ruangan);
  return bookings.filter(
    (booking) =>
      booking.id !== excludeId &&
      occupiesRoom(booking) &&
      booking.waktu === request.waktu &&
      lower(booking.ruangan) === room &&
      bookingInBuilding(booking.gedung, request.building) &&
      slotsOverlap(booking.jam, request.jam),
  );
}

export type EquipmentSource = 'room' | 'building' | 'global';

export interface EquipmentAvailability {
  /** The catalog name the request resolved to. */
  name: string;
  /** room: built into the room (always available); building/global: counted stock. */
  source: EquipmentSource;
  total: number;
  allocated: number;
  remaining: number;
}

export interface AvailabilityContext {
  buildings: SimpelBuilding[];
  equipment: SimpelEquipment[];
  /** Every booking on `waktu` (others are ignored). */
  bookings: BookingSlot[];
  waktu: string;
  jam: string;
  gedung: string;
  ruangan: string;
  excludeId?: string;
}

/**
 * Port of SIMPEL's `checkFacilityStockAvailability` for one line, with the
 * hours rule added. Three tiers: built into the room (free), this building's
 * inventory (shared by bookings in the same building), campus-wide stock
 * (shared by everyone). Only approved bookings consume stock, as in SIMPEL.
 * Returns null when the item is in no catalog.
 */
export function equipmentAvailability(
  context: AvailabilityContext,
  line: string,
): EquipmentAvailability | null {
  const wanted = withoutQuantity(line);
  if (!wanted) return null;

  const building = findBuilding(context.buildings, context.gedung);
  const room = findRoom(building, context.ruangan);
  if (room?.fasilitasBawaan.some((builtIn) => eitherContains(lower(builtIn), wanted))) {
    return {
      name: parseFacility(line).name,
      source: 'room',
      total: Number.POSITIVE_INFINITY,
      allocated: 0,
      remaining: Number.POSITIVE_INFINITY,
    };
  }

  let name: string;
  let total: number;
  let isGlobal = false;
  const buildingItem = building?.inventarisList.find((item) => eitherContains(lower(item.nama), wanted));
  if (buildingItem) {
    name = buildingItem.nama;
    total = buildingItem.jumlah;
  } else {
    const globalItem = context.equipment.find((item) => eitherContains(lower(item.nama), wanted));
    if (!globalItem) return null;
    name = globalItem.nama;
    total = globalItem.totalStok;
    isGlobal = true;
  }

  let allocated = 0;
  for (const booking of context.bookings) {
    if (
      booking.id === context.excludeId ||
      booking.status !== 'disetujui' ||
      booking.waktu !== context.waktu ||
      !slotsOverlap(booking.jam, context.jam)
    ) {
      continue;
    }
    // Building items are only lent within their building; global items anywhere.
    const sameBuilding = !!building && eitherContains(lower(booking.gedung), lower(building.nama));
    if (!isGlobal && !sameBuilding) continue;

    const bookingRoom = findRoom(findBuilding(context.buildings, booking.gedung), booking.ruangan);
    for (const bookedLine of booking.fasilitasTambahan) {
      const booked = withoutQuantity(bookedLine);
      if (!booked) continue;
      // Built into that booking's room, so it never came out of shared stock.
      if (bookingRoom?.fasilitasBawaan.some((builtIn) => eitherContains(lower(builtIn), booked))) continue;
      if (eitherContains(booked, wanted)) allocated += parseFacility(bookedLine).qty;
    }
  }

  return { name, source: isGlobal ? 'global' : 'building', total, allocated, remaining: total - allocated };
}

export interface EquipmentShortage {
  name: string;
  requested: number;
  remaining: number;
}

export function findEquipmentShortages(
  context: AvailabilityContext,
  lines: string[],
): EquipmentShortage[] {
  const shortages: EquipmentShortage[] = [];
  for (const line of lines) {
    const availability = equipmentAvailability(context, line);
    if (!availability || availability.source === 'room') continue;
    const { qty } = parseFacility(line);
    if (availability.remaining < qty) {
      shortages.push({ name: availability.name, requested: qty, remaining: Math.max(0, availability.remaining) });
    }
  }
  return shortages;
}

export function describeShortages(shortages: EquipmentShortage[]): string {
  return shortages
    .map((item) => `${item.name} (sisa ${item.remaining}, diminta ${item.requested})`)
    .join(', ');
}

/** Campus-wide items offered with a building, minus those the building stocks itself (as SIMPEL's form does). */
export function globalEquipmentFor(
  building: SimpelBuilding | undefined,
  equipment: SimpelEquipment[],
): SimpelEquipment[] {
  return equipment.filter(
    (item) =>
      !building?.inventarisList.some((buildingItem) => eitherContains(lower(buildingItem.nama), lower(item.nama))),
  );
}

// ─── A reservation request ──────────────────────────────────────────────────

export interface EquipmentRequestLine {
  name: string;
  qty: number;
}

export interface VenueReservationRequest {
  gedungId: string;
  ruangan: string;
  waktu: string;
  jamMulai: string;
  jamSelesai: string;
  kegiatan: string;
  pemohon: string;
  kontak: string;
  equipment: EquipmentRequestLine[];
  /** Optional link to a SAKU event (e.g. a Proposal Kegiatan id). */
  sakuEventId?: string;
}

/** Coerces an untrusted JSON body into the request shape; validation comes next. */
export function parseReservationRequest(body: unknown): VenueReservationRequest {
  const data = record(body);
  const equipment = Array.isArray(data.equipment) ? data.equipment : [];
  return {
    gedungId: text(data.gedungId),
    ruangan: text(data.ruangan),
    waktu: text(data.waktu),
    jamMulai: text(data.jamMulai),
    jamSelesai: text(data.jamSelesai),
    kegiatan: text(data.kegiatan),
    pemohon: text(data.pemohon),
    kontak: text(data.kontak),
    equipment: equipment.map(record).map((line) => ({
      name: text(line.name),
      qty: typeof line.qty === 'number' ? line.qty : Number(line.qty),
    })),
    sakuEventId: text(data.sakuEventId) || undefined,
  };
}

export interface ValidatedReservation {
  building: SimpelBuilding;
  room: SimpelRoom;
  waktu: string;
  jam: string;
  kegiatan: string;
  pemohon: string;
  kontak: string;
  /** Canonical lines, e.g. "2x Mic Wireless Shure". */
  fasilitasTambahan: string[];
  sakuEventId?: string;
}

export type ValidationResult =
  | { ok: true; value: ValidatedReservation }
  | { ok: false; error: string };

export function textFieldError(value: string, label: string, maxLength: number): string | null {
  if (!value) return `${label} wajib diisi.`;
  if (value.length > maxLength) return `${label} maksimal ${maxLength} karakter.`;
  // SIMPEL renders these values as HTML in its notification bell.
  if (/[<>]/.test(value)) return `${label} tidak boleh memuat tanda < atau >.`;
  return null;
}

/** The number Pekarya call to coordinate the handover: digits, spaces and + ( ) -, 8 to 15 digits. */
export function contactNumberError(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed) return 'Nomor WhatsApp wajib diisi.';
  const digits = trimmed.replace(/\D/g, '');
  if (!/^[0-9+()\-\s]+$/.test(trimmed) || digits.length < 8 || digits.length > 15) {
    return 'Nomor telepon / WhatsApp tidak valid.';
  }
  return null;
}

/**
 * Everything that can be checked without looking at other bookings. There is
 * no human review after this, so it is deliberately strict.
 */
export function validateReservationRequest(
  request: VenueReservationRequest,
  catalog: { buildings: SimpelBuilding[]; equipment: SimpelEquipment[] },
  now: { date: string; minutes: number },
): ValidationResult {
  const fail = (error: string): ValidationResult => ({ ok: false, error });

  if (!isValidDateString(request.waktu)) return fail('Tanggal reservasi tidak valid.');
  if (request.waktu < now.date) return fail('Tanggal reservasi sudah lewat.');
  if (request.waktu > addDays(now.date, RESERVATION_HORIZON_DAYS)) {
    return fail('Reservasi hanya dapat dibuat paling lama satu tahun ke depan.');
  }

  const start = parseClock(request.jamMulai);
  const end = parseClock(request.jamSelesai);
  if (start === null || end === null) return fail('Jam mulai dan jam selesai wajib diisi (format JJ:MM).');
  if (end <= start) return fail('Jam selesai harus setelah jam mulai.');
  if (request.waktu === now.date && end <= now.minutes) return fail('Jam reservasi hari ini sudah lewat.');

  const textError =
    textFieldError(request.kegiatan, 'Nama kegiatan', MAX_KEGIATAN_LENGTH) ||
    textFieldError(request.pemohon, 'Nama pemohon / unit', MAX_PEMOHON_LENGTH);
  if (textError) return fail(textError);

  const contactError = contactNumberError(request.kontak);
  if (contactError) return fail(contactError);

  if (request.sakuEventId && !/^[A-Za-z0-9_-]{1,120}$/.test(request.sakuEventId)) {
    return fail('ID kegiatan terkait tidak valid.');
  }

  const building = catalog.buildings.find((candidate) => candidate.id === request.gedungId);
  if (!building) return fail('Gedung tidak ditemukan di SIMPEL.');
  const room = findRoom(building, request.ruangan);
  if (!room) return fail('Ruangan tidak ditemukan di gedung tersebut.');
  if (lower(room.status) === 'maintenance') {
    return fail(`Ruangan ${room.nama} sedang dalam perawatan dan tidak dapat dipesan.`);
  }

  if (request.equipment.length > MAX_EQUIPMENT_LINES) {
    return fail(`Maksimal ${MAX_EQUIPMENT_LINES} jenis peralatan per reservasi.`);
  }
  const seen = new Set<string>();
  const fasilitasTambahan: string[] = [];
  for (const line of request.equipment) {
    if (!line.name) return fail('Nama peralatan tidak boleh kosong.');
    const key = lower(line.name);
    if (seen.has(key)) return fail(`Peralatan "${line.name}" dipilih lebih dari sekali.`);
    seen.add(key);

    const buildingItem = building.inventarisList.find((item) => lower(item.nama) === key);
    const globalItem = catalog.equipment.find((item) => lower(item.nama) === key);
    const catalogItem = buildingItem
      ? { nama: buildingItem.nama, total: buildingItem.jumlah }
      : globalItem
        ? { nama: globalItem.nama, total: globalItem.totalStok }
        : null;
    if (!catalogItem) return fail(`Peralatan "${line.name}" tidak ada di katalog SIMPEL.`);
    if (!Number.isInteger(line.qty) || line.qty < 1) {
      return fail(`Jumlah ${catalogItem.nama} harus bilangan bulat minimal 1.`);
    }
    if (line.qty > catalogItem.total) {
      return fail(`Jumlah ${catalogItem.nama} melebihi stok SIMPEL (${catalogItem.total}).`);
    }
    fasilitasTambahan.push(formatFacility(line.qty, catalogItem.nama));
  }

  return {
    ok: true,
    value: {
      building,
      room,
      waktu: request.waktu,
      jam: formatJam(request.jamMulai, request.jamSelesai),
      kegiatan: request.kegiatan,
      pemohon: request.pemohon,
      kontak: request.kontak,
      fasilitasTambahan,
      sakuEventId: request.sakuEventId,
    },
  };
}

export interface ReservationActor {
  uid: string;
  role: string;
  email: string | null;
  displayName: string;
}

/**
 * The id is not count-based like SIMPEL's own (`PJM-0<count+101>`), so two
 * writers can never produce the same one.
 */
export function sakuBookingId(nowMillis: number, randomSuffix: string): string {
  return `PJM-S-${nowMillis.toString(36).toUpperCase()}-${randomSuffix.toUpperCase()}`;
}

/** A normal SIMPEL booking, already approved, plus SAKU's extra fields. */
export function buildSakuBooking(input: {
  id: string;
  reservation: ValidatedReservation;
  actor: ReservationActor;
  nowIso: string;
  today: string;
}): SimpelBooking {
  const { reservation, actor } = input;
  return withoutUndefined<SimpelBooking>({
    id: input.id,
    pemohon: reservation.pemohon,
    // An existing SIMPEL type, so SIMPEL's pages need no change. Staff requests
    // use it too, and they skip the student (BAK) review as this does.
    tipePemohon: 'tu',
    kontak: reservation.kontak,
    gedung: reservation.building.nama,
    ruangan: reservation.room.nama,
    waktu: reservation.waktu,
    jam: reservation.jam,
    kegiatan: reservation.kegiatan,
    status: 'disetujui',
    fasilitasTambahan: reservation.fasilitasTambahan,
    tanggalDibuat: input.today,
    createdByEmail: actor.email || undefined,
    source: 'saku',
    sakuUid: actor.uid,
    sakuRole: actor.role,
    sakuDisplayName: actor.displayName || undefined,
    sakuEventId: reservation.sakuEventId,
    autoApproved: true,
    createdAt: input.nowIso,
  });
}

// ─── Lifecycle ──────────────────────────────────────────────────────────────

export type ReservationPhase =
  | 'menunggu'
  | 'terjadwal'
  | 'diserahkan'
  | 'diterima'
  | 'menunggu_checkin'
  | 'selesai'
  | 'dibatalkan'
  | 'ditolak';

export const RESERVATION_PHASE_LABELS: Record<ReservationPhase, string> = {
  menunggu: 'Menunggu Biro Umum',
  terjadwal: 'Terjadwal',
  diserahkan: 'Fasilitas Diserahkan',
  diterima: 'Sedang Dipakai',
  menunggu_checkin: 'Menunggu Check-in Pekarya',
  selesai: 'Selesai',
  dibatalkan: 'Dibatalkan',
  ditolak: 'Ditolak',
};

type LifecycleFields = Pick<
  SimpelBooking,
  | 'status'
  | 'serahTerimaSelesai'
  | 'peminjamDiterima'
  | 'peminjamSiapKembali'
  | 'fasilitasDiserahkan'
  | 'cancelledBy'
>;

/** Where a booking stands, following SIMPEL's flags in the order SIMPEL sets them. */
export function reservationPhase(booking: LifecycleFields): ReservationPhase {
  if (booking.status === 'selesai' || booking.status === 'dikembalikan') return 'selesai';
  if (booking.status === 'ditolak') return booking.cancelledBy ? 'dibatalkan' : 'ditolak';
  if (booking.status !== 'disetujui') return 'menunggu';
  if (!booking.serahTerimaSelesai) return 'terjadwal';
  if (!booking.peminjamDiterima) return 'diserahkan';
  if (!booking.peminjamSiapKembali) return 'diterima';
  return 'menunggu_checkin';
}

export function isActivePhase(phase: ReservationPhase): boolean {
  return phase !== 'selesai' && phase !== 'dibatalkan' && phase !== 'ditolak';
}

export const RESERVATION_ACTIONS = ['cancel', 'confirm-receipt', 'ready-return'] as const;
export type ReservationAction = (typeof RESERVATION_ACTIONS)[number];

export function isReservationAction(value: unknown): value is ReservationAction {
  return typeof value === 'string' && (RESERVATION_ACTIONS as readonly string[]).includes(value);
}

function handoverStarted(booking: LifecycleFields): boolean {
  return !!booking.serahTerimaSelesai || (booking.fasilitasDiserahkan?.length ?? 0) > 0;
}

/** The buttons SIMPEL shows its own borrowers, in the same order. */
export function canPerformReservationAction(
  booking: LifecycleFields,
  action: ReservationAction,
): boolean {
  const phase = reservationPhase(booking);
  switch (action) {
    case 'cancel':
      // Once Pekarya start handing things over, cancelling is Biro Umum's call.
      return (phase === 'menunggu' || phase === 'terjadwal') && !handoverStarted(booking);
    case 'confirm-receipt':
      return phase === 'diserahkan';
    case 'ready-return':
      return phase === 'diterima';
  }
}

export function allowedReservationActions(booking: LifecycleFields): ReservationAction[] {
  return RESERVATION_ACTIONS.filter((action) => canPerformReservationAction(booking, action));
}

/** Why an action was refused, for the 409 answer. */
export function reservationActionRefusal(
  booking: LifecycleFields,
  action: ReservationAction,
): string {
  const phase = reservationPhase(booking);
  if (!isActivePhase(phase)) {
    return `Reservasi ini sudah ${RESERVATION_PHASE_LABELS[phase].toLowerCase()}.`;
  }
  switch (action) {
    case 'cancel':
      return 'Serah terima sudah dimulai, jadi reservasi tidak dapat dibatalkan dari SAKU. Hubungi Biro Umum.';
    case 'confirm-receipt':
      return phase === 'terjadwal' || phase === 'menunggu'
        ? 'Fasilitas belum diserahkan oleh Pekarya.'
        : 'Penerimaan fasilitas sudah dikonfirmasi.';
    case 'ready-return':
      if (phase === 'menunggu_checkin') return 'Pengembalian sudah dilaporkan. Menunggu check-in Pekarya.';
      return phase === 'diserahkan'
        ? 'Konfirmasi penerimaan fasilitas terlebih dahulu.'
        : 'Fasilitas belum diserahkan oleh Pekarya.';
  }
}

/** The only fields an action writes, so nothing SIMPEL set in the meantime is overwritten. */
export function reservationActionPatch(
  action: ReservationAction,
  options: { nowIso: string; cancelReason?: string; cancelledByAdmin?: boolean },
): Record<string, unknown> {
  switch (action) {
    case 'cancel': {
      const who = options.cancelledByAdmin
        ? 'Dibatalkan melalui SAKU oleh Super Admin'
        : 'Dibatalkan oleh pemohon melalui SAKU';
      const reason = options.cancelReason?.trim();
      return {
        status: 'ditolak',
        alasanPenolakan: reason ? `${who}: ${reason}` : who,
        cancelledBy: 'pemohon',
        cancelledAt: options.nowIso,
      };
    }
    case 'confirm-receipt':
      return { peminjamDiterima: true, peminjamDiterimaAt: options.nowIso };
    case 'ready-return':
      return { peminjamSiapKembali: true, peminjamSiapKembaliAt: options.nowIso };
  }
}

// ─── What the page receives ─────────────────────────────────────────────────

export interface ReservationView {
  id: string;
  kegiatan: string;
  pemohon: string;
  kontak: string;
  gedung: string;
  ruangan: string;
  waktu: string;
  jam: string;
  fasilitasTambahan: string[];
  status: string;
  phase: ReservationPhase;
  handoverStarted: boolean;
  alasanPenolakan: string | null;
  createdAt: string | null;
  ownerUid: string | null;
  ownerName: string | null;
  allowedActions: ReservationAction[];
}

export function toReservationView(booking: SimpelBooking): ReservationView {
  return {
    id: booking.id,
    kegiatan: booking.kegiatan,
    pemohon: booking.pemohon,
    kontak: booking.kontak,
    gedung: booking.gedung,
    ruangan: booking.ruangan,
    waktu: booking.waktu,
    jam: booking.jam,
    fasilitasTambahan: booking.fasilitasTambahan,
    status: booking.status,
    phase: reservationPhase(booking),
    handoverStarted: handoverStarted(booking),
    alasanPenolakan: booking.alasanPenolakan ?? null,
    createdAt: booking.createdAt ?? null,
    ownerUid: booking.sakuUid ?? null,
    ownerName: booking.sakuDisplayName ?? null,
    allowedActions: allowedReservationActions(booking),
  };
}

/** Another booking on the chosen date: enough to show the room's schedule and count stock. */
export interface ScheduleEntry extends BookingSlot {
  kegiatan: string;
  pemohon: string;
}

export function toScheduleEntry(booking: SimpelBooking): ScheduleEntry {
  return {
    id: booking.id,
    status: booking.status,
    waktu: booking.waktu,
    jam: booking.jam,
    gedung: booking.gedung,
    ruangan: booking.ruangan,
    fasilitasTambahan: booking.fasilitasTambahan,
    kegiatan: booking.kegiatan,
    pemohon: booking.pemohon,
  };
}

// ─── Notifications in SIMPEL's bell (`simpel_emails`) ───────────────────────

export interface SimpelNotification {
  id: string;
  to: string;
  from: string;
  subject: string;
  bodyHtml: string;
  timestamp: string;
  read: boolean;
}

export interface NotificationDraft {
  to: string;
  subject: string;
  bodyHtml: string;
}

export function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

/** SIMPEL's own email template (`getEmailTemplateHtml`), with every value escaped. */
export function buildSimpelEmailHtml(
  title: string,
  intro: string,
  details: { label: string; value: string }[],
  alertText?: string,
): string {
  const rows = details
    .map(
      (detail) => `
    <tr>
      <td style="padding: 8px; border-bottom: 1px solid #e2e8f0; font-weight: bold; color: #4a5568; width: 140px;">${escapeHtml(detail.label)}</td>
      <td style="padding: 8px; border-bottom: 1px solid #e2e8f0; color: #2d3748;">${escapeHtml(detail.value)}</td>
    </tr>
  `,
    )
    .join('');
  const alertBlock = alertText
    ? `
    <div style="background-color: #fffaf0; border-left: 4px solid #dd6b20; padding: 12px; margin-top: 15px; border-radius: 4px; font-size: 11px; color: #c05621;">
      <strong>PENTING:</strong> ${escapeHtml(alertText)}
    </div>
  `
    : '';

  return `
    <div style="font-family: 'Inter', Helvetica, Arial, sans-serif; background-color: #f7fafc; padding: 20px; border-radius: 12px; border: 1px solid #e2e8f0; max-width: 600px; margin: 0 auto; box-shadow: 0 4px 6px rgba(0,0,0,0.05);">
      <div style="border-bottom: 3px double #1a202c; padding-bottom: 15px; margin-bottom: 20px; text-align: center;">
        <h2 style="margin: 0; color: #059669; font-size: 16px; text-transform: uppercase; letter-spacing: 0.5px;">Universitas Pesantren Tinggi Darul 'Ulum Jombang</h2>
        <p style="margin: 3px 0 0 0; color: #718096; font-size: 10px; font-weight: bold;">SISTEM INFORMASI MANAJEMEN PEMINJAMAN FASILITAS KAMPUS (SIMPEL)</p>
      </div>
      <div style="background-color: #ffffff; padding: 20px; border-radius: 8px; border: 1px solid #edf2f7;">
        <h3 style="margin-top: 0; color: #2d3748; font-size: 14px; border-left: 3px solid #059669; padding-left: 8px;">${escapeHtml(title)}</h3>
        <p style="font-size: 12px; color: #4a5568; line-height: 1.6;">${escapeHtml(intro)}</p>
        <table style="width: 100%; border-collapse: collapse; font-size: 11px; margin-top: 15px;">
          <tbody>
            ${rows}
          </tbody>
        </table>
        ${alertBlock}
      </div>
      <div style="margin-top: 20px; text-align: center; font-size: 9px; color: #a0aec0;">
        <p>Email ini dikirim otomatis oleh Sistem SIMPEL UNIPDU atas reservasi dari aplikasi SAKU. Mohon tidak membalas email ini.</p>
      </div>
    </div>
  `;
}

/** Same id and timestamp format SIMPEL uses, so its bell sorts and shows these alike. */
export function buildSimpelNotification(
  draft: NotificationDraft,
  now: Date,
  random: number,
): SimpelNotification {
  const timestamp = now.toLocaleDateString('id-ID', {
    timeZone: VENUE_TIME_ZONE,
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });
  return {
    id: `EML-${now.getTime()}-${Math.floor(random) % 1000}`,
    to: draft.to,
    from: SIMPEL_SENDER_EMAIL,
    subject: draft.subject,
    bodyHtml: draft.bodyHtml,
    timestamp: `${timestamp} WIB`,
    read: false,
  };
}

function bookingDetails(booking: SimpelBooking) {
  return [
    { label: 'Nomor PJM', value: booking.id },
    { label: 'Nama Pemohon', value: booking.pemohon },
    { label: 'Kontak', value: booking.kontak },
    { label: 'Gedung & Ruangan', value: `${booking.gedung} - ${booking.ruangan}` },
    { label: 'Tanggal & Jam', value: `${booking.waktu} (${booking.jam} WIB)` },
    { label: 'Nama Kegiatan', value: booking.kegiatan },
    { label: 'Peralatan Tambahan', value: booking.fasilitasTambahan.join(', ') || 'Tidak ada' },
  ];
}

export function reservationCreatedNotifications(booking: SimpelBooking): NotificationDraft[] {
  const details = bookingDetails(booking);
  return [
    {
      to: SIMPEL_FIELD_STAFF_EMAIL,
      subject: `[SIMPEL] Penugasan Serah Terima: Reservasi SAKU ${booking.id}`,
      bodyHtml: buildSimpelEmailHtml(
        'Penugasan Serah Terima Fasilitas Baru',
        `Yth. Pekarya / PJ Fasilitas, reservasi ${booking.id} dari aplikasi SAKU otomatis disetujui karena ruangan dan peralatan tersedia pada jam tersebut. Silakan siapkan ruangan dan lakukan serah terima kepada pemohon pada hari pelaksanaan.`,
        details,
        "Buka menu 'Penyerahan Fasilitas' untuk mencatat serah terima.",
      ),
    },
    {
      to: SIMPEL_BIRO_UMUM_EMAIL,
      subject: `[SIMPEL] Info: Reservasi SAKU ${booking.id} Terjadwal Otomatis`,
      bodyHtml: buildSimpelEmailHtml(
        'Reservasi Otomatis dari SAKU',
        `Yth. Tim Biro Umum, ${booking.pemohon} membuat reservasi melalui aplikasi SAKU. Reservasi ini langsung terjadwal karena ruangan dan peralatan tersedia pada jam tersebut.`,
        details,
        "Jika reservasi ini perlu dibatalkan, buka menu 'Persetujuan Peminjaman' dan klik 'Batalkan' sebelum serah terima dimulai.",
      ),
    },
  ];
}

export function reservationActionNotifications(
  booking: SimpelBooking,
  action: ReservationAction,
): NotificationDraft[] {
  const details = bookingDetails(booking);
  switch (action) {
    case 'cancel':
      return [SIMPEL_FIELD_STAFF_EMAIL, SIMPEL_BIRO_UMUM_EMAIL].map((to) => ({
        to,
        subject: `[SIMPEL] Reservasi SAKU ${booking.id} Dibatalkan`,
        bodyHtml: buildSimpelEmailHtml(
          'Reservasi Dibatalkan dari SAKU',
          `Reservasi ${booking.id} untuk kegiatan "${booking.kegiatan}" dibatalkan melalui aplikasi SAKU, sehingga ruangan kembali tersedia dan serah terima tidak perlu disiapkan.`,
          [...details, { label: 'Keterangan', value: booking.alasanPenolakan || '-' }],
        ),
      }));
    case 'confirm-receipt':
      return [
        {
          to: SIMPEL_FIELD_STAFF_EMAIL,
          subject: `[SIMPEL] Konfirmasi Terima: PJM ${booking.id} Telah Diterima Pemohon`,
          bodyHtml: buildSimpelEmailHtml(
            'Konfirmasi Penerimaan Fasilitas oleh Pemohon',
            `Halo Pekarya / PJ Fasilitas Lapangan, pemohon ${booking.pemohon} telah mengonfirmasi melalui SAKU bahwa seluruh fasilitas dan akses ruangan untuk reservasi ${booking.id} telah diterima di lokasi kegiatan.`,
            [...details, { label: 'Status Serah Terima', value: 'DITERIMA & DIKONFIRMASI OLEH PEMOHON' }],
          ),
        },
      ];
    case 'ready-return':
      return [
        {
          to: SIMPEL_FIELD_STAFF_EMAIL,
          subject: `[SIMPEL] PEMBERITAHUAN: Acara ${booking.id} Selesai & Siap Dikembalikan`,
          bodyHtml: buildSimpelEmailHtml(
            'Pemberitahuan Kesiapan Pengembalian Logistik',
            `Yth. Pekarya & Staff Maintenance, pemohon ${booking.pemohon} melaporkan melalui SAKU bahwa kegiatan "${booking.kegiatan}" telah selesai. Kunci & fasilitas ruangan siap diperiksa untuk serah terima pengembalian.`,
            [...details, { label: 'Tindakan Anda', value: "Buka menu 'Maintenance & Pengembalian' untuk melakukan check-in." }],
          ),
        },
      ];
  }
}
