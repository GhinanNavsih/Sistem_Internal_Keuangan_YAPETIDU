import assert from 'node:assert/strict';
import test from 'node:test';
import { employeeLifecycleAudit } from './employeeLifecycle';

const active = { personal_info: { status: 'AKTIF' }, audit: { createdAt: 'original-created-at' } };
const common = { collection: 'Employees_Loyalis', timestamp: 'server-time', actorUid: 'editor', eventId: 'event-1' };

test('creation records an actor, creation time and initial status', () => {
  const audit = employeeLifecycleAudit({ ...common, patch: active });
  assert.equal(audit.createdAt, 'server-time');
  assert.deepEqual(audit.employmentStatusHistory, {
    'event-1': { action: 'created', fromActive: null, toActive: true, occurredAt: 'server-time', actorUid: 'editor' },
  });
});

test('deactivation and reactivation preserve every transition and the original creation time', () => {
  const audit = employeeLifecycleAudit({ ...common, before: active, patch: { personal_info: { status: 'KELUAR' } } });
  const next = employeeLifecycleAudit({ ...common, eventId: 'event-2', timestamp: 'later',
    before: { ...active, personal_info: { status: 'KELUAR' }, audit }, patch: { personal_info: { status: 'AKTIF' } } });
  assert.equal(next.createdAt, 'original-created-at');
  assert.equal(next.lastDeactivatedAt, 'server-time');
  assert.equal(next.lastActivatedAt, 'later');
  assert.equal(Object.keys(next.employmentStatusHistory as object).length, 2);
});

test('an ordinary save from a stale form cannot erase a later status history', () => {
  const latest = employeeLifecycleAudit({ ...common, before: active, patch: { personal_info: { status: 'KELUAR' } } });
  const audit = employeeLifecycleAudit({ ...common, eventId: 'event-2',
    before: { personal_info: { status: 'KELUAR' }, audit: latest },
    patch: { personal_info: { status: 'KELUAR', name: 'Updated' }, audit: { createdAt: 'wrong', employmentStatusHistory: {} } } });
  assert.equal(audit.createdAt, 'original-created-at');
  assert.deepEqual(audit.employmentStatusHistory, latest.employmentStatusHistory);
});

test('a Pekarya partial revert records reactivation while retaining the other eligibility fields', () => {
  const audit = employeeLifecycleAudit({ ...common, collection: 'Employees_BlueCollar',
    before: { employment: { status: 'active' }, flags: { isActive: false, isPayrollEligible: true } },
    patch: { flags: { isActive: true } } });
  assert.equal(audit.lastActivatedAt, 'server-time');
  assert.equal(audit.lastDeactivatedAt, undefined);
});

test('an existing legacy record does not receive a fabricated creation date', () => {
  const audit = employeeLifecycleAudit({ ...common, before: { personal_info: { status: 'AKTIF' } }, patch: active });
  assert.equal(audit.createdAt, undefined);
  assert.equal(audit.employmentStatusHistory, undefined);
});

test('creating an inactive record does not claim a past deactivation', () => {
  const audit = employeeLifecycleAudit({ ...common, patch: { personal_info: { status: 'KELUAR' } } });
  assert.equal(audit.createdAt, 'server-time');
  assert.equal(audit.lastDeactivatedAt, undefined);
});
