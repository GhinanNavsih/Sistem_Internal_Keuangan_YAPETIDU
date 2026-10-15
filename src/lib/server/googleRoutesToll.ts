import type { TollQuote } from '@/lib/driverJourneySimulation';

const ROUTES_ENDPOINT = 'https://routes.googleapis.com/directions/v2:computeRoutes';
const LAT_LNG = /^(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)$/;
const TIMEOUT_MS = 10_000;

function waypoint(point: string) {
  const match = LAT_LNG.exec(point.trim());
  if (match) {
    return { location: { latLng: { latitude: Number(match[1]), longitude: Number(match[2]) } } };
  }
  return { address: point };
}

interface Money {
  currencyCode?: string;
  units?: string | number;
  nanos?: number;
}

/**
 * Asks Google Routes what the tolls on a route cost, for a car paying by
 * Indonesian e-toll card (every vehicle SAKU lends is Golongan I, so one
 * price fits all). Only the Simulasi Biaya Perjalanan calls this; the
 * kilometres always come from Google Directions (`measureDirectionsRoute`),
 * because that is what the sopir is paid on.
 *
 * Never throws: when the service is switched off, over its daily cap or
 * unreachable, the answer is `unavailable` and the toll is typed by hand.
 */
export async function quoteRouteToll(points: readonly string[]): Promise<TollQuote> {
  const apiKey = process.env.GOOGLE_MAPS_API_KEY;
  if (!apiKey || points.length < 2) return { status: 'unavailable', amount: null };

  try {
    const response = await fetch(ROUTES_ENDPOINT, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Goog-Api-Key': apiKey,
        'X-Goog-FieldMask': 'routes.travelAdvisory.tollInfo',
      },
      body: JSON.stringify({
        origin: waypoint(points[0]),
        destination: waypoint(points[points.length - 1]),
        intermediates: points.slice(1, -1).map(waypoint),
        travelMode: 'DRIVE',
        extraComputations: ['TOLLS'],
        routeModifiers: { tollPasses: ['ID_E_TOLL'] },
        languageCode: 'id',
      }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!response.ok) {
      const body = await response.json().catch(() => null) as { error?: { status?: string; message?: string } } | null;
      console.warn('Google Routes toll lookup failed:', response.status, body?.error?.status, body?.error?.message);
      return { status: 'unavailable', amount: null };
    }
    const data = await response.json() as {
      routes?: Array<{ travelAdvisory?: { tollInfo?: { estimatedPrice?: Money[] } } }>;
    };
    const route = data.routes?.[0];
    if (!route) return { status: 'unavailable', amount: null };

    const tollInfo = route.travelAdvisory?.tollInfo;
    if (!tollInfo) return { status: 'none', amount: null };

    // One entry per currency the toll gates charge.
    const price = (tollInfo.estimatedPrice || []).find((entry) => entry.currencyCode === 'IDR');
    if (!price) return { status: 'unknown_price', amount: null };
    const amount = Number(price.units || 0) + Number(price.nanos || 0) / 1e9;
    if (!Number.isFinite(amount) || amount < 0) return { status: 'unknown_price', amount: null };
    return { status: 'priced', amount: Math.round(amount) };
  } catch (error) {
    console.warn('Google Routes toll lookup failed:', error instanceof Error ? error.message : error);
    return { status: 'unavailable', amount: null };
  }
}
