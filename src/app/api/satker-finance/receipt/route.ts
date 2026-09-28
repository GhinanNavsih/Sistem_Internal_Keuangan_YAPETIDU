import { NextRequest } from 'next/server';
import { adminStorage } from '@/lib/firebase-admin';
import { errorResponse, HttpError, requireAuthenticatedProfile } from '@/lib/server/auth';
import { getUnit, yearRef } from '@/lib/server/satkerFinance';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  try {
    const actor = await requireAuthenticatedProfile(request);
    const unitId = request.nextUrl.searchParams.get('unitId') || '';
    const academicYear = request.nextUrl.searchParams.get('academicYear') || '';
    const entryId = request.nextUrl.searchParams.get('entryId') || '';
    await getUnit(actor, unitId);
    if (!/^[a-zA-Z0-9_-]{8,100}$/.test(entryId)) throw new HttpError(400, 'ID jurnal tidak valid.');
    const snapshot = await yearRef(unitId, academicYear).collection('entries').doc(entryId).get();
    const path = snapshot.data()?.receiptPath;
    if (!snapshot.exists || typeof path !== 'string' || !path.startsWith(`satker-finance/${unitId}/${academicYear}/`)) {
      throw new HttpError(404, 'Bukti transaksi tidak ditemukan.');
    }
    const file = adminStorage.bucket().file(path);
    const [metadata] = await file.getMetadata();
    const contentType = metadata.contentType || 'application/octet-stream';
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(contentType)) throw new HttpError(409, 'Jenis bukti tidak valid.');
    const [buffer] = await file.download();
    return new Response(new Uint8Array(buffer), { headers: {
      'Content-Type': contentType,
      'Content-Disposition': `inline; filename="bukti-${entryId}.${contentType.split('/')[1]}"`,
      'Cache-Control': 'private, no-store, max-age=0',
      'X-Content-Type-Options': 'nosniff',
    } });
  } catch (error) { return errorResponse(error); }
}
