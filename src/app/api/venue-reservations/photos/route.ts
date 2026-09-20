import { NextRequest, NextResponse } from 'next/server';
import { VENUE_RESERVATION_ROLES } from '@/lib/payroll/roles';
import {
  errorResponse,
  HttpError,
  requireAuthenticatedProfile,
  requireRole,
} from '@/lib/server/auth';
import { loadVenuePhotos } from '@/lib/server/venueReservations';
import { isSimpelAdminConfigured, simpelAdminDb } from '@/lib/simpel-admin';

export const dynamic = 'force-dynamic';

/**
 * The cover photo of every building and room, for the "Di ruangan mana?" step.
 * Separate from the catalog because the photos are the heavy part and rarely
 * change, so the browser may keep the answer for a few minutes.
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
    return NextResponse.json(await loadVenuePhotos(simpelAdminDb()), {
      headers: { 'Cache-Control': 'private, max-age=300' },
    });
  } catch (error) {
    return errorResponse(error);
  }
}
