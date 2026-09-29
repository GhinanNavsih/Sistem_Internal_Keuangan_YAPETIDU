import { NextRequest } from 'next/server';
import {
  errorResponse,
  HttpError,
  requireAuthenticatedProfile,
  requireRole,
} from '@/lib/server/auth';
import { reconcileLoyalisAutoLeave } from '@/lib/server/loyalisAutoLeave';

export const dynamic = 'force-dynamic';

/**
 * Spends annual cuti on the unexcused absences of a saved Loyalis presence
 * (and takes it back from days that no longer qualify). Called by the presence
 * page right after "Simpan Data Presensi", before slips are refreshed.
 */
export async function POST(request: NextRequest) {
  try {
    const actor = await requireAuthenticatedProfile(request);
    requireRole(actor, ['super_admin', 'loyalis_admin']);
    const body = (await request.json().catch(() => null)) as { period?: unknown } | null;
    const period = typeof body?.period === 'string' ? body.period.trim() : '';
    if (!period) throw new HttpError(400, 'Periode wajib diisi.');
    const summary = await reconcileLoyalisAutoLeave(period, actor);
    return Response.json(summary, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    return errorResponse(error);
  }
}
