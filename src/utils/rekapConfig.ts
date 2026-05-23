import { RekapColumn } from '@/types';

// ─── Hardcoded multiplier rates ─────────────────────────────────────────────
export const RATE_HARIAN = 12_500;
export const RATE_JUMAT  = 25_000;
export const RATE_LEMBUR_SENDIRI = 30_000;
export const RATE_LEMBUR_COVER = 50_000;
export const RATE_BONUS_MUTLAK = 50_000;
export const RATE_BONUS_BULANAN = 17_500;
export const RATE_BONUS_PRESENSI_BULANAN = 100_000;
export const RATE_BONUS_PRESENSI_TRIWULANAN = 300_000;

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
    { key: 'bonusMutlak',            label: 'Bonus Presensi Mutlak',      type: 'count',    multiplier: RATE_BONUS_MUTLAK,              slipLabel: 'Bonus Presensi Mutlak' },
    { key: 'spj',                    label: 'SPJ',                        type: 'currency',                                             slipLabel: 'SPJ' },
    { key: 'tunjanganJabatan',       label: 'Tunjangan Jabatan',          type: 'currency',                                             slipLabel: 'Tunjangan Jabatan' },
    { key: 'bonusLainnya',           label: 'Bonus Lainnya',              type: 'count',    multiplier: RATE_BONUS_BULANAN,             slipLabel: 'Bonus Lainnya' },
  ],
  KEBERSIHAN: [
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
    { key: 'piket',              label: 'Piket',                  type: 'currency',                                  slipLabel: 'Piket' },
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

// ─── Month labels ───────────────────────────────────────────────────────────
export const MONTHS_ID = [
  'Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni',
  'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember',
];
