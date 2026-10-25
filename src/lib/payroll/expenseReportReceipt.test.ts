import assert from 'node:assert/strict';
import test from 'node:test';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { createCanvas, Image as NativeImage, ImageData, DOMMatrix, Path2D } from '@napi-rs/canvas';
import sharp from 'sharp';
import { jsPDF } from 'jspdf';
import * as UTIF from 'utif';
import { prepareExpenseReportReceipt } from './expenseReportReceipt';
import { MAX_EXPENSE_REPORT_RECEIPT_BYTES as LIMIT } from './proposalExpenseReports';

// Real raster/PDF/HEIC codecs run against a minimal canvas and worker host.
// No browser session, network requests, Firebase, or user files are used.
const blobs = new Map<string, Blob>();
let nextUrl = 0;
function ReceiptImage() {
  const image = new NativeImage();
  const descriptor = Object.getOwnPropertyDescriptor(NativeImage.prototype, 'src')!;
  Object.defineProperty(image, 'src', {
    get: () => descriptor.get!.call(image),
    set: (value: string | Uint8Array) => {
      if (typeof value === 'string' && blobs.has(value)) {
        void blobs.get(value)!.arrayBuffer().then((bytes) => { descriptor.set!.call(image, Buffer.from(bytes)); });
      } else descriptor.set!.call(image, value);
    },
  });
  return image;
}
class ReceiptWorker {
  private listeners = new Map<string, Set<(event: unknown) => void>>();
  private scope: Record<string, unknown>;
  private context: vm.Context;
  private ready: Promise<void>;
  constructor(url: string) {
    this.scope = {
      console, ImageData, setTimeout, clearTimeout, TextDecoder, TextEncoder,
      WorkerGlobalScope: class {}, self: { location: { href: 'http://receipt.test/worker.js' } },
      postMessage: (data: unknown) => {
        for (const listener of this.listeners.get('message') || []) listener({ data, currentTarget: this });
      },
    };
    this.context = vm.createContext(this.scope);
    this.ready = blobs.get(url)!.text().then((code) => { vm.runInContext(code, this.context); });
  }
  postMessage(data: unknown) {
    void this.ready.then(() => {
      const message = data as { id: string; buffer: ArrayBuffer };
      // A real Worker structured-clones the input into its own ArrayBuffer realm.
      this.scope.inputBytes = new Uint8Array(message.buffer);
      const buffer = vm.runInContext('new Uint8Array(inputBytes).buffer', this.context);
      (this.scope.onmessage as (event: unknown) => void)({ data: { ...message, buffer } });
    });
  }
  addEventListener(type: string, listener: (event: unknown) => void) {
    if (!this.listeners.has(type)) this.listeners.set(type, new Set());
    this.listeners.get(type)!.add(listener);
  }
  removeEventListener(type: string, listener: (event: unknown) => void) {
    this.listeners.get(type)?.delete(listener);
  }
}
Object.assign(globalThis, {
  document: { createElement: (tag: string) => {
    assert.equal(tag, 'canvas');
    return createCanvas(1, 1);
  } },
  Image: ReceiptImage, ImageData, DOMMatrix, Path2D, Worker: ReceiptWorker,
});
URL.createObjectURL = (blob) => {
  assert.ok(blob instanceof Blob);
  const url = `blob:receipt-${++nextUrl}`;
  blobs.set(url, blob);
  return url;
};
URL.revokeObjectURL = (url) => { blobs.delete(url); };

function file(bytes: Uint8Array | ArrayBuffer, name: string, type = '') {
  return new File([new Uint8Array(bytes instanceof ArrayBuffer ? bytes : bytes.slice()).buffer], name, { type });
}

test('keeps small common receipt images and PDFs intact, including every PDF page', async () => {
  const canvas = createCanvas(40, 30);
  for (const mime of ['image/png', 'image/jpeg', 'image/webp'] as const) {
    const input = file(mime === 'image/png' ? canvas.toBuffer('image/png') : canvas.toBuffer(mime), `receipt.${mime.split('/')[1]}`, mime);
    assert.equal(await prepareExpenseReportReceipt(input), input);
  }
  const pdf = new jsPDF();
  pdf.text('Page one', 10, 10);
  pdf.addPage();
  pdf.text('Page two', 10, 10);
  const input = file(pdf.output('arraybuffer'), 'receipt.pdf', 'application/pdf');
  assert.equal(await prepareExpenseReportReceipt(input), input);
});

test('detects missing or incorrect browser MIME types and refuses renamed non-images', async () => {
  const png = createCanvas(10, 10).toBuffer('image/png');
  for (const mime of ['', 'application/octet-stream', 'image/heic']) {
    const result = await prepareExpenseReportReceipt(file(png, 'scan.png', mime));
    assert.equal(result.type, 'image/png');
    assert.deepEqual(new Uint8Array(await result.arrayBuffer()), new Uint8Array(png));
  }
  await assert.rejects(prepareExpenseReportReceipt(file(new TextEncoder().encode('not an image'), 'fake.jpg', 'image/jpeg')), /tidak didukung/);
});

test('compresses a real image larger than the former 25MB input cap below 1MB', async () => {
  const canvas = createCanvas(1000, 1500);
  const context = canvas.getContext('2d');
  context.fillStyle = '#ffffff'; context.fillRect(0, 0, 1000, 1500);
  context.fillStyle = '#000000'; context.font = '48px sans-serif'; context.fillText('RECEIPT 123', 60, 120);
  const input = file(Buffer.concat([canvas.toBuffer('image/png'), Buffer.alloc(26 * 1024 * 1024)]), 'large-receipt.png');
  const result = await prepareExpenseReportReceipt(input);
  assert.ok(input.size > 25 * 1024 * 1024);
  assert.ok(result.size <= LIMIT);
  assert.equal(result.type, 'image/jpeg');
  assert.equal(result.name, 'large-receipt.jpg');
  const metadata = await sharp(Buffer.from(await result.arrayBuffer())).metadata();
  assert.equal(metadata.width, 1000);
  assert.equal(metadata.height, 1500);
});

test('converts a TIFF receipt to a viewable JPEG', async () => {
  const pixels = new Uint8Array(16 * 16 * 4).fill(255);
  const result = await prepareExpenseReportReceipt(file(UTIF.encodeImage(pixels, 16, 16), 'scan.tiff'));
  assert.equal(result.type, 'image/jpeg');
  assert.ok(result.size <= LIMIT);
  assert.equal((await sharp(Buffer.from(await result.arrayBuffer())).metadata()).width, 16);
});

test('compresses a detailed oversized image through the quality and dimension fallback', async () => {
  const canvas = createCanvas(1800, 1800);
  const context = canvas.getContext('2d');
  const pixels = context.createImageData(1800, 1800);
  let seed = 12345678;
  for (let index = 0; index < pixels.data.length; index += 4) {
    for (let channel = 0; channel < 3; channel++) {
      seed = (seed * 1664525 + 1013904223) >>> 0;
      pixels.data[index + channel] = seed >>> 24;
    }
    pixels.data[index + 3] = 255;
  }
  context.putImageData(pixels, 0, 0);
  const input = file(canvas.toBuffer('image/png'), 'detailed.png', 'image/png');
  assert.ok(input.size > LIMIT);
  const result = await prepareExpenseReportReceipt(input);
  assert.ok(result.size <= LIMIT);
  assert.equal(result.type, 'image/jpeg');
  const metadata = await sharp(Buffer.from(await result.arrayBuffer())).metadata();
  assert.ok(metadata.width! > 0 && metadata.width! <= 1800);
  assert.equal(metadata.height, metadata.width, 'compression preserves the image aspect ratio');
});

test('decodes a real HEIC receipt with an empty MIME type and stores a JPEG', async () => {
  // Generated from a 32x24 blue/white test image, with macOS ImageIO; no user data.
  const bytes = Buffer.from('AAAAJGZ0eXBoZWljAAAAAG1pZjFNaVBybWlhZk1pSEJoZWljAAABhm1ldGEAAAAAAAAAIWhkbHIAAAAAAAAAAHBpY3QAAAAAAAAAAAAAAAAAAAAAJGRpbmYAAAAcZHJlZgAAAAAAAAABAAAADHVybCAAAAABAAAADnBpdG0AAAAAAAEAAAAjaWluZgAAAAAAAQAAABVpbmZlAgAAAAABAABodmMxAAAAAOZpcHJwAAAAxWlwY28AAAATY29scm5jbHgAAgACAAaAAAAADGNsbGkAywBAAAAAFGlzcGUAAAAAAAAAIAAAABgAAAAJaXJvdAAAAAAQcGl4aQAAAAADCAgIAAAAcWh2Y0MBA3AAAACwAAAAAAAe8AD8/fj4AAALA6AAAQAXQAEMAf//A3AAAAMAsAAAAwAAAwAecCShAAEAI0IBAQNwAAADALAAAAMAAAMAHqAUIEHAgwriHuRZVNwICBgCogABAAlEAcBhcshAUyQAAAAZaXBtYQAAAAAAAAABAAEGgQIDBYaEAAAAHmlsb2MAAAAARAAAAQABAAAAAQAAAboAAACKAAAAAW1kYXQAAAAAAAAAmgAAAIYoAa+j6YARssO7fbuAmvt7o0LMACKYbPELZ8tsJIVCICEMT1KfrFKv87O1tQzPwkulJkym565PfN5wTOiySIotT3z5vxjK1+GGFuHDOA4nKupVT0VJmD0FtMxikProEV3XH5CB//yCc09/cgI2p2PQH3oFR2xx/90UeOLYGneKLyC9Xjn24A==', 'base64');
  const result = await prepareExpenseReportReceipt(file(bytes, 'iphone.heic'));
  assert.equal(result.type, 'image/jpeg');
  assert.equal(result.name, 'iphone.jpg');
  assert.ok(result.size <= LIMIT);
  const metadata = await sharp(Buffer.from(await result.arrayBuffer())).metadata();
  assert.equal(metadata.width, 32);
  assert.equal(metadata.height, 24);
});

test('compresses every page of an oversized PDF and retains portrait and landscape pages', async () => {
  const require = createRequire(import.meta.url);
  const worker = await import(pathToFileURL(require.resolve('pdfjs-dist/legacy/build/pdf.worker.mjs')).href);
  Object.assign(globalThis, { pdfjsWorker: worker });
  const pdf = new jsPDF({ unit: 'pt', format: [400, 600] });
  pdf.setFillColor(220, 0, 0);
  pdf.rect(10, 10, 100, 100, 'F');
  pdf.addPage([600, 400], 'landscape');
  pdf.setFillColor(0, 0, 220);
  pdf.rect(10, 10, 100, 100, 'F');
  const input = file(Buffer.concat([Buffer.from(pdf.output('arraybuffer')), Buffer.alloc(2 * LIMIT)]), 'multipage.pdf');
  const result = await prepareExpenseReportReceipt(input);
  assert.equal(result.type, 'application/pdf');
  assert.ok(result.size <= LIMIT);
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const read = await pdfjs.getDocument({ data: new Uint8Array(await result.arrayBuffer()) }).promise;
  assert.equal(read.numPages, 2);
  assert.equal((await read.getPage(1)).getViewport({ scale: 1 }).width, 400);
  assert.equal((await read.getPage(2)).getViewport({ scale: 1 }).width, 600);
  for (let index = 1; index <= 2; index++) {
    const page = await read.getPage(index);
    const viewport = page.getViewport({ scale: 1 });
    const canvas = createCanvas(viewport.width, viewport.height);
    await page.render({ canvas: canvas as unknown as HTMLCanvasElement, canvasContext: canvas.getContext('2d') as unknown as CanvasRenderingContext2D, viewport }).promise;
    const pixel = canvas.getContext('2d').getImageData(50, 50, 1, 1).data;
    assert.ok(index === 1 ? pixel[0] > 180 && pixel[2] < 50 : pixel[2] > 180 && pixel[0] < 50, 'both pages retain their original contents');
  }
  await read.destroy();
});
