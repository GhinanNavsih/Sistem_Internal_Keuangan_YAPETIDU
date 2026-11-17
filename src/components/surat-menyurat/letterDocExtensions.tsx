"use client";

import { createContext, useContext, useState } from 'react';
import { Extension, Node, type CommandProps, type Editor } from '@tiptap/core';
import type { Mark as PmMark, Node as PmNode } from '@tiptap/pm/model';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';
import { NodeViewWrapper, ReactNodeViewRenderer, type NodeViewProps } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import TextAlign from '@tiptap/extension-text-align';
import { TextStyle } from '@tiptap/extension-text-style';
import { Table, TableCell, TableHeader, TableRow } from '@tiptap/extension-table';
import Image from '@tiptap/extension-image';
import { formatAssignedPerson, LETTER_ALIGNMENTS, LETTER_MAX_INDENT, PARAGRAPH_DEFAULTS } from '@/lib/surat-menyurat/letterDoc';
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

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    letterDoc: {
      /** Move the selected paragraphs one step in (or out); inside a list, nest (or lift) the item instead. */
      changeIndent: (direction: 1 | -1) => ReturnType;
      /** Turn the first-line indent of the selected paragraphs on or off. */
      toggleFirstLine: () => ReturnType;
      /** Replace the text of a part of the letter that the record reads back (nomor, signer name, and so on). */
      setLetterField: (field: string, text: string) => ReturnType;
      /** Change how a picture sits: its width as a share of the page, and its alignment. */
      setImageLayout: (layout: { width?: number | null; align?: 'left' | 'center' | 'right' }) => ReturnType;
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
    // In a table, Tab belongs to the table (next cell).
    return {
      Tab: () => !this.editor.isActive('table') && this.editor.commands.changeIndent(1),
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

/** A numbered row such as "Nomor : ...": the label is fixed, the value is text you write. */
const LabelRow = Node.create({
  name: 'labelRow',
  group: 'block',
  content: '(text | hardBreak)*',
  defining: true,
  addAttributes: () => ({ label: { default: '' }, field: { default: 'nomorSurat' } }),
  parseHTML: () => [{ tag: 'div.meta-row', contentElement: '.meta-value' }],
  renderHTML({ node }) {
    return [
      'div',
      { class: 'meta-row', 'data-field': node.attrs.field },
      ['span', { class: 'meta-label', contenteditable: 'false' }, node.attrs.label],
      ['span', { class: 'meta-sep', contenteditable: 'false' }, ':'],
      ['div', { class: 'meta-value' }, 0],
    ];
  },
  addKeyboardShortcuts() {
    // One value per row: Enter adds a line only to the subject, and does nothing elsewhere.
    const inRow = () => this.editor.state.selection.$from.parent.type.name === 'labelRow';
    return {
      Enter: () => (inRow() ? (this.editor.state.selection.$from.parent.attrs.field === 'perihal' ? this.editor.commands.setHardBreak() : true) : false),
    };
  },
});

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
  content: '(paragraph | signSpace)+',
  defining: true,
  parseHTML: () => [{ tag: 'div.signature-block' }],
  renderHTML: () => ['div', { class: 'signature-block' }, 0],
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
      src: { default: null },
      alt: { default: null },
      width: {
        default: null,
        parseHTML: (element) => Number(element.getAttribute('data-width')) || null,
        renderHTML: (attributes) => (attributes.width ? { 'data-width': attributes.width, style: `width: ${attributes.width}%` } : {}),
      },
      align: {
        default: 'center',
        parseHTML: (element) => element.getAttribute('data-align') || 'center',
        renderHTML: (attributes) => (attributes.align && attributes.align !== 'center' ? { 'data-align': attributes.align } : {}),
      },
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
          return commands.updateAttributes('image', attrs);
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
            if ((node.type.name === 'paragraph' || node.type.name === 'labelRow') && node.attrs.field === field) {
              target = { pos, size: node.nodeSize, marks: node.firstChild?.marks ?? [] };
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
  Table.configure({ resizable: false }),
  TableRow,
  TableHeader,
  TableCell,
  LetterImage.configure({ inline: false, allowBase64: true }),
  Kop,
  LabelRow,
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
