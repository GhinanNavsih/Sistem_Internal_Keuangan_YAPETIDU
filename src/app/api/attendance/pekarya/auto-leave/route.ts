import { NextRequest } from 'next/server';
import { errorResponse, HttpError, requireAuthenticatedProfile } from '@/lib/server/auth';
import { permittedAutoLeaveCategories, reconcilePekaryaAutoLeave } from '@/lib/server/pekaryaAutoLeave';
import { syncPekaryaAttendance } from '@/lib/server/pekaryaAttendanceSync';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

export async function POST(request: NextRequest) {
  try {
    const actor = await requireAuthenticatedProfile(request);
    const body = await request.json().catch(() => null);
    if (!body || typeof body.period !== 'string' || (body.category !== undefined && typeof body.category !== 'string')) {
      throw new HttpError(400, 'Periode dan kategori tidak valid.');
    }
    const period = body.period.trim();
    const categories = permittedAutoLeaveCategories(actor, body.category?.trim().toUpperCase() || 'ALL');
    const summary = await reconcilePekaryaAutoLeave(period, actor, { categories });
    const failed = summary.results.some((result) => result.failed);
    // The Presensi Pekarya page calls this on every load, so it is also where
    // attendance changed outside the attendance commands (a NIPY fixed on Data
    // Pegawai, say) reaches the rekap and the draft slips. When nothing
    // changed the sync only compares fingerprints.
    const sync = failed ? [] : await syncPekaryaAttendance(period, categories, actor, 'page_reconcile', {
      autoLeaveReconciled: true,
    });
    return Response.json({ ...summary, sync, ...(failed ? { error: 'Rekonsiliasi cuti otomatis belum selesai. Muat ulang dan ulangi.' } : {}) },
      { status: failed ? 409 : 200, headers: { 'Cache-Control': 'no-store' } });
  } catch (error) { return errorResponse(error); }
}
