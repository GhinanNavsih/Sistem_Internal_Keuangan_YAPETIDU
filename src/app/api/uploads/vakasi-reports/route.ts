import { NextRequest, NextResponse } from 'next/server';
import { randomUUID } from 'node:crypto';
import { FINANCE_ROLES } from '@/lib/payroll/roles';
import { errorResponse, HttpError, requireAuthenticatedProfile } from '@/lib/server/auth';
import { buildFinancialAuditRecord, newFinancialAuditRef } from '@/lib/server/audit';
import { isPayrollPeriodOpen, saveUploadedFile, sanitizePathSegment } from '@/lib/server/storageUpload';
import { detectUploadFileType, MAX_UPLOAD_BYTES, UPLOAD_TYPES_TEXT } from '@/lib/uploadFileTypes';

export async function POST(request: NextRequest) {
  try {
    const actor = await requireAuthenticatedProfile(request);
    const isFinance = FINANCE_ROLES.includes(actor.role);
    if (!isFinance && actor.role !== 'satker_head' && actor.role !== 'satker_head_loyalis') {
      throw new HttpError(403, 'Anda tidak memiliki kewenangan untuk mengunggah berkas ini.');
    }
    const form = await request.formData();
    const period = String(form.get('period') || '');
    const eventSeg = String(form.get('eventSeg') || '');
    const file = form.get('file');

    if (!/^\d{4}-\d{2}$/.test(period)) {
      throw new HttpError(400, 'Periode tidak valid.');
    }
    if (!(file instanceof File)) throw new HttpError(400, 'Berkas wajib disertakan.');
    if (file.size < 1 || file.size > MAX_UPLOAD_BYTES) {
      throw new HttpError(400, 'Ukuran berkas harus di antara 1 byte dan 5 MB.');
    }
    const detected = detectUploadFileType(new Uint8Array(await file.slice(0, 128).arrayBuffer()));
    if (!detected) {
      throw new HttpError(400, `Jenis berkas tidak didukung. Gunakan ${UPLOAD_TYPES_TEXT}.`);
    }
    if (!(await isPayrollPeriodOpen(period))) {
      throw new HttpError(409, `Periode payroll ${period} sudah ditutup.`);
    }

    const safeEventSeg = sanitizePathSegment(eventSeg) || 'event';
    const storagePath = `vakasi_reports/${period}/${safeEventSeg}_${randomUUID()}.${detected.extension}`;
    const url = await saveUploadedFile(storagePath, file, actor.uid, { contentType: detected.mime });
    // Keep a permanent reference even when a draft later replaces or removes
    // this attachment. Evidence in Storage is never deleted by this workflow.
    await newFinancialAuditRef().create(buildFinancialAuditRecord(actor, {
      action: 'VAKASI_REPORT_UPLOADED',
      entityType: 'VakasiReport',
      entityId: storagePath,
      reason: 'Mengunggah laporan bertandatangan.',
      after: { url, fileName: file.name, contentType: detected.mime, size: file.size },
      metadata: { period, eventSeg: safeEventSeg },
    }));
    return NextResponse.json({ url });
  } catch (error) {
    return errorResponse(error);
  }
}
