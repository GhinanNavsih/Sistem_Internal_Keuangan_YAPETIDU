import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildInitialEarnings,
  buildInitialDeductions,
  resolveGapokFromSlip,
} from './slipBuilders';

const amountOf = (fields: { label: string; amount: number }[], label: string) =>
  fields.find((field) => field.label === label)?.amount;

test('a saved zero Gaji Pokok overrides the calculated fallback', () => {
  assert.equal(
    resolveGapokFromSlip([{ label: 'Gaji Pokok', amount: 0 }], 139_750),
    0,
  );
});

test('a Loyalis BPJS deduction on the profile lands on the slip', () => {
  const deductions = buildInitialDeductions(
    { bpjs: { deductionAmount: 472_878 } },
    'loyalis',
  );
  assert.equal(amountOf(deductions, 'BPJS'), 472_878);
  // Rows sourced elsewhere are still emitted at zero for the merge to skip.
  assert.equal(amountOf(deductions, 'Revisi Gaji'), 0);
  assert.equal(amountOf(deductions, 'Pinjaman Kop. UNIPDU'), 0);
});

test('Loyalis earnings derive from the profile and the pay rules', () => {
  const earnings = buildInitialEarnings(
    {
      family_allowance_metrics: {
        spouse_count: 1,
        children_sd: 2,
        children_pt: 1,
      },
      bpjs: { t_bpjs_tk: 120_000, t_bpjs_kes: 80_000 },
      salaryProfile: { tunjanganBeras: 250_000 },
      t_instruksional: 300_000,
    },
    4_000_000,
    'loyalis',
  );

  assert.equal(amountOf(earnings, 'Gaji Pokok'), 4_000_000);
  // spouse 5% + 2x SD 5% + PT 12.5% = 27.5%
  assert.equal(amountOf(earnings, 'T. Keluarga'), 1_100_000);
  assert.equal(amountOf(earnings, 'T. Hari Tua'), 400_000);
  assert.equal(amountOf(earnings, 'T. BPJS TK'), 120_000);
  assert.equal(amountOf(earnings, 'T. BPJS KES'), 80_000);
  assert.equal(amountOf(earnings, 'Beras'), 250_000);
  assert.equal(amountOf(earnings, 'Instruksional'), 300_000);
});

test('the highest structural position is paid in full and the rest halved', () => {
  const earnings = buildInitialEarnings(
    {
      employment_profile: {
        structural_positions: [
          { name: 'Sekretaris', allowance: 500_000 },
          { name: 'Kepala Unit', allowance: 1_000_000 },
        ],
      },
    },
    0,
    'loyalis',
  );

  const structural = earnings.filter((field) => field.label.startsWith('Struktural: '));
  assert.deepEqual(structural, [
    { label: 'Struktural: Kepala Unit', amount: 1_000_000 },
    { label: 'Struktural: Sekretaris (50% dari Rp 500.000)', amount: 250_000 },
  ]);
});

test('no structural position still emits a zero placeholder row', () => {
  const earnings = buildInitialEarnings(
    { employment_profile: { department_unit: 'BAK' } },
    0,
    'loyalis',
  );
  assert.equal(amountOf(earnings, 'Struktural: BAK'), 0);
});

test('a blue-collar BPJS allowance of zero emits no allowance row at all', () => {
  const withAllowance = buildInitialEarnings(
    { employment: { jobCategory: 'SOPIR' }, bpjs: { allowanceAmount: 150_000 } },
    1_000_000,
    'blue',
  );
  assert.equal(amountOf(withAllowance, 'BPJS (Tunjangan)'), 150_000);

  const withoutAllowance = buildInitialEarnings(
    { employment: { jobCategory: 'SOPIR' }, bpjs: { allowanceAmount: 0 } },
    1_000_000,
    'blue',
  );
  // The row is absent, not zero — propagation has to remove it, not zero it.
  assert.equal(
    withoutAllowance.some((field) => field.label === 'BPJS (Tunjangan)'),
    false,
  );
});
