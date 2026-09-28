"use client";

import { AlertCircle, CheckCircle2, FileUp } from 'lucide-react';
import { FAMILY_PROOF_MAX_BYTES } from '@/lib/payroll/familyAllowanceRequests';
import { gantiLiburAttachmentContentType } from '@/lib/payroll/gantiLiburAttachments';

interface Props {
  file: File | null;
  onFileChange: (file: File | null) => void;
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
 * The proof-of-enrollment picker. It turns green once an acceptable file is
 * chosen, and red when the file can't be sent, so the sopir sees the outcome
 * before pressing Kirim. The file itself is only uploaded on submit.
 */
export default function FamilyProofUploadCard({ file, onFileChange }: Props) {
  const problem = familyProofProblem(file);
  const state = !file ? 'empty' : problem ? 'rejected' : 'accepted';

  const frame = {
    empty: 'border-dashed border-indigo-200 bg-indigo-50/50 hover:bg-indigo-50',
    accepted: 'border-solid border-emerald-300 bg-emerald-50 hover:bg-emerald-100/70',
    rejected: 'border-solid border-rose-300 bg-rose-50 hover:bg-rose-100/70',
  }[state];

  return (
    <label className={`relative flex min-h-28 cursor-pointer flex-col items-center justify-center rounded-xl border-2 p-4 text-center transition-colors ${frame}`}>
      {state === 'empty' && <FileUp className="mb-2 size-6 text-indigo-600" />}
      {state === 'accepted' && (
        <span className="mb-2 flex size-10 items-center justify-center rounded-full bg-emerald-100 text-emerald-600">
          <CheckCircle2 className="size-6" />
        </span>
      )}
      {state === 'rejected' && (
        <span className="mb-2 flex size-10 items-center justify-center rounded-full bg-rose-100 text-rose-600">
          <AlertCircle className="size-6" />
        </span>
      )}

      <span className={`block max-w-full truncate text-sm font-medium ${
        state === 'accepted' ? 'font-semibold text-emerald-900' : state === 'rejected' ? 'font-semibold text-rose-900' : 'text-indigo-800'
      }`}>
        {file ? file.name : 'Ketuk untuk memilih foto atau PDF'}
      </span>

      <span role="status" className={`mt-1 text-xs ${
        state === 'accepted' ? 'text-emerald-800' : state === 'rejected' ? 'text-rose-800' : 'text-slate-500'
      }`}>
        {state === 'empty' && 'Surat keterangan aktif sekolah, kartu pelajar, atau bukti pendaftaran · maksimal 5 MB'}
        {state === 'accepted' && `Bukti siap dikirim · ${formatFileSize(file!.size)} · ketuk untuk mengganti`}
        {state === 'rejected' && `${problem} Ketuk untuk memilih berkas lain.`}
      </span>

      <input type="file" accept="image/*,application/pdf" aria-label="Bukti pertama masuk sekolah"
        className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
        onChange={event => {
          const chosen = event.target.files?.[0] || null;
          event.target.value = '';
          onFileChange(chosen);
        }} />
    </label>
  );
}
