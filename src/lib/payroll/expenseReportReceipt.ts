import { MAX_EXPENSE_REPORT_RECEIPT_BYTES } from './proposalExpenseReports';
import { detectUploadFileType, UPLOAD_TYPES_TEXT } from '@/lib/uploadFileTypes';

const MAX_DIMENSION = 2400;

function receiptName(name: string, extension: string) {
  return `${name.replace(/\.[^/.]+$/, '') || 'bukti'}.${extension}`;
}

function makeCanvas(width: number, height: number) {
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(width));
  canvas.height = Math.max(1, Math.round(height));
  if (!canvas.getContext('2d')) throw new Error('Perangkat tidak mendukung pemrosesan bukti.');
  return canvas;
}

async function imageCanvas(blob: Blob) {
  const url = URL.createObjectURL(blob);
  try {
    const image = await new Promise<HTMLImageElement>((resolve, reject) => {
      const image = new Image();
      image.onload = () => resolve(image);
      image.onerror = () => reject(new Error('Berkas gambar tidak dapat dibaca.'));
      image.src = url;
    });
    const canvas = makeCanvas(image.naturalWidth || image.width, image.naturalHeight || image.height);
    canvas.getContext('2d')!.drawImage(image, 0, 0);
    return canvas;
  } finally {
    URL.revokeObjectURL(url);
  }
}

/** Reduce quality and dimensions until the encoded bytes fit, without an input-size gate. */
async function compressCanvas(canvas: HTMLCanvasElement, maxBytes: number): Promise<Blob> {
  let dimension = Math.min(MAX_DIMENSION, Math.max(canvas.width, canvas.height));
  while (dimension >= 1) {
    const scale = Math.min(1, dimension / Math.max(canvas.width, canvas.height));
    const output = makeCanvas(canvas.width * scale, canvas.height * scale);
    try {
      const context = output.getContext('2d')!;
      context.fillStyle = '#ffffff';
      context.fillRect(0, 0, output.width, output.height);
      context.drawImage(canvas, 0, 0, output.width, output.height);
      for (const quality of [0.9, 0.8, 0.7, 0.6, 0.45]) {
        const blob = await new Promise<Blob>((resolve, reject) => {
          output.toBlob((value) => value ? resolve(value) : reject(new Error('Bukti tidak dapat dikompresi.')), 'image/jpeg', quality);
        });
        if (blob.size <= maxBytes) return blob;
      }
    } finally {
      output.width = output.height = 1;
    }
    if (dimension === 1) break;
    dimension = Math.max(1, Math.floor(dimension * 0.75));
  }
  throw new Error('Bukti tidak dapat dikompresi hingga 1 MB.');
}

interface ReceiptPage {
  canvas: HTMLCanvasElement;
  width: number;
  height: number;
  cleanup?: () => void;
}

/** Keep every page of a PDF or TIFF, with a budget for the entire resulting PDF. */
async function compressedPdf(
  name: string,
  pageCount: number,
  renderPage: (page: number) => Promise<ReceiptPage>,
): Promise<File> {
  const { jsPDF } = await import('jspdf');
  let pageBudget = Math.max(512, Math.floor((MAX_EXPENSE_REPORT_RECEIPT_BYTES - 65536 - pageCount * 2048) / pageCount));
  for (let attempt = 0; attempt < 4; attempt++) {
    let pdf: InstanceType<typeof jsPDF> | undefined;
    for (let index = 0; index < pageCount; index++) {
      const page = await renderPage(index);
      try {
        const jpeg = await compressCanvas(page.canvas, pageBudget);
        const orientation = page.width > page.height ? 'landscape' : 'portrait';
        if (!pdf) pdf = new jsPDF({ unit: 'pt', format: [page.width, page.height], orientation, compress: true });
        else pdf.addPage([page.width, page.height], orientation);
        pdf.addImage(new Uint8Array(await jpeg.arrayBuffer()), 'JPEG', 0, 0, page.width, page.height);
      } finally {
        page.canvas.width = page.canvas.height = 1;
        page.cleanup?.();
      }
    }
    if (!pdf) throw new Error('Berkas tidak berisi halaman yang dapat dibaca.');
    const file = new File([pdf.output('arraybuffer')], receiptName(name, 'pdf'), { type: 'application/pdf' });
    if (file.size <= MAX_EXPENSE_REPORT_RECEIPT_BYTES) return file;
    pageBudget = Math.max(512, Math.floor(pageBudget * MAX_EXPENSE_REPORT_RECEIPT_BYTES / file.size * 0.85));
  }
  throw new Error('Seluruh halaman bukti tidak dapat dikompresi hingga 1 MB.');
}

/** Accept the shared receipt formats by their bytes; only processed files cross the network. */
export async function prepareExpenseReportReceipt(file: File): Promise<File> {
  if (!file.size) throw new Error('Berkas bukti kosong.');
  const type = detectUploadFileType(new Uint8Array(await file.slice(0, 128).arrayBuffer()));
  if (!type) throw new Error(`Jenis berkas tidak didukung. Gunakan ${UPLOAD_TYPES_TEXT}.`);
  const normalized = file.type === type.mime
    ? file
    : new File([file], receiptName(file.name, type.extension), { type: type.mime, lastModified: file.lastModified });

  if (type.extension === 'pdf') {
    if (normalized.size <= MAX_EXPENSE_REPORT_RECEIPT_BYTES) return normalized;
    const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
    pdfjs.GlobalWorkerOptions.workerSrc = `https://unpkg.com/pdfjs-dist@${pdfjs.version}/legacy/build/pdf.worker.min.mjs`;
    const pdf = await pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()) }).promise;
    try {
      return await compressedPdf(file.name, pdf.numPages, async (index) => {
        const page = await pdf.getPage(index + 1);
        const original = page.getViewport({ scale: 1 });
        const viewport = page.getViewport({ scale: Math.min(2, MAX_DIMENSION / Math.max(original.width, original.height)) });
        const canvas = makeCanvas(viewport.width, viewport.height);
        await page.render({ canvas, canvasContext: canvas.getContext('2d')!, viewport, background: '#ffffff' }).promise;
        return { canvas, width: original.width, height: original.height, cleanup: () => { page.cleanup(); } };
      });
    } finally {
      await pdf.destroy();
    }
  }

  let canvas: HTMLCanvasElement;
  if (type.extension === 'heic' || type.extension === 'heif') {
    try {
      const { heicTo } = await import('heic-to/csp');
      canvas = await imageCanvas(await heicTo({ blob: normalized, type: 'image/jpeg', quality: 0.95 }));
    } catch (cause) {
      throw new Error('Berkas HEIC/HEIF tidak dapat dibaca. Pastikan berkas tidak rusak lalu coba lagi.', { cause });
    }
  } else if (type.extension === 'tiff') {
    const { default: UTIF } = await import('utif');
    const buffer = await file.arrayBuffer();
    const pages = UTIF.decode(buffer).filter((page) => page.t256 && page.t257);
    if (!pages.length) throw new Error('Berkas TIFF tidak berisi gambar yang dapat dibaca.');
    const renderPage = async (index: number): Promise<ReceiptPage> => {
      const page = { ...pages[index] };
      UTIF.decodeImage(buffer, page);
      const canvas = makeCanvas(page.width, page.height);
      const pixels = canvas.getContext('2d')!.createImageData(page.width, page.height);
      pixels.data.set(UTIF.toRGBA8(page));
      canvas.getContext('2d')!.putImageData(pixels, 0, 0);
      return { canvas, width: page.width, height: page.height };
    };
    if (pages.length > 1) return compressedPdf(file.name, pages.length, renderPage);
    canvas = (await renderPage(0)).canvas;
  } else {
    if (normalized.size <= MAX_EXPENSE_REPORT_RECEIPT_BYTES) return normalized;
    canvas = await imageCanvas(normalized);
  }
  try {
    return new File([await compressCanvas(canvas, MAX_EXPENSE_REPORT_RECEIPT_BYTES)], receiptName(file.name, 'jpg'), { type: 'image/jpeg' });
  } finally {
    canvas.width = canvas.height = 1;
  }
}
