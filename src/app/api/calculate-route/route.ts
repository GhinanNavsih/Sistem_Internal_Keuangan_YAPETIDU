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

    const apiKey = process.env.GOOGLE_MAPS_API_KEY;
    if (!apiKey) {
      return NextResponse.json({ error: 'Google Maps API Key belum dikonfigurasi di server.' }, { status: 500 });
    }

    const origin = encodeURIComponent(activePoints[0]);
    const destination = encodeURIComponent(activePoints[activePoints.length - 1]);
    
    let url = `https://maps.googleapis.com/maps/api/directions/json?origin=${origin}&destination=${destination}&key=${apiKey}`;
    
    if (activePoints.length > 2) {
      const waypoints = activePoints.slice(1, -1).map(p => encodeURIComponent(p)).join('|');
      url += `&waypoints=${waypoints}`;
    }

    const response = await fetch(url);
    const data = await response.json();

    if (data.status !== 'OK') {
      let errMsg = `Gagal mencari rute (${data.status}).`;
      if (data.status === 'NOT_FOUND') {
        errMsg = 'Salah satu nama tempat tidak dapat ditemukan di Google Maps. Silakan periksa kembali ejaan lokasi Anda.';
      } else if (data.status === 'ZERO_RESULTS') {
        errMsg = 'Rute jalan antara lokasi-lokasi tersebut tidak ditemukan.';
      } else if (data.error_message) {
        errMsg = `${errMsg} Detail: ${data.error_message}`;
      }
      return NextResponse.json({ error: errMsg }, { status: 400 });
    }

    const route = data.routes[0];
    let totalDistanceMeters = 0;
    let totalDurationSeconds = 0;
    const legsDetail = [];

    for (let i = 0; i < route.legs.length; i++) {
      const leg = route.legs[i];
      totalDistanceMeters += leg.distance.value;
      totalDurationSeconds += leg.duration.value;
      legsDetail.push({
        start: leg.start_address,
        end: leg.end_address,
        distanceText: leg.distance.text,
        // Keep enough precision for short routes. The UI formats these values
        // for display, but rounding here can turn a real sub-kilometre trip or
        // a few-minute drive into zero before it reaches the authorization API.
        distanceKm: Math.round((leg.distance.value / 1000) * 1000) / 1000,
        durationText: leg.duration.text,
        durationHours: Math.round((leg.duration.value / 3600) * 1000) / 1000
      });
    }

    // Retain precision for validation and wage calculations. Consumers should
    // format these values when presenting them to users.
    const distanceKm = Math.round((totalDistanceMeters / 1000) * 1000) / 1000;
    const durationHours = Math.round((totalDurationSeconds / 3600) * 1000) / 1000;

    return NextResponse.json({
      success: true,
      distanceKm,
      durationHours,
      legs: legsDetail
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
