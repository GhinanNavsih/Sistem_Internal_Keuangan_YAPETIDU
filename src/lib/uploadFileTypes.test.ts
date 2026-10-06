import assert from 'node:assert/strict';
import test from 'node:test';
import {
  MAX_UPLOAD_BYTES,
  UPLOAD_ACCEPT,
  detectUploadFileType,
  parseBase64DataUrl,
  uploadFileProblem,
  uploadFileTypeFor,
} from './uploadFileTypes';

const bytes = (...values: (number | string)[]) =>
  Uint8Array.from(values.flatMap((value) => (typeof value === 'number' ? [value] : [...value].map((char) => char.charCodeAt(0)))));
const pad = (head: Uint8Array, total = 32) => Uint8Array.from([...head, ...new Array(Math.max(0, total - head.length)).fill(0)]);
const ftyp = (brand: string) => pad(bytes(0, 0, 0, 24, 'ftyp', brand));

test('every accepted type is recognised by its own first bytes', () => {
  const samples: [Uint8Array, string][] = [
    [pad(bytes(0xff, 0xd8, 0xff, 0xe0)), 'image/jpeg'],
    [pad(bytes(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a)), 'image/png'],
    [pad(bytes('RIFF', 0, 0, 0, 0, 'WEBPVP8 ')), 'image/webp'],
    [pad(bytes('GIF89a')), 'image/gif'],
    [pad(bytes('BM')), 'image/bmp'],
    [pad(bytes(0x49, 0x49, 0x2a, 0x00)), 'image/tiff'],
    [pad(bytes(0x4d, 0x4d, 0x00, 0x2a)), 'image/tiff'],
    [pad(bytes('%PDF-1.7')), 'application/pdf'],
    [ftyp('heic'), 'image/heic'],
    [ftyp('heix'), 'image/heic'],
    [ftyp('mif1'), 'image/heif'],
    [ftyp('avif'), 'image/avif'],
  ];
  for (const [sample, mime] of samples) assert.equal(detectUploadFileType(sample)?.mime, mime, mime);
});

test('anything else is refused, whatever it claims to be', () => {
  assert.equal(detectUploadFileType(bytes('MZ', 0x90, 0)), null, 'a program');
  assert.equal(detectUploadFileType(pad(bytes('<html>'))), null);
  assert.equal(detectUploadFileType(pad(bytes('PK', 3, 4))), null, 'a zip or office file');
  assert.equal(detectUploadFileType(ftyp('mp42')), null, 'a video');
  assert.equal(detectUploadFileType(new Uint8Array()), null);
  assert.equal(detectUploadFileType(bytes('RIFF', 0, 0, 0, 0, 'WAVEfmt ')), null, 'RIFF audio is not WebP');
});

test('HEIC and scans are named so the page can say they have no inline preview', () => {
  assert.equal(detectUploadFileType(ftyp('heic'))?.inlinePreview, false);
  assert.equal(detectUploadFileType(pad(bytes(0xff, 0xd8, 0xff)))?.inlinePreview, true);
  assert.equal(detectUploadFileType(pad(bytes('%PDF-1.4')))?.inlinePreview, true);
});

test('types are looked up by MIME type or extension, with or without the dot', () => {
  assert.equal(uploadFileTypeFor('image/jpeg')?.extension, 'jpg');
  assert.equal(uploadFileTypeFor('image/jpg')?.mime, 'image/jpeg');
  assert.equal(uploadFileTypeFor('.JPEG')?.mime, 'image/jpeg');
  assert.equal(uploadFileTypeFor('heic')?.mime, 'image/heic');
  assert.equal(uploadFileTypeFor('tif')?.mime, 'image/tiff');
  assert.equal(uploadFileTypeFor('exe'), null);
  assert.equal(uploadFileTypeFor(''), null);
});

test('the picker lists types and extensions, since HEIC often has no type', () => {
  for (const wanted of ['image/jpeg', 'image/heic', 'application/pdf', '.heic', '.jpeg', '.pdf']) {
    assert.ok(UPLOAD_ACCEPT.split(',').includes(wanted), wanted);
  }
});

test('a file is checked by size, then by type or extension', () => {
  assert.equal(uploadFileProblem({ name: 'nota.jpg', type: 'image/jpeg', size: 1000 }), null);
  assert.equal(uploadFileProblem({ name: 'IMG_0001.HEIC', type: '', size: 1000 }), null, 'a HEIC with no type');
  assert.equal(uploadFileProblem({ name: 'nota', type: 'application/pdf', size: 1000 }), null);
  assert.match(uploadFileProblem({ name: 'nota.jpg', type: 'image/jpeg', size: MAX_UPLOAD_BYTES + 1 })!, /5 MB/);
  assert.match(uploadFileProblem({ name: 'program.exe', type: 'application/x-msdownload', size: 10 })!, /tidak didukung/);
  assert.match(uploadFileProblem({ name: 'tanpa-ekstensi', type: '', size: 10 })!, /tidak didukung/);
});

test('a data URL is read whatever type it declares, including none', () => {
  const body = Buffer.from('hello').toString('base64');
  for (const prefix of ['data:image/png;base64,', 'data:application/octet-stream;base64,', 'data:;base64,', 'data:image/heic;name=a.heic;base64,']) {
    assert.equal(parseBase64DataUrl(`${prefix}${body}`)?.toString(), 'hello', prefix);
  }
  assert.equal(parseBase64DataUrl('data:image/png,hello'), null);
  assert.equal(parseBase64DataUrl('hello'), null);
  assert.equal(parseBase64DataUrl(42), null);
});
