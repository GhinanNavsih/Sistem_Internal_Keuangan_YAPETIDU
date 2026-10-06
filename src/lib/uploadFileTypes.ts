/**
 * File types accepted by upload features that take a photo or scan (receipts,
 * proofs, attachments). Every such feature should accept this whole list rather
 * than a hand-picked few: phones save HEIC, scanners and bank apps give PDF, and
 * people should not have to convert a file before attaching it. See "File
 * uploads" in UI_THEME_GUIDE.md.
 *
 * The type is read from the file's own first bytes, never from the browser's
 * guess: a HEIC or a scan often arrives with an empty or generic type, and a
 * wrong declared type must not get past validation. Firebase-free and
 * browser-safe, so the page and the API route apply the same rule.
 */

export interface UploadFileType {
  /** Canonical MIME type, used for storage and when the file is served back. */
  mime: string;
  /** File extension without the dot. */
  extension: string;
  /** Short name for messages. */
  label: string;
  /** Whether browsers can show it inline (HEIC/HEIF/TIFF mostly cannot outside Safari). */
  inlinePreview: boolean;
}

const JPEG: UploadFileType = { mime: 'image/jpeg', extension: 'jpg', label: 'JPG', inlinePreview: true };
const PNG: UploadFileType = { mime: 'image/png', extension: 'png', label: 'PNG', inlinePreview: true };
const WEBP: UploadFileType = { mime: 'image/webp', extension: 'webp', label: 'WebP', inlinePreview: true };
const GIF: UploadFileType = { mime: 'image/gif', extension: 'gif', label: 'GIF', inlinePreview: true };
const BMP: UploadFileType = { mime: 'image/bmp', extension: 'bmp', label: 'BMP', inlinePreview: true };
const AVIF: UploadFileType = { mime: 'image/avif', extension: 'avif', label: 'AVIF', inlinePreview: true };
const HEIC: UploadFileType = { mime: 'image/heic', extension: 'heic', label: 'HEIC', inlinePreview: false };
const HEIF: UploadFileType = { mime: 'image/heif', extension: 'heif', label: 'HEIF', inlinePreview: false };
const TIFF: UploadFileType = { mime: 'image/tiff', extension: 'tiff', label: 'TIFF', inlinePreview: false };
const PDF: UploadFileType = { mime: 'application/pdf', extension: 'pdf', label: 'PDF', inlinePreview: true };

export const UPLOAD_FILE_TYPES: readonly UploadFileType[] = [JPEG, PNG, WEBP, GIF, BMP, AVIF, HEIC, HEIF, TIFF, PDF];

/** For `<input type="file" accept>`: types plus extensions, since some browsers report HEIC with no type. */
export const UPLOAD_ACCEPT = [
  ...UPLOAD_FILE_TYPES.map((type) => type.mime),
  'image/jpg', '.jpg', '.jpeg', '.png', '.webp', '.gif', '.bmp', '.avif', '.heic', '.heif', '.tif', '.tiff', '.pdf',
].join(',');

/** For the hint under a file picker. */
export const UPLOAD_TYPES_TEXT = 'JPG, PNG, WebP, HEIC, GIF, PDF, dan format foto lain';

export const MAX_UPLOAD_BYTES = 5 * 1024 * 1024;

const ascii = (bytes: Uint8Array, start: number, end: number) => String.fromCharCode(...bytes.subarray(start, end));
const startsWith = (bytes: Uint8Array, signature: number[]) => signature.every((value, index) => bytes[index] === value);

// Brands of an ISO base media file (`ftyp` box) that make it HEIC/HEIF or AVIF.
const HEIC_BRANDS = ['heic', 'heix', 'hevc', 'hevx', 'heim', 'heis', 'hevm', 'hevs'];
const HEIF_BRANDS = ['mif1', 'msf1'];
const AVIF_BRANDS = ['avif', 'avis'];

/** What the bytes actually are, or null when they are not one of the accepted types. */
export function detectUploadFileType(bytes: Uint8Array): UploadFileType | null {
  if (startsWith(bytes, [0xff, 0xd8, 0xff])) return JPEG;
  if (startsWith(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return PNG;
  if (bytes.length >= 12 && ascii(bytes, 0, 4) === 'RIFF' && ascii(bytes, 8, 12) === 'WEBP') return WEBP;
  if (ascii(bytes, 0, 6) === 'GIF87a' || ascii(bytes, 0, 6) === 'GIF89a') return GIF;
  if (ascii(bytes, 0, 2) === 'BM' && bytes.length > 14) return BMP;
  if (startsWith(bytes, [0x49, 0x49, 0x2a, 0x00]) || startsWith(bytes, [0x4d, 0x4d, 0x00, 0x2a])) return TIFF;
  if (ascii(bytes, 0, 5) === '%PDF-') return PDF;
  if (bytes.length >= 12 && ascii(bytes, 4, 8) === 'ftyp') {
    const brand = ascii(bytes, 8, 12);
    if (AVIF_BRANDS.includes(brand)) return AVIF;
    if (HEIC_BRANDS.includes(brand)) return HEIC;
    if (HEIF_BRANDS.includes(brand)) return HEIF;
  }
  return null;
}

/** The accepted type with this MIME type (or extension, with or without the dot), if any. */
export function uploadFileTypeFor(mimeOrExtension: string): UploadFileType | null {
  const value = mimeOrExtension.trim().toLowerCase().replace(/^\./, '');
  const alias = value === 'image/jpg' || value === 'jpeg' ? 'jpg' : value === 'tif' ? 'tiff' : value;
  return UPLOAD_FILE_TYPES.find((type) => type.mime === alias || type.extension === alias) ?? null;
}

/**
 * Client-side first check before reading a file: its size, and that its name or
 * type is one of the accepted ones. The server still checks the contents.
 */
export function uploadFileProblem(file: { name: string; type: string; size: number }): string | null {
  if (file.size > MAX_UPLOAD_BYTES) return 'Ukuran berkas maksimal 5 MB.';
  const extension = file.name.includes('.') ? file.name.split('.').pop() || '' : '';
  if (!uploadFileTypeFor(file.type) && !uploadFileTypeFor(extension)) {
    return `Jenis berkas tidak didukung. Gunakan ${UPLOAD_TYPES_TEXT}.`;
  }
  return null;
}

/** Splits a base64 data URL; the declared type is ignored on purpose. */
export function parseBase64DataUrl(value: unknown): Buffer | null {
  if (typeof value !== 'string') return null;
  const match = /^data:[^;,]*(?:;[^;,]*)*;base64,([A-Za-z0-9+/=]+)$/.exec(value);
  return match ? Buffer.from(match[1], 'base64') : null;
}
