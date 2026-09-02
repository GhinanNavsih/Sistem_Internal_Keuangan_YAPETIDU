import { RekapColumn } from '@/types';
import { SATPAM_RATES } from '@/lib/payroll/domain';
import { SATPAM_MONTHLY_ATTENDANCE_BONUS } from '@/lib/payroll/satpamDutyPlan';

// ─── Hardcoded multiplier rates ─────────────────────────────────────────────
export const RATE_HARIAN = SATPAM_RATES.Harian;
export const RATE_JUMAT  = SATPAM_RATES['Jumat & Libur'];
export const RATE_LEMBUR_SENDIRI = SATPAM_RATES['Lembur Sendiri'];
export const RATE_LEMBUR_COVER = SATPAM_RATES['Lembur Cover'];
export const RATE_BONUS_MUTLAK = 50_000;
export const RATE_BONUS_BULANAN = 17_500;
export const RATE_BONUS_PRESENSI_BULANAN = SATPAM_MONTHLY_ATTENDANCE_BONUS;
export const RATE_BONUS_PRESENSI_TRIWULANAN = 300_000;
export const RATE_PIKET = 15_000;

// ─── Column configs per job category ────────────────────────────────────────
// Each category can have a different set of columns.
// 'count' columns are raw attendance counts that get multiplied.
// 'currency' columns are direct Rp amounts from the rekap.

export const REKAP_COLUMNS: Record<string, RekapColumn[]> = {
  SATPAM: [
    { key: 'harian',                 label: 'Harian',                     type: 'count',    multiplier: RATE_HARIAN,                    slipLabel: 'Vakasi Harian' },
    { key: 'jumatLibur',             label: 'Jumat & Libur',              type: 'count',    multiplier: RATE_JUMAT,                     slipLabel: 'Jumat & Libur' },
    { key: 'lemburSendiri',          label: 'Lembur Sendiri',             type: 'count',    multiplier: RATE_LEMBUR_SENDIRI,            slipLabel: 'Lembur Sendiri' },
    { key: 'lemburCover',            label: 'Lembur Cover',               type: 'count',    multiplier: RATE_LEMBUR_COVER,              slipLabel: 'Lembur Cover' },
    { key: 'bonusPresensiBulanan',   label: 'Bonus Presensi Bulanan',     type: 'count',    multiplier: RATE_BONUS_PRESENSI_BULANAN,    slipLabel: 'Bonus Presensi Bulanan' },
    { key: 'bonusPresensiTriwulanan', label: 'Bonus Presensi Triwulanan',   type: 'count',    multiplier: RATE_BONUS_PRESENSI_TRIWULANAN,  slipLabel: 'Bonus Presensi Triwulanan' },
    { key: 'spj',                    label: 'SPJ',                        type: 'currency',                                             slipLabel: 'SPJ' },
    { key: 'tunjanganJabatan',       label: 'Tunjangan Jabatan',          type: 'currency',                                             slipLabel: 'Tunjangan Jabatan' },
    { key: 'bonusLainnya',           label: 'Bonus Lainnya',              type: 'count',    multiplier: RATE_BONUS_BULANAN,             slipLabel: 'Bonus Lainnya' },
  ],
  KEBERSIHAN: [
    { key: 'harian',             label: 'Harian',                 type: 'count',    multiplier: RATE_HARIAN,         slipLabel: 'Vakasi Harian' },
    { key: 'jumatLibur',         label: 'Jumat & Libur',          type: 'count',    multiplier: RATE_JUMAT,          slipLabel: 'Jumat & Libur' },
    { key: 'bonusPresensi',      label: 'Bonus Presensi',         type: 'currency',                                  slipLabel: 'Bonus Presensi' },
    // Retain the legacy attendance earning while historical records are
    // merged into KEBERSIHAN. New attendance publications replace this field
    // with harian/jumatLibur through the existing propagation rule.
    { key: 'presensi',           label: 'Presensi',               type: 'currency',                                  slipLabel: 'Presensi' },
    { key: 'spj',                label: 'SPJ',                    type: 'currency',                                  slipLabel: 'SPJ' },
    { key: 'tunjanganKhusus',    label: 'Tunjangan Khusus',       type: 'currency',                                  slipLabel: 'Tunjangan Khusus' },
  ],
  KEBERSIHAN_PONTI: [
    { key: 'presensi',           label: 'Presensi',               type: 'currency',                                  slipLabel: 'Presensi' },
    { key: 'spj',                label: 'SPJ',                    type: 'currency',                                  slipLabel: 'SPJ' },
  ],
  PONTI: [
    { key: 'presensi',           label: 'Presensi',               type: 'currency',                                  slipLabel: 'Presensi' },
    { key: 'spj',                label: 'SPJ',                    type: 'currency',                                  slipLabel: 'SPJ' },
  ],
  PEKARYA: [
    { key: 'harian',             label: 'Harian',                 type: 'count',    multiplier: RATE_HARIAN,         slipLabel: 'Vakasi Harian' },
    { key: 'jumatLibur',         label: 'Jumat & Libur',          type: 'count',    multiplier: RATE_JUMAT,          slipLabel: 'Jumat & Libur' },
    { key: 'bonusPresensi',      label: 'Bonus Presensi',         type: 'currency',                                  slipLabel: 'Bonus Presensi' },
    { key: 'spj',                label: 'SPJ',                    type: 'currency',                                  slipLabel: 'SPJ' },
    { key: 'tunjanganKhusus',    label: 'Tunjangan Khusus',       type: 'currency',                                  slipLabel: 'Tunjangan Khusus' },
  ],
  TEKNISI: [
    { key: 'harian',             label: 'Harian',                 type: 'count',    multiplier: RATE_HARIAN,         slipLabel: 'Vakasi Harian' },
    { key: 'jumatLibur',         label: 'Jumat & Libur',          type: 'count',    multiplier: RATE_JUMAT,          slipLabel: 'Jumat & Libur' },
    { key: 'bonusMutlak',        label: 'Bonus Mutlak',           type: 'count',    multiplier: RATE_BONUS_MUTLAK,   slipLabel: 'Bonus Mutlak' },
    { key: 'lembur',             label: 'Lembur',                 type: 'currency',                                  slipLabel: 'Lembur' },
    { key: 'spj',                label: 'SPJ',                    type: 'currency',                                  slipLabel: 'SPJ' },
  ],
  SOPIR: [
    { key: 'harian',             label: 'Harian',                 type: 'count',    multiplier: RATE_HARIAN,         slipLabel: 'Vakasi Harian' },
    { key: 'jumatLibur',         label: 'Jumat & Libur',          type: 'count',    multiplier: RATE_JUMAT,          slipLabel: 'Jumat & Libur' },
    { key: 'bonusMutlak',        label: 'Bonus Mutlak',           type: 'count',    multiplier: RATE_BONUS_MUTLAK,   slipLabel: 'Bonus Mutlak' },
    { key: 'piket',              label: 'Piket',                  type: 'count',    multiplier: RATE_PIKET,          slipLabel: 'Piket' },
    { key: 'praktek',            label: 'Praktek',                type: 'currency',                                  slipLabel: 'Praktek' },
    { key: 'spj',                label: 'SPJ',                    type: 'currency',                                  slipLabel: 'SPJ' },
    { key: 'tunjangan',          label: 'Tunjangan',              type: 'currency',                                  slipLabel: 'Tunjangan' },
  ],
};

// ─── Helper: compute slip amount from a raw value ───────────────────────────
export function computeSlipAmount(column: RekapColumn, rawValue: number): number {
  if (column.type === 'count' && column.multiplier) {
    return rawValue * column.multiplier;
  }
  return rawValue; // currency columns are used as-is
}

// ─── Helper: build computed values map for an entry ─────────────────────────
export function computeAllSlipAmounts(
  values: Record<string, number>,
  columns: RekapColumn[]
): Record<string, number> {
  const computed: Record<string, number> = {};
  for (const col of columns) {
    if (col.slipLabel) {
      computed[col.key] = computeSlipAmount(col, values[col.key] ?? 0);
    }
  }
  return computed;
}

// ─── Supported job categories ───────────────────────────────────────────────
export const SUPPORTED_CATEGORIES = Object.keys(REKAP_COLUMNS);

const ATTENDANCE_HARIAN_COLUMN: RekapColumn = {
  key: 'harian',
  label: 'Harian',
  type: 'count',
  multiplier: RATE_HARIAN,
  slipLabel: 'Vakasi Harian',
};
const ATTENDANCE_PREMIUM_COLUMN: RekapColumn = {
  key: 'jumatLibur',
  label: 'Jumat & Libur',
  type: 'count',
  multiplier: RATE_JUMAT,
  slipLabel: 'Jumat & Libur',
};

export function getRekapColumns(
  category: string,
  period?: string,
): RekapColumn[] {
  const base = REKAP_COLUMNS[category] || REKAP_COLUMNS.KEBERSIHAN;
  const normalizedPeriod = normalizeRekapPeriod(period);
  if (!normalizedPeriod || normalizedPeriod < '2026-08' || category === 'SATPAM') {
    return base;
  }
  const withoutLegacyPresence = base.filter(
    (column) =>
      column.key !== 'presensi' &&
      column.key !== 'harian' &&
      column.key !== 'jumatLibur',
  );
  return [
    ATTENDANCE_HARIAN_COLUMN,
    ATTENDANCE_PREMIUM_COLUMN,
    ...withoutLegacyPresence,
  ];
}

function normalizeRekapPeriod(period?: string): string {
  if (!period) return '';
  const tokenMatch = /(\d{4})[-_](\d{2})/.exec(period);
  if (tokenMatch) return `${tokenMatch[1]}-${tokenMatch[2]}`;
  const yearMatch = /\b(20\d{2})\b/.exec(period);
  const monthIndex = MONTHS_ID.findIndex((month) =>
    period.toLocaleLowerCase('id-ID').includes(
      month.toLocaleLowerCase('id-ID'),
    ),
  );
  return yearMatch && monthIndex >= 0
    ? `${yearMatch[1]}-${String(monthIndex + 1).padStart(2, '0')}`
    : '';
}

export function isAttendanceDerivedRekapColumn(
  category: string,
  period: string,
  key: string,
): boolean {
  return (
    normalizeRekapPeriod(period) >= '2026-08' &&
    category !== 'SATPAM' &&
    (key === 'harian' || key === 'jumatLibur')
  );
}

// ─── Month labels ───────────────────────────────────────────────────────────
export const MONTHS_ID = [
  'Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni',
  'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember',
];
