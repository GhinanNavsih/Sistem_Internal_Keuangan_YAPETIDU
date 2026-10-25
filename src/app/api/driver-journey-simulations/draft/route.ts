import { NextRequest, NextResponse } from 'next/server';
import { adminDb } from '@/lib/firebase-admin';
import { DRIVER_JOURNEY_SIMULATION_ROLES } from '@/lib/payroll/roles';
import { errorResponse, HttpError, requireAuthenticatedProfile, requireRole } from '@/lib/server/auth';
import {
  deleteDriverJourneySimulationDraft,
  getDriverJourneySimulationDraft,
  saveDriverJourneySimulationDraft,
} from '@/lib/server/driverJourneySimulations';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  try {
    const actor = await requireAuthenticatedProfile(request);
    requireRole(actor, DRIVER_JOURNEY_SIMULATION_ROLES);
    const draft = await getDriverJourneySimulationDraft(adminDb, actor);
    return NextResponse.json({ draft });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function PUT(request: NextRequest) {
  try {
    const actor = await requireAuthenticatedProfile(request);
    requireRole(actor, DRIVER_JOURNEY_SIMULATION_ROLES);
    const body = await request.json().catch(() => null);
    if (!body || !body.form || typeof body.form !== 'object') {
      throw new HttpError(400, 'Data draf tidak valid.');
    }
    await saveDriverJourneySimulationDraft(adminDb, actor, {
      form: body.form,
      savedId: typeof body.savedId === 'string' && body.savedId ? body.savedId : null,
    });
    return NextResponse.json({ success: true });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const actor = await requireAuthenticatedProfile(request);
    requireRole(actor, DRIVER_JOURNEY_SIMULATION_ROLES);
    await deleteDriverJourneySimulationDraft(adminDb, actor);
    return NextResponse.json({ success: true });
  } catch (error) {
    return errorResponse(error);
  }
}
