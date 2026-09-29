import * as React from "react"

import { cn } from "@/lib/utils"

/** A label/value list: labels on the left, values on the right, hairlines between. */
function DetailList({ className, ...props }: React.ComponentProps<"dl">) {
  return (
    <dl
      data-slot="detail-list"
      className={cn("divide-y divide-slate-100 text-sm", className)}
      {...props}
    />
  )
}

interface DetailRowProps extends Omit<React.ComponentProps<"div">, "children"> {
  label: React.ReactNode
  /** The row that matters most, e.g. a total: larger and semibold. */
  emphasis?: boolean
  children: React.ReactNode
}

function DetailRow({ label, emphasis, className, children, ...props }: DetailRowProps) {
  return (
    <div
      data-slot="detail-row"
      className={cn("flex items-baseline justify-between gap-4 py-2", className)}
      {...props}
    >
      <dt className={cn("min-w-0", emphasis ? "font-semibold text-slate-900" : "text-slate-500")}>
        {label}
      </dt>
      <dd
        className={cn(
          "min-w-0 text-right tabular-nums",
          emphasis ? "text-base font-semibold text-slate-900" : "text-slate-900",
        )}
      >
        {children}
      </dd>
    </div>
  )
}

export { DetailList, DetailRow }
