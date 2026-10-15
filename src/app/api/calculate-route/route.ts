import { NextRequest, NextResponse } from 'next/server';
import {
  errorResponse,
  HttpError,
  requireAuthenticatedProfile,
} from '@/lib/server/auth';
import {
  countDriverJourneyRouteDestinations,
  MAX_DRIVER_JOURNEY_DESTINATIONS,
  MAX_DRIVER_ROUTE_CALCULATION_POINTS,
} from '@/lib/payroll/driverJourney';
import { measureDirectionsRoute } from '@/lib/server/googleDirections';

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  try {
    await requireAuthenticatedProfile(req);
    const body = await req.json();
    const { points } = body;

    if (!Array.isArray(points) || points.length < 2) {
      return NextResponse.json({ error: 'Minimal 2 lokasi harus diisi.' }, { status: 400 });
    }

    if (points.some((point) => typeof point !== 'string')) {
      return NextResponse.json({ error: 'Format lokasi rute tidak valid.' }, { status: 400 });
    }

    // A round trip contains one extra route point because the departure point
    // is appended again as the final destination. Do not count that generated
    // return point against the 25 destinations the user can enter in the UI.
    const activePoints = (points as string[]).map((point) => point.trim()).filter(Boolean);
    if (activePoints.length < 2) {
      return NextResponse.json({ error: 'Minimal 2 lokasi harus diisi.' }, { status: 400 });
    }
    const enteredDestinationCount = countDriverJourneyRouteDestinations(activePoints);
    if (
      enteredDestinationCount > MAX_DRIVER_JOURNEY_DESTINATIONS ||
      activePoints.length > MAX_DRIVER_ROUTE_CALCULATION_POINTS
    ) {
      return NextResponse.json(
        { error: `Maksimal ${MAX_DRIVER_JOURNEY_DESTINATIONS} titik tujuan dapat dihitung.` },
        { status: 400 },
      );
    }
    if (activePoints.some((point) => point.length > 200)) {
      return NextResponse.json(
        { error: 'Setiap lokasi rute maksimal 200 karakter.' },
        { status: 400 },
      );
    }

    const measurement = await measureDirectionsRoute(activePoints);
    return NextResponse.json({
      success: true,
      distanceKm: measurement.distanceKm,
      durationHours: measurement.durationHours,
      legs: measurement.legs,
    });
  } catch (error: unknown) {
    if (error instanceof HttpError) {
      return errorResponse(error);
    }
    console.error('Error in calculate-route API:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Internal Server Error' },
      { status: 500 },
    );
  }
}
