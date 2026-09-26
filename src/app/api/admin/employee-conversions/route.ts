import { NextRequest } from 'next/server';
import { EMPLOYEE_PROFILE_EDITOR_ROLES } from '@/lib/payroll/roles';
import {
  errorResponse,
  requireAuthenticatedProfile,
  requireRole,
} from '@/lib/server/auth';
import {
  assertBlueCollarEmployeeId,
  convertEmployeeToLoyalis,
  parseEmployeeConversionCommand,
  previewEmployeeConversion,
} from '@/lib/server/employeeConversion';

export const dynamic = 'force-dynamic';

/** Pre-flight check and pre-filled form for converting one Pekarya to Loyalis. */
export async function GET(request: NextRequest) {
  try {
    const actor = await requireAuthenticatedProfile(request);
    requireRole(actor, EMPLOYEE_PROFILE_EDITOR_ROLES);
    const employeeId = assertBlueCollarEmployeeId(
      request.nextUrl.searchParams.get('employeeId'),
    );
    return Response.json(await previewEmployeeConversion(actor, employeeId));
  } catch (error) {
    return errorResponse(error);
  }
}

/** Converts one Pekarya to a new Loyalis record (see src/lib/employeeConversion.ts). */
export async function POST(request: NextRequest) {
  try {
    const actor = await requireAuthenticatedProfile(request);
    requireRole(actor, EMPLOYEE_PROFILE_EDITOR_ROLES);
    const command = parseEmployeeConversionCommand(await request.json(), actor);
    const result = await convertEmployeeToLoyalis(actor, command);
    return Response.json(result, { status: result.idempotent ? 200 : 201 });
  } catch (error) {
    return errorResponse(error);
  }
}
