"use client";

import { useState, type ReactNode } from 'react';
import { CalendarRange, Plus, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { leaveRangeErrorMessage, type LeaveRangeError } from '@/lib/leaveDateRange';

/**
 * Keeps an optional multi-day control behind a link until the employee asks
 * for it, so a one-day request is not cluttered. `onClose` runs when they go
 * back to a single day and should clear the end date.
 */
export function LeaveRangeDisclosure({
  noun,
  initiallyOpen = false,
  disabled,
  onClose,
  children,
}: {
  noun: string;
  initiallyOpen?: boolean;
  disabled?: boolean;
  onClose: () => void;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(initiallyOpen);

  if (!open) {
    return (
      <Button
        type="button"
        variant="outline"
        disabled={disabled}
        aria-expanded={false}
        onClick={() => setOpen(true)}
        className="h-auto min-h-12 w-full justify-between gap-3 whitespace-normal rounded-xl border-dashed py-2.5 text-left border-indigo-300 bg-indigo-50/60 px-4 text-sm font-bold text-indigo-800 hover:bg-indigo-50 hover:text-indigo-900"
      >
        <span className="flex min-w-0 items-center gap-2">
          <CalendarRange className="h-4 w-4 shrink-0" aria-hidden="true" />
          Ajukan {noun} lebih dari satu hari
        </span>
        <Plus className="h-4 w-4" aria-hidden="true" />
      </Button>
    );
  }

  return (
    <div className="space-y-2">
      {children}
      <button
        type="button"
        disabled={disabled}
        aria-expanded
        onClick={() => {
          onClose();
          setOpen(false);
        }}
        className="flex min-h-11 items-center gap-1 rounded-lg px-1 text-sm font-semibold text-slate-600 hover:text-slate-900 disabled:opacity-50"
      >
        <X className="h-4 w-4" aria-hidden="true" />
        Hanya satu hari
      </button>
    </div>
  );
}

/**
 * Optional "Sampai tanggal" beside the first date of a leave form. Filled,
 * every date up to it gets its own request.
 */
export function LeaveDateRangeEndField({
  id,
  value,
  onChange,
  min,
  max,
  dayCount,
  error,
  disabled,
  noun,
}: {
  id: string;
  value: string;
  onChange: (value: string) => void;
  min?: string;
  max?: string;
  /** Dates the range would send; only shown once an end date is chosen. */
  dayCount: number;
  error: LeaveRangeError | null;
  disabled?: boolean;
  noun: string;
}) {
  return (
    <LeaveRangeDisclosure
      noun={noun}
      initiallyOpen={Boolean(value)}
      disabled={disabled}
      onClose={() => onChange('')}
    >
      <div className="space-y-2">
        <Label htmlFor={id}>Sampai tanggal</Label>
        <Input
          id={id}
          type="date"
          min={min}
          max={max}
          value={value}
          disabled={disabled}
          onChange={(event) => onChange(event.target.value)}
          className="min-h-14 rounded-xl text-base font-mono"
        />
        {error && value ? (
          <p className="text-sm font-semibold text-rose-700">{leaveRangeErrorMessage(error)}</p>
        ) : value && dayCount > 1 ? (
          <p className="text-sm font-semibold text-slate-700">
            {dayCount} hari {noun} akan diajukan sekaligus, satu pengajuan untuk setiap tanggal.
          </p>
        ) : (
          <p className="text-xs text-slate-500">Pilih tanggal terakhir {noun}.</p>
        )}
      </div>
    </LeaveRangeDisclosure>
  );
}
