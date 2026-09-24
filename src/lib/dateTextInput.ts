import { isDateOnly } from '@/lib/payroll/annualPaidLeave';

/**
 * A date typed on the number keypad as dd/mm/yyyy. The field holds the text
 * exactly as displayed; the date itself is only read out of it once complete.
 */

const ISO_DATE_PATTERN = /^\s*(\d{4})-(\d{2})-(\d{2})\s*$/;

export const DATE_TEXT_LENGTH = 10;

/**
 * Turns whatever was typed or pasted into the dd/mm/yyyy mask, so typing
 * "25092026" reads "25/09/2026". A separator only appears once a digit follows
 * it, which keeps Backspace from getting stuck on a slash the mask would put
 * straight back. A pasted yyyy-mm-dd date is converted rather than scrambled.
 */
export function maskDateInput(raw: string): string {
  const iso = ISO_DATE_PATTERN.exec(raw);
  if (iso) return `${iso[3]}/${iso[2]}/${iso[1]}`;
  const digits = raw.replace(/\D/g, '').slice(0, 8);
  if (digits.length <= 2) return digits;
  if (digits.length <= 4) return `${digits.slice(0, 2)}/${digits.slice(2)}`;
  return `${digits.slice(0, 2)}/${digits.slice(2, 4)}/${digits.slice(4)}`;
}

/** "25/09/2026" → "2026-09-25"; '' unless the text is a complete, real date. */
export function displayDateToIso(text: string): string {
  const match = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(text);
  if (!match) return '';
  const iso = `${match[3]}-${match[2]}-${match[1]}`;
  return isDateOnly(iso) ? iso : '';
}

/** "2026-09-25" → "25/09/2026"; '' for anything that is not a real date. */
export function isoToDisplayDate(iso: string): string {
  return isDateOnly(iso) ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}` : '';
}

/** All ten characters typed, whether or not they make a real date. */
export function isCompleteDateText(text: string): boolean {
  return text.length === DATE_TEXT_LENGTH;
}
