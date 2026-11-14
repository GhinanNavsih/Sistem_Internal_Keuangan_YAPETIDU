"use client";

import React, { useMemo, useState } from 'react';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { SuratMasuk, SuratKeluar, SuratAttachment } from '@/lib/surat-menyurat/types';
import { draftFromSurat } from '@/lib/surat-menyurat/templates';
import { uploadFileTypeFor } from '@/lib/uploadFileTypes';
import { Download, ExternalLink, FileText } from 'lucide-react';
import LetterPaper from './LetterPaper';

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  surat: SuratMasuk | SuratKeluar | null;
  type: 'masuk' | 'keluar';
}

type LetterDocument =
  | { key: string; label: string; kind: 'naskah' }
  | { key: string; label: string; kind: 'file'; file: SuratAttachment };

function previewKind(file: SuratAttachment): 'image' | 'pdf' | 'other' {
  const extension = file.name.includes('.') ? file.name.split('.').pop() || '' : '';
  const fileType = uploadFileTypeFor(file.contentType || '') || uploadFileTypeFor(extension);
  if (!fileType || !fileType.inlinePreview) return 'other';
  return fileType.mime === 'application/pdf' ? 'pdf' : 'image';
}

/** Shows the letter itself: the typed naskah of a surat keluar, and the uploaded scan or file. */
export default function SuratDetailDialog({ open, onOpenChange, surat, type }: Props) {
  const [selection, setSelection] = useState<{ suratId: string; index: number }>({ suratId: '', index: 0 });

  const documents = useMemo<LetterDocument[]>(() => {
    if (!surat) return [];
    const docs: LetterDocument[] = [];
    if (type === 'keluar') {
      const keluar = surat as SuratKeluar;
      if (keluar.letterDraft || keluar.contentBody) docs.push({ key: 'naskah', label: 'Naskah surat', kind: 'naskah' });
    }
    (surat.attachments || []).forEach((file, index) => {
      docs.push({ key: file.id || String(index), label: file.name, kind: 'file', file });
    });
    return docs;
  }, [surat, type]);

  const naskahDraft = useMemo(
    () => (surat && type === 'keluar' ? draftFromSurat(surat as SuratKeluar, surat.satkerName) : null),
    [surat, type],
  );

  if (!surat) return null;

  const isMasuk = type === 'masuk';
  const index = selection.suratId === surat.id && selection.index < documents.length ? selection.index : 0;
  const current = documents[index];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-4xl max-w-4xl bg-white rounded-md p-6 border border-slate-100 shadow-[0_20px_50px_rgba(0,0,0,0.1)] max-h-[95vh] overflow-y-auto">
        <DialogHeader className="space-y-1 pr-8">
          <DialogTitle className="text-xl font-bold tracking-tight text-slate-900 break-words">
            {surat.nomorSurat}
          </DialogTitle>
          <DialogDescription className="text-xs text-slate-500 line-clamp-2">
            {isMasuk ? 'Surat masuk' : 'Surat keluar'} · {surat.perihal}
          </DialogDescription>
        </DialogHeader>

        {documents.length > 1 && (
          <div className="flex flex-wrap gap-1.5" role="tablist" aria-label="Dokumen surat">
            {documents.map((doc, i) => (
              <button
                key={doc.key}
                type="button"
                role="tab"
                aria-selected={i === index}
                onClick={() => setSelection({ suratId: surat.id, index: i })}
                className={`max-w-[220px] truncate rounded-sm border px-3 py-1.5 text-xs font-semibold transition-colors cursor-pointer ${
                  i === index
                    ? 'border-indigo-200 bg-indigo-50 text-indigo-700'
                    : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50'
                }`}
                title={doc.label}
              >
                {doc.label}
              </button>
            ))}
          </div>
        )}

        <div className="h-[68vh] overflow-auto rounded-md border border-slate-200 bg-slate-100 p-3 sm:p-4">
          {!current && (
            <div className="flex h-full flex-col items-center justify-center gap-2 text-slate-400">
              <FileText className="size-10 opacity-30" />
              <p className="text-sm font-medium">
                {isMasuk
                  ? 'Belum ada berkas surat yang diunggah.'
                  : 'Belum ada naskah atau berkas untuk surat ini.'}
              </p>
            </div>
          )}

          {current?.kind === 'naskah' && naskahDraft && (
            <div className="mx-auto w-fit max-w-full">
              <LetterPaper
                draft={naskahDraft}
                defaultSatkerName={surat.satkerName}
                isYapetidu={surat.institutionScope === 'YAPETIDU'}
                email={naskahDraft.satkerHeadEmail || ''}
                phone={naskahDraft.satkerHeadPhone || ''}
                readOnly
              />
            </div>
          )}

          {current?.kind === 'file' && (() => {
            const kind = previewKind(current.file);
            if (kind === 'pdf') {
              return <iframe src={current.file.url} title={current.file.name} className="h-full min-h-[60vh] w-full rounded-sm border-0 bg-white" />;
            }
            if (kind === 'image') {
              // eslint-disable-next-line @next/next/no-img-element
              return <img src={current.file.url} alt={current.file.name} className="mx-auto h-auto max-w-full rounded-sm bg-white shadow-sm" />;
            }
            return (
              <div className="flex h-full flex-col items-center justify-center gap-3 text-slate-500">
                <FileText className="size-10 opacity-40" />
                <p className="text-sm font-medium">Pratinjau tidak tersedia untuk jenis berkas ini.</p>
                <a
                  href={current.file.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1.5 rounded-sm border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 shadow-xs hover:bg-slate-50"
                >
                  <Download className="size-3.5" />
                  Unduh {current.file.name}
                </a>
              </div>
            );
          })()}
        </div>

        <DialogFooter className="pt-1">
          {current?.kind === 'file' && (
            <a
              href={current.file.url}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-2 px-4 py-2 text-xs font-semibold rounded-sm text-indigo-600 hover:bg-indigo-50 transition-colors"
            >
              <ExternalLink className="size-3.5" />
              Buka di tab baru
            </a>
          )}
          <button
            type="button"
            onClick={() => onOpenChange(false)}
            className="inline-flex items-center gap-2 px-4 py-2 text-xs font-semibold rounded-sm border border-slate-200 text-slate-700 bg-white hover:bg-slate-50 transition-all duration-150 shadow-sm cursor-pointer"
          >
            Tutup
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
