import { NextRequest, NextResponse } from 'next/server';
import { errorResponse, HttpError, requireAuthenticatedProfile } from '@/lib/server/auth';
import { canManageSuratMenyurat } from '@/lib/payroll/roles';
import { saveUploadedFile } from '@/lib/server/storageUpload';
import { detectUploadFileType } from '@/lib/uploadFileTypes';
import { randomUUID } from 'crypto';

export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  try {
    const actor = await requireAuthenticatedProfile(request);
    if (!canManageSuratMenyurat(actor.role)) {
      throw new HttpError(403, 'Anda tidak memiliki hak akses untuk mengunggah berkas surat.');
    }

    const form = await request.formData();
    const file = form.get('file');
    if (!(file instanceof File) || file.size < 1 || file.size > 10 * 1024 * 1024) {
      throw new HttpError(400, 'Ukuran berkas harus di antara 1 byte dan 10 MB.');
    }
    const bytes = Buffer.from(await file.arrayBuffer());
    const detected = detectUploadFileType(bytes);
    if (!detected) throw new HttpError(400, 'Jenis berkas tidak didukung.');
    const validatedFile = new File([bytes], file.name, { type: detected.mime });

    const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 150) || 'berkas_surat';
    const storagePath = `satker-surat/${actor.uid}/${Date.now()}_${randomUUID().slice(0, 8)}_${safeName}`;

    const url = await saveUploadedFile(storagePath, validatedFile, actor.uid, {
      contentType: detected.mime,
    });

    return NextResponse.json({
      ok: true,
      attachment: {
        id: randomUUID(),
        name: file.name,
        url,
        contentType: detected.mime,
        size: file.size,
        uploadedAt: new Date().toISOString(),
      },
    });
  } catch (error) {
    return errorResponse(error);
  }
}
