import assert from 'node:assert/strict';
import test from 'node:test';
import {
  calculateDriverNetWage,
  calculateJourneyElapsedHours,
  calculateNightPremium,
  getMealAllowanceForDuration,
  journeyDayCount,
} from './driverJourney';

test('meal allowance supports 24-hour cycles and partial-day strata', () => {
  assert.equal(getMealAllowanceForDuration(0), 0);
  assert.equal(getMealAllowanceForDuration(1), 5_000);
  assert.equal(getMealAllowanceForDuration(2), 20_000);
  assert.equal(getMealAllowanceForDuration(6), 20_000);
  assert.equal(getMealAllowanceForDuration(6.01), 40_000);
  assert.equal(getMealAllowanceForDuration(12), 40_000);
  assert.equal(getMealAllowanceForDuration(12.01), 60_000);
  assert.equal(getMealAllowanceForDuration(24), 60_000);
  assert.equal(getMealAllowanceForDuration(30), 80_000);
  assert.equal(getMealAllowanceForDuration(54), 140_000);
});

test('Ndalem vehicle is always exempt from meal allowance', () => {
  assert.equal(getMealAllowanceForDuration(6, 'Ndalem'), 0);
  assert.equal(getMealAllowanceForDuration(54, 'Ndalem'), 0);
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
  assert.throws(() => calculateJourneyElapsedHours('22:00', '08:00', 0));
});
