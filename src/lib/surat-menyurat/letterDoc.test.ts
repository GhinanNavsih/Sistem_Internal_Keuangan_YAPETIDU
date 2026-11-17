import assert from 'node:assert/strict';
import test from 'node:test';
import { extractLetterFields, letterDocText, sanitizeLetterDoc, LETTER_MAX_TEXT, type LetterDoc, type LetterNode } from './letterDoc';
import { buildLetterDoc } from './letterDocBuild';
import { applyTemplateDefaults, getDefaultDraft, parseLetterDraft, type LetterDraftPayload } from './templates';

const TEMPLATES = ['tugas', 'keterangan', 'undangan', 'pengantar', 'permohonan', 'edaran', 'rekomendasi', 'balasan', 'custom'] as const;

function sampleDraft(type: (typeof TEMPLATES)[number] = 'undangan'): LetterDraftPayload {
  const draft = applyTemplateDefaults(getDefaultDraft('Biro Umum', 'Dr. Ahmad', 'Kepala', 'biro@unipdu.ac.id', '0812'), type, 'Biro Umum', 'Dr. Ahmad', 'Kepala');
  return { ...draft, nomorSurat: '185/B.1/AAK/11/2026', tanggalSurat: '2026-11-17', tujuanNama: 'Bapak/Ibu Dosen\nUNIPDU', penandatanganNipy: '11 01 0209 035' };
}
const paragraph = (text: string, attrs?: Record<string, unknown>, marks?: unknown[]): LetterNode => ({
  type: 'paragraph',
  ...(attrs ? { attrs } : {}),
  content: [{ type: 'text', text, ...(marks ? { marks: marks as never } : {}) }],
});
const doc = (...content: LetterNode[]): LetterDoc => ({ type: 'doc', content });
const kinds = (letter: LetterDoc) => letter.content.map((node) => node.type);

test('a letter is laid out as letterhead, numbered rows, recipient, body, closing', () => {
  const letter = buildLetterDoc(sampleDraft(), { isYapetidu: false });
  assert.deepEqual(kinds(letter).filter((type, index, all) => type !== all[index - 1]), ['kop', 'labelRow', 'paragraph', 'closing']);
  assert.equal(letter.content[0].attrs?.logo, 'unipdu');
  assert.equal(buildLetterDoc(sampleDraft(), { isYapetidu: true }).content[0].attrs?.logo, 'yapetidu');
});

test('every template builds a letter the server accepts', () => {
  for (const type of TEMPLATES) {
    const draft = sampleDraft(type);
    const letter = buildLetterDoc(draft, { isYapetidu: false });
    assert.deepEqual(sanitizeLetterDoc(letter), letter, type);
    assert.ok(parseLetterDraft({ ...draft, letterDoc: letter }), type);
  }
});

test('a Surat Tugas carries its task giver and people list; other letters do not', () => {
  const letter = buildLetterDoc(sampleDraft('tugas'), { isYapetidu: false });
  assert.ok(kinds(letter).includes('taskPeople'));
  assert.ok(kinds(letter).includes('taskAssigner'));
  const other = kinds(buildLetterDoc(sampleDraft('undangan'), { isYapetidu: false }));
  assert.ok(!other.includes('taskPeople') && !other.includes('taskAssigner'));
});

test('the record fields are read back from the letter as written', () => {
  const draft = sampleDraft();
  const fields = extractLetterFields(buildLetterDoc(draft, { isYapetidu: false }));
  assert.equal(fields.nomorSurat, draft.nomorSurat);
  assert.equal(fields.perihal, draft.perihal);
  assert.equal(fields.lampiranKeterangan, draft.lampiranKeterangan);
  assert.equal(fields.tanggalSurat, '2026-11-17');
  assert.equal(fields.tujuanNama, 'Bapak/Ibu Dosen\nUNIPDU');
  assert.equal(fields.tujuanAlamatKota, draft.tujuanAlamatKota);
  assert.equal(fields.penandatanganNama, 'Dr. Ahmad');
  assert.equal(fields.penandatanganJabatan, draft.penandatanganJabatan);
  assert.equal(fields.penandatanganNipy, '11 01 0209 035');
});

test('editing the letter changes the fields read back; deleting a part empties its field', () => {
  const letter = buildLetterDoc(sampleDraft(), { isYapetidu: false });
  const edited: LetterDoc = {
    ...letter,
    content: letter.content
      .filter((node) => !(node.type === 'labelRow' && node.attrs?.field === 'lampiranKeterangan'))
      .map((node) => (node.type === 'labelRow' && node.attrs?.field === 'nomorSurat' ? { ...node, content: [{ type: 'text', text: '999/X' }] } : node)),
  };
  const fields = extractLetterFields(edited);
  assert.equal(fields.nomorSurat, '999/X');
  assert.equal(fields.lampiranKeterangan, '');
});

test('a recipient written over several paragraphs is read as several lines', () => {
  const fields = extractLetterFields(doc(paragraph('Bapak A', { field: 'tujuanNama' }), paragraph('Ibu B', { field: 'tujuanNama' }), paragraph('Tanpa tag')));
  assert.equal(fields.tujuanNama, 'Bapak A\nIbu B');
});

test('summary text leaves out the letterhead, rows, recipient and signature', () => {
  const text = letterDocText(buildLetterDoc(sampleDraft(), { isYapetidu: false }));
  assert.ok(text.includes('Hari / Tanggal:'));
  assert.ok(text.includes("Wassalamu'alaikum"));
  assert.ok(!text.includes('Dr. Ahmad'));
  assert.ok(!text.includes('185/B.1/AAK'));
  assert.ok(!text.includes('Alamat: PP Darul Ulum'));
});

test('tables, lists and the people list appear in the summary', () => {
  const cell = (text: string): LetterNode => ({ type: 'tableCell', content: [paragraph(text)] });
  const text = letterDocText(
    doc(
      { type: 'table', content: [{ type: 'tableRow', content: [cell('No'), cell('Uraian')] }, { type: 'tableRow', content: [cell('1'), cell('Laporan')] }] },
      { type: 'orderedList', attrs: { start: 3 }, content: [{ type: 'listItem', content: [paragraph('Tiga')] }] },
      { type: 'taskPeople' },
    ),
    [{ id: '1', collection: 'Employees_Loyalis', name: 'Siti', role: 'Staf' }],
  );
  assert.equal(text, 'No | Uraian\n\n1 | Laporan\n\n3. Tiga\n\n1. Siti — Staf');
});

test('formatting the editor makes is accepted and cleaned; defaults are dropped', () => {
  const letter = sanitizeLetterDoc(
    doc(
      paragraph('Judul', { textAlign: 'center', indent: 0, firstLine: true, after: 9, extra: 1 }, [
        { type: 'bold' },
        { type: 'textStyle', attrs: { fontSize: 14, fontFamily: 'Arial', color: '#AA0000', backgroundColor: null, rubbish: 1 } },
      ]),
      paragraph('Biasa', { textAlign: 'justify' }, [{ type: 'textStyle', attrs: { fontSize: null } }]),
    ),
  );
  assert.deepEqual(letter, {
    type: 'doc',
    content: [
      { type: 'paragraph', attrs: { textAlign: 'center' }, content: [{ type: 'text', text: 'Judul', marks: [{ type: 'bold' }, { type: 'textStyle', attrs: { fontSize: 14, fontFamily: 'Arial', color: '#aa0000' } }] }] },
      { type: 'paragraph', content: [{ type: 'text', text: 'Biasa' }] },
    ],
  });
});

test('tables and pictures are accepted', () => {
  const png = 'data:image/png;base64,iVBORw0KGgo=';
  const table: LetterNode = { type: 'table', content: [{ type: 'tableRow', content: [{ type: 'tableHeader', attrs: { colspan: 2, colwidth: [100, 100] }, content: [paragraph('Judul')] }] }] };
  const result = sanitizeLetterDoc(doc(table, { type: 'image', attrs: { src: png, alt: 'Stempel', width: 40, align: 'right', extra: 1 } }));
  assert.deepEqual(result?.content[0], { type: 'table', content: [{ type: 'tableRow', content: [{ type: 'tableHeader', attrs: { colspan: 2 }, content: [paragraph('Judul')] }] }] });
  assert.deepEqual(result?.content[1], { type: 'image', attrs: { src: png, alt: 'Stempel', width: 40, align: 'right' } });
});

test('a picture may sit inside a table cell', () => {
  const png = 'data:image/png;base64,iVBORw0KGgo=';
  const cell: LetterNode = { type: 'tableCell', content: [paragraph('Tanda tangan'), { type: 'image', attrs: { src: png } }] };
  const table: LetterNode = { type: 'table', content: [{ type: 'tableRow', content: [cell] }] };
  assert.deepEqual(sanitizeLetterDoc(doc(table)), doc(table));
});

test('anything the editor cannot make is refused', () => {
  const bad = (...content: LetterNode[]) => sanitizeLetterDoc(doc(...content));
  assert.equal(bad({ type: 'script' }), null);
  assert.equal(bad({ type: 'image', attrs: { src: 'https://evil.example/x.png' } }), null);
  assert.equal(bad({ type: 'image', attrs: { src: 'data:image/svg+xml;base64,PHN2Zz4=' } }), null);
  assert.equal(bad({ type: 'image' }), null);
  assert.equal(bad(paragraph('a', undefined, [{ type: 'link', attrs: { href: 'javascript:alert(1)' } }])), null);
  assert.equal(bad({ type: 'paragraph', content: [{ type: 'image', attrs: { src: 'data:image/png;base64,AA==' } }] }), null);
  assert.equal(bad({ type: 'labelRow', attrs: { label: 'X', field: 'unknown' } }), null);
  assert.equal(bad({ type: 'labelRow', attrs: { field: 'perihal' } }), null);
  assert.equal(bad({ type: 'letterDate', attrs: { value: 'besok' } }), null);
  assert.equal(bad({ type: 'bulletList', content: [] }), null);
  assert.equal(bad({ type: 'table', content: [] }), null);
  assert.equal(bad({ type: 'listItem', content: [paragraph('x')] }), null);
  assert.equal(sanitizeLetterDoc(doc()), null);
  assert.equal(sanitizeLetterDoc({ type: 'paragraph' }), null);
  assert.equal(sanitizeLetterDoc(null), null);
  assert.equal(sanitizeLetterDoc('<p>x</p>'), null);
});

test('settings are limited to known values', () => {
  const [result] = sanitizeLetterDoc(
    doc(paragraph('x', { textAlign: 'javascript:1', indent: 99, firstLine: false, after: 500, field: 'secret' }, [{ type: 'textStyle', attrs: { fontFamily: 'Comic Sans', color: 'red', fontSize: 500 } }])),
  )!.content;
  assert.deepEqual(result, { type: 'paragraph', attrs: { firstLine: false }, content: [{ type: 'text', text: 'x' }] });
});

test('a letter that is too long or has too many pictures is refused', () => {
  assert.ok(sanitizeLetterDoc(doc(paragraph('a'.repeat(LETTER_MAX_TEXT)))));
  assert.equal(sanitizeLetterDoc(doc(paragraph('a'.repeat(LETTER_MAX_TEXT + 1)))), null);
  const image = (size: number): LetterNode => ({ type: 'image', attrs: { src: `data:image/png;base64,${'A'.repeat(size)}` } });
  assert.ok(sanitizeLetterDoc(doc(image(300000))));
  assert.equal(sanitizeLetterDoc(doc(image(450000))), null);
  assert.equal(sanitizeLetterDoc(doc(image(300000), image(300000), image(10))), null);
  assert.equal(sanitizeLetterDoc(doc(...Array.from({ length: 9000 }, () => paragraph('x')))), null);
});

test('a saved draft keeps its letter, and a bad letter rejects the draft', () => {
  const draft = sampleDraft();
  const letterDoc = buildLetterDoc(draft, { isYapetidu: false });
  assert.deepEqual(parseLetterDraft({ ...draft, letterDoc })?.letterDoc, letterDoc);
  assert.equal(parseLetterDraft({ ...draft, letterDoc: doc({ type: 'script' }) }), null);
  assert.equal(parseLetterDraft(draft)?.letterDoc, undefined);
});
