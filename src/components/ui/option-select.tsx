"use client"

import * as React from "react"

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { cn } from "@/lib/utils"

export interface OptionSelectOption {
  value: string
  label: string
  disabled?: boolean
}

interface OptionSelectProps {
  value: string
  onValueChange: (value: string) => void
  options: readonly OptionSelectOption[]
  /** Shown while `value` matches no option. */
  placeholder?: string
  id?: string
  "aria-label"?: string
  disabled?: boolean
  /** `md` fits a form field; `sm` fits a table cell. */
  size?: "sm" | "md"
  /** Extra classes for the trigger. */
  className?: string
}

/**
 * A dropdown in the app's indigo theme, used in place of a native `<select>`
 * so the open list looks the same in every browser. Long labels wrap rather
 * than truncate, since the option text often carries the detail.
 */
export function OptionSelect({
  value,
  onValueChange,
  options,
  placeholder = "Pilih",
  id,
  "aria-label": ariaLabel,
  disabled,
  size = "md",
  className,
}: OptionSelectProps) {
  const selected = options.find((option) => option.value === value)

  return (
    <Select
      value={selected ? selected.value : null}
      onValueChange={(next) => {
        if (typeof next === "string") onValueChange(next)
      }}
      disabled={disabled}
    >
      <SelectTrigger
        id={id}
        aria-label={ariaLabel}
        className={cn(
          "w-full border-slate-200 bg-white text-slate-900 shadow-xs hover:border-indigo-300 focus-visible:border-indigo-500 focus-visible:ring-indigo-500/25 data-[popup-open]:border-indigo-500 data-[popup-open]:ring-3 data-[popup-open]:ring-indigo-500/25 data-[size=default]:h-auto *:data-[slot=select-value]:line-clamp-2 [&_svg]:text-slate-400",
          size === "md"
            ? "rounded-xl px-3 py-2 data-[size=default]:min-h-11"
            : "rounded-lg px-2 py-1.5 data-[size=default]:min-h-9",
          className
        )}
      >
        <SelectValue>
          {selected ? (
            selected.label
          ) : (
            <span className="text-slate-400">{placeholder}</span>
          )}
        </SelectValue>
      </SelectTrigger>
      <SelectContent className="rounded-xl border border-slate-200 bg-white p-1 shadow-xl ring-0">
        {options.map((option) => (
          <SelectItem
            key={option.value}
            value={option.value}
            disabled={option.disabled}
            className="rounded-lg py-2.5 pr-8 pl-3 text-slate-700 focus:bg-indigo-50 focus:text-indigo-900 data-[selected]:font-semibold data-[selected]:text-indigo-700"
          >
            <span className="block whitespace-normal leading-snug">{option.label}</span>
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}
