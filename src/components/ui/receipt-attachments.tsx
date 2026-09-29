"use client"

import * as React from "react"
import { Loader2, Paperclip, Plus, Trash2 } from "lucide-react"

import { Button } from "@/components/ui/button"

interface ReceiptAttachmentsProps {
  /** One entry per uploaded proof; only the count and order matter here. */
  urls: readonly string[]
  /** Singular noun for the rows, e.g. "Bukti BBM". Numbered when several. */
  label: string
  uploading?: boolean
  onUploadClick: () => void
  onView: (index: number) => void
  onRemove: (index: number) => void
}

/**
 * Uploaded proofs as quiet rows (name, "Lihat", a red remove icon) with an
 * obvious upload button. The hidden file input stays with the page, which owns
 * the upload handler; this only draws the list and reports clicks.
 */
function ReceiptAttachments({
  urls,
  label,
  uploading,
  onUploadClick,
  onView,
  onRemove,
}: ReceiptAttachmentsProps) {
  return (
    <div className="space-y-2">
      {urls.length > 0 ? (
        <ul className="divide-y divide-slate-100 rounded-lg border border-slate-200">
          {urls.map((url, index) => {
            const name = urls.length > 1 ? `${label} ${index + 1}` : label
            return (
              <li key={`${url}-${index}`} className="flex items-center gap-2 px-3 py-2 text-sm">
                <Paperclip className="size-4 shrink-0 text-slate-400" />
                <span className="min-w-0 flex-1 truncate text-slate-700">{name}</span>
                <Button type="button" variant="ghost" size="sm" onClick={() => onView(index)}>
                  Lihat
                </Button>
                <Button
                  type="button"
                  variant="danger-ghost"
                  size="icon-sm"
                  onClick={() => onRemove(index)}
                  aria-label={`Hapus ${name}`}
                  title={`Hapus ${name}`}
                >
                  <Trash2 />
                </Button>
              </li>
            )
          })}
        </ul>
      ) : null}
      <Button
        type="button"
        variant="outline"
        size="lg"
        onClick={onUploadClick}
        disabled={uploading}
        className="w-full border-dashed"
      >
        {uploading ? <Loader2 className="animate-spin" /> : <Plus />}
        {uploading ? "Mengunggah…" : urls.length > 0 ? "Tambah bukti" : "Unggah bukti"}
      </Button>
    </div>
  )
}

export { ReceiptAttachments }
