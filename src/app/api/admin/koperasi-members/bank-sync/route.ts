import { NextRequest } from 'next/server';
import { EMPLOYEE_PROFILE_EDITOR_ROLES } from '@/lib/payroll/roles';
import { errorResponse, HttpError, requireAuthenticatedProfile, requireRole } from '@/lib/server/auth';
import { memberCommandBody, syncKoperasiBanks } from '@/lib/server/koperasiMembers';

export const dynamic = 'force-dynamic';
export async function POST(request: NextRequest) {
  try {
    const actor = await requireAuthenticatedProfile(request);
    const body = memberCommandBody(await request.json().catch(() => { throw new HttpError(400, 'JSON tidak valid.'); }));
    requireRole(actor, typeof body.employeeId === 'string' && !('memberIds' in body) ? EMPLOYEE_PROFILE_EDITOR_ROLES : ['super_admin']);
    return Response.json(await syncKoperasiBanks(actor, body));
  } catch (error) { return errorResponse(error); }
}
