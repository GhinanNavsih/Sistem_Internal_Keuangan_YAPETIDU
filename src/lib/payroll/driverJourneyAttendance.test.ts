import assert from 'node:assert/strict';
import test from 'node:test';
import { attendanceDayKey, type EffectiveAttendanceDay } from './attendance';
import {
  applyDriverJourneyCredits,
  DRIVER_JOURNEY_ATTENDANCE_START_PERIOD,
  driverJourneyDayCredits,
  shiftPeriodToken,
  type DriverJourneyInterval,
} from './driverJourneyAttendance';

const PERIOD = '2026-09';
const NIPY = '14000000001';
const JOIN = new Map([['BC_001', NIPY]]);

function journey(overrides: Partial<DriverJourneyInterval>): DriverJourneyInterval {
  return {
    employeeId: 'BC_001',
    journeyId: 'JRN-1',
    dateStart: '2026-09-14',
    dateEnd: '2026-09-14',
    timeStart: '07:00',
    timeEnd: '15:00',
    isMultiDay: false,
    ...overrides,
  };
}

function day(date: string, overrides: Partial<EffectiveAttendanceDay> = {}): EffectiveAttendanceDay {
  return {
    nipy: NIPY,
    date,
    name: 'Abdul Kholik',
    department: '',
    workStatus: '',
    scanIn: null,
    scanOut: null,
    present: false,
    completePunch: false,
    corrected: false,
    sourceRows: [1],
    issues: [],
    ...overrides,
  };
}

function apply(
  journeys: DriverJourneyInterval[],
  days: EffectiveAttendanceDay[],
  correctedKeys: string[] = [],
) {
  return applyDriverJourneyCredits({
    days,
    credits: driverJourneyDayCredits(journeys, PERIOD),
    joinNipyByEmployeeId: JOIN,
    correctedKeys: new Set(correctedKeys),
  });
}

const find = (days: EffectiveAttendanceDay[], date: string) =>
  days.find((candidate) => candidate.date === date)!;

test('credits begin with the September period; August is never touched', () => {
  assert.equal(DRIVER_JOURNEY_ATTENDANCE_START_PERIOD, '2026-09');
  assert.deepEqual(
    driverJourneyDayCredits(
      [journey({ dateStart: '2026-08-20', dateEnd: '2026-08-20' })],
      '2026-08',
    ),
    [],
  );
});

test('a trip from 07:00 yesterday to 15:00 today makes both days a complete 07:30-14:00', () => {
  const days = apply(
    [journey({ dateStart: '2026-09-14', dateEnd: '2026-09-15', timeStart: '07:00', timeEnd: '15:00', isMultiDay: true })],
    [day('2026-09-14'), day('2026-09-15')],
  );
  for (const date of ['2026-09-14', '2026-09-15']) {
    const credited = find(days, date);
    assert.equal(credited.scanIn, '07:30:00');
    assert.equal(credited.scanOut, '14:00:00');
    assert.equal(credited.present, true);
    assert.equal(credited.completePunch, true);
    assert.equal(credited.corrected, false);
    assert.equal(credited.workStatus, 'PERJALANAN DINAS');
    assert.deepEqual(credited.journeyCredit, { scanIn: true, scanOut: true, journeyIds: ['JRN-1'] });
  }
});

test('a middle day of a long trip is credited the whole window too', () => {
  const credits = driverJourneyDayCredits(
    [journey({ dateStart: '2026-09-14', dateEnd: '2026-09-16', timeStart: '16:00', timeEnd: '09:00', isMultiDay: true })],
    PERIOD,
  );
  assert.deepEqual(
    credits.map((credit) => [credit.date, credit.scanIn, credit.scanOut]),
    [
      ['2026-09-15', '07:30:00', '14:00:00'],
      ['2026-09-16', '07:30:00', '09:00:00'],
    ],
  );
});

test('a trip that only touches part of the window fills only that part', () => {
  const evening = apply(
    [journey({ timeStart: '13:30', timeEnd: '18:15' })],
    [day('2026-09-14')],
  );
  assert.equal(find(evening, '2026-09-14').scanIn, '13:30:00');
  assert.equal(find(evening, '2026-09-14').scanOut, '14:00:00');

  const morning = apply(
    [journey({ timeStart: '07:30', timeEnd: '10:00' })],
    [day('2026-09-14')],
  );
  assert.equal(find(morning, '2026-09-14').scanIn, '07:30:00');
  assert.equal(find(morning, '2026-09-14').scanOut, '10:00:00');
});

test('a one-sided scan keeps its real side and takes the other from the trip', () => {
  const days = apply(
    [journey({ timeStart: '07:40', timeEnd: '18:00' })],
    [
      day('2026-09-14', {
        present: true,
        scanIn: '07:26:45',
        scanOut: null,
        issues: ['INCOMPLETE_PUNCH', 'DUPLICATE_EMPLOYEE_DAY'],
      }),
    ],
  );
  const credited = find(days, '2026-09-14');
  assert.equal(credited.scanIn, '07:26:45');
  assert.equal(credited.scanOut, '14:00:00');
  assert.equal(credited.completePunch, true);
  assert.deepEqual(credited.journeyCredit, { scanIn: false, scanOut: true, journeyIds: ['JRN-1'] });
  // The scan problem the trip resolved is gone; unrelated issues stay.
  assert.deepEqual(credited.issues, ['DUPLICATE_EMPLOYEE_DAY']);
});

test('short complete scans are extended by a trip covering the window', () => {
  const days = apply(
    [journey({ timeStart: '07:00', timeEnd: '15:00' })],
    [day('2026-09-14', { present: true, scanIn: '09:00:00', scanOut: '12:00:00', completePunch: true })],
  );
  const credited = find(days, '2026-09-14');
  assert.equal(credited.scanIn, '07:30:00');
  assert.equal(credited.scanOut, '14:00:00');
});

test('real scans that already cover the trip are left untouched', () => {
  const original = day('2026-09-14', {
    present: true,
    scanIn: '06:00:00',
    scanOut: '15:00:00',
    completePunch: true,
  });
  const days = apply([journey({ timeStart: '08:00', timeEnd: '10:00' })], [original]);
  assert.deepEqual(find(days, '2026-09-14'), original);
  assert.equal(find(days, '2026-09-14').journeyCredit, undefined);
});

test('several trips on one date reach from the earliest start to the latest end', () => {
  const days = apply(
    [
      journey({ journeyId: 'A', timeStart: '07:30', timeEnd: '09:00' }),
      journey({ journeyId: 'B', timeStart: '11:00', timeEnd: '14:00' }),
    ],
    [day('2026-09-14')],
  );
  const credited = find(days, '2026-09-14');
  assert.equal(credited.scanIn, '07:30:00');
  assert.equal(credited.scanOut, '14:00:00');
  assert.deepEqual(credited.journeyCredit?.journeyIds, ['A', 'B']);
});

test('a trip outside the work window, or an overnight drive, credits nothing', () => {
  assert.deepEqual(
    driverJourneyDayCredits([journey({ timeStart: '14:30', timeEnd: '18:00' })], PERIOD),
    [],
  );
  assert.deepEqual(
    driverJourneyDayCredits(
      [journey({ timeStart: '22:00', timeEnd: '03:00', isMultiDay: true })],
      PERIOD,
    ),
    [],
  );
});

test('a date with a stored correction is never changed by a trip', () => {
  const corrected = day('2026-09-14', { corrected: true, workStatus: 'TIDAK MASUK' });
  const days = apply(
    [journey({})],
    [corrected],
    [attendanceDayKey(NIPY, '2026-09-14')],
  );
  assert.deepEqual(find(days, '2026-09-14'), corrected);
});

test('a date the file has no row for is created from the trip alone', () => {
  const days = apply([journey({})], []);
  assert.equal(days.length, 1);
  assert.equal(days[0].nipy, NIPY);
  assert.equal(days[0].present, true);
  assert.deepEqual(days[0].sourceRows, []);
  assert.equal(days[0].scanIn, '07:30:00');
});

test('days of a month are credited only inside that month', () => {
  const credits = driverJourneyDayCredits(
    [journey({ dateStart: '2026-08-31', dateEnd: '2026-09-01', timeStart: '07:00', timeEnd: '15:00', isMultiDay: true })],
    PERIOD,
  );
  assert.deepEqual(credits.map((credit) => credit.date), ['2026-09-01']);
});

test('an employee without a join NIPY, and malformed trips, are ignored', () => {
  const days = apply(
    [
      journey({ employeeId: 'BC_999' }),
      journey({ timeStart: '7:00' }),
      journey({ timeEnd: '25:00' }),
    ],
    [day('2026-09-14')],
  );
  assert.equal(find(days, '2026-09-14').present, false);
});

test('shifting a period token crosses the year', () => {
  assert.equal(shiftPeriodToken('2026-01', -1), '2025-12');
  assert.equal(shiftPeriodToken('2026-12', 1), '2027-01');
  assert.equal(shiftPeriodToken('2026-09', 0), '2026-09');
});
