import { NextRequest } from 'next/server';
import { errorResponse, HttpError, requireAuthenticatedProfile, requireRole } from '@/lib/server/auth';
import { memberCommandBody } from '@/lib/server/koperasiMembers';
import { declineKoperasiLoan } from '@/lib/server/koperasiLoanAdmin';

export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  try {
    const actor = await requireAuthenticatedProfile(request);
    requireRole(actor, ['super_admin']);
    const body = memberCommandBody(await request.json().catch(() => { throw new HttpError(400, 'JSON tidak valid.'); }));
    return Response.json(await declineKoperasiLoan(actor, body));
  } catch (error) { return errorResponse(error); }
}
