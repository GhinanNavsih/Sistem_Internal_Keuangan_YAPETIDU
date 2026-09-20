/**
 * Where a Kepala SatKer's WhatsApp number comes from, so the booking form can
 * fill it in instead of asking every time.
 *
 * A login account carries no phone number and no link to an employee record
 * (`linkedEmployeeId` is only set for honorer, loyalis and ketua shift), but the
 * person is an employee, so their record can be found by name. Because a wrong
 * match would put a colleague's number on a booking, only a single record whose
 * name matches (titles and degrees ignored) is trusted; none, or several, means
 * "unknown" and the user types the number once. The form always shows the
 * number it filled in, so a mistake is visible before anything is sent.
 *
 * Firebase-free so it can be unit-tested; the reads and writes are in
 * `@/lib/server/venueContact`.
 */
import { normalizeName } from './payroll/employeeNames';
import { contactNumberError, MAX_PEMOHON_LENGTH, textFieldError } from './venueReservation';

export type ContactSource = 'saved' | 'employee';

/** What the booking form is offered as a starting point. */
export interface ReservationContact {
  phone: string | null;
  pemohon: string | null;
  source: ContactSource | null;
}

/** One employee record reduced to what matching needs. */
export interface EmployeeContactRecord {
  name: string;
  phone: unknown;
}

/**
 * Turns however a number was written ("0812 3456 7890", "+62-812-3456-7890",
 * "0812-3456-7890 (WA)", or two numbers separated by "/") into plain digits.
 * Null unless the result is a usable number.
 *
 * Stored numbers are mostly international ("+62 812…", often copied from WhatsApp
 * with invisible marks around them), while the booking form, its examples and
 * SIMPEL all use the local "0812…" form. So an Indonesian number always comes
 * out local, and a number from another country keeps its "+".
 */
export function cleanPhoneNumber(raw: unknown): string | null {
  if (typeof raw !== 'string' && typeof raw !== 'number') return null;

  // Several numbers in one field: use the first one that works.
  for (const part of String(raw).split(/[/,;]|\b(?:atau|dan)\b/i)) {
    const digits = part.replace(/\D/g, '');
    if (!digits) continue;
    const hasPlus = /^[^\d+]*\+/.test(part);
    // "62" is Indonesia's country code; "+62 0812…" (a stray zero) must not become "00812…".
    const candidate = digits.startsWith('62')
      ? `0${digits.slice(2).replace(/^0+/, '')}`
      : hasPlus
        ? `+${digits}`
        : digits;
    if (contactNumberError(candidate) === null) return candidate;
  }
  return null;
}

/** An employee document, in either of the two shapes SAKU stores (nested `personal_info` or flat). */
export function toEmployeeContactRecord(data: unknown): EmployeeContactRecord | null {
  if (!data || typeof data !== 'object') return null;
  const record = data as Record<string, unknown>;
  const info = (record.personal_info && typeof record.personal_info === 'object'
    ? record.personal_info
    : {}) as Record<string, unknown>;
  const name = typeof info.name === 'string' ? info.name : typeof record.name === 'string' ? record.name : '';
  if (!name.trim()) return null;
  return { name, phone: info.phone ?? record.phoneNumber };
}

/** The phone of the one employee whose name matches, or null when none or several do. */
export function findEmployeePhone(
  displayName: string,
  records: EmployeeContactRecord[],
): string | null {
  const target = normalizeName(displayName);
  if (!target) return null;
  const matches = records.filter((record) => normalizeName(record.name) === target);
  return matches.length === 1 ? cleanPhoneNumber(matches[0].phone) : null;
}

/** The number and unit name saved after a previous booking, read defensively. */
export function readSavedContact(data: unknown): { phone: string | null; pemohon: string | null } {
  const record = data && typeof data === 'object' ? (data as Record<string, unknown>) : {};
  const pemohon = typeof record.pemohon === 'string' ? record.pemohon.trim() : '';
  return {
    phone: cleanPhoneNumber(record.phoneNumber),
    pemohon: pemohon && !textFieldError(pemohon, 'Pemohon / unit', MAX_PEMOHON_LENGTH) ? pemohon : null,
  };
}
