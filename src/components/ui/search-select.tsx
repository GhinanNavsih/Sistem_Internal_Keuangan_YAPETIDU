"use client"

import * as React from "react"
import { Combobox } from "@base-ui/react/combobox"
import { CheckIcon, ChevronDownIcon } from "lucide-react"

import { cn } from "@/lib/utils"

export interface SearchSelectOption {
  value: string
  label: string
}

interface SearchSelectProps {
  value: string
  onValueChange: (value: string) => void
  options: readonly SearchSelectOption[]
  placeholder?: string
  /** Shown when the typed text matches no option. */
  emptyText?: string
  id?: string
  "aria-label"?: string
  disabled?: boolean
  /** Extra classes for the text box. */
  className?: string
}

/**
 * A select you can type into: the list narrows to the options whose label
 * contains the typed text, and the chosen option's label stays in the box.
 * Use it instead of `Select` when the list is long (an account catalog, say).
 * `value` is the option's `value`, or '' while nothing is chosen.
 */
export function SearchSelect({
  value,
  onValueChange,
  options,
  placeholder = "Cari…",
  emptyText = "Tidak ditemukan",
  id,
  "aria-label": ariaLabel,
  disabled,
  className,
}: SearchSelectProps) {
  const selected = options.find((option) => option.value === value) ?? null

  return (
    <Combobox.Root
      items={options}
      value={selected}
      onValueChange={(next) => onValueChange(next ? next.value : "")}
      itemToStringLabel={(option) => option.label}
      isItemEqualToValue={(option, current) => option.value === current.value}
      disabled={disabled}
    >
      <div className="relative w-full">
        <Combobox.Input
          id={id}
          aria-label={ariaLabel}
          placeholder={placeholder}
          className={cn(
            "h-9.5 w-full min-w-0 rounded-md border border-slate-300 bg-white pr-9 pl-3 text-sm text-slate-700 outline-none placeholder:text-slate-400 focus-visible:border-accent-500 focus-visible:ring-2 focus-visible:ring-accent-100 disabled:cursor-not-allowed disabled:opacity-50",
            className
          )}
        />
        <Combobox.Trigger
          aria-label="Buka daftar"
          className="absolute inset-y-0 right-0 flex w-9 items-center justify-center text-slate-400 hover:text-slate-600"
        >
          <ChevronDownIcon className="size-4" />
        </Combobox.Trigger>
      </div>
      <Combobox.Portal>
        <Combobox.Positioner sideOffset={4} align="start" className="isolate z-50">
          <Combobox.Popup className="max-h-72 w-max min-w-(--anchor-width) max-w-[28rem] overflow-y-auto rounded-lg border border-slate-200 bg-white p-1 text-slate-700 shadow-lg">
            <Combobox.Empty className="px-3 py-2 text-sm text-slate-500">{emptyText}</Combobox.Empty>
            <Combobox.List>
              {(option: SearchSelectOption) => (
                <Combobox.Item
                  key={option.value}
                  value={option}
                  className="flex min-h-9 cursor-default items-center justify-between gap-3 rounded-md px-3 py-1.5 text-sm text-slate-700 outline-none select-none data-highlighted:bg-slate-50 data-highlighted:text-slate-900"
                >
                  <span>{option.label}</span>
                  <Combobox.ItemIndicator>
                    <CheckIcon className="size-4 text-accent-600" />
                  </Combobox.ItemIndicator>
                </Combobox.Item>
              )}
            </Combobox.List>
          </Combobox.Popup>
        </Combobox.Positioner>
      </Combobox.Portal>
    </Combobox.Root>
  )
}
