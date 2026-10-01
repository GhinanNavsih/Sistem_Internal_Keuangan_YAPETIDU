import assert from 'node:assert/strict';
import test from 'node:test';
import {
  MAX_LEAVE_RANGE_DAYS,
  describeLeaveRangeOutcome,
  expandLeaveDateRange,
  submitLeaveRange,
} from './leaveDateRange';

test('an empty or equal end date is a single day', () => {
  assert.deepEqual(expandLeaveDateRange('2026-09-29', ''), { dates: ['2026-09-29'], error: null });
  assert.deepEqual(expandLeaveDateRange('2026-09-29', '2026-09-29'), {
    dates: ['2026-09-29'],
    error: null,
  });
});

test('a range lists every date, crossing month and year ends', () => {
  assert.deepEqual(expandLeaveDateRange('2026-09-29', '2026-10-02').dates, [
    '2026-09-29',
    '2026-09-30',
    '2026-10-01',
    '2026-10-02',
  ]);
  assert.deepEqual(expandLeaveDateRange('2026-12-31', '2027-01-01').dates, [
    '2026-12-31',
    '2027-01-01',
  ]);
  assert.deepEqual(expandLeaveDateRange('2028-02-28', '2028-03-01').dates, [
    '2028-02-28',
    '2028-02-29',
    '2028-03-01',
  ]);
});

test('bad input is reported instead of expanded', () => {
  assert.equal(expandLeaveDateRange('', '').error, 'invalid');
  assert.equal(expandLeaveDateRange('2026-02-30', '').error, 'invalid');
  assert.equal(expandLeaveDateRange('2026-09-29', 'besok').error, 'invalid');
  assert.equal(expandLeaveDateRange('2026-09-29', '2026-09-28').error, 'reversed');
});

test('the range is capped at a month', () => {
  assert.equal(expandLeaveDateRange('2026-09-01', '2026-10-01').dates.length, MAX_LEAVE_RANGE_DAYS);
  assert.equal(expandLeaveDateRange('2026-09-01', '2026-10-02').error, 'too_long');
});

test('submitLeaveRange skips held dates and keeps going after a failure', async () => {
  const sent: string[] = [];
  const progress: string[] = [];
  const outcome = await submitLeaveRange(
    ['2026-09-29', '2026-09-30', '2026-10-01'],
    (date) => date === '2026-09-29',
    async (date) => {
      if (date === '2026-09-30') throw new Error('Jatah habis.');
      sent.push(date);
    },
    (done, total) => progress.push(`${done}/${total}`),
  );
  assert.deepEqual(sent, ['2026-10-01']);
  assert.deepEqual(outcome, {
    succeeded: ['2026-10-01'],
    skipped: ['2026-09-29'],
    failed: [{ date: '2026-09-30', message: 'Jatah habis.' }],
  });
  assert.deepEqual(progress, ['0/2', '1/2', '2/2']);
});

test('the summary names what went through, what was skipped and what failed', () => {
  const ok = describeLeaveRangeOutcome(
    { succeeded: ['2026-09-29', '2026-09-30'], skipped: [], failed: [] },
    'izin sakit',
  );
  assert.equal(ok.failed, false);
  assert.match(ok.text, /2 hari izin sakit berhasil dikirim/);

  const partial = describeLeaveRangeOutcome(
    {
      succeeded: ['2026-09-29'],
      skipped: ['2026-09-30'],
      failed: [{ date: '2026-10-01', message: 'Jatah habis.' }],
    },
    'cuti',
  );
  assert.equal(partial.failed, true);
  assert.match(partial.text, /1 hari cuti berhasil dikirim/);
  assert.match(partial.text, /Dilewati.*2026-09-30/);
  assert.match(partial.text, /2026-10-01: Jatah habis\./);

  assert.equal(
    describeLeaveRangeOutcome({ succeeded: [], skipped: ['2026-09-30'], failed: [] }, 'cuti').failed,
    true,
  );
});
