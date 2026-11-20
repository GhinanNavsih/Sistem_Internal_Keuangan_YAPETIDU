"use client";

import React, { useRef } from 'react';
import type { Editor } from '@tiptap/core';
import { useEditorState } from '@tiptap/react';
import {
  AlignCenter,
  AlignJustify,
  AlignLeft,
  AlignRight,
  Baseline,
  Bold,
  Highlighter,
  ImagePlus,
  IndentDecrease,
  IndentIncrease,
  Italic,
  List,
  ListOrdered,
  Minus,
  PilcrowRight,
  Plus,
  Redo2,
  Table as TableIcon,
  Underline,
  Undo2,
  X,
  type LucideIcon,
} from 'lucide-react';
import { extraSelections } from './letterDocExtensions';
import { LETTER_BASE_PT, LETTER_FONT_FAMILIES, LETTER_FONT_SIZES, LETTER_MAX_IMAGES_CHARS } from '@/lib/surat-menyurat/letterDoc';
import { imageToDataUrl, LETTER_IMAGE_ACCEPT } from '@/lib/surat-menyurat/imageData';

const DEFAULT_FONT = 'Times New Roman';
type Chain = ReturnType<Editor['chain']>;

function ToolButton({
  label,
  icon: Icon,
  active = false,
  disabled = false,
  onClick,
}: {
  label: string;
  icon: LucideIcon;
  active?: boolean;
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      aria-pressed={active}
      disabled={disabled}
      // Keep the text selection in the paper while a button is pressed.
      onMouseDown={(event) => event.preventDefault()}
      onClick={onClick}
      className={`inline-flex size-8 shrink-0 items-center justify-center rounded-sm transition-colors disabled:opacity-35 ${
        active ? 'bg-indigo-100 text-indigo-700' : 'text-slate-600 hover:bg-slate-100'
      } ${disabled ? 'cursor-default' : 'cursor-pointer'}`}
    >
      <Icon className="size-4" />
    </button>
  );
}

function TextButton({ label, onClick, active = false, danger = false }: { label: string; onClick: () => void; active?: boolean; danger?: boolean }) {
  return (
    <button
      type="button"
      onMouseDown={(event) => event.preventDefault()}
      onClick={onClick}
      aria-pressed={active}
      className={`h-7 shrink-0 cursor-pointer rounded-sm px-2 text-[11px] font-semibold transition-colors ${
        danger ? 'text-rose-600 hover:bg-rose-50' : active ? 'bg-indigo-100 text-indigo-700' : 'text-slate-600 hover:bg-slate-100'
      }`}
    >
      {label}
    </button>
  );
}

const Divider = () => <span aria-hidden className="mx-1 h-5 w-px shrink-0 bg-slate-200" />;

/** A colour button: shows the current colour under the letter, opens the browser's colour picker, and can clear it. */
function ColorTool({
  label,
  icon: Icon,
  value,
  fallback,
  disabled,
  onChange,
  onClear,
}: {
  label: string;
  icon: LucideIcon;
  value: string | null;
  fallback: string;
  disabled: boolean;
  onChange: (color: string) => void;
  onClear: () => void;
}) {
  return (
    <span className="inline-flex items-center">
      <label
        title={label}
        className={`relative inline-flex size-8 shrink-0 items-center justify-center rounded-sm text-slate-600 hover:bg-slate-100 ${disabled ? 'pointer-events-none opacity-35' : 'cursor-pointer'}`}
      >
        <Icon className="size-4" />
        <span aria-hidden className="absolute bottom-1 left-1.5 right-1.5 h-[3px] rounded-full" style={{ background: value || fallback }} />
        <input
          type="color"
          aria-label={label}
          value={value || fallback}
          disabled={disabled}
          onChange={(event) => onChange(event.target.value)}
          className="absolute inset-0 size-full cursor-pointer opacity-0"
        />
      </label>
      {value && (
        <button type="button" title={`Hapus ${label.toLowerCase()}`} aria-label={`Hapus ${label.toLowerCase()}`} onMouseDown={(event) => event.preventDefault()} onClick={onClear} className="-ml-1 inline-flex size-5 cursor-pointer items-center justify-center rounded-sm text-slate-400 hover:bg-slate-100 hover:text-rose-600">
          <X className="size-3" />
        </button>
      )}
    </span>
  );
}

function imageChars(editor: Editor): number {
  let total = 0;
  editor.state.doc.descendants((node) => {
    if (node.type.name === 'image') total += String(node.attrs.src || '').length;
  });
  return total;
}

const RESTING_STATE = {
  canUndo: false,
  canRedo: false,
  bold: false,
  italic: false,
  underline: false,
  bulletList: false,
  orderedList: false,
  firstLine: true,
  align: 'justify',
  fontFamily: DEFAULT_FONT,
  fontSize: LETTER_BASE_PT as number,
  color: null as string | null,
  background: null as string | null,
  inTable: false,
};

/** The formatting bar of the letter editor, in the manner of a word processor's. */
export default function LetterToolbar({ editor, onError }: { editor: Editor | null; onError: (message: string) => void }) {
  const fileInput = useRef<HTMLInputElement>(null);
  const read = useEditorState({
    editor,
    selector: ({ editor: current }) => {
      if (!current) return null;
      const paragraph = current.state.selection.$from.parent;
      const style = current.getAttributes('textStyle');
      return {
        canUndo: current.can().undo(),
        canRedo: current.can().redo(),
        bold: current.isActive('bold'),
        italic: current.isActive('italic'),
        underline: current.isActive('underline'),
        bulletList: current.isActive('bulletList'),
        orderedList: current.isActive('orderedList'),
        firstLine: paragraph.type.name === 'paragraph' && paragraph.attrs.firstLine !== false,
        align: (paragraph.attrs.textAlign as string | null | undefined) || 'justify',
        fontFamily: (style.fontFamily as string | null) || DEFAULT_FONT,
        fontSize: (style.fontSize as number | null) || LETTER_BASE_PT,
        color: (style.color as string | null) || null,
        background: (style.backgroundColor as string | null) || null,
        inTable: current.isActive('table'),
      };
    },
  });

  // Until the editor reports its first selection, the controls show their resting state.
  const state = read ?? RESTING_STATE;
  const disabled = !editor;
  const run = (command: (chain: Chain) => Chain) => () => {
    if (editor) command(editor.chain().focus()).run();
  };
  /** Like `run`, but also on every extra passage chosen with Ctrl/Cmd held. Only for changes that do not shift positions. */
  const runAll = (command: (chain: Chain) => Chain) => () => {
    if (!editor) return;
    const extra = extraSelections(editor);
    if (!extra.length) return run(command)();
    const { from, to } = editor.state.selection;
    const chain = editor.chain().focus();
    [...extra, ...(to > from ? [{ from, to }] : [])].forEach((range) => command(chain.setTextSelection(range)));
    chain.setTextSelection({ from, to }).run();
  };
  /** Bold, italic, underline: on if the first passage lacks the mark, off if it has it, the same for every passage. */
  const toggleAll = (mark: 'bold' | 'italic' | 'underline') => () => {
    if (!editor) return;
    const extra = extraSelections(editor);
    if (!extra.length) return run((c) => (mark === 'bold' ? c.toggleBold() : mark === 'italic' ? c.toggleItalic() : c.toggleUnderline()))();
    const first = extra[0];
    const on = !editor.state.doc.rangeHasMark(first.from, first.to, editor.schema.marks[mark]);
    const set = (c: Chain) => (mark === 'bold' ? (on ? c.setBold() : c.unsetBold()) : mark === 'italic' ? (on ? c.setItalic() : c.unsetItalic()) : on ? c.setUnderline() : c.unsetUnderline());
    runAll(set)();
  };
  const setStyle = (attrs: Record<string, unknown>) => runAll((c) => c.setMark('textStyle', attrs).removeEmptyTextStyle())();
  const sizes: number[] = !(LETTER_FONT_SIZES as readonly number[]).includes(state.fontSize) ? [...LETTER_FONT_SIZES, state.fontSize].sort((a, b) => a - b) : [...LETTER_FONT_SIZES];
  const stepSize = (direction: 1 | -1) => {
    const index = sizes.indexOf(state.fontSize);
    const next = sizes[Math.max(0, Math.min(sizes.length - 1, index + direction))];
    setStyle({ fontSize: next });
  };

  const insertImage = async (file: File | undefined) => {
    if (!file || !editor) return;
    try {
      const src = await imageToDataUrl(file);
      if (imageChars(editor) + src.length > LETTER_MAX_IMAGES_CHARS) throw new Error('Total ukuran gambar dalam surat sudah mencapai batas. Hapus atau perkecil gambar lain.');
      editor.chain().focus().setImage({ src, alt: file.name.replace(/\.[^.]+$/, '').slice(0, 200), width: 50 } as never).run();
    } catch (error) {
      onError(error instanceof Error ? error.message : 'Gambar tidak dapat ditambahkan.');
    }
  };

  const selectClass = 'h-8 shrink-0 rounded-sm border border-slate-200 bg-white px-1.5 text-xs text-slate-700 outline-none hover:border-indigo-300 focus-visible:border-indigo-400 disabled:opacity-40';

  return (
    <div role="toolbar" aria-label="Format surat" className="max-w-full rounded-md border border-slate-200 bg-white px-1.5 py-1 shadow-sm">
      <div className="flex flex-wrap items-center gap-0.5">
        <ToolButton label="Urungkan (Ctrl+Z)" icon={Undo2} disabled={disabled || !state.canUndo} onClick={run((c) => c.undo())} />
        <ToolButton label="Ulangi (Ctrl+Y)" icon={Redo2} disabled={disabled || !state.canRedo} onClick={run((c) => c.redo())} />
        <Divider />
        <select aria-label="Jenis huruf" disabled={disabled} value={state.fontFamily ?? DEFAULT_FONT} onChange={(event) => setStyle({ fontFamily: event.target.value })} className={`${selectClass} w-36`}>
          {LETTER_FONT_FAMILIES.map((family) => (
            <option key={family} value={family} style={{ fontFamily: family }}>
              {family}
            </option>
          ))}
        </select>
        <ToolButton label="Perkecil huruf" icon={Minus} disabled={disabled} onClick={() => stepSize(-1)} />
        <select aria-label="Ukuran huruf" disabled={disabled} value={state.fontSize ?? LETTER_BASE_PT} onChange={(event) => setStyle({ fontSize: Number(event.target.value) })} className={`${selectClass} w-14 text-center`}>
          {sizes.map((size) => (
            <option key={size} value={size}>
              {size}
            </option>
          ))}
        </select>
        <ToolButton label="Perbesar huruf" icon={Plus} disabled={disabled} onClick={() => stepSize(1)} />
        <Divider />
        <ToolButton label="Tebal (Ctrl+B)" icon={Bold} active={state.bold} disabled={disabled} onClick={toggleAll('bold')} />
        <ToolButton label="Miring (Ctrl+I)" icon={Italic} active={state.italic} disabled={disabled} onClick={toggleAll('italic')} />
        <ToolButton label="Garis bawah (Ctrl+U)" icon={Underline} active={state.underline} disabled={disabled} onClick={toggleAll('underline')} />
        <ColorTool label="Warna teks" icon={Baseline} value={state.color ?? null} fallback="#111111" disabled={disabled} onChange={(color) => setStyle({ color })} onClear={() => setStyle({ color: null })} />
        <ColorTool label="Warna sorot" icon={Highlighter} value={state.background ?? null} fallback="#fde047" disabled={disabled} onChange={(backgroundColor) => setStyle({ backgroundColor })} onClear={() => setStyle({ backgroundColor: null })} />
        <Divider />
        <ToolButton label="Rata kiri" icon={AlignLeft} active={state.align === 'left'} disabled={disabled} onClick={runAll((c) => c.setTextAlign('left'))} />
        <ToolButton label="Rata tengah" icon={AlignCenter} active={state.align === 'center'} disabled={disabled} onClick={runAll((c) => c.setTextAlign('center'))} />
        <ToolButton label="Rata kanan" icon={AlignRight} active={state.align === 'right'} disabled={disabled} onClick={runAll((c) => c.setTextAlign('right'))} />
        <ToolButton label="Rata kiri dan kanan" icon={AlignJustify} active={state.align === 'justify'} disabled={disabled} onClick={runAll((c) => c.setTextAlign('justify'))} />
        <Divider />
        <ToolButton label="Daftar berpoin" icon={List} active={state.bulletList} disabled={disabled} onClick={run((c) => c.toggleBulletList())} />
        <ToolButton label="Daftar bernomor" icon={ListOrdered} active={state.orderedList} disabled={disabled} onClick={run((c) => c.toggleOrderedList())} />
        <ToolButton label="Kurangi menjorok (Shift+Tab)" icon={IndentDecrease} disabled={disabled} onClick={run((c) => c.changeIndent(-1))} />
        <ToolButton label="Tambah menjorok (Tab di awal baris)" icon={IndentIncrease} disabled={disabled} onClick={run((c) => c.changeIndent(1))} />
        <ToolButton label="Baris pertama menjorok" icon={PilcrowRight} active={state.firstLine} disabled={disabled} onClick={run((c) => c.toggleFirstLine())} />
        <Divider />
        <ToolButton label="Sisipkan tabel" icon={TableIcon} active={state.inTable} disabled={disabled} onClick={run((c) => c.insertTable({ rows: 3, cols: 3, withHeaderRow: true }))} />
        <ToolButton label="Sisipkan gambar" icon={ImagePlus} disabled={disabled} onClick={() => fileInput.current?.click()} />
        <input
          ref={fileInput}
          type="file"
          accept={LETTER_IMAGE_ACCEPT}
          className="hidden"
          onChange={(event) => {
            void insertImage(event.target.files?.[0]);
            event.target.value = '';
          }}
        />
      </div>

      {state.inTable && (
        <div className="mt-1 flex flex-wrap items-center gap-0.5 border-t border-slate-100 pt-1">
          <span className="px-1.5 text-[11px] font-semibold text-slate-400">Tabel</span>
          <TextButton label="+ Baris di atas" onClick={run((c) => c.addRowBefore())} />
          <TextButton label="+ Baris di bawah" onClick={run((c) => c.addRowAfter())} />
          <TextButton label="+ Kolom kiri" onClick={run((c) => c.addColumnBefore())} />
          <TextButton label="+ Kolom kanan" onClick={run((c) => c.addColumnAfter())} />
          <TextButton label="Hapus baris" onClick={run((c) => c.deleteRow())} />
          <TextButton label="Hapus kolom" onClick={run((c) => c.deleteColumn())} />
          <TextButton label="Baris judul" onClick={run((c) => c.toggleHeaderRow())} />
          <TextButton label="Gabung sel" onClick={run((c) => c.mergeCells())} />
          <TextButton label="Pisah sel" onClick={run((c) => c.splitCell())} />
          <TextButton label="Hapus tabel" danger onClick={run((c) => c.deleteTable())} />
        </div>
      )}

    </div>
  );
}
