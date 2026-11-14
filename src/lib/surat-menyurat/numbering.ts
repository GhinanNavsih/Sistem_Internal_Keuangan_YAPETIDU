import { ROMAN_MONTHS } from './constants';
import { InstitutionScope } from './types';
import { normalizeSatkerInitials, satkerInitialsProblem } from './satkerInitials';

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
  if (lower.includes('yapetidu') || lower.includes('yayasan')) return 'YPTDU';
  if (lower.includes('rektorat') || lower.includes('rektor')) return 'A';
  if (lower.includes('baak') || lower.includes('administrasi akademik')) return 'BAAK';
  if (lower.includes('keuangan') || lower.includes('bak')) return 'BAK';
  if (lower.includes('agama islam')) return 'FAI';
  if (lower.includes('ilmu kesehatan')) return 'FIK';
  if (lower.includes('bisnis') || lower.includes('ekonomi') || lower.includes('ilmu administrasi')) return 'FIA';
  if (lower.includes('bahasa') || lower.includes('sastra')) return 'FBS';
  if (lower.includes('sains') || lower.includes('teknologi') || lower.includes('mipa') || lower.includes('teknik')) return 'FST';
  if (lower.includes('penelitian') || lower.includes('lppm')) return 'LPPM';
  if (lower.includes('penjaminan mutu') || lower.includes('lpm') || lower.includes('pjm')) return 'BPM';
  if (lower.includes('perpustakaan')) return 'PERPUS';
  if (lower.includes('pondok') || lower.includes('pesantren')) return 'PPDU';

  // Fallback: take first letters of uppercase words
  const words = trimmed.replace(/[^a-zA-Z0-9\s]/g, '').split(/\s+/).filter(Boolean);
  const initials = words.map((w) => w[0].toUpperCase()).join('');
  return initials.slice(0, 6) || 'SATKER';
}

/**
 * Calculates archival age dynamically, exactly replicating the Excel formula:
 * L = TODAY()
 * M = INT((L - TanggalSurat) / 360) (years)
 * N = INT((((L - TanggalSurat) - (M * 365)) / 365) * 12) (months)
 * Output: "=CONCATENATE(M, ' tahun ', N, ' bulan ')"
 */
export function calculateUsiaArsip(
  tanggalSurat: string | Date | undefined | null,
  asOfDate: Date = new Date()
): string {
  if (!tanggalSurat) return '-';
  const suratDate = typeof tanggalSurat === 'string' ? new Date(tanggalSurat) : tanggalSurat;
  if (isNaN(suratDate.getTime())) return '-';

  const diffMs = asOfDate.getTime() - suratDate.getTime();
  if (diffMs < 0) return '0 tahun 0 bulan';

  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
  const years = Math.floor(diffDays / 360);
  const remainingDays = diffDays - (years * 365);
  const months = Math.max(0, Math.floor((remainingDays / 365) * 12));

  return `${years} tahun ${months} bulan`;
}

/**
 * Formats official Archive Locator Code (Kode Arsip) matching the Excel convention:
 * - UNIPDU Surat Keluar: S.REKTOR,{001}
 * - YAPETIDU Surat Keluar: S.YPTDU.A.100.{1}
 * - Surat Masuk: A.1.R1.{klasifikasi},{01}
 */
export function formatKodeArsip({
  type = 'keluar',
  institutionScope = 'UNIPDU',
  sequenceNumber,
  klasifikasiCode = '100',
}: {
  type?: 'masuk' | 'keluar';
  institutionScope?: InstitutionScope;
  sequenceNumber: number;
  klasifikasiCode?: string;
}): string {
  const seq = Math.max(1, sequenceNumber);
  const padded3 = String(seq).padStart(3, '0');
  const padded2 = String(seq).padStart(2, '0');

  if (type === 'masuk') {
    const cleanKlas = (klasifikasiCode || '100').replace(/[^0-9]/g, '') || '100';
    return `A.1.R1.${cleanKlas},${padded2}`;
  }

  if (institutionScope === 'YAPETIDU') {
    return `S.YPTDU.A.100.${seq}`;
  }

  // UNIPDU (Rektorat) default
  return `S.REKTOR,${padded3}`;
}

/**
 * Generates official letter number format replicating the Excel template logic:
 *
 * 1. UNIPDU (Rektorat) syntax:
 *    Single: {NoUrut}/A/{KodeJenis}/{BulanAngka}/{Tahun} -> e.g. 001/A/SK/1/2026
 *    Batch Range: {NoUrutStart}-{NoUrutEnd}/A/{KodeJenis}/{BulanAngka}/{Tahun} -> e.g. 011-015/A/AU/1/2026
 *
 * 2. YAPETIDU (Yayasan) syntax:
 *    Single: {NoUrut}/YPTDU/{KodeJenis}/{BulanAngka}/{Tahun} -> e.g. 001/YPTDU/SK/1/2026
 *    Batch Range: {NoUrutStart}-{NoUrutEnd}/YPTDU/{KodeJenis}/{BulanAngka}/{Tahun} -> e.g. 003-005/YPTDU/AU/1/2026
 *
 * 3. SatKer / Unit fallback syntax:
 *    {NoUrut}/{SatkerCode}/UNIPDU/{BulanRomawi}/{Tahun} -> e.g. 015/FAI/UNIPDU/XI/2026
 */
export function formatNomorSuratKeluarTemplate({
  sequenceNumber,
  sequenceNumberEnd,
  institutionScope = 'UNIPDU',
  satkerCode = 'A',
  kodeSurat = 'AU',
  date = new Date(),
}: {
  sequenceNumber: number;
  sequenceNumberEnd?: number;
  institutionScope?: InstitutionScope;
  satkerCode?: string;
  kodeSurat?: string;
  date?: Date;
}): string {
  const startNum = Math.max(1, sequenceNumber);
  const endNum = sequenceNumberEnd && sequenceNumberEnd > startNum ? sequenceNumberEnd : null;

  const paddedStart = String(startNum).padStart(3, '0');
  const seqPart = endNum ? `${paddedStart}-${String(endNum).padStart(3, '0')}` : paddedStart;

  const monthNum = date.getMonth() + 1;
  const year = date.getFullYear();
  const cleanKode = (kodeSurat || 'AU').trim().toUpperCase();

  if (institutionScope === 'UNIPDU') {
    return `${seqPart}/A/${cleanKode}/${monthNum}/${year}`;
  }

  if (institutionScope === 'YAPETIDU') {
    return `${seqPart}/YPTDU/${cleanKode}/${monthNum}/${year}`;
  }

  // SATKER / Fakultas legacy syntax with Roman numeral month
  const code = (satkerCode || 'SATKER').trim().toUpperCase();
  const monthRoman = getRomanMonth(monthNum);
  return `${seqPart}/${code}/UNIPDU/${monthRoman}/${year}`;
}

/**
 * The SatKer code for a Surat Keluar number: the head's saved initials when they
 * are valid, otherwise a code guessed from the SatKer name (accounts made before
 * initials existed).
 */
export function satkerCodeFor(initials: unknown, satkerName: string): string {
  return satkerInitialsProblem(initials) === null
    ? normalizeSatkerInitials(initials)
    : deriveSatkerCode(satkerName);
}

/**
 * Standard UNIPDU SatKer letter number generator (legacy wrapper for backwards compatibility)
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
