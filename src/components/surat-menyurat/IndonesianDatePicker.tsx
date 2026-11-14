"use client";

import React, { useState } from 'react';
import { Popover } from '@base-ui/react/popover';
import { addMonths, addYears, format, getDay, getDaysInMonth, isValid, parseISO, startOfMonth } from 'date-fns';
import { id as indonesian } from 'date-fns/locale';
import { CalendarDays, ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight } from 'lucide-react';
import { formatLetterDate } from '@/lib/surat-menyurat/date';

interface Props {
  value: string;
  onValueChange: (value: string) => void;
  label: string;
  id?: string;
  required?: boolean;
  initiallyOpen?: boolean;
  onClose?: () => void;
}

function selectedMonth(value: string): Date {
  const date = parseISO(value);
  return startOfMonth(isValid(date) ? date : new Date());
}

export default function IndonesianDatePicker({ value, onValueChange, label, id, required, initiallyOpen = false, onClose }: Props) {
  const [open, setOpen] = useState(initiallyOpen);
  const [month, setMonth] = useState(() => selectedMonth(value));
  const offset = (getDay(month) + 6) % 7;
  const days = getDaysInMonth(month);
  const monthName = format(month, 'MMMM yyyy', { locale: indonesian });

  return (
    <Popover.Root open={open} onOpenChange={(next) => {
      if (next) setMonth(selectedMonth(value));
      setOpen(next);
      if (!next) onClose?.();
    }}>
      <Popover.Trigger id={id} aria-label={label} aria-required={required || undefined} className="flex h-9 w-full items-center justify-between gap-2 rounded-sm border border-slate-200 bg-white px-3 text-left text-xs text-slate-800 shadow-xs hover:border-indigo-300 focus-visible:outline-2 focus-visible:outline-indigo-500">
        <span>{formatLetterDate(value) || 'Pilih tanggal'}</span>
        <CalendarDays className="size-4 shrink-0 text-slate-400" />
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Positioner sideOffset={6} align="start" className="isolate z-[70]">
          <Popover.Popup aria-label={`Kalender ${label}`} lang="id" className="w-72 rounded-md border border-slate-200 bg-white p-3 text-slate-800 shadow-xl outline-none">
            <div className="flex items-center justify-between gap-1">
              <button type="button" aria-label="Tahun sebelumnya" onClick={() => setMonth(addYears(month, -1))} className="rounded p-1.5 hover:bg-indigo-50 focus-visible:outline-2 focus-visible:outline-indigo-500"><ChevronsLeft className="size-4" /></button>
              <button type="button" aria-label="Bulan sebelumnya" onClick={() => setMonth(addMonths(month, -1))} className="rounded p-1.5 hover:bg-indigo-50 focus-visible:outline-2 focus-visible:outline-indigo-500"><ChevronLeft className="size-4" /></button>
              <span aria-live="polite" className="flex-1 text-center text-sm font-semibold">{monthName}</span>
              <button type="button" aria-label="Bulan berikutnya" onClick={() => setMonth(addMonths(month, 1))} className="rounded p-1.5 hover:bg-indigo-50 focus-visible:outline-2 focus-visible:outline-indigo-500"><ChevronRight className="size-4" /></button>
              <button type="button" aria-label="Tahun berikutnya" onClick={() => setMonth(addYears(month, 1))} className="rounded p-1.5 hover:bg-indigo-50 focus-visible:outline-2 focus-visible:outline-indigo-500"><ChevronsRight className="size-4" /></button>
            </div>
            <div className="mt-3 grid grid-cols-7 gap-1 text-center text-xs">
              {['Sen', 'Sel', 'Rab', 'Kam', 'Jum', 'Sab', 'Min'].map((day) => <span key={day} className="py-1 font-semibold text-slate-500">{day}</span>)}
              {Array.from({ length: offset }, (_, index) => <span key={`empty-${index}`} />)}
              {Array.from({ length: days }, (_, index) => {
                const date = new Date(month.getFullYear(), month.getMonth(), index + 1);
                const iso = format(date, 'yyyy-MM-dd');
                return <button key={iso} type="button" aria-label={format(date, 'EEEE, d MMMM yyyy', { locale: indonesian })} aria-pressed={iso === value} onClick={() => { onValueChange(iso); setOpen(false); onClose?.(); }} className={`h-8 rounded-sm focus-visible:outline-2 focus-visible:outline-indigo-500 ${iso === value ? 'bg-indigo-600 font-semibold text-white' : 'hover:bg-indigo-50'}`}>{index + 1}</button>;
              })}
            </div>
          </Popover.Popup>
        </Popover.Positioner>
      </Popover.Portal>
    </Popover.Root>
  );
}
