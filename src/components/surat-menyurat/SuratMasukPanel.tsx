"use client";

import React, { useState, useMemo } from 'react';
import { SuratMasuk } from '@/lib/surat-menyurat/types';
import { formatLetterDate } from '@/lib/surat-menyurat/date';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import SuratMasukInlineForm from './SuratMasukInlineForm';
import SuratRowActions from './SuratRowActions';
import { Inbox, Paperclip } from 'lucide-react';

const COLUMN_COUNT = 4;

interface Props {
  data: SuratMasuk[];
  searchQuery: string;
  sifatFilter: string;
  isAdding?: boolean;
  editingItem?: SuratMasuk | null;
  defaultSatkerName?: string;
  targetSatkerId?: string;
  onCancelForm?: () => void;
  onSaveSuccess?: (data: SuratMasuk) => void;
  onOpenEdit: (surat: SuratMasuk) => void;
  onOpenDetail: (surat: SuratMasuk) => void;
  onDelete: (id: string) => Promise<void>;
}

export default function SuratMasukPanel({
  data,
  searchQuery,
  sifatFilter,
  isAdding = false,
  editingItem = null,
  defaultSatkerName = 'Satuan Kerja',
  targetSatkerId,
  onCancelForm,
  onSaveSuccess,
  onOpenEdit,
  onOpenDetail,
  onDelete,
}: Props) {
  const [deleteTarget, setDeleteTarget] = useState<SuratMasuk | null>(null);
  const [deleting, setDeleting] = useState(false);

  const filtered = useMemo(() => {
    return data.filter((item) => {
      if (sifatFilter !== 'all' && item.sifat !== sifatFilter) return false;

      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        const text = [
          item.nomorSurat,
          item.pengirim,
          item.penerima,
          item.perihal,
          item.ringkasan,
          item.kategori,
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

  // If there's no data and not adding or editing, show standard empty placeholder
  if (filtered.length === 0 && !isAdding && !editingItem) {
    return (
      <div className="p-20 flex flex-col items-center justify-center text-slate-400">
        <Inbox className="w-12 h-12 mb-4 opacity-20" />
        <span className="text-sm font-medium">Tidak ada surat masuk yang sesuai filter atau pencarian.</span>
      </div>
    );
  }

  return (
    <div>
      <Table className="table-fixed">
        <TableHeader className="bg-slate-50/50">
          <TableRow className="border-slate-100">
            <TableHead className="w-[26%] font-medium text-slate-500 pl-8">Nomor & Tanggal</TableHead>
            <TableHead className="w-[26%] font-medium text-slate-500">Pengirim</TableHead>
            <TableHead className="w-[32%] font-medium text-slate-500">Perihal</TableHead>
            <TableHead className="w-[16%] font-medium text-slate-500 text-right pr-6">Aksi</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {/* Inline Form Row when Adding New Surat Masuk */}
          {isAdding && (
            <TableRow className="border-b-2 border-indigo-100 bg-slate-50/70 hover:bg-slate-50/70">
              <TableCell colSpan={COLUMN_COUNT} className="p-6 pl-8 pr-8">
                <SuratMasukInlineForm
                  suratToEdit={null}
                  defaultSatkerName={defaultSatkerName}
                  targetSatkerId={targetSatkerId}
                  onCancel={() => onCancelForm?.()}
                  onSuccess={(data) => onSaveSuccess?.(data)}
                />
              </TableCell>
            </TableRow>
          )}

          {/* If there are no existing rows but we're adding, show a subtle note row */}
          {filtered.length === 0 && isAdding && (
            <TableRow>
              <TableCell colSpan={COLUMN_COUNT} className="text-center py-8 text-slate-400 text-xs font-medium">
                Belum ada data surat masuk lain yang tercatat.
              </TableCell>
            </TableRow>
          )}

          {/* Existing Rows */}
          {filtered.map((item) => {
            const isRowEditing = editingItem?.id === item.id;

            if (isRowEditing) {
              return (
                <TableRow key={item.id} className="border-b-2 border-indigo-100 bg-slate-50/70 hover:bg-slate-50/70">
                  <TableCell colSpan={COLUMN_COUNT} className="p-6 pl-8 pr-8">
                    <SuratMasukInlineForm
                      suratToEdit={editingItem}
                      defaultSatkerName={defaultSatkerName}
                      targetSatkerId={targetSatkerId}
                      onCancel={() => onCancelForm?.()}
                      onSuccess={(data) => onSaveSuccess?.(data)}
                    />
                  </TableCell>
                </TableRow>
              );
            }

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

                {/* Pengirim */}
                <TableCell className="py-4 align-top whitespace-normal">
                  <span className="block text-xs font-semibold text-slate-800 break-words line-clamp-2" title={item.pengirim}>
                    {item.pengirim}
                  </span>
                  <span className="mt-0.5 block truncate text-[11px] text-slate-400" title={item.penerima}>
                    Yth. {item.penerima}
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
        title="Hapus Surat Masuk"
        description={`Apakah Anda yakin ingin menghapus surat masuk nomor "${deleteTarget?.nomorSurat}"? Tindakan ini tidak dapat dibatalkan.`}
        confirmLabel="Ya, Hapus"
        cancelLabel="Batal"
        destructive
        loading={deleting}
        onConfirm={confirmDelete}
      />
    </div>
  );
}
