import type { MoneyField } from '@/lib/payroll/domain';
import { eligibleFamilyMetrics, familyAllowancePeriodDate } from './familyAllowance';
import { deriveGenderFromNik, formatGenderLabel, type Gender } from './gender';

export { deriveGenderFromNik, formatGenderLabel, type Gender };

// ─── PPh 21 TER (Tarif Efektif Rata-Rata) Types & Tables (PP 58/2023 & PMK 168/2023) ───

export type PtkpStatus =
  | 'TK/0'
  | 'TK/1'
  | 'TK/2'
  | 'TK/3'
  | 'K/0'
  | 'K/1'
  | 'K/2'
  | 'K/3';

export type TerCategory = 'A' | 'B' | 'C';

export interface TerBracket {
  readonly maxGross: number; // Upper bracket boundary in IDR (inclusive). Infinity for highest tier.
  readonly rate: number;     // Decimal tax rate, e.g. 0.0025 for 0.25%
}

/**
 * Mapping of PTKP status to TER Category under PP 58/2023 & PMK 168/2023.
 *
 * Category A: TK/0 (PTKP 54 jt), TK/1 (PTKP 58.5 jt), K/0 (PTKP 58.5 jt)
 * Category B: TK/2 (PTKP 63 jt), TK/3 (PTKP 67.5 jt), K/1 (PTKP 63 jt), K/2 (PTKP 67.5 jt)
 * Category C: K/3 (PTKP 72 jt)
 */
export const PTKP_TO_TER_CATEGORY: Record<PtkpStatus, TerCategory> = {
  'TK/0': 'A',
  'TK/1': 'A',
  'K/0': 'A',
  'TK/2': 'B',
  'TK/3': 'B',
  'K/1': 'B',
  'K/2': 'B',
  'K/3': 'C',
};

/** Tabel Tarif Efektif Bulanan Kategori A (44 tiers) */
export const TER_BULANAN_A: readonly TerBracket[] = [
  { maxGross: 5_400_000, rate: 0 },
  { maxGross: 5_650_000, rate: 0.0025 },
  { maxGross: 5_950_000, rate: 0.005 },
  { maxGross: 6_300_000, rate: 0.0075 },
  { maxGross: 6_750_000, rate: 0.01 },
  { maxGross: 7_500_000, rate: 0.0125 },
  { maxGross: 8_550_000, rate: 0.015 },
  { maxGross: 9_650_000, rate: 0.0175 },
  { maxGross: 10_050_000, rate: 0.02 },
  { maxGross: 10_350_000, rate: 0.0225 },
  { maxGross: 10_700_000, rate: 0.025 },
  { maxGross: 11_050_000, rate: 0.03 },
  { maxGross: 11_600_000, rate: 0.035 },
  { maxGross: 12_500_000, rate: 0.04 },
  { maxGross: 13_750_000, rate: 0.05 },
  { maxGross: 15_100_000, rate: 0.06 },
  { maxGross: 16_950_000, rate: 0.07 },
  { maxGross: 19_750_000, rate: 0.08 },
  { maxGross: 24_150_000, rate: 0.09 },
  { maxGross: 26_450_000, rate: 0.10 },
  { maxGross: 28_000_000, rate: 0.11 },
  { maxGross: 30_050_000, rate: 0.12 },
  { maxGross: 32_400_000, rate: 0.13 },
  { maxGross: 35_400_000, rate: 0.14 },
  { maxGross: 39_100_000, rate: 0.15 },
  { maxGross: 43_850_000, rate: 0.16 },
  { maxGross: 47_800_000, rate: 0.17 },
  { maxGross: 51_400_000, rate: 0.18 },
  { maxGross: 56_300_000, rate: 0.19 },
  { maxGross: 62_200_000, rate: 0.20 },
  { maxGross: 68_600_000, rate: 0.21 },
  { maxGross: 77_500_000, rate: 0.22 },
  { maxGross: 89_000_000, rate: 0.23 },
  { maxGross: 103_000_000, rate: 0.24 },
  { maxGross: 125_000_000, rate: 0.25 },
  { maxGross: 157_000_000, rate: 0.26 },
  { maxGross: 206_000_000, rate: 0.27 },
  { maxGross: 337_000_000, rate: 0.28 },
  { maxGross: 454_000_000, rate: 0.29 },
  { maxGross: 550_000_000, rate: 0.30 },
  { maxGross: 695_000_000, rate: 0.31 },
  { maxGross: 910_000_000, rate: 0.32 },
  { maxGross: 1_400_000_000, rate: 0.33 },
  { maxGross: Infinity, rate: 0.34 },
];

/** Tabel Tarif Efektif Bulanan Kategori B (40 tiers) */
export const TER_BULANAN_B: readonly TerBracket[] = [
  { maxGross: 6_200_000, rate: 0 },
  { maxGross: 6_500_000, rate: 0.0025 },
  { maxGross: 6_850_000, rate: 0.005 },
  { maxGross: 7_300_000, rate: 0.0075 },
  { maxGross: 9_200_000, rate: 0.01 },
  { maxGross: 10_750_000, rate: 0.015 },
  { maxGross: 11_250_000, rate: 0.02 },
  { maxGross: 11_600_000, rate: 0.025 },
  { maxGross: 12_600_000, rate: 0.03 },
  { maxGross: 13_600_000, rate: 0.04 },
  { maxGross: 14_950_000, rate: 0.05 },
  { maxGross: 16_400_000, rate: 0.06 },
  { maxGross: 18_450_000, rate: 0.07 },
  { maxGross: 21_850_000, rate: 0.08 },
  { maxGross: 26_000_000, rate: 0.09 },
  { maxGross: 27_700_000, rate: 0.10 },
  { maxGross: 29_350_000, rate: 0.11 },
  { maxGross: 31_450_000, rate: 0.12 },
  { maxGross: 33_950_000, rate: 0.13 },
  { maxGross: 37_100_000, rate: 0.14 },
  { maxGross: 41_100_000, rate: 0.15 },
  { maxGross: 45_800_000, rate: 0.16 },
  { maxGross: 49_500_000, rate: 0.17 },
  { maxGross: 53_800_000, rate: 0.18 },
  { maxGross: 58_500_000, rate: 0.19 },
  { maxGross: 64_000_000, rate: 0.20 },
  { maxGross: 71_000_000, rate: 0.21 },
  { maxGross: 80_000_000, rate: 0.22 },
  { maxGross: 93_000_000, rate: 0.23 },
  { maxGross: 109_000_000, rate: 0.24 },
  { maxGross: 129_000_000, rate: 0.25 },
  { maxGross: 163_000_000, rate: 0.26 },
  { maxGross: 211_000_000, rate: 0.27 },
  { maxGross: 374_000_000, rate: 0.28 },
  { maxGross: 459_000_000, rate: 0.29 },
  { maxGross: 555_000_000, rate: 0.30 },
  { maxGross: 704_000_000, rate: 0.31 },
  { maxGross: 957_000_000, rate: 0.32 },
  { maxGross: 1_405_000_000, rate: 0.33 },
  { maxGross: Infinity, rate: 0.34 },
];

/** Tabel Tarif Efektif Bulanan Kategori C (41 tiers) */
export const TER_BULANAN_C: readonly TerBracket[] = [
  { maxGross: 6_600_000, rate: 0 },
  { maxGross: 6_950_000, rate: 0.0025 },
  { maxGross: 7_350_000, rate: 0.005 },
  { maxGross: 7_800_000, rate: 0.0075 },
  { maxGross: 8_850_000, rate: 0.01 },
  { maxGross: 9_800_000, rate: 0.0125 },
  { maxGross: 10_950_000, rate: 0.015 },
  { maxGross: 11_200_000, rate: 0.0175 },
  { maxGross: 12_050_000, rate: 0.02 },
  { maxGross: 12_950_000, rate: 0.03 },
  { maxGross: 14_150_000, rate: 0.04 },
  { maxGross: 15_550_000, rate: 0.05 },
  { maxGross: 17_050_000, rate: 0.06 },
  { maxGross: 19_500_000, rate: 0.07 },
  { maxGross: 22_700_000, rate: 0.08 },
  { maxGross: 26_600_000, rate: 0.09 },
  { maxGross: 28_100_000, rate: 0.10 },
  { maxGross: 30_100_000, rate: 0.11 },
  { maxGross: 32_600_000, rate: 0.12 },
  { maxGross: 35_400_000, rate: 0.13 },
  { maxGross: 38_900_000, rate: 0.14 },
  { maxGross: 43_000_000, rate: 0.15 },
  { maxGross: 47_400_000, rate: 0.16 },
  { maxGross: 51_200_000, rate: 0.17 },
  { maxGross: 55_800_000, rate: 0.18 },
  { maxGross: 60_400_000, rate: 0.19 },
  { maxGross: 66_700_000, rate: 0.20 },
  { maxGross: 74_500_000, rate: 0.21 },
  { maxGross: 83_200_000, rate: 0.22 },
  { maxGross: 95_600_000, rate: 0.23 },
  { maxGross: 110_000_000, rate: 0.24 },
  { maxGross: 134_000_000, rate: 0.25 },
  { maxGross: 169_000_000, rate: 0.26 },
  { maxGross: 221_000_000, rate: 0.27 },
  { maxGross: 390_000_000, rate: 0.28 },
  { maxGross: 463_000_000, rate: 0.29 },
  { maxGross: 561_000_000, rate: 0.30 },
  { maxGross: 709_000_000, rate: 0.31 },
  { maxGross: 965_000_000, rate: 0.32 },
  { maxGross: 1_419_000_000, rate: 0.33 },
  { maxGross: Infinity, rate: 0.34 },
];

export const TER_TABLES: Record<TerCategory, readonly TerBracket[]> = {
  A: TER_BULANAN_A,
  B: TER_BULANAN_B,
  C: TER_BULANAN_C,
};

/** Type guard for PTKP status string. */
export function isPtkpStatus(val: unknown): val is PtkpStatus {
  return typeof val === 'string' && val in PTKP_TO_TER_CATEGORY;
}

/** Type guard for TER category string. */
export function isTerCategory(val: unknown): val is TerCategory {
  return val === 'A' || val === 'B' || val === 'C';
}

/**
 * Resolves the TER Category (A, B, or C) from a PTKP status string.
 * Defaults to 'A' (the baseline for TK/0) if unrecognized or omitted.
 */
export function resolveTerCategory(ptkp: string | undefined | null): TerCategory {
  if (typeof ptkp === 'string') {
    const normalized = ptkp.trim().toUpperCase();
    if (normalized in PTKP_TO_TER_CATEGORY) {
      return PTKP_TO_TER_CATEGORY[normalized as PtkpStatus];
    }
  }
  return 'A';
}

/**
 * Derives the canonical PTKP status from marital status and dependent count.
 * Tanggungan is capped at 3 dependents under Indonesian tax law.
 */
export function derivePtkpStatus(
  spouseCount: number | undefined | null,
  dependentsCount: number | undefined | null,
): PtkpStatus {
  const isMarried = (Number(spouseCount) || 0) >= 1;
  const rawDeps = Number(dependentsCount) || 0;
  const clampedDeps = Math.min(3, Math.max(0, Math.floor(rawDeps)));
  return (isMarried ? `K/${clampedDeps}` : `TK/${clampedDeps}`) as PtkpStatus;
}

/**
 * Retrieves the effective TER tax rate for a given category and monthly gross earnings.
 */
export function getTerRate(category: TerCategory, grossIncome: number): number {
  if (!Number.isFinite(grossIncome) || grossIncome <= 0) return 0;
  const brackets = TER_TABLES[category] || TER_BULANAN_A;
  for (const bracket of brackets) {
    if (grossIncome <= bracket.maxGross) {
      return bracket.rate;
    }
  }
  return 0.34;
}

/**
 * Computes the monthly PPh 21 tax amount under TER rules, rounded to whole Rupiah.
 */
export function calculateTerTaxAmount(category: TerCategory, grossIncome: number): number {
  if (!Number.isFinite(grossIncome) || grossIncome <= 0) return 0;
  const rate = getTerRate(category, grossIncome);
  return Math.round(grossIncome * rate);
}

/** Formats a decimal tax rate into a localized percentage string, e.g. 0.015 -> '1,5%'. */
export function formatTerRatePercent(rate: number): string {
  if (!Number.isFinite(rate) || rate <= 0) return '0%';
  const pct = +(rate * 100).toFixed(4);
  return `${pct.toString().replace('.', ',')}%`;
}

/** Returns the standard display label for a TER tax row on a payslip. */
export function formatTerTaxLabel(category: TerCategory, rate: number): string {
  return `Pajak Penghasilan PPh 21 (TER ${category} ${formatTerRatePercent(rate)})`;
}

/**
 * Produces the tax row(s) for a slip under TER rules based on gross earnings.
 * Returns empty array when rate is 0% (below threshold) or gross <= 0.
 */
export function resolveTerSlipTaxes(
  earnings: readonly MoneyField[] | undefined | null,
  ptkpOrCategory: PtkpStatus | TerCategory,
): MoneyField[] {
  const category = isTerCategory(ptkpOrCategory)
    ? ptkpOrCategory
    : resolveTerCategory(ptkpOrCategory);
  const gross = sumMoneyFields(earnings);
  const amount = calculateTerTaxAmount(category, gross);
  if (amount <= 0) return [];
  const rate = getTerRate(category, gross);
  return [{ label: formatTerTaxLabel(category, rate), amount }];
}

/**
 * Resolves an employee's PTKP status from explicit profile setting or
 * automatically derived from family allowance metrics.
 *
 * Priority:
 * 1. Explicit `emp.ptkp_status` or `emp.tax_profile?.ptkp_status` or `emp.ptkpStatus` (if valid PtkpStatus)
 * 2. Derived from `emp.family_allowance_metrics` (spouse_count + eligible children capped at 3)
 * 3. Defaults to 'TK/0' (e.g. for blue-collar / pekarya without family metrics)
 */
export function resolveEmployeePtkpStatus(
  emp: unknown,
  period?: string | Date,
): PtkpStatus {
  if (!emp || typeof emp !== 'object') return 'TK/0';
  const record = emp as Record<string, any>;
  const explicit = record.ptkp_status || record.tax_profile?.ptkp_status || record.ptkpStatus;
  if (isPtkpStatus(explicit)) return explicit;

  // Resolve gender (from explicit personal_info.gender, root gender, or derived from NIK)
  const gender: Gender | null =
    record.personal_info?.gender ||
    record.gender ||
    deriveGenderFromNik(record.personal_info?.nik || record.nik);

  // Under PMK 168/2023 Pasal 9 ayat (2), a married woman's default statutory PTKP is 'TK/0'
  // because the husband claims the family tax relief, unless she submits an official
  // certificate from the sub-district proving her husband has no income (represented by an explicit ptkp_status).
  if (gender === 'female') {
    return 'TK/0';
  }

  if (record.family_allowance_metrics) {
    const asOf = familyAllowancePeriodDate(period);
    const metrics = eligibleFamilyMetrics(record.family_allowance_metrics, asOf);
    const totalChildren =
      (metrics.children_sd || 0) +
      (metrics.children_sltp || 0) +
      (metrics.children_slta || 0) +
      (metrics.children_pt || 0);
    return derivePtkpStatus(metrics.spouse_count, totalChildren);
  }

  return 'TK/0';
}

/** Resolves an employee's TER Category ('A' | 'B' | 'C') based on their PTKP status. */
export function resolveEmployeeTerCategory(
  emp: unknown,
  period?: string | Date,
): TerCategory {
  return resolveTerCategory(resolveEmployeePtkpStatus(emp, period));
}

/** Check if any tax row was generated from the TER system. */
export function hasTerTax(taxes: readonly MoneyField[] | undefined | null): boolean {
  return (
    Array.isArray(taxes) &&
    taxes.some((t) => typeof t?.label === 'string' && t.label.includes('TER '))
  );
}

/** Extract the TER Category from an existing TER tax label. */
export function extractTerCategoryFromTaxes(
  taxes: readonly MoneyField[] | undefined | null,
): TerCategory | null {
  if (!Array.isArray(taxes)) return null;
  for (const tax of taxes) {
    if (typeof tax?.label === 'string') {
      const match = /\bTER\s+([ABC])\b/i.exec(tax.label);
      if (match) return match[1].toUpperCase() as TerCategory;
    }
  }
  return null;
}

/**
 * Resolves full TER tax details (PTKP status, Category, Rate, Gross, Tax Amount,
 * and Tax rows) for an employee given their profile and gross earnings.
 */
export function resolveSlipTaxDetails(
  emp: unknown,
  earnings: readonly MoneyField[] | undefined | null,
  period?: string | Date,
) {
  const ptkpStatus = resolveEmployeePtkpStatus(emp, period);
  const terCategory = resolveTerCategory(ptkpStatus);
  const gross = sumMoneyFields(earnings);
  const terRate = getTerRate(terCategory, gross);
  const taxAmount = calculateTerTaxAmount(terCategory, gross);
  const taxes: MoneyField[] =
    taxAmount > 0
      ? [{ label: formatTerTaxLabel(terCategory, terRate), amount: taxAmount }]
      : [];

  return {
    ptkpStatus,
    terCategory,
    terRate,
    gross,
    taxAmount,
    taxes,
    taxApplied: taxAmount > 0,
  };
}

// ─── Legacy / Transition Tax Logic (Flat 5% with Super Admin Selection) ───

/**
 * Payroll income tax — a slip category of its own, alongside earnings and
 * deductions.
 *
 * The rule: a slip whose pre-tax Gaji Bersih (total earnings minus total
 * deductions) reaches Rp 6.000.000 is taxed 5% of that same Gaji Bersih. Tax
 * is deliberately *not* a deduction row: it is applied after the deduction
 * subtotal, so the tax base can never depend on itself and the printed slip
 * can show Potongan and Pajak as separate sections.
 *
 * Selection is manual for now — a super admin applies the tax per employee in
 * Tinjau Slip Gaji. The *amount*, however, is never manual: every writer
 * derives it here from the rows it is about to persist, so a tax row can
 * never disagree with the base it was computed from, and a propagation that
 * moves an earning or a deduction re-derives the tax along with it.
 */

/** A slip is taxable once its pre-tax Gaji Bersih reaches this amount. */
export const PAYROLL_TAX_THRESHOLD = 6_000_000;

/** Flat rate applied to the whole pre-tax Gaji Bersih, not to the excess. */
export const PAYROLL_TAX_RATE = 0.05;

/** The single label every tax row carries. */
export const PAYROLL_TAX_LABEL = 'Pajak Penghasilan (5%)';

function sumFields(fields: readonly MoneyField[] | undefined | null): number {
  if (!Array.isArray(fields)) return 0;
  return fields.reduce((sum, field) => sum + (Number(field?.amount) || 0), 0);
}

/** Total of a money-row list; shared by every tax caller. */
export function sumMoneyFields(
  fields: readonly MoneyField[] | undefined | null,
): number {
  return sumFields(fields);
}

/**
 * The figure the tax is charged on: Gaji Bersih *before* tax.
 *
 * This is the same number the slip has always called Gaji Bersih. Once a tax
 * row exists the displayed Gaji Bersih drops below it, which is why the base
 * is computed from the rows rather than read back off the slip total.
 */
export function calculateTaxBase(
  earnings: readonly MoneyField[] | undefined | null,
  deductions: readonly MoneyField[] | undefined | null,
): number {
  return sumFields(earnings) - sumFields(deductions);
}

export function isTaxableBase(base: number): boolean {
  return Number.isFinite(base) && base >= PAYROLL_TAX_THRESHOLD;
}

/** 5% of the base, rounded to whole Rupiah; zero below the threshold. */
export function calculateTaxAmount(base: number): number {
  if (!isTaxableBase(base)) return 0;
  return Math.round(base * PAYROLL_TAX_RATE);
}

/** True when a slip carries a tax row with a real amount. */
export function hasTaxApplied(
  taxes: readonly MoneyField[] | undefined | null,
): boolean {
  return Array.isArray(taxes) && taxes.some((tax) => (Number(tax?.amount) || 0) > 0);
}

/** The shape every reader needs to recover a slip's tax selection. */
export interface TaxSelectionSource {
  taxApplied?: unknown;
  taxes?: readonly MoneyField[] | null;
  taxMethod?: unknown;
  ptkpStatus?: unknown;
  terCategory?: unknown;
  terRate?: unknown;
}

/**
 * Whether this employee is selected for tax.
 *
 * The selection is stored as its own boolean and must be, because an empty
 * `taxes` array is ambiguous: it means both "never selected" and "selected,
 * but the base is currently under the threshold". Reading the rows alone
 * would let one propagation run at Rp 5.9 juta erase a selection for good.
 * Slips written before the flag existed fall back to their rows.
 */
export function resolveTaxSelection(slip: TaxSelectionSource | null | undefined): boolean {
  if (typeof slip?.taxApplied === 'boolean') return slip.taxApplied;
  return hasTaxApplied(slip?.taxes);
}

/**
 * The tax rows a slip should carry, given the rows being saved and whether a
 * super admin has selected this employee for tax.
 *
 * A selected employee whose base has since fallen below the threshold gets no
 * tax row: the rule is what decides, not the click that preceded it.
 */
export function resolveSlipTaxes(
  earnings: readonly MoneyField[] | undefined | null,
  deductions: readonly MoneyField[] | undefined | null,
  taxApplied: boolean,
): MoneyField[] {
  if (!taxApplied) return [];
  const amount = calculateTaxAmount(calculateTaxBase(earnings, deductions));
  if (amount <= 0) return [];
  return [{ label: PAYROLL_TAX_LABEL, amount }];
}

/**
 * Re-derive an existing slip's tax rows against rows that have just changed,
 * keeping whatever selection or tax method the slip already carried.
 *
 * Automatically detects whether the slip was created under the TER system
 * (via `taxMethod === 'ter'`, `ptkpStatus`, `terCategory`, an explicit
 * `ptkpOrCategory` parameter, or an existing TER tax label) and recalculates
 * using the corresponding TER category and new gross earnings.
 * Otherwise, falls back to the legacy 5% scheme.
 */
export function recalculateSlipTaxes(
  storedSlip: TaxSelectionSource | null | undefined,
  earnings: readonly MoneyField[] | undefined | null,
  deductions: readonly MoneyField[] | undefined | null,
  ptkpOrCategory?: PtkpStatus | TerCategory,
): MoneyField[] {
  const isTer =
    storedSlip?.taxMethod === 'ter' ||
    isPtkpStatus(storedSlip?.ptkpStatus) ||
    isTerCategory(storedSlip?.terCategory) ||
    Boolean(ptkpOrCategory) ||
    hasTerTax(storedSlip?.taxes);

  if (isTer) {
    const category = isTerCategory(ptkpOrCategory)
      ? ptkpOrCategory
      : isPtkpStatus(ptkpOrCategory)
        ? resolveTerCategory(ptkpOrCategory)
        : isTerCategory(storedSlip?.terCategory)
          ? (storedSlip.terCategory as TerCategory)
          : isPtkpStatus(storedSlip?.ptkpStatus)
            ? resolveTerCategory(storedSlip.ptkpStatus as PtkpStatus)
            : extractTerCategoryFromTaxes(storedSlip?.taxes) || 'A';

    return resolveTerSlipTaxes(earnings, category);
  }

  return resolveSlipTaxes(earnings, deductions, resolveTaxSelection(storedSlip));
}

/** Reads a Firestore slip's `taxes` array into displayable rows. */
export function normalizeTaxFields(fields: unknown): MoneyField[] {
  if (!Array.isArray(fields)) return [];
  return fields
    .filter((field: any) => field && typeof field.label === 'string')
    .map((field: any) => ({
      label: field.label,
      amount: Number.isFinite(Number(field.amount)) ? Number(field.amount) : 0,
    }))
    .filter((field) => field.amount > 0);
}

/**
 * Why a slip cannot be taxed right now, for a disabled button's tooltip.
 * `null` means the tax may be applied.
 */
export function describeTaxIneligibility(base: number): string | null {
  if (isTaxableBase(base)) return null;
  return `Gaji bersih ${formatTaxIDR(base)} belum mencapai batas pajak ${formatTaxIDR(
    PAYROLL_TAX_THRESHOLD,
  )}.`;
}

function formatTaxIDR(amount: number): string {
  return `Rp${Math.round(amount).toLocaleString('id-ID')}`;
}

