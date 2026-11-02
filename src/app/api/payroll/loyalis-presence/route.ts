import { NextRequest } from 'next/server';
import { FINANCE_ROLES } from '@/lib/payroll/roles';
import { errorResponse, HttpError, requireAuthenticatedProfile, requireRole } from '@/lib/server/auth';
import {
  loadEffectiveLoyalisPresence,
  reconcileAndLoadLoyalisPresence,
} from '@/lib/server/loyalisPresence';

export const dynamic = 'force-dynamic';

function parsePeriod(value: unknown): string {
  const period = typeof value === 'string' ? value.replace('_', '-').trim() : '';
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(period)) {
    throw new HttpError(400, 'Periode wajib menggunakan format YYYY-MM.');
  }
  return period;
}

/** Read-only dashboard totals include approved credits and corrections. */
export async function GET(request: NextRequest) {
  try {
    const actor = await requireAuthenticatedProfile(request);
    requireRole(actor, [...FINANCE_ROLES, 'satker_head_loyalis', 'loyalis_admin']);
    const period = parsePeriod(request.nextUrl.searchParams.get('period'));
    return Response.json({ presence: await loadEffectiveLoyalisPresence(period) }, {
      headers: { 'Cache-Control': 'no-store' },
    });
  } catch (error) {
    return errorResponse(error);
  }
}

/** Explicit payroll refresh reconciles leave before returning its amounts. */
export async function POST(request: NextRequest) {
  try {
    const actor = await requireAuthenticatedProfile(request);
    requireRole(actor, [...FINANCE_ROLES, 'loyalis_admin']);
    const body = await request.json().catch(() => null);
    const period = parsePeriod(body?.period);
    return Response.json({ presence: await reconcileAndLoadLoyalisPresence(period, actor) }, {
      headers: { 'Cache-Control': 'no-store' },
    });
  } catch (error) {
    return errorResponse(error);
  }
}
