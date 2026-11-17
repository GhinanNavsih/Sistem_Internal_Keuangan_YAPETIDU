import { formatPenandatanganJabatan, type LetterDraftPayload } from './templates';
import type { LetterDoc, LetterMark, LetterNode } from './letterDoc';

export interface LetterDocOptions {
  isYapetidu: boolean;
}

const bold: LetterMark = { type: 'bold' };
const italic: LetterMark = { type: 'italic' };
const underline: LetterMark = { type: 'underline' };
const size = (fontSize: number): LetterMark => ({ type: 'textStyle', attrs: { fontSize } });

/** Text with its line breaks as hard breaks inside one paragraph. */
function inline(value: string, marks: LetterMark[] = []): LetterNode[] {
  const nodes: LetterNode[] = [];
  value.split('\n').forEach((line, index) => {
    if (index > 0) nodes.push({ type: 'hardBreak' });
    if (line) nodes.push({ type: 'text', text: line, ...(marks.length ? { marks } : {}) });
  });
  return nodes;
}

function paragraph(content: LetterNode[], attrs: Record<string, unknown> = {}): LetterNode {
  return { type: 'paragraph', ...(Object.keys(attrs).length ? { attrs } : {}), ...(content.length ? { content } : {}) };
}

/** A line of a fixed block (letterhead, recipient, signature): flush, centered or left, no space after. */
const line = (content: LetterNode[], textAlign: 'left' | 'center', extra: Record<string, unknown> = {}) =>
  paragraph(content, { textAlign, firstLine: false, after: 0, ...extra });

/**
 * Lays a letter's fields out as the document the editor works on: letterhead, numbered rows, recipient,
 * greetings, body, closing and signature. Older letters and the templates hold their body as three plain
 * paragraphs, which become ordinary paragraphs here.
 */
export function buildLetterDoc(draft: LetterDraftPayload, { isYapetidu }: LetterDocOptions): LetterDoc {
  const content: LetterNode[] = [];
  const isTask = draft.templateType === 'tugas';

  // Letterhead
  const kopLines: LetterNode[] = [
    line(inline(isYapetidu ? "YAYASAN PESANTREN TINGGI DARUL 'ULUM JOMBANG" : 'UNIVERSITAS PESANTREN TINGGI DARUL ULUM', [bold, size(13.5)]), 'center'),
    line(inline((draft.satkerName || 'SATUAN KERJA').toUpperCase(), [bold]), 'center', { after: 2 }),
    line(inline('Alamat: PP Darul Ulum, Tromol Pos 10 Peterongan Jombang Jawa Timur 61481', [size(8.5)]), 'center'),
    line(
      inline(
        ['Website: unipdu.ac.id', draft.satkerHeadEmail ? `email: ${draft.satkerHeadEmail}` : '', draft.satkerHeadPhone ? `Telp. ${draft.satkerHeadPhone}` : ''].filter(Boolean).join(' | '),
        [size(8.5)],
      ),
      'center',
    ),
  ];
  content.push({ type: 'kop', attrs: { logo: isYapetidu ? 'yapetidu' : 'unipdu' }, content: kopLines });

  // Nomor, Lampiran, Hal
  content.push(
    { type: 'labelRow', attrs: { label: 'Nomor', field: 'nomorSurat' }, ...(draft.nomorSurat ? { content: inline(draft.nomorSurat, [bold]) } : {}) },
    { type: 'labelRow', attrs: { label: 'Lampiran', field: 'lampiranKeterangan' }, content: inline(draft.lampiranKeterangan || '-') },
    { type: 'labelRow', attrs: { label: 'Hal', field: 'perihal' }, content: inline(draft.perihal || 'Surat Dinas', [bold, underline]) },
  );

  // Kepada Yth.
  content.push(line(inline('Kepada Yth.'), 'left', { field: 'tujuanLabel', textAlign: 'left' }));
  (draft.tujuanNama || 'Bapak / Ibu').split('\n').forEach((name) => {
    content.push(line(inline(name, [bold]), 'left', { field: 'tujuanNama' }));
  });
  content.push(line(inline(draft.tujuanAlamatKota || 'di Tempat', [italic]), 'left', { field: 'tujuanAlamatKota', after: 14 }));

  // Opening greeting, task giver, body
  if (draft.salamPembuka) content.push(paragraph(inline(draft.salamPembuka, [italic]), { textAlign: 'left', firstLine: false }));
  if (isTask) content.push({ type: 'taskAssigner' });
  if (draft.isiParagraf1.trim()) content.push(paragraph(inline(draft.isiParagraf1)));
  if (isTask) content.push({ type: 'taskPeople' });
  // The detail block (dates, names, table-like lines) sat indented and without a first-line indent.
  if (draft.isiParagraf2.trim()) content.push(paragraph(inline(draft.isiParagraf2), { indent: 1, firstLine: false }));
  if (draft.isiParagraf3.trim()) content.push(paragraph(inline(draft.isiParagraf3)));
  if (!draft.isiParagraf1.trim() && !draft.isiParagraf2.trim() && !draft.isiParagraf3.trim()) content.push(paragraph([]));

  // Closing greeting and signature, kept together on one page
  const title = isTask && draft.taskAssigner ? draft.penandatanganJabatan : formatPenandatanganJabatan(draft.penandatanganJabatan, draft.satkerName);
  const signature: LetterNode[] = [
    line([{ type: 'text', text: 'Jombang, ' }, { type: 'letterDate', attrs: { value: draft.tanggalSurat } }], 'center'),
    line(inline(`${title},`), 'center', { field: 'penandatanganJabatan' }),
    { type: 'signSpace' },
    line(inline(draft.penandatanganNama, [bold, underline]), 'center', { field: 'penandatanganNama' }),
    ...(draft.penandatanganNipy ? [line(inline(`NIPY: ${draft.penandatanganNipy}`), 'center', { field: 'penandatanganNipy' })] : []),
  ];
  content.push({
    type: 'closing',
    content: [...(draft.salamPenutup ? [line(inline(draft.salamPenutup, [italic]), 'left')] : []), { type: 'signatureBlock', content: signature }],
  });

  return { type: 'doc', content };
}
