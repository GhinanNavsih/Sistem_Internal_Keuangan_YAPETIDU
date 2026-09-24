import { NextRequest, NextResponse } from 'next/server';
import { VENUE_RESERVATION_ROLES } from '@/lib/payroll/roles';
import {
  errorResponse,
  HttpError,
  requireAuthenticatedProfile,
  requireRole,
} from '@/lib/server/auth';
import { loadBookingSurat } from '@/lib/server/venueReservations';
import { isSimpelAdminConfigured, simpelAdminDb } from '@/lib/simpel-admin';
import type { ReservationActor } from '@/lib/venueReservation';

export const dynamic = 'force-dynamic';

function reservationActor(actor: { uid: string; role: string; email: string | null; displayName: string }): ReservationActor {
  return { uid: actor.uid, role: actor.role, email: actor.email, displayName: actor.displayName };
}

/**
 * Loads the attached booking confirmation letter (surat/SK) for a single booking on demand.
 */
export async function GET(request: NextRequest) {
  try {
    const actor = await requireAuthenticatedProfile(request);
    requireRole(actor, VENUE_RESERVATION_ROLES);
    if (!isSimpelAdminConfigured()) {
      throw new HttpError(
        503,
        'Integrasi SIMPEL UNIPDU belum dikonfigurasi di server. Hubungi administrator sistem.',
      );
    }
    const bookingId = request.nextUrl.searchParams.get('id') || '';
    if (!bookingId) {
      throw new HttpError(400, 'Parameter id reservasi wajib disertakan.');
    }
    const surat = await loadBookingSurat(simpelAdminDb(), reservationActor(actor), bookingId);
    return NextResponse.json(surat);
  } catch (error) {
    return errorResponse(error);
  }
}
