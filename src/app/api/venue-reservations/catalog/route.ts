import { NextRequest, NextResponse } from 'next/server';
import { VENUE_RESERVATION_ROLES } from '@/lib/payroll/roles';
import {
  errorResponse,
  HttpError,
  requireAuthenticatedProfile,
  requireRole,
} from '@/lib/server/auth';
import { loadBookingsOn, loadSimpelCatalog } from '@/lib/server/venueReservations';
import { isSimpelAdminConfigured, simpelAdminDb } from '@/lib/simpel-admin';
import {
  isValidDateString,
  jakartaNow,
  toScheduleEntry,
  type ScheduleEntry,
} from '@/lib/venueReservation';

export const dynamic = 'force-dynamic';

/**
 * What the reservation form needs: SIMPEL's buildings, rooms and equipment,
 * plus every booking on `?date=YYYY-MM-DD` so the page can show a room's
 * schedule and count remaining equipment with the same rules the server uses.
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

    const date = request.nextUrl.searchParams.get('date')?.trim() || '';
    if (date && !isValidDateString(date)) {
      throw new HttpError(400, 'Tanggal tidak valid.');
    }

    const db = simpelAdminDb();
    const [catalog, dayBookings] = await Promise.all([
      loadSimpelCatalog(db),
      date ? loadBookingsOn(db, date) : Promise.resolve([]),
    ]);
    const schedule: ScheduleEntry[] = dayBookings.map(toScheduleEntry);
    const clock = jakartaNow();

    return NextResponse.json({
      buildings: catalog.buildings,
      equipment: catalog.equipment,
      date: date || null,
      schedule,
      today: clock.date,
      nowMinutes: clock.minutes,
    });
  } catch (error) {
    return errorResponse(error);
  }
}
