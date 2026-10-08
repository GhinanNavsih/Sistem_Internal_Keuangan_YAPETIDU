import { NextRequest } from 'next/server';
import { assertRequestId } from '@/lib/payroll/domain';
import {
  errorResponse,
  HttpError,
  requireAuthenticatedProfile,
  requireRole,
} from '@/lib/server/auth';
import {
  BONUS_TRIWULAN_READER_ROLES,
  evaluateAndSyncBonusTriwulan,
  getBonusTriwulanView,
  parsePeriodParam,
} from '@/lib/server/bonusTriwulan';

export const dynamic = 'force-dynamic';

const responseHeaders = { 'Cache-Control': 'no-store' };

/** `?period=YYYY-MM`: a fresh evaluation next to the stored result. */
export async function GET(request: NextRequest) {
  try {
    const actor = await requireAuthenticatedProfile(request);
    requireRole(actor, BONUS_TRIWULAN_READER_ROLES);
    const period = parsePeriodParam(request.nextUrl.searchParams.get('period'));
    return Response.json(await getBonusTriwulanView(period), { headers: responseHeaders });
  } catch (error) {
    return errorResponse(error);
  }
}

/**
 * Recalculates the month and brings the payout and draft slips in line. The
 * request carries no amounts or names: everything is re-derived from presence
 * and Senam Pagi.
 */
export async function POST(request: NextRequest) {
  try {
    const actor = await requireAuthenticatedProfile(request);
    requireRole(actor, BONUS_TRIWULAN_READER_ROLES);
    const body = await request.json().catch(() => null) as Record<string, unknown> | null;
    const period = parsePeriodParam(body?.period);
    const requestId = typeof body?.requestId === 'string' ? body.requestId : '';
    try {
      assertRequestId(requestId);
    } catch {
      throw new HttpError(400, 'requestId tidak valid.');
    }
    const result = await evaluateAndSyncBonusTriwulan(actor, period, requestId);
    return Response.json({ result, view: await getBonusTriwulanView(period) }, { headers: responseHeaders });
  } catch (error) {
    return errorResponse(error);
  }
}
