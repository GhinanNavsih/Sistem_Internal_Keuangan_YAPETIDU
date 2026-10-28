"use client";

import { useEffect, useState } from 'react';
import Image from 'next/image';
import type { User } from 'firebase/auth';
import { Loader2 } from 'lucide-react';
import { uploadFileTypeFor } from '@/lib/uploadFileTypes';

/** A journal's receipts, loaded when its row is expanded. Each object URL is released when the row collapses. */
export default function EntryReceipts({ user, unitId, academicYear, entryId, count }: { user: User; unitId: string; academicYear: string; entryId: string; count: number }) {
  const [receipts, setReceipts] = useState<{ url: string; mime: string; inlinePreview: boolean; extension: string }[]>([]);
  const [failed, setFailed] = useState(false);
  const [enlarged, setEnlarged] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    let urls: string[] = [];
    Promise.all(Array.from({ length: count }, async (_, index) => {
      const params = new URLSearchParams({ unitId, academicYear, entryId, index: String(index) });
      const response = await fetch(`/api/satker-finance/receipt?${params}`, { headers: { Authorization: `Bearer ${await user.getIdToken()}` } });
      if (!response.ok) throw new Error('Bukti tidak dapat dibuka.');
      return response.blob();
    }))
      .then((blobs) => {
        if (cancelled) return;
        urls = blobs.map((blob) => URL.createObjectURL(blob));
        setReceipts(blobs.map((blob, index) => {
          const type = uploadFileTypeFor(blob.type);
          return { url: urls[index], mime: type?.mime ?? blob.type, inlinePreview: !!type?.inlinePreview, extension: type?.extension ?? '' };
        }));
      })
      .catch(() => { if (!cancelled) setFailed(true); });
    return () => {
      cancelled = true;
      urls.forEach((url) => URL.revokeObjectURL(url));
    };
  }, [user, unitId, academicYear, entryId, count]);

  if (failed) return <p className="text-sm text-red-700">Bukti tidak dapat dibuka.</p>;
  if (!receipts.length) return <div className="flex items-center gap-2 text-sm text-slate-500"><Loader2 className="h-4 w-4 animate-spin" /> Memuat bukti…</div>;
  return <div className="flex flex-wrap gap-4 pt-1">{receipts.map((receipt, index) => <figure key={receipt.url} className="space-y-1.5 text-sm text-slate-600">
    {receipt.mime === 'application/pdf'
      ? <iframe title={`Bukti ${index + 1}`} src={receipt.url} className="h-[28rem] w-[min(100%,36rem)] rounded-md border border-slate-200 bg-white" />
      : receipt.inlinePreview
        ? <button type="button" aria-label={`Perbesar bukti ${index + 1}`} className="block" onClick={() => setEnlarged(receipt.url)}><Image src={receipt.url} alt={`Bukti ${index + 1}`} width={480} height={360} unoptimized className="h-auto max-h-80 w-auto max-w-full rounded-md border border-slate-200 bg-white object-contain" /></button>
        : <a className="text-accent-700 hover:underline" href={receipt.url} download={`bukti-${index + 1}.${receipt.extension}`}>Unduh bukti {index + 1}</a>}
    <figcaption>Bukti {index + 1}</figcaption>
  </figure>)}{enlarged && <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/80 p-4" onClick={() => setEnlarged(null)}>
    <button type="button" className="absolute right-5 top-5 rounded-md bg-white px-3 py-2 text-sm font-semibold" onClick={() => setEnlarged(null)}>Tutup</button>
    <Image src={enlarged} alt="Bukti transaksi" width={1000} height={1000} unoptimized className="max-h-[90vh] max-w-full object-contain" onClick={(event) => event.stopPropagation()} />
  </div>}</div>;
}
