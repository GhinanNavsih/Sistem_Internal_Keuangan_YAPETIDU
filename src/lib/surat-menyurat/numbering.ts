import { ROMAN_MONTHS } from './constants';

/**
 * Returns Roman numeral representation of a month (1-12).
 */
export function getRomanMonth(monthIndex1Based: number): string {
  if (monthIndex1Based < 1 || monthIndex1Based > 12) return 'I';
  return ROMAN_MONTHS[monthIndex1Based - 1];
}

/**
 * Converts a SatKer name to a clean initials/code abbreviation.
 * e.g. "Fakultas Agama Islam" -> "FAI", "Lembaga Penelitian dan Pengabdian" -> "LPPM", etc.
 */
export function deriveSatkerCode(satkerName: string): string {
  const trimmed = (satkerName || '').trim();
  if (!trimmed) return 'SATKER';

  // Common well-known abbreviations
  const lower = trimmed.toLowerCase();
  if (lower.includes('agama islam')) return 'FAI';
  if (lower.includes('ilmu kesehatan')) return 'FIK';
  if (lower.includes('bisnis') || lower.includes('ekonomi')) return 'FBE';
  if (lower.includes('bahasa') || lower.includes('sastra')) return 'FBS';
  if (lower.includes('sains') || lower.includes('teknologi')) return 'FST';
  if (lower.includes('penelitian') || lower.includes('lppm')) return 'LPPM';
  if (lower.includes('penjaminan mutu') || lower.includes('lpm')) return 'BPM';
  if (lower.includes('baak') || lower.includes('administrasi akademik')) return 'BAAK';
  if (lower.includes('keuangan') || lower.includes('bak')) return 'BAK';
  if (lower.includes('perpustakaan')) return 'PERPUS';
  if (lower.includes('pondok') || lower.includes('pesantren')) return 'PPDU';

  // Fallback: take first letters of uppercase words
  const words = trimmed.replace(/[^a-zA-Z0-9\s]/g, '').split(/\s+/).filter(Boolean);
  const initials = words.map((w) => w[0].toUpperCase()).join('');
  return initials.slice(0, 6) || 'SATKER';
}

/**
 * Generates official letter number format:
 * Format: {NoUrut}/{SatkerCode}/UNIPDU/{BulanRomawi}/{Tahun}
 * Example: 015/FAI/UNIPDU/XI/2026
 */
export function formatNomorSuratKeluar({
  sequenceNumber,
  satkerCode,
  date,
}: {
  sequenceNumber: number;
  satkerCode: string;
  date: Date;
}): string {
  const paddedSeq = String(Math.max(1, sequenceNumber)).padStart(3, '0');
  const monthRoman = getRomanMonth(date.getMonth() + 1);
  const year = date.getFullYear();
  const code = (satkerCode || 'SATKER').trim().toUpperCase();

  return `${paddedSeq}/${code}/UNIPDU/${monthRoman}/${year}`;
}
