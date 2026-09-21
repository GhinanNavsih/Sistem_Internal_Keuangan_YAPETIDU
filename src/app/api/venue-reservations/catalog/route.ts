import { NextRequest, NextResponse } from 'next/server';
import { VENUE_RESERVATION_ROLES } from '@/lib/payroll/roles';
import {
  errorResponse,
  HttpError,
  requireAuthenticatedProfile,
  requireRole,
} from '@/lib/server/auth';
import { loadBookingsOnDates, loadSimpelCatalog } from '@/lib/server/venueReservations';
import { isSimpelAdminConfigured, simpelAdminDb } from '@/lib/simpel-admin';
import {
  getDateRangeList,
  isValidDateString,
  jakartaNow,
  MAX_MULTI_DAY_RANGE,
  toScheduleEntry,
  type ScheduleEntry,
} from '@/lib/venueReservation';

export const dynamic = 'force-dynamic';

/**
 * What the reservation form needs: SIMPEL's buildings, rooms and equipment,
 * plus every booking on `?date=YYYY-MM-DD` or multiple dates (`?dates=...` or
 * `?startDate=...&endDate=...`) so the page can show a room's schedule and
 * count remaining equipment with the same rules the server uses.
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

    const singleDate = request.nextUrl.searchParams.get('date')?.trim() || '';
    const datesParam = request.nextUrl.searchParams.get('dates')?.trim() || '';
    const startDate = request.nextUrl.searchParams.get('startDate')?.trim() || '';
    const endDate = request.nextUrl.searchParams.get('endDate')?.trim() || '';

    let dates: string[] = [];
    if (datesParam) {
      dates = datesParam.split(',').map((d) => d.trim()).filter(Boolean);
    } else if (startDate && endDate) {
      dates = getDateRangeList(startDate, endDate);
    } else if (singleDate) {
      dates = [singleDate];
    }

    for (const d of dates) {
      if (!isValidDateString(d)) {
        throw new HttpError(400, `Tanggal tidak valid: ${d}`);
      }
    }
    if (dates.length > MAX_MULTI_DAY_RANGE) {
      throw new HttpError(400, `Maksimal ${MAX_MULTI_DAY_RANGE} tanggal dapat diperiksa sekaligus.`);
    }

    const db = simpelAdminDb();
    const [catalog, dayBookings] = await Promise.all([
      loadSimpelCatalog(db),
      dates.length > 0 ? loadBookingsOnDates(db, dates) : Promise.resolve([]),
    ]);
    const schedule: ScheduleEntry[] = dayBookings.map(toScheduleEntry);
    const clock = jakartaNow();

    return NextResponse.json({
      buildings: catalog.buildings,
      equipment: catalog.equipment,
      date: dates[0] || singleDate || null,
      dates,
      schedule,
      today: clock.date,
      nowMinutes: clock.minutes,
    });
  } catch (error) {
    return errorResponse(error);
  }
}
