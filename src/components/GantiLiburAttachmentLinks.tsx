import { FileText, Image as ImageIcon } from 'lucide-react';
import {
  formatAttachmentSize,
  isPdfAttachment,
  type GantiLiburAttachment,
} from '@/lib/payroll/gantiLiburAttachments';

/** The surat resmi files of a ganti libur request, each opening in a new tab. */
export function GantiLiburAttachmentLinks({
  attachments,
  className = '',
}: {
  attachments: readonly GantiLiburAttachment[] | undefined;
  className?: string;
}) {
  if (!attachments || attachments.length === 0) return null;
  return (
    <ul className={`flex flex-wrap gap-2 ${className}`}>
      {attachments.map((attachment) => {
        const Icon = isPdfAttachment(attachment) ? FileText : ImageIcon;
        return (
          <li key={attachment.path} className="min-w-0 max-w-full">
            <a
              href={attachment.url}
              target="_blank"
              rel="noopener noreferrer"
              title={`${attachment.name} · ${formatAttachmentSize(attachment.size)}`}
              className="inline-flex max-w-full items-center gap-1.5 rounded-full border border-slate-200 bg-white px-2.5 py-1 text-xs font-semibold text-sky-700 hover:bg-sky-50"
            >
              <Icon className="h-3.5 w-3.5 shrink-0" />
              <span className="truncate">{attachment.name}</span>
            </a>
          </li>
        );
      })}
    </ul>
  );
}
