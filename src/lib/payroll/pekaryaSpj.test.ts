import assert from 'node:assert/strict';
import test from 'node:test';
import {
  activityDurationMinutes,
  pekaryaPayrollPeriodForDate,
  pekaryaPayrollWindow,
  sumApprovedActivitySpj,
  sumApprovedEventSpj,
} from './pekaryaSpj';

test('maps legacy cutoff, July transition, and calendar periods', () => {
  assert.equal(pekaryaPayrollPeriodForDate('2026-05-26'), '2026-06');
  assert.equal(pekaryaPayrollPeriodForDate('2026-06-25'), '2026-06');
  assert.equal(pekaryaPayrollPeriodForDate('2026-06-26'), '2026-07');
  assert.equal(pekaryaPayrollPeriodForDate('2026-07-31'), '2026-07');
  assert.equal(pekaryaPayrollPeriodForDate('2026-08-01'), '2026-08');
  assert.deepEqual(pekaryaPayrollWindow('2026-07').sourceMonths, ['2026-06', '2026-07']);
});

test('validates normal and cross-midnight activity duration', () => {
  assert.equal(activityDurationMinutes('08:00', '14:00'), 360);
  assert.equal(activityDurationMinutes('22:00', '02:00'), 240);
  assert.throws(() => activityDurationMinutes('08:00', '08:00'));
  assert.throws(() => activityDurationMinutes('08:99', '10:00'));
});

test('counts approved non-Satpam activity once and does not double driver wage', () => {
  const reports = [
    {
      id: 'a',
      employeeId: 'E1',
      jobCategory: 'SOPIR',
      activityDate: '2026-07-10',
      status: 'approved',
      fee: 70_000,
      upahBersih: 70_000,
    },
    {
      id: 'a',
      employeeId: 'E1',
      jobCategory: 'SOPIR',
      activityDate: '2026-07-10',
      status: 'approved',
      fee: 70_000,
      upahBersih: 70_000,
    },
  ];
  assert.equal(sumApprovedActivitySpj(reports, 'E1', 'SOPIR', '2026-07'), 70_000);
});

test('event totals are period/category scoped and legacy compatible', () => {
  const events = [
    {
      id: 'one',
      period: '2026-08',
      jobCategory: 'TEKNISI',
      status: 'approved',
      eventWorkers: { E1: { payGiven: 50_000 } },
    },
    {
      id: 'two',
      period: '2026-08',
      jobCategory: 'SOPIR',
      status: 'approved',
      eventWorkers: { E1: { payGiven: 100_000 } },
    },
  ];
  assert.equal(sumApprovedEventSpj(events, 'E1', 'TEKNISI', '2026-08'), 50_000);
});
