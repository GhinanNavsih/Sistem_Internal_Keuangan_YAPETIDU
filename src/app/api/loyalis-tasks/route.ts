import { NextRequest, NextResponse } from 'next/server';
import { adminDb } from '@/lib/firebase-admin';
import { LOYALIS_TASK_ASSIGNER_ROLES } from '@/lib/payroll/roles';
import { errorResponse, HttpError, requireAuthenticatedProfile, requireRole } from '@/lib/server/auth';
import { createLoyalisTask, listLoyalisTasks } from '@/lib/server/loyalisTasks';

export const dynamic = 'force-dynamic';

const SAFE_EMPLOYEE_ID = /^[A-Za-z0-9_-]{1,64}$/;

/** Every Tugas Loyalis, or those of one Loyalis (`?employeeId=`). */
export async function GET(request: NextRequest) {
  try {
    const actor = await requireAuthenticatedProfile(request);
    requireRole(actor, LOYALIS_TASK_ASSIGNER_ROLES);
    const employeeId = request.nextUrl.searchParams.get('employeeId')?.trim() || undefined;
    if (employeeId && !SAFE_EMPLOYEE_ID.test(employeeId)) throw new HttpError(400, 'Loyalis tidak valid.');
    return NextResponse.json({ tasks: await listLoyalisTasks(adminDb, { employeeId }) });
  } catch (error) {
    return errorResponse(error);
  }
}

/** Gives a Loyalis a new task. */
export async function POST(request: NextRequest) {
  try {
    const actor = await requireAuthenticatedProfile(request);
    requireRole(actor, LOYALIS_TASK_ASSIGNER_ROLES);
    const body = await request.json().catch(() => null);
    const task = await createLoyalisTask(adminDb, actor, body);
    return NextResponse.json({ task }, { status: 201 });
  } catch (error) {
    return errorResponse(error);
  }
}
