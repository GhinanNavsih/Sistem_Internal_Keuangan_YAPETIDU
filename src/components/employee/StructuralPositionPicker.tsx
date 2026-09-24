"use client";

import { useEffect, useRef, useState } from 'react';
import { Search } from 'lucide-react';
import { Input } from '@/components/ui/input';
import {
  filterPositionOptions,
  type PositionOption,
  type TakenPosition,
} from '@/lib/structuralPositionPicker';

interface StructuralPositionPickerProps {
  options: readonly PositionOption[];
  taken: readonly TakenPosition[];
  onPick: (id: string) => void;
}

/**
 * Search-and-select over the existing structural positions, for a role that may
 * add a position to an employee but neither create one nor see what it pays.
 * Picking a result adds it straight away; there is no free text and no amount.
 */
export default function StructuralPositionPicker({ options, taken, onPick }: StructuralPositionPickerProps) {
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function closeOnOutsideClick(event: MouseEvent) {
      if (rootRef.current && !rootRef.current.contains(event.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', closeOnOutsideClick);
    return () => document.removeEventListener('mousedown', closeOnOutsideClick);
  }, []);

  const matches = filterPositionOptions(options, taken, query);

  return (
    <div className="bg-slate-50/50 p-4 rounded-[20px] border border-slate-100 space-y-1.5">
      <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">
        Tambah Jabatan
      </label>
      <div className="relative" ref={rootRef}>
        <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
        <Input
          placeholder="Cari jabatan atau satker, lalu pilih…"
          value={query}
          onChange={(event) => {
            setQuery(event.target.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          onKeyDown={(event) => {
            if (event.key === 'Escape') setOpen(false);
          }}
          className="rounded-xl border-slate-200 text-sm h-8 bg-white pl-9"
        />
        {open && (
          <div className="absolute left-0 right-0 top-full mt-1 bg-white border border-slate-200 rounded-xl shadow-lg max-h-60 overflow-y-auto z-[9999]">
            {matches.length === 0 ? (
              <p className="px-3 py-3 text-xs text-slate-400">
                {options.length === 0 || !query.trim()
                  ? 'Tidak ada jabatan lain yang bisa ditambahkan.'
                  : 'Jabatan tidak ditemukan. Jabatan baru hanya bisa dibuat oleh Super Admin.'}
              </p>
            ) : (
              matches.map((option) => (
                <button
                  key={option.id}
                  type="button"
                  onClick={() => {
                    onPick(option.id);
                    setQuery('');
                    setOpen(false);
                  }}
                  className="w-full text-left px-3 py-2.5 text-xs hover:bg-indigo-50/50 hover:text-indigo-600 border-b border-slate-50 last:border-0 flex justify-between items-center transition-colors cursor-pointer"
                >
                  <span className="font-semibold text-slate-700">{option.name}</span>
                  <span className="text-[10px] text-slate-400 bg-slate-100 px-1.5 py-0.5 rounded border border-slate-200 ml-2 shrink-0">
                    {option.satker}
                  </span>
                </button>
              ))
            )}
          </div>
        )}
      </div>
    </div>
  );
}
