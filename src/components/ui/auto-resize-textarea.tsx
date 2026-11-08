"use client";

import * as React from "react";
import { cn } from "@/lib/utils";

// SSR-safe layout effect
const useIsomorphicLayoutEffect =
  typeof window !== "undefined" ? React.useLayoutEffect : React.useEffect;

export interface AutoResizeTextareaProps
  extends React.TextareaHTMLAttributes<HTMLTextAreaElement> {
  minRows?: number;
  maxRows?: number;
}

export const AutoResizeTextarea = React.forwardRef<
  HTMLTextAreaElement,
  AutoResizeTextareaProps
>(
  (
    {
      value,
      defaultValue,
      minRows = 1,
      maxRows,
      className,
      onChange,
      onInput,
      style,
      rows,
      ...props
    },
    forwardedRef
  ) => {
    const textareaRef = React.useRef<HTMLTextAreaElement | null>(null);
    const prevWidthRef = React.useRef<number>(0);

    React.useImperativeHandle(
      forwardedRef,
      () => textareaRef.current as HTMLTextAreaElement
    );

    const adjustHeight = React.useCallback(() => {
      const textarea = textareaRef.current;
      if (!textarea) return;

      // Reset height to 'auto' so scrollHeight can accurately shrink on contraction
      textarea.style.height = "auto";

      const scrollHeight = textarea.scrollHeight;
      if (scrollHeight > 0) {
        textarea.style.height = `${scrollHeight}px`;
      }
    }, []);

    // Adjust immediately on value/defaultValue changes
    useIsomorphicLayoutEffect(() => {
      adjustHeight();
      const rafId = requestAnimationFrame(adjustHeight);
      return () => cancelAnimationFrame(rafId);
    }, [value, defaultValue, adjustHeight]);

    // Recalculate on container / window resize as text wrapping line counts change
    React.useEffect(() => {
      const textarea = textareaRef.current;
      if (!textarea) return;

      if (typeof ResizeObserver !== "undefined") {
        const observer = new ResizeObserver((entries) => {
          for (const entry of entries) {
            const width = entry.contentRect.width;
            if (width > 0 && Math.abs(width - prevWidthRef.current) > 1) {
              prevWidthRef.current = width;
              adjustHeight();
            }
          }
        });

        if (textarea.parentElement) {
          observer.observe(textarea.parentElement);
        } else {
          observer.observe(textarea);
        }

        return () => observer.disconnect();
      } else {
        const handleResize = () => adjustHeight();
        window.addEventListener("resize", handleResize);
        return () => window.removeEventListener("resize", handleResize);
      }
    }, [adjustHeight]);

    // Compute min-height for clean baseline presentation
    // text-xs has ~18px line-height, with 20px vertical padding (p-2.5) + 2px border
    const minHeightStyle = minRows
      ? { minHeight: `${minRows * 18 + 20}px` }
      : undefined;

    const maxHeightStyle = maxRows
      ? { maxHeight: `${maxRows * 18 + 20}px`, overflowY: "auto" as const }
      : undefined;

    return (
      <textarea
        ref={textareaRef}
        value={value}
        defaultValue={defaultValue}
        rows={rows ?? minRows}
        onChange={(e) => {
          onChange?.(e);
          adjustHeight();
        }}
        onInput={(e) => {
          onInput?.(e);
          adjustHeight();
        }}
        style={{
          fieldSizing: "content",
          ...minHeightStyle,
          ...maxHeightStyle,
          ...style,
        }}
        className={cn(
          "w-full resize-none overflow-hidden rounded-sm border border-slate-200 bg-white p-2.5 text-xs transition-[border-color,box-shadow] focus:border-indigo-500 focus:outline-none focus:ring-4 focus:ring-indigo-100 disabled:cursor-not-allowed disabled:bg-slate-50",
          className
        )}
        {...props}
      />
    );
  }
);

AutoResizeTextarea.displayName = "AutoResizeTextarea";
