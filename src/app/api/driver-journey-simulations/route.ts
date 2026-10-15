import { NextRequest, NextResponse } from 'next/server';
import { adminDb } from '@/lib/firebase-admin';
import { parseSimulationInput, SimulationInputError } from '@/lib/driverJourneySimulation';
import { DRIVER_JOURNEY_SIMULATION_ROLES } from '@/lib/payroll/roles';
import { errorResponse, HttpError, requireAuthenticatedProfile, requireRole } from '@/lib/server/auth';
import {
  createDriverJourneySimulation,
  listDriverJourneySimulations,
} from '@/lib/server/driverJourneySimulations';

export const dynamic = 'force-dynamic';

/** The caller's saved Simulasi Biaya Perjalanan; every one for Super Admin. */
export async function GET(request: NextRequest) {
  try {
    const actor = await requireAuthenticatedProfile(request);
    requireRole(actor, DRIVER_JOURNEY_SIMULATION_ROLES);
    return NextResponse.json({ simulations: await listDriverJourneySimulations(adminDb, actor) });
  } catch (error) {
    return errorResponse(error);
  }
}

/** Saves a new Simulasi; the figures are worked out here, never taken from the request. */
export async function POST(request: NextRequest) {
  try {
    const actor = await requireAuthenticatedProfile(request);
    requireRole(actor, DRIVER_JOURNEY_SIMULATION_ROLES);
    const body = await request.json().catch(() => null);
    let input;
    try {
      input = parseSimulationInput(body);
    } catch (error) {
      if (error instanceof SimulationInputError) throw new HttpError(400, error.message);
      throw error;
    }
    const simulation = await createDriverJourneySimulation(adminDb, actor, input);
    return NextResponse.json({ simulation }, { status: 201 });
  } catch (error) {
    return errorResponse(error);
  }
}
