"use client";

import React, { useLayoutEffect, useRef, useState } from 'react';
import Image from 'next/image';
import { formatPenandatanganJabatan, type LetterDraftPayload } from '@/lib/surat-menyurat/templates';
import { formatLetterDate } from '@/lib/surat-menyurat/date';
import { LETTER_CSS, LETTER_MARGIN_U, LETTER_PAGE_CONTENT_U, LETTER_SCREEN_CSS } from './letterPaperCss';

/** Draft fields the paper shows, and the composer lets people edit in place. */
export type LetterField = Exclude<keyof LetterDraftPayload, 'templateType' | 'assignedPeople' | 'taskAssigner'>;

interface Props {
  draft: LetterDraftPayload;
  defaultSatkerName: string;
  isYapetidu: boolean;
  /** Head's contact for the letterhead; blank shows a placeholder unless `readOnly`. */
  email: string;
  phone: string;
  /** Set when the paper is printed from the DOM by id. */
  id?: string;
  /** Plain viewing: no placeholders for missing contact details. */
  readOnly?: boolean;
  /** Wraps a field's text so the composer can make it editable in place. */
  renderField?: (field: LetterField, display: string, label: string, multiline?: boolean) => React.ReactNode;
  /** Keeps an empty field visible while it is being edited. */
  isEditing?: (field: LetterField) => boolean;
}

/**
 * Where the printed pages end, so the preview breaks like the PDF does. Returns how many pages the letter
 * fills, and how much space (in letter units) pushes the closing block to the next page when it would be
 * split across two. Printing keeps that block whole; this reserves the same gap on screen.
 */
function useLetterPages(flowRef: React.RefObject<HTMLDivElement | null>, closingRef: React.RefObject<HTMLDivElement | null>) {
  const [layout, setLayout] = useState({ pages: 1, spacer: 0 });

  useLayoutEffect(() => {
    const flow = flowRef.current;
    if (!flow) return;
    const measure = () => {
      const unit = parseFloat(getComputedStyle(flow).fontSize);
      if (!unit) return;
      const pageHeight = LETTER_PAGE_CONTENT_U * unit;
      const flowRect = flow.getBoundingClientRect();
      const pages = Math.max(1, Math.ceil((flowRect.height - 0.5) / pageHeight));

      let spacerPx = 0;
      const closing = closingRef.current;
      if (closing) {
        const reserved = flow.querySelector('[data-letter-screen-only="spacer"]')?.getBoundingClientRect().height ?? 0;
        const closingRect = closing.getBoundingClientRect();
        const top = closingRect.top - flowRect.top - reserved;
        const page = Math.floor(top / pageHeight);
        const pageEnd = (page + 1) * pageHeight;
        if (closingRect.height <= pageHeight && top + closingRect.height > pageEnd + 0.5) spacerPx = pageEnd - top;
      }

      const spacer = spacerPx / unit;
      setLayout((prev) => (prev.pages === pages && Math.abs(prev.spacer - spacer) < 0.01 ? prev : { pages, spacer }));
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(flow);
    return () => observer.disconnect();
  }, [flowRef, closingRef]);

  return layout;
}

/** The official letter on an A4 sheet: letterhead, body and signature. */
export default function LetterPaper({
  draft,
  defaultSatkerName,
  isYapetidu,
  email,
  phone,
  id,
  readOnly = false,
  renderField,
  isEditing,
}: Props) {
  const field = (name: LetterField, display: string, label: string, multiline = false): React.ReactNode =>
    renderField ? renderField(name, display, label, multiline) : display;
  const editing = (name: LetterField) => Boolean(isEditing?.(name));

  const flowRef = useRef<HTMLDivElement>(null);
  const closingRef = useRef<HTMLDivElement>(null);
  const { pages, spacer } = useLetterPages(flowRef, closingRef);

  const emailDisplay = email || '{satker_head_email}';
  const phoneDisplay = phone || '{satker_head_phone_number}';
  const emailFormatted = emailDisplay.startsWith('{') ? `email:${emailDisplay}` : `email: ${emailDisplay}`;
  const unit = (n: number) => `calc(var(--u) * ${n})`;

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
        <div id={id} ref={flowRef}>
          {/* Kop surat sesuai lingkup surat yang dicatat */}
          <div className="kop-container">
            <div className="kop-logo">
              <Image
                src={isYapetidu ? '/Logo YAPETIDU (Transparent bg).png' : '/Logo UNIPDU.png'}
                alt={isYapetidu ? 'Logo YAPETIDU' : 'Logo UNIPDU'}
                width={56}
                height={56}
                priority
              />
            </div>
            <div className="kop-text">
              <h1 className="kop-instansi">
                {isYapetidu ? "YAYASAN PESANTREN TINGGI DARUL 'ULUM JOMBANG" : 'UNIVERSITAS PESANTREN TINGGI DARUL ULUM'}
              </h1>
              <h2 className="kop-satker">
                {field('satkerName', draft.satkerName || defaultSatkerName || 'SATUAN KERJA', 'nama SatKer')}
              </h2>
              <p className="kop-alamat">Alamat: PP Darul Ulum, Tromol Pos 10 Peterongan Jombang Jawa Timur 61481</p>
              <p className="kop-kontak">
                Website: unipdu.ac.id
                {(!readOnly || email) && <> | {field('satkerHeadEmail', emailFormatted, 'email')}</>}
                {(!readOnly || phone) && <> | Telp. {field('satkerHeadPhone', phoneDisplay, 'telepon')}</>}
              </p>
            </div>
          </div>

          {/* Nomor, Lampiran, Hal */}
          <div className="letter-meta">
            <div className="meta-row">
              <span className="meta-label">Nomor</span>
              <span className="meta-sep">:</span>
              <span className="meta-value meta-bold">{field('nomorSurat', draft.nomorSurat, 'nomor surat')}</span>
            </div>
            <div className="meta-row">
              <span className="meta-label">Lampiran</span>
              <span className="meta-sep">:</span>
              <span className="meta-value">{field('lampiranKeterangan', draft.lampiranKeterangan || '-', 'lampiran')}</span>
            </div>
            <div className="meta-row">
              <span className="meta-label">Hal</span>
              <span className="meta-sep">:</span>
              <span className="meta-value meta-hal">{field('perihal', draft.perihal || 'Surat Dinas', 'perihal', true)}</span>
            </div>
          </div>

          {/* Kepada Yth */}
          <div className="destination-block">
            <p>Kepada Yth.</p>
            <p className="dest-name">{field('tujuanNama', draft.tujuanNama || 'Bapak / Ibu', 'nama penerima', true)}</p>
            <p className="dest-city">{field('tujuanAlamatKota', draft.tujuanAlamatKota || 'di Tempat', 'alamat penerima')}</p>
          </div>

          {/* Isi Surat */}
          <div className="letter-content">
            {(draft.salamPembuka || editing('salamPembuka')) && (
              <p className="salam">{field('salamPembuka', draft.salamPembuka, 'salam pembuka', true)}</p>
            )}
            {draft.templateType === 'tugas' && draft.taskAssigner && <div className="task-giver">Pemberi tugas:<br />Nama: {draft.penandatanganNama}<br />Jabatan: {draft.penandatanganJabatan}</div>}
            {(draft.isiParagraf1 || editing('isiParagraf1')) && (
              <p className="indented">{field('isiParagraf1', draft.isiParagraf1, 'paragraf pembuka', true)}</p>
            )}
            {draft.templateType === 'tugas' && (draft.assignedPeople || []).length > 0 && <ol className="task-people">{draft.assignedPeople?.map((person) => <li key={`${person.collection}:${person.id}`}>{person.name}{person.role ? ` — ${person.role}` : ''}</li>)}</ol>}
            {(draft.isiParagraf2 || editing('isiParagraf2')) && (
              <div className="raw-block">
                {field('isiParagraf2', draft.isiParagraf2, 'isi surat', true)}
              </div>
            )}
            {(draft.isiParagraf3 || editing('isiParagraf3')) && (
              <p className="indented">{field('isiParagraf3', draft.isiParagraf3, 'paragraf penutup', true)}</p>
            )}
          </div>

          {/* The closing and signature are kept together: they move to the next page whole, never split. */}
          {spacer > 0 && <div data-letter-screen-only="spacer" aria-hidden style={{ height: unit(spacer) }} />}
          <div ref={closingRef} className={`letter-closing${spacer > 0 ? ' letter-closing--pushed' : ''}`}>
            {(draft.salamPenutup || editing('salamPenutup')) && (
              <p className="salam">{field('salamPenutup', draft.salamPenutup, 'salam penutup', true)}</p>
            )}

            {/* Tanda Tangan */}
            <div className="signature-block">
              <p className="signature-date">
                Jombang, {field('tanggalSurat', formatLetterDate(draft.tanggalSurat), 'tanggal surat')}
              </p>
              <p className="signature-jabatan">
                {field('penandatanganJabatan', draft.templateType === 'tugas' && draft.taskAssigner ? draft.penandatanganJabatan : formatPenandatanganJabatan(draft.penandatanganJabatan, draft.satkerName || defaultSatkerName), 'jabatan penandatangan')},
              </p>
              <div className="sign-space" />
              <p className="sign-name">
                {field('penandatanganNama', draft.penandatanganNama, 'nama penandatangan')}
              </p>
              {(draft.penandatanganNipy || editing('penandatanganNipy')) && (
                <p>NIPY: {field('penandatanganNipy', draft.penandatanganNipy, 'NIPY')}</p>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
