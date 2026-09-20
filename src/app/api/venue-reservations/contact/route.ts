import { NextRequest, NextResponse } from 'next/server';
import { adminDb } from '@/lib/firebase-admin';
import { VENUE_RESERVATION_ROLES } from '@/lib/payroll/roles';
import { errorResponse, requireAuthenticatedProfile, requireRole } from '@/lib/server/auth';
import { loadReservationContact } from '@/lib/server/venueContact';

export const dynamic = 'force-dynamic';

/**
 * The WhatsApp number and unit name the booking form starts with, so the user
 * does not retype them (`@/lib/venueReservationContact`). Always the caller's
 * own: the name to look up comes from their account, never from the request.
 */
export async function GET(request: NextRequest) {
  try {
    const actor = await requireAuthenticatedProfile(request);
    requireRole(actor, VENUE_RESERVATION_ROLES);
    return NextResponse.json(await loadReservationContact(adminDb, actor));
  } catch (error) {
    return errorResponse(error);
  }
}
