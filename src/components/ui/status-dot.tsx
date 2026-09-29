import * as React from "react"

import { cn } from "@/lib/utils"

type StatusTone = "success" | "warning" | "danger" | "neutral" | "accent"

const DOT: Record<StatusTone, string> = {
  success: "bg-green-500",
  warning: "bg-amber-500",
  danger: "bg-red-500",
  neutral: "bg-slate-400",
  accent: "bg-blue-500",
}

/**
 * Status is a coloured dot plus a word, never colour alone and never a filled
 * pill (UI_UX_PRINCIPLES.md §8). Colours carry meaning only: green done,
 * amber waiting or needs attention, red broken, grey inactive, blue in progress.
 */
function StatusDot({
  tone = "neutral",
  className,
  children,
  ...props
}: React.ComponentProps<"span"> & { tone?: StatusTone }) {
  return (
    <span
      data-slot="status-dot"
      className={cn("inline-flex items-center gap-1.5 text-sm text-slate-700", className)}
      {...props}
    >
      <span aria-hidden className={cn("size-2 shrink-0 rounded-full", DOT[tone])} />
      {children}
    </span>
  )
}

export { StatusDot }
export type { StatusTone }
