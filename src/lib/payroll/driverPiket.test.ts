import assert from 'node:assert/strict';
import test from 'node:test';
import {
  DriverPiketSchedule,
  PIKET_STATIONS,
  isDriverPiketActiveOnDate,
  getActiveDriverPiketScheduleOnDate,
  countDriverPiketInPeriod,
  getDriverPiketDatesInPeriod,
  getTodayDateString,
} from './driverPiket';

const mockSchedules: DriverPiketSchedule[] = [
  {
    id: 'PIKET-2026-08-01-pak_ufik',
    period: '2026-08',
    date: '2026-08-01',
    stationKey: 'pak_ufik',
    stationName: 'Pak Ufik',
    driverId: 'D1',
    driverName: 'Abdul Kholik',
  },
  {
    id: 'PIKET-2026-08-01-sekolah',
    period: '2026-08',
    date: '2026-08-01',
    stationKey: 'sekolah',
    stationName: 'Sekolah',
    driverId: 'D2',
    driverName: 'Suryadi',
  },
  {
    id: 'PIKET-2026-08-15-pak_heri',
    period: '2026-08',
    date: '2026-08-15',
    stationKey: 'pak_heri',
    stationName: 'Pak Heri',
    driverId: 'D1',
    driverName: 'Abdul Kholik',
  },
];

test('PIKET_STATIONS contains 5 valid stations', () => {
  assert.equal(PIKET_STATIONS.length, 5);
  const keys = PIKET_STATIONS.map(s => s.key);
  assert.deepEqual(keys, ['pak_ufik', 'pak_zuem', 'pak_heri', 'bu_afifah', 'sekolah']);
});

test('isDriverPiketActiveOnDate correctly identifies active piket schedule', () => {
  assert.equal(isDriverPiketActiveOnDate('2026-08-01', 'D1', mockSchedules), true);
  assert.equal(isDriverPiketActiveOnDate('2026-08-01', 'D2', mockSchedules), true);
  assert.equal(isDriverPiketActiveOnDate('2026-08-02', 'D1', mockSchedules), false);
  assert.equal(isDriverPiketActiveOnDate('2026-08-15', 'D1', mockSchedules), true);
  assert.equal(isDriverPiketActiveOnDate('2026-08-15', 'D2', mockSchedules), false);
  assert.equal(isDriverPiketActiveOnDate('2026-08-01', 'UNKNOWN', mockSchedules), false);
});

test('getActiveDriverPiketScheduleOnDate returns station details for active driver', () => {
  const sched1 = getActiveDriverPiketScheduleOnDate('2026-08-01', 'D1', mockSchedules);
  assert.notEqual(sched1, null);
  assert.equal(sched1?.stationKey, 'pak_ufik');
  assert.equal(sched1?.stationName, 'Pak Ufik');

  const sched2 = getActiveDriverPiketScheduleOnDate('2026-08-01', 'D2', mockSchedules);
  assert.equal(sched2?.stationKey, 'sekolah');

  const schedNone = getActiveDriverPiketScheduleOnDate('2026-08-02', 'D1', mockSchedules);
  assert.equal(schedNone, null);
});

test('countDriverPiketInPeriod counts assigned piket shifts for a driver in a period', () => {
  assert.equal(countDriverPiketInPeriod('D1', '2026-08', mockSchedules), 2);
  assert.equal(countDriverPiketInPeriod('D2', '2026-08', mockSchedules), 1);
  assert.equal(countDriverPiketInPeriod('D3', '2026-08', mockSchedules), 0);
});

test('getDriverPiketDatesInPeriod returns sorted date list', () => {
  assert.deepEqual(getDriverPiketDatesInPeriod('D1', '2026-08', mockSchedules), ['2026-08-01', '2026-08-15']);
  assert.deepEqual(getDriverPiketDatesInPeriod('D2', '2026-08', mockSchedules), ['2026-08-01']);
  assert.deepEqual(getDriverPiketDatesInPeriod('D3', '2026-08', mockSchedules), []);
});

test('getTodayDateString returns valid YYYY-MM-DD string', () => {
  const today = getTodayDateString();
  assert.match(today, /^\d{4}-\d{2}-\d{2}$/);
});
