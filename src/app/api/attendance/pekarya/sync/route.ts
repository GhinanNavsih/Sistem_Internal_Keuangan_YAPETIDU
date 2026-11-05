import { NextRequest } from 'next/server';
import { adminDb } from '@/lib/firebase-admin';
import { ATTENDANCE_PAYROLL_START_PERIOD } from '@/lib/payroll/attendance';
import { ALL_BLUE_COLLAR_CATEGORY } from '@/lib/payroll/pekaryaSpj';
import { isPeriodClosed } from '@/lib/server/payrollPeriod';
import { listActivePekaryaAttendanceCategories } from '@/lib/server/pekaryaAttendance';
import { syncPekaryaAttendance } from '@/lib/server/pekaryaAttendanceSync';
import {
  errorResponse,
  HttpError,
  requireAuthenticatedProfile,
  requireRole,
} from '@/lib/server/auth';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

/**
 * "Sinkronkan Ulang": runs the automatic attendance sync again by hand, for
 * when an automatic run failed. The same roles that used to publish may ask.
 */
export async function POST(request: NextRequest) {
  try {
    const actor = await requireAuthenticatedProfile(request);
    requireRole(actor, ['satker_head', 'super_admin']);
    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    const period = String(body.period || '');
    const category = String(body.category || '').trim().toUpperCase();
    if (!/^\d{4}-\d{2}$/.test(period) || period < ATTENDANCE_PAYROLL_START_PERIOD) {
      throw new HttpError(400, 'Presensi Pekarya berlaku mulai periode 2026-08.');
    }
    const permitted = new Set(actor.permittedCategories.map((item) => item.trim().toUpperCase()));
    let categories: string[] = [];
    if (category === ALL_BLUE_COLLAR_CATEGORY) {
      const active = await listActivePekaryaAttendanceCategories(period);
      categories = actor.role === 'super_admin' ? active : active.filter((item) => permitted.has(item));
    } else if (
      category &&
      category !== 'SATPAM' &&
      (actor.role === 'super_admin' || permitted.has(category))
    ) {
      categories = [category];
    }
    if (categories.length === 0) {
      throw new HttpError(403, 'Kategori sinkronisasi tidak diizinkan.');
    }
    if (isPeriodClosed((await adminDb.collection('PayrollPeriods').doc(period).get()).data())) {
      throw new HttpError(409, 'Periode payroll sudah ditutup permanen.');
    }
    const results = await syncPekaryaAttendance(period, categories, actor, 'manual_retry');
    const failed = results.filter((result) => result.status === 'failed');
    if (failed.length > 0) {
      throw new HttpError(
        409,
        failed.map((result) => `${result.category}: ${result.reason || 'gagal'}`).join(' · '),
      );
    }
    return Response.json({ period, results }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    return errorResponse(error);
  }
}
