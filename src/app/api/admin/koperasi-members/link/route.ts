import { FINANCE_ROLES } from '@/lib/payroll/roles';
import { NextRequest } from 'next/server';
import { errorResponse, HttpError, requireAuthenticatedProfile, requireRole } from '@/lib/server/auth';
import { linkKoperasiMember, memberCommandBody } from '@/lib/server/koperasiMembers';

export const dynamic = 'force-dynamic';
export async function POST(request: NextRequest) {
  try {
    const actor = await requireAuthenticatedProfile(request);
    requireRole(actor, FINANCE_ROLES);
    const body = memberCommandBody(await request.json().catch(() => { throw new HttpError(400, 'JSON tidak valid.'); }));
    return Response.json(await linkKoperasiMember(actor, body));
  } catch (error) { return errorResponse(error); }
}
