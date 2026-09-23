import { NextRequest } from 'next/server';
import { adminDb } from '@/lib/firebase-admin';
import { ATTENDANCE_IMPORTS_COLLECTION } from '@/lib/server/attendanceStore';
import {
  errorResponse,
  HttpError,
  requireAuthenticatedProfile,
} from '@/lib/server/auth';

export const dynamic = 'force-dynamic';

/**
 * Whether this period's shared attendance file has been imported yet.
 *
 * Deliberately open to every authenticated profile: `AttendanceImports` is
 * readable under Firestore rules only by finance roles and
 * `loyalis_admin`, but satker heads and employees need this same
 * fact to know whether their submission is still waiting on the monthly
 * upload. Only the three derived booleans/numbers below are exposed.
 */
export async function GET(request: NextRequest) {
  try {
    await requireAuthenticatedProfile(request);
    const period = request.nextUrl.searchParams.get('period') || '';
    if (!/^\d{4}-\d{2}$/.test(period)) {
      throw new HttpError(400, 'Parameter period wajib berformat YYYY-MM.');
    }
    const [importSnapshot, loyalisPresenceSnapshot] = await Promise.all([
      adminDb.collection(ATTENDANCE_IMPORTS_COLLECTION).doc(period).get(),
      adminDb.collection('LoyalisPresence').doc(period.replace('-', '_')).get(),
    ]);
    const importData = importSnapshot.data();
    const imported = Boolean(importData?.activeRevisionId);
    const stale =
      imported && loyalisPresenceSnapshot.data()?.sourceImportStale === true;
    return Response.json(
      {
        imported,
        revision: Number(importData?.activeRevision || 0),
        ...(stale ? { stale: true } : {}),
      },
      { headers: { 'Cache-Control': 'no-store' } },
    );
  } catch (error) {
    return errorResponse(error);
  }
}
