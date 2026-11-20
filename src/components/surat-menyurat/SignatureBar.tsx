"use client";

import React, { useLayoutEffect, useState } from 'react';
import type { Editor } from '@tiptap/core';
import { useEditorState } from '@tiptap/react';
import { AlignHorizontalJustifyCenter, AlignHorizontalJustifyEnd, AlignHorizontalJustifyStart, StretchHorizontal, type LucideIcon } from 'lucide-react';
import type { SignaturePlace } from './letterDocExtensions';

const PLACES: { place: SignaturePlace; label: string; icon: LucideIcon }[] = [
  { place: 'left', label: 'Tanda tangan di kiri', icon: AlignHorizontalJustifyStart },
  { place: 'center', label: 'Tanda tangan di tengah', icon: AlignHorizontalJustifyCenter },
  { place: 'right', label: 'Tanda tangan di kanan', icon: AlignHorizontalJustifyEnd },
  { place: 'full', label: 'Tanda tangan selebar halaman', icon: StretchHorizontal },
];

/** A small bar above the signature while the cursor is in it, to put the block at the left, middle or right of the page. Screen only. */
export default function SignatureBar({ editor, sheetRef }: { editor: Editor; sheetRef: React.RefObject<HTMLDivElement | null> }) {
  const info = useEditorState({
    editor,
    selector: ({ editor: current }) => {
      const { $from } = current.state.selection;
      for (let depth = $from.depth; depth > 0; depth -= 1) {
        if ($from.node(depth).type.name === 'signatureBlock') return { pos: $from.before(depth), place: ($from.node(depth).attrs.place as SignaturePlace) || 'right', size: current.state.doc.content.size };
      }
      return null;
    },
  });
  const [spot, setSpot] = useState<{ left: number; top: number } | null>(null);

  useLayoutEffect(() => {
    const sheet = sheetRef.current;
    const block = info ? (editor.view.nodeDOM(info.pos) as HTMLElement | null) : null;
    if (!sheet || !block) {
      setSpot(null);
      return;
    }
    const a = block.getBoundingClientRect();
    const b = sheet.getBoundingClientRect();
    setSpot({ left: Math.max(0, Math.min(a.left - b.left, b.width - 190)), top: Math.max(0, a.top - b.top - 42) });
  }, [editor, sheetRef, info]);

  if (!info || !spot || !editor.isEditable) return null;
  return (
    <div
      role="toolbar"
      aria-label="Letak tanda tangan"
      onMouseDown={(event) => event.preventDefault()}
      className="absolute z-30 flex items-center gap-0.5 rounded-full border border-slate-200 bg-white px-1.5 py-1 shadow-lg"
      style={{ left: spot.left, top: spot.top }}
    >
      {PLACES.map(({ place, label, icon: Icon }) => (
        <button
          key={place}
          type="button"
          title={label}
          aria-label={label}
          aria-pressed={info.place === place}
          onClick={() => editor.chain().focus().setSignaturePlace(place).run()}
          className={`inline-flex size-7 cursor-pointer items-center justify-center rounded-full ${info.place === place ? 'bg-indigo-100 text-indigo-700' : 'text-slate-600 hover:bg-slate-100'}`}
        >
          <Icon className="size-4" />
        </button>
      ))}
    </div>
  );
}
