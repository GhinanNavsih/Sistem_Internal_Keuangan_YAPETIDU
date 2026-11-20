"use client";

import React, { useEffect, useState } from 'react';
import type { Editor } from '@tiptap/core';
import { CellSelection } from '@tiptap/pm/tables';

type Chain = ReturnType<Editor['chain']>;
interface Item {
  label: string;
  run: (chain: Chain) => Chain;
  can?: (editor: Editor) => boolean;
  danger?: boolean;
  separatorBefore?: boolean;
}

const ITEMS: Item[] = [
  { label: 'Sisipkan baris di atas', run: (c) => c.addRowBefore() },
  { label: 'Sisipkan baris di bawah', run: (c) => c.addRowAfter() },
  { label: 'Sisipkan kolom di kiri', run: (c) => c.addColumnBefore() },
  { label: 'Sisipkan kolom di kanan', run: (c) => c.addColumnAfter() },
  { label: 'Hapus baris', run: (c) => c.deleteRow(), separatorBefore: true },
  { label: 'Hapus kolom', run: (c) => c.deleteColumn() },
  { label: 'Gabungkan sel', run: (c) => c.mergeCells(), can: (e) => e.can().mergeCells(), separatorBefore: true },
  { label: 'Pisahkan sel', run: (c) => c.splitCell(), can: (e) => e.can().splitCell() },
  { label: 'Jadikan baris judul', run: (c) => c.toggleHeaderRow() },
  { label: 'Hapus tabel', run: (c) => c.deleteTable(), danger: true, separatorBefore: true },
];

/**
 * Right-click menu for a table, as in Google Docs. Wrap the editor with it; it opens only on table cells and
 * leaves the browser's own menu alone elsewhere.
 */
export default function TableContextMenu({ editor, children }: { editor: Editor | null | undefined; children: React.ReactNode }) {
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);

  useEffect(() => {
    if (!menu) return;
    const close = () => setMenu(null);
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') close();
    };
    window.addEventListener('mousedown', close);
    window.addEventListener('scroll', close, true);
    window.addEventListener('resize', close);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('mousedown', close);
      window.removeEventListener('scroll', close, true);
      window.removeEventListener('resize', close);
      window.removeEventListener('keydown', onKey);
    };
  }, [menu]);

  const open = (event: React.MouseEvent) => {
    if (!editor || !(event.target as HTMLElement).closest('td,th')) return;
    event.preventDefault();
    // Put the cursor in the cell that was clicked, unless it is already part of the chosen cells.
    const at = editor.view.posAtCoords({ left: event.clientX, top: event.clientY });
    const inside = editor.state.selection instanceof CellSelection && at && at.pos >= editor.state.selection.from && at.pos <= editor.state.selection.to;
    if (at && !inside) editor.commands.setTextSelection(at.pos);
    setMenu({ x: event.clientX, y: event.clientY });
  };

  return (
    <div onContextMenu={open}>
      {children}
      {menu && editor && (
        <div
          role="menu"
          aria-label="Menu tabel"
          // Keep clicks on the menu from closing it before they run.
          onMouseDown={(event) => event.stopPropagation()}
          className="fixed z-[80] w-56 rounded-md border border-slate-200 bg-white py-1 font-sans text-xs text-slate-700 shadow-xl"
          style={{ left: Math.min(menu.x, window.innerWidth - 232), top: Math.min(menu.y, window.innerHeight - 340) }}
        >
          {ITEMS.map((item) => {
            const enabled = item.can ? item.can(editor) : true;
            return (
              <React.Fragment key={item.label}>
                {item.separatorBefore && <div className="my-1 border-t border-slate-100" />}
                <button
                  type="button"
                  role="menuitem"
                  disabled={!enabled}
                  onClick={() => {
                    item.run(editor.chain().focus()).run();
                    setMenu(null);
                  }}
                  className={`block w-full px-3 py-1.5 text-left disabled:opacity-35 ${item.danger ? 'text-rose-600 hover:bg-rose-50' : 'hover:bg-slate-50'}`}
                >
                  {item.label}
                </button>
              </React.Fragment>
            );
          })}
        </div>
      )}
    </div>
  );
}
