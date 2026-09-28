import assert from 'node:assert/strict';
import test from 'node:test';
import { dependentChildren, eligibleFamilyMetrics, synchronizeFamilyAllowanceEarnings } from './familyAllowance';
import { applyRequestedEnrollment } from './familyAllowanceRequests';

const today = '2026-09-28';
const stageId = 'request_12345678';

test('approval adds a new child only once and changes T. Keluarga for the enrollment month', () => {
  const before = { spouse_count: 1, children_sd: 0 };
  const result = applyRequestedEnrollment(before, {
    targetChildId: 'new', level: 'SD', enrolledAt: '2026-09-19', stageId,
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
    targetChildId: 'legacy-SD-1', level: 'SD', enrolledAt: '2023-07-01', stageId,
  }, today);
  assert.equal(result.metrics.dependents?.length, 1);
  assert.equal(result.metrics.dependents?.[0].enrolled_at, '2023-07-01');
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
    targetChildId: 'child-one', level: 'SD', enrolledAt: '2023-07-01', stageId,
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
