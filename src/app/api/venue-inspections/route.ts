import { NextRequest, NextResponse } from 'next/server';
import {
  errorResponse,
  HttpError,
  requireAuthenticatedProfile,
  type AuthenticatedProfile,
} from '@/lib/server/auth';
import {
  completeReturnCheck,
  listRepairLogs,
  listReturnInspections,
  recordInspectionAudit,
  resolveRepair,
} from '@/lib/server/venueInspections';
import { isSimpelAdminConfigured, simpelAdminDb } from '@/lib/simpel-admin';
import { canInspectVenues, parseCheckInSubmission } from '@/lib/venueInspection';

export const dynamic = 'force-dynamic';

/**
 * Pemeriksaan Ruang: Kebersihan and Teknisi check rooms in after use, in
 * SIMPEL UNIPDU's database (the work SIMPEL's maintenance page does).
 *
 * GET lists rooms waiting for their return check and SIMPEL's repair log.
 * POST takes `{ action }`: `check-in` records a return check;
 * `resolve-repair` marks a repair log entry done.
 */

async function authorize(request: NextRequest): Promise<AuthenticatedProfile> {
  const actor = await requireAuthenticatedProfile(request);
  if (!canInspectVenues(actor)) {
    throw new HttpError(403, 'Pemeriksaan ruang hanya untuk petugas Kebersihan dan Teknisi.');
  }
  if (!isSimpelAdminConfigured()) {
    throw new HttpError(
      503,
      'Integrasi SIMPEL UNIPDU belum dikonfigurasi di server. Hubungi administrator sistem.',
    );
  }
  return actor;
}

function inspector(actor: AuthenticatedProfile) {
  return {
    uid: actor.uid,
    name: actor.displayName || actor.email || 'Petugas SAKU',
    email: actor.email,
    role: actor.role,
  };
}

export async function GET(request: NextRequest) {
  try {
    await authorize(request);
    const db = simpelAdminDb();
    const [returns, repairs] = await Promise.all([listReturnInspections(db), listRepairLogs(db)]);
    return NextResponse.json({ returns, repairs });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function POST(request: NextRequest) {
  try {
    const actor = inspector(await authorize(request));
    const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
    const action = typeof body?.action === 'string' ? body.action : '';
    const db = simpelAdminDb();

    if (action === 'check-in') {
      const result = await completeReturnCheck(db, actor, parseCheckInSubmission(body));
      await recordInspectionAudit(actor, 'VENUE_RETURN_CHECKED', {
        bookingId: result.booking.id,
        gedung: result.booking.gedung,
        ruangan: result.booking.ruangan,
        waktu: result.booking.waktu,
        kegiatan: result.booking.kegiatan,
        damageSummaries: result.damageSummaries,
        maintenanceLogIds: result.logIds,
      });
      return NextResponse.json({ bookingId: result.booking.id, damageSummaries: result.damageSummaries });
    }

    if (action === 'resolve-repair') {
      const logId = typeof body?.logId === 'string' ? body.logId.trim() : '';
      const result = await resolveRepair(db, actor, logId);
      await recordInspectionAudit(actor, 'VENUE_REPAIR_RESOLVED', {
        maintenanceLogId: result.logId,
        namaBarang: result.namaBarang,
        restored: result.restored,
      });
      return NextResponse.json(result);
    }

    throw new HttpError(400, 'Aksi pemeriksaan tidak dikenal.');
  } catch (error) {
    return errorResponse(error);
  }
}
