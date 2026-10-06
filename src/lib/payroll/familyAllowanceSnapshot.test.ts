import test from 'node:test';
import assert from 'node:assert/strict';
import { familyMetricsBeforeEdits, type FamilyAllowanceHistoryEvent } from './familyAllowanceHistory';
import { createFamilyAllowanceSnapshot, explainFamilyAllowance, readFamilyAllowanceSnapshot } from './familyAllowanceSnapshot';
import type { FamilyAllowanceMetrics } from './familyAllowance';

const period = '2026-09';
const earnings = (gapok: number, family: number) => [
  { label: 'Gaji Pokok', amount: gapok }, { label: 'T. Keluarga', amount: family },
];
const change = (field: string, oldValue: unknown) => ({ field: `family_allowance_metrics.${field}`, oldValue });
const event = (...changes: { field: string; oldValue: unknown }[]): FamilyAllowanceHistoryEvent => ({ occurredAt: 200, changes });

test('a new locked snapshot keeps its September dependents after the profile changes', () => {
  const metrics: FamilyAllowanceMetrics = { spouse_count: 1, dependents: [
    { id: 'kid', level: 'SD', enrolled_at: '2020-02-22', birth_date: '2020-02-22' },
  ] };
  const snapshot = createFamilyAllowanceSnapshot(metrics, period);
  metrics.spouse_count = 0;
  metrics.dependents = [];
  const frozen = readFamilyAllowanceSnapshot(snapshot, period);
  assert.equal(frozen?.spouse_count, 1);
  assert.equal(frozen?.children_sd, 1);
  assert.equal(explainFamilyAllowance(earnings(532_000, 53_200), frozen, period).metrics?.children_sd, 1);
  assert.equal(readFamilyAllowanceSnapshot(snapshot, '2026-10'), null);
});

test('Siti September shows the spouse only and 5%, despite two children in her updated profile', () => {
  const current: FamilyAllowanceMetrics = { spouse_count: 1, children_sd: 2, dependents: [
    { id: 'one', level: 'SD', enrolled_at: '2020-02-22', birth_date: '2020-02-22' },
    { id: 'two', level: 'SD', enrolled_at: '2022-04-26', birth_date: '2022-04-26' },
  ] };
  const old = familyMetricsBeforeEdits(current, [event(
    change('children_sd', 0), change('dependents.one', null), change('dependents.two', null),
  )], 100);
  const result = explainFamilyAllowance(earnings(532_000, 26_600), old, period);
  assert.equal(result.percentage, 0.05);
  assert.equal(result.metrics?.spouse_count, 1);
  assert.equal(result.metrics?.children_sd, 0);
  assert.equal(current.children_sd, 2);
  assert.equal(current.dependents?.length, 2);
});

test('Ali September retains his two SD children rather than the later S2 and SLTA correction', () => {
  const current: FamilyAllowanceMetrics = { spouse_count: 1, dependents: [
    { id: 'legacy-SD-1', level: 'S2', enrolled_at: '2025-09-01' },
    { id: 'legacy-SD-2', level: 'SLTA', enrolled_at: '2024-07-01' },
  ] };
  const old = familyMetricsBeforeEdits(current, [event(
    change('dependents.legacy-SD-1', 'Anak 1; SD; masuk belum dicatat; ID anak legacy-SD-1'),
    change('dependents.legacy-SD-2', 'Anak 2; SD; masuk belum dicatat; ID anak legacy-SD-2'),
  )], 100);
  const result = explainFamilyAllowance(earnings(631_000, 94_650), old, period);
  assert.equal(result.percentage, 0.15);
  assert.equal(result.metrics?.children_sd, 2);
  assert.equal(result.metrics?.children_slta, 0);
  assert.equal(result.metrics?.children_s2, 0);
});

test('Herin and Yosi retain the legacy college allowance before graduation dates were backfilled', () => {
  for (const scenario of [
    { name: 'Herin', gapok: 1_150_000, family: 345_000, other: 'S2', expected: 0.3 },
    { name: 'Yosi', gapok: 1_370_000, family: 376_750, other: 'SLTA', expected: 0.275 },
  ] as const) {
    const current: FamilyAllowanceMetrics = { spouse_count: 1, dependents: [
      { id: 'other', level: scenario.other, enrolled_at: '2025-09-01' },
      { id: 'legacy-PT-1', level: 'S1', enrolled_at: '2020-09-01', ended_at: '2026-10-01' },
    ] };
    const old = familyMetricsBeforeEdits(current, [event(change('dependents.legacy-PT-1',
      'Anak 2; PT; masuk belum dicatat; dihentikan 2026-10-01; ID anak legacy-PT-1'))], 100);
    const result = explainFamilyAllowance(earnings(scenario.gapok, scenario.family), old, period);
    assert.equal(result.percentage, scenario.expected, scenario.name);
    assert.equal(result.metrics?.children_pt, scenario.other === 'S2' ? 2 : 1, scenario.name);
  }
});

test('Khotimah September restores the prior SLTA stage and undated college dependent', () => {
  const current: FamilyAllowanceMetrics = { spouse_count: 1, dependents: [
    { id: 'legacy-SLTA-1', level: 'S1', enrolled_at: '2026-07-01' },
    { id: 'legacy-PT-1', level: 'S1', enrolled_at: '2022-08-01', ended_at: '2026-10-01' },
  ] };
  const old = familyMetricsBeforeEdits(current, [event(
    change('dependents.legacy-SLTA-1', 'Anak 1; SLTA; masuk 2026-07-01; lulus 2029-07-01; ID anak legacy-SLTA-1'),
    change('dependents.legacy-PT-1', 'Anak 2; PT; masuk belum dicatat; dihentikan 2026-10-01; ID anak legacy-PT-1'),
  )], 100);
  const result = explainFamilyAllowance(earnings(1_200_000, 330_000), old, period);
  assert.equal(result.percentage, 0.275);
  assert.equal(result.metrics?.children_slta, 1);
  assert.equal(result.metrics?.children_pt, 1);
  assert.equal(result.metrics?.children_s1, 0);
});

test('missing or unparseable history shows the saved percentage without inventing dependent counts', () => {
  assert.deepEqual(explainFamilyAllowance(earnings(532_000, 26_600), null, period), { metrics: null, percentage: 0.05 });
  assert.equal(explainFamilyAllowance(earnings(532_000, 26_600), { spouse_count: 1, children_sd: 2 }, period).metrics, null);
  assert.equal(familyMetricsBeforeEdits({}, [event(change('dependents.kid', 'unknown old format'))], 100), null);
});

test('a later school-level correction cannot alter the historical breakdown even when its rate is unchanged', () => {
  const current: FamilyAllowanceMetrics = { dependents: [
    { id: 'kid', level: 'S1', enrolled_at: '2025-09-01' },
  ] };
  const old = familyMetricsBeforeEdits(current, [event(change('dependents.kid',
    'Anak 1; S2; masuk 2025-09-01; lulus 2027-09-01; ID anak kid'))], 100);
  const result = explainFamilyAllowance(earnings(1_000_000, 125_000), old, period);
  assert.equal(result.metrics?.children_s1, 0);
  assert.equal(result.metrics?.children_s2, 1);
  assert.equal(result.percentage, 0.125);
});

test('approval history is reversed in time order and edits before locking are retained', () => {
  const old = familyMetricsBeforeEdits({ spouse_count: 0, children_sd: 2 }, [
    { occurredAt: 50, changes: [change('spouse_count', 0)] },
    { occurredAt: 150, beforeMetrics: { spouse_count: 1, children_sd: 0 } },
    { occurredAt: 200, changes: [change('spouse_count', 1)] },
  ], 100);
  assert.deepEqual(old, { spouse_count: 1, children_sd: 0 });
});

test('invalid frozen metrics cannot supply misleading historical counts', () => {
  const snapshot = createFamilyAllowanceSnapshot({ spouse_count: 1 }, period);
  snapshot.metrics.children_sd = -1;
  assert.equal(readFamilyAllowanceSnapshot(snapshot, period), null);
});
