import { NextRequest } from 'next/server';
import {
  buildSatpamDutyReconciliation,
  syncSatpamDutyReconciliation,
} from '@/lib/server/satpamDutyPlan';
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
    const refresh = request.nextUrl.searchParams.get('refresh') === 'true';
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
