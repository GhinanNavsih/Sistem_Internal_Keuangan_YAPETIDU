import { NextRequest, NextResponse } from 'next/server';
import { adminDb } from '@/lib/firebase-admin';
import {
  errorResponse,
  HttpError,
  requireAuthenticatedProfile,
} from '@/lib/server/auth';

export const dynamic = 'force-dynamic';

/**
 * Returns the authenticated driver's journeys. The client used to call this
 * endpoint while it did not exist, then fall back to a direct Firestore read.
 * Keeping this read behind the Admin SDK gives the report page a reliable,
 * authenticated path without widening browser rules for arbitrary employee
 * IDs.
 */
export async function GET(request: NextRequest) {
  try {
    const actor = await requireAuthenticatedProfile(request);
    if (actor.role !== 'honorer' || !actor.linkedEmployeeId) {
      throw new HttpError(403, 'Hanya akun Sopir yang dapat memuat perjalanan dinas.');
    }
    if (!actor.permittedCategories.includes('SOPIR')) {
      throw new HttpError(403, 'Akun ini tidak terdaftar sebagai Sopir.');
    }

    const requestedDriverId = new URL(request.url).searchParams.get('driverId');
    if (requestedDriverId && requestedDriverId !== actor.linkedEmployeeId) {
      throw new HttpError(403, 'Anda hanya dapat memuat perjalanan milik sendiri.');
    }

    const snapshot = await adminDb
      .collection('DriverJourneys')
      .where('employeeId', '==', actor.linkedEmployeeId)
      .get();

    const journeys = snapshot.docs.map((document) => ({
      id: document.id,
      ...document.data(),
    }));

    return NextResponse.json({ journeys });
  } catch (error) {
    return errorResponse(error);
  }
}
