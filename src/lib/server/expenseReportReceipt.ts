import sharp from 'sharp';
import { HttpError } from '@/lib/server/auth';
import { MAX_EXPENSE_REPORT_RECEIPT_BYTES } from '@/lib/payroll/proposalExpenseReports';
import { detectUploadFileType, UPLOAD_TYPES_TEXT } from '@/lib/uploadFileTypes';

const INITIAL_MAX_DIMENSION = 1600;
const MIN_MAX_DIMENSION = 500;
const INITIAL_JPEG_QUALITY = 82;

function safeJpegBaseName(fileName: string): string {
  return fileName.replace(/\.[^/.]+$/, '').replace(/[^A-Za-z0-9_-]/g, '_') || 'bukti';
}

/**
 * Compresses an oversized image receipt before it reaches Firebase Storage.
 * The browser prepares PDFs with all pages retained; oversized PDFs sent
 * directly to this endpoint must be prepared through that uploader first.
 */
export async function compressExpenseReportReceipt(file: File): Promise<File> {
  if (!file.size) throw new HttpError(400, 'Berkas bukti kosong.');
  const detected = detectUploadFileType(new Uint8Array(await file.slice(0, 128).arrayBuffer()));
  if (!detected) throw new HttpError(400, `Jenis berkas tidak didukung. Gunakan ${UPLOAD_TYPES_TEXT}.`);
  const canonicalName = `${file.name.replace(/\.[^/.]+$/, '') || 'bukti'}.${detected.extension}`;
  const normalized = file.type === detected.mime && file.name === canonicalName
    ? file
    : new File([file], canonicalName, { type: detected.mime, lastModified: file.lastModified });
  if (normalized.size <= MAX_EXPENSE_REPORT_RECEIPT_BYTES) return normalized;

  if (detected.extension === 'pdf') {
    throw new HttpError(400, 'Bukti PDF harus berukuran maksimal 1MB.');
  }

  const source = Buffer.from(await file.arrayBuffer());
  let maxDimension = INITIAL_MAX_DIMENSION;
  let quality = INITIAL_JPEG_QUALITY;

  try {
    for (let attempt = 0; attempt < 12; attempt += 1) {
      const compressed = await sharp(source)
        .rotate()
        .resize({
          width: maxDimension,
          height: maxDimension,
          fit: 'inside',
          withoutEnlargement: true,
        })
        .jpeg({ quality, mozjpeg: true })
        .toBuffer();

      if (compressed.byteLength <= MAX_EXPENSE_REPORT_RECEIPT_BYTES) {
        const fileBytes = new ArrayBuffer(compressed.byteLength);
        new Uint8Array(fileBytes).set(compressed);
        return new File([fileBytes], `${safeJpegBaseName(file.name)}.jpg`, {
          type: 'image/jpeg',
          lastModified: Date.now(),
        });
      }

      if (quality > 40) {
        quality = Math.max(40, quality - 10);
      } else if (maxDimension > MIN_MAX_DIMENSION) {
        maxDimension = Math.max(MIN_MAX_DIMENSION, Math.round(maxDimension * 0.75));
        quality = 70;
      } else {
        quality = Math.max(20, quality - 5);
      }
    }
  } catch {
    throw new HttpError(400, 'Bukti gambar tidak dapat dikompresi.');
  }

  throw new HttpError(400, 'Bukti gambar masih melebihi batas 1MB setelah dikompresi.');
}
