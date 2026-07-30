import assert from 'node:assert/strict';
import test from 'node:test';
import {
  normalizePeriodPremiumDates,
  periodCalendarFromData,
  periodFridayDates,
} from './calendar';

test('August period calendar always includes Fridays', () => {
  assert.deepEqual(periodFridayDates('2026-08'), [
    '2026-08-07',
    '2026-08-14',
    '2026-08-21',
    '2026-08-28',
  ]);
  assert.deepEqual(normalizePeriodPremiumDates('2026-08', ['2026-08-17']), [
    '2026-08-07',
    '2026-08-14',
    '2026-08-17',
    '2026-08-21',
    '2026-08-28',
  ]);
});

test('period calendar snapshots legacy dates and rejects dates outside its window', () => {
  const calendar = periodCalendarFromData(
    '2026-08',
    {
      holidays: ['2026-08-17', '2026-09-01'],
      holidayCalendarVersion: 'ID-2026-V1',
    },
  );
  assert.equal(calendar.revision, 1);
  assert.equal(calendar.annualVersion, 'ID-2026-V1');
  assert.ok(calendar.premiumDates.includes('2026-08-17'));
  assert.ok(!calendar.premiumDates.includes('2026-09-01'));
});

