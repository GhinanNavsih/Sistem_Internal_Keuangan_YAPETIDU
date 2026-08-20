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
  hasClaimedDriverJourney,
  countSubmittedSelfPiketJourneysOnDate,
  isSelfCreatedDriverJourney,
  classifyDriverPiketDatesInPeriod,
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

  const duplicateSchedule = { ...mockSchedules[0], id: 'PIKET-DUPLICATE' };
  assert.equal(
    countDriverPiketInPeriod('D1', '2026-08', [...mockSchedules, duplicateSchedule]),
    2,
  );
});

test('getDriverPiketDatesInPeriod returns sorted date list', () => {
  assert.deepEqual(getDriverPiketDatesInPeriod('D1', '2026-08', mockSchedules), ['2026-08-01', '2026-08-15']);
  assert.deepEqual(getDriverPiketDatesInPeriod('D2', '2026-08', mockSchedules), ['2026-08-01']);
  assert.deepEqual(getDriverPiketDatesInPeriod('D3', '2026-08', mockSchedules), []);

  const duplicateSchedule = { ...mockSchedules[0], id: 'PIKET-DUPLICATE' };
  assert.deepEqual(
    getDriverPiketDatesInPeriod('D1', '2026-08', [...mockSchedules, duplicateSchedule]),
    ['2026-08-01', '2026-08-15'],
  );
});

test('getTodayDateString returns valid YYYY-MM-DD string', () => {
  const today = getTodayDateString();
  assert.match(today, /^\d{4}-\d{2}-\d{2}$/);
});

test('only a claimed journey blocks the next self-authorized Piket journey', () => {
  const journeys = [
    {
      id: 'JRN-PIKET-20260801-FIRST',
      employeeId: 'D1',
      status: 'claimed',
      activityDate: '2026-08-01',
      isSelfCreatedPiketSpj: true,
    },
  ];

  assert.equal(hasClaimedDriverJourney(journeys), true);

  journeys[0].status = 'submitted';
  assert.equal(hasClaimedDriverJourney(journeys), false);
  assert.equal(
    countSubmittedSelfPiketJourneysOnDate('2026-08-01', 'D1', journeys),
    1,
  );

  journeys.push({
    id: 'JRN-PIKET-20260801-SECOND',
    employeeId: 'D1',
    status: 'claimed',
    activityDate: '2026-08-01',
    isSelfCreatedPiketSpj: true,
  });
  assert.equal(hasClaimedDriverJourney(journeys), true);
  assert.equal(
    countSubmittedSelfPiketJourneysOnDate('2026-08-01', 'D1', journeys),
    1,
  );
});

test('Piket SPJ count is date, driver, and journey-type scoped', () => {
  const journeys = [
    {
      id: 'JRN-PIKET-20260801-FIRST',
      employeeId: 'D1',
      status: 'submitted',
      activityDate: '2026-08-01',
    },
    {
      id: 'JRN-PIKET-20260801-SECOND',
      employeeId: 'D1',
      status: 'approved',
      journeyDate: '2026-08-01',
    },
    {
      id: 'JRN-PIKET-20260802-OTHER-DATE',
      employeeId: 'D1',
      status: 'submitted',
      activityDate: '2026-08-02',
    },
    {
      id: 'JRN-PIKET-20260801-OTHER-DRIVER',
      employeeId: 'D2',
      status: 'submitted',
      activityDate: '2026-08-01',
    },
    {
      id: 'REGULAR-JOURNEY',
      employeeId: 'D1',
      status: 'submitted',
      activityDate: '2026-08-01',
      isSelfCreatedPiketSpj: false,
    },
    {
      id: 'JRN-PIKET-20260801-CANCELLED',
      employeeId: 'D1',
      status: 'cancelled',
      activityDate: '2026-08-01',
    },
  ];

  assert.equal(
    countSubmittedSelfPiketJourneysOnDate('2026-08-01', 'D1', journeys),
    2,
  );
});

test('a driver can self-authorize without a Piket schedule, flagged distinctly from Piket self-journeys', () => {
  const piketSelf = { id: 'JRN-PIKET-20260801-ABC', isSelfCreatedPiketSpj: true };
  const mandiriSelf = { id: 'JRN-MANDIRI-20260801-XYZ', isSelfAuthorizedWithoutPiket: true };
  const legacyPiketById = { id: 'JRN-PIKET-20260801-LEGACY' };
  const adminAuthorized = { id: 'JRN-20260801-ADMIN', assignedTo: 'D1' };

  assert.equal(isSelfCreatedDriverJourney(piketSelf), true);
  assert.equal(isSelfCreatedDriverJourney(mandiriSelf), true);
  assert.equal(isSelfCreatedDriverJourney(legacyPiketById), true);
  assert.equal(isSelfCreatedDriverJourney(adminAuthorized), false);

  // The Piket-specific counter must stay Piket-only: a self-authorized
  // journey without a schedule must never be counted as a Piket SPJ.
  const mixedJourneys = [
    { id: 'JRN-PIKET-20260801-ABC', employeeId: 'D1', status: 'submitted', activityDate: '2026-08-01', isSelfCreatedPiketSpj: true },
    { id: 'JRN-MANDIRI-20260801-XYZ', employeeId: 'D1', status: 'submitted', activityDate: '2026-08-01', isSelfAuthorizedWithoutPiket: true },
  ];
  assert.equal(
    countSubmittedSelfPiketJourneysOnDate('2026-08-01', 'D1', mixedJourneys),
    1,
  );
});

test('Piket days split into Harian/Jumat & Libur exactly like real attendance days, and always sum to the Piket count', () => {
  // Scheduled every day 1–7 Aug 2026: only 7 Aug is a Friday, so this is the
  // user's own example — 7 Piket, 6 Harian, 1 Jumat & Libur.
  const dailySchedules: DriverPiketSchedule[] = [
    '2026-08-01', '2026-08-02', '2026-08-03', '2026-08-04',
    '2026-08-05', '2026-08-06', '2026-08-07',
  ].map((date) => ({
    id: `PIKET-${date}-pak_ufik`,
    period: '2026-08',
    date,
    stationKey: 'pak_ufik',
    stationName: 'Pak Ufik',
    driverId: 'D1',
    driverName: 'Abdul Kholik',
  }));

  const noHolidays = new Set<string>();
  const result = classifyDriverPiketDatesInPeriod('D1', '2026-08', dailySchedules, noHolidays);
  assert.deepEqual(result, { harian: 6, jumatLibur: 1 });
  assert.equal(
    result.harian + result.jumatLibur,
    countDriverPiketInPeriod('D1', '2026-08', dailySchedules),
  );

  // A non-Friday date that's an explicit designated holiday also counts as
  // Jumat & Libur, same rule real published attendance uses.
  const withNationalHoliday = new Set<string>(['2026-08-17']);
  const mondayHolidaySchedule: DriverPiketSchedule[] = [
    { id: 'PIKET-2026-08-17-sekolah', period: '2026-08', date: '2026-08-17', stationKey: 'sekolah', stationName: 'Sekolah', driverId: 'D1', driverName: 'Abdul Kholik' },
  ];
  assert.deepEqual(
    classifyDriverPiketDatesInPeriod('D1', '2026-08', mondayHolidaySchedule, withNationalHoliday),
    { harian: 0, jumatLibur: 1 },
  );
});
