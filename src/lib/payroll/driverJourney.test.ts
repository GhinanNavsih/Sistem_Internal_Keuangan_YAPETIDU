import assert from 'node:assert/strict';
import test from 'node:test';
import {
  canonicalizeDriverJourneyTimeline,
  DEFAULT_DRIVER_JOURNEY_LOCATION,
  DEFAULT_DRIVER_JOURNEY_POINT,
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
  countDriverJourneyRouteDestinations,
  getMealAllowanceForDuration,
  getGrossMealAllowanceForDuration,
  getMealWageComponent,
  resolveMealAccountingMode,
  DRIVER_SHORT_TRIP_MEAL_ALLOWANCE,
  closeDriverJourneyRoundTrip,
  driverJourneyRoutePoints,
  driverJourneyRoutePoint,
  cashOperationalCostFromJourney,
  fuelProcurementModeLabel,
  journeyDayCount,
  MAX_DRIVER_JOURNEY_DESTINATIONS,
  MAX_DRIVER_JOURNEY_LOCATIONS,
  MAX_DRIVER_ROUTE_CALCULATION_POINTS,
  MAX_MAIN_DESTINATIONS,
  normalizeDriverJourneyDestinations,
  normalizeDriverJourneyLocation,
  resolveDriverJourneyPointLocations,
  normalizeDriverJourneyLocations,
  formatDurationHoursAsJamMenit,
} from './driverJourney';

test('fuel procurement modes have human-readable UI labels', () => {
  assert.equal(fuelProcurementModeLabel('standard_direct'), 'Standard langsung');
  assert.equal(fuelProcurementModeLabel('hold_accumulate'), 'Tahan & akumulasi');
  assert.equal(fuelProcurementModeLabel('procure_release'), 'Cairkan saldo');
  assert.equal(fuelProcurementModeLabel('unknown_mode'), 'Mode pengadaan BBM');
});

test('journey destinations preserve order and support legacy endPoint documents', () => {
  assert.deepEqual(
    normalizeDriverJourneyDestinations(['  Tujuan A  ', 'Tujuan B']),
    ['Tujuan A', 'Tujuan B'],
  );
  assert.deepEqual(
    normalizeDriverJourneyDestinations(undefined, 'Tujuan Lama'),
    ['Tujuan Lama'],
  );
  assert.deepEqual(
    normalizeDriverJourneyDestinations([], 'Tujuan Lama'),
    ['Tujuan Lama'],
  );
});

test('journey route points retain an editable start and return leg', () => {
  assert.deepEqual(
    driverJourneyRoutePoints('', ['Tujuan A', 'Tujuan B']),
    [DEFAULT_DRIVER_JOURNEY_POINT, 'Tujuan A', 'Tujuan B', DEFAULT_DRIVER_JOURNEY_POINT],
  );
  assert.deepEqual(
    driverJourneyRoutePoints('Titik Baru', ['Tujuan A', 'Tujuan B'], undefined, false),
    ['Titik Baru', 'Tujuan A', 'Tujuan B'],
  );
});

test('a single-stop payable route measures the real return leg instead of doubling outbound', () => {
  assert.deepEqual(
    closeDriverJourneyRoundTrip(['UNIPDU', 'RSUD Jombang']),
    ['UNIPDU', 'RSUD Jombang', 'UNIPDU'],
  );
  assert.deepEqual(
    closeDriverJourneyRoundTrip(['UNIPDU', 'RSUD Jombang', 'UNIPDU']),
    ['UNIPDU', 'RSUD Jombang', 'UNIPDU'],
  );
});

test('25 destinations leave room for the departure and generated return points', () => {
  const locations = Array.from(
    { length: MAX_DRIVER_JOURNEY_LOCATIONS },
    (_, index) => `Lokasi ${index + 1}`,
  );
  const routePoints = closeDriverJourneyRoundTrip(locations);

  assert.equal(MAX_DRIVER_JOURNEY_DESTINATIONS, 25);
  assert.equal(MAX_DRIVER_JOURNEY_LOCATIONS, 26);
  assert.equal(routePoints.length, MAX_DRIVER_ROUTE_CALCULATION_POINTS);
  assert.equal(countDriverJourneyRouteDestinations(routePoints), 25);
  assert.equal(countDriverJourneyRouteDestinations([...locations, 'Lokasi 27']), 26);
  assert.equal(routePoints[routePoints.length - 1], locations[0]);
});

test('journey locations retain validated addresses and coordinates for route reuse', () => {
  assert.deepEqual(
    normalizeDriverJourneyLocation(
      { address: 'RSUD Jombang', latitude: -7.5462, longitude: 112.2331 },
      'RSUD Jombang',
    ),
    { address: 'RSUD Jombang', latitude: -7.5462, longitude: 112.2331 },
  );
  assert.equal(
    normalizeDriverJourneyLocation(
      { address: 'Alamat Lama', latitude: -7.5, longitude: 112.2 },
      'Alamat Baru',
    ),
    null,
  );
  assert.equal(
    normalizeDriverJourneyLocation(
      { address: 'Lokasi Rusak', latitude: 91, longitude: 112.2 },
      'Lokasi Rusak',
    ),
    null,
  );
  assert.deepEqual(
    normalizeDriverJourneyLocations(
      [{ address: 'A', latitude: -7.1, longitude: 112.1 }, null],
      ['A', 'B'],
    ),
    [{ address: 'A', latitude: -7.1, longitude: 112.1 }, null],
  );
  assert.equal(
    driverJourneyRoutePoint('RSUD Jombang', {
      address: 'RSUD Jombang',
      latitude: -7.5462,
      longitude: 112.2331,
    }),
    '-7.546200,112.233100',
  );
  assert.equal(driverJourneyRoutePoint('Alamat saja'), 'Alamat saja');
  assert.equal(
    driverJourneyRoutePoint(
      DEFAULT_DRIVER_JOURNEY_POINT,
      DEFAULT_DRIVER_JOURNEY_LOCATION,
    ),
    '-7.545800,112.285800',
  );
});

test('ad hoc stops keep the coordinates the sopir picked when a route is re-measured', () => {
  const authorized = { address: 'RSUD Jombang', latitude: -7.5462, longitude: 112.2331 };
  const adHoc = { address: 'SPBU Peterongan', latitude: -7.5501, longitude: 112.2707 };

  // `points` carries the ad hoc stop, but `mainDestinations` covers only the
  // pre-authorized one — the ad hoc coordinate lives solely in the stop log.
  const resolved = resolveDriverJourneyPointLocations({
    points: [DEFAULT_DRIVER_JOURNEY_POINT, 'RSUD Jombang', 'SPBU Peterongan'],
    startPoint: DEFAULT_DRIVER_JOURNEY_POINT,
    startPointLocation: DEFAULT_DRIVER_JOURNEY_LOCATION,
    mainDestinations: ['RSUD Jombang'],
    mainDestinationLocations: [authorized],
    extraActivities: [
      { type: 'tambah_lokasi', destination: 'SPBU Peterongan', destinationLocation: adHoc },
    ],
  });

  assert.deepEqual(resolved, [DEFAULT_DRIVER_JOURNEY_LOCATION, authorized, adHoc]);
  // Without the stop-log fallback this degraded to bare address text, which
  // Google re-geocodes to a possibly different place than the sopir picked.
  assert.equal(driverJourneyRoutePoint('SPBU Peterongan', resolved[2]), '-7.550100,112.270700');
});

test('route coordinates survive past MAX_MAIN_DESTINATIONS and fall back per stop', () => {
  const destinations = Array.from({ length: MAX_MAIN_DESTINATIONS + 2 }, (_, i) => `Tujuan ${i + 1}`);
  const locations = destinations.map((address, i) => ({
    address,
    latitude: -7.5 - i / 1000,
    longitude: 112.2 + i / 1000,
  }));

  const resolved = resolveDriverJourneyPointLocations({
    points: [DEFAULT_DRIVER_JOURNEY_POINT, ...destinations],
    startPoint: DEFAULT_DRIVER_JOURNEY_POINT,
    startPointLocation: DEFAULT_DRIVER_JOURNEY_LOCATION,
    mainDestinations: destinations,
    mainDestinationLocations: locations,
  });

  assert.equal(resolved.length, destinations.length + 1);
  // The stop past the cap used to resolve to null because the lookup was built
  // through `normalizeDriverJourneyDestinations`, which slices at the cap.
  assert.deepEqual(resolved[MAX_MAIN_DESTINATIONS + 2], locations[MAX_MAIN_DESTINATIONS + 1]);

  // A stored authorized coordinate that fails validation still falls back to
  // the sopir's log rather than degrading to address text.
  const repaired = resolveDriverJourneyPointLocations({
    points: [DEFAULT_DRIVER_JOURNEY_POINT, 'Tujuan 1'],
    mainDestinations: ['Tujuan 1'],
    mainDestinationLocations: [{ address: 'Alamat Lain', latitude: -7.5, longitude: 112.2 }],
    extraActivities: [
      {
        type: 'tambah_lokasi',
        destination: 'Tujuan 1',
        destinationLocation: { address: 'Tujuan 1', latitude: -7.51, longitude: 112.21 },
      },
    ],
  });
  assert.deepEqual(repaired[1], { address: 'Tujuan 1', latitude: -7.51, longitude: 112.21 });

  // Non-location entries in the stop log are ignored.
  assert.deepEqual(
    resolveDriverJourneyPointLocations({
      points: [DEFAULT_DRIVER_JOURNEY_POINT, 'Tanpa Koordinat'],
      extraActivities: [{ type: 'tambah_kegiatan', destination: 'Tanpa Koordinat' }],
    })[1],
    null,
  );
});

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
    mealAccountingMode: 'legacy_reimbursement',
    effectiveFuelAllowance: 0,
    heldFuelAmount: 0,
    procuredAccumulatedAmount: 0,
    totalFuelAllocation: 0,
    mealAllowance: 0,
    grossMealAllowance: 20_000,
    tollParkingFee: 15_000,
    totalOperationalCost: 15_000,
  });

  const suzuki = calculateDriverJourneyOperationalCosts(10, 6, 'Suzuki XL7', 15_000);
  assert.deepEqual(suzuki, {
    vehicleName: 'Suzuki XL7',
    vehicleRate: 1_000,
    baseOperationalCost: 20_000,
    fuelProcurementMode: 'standard_direct',
    mealAccountingMode: 'legacy_reimbursement',
    effectiveFuelAllowance: 20_000,
    heldFuelAmount: 0,
    procuredAccumulatedAmount: 0,
    totalFuelAllocation: 20_000,
    mealAllowance: 20_000,
    grossMealAllowance: 20_000,
    tollParkingFee: 15_000,
    totalOperationalCost: 55_000,
  });
});

test('gross meal accounting keeps meal out of the operational budget entirely', () => {
  const gross = calculateDriverJourneyOperationalCosts(
    10,
    6,
    'Suzuki XL7',
    15_000,
    { mealAccountingMode: 'upah_bersih_gross' },
  );

  // Meal is paid in Upah Bersih now, so it is no longer a cash advance: the
  // budget is fuel + toll only, while the entitlement stays visible.
  assert.equal(gross.mealAllowance, 0);
  assert.equal(gross.grossMealAllowance, 20_000);
  assert.equal(gross.totalOperationalCost, 35_000);
  assert.equal(cashOperationalCostFromJourney(gross), 35_000);

  // Ndalem earns the same entitlement rather than being zeroed out.
  const ndalemGross = calculateDriverJourneyOperationalCosts(
    10,
    6,
    'Ndalem',
    0,
    { mealAccountingMode: 'upah_bersih_gross' },
  );
  assert.equal(ndalemGross.grossMealAllowance, 20_000);
  assert.equal(ndalemGross.totalOperationalCost, 0);
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
  assert.equal(hold.totalFuelAllocation, 0);
  assert.equal(hold.totalOperationalCost, 20_000);

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

test('cash operational cost excludes held fuel from legacy journey totals', () => {
  assert.equal(
    cashOperationalCostFromJourney({
      totalOperationalCost: 328_120,
      fuelProcurementMode: 'hold_accumulate',
      mealAllowance: 20_000,
      preAuthorizedToll: 89_000,
      heldFuelAmount: 219_120,
    }),
    109_000,
  );
  assert.equal(
    cashOperationalCostFromJourney({
      totalOperationalCost: 328_120,
      fuelProcurementMode: 'standard_direct',
    }),
    328_120,
  );
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

test('gross meal entitlement ignores money already handed over, for every vehicle', () => {
  // Same tiers as the legacy right...
  assert.equal(getGrossMealAllowanceForDuration(0), 0);
  assert.equal(getGrossMealAllowanceForDuration(2), 0);
  assert.equal(getGrossMealAllowanceForDuration(2.01), 20_000);
  assert.equal(getGrossMealAllowanceForDuration(6), 20_000);
  assert.equal(getGrossMealAllowanceForDuration(6.01), 40_000);
  assert.equal(getGrossMealAllowanceForDuration(12), 40_000);
  assert.equal(getGrossMealAllowanceForDuration(12.01), 60_000);
  assert.equal(getGrossMealAllowanceForDuration(24), 60_000);
  assert.equal(getGrossMealAllowanceForDuration(30), 80_000);
  assert.equal(getGrossMealAllowanceForDuration(54), 140_000);

  // ...but it is gross: money received during the trip is reporting only and
  // never nets off the entitlement, and no vehicle is excluded.
  assert.equal(getMealWageComponent(12, 'upah_bersih_gross'), 40_000);
  assert.equal(getMealWageComponent(12, 'legacy_reimbursement'), 0);
});

test('meal accounting mode falls back by whether a record was already paid', () => {
  // An explicit stamp always wins so an approved record keeps its treatment.
  assert.equal(resolveMealAccountingMode('legacy_reimbursement'), 'legacy_reimbursement');
  assert.equal(
    resolveMealAccountingMode('legacy_reimbursement', { alreadyApproved: false }),
    'legacy_reimbursement',
  );
  assert.equal(resolveMealAccountingMode('upah_bersih_gross', { alreadyApproved: true }), 'upah_bersih_gross');

  // Unstamped: already-approved records are historical, pending ones settle
  // under current policy when they are approved.
  assert.equal(resolveMealAccountingMode(undefined, { alreadyApproved: true }), 'legacy_reimbursement');
  assert.equal(resolveMealAccountingMode(undefined, { alreadyApproved: false }), 'upah_bersih_gross');
  assert.equal(resolveMealAccountingMode(undefined), 'upah_bersih_gross');
  assert.equal(resolveMealAccountingMode('nonsense', { alreadyApproved: true }), 'legacy_reimbursement');
});

test('gross meal is added to Upah Bersih without duplicating the short-trip component', () => {
  const base = { distanceKm: 10, travelTimeHours: 1, nightCount: 0 } as const;

  // A 6-hour trip: tier pays 20.000, short-trip component pays nothing.
  const legacySixHours = calculateDriverNetWage({ ...base, elapsedDurationHours: 6 });
  const grossSixHours = calculateDriverNetWage({
    ...base,
    elapsedDurationHours: 6,
    mealAccountingMode: 'upah_bersih_gross',
  });
  assert.equal(grossSixHours - legacySixHours, 20_000);

  // A 2-hour trip sits in the tier that pays nothing, which is exactly the gap
  // the flat Rp 5.000 short-trip component fills — so gross mode adds nothing
  // on top and the Rp 5.000 is still paid exactly once.
  const legacyTwoHours = calculateDriverNetWage({ ...base, elapsedDurationHours: 2 });
  const grossTwoHours = calculateDriverNetWage({
    ...base,
    elapsedDurationHours: 2,
    mealAccountingMode: 'upah_bersih_gross',
  });
  assert.equal(grossTwoHours, legacyTwoHours);
  assert.equal(grossTwoHours - Math.ceil(10 * 300) - Math.ceil(1 * 5_000), DRIVER_SHORT_TRIP_MEAL_ALLOWANCE);

  // A 26-hour trip earns a full day (60.000) plus the Rp 5.000 for its 2-hour
  // remainder: different hours, so both legitimately apply.
  const grossOvernight = calculateDriverNetWage({
    ...base,
    elapsedDurationHours: 26,
    nightCount: 1,
    mealAccountingMode: 'upah_bersih_gross',
  });
  const legacyOvernight = calculateDriverNetWage({ ...base, elapsedDurationHours: 26, nightCount: 1 });
  assert.equal(grossOvernight - legacyOvernight, 60_000);

  // Omitting the mode reproduces the historical figure exactly.
  assert.equal(calculateDriverNetWage({ ...base, elapsedDurationHours: 6 }), legacySixHours);
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
  assert.equal(
    calculateDriverNetWage({
      distanceKm: 100,
      travelTimeHours: 30,
      elapsedDurationHours: 30,
      nightCount: 2,
    }),
    280_000,
  );
  assert.throws(() => calculateNightPremium(-1));
  assert.throws(() => calculateNightPremium(1.5));
});

test('driver net wage charges Komponen Waktu from travel time, not elapsed clock time', () => {
  // Travel time (Directions leg sum) is short enough to skip the short-trip meal
  // component, but elapsed clock time (waiting at stops included) is what decides
  // that component, per the uang makan strata rule.
  const wage = calculateDriverNetWage({
    distanceKm: 50,
    travelTimeHours: 3,
    elapsedDurationHours: 8,
    nightCount: 0,
  });
  // (50 * 300) + (3 * 5000) = 15000 + 15000 = 30000. No short-trip meal component
  // since elapsedDurationHours (8h) is above the <=2h threshold.
  assert.equal(wage, 30_000);

  const shortElapsedWage = calculateDriverNetWage({
    distanceKm: 50,
    travelTimeHours: 3,
    elapsedDurationHours: 2,
    nightCount: 0,
  });
  // Same distance/travel time, but elapsedDurationHours <= 2h now adds the flat
  // Rp 5.000 short-trip meal component: 15000 + 15000 + 5000 = 35000.
  assert.equal(shortElapsedWage, 35_000);
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
  const wage = calculateDriverNetWage({
    distanceKm: 173.4,
    travelTimeHours: result.durationHours,
    elapsedDurationHours: result.durationHours,
    nightCount: result.nightCount,
  });
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

test('a stale isMultiDay flag on same-day dates never invents a premium malam', () => {
  // The submit path stores `isMultiDay: true` with an unchanged end date
  // whenever the sopir leaves the toggle on, and scores it as zero nights.
  // Advancing dateEnd off that flag made an evening errand audit as a
  // 25.4-hour lintas-hari journey worth a phantom Rp 50.000, so the audit
  // dialog disagreed with the stored figure the review table shows.
  const staleFlag = calculateEditableDriverJourneyTimeline({
    dateStart: '2026-08-23',
    dateEnd: '2026-08-23',
    timeStart: '19:50',
    timeEnd: '21:15',
    isMultiDay: true,
  });
  assert.equal(staleFlag.isMultiDay, false);
  assert.equal(staleFlag.dateEnd, '2026-08-23');
  assert.equal(staleFlag.nightCount, 0);
  assert.equal(calculateNightPremium(staleFlag.nightCount), 0);
  assert.ok(Math.abs(staleFlag.durationHours - 85 / 60) < 1e-9);

  // The submit path and the audit path must agree on that same record.
  const submitted = calculateJourneyDateTimeTimings({
    dateStart: '2026-08-23',
    dateEnd: '2026-08-23',
    timeStart: '19:50',
    timeEnd: '21:15',
    isMultiDay: true,
  });
  assert.equal(staleFlag.nightCount, submitted.nightCount);
  assert.equal(staleFlag.durationHours, submitted.durationHours);

  // A flag left on must still not survive when the dates really are the same.
  const staleAcrossDays = calculateEditableDriverJourneyTimeline({
    dateStart: '2026-08-23',
    dateEnd: '2026-08-25',
    timeStart: '19:50',
    timeEnd: '21:15',
    isMultiDay: true,
  });
  assert.equal(staleAcrossDays.isMultiDay, true);
  assert.equal(staleAcrossDays.nightCount, 2);
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

test('formatDurationHoursAsJamMenit spells out hours and minutes instead of decimal hours', () => {
  assert.equal(formatDurationHoursAsJamMenit(2.6), '2j 36m');
  assert.equal(formatDurationHoursAsJamMenit(0.2), '0j 12m');
  assert.equal(formatDurationHoursAsJamMenit(2), '2j 00m');
  assert.equal(formatDurationHoursAsJamMenit(0), '0j 00m');
  // Rounds to the nearest minute rather than truncating.
  assert.equal(formatDurationHoursAsJamMenit(0.3591666666666667), '0j 22m');
  // 59.6 minutes rounds up into the next hour, not "1j 60m".
  assert.equal(formatDurationHoursAsJamMenit(1.993), '2j 00m');
  assert.equal(formatDurationHoursAsJamMenit(-1), '0j 00m');
});
