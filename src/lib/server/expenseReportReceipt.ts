import sharp from 'sharp';
import { HttpError } from '@/lib/server/auth';
import { MAX_EXPENSE_REPORT_RECEIPT_BYTES } from '@/lib/payroll/proposalExpenseReports';

const INITIAL_MAX_DIMENSION = 1600;
const MIN_MAX_DIMENSION = 500;
const INITIAL_JPEG_QUALITY = 82;

function safeJpegBaseName(fileName: string): string {
  return fileName.replace(/\.[^/.]+$/, '').replace(/[^A-Za-z0-9_-]/g, '_') || 'bukti';
}

/**
 * Compresses an oversized image receipt before it reaches Firebase Storage.
 * PDFs are already rasterized by the browser uploader; oversized PDFs sent
 * directly to this endpoint are rejected rather than stored uncompressed.
 */
export async function compressExpenseReportReceipt(file: File): Promise<File> {
  if (file.size <= MAX_EXPENSE_REPORT_RECEIPT_BYTES) return file;

  if (file.type === 'application/pdf') {
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
