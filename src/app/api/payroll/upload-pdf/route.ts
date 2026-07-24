import { NextRequest, NextResponse } from 'next/server';
import { adminDb, adminStorage } from '@/lib/firebase-admin';
import { isTransferEligibleStatus } from '@/lib/payroll/domain';
import { FINANCE_ROLES } from '@/lib/payroll/roles';
import { buildFinancialAuditRecord, newFinancialAuditRef } from '@/lib/server/audit';
import {
  errorResponse,
  HttpError,
  requireAuthenticatedProfile,
  requireRole,
} from '@/lib/server/auth';

export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  try {
    const actor = await requireAuthenticatedProfile(request);
    requireRole(actor, FINANCE_ROLES);
    const body = await request.json();
    const { pdfBase64 } = body;
    const employeeId = typeof body.employeeId === 'string' ? body.employeeId : '';
    const dbPeriod = typeof body.dbPeriod === 'string' ? body.dbPeriod : '';
    const requestId = typeof body.requestId === 'string' ? body.requestId : '';

    if (
      typeof pdfBase64 !== 'string' ||
      !/^[A-Za-z0-9_-]{1,128}$/.test(employeeId) ||
      !/^\d{4}_\d{2}$/.test(dbPeriod) ||
      !/^[A-Za-z0-9_-]{8,128}$/.test(requestId)
    ) {
      throw new HttpError(400, 'PDF, employeeId, dbPeriod, dan requestId wajib valid.');
    }
    const pdfBuffer = Buffer.from(pdfBase64, 'base64');
    if (pdfBuffer.length > 10_000_000 || pdfBuffer.subarray(0, 5).toString('ascii') !== '%PDF-') {
      throw new HttpError(400, 'Berkas wajib berupa PDF valid maksimal 10 MB.');
    }

    const slipId = `${dbPeriod}_${employeeId}`;
    const slipSnapshot = await adminDb.collection('PayrollSlipStates').doc(slipId).get();
    if (!slipSnapshot.exists || !isTransferEligibleStatus(slipSnapshot.data()?.status)) {
      throw new HttpError(409, 'PDF hanya dapat dibuat untuk slip terkunci.');
    }

    const filePath = `payslips/${dbPeriod}/${employeeId}/${requestId}.pdf`;
    const bucket = adminStorage.bucket();
    const file = bucket.file(filePath);

    await file.save(pdfBuffer, {
      resumable: false,
      validation: 'crc32c',
      metadata: {
        contentType: 'application/pdf',
        cacheControl: 'private, no-store, max-age=0',
        metadata: {
          employeeId,
          dbPeriod,
          slipId,
          uploadedBy: actor.uid,
        },
      },
    });

    const expiresAt = Date.now() + 24 * 60 * 60 * 1000;
    const [downloadUrl] = await file.getSignedUrl({
      action: 'read',
      expires: expiresAt,
    });
    await newFinancialAuditRef().create(
      buildFinancialAuditRecord(actor, {
        action: 'PAYSLIP_PDF_LINK_CREATED',
        entityType: 'PayrollSlipState',
        entityId: slipId,
        reason: 'Pembuatan tautan PDF slip final dengan masa berlaku terbatas',
        requestId,
        metadata: { filePath, expiresAt: new Date(expiresAt).toISOString() },
      }),
    );

    return NextResponse.json({
      success: true,
      pdfUrl: downloadUrl,
      expiresAt: new Date(expiresAt).toISOString(),
    });
  } catch (error: unknown) {
    console.error('Server-side Firebase Storage upload error:', error);
    let errorMsg = error instanceof Error ? error.message : 'Gagal mengunggah PDF.';
    if (errorMsg.includes('The specified bucket does not exist') || errorMsg.includes('bucket does not exist')) {
      errorMsg = 'Firebase Storage belum diaktifkan atau diinisialisasi di Firebase Console Anda. Silakan buka menu "Storage" di Firebase Console (https://console.firebase.google.com/project/internal-bak/storage) lalu klik tombol "Get Started" (Mulai) untuk mengaktifkannya agar link PDF dapat disertakan.';
    }
    if (error instanceof HttpError) return errorResponse(error);
    return NextResponse.json({ error: errorMsg }, { status: 500 });
  }
}
