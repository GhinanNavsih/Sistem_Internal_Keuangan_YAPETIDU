import { parseImageExif } from '@/lib/exif';
import type { PhotoAuditMetadata } from '@/lib/payroll/domain';

export const MAX_PROOF_IMAGE_BYTES = 5 * 1024 * 1024;
export const PROOF_IMAGE_MAX_DIMENSION = 1280;
export const PROOF_IMAGE_JPEG_QUALITY = 0.75;

export type { PhotoAuditMetadata, PhotoEvidence } from '@/lib/payroll/domain';

export interface PreparedProofImage {
  file: File;
  auditMetadata: PhotoAuditMetadata;
}

function nullableString(value: unknown, maxLength: number): string | null {
  return typeof value === 'string' && value.trim() && value.trim().length <= maxLength
    ? value.trim()
    : null;
}

export function normalizePhotoAuditMetadata(input: Partial<PhotoAuditMetadata> | undefined): PhotoAuditMetadata {
  const latitude = typeof input?.latitude === 'number' && Number.isFinite(input.latitude)
    ? input.latitude
    : null;
  const longitude = typeof input?.longitude === 'number' && Number.isFinite(input.longitude)
    ? input.longitude
    : null;

  return {
    capturedAt: nullableString(input?.capturedAt, 64),
    latitude: latitude !== null && latitude >= -90 && latitude <= 90 ? latitude : null,
    longitude: longitude !== null && longitude >= -180 && longitude <= 180 ? longitude : null,
    deviceName: nullableString(input?.deviceName, 200),
    hasExif: Boolean(input?.hasExif),
    locationName: nullableString(input?.locationName, 200),
    locationAddress: nullableString(input?.locationAddress, 500),
    locationPlaceId: nullableString(input?.locationPlaceId, 200),
  };
}

export async function extractPhotoAuditMetadata(file: File): Promise<PhotoAuditMetadata> {
  const exif = await parseImageExif(file);
  const deviceName = [exif.make, exif.model].filter(Boolean).join(' ').trim() || null;
  return normalizePhotoAuditMetadata({
    capturedAt: exif.isoDateString || null,
    latitude: exif.latitude ?? null,
    longitude: exif.longitude ?? null,
    deviceName,
    hasExif: exif.hasExif,
  });
}

function compressedFileName(fileName: string): string {
  const base = fileName.replace(/\.[^/.]+$/, '').replace(/[^A-Za-z0-9_-]/g, '_') || 'bukti';
  return `${base}.jpg`;
}

async function loadImage(file: File): Promise<{ source: CanvasImageSource; width: number; height: number; dispose: () => void }> {
  if ('createImageBitmap' in window) {
    try {
      const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
      return {
        source: bitmap,
        width: bitmap.width,
        height: bitmap.height,
        dispose: () => bitmap.close(),
      };
    } catch {
      // Fall back to <img>; it supports a few formats that createImageBitmap does not.
    }
  }

  const objectUrl = URL.createObjectURL(file);
  try {
    const image = await new Promise<HTMLImageElement>((resolve, reject) => {
      const element = new Image();
      element.onload = () => resolve(element);
      element.onerror = () => reject(new Error('Format gambar tidak dapat diproses. Gunakan JPG, PNG, atau WebP.'));
      element.src = objectUrl;
    });
    return {
      source: image,
      width: image.naturalWidth,
      height: image.naturalHeight,
      dispose: () => URL.revokeObjectURL(objectUrl),
    };
  } catch (error) {
    URL.revokeObjectURL(objectUrl);
    throw error;
  }
}

async function canvasToJpeg(canvas: HTMLCanvasElement, quality: number): Promise<Blob> {
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', quality));
  if (!blob) throw new Error('Gagal mengompresi gambar bukti.');
  return blob;
}

export async function compressProofImage(file: File): Promise<File> {
  if (!file.type.startsWith('image/')) {
    throw new Error('Bukti harus berupa gambar JPG, PNG, atau WebP.');
  }

  const image = await loadImage(file);
  try {
    if (!image.width || !image.height) throw new Error('Ukuran gambar tidak valid.');
    const scale = Math.min(1, PROOF_IMAGE_MAX_DIMENSION / Math.max(image.width, image.height));
    const width = Math.max(1, Math.round(image.width * scale));
    const height = Math.max(1, Math.round(image.height * scale));
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext('2d');
    if (!context) throw new Error('Perangkat tidak mendukung kompresi gambar.');
    context.drawImage(image.source, 0, 0, width, height);
    const blob = await canvasToJpeg(canvas, PROOF_IMAGE_JPEG_QUALITY);
    if (blob.size > MAX_PROOF_IMAGE_BYTES) {
      throw new Error('Foto masih lebih dari 5 MB setelah dikompresi. Pilih foto lain yang lebih kecil.');
    }
    return new File([blob], compressedFileName(file.name), { type: 'image/jpeg', lastModified: Date.now() });
  } finally {
    image.dispose();
  }
}

async function resolveNearestPlace(metadata: PhotoAuditMetadata): Promise<PhotoAuditMetadata> {
  if (metadata.latitude === null || metadata.longitude === null) return metadata;
  try {
    const response = await fetch('/api/maps/nearest-place', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ latitude: metadata.latitude, longitude: metadata.longitude }),
    });
    if (!response.ok) return metadata;
    const place = await response.json() as { name?: string; address?: string; placeId?: string };
    return normalizePhotoAuditMetadata({
      ...metadata,
      locationName: place.name ?? null,
      locationAddress: place.address ?? null,
      locationPlaceId: place.placeId ?? null,
    });
  } catch {
    // Place lookup improves the audit label but must never block proof upload.
    return metadata;
  }
}

export async function prepareProofImage(file: File): Promise<PreparedProofImage> {
  const [auditMetadata, compressedFile] = await Promise.all([
    extractPhotoAuditMetadata(file),
    compressProofImage(file),
  ]);
  return {
    file: compressedFile,
    auditMetadata: await resolveNearestPlace(auditMetadata),
  };
}
