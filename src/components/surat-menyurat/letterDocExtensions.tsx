"use client";

import { createContext, useContext, useState } from 'react';
import { Extension, Node, type CommandProps, type Editor } from '@tiptap/core';
import type { Mark as PmMark, Node as PmNode } from '@tiptap/pm/model';
import { NodeSelection, Plugin, PluginKey, TextSelection } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';
import { CellSelection, TableMap } from '@tiptap/pm/tables';
import type { EditorView } from '@tiptap/pm/view';
import { NodeViewWrapper, ReactNodeViewRenderer, type NodeViewProps } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import TextAlign from '@tiptap/extension-text-align';
import { TextStyle } from '@tiptap/extension-text-style';
import { Table, TableCell, TableHeader, TableRow } from '@tiptap/extension-table';
import Image from '@tiptap/extension-image';
import { formatAssignedPerson, LETTER_ALIGNMENTS, LETTER_CONTENT_WIDTH_U, LETTER_MAX_INDENT, PARAGRAPH_DEFAULTS, SIGNATURE_PLACES } from '@/lib/surat-menyurat/letterDoc';
import { formatLetterDate } from '@/lib/surat-menyurat/date';
import type { AssignedPerson } from '@/lib/surat-menyurat/templates';
import IndonesianDatePicker from './IndonesianDatePicker';
import PersonPicker, { type PeopleDirectory } from './PersonPicker';

/* ------------------------------------------------------------------ */
/* What the letter's smart blocks need from the composer              */
/* ------------------------------------------------------------------ */

/** The Surat Tugas blocks read who is chosen, and change it, through this. */
export interface LetterEditorControls {
  assigned: AssignedPerson[];
  directory: PeopleDirectory;
  onAddPerson: (person: AssignedPerson) => void;
  onRemovePerson: (person: AssignedPerson) => void;
  assigner: AssignedPerson | undefined;
  /** The signer as written in the letter now, which is who the task giver block shows. */
  signerName: string;
  signerTitle: string;
  onPickAssigner: (person: AssignedPerson) => void;
  onClearAssigner: () => void;
}
export const LetterEditorContext = createContext<LetterEditorControls | null>(null);

/** Who the Surat Tugas blocks name when the letter is shown without the editor. */
export interface LetterStaticData {
  people: AssignedPerson[];
  signerName: string;
  signerTitle: string;
}

/* ------------------------------------------------------------------ */
/* Commands                                                            */
/* ------------------------------------------------------------------ */

export type ImageMode = 'inline' | 'wrap' | 'behind' | 'front';
export type SignaturePlace = (typeof SIGNATURE_PLACES)[number];

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    letterDoc: {
      /** Move the selected paragraphs one step in (or out); inside a list, nest (or lift) the item instead. */
      changeIndent: (direction: 1 | -1) => ReturnType;
      /** Turn the first-line indent of the selected paragraphs on or off. */
      toggleFirstLine: () => ReturnType;
      /** Replace the text of a part of the letter that the record reads back (nomor, signer name, and so on). */
      setLetterField: (field: string, text: string) => ReturnType;
      /** Where the signature block sits on the page: at the left, in the middle, at the right, or the full width. */
      setSignaturePlace: (place: SignaturePlace) => ReturnType;
      /** Change how a picture sits: its width as a share of the page, and its alignment. */
      setImageLayout: (layout: { width?: number | null; align?: 'left' | 'center' | 'right'; rotate?: number }) => ReturnType;
      /** How the selected picture sits with the text: in the line, with text wrapped around it, or free on the page behind or in front of the text. */
      setImageMode: (mode: ImageMode) => ReturnType;
    };
  }
}

const textContent = (text: string, schemaText: (value: string) => unknown, hardBreak: () => unknown) =>
  text.split('\n').flatMap((line, index) => [...(index > 0 ? [hardBreak()] : []), ...(line ? [schemaText(line)] : [])]);

/* ------------------------------------------------------------------ */
/* Paragraph layout and text style                                     */
/* ------------------------------------------------------------------ */

/** Paragraph settings the letter needs, beyond alignment: indent, first-line indent, space after, and the record field it holds. */
const ParagraphLayout = Extension.create({
  name: 'paragraphLayout',

  addGlobalAttributes() {
    return [
      {
        types: ['paragraph'],
        attributes: {
          indent: {
            default: 0,
            parseHTML: (element) => Math.min(Number(element.getAttribute('data-indent')) || 0, LETTER_MAX_INDENT),
            renderHTML: (attributes) => (attributes.indent ? { 'data-indent': attributes.indent } : {}),
          },
          firstLine: {
            default: true,
            parseHTML: (element) => element.getAttribute('data-first-line') !== 'false',
            renderHTML: (attributes) => (attributes.firstLine ? {} : { 'data-first-line': 'false' }),
          },
          after: {
            default: PARAGRAPH_DEFAULTS.after,
            parseHTML: (element) => {
              const value = Number(element.getAttribute('data-after'));
              return Number.isFinite(value) && element.hasAttribute('data-after') ? value : PARAGRAPH_DEFAULTS.after;
            },
            renderHTML: (attributes) =>
              attributes.after === PARAGRAPH_DEFAULTS.after ? {} : { 'data-after': attributes.after, style: `margin-bottom: calc(var(--u) * ${attributes.after / 12})` },
          },
          // Which part of the record this paragraph holds. Not copied with the text, so a pasted line is just text.
          field: { default: null, rendered: false },
        },
      },
    ];
  },

  addCommands() {
    const eachParagraph = ({ state, tr, dispatch }: CommandProps, change: (attrs: Record<string, unknown>) => Record<string, unknown>) => {
      state.doc.nodesBetween(state.selection.from, state.selection.to, (node, pos) => {
        if (node.type.name === 'paragraph') tr.setNodeMarkup(pos, undefined, change(node.attrs));
      });
      if (dispatch) dispatch(tr);
      return true;
    };
    return {
      changeIndent:
        (direction) =>
        (props) => {
          if (props.editor.isActive('listItem')) {
            return direction === 1 ? props.commands.sinkListItem('listItem') : props.commands.liftListItem('listItem');
          }
          return eachParagraph(props, (attrs) => ({
            ...attrs,
            indent: Math.max(0, Math.min(LETTER_MAX_INDENT, (Number(attrs.indent) || 0) + direction)),
          }));
        },
      toggleFirstLine:
        () =>
        (props) => {
          const current = props.state.selection.$from.parent.attrs.firstLine !== false;
          return eachParagraph(props, (attrs) => ({ ...attrs, firstLine: !current }));
        },
    };
  },

  addKeyboardShortcuts() {
    // In a table, Tab belongs to the table (next cell). At the start of a paragraph, or in a list, it indents;
    // anywhere else in the text it inserts a tab stop, which is how a colon or a column is lined up.
    return {
      Tab: () => {
        if (this.editor.isActive('table')) return false;
        const { selection } = this.editor.state;
        const atStart = selection.empty && selection.$from.parentOffset === 0;
        if (this.editor.isActive('listItem') || atStart || !selection.empty) return this.editor.commands.changeIndent(1);
        return this.editor.commands.insertContent({ type: 'text', text: '\t' });
      },
      'Shift-Tab': () => !this.editor.isActive('table') && this.editor.commands.changeIndent(-1),
    };
  },
});

/** Font size (pt), family, text colour and highlight, kept as attributes of the text style mark. Sizes scale with the sheet. */
const LetterTextStyle = Extension.create({
  name: 'letterTextStyle',
  addGlobalAttributes() {
    return [
      {
        types: ['textStyle'],
        attributes: {
          fontSize: {
            default: null,
            parseHTML: (element) => Number(element.getAttribute('data-pt')) || null,
            renderHTML: (attributes) => (attributes.fontSize ? { 'data-pt': String(attributes.fontSize), style: `font-size: calc(var(--u) * ${attributes.fontSize / 12})` } : {}),
          },
          fontFamily: {
            default: null,
            parseHTML: (element) => element.getAttribute('data-font') || null,
            renderHTML: (attributes) => (attributes.fontFamily ? { 'data-font': attributes.fontFamily, style: `font-family: '${attributes.fontFamily}', serif` } : {}),
          },
          color: {
            default: null,
            parseHTML: (element) => element.getAttribute('data-color') || null,
            renderHTML: (attributes) => (attributes.color ? { 'data-color': attributes.color, style: `color: ${attributes.color}` } : {}),
          },
          backgroundColor: {
            default: null,
            parseHTML: (element) => element.getAttribute('data-bg') || null,
            renderHTML: (attributes) => (attributes.backgroundColor ? { 'data-bg': attributes.backgroundColor, style: `background-color: ${attributes.backgroundColor}` } : {}),
          },
        },
      },
    ];
  },
});

/* ------------------------------------------------------------------ */
/* The letter's own blocks                                             */
/* ------------------------------------------------------------------ */

const LOGOS = { unipdu: '/Logo UNIPDU.png', yapetidu: '/Logo YAPETIDU (Transparent bg).png' } as const;

/** The letterhead: the logo, and the lines of text beside it (each an ordinary paragraph you can edit and style). */
const Kop = Node.create({
  name: 'kop',
  group: 'block',
  content: 'paragraph+',
  defining: true,
  isolating: true,
  addAttributes: () => ({ logo: { default: 'unipdu' } }),
  parseHTML: () => [{ tag: 'div.kop-container', contentElement: '.kop-text' }],
  renderHTML({ node }) {
    const logo = node.attrs.logo === 'yapetidu' ? 'yapetidu' : 'unipdu';
    return [
      'div',
      { class: 'kop-container' },
      ['div', { class: 'kop-logo', contenteditable: 'false' }, ['img', { src: encodeURI(LOGOS[logo]), alt: logo === 'yapetidu' ? 'Logo YAPETIDU' : 'Logo UNIPDU', draggable: 'false' }]],
      ['div', { class: 'kop-text' }, 0],
    ];
  },
});

/** A numbered row such as "Nomor : ...". The label, the colon and the value are all text you can write. */
const LabelRow = Node.create({
  name: 'labelRow',
  group: 'block',
  content: 'rowLabel rowSep rowValue',
  defining: true,
  isolating: true,
  addAttributes: () => ({ field: { default: 'nomorSurat' } }),
  parseHTML: () => [{ tag: 'div.meta-row' }],
  renderHTML: ({ node }) => ['div', { class: 'meta-row', 'data-field': node.attrs.field }, 0],
});

const rowPart = (name: string, className: string) =>
  Node.create({
    name,
    content: '(text | hardBreak)*',
    defining: true,
    parseHTML: () => [{ tag: `div.${className}` }],
    renderHTML: () => ['div', { class: className }, 0],
    addKeyboardShortcuts() {
      const inPart = () => this.editor.state.selection.$from.parent.type.name === name;
      const parentField = () => this.editor.state.selection.$from.node(this.editor.state.selection.$from.depth - 1).attrs.field;
      return {
        // One line per part: Enter adds a line only to the subject's value.
        Enter: () => (inPart() ? (name === 'rowValue' && parentField() === 'perihal' ? this.editor.commands.setHardBreak() : true) : false),
        // Keep the three parts of a row apart: nothing joins them or deletes across them.
        Backspace: () => inPart() && this.editor.state.selection.empty && this.editor.state.selection.$from.parentOffset === 0,
        Delete: () => {
          const { $from, empty } = this.editor.state.selection;
          return inPart() && empty && $from.parentOffset === $from.parent.content.size;
        },
      };
    },
  });
const RowLabel = rowPart('rowLabel', 'meta-label');
const RowSep = rowPart('rowSep', 'meta-sep');
const RowValue = rowPart('rowValue', 'meta-value');

/** The closing greeting and the signature, which stay together on one page. */
const Closing = Node.create({
  name: 'closing',
  group: 'block',
  content: 'block+',
  defining: true,
  parseHTML: () => [{ tag: 'div.letter-closing' }],
  renderHTML: () => ['div', { class: 'letter-closing' }, 0],
});

const SignatureBlock = Node.create({
  name: 'signatureBlock',
  group: 'block',
  content: '(paragraph | signSpace | image)+',
  defining: true,
  // Where the block sits on the page; it starts at the right, as signatures usually do, but is not tied there.
  addAttributes: () => ({
    place: {
      default: 'right',
      parseHTML: (element) => element.getAttribute('data-place') || 'right',
      renderHTML: (attributes) => (attributes.place && attributes.place !== 'right' ? { 'data-place': attributes.place } : {}),
    },
  }),
  parseHTML: () => [{ tag: 'div.signature-block' }],
  renderHTML: ({ HTMLAttributes }) => ['div', { ...HTMLAttributes, class: 'signature-block' }, 0],
  addCommands() {
    return {
      setSignaturePlace:
        (place) =>
        ({ state, tr, dispatch }) => {
          const { $from } = state.selection;
          for (let depth = $from.depth; depth > 0; depth -= 1) {
            if ($from.node(depth).type.name === 'signatureBlock') {
              tr.setNodeMarkup($from.before(depth), undefined, { ...$from.node(depth).attrs, place });
              if (dispatch) dispatch(tr);
              return true;
            }
          }
          return false;
        },
    };
  },
});

/** The blank space left for the signature. */
const SignSpace = Node.create({
  name: 'signSpace',
  group: 'block',
  atom: true,
  selectable: true,
  parseHTML: () => [{ tag: 'div.sign-space' }],
  renderHTML: () => ['div', { class: 'sign-space' }],
});

/** A date in the letter. It is kept as a real date; clicking it opens the calendar. */
function LetterDateView({ node, updateAttributes }: NodeViewProps) {
  const [open, setOpen] = useState(false);
  const value = String(node.attrs.value || '');
  return (
    <NodeViewWrapper as="span">
      {open ? (
        <span className="inline-block w-52 align-middle font-sans text-xs not-italic font-normal indent-0">
          <IndonesianDatePicker value={value} label="Tanggal surat" initiallyOpen onValueChange={(next) => updateAttributes({ value: next })} onClose={() => setOpen(false)} />
        </span>
      ) : (
        <span
          role="button"
          tabIndex={0}
          title="Klik untuk mengubah tanggal"
          className="cursor-pointer rounded-sm hover:bg-indigo-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-indigo-500"
          onClick={() => setOpen(true)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' || event.key === ' ') {
              event.preventDefault();
              setOpen(true);
            }
          }}
        >
          {formatLetterDate(value) || 'Pilih tanggal'}
        </span>
      )}
    </NodeViewWrapper>
  );
}

const LetterDate = Node.create({
  name: 'letterDate',
  group: 'inline',
  inline: true,
  atom: true,
  addAttributes: () => ({ value: { default: '' } }),
  parseHTML: () => [{ tag: 'span.letter-date' }],
  renderHTML: ({ node }) => ['span', { class: 'letter-date', 'data-date': node.attrs.value }, formatLetterDate(String(node.attrs.value || ''))],
  addNodeView() {
    return ReactNodeViewRenderer(LetterDateView, { as: 'span' });
  },
});

/* ---- Surat Tugas: who gives the task, and who receives it ---- */

const pickerPill = 'rounded-sm bg-white px-2 py-0.5 font-sans text-[11px] font-semibold leading-normal shadow-sm ring-1';

function TaskAssignerView() {
  const controls = useContext(LetterEditorContext);
  if (!controls) return <NodeViewWrapper />;
  const { assigner, signerName, signerTitle, directory, onPickAssigner, onClearAssigner } = controls;
  return (
    <NodeViewWrapper>
      {assigner || signerName ? (
        <div className="task-giver relative">
          Pemberi tugas:
          <br />
          Nama: {signerName}
          <br />
          Jabatan: {signerTitle}
          <div data-letter-screen-only className="absolute right-0 top-0 flex items-center gap-1">
            <PersonPicker directory={directory} onSelect={onPickAssigner} label="Ganti pemberi tugas" panelClassName="right-0" buttonClassName={`${pickerPill} text-indigo-600 ring-indigo-200 hover:bg-indigo-50`} />
            <button type="button" onClick={onClearAssigner} className={`${pickerPill} text-rose-600 ring-rose-200 hover:bg-rose-50`}>
              Hapus
            </button>
          </div>
        </div>
      ) : (
        <div data-letter-screen-only className="mb-3 indent-0">
          <PersonPicker
            directory={directory}
            onSelect={onPickAssigner}
            label="+ Pilih pemberi tugas / penandatangan"
            buttonClassName="rounded-sm border border-dashed border-indigo-300 bg-indigo-50/60 px-3 py-1.5 font-sans text-xs font-semibold text-indigo-600 hover:bg-indigo-50"
          />
        </div>
      )}
    </NodeViewWrapper>
  );
}

const TaskAssigner = Node.create<{ data: LetterStaticData | null }>({
  name: 'taskAssigner',
  group: 'block',
  atom: true,
  draggable: true,
  addOptions: () => ({ data: null }),
  parseHTML: () => [{ tag: 'div.task-giver' }],
  renderHTML() {
    const data = this.options.data;
    // Without a chosen task giver there is nothing to print.
    return data?.signerName
      ? ['div', { class: 'task-giver' }, 'Pemberi tugas:', ['br'], `Nama: ${data.signerName}`, ['br'], `Jabatan: ${data.signerTitle}`]
      : ['div', { class: 'task-giver' }];
  },
});

function TaskPeopleView() {
  const controls = useContext(LetterEditorContext);
  if (!controls) return <NodeViewWrapper />;
  const { assigned, directory, onAddPerson, onRemovePerson } = controls;
  return (
    <NodeViewWrapper>
      {assigned.length ? (
        <div className="relative">
          <ol className="task-people">
            {assigned.map((person) => (
              <li key={`${person.collection}:${person.id}`} className="group relative">
                {formatAssignedPerson(person)}
                <button
                  type="button"
                  data-letter-screen-only
                  aria-label={`Hapus ${person.name}`}
                  title="Hapus dari daftar"
                  onClick={() => onRemovePerson(person)}
                  className="absolute right-0 top-1/2 inline-flex size-5 -translate-y-1/2 items-center justify-center rounded-sm bg-white font-sans text-sm leading-none text-rose-600 opacity-0 shadow-sm ring-1 ring-slate-200 transition-opacity hover:bg-rose-50 focus-visible:opacity-100 group-hover:opacity-100"
                >
                  ×
                </button>
              </li>
            ))}
          </ol>
          <div data-letter-screen-only className="absolute right-0 top-0 mr-7">
            <PersonPicker
              directory={directory}
              exclude={assigned}
              onSelect={onAddPerson}
              label="+ Tambah pegawai"
              panelClassName="right-0"
              buttonClassName="rounded-sm bg-white px-2 py-0.5 font-sans text-[11px] font-semibold leading-normal text-indigo-600 shadow-sm ring-1 ring-indigo-200 hover:bg-indigo-50"
            />
          </div>
        </div>
      ) : (
        <div data-letter-screen-only className="mb-3 indent-0">
          <PersonPicker
            directory={directory}
            onSelect={onAddPerson}
            label="+ Pilih pegawai yang ditugaskan"
            buttonClassName="rounded-sm border border-dashed border-indigo-300 bg-indigo-50/60 px-3 py-1.5 font-sans text-xs font-semibold text-indigo-600 hover:bg-indigo-50"
          />
        </div>
      )}
    </NodeViewWrapper>
  );
}

const TaskPeople = Node.create<{ data: LetterStaticData | null }>({
  name: 'taskPeople',
  group: 'block',
  atom: true,
  draggable: true,
  addOptions: () => ({ data: null }),
  parseHTML: () => [{ tag: 'ol[data-task-people]' }, { tag: 'div[data-task-people]' }],
  renderHTML() {
    const people = this.options.data?.people ?? [];
    return people.length
      ? ['ol', { class: 'task-people', 'data-task-people': '' }, ...people.map((person) => ['li', {}, formatAssignedPerson(person)] as const)]
      : ['div', { 'data-task-people': '' }];
  },
});

/* ------------------------------------------------------------------ */
/* Pictures, and where the printed pages end                           */
/* ------------------------------------------------------------------ */

const LetterImage = Image.extend({
  addAttributes() {
    return {
      src: { default: null, parseHTML: (element) => element.getAttribute('src') ?? element.querySelector('img')?.getAttribute('src') ?? null },
      alt: { default: null, parseHTML: (element) => element.getAttribute('alt') ?? element.querySelector('img')?.getAttribute('alt') ?? null },
      width: {
        default: null,
        parseHTML: (element) => Number(element.getAttribute('data-width')) || null,
        renderHTML: (attributes) => (attributes.width ? { 'data-width': String(attributes.width), style: `width: ${attributes.width}%` } : {}),
      },
      align: {
        default: 'center',
        parseHTML: (element) => element.getAttribute('data-align') || 'center',
        renderHTML: (attributes) => (attributes.align && attributes.align !== 'center' ? { 'data-align': attributes.align } : {}),
      },
      // A floating picture sits at a spot on the page (x, y in letter units from its top-left corner), outside the text flow.
      float: {
        default: false,
        parseHTML: (element) => element.hasAttribute('data-float'),
        renderHTML: (attributes) => (attributes.float ? { 'data-float': '' } : {}),
      },
      // Text wraps around the picture (it floats to the left or right, following its alignment).
      wrap: {
        default: false,
        parseHTML: (element) => element.hasAttribute('data-wrap'),
        renderHTML: (attributes) => (attributes.wrap ? { 'data-wrap': '' } : {}),
      },
      // A floating picture can sit behind the text instead of in front of it.
      behind: {
        default: false,
        parseHTML: (element) => element.hasAttribute('data-behind'),
        renderHTML: (attributes) => (attributes.float && attributes.behind ? { 'data-behind': '' } : {}),
      },
      rotate: {
        default: 0,
        parseHTML: (element) => Number(element.getAttribute('data-rotate')) || 0,
        renderHTML: (attributes) => (attributes.rotate ? { 'data-rotate': String(attributes.rotate), style: `transform: rotate(${attributes.rotate}deg)` } : {}),
      },
      x: {
        default: null,
        parseHTML: (element) => (element.hasAttribute('data-x') ? Number(element.getAttribute('data-x')) : null),
        renderHTML: (attributes) => (attributes.float && typeof attributes.x === 'number' ? { 'data-x': String(attributes.x), style: `left: calc(var(--u) * ${attributes.x})` } : {}),
      },
      y: {
        default: null,
        parseHTML: (element) => (element.hasAttribute('data-y') ? Number(element.getAttribute('data-y')) : null),
        renderHTML: (attributes) => (attributes.float && typeof attributes.y === 'number' ? { 'data-y': String(attributes.y), style: `top: calc(var(--u) * ${attributes.y})` } : {}),
      },
    };
  },
  parseHTML() {
    return [{ tag: 'div.letter-image' }, { tag: 'img[src]' }];
  },
  // The picture sits in a frame, which carries its size and place, so that handles can be drawn around it.
  renderHTML({ HTMLAttributes }) {
    const { src, alt, ...frame } = HTMLAttributes;
    return ['div', { ...frame, class: 'letter-image' }, ['img', { src, alt: alt ?? '', draggable: 'false' }]];
  },
  addNodeView() {
    return ({ node, getPos, view }) => {
      let current = node;
      const dom = document.createElement('div');
      dom.className = 'letter-image';
      const img = document.createElement('img');
      img.draggable = false;
      dom.appendChild(img);

      const draw = () => {
        const { src, alt, width, align, float, x, y, wrap, behind, rotate } = current.attrs;
        img.src = src || '';
        img.alt = alt || '';
        dom.style.width = width ? `${width}%` : '';
        dom.toggleAttribute('data-float', Boolean(float));
        dom.toggleAttribute('data-wrap', Boolean(wrap));
        dom.toggleAttribute('data-behind', Boolean(float && behind));
        dom.style.transform = rotate ? `rotate(${rotate}deg)` : '';
        dom.style.left = float && typeof x === 'number' ? `calc(var(--u) * ${x})` : '';
        dom.style.top = float && typeof y === 'number' ? `calc(var(--u) * ${y})` : '';
        if (align && align !== 'center') dom.setAttribute('data-align', align);
        else dom.removeAttribute('data-align');
      };
      draw();

      const angle = () => ((Number(current.attrs.rotate) || 0) * Math.PI) / 180;

      /**
       * Dragging a handle changes the width (the height follows, so the picture is never stretched). The distance is
       * measured along the picture's own axes, so a turned picture resizes as expected; a left or top handle keeps
       * the opposite edge still when the picture floats on the page.
       */
      const startResize = (handle: string) => (event: MouseEvent) => {
        event.preventDefault();
        event.stopPropagation();
        const doc = dom.closest('.letter-doc') as HTMLElement | null;
        if (!doc || !view.editable) return;
        const docWidth = doc.getBoundingClientRect().width;
        const unit = docWidth / PAGE_CONTENT_WIDTH_U;
        // The width is a share of the picture's own container (the page, a signature block, a table cell), not always of the page.
        const parent = dom.parentElement;
        const parentStyle = parent ? getComputedStyle(parent) : null;
        const base = current.attrs.float || !parent || !parentStyle ? docWidth : parent.clientWidth - parseFloat(parentStyle.paddingLeft) - parseFloat(parentStyle.paddingRight);
        const startWidth = dom.offsetWidth;
        const startHeight = dom.offsetHeight || startWidth;
        const ratio = startWidth / startHeight;
        const theta = angle();
        const startX = event.clientX;
        const startY = event.clientY;
        const x0 = typeof current.attrs.x === 'number' ? current.attrs.x : 0;
        const y0 = typeof current.attrs.y === 'number' ? current.attrs.y : 0;
        const west = handle.includes('w');
        const north = handle.includes('n');
        const sideways = handle === 'e' || handle === 'w';
        const vertical = handle === 'n' || handle === 's';
        let percent = (startWidth / base) * 100;
        let x = x0;
        let y = y0;
        const move = (moveEvent: MouseEvent) => {
          const dx = moveEvent.clientX - startX;
          const dy = moveEvent.clientY - startY;
          const along = dx * Math.cos(theta) + dy * Math.sin(theta);
          const down = -dx * Math.sin(theta) + dy * Math.cos(theta);
          let width = startWidth;
          if (vertical) width = startWidth + (north ? -down : down) * ratio;
          else if (sideways || handle.length === 2) width = startWidth + (west ? -along : along);
          width = Math.max(base * 0.05, Math.min(base, width));
          percent = (width / base) * 100;
          dom.style.width = `${percent}%`;
          if (current.attrs.float && !theta) {
            if (west) {
              x = x0 + (startWidth - width) / unit;
              dom.style.left = `calc(var(--u) * ${x})`;
            }
            if (north) {
              y = y0 + (startHeight - width / ratio) / unit;
              dom.style.top = `calc(var(--u) * ${y})`;
            }
          }
        };
        const up = () => {
          document.removeEventListener('mousemove', move);
          document.removeEventListener('mouseup', up);
          const pos = getPos();
          if (typeof pos !== 'number') return;
          const moved = current.attrs.float && !theta ? { x: Math.round(x * 10) / 10, y: Math.round(y * 10) / 10 } : {};
          view.dispatch(view.state.tr.setNodeMarkup(pos, undefined, { ...current.attrs, width: percent >= 99.5 ? null : Math.round(percent * 10) / 10, ...moved }));
        };
        document.addEventListener('mousemove', move);
        document.addEventListener('mouseup', up);
      };

      /** The round handle above the picture turns it around its centre; it snaps upright when close, and to 15° steps with Shift. */
      const startRotate = (event: MouseEvent) => {
        event.preventDefault();
        event.stopPropagation();
        if (!view.editable) return;
        const box = dom.getBoundingClientRect();
        const cx = box.left + box.width / 2;
        const cy = box.top + box.height / 2;
        let degrees = Number(current.attrs.rotate) || 0;
        const move = (moveEvent: MouseEvent) => {
          let next = (Math.atan2(moveEvent.clientY - cy, moveEvent.clientX - cx) * 180) / Math.PI + 90;
          if (next > 180) next -= 360;
          if (moveEvent.shiftKey) next = Math.round(next / 15) * 15;
          else if (Math.abs(next) < 3) next = 0;
          degrees = Math.round(next * 10) / 10;
          dom.style.transform = degrees ? `rotate(${degrees}deg)` : '';
        };
        const up = () => {
          document.removeEventListener('mousemove', move);
          document.removeEventListener('mouseup', up);
          const pos = getPos();
          if (typeof pos === 'number') view.dispatch(view.state.tr.setNodeMarkup(pos, undefined, { ...current.attrs, rotate: degrees }));
        };
        document.addEventListener('mousemove', move);
        document.addEventListener('mouseup', up);
      };

      for (const handle of ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w']) {
        const element = document.createElement('span');
        element.className = `letter-handle letter-handle--${handle}`;
        element.setAttribute('data-letter-screen-only', '');
        element.setAttribute('contenteditable', 'false');
        element.addEventListener('mousedown', startResize(handle));
        dom.appendChild(element);
      }
      const rotator = document.createElement('span');
      rotator.className = 'letter-handle letter-handle--rotate';
      rotator.title = 'Putar gambar (tahan Shift untuk kelipatan 15°)';
      rotator.setAttribute('data-letter-screen-only', '');
      rotator.setAttribute('contenteditable', 'false');
      rotator.addEventListener('mousedown', startRotate);
      dom.appendChild(rotator);

      return {
        dom,
        update(updated) {
          if (updated.type !== current.type) return false;
          current = updated;
          draw();
          return true;
        },
        // Nothing inside the frame is editable text, so changes to it (handles, live resizing) are not edits.
        ignoreMutation: () => true,
        stopEvent: (event) => (event.target as HTMLElement | null)?.classList?.contains('letter-handle') ?? false,
      };
    };
  },
  addCommands() {
    return {
      ...this.parent?.(),
      setImageLayout:
        (layout) =>
        ({ commands }) => {
          const attrs: Record<string, unknown> = {};
          if ('width' in layout) attrs.width = layout.width;
          if (layout.align) attrs.align = layout.align;
          if ('rotate' in layout) attrs.rotate = layout.rotate;
          return commands.updateAttributes('image', attrs);
        },
      setImageMode:
        (mode) =>
        ({ state, view, commands }) => {
          const { selection } = state;
          if (!(selection instanceof NodeSelection) || selection.node.type.name !== 'image') return false;
          const align = selection.node.attrs.align;
          if (mode === 'inline') return commands.updateAttributes('image', { float: false, behind: false, wrap: false, x: null, y: null });
          // Text wraps to one side, so a centred picture moves to the left.
          if (mode === 'wrap') return commands.updateAttributes('image', { float: false, behind: false, wrap: true, x: null, y: null, align: align === 'right' ? 'right' : 'left' });
          // Free on the page: not inside a table cell, where the position would be measured from the cell.
          const inCell = [...Array(selection.$from.depth + 1).keys()].some((depth) => ['tableCell', 'tableHeader'].includes(selection.$from.node(depth).type.name));
          const frame = view.nodeDOM(selection.from) as HTMLElement | null;
          const doc = frame?.closest('.letter-doc') as HTMLElement | null;
          if (inCell || !frame || !doc) return false;
          const unit = doc.getBoundingClientRect().width / PAGE_CONTENT_WIDTH_U;
          const a = frame.getBoundingClientRect();
          const b = doc.getBoundingClientRect();
          return commands.updateAttributes('image', {
            float: true,
            behind: mode === 'behind',
            wrap: false,
            x: Math.round(((a.left - b.left) / unit) * 10) / 10,
            y: Math.round(((a.top - b.top) / unit) * 10) / 10,
          });
        },
    };
  },
});

/**
 * When the closing block would be split by a page break, printing moves it to the next page whole. The
 * preview does the same by giving it extra space above; the sheet works out how much and stores it here.
 */
const pageBreakKey = new PluginKey('letterPageBreak');
const PageBreak = Extension.create({
  name: 'pageBreak',
  addStorage: () => ({ spacer: 0 }),
  addProseMirrorPlugins() {
    const storage = this.storage;
    return [
      new Plugin({
        key: pageBreakKey,
        props: {
          decorations(state) {
            if (!storage.spacer) return null;
            let found: DecorationSet | null = null;
            state.doc.descendants((node, pos) => {
              if (found) return false;
              if (node.type.name === 'closing') {
                found = DecorationSet.create(state.doc, [
                  Decoration.node(pos, pos + node.nodeSize, { style: `margin-top: calc(var(--u) * ${storage.spacer + 1})`, 'data-letter-pushed': '' }),
                ]);
                return false;
              }
              return true;
            });
            return found;
          },
        },
      }),
    ];
  },
});

/** Tells the editor how far to push the closing block down; the sheet calls this as the letter changes. */
export function setPageBreakSpacer(editor: Editor, spacer: number) {
  const storage = (editor.storage as { pageBreak?: { spacer: number } }).pageBreak;
  if (!storage || Math.abs(storage.spacer - spacer) < 0.01) return;
  storage.spacer = spacer;
  editor.view.dispatch(editor.view.state.tr.setMeta(pageBreakKey, spacer));
}

/* ------------------------------------------------------------------ */
/* Table column widths                                                 */
/* ------------------------------------------------------------------ */

const MIN_COLUMN = 5;
/** Width of the writing area of the page (170mm), in letter units. */
const PAGE_CONTENT_WIDTH_U = LETTER_CONTENT_WIDTH_U;

/** Column widths of a table as shares of its width (percent), so they hold at any sheet size and in print. */
function columnShares(table: PmNode, map: TableMap): number[] {
  const shares: number[] = Array(map.width).fill(0);
  const seen = new Set<number>();
  map.map.forEach((pos) => {
    if (seen.has(pos)) return;
    seen.add(pos);
    const cell = table.nodeAt(pos);
    const widths = cell?.attrs.colwidth as number[] | null | undefined;
    const first = map.colCount(pos);
    const span = (cell?.attrs.colspan as number) || 1;
    for (let offset = 0; offset < span; offset += 1) {
      if (widths && widths[offset] > 0 && !shares[first + offset]) shares[first + offset] = widths[offset];
    }
  });
  return shares.every((value) => value > 0) ? shares : Array(map.width).fill(100 / map.width);
}

/** Drag the border between two columns to widen one and narrow the other, as in a word processor. */
const TableColumnResize = Extension.create({
  name: 'tableColumnResize',
  addProseMirrorPlugins() {
    const edge = (view: EditorView, event: MouseEvent) => {
      // The selection grips sit on the cell edges and have their own clicks.
      if ((event.target as HTMLElement | null)?.closest?.('.letter-grip')) return null;
      const cell = (event.target as HTMLElement | null)?.closest?.('td,th') as HTMLElement | null;
      if (!cell || !view.dom.contains(cell)) return null;
      const rect = cell.getBoundingClientRect();
      const nearRight = rect.right - event.clientX <= 5;
      const nearLeft = event.clientX - rect.left <= 5;
      if (!nearRight && !nearLeft) return null;
      const $pos = view.state.doc.resolve(view.posAtDOM(cell, 0));
      let tableDepth = $pos.depth;
      while (tableDepth > 0 && $pos.node(tableDepth).type.name !== 'table') tableDepth -= 1;
      if (tableDepth === 0) return null;
      const tableStart = $pos.start(tableDepth);
      const table = $pos.node(tableDepth);
      const map = TableMap.get(table);
      const rel = $pos.before(tableDepth + 2) - tableStart;
      const span = (table.nodeAt(rel)?.attrs.colspan as number) || 1;
      const col = nearRight ? map.colCount(rel) + span - 1 : map.colCount(rel) - 1;
      if (col < 0 || col >= map.width - 1) return null;
      return { col, tableStart, table, map, tableDom: cell.closest('table') as HTMLElement };
    };

    return [
      new Plugin({
        key: new PluginKey('letterColumnResize'),
        props: {
          handleDOMEvents: {
            mousemove(view, event) {
              if (view.editable) view.dom.classList.toggle('letter-col-resize', Boolean(edge(view, event as MouseEvent)));
              return false;
            },
            mousedown(view, event) {
              const hit = edge(view, event as MouseEvent);
              if (!hit) return false;
              event.preventDefault();
              const { col, tableStart, map, tableDom } = hit;
              const startX = (event as MouseEvent).clientX;
              const start = columnShares(hit.table, map);
              const tableWidth = tableDom.getBoundingClientRect().width;

              const apply = (shares: number[]) => {
                const table = view.state.doc.nodeAt(tableStart - 1);
                if (!table) return;
                const tr = view.state.tr;
                const current = TableMap.get(table);
                const done = new Set<number>();
                current.map.forEach((pos) => {
                  if (done.has(pos)) return;
                  done.add(pos);
                  const cell = table.nodeAt(pos);
                  if (!cell) return;
                  const first = current.colCount(pos);
                  const spanCount = (cell.attrs.colspan as number) || 1;
                  tr.setNodeMarkup(tableStart + pos, undefined, {
                    ...cell.attrs,
                    colwidth: shares.slice(first, first + spanCount).map((value) => Math.round(value * 10) / 10),
                  });
                });
                view.dispatch(tr);
              };

              const move = (moveEvent: MouseEvent) => {
                const delta = ((moveEvent.clientX - startX) / tableWidth) * 100;
                const pair = start[col] + start[col + 1];
                const left = Math.max(MIN_COLUMN, Math.min(pair - MIN_COLUMN, start[col] + delta));
                const shares = [...start];
                shares[col] = left;
                shares[col + 1] = pair - left;
                apply(shares);
              };
              const up = () => {
                document.removeEventListener('mousemove', move);
                document.removeEventListener('mouseup', up);
              };
              document.addEventListener('mousemove', move);
              document.addEventListener('mouseup', up);
              return true;
            },
          },
        },
      }),
    ];
  },
});

/* ---- Selecting parts of a table, as in Google Docs ---- */

/** The table the cursor is in, with where it starts. */
function tableAtSelection(state: import('@tiptap/pm/state').EditorState) {
  const { $from } = state.selection;
  for (let depth = $from.depth; depth > 0; depth -= 1) {
    if ($from.node(depth).type.name === 'table') return { table: $from.node(depth), start: $from.start(depth) };
  }
  return null;
}

function grip(kind: 'col' | 'row' | 'table', title: string, onSelect: (view: EditorView) => void) {
  return (view: EditorView) => {
    const element = document.createElement('span');
    element.className = `letter-grip letter-grip--${kind}`;
    element.title = title;
    element.setAttribute('contenteditable', 'false');
    element.setAttribute('data-letter-screen-only', '');
    element.addEventListener('mousedown', (event) => {
      event.preventDefault();
      onSelect(view);
      view.focus();
    });
    return element;
  };
}

/**
 * Handles for choosing a whole column, a whole row or the whole table, shown on the table the cursor is in.
 * Dragging across cells (which the table plugin already does) and these handles all make a cell selection,
 * which is highlighted, can be cut or cleared, and deletes the table when it covers every cell.
 */
const TableSelectionTools = Extension.create({
  name: 'tableSelectionTools',

  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: new PluginKey('letterTableTools'),
        props: {
          decorations(state) {
            const found = tableAtSelection(state);
            if (!found) return null;
            const { table, start } = found;
            const doc = state.doc;
            const select = (anchor: number, head: number) => (view: EditorView) => view.dispatch(view.state.tr.setSelection(CellSelection.create(view.state.doc, anchor, head)));
            const decorations: Decoration[] = [];
            const map = TableMap.get(table);
            table.forEach((row, rowOffset, rowIndex) => {
              row.forEach((_cell, cellOffset, cellIndex) => {
                const cellPos = start + rowOffset + 1 + cellOffset;
                if (rowIndex === 0) {
                  decorations.push(
                    Decoration.widget(cellPos + 1, grip('col', 'Pilih kolom', (view) => view.dispatch(view.state.tr.setSelection(CellSelection.colSelection(view.state.doc.resolve(cellPos))))), { side: -3, key: `col-${cellPos}`, ignoreSelection: true, stopEvent: () => true }),
                  );
                }
                if (cellIndex === 0) {
                  decorations.push(
                    Decoration.widget(cellPos + 1, grip('row', 'Pilih baris', (view) => view.dispatch(view.state.tr.setSelection(CellSelection.rowSelection(view.state.doc.resolve(cellPos))))), { side: -2, key: `row-${cellPos}`, ignoreSelection: true, stopEvent: () => true }),
                  );
                }
                if (rowIndex === 0 && cellIndex === 0) {
                  const first = start + map.map[0];
                  const last = start + map.map[map.map.length - 1];
                  decorations.push(Decoration.widget(cellPos + 1, grip('table', 'Pilih seluruh tabel', select(first, last)), { side: -1, key: `table-${cellPos}`, ignoreSelection: true, stopEvent: () => true }));
                }
              });
            });
            return DecorationSet.create(doc, decorations);
          },
        },
      }),
    ];
  },

  addKeyboardShortcuts() {
    // With every cell selected, Delete removes the table itself (as Google Docs does); with fewer, it clears them.
    const wholeTable = () => {
      const { selection } = this.editor.state;
      if (!(selection instanceof CellSelection)) return false;
      const found = tableAtSelection(this.editor.state);
      if (!found) return false;
      let selected = 0;
      selection.forEachCell(() => {
        selected += 1;
      });
      return selected === new Set(TableMap.get(found.table).map).size;
    };
    return {
      Backspace: () => (wholeTable() ? this.editor.commands.deleteTable() : false),
      Delete: () => (wholeTable() ? this.editor.commands.deleteTable() : false),
    };
  },
});

/** A table whose columns carry their widths as shares of the table, written out when it is shown or printed. */
function columnWidthsOf(node: PmNode): number[] | null {
  const map = TableMap.get(node);
  const shares = columnShares(node, map);
  const custom = map.width > 0 && shares.some((value) => Math.abs(value - 100 / map.width) > 0.05);
  return custom ? shares : null;
}

const LetterTable = Table.extend({
  renderHTML({ node, HTMLAttributes }) {
    const shares = columnWidthsOf(node);
    return [
      'table',
      { ...HTMLAttributes, style: 'width: 100%' },
      ...(shares ? [['colgroup', {}, ...shares.map((value) => ['col', { style: `width: ${value}%` }] as const)] as const] : []),
      ['tbody', 0],
    ];
  },
  // The editor redraws the column widths itself whenever they change (the cells alone changing would not redraw them).
  addNodeView() {
    return ({ node: initial }) => {
      let current = initial;
      const dom = document.createElement('table');
      dom.style.width = '100%';
      const colgroup = document.createElement('colgroup');
      const body = document.createElement('tbody');
      dom.append(colgroup, body);
      const draw = () => {
        const shares = columnWidthsOf(current);
        colgroup.replaceChildren(
          ...(shares ?? []).map((value) => {
            const col = document.createElement('col');
            col.style.width = `${value}%`;
            return col;
          }),
        );
      };
      draw();
      return {
        dom,
        contentDOM: body,
        update(updated: PmNode) {
          if (updated.type !== current.type) return false;
          current = updated;
          draw();
          return true;
        },
      };
    };
  },
});

/* ---- Several separate selections at once (hold Ctrl, or Cmd on a Mac, and select more text) ---- */

interface Range {
  from: number;
  to: number;
}
const multiKey = new PluginKey<Range[]>('letterMultiSelection');
/** The key that adds to a selection: Cmd on a Mac, Ctrl on Windows and elsewhere (Ctrl-click on a Mac opens a menu instead). */
const isMac = () => typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);
const addKey = (event: MouseEvent | KeyboardEvent) => (isMac() ? event.metaKey : event.ctrlKey);

/** The extra passages chosen with Ctrl/Cmd held; the passage selected now is the editor's ordinary selection. */
export function extraSelections(editor: Editor): Range[] {
  return multiKey.getState(editor.state) ?? [];
}

/**
 * Select several separate passages, as in Google Docs: hold Ctrl (Cmd on a Mac) and select more text, and the
 * earlier passages stay highlighted. The formatting buttons then act on all of them. Clicking elsewhere or
 * pressing Escape clears the extra passages.
 */
const MultiSelection = Extension.create({
  name: 'multiSelection',
  addProseMirrorPlugins() {
    return [
      new Plugin<Range[]>({
        key: multiKey,
        state: {
          init: () => [],
          apply(tr, ranges) {
            const meta = tr.getMeta(multiKey) as { add?: Range; clear?: boolean } | undefined;
            if (meta?.clear) return [];
            let next = ranges.length
              ? ranges.map((range) => ({ from: tr.mapping.map(range.from, 1), to: tr.mapping.map(range.to, -1) })).filter((range) => range.to > range.from)
              : ranges;
            if (meta?.add) next = [...next.filter((range) => range.to <= meta.add!.from || range.from >= meta.add!.to), meta.add];
            return next;
          },
        },
        props: {
          decorations(state) {
            const ranges = multiKey.getState(state) ?? [];
            return ranges.length ? DecorationSet.create(state.doc, ranges.map((range) => Decoration.inline(range.from, range.to, { class: 'letter-multi-sel' }))) : null;
          },
          handleDOMEvents: {
            mousedown(view, rawEvent) {
              const event = rawEvent as MouseEvent;
              if (event.button !== 0 || !view.editable) return false;
              const { selection } = view.state;
              if (addKey(event) && selection instanceof TextSelection && !selection.empty) {
                view.dispatch(view.state.tr.setMeta(multiKey, { add: { from: selection.from, to: selection.to } }));
              } else if (!addKey(event) && (multiKey.getState(view.state) ?? []).length && !(event.target as HTMLElement | null)?.closest?.('[role=toolbar]')) {
                view.dispatch(view.state.tr.setMeta(multiKey, { clear: true }));
              }
              return false;
            },
            keydown(view, rawEvent) {
              const event = rawEvent as KeyboardEvent;
              const ranges = multiKey.getState(view.state) ?? [];
              if (!ranges.length) return false;
              // Formatting shortcuts (Ctrl+B and the like) keep the passages; anything that types or moves clears them.
              if (!event.ctrlKey && !event.metaKey && !['Shift', 'Control', 'Meta', 'Alt'].includes(event.key)) view.dispatch(view.state.tr.setMeta(multiKey, { clear: true }));
              return false;
            },
          },
        },
      }),
    ];
  },
});

/** Drag a floating picture anywhere on the page. A picture in the text is moved between paragraphs by the editor's own drag. */
const ImageFloatDrag = Extension.create({
  name: 'imageFloatDrag',
  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: new PluginKey('letterImageFloatDrag'),
        props: {
          handleDOMEvents: {
            mousedown(view, rawEvent) {
              const event = rawEvent as MouseEvent;
              const img = (event.target as HTMLElement | null)?.closest?.('.letter-image[data-float]') as HTMLElement | null;
              if (!img || event.button !== 0 || !view.editable || !img.parentNode) return false;
              event.preventDefault();
              const pos = view.posAtDOM(img.parentNode, Array.prototype.indexOf.call(img.parentNode.childNodes, img));
              const node = view.state.doc.nodeAt(pos);
              if (!node || node.type.name !== 'image') return false;
              view.dispatch(view.state.tr.setSelection(NodeSelection.create(view.state.doc, pos)));
              view.focus();

              const doc = img.closest('.letter-doc') as HTMLElement;
              const unit = doc.getBoundingClientRect().width / PAGE_CONTENT_WIDTH_U;
              const startX = event.clientX;
              const startY = event.clientY;
              const x0 = typeof node.attrs.x === 'number' ? node.attrs.x : 0;
              const y0 = typeof node.attrs.y === 'number' ? node.attrs.y : 0;
              let x = x0;
              let y = y0;
              let moved = false;

              const move = (moveEvent: MouseEvent) => {
                if (!moved && Math.hypot(moveEvent.clientX - startX, moveEvent.clientY - startY) < 3) return;
                moved = true;
                x = Math.max(-2, Math.min(PAGE_CONTENT_WIDTH_U + 2, x0 + (moveEvent.clientX - startX) / unit));
                y = Math.max(-2, y0 + (moveEvent.clientY - startY) / unit);
                img.style.left = `calc(var(--u) * ${x})`;
                img.style.top = `calc(var(--u) * ${y})`;
              };
              const up = () => {
                document.removeEventListener('mousemove', move);
                document.removeEventListener('mouseup', up);
                if (!moved) return;
                const current = view.state.doc.nodeAt(pos);
                if (current?.type.name === 'image') {
                  view.dispatch(view.state.tr.setNodeMarkup(pos, undefined, { ...current.attrs, x: Math.round(x * 10) / 10, y: Math.round(y * 10) / 10 }));
                }
              };
              document.addEventListener('mousemove', move);
              document.addEventListener('mouseup', up);
              return true;
            },
          },
        },
      }),
    ];
  },
});

/* ------------------------------------------------------------------ */
/* Putting it together                                                 */
/* ------------------------------------------------------------------ */

const SetLetterField = Extension.create({
  name: 'setLetterField',
  addCommands() {
    return {
      setLetterField:
        (field, text) =>
        ({ state, tr, dispatch }) => {
          let target: { pos: number; size: number; marks: readonly PmMark[] } | null = null;
          state.doc.descendants((node, pos) => {
            if (target) return false;
            if (node.type.name === 'paragraph' && node.attrs.field === field) {
              target = { pos, size: node.nodeSize, marks: node.firstChild?.marks ?? [] };
              return false;
            }
            // A numbered row's value is the third part of the row.
            if (node.type.name === 'labelRow' && node.attrs.field === field) {
              node.forEach((child, offset) => {
                if (child.type.name === 'rowValue') target = { pos: pos + 1 + offset, size: child.nodeSize, marks: child.firstChild?.marks ?? [] };
              });
              return false;
            }
            return true;
          });
          if (!target) return false;
          const { pos, size, marks } = target as { pos: number; size: number; marks: readonly PmMark[] };
          const { schema } = state;
          if (!text && field === 'penandatanganNipy') {
            tr.delete(pos, pos + size);
          } else {
            const nodes = textContent(text, (value) => schema.text(value, marks), () => schema.nodes.hardBreak.create()) as PmNode[];
            tr.replaceWith(pos + 1, pos + size - 1, nodes);
          }
          if (dispatch) dispatch(tr);
          return true;
        },
    };
  },
});

const base = [
  StarterKit.configure({
    blockquote: false,
    code: false,
    codeBlock: false,
    heading: false,
    horizontalRule: false,
    strike: false,
    link: false,
    trailingNode: false,
  }),
  // The letter is justified unless a paragraph says otherwise.
  TextAlign.configure({ types: ['paragraph'], alignments: [...LETTER_ALIGNMENTS], defaultAlignment: PARAGRAPH_DEFAULTS.textAlign }),
  TextStyle,
  LetterTextStyle,
  ParagraphLayout,
  LetterTable.configure({ resizable: false }),
  TableColumnResize,
  TableSelectionTools,
  ImageFloatDrag,
  MultiSelection,
  TableRow,
  TableHeader,
  TableCell,
  LetterImage.configure({ inline: false, allowBase64: true }),
  Kop,
  LabelRow,
  RowLabel,
  RowSep,
  RowValue,
  Closing,
  SignatureBlock,
  SignSpace,
  LetterDate,
  SetLetterField,
  PageBreak,
];

/** Everything a letter may contain. Without `data`, the Surat Tugas blocks are the editable kind; with it, they print the given names. */
export function letterDocExtensions(data?: LetterStaticData) {
  return [
    ...base,
    data ? TaskAssigner.configure({ data }) : TaskAssigner.extend({ addNodeView: () => ReactNodeViewRenderer(TaskAssignerView) }),
    data ? TaskPeople.configure({ data }) : TaskPeople.extend({ addNodeView: () => ReactNodeViewRenderer(TaskPeopleView) }),
  ];
}
