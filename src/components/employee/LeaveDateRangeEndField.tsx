"use client";

import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { leaveRangeErrorMessage, type LeaveRangeError } from '@/lib/leaveDateRange';

/**
 * Optional "Sampai tanggal" beside the first date of a leave form. Left empty
 * the form stays a one-day request; filled, every date up to it gets its own.
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
    <div className="space-y-2">
      <Label htmlFor={id}>Sampai tanggal (opsional)</Label>
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
        <p className="text-xs text-slate-500">
          Isi jika {noun} lebih dari satu hari. Kosongkan jika hanya satu hari.
        </p>
      )}
    </div>
  );
}
