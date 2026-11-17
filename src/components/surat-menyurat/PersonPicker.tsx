"use client";

import React, { useEffect, useRef, useState } from 'react';
import { Search } from 'lucide-react';
import type { AssignedPerson } from '@/lib/surat-menyurat/templates';

/** The employees a letter can name, as loaded by the composer. */
export interface PeopleDirectory {
  people: AssignedPerson[];
  loading: boolean;
  error: string;
  retry: () => void;
}

const GROUPS = [
  { collection: 'Employees_Loyalis', label: 'Loyalis' },
  { collection: 'Employees_BlueCollar', label: 'Pekarya' },
] as const;

const sameEmployee = (a: AssignedPerson, b: AssignedPerson) => a.id === b.id && a.collection === b.collection;

/**
 * A button that opens a small search list of employees. It sits on the paper, so it sets its own
 * text style rather than taking the letter's, and is only ever drawn on screen.
 */
export default function PersonPicker({
  directory,
  exclude = [],
  onSelect,
  label,
  buttonClassName,
  panelClassName = 'left-0',
}: {
  directory: PeopleDirectory;
  /** People already chosen, left out of the list. */
  exclude?: AssignedPerson[];
  onSelect: (person: AssignedPerson) => void;
  label: string;
  buttonClassName: string;
  panelClassName?: string;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const close = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [open]);

  const needle = query.trim().toLocaleLowerCase('id');
  const groups = GROUPS.map((group) => ({
    ...group,
    matches: directory.people.filter(
      (person) =>
        person.collection === group.collection &&
        `${person.name} ${person.role}`.toLocaleLowerCase('id').includes(needle) &&
        !exclude.some((chosen) => sameEmployee(chosen, person)),
    ),
  })).filter((group) => group.matches.length > 0);

  const choose = (person: AssignedPerson) => {
    onSelect(person);
    setQuery('');
    setOpen(false);
  };

  return (
    <div ref={rootRef} className="relative inline-block text-left">
      <button type="button" onClick={() => setOpen((current) => !current)} aria-expanded={open} className={buttonClassName}>
        {label}
      </button>
      {open && (
        <div
          className={`absolute top-full z-50 mt-1 w-72 indent-0 whitespace-normal rounded-md border border-slate-200 bg-white font-sans text-xs font-normal normal-case not-italic leading-normal tracking-normal text-slate-700 shadow-xl ${panelClassName}`}
        >
          <div className="flex items-center gap-2 border-b border-slate-100 px-3 py-2">
            <Search className="size-3.5 shrink-0 text-slate-400" />
            <input
              autoFocus
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Escape') setOpen(false);
              }}
              placeholder="Cari nama atau jabatan..."
              aria-label="Cari pegawai"
              autoComplete="off"
              className="min-w-0 flex-1 bg-transparent text-xs text-slate-800 outline-none placeholder:text-slate-400"
            />
          </div>
          <div className="max-h-56 overflow-y-auto">
            {directory.loading ? (
              <div className="p-3 text-slate-500">Memuat pegawai...</div>
            ) : directory.error ? (
              <div className="p-3 text-rose-600">
                {directory.error}{' '}
                <button type="button" className="underline" onClick={directory.retry}>
                  Coba lagi
                </button>
              </div>
            ) : groups.length === 0 ? (
              <div className="p-3 text-slate-500">Pegawai tidak ditemukan atau sudah dipilih.</div>
            ) : (
              groups.map((group) => (
                <div key={group.collection}>
                  <div className="sticky top-0 bg-slate-50 px-3 py-1 text-[9px] font-bold uppercase text-slate-500">{group.label}</div>
                  {group.matches.map((person) => (
                    <button
                      key={person.id}
                      type="button"
                      onClick={() => choose(person)}
                      className="flex w-full justify-between gap-3 px-3 py-2 text-left hover:bg-slate-50"
                    >
                      <span>{person.name}</span>
                      <span className="text-[10px] text-slate-400">{person.role}</span>
                    </button>
                  ))}
                </div>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}
