import { NextRequest, NextResponse } from 'next/server';
import { adminDb } from '@/lib/firebase-admin';
import { LOYALIS_TASK_ASSIGNER_ROLES } from '@/lib/payroll/roles';
import { errorResponse, HttpError, requireAuthenticatedProfile, requireRole } from '@/lib/server/auth';
import { deleteLoyalisTask, updateLoyalisTask } from '@/lib/server/loyalisTasks';

export const dynamic = 'force-dynamic';

const SAFE_ID = /^[A-Za-z0-9]{1,64}$/;

type Context = { params: Promise<{ id: string }> };

async function taskId(context: Context): Promise<string> {
  const { id } = await context.params;
  if (!SAFE_ID.test(id)) throw new HttpError(404, 'Tugas tidak ditemukan.');
  return id;
}

/** Edits a task's wording and due date; `status` reopens or completes it. */
export async function PUT(request: NextRequest, context: Context) {
  try {
    const actor = await requireAuthenticatedProfile(request);
    requireRole(actor, LOYALIS_TASK_ASSIGNER_ROLES);
    const id = await taskId(context);
    const body = await request.json().catch(() => null);
    return NextResponse.json({ task: await updateLoyalisTask(adminDb, actor, id, body) });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function DELETE(request: NextRequest, context: Context) {
  try {
    const actor = await requireAuthenticatedProfile(request);
    requireRole(actor, LOYALIS_TASK_ASSIGNER_ROLES);
    await deleteLoyalisTask(adminDb, await taskId(context));
    return NextResponse.json({ ok: true });
  } catch (error) {
    return errorResponse(error);
  }
}
