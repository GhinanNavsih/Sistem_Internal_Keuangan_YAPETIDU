import assert from 'node:assert/strict';
import test from 'node:test';
import {
  DRIVER_VEHICLE_RATES,
  calculateDriverNetWage,
  calculateJourneyElapsedHours,
  calculateJourneyDateTimeTimings,
  calculateNightPremium,
  getMealAllowanceForDuration,
  journeyDayCount,
} from './driverJourney';

test('vehicle rates stay centralized for authorization and review calculations', () => {
  assert.equal(DRIVER_VEHICLE_RATES.Bis, 2_500);
  assert.equal(DRIVER_VEHICLE_RATES['Suzuki XL7'], 1_000);
  assert.equal(DRIVER_VEHICLE_RATES.Ndalem, 0);
});

test('meal allowance supports 24-hour cycles and partial-day strata', () => {
  assert.equal(getMealAllowanceForDuration(0), 0);
  assert.equal(getMealAllowanceForDuration(1), 0);
  assert.equal(getMealAllowanceForDuration(2), 0);
  assert.equal(getMealAllowanceForDuration(2.01), 20_000);
  assert.equal(getMealAllowanceForDuration(6), 20_000);
  assert.equal(getMealAllowanceForDuration(6.01), 40_000);
  assert.equal(getMealAllowanceForDuration(12), 40_000);
  assert.equal(getMealAllowanceForDuration(12.01), 60_000);
  assert.equal(getMealAllowanceForDuration(24), 60_000);
  assert.equal(getMealAllowanceForDuration(30), 80_000);
  assert.equal(getMealAllowanceForDuration(54), 140_000);
});

test('Ndalem vehicle calculates meal allowance rights and unpaid meal delta from Rupiah money received', () => {
  // Default (Rp 0 provided by Ndalem):
  assert.equal(getMealAllowanceForDuration(6, 'Ndalem'), 20_000); // Rp 20.000 right - 0 = Rp 20.000
  assert.equal(getMealAllowanceForDuration(12, 'Ndalem'), 40_000); // Rp 40.000 right - 0 = Rp 40.000
  assert.equal(getMealAllowanceForDuration(24, 'Ndalem'), 60_000); // Rp 60.000 right - 0 = Rp 60.000

  // Partial or full money provided by Ndalem (Rupiah input):
  assert.equal(getMealAllowanceForDuration(12, 'Ndalem', 15_000), 25_000); // Rp 40.000 right - Rp 15.000 = Rp 25.000
  assert.equal(getMealAllowanceForDuration(12, 'Ndalem', 40_000), 0); // Rp 40.000 right - Rp 40.000 = Rp 0
  assert.equal(getMealAllowanceForDuration(24, 'Ndalem', 50_000), 10_000); // Rp 60.000 right - Rp 50.000 = Rp 10.000
  assert.equal(getMealAllowanceForDuration(24, 'Ndalem', 70_000), 0); // Rp 60.000 right - Rp 70.000 = Rp 0 (no negative delta)
});

test('night premium and driver net wage use quantitative night count', () => {
  assert.equal(calculateNightPremium(0), 0);
  assert.equal(calculateNightPremium(3), 150_000);
  assert.equal(calculateDriverNetWage(100, 30, 2), 280_000);
  assert.throws(() => calculateNightPremium(-1));
  assert.throws(() => calculateNightPremium(1.5));
});

test('journey day count rounds partial 24-hour cycles up', () => {
  assert.equal(journeyDayCount(0), 0);
  assert.equal(journeyDayCount(6), 1);
  assert.equal(journeyDayCount(24), 1);
  assert.equal(journeyDayCount(24.1), 2);
  assert.equal(journeyDayCount(54), 3);
});

test('elapsed journey hours include every selected night', () => {
  assert.equal(calculateJourneyElapsedHours('08:00', '14:00', 0), 6);
  assert.equal(calculateJourneyElapsedHours('08:00', '14:00', 1), 30);
  assert.equal(calculateJourneyElapsedHours('08:00', '14:00', 2), 54);
  assert.equal(calculateJourneyElapsedHours('22:00', '08:00', 1), 10);
  assert.equal(calculateJourneyElapsedHours('22:00', '08:00', 0), 10);
});

test('calculateJourneyDateTimeTimings enforces 05:00 AM cutoff threshold for overnight nightCount', () => {
  // Arriving next day at 02:30 AM (before 05:00 AM) -> 0 nights
  const pre5AM = calculateJourneyDateTimeTimings({
    dateStart: '2026-07-25',
    timeStart: '20:00',
    dateEnd: '2026-07-26',
    timeEnd: '02:30',
    isMultiDay: false,
  });
  assert.equal(pre5AM.durationHours, 6.5);
  assert.equal(pre5AM.nightCount, 0);

  // Arriving next day at 05:00 AM -> 1 night (+Rp 50.000)
  const at5AM = calculateJourneyDateTimeTimings({
    dateStart: '2026-07-25',
    timeStart: '20:00',
    dateEnd: '2026-07-26',
    timeEnd: '05:00',
    isMultiDay: false,
  });
  assert.equal(at5AM.durationHours, 9);
  assert.equal(at5AM.nightCount, 1);

  // Arriving next day at 10:00 AM -> 1 night (+Rp 50.000)
  const result = calculateJourneyDateTimeTimings({
    dateStart: '2026-07-25',
    timeStart: '08:00',
    dateEnd: '2026-07-26',
    timeEnd: '10:00',
    isMultiDay: false,
  });

  assert.equal(result.durationHours, 26);
  assert.equal(result.nightCount, 1);
  const wage = calculateDriverNetWage(173.4, result.durationHours, result.nightCount);
  // (173.4 * 300) + (26 * 5000) + (1 * 50000) + (5000 short trip meal) = 52020 + 130000 + 50000 + 5000 = 237020
  assert.equal(wage, 237_020);
});
