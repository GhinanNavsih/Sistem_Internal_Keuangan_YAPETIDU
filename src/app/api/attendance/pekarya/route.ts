import { NextRequest } from 'next/server';
import { adminDb } from '@/lib/firebase-admin';
import {
  ATTENDANCE_PAYROLL_START_PERIOD,
} from '@/lib/payroll/attendance';
import {
  buildPekaryaAttendanceView,
  buildPekaryaAttendanceViewForCategories,
  buildSatpamAttendanceMismatches,
  listActivePekaryaAttendanceCategories,
} from '@/lib/server/pekaryaAttendance';
import { ALL_BLUE_COLLAR_CATEGORY } from '@/lib/payroll/pekaryaSpj';
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
    if (
      !category ||
      (!/^[A-Z0-9_ -]{2,80}$/.test(category) &&
        category !== ALL_BLUE_COLLAR_CATEGORY)
    ) {
      throw new HttpError(400, 'Kategori Pekarya tidak valid.');
    }
    let visibleCategories: string[] | null = null;
    if (category === ALL_BLUE_COLLAR_CATEGORY) {
      const activeCategories = await listActivePekaryaAttendanceCategories();
      const permittedCategories = new Set(
        actor.permittedCategories.map((item) => item.trim().toUpperCase()),
      );
      visibleCategories =
        actor.role === 'satker_head'
          ? activeCategories.filter((item) =>
              permittedCategories.has(item),
            )
          : activeCategories;
      if (visibleCategories.length === 0) {
        throw new HttpError(
          403,
          'Anda tidak memiliki akses ke kategori Pekarya aktif.',
        );
      }
    } else {
      if (
        actor.role === 'satker_head' &&
        !actor.permittedCategories
          .map((item) => item.trim().toUpperCase())
          .includes(category)
      ) {
        throw new HttpError(403, `Anda tidak memiliki akses kategori ${category}.`);
      }
      visibleCategories = category === 'SATPAM' ? null : [category];
    }
    const result =
      category === 'SATPAM'
        ? await buildSatpamAttendanceMismatches(period, {
            allowMissingActiveImport: true,
          })
        : category === ALL_BLUE_COLLAR_CATEGORY
          ? await buildPekaryaAttendanceViewForCategories(
              period,
              visibleCategories || [],
              { allowMissingActiveImport: true },
            )
          : await buildPekaryaAttendanceView(period, category, {
              allowMissingActiveImport: true,
            });
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
          .filter((item) =>
            (visibleCategories || []).includes(
              String(item.category || '').trim().toUpperCase(),
            ),
          )
          .sort((left, right) =>
            String(right.date || '').localeCompare(String(left.date || '')),
          ) || [],
    });
  } catch (error) {
    return errorResponse(error);
  }
}
