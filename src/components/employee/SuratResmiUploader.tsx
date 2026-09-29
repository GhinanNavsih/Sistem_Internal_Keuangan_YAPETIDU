"use client";

import { useRef, type Dispatch, type SetStateAction } from 'react';
import { FileText, Image as ImageIcon, Loader2, Paperclip, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { authenticatedFormData } from '@/lib/payroll/client';
import { compressProofImageToLimit } from '@/lib/photoEvidence';
import {
  GANTI_LIBUR_ATTACHMENT_ACCEPT,
  GANTI_LIBUR_MAX_ATTACHMENTS,
  GANTI_LIBUR_MAX_ATTACHMENT_BYTES,
  formatAttachmentSize,
  gantiLiburAttachmentContentType,
  gantiLiburAttachmentTypeIssue,
  isPdfAttachment,
  type GantiLiburAttachment,
} from '@/lib/payroll/gantiLiburAttachments';

export interface SuratResmiItem {
  key: string;
  name: string;
  size: number;
  status: 'uploading' | 'done' | 'error';
  attachment?: GantiLiburAttachment;
  error?: string;
}

const MAX_ATTACHMENT_MB = GANTI_LIBUR_MAX_ATTACHMENT_BYTES / (1024 * 1024);

// Module-level so a key stays unique when the uploader remounts and the files
// it shows are still held by its parent.
let uploadCounter = 0;

/** Files already stored on a request, shown as uploaded. */
export function suratResmiItemsFromAttachments(
  attachments: readonly GantiLiburAttachment[] | undefined,
): SuratResmiItem[] {
  return (attachments || []).map((attachment) => ({
    key: `saved-${attachment.path}`,
    name: attachment.name,
    size: attachment.size,
    status: 'done' as const,
    attachment,
  }));
}

/** Storage paths of the uploaded files, in the order a submission names them. */
export function suratResmiPaths(items: readonly SuratResmiItem[]): string[] {
  return items.flatMap((item) => (item.attachment ? [item.attachment.path] : []));
}

/**
 * A file within the size limit is sent as it is. A larger photo is scaled
 * down to fit; anything else that is too big is refused.
 */
async function fitAttachmentToLimit(file: File): Promise<File> {
  if (file.size <= GANTI_LIBUR_MAX_ATTACHMENT_BYTES) return file;
  if (/^image\/(jpeg|png|webp)$/.test(file.type)) {
    try {
      return await compressProofImageToLimit(file, GANTI_LIBUR_MAX_ATTACHMENT_BYTES);
    } catch {
      // Fall through to the size message below.
    }
  }
  throw new Error(`Ukuran berkas melebihi ${MAX_ATTACHMENT_MB} MB.`);
}

async function uploadAttachment(endpoint: string, file: File): Promise<GantiLiburAttachment> {
  const typeIssue = gantiLiburAttachmentTypeIssue(file.name, file.type);
  if (typeIssue) throw new Error(typeIssue);
  const form = new FormData();
  form.append('file', await fitAttachmentToLimit(file));
  const { attachment } = await authenticatedFormData<{ attachment: GantiLiburAttachment }>(
    endpoint,
    form,
  );
  return attachment;
}

/**
 * Picker for the surat resmi of a leave request. The files are held by the
 * parent (`files`) so it can tell when one is still uploading, has failed, or
 * is missing, and send the paths with the submission. `locked` shows what was
 * submitted without letting it be changed.
 */
export function SuratResmiUploader({
  endpoint,
  files,
  onFilesChange,
  onError,
  disabled = false,
  locked = false,
}: {
  endpoint: string;
  files: SuratResmiItem[];
  onFilesChange: Dispatch<SetStateAction<SuratResmiItem[]>>;
  onError: (message: string) => void;
  disabled?: boolean;
  locked?: boolean;
}) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const uploading = files.some((item) => item.status === 'uploading');
  const failed = files.some((item) => item.status === 'error');

  const addFiles = async (picked: File[]) => {
    if (picked.length === 0) return;
    onError('');
    const room = Math.max(0, GANTI_LIBUR_MAX_ATTACHMENTS - files.length);
    const accepted = picked.slice(0, room);
    if (accepted.length < picked.length) {
      onError(
        `Surat resmi maksimal ${GANTI_LIBUR_MAX_ATTACHMENTS} berkas; ${picked.length - accepted.length} berkas tidak ditambahkan.`,
      );
    }
    const queued = accepted.map((file) => ({ file, key: `upload-${uploadCounter++}` }));
    onFilesChange((current) => [
      ...current,
      ...queued.map(({ file, key }) => ({
        key,
        name: file.name,
        size: file.size,
        status: 'uploading' as const,
      })),
    ]);
    await Promise.all(
      queued.map(async ({ file, key }) => {
        try {
          const attachment = await uploadAttachment(endpoint, file);
          onFilesChange((current) =>
            current.map((item) =>
              item.key === key ? { ...item, status: 'done', attachment } : item,
            ),
          );
        } catch (cause) {
          const message = cause instanceof Error ? cause.message : 'Berkas gagal diunggah.';
          onFilesChange((current) =>
            current.map((item) =>
              item.key === key ? { ...item, status: 'error', error: message } : item,
            ),
          );
        }
      }),
    );
  };

  const removeFile = (key: string) => {
    onFilesChange((current) => current.filter((item) => item.key !== key));
    onError('');
  };

  return (
    <div className="space-y-2">
      <input
        ref={fileInputRef}
        type="file"
        multiple
        accept={GANTI_LIBUR_ATTACHMENT_ACCEPT}
        className="hidden"
        onChange={(event) => {
          const picked = Array.from(event.target.files || []);
          // Clear the input so picking the same file again still fires.
          event.target.value = '';
          void addFiles(picked);
        }}
      />
      {!locked && (
        <Button
          type="button"
          variant="outline"
          className="min-h-14 w-full gap-2 rounded-xl border-dashed border-slate-300 text-base font-bold text-slate-700"
          disabled={disabled || files.length >= GANTI_LIBUR_MAX_ATTACHMENTS}
          onClick={() => fileInputRef.current?.click()}
        >
          <Paperclip className="h-5 w-5" />
          {files.length === 0 ? 'Unggah Surat Resmi' : 'Tambah Berkas Lagi'}
        </Button>
      )}
      {files.length > 0 && (
        <ul className="space-y-2">
          {files.map((item) => {
            const isPdf = item.attachment
              ? isPdfAttachment(item.attachment)
              : gantiLiburAttachmentContentType(item.name, '') === 'application/pdf';
            const Icon = isPdf ? FileText : ImageIcon;
            return (
              <li
                key={item.key}
                className="flex items-center gap-3 rounded-xl border border-slate-200 bg-slate-50 p-3"
              >
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-slate-200 bg-white">
                  <Icon className="h-5 w-5 text-emerald-600" />
                </div>
                <div className="min-w-0 flex-1">
                  {item.attachment ? (
                    <a
                      href={item.attachment.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="block truncate text-sm font-bold text-slate-800 hover:underline"
                    >
                      {item.name}
                    </a>
                  ) : (
                    <p className="truncate text-sm font-bold text-slate-800">{item.name}</p>
                  )}
                  <p
                    className={`text-xs ${
                      item.status === 'error' ? 'font-semibold text-rose-600' : 'text-slate-500'
                    }`}
                  >
                    {item.status === 'uploading'
                      ? 'Mengunggah…'
                      : item.status === 'error'
                        ? item.error
                        : formatAttachmentSize(item.size)}
                  </p>
                </div>
                {item.status === 'uploading' ? (
                  <Loader2 className="h-4 w-4 shrink-0 animate-spin text-emerald-600" />
                ) : (
                  !locked && (
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="h-9 w-9 shrink-0 rounded-full text-slate-500"
                      aria-label={`Hapus ${item.name}`}
                      disabled={disabled}
                      onClick={() => removeFile(item.key)}
                    >
                      <X className="h-4 w-4" />
                    </Button>
                  )
                )}
              </li>
            );
          })}
        </ul>
      )}
      {!locked && uploading && (
        <p className="text-sm font-semibold text-slate-600">
          Tunggu unggahan berkas selesai sebelum mengirim.
        </p>
      )}
      {!locked && failed && (
        <p className="text-sm font-semibold text-amber-700">
          Hapus berkas yang gagal diunggah, lalu unggah ulang jika perlu.
        </p>
      )}
    </div>
  );
}
