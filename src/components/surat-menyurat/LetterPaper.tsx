"use client";

import React, { useLayoutEffect, useMemo, useRef, useState } from 'react';
import { EditorContent, type Editor } from '@tiptap/react';
import { generateHTML } from '@tiptap/html';
import type { JSONContent } from '@tiptap/core';
import type { LetterDraftPayload } from '@/lib/surat-menyurat/templates';
import { buildLetterDoc } from '@/lib/surat-menyurat/letterDocBuild';
import { letterDocExtensions, setPageBreakSpacer } from './letterDocExtensions';
import { LETTER_CSS, LETTER_MARGIN_U, LETTER_PAGE_CONTENT_U, LETTER_SCREEN_CSS } from './letterPaperCss';

interface Props {
  draft: LetterDraftPayload;
  isYapetidu: boolean;
  /** Set when the paper is printed from the DOM by id. */
  id?: string;
  /** The editor to write in. Leave out to only view the letter. */
  editor?: Editor | null;
}

/** The letter shown without the editor. An older letter is laid out from its fields first. */
function LetterDocHtml({ draft, isYapetidu, spacer }: { draft: LetterDraftPayload; isYapetidu: boolean; spacer: number }) {
  const html = useMemo(() => {
    const doc = draft.letterDoc ?? buildLetterDoc(draft, { isYapetidu });
    const out = generateHTML(doc as JSONContent, letterDocExtensions({
      people: draft.assignedPeople ?? [],
      signerName: draft.taskAssigner ? draft.penandatanganNama : '',
      signerTitle: draft.penandatanganJabatan,
    }));
    // Printing keeps the closing block whole; when it would be split, it starts the next page.
    return spacer > 0 ? out.replace('class="letter-closing"', `class="letter-closing" style="margin-top: calc(var(--u) * ${spacer + 1})"`) : out;
  }, [draft, isYapetidu, spacer]);
  return <div dangerouslySetInnerHTML={{ __html: html }} />;
}

/**
 * Where the printed pages end, so the preview breaks like the PDF does. Returns how many pages the letter
 * fills, and how much space (in letter units) pushes the closing block to the next page when it would be
 * split across two. Printing keeps that block whole; the sheet reserves the same gap on screen.
 */
function useLetterPages(flowRef: React.RefObject<HTMLDivElement | null>) {
  const [layout, setLayout] = useState({ pages: 1, spacer: 0 });
  const applied = useRef(0);

  useLayoutEffect(() => {
    const flow = flowRef.current;
    if (!flow) return;
    const measure = () => {
      const unit = parseFloat(getComputedStyle(flow).fontSize) * (12 / 11);
      if (!unit) return;
      const pageHeight = LETTER_PAGE_CONTENT_U * unit;
      const flowRect = flow.getBoundingClientRect();
      const pages = Math.max(1, Math.ceil((flowRect.height - 0.5) / pageHeight));

      let spacerPx = 0;
      const closing = flow.querySelector<HTMLElement>('.letter-closing');
      if (closing) {
        const closingRect = closing.getBoundingClientRect();
        const top = closingRect.top - flowRect.top - applied.current * unit;
        const page = Math.floor(top / pageHeight);
        const pageEnd = (page + 1) * pageHeight;
        if (closingRect.height <= pageHeight && top + closingRect.height > pageEnd + 0.5) spacerPx = pageEnd - top;
      }

      const spacer = spacerPx / unit;
      setLayout((prev) => {
        if (prev.pages === pages && Math.abs(prev.spacer - spacer) < 0.01) return prev;
        applied.current = spacer;
        return { pages, spacer };
      });
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(flow);
    return () => observer.disconnect();
  }, [flowRef]);

  return layout;
}

/** The official letter on an A4 sheet. With an `editor` it is written in place, like a word processor. */
export default function LetterPaper({ draft, isYapetidu, id, editor }: Props) {
  const flowRef = useRef<HTMLDivElement>(null);
  const { pages, spacer } = useLetterPages(flowRef);
  const unit = (n: number) => `calc(var(--u) * ${n})`;

  useLayoutEffect(() => {
    if (editor) setPageBreakSpacer(editor, spacer);
  }, [editor, spacer]);

  return (
    <div className="letter-frame">
      <style href="letter-paper" precedence="default">{LETTER_CSS + LETTER_SCREEN_CSS}</style>
      <div
        className="letter-sheet letter-sheet--screen bg-white shadow-xl ring-1 ring-slate-200 rounded-xs select-text"
        style={{ minHeight: unit(pages * LETTER_PAGE_CONTENT_U + 2 * LETTER_MARGIN_U) }}
      >
        {/* Where each printed page ends */}
        {Array.from({ length: pages - 1 }, (_, index) => (
          <div
            key={index}
            aria-hidden
            className="letter-page-guide"
            style={{ top: unit(LETTER_MARGIN_U + (index + 1) * LETTER_PAGE_CONTENT_U) }}
          >
            <span>Halaman {index + 2}</span>
          </div>
        ))}

        {/* `id` marks the part that is printed: everything but the page guides. */}
        <div id={id} ref={flowRef} className="letter-doc">
          {editor === undefined ? <LetterDocHtml draft={draft} isYapetidu={isYapetidu} spacer={spacer} /> : <EditorContent editor={editor} />}
        </div>
      </div>
    </div>
  );
}
