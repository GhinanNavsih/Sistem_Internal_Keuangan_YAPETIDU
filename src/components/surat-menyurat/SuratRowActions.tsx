"use client";

import React from 'react';
import { Eye, Pencil, Trash2 } from 'lucide-react';

interface Props {
  onDetail: () => void;
  onEdit: () => void;
  onDelete: () => void;
}

const base =
  'inline-flex size-8 shrink-0 items-center justify-center rounded-sm border shadow-xs transition-colors cursor-pointer focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-indigo-500/25';

/** Icon-only row actions for the surat tables; the label shows as a tooltip. */
export default function SuratRowActions({ onDetail, onEdit, onDelete }: Props) {
  return (
    <>
      <button
        type="button"
        onClick={onDetail}
        title="Lihat surat"
        aria-label="Lihat surat"
        className={`${base} border-slate-200 bg-white text-slate-600 hover:bg-slate-50`}
      >
        <Eye className="size-4" />
      </button>
      <button
        type="button"
        onClick={onEdit}
        title="Edit data"
        aria-label="Edit data"
        className={`${base} border-amber-200 bg-amber-50 text-amber-600 hover:bg-amber-100`}
      >
        <Pencil className="size-4" />
      </button>
      <button
        type="button"
        onClick={onDelete}
        title="Hapus"
        aria-label="Hapus"
        className={`${base} border-rose-200 bg-rose-50 text-rose-600 hover:bg-rose-100`}
      >
        <Trash2 className="size-4" />
      </button>
    </>
  );
}
