'use client';

import React, { useRef, useState } from 'react';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';

/** A grant belongs to one focus visit, never to the whole event. Portals retain
 * this React capture boundary, including the report and employee pickers. */
export default function ProposalEditGuard({ enabled, ownerName, children }: {
  enabled: boolean;
  ownerName?: string | null;
  children: React.ReactNode;
}) {
  const [pending, setPending] = useState<HTMLElement | null>(null);
  const granted = useRef<HTMLElement | null>(null);
  const replay = useRef(false);
  const cancelled = useRef<HTMLElement | null>(null);
  const resume = useRef<HTMLElement | null>(null);

  const intercept = (event: React.SyntheticEvent) => {
    if (!enabled || replay.current) return;
    const target = event.target as HTMLElement;
    const control = target.closest<HTMLElement>(
      'input:not(:disabled):not([readonly]), textarea:not(:disabled):not([readonly]), select:not(:disabled), [role="combobox"]:not([disabled]), [data-proposal-mutation]:not([disabled])',
    );
    if (!control || control.closest('[data-proposal-view]')) return;
    // Options belong to the selector whose focus was confirmed.
    if (granted.current && target.closest('[role="listbox"], [role="option"]')) return;
    if (granted.current === control) return;
    if (event.type === 'focus' && cancelled.current === control) return;
    cancelled.current = null;
    event.preventDefault();
    event.stopPropagation();
    if (event.type === 'focus') control.blur();
    setPending(control);
  };

  return <>
    <div className="contents"
      onPointerDownCapture={intercept}
      onMouseDownCapture={intercept}
      onTouchStartCapture={intercept}
      onClickCapture={intercept}
      onFocusCapture={intercept}
      onBeforeInputCapture={intercept}
      onChangeCapture={intercept}
      onKeyDownCapture={(event) => {
        if (!['Tab', 'Escape', 'Shift', 'Control', 'Alt', 'Meta'].includes(event.key)) intercept(event);
      }}
      onBlurCapture={(event) => {
        const next = event.relatedTarget as HTMLElement | null;
        if (next && (next === granted.current || next.closest('[role="listbox"], [role="option"]'))) return;
        granted.current = null;
      }}
    >{children}</div>
    <ConfirmDialog open={Boolean(pending)} title="Ubah data kegiatan?"
      description={`Kegiatan ini dibuat oleh ${ownerName || 'akun lain'}. Lanjutkan untuk mengubah nilai pada kolom atau kontrol yang dipilih.`}
      confirmLabel="Ya, ubah nilai" cancelLabel="Kembali"
      onOpenChange={(open) => {
        if (!open) { cancelled.current = pending; setPending(null); }
      }}
      onConfirm={() => {
        const control = pending;
        setPending(null);
        if (!control?.isConnected) return;
        resume.current = control;
        granted.current = control;
      }}
      finalFocus={() => {
        const control = resume.current;
        resume.current = null;
        if (!control?.isConnected) return cancelled.current?.isConnected ? cancelled.current : false;
        granted.current = control;
        if (control.matches('button, select, [role="combobox"], input[type="checkbox"], input[type="radio"], input[type="file"]')) queueMicrotask(() => {
          replay.current = true;
          control.click();
          replay.current = false;
        });
        return control;
      }}
    />
  </>;
}
