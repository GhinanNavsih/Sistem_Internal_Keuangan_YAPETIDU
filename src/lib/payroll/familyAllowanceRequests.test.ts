import assert from 'node:assert/strict';
import test from 'node:test';
import { dependentChildren, eligibleFamilyMetrics, synchronizeFamilyAllowanceEarnings } from './familyAllowance';
import { applyRequestedEnrollment, assertActiveEnrollment } from './familyAllowanceRequests';

const today = '2026-09-28';
const stageId = 'request_12345678';

test('approval adds a new child only once and changes T. Keluarga for the enrollment month', () => {
  const before = { spouse_count: 1, children_sd: 0 };
  const result = applyRequestedEnrollment(before, {
    targetChildId: 'new', level: 'SD', enrolledAt: '2026-09-19', birthDate: '2026-09-19', stageId,
  }, today);
  assert.equal(result.childId, stageId);
  assert.equal(dependentChildren(result.metrics).length, 1);
  assert.equal(result.metrics.children_sd, 1);
  const fields = [{ label: 'Gaji Pokok', amount: 4_000_000 }, { label: 'T. Keluarga', amount: 0 }];
  assert.equal(synchronizeFamilyAllowanceEarnings(fields, result.metrics, '2026_08')[1].amount, 200_000);
  assert.equal(synchronizeFamilyAllowanceEarnings(fields, result.metrics, '2026_09')[1].amount, 400_000);
});

test('approval advances an old count-only child without losing its earlier pay history', () => {
  const before = { spouse_count: 1, children_sd: 1 };
  const result = applyRequestedEnrollment(before, {
    targetChildId: 'legacy-SD-1', level: 'SLTP', enrolledAt: '2025-07-01', stageId,
  }, today);
  assert.equal(result.childId, 'legacy-SD-1');
  assert.equal(dependentChildren(result.metrics).length, 1);
  assert.equal(result.metrics.children_sd, 0);
  assert.equal(result.metrics.children_sltp, 1);
  assert.equal(result.metrics.dependents?.[0].id, 'legacy-SD-1');
  assert.equal(result.metrics.dependents?.length, 2);
  assert.equal(eligibleFamilyMetrics(result.metrics, '2024-07-01').children_sd, 1);
  assert.equal(eligibleFamilyMetrics(result.metrics, '2025-07-01').children_sltp, 1);
});

test('approval can backfill the current level of a count-only child in place', () => {
  const result = applyRequestedEnrollment({ children_sd: 1 }, {
    targetChildId: 'legacy-SD-1', level: 'SD', enrolledAt: '2023-07-01', birthDate: '2023-07-01', stageId,
  }, today);
  assert.equal(result.metrics.dependents?.length, 1);
  assert.equal(result.metrics.dependents?.[0].enrolled_at, '2023-07-01');
  assert.equal(result.metrics.dependents?.[0].birth_date, '2023-07-01');
  assert.equal(result.metrics.children_sd, 1);
});

test('approval advances a graduated child while preserving the prior stage and payment gap', () => {
  const before = { dependents: [{ id: 'child-one', level: 'SD' as const, enrolled_at: '2020-07-01' }] };
  const result = applyRequestedEnrollment(before, {
    targetChildId: 'child-one', level: 'SLTP', enrolledAt: '2026-08-01', stageId,
  }, today);
  assert.equal(dependentChildren(result.metrics).length, 1);
  assert.equal(result.metrics.dependents?.length, 2);
  assert.equal(eligibleFamilyMetrics(result.metrics, '2026-06-30').children_sd, 1);
  assert.equal(eligibleFamilyMetrics(result.metrics, '2026-07-31').children_sltp, 0);
  assert.equal(eligibleFamilyMetrics(result.metrics, '2026-08-31').children_sltp, 1);
});

test('approval refuses duplicate active children and invalid progression', () => {
  const active = { dependents: [{ id: 'child-one', level: 'SD' as const, enrolled_at: '2023-07-01' }] };
  assert.throws(() => applyRequestedEnrollment(active, {
    targetChildId: 'child-one', level: 'SD', enrolledAt: '2023-07-01', birthDate: '2023-07-01', stageId,
  }, today), /sudah memiliki jenjang aktif/);
  const graduated = { dependents: [{ id: 'child-one', level: 'SD' as const, enrolled_at: '2020-07-01' }] };
  assert.throws(() => applyRequestedEnrollment(graduated, {
    targetChildId: 'child-one', level: 'SLTA', enrolledAt: '2026-07-01', stageId,
  }, today), /sesuai urutan/);
  assert.throws(() => applyRequestedEnrollment(graduated, {
    targetChildId: 'child-one', level: 'SLTP', enrolledAt: '2026-06-30', stageId,
  }, today), /setelah jenjang sebelumnya lulus/);
  assert.throws(() => applyRequestedEnrollment({}, {
    targetChildId: 'new', level: 'S2', enrolledAt: '2024-01-01', stageId,
  }, today), /sudah berakhir/);
});

test('an SD request is tracked by birth date and covers a child who has not started school', () => {
  const result = applyRequestedEnrollment({}, {
    targetChildId: 'new', level: 'SD', enrolledAt: '2023-03-10', birthDate: '2023-03-10', stageId,
  }, today);
  assert.deepEqual(result.metrics.dependents?.[0], {
    id: stageId, child_id: stageId, level: 'SD', enrolled_at: '2023-03-10', birth_date: '2023-03-10',
  });
  assert.equal(eligibleFamilyMetrics(result.metrics, '2026-09-30').children_sd, 1);
  assert.equal(eligibleFamilyMetrics(result.metrics, '2036-03-31').children_sd, 0);
});

test('an SD request needs a valid birth date of a child under 13', () => {
  const ask = (enrolledAt: unknown, birthDate: unknown) => () => assertActiveEnrollment('SD', enrolledAt, today, birthDate);
  assert.throws(ask('2023-03-10', undefined), /Tanggal lahir/);
  assert.throws(ask('2026-09-29', '2026-09-29'), /Tanggal lahir/);
  assert.throws(ask('2023-03-10', '2023-03-11'), /harus sama dengan tanggal lahir/);
  assert.throws(ask('2013-09-28', '2013-09-28'), /berusia 13 tahun/);
  assert.doesNotThrow(ask('2013-09-29', '2013-09-29'));
});

test('a graduated SD child with a birth date continues to SLTP only after the 13th birthday', () => {
  const before = { dependents: [{ id: 'kid', level: 'SD' as const, enrolled_at: '2013-07-15', birth_date: '2013-07-15' }] };
  assert.throws(() => applyRequestedEnrollment(before, {
    targetChildId: 'kid', level: 'SLTP', enrolledAt: '2026-07-14', stageId,
  }, today), /setelah jenjang sebelumnya lulus/);
  const result = applyRequestedEnrollment(before, {
    targetChildId: 'kid', level: 'SLTP', enrolledAt: '2026-07-15', stageId,
  }, today);
  assert.equal(eligibleFamilyMetrics(result.metrics, '2026-07-31').children_sltp, 1);
  assert.equal(eligibleFamilyMetrics(result.metrics, '2026-07-31').children_sd, 0);
});
