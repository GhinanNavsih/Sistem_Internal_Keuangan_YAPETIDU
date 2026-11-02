import { NextRequest } from 'next/server';
import { errorResponse, HttpError, requireAuthenticatedProfile } from '@/lib/server/auth';
import { permittedAutoLeaveCategories, reconcilePekaryaAutoLeave } from '@/lib/server/pekaryaAutoLeave';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

export async function POST(request: NextRequest) {
  try {
    const actor = await requireAuthenticatedProfile(request);
    const body = await request.json().catch(() => null);
    if (!body || typeof body.period !== 'string' || (body.category !== undefined && typeof body.category !== 'string')) {
      throw new HttpError(400, 'Periode dan kategori tidak valid.');
    }
    const categories = permittedAutoLeaveCategories(actor, body.category?.trim().toUpperCase() || 'ALL');
    const summary = await reconcilePekaryaAutoLeave(body.period.trim(), actor, { categories });
    const failed = summary.results.some((result) => result.failed);
    return Response.json({ ...summary, ...(failed ? { error: 'Rekonsiliasi cuti otomatis belum selesai. Muat ulang dan ulangi.' } : {}) },
      { status: failed ? 409 : 200, headers: { 'Cache-Control': 'no-store' } });
  } catch (error) { return errorResponse(error); }
}
