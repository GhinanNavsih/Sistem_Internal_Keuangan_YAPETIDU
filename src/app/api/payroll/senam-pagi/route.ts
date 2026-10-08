import { NextRequest } from 'next/server';
import {
  errorResponse,
  requireAuthenticatedProfile,
  requireRole,
} from '@/lib/server/auth';
import {
  BONUS_TRIWULAN_READER_ROLES,
  getSenamPagiView,
  parsePeriodParam,
  parseSenamPagiWriteCommand,
  SENAM_PAGI_WRITER_ROLES,
  writeSenamPagi,
} from '@/lib/server/bonusTriwulan';

export const dynamic = 'force-dynamic';

const responseHeaders = { 'Cache-Control': 'no-store' };

/** `?period=YYYY-MM`: the month's sessions and every Loyalis's standing. */
export async function GET(request: NextRequest) {
  try {
    const actor = await requireAuthenticatedProfile(request);
    requireRole(actor, BONUS_TRIWULAN_READER_ROLES);
    const period = parsePeriodParam(request.nextUrl.searchParams.get('period'));
    return Response.json(await getSenamPagiView(period), { headers: responseHeaders });
  } catch (error) {
    return errorResponse(error);
  }
}

/** Saves or deletes one session, or marks the month as having no Senam Pagi. */
export async function POST(request: NextRequest) {
  try {
    const actor = await requireAuthenticatedProfile(request);
    requireRole(actor, SENAM_PAGI_WRITER_ROLES);
    const command = parseSenamPagiWriteCommand(await request.json().catch(() => null));
    return Response.json(await writeSenamPagi(actor, command), { headers: responseHeaders });
  } catch (error) {
    return errorResponse(error);
  }
}
