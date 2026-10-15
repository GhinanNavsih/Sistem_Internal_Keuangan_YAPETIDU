import { NextRequest, NextResponse } from 'next/server';
import { adminDb } from '@/lib/firebase-admin';
import { parseSimulationInput, SimulationInputError } from '@/lib/driverJourneySimulation';
import { DRIVER_JOURNEY_SIMULATION_ROLES } from '@/lib/payroll/roles';
import { errorResponse, HttpError, requireAuthenticatedProfile, requireRole } from '@/lib/server/auth';
import {
  deleteDriverJourneySimulation,
  getDriverJourneySimulation,
  updateDriverJourneySimulation,
} from '@/lib/server/driverJourneySimulations';

export const dynamic = 'force-dynamic';

const SAFE_ID = /^[A-Za-z0-9]{1,64}$/;

type Context = { params: Promise<{ id: string }> };

async function simulationId(context: Context): Promise<string> {
  const { id } = await context.params;
  if (!SAFE_ID.test(id)) throw new HttpError(404, 'Simulasi tidak ditemukan.');
  return id;
}

export async function GET(request: NextRequest, context: Context) {
  try {
    const actor = await requireAuthenticatedProfile(request);
    requireRole(actor, DRIVER_JOURNEY_SIMULATION_ROLES);
    const simulation = await getDriverJourneySimulation(adminDb, actor, await simulationId(context));
    return NextResponse.json({ simulation });
  } catch (error) {
    return errorResponse(error);
  }
}

/** Saves changes, or works the same Simulasi out again with today's rates ("Hitung ulang"). */
export async function PUT(request: NextRequest, context: Context) {
  try {
    const actor = await requireAuthenticatedProfile(request);
    requireRole(actor, DRIVER_JOURNEY_SIMULATION_ROLES);
    const id = await simulationId(context);
    const body = await request.json().catch(() => null);
    let input;
    try {
      input = parseSimulationInput(body);
    } catch (error) {
      if (error instanceof SimulationInputError) throw new HttpError(400, error.message);
      throw error;
    }
    const simulation = await updateDriverJourneySimulation(adminDb, actor, id, input);
    return NextResponse.json({ simulation });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function DELETE(request: NextRequest, context: Context) {
  try {
    const actor = await requireAuthenticatedProfile(request);
    requireRole(actor, DRIVER_JOURNEY_SIMULATION_ROLES);
    await deleteDriverJourneySimulation(adminDb, actor, await simulationId(context));
    return NextResponse.json({ ok: true });
  } catch (error) {
    return errorResponse(error);
  }
}
