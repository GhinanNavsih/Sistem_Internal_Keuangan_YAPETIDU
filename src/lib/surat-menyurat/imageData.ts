import { LETTER_MAX_IMAGE_CHARS } from './letterDoc';

const ACCEPTED = ['image/png', 'image/jpeg', 'image/webp'];
const MAX_SOURCE_BYTES = 12 * 1024 * 1024;
const START_SIDE = 1000;

export const LETTER_IMAGE_ACCEPT = ACCEPTED.join(',');

function load(file: File): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const image = new window.Image();
    image.onload = () => {
      URL.revokeObjectURL(url);
      resolve(image);
    };
    image.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('Gambar tidak dapat dibuka.'));
    };
    image.src = url;
  });
}

/**
 * Reads a picture as a small data URL that is stored inside the letter itself, so the letter needs no
 * separate file. The picture is scaled down until it fits the size one letter may hold.
 */
export async function imageToDataUrl(file: File): Promise<string> {
  if (!ACCEPTED.includes(file.type)) throw new Error('Gambar harus berformat PNG, JPG, atau WebP.');
  if (file.size > MAX_SOURCE_BYTES) throw new Error('Ukuran gambar terlalu besar (maksimal 12 MB).');
  const image = await load(file);
  // PNG may carry transparency (a stamp, say), so it stays PNG; photos become JPEG.
  const mime = file.type === 'image/png' ? 'image/png' : 'image/jpeg';

  let side = START_SIDE;
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const scale = Math.min(1, side / Math.max(image.naturalWidth, image.naturalHeight));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
    canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
    const context = canvas.getContext('2d');
    if (!context) throw new Error('Gambar tidak dapat diproses.');
    if (mime === 'image/jpeg') {
      context.fillStyle = '#ffffff';
      context.fillRect(0, 0, canvas.width, canvas.height);
    }
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    const dataUrl = canvas.toDataURL(mime, 0.85);
    if (dataUrl.length <= LETTER_MAX_IMAGE_CHARS * 0.7) return dataUrl;
    side = Math.round(side * 0.75);
  }
  throw new Error('Gambar terlalu besar untuk disimpan dalam surat.');
}
