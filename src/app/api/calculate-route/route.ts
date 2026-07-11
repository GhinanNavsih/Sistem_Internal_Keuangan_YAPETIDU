import { NextRequest, NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { points } = body;

    if (!points || !Array.isArray(points) || points.length < 2) {
      return NextResponse.json({ error: 'Minimal 2 lokasi harus diisi.' }, { status: 400 });
    }

    // Filter out any empty entries
    const activePoints = points.map(p => String(p).trim()).filter(Boolean);
    if (activePoints.length < 2) {
      return NextResponse.json({ error: 'Minimal 2 lokasi valid harus diisi.' }, { status: 400 });
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
        durationText: leg.duration.text
      });
    }

    // Convert to KM (rounded to 1 decimal place) and Hours (rounded to 1 decimal place)
    const distanceKm = Math.round((totalDistanceMeters / 1000) * 10) / 10;
    const durationHours = Math.round((totalDurationSeconds / 3600) * 10) / 10;

    return NextResponse.json({
      success: true,
      distanceKm,
      durationHours,
      legs: legsDetail
    });

  } catch (error: any) {
    console.error('Error in calculate-route API:', error);
    return NextResponse.json({ error: error.message || 'Internal Server Error' }, { status: 500 });
  }
}
