import assert from 'node:assert/strict';
import test from 'node:test';
import {
  canonicalizeDriverJourneyTimeline,
  DEFAULT_DRIVER_VEHICLE_NAME,
  DRIVER_VEHICLE_RATES,
  calculateDriverJourneyOperationalCosts,
  calculateDriverReimbursementSettlement,
  calculateEffectiveFuelAllowance,
  calculateDriverNetWage,
  calculateEstimatedDriverWage,
  calculateEditableDriverJourneyTimeline,
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
  assert.equal(DEFAULT_DRIVER_VEHICLE_NAME, 'Ndalem');
});

test('authorized journey operational costs use the same baseline for every authorization path', () => {
  const ndalem = calculateDriverJourneyOperationalCosts(10, 6, 'Ndalem', 15_000);
  assert.deepEqual(ndalem, {
    vehicleName: 'Ndalem',
    vehicleRate: 0,
    baseOperationalCost: 0,
    fuelProcurementMode: 'standard_direct',
    effectiveFuelAllowance: 0,
    heldFuelAmount: 0,
    procuredAccumulatedAmount: 0,
    totalFuelAllocation: 0,
    mealAllowance: 0,
    tollParkingFee: 15_000,
    totalOperationalCost: 15_000,
  });

  const suzuki = calculateDriverJourneyOperationalCosts(10, 6, 'Suzuki XL7', 15_000);
  assert.deepEqual(suzuki, {
    vehicleName: 'Suzuki XL7',
    vehicleRate: 1_000,
    baseOperationalCost: 20_000,
    fuelProcurementMode: 'standard_direct',
    effectiveFuelAllowance: 20_000,
    heldFuelAmount: 0,
    procuredAccumulatedAmount: 0,
    totalFuelAllocation: 20_000,
    mealAllowance: 20_000,
    tollParkingFee: 15_000,
    totalOperationalCost: 55_000,
  });
});

test('fuel modes calculate allocation and settlement independently', () => {
  const hold = calculateDriverJourneyOperationalCosts(
    10,
    6,
    'Suzuki XL7',
    0,
    { fuelProcurementMode: 'hold_accumulate' },
  );
  assert.equal(hold.baseOperationalCost, 20_000);
  assert.equal(hold.effectiveFuelAllowance, 0);
  assert.equal(hold.heldFuelAmount, 20_000);
  assert.equal(hold.totalFuelAllocation, 20_000);
  assert.equal(hold.totalOperationalCost, 40_000);

  const procure = calculateDriverJourneyOperationalCosts(
    10,
    6,
    'Suzuki XL7',
    0,
    { fuelProcurementMode: 'procure_release', procuredAccumulatedAmount: 35_000 },
  );
  assert.equal(procure.effectiveFuelAllowance, 55_000);
  assert.equal(procure.heldFuelAmount, 0);
  assert.equal(procure.totalFuelAllocation, 55_000);

  assert.equal(calculateEffectiveFuelAllowance(20_000, 'hold_accumulate'), 0);
  assert.equal(calculateEffectiveFuelAllowance(20_000, 'procure_release', 35_000), 55_000);
  assert.equal(calculateEffectiveFuelAllowance(20_000), 20_000);

  const holdSettlement = calculateDriverReimbursementSettlement({
    fuelAllowance: 20_000,
    fuelSpent: 0,
    tollAllowance: 0,
    tollSpent: 0,
    fuelProcurementMode: 'hold_accumulate',
  });
  assert.equal(holdSettlement.effectiveFuelAllowance, 0);
  assert.equal(holdSettlement.fuelDelta, 0);
  assert.equal(holdSettlement.totalPreAuthorizedAllowance, 0);

  const procureSettlement = calculateDriverReimbursementSettlement({
    fuelAllowance: 20_000,
    fuelSpent: 50_000,
    tollAllowance: 0,
    tollSpent: 0,
    fuelProcurementMode: 'procure_release',
    procuredAccumulatedAmount: 35_000,
  });
  assert.equal(procureSettlement.effectiveFuelAllowance, 55_000);
  assert.equal(procureSettlement.fuelDelta, -5_000);
});

test('accumulation modes are rejected for Ndalem', () => {
  assert.throws(() => calculateDriverJourneyOperationalCosts(
    10,
    6,
    'Ndalem',
    0,
    { fuelProcurementMode: 'hold_accumulate' },
  ));
});

test('fuel savings offset toll and parking overage before reimbursement is paid', () => {
  const settlement = calculateDriverReimbursementSettlement({
    fuelAllowance: 170_200,
    fuelSpent: 150_000,
    tollAllowance: 0,
    tollSpent: 30_000,
  });

  assert.equal(settlement.fuelAllowanceSurplus, 20_200);
  assert.equal(settlement.extraTollCost, 30_000);
  assert.equal(settlement.netOperationalDelta, 9_800);
  assert.equal(settlement.reimburseDelta, 9_800);
  assert.equal(settlement.remainingUnspentCash, 0);
});

test('toll and parking savings offset fuel overage before reimbursement is paid', () => {
  const settlement = calculateDriverReimbursementSettlement({
    fuelAllowance: 0,
    fuelSpent: 30_000,
    tollAllowance: 100_000,
    tollSpent: 80_000,
  });

  assert.equal(settlement.extraFuelCost, 30_000);
  assert.equal(settlement.tollAllowanceSurplus, 20_000);
  assert.equal(settlement.reimburseDelta, 10_000);
  assert.equal(settlement.remainingUnspentCash, 0);
});

test('remaining net allowance is deducted from the driver wage', () => {
  const settlement = calculateDriverReimbursementSettlement({
    fuelAllowance: 170_200,
    fuelSpent: 100_000,
    tollAllowance: 0,
    tollSpent: 30_000,
  });

  assert.equal(settlement.netOperationalDelta, -40_200);
  assert.equal(settlement.reimburseDelta, 0);
  assert.equal(settlement.unspentCash, 40_200);
  assert.equal(settlement.remainingUnspentCash, 40_200);
  assert.equal(Math.max(0, 79_050 - settlement.remainingUnspentCash), 38_850);
});

test('additional reimbursement can consume allowance surplus before wage deduction', () => {
  const settlement = calculateDriverReimbursementSettlement({
    fuelAllowance: 100,
    fuelSpent: 50,
    tollAllowance: 0,
    tollSpent: 0,
    additionalReimbursement: 30,
  });

  assert.equal(settlement.reimburseDelta, 0);
  assert.equal(settlement.remainingUnspentCash, 20);

  const reimbursementRemains = calculateDriverReimbursementSettlement({
    fuelAllowance: 100,
    fuelSpent: 50,
    tollAllowance: 0,
    tollSpent: 0,
    additionalReimbursement: 60,
  });
  assert.equal(reimbursementRemains.reimburseDelta, 10);
  assert.equal(reimbursementRemains.remainingUnspentCash, 0);
});

test('settlement rejects invalid negative or non-finite money values', () => {
  assert.throws(() => calculateDriverReimbursementSettlement({
    fuelAllowance: -1,
    fuelSpent: 0,
    tollAllowance: 0,
    tollSpent: 0,
  }));
  assert.throws(() => calculateDriverReimbursementSettlement({
    fuelAllowance: 0,
    fuelSpent: Number.NaN,
    tollAllowance: 0,
    tollSpent: 0,
  }));
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

test('all vehicle types subtract meal money already provided from the meal right', () => {
  assert.equal(getMealAllowanceForDuration(12, 'Suzuki XL7', 15_000), 25_000);
  assert.equal(getMealAllowanceForDuration(12, 'Bis', 40_000), 0);
  assert.equal(getMealAllowanceForDuration(24, 'Elf', 50_000), 10_000);
  assert.equal(getMealAllowanceForDuration(24, 'Innova Matic', 70_000), 0);
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

test('editable audit timeline infers overnight journeys from edited times', () => {
  const overnight = calculateEditableDriverJourneyTimeline({
    dateStart: '2026-08-04',
    timeStart: '20:00',
    timeEnd: '05:00',
  });
  assert.equal(overnight.isMultiDay, true);
  assert.equal(overnight.dateEnd, '2026-08-05');
  assert.equal(overnight.durationHours, 9);
  assert.equal(overnight.nightCount, 1);
  assert.equal(getMealAllowanceForDuration(overnight.durationHours, 'Suzuki XL7'), 40_000);
  assert.equal(calculateNightPremium(overnight.nightCount), 50_000);

  const beforeCutoff = calculateEditableDriverJourneyTimeline({
    dateStart: '2026-08-04',
    timeStart: '20:00',
    timeEnd: '02:00',
  });
  assert.equal(beforeCutoff.isMultiDay, true);
  assert.equal(beforeCutoff.durationHours, 6);
  assert.equal(beforeCutoff.nightCount, 0);

  const sameDay = calculateEditableDriverJourneyTimeline({
    dateStart: '2026-08-04',
    timeStart: '08:00',
    timeEnd: '17:00',
  });
  assert.equal(sameDay.isMultiDay, false);
  assert.equal(sameDay.durationHours, 9);
  assert.equal(sameDay.nightCount, 0);
});

test('canonicalizeDriverJourneyTimeline clears stale overnight data for a single-day journey', () => {
  assert.deepEqual(
    canonicalizeDriverJourneyTimeline({
      activityDate: '2026-08-03',
      dateStart: '2026-08-03',
      dateEnd: '2026-08-04',
      isMultiDay: false,
      nightCount: 1,
    }),
    {
      dateStart: '2026-08-03',
      dateEnd: '2026-08-03',
      isMultiDay: false,
      nightCount: 0,
      nightPremium: 0,
    },
  );
});

test('calculateEstimatedDriverWage includes short-trip meal allowance when duration PP <= 2 hours', () => {
  // 9.2 km PP, 0.2 hours PP (12 min)
  const estShort = calculateEstimatedDriverWage(9.2, 0.2);
  assert.equal(estShort.compJarak, 2_760);
  assert.equal(estShort.compWaktu, 1_000);
  assert.equal(estShort.shortTripMeal, 5_000);
  assert.equal(estShort.baseWage, 8_760); // 2760 + 1000 + 5000
  assert.equal(estShort.maxWage, 10_950); // 8760 * 1.25

  // 10 km PP, 3 hours PP (over 2 hours -> shortTripMeal = 0)
  const estLong = calculateEstimatedDriverWage(10, 3);
  assert.equal(estLong.compJarak, 3_000);
  assert.equal(estLong.compWaktu, 15_000);
  assert.equal(estLong.shortTripMeal, 0);
  assert.equal(estLong.baseWage, 18_000);
  assert.equal(estLong.maxWage, 22_500);
});
