import { NextRequest, NextResponse } from 'next/server';
import { FINANCE_ROLES } from '@/lib/payroll/roles';
import { errorResponse, HttpError, requireAuthenticatedProfile } from '@/lib/server/auth';
import { assertValidProofFile, isPayrollPeriodOpen, saveUploadedFile, sanitizePathSegment } from '@/lib/server/storageUpload';

export async function POST(request: NextRequest) {
  try {
    const actor = await requireAuthenticatedProfile(request);
    const form = await request.formData();
    const period = String(form.get('period') || '');
    const eventSeg = String(form.get('eventSeg') || '');
    const file = form.get('file');

    if (!/^\d{4}-\d{2}$/.test(period)) {
      throw new HttpError(400, 'Periode tidak valid.');
    }
    assertValidProofFile(file, 10 * 1024 * 1024, { allowPdf: true });

    const isFinance = FINANCE_ROLES.includes(actor.role);
    if (!isFinance && actor.role !== 'satker_head' && actor.role !== 'satker_head_loyalis') {
      throw new HttpError(403, 'Anda tidak memiliki kewenangan untuk mengunggah berkas ini.');
    }
    if (!(await isPayrollPeriodOpen(period))) {
      throw new HttpError(409, `Periode payroll ${period} sudah ditutup.`);
    }

    const ext = file.name.split('.').pop() || 'pdf';
    const safeEventSeg = sanitizePathSegment(eventSeg) || 'event';
    const storagePath = `vakasi_reports/${period}/${safeEventSeg}_${Date.now()}.${ext}`;
    const url = await saveUploadedFile(storagePath, file, actor.uid);
    return NextResponse.json({ url });
  } catch (error) {
    return errorResponse(error);
  }
}
