import assert from 'node:assert/strict';
import test from 'node:test';
import { periodCalendarFromData, normalizePeriodPremiumDates } from './calendar';
import { isSatpamDutyPlanRequired } from './satpamDutyPlan';

test('an unmaterialized period still rates Fridays as premium', () => {
  // Periods are open by default, so work can be reported into a month that has
  // no PayrollPeriods document. Pay classification must not silently degrade to
  // all-Harian just because nobody configured the month.
  const calendar = periodCalendarFromData('2026-08', null);
  const fridays = calendar.premiumDates.filter((date) => {
    const [year, month, day] = date.split('-').map(Number);
    return new Date(Date.UTC(year, month - 1, day)).getUTCDay() === 5;
  });
  assert.ok(fridays.length >= 4, 'every Friday in the window must be premium');
  assert.equal(calendar.revision, 1);
  assert.deepEqual(calendar.premiumDates, [...calendar.premiumDates].sort());
});

test('annual holidays reach an unmaterialized period, and a frozen snapshot wins', () => {
  const withAnnual = periodCalendarFromData('2026-08', null, ['2026-08-17']);
  assert.ok(
    withAnnual.premiumDates.includes('2026-08-17'),
    'national holidays apply before the period is materialized',
  );

  // Once frozen, the snapshot is authoritative: a later annual-calendar edit
  // must not retroactively re-rate work already approved against it.
  const frozen = periodCalendarFromData(
    '2026-08',
    { workCalendar: { revision: 3, premiumDates: ['2026-08-07'] } },
    ['2026-08-17'],
  );
  assert.equal(frozen.revision, 3);
  assert.ok(!frozen.premiumDates.includes('2026-08-17'));
  assert.ok(frozen.premiumDates.includes('2026-08-07'));
});

test('premium dates outside the payroll window are rejected', () => {
  const normalized = normalizePeriodPremiumDates('2026-08', [
    '2026-08-17',
    '2026-09-20',
  ]);
  assert.ok(normalized.includes('2026-08-17'));
  assert.ok(!normalized.includes('2026-09-20'));
});

test('duty planning is required from the August attendance regime onward', () => {
  // The stored marker is written at materialization. An August-or-later month
  // nobody has touched still owes a duty plan, so the regime boundary has to
  // answer on its own; July remains a legacy month.
  assert.equal(isSatpamDutyPlanRequired('2026-09', null), true);
  assert.equal(isSatpamDutyPlanRequired('2026-08', null), true);
  assert.equal(isSatpamDutyPlanRequired('2026-07', null), false);
  assert.equal(isSatpamDutyPlanRequired('2026-05', null), false);
  assert.equal(
    isSatpamDutyPlanRequired('2026-05', { satpamDutyPlanRequired: true }),
    true,
  );
});
