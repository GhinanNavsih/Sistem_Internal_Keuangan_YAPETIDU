import * as React from "react"
import { AlertCircle, AlertTriangle, Info } from "lucide-react"

import { cn } from "@/lib/utils"

type CalloutTone = "info" | "warning" | "error"

const TONES: Record<
  CalloutTone,
  { box: string; icon: React.ComponentType<{ className?: string }>; iconClass: string }
> = {
  info: { box: "border-blue-200 bg-blue-50 text-blue-900", icon: Info, iconClass: "text-blue-600" },
  warning: {
    box: "border-amber-200 bg-amber-50 text-amber-900",
    icon: AlertTriangle,
    iconClass: "text-amber-600",
  },
  error: { box: "border-red-200 bg-red-50 text-red-900", icon: AlertCircle, iconClass: "text-red-600" },
}

interface CalloutProps extends React.ComponentProps<"div"> {
  tone?: CalloutTone
  /** A small secondary control on the right, e.g. a retry button. */
  action?: React.ReactNode
}

/**
 * A tinted box with an icon for a problem or an important note inside a form
 * or detail view. One sentence where possible. Errors are announced to
 * assistive technology.
 */
function Callout({ tone = "info", action, className, children, ...props }: CalloutProps) {
  const { box, icon: Icon, iconClass } = TONES[tone]
  return (
    <div
      role={tone === "error" ? "alert" : undefined}
      data-slot="callout"
      className={cn("flex items-start gap-2.5 rounded-lg border px-3 py-2.5 text-sm", box, className)}
      {...props}
    >
      <Icon className={cn("mt-0.5 size-4 shrink-0", iconClass)} />
      <div className="min-w-0 flex-1 leading-snug">{children}</div>
      {action ? <div className="shrink-0">{action}</div> : null}
    </div>
  )
}

export { Callout }
export type { CalloutTone }
