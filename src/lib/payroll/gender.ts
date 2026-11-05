/**
 * Utilities for resolving employee gender under Indonesian National ID (NIK) standards
 * and statutory tax compliance (PMK No. 168/2023).
 */

export type Gender = 'male' | 'female';

/**
 * Derives employee gender from a 16-digit Indonesian NIK (Nomor Induk Kependudukan).
 *
 * Under UU No. 23/2006 on Population Administration:
 * - Digits 1-6: Regional identifiers (Provinsi, Kota/Kabupaten, Kecamatan)
 * - Digits 7-8: Day of birth
 *   - For males: birth day is 01–31.
 *   - For females: birth day is (day + 40), i.e., 41–71.
 * - Digits 9-10: Month of birth (01–12)
 * - Digits 11-12: Year of birth (2 digits)
 * - Digits 13-16: Sequence number
 *
 * Returns 'female' if birth day is between 41 and 71.
 * Returns 'male' if birth day is between 01 and 31.
 * Returns null if NIK is invalid or cannot be parsed.
 */
export function deriveGenderFromNik(nik: unknown): Gender | null {
  if (typeof nik !== 'string' && typeof nik !== 'number') return null;
  const cleaned = String(nik).replace(/[^0-9]/g, '');
  if (cleaned.length !== 16) return null;

  const day = parseInt(cleaned.substring(6, 8), 10);
  if (Number.isNaN(day)) return null;

  if (day >= 41 && day <= 71) {
    return 'female';
  }
  if (day >= 1 && day <= 31) {
    return 'male';
  }

  return null;
}

/**
 * Returns a human-friendly Indonesian label for gender.
 */
export function formatGenderLabel(gender: unknown): string {
  if (gender === 'female') return 'Perempuan';
  if (gender === 'male') return 'Laki-laki';
  return '-';
}
