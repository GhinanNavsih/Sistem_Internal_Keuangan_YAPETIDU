import { createHash } from 'node:crypto';
import type { firestore } from 'firebase-admin';
import {
  isRouteQuoteFresh,
  type RouteLeg,
  type RouteMeasurement,
  type RouteQuote,
  type TollQuote,
  type TollQuoteStatus,
} from '@/lib/driverJourneySimulation';
import { measureDirectionsRoute } from '@/lib/server/googleDirections';
import { quoteRouteToll } from '@/lib/server/googleRoutesToll';

/**
 * Route answers from Google, kept for `ROUTE_QUOTE_REUSE_DAYS` so asking about
 * the same route again (another "Hitung", saving, "Hitung ulang") costs no new
 * Google request. Shared by every account: a route says nothing about who
 * asked. Server-only; the Firestore rules refuse browser access.
 */
const COLLECTION = 'DriverRouteQuotes';

type Firestore = firestore.Firestore;

const TOLL_STATUSES: readonly TollQuoteStatus[] = ['priced', 'unknown_price', 'none', 'unavailable'];

function routeQuoteId(points: readonly string[]): string {
  return createHash('sha256').update(points.join('\u0000')).digest('hex');
}

function finiteNonNegative(value: unknown): number | null {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : null;
}

function storedMeasurement(value: unknown): RouteMeasurement | null {
  if (!value || typeof value !== 'object') return null;
  const record = value as Record<string, unknown>;
  const distanceKm = finiteNonNegative(record.distanceKm);
  const durationHours = finiteNonNegative(record.durationHours);
  if (!distanceKm || !durationHours || !Array.isArray(record.legs)) return null;
  const legs: RouteLeg[] = record.legs.map((leg) => {
    const entry = (leg || {}) as Record<string, unknown>;
    return {
      start: String(entry.start || ''),
      end: String(entry.end || ''),
      distanceKm: finiteNonNegative(entry.distanceKm) ?? 0,
      durationHours: finiteNonNegative(entry.durationHours) ?? 0,
    };
  });
  return { distanceKm, durationHours, legs };
}

function storedToll(value: unknown): TollQuote {
  const record = (value || {}) as Record<string, unknown>;
  const status = TOLL_STATUSES.includes(record.status as TollQuoteStatus)
    ? (record.status as TollQuoteStatus)
    : 'unavailable';
  const amount = finiteNonNegative(record.amount);
  return status === 'priced' && amount !== null
    ? { status, amount }
    : { status: status === 'priced' ? 'unavailable' : status, amount: null };
}

function plainMeasurement(measurement: RouteMeasurement): RouteMeasurement {
  return {
    distanceKm: measurement.distanceKm,
    durationHours: measurement.durationHours,
    legs: measurement.legs.map((leg) => ({
      start: leg.start,
      end: leg.end,
      distanceKm: leg.distanceKm,
      durationHours: leg.durationHours,
    })),
  };
}

/**
 * The measurement and toll for a route, from the store when it was measured
 * within the reuse window, otherwise from Google. A toll Google could not
 * answer earlier is asked again (a failed toll request is not billed), the
 * kilometres are not.
 */
export async function loadRouteQuote(
  db: Firestore,
  points: readonly string[],
  now: Date = new Date(),
): Promise<RouteQuote & { reused: boolean }> {
  const ref = db.collection(COLLECTION).doc(routeQuoteId(points));
  const snapshot = await ref.get();
  const data = snapshot.exists ? snapshot.data() : undefined;
  const cachedMeasurement = storedMeasurement(data?.measurement);
  const measuredAt = typeof data?.measuredAt === 'string' ? data.measuredAt : '';

  if (cachedMeasurement && isRouteQuoteFresh(measuredAt, now)) {
    let toll = storedToll(data?.toll);
    if (toll.status === 'unavailable') {
      toll = await quoteRouteToll(points);
      if (toll.status !== 'unavailable') {
        await ref.set({ toll, tollCheckedAt: now.toISOString() }, { merge: true });
      }
    }
    return { measurement: cachedMeasurement, toll, measuredAt, reused: true };
  }

  const [measurement, toll] = await Promise.all([
    measureDirectionsRoute(points),
    quoteRouteToll(points),
  ]);
  const quote: RouteQuote = {
    measurement: plainMeasurement(measurement),
    toll,
    measuredAt: now.toISOString(),
  };
  await ref.set({
    points: [...points],
    measurement: quote.measurement,
    toll,
    measuredAt: quote.measuredAt,
    tollCheckedAt: quote.measuredAt,
  });
  return { ...quote, reused: false };
}
