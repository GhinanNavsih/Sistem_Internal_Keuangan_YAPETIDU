export type ReceiptPageImage = { dataUrl: string; width: number; height: number };

/** Longest side a receipt page is drawn at; enough for a legible A4 print without a huge PDF. */
const MAX_SIDE = 1600;

function pageCanvas(width: number, height: number) {
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(width));
  canvas.height = Math.max(1, Math.round(height));
  return canvas;
}

function pageImage(canvas: HTMLCanvasElement): ReceiptPageImage {
  return { dataUrl: canvas.toDataURL('image/jpeg', 0.85), width: canvas.width, height: canvas.height };
}

async function pdfPageImages(blob: Blob): Promise<ReceiptPageImage[]> {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  pdfjs.GlobalWorkerOptions.workerSrc = `https://unpkg.com/pdfjs-dist@${pdfjs.version}/legacy/build/pdf.worker.min.mjs`;
  const pdf = await pdfjs.getDocument({ data: new Uint8Array(await blob.arrayBuffer()) }).promise;
  try {
    const pages: ReceiptPageImage[] = [];
    for (let number = 1; number <= pdf.numPages; number += 1) {
      const page = await pdf.getPage(number);
      const original = page.getViewport({ scale: 1 });
      const viewport = page.getViewport({ scale: Math.min(2, MAX_SIDE / Math.max(original.width, original.height)) });
      const canvas = pageCanvas(viewport.width, viewport.height);
      await page.render({ canvas, canvasContext: canvas.getContext('2d')!, viewport, background: '#ffffff' }).promise;
      pages.push(pageImage(canvas));
      page.cleanup();
    }
    return pages;
  } finally {
    await pdf.destroy();
  }
}

/**
 * The pages of a stored receipt (a photo or a PDF) as JPEG images for a printed PDF. Empty when the
 * browser cannot decode the file; receipts are normalised to JPEG/PNG/WebP/PDF when they are attached,
 * so this is only an older or damaged file.
 */
export async function receiptPageImages(blob: Blob): Promise<ReceiptPageImage[]> {
  try {
    if (blob.type === 'application/pdf') return await pdfPageImages(blob);
    const bitmap = await createImageBitmap(blob);
    try {
      const scale = Math.min(1, MAX_SIDE / Math.max(bitmap.width, bitmap.height));
      const canvas = pageCanvas(bitmap.width * scale, bitmap.height * scale);
      const context = canvas.getContext('2d')!;
      // A transparent PNG would turn black as a JPEG.
      context.fillStyle = '#ffffff';
      context.fillRect(0, 0, canvas.width, canvas.height);
      context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
      return [pageImage(canvas)];
    } finally {
      bitmap.close();
    }
  } catch {
    return [];
  }
}
