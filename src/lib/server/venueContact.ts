import type { firestore } from 'firebase-admin';
import type { AuthenticatedProfile } from '@/lib/server/auth';
import {
  findEmployeePhone,
  readSavedContact,
  toEmployeeContactRecord,
  type EmployeeContactRecord,
  type ReservationContact,
} from '@/lib/venueReservationContact';

/**
 * The starting point for a booking's contact details: the number the user gave
 * last time, or else the one on their own employee record. See
 * `@/lib/venueReservationContact` for why a single name match is the bar.
 *
 * Takes the Firestore handle so the same code runs against the real database,
 * a test copy, or the emulator.
 */

type Firestore = firestore.Firestore;

/** Server-only (the rules deny every client): one document per account. */
export const VENUE_CONTACTS_COLLECTION = 'VenueReservationContacts';

const EMPLOYEE_COLLECTIONS = ['Employees_Loyalis', 'Employees_WhiteCollar', 'Employees_BlueCollar'] as const;

async function loadEmployeeContactRecords(db: Firestore): Promise<EmployeeContactRecord[]> {
  const snapshots = await Promise.all(
    EMPLOYEE_COLLECTIONS.map((collection) =>
      db.collection(collection).select('personal_info.name', 'personal_info.phone', 'name', 'phoneNumber').get(),
    ),
  );
  return snapshots.flatMap((snapshot) =>
    snapshot.docs
      .map((document) => toEmployeeContactRecord(document.data()))
      .filter((record): record is EmployeeContactRecord => record !== null),
  );
}

export async function loadReservationContact(
  db: Firestore,
  actor: Pick<AuthenticatedProfile, 'uid' | 'displayName'>,
): Promise<ReservationContact> {
  const saved = readSavedContact((await db.collection(VENUE_CONTACTS_COLLECTION).doc(actor.uid).get()).data());
  if (saved.phone) return { phone: saved.phone, pemohon: saved.pemohon, source: 'saved' };

  // Only reached until the first booking: after that the saved number is used and no scan happens.
  const phone = findEmployeePhone(actor.displayName, await loadEmployeeContactRecords(db));
  return { phone, pemohon: saved.pemohon, source: phone ? 'employee' : null };
}

/**
 * Remembers what was used for a booking, so the next one starts filled in on any
 * device. A failure is logged, not thrown: the booking already exists, and an
 * error here would invite a duplicate retry.
 */
export async function saveReservationContact(
  db: Firestore,
  uid: string,
  contact: { phone: string; pemohon: string },
  now: Date = new Date(),
): Promise<void> {
  try {
    await db
      .collection(VENUE_CONTACTS_COLLECTION)
      .doc(uid)
      .set({ phoneNumber: contact.phone, pemohon: contact.pemohon, updatedAt: now.toISOString() }, { merge: true });
  } catch (err) {
    console.error('Failed to save venue reservation contact:', err);
  }
}
