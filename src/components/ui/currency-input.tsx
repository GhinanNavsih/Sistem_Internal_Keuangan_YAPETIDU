"use client";

import { useEffect, useRef, useState } from 'react';
import { Input } from '@/components/ui/input';

/**
 * A rupiah input: fixed "Rp" prefix and dots between thousands while typing
 * (166039 shows as 166.039). Only digits are kept, so the caret is put back
 * after the same digit it was on when the dots were re-inserted. Empty is 0.
 */
export function CurrencyInput({ value, onValue, ...props }: Omit<React.ComponentProps<typeof Input>, 'value' | 'onChange'> & { value: number; onValue: (value: number) => void }) {
  const [digits, setDigits] = useState(() => (value > 0 ? String(Math.round(value)) : ''));
  const inputRef = useRef<HTMLInputElement>(null);
  const caretDigitsRef = useRef<number | null>(null);
  const display = digits ? Number(digits).toLocaleString('id-ID') : '';

  useEffect(() => {
    const input = inputRef.current;
    const target = caretDigitsRef.current;
    if (!input || target === null) return;
    caretDigitsRef.current = null;
    let seen = 0;
    let position = 0;
    while (position < input.value.length && seen < target) {
      if (/\d/.test(input.value[position])) seen += 1;
      position += 1;
    }
    input.setSelectionRange(position, position);
  }, [display]);

  return (
    <div className="relative">
      <span className="pointer-events-none absolute inset-y-0 left-3 flex items-center text-sm font-semibold text-slate-400">
        Rp
      </span>
      <Input
        {...props}
        ref={inputRef}
        type="text"
        inputMode="numeric"
        placeholder="0"
        value={display}
        onChange={(event) => {
          const raw = event.target.value;
          const caret = event.target.selectionStart ?? raw.length;
          caretDigitsRef.current = raw.slice(0, caret).replace(/\D/g, '').length;
          // No leading zeros, and a cap well above any real allowance.
          const next = raw.replace(/\D/g, '').replace(/^0+/, '').slice(0, 10);
          setDigits(next);
          onValue(next === '' ? 0 : Number(next));
        }}
        className="rounded-xl pl-10"
      />
    </div>
  );
}

