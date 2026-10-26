import { NextRequest } from 'next/server';
import { errorResponse, HttpError, requireAuthenticatedProfile, requireRole } from '@/lib/server/auth';
import { finishProposalPayrollSync } from '@/lib/server/proposalPayroll';

export async function POST(request: NextRequest) {
  try {
    const actor = await requireAuthenticatedProfile(request);
    requireRole(actor, ['super_admin', 'finance_verifier', 'satker_head_loyalis']);
    const { operationId } = await request.json();
    if (typeof operationId !== 'string' || !/^[A-Za-z0-9_-]{1,300}$/.test(operationId)) throw new HttpError(400, 'ID sinkronisasi tidak valid.');
    return Response.json(await finishProposalPayrollSync(actor, operationId), { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) { return errorResponse(error); }
}
