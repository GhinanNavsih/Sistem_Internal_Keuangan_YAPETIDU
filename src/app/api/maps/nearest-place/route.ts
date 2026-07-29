import { NextRequest } from 'next/server';
import { errorResponse, HttpError, requireAuthenticatedProfile } from '@/lib/server/auth';

export const dynamic = 'force-dynamic';

function coordinate(value: unknown, label: string, min: number, max: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max) {
    throw new HttpError(400, `${label} tidak valid.`);
  }
  return value;
}

export async function POST(request: NextRequest) {
  try {
    await requireAuthenticatedProfile(request);
    const body = await request.json().catch(() => null) as Record<string, unknown> | null;
    const latitude = coordinate(body?.latitude, 'Latitude', -90, 90);
    const longitude = coordinate(body?.longitude, 'Longitude', -180, 180);
    const apiKey = process.env.GOOGLE_MAPS_API_KEY;
    if (!apiKey) throw new HttpError(503, 'Google Maps belum dikonfigurasi.');

    const response = await fetch('https://places.googleapis.com/v1/places:searchNearby', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Goog-Api-Key': apiKey,
        'X-Goog-FieldMask': 'places.id,places.displayName,places.formattedAddress',
      },
      body: JSON.stringify({
        maxResultCount: 1,
        rankPreference: 'DISTANCE',
        languageCode: 'id',
        locationRestriction: {
          circle: { center: { latitude, longitude }, radius: 250 },
        },
      }),
      cache: 'no-store',
    });
    if (!response.ok) {
      console.warn('Google Places nearby lookup failed:', response.status);
      return Response.json({ name: null, address: null, placeId: null }, { headers: { 'Cache-Control': 'no-store' } });
    }
    const data = await response.json() as {
      places?: Array<{ id?: string; displayName?: { text?: string }; formattedAddress?: string }>;
    };
    const place = data.places?.[0];
    return Response.json({
      name: typeof place?.displayName?.text === 'string' ? place.displayName.text : null,
      address: typeof place?.formattedAddress === 'string' ? place.formattedAddress : null,
      placeId: typeof place?.id === 'string' ? place.id : null,
    }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    return errorResponse(error);
  }
}
