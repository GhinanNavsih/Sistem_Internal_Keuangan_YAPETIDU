import test from 'node:test';
import assert from 'node:assert/strict';

import { calculatePayrollTotals } from './domain';
import {
  PAYROLL_TAX_LABEL,
  PAYROLL_TAX_THRESHOLD,
  PTKP_TO_TER_CATEGORY,
  TER_BULANAN_A,
  TER_BULANAN_B,
  TER_BULANAN_C,
  calculateTaxAmount,
  calculateTaxBase,
  calculateTerTaxAmount,
  derivePtkpStatus,
  describeTaxIneligibility,
  extractTerCategoryFromTaxes,
  formatTerRatePercent,
  formatTerTaxLabel,
  getTerRate,
  hasTaxApplied,
  hasTerTax,
  isPtkpStatus,
  isTaxableBase,
  isTerCategory,
  normalizeTaxFields,
  recalculateSlipTaxes,
  resolveEmployeePtkpStatus,
  resolveEmployeeTerCategory,
  resolveSlipTaxDetails,
  resolveSlipTaxes,
  resolveTaxSelection,
  resolveTerCategory,
  resolveTerSlipTaxes,
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

// ─── PPh 21 TER (PP 58/2023 & PMK 168/2023) Tests ─────────────────────────────

test('TER bracket tables are well-formed and monotonic', () => {
  assert.equal(TER_BULANAN_A.length, 44);
  assert.equal(TER_BULANAN_B.length, 40);
  assert.equal(TER_BULANAN_C.length, 41);

  for (const [name, table] of [
    ['A', TER_BULANAN_A],
    ['B', TER_BULANAN_B],
    ['C', TER_BULANAN_C],
  ] as const) {
    assert.equal(table[0].rate, 0, `Table ${name} first tier must be 0%`);
    assert.equal(table[table.length - 1].maxGross, Infinity, `Table ${name} last tier maxGross must be Infinity`);
    assert.equal(table[table.length - 1].rate, 0.34, `Table ${name} top tier must be 34%`);

    for (let i = 1; i < table.length; i++) {
      assert.ok(
        table[i].maxGross > table[i - 1].maxGross,
        `Table ${name} tier ${i} maxGross (${table[i].maxGross}) must be greater than previous (${table[i - 1].maxGross})`,
      );
      assert.ok(
        table[i].rate >= table[i - 1].rate,
        `Table ${name} tier ${i} rate (${table[i].rate}) must be >= previous (${table[i - 1].rate})`,
      );
    }
  }
});

test('PTKP to TER category mapping matches government regulation', () => {
  assert.equal(PTKP_TO_TER_CATEGORY['TK/0'], 'A');
  assert.equal(PTKP_TO_TER_CATEGORY['TK/1'], 'A');
  assert.equal(PTKP_TO_TER_CATEGORY['K/0'], 'A');

  assert.equal(PTKP_TO_TER_CATEGORY['TK/2'], 'B');
  assert.equal(PTKP_TO_TER_CATEGORY['TK/3'], 'B');
  assert.equal(PTKP_TO_TER_CATEGORY['K/1'], 'B');
  assert.equal(PTKP_TO_TER_CATEGORY['K/2'], 'B');

  assert.equal(PTKP_TO_TER_CATEGORY['K/3'], 'C');
});

test('type guards recognize valid PTKP and TER category values', () => {
  assert.equal(isPtkpStatus('TK/0'), true);
  assert.equal(isPtkpStatus('K/3'), true);
  assert.equal(isPtkpStatus('K/4'), false);
  assert.equal(isPtkpStatus(null), false);

  assert.equal(isTerCategory('A'), true);
  assert.equal(isTerCategory('B'), true);
  assert.equal(isTerCategory('C'), true);
  assert.equal(isTerCategory('D'), false);
  assert.equal(isTerCategory(123), false);
});

test('resolveTerCategory handles strings, case insensitivity, and fallbacks', () => {
  assert.equal(resolveTerCategory('TK/0'), 'A');
  assert.equal(resolveTerCategory('tk/1'), 'A');
  assert.equal(resolveTerCategory(' k/0 '), 'A');

  assert.equal(resolveTerCategory('TK/2'), 'B');
  assert.equal(resolveTerCategory('K/1'), 'B');
  assert.equal(resolveTerCategory('k/2'), 'B');

  assert.equal(resolveTerCategory('K/3'), 'C');
  assert.equal(resolveTerCategory('k/3'), 'C');

  // Fallbacks to A for unknown or missing
  assert.equal(resolveTerCategory('UNKNOWN'), 'A');
  assert.equal(resolveTerCategory(undefined), 'A');
  assert.equal(resolveTerCategory(null), 'A');
});

test('derivePtkpStatus correctly derives and clamps dependents', () => {
  // Single employees
  assert.equal(derivePtkpStatus(0, 0), 'TK/0');
  assert.equal(derivePtkpStatus(0, 1), 'TK/1');
  assert.equal(derivePtkpStatus(0, 2), 'TK/2');
  assert.equal(derivePtkpStatus(0, 3), 'TK/3');
  assert.equal(derivePtkpStatus(0, 5), 'TK/3'); // clamped at 3

  // Married employees
  assert.equal(derivePtkpStatus(1, 0), 'K/0');
  assert.equal(derivePtkpStatus(1, 1), 'K/1');
  assert.equal(derivePtkpStatus(1, 2), 'K/2');
  assert.equal(derivePtkpStatus(1, 3), 'K/3');
  assert.equal(derivePtkpStatus(1, 4), 'K/3'); // clamped at 3

  // Edge cases (null, negative)
  assert.equal(derivePtkpStatus(null, null), 'TK/0');
  assert.equal(derivePtkpStatus(1, -2), 'K/0');
});

test('getTerRate and calculateTerTaxAmount work accurately for Category A', () => {
  // Threshold: <= 5.400.000 -> 0%
  assert.equal(getTerRate('A', 5_400_000), 0);
  assert.equal(calculateTerTaxAmount('A', 5_400_000), 0);

  // 5.400.001 - 5.650.000 -> 0.25%
  assert.equal(getTerRate('A', 5_400_001), 0.0025);
  assert.equal(calculateTerTaxAmount('A', 5_500_000), 13_750); // 5.500.000 * 0.0025 = 13.750
  assert.equal(getTerRate('A', 5_650_000), 0.0025);

  // 5.650.001 - 5.950.000 -> 0.5%
  assert.equal(getTerRate('A', 5_650_001), 0.005);
  assert.equal(getTerRate('A', 5_950_000), 0.005);

  // 7.500.001 - 8.550.000 -> 1.5%
  assert.equal(getTerRate('A', 8_000_000), 0.015);
  assert.equal(calculateTerTaxAmount('A', 8_000_000), 120_000);

  // 9.650.001 - 10.050.000 -> 2%
  assert.equal(getTerRate('A', 10_000_000), 0.02);
  assert.equal(calculateTerTaxAmount('A', 10_000_000), 200_000);

  // 13.750.001 - 15.100.000 -> 6%
  assert.equal(getTerRate('A', 15_000_000), 0.06);
  assert.equal(calculateTerTaxAmount('A', 15_000_000), 900_000);

  // Above 1.4B -> 34%
  assert.equal(getTerRate('A', 1_500_000_000), 0.34);
  assert.equal(calculateTerTaxAmount('A', 1_500_000_000), 510_000_000);
});

test('getTerRate and calculateTerTaxAmount work accurately for Category B', () => {
  // Threshold: <= 6.200.000 -> 0%
  assert.equal(getTerRate('B', 6_200_000), 0);
  assert.equal(calculateTerTaxAmount('B', 6_200_000), 0);

  // 6.200.001 - 6.500.000 -> 0.25%
  assert.equal(getTerRate('B', 6_200_001), 0.0025);
  assert.equal(getTerRate('B', 6_500_000), 0.0025);

  // 7.300.001 - 9.200.000 -> 1%
  assert.equal(getTerRate('B', 8_000_000), 0.01);
  assert.equal(calculateTerTaxAmount('B', 8_000_000), 80_000);

  // 9.200.001 - 10.750.000 -> 1.5%
  assert.equal(getTerRate('B', 10_000_000), 0.015);
  assert.equal(calculateTerTaxAmount('B', 10_000_000), 150_000);

  // Above 1.405B -> 34%
  assert.equal(getTerRate('B', 2_000_000_000), 0.34);
  assert.equal(calculateTerTaxAmount('B', 2_000_000_000), 680_000_000);
});

test('getTerRate and calculateTerTaxAmount work accurately for Category C', () => {
  // Threshold: <= 6.600.000 -> 0%
  assert.equal(getTerRate('C', 6_600_000), 0);
  assert.equal(calculateTerTaxAmount('C', 6_600_000), 0);

  // 6.600.001 - 6.950.000 -> 0.25%
  assert.equal(getTerRate('C', 6_600_001), 0.0025);
  assert.equal(getTerRate('C', 6_950_000), 0.0025);

  // 7.800.001 - 8.850.000 -> 1%
  assert.equal(getTerRate('C', 8_000_000), 0.01);
  assert.equal(calculateTerTaxAmount('C', 8_000_000), 80_000);

  // 9.800.001 - 10.950.000 -> 1.5%
  assert.equal(getTerRate('C', 10_000_000), 0.015);
  assert.equal(calculateTerTaxAmount('C', 10_000_000), 150_000);

  // Above 1.419B -> 34%
  assert.equal(getTerRate('C', 2_000_000_000), 0.34);
  assert.equal(calculateTerTaxAmount('C', 2_000_000_000), 680_000_000);
});

test('formatting utilities format percentages and labels correctly', () => {
  assert.equal(formatTerRatePercent(0), '0%');
  assert.equal(formatTerRatePercent(0.0025), '0,25%');
  assert.equal(formatTerRatePercent(0.015), '1,5%');
  assert.equal(formatTerRatePercent(0.06), '6%');
  assert.equal(formatTerRatePercent(0.34), '34%');

  assert.equal(formatTerTaxLabel('A', 0.015), 'Pajak Penghasilan PPh 21 (TER A 1,5%)');
  assert.equal(formatTerTaxLabel('B', 0.0025), 'Pajak Penghasilan PPh 21 (TER B 0,25%)');
});

test('resolveTerSlipTaxes returns empty array when below threshold or non-positive', () => {
  assert.deepEqual(resolveTerSlipTaxes(earnings(5_000_000), 'A'), []);
  assert.deepEqual(resolveTerSlipTaxes(earnings(6_200_000), 'B'), []);
  assert.deepEqual(resolveTerSlipTaxes(earnings(6_600_000), 'K/3'), []);
  assert.deepEqual(resolveTerSlipTaxes([], 'A'), []);
});

test('resolveTerSlipTaxes produces formatted row when taxable gross is earned', () => {
  // Category A with 10M gross -> 2% rate -> 200.000 tax
  assert.deepEqual(resolveTerSlipTaxes(earnings(10_000_000), 'A'), [
    { label: 'Pajak Penghasilan PPh 21 (TER A 2%)', amount: 200_000 },
  ]);

  // Resolving via PTKP status 'K/1' (Category B) with 10M gross -> 1.5% rate -> 150.000 tax
  assert.deepEqual(resolveTerSlipTaxes(earnings(10_000_000), 'K/1'), [
    { label: 'Pajak Penghasilan PPh 21 (TER B 1,5%)', amount: 150_000 },
  ]);
});

test('resolveEmployeePtkpStatus derives PTKP from employee profile metrics', () => {
  // Single with 2 dependents
  assert.equal(
    resolveEmployeePtkpStatus({
      family_allowance_metrics: { spouse_count: 0, children_sd: 2 },
    }),
    'TK/2',
  );

  // Married with 3 dependents
  assert.equal(
    resolveEmployeePtkpStatus({
      family_allowance_metrics: { spouse_count: 1, children_sd: 1, children_sltp: 2 },
    }),
    'K/3',
  );

  // Clamps dependents at 3
  assert.equal(
    resolveEmployeePtkpStatus({
      family_allowance_metrics: { spouse_count: 1, children_sd: 2, children_pt: 3 },
    }),
    'K/3',
  );

  // Explicit ptkp_status override takes precedence
  assert.equal(
    resolveEmployeePtkpStatus({
      ptkp_status: 'TK/1',
      family_allowance_metrics: { spouse_count: 1, children_sd: 3 },
    }),
    'TK/1',
  );

  // Nested tax_profile.ptkp_status
  assert.equal(
    resolveEmployeePtkpStatus({
      tax_profile: { ptkp_status: 'K/0' },
      family_allowance_metrics: { spouse_count: 1, children_sd: 3 },
    }),
    'K/0',
  );

  // Blue collar / Pekarya without family allowance metrics defaults to TK/0
  assert.equal(resolveEmployeePtkpStatus({}), 'TK/0');
  assert.equal(resolveEmployeePtkpStatus(null), 'TK/0');

  // Female employees default to TK/0 under PMK 168/2023 Pasal 9 ayat (2)
  assert.equal(
    resolveEmployeePtkpStatus({
      gender: 'female',
      family_allowance_metrics: { spouse_count: 1, children_sd: 2 },
    }),
    'TK/0',
  );

  // Female inferred from NIK (day > 40) defaults to TK/0
  assert.equal(
    resolveEmployeePtkpStatus({
      personal_info: { nik: '3517194607760004' },
      family_allowance_metrics: { spouse_count: 1, children_sd: 2 },
    }),
    'TK/0',
  );

  // Female with verified Kecamatan certificate (explicit ptkp_status) preserves the explicit status
  assert.equal(
    resolveEmployeePtkpStatus({
      gender: 'female',
      ptkp_status: 'K/2',
      family_allowance_metrics: { spouse_count: 1, children_sd: 2 },
    }),
    'K/2',
  );

  // Male employee derives full PTKP from family allowance metrics
  assert.equal(
    resolveEmployeePtkpStatus({
      gender: 'male',
      family_allowance_metrics: { spouse_count: 1, children_sd: 2 },
    }),
    'K/2',
  );
});

test('resolveEmployeeTerCategory maps employee profile directly to TER category', () => {
  assert.equal(
    resolveEmployeeTerCategory({
      family_allowance_metrics: { spouse_count: 1, children_sd: 0 },
    }),
    'A', // K/0 -> Category A
  );

  assert.equal(
    resolveEmployeeTerCategory({
      family_allowance_metrics: { spouse_count: 1, children_sd: 1 },
    }),
    'B', // K/1 -> Category B
  );

  assert.equal(
    resolveEmployeeTerCategory({
      family_allowance_metrics: { spouse_count: 1, children_sd: 3 },
    }),
    'C', // K/3 -> Category C
  );

  assert.equal(resolveEmployeeTerCategory({}), 'A'); // Default TK/0 -> Category A
});

test('hasTerTax and extractTerCategoryFromTaxes recognize TER rows', () => {
  const terRow = [{ label: 'Pajak Penghasilan PPh 21 (TER B 1,5%)', amount: 150_000 }];
  const legacyRow = [{ label: 'Pajak Penghasilan (5%)', amount: 300_000 }];

  assert.equal(hasTerTax(terRow), true);
  assert.equal(hasTerTax(legacyRow), false);
  assert.equal(hasTerTax([]), false);

  assert.equal(extractTerCategoryFromTaxes(terRow), 'B');
  assert.equal(extractTerCategoryFromTaxes(legacyRow), null);
  assert.equal(extractTerCategoryFromTaxes([{ label: 'Pajak Penghasilan PPh 21 (TER A 0,25%)', amount: 10_000 }]), 'A');
  assert.equal(extractTerCategoryFromTaxes([{ label: 'Pajak Penghasilan PPh 21 (TER C 6%)', amount: 900_000 }]), 'C');
});

test('recalculateSlipTaxes seamlessly recalculates TER slips when earnings change', () => {
  const terSlip = {
    taxMethod: 'ter' as const,
    terCategory: 'B' as const,
    ptkpStatus: 'K/1' as const,
    taxes: [{ label: 'Pajak Penghasilan PPh 21 (TER B 1,5%)', amount: 150_000 }],
  };

  // When earnings move to 15.000.000 in Category B (bracket 14.95M - 16.4M -> 6% rate)
  const updated = recalculateSlipTaxes(terSlip, earnings(15_000_000), []);
  assert.deepEqual(updated, [
    { label: 'Pajak Penghasilan PPh 21 (TER B 6%)', amount: 900_000 },
  ]);

  // When earnings dip below Category B threshold (6.2M) -> tax becomes 0
  const dipped = recalculateSlipTaxes(terSlip, earnings(6_000_000), []);
  assert.deepEqual(dipped, []);

  // When earnings recover, TER recalculation picks it right back up
  const recovered = recalculateSlipTaxes(
    { ...terSlip, taxes: dipped },
    earnings(10_000_000),
    [],
  );
  assert.deepEqual(recovered, [
    { label: 'Pajak Penghasilan PPh 21 (TER B 1,5%)', amount: 150_000 },
  ]);
});


