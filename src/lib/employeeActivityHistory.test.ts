import assert from 'node:assert/strict';
import test from 'node:test';
import {
  filterEmployeeActivityHistory,
  summarizeEmployeeActivityHistory,
} from './employeeActivityHistory';

const historicalRecords = Object.freeze([
  Object.freeze({ id: 'old-1', status: 'approved' as const, fee: 12_500 }),
  Object.freeze({ id: 'old-2', status: 'pending' as const, fee: 0 }),
  Object.freeze({ id: 'old-3', status: 'declined' as const, fee: 50_000 }),
]);

test('history filtering preserves every source record and its identity', () => {
  const before = JSON.stringify(historicalRecords);
  const approved = filterEmployeeActivityHistory(
    historicalRecords,
    'approved',
  );

  assert.deepEqual(approved, [historicalRecords[0]]);
  assert.equal(approved[0], historicalRecords[0]);
  assert.equal(JSON.stringify(historicalRecords), before);
});

test('the all filter returns the original read-only history collection', () => {
  assert.equal(
    filterEmployeeActivityHistory(historicalRecords, 'all'),
    historicalRecords,
  );
});

test('history summaries do not alter declined or approved historical fees', () => {
  const before = JSON.stringify(historicalRecords);
  assert.deepEqual(summarizeEmployeeActivityHistory(historicalRecords), {
    pending: 1,
    approved: 1,
    declined: 1,
    totalApprovedFee: 12_500,
  });
  assert.equal(JSON.stringify(historicalRecords), before);
});
