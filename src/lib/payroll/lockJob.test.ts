import assert from 'node:assert/strict';
import test from 'node:test';
import { lockJobPercent, runLockJob, type LockJobProgress } from './lockJob';

const targets = [
  { id: 'a', name: 'Ani' },
  { id: 'b', name: 'Budi' },
  { id: 'c', name: 'Citra' },
];
const none = { advancedLoans: 0, paidOffLoans: 0 };

test('the seal is one step and each slip another, so progress starts at 0 and ends at 100', async () => {
  const seen: LockJobProgress[] = [];
  const result = await runLockJob({
    targets,
    seal: async () => {},
    lockOne: async () => none,
    shouldStop: () => false,
    onProgress: (progress) => seen.push(progress),
  });
  assert.equal(result.total, 4);
  assert.equal(lockJobPercent(seen[0].completed, seen[0].total), 0);
  assert.equal(lockJobPercent(result.completed, result.total), 100);
  const completed = seen.map((progress) => progress.completed);
  assert.deepEqual(completed, [...completed].sort((left, right) => left - right), 'never goes backwards');
  assert.deepEqual(result.lockedIds, ['a', 'b', 'c']);
  assert.equal(result.stopped, false);
});

test('a slip counts as a step only once it has finished', async () => {
  const during: Array<[string, number]> = [];
  await runLockJob({
    targets,
    seal: async () => {},
    lockOne: async () => none,
    shouldStop: () => false,
    onProgress: (progress) => {
      if (progress.currentName) during.push([progress.currentName, progress.completed]);
    },
  });
  assert.deepEqual(during, [['Ani', 1], ['Budi', 2], ['Citra', 3]]);
});

test('a failing slip is listed, stays unlocked and does not stop the rest', async () => {
  const result = await runLockJob({
    targets,
    seal: async () => {},
    lockOne: async (target) => {
      if (target.id === 'b') throw new Error('Cicilan Koperasi tidak cocok');
      return none;
    },
    shouldStop: () => false,
    onProgress: () => {},
  });
  assert.deepEqual(result.lockedIds, ['a', 'c']);
  assert.deepEqual(result.failures, [{ name: 'Budi', message: 'Cicilan Koperasi tidak cocok' }]);
  assert.equal(lockJobPercent(result.completed, result.total), 100);
});

test('loan counts add up across slips', async () => {
  const result = await runLockJob({
    targets,
    seal: async () => {},
    lockOne: async (target) => (target.id === 'c' ? { advancedLoans: 2, paidOffLoans: 1 } : { advancedLoans: 1, paidOffLoans: 0 }),
    shouldStop: () => false,
    onProgress: () => {},
  });
  assert.equal(result.advancedLoans, 4);
  assert.equal(result.paidOffLoans, 1);
});

test('a failed seal locks nothing and reports why', async () => {
  let locked = 0;
  const result = await runLockJob({
    targets,
    seal: async () => {
      throw new Error('Periode belum dapat ditutup');
    },
    lockOne: async () => {
      locked += 1;
      return none;
    },
    shouldStop: () => false,
    onProgress: () => {},
  });
  assert.equal(locked, 0);
  assert.equal(result.fatalError, 'Periode belum dapat ditutup');
  assert.deepEqual(result.lockedIds, []);
  assert.equal(result.skipped, 3);
  assert.equal(result.completed, 0);
});

test('stopping leaves the untried slips alone and says how many', async () => {
  let stop = false;
  const result = await runLockJob({
    targets,
    seal: async () => {},
    lockOne: async () => {
      stop = true;
      return none;
    },
    shouldStop: () => stop,
    onProgress: () => {},
  });
  assert.deepEqual(result.lockedIds, ['a']);
  assert.equal(result.stopped, true);
  assert.equal(result.skipped, 2);
  assert.ok(lockJobPercent(result.completed, result.total) < 100);
});

test('no slips means only the seal runs', async () => {
  const result = await runLockJob({
    targets: [],
    seal: async () => {},
    lockOne: async () => none,
    shouldStop: () => false,
    onProgress: () => {},
  });
  assert.equal(result.total, 1);
  assert.equal(lockJobPercent(result.completed, result.total), 100);
});

test('percent is clamped and safe with no total', () => {
  assert.equal(lockJobPercent(0, 0), 0);
  assert.equal(lockJobPercent(5, 4), 100);
  assert.equal(lockJobPercent(-1, 4), 0);
  assert.equal(lockJobPercent(1, 3), 33);
});
