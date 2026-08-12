import { NextRequest, NextResponse } from 'next/server';
import { FINANCE_ROLES } from '@/lib/payroll/roles';
import { errorResponse, HttpError, requireAuthenticatedProfile } from '@/lib/server/auth';
import { assertValidProofFile, saveUploadedFile, sanitizePathSegment } from '@/lib/server/storageUpload';

export async function POST(request: NextRequest) {
  try {
    const actor = await requireAuthenticatedProfile(request);
    const form = await request.formData();
    const reportId = String(form.get('reportId') || '');
    const headerRowId = String(form.get('headerRowId') || '');
    const file = form.get('file');

    if (!reportId || !headerRowId) {
      throw new HttpError(400, 'ID laporan dan baris header wajib diisi.');
    }
    assertValidProofFile(file, 10 * 1024 * 1024, { allowPdf: true });

    const isFinance = FINANCE_ROLES.includes(actor.role);
    if (!isFinance && actor.role !== 'satker_head_loyalis') {
      throw new HttpError(403, 'Anda tidak memiliki kewenangan untuk mengunggah berkas ini.');
    }

    const ext = file.name.split('.').pop() || 'jpg';
    const safeReportId = sanitizePathSegment(reportId);
    const safeHeaderRowId = sanitizePathSegment(headerRowId);
    const storagePath = `expense_report_receipts/${safeReportId}/${safeHeaderRowId}_${Date.now()}.${ext}`;
    const url = await saveUploadedFile(storagePath, file, actor.uid);
    return NextResponse.json({ url, fileName: file.name });
  } catch (error) {
    return errorResponse(error);
  }
}
