"use client";

import React from 'react';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { SATKER_INITIALS_MAX, SATKER_INITIALS_MIN } from '@/lib/surat-menyurat/satkerInitials';

interface Props {
  id: string;
  value: string;
  onChange: (value: string) => void;
  /** Who already uses these initials, when another SatKer does. */
  takenBy?: string;
}

/** The initials a Kepala SatKer Loyalis uses as the SatKer code in Surat Keluar numbers. */
export default function SatkerInitialsField({ id, value, onChange, takenBy }: Props) {
  return (
    <div>
      <Label htmlFor={id} className="text-xs font-semibold text-slate-600 block mb-1.5">Inisial SatKer</Label>
      <Input
        id={id}
        value={value}
        onChange={(e) => onChange(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, SATKER_INITIALS_MAX))}
        placeholder="Contoh: BPM"
        maxLength={SATKER_INITIALS_MAX}
        required
        aria-invalid={Boolean(takenBy)}
        className={`rounded-sm h-[42px] bg-white text-sm font-bold font-mono tracking-wider focus:ring-indigo-500/20 ${
          takenBy ? 'border-rose-300 focus:border-rose-500' : 'border-slate-200 focus:border-indigo-500'
        }`}
      />
      {takenBy ? (
        <p className="mt-1 text-[11px] font-semibold text-rose-600 leading-relaxed">
          Inisial ini sudah dipakai oleh {takenBy}. Pilih inisial yang unik.
        </p>
      ) : (
        <p className="mt-1 text-[11px] text-slate-500 leading-relaxed">
          Menjadi kode SatKer pada nomor Surat Keluar, contoh 001/<strong>BPM</strong>/UNIPDU/XI/2026.
          Harus unik; {SATKER_INITIALS_MIN}–{SATKER_INITIALS_MAX} huruf atau angka.
        </p>
      )}
    </div>
  );
}
