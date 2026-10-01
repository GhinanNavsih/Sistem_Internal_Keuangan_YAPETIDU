"use client";

import { useRef } from 'react';
import { Paperclip, Trash2, Upload } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { FAMILY_PROOF_MAX_BYTES } from '@/lib/payroll/familyAllowanceRequests';
import { gantiLiburAttachmentContentType } from '@/lib/payroll/gantiLiburAttachments';

interface Props {
  file: File | null;
  onFileChange: (file: File | null) => void;
  /** Goes on the pick button, so a `Field` label can point at it. */
  id?: string;
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024)).toLocaleString('id-ID')} KB`;
  return `${(bytes / 1024 / 1024).toLocaleString('id-ID', { maximumFractionDigits: 1 })} MB`;
}

/** Why the chosen file cannot be sent, or '' when it can. */
export function familyProofProblem(file: File | null): string {
  if (!file) return '';
  if (file.size < 1) return 'Berkas kosong.';
  if (file.size > FAMILY_PROOF_MAX_BYTES) return 'Ukuran berkas melebihi 5 MB.';
  if (!gantiLiburAttachmentContentType(file.name, file.type)) return 'Format tidak didukung. Pilih foto atau PDF.';
  return '';
}

/**
 * The proof picker: the chosen file as a quiet row (name, size, a red remove
 * icon) above an upload button, in the same shape as `ReceiptAttachments`. A
 * file that cannot be sent is flagged here, so it shows before Kirim is pressed.
 * The file itself is only uploaded on submit.
 */
export default function FamilyProofUploadCard({ file, onFileChange, id }: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const problem = familyProofProblem(file);

  return (
    <div className="space-y-2">
      {file && (
        <div
          className={`flex items-center gap-2 rounded-md border px-3 py-2 text-sm ${
            problem ? 'border-red-200' : 'border-slate-200'
          }`}
        >
          <Paperclip className="size-4 shrink-0 text-slate-400" />
          <span className="min-w-0 flex-1 truncate text-slate-700">{file.name}</span>
          <span className="shrink-0 text-xs tabular-nums text-slate-500">{formatFileSize(file.size)}</span>
          <Button className="rounded-sm"
            type="button"
            variant="danger-ghost"
            size="icon-sm"
            onClick={() => onFileChange(null)}
            aria-label="Hapus berkas"
            title="Hapus berkas"
          >
            <Trash2 />
          </Button>
        </div>
      )}
      {problem && (
        <p role="alert" className="text-xs text-red-600">
          {problem}
        </p>
      )}
      <Button
        id={id}
        type="button"
        variant="outline"
        size="lg"
        onClick={() => inputRef.current?.click()}
        className="rounded-sm w-full border-dashed"
      >
        <Upload />
        {file ? 'Ganti berkas' : 'Pilih foto atau PDF'}
      </Button>
      <input
        ref={inputRef}
        type="file"
        hidden
        accept="image/*,application/pdf"
        onChange={event => {
          const chosen = event.target.files?.[0] || null;
          event.target.value = '';
          onFileChange(chosen);
        }}
      />
    </div>
  );
}
