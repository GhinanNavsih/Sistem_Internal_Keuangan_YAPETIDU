import { NextRequest, NextResponse } from 'next/server';
import { errorResponse, HttpError, requireAuthenticatedProfile } from '@/lib/server/auth';
import { canManageSuratMenyurat } from '@/lib/payroll/roles';
import { assertValidProofFile, saveUploadedFile } from '@/lib/server/storageUpload';
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
    assertValidProofFile(file, 10 * 1024 * 1024, { allowPdf: true });

    const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 150) || 'berkas_surat';
    const extension = file.type === 'application/pdf' ? 'pdf' : (file.name.split('.').pop() || 'jpg');
    const storagePath = `satker-surat/${actor.uid}/${Date.now()}_${randomUUID().slice(0, 8)}_${safeName}`;

    const url = await saveUploadedFile(storagePath, file, actor.uid, {
      contentType: file.type || 'application/octet-stream',
    });

    return NextResponse.json({
      ok: true,
      attachment: {
        id: randomUUID(),
        name: file.name,
        url,
        contentType: file.type || 'application/octet-stream',
        size: file.size,
        uploadedAt: new Date().toISOString(),
      },
    });
  } catch (error) {
    return errorResponse(error);
  }
}
