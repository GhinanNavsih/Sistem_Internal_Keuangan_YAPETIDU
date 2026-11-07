import { NextRequest } from 'next/server';
import {
  buildSatpamDutyReconciliation,
  syncSatpamDutyReconciliation,
} from '@/lib/server/satpamDutyPlan';
import { adminDb } from '@/lib/firebase-admin';
import { isPeriodClosed } from '@/lib/server/payrollPeriod';
import {
  errorResponse,
  HttpError,
  requireAuthenticatedProfile,
  requireRole,
} from '@/lib/server/auth';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  try {
    const actor = await requireAuthenticatedProfile(request);
    requireRole(actor, [
      'super_admin',
      'finance_verifier',
      'satker_head',
    ]);
    if (
      actor.role === 'satker_head' &&
      !actor.permittedCategories.includes('SATPAM')
    ) {
      throw new HttpError(403, 'Anda tidak memiliki akses kategori SATPAM.');
    }
    const period = request.nextUrl.searchParams.get('period') || '';
    if (!/^\d{4}-\d{2}$/.test(period)) {
      throw new HttpError(400, 'Periode wajib menggunakan format YYYY-MM.');
    }
    // Pages ask for a refresh every time they open a month. A closed month's
    // saved rekap must not move, so there the answer is the current view with
    // nothing written, not an error. The sync still refuses a closed month
    // inside its own transaction, so a close that lands in between is caught.
    const refresh =
      request.nextUrl.searchParams.get('refresh') === 'true' &&
      !isPeriodClosed((await adminDb.doc(`PayrollPeriods/${period}`).get()).data());
    const view = refresh
      ? await syncSatpamDutyReconciliation(period, actor.uid)
      : await buildSatpamDutyReconciliation(period);
    return Response.json(view, {
      headers: { 'Cache-Control': 'no-store' },
    });
  } catch (error) {
    return errorResponse(error);
  }
}
