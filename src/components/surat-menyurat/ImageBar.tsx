"use client";

import React, { useEffect, useLayoutEffect, useState } from 'react';
import type { Editor } from '@tiptap/core';
import { NodeSelection } from '@tiptap/pm/state';
import { useEditorState } from '@tiptap/react';
import { AlignCenter, AlignLeft, AlignRight, BringToFront, Check, ChevronDown, RotateCcw, SendToBack, Trash2, WrapText, type LucideIcon } from 'lucide-react';
import type { ImageMode } from './letterDocExtensions';

const MODES: { mode: ImageMode; label: string; hint: string; icon: LucideIcon }[] = [
  { mode: 'inline', label: 'Sebaris dengan teks', hint: 'In line', icon: AlignLeft },
  { mode: 'wrap', label: 'Kelilingi teks', hint: 'Wrap text', icon: WrapText },
  { mode: 'behind', label: 'Di belakang teks', hint: 'Behind text', icon: SendToBack },
  { mode: 'front', label: 'Di depan teks', hint: 'In front of text', icon: BringToFront },
];

function modeOf(attrs: Record<string, unknown>): ImageMode {
  if (attrs.float) return attrs.behind ? 'behind' : 'front';
  return attrs.wrap ? 'wrap' : 'inline';
}

/**
 * The small bar under a selected picture, as in Google Docs: how the picture sits with the text, its
 * alignment, resetting its size and turn, and removing it. Shown on screen only.
 */
export default function ImageBar({ editor, sheetRef }: { editor: Editor; sheetRef: React.RefObject<HTMLDivElement | null> }) {
  const info = useEditorState({
    editor,
    selector: ({ editor: current }) => {
      const selection = current.state.selection;
      return selection instanceof NodeSelection && selection.node.type.name === 'image' ? { pos: selection.from, attrs: { ...selection.node.attrs }, size: current.state.doc.content.size } : null;
    },
  });
  const [place, setPlace] = useState<{ left: number; top: number } | null>(null);
  // The menu belongs to the picture it was opened for, so choosing another picture closes it.
  const [menuFor, setMenuFor] = useState<number | null>(null);
  const menuOpen = menuFor !== null && menuFor === info?.pos;

  const measure = () => {
    const sheet = sheetRef.current;
    const frame = info ? (editor.view.nodeDOM(info.pos) as HTMLElement | null) : null;
    if (!sheet || !frame) return setPlace(null);
    const a = frame.getBoundingClientRect();
    const b = sheet.getBoundingClientRect();
    setPlace({ left: Math.max(0, Math.min(a.left - b.left, b.width - 300)), top: a.bottom - b.top + 14 });
  };
  // Follows the picture as it moves, is resized or turned.
  useLayoutEffect(() => {
    measure();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [info?.pos, info?.size, info?.attrs.width, info?.attrs.rotate, info?.attrs.x, info?.attrs.y, info?.attrs.float, info?.attrs.wrap, info?.attrs.align]);
  useEffect(() => {
    window.addEventListener('resize', measure);
    return () => window.removeEventListener('resize', measure);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [info?.pos]);

  if (!info || !place || !editor.isEditable) return null;
  const current = modeOf(info.attrs);
  const CurrentIcon = MODES.find((item) => item.mode === current)!.icon;
  const run = (command: (chain: ReturnType<Editor['chain']>) => ReturnType<Editor['chain']>) => () => command(editor.chain().focus()).run();
  const sideless = current === 'behind' || current === 'front';
  const align = (info.attrs.align as string) || 'center';
  const button = 'inline-flex size-7 items-center justify-center rounded-full text-slate-600 hover:bg-slate-100 disabled:opacity-35 cursor-pointer';

  return (
    <div
      role="toolbar"
      aria-label="Pengaturan gambar"
      onMouseDown={(event) => event.preventDefault()}
      className="absolute z-30 flex items-center gap-0.5 rounded-full border border-slate-200 bg-white px-1.5 py-1 font-sans text-xs text-slate-700 shadow-lg"
      style={{ left: place.left, top: place.top }}
    >
      <div className="relative">
        <button type="button" title="Tata letak gambar" aria-expanded={menuOpen} onClick={() => setMenuFor(menuOpen ? null : info.pos)} className="inline-flex h-7 cursor-pointer items-center gap-1 rounded-full px-2 hover:bg-slate-100">
          <CurrentIcon className="size-4" />
          <ChevronDown className="size-3 text-slate-500" />
        </button>
        {menuOpen && (
          <div role="menu" className="absolute left-0 top-full z-40 mt-2 w-60 overflow-hidden rounded-md border border-slate-200 bg-white py-1 shadow-xl">
            {MODES.map(({ mode, label, hint, icon: Icon }) => (
              <button
                key={mode}
                type="button"
                role="menuitemradio"
                aria-checked={mode === current}
                onClick={() => {
                  run((c) => c.setImageMode(mode))();
                  setMenuFor(null);
                }}
                className={`flex w-full cursor-pointer items-center gap-3 px-3 py-2 text-left hover:bg-slate-50 ${mode === current ? 'bg-slate-100' : ''}`}
              >
                <Icon className="size-4 shrink-0 text-slate-600" />
                <span className="flex-1">
                  {label}
                  <span className="ml-1 text-[10px] text-slate-400">{hint}</span>
                </span>
                {mode === current && <Check className="size-4 text-slate-700" />}
              </button>
            ))}
          </div>
        )}
      </div>
      <span aria-hidden className="mx-0.5 h-5 w-px bg-slate-200" />
      <button type="button" title="Rata kiri" aria-pressed={align === 'left'} disabled={sideless} onClick={run((c) => c.setImageLayout({ align: 'left' }))} className={`${button} ${align === 'left' && !sideless ? 'bg-indigo-100 text-indigo-700' : ''}`}>
        <AlignLeft className="size-4" />
      </button>
      <button type="button" title="Rata tengah" aria-pressed={align === 'center'} disabled={sideless || current === 'wrap'} onClick={run((c) => c.setImageLayout({ align: 'center' }))} className={`${button} ${align === 'center' && !sideless ? 'bg-indigo-100 text-indigo-700' : ''}`}>
        <AlignCenter className="size-4" />
      </button>
      <button type="button" title="Rata kanan" aria-pressed={align === 'right'} disabled={sideless} onClick={run((c) => c.setImageLayout({ align: 'right' }))} className={`${button} ${align === 'right' && !sideless ? 'bg-indigo-100 text-indigo-700' : ''}`}>
        <AlignRight className="size-4" />
      </button>
      <span aria-hidden className="mx-0.5 h-5 w-px bg-slate-200" />
      <button type="button" title="Kembalikan ukuran dan putaran" onClick={run((c) => c.setImageLayout({ width: null, rotate: 0 }))} className={button}>
        <RotateCcw className="size-4" />
      </button>
      <button type="button" title="Hapus gambar" onClick={run((c) => c.deleteSelection())} className={`${button} hover:bg-rose-50 hover:text-rose-600`}>
        <Trash2 className="size-4" />
      </button>
    </div>
  );
}
