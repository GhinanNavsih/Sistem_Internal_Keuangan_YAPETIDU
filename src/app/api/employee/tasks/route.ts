import { NextRequest } from 'next/server';
import { adminDb } from '@/lib/firebase-admin';
import { errorResponse, requireAuthenticatedProfile } from '@/lib/server/auth';
import { listOwnLoyalisTasks } from '@/lib/server/loyalisTasks';

export const dynamic = 'force-dynamic';

const responseHeaders = { 'Cache-Control': 'no-store' };

/**
 * The signed-in Loyalis's own tasks. `?countOnly=true` answers just what the
 * menu needs: whether the Daftar Tugas page exists for them, and how many are open.
 */
export async function GET(request: NextRequest) {
  try {
    const actor = await requireAuthenticatedProfile(request);
    const { tasks, hasTasks, openCount } = await listOwnLoyalisTasks(adminDb, actor);
    if (request.nextUrl.searchParams.get('countOnly') === 'true') {
      return Response.json({ hasTasks, openCount }, { headers: responseHeaders });
    }
    return Response.json({ tasks, hasTasks, openCount }, { headers: responseHeaders });
  } catch (error) {
    return errorResponse(error);
  }
}
