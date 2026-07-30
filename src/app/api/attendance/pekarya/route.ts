import { NextRequest } from 'next/server';
import {
  ATTENDANCE_PAYROLL_START_PERIOD,
} from '@/lib/payroll/attendance';
import {
  buildPekaryaAttendanceView,
  buildSatpamAttendanceMismatches,
} from '@/lib/server/pekaryaAttendance';
import {
  errorResponse,
  HttpError,
  requireAuthenticatedProfile,
  requireRole,
} from '@/lib/server/auth';

export const dynamic = 'force-dynamic';

function queryValue(request: NextRequest, key: string): string {
  return request.nextUrl.searchParams.get(key)?.trim() || '';
}

export async function GET(request: NextRequest) {
  try {
    const actor = await requireAuthenticatedProfile(request);
    requireRole(actor, [
      'super_admin',
      'finance_verifier',
      'payroll_authorizer',
      'satker_head',
    ]);
    const period = queryValue(request, 'period');
    const category = queryValue(request, 'category').toUpperCase();
    if (!/^\d{4}-\d{2}$/.test(period) || period < ATTENDANCE_PAYROLL_START_PERIOD) {
      throw new HttpError(
        400,
        'Presensi Pekarya berlaku mulai periode 2026-08.',
      );
    }
    if (!category || !/^[A-Z0-9_ -]{2,80}$/.test(category)) {
      throw new HttpError(400, 'Kategori Pekarya tidak valid.');
    }
    if (
      actor.role === 'satker_head' &&
      !actor.permittedCategories.includes(category)
    ) {
      throw new HttpError(403, `Anda tidak memiliki akses kategori ${category}.`);
    }
    const result =
      category === 'SATPAM'
        ? await buildSatpamAttendanceMismatches(period)
        : await buildPekaryaAttendanceView(period, category);
    return Response.json(result);
  } catch (error) {
    return errorResponse(error);
  }
}

