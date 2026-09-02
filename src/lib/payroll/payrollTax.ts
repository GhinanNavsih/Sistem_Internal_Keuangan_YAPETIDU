import type { MoneyField } from '@/lib/payroll/domain';

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
 * keeping whatever selection the slip already carried.
 */
export function recalculateSlipTaxes(
  storedSlip: TaxSelectionSource | null | undefined,
  earnings: readonly MoneyField[] | undefined | null,
  deductions: readonly MoneyField[] | undefined | null,
): MoneyField[] {
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
