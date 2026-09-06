import { randomUUID } from 'crypto';
import { adminDb, adminStorage } from '@/lib/firebase-admin';
import { HttpError } from '@/lib/server/auth';

export function assertValidProofFile(
  file: unknown,
  maxBytes: number,
  { allowPdf = false }: { allowPdf?: boolean } = {},
): asserts file is File {
  if (!(file instanceof File)) {
    throw new HttpError(400, 'Berkas wajib disertakan.');
  }
  if (file.size < 1 || file.size > maxBytes) {
    throw new HttpError(400, `Ukuran berkas harus di antara 1 byte dan ${Math.round(maxBytes / (1024 * 1024))} MB.`);
  }
  const contentType = file.type || '';
  const isImage = contentType.startsWith('image/');
  const isPdf = contentType === 'application/pdf';
  if (!isImage && !(allowPdf && isPdf)) {
    throw new HttpError(400, allowPdf ? 'Berkas harus berupa gambar atau PDF.' : 'Berkas harus berupa gambar.');
  }
}

/**
 * Saves a file via the Admin SDK and returns a permanent token-based download
 * URL identical in shape to what the client SDK's getDownloadURL() returns
 * after uploadBytes(). Direct client writes to these paths are no longer
 * possible (see storage.rules) because Storage Rules' cross-service
 * firestore.get()/exists() calls do not work reliably for this project —
 * ownership/role checks now happen here, server-side, against Firestore via
 * the Admin SDK instead.
 */
export async function saveUploadedFile(
  storagePath: string,
  file: File,
  uploadedBy: string,
  { cacheControl }: { cacheControl?: string } = {},
): Promise<string> {
  const buffer = Buffer.from(await file.arrayBuffer());
  const token = randomUUID();
  const bucket = adminStorage.bucket();
  const storageFile = bucket.file(storagePath);
  await storageFile.save(buffer, {
    resumable: false,
    validation: 'crc32c',
    metadata: {
      contentType: file.type || 'application/octet-stream',
      ...(cacheControl ? { cacheControl } : {}),
      metadata: {
        firebaseStorageDownloadTokens: token,
        uploadedBy,
      },
    },
  });
  return `https://firebasestorage.googleapis.com/v0/b/${encodeURIComponent(bucket.name)}/o/${encodeURIComponent(storagePath)}?alt=media&token=${token}`;
}

export async function isPayrollPeriodOpen(period: string): Promise<boolean> {
  if (!/^\d{4}-\d{2}$/.test(period)) return false;
  const snapshot = await adminDb.collection('PayrollPeriods').doc(period).get();
  return snapshot.data()?.attendanceStatus !== 'closed';
}

export function sanitizePathSegment(value: string, maxLength = 180): string {
  return value.replace(/[^A-Za-z0-9_-]/g, '_').slice(0, maxLength);
}
