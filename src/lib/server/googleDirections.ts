import { HttpError } from '@/lib/server/auth';
import type { RouteLeg, RouteMeasurement } from '@/lib/driverJourneySimulation';

/**
 * Measures a driving route with Google Directions: total distance and Google's
 * driving time, leg by leg. This is the one measurement behind the sopir's
 * journey report, journey authorization and the Simulasi Biaya Perjalanan, so
 * the same stops always give the same kilometres. Points are addresses or
 * "lat,lng" strings, already validated by the caller.
 */
export async function measureDirectionsRoute(points: readonly string[]): Promise<RouteMeasurement> {
  if (points.length < 2) {
    throw new HttpError(400, 'Minimal 2 lokasi harus diisi.');
  }
  const apiKey = process.env.GOOGLE_MAPS_API_KEY;
  if (!apiKey) {
    throw new HttpError(500, 'Google Maps API Key belum dikonfigurasi di server.');
  }

  const origin = encodeURIComponent(points[0]);
  const destination = encodeURIComponent(points[points.length - 1]);
  let url = `https://maps.googleapis.com/maps/api/directions/json?origin=${origin}&destination=${destination}&key=${apiKey}`;
  if (points.length > 2) {
    const waypoints = points.slice(1, -1).map((point) => encodeURIComponent(point)).join('|');
    url += `&waypoints=${waypoints}`;
  }

  const response = await fetch(url);
  const data = await response.json();

  if (data.status !== 'OK') {
    let message = `Gagal mencari rute (${data.status}).`;
    if (data.status === 'NOT_FOUND') {
      message = 'Salah satu nama tempat tidak dapat ditemukan di Google Maps. Silakan periksa kembali ejaan lokasi Anda.';
    } else if (data.status === 'ZERO_RESULTS') {
      message = 'Rute jalan antara lokasi-lokasi tersebut tidak ditemukan.';
    } else if (data.error_message) {
      message = `${message} Detail: ${data.error_message}`;
    }
    throw new HttpError(400, message);
  }

  const route = data.routes[0];
  let totalDistanceMeters = 0;
  let totalDurationSeconds = 0;
  const legs: Array<RouteLeg & { distanceText: string; durationText: string }> = [];

  for (const leg of route.legs) {
    totalDistanceMeters += leg.distance.value;
    totalDurationSeconds += leg.duration.value;
    legs.push({
      start: leg.start_address,
      end: leg.end_address,
      distanceText: leg.distance.text,
      // Keep enough precision for short routes. The UI formats these values
      // for display, but rounding here can turn a real sub-kilometre trip or
      // a few-minute drive into zero before it reaches the authorization API.
      distanceKm: Math.round((leg.distance.value / 1000) * 1000) / 1000,
      durationText: leg.duration.text,
      durationHours: Math.round((leg.duration.value / 3600) * 1000) / 1000,
    });
  }

  // Retain precision for validation and wage calculations. Consumers should
  // format these values when presenting them to users.
  return {
    distanceKm: Math.round((totalDistanceMeters / 1000) * 1000) / 1000,
    durationHours: Math.round((totalDurationSeconds / 3600) * 1000) / 1000,
    legs,
  };
}
