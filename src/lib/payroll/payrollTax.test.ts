import test from 'node:test';
import assert from 'node:assert/strict';

import { calculatePayrollTotals } from './domain';
import {
  PAYROLL_TAX_LABEL,
  PAYROLL_TAX_THRESHOLD,
  calculateTaxAmount,
  calculateTaxBase,
  describeTaxIneligibility,
  hasTaxApplied,
  isTaxableBase,
  normalizeTaxFields,
  recalculateSlipTaxes,
  resolveSlipTaxes,
  resolveTaxSelection,
} from './payrollTax';

const earnings = (total: number) => [{ label: 'Gaji Pokok', amount: total }];
const deductions = (total: number) => [{ label: 'BPJS', amount: total }];

test('the tax base is Gaji Bersih before tax, not gross earnings', () => {
  assert.equal(calculateTaxBase(earnings(8_000_000), deductions(1_500_000)), 6_500_000);
});

test('the threshold is inclusive at exactly Rp 6.000.000', () => {
  assert.equal(isTaxableBase(PAYROLL_TAX_THRESHOLD - 1), false);
  assert.equal(isTaxableBase(PAYROLL_TAX_THRESHOLD), true);
  assert.equal(calculateTaxAmount(PAYROLL_TAX_THRESHOLD), 300_000);
});

test('a base below the threshold is never taxed, even a rupiah short', () => {
  assert.equal(calculateTaxAmount(5_999_999), 0);
  assert.deepEqual(resolveSlipTaxes(earnings(5_999_999), [], true), []);
});

test('the rate applies to the whole base, not only the excess', () => {
  // 5% of 20.000.000 — not 5% of the 14.000.000 above the threshold.
  assert.equal(calculateTaxAmount(20_000_000), 1_000_000);
});

test('the amount is rounded to whole rupiah', () => {
  assert.equal(calculateTaxAmount(6_000_009), 300_000);
  assert.equal(calculateTaxAmount(6_000_010), 300_001);
});

test('an unselected employee gets no tax row regardless of the base', () => {
  assert.deepEqual(resolveSlipTaxes(earnings(50_000_000), [], false), []);
});

test('a selected employee gets exactly one labelled row', () => {
  assert.deepEqual(resolveSlipTaxes(earnings(10_000_000), deductions(1_000_000), true), [
    { label: PAYROLL_TAX_LABEL, amount: 450_000 },
  ]);
});

const taxedSlip = { taxApplied: true, taxes: resolveSlipTaxes(earnings(10_000_000), [], true) };

test('recalculating follows the base when earnings move', () => {
  assert.equal(taxedSlip.taxes[0].amount, 500_000);

  const next = recalculateSlipTaxes(taxedSlip, earnings(12_000_000), []);
  assert.deepEqual(next, [{ label: PAYROLL_TAX_LABEL, amount: 600_000 }]);
});

test('recalculating follows the base when a deduction is added', () => {
  const next = recalculateSlipTaxes(taxedSlip, earnings(10_000_000), deductions(2_000_000));
  assert.deepEqual(next, [{ label: PAYROLL_TAX_LABEL, amount: 400_000 }]);
});

test('a slip that falls below the threshold loses its tax row', () => {
  const next = recalculateSlipTaxes(taxedSlip, earnings(6_100_000), deductions(200_000));
  assert.deepEqual(next, []);
});

test('a dip below the threshold does not erase the selection', () => {
  // The row is gone but the flag remains, so a later run at a higher base
  // taxes the employee again instead of silently paying them untaxed.
  const dipped = {
    taxApplied: true,
    taxes: recalculateSlipTaxes(taxedSlip, earnings(5_900_000), []),
  };
  assert.deepEqual(dipped.taxes, []);
  assert.equal(resolveTaxSelection(dipped), true);
  assert.deepEqual(recalculateSlipTaxes(dipped, earnings(10_000_000), []), [
    { label: PAYROLL_TAX_LABEL, amount: 500_000 },
  ]);
});

test('a slip written before the flag falls back to its rows', () => {
  assert.equal(resolveTaxSelection({ taxes: [{ label: PAYROLL_TAX_LABEL, amount: 1 }] }), true);
  assert.equal(resolveTaxSelection({ taxes: [] }), false);
  assert.equal(resolveTaxSelection(undefined), false);
  // An explicit flag always wins over the rows it produced.
  assert.equal(resolveTaxSelection({ taxApplied: true, taxes: [] }), true);
  assert.equal(
    resolveTaxSelection({ taxApplied: false, taxes: [{ label: PAYROLL_TAX_LABEL, amount: 1 }] }),
    false,
  );
});

test('an untaxed slip stays untaxed through a recalculation', () => {
  assert.deepEqual(recalculateSlipTaxes({ taxes: [] }, earnings(30_000_000), []), []);
  assert.deepEqual(recalculateSlipTaxes(undefined, earnings(30_000_000), []), []);
});

test('hasTaxApplied ignores empty and zero-amount rows', () => {
  assert.equal(hasTaxApplied(undefined), false);
  assert.equal(hasTaxApplied([]), false);
  assert.equal(hasTaxApplied([{ label: PAYROLL_TAX_LABEL, amount: 0 }]), false);
  assert.equal(hasTaxApplied([{ label: PAYROLL_TAX_LABEL, amount: 1 }]), true);
});

test('normalizeTaxFields drops malformed and zero rows from Firestore', () => {
  assert.deepEqual(
    normalizeTaxFields([
      { label: PAYROLL_TAX_LABEL, amount: 300_000 },
      { label: 'Kosong', amount: 0 },
      { amount: 5_000 },
      null,
      'bukan objek',
    ]),
    [{ label: PAYROLL_TAX_LABEL, amount: 300_000 }],
  );
  assert.deepEqual(normalizeTaxFields(undefined), []);
});

test('describeTaxIneligibility explains only an untaxable base', () => {
  assert.equal(describeTaxIneligibility(9_000_000), null);
  assert.match(describeTaxIneligibility(1_000_000)!, /Rp1\.000\.000/);
  assert.match(describeTaxIneligibility(1_000_000)!, /Rp6\.000\.000/);
});

test('net salary is the take-home figure after tax', () => {
  const taxes = resolveSlipTaxes(earnings(10_000_000), deductions(1_000_000), true);
  const totals = calculatePayrollTotals(earnings(10_000_000), deductions(1_000_000), taxes);

  assert.deepEqual(totals, {
    totalEarnings: 10_000_000,
    totalDeductions: 1_000_000,
    totalTax: 450_000,
    netSalary: 8_550_000,
  });
});

test('totals without a tax category are unchanged from before the rule', () => {
  assert.deepEqual(calculatePayrollTotals(earnings(4_000_000), deductions(500_000)), {
    totalEarnings: 4_000_000,
    totalDeductions: 500_000,
    totalTax: 0,
    netSalary: 3_500_000,
  });
});
