import { createHash } from 'node:crypto';
import { NextRequest } from 'next/server';
import { ATTENDANCE_PAYROLL_START_PERIOD } from '@/lib/payroll/attendance';
import { assertRequestId } from '@/lib/payroll/domain';
import { publishPekaryaAttendance } from '@/lib/server/pekaryaAttendance';
import {
  errorResponse,
  HttpError,
  requireAuthenticatedProfile,
  requireRole,
} from '@/lib/server/auth';

export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  try {
    const actor = await requireAuthenticatedProfile(request);
    requireRole(actor, ['satker_head']);
    const body = (await request.json()) as Record<string, unknown>;
    const period = String(body.period || '');
    const category = String(body.category || '').trim().toUpperCase();
    const requestId = String(body.requestId || '');
    try {
      assertRequestId(requestId);
    } catch (error) {
      throw new HttpError(
        400,
        error instanceof Error ? error.message : 'requestId tidak valid.',
      );
    }
    if (!/^\d{4}-\d{2}$/.test(period) || period < ATTENDANCE_PAYROLL_START_PERIOD) {
      throw new HttpError(400, 'Presensi Pekarya berlaku mulai periode 2026-08.');
    }
    if (
      !category ||
      category === 'SATPAM' ||
      !actor.permittedCategories.includes(category)
    ) {
      throw new HttpError(403, 'Kategori publikasi tidak diizinkan.');
    }
    const acknowledgedWarnings = Array.isArray(body.acknowledgedWarnings)
      ? body.acknowledgedWarnings.filter(
          (warning): warning is string =>
            typeof warning === 'string' && warning.length <= 100,
        )
      : [];
    const requestHash = createHash('sha256')
      .update(JSON.stringify({ period, category, acknowledgedWarnings }))
      .digest('hex');
    let result;
    try {
      result = await publishPekaryaAttendance(
        period,
        category,
        actor.uid,
        requestId,
        acknowledgedWarnings,
        requestHash,
      );
    } catch (error) {
      throw new HttpError(
        409,
        error instanceof Error ? error.message : 'Publikasi presensi gagal.',
      );
    }
    return Response.json(result);
  } catch (error) {
    return errorResponse(error);
  }
}
