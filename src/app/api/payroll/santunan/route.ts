import { NextRequest } from 'next/server';
import { isBansosKind } from '@/lib/payroll/santunan';
import {
  errorResponse,
  HttpError,
  requireAuthenticatedProfile,
  requireRole,
} from '@/lib/server/auth';
import {
  BANSOS_REVIEW_READER_ROLES,
  bansosSideForRole,
  decideBansos,
  isBansosReviewTab,
  listBansosForEvent,
  listBansosForReview,
  markBansosHandedOver,
  parseBansosReviewCommand,
} from '@/lib/server/santunan';

export const dynamic = 'force-dynamic';

const responseHeaders = { 'Cache-Control': 'no-store' };

/**
 * `?tab=waiting|handover|decided|all` lists ajuan for the Verifikasi Ajuan
 * Santunan page, from the caller's side;
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
    if (!isBansosReviewTab(tab)) throw new HttpError(400, 'Tab tidak valid.');
    return Response.json(
      { requests: await listBansosForReview(tab, bansosSideForRole(actor.role)) },
      { headers: responseHeaders },
    );
  } catch (error) {
    return errorResponse(error);
  }
}

/**
 * One side's decision (Admin Karyawan for the admin side, Super Admin for the
 * finance side), or `action: 'handover'` from either once a Duka's cash is handed over.
 */
export async function POST(request: NextRequest) {
  try {
    const actor = await requireAuthenticatedProfile(request);
    requireRole(actor, ['loyalis_admin', 'super_admin']);
    const command = parseBansosReviewCommand(await request.json());
    const result = command.action === 'handover'
      ? await markBansosHandedOver(actor, command)
      : await decideBansos(actor, command);
    return Response.json(result, { headers: responseHeaders });
  } catch (error) {
    return errorResponse(error);
  }
}
