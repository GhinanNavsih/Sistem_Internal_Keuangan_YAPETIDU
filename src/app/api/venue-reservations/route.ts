import { NextRequest, NextResponse } from 'next/server';
import { adminDb } from '@/lib/firebase-admin';
import { VENUE_RESERVATION_ROLES } from '@/lib/payroll/roles';
import {
  errorResponse,
  HttpError,
  requireAuthenticatedProfile,
  requireRole,
  type AuthenticatedProfile,
} from '@/lib/server/auth';
import { saveReservationContact } from '@/lib/server/venueContact';
import {
  createReservation,
  listReservations,
  performReservationAction,
  recordReservationAudit,
} from '@/lib/server/venueReservations';
import { isSimpelAdminConfigured, simpelAdminDb } from '@/lib/simpel-admin';
import {
  isReservationAction,
  parseReservationRequest,
  toReservationView,
  type ReservationActor,
} from '@/lib/venueReservation';

export const dynamic = 'force-dynamic';

/**
 * Venue reservations in SIMPEL UNIPDU, made from SAKU.
 *
 * GET lists the caller's reservations (Super Admin: every one made through
 * SAKU). POST takes `{ action }`: `create` books a room, approved immediately
 * when it is free; `cancel`, `confirm-receipt` and `ready-return` move an
 * existing reservation along, owner or Super Admin only.
 */

async function authorize(request: NextRequest): Promise<AuthenticatedProfile> {
  const actor = await requireAuthenticatedProfile(request);
  requireRole(actor, VENUE_RESERVATION_ROLES);
  if (!isSimpelAdminConfigured()) {
    throw new HttpError(
      503,
      'Integrasi SIMPEL UNIPDU belum dikonfigurasi di server. Hubungi administrator sistem.',
    );
  }
  return actor;
}

function reservationActor(actor: AuthenticatedProfile): ReservationActor {
  return { uid: actor.uid, role: actor.role, email: actor.email, displayName: actor.displayName };
}

export async function GET(request: NextRequest) {
  try {
    const actor = await authorize(request);
    const reservations = await listReservations(simpelAdminDb(), actor);
    return NextResponse.json({ reservations, viewerRole: actor.role });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function POST(request: NextRequest) {
  try {
    const actor = await authorize(request);
    const caller = reservationActor(actor);
    const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
    const action = typeof body?.action === 'string' ? body.action : '';
    const db = simpelAdminDb();

    if (action === 'create') {
      const bookings = await createReservation(db, caller, parseReservationRequest(body));
      for (const booking of bookings) {
        await recordReservationAudit(caller, 'create', booking);
      }
      // Next time the form starts with this number, on any device.
      await saveReservationContact(adminDb, caller.uid, { phone: bookings[0].kontak, pemohon: bookings[0].pemohon });
      return NextResponse.json({
        reservation: toReservationView(bookings[0], caller.role, caller.uid),
        reservations: bookings.map((b) => toReservationView(b, caller.role, caller.uid)),
      }, { status: 201 });
    }

    if (isReservationAction(action)) {
      const bookingId = typeof body?.bookingId === 'string' ? body.bookingId.trim() : '';
      const cancelReason = typeof body?.reason === 'string' ? body.reason : undefined;
      const cancelGroup = body?.cancelGroup === true;
      const booking = await performReservationAction(db, caller, bookingId, action, { cancelReason, cancelGroup });
      await recordReservationAudit(caller, action, booking);
      return NextResponse.json({ reservation: toReservationView(booking, caller.role, caller.uid) });
    }

    throw new HttpError(400, 'Aksi reservasi tidak dikenal.');
  } catch (error) {
    return errorResponse(error);
  }
}
