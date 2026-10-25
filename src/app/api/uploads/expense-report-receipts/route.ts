import { NextRequest, NextResponse } from 'next/server';
import { FINANCE_ROLES } from '@/lib/payroll/roles';
import { errorResponse, HttpError, requireAuthenticatedProfile } from '@/lib/server/auth';
import { compressExpenseReportReceipt } from '@/lib/server/expenseReportReceipt';
import { saveUploadedFile, sanitizePathSegment } from '@/lib/server/storageUpload';
import { uploadFileTypeFor } from '@/lib/uploadFileTypes';

export async function POST(request: NextRequest) {
  try {
    const actor = await requireAuthenticatedProfile(request);
    const isFinance = FINANCE_ROLES.includes(actor.role);
    if (!isFinance && actor.role !== 'satker_head_loyalis') {
      throw new HttpError(403, 'Anda tidak memiliki kewenangan untuk mengunggah berkas ini.');
    }
    const form = await request.formData();
    const reportId = String(form.get('reportId') || '');
    const headerRowId = String(form.get('headerRowId') || '');
    const file = form.get('file');

    if (!reportId || !headerRowId) {
      throw new HttpError(400, 'ID laporan dan baris header wajib diisi.');
    }
    if (!(file instanceof File)) throw new HttpError(400, 'Berkas wajib disertakan.');

    const storedFile = await compressExpenseReportReceipt(file);
    const ext = uploadFileTypeFor(storedFile.type)!.extension;
    const safeReportId = sanitizePathSegment(reportId);
    const safeHeaderRowId = sanitizePathSegment(headerRowId);
    const storagePath = `expense_report_receipts/${safeReportId}/${safeHeaderRowId}_${Date.now()}.${ext}`;
    const url = await saveUploadedFile(storagePath, storedFile, actor.uid);
    return NextResponse.json({ url, fileName: storedFile.name });
  } catch (error) {
    return errorResponse(error);
  }
}
