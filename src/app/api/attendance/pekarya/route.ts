import { NextRequest } from 'next/server';
import { adminDb } from '@/lib/firebase-admin';
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
import { PEKARYA_OFFICIAL_LEAVE_REQUESTS_COLLECTION } from '@/lib/server/pekaryaOfficialLeave';

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
    const officialLeaveSnapshot =
      category === 'SATPAM'
        ? null
        : await adminDb
            .collection(PEKARYA_OFFICIAL_LEAVE_REQUESTS_COLLECTION)
            .where('period', '==', period)
            .get();
    return Response.json({
      ...result,
      officialLeaves:
        officialLeaveSnapshot?.docs
          .map((document): { id: string; [key: string]: unknown } => ({
            id: document.id,
            ...(document.data() as Record<string, unknown>),
          }))
          .filter((item) => String(item.category || '') === category)
          .sort((left, right) =>
            String(right.date || '').localeCompare(String(left.date || '')),
          ) || [],
    });
  } catch (error) {
    return errorResponse(error);
  }
}
