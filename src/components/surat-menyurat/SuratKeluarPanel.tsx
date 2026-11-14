"use client";

import React, { useState, useMemo } from 'react';
import { SuratKeluar } from '@/lib/surat-menyurat/types';
import { formatLetterDate } from '@/lib/surat-menyurat/date';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import SuratRowActions from './SuratRowActions';
import { Paperclip, Send } from 'lucide-react';

interface Props {
  data: SuratKeluar[];
  searchQuery: string;
  sifatFilter: string;
  onOpenEdit: (surat: SuratKeluar) => void;
  onOpenDetail: (surat: SuratKeluar) => void;
  onDelete: (id: string) => Promise<void>;
}

export default function SuratKeluarPanel({
  data,
  searchQuery,
  sifatFilter,
  onOpenEdit,
  onOpenDetail,
  onDelete,
}: Props) {
  const [deleteTarget, setDeleteTarget] = useState<SuratKeluar | null>(null);
  const [deleting, setDeleting] = useState(false);

  const filtered = useMemo(() => {
    return data.filter((item) => {
      if (sifatFilter !== 'all' && item.sifat !== sifatFilter) return false;

      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        const text = [
          item.nomorSurat,
          item.tujuan,
          item.perihal,
          item.ringkasan,
          item.kategori,
          item.penandatanganNama,
          item.penandatanganJabatan,
        ]
          .filter(Boolean)
          .join(' ')
          .toLowerCase();

        if (!text.includes(q)) return false;
      }
      return true;
    });
  }, [data, searchQuery, sifatFilter]);

  const confirmDelete = async () => {
    if (!deleteTarget) return;
    try {
      setDeleting(true);
      await onDelete(deleteTarget.id);
      setDeleteTarget(null);
    } finally {
      setDeleting(false);
    }
  };

  if (filtered.length === 0) {
    return (
      <div className="p-20 flex flex-col items-center justify-center text-slate-400">
        <Send className="w-12 h-12 mb-4 opacity-20" />
        <span className="text-sm font-medium">Tidak ada surat keluar yang sesuai filter atau pencarian.</span>
      </div>
    );
  }

  return (
    <div>
      <Table className="table-fixed">
        <TableHeader className="bg-slate-50/50">
          <TableRow className="border-slate-100">
            <TableHead className="w-[25%] font-medium text-slate-500 pl-8">Nomor & Tanggal</TableHead>
            <TableHead className="w-[27%] font-medium text-slate-500">Tujuan</TableHead>
            <TableHead className="w-[32%] font-medium text-slate-500">Perihal</TableHead>
            <TableHead className="w-[16%] font-medium text-slate-500 text-right pr-6">Aksi</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {/* Existing Rows */}
          {filtered.map((item) => {
            return (
              <TableRow key={item.id} className="border-slate-100 transition-colors hover:bg-slate-50/50">
                {/* Nomor & Tanggal */}
                <TableCell className="py-4 pl-8 align-top whitespace-normal">
                  <button
                    type="button"
                    onClick={() => onOpenDetail(item)}
                    title="Lihat surat"
                    className="block w-full text-left text-xs font-bold text-slate-900 break-words line-clamp-2 hover:text-indigo-700 hover:underline cursor-pointer"
                  >
                    {item.nomorSurat}
                  </button>
                  <span className="mt-1 block font-mono text-[11px] text-slate-400">
                    No. {item.nomorUrut || '-'} · {formatLetterDate(item.tanggalSurat)}
                  </span>
                </TableCell>

                {/* Tujuan */}
                <TableCell className="py-4 align-top whitespace-normal">
                  <span className="block text-xs font-semibold text-slate-800 break-words line-clamp-2" title={item.tujuan}>
                    {item.tujuan}
                  </span>
                </TableCell>

                {/* Perihal */}
                <TableCell className="py-4 align-top whitespace-normal">
                  <span className="block text-xs font-medium text-slate-800 break-words line-clamp-2" title={item.perihal}>
                    {item.perihal}
                  </span>
                  <span className="mt-0.5 flex items-center gap-2 text-[11px] text-slate-400">
                    <span className="truncate">{item.kategori || 'Umum'}</span>
                    {item.attachments && item.attachments.length > 0 && (
                      <span
                        className="inline-flex shrink-0 items-center gap-0.5 text-slate-500"
                        title={`${item.attachments.length} berkas terlampir`}
                      >
                        <Paperclip className="size-3" />
                        {item.attachments.length}
                      </span>
                    )}
                  </span>
                </TableCell>

                {/* Aksi */}
                <TableCell className="py-4 pr-6 align-top whitespace-normal">
                  <div className="flex flex-wrap items-center justify-end gap-1.5">
                    <SuratRowActions
                      onDetail={() => onOpenDetail(item)}
                      onEdit={() => onOpenEdit(item)}
                      onDelete={() => setDeleteTarget(item)}
                    />
                  </div>
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>

      {/* Delete Confirmation Dialog */}
      <ConfirmDialog
        open={!!deleteTarget}
        onOpenChange={(isOpen) => !isOpen && setDeleteTarget(null)}
        title="Hapus Surat Keluar"
        description={`Apakah Anda yakin ingin menghapus surat keluar nomor "${deleteTarget?.nomorSurat}"? Tindakan ini tidak dapat dibatalkan.`}
        confirmLabel="Ya, Hapus"
        cancelLabel="Batal"
        destructive
        loading={deleting}
        onConfirm={confirmDelete}
      />
    </div>
  );
}
