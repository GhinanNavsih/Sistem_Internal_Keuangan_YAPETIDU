import assert from 'node:assert/strict';
import test from 'node:test';
import {
  coerceGantiLiburAttachments,
  formatAttachmentSize,
  gantiLiburAttachmentContentType,
  gantiLiburAttachmentStoragePath,
  gantiLiburAttachmentTypeIssue,
  isGantiLiburAttachmentPath,
  parseGantiLiburAttachmentPaths,
} from './gantiLiburAttachments';

test('images of any format and PDFs are accepted', () => {
  assert.equal(gantiLiburAttachmentContentType('surat.jpg', 'image/jpeg'), 'image/jpeg');
  assert.equal(gantiLiburAttachmentContentType('surat.jpeg', 'image/jpg'), 'image/jpeg');
  assert.equal(gantiLiburAttachmentContentType('surat.png', 'image/png'), 'image/png');
  assert.equal(gantiLiburAttachmentContentType('surat.pdf', 'application/pdf'), 'application/pdf');
  assert.equal(gantiLiburAttachmentContentType('surat.heic', 'image/heic'), 'image/heic');
  assert.equal(gantiLiburAttachmentContentType('surat.webp', 'image/webp; charset=x'), 'image/webp');
  // A format nobody listed is still an image.
  assert.equal(gantiLiburAttachmentContentType('surat.jxl', 'image/jxl'), 'image/jxl');
});

test('a browser that reports no type is read by the file extension', () => {
  assert.equal(gantiLiburAttachmentContentType('IMG_0001.HEIC', ''), 'image/heic');
  assert.equal(gantiLiburAttachmentContentType('scan.heif', 'application/octet-stream'), 'image/heif');
  assert.equal(gantiLiburAttachmentContentType('scan.PDF', ''), 'application/pdf');
  assert.equal(gantiLiburAttachmentContentType('scan.jpg', ''), 'image/jpeg');
  assert.equal(gantiLiburAttachmentContentType('scan.docx', ''), null);
  assert.equal(gantiLiburAttachmentContentType('noextension', ''), null);
});

test('anything else, and SVG, is refused', () => {
  assert.equal(gantiLiburAttachmentContentType('a.svg', 'image/svg+xml'), null);
  assert.equal(gantiLiburAttachmentContentType('a.svg', ''), null);
  assert.equal(gantiLiburAttachmentContentType('a.docx', 'application/msword'), null);
  // A named non-image type is not rescued by an image extension.
  assert.equal(gantiLiburAttachmentContentType('page.jpg', 'text/html'), null);
  assert.match(gantiLiburAttachmentTypeIssue('a.docx', 'application/msword') || '', /tidak didukung/);
  assert.equal(gantiLiburAttachmentTypeIssue('a.jpg', 'image/jpeg'), null);
});

test('storage paths stay in the employee folder and keep files apart', () => {
  const first = gantiLiburAttachmentStoragePath('emp-1', 'Surat Tugas (1).JPG', 'image/jpeg', 1000, 'abc123');
  assert.equal(first, 'ganti_libur/emp-1/1000_abc123_Surat_Tugas__1_.jpg');
  assert.ok(isGantiLiburAttachmentPath('emp-1', first));
  // Same name at the same moment still differs by the unique part.
  assert.notEqual(
    first,
    gantiLiburAttachmentStoragePath('emp-1', 'Surat Tugas (1).JPG', 'image/jpeg', 1000, 'zzz999'),
  );
  // An unknown extension is replaced by one that matches the content type.
  assert.equal(
    gantiLiburAttachmentStoragePath('emp-1', 'scan.exe', 'image/png', 1, 'u'),
    'ganti_libur/emp-1/1_u_scan.png',
  );
  assert.equal(
    gantiLiburAttachmentStoragePath('emp-1', 'noext', 'image/jxl', 1, 'u'),
    'ganti_libur/emp-1/1_u_noext.jxl',
  );
  assert.equal(
    gantiLiburAttachmentStoragePath('emp-1', '....pdf', 'application/pdf', 1, 'u'),
    'ganti_libur/emp-1/1_u_surat.pdf',
  );
});

test('only a file directly inside the employee\'s own folder is a valid attachment path', () => {
  assert.ok(isGantiLiburAttachmentPath('emp-1', 'ganti_libur/emp-1/1_u_scan.png'));
  assert.equal(isGantiLiburAttachmentPath('emp-1', 'ganti_libur/emp-2/1_u_scan.png'), false);
  assert.equal(isGantiLiburAttachmentPath('emp-1', 'ganti_libur/emp-1/../emp-2/x.png'), false);
  assert.equal(isGantiLiburAttachmentPath('emp-1', 'ganti_libur/emp-1/sub/x.png'), false);
  assert.equal(isGantiLiburAttachmentPath('emp-1', 'presence_corrections/emp-1/x.png'), false);
  assert.equal(isGantiLiburAttachmentPath('emp-1', 'ganti_libur/emp-1/'), false);
  assert.equal(isGantiLiburAttachmentPath('emp-1', 42), false);
});

test('submitted attachment paths are checked, deduplicated and capped', () => {
  assert.deepEqual(parseGantiLiburAttachmentPaths(undefined, 'emp-1'), { ok: true, paths: [] });
  assert.deepEqual(parseGantiLiburAttachmentPaths(null, 'emp-1'), { ok: true, paths: [] });
  assert.deepEqual(
    parseGantiLiburAttachmentPaths(
      ['ganti_libur/emp-1/a.png', 'ganti_libur/emp-1/a.png', 'ganti_libur/emp-1/b.pdf'],
      'emp-1',
    ),
    { ok: true, paths: ['ganti_libur/emp-1/a.png', 'ganti_libur/emp-1/b.pdf'] },
  );
  assert.equal(parseGantiLiburAttachmentPaths('x', 'emp-1').ok, false);
  assert.equal(
    parseGantiLiburAttachmentPaths(['ganti_libur/emp-2/a.png'], 'emp-1').ok,
    false,
  );
  const tooMany = Array.from({ length: 6 }, (_, index) => `ganti_libur/emp-1/${index}.png`);
  assert.equal(parseGantiLiburAttachmentPaths(tooMany, 'emp-1').ok, false);
  assert.equal(parseGantiLiburAttachmentPaths(tooMany.slice(0, 5), 'emp-1').ok, true);
});

test('stored attachments are read back without malformed entries', () => {
  const good = {
    name: 'surat.pdf',
    path: 'ganti_libur/emp-1/a.pdf',
    url: 'https://example.test/a',
    contentType: 'application/pdf',
    size: 1234,
  };
  assert.deepEqual(coerceGantiLiburAttachments([good, null, 'x', { ...good, size: 'big' }]), [good]);
  assert.deepEqual(coerceGantiLiburAttachments(undefined), []);
});

test('file sizes read naturally', () => {
  assert.equal(formatAttachmentSize(512), '512 B');
  assert.equal(formatAttachmentSize(2048), '2 KB');
  assert.equal(formatAttachmentSize(3.5 * 1024 * 1024), '3.5 MB');
});
