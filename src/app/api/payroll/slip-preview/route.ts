import { NextRequest } from 'next/server';
import { resolveSlipPreviewScope } from '@/lib/payroll/pekaryaSlipPreview';
import { FINANCE_ROLES } from '@/lib/payroll/roles';
import { loadPekaryaSlipPreviews } from '@/lib/server/pekaryaSlipPreview';
import {
  errorResponse,
  HttpError,
  requireAuthenticatedProfile,
} from '@/lib/server/auth';

export const dynamic = 'force-dynamic';

const PERIOD_RE = /^(\d{4})-(\d{2})$/;
const EMPLOYEE_ID_RE = /^[A-Za-z0-9_-]{1,128}$/;

/**
 * The read-only Pekarya earnings preview both the Finance dashboard and the
 * employee payslip page render.
 *
 * Every input — the active salary matrix, the Uraian publication state,
 * approved activity and event SPJ, Piket schedules, and the payroll calendar —
 * is loaded server-side, so neither client can drift from the other and
 * neither needs collection-wide read access to payroll inputs.
 */
export async function GET(request: NextRequest) {
  try {
    const actor = await requireAuthenticatedProfile(request);

    const period = request.nextUrl.searchParams.get('period')?.trim() || '';
    const periodMatch = PERIOD_RE.exec(period);
    if (!periodMatch || Number(periodMatch[2]) < 1 || Number(periodMatch[2]) > 12) {
      throw new HttpError(400, 'Periode wajib menggunakan format YYYY-MM.');
    }

    const requestedEmployeeId =
      request.nextUrl.searchParams.get('employeeId')?.trim() || '';
    if (requestedEmployeeId && !EMPLOYEE_ID_RE.test(requestedEmployeeId)) {
      throw new HttpError(400, 'employeeId tidak valid.');
    }

    const scope = resolveSlipPreviewScope({
      role: actor.role,
      financeRoles: FINANCE_ROLES,
      linkedEmployeeId: actor.linkedEmployeeId,
      requestedEmployeeId,
    });
    if (scope.kind === 'denied') {
      throw new HttpError(scope.status, scope.message);
    }

    const result = await loadPekaryaSlipPreviews(
      period,
      scope.kind === 'employee' ? [scope.employeeId] : undefined,
    );

    return Response.json(result, {
      headers: { 'Cache-Control': 'no-store' },
    });
  } catch (error) {
    return errorResponse(error);
  }
}
