import assert from 'node:assert/strict';
import test from 'node:test';
import {
  dependentChildren,
  dependentHistory,
  eligibleFamilyMetrics,
  familyAllowancePeriodDate,
  graduationDate,
  pendingGraduatedChildren,
  sdGraduationDateFromBirth,
  stageGraduationDate,
  synchronizeFamilyAllowanceEarnings,
  validateDependentHistory,
} from './familyAllowance';

test('each school stage stops at its own graduation anniversary', () => {
  const cases = [
    ['SD', '2020-07-01', '2026-07-01'],
    ['SLTP', '2023-07-01', '2026-07-01'],
    ['SLTA', '2023-07-01', '2026-07-01'],
    ['S1', '2022-07-01', '2026-07-01'],
    ['S2', '2024-07-01', '2026-07-01'],
  ] as const;
  for (const [level, enrolled, graduates] of cases) {
    const metrics = { spouse_count: 1, dependents: [{ id: level, level, enrolled_at: enrolled }] };
    const before = eligibleFamilyMetrics(metrics, '2026-06-01');
    const after = eligibleFamilyMetrics(metrics, graduates);
    assert.equal(graduationDate(enrolled, level), graduates);
    assert.equal(before.children_sd + before.children_sltp + before.children_slta + before.children_pt, 1);
    assert.equal(after.children_sd + after.children_sltp + after.children_slta + after.children_pt, 0);
    assert.equal(after.spouse_count, 1);
  }
});

test('S1 and S2 remain separate but share the college allowance rate', () => {
  const metrics = { dependents: [
    { id: 's1', level: 'S1' as const, enrolled_at: '2024-01-01' },
    { id: 's2', level: 'S2' as const, enrolled_at: '2025-01-01' },
  ] };
  assert.deepEqual(eligibleFamilyMetrics(metrics, '2026-01-01'), {
    spouse_count: 0, children_sd: 0, children_sltp: 0, children_slta: 0,
    children_s1: 1, children_s2: 1, children_pt: 2,
  });
  assert.equal(eligibleFamilyMetrics(metrics, '2027-01-01').children_s2, 0);
  assert.equal(eligibleFamilyMetrics(metrics, '2027-01-01').children_s1, 1);
});

test('each dependent contributes the correct amount to T. Keluarga', () => {
  const cases = [
    ['SD', 200_000],
    ['SLTP', 300_000],
    ['SLTA', 400_000],
    ['S1', 500_000],
    ['S2', 500_000],
  ] as const;
  const rows = [{ label: 'Gaji Pokok', amount: 4_000_000 }, { label: 'T. Keluarga', amount: 0 }];
  for (const [level, expected] of cases) {
    const metrics = { dependents: [{ id: level, level, enrolled_at: '2025-01-01' }] };
    assert.equal(synchronizeFamilyAllowanceEarnings(rows, metrics, '2026_10')[1].amount, expected, level);
  }
  assert.equal(synchronizeFamilyAllowanceEarnings(rows, { spouse_count: 1, dependents: [] }, '2026_10')[1].amount, 200_000);
  assert.equal(synchronizeFamilyAllowanceEarnings(rows, {
    spouse_count: 1,
    dependents: [
      { id: 's1', level: 'S1', enrolled_at: '2026-09-19' },
      { id: 'sd', level: 'SD', enrolled_at: '2021-09-19' },
    ],
  }, '2026_10')[1].amount, 900_000);
});

test('a mid-month enrollment counts that month and graduation stops it that month', () => {
  const rows = [{ label: 'Gaji Pokok', amount: 4_000_000 }, { label: 'T. Keluarga', amount: 0 }];
  const metrics = {
    spouse_count: 1,
    dependents: [
      { id: 's1', level: 'S1' as const, enrolled_at: '2026-09-19' },
      { id: 'sd', level: 'SD' as const, enrolled_at: '2021-09-19' },
    ],
  };
  assert.equal(familyAllowancePeriodDate('2026-09'), '2026-09-30');
  assert.equal(familyAllowancePeriodDate('2028_02'), '2028-02-29');
  assert.equal(familyAllowancePeriodDate(new Date(2026, 8, 1)), '2026-09-30');
  assert.equal(synchronizeFamilyAllowanceEarnings(rows, metrics, '2026_08')[1].amount, 400_000);
  assert.equal(synchronizeFamilyAllowanceEarnings(rows, metrics, '2026_09')[1].amount, 900_000);
  assert.equal(synchronizeFamilyAllowanceEarnings(rows, metrics, '2027_09')[1].amount, 700_000);
  assert.equal(synchronizeFamilyAllowanceEarnings(rows, metrics, '2030_09')[1].amount, 200_000);
});

test('legacy counts stay payable until enrollment dates are backfilled', () => {
  const legacy = { children_sd: 2, children_pt: 1 };
  assert.equal(dependentHistory(legacy).length, 3);
  assert.equal(eligibleFamilyMetrics(legacy, '2040-01-01').children_sd, 2);
  assert.equal(eligibleFamilyMetrics({ ...legacy, dependents: dependentHistory(legacy) }, '2040-01-01').children_pt, 1);
  const splitCollege = { children_s1: 1, children_s2: 1, children_pt: 2 };
  assert.deepEqual(dependentHistory(splitCollege).map(child => child.level), ['S1', 'S2']);
  assert.equal(eligibleFamilyMetrics(splitCollege, '2040-01-01').children_pt, 2);
});

test('new dependents need valid dates and manual removal preserves older periods', () => {
  const undated = { dependents: [{ id: 'new-child', level: 'SD' as const, enrolled_at: '' }] };
  assert.throws(() => validateDependentHistory(undated, '2026-09-28'), /wajib diisi/);
  assert.equal(eligibleFamilyMetrics(undated, '2026-09-28').children_sd, 0);
  assert.throws(() => validateDependentHistory({ dependents: [{ id: 'new-child', level: 'SD', enrolled_at: '2026-09-29' }] }, '2026-09-28'), /masa depan/);
  assert.throws(() => validateDependentHistory({ dependents: [{ id: 'legacy-PT-1', level: 'S2', enrolled_at: '' }] }, '2026-09-28'), /wajib diisi/);
  const removed = { dependents: [{ id: 'child', level: 'SD' as const, enrolled_at: '2022-07-01', ended_at: '2026-09-01' }] };
  assert.equal(eligibleFamilyMetrics(removed, '2026-08-01').children_sd, 1);
  assert.equal(eligibleFamilyMetrics(removed, '2026-09-01').children_sd, 0);
});

test('saved draft family amount is recomputed for the payroll month', () => {
  const metrics = { spouse_count: 1, dependents: [{ id: 'child', level: 'SD' as const, enrolled_at: '2020-07-01' }] };
  const rows = [{ label: 'Gaji Pokok', amount: 4_000_000 }, { label: 'T. Keluarga', amount: 400_000 }];
  assert.equal(synchronizeFamilyAllowanceEarnings(rows, metrics, '2026_06')[1].amount, 400_000);
  assert.equal(synchronizeFamilyAllowanceEarnings(rows, metrics, '2026_07')[1].amount, 200_000);
  assert.equal(synchronizeFamilyAllowanceEarnings(rows, { children_sd: 1 }, '2026_07')[1].amount, 200_000);
});

test('leap day enrollment ends on the last day of February', () => {
  assert.equal(graduationDate('2024-02-29', 'S2'), '2026-02-28');
});

test('school progression keeps one child and one allowance across past, gap, and new payroll periods', () => {
  const metrics = { spouse_count: 1, dependents: [
    { id: 'child-one', level: 'SD' as const, enrolled_at: '2020-07-01' },
    { id: 'stage-two', child_id: 'child-one', level: 'SLTP' as const, enrolled_at: '2026-07-15' },
  ] };
  validateDependentHistory(metrics, '2026-09-28');
  assert.equal(dependentChildren(metrics).length, 1);
  assert.equal(eligibleFamilyMetrics(metrics, '2026-06-30').children_sd, 1);
  assert.equal(eligibleFamilyMetrics(metrics, '2026-07-01').children_sd, 0);
  assert.equal(eligibleFamilyMetrics(metrics, '2026-07-01').children_sltp, 0);
  assert.equal(eligibleFamilyMetrics(metrics, '2026-07-15').children_sltp, 1);
  const rows = [{ label: 'Gaji Pokok', amount: 4_000_000 }, { label: 'T. Keluarga', amount: 0 }];
  assert.equal(synchronizeFamilyAllowanceEarnings(rows, metrics, '2026_06')[1].amount, 400_000);
  assert.equal(synchronizeFamilyAllowanceEarnings(rows, metrics, '2026_07')[1].amount, 500_000);
  assert.equal(synchronizeFamilyAllowanceEarnings(rows, metrics, '2029_07')[1].amount, 200_000);
});

test('graduation review includes only unresolved, dated, nonterminal children', () => {
  const metrics = { dependents: [
    { id: 'pending', level: 'SD' as const, enrolled_at: '2020-07-01' },
    { id: 'decided', level: 'SLTP' as const, enrolled_at: '2022-07-01', no_further_study: true },
    { id: 'terminal', level: 'S2' as const, enrolled_at: '2024-07-01' },
    { id: 'manual-stop', level: 'SLTA' as const, enrolled_at: '2022-07-01', ended_at: '2025-01-01' },
    { id: 'legacy-SD-1', level: 'SD' as const, enrolled_at: '' },
  ] };
  assert.deepEqual(pendingGraduatedChildren(metrics, '2026-06-30'), []);
  assert.deepEqual(pendingGraduatedChildren(metrics, '2026-07-01').map(child => [child.id, child.childNumber, child.graduatedAt]),
    [['pending', 1, '2026-07-01']]);
  validateDependentHistory(metrics, '2026-09-28');
  assert.equal(pendingGraduatedChildren({ dependents: [
    ...metrics.dependents,
    { id: 'new-stage', child_id: 'pending', level: 'SLTP' as const, enrolled_at: '2026-07-15' },
  ] }, '2026-09-28').length, 0);
});

test('linked stages must follow the next school level and start after graduation', () => {
  const sd = { id: 'child', level: 'SD' as const, enrolled_at: '2020-07-01' };
  assert.throws(() => validateDependentHistory({ dependents: [sd,
    { id: 'skipped', child_id: 'child', level: 'SLTA', enrolled_at: '2026-07-01' },
  ] }, '2026-09-28'), /sesuai urutan/);
  assert.throws(() => validateDependentHistory({ dependents: [sd,
    { id: 'early', child_id: 'child', level: 'SLTP', enrolled_at: '2026-06-30' },
  ] }, '2026-09-28'), /setelah jenjang sebelumnya lulus/);
  assert.throws(() => validateDependentHistory({ dependents: [
    { ...sd, no_further_study: true },
    { id: 'conflict', child_id: 'child', level: 'SLTP', enrolled_at: '2026-07-01' },
  ] }, '2026-09-28'), /sesuai urutan/);
  assert.throws(() => validateDependentHistory({ dependents: [
    { ...sd, no_further_study: true },
  ] }, '2026-06-30'), /setelah anak lulus/);
});

const sdByBirth = (birth: string) => ({
  dependents: [{ id: 'kid', level: 'SD' as const, enrolled_at: birth, birth_date: birth }],
});

test('an SD child entered by birth date is paid from birth, even before starting school', () => {
  const metrics = sdByBirth('2023-03-10');
  validateDependentHistory(metrics, '2026-09-28');
  assert.equal(eligibleFamilyMetrics(metrics, '2023-02-28').children_sd, 0);
  assert.equal(eligibleFamilyMetrics(metrics, '2023-03-31').children_sd, 1);
  const rows = [{ label: 'Gaji Pokok', amount: 4_000_000 }, { label: 'T. Keluarga', amount: 0 }];
  assert.equal(synchronizeFamilyAllowanceEarnings(rows, metrics, '2026_09')[1].amount, 200_000);
});

test('an SD child stops in the month of the 13th birthday', () => {
  const metrics = sdByBirth('2013-07-15');
  assert.equal(sdGraduationDateFromBirth('2013-07-15'), '2026-07-15');
  assert.equal(stageGraduationDate(metrics.dependents[0]), '2026-07-15');
  assert.equal(eligibleFamilyMetrics(metrics, familyAllowancePeriodDate('2026-06')).children_sd, 1);
  assert.equal(eligibleFamilyMetrics(metrics, familyAllowancePeriodDate('2026-07')).children_sd, 0);
  assert.equal(eligibleFamilyMetrics(metrics, '2026-07-14').children_sd, 1);
  assert.equal(eligibleFamilyMetrics(metrics, '2026-07-15').children_sd, 0);
  assert.deepEqual(pendingGraduatedChildren(metrics, '2026-07-14'), []);
  assert.deepEqual(pendingGraduatedChildren(metrics, '2026-07-15').map(child => child.graduatedAt), ['2026-07-15']);
});

test('a leap-day birth turns 13 on the last day of February', () => {
  assert.equal(sdGraduationDateFromBirth('2012-02-29'), '2025-02-28');
});

test('rows saved with a masuk date keep ending after six years', () => {
  const legacy = { dependents: [{ id: 'old', level: 'SD' as const, enrolled_at: '2020-07-01' }] };
  validateDependentHistory(legacy, '2026-09-28');
  assert.equal(stageGraduationDate(legacy.dependents[0]), '2026-07-01');
  assert.equal(eligibleFamilyMetrics(legacy, '2026-06-30').children_sd, 1);
  assert.equal(eligibleFamilyMetrics(legacy, '2026-07-31').children_sd, 0);
});

test('birth date is validated: SD only, valid, not in the future, same as the start date', () => {
  const today = '2026-09-28';
  assert.throws(() => validateDependentHistory({ dependents: [
    { id: 'kid', level: 'SLTP', enrolled_at: '2023-07-01', birth_date: '2013-07-01' },
  ] }, today), /hanya digunakan untuk anak SD/);
  assert.throws(() => validateDependentHistory(sdByBirth('2026-09-29'), today), /masa depan/);
  assert.throws(() => validateDependentHistory({ dependents: [
    { id: 'kid', level: 'SD', enrolled_at: '2023-03-10', birth_date: '2023-03-11' },
  ] }, today), /sama dengan tanggal lahir/);
  assert.throws(() => validateDependentHistory({ dependents: [
    { id: 'kid', level: 'SD', enrolled_at: '', birth_date: '' },
  ] }, today), /Tanggal lahir anak SD wajib diisi/);
});

test('SLTP after a birth-dated SD child must start on or after the 13th birthday', () => {
  const sd = { id: 'kid', level: 'SD' as const, enrolled_at: '2013-07-15', birth_date: '2013-07-15' };
  assert.throws(() => validateDependentHistory({ dependents: [sd,
    { id: 'early', child_id: 'kid', level: 'SLTP', enrolled_at: '2026-07-14' },
  ] }, '2026-09-28'), /setelah jenjang sebelumnya lulus/);
  validateDependentHistory({ dependents: [sd,
    { id: 'next', child_id: 'kid', level: 'SLTP', enrolled_at: '2026-07-15' },
  ] }, '2026-09-28');
});
