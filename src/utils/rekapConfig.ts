import { RekapColumn } from '@/types';

// ─── Hardcoded multiplier rates ─────────────────────────────────────────────
export const RATE_HARIAN = 12_500;
export const RATE_JUMAT  = 25_000;

// ─── Column configs per job category ────────────────────────────────────────
// Each category can have a different set of columns.
// 'count' columns are raw attendance counts that get multiplied.
// 'currency' columns are direct Rp amounts from the rekap.

export const REKAP_COLUMNS: Record<string, RekapColumn[]> = {
  KEBERSIHAN: [
    { key: 'harian',          label: 'Harian',           type: 'count',    multiplier: RATE_HARIAN, slipLabel: 'Vakasi Harian' },
    { key: 'jumatLibur',      label: "Jum'at/H.Libur",   type: 'count',    multiplier: RATE_JUMAT,  slipLabel: "Bonus Jum'at" },
    { key: 'ijinSakit',       label: 'Ijin/Sakit',       type: 'count' },
    { key: 'bonusPresensi',   label: 'Bonus Presensi',   type: 'currency', slipLabel: 'Bonus presensi' },
    { key: 'bonusFinger',     label: 'Bonus Finger',     type: 'currency', slipLabel: 'Bonus Finger' },
    { key: 'bonusTriwulan',   label: 'Bonus Triwulan',   type: 'currency', slipLabel: 'bonus triwulan' },
    { key: 'lemburSPJ',       label: 'SPJ/Lainnya',      type: 'currency', slipLabel: 'Blangko Lembur / lembur SPJ' },
    { key: 'tunjanganKhusus', label: 'Tunj. Khusus',     type: 'currency', slipLabel: 'Tunj. Khusus' },
  ],
  SOPIR: [
    { key: 'harian',          label: 'Harian',           type: 'currency', slipLabel: 'Presensi Harian' },
    { key: 'jumatLibur',      label: 'Bonus Jumat',      type: 'currency', slipLabel: 'Bonus Jumat' },
    { key: 'bonusPresensi',   label: 'Bonus Presensi',   type: 'currency', slipLabel: 'Bonus Presensi' },
    { key: 'piket',           label: 'Piket',            type: 'currency', slipLabel: 'Piket' },
    { key: 'praktek',         label: 'Praktek',          type: 'currency', slipLabel: 'Praktek' },
    { key: 'lemburSPJ',       label: 'SPJ Sopir',        type: 'currency', slipLabel: 'SPJ Sopir' },
    { key: 'tunjanganKhusus', label: 'Tunjangan',        type: 'currency', slipLabel: 'Tunjangan' },
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
