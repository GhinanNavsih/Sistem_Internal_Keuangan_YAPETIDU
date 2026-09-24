/**
 * Surat resmi (official letter) attached to a ganti libur request: a photo,
 * scan or PDF of the letter that had the employee work on the holiday. The
 * files live in Firebase Storage under `ganti_libur/{employeeId}/`; a request
 * keeps only what the server read back from those objects.
 */

export const GANTI_LIBUR_MAX_ATTACHMENTS = 5;
export const GANTI_LIBUR_MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024;

/**
 * `image/*` covers every image format the device knows (JPG, PNG, HEIC, ...),
 * so the picker does not need a list. The server also accepts a file by its
 * extension when the browser reports no type, which is how HEIC often arrives.
 */
export const GANTI_LIBUR_ATTACHMENT_ACCEPT = 'image/*,application/pdf';

export interface GantiLiburAttachment {
  name: string;
  /** Storage object path, always under `ganti_libur/{employeeId}/`. */
  path: string;
  /** Permanent token download URL. */
  url: string;
  contentType: string;
  size: number;
}

const EXTENSION_CONTENT_TYPES: Record<string, string> = {
  pdf: 'application/pdf',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  jpe: 'image/jpeg',
  jfif: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
  gif: 'image/gif',
  bmp: 'image/bmp',
  tif: 'image/tiff',
  tiff: 'image/tiff',
  avif: 'image/avif',
  heic: 'image/heic',
  heif: 'image/heif',
};

const STORAGE_PREFIX = 'ganti_libur/';

function fileExtension(fileName: string): string {
  const match = /\.([A-Za-z0-9]+)$/.exec(fileName.trim());
  return match ? match[1].toLowerCase() : '';
}

/**
 * The content type to store a file under, or null when it is not an image or
 * a PDF. SVG is refused because it can carry script.
 */
export function gantiLiburAttachmentContentType(
  fileName: string,
  reportedType: string,
): string | null {
  const type = reportedType.split(';')[0].trim().toLowerCase();
  if (type === 'application/pdf' || type === 'application/x-pdf') {
    return 'application/pdf';
  }
  if (type.startsWith('image/')) {
    if (type.startsWith('image/svg')) return null;
    return type === 'image/jpg' ? 'image/jpeg' : type;
  }
  // Only a browser that named no type is second-guessed by the extension; a
  // file it did name (text/html, ...) is not an image however it is called.
  if (type === '' || type === 'application/octet-stream') {
    return EXTENSION_CONTENT_TYPES[fileExtension(fileName)] ?? null;
  }
  return null;
}

/** Why a picked file cannot be attached, or null when its type is fine. */
export function gantiLiburAttachmentTypeIssue(
  fileName: string,
  reportedType: string,
): string | null {
  return gantiLiburAttachmentContentType(fileName, reportedType)
    ? null
    : `Format "${fileName}" tidak didukung. Pilih gambar (JPG, PNG, HEIC, dll) atau PDF.`;
}

function extensionForContentType(contentType: string): string {
  const known = Object.entries(EXTENSION_CONTENT_TYPES).find(
    ([, type]) => type === contentType,
  );
  if (known) return known[0];
  const subtype = contentType.split('/')[1] ?? '';
  return /^[a-z0-9]{1,5}$/.test(subtype) ? subtype : 'img';
}

/**
 * Storage path for one uploaded file. `now` and `unique` keep two files that
 * share a name (or arrive in the same millisecond) from overwriting each other.
 */
export function gantiLiburAttachmentStoragePath(
  employeeId: string,
  fileName: string,
  contentType: string,
  now: number,
  unique: string,
): string {
  const extension = fileExtension(fileName);
  const safeExtension =
    extension in EXTENSION_CONTENT_TYPES
      ? extension
      : extensionForContentType(contentType);
  const base = fileName
    .replace(/\.[^/.]+$/, '')
    .replace(/[^A-Za-z0-9_-]/g, '_')
    .slice(0, 60);
  const safeUnique = unique.replace(/[^A-Za-z0-9]/g, '').slice(0, 12) || '0';
  // A name with no letters or digits would leave only underscores.
  const safeBase = /[A-Za-z0-9]/.test(base) ? base : 'surat';
  return `${STORAGE_PREFIX}${employeeId}/${now}_${safeUnique}_${safeBase}.${safeExtension}`;
}

/** True only for a file directly inside this employee's own folder. */
export function isGantiLiburAttachmentPath(employeeId: string, path: unknown): path is string {
  if (typeof path !== 'string') return false;
  const prefix = `${STORAGE_PREFIX}${employeeId}/`;
  if (!path.startsWith(prefix)) return false;
  const filename = path.slice(prefix.length);
  return /^[A-Za-z0-9_.-]{1,200}$/.test(filename) && !filename.includes('..');
}

export type GantiLiburAttachmentPathsResult =
  | { ok: true; paths: string[] }
  | { ok: false; message: string };

/** Checks the attachment paths a submission names before the server trusts them. */
export function parseGantiLiburAttachmentPaths(
  value: unknown,
  employeeId: string,
): GantiLiburAttachmentPathsResult {
  if (value === undefined || value === null) return { ok: true, paths: [] };
  if (!Array.isArray(value)) {
    return { ok: false, message: 'Daftar surat resmi tidak valid.' };
  }
  if (value.length > GANTI_LIBUR_MAX_ATTACHMENTS) {
    return {
      ok: false,
      message: `Surat resmi maksimal ${GANTI_LIBUR_MAX_ATTACHMENTS} berkas.`,
    };
  }
  const paths: string[] = [];
  for (const path of value) {
    if (!isGantiLiburAttachmentPath(employeeId, path)) {
      return { ok: false, message: 'Berkas surat resmi tidak valid.' };
    }
    if (!paths.includes(path)) paths.push(path);
  }
  return { ok: true, paths };
}

/** Attachments as read from a stored request, dropping anything malformed. */
export function coerceGantiLiburAttachments(value: unknown): GantiLiburAttachment[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    if (!item || typeof item !== 'object') return [];
    const { name, path, url, contentType, size } = item as Record<string, unknown>;
    if (
      typeof name !== 'string' ||
      typeof path !== 'string' ||
      typeof url !== 'string' ||
      typeof contentType !== 'string' ||
      typeof size !== 'number' ||
      !Number.isFinite(size)
    ) {
      return [];
    }
    return [{ name, path, url, contentType, size }];
  });
}

export function isPdfAttachment(attachment: Pick<GantiLiburAttachment, 'contentType'>): boolean {
  return attachment.contentType === 'application/pdf';
}

export function formatAttachmentSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
