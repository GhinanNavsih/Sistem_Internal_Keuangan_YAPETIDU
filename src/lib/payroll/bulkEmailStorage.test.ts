import assert from 'node:assert/strict';
import test from 'node:test';
import {
  AUTO_RESUME_WINDOW_MS,
  restoreBulkEmailJob,
  serializeBulkEmailJob,
  type StorableQueueItem,
} from './bulkEmailStorage';

const now = 1_800_000_000_000;
const item = (employeeId: string, status: StorableQueueItem['status']): StorableQueueItem => ({
  employeeId,
  employeeName: employeeId.toUpperCase(),
  email: `${employeeId}@x.id`,
  status,
  requestId: `bulk_email_${employeeId}_0001`,
  slipData: { employeeName: employeeId },
});
const saved = (patch: Partial<{ uid: string; status: 'sending' | 'paused' | 'done'; savedAt: number; queue: StorableQueueItem[]; dbPeriod: string }> = {}) =>
  serializeBulkEmailJob({
    uid: 'u1',
    period: 'Oktober 2026',
    dbPeriod: '2026_10',
    status: 'sending',
    savedAt: now - 10_000,
    queue: [item('a', 'success'), item('b', 'sending'), item('c', 'pending')],
    ...patch,
  });

test('a run interrupted by a reload resumes, retrying the cut-off send with its requestId', () => {
  const restored = restoreBulkEmailJob(saved(), 'u1', now);
  assert.ok(restored);
  assert.equal(restored.status, 'sending');
  assert.equal(restored.resumed, true);
  assert.deepEqual(restored.queue.map((entry) => entry.status), ['success', 'pending', 'pending']);
  assert.equal(restored.queue[1].requestId, 'bulk_email_b_0001');
});

test('an old interrupted run comes back paused', () => {
  const restored = restoreBulkEmailJob(saved({ savedAt: now - AUTO_RESUME_WINDOW_MS - 1 }), 'u1', now);
  assert.equal(restored?.status, 'paused');
  assert.equal(restored?.resumed, false);
});

test('a paused run stays paused and a finished one stays finished', () => {
  assert.equal(restoreBulkEmailJob(saved({ status: 'paused' }), 'u1', now)?.status, 'paused');
  assert.equal(
    restoreBulkEmailJob(saved({ status: 'done', queue: [item('a', 'success'), item('b', 'failed')] }), 'u1', now)?.status,
    'done',
  );
});

test('a run with nothing left to send is done', () => {
  const restored = restoreBulkEmailJob(saved({ queue: [item('a', 'success'), item('b', 'failed')] }), 'u1', now);
  assert.equal(restored?.status, 'done');
  assert.equal(restored?.resumed, false);
});

test('another user, a bad period or a damaged entry restores nothing', () => {
  assert.equal(restoreBulkEmailJob(saved(), 'u2', now), null);
  assert.equal(restoreBulkEmailJob(saved({ dbPeriod: '2026-10' }), 'u1', now), null);
  assert.equal(restoreBulkEmailJob('{not json', 'u1', now), null);
  assert.equal(restoreBulkEmailJob(null, 'u1', now), null);
  assert.equal(restoreBulkEmailJob(saved({ queue: [] }), 'u1', now), null);
  const broken = JSON.parse(saved());
  delete broken.queue[0].requestId;
  assert.equal(restoreBulkEmailJob(JSON.stringify(broken), 'u1', now), null, 'no requestId means no dedupe');
});
