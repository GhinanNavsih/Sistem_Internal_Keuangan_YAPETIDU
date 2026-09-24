import { randomBytes, randomInt } from 'node:crypto';
import type { firestore } from 'firebase-admin';
import { adminDb } from '@/lib/firebase-admin';
import { HttpError } from '@/lib/server/auth';
import {
  SIMPEL_BOOKINGS_COLLECTION,
  SIMPEL_BUILDINGS_COLLECTION,
  SIMPEL_EQUIPMENT_COLLECTION,
  SIMPEL_NOTIFICATIONS_COLLECTION,
  SIMPEL_RESERVATION_LOCKS_COLLECTION,
  simpelProjectId,
} from '@/lib/simpel-admin';
import {
  buildSakuBooking,
  buildSimpelNotification,
  buildVenuePhotos,
  canPerformReservationAction,
  describeShortages,
  findEquipmentShortages,
  findRoomConflicts,
  isActivePhase,
  isValidDateString,
  jakartaNow,
  jamRange,
  MAX_CANCEL_REASON_LENGTH,
  normalizeSimpelBooking,
  normalizeSimpelBuilding,
  normalizeSimpelEquipment,
  reservationActionNotifications,
  reservationActionPatch,
  reservationActionRefusal,
  reservationCreatedNotifications,
  reservationPhase,
  sakuBookingId,
  sakuGroupId,
  toReservationView,
  validateReservationRequest,
  type NotificationDraft,
  type ReservationAction,
  type ReservationActor,
  type ReservationView,
  type SimpelBooking,
  type SimpelBuilding,
  type SimpelEquipment,
  type VenuePhotos,
  type VenueReservationRequest,
} from '@/lib/venueReservation';

/**
 * Reading and writing SIMPEL's database for venue reservations. Every function
 * takes the Firestore handle so the same code runs against SIMPEL, a scratch
 * copy, or the emulator. Rules live in `@/lib/venueReservation`; this file only
 * adds the reads, the transactions and the writes.
 */

type Firestore = firestore.Firestore;

// Bookings can carry a base64 letter of several MB; only read what the rules use.
const BOOKING_FIELDS = [
  'pemohon',
  'tipePemohon',
  'kontak',
  'gedung',
  'ruangan',
  'waktu',
  'jam',
  'kegiatan',
  'status',
  'fasilitasTambahan',
  'tanggalDibuat',
  'createdByEmail',
  'alasanPenolakan',
  'fasilitasDiserahkan',
  'serahTerimaSelesai',
  'peminjamDiterima',
  'peminjamSiapKembali',
  'source',
  'sakuUid',
  'sakuRole',
  'sakuDisplayName',
  'sakuEventId',
  'autoApproved',
  'createdAt',
  'cancelledBy',
  'cancelledAt',
  'peminjamDiterimaAt',
  'peminjamSiapKembaliAt',
  'sakuGroupId',
  'sakuGroupDates',
  'sakuGroupIndex',
  'sakuGroupTotal',
  'suratName',
];

const SAFE_BOOKING_ID = /^[A-Za-z0-9_-]{1,120}$/;

export async function loadSimpelCatalog(
  db: Firestore,
): Promise<{ buildings: SimpelBuilding[]; equipment: SimpelEquipment[] }> {
  const [buildingSnapshot, equipmentSnapshot] = await Promise.all([
    // Leaves out the building photos, which SIMPEL stores inline as base64.
    db.collection(SIMPEL_BUILDINGS_COLLECTION).select('nama', 'singkatan', 'lokasi', 'ruanganList', 'inventarisList').get(),
    db.collection(SIMPEL_EQUIPMENT_COLLECTION).select('nama', 'kategori', 'totalStok').get(),
  ]);
  const byName = (left: { nama: string }, right: { nama: string }) => left.nama.localeCompare(right.nama, 'id');
  return {
    buildings: buildingSnapshot.docs
      .map((document) => normalizeSimpelBuilding(document.id, document.data()))
      .filter((building) => building.nama)
      .sort(byName),
    equipment: equipmentSnapshot.docs
      .map((document) => normalizeSimpelEquipment(document.id, document.data()))
      .filter((item) => item.nama)
      .sort(byName),
  };
}

/**
 * The cover photo of every building and room. Kept apart from the catalog: the
 * catalog is reloaded whenever the date changes, and the photos (embedded in
 * SIMPEL's documents) are the heavy part, so the form fetches them once.
 */
export async function loadVenuePhotos(db: Firestore): Promise<VenuePhotos> {
  const snapshot = await db
    .collection(SIMPEL_BUILDINGS_COLLECTION)
    .select('nama', 'singkatan', 'imageUrl', 'images', 'ruanganList')
    .get();
  return buildVenuePhotos(snapshot.docs.map((document) => ({ id: document.id, data: document.data() })));
}

function bookingsOn(db: Firestore, waktu: string) {
  return db
    .collection(SIMPEL_BOOKINGS_COLLECTION)
    .where('waktu', '==', waktu)
    .select(...BOOKING_FIELDS);
}

export async function loadBookingsOn(db: Firestore, waktu: string): Promise<SimpelBooking[]> {
  const snapshot = await bookingsOn(db, waktu).get();
  return snapshot.docs.map((document) => normalizeSimpelBooking(document.id, document.data()));
}

export async function loadBookingsOnDates(db: Firestore, dates: string[]): Promise<SimpelBooking[]> {
  const uniqueDates = Array.from(new Set(dates.filter(isValidDateString)));
  if (uniqueDates.length === 0) return [];
  if (uniqueDates.length === 1) return loadBookingsOn(db, uniqueDates[0]);

  const snapshot = await db
    .collection(SIMPEL_BOOKINGS_COLLECTION)
    .where('waktu', 'in', uniqueDates.slice(0, 30))
    .select(...BOOKING_FIELDS)
    .get();
  return snapshot.docs.map((document) => normalizeSimpelBooking(document.id, document.data()));
}

/** A Kepala SatKer sees their own reservations and everyone else's active reservations; Super Admin sees all SAKU bookings and all active reservations. */
export async function listReservations(
  db: Firestore,
  caller: Pick<ReservationActor, 'uid' | 'role'>,
): Promise<ReservationView[]> {
  const bookings = db.collection(SIMPEL_BOOKINGS_COLLECTION);
  const snapshot = await bookings.select(...BOOKING_FIELDS).get();

  const allBookings = snapshot.docs.map((document) => normalizeSimpelBooking(document.id, document.data()));

  const visibleBookings = allBookings.filter((booking) => {
    const isCallerOwner = Boolean(booking.sakuUid && booking.sakuUid === caller.uid);
    const active = isActivePhase(reservationPhase(booking));

    // Show all active reservations across the university
    if (active) return true;
    // Show caller's own historical reservations
    if (isCallerOwner) return true;
    // Super admin sees all historical SAKU reservations
    if (caller.role === 'super_admin' && booking.source === 'saku') return true;

    return false;
  });

  return visibleBookings
    .sort(
      (left, right) =>
        right.waktu.localeCompare(left.waktu) || jamRange(right.jam).start - jamRange(left.jam).start,
    )
    .map((booking) => toReservationView(booking, caller.role, caller.uid));
}

function notificationWrites(drafts: NotificationDraft[], now: Date) {
  // One millisecond apart so ids never collide within a batch.
  return drafts.map((draft, index) => buildSimpelNotification(draft, new Date(now.getTime() + index), randomInt(1000)));
}

/**
 * Checks and writes in one transaction on SIMPEL's database. Supports single-day
 * or multi-day batch reservations. The per-date lock documents make concurrent
 * SAKU reservations run in serial order, preventing double bookings.
 */
export async function createReservation(
  db: Firestore,
  caller: ReservationActor,
  request: VenueReservationRequest,
  now: Date = new Date(),
): Promise<SimpelBooking[]> {
  const clock = jakartaNow(now);
  // The catalog changes rarely, so it is read outside the transaction to avoid
  // holding locks on SIMPEL's building documents.
  const catalog = await loadSimpelCatalog(db);
  const validation = validateReservationRequest(request, catalog, clock);
  if (!validation.ok) throw new HttpError(400, validation.error);
  const reservation = validation.value;
  const dates = reservation.dates;
  const isGroup = dates.length > 1;
  const groupId = isGroup ? sakuGroupId(now.getTime(), randomBytes(3).toString('hex')) : undefined;

  // Sorting dates chronologically avoids deadlock between concurrent multi-day locks
  const sortedDates = [...dates].sort();
  const createdBookings: SimpelBooking[] = [];

  await db.runTransaction(async (transaction) => {
    // 1. Transaction reads: lock docs for all dates in sorted order
    for (const date of sortedDates) {
      const lockRef = db.collection(SIMPEL_RESERVATION_LOCKS_COLLECTION).doc(date);
      await transaction.get(lockRef);
    }

    // 2. Transaction reads: existing bookings on all dates
    const bookingsByDate = new Map<string, SimpelBooking[]>();
    for (const date of sortedDates) {
      const daySnapshot = await transaction.get(bookingsOn(db, date));
      const dayBookings = daySnapshot.docs.map((document) =>
        normalizeSimpelBooking(document.id, document.data()),
      );
      bookingsByDate.set(date, dayBookings);
    }

    // 3. Validation: check room conflicts and equipment shortages on every date
    for (const date of dates) {
      const dayBookings = bookingsByDate.get(date) || [];
      const conflicts = findRoomConflicts(dayBookings, {
        waktu: date,
        jam: reservation.jam,
        building: reservation.building,
        ruangan: reservation.room.nama,
      });
      if (conflicts.length > 0) {
        const taken = conflicts
          .map((conflict) => `${conflict.jam} (${conflict.kegiatan || 'kegiatan lain'})`)
          .join('; ');
        throw new HttpError(
          409,
          `Ruangan ${reservation.room.nama} sudah terpakai pada ${date} jam ${taken}. Pilih jam atau ruangan lain.`,
        );
      }

      const shortages = findEquipmentShortages(
        {
          buildings: catalog.buildings,
          equipment: catalog.equipment,
          bookings: dayBookings,
          waktu: date,
          jam: reservation.jam,
          gedung: reservation.building.nama,
          ruangan: reservation.room.nama,
        },
        reservation.fasilitasTambahan,
      );
      if (shortages.length > 0) {
        throw new HttpError(
          409,
          `Peralatan tidak mencukupi pada ${date} jam tersebut: ${describeShortages(shortages)}.`,
        );
      }
    }

    // 4. Writes: create booking, set lock, and create notifications for each date
    for (let idx = 0; idx < dates.length; idx++) {
      const date = dates[idx];
      const bookingRef = db
        .collection(SIMPEL_BOOKINGS_COLLECTION)
        .doc(sakuBookingId(now.getTime() + idx, randomBytes(3).toString('hex')));
      const lockRef = db.collection(SIMPEL_RESERVATION_LOCKS_COLLECTION).doc(date);

      const activityTitle = isGroup
        ? `${reservation.kegiatan} (Hari ${idx + 1}/${dates.length})`
        : reservation.kegiatan;

      const booking = buildSakuBooking({
        id: bookingRef.id,
        reservation,
        actor: caller,
        nowIso: now.toISOString(),
        today: clock.date,
        waktu: date,
        kegiatan: activityTitle,
        group: isGroup
          ? {
              id: groupId!,
              dates,
              index: idx + 1,
              total: dates.length,
            }
          : undefined,
      });
      createdBookings.push(booking);

      transaction.create(bookingRef, booking);
      transaction.set(
        lockRef,
        { waktu: date, lastBookingId: booking.id, updatedAt: now.toISOString() },
        { merge: true },
      );

      const notifications = notificationWrites(
        reservationCreatedNotifications(booking),
        new Date(now.getTime() + idx * 10),
      );
      for (const notification of notifications) {
        transaction.create(db.collection(SIMPEL_NOTIFICATIONS_COLLECTION).doc(notification.id), notification);
      }
    }
  });

  return createdBookings;
}

/**
 * Cancel, confirm receipt, or report ready-to-return. Reads the booking inside
 * the transaction, so a handover Pekarya recorded a moment ago is respected,
 * and writes only the fields the action owns.
 * If cancelGroup is true, cancels all bookings in the same multi-day group whose
 * handover has not started yet.
 */
export async function performReservationAction(
  db: Firestore,
  caller: Pick<ReservationActor, 'uid' | 'role'>,
  bookingId: string,
  action: ReservationAction,
  options: { cancelReason?: string; cancelGroup?: boolean } = {},
  now: Date = new Date(),
): Promise<SimpelBooking> {
  if (!SAFE_BOOKING_ID.test(bookingId)) throw new HttpError(400, 'ID reservasi tidak valid.');
  const cancelReason = options.cancelReason?.trim() || undefined;
  if (cancelReason && cancelReason.length > MAX_CANCEL_REASON_LENGTH) {
    throw new HttpError(400, `Alasan pembatalan maksimal ${MAX_CANCEL_REASON_LENGTH} karakter.`);
  }
  if (cancelReason && /[<>]/.test(cancelReason)) {
    throw new HttpError(400, 'Alasan pembatalan tidak boleh memuat tanda < atau >.');
  }

  const bookingRef = db.collection(SIMPEL_BOOKINGS_COLLECTION).doc(bookingId);
  return db.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(bookingRef);
    if (!snapshot.exists) throw new HttpError(404, 'Reservasi tidak ditemukan.');
    const current = snapshot.data() || {};
    const booking = normalizeSimpelBooking(snapshot.id, current);

    if (booking.source !== 'saku') {
      throw new HttpError(403, 'Peminjaman ini tidak dibuat dari SAKU. Kelola melalui SIMPEL.');
    }
    const isOwner = booking.sakuUid === caller.uid;
    if (!isOwner && caller.role !== 'super_admin') {
      throw new HttpError(403, 'Reservasi ini bukan milik Anda.');
    }

    if (action === 'cancel' && options.cancelGroup && booking.sakuGroupId) {
      // Find and cancel all bookings in the same multi-day group
      const groupSnapshot = await transaction.get(
        db.collection(SIMPEL_BOOKINGS_COLLECTION).where('sakuGroupId', '==', booking.sakuGroupId),
      );
      const patch = reservationActionPatch(action, {
        nowIso: now.toISOString(),
        cancelReason,
        cancelledByAdmin: !isOwner,
      });

      let updatedPrimary = booking;
      let writeIdx = 0;
      for (const doc of groupSnapshot.docs) {
        const member = normalizeSimpelBooking(doc.id, doc.data());
        if (canPerformReservationAction(member, action)) {
          const updated = normalizeSimpelBooking(member.id, { ...doc.data(), ...patch });
          if (member.id === booking.id) {
            updatedPrimary = updated;
          }
          transaction.update(doc.ref, patch);
          const notifications = notificationWrites(
            reservationActionNotifications(updated, action),
            new Date(now.getTime() + writeIdx * 10),
          );
          for (const notification of notifications) {
            transaction.create(db.collection(SIMPEL_NOTIFICATIONS_COLLECTION).doc(notification.id), notification);
          }
          writeIdx++;
        }
      }
      return updatedPrimary;
    }

    if (!canPerformReservationAction(booking, action)) {
      throw new HttpError(409, reservationActionRefusal(booking, action));
    }

    const patch = reservationActionPatch(action, {
      nowIso: now.toISOString(),
      cancelReason,
      cancelledByAdmin: !isOwner,
    });
    const updated = normalizeSimpelBooking(booking.id, { ...current, ...patch });
    transaction.update(bookingRef, patch);
    for (const notification of notificationWrites(reservationActionNotifications(updated, action), now)) {
      transaction.create(db.collection(SIMPEL_NOTIFICATIONS_COLLECTION).doc(notification.id), notification);
    }
    return updated;
  });
}

const AUDIT_ACTIONS: Record<ReservationAction | 'create', string> = {
  create: 'VENUE_RESERVATION_CREATED',
  cancel: 'VENUE_RESERVATION_CANCELLED',
  'confirm-receipt': 'VENUE_RESERVATION_RECEIPT_CONFIRMED',
  'ready-return': 'VENUE_RESERVATION_READY_TO_RETURN',
};

/**
 * Written to SAKU's own `audit_logs` after SIMPEL accepted the change. A failed
 * audit write is logged, not thrown: the reservation already exists, and an
 * error here would invite a duplicate retry.
 */
export async function recordReservationAudit(
  caller: ReservationActor,
  action: ReservationAction | 'create',
  booking: SimpelBooking,
): Promise<void> {
  try {
    await adminDb.collection('audit_logs').add({
      action: AUDIT_ACTIONS[action],
      actorUid: caller.uid,
      actorEmail: caller.email,
      actorRole: caller.role,
      bookingId: booking.id,
      bookingOwnerUid: booking.sakuUid || null,
      simpelProjectId: simpelProjectId(),
      details: {
        gedung: booking.gedung,
        ruangan: booking.ruangan,
        waktu: booking.waktu,
        jam: booking.jam,
        kegiatan: booking.kegiatan,
        status: booking.status,
      },
      timestamp: new Date().toISOString(),
    });
  } catch (err) {
    console.error('Failed to write venue reservation audit log:', err);
  }
}

export async function loadBookingSurat(
  db: Firestore,
  caller: ReservationActor,
  bookingId: string,
): Promise<{
  suratName: string | null;
  suratBase64: string | null;
  files: Array<{ name: string; base64: string }>;
}> {
  if (!SAFE_BOOKING_ID.test(bookingId)) {
    throw new HttpError(400, 'ID reservasi tidak valid.');
  }
  const snapshot = await db.collection(SIMPEL_BOOKINGS_COLLECTION).doc(bookingId).get();
  if (!snapshot.exists) {
    throw new HttpError(404, 'Reservasi tidak ditemukan di SIMPEL.');
  }
  const data = snapshot.data() || {};
  const isOwner = Boolean(data.sakuUid && data.sakuUid === caller.uid);
  const isSuperAdmin = caller.role === 'super_admin';
  if (!isOwner && !isSuperAdmin) {
    throw new HttpError(403, 'Anda tidak memiliki akses untuk melihat dokumen reservasi ini.');
  }
  const rawFiles = Array.isArray(data.suratFiles) ? data.suratFiles : [];
  const files: Array<{ name: string; base64: string }> = rawFiles.length > 0
    ? rawFiles
        .filter((f) => f && typeof f.name === 'string' && typeof f.base64 === 'string')
        .map((f) => ({ name: f.name as string, base64: f.base64 as string }))
    : typeof data.suratBase64 === 'string' && data.suratBase64
      ? [{ name: typeof data.suratName === 'string' && data.suratName ? data.suratName : 'Berkas SK', base64: data.suratBase64 }]
      : [];

  return {
    suratName: typeof data.suratName === 'string' ? data.suratName : null,
    suratBase64: typeof data.suratBase64 === 'string' ? data.suratBase64 : null,
    files,
  };
}
