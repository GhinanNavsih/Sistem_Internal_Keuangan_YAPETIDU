import { randomUUID } from 'crypto';
import { NextRequest, NextResponse } from 'next/server';
import {
  GANTI_LIBUR_MAX_ATTACHMENT_BYTES,
  gantiLiburAttachmentContentType,
  gantiLiburAttachmentStoragePath,
  type GantiLiburAttachment,
} from '@/lib/payroll/gantiLiburAttachments';
import { errorResponse, HttpError, requireAuthenticatedProfile } from '@/lib/server/auth';
import { requireSelfGantiLiburEmployee } from '@/lib/server/gantiLibur';
import { saveUploadedFile } from '@/lib/server/storageUpload';

/**
 * Stores one surat resmi (photo, scan or PDF) for the signed-in Loyalis. The
 * file is only held in the employee's own folder until a ganti libur request
 * names it; the request route reads it back from Storage.
 */
export async function POST(request: NextRequest) {
  try {
    const actor = await requireAuthenticatedProfile(request);
    const employee = await requireSelfGantiLiburEmployee(actor);
    const form = await request.formData();
    const file = form.get('file');

    if (!(file instanceof File)) {
      throw new HttpError(400, 'Berkas wajib disertakan.');
    }
    if (file.size < 1 || file.size > GANTI_LIBUR_MAX_ATTACHMENT_BYTES) {
      throw new HttpError(
        400,
        `Ukuran berkas harus di antara 1 byte dan ${GANTI_LIBUR_MAX_ATTACHMENT_BYTES / (1024 * 1024)} MB.`,
      );
    }
    const contentType = gantiLiburAttachmentContentType(file.name, file.type);
    if (!contentType) {
      throw new HttpError(400, 'Berkas harus berupa gambar (JPG, PNG, HEIC, dll) atau PDF.');
    }

    const name = file.name.trim().slice(0, 200) || 'surat-resmi';
    const path = gantiLiburAttachmentStoragePath(
      employee.id,
      file.name,
      contentType,
      Date.now(),
      randomUUID().slice(0, 8),
    );
    const url = await saveUploadedFile(path, file, actor.uid, {
      contentType,
      customMetadata: { originalName: name },
    });
    const attachment: GantiLiburAttachment = {
      name,
      path,
      url,
      contentType,
      size: file.size,
    };
    return NextResponse.json({ attachment });
  } catch (error) {
    return errorResponse(error);
  }
}
