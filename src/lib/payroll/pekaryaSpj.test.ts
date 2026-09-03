import assert from 'node:assert/strict';
import test from 'node:test';
import {
  activityDurationMinutes,
  allowsHistoricalPaperSpjEntry,
  allowsManualSpjEntry,
  assertSatpamFoundItemPhotoCount,
  buildPekaryaActivityIdentity,
  calculateActivitySpjEstimate,
  pekaryaSpjBillableMinutes,
  pekaryaSpjRateBasis,
  usesPerMinuteSpjRate,
  pekaryaSpjHourlyRate,
  resolvePekaryaActivityRateType,
  pekaryaPayrollPeriodForDate,
  pekaryaPayrollWindow,
  satpamFoundItemFeeNeedsAdjustmentReason,
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

test('every payroll regime has matching period boundaries and windows', () => {
  // Legacy 26th-25th, through June 2026.
  assert.deepEqual(pekaryaPayrollWindow('2026-06'), {
    startsOn: '2026-05-26',
    endsOn: '2026-06-25',
    sourceMonths: ['2026-05', '2026-06'],
  });
  // July 2026 is the one-off transition: 26 June through 31 July.
  assert.deepEqual(pekaryaPayrollWindow('2026-07'), {
    startsOn: '2026-06-26',
    endsOn: '2026-07-31',
    sourceMonths: ['2026-06', '2026-07'],
  });
  // August 2026 onward follows the Loyalis calendar month, including the
  // 31-day, 30-day, February, and leap-February cases.
  assert.deepEqual(pekaryaPayrollWindow('2026-08'), {
    startsOn: '2026-08-01',
    endsOn: '2026-08-31',
    sourceMonths: ['2026-08'],
  });
  assert.equal(pekaryaPayrollWindow('2026-09').endsOn, '2026-09-30');
  assert.equal(pekaryaPayrollWindow('2027-02').endsOn, '2027-02-28');
  assert.equal(pekaryaPayrollWindow('2028-02').endsOn, '2028-02-29');

  // A date must always fall inside the window of the period it maps to.
  for (const date of [
    '2026-05-26', '2026-06-25', '2026-06-26', '2026-06-30', '2026-07-01',
    '2026-07-31', '2026-08-01', '2026-08-26', '2026-08-31', '2026-09-30',
    '2027-02-28', '2028-02-29',
  ]) {
    const window = pekaryaPayrollWindow(pekaryaPayrollPeriodForDate(date));
    assert.ok(
      date >= window.startsOn && date <= window.endsOn,
      `${date} fell outside the window of its own period`,
    );
  }

  // No date may land in a July gap or be double-counted across the transition.
  assert.equal(pekaryaPayrollPeriodForDate('2026-07-25'), '2026-07');
  assert.equal(pekaryaPayrollPeriodForDate('2026-07-26'), '2026-07');
  assert.equal(pekaryaPayrollPeriodForDate('2026-08-26'), '2026-08');
});

test('validates normal and cross-midnight activity duration', () => {
  assert.equal(activityDurationMinutes('08:00', '14:00'), 360);
  assert.equal(activityDurationMinutes('22:00', '02:00'), 240);
  assert.throws(() => activityDurationMinutes('08:00', '08:00'));
  assert.throws(() => activityDurationMinutes('08:99', '10:00'));
});

const ON = '2026-09-04';
const BEFORE = '2026-09-03';

test('calculates the shared non-driver activity SPJ estimate', () => {
  // Whole hours stay on round rupiah figures: Rp7.000/jam and Rp5.000/jam.
  assert.equal(
    calculateActivitySpjEstimate('08:00', '13:00', 'Lainnya', undefined, ON),
    35_000,
  );
  assert.equal(
    calculateActivitySpjEstimate('08:00', '10:00', 'Piket', undefined, ON),
    10_000,
  );
  assert.equal(
    calculateActivitySpjEstimate('22:00', '02:00', undefined, 'Piket malam', ON),
    20_000,
  );
  assert.equal(calculateActivitySpjEstimate('', '', 'Buang Sampah'), 5_000);
});

test('time-based SPJ accrues per minute and rounds the rupiah up', () => {
  // 61 min × Rp5.000/jam = Rp5.083,33… -> Rp5.084.
  assert.equal(calculateActivitySpjEstimate('08:00', '09:01', 'Piket', undefined, ON), 5_084);
  // 61 min × Rp7.000/jam = Rp7.116,66… -> Rp7.117.
  assert.equal(calculateActivitySpjEstimate('08:00', '09:01', "Ro'an", undefined, ON), 7_117);
  // Whole hours stay on round rupiah figures.
  assert.equal(calculateActivitySpjEstimate('08:00', '09:30', 'Standby', undefined, ON), 7_500);
  assert.equal(calculateActivitySpjEstimate('08:00', '09:30', 'Lainnya', undefined, ON), 10_500);
  assert.equal(calculateActivitySpjEstimate('08:00', '13:00', 'Lainnya', undefined, ON), 35_000);
});

test('time-based SPJ below one hour is paid as a full hour', () => {
  // Abdul Rouf's 13-minute Piket is billed at the 60-minute floor, not 13 × rate.
  assert.equal(calculateActivitySpjEstimate('08:00', '08:13', 'Piket', undefined, ON), 5_000);
  assert.equal(calculateActivitySpjEstimate('08:00', '08:01', 'Standby', undefined, ON), 5_000);
  assert.equal(calculateActivitySpjEstimate('08:00', '08:59', "Ro'an", undefined, ON), 7_000);
  assert.equal(calculateActivitySpjEstimate('08:00', '09:00', 'Lainnya', undefined, ON), 7_000);
  // The floor never reduces an over-an-hour submission.
  assert.equal(pekaryaSpjBillableMinutes(13), 60);
  assert.equal(pekaryaSpjBillableMinutes(240), 240);
});

test('the per-minute regime starts on its cutoff date and never before', () => {
  assert.equal(usesPerMinuteSpjRate(ON), true);
  assert.equal(usesPerMinuteSpjRate('2026-12-31'), true);
  assert.equal(usesPerMinuteSpjRate(BEFORE), false);
  assert.equal(usesPerMinuteSpjRate('2026-08-31'), false);
  // No date, or an unparseable one, must not reprice a legacy record.
  assert.equal(usesPerMinuteSpjRate(undefined), false);
  assert.equal(usesPerMinuteSpjRate(''), false);
  assert.equal(usesPerMinuteSpjRate('04/09/2026'), false);
});

test('pre-cutoff SPJ keeps the 30-minute block rates it was filed under', () => {
  // Same 2-hour Piket: Rp2.000/30m before, Rp5.000/jam on and after.
  assert.equal(calculateActivitySpjEstimate('08:00', '10:00', 'Piket', undefined, BEFORE), 8_000);
  assert.equal(calculateActivitySpjEstimate('08:00', '10:00', 'Piket', undefined, ON), 10_000);
  assert.equal(calculateActivitySpjEstimate('08:00', '13:00', 'Lainnya', undefined, BEFORE), 25_000);
  // The one-hour floor is a per-minute-regime rule only.
  assert.equal(calculateActivitySpjEstimate('08:00', '08:13', 'Piket', undefined, BEFORE), 0);
  // An undated record prices as legacy rather than being lifted to the new rate.
  assert.equal(calculateActivitySpjEstimate('08:00', '10:00', 'Piket'), 8_000);
});

test('Buang Sampah stays flat across both rate regimes', () => {
  assert.equal(calculateActivitySpjEstimate('', '', 'Buang Sampah', undefined, BEFORE), 5_000);
  assert.equal(calculateActivitySpjEstimate('', '', 'Buang Sampah', undefined, ON), 5_000);
  assert.equal(pekaryaSpjRateBasis(600, 'Buang Sampah', undefined, ON).amount, 5_000);
});

test('rate basis reports the regime the UI must render', () => {
  const modern = pekaryaSpjRateBasis(13, 'Piket', undefined, ON);
  assert.equal(modern.perMinute, true);
  assert.equal(modern.rate, 5_000);
  assert.equal(modern.billableMinutes, 60);
  assert.equal(modern.minimumApplied, true);

  const legacy = pekaryaSpjRateBasis(120, 'Piket', undefined, BEFORE);
  assert.equal(legacy.perMinute, false);
  assert.equal(legacy.rate, 2_000);
  assert.equal(legacy.minimumApplied, false);
  assert.equal(legacy.amount, 8_000);
});

test('activity rate bracket resolves from explicit type then free-text name', () => {
  assert.equal(resolvePekaryaActivityRateType('Piket'), 'Piket');
  assert.equal(resolvePekaryaActivityRateType(undefined, 'Standby pagi'), 'Standby');
  assert.equal(resolvePekaryaActivityRateType(undefined, "Ro'an masjid"), "Ro'an");
  assert.equal(resolvePekaryaActivityRateType(undefined, 'Bersih taman'), 'Lainnya');
  assert.equal(resolvePekaryaActivityRateType(undefined, undefined), 'Lainnya');
  assert.equal(
    resolvePekaryaActivityRateType(undefined, 'Buang Sampah'),
    'Buang Sampah',
  );
  assert.equal(pekaryaSpjHourlyRate('Piket'), 5_000);
  assert.equal(pekaryaSpjHourlyRate('Standby'), 5_000);
  assert.equal(pekaryaSpjHourlyRate("Ro'an"), 7_000);
  assert.equal(pekaryaSpjHourlyRate('Lainnya'), 7_000);
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

test('approved driver wages from multiple journeys are accumulated independently', () => {
  const reports = [
    {
      id: 'JOURNEY-1-REPORT',
      employeeId: 'E1',
      jobCategory: 'SOPIR',
      activityDate: '2026-08-10',
      status: 'approved',
      fee: 60_000,
      upahBersih: 60_000,
    },
    {
      id: 'JOURNEY-2-REPORT',
      employeeId: 'E1',
      jobCategory: 'SOPIR',
      activityDate: '2026-08-10',
      status: 'approved',
      fee: 80_000,
      upahBersih: 80_000,
    },
  ];

  assert.equal(sumApprovedActivitySpj(reports, 'E1', 'SOPIR', '2026-08'), 140_000);
});

test('activity index identity keeps same-day journeys distinct by time or activity', () => {
  const first = buildPekaryaActivityIdentity(
    'driver/1',
    '2026-08-10',
    '08:00',
    '10:00',
    'Antar tamu',
  );
  const differentTime = buildPekaryaActivityIdentity(
    'driver/1',
    '2026-08-10',
    '11:00',
    '13:00',
    'Antar tamu',
  );
  const differentActivity = buildPekaryaActivityIdentity(
    'driver/1',
    '2026-08-10',
    '08:00',
    '10:00',
    'Ambil dokumen',
  );

  assert.equal(first, 'driver_1__20260810__0800__1000__antar_tamu');
  assert.notEqual(first, differentTime);
  assert.notEqual(first, differentActivity);
});

test('personal Satpam SPJ is payable while shift assignments stay separate', () => {
  const reports = [
    {
      id: 'SPJ-1',
      employeeId: 'E1',
      jobCategory: 'SATPAM',
      reportKind: 'satpam_spj',
      activityDate: '2026-08-03',
      status: 'approved',
      fee: 45_000,
    },
    {
      id: 'SHIFT-1',
      employeeId: 'E1',
      jobCategory: 'SATPAM',
      reportKind: 'satpam_shift_assignment',
      sourceOccurrenceId: 'team_1__20260803__pagi',
      activityDate: '2026-08-03',
      status: 'approved',
      fee: 12_500,
    },
  ];

  assert.equal(sumApprovedActivitySpj(reports, 'E1', 'SATPAM', '2026-08'), 45_000);
});

test('approved Satpam found items enter only the personal SPJ total', () => {
  const reports = [
    {
      id: 'found-wallet',
      employeeId: 'SAT-1',
      jobCategory: 'SATPAM',
      reportKind: 'satpam_found_item',
      activityDate: '2026-08-12',
      payrollPeriod: '2026-08',
      status: 'approved',
      fee: 7_500,
    },
  ];
  assert.equal(
    sumApprovedActivitySpj(reports, 'SAT-1', 'SATPAM', '2026-08'),
    7_500,
  );
});

test('found-item evidence and fee adjustment rules are bounded', () => {
  assert.doesNotThrow(() => assertSatpamFoundItemPhotoCount(1));
  assert.doesNotThrow(() => assertSatpamFoundItemPhotoCount(5));
  assert.throws(() => assertSatpamFoundItemPhotoCount(0), /1 sampai 5 foto/);
  assert.throws(() => assertSatpamFoundItemPhotoCount(6), /1 sampai 5 foto/);
  assert.equal(satpamFoundItemFeeNeedsAdjustmentReason(5_000), false);
  assert.equal(satpamFoundItemFeeNeedsAdjustmentReason(7_500), false);
});

test('legacy Satpam shift metadata never falls into the personal SPJ column', () => {
  const reports = [
    {
      id: 'LEGACY-SHIFT',
      employeeId: 'E1',
      jobCategory: 'SATPAM',
      activityDate: '2026-08-03',
      status: 'approved',
      shiftName: 'Pagi',
      shiftType: 'Harian',
      postName: 'Pos 1',
      fee: 12_500,
    },
  ];
  assert.equal(sumApprovedActivitySpj(reports, 'E1', 'SATPAM', '2026-08'), 0);
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

test('Vakasi Pekarya projections count once and voided projections stop paying', () => {
  const projection = {
    id: 'VAKASI_PEKARYA__EVENT_A__TEKNISI',
    sourceKind: 'vakasi_tambahan_pekarya',
    sourceVakasiEventId: 'EVENT_A',
    period: '2026-08',
    jobCategory: 'TEKNISI',
    status: 'approved',
    eventWorkers: { E1: { payGiven: 85_000 } },
  };
  assert.equal(
    sumApprovedEventSpj([projection, { ...projection }], 'E1', 'TEKNISI', '2026-08'),
    85_000,
  );
  assert.equal(
    sumApprovedEventSpj([{ ...projection, status: 'voided' }], 'E1', 'TEKNISI', '2026-08'),
    0,
  );
});

test('manual SPJ entry is limited to the July 2026 paper-based categories', () => {
  // Paper-based reporting: the Kepala Satker types the accumulated SPJ in.
  assert.equal(allowsManualSpjEntry('SOPIR', '2026-07'), true);
  assert.equal(allowsManualSpjEntry('SATPAM', '2026-07'), true);
  // Other categories were already reporting activities in that period.
  assert.equal(allowsManualSpjEntry('PEKARYA', '2026-07'), false);
  assert.equal(allowsManualSpjEntry('TEKNISI', '2026-07'), false);
  assert.equal(allowsManualSpjEntry('KEBERSIHAN', '2026-07'), false);
  assert.equal(allowsManualSpjEntry('KEBERSIHAN_PONTI', '2026-07'), false);
  // Neighbouring periods stay on the computed activity sum.
  assert.equal(allowsManualSpjEntry('SOPIR', '2026-06'), false);
  assert.equal(allowsManualSpjEntry('SOPIR', '2026-08'), false);
  assert.equal(allowsManualSpjEntry('SATPAM', '2026-08'), false);
  assert.equal(allowsManualSpjEntry('SATPAM', '2027-07'), false);
});

test('historical paper SPJ applies only to Khoirul Anam and Pribadi', () => {
  assert.equal(
    allowsHistoricalPaperSpjEntry('KEBERSIHAN', '2026-07', 'BC_053'),
    true,
  );
  assert.equal(
    allowsHistoricalPaperSpjEntry('KEBERSIHAN', '2026-07', 'BC_054'),
    true,
  );
  assert.equal(
    allowsHistoricalPaperSpjEntry('KEBERSIHAN', '2026-07', 'BC_052'),
    false,
  );
  assert.equal(
    allowsHistoricalPaperSpjEntry('KEBERSIHAN_PONTI', '2026-07', 'BC_053'),
    false,
  );
  assert.equal(
    allowsHistoricalPaperSpjEntry('KEBERSIHAN', '2026-08', 'BC_053'),
    false,
  );
});
