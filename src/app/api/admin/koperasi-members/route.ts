import { NextRequest } from 'next/server';
import { errorResponse, HttpError, requireAuthenticatedProfile, requireRole } from '@/lib/server/auth';
import { deleteKoperasiMember, editKoperasiMember, memberCommandBody } from '@/lib/server/koperasiMembers';

export const dynamic = 'force-dynamic';
export async function PATCH(request: NextRequest) {
  try {
    const actor = await requireAuthenticatedProfile(request);
    requireRole(actor, ['super_admin']);
    const body = memberCommandBody(await request.json().catch(() => { throw new HttpError(400, 'JSON tidak valid.'); }));
    return Response.json(await editKoperasiMember(actor, body));
  } catch (error) { return errorResponse(error); }
}

export async function DELETE(request: NextRequest) {
  try {
    const actor = await requireAuthenticatedProfile(request);
    requireRole(actor, ['super_admin']);
    const body = memberCommandBody(await request.json().catch(() => { throw new HttpError(400, 'JSON tidak valid.'); }));
    return Response.json(await deleteKoperasiMember(actor, body));
  } catch (error) { return errorResponse(error); }
}
