import { NextRequest } from 'next/server';
import { adminDb } from '@/lib/firebase-admin';
import { errorResponse, HttpError, requireAuthenticatedProfile } from '@/lib/server/auth';
import { setOwnLoyalisTaskStatus } from '@/lib/server/loyalisTasks';

export const dynamic = 'force-dynamic';

const SAFE_ID = /^[A-Za-z0-9]{1,64}$/;

type Context = { params: Promise<{ id: string }> };

/** The signed-in Loyalis marks one of their own tasks completed, or open again. */
export async function PATCH(request: NextRequest, context: Context) {
  try {
    const actor = await requireAuthenticatedProfile(request);
    const { id } = await context.params;
    if (!SAFE_ID.test(id)) throw new HttpError(404, 'Tugas tidak ditemukan.');
    const body = await request.json().catch(() => null);
    const task = await setOwnLoyalisTaskStatus(adminDb, actor, id, (body as { status?: unknown } | null)?.status);
    return Response.json({ task }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    return errorResponse(error);
  }
}
