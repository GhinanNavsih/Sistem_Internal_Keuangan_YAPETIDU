import { NextRequest } from 'next/server';
import { adminStorage } from '@/lib/firebase-admin';
import { errorResponse, HttpError, requireAuthenticatedProfile } from '@/lib/server/auth';
import { getUnit, yearRef } from '@/lib/server/satkerFinance';
import { entryReceiptPaths } from '@/lib/satker-finance/core';
import { uploadFileTypeFor } from '@/lib/uploadFileTypes';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  try {
    const actor = await requireAuthenticatedProfile(request);
    const unitId = request.nextUrl.searchParams.get('unitId') || '';
    const academicYear = request.nextUrl.searchParams.get('academicYear') || '';
    const entryId = request.nextUrl.searchParams.get('entryId') || '';
    // A bank reconciliation's statement (rekening koran) is served the same way as a journal's receipt.
    const reconciliationId = request.nextUrl.searchParams.get('reconciliationId') || '';
    await getUnit(actor, unitId);
    const id = reconciliationId || entryId;
    if (!/^[a-zA-Z0-9_-]{4,150}$/.test(id)) throw new HttpError(400, 'ID bukti tidak valid.');
    const snapshot = await yearRef(unitId, academicYear).collection(reconciliationId ? 'bankReconciliations' : 'entries').doc(id).get();
    // A journal may carry several receipts; `index` picks one (the first by default).
    const index = Number(request.nextUrl.searchParams.get('index') ?? 0);
    if (!Number.isInteger(index) || index < 0) throw new HttpError(400, 'Nomor bukti tidak valid.');
    const path = reconciliationId ? snapshot.data()?.statementPath : entryReceiptPaths(snapshot.data() ?? {})[index];
    if (!snapshot.exists || typeof path !== 'string' || !path.startsWith(`satker-finance/${unitId}/${academicYear}/`)) {
      throw new HttpError(404, 'Bukti transaksi tidak ditemukan.');
    }
    const file = adminStorage.bucket().file(path);
    const [metadata] = await file.getMetadata();
    const contentType = metadata.contentType || 'application/octet-stream';
    const type = uploadFileTypeFor(contentType);
    if (!type) throw new HttpError(409, 'Jenis bukti tidak valid.');
    const [buffer] = await file.download();
    return new Response(new Uint8Array(buffer), { headers: {
      'Content-Type': type.mime,
      'Content-Disposition': `inline; filename="bukti-${id}${index ? `-${index + 1}` : ''}.${type.extension}"`,
      'Cache-Control': 'private, no-store, max-age=0',
      'X-Content-Type-Options': 'nosniff',
    } });
  } catch (error) { return errorResponse(error); }
}
