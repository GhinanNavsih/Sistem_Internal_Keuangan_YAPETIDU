import { randomBytes, randomInt } from 'node:crypto';
import type { firestore } from 'firebase-admin';
import { adminDb } from '@/lib/firebase-admin';
import { HttpError } from '@/lib/server/auth';
import { loadSimpelCatalog } from '@/lib/server/venueReservations';
import {
  SIMPEL_BOOKINGS_COLLECTION,
  SIMPEL_BUILDINGS_COLLECTION,
  SIMPEL_EQUIPMENT_COLLECTION,
  SIMPEL_MAINTENANCE_COLLECTION,
  SIMPEL_NOTIFICATIONS_COLLECTION,
  simpelProjectId,
} from '@/lib/simpel-admin';
import {
  awaitsReturnCheck,
  buildInspectionChecklist,
  compareRepairLogs,
  compareReturnInspections,
  normalizeMaintenanceLog,
  planCheckIn,
  planRepairResolution,
  toEquipmentStock,
  toRawBuilding,
  toRepairLogView,
  toReturnInspectionView,
  validateCheckInSubmission,
  type CheckInSubmission,
  type InspectionActor,
  type RepairLogView,
  type ReturnInspectionView,
} from '@/lib/venueInspection';
import {
  buildSimpelNotification,
  findBuilding,
  jakartaNow,
  normalizeSimpelBooking,
  withoutUndefined,
  type NotificationDraft,
  type SimpelBooking,
} from '@/lib/venueReservation';

/**
 * Pemeriksaan Ruang on SIMPEL's database: listing rooms waiting for their
 * return check and SIMPEL's repair log, checking a room in, and closing a
 * repair. Rules live in `@/lib/venueInspection`; this file only reads, runs
 * the transactions and writes.
 */

type Firestore = firestore.Firestore;
type Transaction = firestore.Transaction;

// Bookings can carry a base64 letter of several MB; only read what the check uses.
const BOOKING_FIELDS = [
  'pemohon',
  'gedung',
  'ruangan',
  'waktu',
  'jam',
  'kegiatan',
  'status',
  'fasilitasTambahan',
  'fasilitasDiserahkan',
  'serahTerimaSelesai',
  'peminjamDiterima',
  'peminjamSiapKembali',
  'checkInSelesai',
  'source',
  'sakuDisplayName',
  'sakuGroupDates',
  'sakuGroupIndex',
  'sakuGroupTotal',
];

const EQUIPMENT_STOCK_FIELDS = ['nama', 'totalStok', 'terpinjam', 'penanggungJawab', 'lokasiPenyimpanan'];

const SAFE_ID = /^[A-Za-z0-9_-]{1,120}$/;

export async function listReturnInspections(db: Firestore, now: Date = new Date()): Promise<ReturnInspectionView[]> {
  const [catalog, snapshot] = await Promise.all([
    loadSimpelCatalog(db),
    db
      .collection(SIMPEL_BOOKINGS_COLLECTION)
      .where('status', 'in', ['disetujui', 'selesai'])
      .select(...BOOKING_FIELDS)
      .get(),
  ]);
  const clock = jakartaNow(now);
  return snapshot.docs
    .map((document) => normalizeSimpelBooking(document.id, document.data()))
    .filter(awaitsReturnCheck)
    .map((booking) => toReturnInspectionView(booking, catalog, clock))
    .sort(compareReturnInspections);
}

export async function listRepairLogs(db: Firestore): Promise<RepairLogView[]> {
  const snapshot = await db.collection(SIMPEL_MAINTENANCE_COLLECTION).get();
  return snapshot.docs
    .map((document) => toRepairLogView(normalizeMaintenanceLog(document.id, document.data())))
    .sort(compareRepairLogs);
}

function logId(now: Date): string {
  return `${now.getTime()}-${randomBytes(3).toString('hex')}`;
}

function writeNotifications(
  db: Firestore,
  transaction: Transaction,
  drafts: NotificationDraft[],
  now: Date,
): void {
  // One millisecond apart so ids never collide within a transaction.
  drafts.forEach((draft, index) => {
    const notification = buildSimpelNotification(draft, new Date(now.getTime() + index), randomInt(1000));
    transaction.create(db.collection(SIMPEL_NOTIFICATIONS_COLLECTION).doc(notification.id), notification);
  });
}

export interface CheckInResult {
  booking: SimpelBooking;
  damageSummaries: string[];
  logIds: string[];
}

/**
 * Checks a room in, in one transaction on SIMPEL's database. The booking is
 * re-read inside it, so a room SIMPEL's staff (or another Pekarya) checked in
 * a moment ago is refused instead of being counted twice, and the stock and
 * building documents are read fresh before they are changed.
 */
export async function completeReturnCheck(
  db: Firestore,
  actor: InspectionActor,
  submission: CheckInSubmission,
  now: Date = new Date(),
): Promise<CheckInResult> {
  if (!SAFE_ID.test(submission.bookingId)) throw new HttpError(400, 'ID peminjaman tidak valid.');
  // The catalog (room fixtures, names) changes rarely; read it outside the transaction.
  const catalog = await loadSimpelCatalog(db);
  const bookingRef = db.collection(SIMPEL_BOOKINGS_COLLECTION).doc(submission.bookingId);

  return db.runTransaction(async (transaction) => {
    const bookingSnapshot = await transaction.get(bookingRef);
    if (!bookingSnapshot.exists) throw new HttpError(404, 'Peminjaman tidak ditemukan di SIMPEL.');
    const booking = normalizeSimpelBooking(bookingSnapshot.id, bookingSnapshot.data());
    if (booking.checkInSelesai) {
      throw new HttpError(409, 'Ruangan ini sudah diperiksa. Muat ulang daftar pengembalian.');
    }
    if (!awaitsReturnCheck(booking)) {
      throw new HttpError(409, 'Peminjaman ini tidak sedang menunggu pemeriksaan pengembalian.');
    }

    const validation = validateCheckInSubmission(submission, buildInspectionChecklist(booking, catalog));
    if (!validation.ok) throw new HttpError(validation.stale ? 409 : 400, validation.error);

    const catalogBuilding = findBuilding(catalog.buildings, booking.gedung);
    const buildingRef = catalogBuilding ? db.collection(SIMPEL_BUILDINGS_COLLECTION).doc(catalogBuilding.id) : null;
    const [buildingSnapshot, equipmentSnapshot] = await Promise.all([
      buildingRef ? transaction.get(buildingRef) : Promise.resolve(null),
      transaction.get(db.collection(SIMPEL_EQUIPMENT_COLLECTION).select(...EQUIPMENT_STOCK_FIELDS)),
    ]);

    const plan = planCheckIn({
      booking,
      inspection: validation.value,
      building: buildingSnapshot?.exists ? toRawBuilding(buildingSnapshot.id, buildingSnapshot.data()) : null,
      equipment: equipmentSnapshot.docs
        .map((document) => toEquipmentStock(document.id, document.data()))
        .sort((left, right) => left.id.localeCompare(right.id)),
      actor,
      now,
      newId: () => logId(now),
    });

    transaction.update(bookingRef, plan.bookingPatch);
    for (const { id, patch } of plan.equipmentPatches) {
      transaction.update(db.collection(SIMPEL_EQUIPMENT_COLLECTION).doc(id), patch);
    }
    if (plan.buildingPatch) {
      transaction.update(db.collection(SIMPEL_BUILDINGS_COLLECTION).doc(plan.buildingPatch.id), plan.buildingPatch.patch);
    }
    for (const log of plan.logs) {
      transaction.create(db.collection(SIMPEL_MAINTENANCE_COLLECTION).doc(log.id), withoutUndefined(log));
    }
    writeNotifications(db, transaction, plan.notifications, now);

    return {
      booking: normalizeSimpelBooking(booking.id, { ...bookingSnapshot.data(), ...plan.bookingPatch }),
      damageSummaries: plan.damageSummaries,
      logIds: plan.logs.map((log) => log.id),
    };
  });
}

export interface RepairResult {
  logId: string;
  namaBarang: string;
  restored: string[];
}

/** Marks a repair done, in one transaction, putting stock (and a closed room) back as `planRepairResolution` says. */
export async function resolveRepair(
  db: Firestore,
  actor: InspectionActor,
  logId: string,
  now: Date = new Date(),
): Promise<RepairResult> {
  if (!SAFE_ID.test(logId)) throw new HttpError(400, 'ID catatan perbaikan tidak valid.');
  const logRef = db.collection(SIMPEL_MAINTENANCE_COLLECTION).doc(logId);

  return db.runTransaction(async (transaction) => {
    const logSnapshot = await transaction.get(logRef);
    if (!logSnapshot.exists) throw new HttpError(404, 'Catatan perbaikan tidak ditemukan di SIMPEL.');
    const log = normalizeMaintenanceLog(logSnapshot.id, logSnapshot.data());
    if (log.status === 'Selesai') throw new HttpError(409, 'Perbaikan ini sudah ditandai selesai.');

    const equipmentId = SAFE_ID.test(log.fasilitasId) ? log.fasilitasId : null;
    const target = log.source === 'saku' ? log.sakuTarget : undefined;
    const buildingId =
      target && (target.kind === 'building-item' || target.kind === 'room') && target.buildingId && SAFE_ID.test(target.buildingId)
        ? target.buildingId
        : null;

    const [equipmentSnapshot, buildingSnapshot, openRoomLogs] = await Promise.all([
      equipmentId ? transaction.get(db.collection(SIMPEL_EQUIPMENT_COLLECTION).doc(equipmentId)) : Promise.resolve(null),
      buildingId ? transaction.get(db.collection(SIMPEL_BUILDINGS_COLLECTION).doc(buildingId)) : Promise.resolve(null),
      target?.kind === 'room'
        ? transaction.get(
            db
              .collection(SIMPEL_MAINTENANCE_COLLECTION)
              .where('fasilitasId', '==', log.fasilitasId)
              .where('status', '==', 'Dalam Perbaikan')
              .select('sakuTarget'),
          )
        : Promise.resolve(null),
    ]);

    const plan = planRepairResolution({
      log,
      equipment: equipmentSnapshot?.exists ? toEquipmentStock(equipmentSnapshot.id, equipmentSnapshot.data()) : null,
      building: buildingSnapshot?.exists ? toRawBuilding(buildingSnapshot.id, buildingSnapshot.data()) : null,
      otherOpenRoomLogs: openRoomLogs
        ? openRoomLogs.docs.filter((document) => document.id !== log.id).length
        : 0,
      actor,
      now,
    });

    transaction.update(logRef, plan.logPatch);
    if (plan.equipmentPatch) {
      transaction.update(db.collection(SIMPEL_EQUIPMENT_COLLECTION).doc(plan.equipmentPatch.id), plan.equipmentPatch.patch);
    }
    if (plan.buildingPatch) {
      transaction.update(db.collection(SIMPEL_BUILDINGS_COLLECTION).doc(plan.buildingPatch.id), plan.buildingPatch.patch);
    }
    writeNotifications(db, transaction, plan.notifications, now);

    return { logId: log.id, namaBarang: log.namaBarang, restored: plan.restored };
  });
}

/**
 * Written to SAKU's own `audit_logs` after SIMPEL accepted the change. A failed
 * audit write is logged, not thrown: the change is already made in SIMPEL.
 */
export async function recordInspectionAudit(
  actor: InspectionActor & { email: string | null; role: string },
  action: 'VENUE_RETURN_CHECKED' | 'VENUE_REPAIR_RESOLVED',
  details: Record<string, unknown>,
): Promise<void> {
  try {
    await adminDb.collection('audit_logs').add({
      action,
      actorUid: actor.uid,
      actorEmail: actor.email,
      actorRole: actor.role,
      simpelProjectId: simpelProjectId(),
      details,
      timestamp: new Date().toISOString(),
    });
  } catch (err) {
    console.error('Failed to write venue inspection audit log:', err);
  }
}
