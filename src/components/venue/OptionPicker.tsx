"use client";

import { CheckCircle2, ImageOff } from 'lucide-react';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { cn } from '@/lib/utils';

export interface PickerOption {
  value: string;
  label: string;
  /** Under the label on cards; after a "·" in the dropdown fallback. */
  description?: string;
  /** Cover photo (an embedded image or https link); none shows a placeholder. */
  image?: string | null;
  disabled?: boolean;
}

interface OptionPickerProps {
  /** Radio group name. */
  name: string;
  /** Id of the visible label, so screen readers announce the group by it. */
  labelledBy: string;
  options: PickerOption[];
  value: string;
  onChange: (value: string) => void;
  /** More options than this fall back to a dropdown. */
  maxInline?: number;
  placeholder?: string;
  invalid?: boolean;
  /** The photos are still on their way: the cards show a pulsing placeholder. */
  photosLoading?: boolean;
}

/**
 * Shows every option as a photo card at once so choosing is one tap, not open-a-dropdown-then-tap
 * (recognition over recall). Built on real radio inputs, so arrow keys, focus and
 * screen readers work without any extra code; only the look is custom.
 */
export default function OptionPicker({
  name,
  labelledBy,
  options,
  value,
  onChange,
  maxInline = 6,
  placeholder = 'Pilih',
  invalid = false,
  photosLoading = false,
}: OptionPickerProps) {
  if (options.length > maxInline) {
    const selected = options.find((option) => option.value === value);
    return (
      <Select value={value} onValueChange={(next) => onChange(next ?? '')}>
        <SelectTrigger
          aria-labelledby={labelledBy}
          aria-invalid={invalid || undefined}
          className="h-12 w-full rounded-xl border-slate-200 bg-white text-base font-semibold"
        >
          <SelectValue placeholder={placeholder}>{selected?.label || placeholder}</SelectValue>
        </SelectTrigger>
        <SelectContent className="bg-white rounded-xl border border-slate-100 shadow-xl">
          {options.map((option) => (
            <SelectItem key={option.value} value={option.value} disabled={option.disabled}>
              {option.label}
              {option.description ? ` · ${option.description}` : ''}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    );
  }

  return (
    <div
      role="radiogroup"
      aria-labelledby={labelledBy}
      aria-invalid={invalid || undefined}
      className="grid grid-cols-2 gap-3"
    >
      {options.map((option) => (
        <label
          key={option.value}
          className={cn(
            'group relative block cursor-pointer select-none overflow-hidden rounded-xl border bg-white transition-colors',
            'has-[:checked]:border-indigo-500 has-[:checked]:ring-2 has-[:checked]:ring-indigo-500',
            'has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-indigo-400',
            'has-[:disabled]:cursor-not-allowed has-[:disabled]:opacity-50',
            invalid ? 'border-rose-300' : 'border-slate-200 hover:border-slate-300',
          )}
        >
          <input
            type="radio"
            name={name}
            value={option.value}
            checked={option.value === value}
            disabled={option.disabled}
            onChange={() => onChange(option.value)}
            className="sr-only"
          />
          <span className="relative block aspect-video w-full overflow-hidden bg-slate-100">
            {option.image ? (
              // Embedded photos cannot go through next/image.
              // eslint-disable-next-line @next/next/no-img-element
              <img src={option.image} alt="" decoding="async" draggable={false} className="h-full w-full object-cover" />
            ) : (
              <span
                className={cn(
                  'flex h-full w-full items-center justify-center text-slate-300',
                  photosLoading && 'animate-pulse bg-slate-200',
                )}
              >
                {!photosLoading && <ImageOff className="h-7 w-7" aria-hidden="true" />}
              </span>
            )}
            <CheckCircle2
              aria-hidden="true"
              className="absolute right-2 top-2 h-6 w-6 rounded-full bg-white text-indigo-600 opacity-0 shadow transition-opacity group-has-[:checked]:opacity-100"
            />
          </span>
          <span className="block px-3.5 py-3">
            <span className="block text-sm font-semibold text-slate-800">{option.label}</span>
            {option.description && (
              <span className="mt-0.5 block text-xs leading-relaxed text-slate-500">{option.description}</span>
            )}
          </span>
        </label>
      ))}
    </div>
  );
}
