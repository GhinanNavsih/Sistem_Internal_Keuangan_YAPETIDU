import type { TollAccess, TollQuote } from '@/lib/driverJourneySimulation';

const ROUTES_ENDPOINT = 'https://routes.googleapis.com/directions/v2:computeRoutes';
const LAT_LNG = /^(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)$/;
const TIMEOUT_MS = 10_000;
const TOLL_ROAD_NAME = /\b(?:jl\.?|jalan|gerbang)\s+tol\b|\btoll road\b/i;

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

interface GoogleTollInfo {
  estimatedPrice?: Money[];
}

interface GoogleRouteStep {
  navigationInstruction?: { maneuver?: string; instructions?: string };
}

interface GoogleTollRoute {
  travelAdvisory?: { tollInfo?: GoogleTollInfo };
  legs?: Array<{
    travelAdvisory?: { tollInfo?: GoogleTollInfo };
    steps?: GoogleRouteStep[];
  }>;
}

/**
 * Google has no gate-name fields. Keep its plain-text entry/exit directions
 * from each contiguous toll section instead of guessing a nearby toll plaza.
 * Road names alone do not prove a toll: require a toll notice in the section
 * and a toll advisory on the leg. Never parse HTML navigation instructions.
 */
function tollAccess(route: GoogleTollRoute): TollAccess[] {
  const access: TollAccess[] = [];
  for (const [legIndex, leg] of (route.legs ?? []).entries()) {
    if (!leg.travelAdvisory?.tollInfo) continue;
    let section: {
      entrance: string | null;
      exit: string | null;
      paid: boolean;
      namedRoad: boolean;
      departing: boolean;
    } | null = null;
    const finish = () => {
      if (section?.paid && section.namedRoad) {
        access.push({ legIndex, entrance: section.entrance, exit: section.exit });
      }
      section = null;
    };

    const steps = leg.steps ?? [];
    for (const [stepIndex, step] of steps.entries()) {
      const text = step.navigationInstruction?.instructions?.trim() ?? '';
      const instruction = text.split('\n')[0].trim();
      const paid = /^(?:jalan tol|sebagian jalan tol|toll road|partial toll road)\s*$/im.test(text);
      const namedRoad = TOLL_ROAD_NAME.test(instruction);
      const tollRoad = paid || namedRoad;
      const exit = /\b(?:jalan|jalur) keluar\b|\btake (?:the )?exit\b/i.test(instruction);
      if (tollRoad) {
        section ??= {
          entrance: null,
          exit: null,
          paid: false,
          namedRoad: false,
          departing: step.navigationInstruction?.maneuver === 'DEPART',
        };
        section.paid ||= paid;
        if (namedRoad && !section.namedRoad && !section.departing && !exit) {
          // A paid airport/parking access road before the motorway is not its
          // toll entrance. Prefer the instruction that names the toll road.
          section.entrance = instruction;
        }
        if (section.namedRoad && !namedRoad && /\b(?:ke|menuju)\s+(?:jl\.?|jalan)\s+/i.test(instruction)) {
          // Some exits name the next local road instead of an exit number.
          section.exit ??= instruction;
        }
        section.namedRoad ||= namedRoad;
        // An interchange that merges onto another toll road is not its exit.
        if (step.navigationInstruction?.maneuver === 'MERGE') section.exit = null;
        if (exit) section.exit = instruction;
      } else if (section && exit) {
        section.exit = instruction;
      } else if (section && /^(?:RAMP_LEFT|RAMP_RIGHT|STRAIGHT)$/.test(step.navigationInstruction?.maneuver ?? '') &&
        TOLL_ROAD_NAME.test(steps[stepIndex + 1]?.navigationInstruction?.instructions ?? '')) {
        // Access roads can have an unnamed ramp immediately before merging.
        continue;
      } else {
        finish();
      }
    }
    finish();
  }
  return access;
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
        'X-Goog-FieldMask': [
          'routes.travelAdvisory.tollInfo',
          'routes.legs.travelAdvisory.tollInfo',
          'routes.legs.steps.navigationInstruction',
        ].join(','),
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
      routes?: GoogleTollRoute[];
    };
    const route = data.routes?.[0];
    if (!route) return { status: 'unavailable', amount: null };

    const tollInfo = route.travelAdvisory?.tollInfo;
    if (!tollInfo) return { status: 'none', amount: null, access: [] };
    const access = tollAccess(route);

    // One entry per currency the toll gates charge.
    const price = (tollInfo.estimatedPrice || []).find((entry) => entry.currencyCode === 'IDR');
    if (!price) return { status: 'unknown_price', amount: null, access };
    const amount = Number(price.units || 0) + Number(price.nanos || 0) / 1e9;
    if (!Number.isFinite(amount) || amount < 0) return { status: 'unknown_price', amount: null, access };
    return { status: 'priced', amount: Math.round(amount), access };
  } catch (error) {
    console.warn('Google Routes toll lookup failed:', error instanceof Error ? error.message : error);
    return { status: 'unavailable', amount: null };
  }
}
