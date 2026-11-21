import type { AssignedPerson } from './templates';

/**
 * The whole letter as one TipTap/ProseMirror document: letterhead, Nomor/Hal, recipient, body, closing and
 * signature. This file knows only the plain data shape, so the server can check a stored or submitted
 * letter without loading the editor.
 */
export interface LetterMark {
  type: string;
  attrs?: Record<string, unknown>;
}
export interface LetterNode {
  type: string;
  attrs?: Record<string, unknown>;
  content?: LetterNode[];
  marks?: LetterMark[];
  text?: string;
}
export interface LetterDoc {
  type: 'doc';
  content: LetterNode[];
}

export const SIGNATURE_PLACES = ['left', 'center', 'right', 'full'] as const;
export const LETTER_ALIGNMENTS = ['left', 'center', 'right', 'justify'] as const;
export const LETTER_MAX_INDENT = 6;
/** Space after a paragraph (pt) and the other paragraph settings the editor starts from. */
export const PARAGRAPH_DEFAULTS = { textAlign: 'justify', indent: 0, firstLine: true, after: 9 } as const;
export const LETTER_FONT_FAMILIES = ['Times New Roman', 'Arial', 'Calibri', 'Georgia', 'Verdana', 'Tahoma', 'Courier New'] as const;
export const LETTER_FONT_SIZES = [8, 9, 10, 11, 12, 14, 16, 18, 20, 24, 28, 36] as const;
/** The text size of an unmarked letter, in pt. */
export const LETTER_BASE_PT = 11;
export const LETTER_MAX_ROW_HEIGHT_PT = 720;

export function sanitizeRowHeight(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value >= 1 && value <= LETTER_MAX_ROW_HEIGHT_PT
    ? Math.round(value * 10) / 10
    : null;
}
const FONT_SIZE_RANGE = [6, 96] as const;
/** The writing area of an A4 page (170mm) in letter units, where one unit is 12pt. */
export const LETTER_CONTENT_WIDTH_U = (170 * 72) / 25.4 / 12;

/** Paragraph tags that let the letter's record (number, subject, recipient, signer) be read back from the document. */
export const PARAGRAPH_FIELDS = ['tujuanLabel', 'tujuanNama', 'tujuanAlamatKota', 'penandatanganNama', 'penandatanganJabatan', 'penandatanganNipy'] as const;
export const ROW_FIELDS = ['nomorSurat', 'lampiranKeterangan', 'perihal'] as const;
export type LetterRowField = (typeof ROW_FIELDS)[number];

/** Limits for what one letter may hold. */
export const LETTER_MAX_TEXT = 40000;
export const LETTER_MAX_IMAGE_CHARS = 400000;
export const LETTER_MAX_IMAGES_CHARS = 600000;
const MAX_NODES = 8000;
const MAX_DEPTH = 12;

const MARKS = new Set(['bold', 'italic', 'underline', 'textStyle']);
const LEAF = new Set(['text', 'hardBreak', 'letterDate', 'signSpace', 'image', 'taskAssigner', 'taskPeople']);
/**
 * Everything the editor treats as a block. Where the editor allows any block (the page, the closing, table
 * cells), so does this check: a letter the editor can make must never be refused when it is saved.
 */
const ALL_BLOCKS = ['paragraph', 'bulletList', 'orderedList', 'table', 'image', 'kop', 'labelRow', 'closing', 'signatureBlock', 'signSpace', 'taskAssigner', 'taskPeople'];
/** Which nodes may sit inside which; an unknown node makes the whole letter invalid rather than losing text. */
const CHILDREN: Record<string, ReadonlySet<string>> = {
  doc: new Set(ALL_BLOCKS),
  paragraph: new Set(['text', 'hardBreak', 'letterDate']),
  labelRow: new Set(['rowLabel', 'rowSep', 'rowValue']),
  rowLabel: new Set(['text', 'hardBreak']),
  rowSep: new Set(['text', 'hardBreak']),
  rowValue: new Set(['text', 'hardBreak']),
  kop: new Set(['paragraph']),
  closing: new Set(ALL_BLOCKS),
  signatureBlock: new Set(['paragraph', 'signSpace', 'image']),
  bulletList: new Set(['listItem']),
  orderedList: new Set(['listItem']),
  listItem: new Set(ALL_BLOCKS),
  table: new Set(['tableRow']),
  tableRow: new Set(['tableCell', 'tableHeader']),
  tableCell: new Set(ALL_BLOCKS),
  tableHeader: new Set(ALL_BLOCKS),
};
for (const type of LEAF) CHILDREN[type] = new Set();

const HEX = /^#[0-9a-fA-F]{6}$/;
const DATA_IMAGE = /^data:image\/(?:png|jpeg|webp);base64,[A-Za-z0-9+/]+=*$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;

const record = (value: unknown): Record<string, unknown> =>
  value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
const isInt = (value: unknown, min: number, max: number): value is number =>
  typeof value === 'number' && Number.isInteger(value) && value >= min && value <= max;

function sanitizeAttrs(type: string, value: unknown): Record<string, unknown> | undefined | null {
  const raw = record(value);
  const result: Record<string, unknown> = {};
  switch (type) {
    case 'paragraph': {
      if (typeof raw.textAlign === 'string' && (LETTER_ALIGNMENTS as readonly string[]).includes(raw.textAlign) && raw.textAlign !== PARAGRAPH_DEFAULTS.textAlign) result.textAlign = raw.textAlign;
      if (isInt(raw.indent, 1, LETTER_MAX_INDENT)) result.indent = raw.indent;
      if (raw.firstLine === false) result.firstLine = false;
      if (typeof raw.after === 'number' && Number.isFinite(raw.after) && raw.after >= 0 && raw.after <= 48 && raw.after !== PARAGRAPH_DEFAULTS.after) result.after = Math.round(raw.after * 10) / 10;
      if (typeof raw.field === 'string' && (PARAGRAPH_FIELDS as readonly string[]).includes(raw.field)) result.field = raw.field;
      break;
    }
    case 'orderedList':
      if (isInt(raw.start, 2, 9999)) result.start = raw.start;
      break;
    case 'tableRow': {
      const height = sanitizeRowHeight(raw.height);
      if (height !== null) result.height = height;
      break;
    }
    case 'tableCell':
    case 'tableHeader':
      if (isInt(raw.colspan, 2, 20)) result.colspan = raw.colspan;
      if (isInt(raw.rowspan, 2, 20)) result.rowspan = raw.rowspan;
      // Column widths are shares of the table, in percent.
      if (Array.isArray(raw.colwidth) && raw.colwidth.length >= 1 && raw.colwidth.length <= 20 && raw.colwidth.every((w) => typeof w === 'number' && w >= 1 && w <= 100)) {
        result.colwidth = (raw.colwidth as number[]).map((w) => Math.round(w * 10) / 10);
      }
      break;
    case 'labelRow':
      if (typeof raw.field !== 'string' || !(ROW_FIELDS as readonly string[]).includes(raw.field)) return null;
      result.field = raw.field;
      break;
    case 'signatureBlock':
      if (typeof raw.place === 'string' && raw.place !== 'right' && (SIGNATURE_PLACES as readonly string[]).includes(raw.place)) result.place = raw.place;
      break;
    case 'kop':
      result.logo = raw.logo === 'yapetidu' ? 'yapetidu' : 'unipdu';
      if (result.logo === 'unipdu' && raw.variant === 'rektorat') result.variant = 'rektorat';
      break;
    case 'letterDate':
      if (typeof raw.value !== 'string' || (raw.value !== '' && !DATE.test(raw.value))) return null;
      result.value = raw.value;
      break;
    case 'image':
      if (typeof raw.src !== 'string' || raw.src.length > LETTER_MAX_IMAGE_CHARS || !DATA_IMAGE.test(raw.src)) return null;
      result.src = raw.src;
      if (typeof raw.alt === 'string' && raw.alt) result.alt = raw.alt.slice(0, 200);
      if (typeof raw.width === 'number' && raw.width >= 5 && raw.width < 99.5) result.width = Math.round(raw.width * 10) / 10;
      if (raw.align === 'left' || raw.align === 'right') result.align = raw.align;
      if (raw.wrap === true) result.wrap = true;
      if (typeof raw.rotate === 'number' && raw.rotate !== 0 && Math.abs(raw.rotate) <= 360) result.rotate = Math.round(raw.rotate * 10) / 10;
      // A floating picture needs its spot; without a valid one it stays in the text.
      if (raw.float === true && typeof raw.x === 'number' && typeof raw.y === 'number' && raw.x >= -10 && raw.x <= 60 && raw.y >= -10 && raw.y <= 800) {
        result.float = true;
        if (raw.behind === true) result.behind = true;
        delete result.wrap;
        result.x = Math.round(raw.x * 10) / 10;
        result.y = Math.round(raw.y * 10) / 10;
      }
      break;
    default:
      break;
  }
  return Object.keys(result).length ? result : undefined;
}

function sanitizeMark(value: unknown): LetterMark | null | undefined {
  const raw = record(value);
  if (typeof raw.type !== 'string' || !MARKS.has(raw.type)) return null;
  if (raw.type !== 'textStyle') return { type: raw.type };
  const attrs = record(raw.attrs);
  const result: Record<string, unknown> = {};
  if (typeof attrs.fontSize === 'number' && attrs.fontSize >= FONT_SIZE_RANGE[0] && attrs.fontSize <= FONT_SIZE_RANGE[1]) result.fontSize = Math.round(attrs.fontSize * 10) / 10;
  if (typeof attrs.fontFamily === 'string' && (LETTER_FONT_FAMILIES as readonly string[]).includes(attrs.fontFamily)) result.fontFamily = attrs.fontFamily;
  if (typeof attrs.color === 'string' && HEX.test(attrs.color)) result.color = attrs.color.toLowerCase();
  if (typeof attrs.backgroundColor === 'string' && HEX.test(attrs.backgroundColor)) result.backgroundColor = attrs.backgroundColor.toLowerCase();
  // A style mark that sets nothing is dropped, as the editor leaves such marks behind.
  return Object.keys(result).length ? { type: 'textStyle', attrs: result } : undefined;
}

/**
 * Letters saved earlier kept a row's label ("Nomor") as a fixed setting and only its value as text. The label
 * and the colon are now text too, so such a row is rewritten to the current layout.
 */
function upgradeRow(node: unknown): unknown {
  const raw = record(node);
  const attrs = record(raw.attrs);
  if (raw.type !== 'labelRow' || typeof attrs.label !== 'string') return node;
  const value = Array.isArray(raw.content) ? raw.content : [];
  if (!value.every((child) => ['text', 'hardBreak'].includes(String(record(child).type)))) return node;
  const text = (content: string) => (content ? [{ type: 'text', text: content }] : undefined);
  const part = (type: string, content?: unknown[]) => ({ type, ...(content?.length ? { content } : {}) });
  return {
    type: 'labelRow',
    attrs: { field: attrs.field },
    content: [part('rowLabel', text(attrs.label)), part('rowSep', text(':')), part('rowValue', value)],
  };
}

/**
 * Checks a stored or submitted letter against the small set of things the editor can make, and returns a
 * clean copy (only known nodes, marks and settings). Returns null when anything else is found or it is too large.
 */
export function sanitizeLetterDoc(value: unknown): LetterDoc | null {
  const root = record(value);
  if (root.type !== 'doc' || !Array.isArray(root.content)) return null;
  let nodes = 0;
  let textLength = 0;
  let imageChars = 0;

  const clean = (node: unknown, parentType: string, depth: number): LetterNode | null => {
    const raw = record(upgradeRow(node));
    const type = raw.type;
    if (typeof type !== 'string' || depth > MAX_DEPTH || !CHILDREN[parentType]?.has(type)) return null;
    nodes += 1;
    if (nodes > MAX_NODES) return null;

    const result: LetterNode = { type };
    const attrs = sanitizeAttrs(type, raw.attrs);
    if (attrs === null) return null;
    if (attrs) result.attrs = attrs;
    if (type === 'image') {
      imageChars += (result.attrs?.src as string).length;
      if (imageChars > LETTER_MAX_IMAGES_CHARS) return null;
    }

    if (type === 'text') {
      if (typeof raw.text !== 'string' || !raw.text) return null;
      textLength += raw.text.length;
      if (textLength > LETTER_MAX_TEXT) return null;
      result.text = raw.text;
      if (raw.marks !== undefined) {
        if (!Array.isArray(raw.marks)) return null;
        const marks: LetterMark[] = [];
        for (const item of raw.marks) {
          const mark = sanitizeMark(item);
          if (mark === null) return null;
          if (mark && !marks.some((existing) => existing.type === mark.type)) marks.push(mark);
        }
        if (marks.length) result.marks = marks;
      }
      return result;
    }

    if (LEAF.has(type)) return result;
    if (raw.content !== undefined) {
      if (!Array.isArray(raw.content)) return null;
      const children: LetterNode[] = [];
      for (const child of raw.content) {
        const cleaned = clean(child, type, depth + 1);
        if (!cleaned) return null;
        children.push(cleaned);
      }
      if (children.length) result.content = children;
    }
    // Containers the editor cannot open when empty or when they start with the wrong thing.
    if (type === 'listItem' && result.content?.[0]?.type !== 'paragraph') return null;
    // A numbered row is always its label, its colon and its value, in that order.
    if (type === 'labelRow' && result.content?.map((child) => child.type).join() !== 'rowLabel,rowSep,rowValue') return null;
    if (['bulletList', 'orderedList', 'table', 'tableRow', 'kop', 'closing', 'signatureBlock'].includes(type) && !result.content?.length) return null;
    if ((type === 'tableCell' || type === 'tableHeader') && !result.content?.length) return null;
    return result;
  };

  const content: LetterNode[] = [];
  for (const child of root.content) {
    const cleaned = clean(child, 'doc', 1);
    if (!cleaned) return null;
    content.push(cleaned);
  }
  return content.length ? { type: 'doc', content } : null;
}

/** The record fields the letter's document carries; each is read back after every edit. */
export interface LetterFields {
  nomorSurat: string;
  lampiranKeterangan: string;
  perihal: string;
  tanggalSurat: string;
  tujuanNama: string;
  tujuanAlamatKota: string;
  penandatanganNama: string;
  penandatanganJabatan: string;
  penandatanganNipy: string;
}

function inlineText(node: LetterNode): string {
  if (node.type === 'text') return node.text || '';
  if (node.type === 'hardBreak') return '\n';
  return (node.content || []).map(inlineText).join('');
}

/** Reads the number, subject, date, recipient and signer out of the letter, as written in the document now. */
export function extractLetterFields(doc: LetterDoc): LetterFields {
  const rows: Partial<Record<LetterRowField, string>> = {};
  const lines: Partial<Record<(typeof PARAGRAPH_FIELDS)[number], string[]>> = {};
  let tanggalSurat = '';

  const visit = (node: LetterNode) => {
    if (node.type === 'labelRow' && typeof node.attrs?.field === 'string' && !(node.attrs.field in rows)) {
      const value = node.content?.find((child) => child.type === 'rowValue');
      rows[node.attrs.field as LetterRowField] = value ? inlineText(value).trim() : '';
    } else if (node.type === 'paragraph' && typeof node.attrs?.field === 'string') {
      const field = node.attrs.field as (typeof PARAGRAPH_FIELDS)[number];
      (lines[field] ||= []).push(inlineText(node).trim());
    } else if (node.type === 'letterDate' && !tanggalSurat) {
      tanggalSurat = typeof node.attrs?.value === 'string' ? node.attrs.value : '';
    }
    node.content?.forEach(visit);
  };
  doc.content.forEach(visit);

  const joined = (field: (typeof PARAGRAPH_FIELDS)[number]) => (lines[field] || []).filter(Boolean).join('\n');
  return {
    nomorSurat: rows.nomorSurat || '',
    lampiranKeterangan: rows.lampiranKeterangan || '',
    perihal: rows.perihal || '',
    tanggalSurat,
    tujuanNama: joined('tujuanNama'),
    tujuanAlamatKota: joined('tujuanAlamatKota'),
    penandatanganNama: joined('penandatanganNama'),
    // The title line ends with a comma on the paper, which is not part of the title.
    penandatanganJabatan: joined('penandatanganJabatan').replace(/,\s*$/, ''),
    penandatanganNipy: joined('penandatanganNipy').replace(/^\s*NIPY\s*:?\s*/i, ''),
  };
}

export function formatAssignedPerson(person: AssignedPerson): string {
  return `${person.name}${person.role ? ` — ${person.role}` : ''}`;
}

/**
 * The words of the letter as plain text, for its summary and search. Skips the letterhead, the numbered rows,
 * the recipient and the signature, which the record already holds on their own.
 */
export function letterDocText(doc: LetterDoc | undefined, people: AssignedPerson[] = []): string {
  if (!doc) return '';
  const lines: string[] = [];
  const block = (node: LetterNode, prefix = ''): void => {
    switch (node.type) {
      case 'paragraph': {
        // Paragraphs tagged as the recipient or signer belong to the record's own fields.
        if (typeof node.attrs?.field === 'string') return;
        const text = inlineText(node).trim();
        if (text) lines.push(prefix + text);
        return;
      }
      case 'taskPeople':
        people.forEach((person, index) => lines.push(`${index + 1}. ${formatAssignedPerson(person)}`));
        return;
      case 'bulletList':
      case 'orderedList': {
        const start = typeof node.attrs?.start === 'number' ? node.attrs.start : 1;
        (node.content || []).forEach((item, index) =>
          (item.content || []).forEach((child) => block(child, node.type === 'bulletList' ? '- ' : `${start + index}. `)),
        );
        return;
      }
      case 'table':
        (node.content || []).forEach((row) => {
          const cells = (row.content || []).map((cell) => (cell.content || []).map(inlineText).join(' ').trim());
          if (cells.some(Boolean)) lines.push(cells.join(' | '));
        });
        return;
      case 'closing':
        // Only the closing greeting; the signature block below it is the signer's.
        (node.content || []).filter((child) => child.type !== 'signatureBlock').forEach((child) => block(child));
        return;
      default:
        return;
    }
  };
  doc.content.forEach((node) => block(node));
  return lines.join('\n\n');
}
