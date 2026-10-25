import assert from 'node:assert/strict';
import test from 'node:test';
import { ProposalDraftQueue, readProposalDrafts, type LocalProposalDraft } from './proposalDrafts';
import type { ProposalWriteResult } from './proposalLifecycle';

const draft = (name: string): LocalProposalDraft => ({
  id: '2026-10_prop_fixture',
  actorUid: 'head',
  ownerUid: 'head',
  ownerName: 'Head',
  period: '2026-10',
  revision: 0,
  status: 'proposal_draft',
  stage: 'proposal',
  data: { reportName: name },
  requestId: name,
  updatedAt: 100,
  localRevision: 1,
  predecessorRequestIds: [],
});
const initial: ProposalWriteResult = {
  proposalId: draft('').id,
  revision: 0,
  status: 'proposal_draft',
};

test('draft saves serialize one document and persist the newest input with the acknowledged revision', async () => {
  const calls: LocalProposalDraft[] = [];
  let release!: () => void;
  const blocked = new Promise<void>((resolve) => {
    release = resolve;
  });
  const local: string[] = [];
  const queue = new ProposalDraftQueue(
    initial,
    async (input) => {
      calls.push(input);
      if (calls.length === 1) await blocked;
      return { ...initial, revision: input.revision + 1 };
    },
    (input) => {
      local.push(String(input.data.reportName));
    },
    () => {},
    () => {},
  );
  queue.update(draft('first'));
  const flush = queue.flush();
  queue.update(draft('second'));
  queue.update(draft('newest'));
  assert.equal(calls.length, 1);
  assert.equal(local.at(-1), 'newest', 'new input is durable before its request starts');
  release();
  assert.equal(await flush, true);
  assert.deepEqual(
    calls.map((input) => [input.requestId, input.revision]),
    [
      ['first', 0],
      ['newest', 1],
    ],
  );
  assert.equal(queue.currentVersion.revision, 2);
  queue.discard();
});

test('a failed save retains the same request identity for a later retry', async () => {
  let fails = true;
  const requestIds: string[] = [];
  const statuses: string[] = [];
  const queue = new ProposalDraftQueue(
    initial,
    async (input) => {
      requestIds.push(input.requestId);
      if (fails) throw new Error('Offline');
      return { ...initial, revision: 1 };
    },
    () => {},
    () => {},
    (status) => {
      statuses.push(status);
    },
  );
  queue.update(draft('recoverable'));
  assert.equal(await queue.flush(), false);
  assert.equal(statuses.at(-1), 'error');
  fails = false;
  assert.equal(await queue.flush(), true);
  assert.deepEqual(requestIds, ['recoverable', 'recoverable']);
  queue.discard();
});

test('an explicit save interrupted by a lost response remains retryable', async () => {
  let attempts = 0;
  const saved: string[] = [];
  const queue = new ProposalDraftQueue(
    initial,
    async () => {
      if (++attempts === 1) throw new Error('Response lost');
      return { ...initial, revision: 1 };
    },
    () => {},
    (input) => {
      saved.push(input.requestId);
    },
    () => {},
  );
  await assert.rejects(queue.perform(draft('manual-save'), 'save_draft'), /Response lost/);
  assert.equal(await queue.flush(), true);
  assert.deepEqual(saved, ['manual-save']);
  queue.discard();
});

test('a departed session abandons queued input superseded by a newer local draft', async () => {
  let release!: () => void;
  const blocked = new Promise<void>((resolve) => {
    release = resolve;
  });
  const calls: string[] = [];
  let superseded = false;
  const queue = new ProposalDraftQueue(
    initial,
    async (input) => {
      calls.push(input.requestId);
      await blocked;
      return { ...initial, revision: 1 };
    },
    () => !superseded,
    () => {},
    () => {},
  );
  queue.update(draft('in-flight'));
  const flush = queue.flush();
  queue.update(draft('old-queued'));
  superseded = true;
  release();
  assert.equal(await flush, true);
  assert.deepEqual(calls, ['in-flight']);
  queue.discard();
});

test('local proposal recovery is scoped to the authenticated account and payroll period', () => {
  const values = [
    draft('own'),
    { ...draft('other-account'), actorUid: 'other' },
    { ...draft('other-period'), period: '2026-11' },
    { ...draft('bad-id'), id: '../other' },
  ];
  const storage = { getItem: () => JSON.stringify(values) };
  assert.deepEqual(
    readProposalDrafts(storage, 'head', '2026-10').map((item) => item.requestId),
    ['own'],
  );
  assert.deepEqual(readProposalDrafts({ getItem: () => '{broken' }, 'head', '2026-10'), []);
});
