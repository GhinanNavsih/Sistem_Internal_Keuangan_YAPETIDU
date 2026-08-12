"use client";

import { createPortal } from "react-dom";
import { AlertCircle, CheckCircle2, X } from "lucide-react";

export type SnackbarMessage = {
  type: "success" | "error";
  text: string;
};

type FloatingSnackbarProps = {
  message?: SnackbarMessage | null;
  onDismiss?: () => void;
  title?: string;
};

/**
 * Renders transient feedback above the application UI, including modal and
 * transformed stacking contexts created by page-level layouts.
 */
export function FloatingSnackbar({ message, onDismiss, title }: FloatingSnackbarProps) {
  if (!message || typeof document === "undefined") return null;

  const isError = message.type === "error";

  return createPortal(
    <div
      className="pointer-events-none fixed inset-x-0 top-0 z-[2147483647] flex justify-center px-4 pt-[max(1rem,env(safe-area-inset-top))]"
      role={isError ? "alert" : "status"}
      aria-live={isError ? "assertive" : "polite"}
      aria-atomic="true"
    >
      <div
        className={`pointer-events-auto flex w-full max-w-[640px] items-start gap-3 rounded-2xl border px-4 py-3.5 text-sm font-semibold shadow-2xl animate-in fade-in slide-in-from-top-4 duration-300 ${
          isError
            ? "border-rose-200 bg-rose-50 text-rose-900"
            : "border-emerald-200 bg-emerald-50 text-emerald-900"
        }`}
      >
        {isError ? (
          <AlertCircle className="mt-0.5 h-5 w-5 shrink-0 text-rose-600" aria-hidden="true" />
        ) : (
          <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-emerald-600" aria-hidden="true" />
        )}

        <div className="min-w-0 flex-1">
          {title && <div className="font-bold">{title}</div>}
          <div className={title ? "mt-0.5 text-xs leading-relaxed" : "leading-relaxed"}>
            {message.text}
          </div>
        </div>

        {onDismiss && (
          <button
            type="button"
            onClick={onDismiss}
            aria-label="Tutup pemberitahuan"
            className="-mr-1 -mt-1 shrink-0 rounded-lg p-1 text-slate-400 transition-colors hover:bg-black/5 hover:text-slate-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-400"
          >
            <X className="h-4 w-4" aria-hidden="true" />
          </button>
        )}
      </div>
    </div>,
    document.body,
  );
}
