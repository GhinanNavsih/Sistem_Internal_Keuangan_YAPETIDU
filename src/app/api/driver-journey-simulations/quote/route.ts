import { NextRequest, NextResponse } from 'next/server';
import { adminDb } from '@/lib/firebase-admin';
import {
  parseSimulationRoute,
  simulationRoutePoints,
  SimulationInputError,
} from '@/lib/driverJourneySimulation';
import { DRIVER_JOURNEY_SIMULATION_ROLES } from '@/lib/payroll/roles';
import { errorResponse, HttpError, requireAuthenticatedProfile, requireRole } from '@/lib/server/auth';
import { loadRouteQuote } from '@/lib/server/driverRouteQuotes';

export const dynamic = 'force-dynamic';

/**
 * Measures one Perjalanan's loop from UNIPDU and back ("Hitung"): kilometres
 * and Durasi tempuh from Google Directions, the toll from Google Routes. Only
 * the roles that may simulate can reach it, and a route asked about within
 * the last seven days is answered from the store. Older toll quotes missing
 * entry/exit directions are enriched once through Google Routes.
 */
export async function POST(request: NextRequest) {
  try {
    const actor = await requireAuthenticatedProfile(request);
    requireRole(actor, DRIVER_JOURNEY_SIMULATION_ROLES);
    const body = await request.json().catch(() => null) as { stops?: unknown; stopLocations?: unknown } | null;
    let route: ReturnType<typeof parseSimulationRoute>;
    try {
      route = parseSimulationRoute(body?.stops, body?.stopLocations);
    } catch (error) {
      if (error instanceof SimulationInputError) throw new HttpError(400, error.message);
      throw error;
    }
    const quote = await loadRouteQuote(adminDb, simulationRoutePoints(route.stops, route.stopLocations));
    return NextResponse.json({ quote });
  } catch (error) {
    return errorResponse(error);
  }
}
