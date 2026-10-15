import assert from 'node:assert/strict';
import test from 'node:test';
import { journeyFormFromResult } from '@/components/driver-simulation/simulationForm';
import {
  calculateSimulation,
  calculateSimulationJourney,
  initialTollAmount,
  isDriverJourneySimulationPath,
  isRouteQuoteFresh,
  parseSimulationInput,
  parseSimulationRoute,
  resolveSimulationToll,
  SIMULATION_VEHICLES,
  simulationRouteKey,
  simulationRoutePoints,
  simulationStartPoint,
  simulationTollMark,
  SimulationInputError,
  tollNeedsTyping,
  type RouteQuote,
  type SimulationJourneyInput,
} from './driverJourneySimulation';

const surabayaDay: SimulationJourneyInput = {
  stops: ['Universitas Airlangga Kampus C, Surabaya'],
  stopLocations: [null],
  vehicleName: 'Innova Matic',
  departureDate: '2026-11-02',
  departureTime: '07:00',
  returnDate: '2026-11-02',
  returnTime: '15:00',
  tollSource: 'google',
  tollAmount: 0,
  parkingFee: 10_000,
};

const surabayaQuote: RouteQuote = {
  measurement: {
    distanceKm: 160,
    durationHours: 3,
    legs: [
      { start: 'UNIPDU', end: 'Kampus C', distanceKm: 80, durationHours: 1.5 },
      { start: 'Kampus C', end: 'UNIPDU', distanceKm: 80, durationHours: 1.5 },
    ],
  },
  toll: { status: 'priced', amount: 64_000 },
  measuredAt: '2026-10-15T02:00:00.000Z',
};

test('the simulation path is its own page', () => {
  assert.equal(isDriverJourneySimulationPath('/dashboard/simulasi-perjalanan'), true);
  assert.equal(isDriverJourneySimulationPath('/dashboard/simulasi-perjalanan-lain'), false);
});

test('Ndalem cannot be borrowed for an event', () => {
  assert.equal(SIMULATION_VEHICLES.includes('Ndalem'), false);
  assert.equal(SIMULATION_VEHICLES.includes('Bis'), true);
});

test('every route starts and ends at UNIPDU as the sopir report measures it', () => {
  const points = simulationRoutePoints(['  Surabaya ', '', 'Sidoarjo']);
  assert.deepEqual(points, [simulationStartPoint(), 'Surabaya', 'Sidoarjo', simulationStartPoint()]);
  assert.match(simulationStartPoint(), /^-?\d+\.\d{6},-?\d+\.\d{6}$/);
  assert.equal(simulationRouteKey([' Surabaya', 'Sidoarjo ']), simulationRouteKey(['Surabaya', 'Sidoarjo']));
});

test('a stop picked on the map is measured by its pin, as in the sopir report', () => {
  const kampusC = { address: 'Kampus C', latitude: -7.2656, longitude: 112.7838 };
  const points = simulationRoutePoints(['Kampus C', 'Sidoarjo'], [kampusC, null]);
  assert.deepEqual(points, [simulationStartPoint(), '-7.265600,112.783800', 'Sidoarjo', simulationStartPoint()]);
  // Moving the pin makes the measured route stale.
  assert.notEqual(
    simulationRouteKey(['Kampus C'], [kampusC]),
    simulationRouteKey(['Kampus C'], [{ ...kampusC, latitude: -7.27 }]),
  );
  const parsed = parseSimulationRoute(['Kampus C', 'Sidoarjo'], [kampusC, { address: 'Elsewhere', latitude: 0, longitude: 0 }]);
  assert.deepEqual(parsed.stopLocations, [kampusC, null], 'a pin that belongs to another stop is dropped');
  assert.deepEqual(parseSimulationRoute(['Kampus C'], undefined).stopLocations, [null]);
});

test('a Simulasi Perjalanan costs fuel, toll, parking and the Upah Bersih the sopir is paid', () => {
  const result = calculateSimulationJourney(surabayaDay, surabayaQuote);
  assert.equal(result.fuelCost, 232_000); // 160 km × Rp1.450
  assert.equal(result.tollFee, 64_000);
  assert.equal(result.pay.upahBersih, 103_000);
  assert.equal(result.total, 232_000 + 64_000 + 10_000 + 103_000);
  assert.equal(simulationTollMark(result), null);
});

test('toll access directions survive the saved calculation and reopening the simulation form', () => {
  const access = [
    { legIndex: 0, entrance: 'Masuk Jl. Tol Jombang', exit: 'Ambil jalan keluar menuju Surabaya' },
    { legIndex: 1, entrance: 'Masuk Jl. Tol Surabaya', exit: 'Ambil jalan keluar menuju Jombang' },
  ];
  const result = calculateSimulationJourney(surabayaDay, {
    ...surabayaQuote,
    toll: { ...surabayaQuote.toll, access },
  });
  assert.deepEqual(result.tollQuote.access, access);
  const reopened = journeyFormFromResult(JSON.parse(JSON.stringify(result)));
  assert.deepEqual(reopened.quote?.toll.access, access);
  assert.equal(reopened.tollInput, '64000');
  assert.equal(reopened.tollSource, 'google');
});

test('going out and back twice in one day is one Perjalanan with the sopir waiting', () => {
  const twice = calculateSimulationJourney(
    {
      ...surabayaDay,
      stops: ['Surabaya', 'UNIPDU Jombang', 'Surabaya'],
      departureTime: '06:00',
      returnTime: '20:00',
    },
    { ...surabayaQuote, measurement: { distanceKm: 320, durationHours: 6, legs: [] } },
  );
  assert.equal(twice.pay.journeyDurationHours, 14);
  assert.equal(twice.pay.mealWage, 60_000);
  assert.equal(twice.pay.upahBersih, 96_000 + 30_000 + 60_000);
});

test('a toll Google cannot price must be typed before the total counts', () => {
  for (const status of ['unknown_price', 'unavailable'] as const) {
    assert.equal(tollNeedsTyping(status), true);
    assert.equal(initialTollAmount({ status, amount: null }), null);
    assert.throws(
      () => resolveSimulationToll({ tollSource: 'google', tollAmount: 0 }, { status, amount: null }),
      SimulationInputError,
    );
    assert.equal(resolveSimulationToll({ tollSource: 'manual', tollAmount: 0 }, { status, amount: null }), 0);
  }
  assert.equal(initialTollAmount({ status: 'none', amount: null }), 0);
  assert.equal(resolveSimulationToll({ tollSource: 'google', tollAmount: 0 }, { status: 'none', amount: null }), 0);
});

test('a typed toll is marked as changed or filled by hand', () => {
  const overridden = calculateSimulationJourney(
    { ...surabayaDay, tollSource: 'manual', tollAmount: 70_000 },
    surabayaQuote,
  );
  assert.equal(overridden.tollFee, 70_000);
  assert.equal(simulationTollMark(overridden), 'override');
  const filled = calculateSimulationJourney(
    { ...surabayaDay, tollSource: 'manual', tollAmount: 70_000 },
    { ...surabayaQuote, toll: { status: 'unavailable', amount: null } },
  );
  assert.equal(simulationTollMark(filled), 'filled');
});

test('a Simulasi adds its Perjalanan into a grand total', () => {
  const result = calculateSimulation(
    [surabayaDay, { ...surabayaDay, vehicleName: 'Bis', parkingFee: 0 }],
    [surabayaQuote, surabayaQuote],
  );
  assert.equal(result.journeys[1].fuelCost, 400_000);
  assert.equal(result.grandTotal, result.journeys[0].total + result.journeys[1].total);
  assert.throws(() => calculateSimulation([surabayaDay], []));
});

test('a measured route is reused for seven days', () => {
  const now = new Date('2026-10-15T00:00:00.000Z');
  assert.equal(isRouteQuoteFresh('2026-10-09T00:00:01.000Z', now), true);
  assert.equal(isRouteQuoteFresh('2026-10-08T00:00:00.000Z', now), false);
  assert.equal(isRouteQuoteFresh('not a date', now), false);
  assert.equal(isRouteQuoteFresh('2026-10-16T00:00:00.000Z', now), false);
});

test('the form input is validated with messages for the user', () => {
  const valid = {
    eventName: '  Seminar Nasional ',
    journeys: [{ ...surabayaDay, tollAmount: 999 }],
  };
  const parsed = parseSimulationInput(valid);
  assert.equal(parsed.eventName, 'Seminar Nasional');
  assert.equal(parsed.journeys[0].tollAmount, 0); // ignored unless typed

  const invalid: Array<[unknown, RegExp]> = [
    [{ ...valid, eventName: ' ' }, /Nama kegiatan/],
    [{ ...valid, journeys: [] }, /minimal satu/],
    [{ ...valid, journeys: Array(11).fill(surabayaDay) }, /Maksimal 10/],
    [{ ...valid, journeys: [{ ...surabayaDay, stops: ['Surabaya', ' '] }] }, /baris yang kosong/],
    [{ ...valid, journeys: [{ ...surabayaDay, vehicleName: 'Ndalem' }] }, /pilih kendaraan/],
    [{ ...valid, journeys: [{ ...surabayaDay, returnTime: '06:00' }] }, /setelah waktu berangkat/],
    [{ ...valid, journeys: [{ ...surabayaDay, departureDate: '2026-02-30' }] }, /tanggal dan jam berangkat/],
    [{ ...valid, journeys: [{ ...surabayaDay, tollSource: 'manual', tollAmount: -1 }] }, /biaya tol/],
    [{ ...valid, journeys: [{ ...surabayaDay, parkingFee: 1.5 }] }, /biaya parkir/],
  ];
  for (const [input, message] of invalid) {
    assert.throws(() => parseSimulationInput(input), message);
  }
});
