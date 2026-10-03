import assert from 'node:assert/strict';
import test from 'node:test';
import { periodDateRange } from './calendar';
import { isPremiumAttendanceDate } from './attendance';
import {
  applyCorrectionToPresenceDays,
  calculatePekaryaPresenceBonus,
  presenceBonusColumnKey,
  type PresenceBonusDay,
} from './pekaryaPresenceBonus';

const PERIOD = '2026-09';
// September 2026 has four Fridays (4, 11, 18, 25); the 17th is declared a holiday.
const HOLIDAYS = new Set(['2026-09-17']);

const workingDates = periodDateRange(PERIOD).filter(
  (date) => !isPremiumAttendanceDate(date, HOLIDAYS),
);

function everyWorkingDay(overrides: Record<string, Partial<PresenceBonusDay>> = {}) {
  return workingDates.map(
    (date): PresenceBonusDay => ({
      date,
      present: true,
      scanIn: '05:49:24',
      ...overrides[date],
    }),
  );
}

function bonus(days: PresenceBonusDay[]) {
  return calculatePekaryaPresenceBonus({ period: PERIOD, days, premiumDates: HOLIDAYS });
}

test('Fridays and holidays are not working days', () => {
  assert.equal(workingDates.length, 30 - 4 - 1);
  assert.ok(!workingDates.includes('2026-09-04'));
  assert.ok(!workingDates.includes('2026-09-17'));
  assert.ok(workingDates.includes('2026-09-06'), 'a Sunday is an ordinary working day');
});

test('present every working day and never late earns Rp100.000', () => {
  const result = bonus(everyWorkingDay());
  assert.equal(result.amount, 100_000);
  assert.equal(result.tier, 'perfect');
});

test('being absent on Fridays and holidays costs nothing', () => {
  // No rows at all for the premium days, as for a guard who is simply off.
  const result = bonus(everyWorkingDay());
  assert.equal(result.absentDates.length, 0);
  assert.equal(result.amount, 100_000);
});

test('present every working day but late at least once earns Rp50.000', () => {
  const result = bonus(everyWorkingDay({ '2026-09-02': { scanIn: '07:36:12' } }));
  assert.equal(result.amount, 50_000);
  assert.equal(result.tier, 'full');
  assert.deepEqual(result.lateDates, ['2026-09-02']);
});

test('late by even one second is late; exactly 07:30:00 and earlier are not', () => {
  assert.equal(bonus(everyWorkingDay({ '2026-09-02': { scanIn: '07:30:01' } })).amount, 50_000);
  assert.equal(bonus(everyWorkingDay({ '2026-09-02': { scanIn: '07:30:00' } })).amount, 100_000);
  assert.equal(bonus(everyWorkingDay({ '2026-09-02': { scanIn: '07:29:59' } })).amount, 100_000);
});

test('one absence earns Rp30.000, late or not', () => {
  const clean = bonus(everyWorkingDay({ '2026-09-02': { present: false, scanIn: null } }));
  assert.equal(clean.amount, 30_000);
  assert.equal(clean.tier, 'one_absence');
  const late = bonus(
    everyWorkingDay({
      '2026-09-02': { present: false, scanIn: null },
      '2026-09-03': { scanIn: '08:15:00' },
    }),
  );
  assert.equal(late.amount, 30_000);
});

test('two absences earn Rp10.000, late or not', () => {
  const result = bonus(
    everyWorkingDay({
      '2026-09-02': { present: false, scanIn: null },
      '2026-09-03': { present: false, scanIn: null },
      '2026-09-05': { scanIn: '09:00:00' },
    }),
  );
  assert.equal(result.amount, 10_000);
  assert.equal(result.tier, 'two_absences');
});

test('three or more absences earn nothing', () => {
  const result = bonus(
    everyWorkingDay({
      '2026-09-02': { present: false, scanIn: null },
      '2026-09-03': { present: false, scanIn: null },
      '2026-09-05': { present: false, scanIn: null },
    }),
  );
  assert.equal(result.amount, 0);
  assert.equal(result.tier, 'none');
});

test('a working day with no attendance row counts as absent', () => {
  const days = everyWorkingDay().filter((day) => day.date !== '2026-09-08');
  const result = bonus(days);
  assert.deepEqual(result.absentDates, ['2026-09-08']);
  assert.equal(result.amount, 30_000);
});

test('an employee with no attendance at all earns nothing', () => {
  assert.equal(bonus([]).amount, 0);
});

test('a missing scan-in is not late, because nothing was scanned late', () => {
  assert.equal(bonus(everyWorkingDay({ '2026-09-02': { scanIn: null } })).amount, 100_000);
});

test('working on a Friday or holiday does not change the tier', () => {
  const days = [
    ...everyWorkingDay(),
    { date: '2026-09-04', present: true, scanIn: '09:00:00' },
    { date: '2026-09-17', present: true, scanIn: '09:00:00' },
  ];
  assert.equal(bonus(days).amount, 100_000);
});

test('only Kebersihan and Teknisi earn the bonus, each on its own rekap column', () => {
  assert.equal(presenceBonusColumnKey('KEBERSIHAN'), 'bonusPresensi');
  assert.equal(presenceBonusColumnKey('TEKNISI'), 'bonusMutlak');
  for (const category of ['PEKARYA', 'SOPIR', 'SATPAM', 'PONTI', 'KEBERSIHAN_PONTI']) {
    assert.equal(presenceBonusColumnKey(category), null);
  }
});

test('a correction is applied to one date without touching the rest', () => {
  const days = everyWorkingDay({ '2026-09-02': { present: false, scanIn: null } });
  assert.equal(bonus(days).amount, 30_000);
  const corrected = applyCorrectionToPresenceDays(days, '2026-09-02', {
    present: true,
    scanIn: '07:30:00',
  });
  assert.equal(bonus(corrected).amount, 100_000);
  // Original input is not mutated.
  assert.equal(days.find((day) => day.date === '2026-09-02')?.present, false);
  // A correction that only supplies a scan keeps the day's presence.
  const scanOnly = applyCorrectionToPresenceDays(days, '2026-09-03', { scanIn: '08:00:00' });
  assert.equal(scanOnly.find((day) => day.date === '2026-09-03')?.present, true);
  assert.equal(bonus(scanOnly).tier, 'one_absence');
  // A correction for a date with no row adds one.
  const added = applyCorrectionToPresenceDays([], '2026-09-02', { present: true, scanIn: null });
  assert.equal(added.length, 1);
});
