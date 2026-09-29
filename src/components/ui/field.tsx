import * as React from "react"

import { Label } from "@/components/ui/label"
import { cn } from "@/lib/utils"

interface FieldProps {
  label: React.ReactNode
  /** `id` of the control the label belongs to. */
  htmlFor?: string
  /** Only for what people cannot guess: a constraint, a format, a consequence. */
  hint?: React.ReactNode
  error?: React.ReactNode
  required?: boolean
  /** A small shortcut link on the label's right, e.g. "Isi manual". */
  action?: React.ReactNode
  className?: string
  children: React.ReactNode
}

/** A label above its control, with an optional hint and error underneath. */
function Field({ label, htmlFor, hint, error, required, action, className, children }: FieldProps) {
  return (
    <div data-slot="field" className={cn("space-y-1.5", className)}>
      <div className="flex items-center justify-between gap-2">
        <Label htmlFor={htmlFor} className="text-slate-900">
          {label}
          {required ? (
            <span aria-hidden className="text-red-600">
              *
            </span>
          ) : null}
        </Label>
        {action}
      </div>
      {children}
      {error ? (
        <p role="alert" className="text-xs text-red-600">
          {error}
        </p>
      ) : hint ? (
        <p className="text-xs text-slate-500">{hint}</p>
      ) : null}
    </div>
  )
}

export { Field }
