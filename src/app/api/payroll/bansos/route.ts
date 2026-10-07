import { NextRequest } from 'next/server';
import { isBansosKind } from '@/lib/payroll/bansos';
import {
  errorResponse,
  HttpError,
  requireAuthenticatedProfile,
  requireRole,
} from '@/lib/server/auth';
import {
  BANSOS_REVIEW_READER_ROLES,
  decideBansos,
  listBansosForEvent,
  listBansosForReview,
  parseBansosDecisionCommand,
} from '@/lib/server/bansos';

export const dynamic = 'force-dynamic';

const responseHeaders = { 'Cache-Control': 'no-store' };

/**
 * `?tab=waiting|decided|all` lists ajuan for the Admin Karyawan page;
 * `?period=YYYY-MM&kind=duka|melahirkan` lists one month's event for the
 * Vakasi page panel.
 */
export async function GET(request: NextRequest) {
  try {
    const actor = await requireAuthenticatedProfile(request);
    requireRole(actor, BANSOS_REVIEW_READER_ROLES);
    const params = request.nextUrl.searchParams;
    const period = params.get('period');
    if (period !== null) {
      const kind = params.get('kind');
      if (!/^\d{4}-\d{2}$/.test(period)) throw new HttpError(400, 'Periode wajib berformat YYYY-MM.');
      if (!isBansosKind(kind)) throw new HttpError(400, 'Jenis ajuan tidak valid.');
      return Response.json({ requests: await listBansosForEvent(period, kind) }, { headers: responseHeaders });
    }
    const tab = params.get('tab') || 'waiting';
    if (tab !== 'waiting' && tab !== 'decided' && tab !== 'all') {
      throw new HttpError(400, 'Tab tidak valid.');
    }
    return Response.json({ requests: await listBansosForReview(tab) }, { headers: responseHeaders });
  } catch (error) {
    return errorResponse(error);
  }
}

/** One side's decision: Admin Karyawan for the admin side, Super Admin for the finance side. */
export async function POST(request: NextRequest) {
  try {
    const actor = await requireAuthenticatedProfile(request);
    requireRole(actor, ['loyalis_admin', 'super_admin']);
    const command = parseBansosDecisionCommand(await request.json());
    return Response.json(await decideBansos(actor, command), { headers: responseHeaders });
  } catch (error) {
    return errorResponse(error);
  }
}
