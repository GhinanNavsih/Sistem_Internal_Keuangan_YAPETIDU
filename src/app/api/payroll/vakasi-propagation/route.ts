import { NextRequest } from 'next/server';
import { URAIAN_EDITOR_ROLES } from '@/lib/payroll/roles';
import {
  errorResponse,
  requireAuthenticatedProfile,
  requireRole,
} from '@/lib/server/auth';
import {
  parseVakasiPropagationCommand,
  propagateVakasiEmployees,
} from '@/lib/server/vakasiPropagation';

export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  try {
    const actor = await requireAuthenticatedProfile(request);
    requireRole(actor, URAIAN_EDITOR_ROLES);
    const command = parseVakasiPropagationCommand(await request.json());
    const result = await propagateVakasiEmployees(actor, command);
    return Response.json(result, {
      status: 200,
      headers: { 'Cache-Control': 'no-store' },
    });
  } catch (error) {
    return errorResponse(error);
  }
}
