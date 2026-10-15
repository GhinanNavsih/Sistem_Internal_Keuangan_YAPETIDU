import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';
import type { firestore } from 'firebase-admin';
import type { TollQuote } from '@/lib/driverJourneySimulation';
import { loadRouteQuote } from './driverRouteQuotes';
import { quoteRouteToll } from './googleRoutesToll';

const points = ['-7.545800,112.285800', '-7.366667,111.883333', '-7.545800,112.285800'];
const now = new Date('2026-10-15T15:00:00.000Z');
const measuredAt = '2026-10-15T14:29:10.001Z';
const measurement = {
  distanceKm: 100,
  durationHours: 2,
  legs: [
    { start: 'UNIPDU', end: 'Nganjuk', distanceKm: 50, durationHours: 1 },
    { start: 'Nganjuk', end: 'UNIPDU', distanceKm: 50, durationHours: 1 },
  ],
};
const tollInfo = { estimatedPrice: [{ currencyCode: 'IDR', units: '79000' }] };
const step = (instructions: string, maneuver = 'NAME_CHANGE') => ({ navigationInstruction: { instructions, maneuver } });

// Reduced from Google's live response for the Rp79.000 loop. In particular,
// the return leg has an unnamed ramp between Jl. Tol Nganjuk and the merge.
const responseWithAccess = {
  routes: [{
    travelAdvisory: { tollInfo },
    legs: [
      {
        travelAdvisory: { tollInfo },
        steps: [
          step('Belok kiri ke Jl. Panglima Sudirman', 'TURN_LEFT'),
          step('Belok kanan menuju Jl. Tol Jombang/Jl. Tol Kertosono - Mojokerto\nJalan tol', 'TURN_RIGHT'),
          step('Teruskan ke Jl. Tol Kertosono - Mojokerto\nJalan tol'),
          step('Bergabung ke Jl. Tol Ngawi – Kertosono\nJalan tol', 'MERGE'),
          step('Ambil jalan keluar 647 menuju Nganjuk/Kediri/Blitar', 'RAMP_LEFT'),
          step('Teruskan ke Jl. Tol Nganjuk'),
          step('Belok kiri ke Jl. Bengawan Solo', 'TURN_LEFT'),
        ],
      },
      {
        travelAdvisory: { tollInfo },
        steps: [
          step('Belok kiri ke Jl. Tol Nganjuk', 'TURN_LEFT'),
          step('Ambil jalan ke Rute 11/Jombang/Kertosono/Surabaya', 'STRAIGHT'),
          step('Bergabung ke Jl. Tol Ngawi – Kertosono\nJalan tol', 'MERGE'),
          step('Teruskan ke Jl. Tol Kertosono - Mojokerto\nJalan tol'),
          step('Ambil jalan keluar 25 menuju Jombang/Ploso\nJalan tol', 'STRAIGHT'),
          step('Teruskan ke Jl. Tol Jombang - Mojokerto\nJalan tol'),
          step('Belok kiri ke Jl. Jombang - Ploso', 'TURN_LEFT'),
        ],
      },
    ],
  }],
};
const expectedAccess = [
  {
    legIndex: 0,
    entrance: 'Belok kanan menuju Jl. Tol Jombang/Jl. Tol Kertosono - Mojokerto',
    exit: 'Ambil jalan keluar 647 menuju Nganjuk/Kediri/Blitar',
  },
  {
    legIndex: 1,
    entrance: 'Belok kiri ke Jl. Tol Nganjuk',
    exit: 'Ambil jalan keluar 25 menuju Jombang/Ploso',
  },
];

function googleResponse(t: TestContext, body: unknown, status = 200) {
  const apiKey = process.env.GOOGLE_MAPS_API_KEY;
  process.env.GOOGLE_MAPS_API_KEY = 'test-key';
  t.after(() => {
    if (apiKey === undefined) delete process.env.GOOGLE_MAPS_API_KEY;
    else process.env.GOOGLE_MAPS_API_KEY = apiKey;
  });
  return t.mock.method(globalThis, 'fetch', async (input: unknown, init?: RequestInit) => {
    assert.equal(input, 'https://routes.googleapis.com/directions/v2:computeRoutes');
    assert.equal(init?.method, 'POST');
    return Response.json(body, { status });
  });
}

function cachedQuote(toll: TollQuote) {
  let stored: Record<string, unknown> = { measurement, measuredAt, toll };
  const writes: Record<string, unknown>[] = [];
  const ref = {
    get: async () => ({ exists: true, data: () => stored }),
    set: async (value: Record<string, unknown>, options: { merge: boolean }) => {
      assert.equal(options.merge, true);
      writes.push(value);
      stored = { ...stored, ...value };
    },
  };
  const db = {
    collection: (name: string) => {
      assert.equal(name, 'DriverRouteQuotes');
      return { doc: () => ref };
    },
  } as unknown as firestore.Firestore;
  return { db, writes };
}

test('requests entry/exit directions with the toll fee and keeps outgoing and return legs distinct', async (t) => {
  const fetch = googleResponse(t, responseWithAccess);
  const toll = await quoteRouteToll(points);
  assert.deepEqual(toll, { status: 'priced', amount: 79_000, access: expectedAccess });
  assert.equal(fetch.mock.callCount(), 1);
  const request = fetch.mock.calls[0].arguments[1];
  const mask = new Headers(request?.headers).get('X-Goog-FieldMask');
  assert.match(mask ?? '', /routes\.legs\.steps\.navigationInstruction/);
  assert.match(mask ?? '', /routes\.legs\.travelAdvisory\.tollInfo/);
  const body = JSON.parse(String(request?.body));
  assert.deepEqual(body.extraComputations, ['TOLLS'], 'do not request or parse HTML instructions');
  assert.equal(body.languageCode, 'id');
  assert.deepEqual(body.routeModifiers.tollPasses, ['ID_E_TOLL']);
});

test('keeps separate toll sections in one leg and does not mistake an interchange for its exit', async (t) => {
  googleResponse(t, { routes: [{ travelAdvisory: { tollInfo }, legs: [{
    travelAdvisory: { tollInfo },
    steps: [
      step('Masuk Jl. Tol A\nJalan tol'),
      step('Ambil jalan keluar menuju Jl. Tol B\nJalan tol', 'RAMP_LEFT'),
      step('Bergabung ke Jl. Tol B\nJalan tol', 'MERGE'),
      step('Ambil jalan keluar 1 menuju Kota A', 'RAMP_RIGHT'),
      step('Belok kiri ke Jl. Merdeka', 'TURN_LEFT'),
      step('Masuk Jl. Tol C\nJalan tol'),
      step('Ambil jalan keluar 2 menuju Kota B', 'RAMP_LEFT'),
      step('Belok kanan ke Jl. Sudirman', 'TURN_RIGHT'),
    ],
  }] }] });
  const toll = await quoteRouteToll(points);
  assert.deepEqual(toll.access, [
    { legIndex: 0, entrance: 'Masuk Jl. Tol A', exit: 'Ambil jalan keluar 1 menuju Kota A' },
    { legIndex: 0, entrance: 'Masuk Jl. Tol C', exit: 'Ambil jalan keluar 2 menuju Kota B' },
  ]);
});

test('does not invent access directions from a road name or an incomplete toll section', async (t) => {
  googleResponse(t, { routes: [{ travelAdvisory: { tollInfo }, legs: [
    { steps: [step('Belok ke Jl. Tol Lama\nJalan tol')] }, // No toll advisory on this leg.
    { travelAdvisory: { tollInfo }, steps: [step('Belok ke Jl. Tol Lama')] }, // No paid section.
    { travelAdvisory: { tollInfo }, steps: [step('Ke arah timur di Jl. Tol A\nJalan tol', 'DEPART')] },
  ] }] });
  const toll = await quoteRouteToll(points);
  assert.deepEqual(toll.access, [{ legIndex: 2, entrance: null, exit: null }]);
});

test('uses the named motorway instead of a paid parking access road and recognises a local-road exit', async (t) => {
  googleResponse(t, { routes: [{ travelAdvisory: { tollInfo }, legs: [
    { travelAdvisory: { tollInfo }, steps: [
      step('Belok kanan ke Jl. Tol Jombang - Mojokerto\nJalan tol', 'TURN_RIGHT'),
      step('Teruskan ke Jl. Tol Waru - Juanda\nJalan tol'),
      step('Terus lurus ke Jl. Bandara Juanda\nJalan tol', 'STRAIGHT'),
      step('Belok kiri untuk tetap di Jl. Bandara Juanda', 'TURN_LEFT'),
    ] },
    { travelAdvisory: { tollInfo }, steps: [
      step('Belok sedikit ke kiri menuju Jl. Gerbang Pakir Terminal I\nJalan tol', 'TURN_SLIGHT_LEFT'),
      step('Terus lurus ke Jl. Tol Waru - Juanda\nJalan tol', 'STRAIGHT'),
      step('Ambil jalan keluar 687 menuju Jombang/Ploso\nJalan tol', 'RAMP_LEFT'),
      step('Belok kiri ke Jl. Jombang - Ploso', 'TURN_LEFT'),
    ] },
  ] }] });
  assert.deepEqual((await quoteRouteToll(points)).access, [
    { legIndex: 0, entrance: 'Belok kanan ke Jl. Tol Jombang - Mojokerto', exit: 'Terus lurus ke Jl. Bandara Juanda' },
    { legIndex: 1, entrance: 'Terus lurus ke Jl. Tol Waru - Juanda', exit: 'Ambil jalan keluar 687 menuju Jombang/Ploso' },
  ]);
});

test('a priced route with no access information stays priced and records that directions were checked', async (t) => {
  googleResponse(t, { routes: [{ travelAdvisory: { tollInfo } }] });
  assert.deepEqual(await quoteRouteToll(points), { status: 'priced', amount: 79_000, access: [] });
});

test('unknown-price tolls retain their directions without becoming a zero-cost toll', async (t) => {
  googleResponse(t, { routes: [{ ...responseWithAccess.routes[0], travelAdvisory: { tollInfo: {} } }] });
  assert.deepEqual(await quoteRouteToll(points), { status: 'unknown_price', amount: null, access: expectedAccess });
});

test('enriches an older cached toll once, preserving the existing distance and measurement date', async (t) => {
  const fetch = googleResponse(t, responseWithAccess);
  const { db, writes } = cachedQuote({ status: 'priced', amount: 79_000 });
  const quote = await loadRouteQuote(db, points, now);
  assert.deepEqual(quote.toll.access, expectedAccess);
  assert.deepEqual(quote.measurement, measurement);
  assert.equal(quote.measuredAt, measuredAt);
  assert.equal(quote.reused, true);
  assert.equal(writes.length, 1);
  assert.deepEqual(writes[0].toll, quote.toll);
  assert.equal(writes[0].tollCheckedAt, now.toISOString());
  assert.deepEqual(await loadRouteQuote(db, points, now), quote);
  assert.equal(fetch.mock.callCount(), 1, 'the enriched quote must be reused without more Google requests');
});

test('reuses a toll already checked for access, including when Google supplied no directions', async (t) => {
  const fetch = googleResponse(t, {});
  for (const access of [[], expectedAccess]) {
    const { db, writes } = cachedQuote({ status: 'priced', amount: 79_000, access });
    assert.deepEqual((await loadRouteQuote(db, points, now)).toll.access, access);
    assert.equal(writes.length, 0);
  }
  assert.equal(fetch.mock.callCount(), 0);
});

test('a failed access refresh preserves a usable cached toll price', async (t) => {
  googleResponse(t, { error: { status: 'UNAVAILABLE' } }, 503);
  t.mock.method(console, 'warn', () => {});
  const { db, writes } = cachedQuote({ status: 'priced', amount: 79_000 });
  const quote = await loadRouteQuote(db, points, now);
  assert.deepEqual(quote.toll, { status: 'priced', amount: 79_000 });
  assert.equal(writes.length, 0);
});

test('does not refresh a cached toll-free route merely to look for access directions', async (t) => {
  const fetch = googleResponse(t, {});
  const { db } = cachedQuote({ status: 'none', amount: null });
  assert.equal((await loadRouteQuote(db, points, now)).toll.status, 'none');
  assert.equal(fetch.mock.callCount(), 0);
});
