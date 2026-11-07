"use client";

import React, { useState, useMemo } from 'react';
import { SuratKeluar } from '@/lib/surat-menyurat/types';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import SuratKeluarInlineForm from './SuratKeluarInlineForm';
import {
  Calendar,
  Eye,
  Paperclip,
  Pencil,
  Send,
  Trash2,
} from 'lucide-react';

interface Props {
  data: SuratKeluar[];
  searchQuery: string;
  statusFilter: string;
  sifatFilter: string;
  isAdding?: boolean;
  editingItem?: SuratKeluar | null;
  defaultSatkerName?: string;
  defaultKepalaName?: string;
  nextSequence: number;
  targetSatkerId?: string;
  onCancelForm?: () => void;
  onSaveSuccess?: (data: SuratKeluar) => void;
  onOpenEdit: (surat: SuratKeluar) => void;
  onOpenDetail: (surat: SuratKeluar) => void;
  onDelete: (id: string) => Promise<void>;
}

export default function SuratKeluarPanel({
  data,
  searchQuery,
  statusFilter,
  sifatFilter,
  isAdding = false,
  editingItem = null,
  defaultSatkerName = 'Satuan Kerja',
  defaultKepalaName = '',
  nextSequence,
  targetSatkerId,
  onCancelForm,
  onSaveSuccess,
  onOpenEdit,
  onOpenDetail,
  onDelete,
}: Props) {
  const [deleteTarget, setDeleteTarget] = useState<SuratKeluar | null>(null);
  const [deleting, setDeleting] = useState(false);

  const filtered = useMemo(() => {
    return data.filter((item) => {
      if (statusFilter !== 'all' && item.status !== statusFilter) return false;
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
  }, [data, searchQuery, statusFilter, sifatFilter]);

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

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'draft':
        return (
          <Badge variant="outline" className="rounded-sm border-slate-200 bg-slate-100 text-slate-700">
            Draft
          </Badge>
        );
      case 'disetujui':
        return (
          <Badge variant="outline" className="rounded-sm border-indigo-200 bg-indigo-50 text-indigo-700">
            Disetujui
          </Badge>
        );
      case 'terkirim':
        return (
          <Badge variant="outline" className="rounded-sm border-emerald-200 bg-emerald-50 text-emerald-700">
            Terkirim
          </Badge>
        );
      case 'diarsipkan':
      default:
        return (
          <Badge variant="outline" className="rounded-sm border-slate-200 bg-slate-100 text-slate-700">
            Diarsipkan
          </Badge>
        );
    }
  };

  const getSifatBadge = (sifat: string) => {
    switch (sifat) {
      case 'segera':
        return (
          <Badge variant="outline" className="rounded-sm border-rose-200 bg-rose-50 text-rose-700">
            Segera
          </Badge>
        );
      case 'penting':
        return (
          <Badge variant="outline" className="rounded-sm border-amber-200 bg-amber-50 text-amber-700">
            Penting
          </Badge>
        );
      case 'rahasia':
        return (
          <Badge variant="outline" className="rounded-sm border-purple-200 bg-purple-50 text-purple-700">
            Rahasia
          </Badge>
        );
      case 'biasa':
      default:
        return (
          <Badge variant="outline" className="rounded-sm border-slate-200 bg-slate-100 text-slate-700">
            Biasa
          </Badge>
        );
    }
  };

  // If there's no data and not adding or editing, show standard empty placeholder
  if (filtered.length === 0 && !isAdding && !editingItem) {
    return (
      <div className="p-20 flex flex-col items-center justify-center text-slate-400">
        <Send className="w-12 h-12 mb-4 opacity-20" />
        <span className="text-sm font-medium">Tidak ada surat keluar yang sesuai filter atau pencarian.</span>
      </div>
    );
  }

  return (
    <div>
      <Table>
        <TableHeader className="bg-slate-50/50">
          <TableRow className="border-slate-100">
            <TableHead className="font-medium text-slate-500 pl-8">Nomor & Tanggal</TableHead>
            <TableHead className="font-medium text-slate-500">Tujuan / Penerima</TableHead>
            <TableHead className="font-medium text-slate-500">Perihal & Kategori</TableHead>
            <TableHead className="font-medium text-slate-500">Penandatangan</TableHead>
            <TableHead className="font-medium text-slate-500">Sifat & Status</TableHead>
            <TableHead className="font-medium text-slate-500 text-center">Berkas</TableHead>
            <TableHead className="font-medium text-slate-500 text-right pr-8">Aksi</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {/* Inline Form Row when Adding New Surat Keluar */}
          {isAdding && (
            <TableRow className="border-b-2 border-indigo-100 bg-slate-50/70 hover:bg-slate-50/70">
              <TableCell colSpan={7} className="p-6 pl-8 pr-8">
                <SuratKeluarInlineForm
                  suratToEdit={null}
                  defaultSatkerName={defaultSatkerName}
                  defaultKepalaName={defaultKepalaName}
                  nextSequence={nextSequence}
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
              <TableCell colSpan={7} className="text-center py-8 text-slate-400 text-xs font-medium">
                Belum ada data surat keluar lain yang tercatat.
              </TableCell>
            </TableRow>
          )}

          {/* Existing Rows */}
          {filtered.map((item) => {
            const isRowEditing = editingItem?.id === item.id;

            if (isRowEditing) {
              return (
                <TableRow key={item.id} className="border-b-2 border-indigo-100 bg-slate-50/70 hover:bg-slate-50/70">
                  <TableCell colSpan={7} className="p-6 pl-8 pr-8">
                    <SuratKeluarInlineForm
                      suratToEdit={editingItem}
                      defaultSatkerName={defaultSatkerName}
                      defaultKepalaName={defaultKepalaName}
                      nextSequence={nextSequence}
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
                <TableCell className="font-medium pl-8 py-4 align-top">
                  <span className="font-bold text-slate-800 block text-xs truncate max-w-[170px]" title={item.nomorSurat}>
                    {item.nomorSurat}
                  </span>
                  <div className="flex items-center gap-1 text-[11px] text-slate-400 mt-1">
                    <Calendar className="w-3 h-3 text-slate-400" />
                    <span>{item.tanggalSurat}</span>
                  </div>
                </TableCell>

                {/* Tujuan */}
                <TableCell className="py-4 align-top">
                  <span className="font-semibold text-xs text-slate-800 block truncate max-w-[190px]" title={item.tujuan}>
                    {item.tujuan}
                  </span>
                </TableCell>

                {/* Perihal & Kategori */}
                <TableCell className="py-4 align-top">
                  <span className="font-medium text-xs text-slate-800 block line-clamp-2 max-w-[240px]" title={item.perihal}>
                    {item.perihal}
                  </span>
                  <Badge variant="outline" className="rounded-sm border-slate-200 bg-slate-100 text-slate-600 text-[10px] mt-1">
                    {item.kategori || 'Umum'}
                  </Badge>
                </TableCell>

                {/* Penandatangan */}
                <TableCell className="py-4 align-top">
                  <span className="font-medium text-xs text-slate-700 block truncate max-w-[160px]" title={item.penandatanganNama}>
                    {item.penandatanganNama || '—'}
                  </span>
                  <span className="text-[10px] text-slate-400 block truncate max-w-[160px] mt-0.5" title={item.penandatanganJabatan}>
                    {item.penandatanganJabatan}
                  </span>
                </TableCell>

                {/* Sifat & Status */}
                <TableCell className="py-4 align-top">
                  <div className="flex flex-col gap-1 items-start">
                    {getSifatBadge(item.sifat)}
                    {getStatusBadge(item.status)}
                  </div>
                </TableCell>

                {/* Berkas Lampiran */}
                <TableCell className="py-4 align-top text-center">
                  {item.attachments && item.attachments.length > 0 ? (
                    <span
                      className="inline-flex items-center gap-1 text-[11px] font-semibold text-slate-600 bg-slate-100 px-2 py-0.5 rounded-sm border border-slate-200"
                      title={`${item.attachments.length} berkas terlampir`}
                    >
                      <Paperclip className="w-3 h-3 text-slate-400" />
                      {item.attachments.length}
                    </span>
                  ) : (
                    <span className="text-slate-300 text-[11px]">—</span>
                  )}
                </TableCell>

                {/* Actions */}
                <TableCell className="text-right pr-8 py-4 align-top">
                  <div className="flex items-center justify-end gap-1.5">
                    {/* Detail */}
                    <button
                      type="button"
                      onClick={() => onOpenDetail(item)}
                      title="Lihat Detail Surat"
                      className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-sm text-xs font-semibold bg-white text-slate-700 border border-slate-200 hover:bg-slate-50 hover:shadow-xs transition-all duration-150 shadow-xs cursor-pointer"
                    >
                      <Eye className="w-3 h-3 text-slate-500" />
                      Detail
                    </button>

                    {/* Edit */}
                    <button
                      type="button"
                      onClick={() => onOpenEdit(item)}
                      title="Edit Data Surat"
                      className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-sm text-xs font-semibold bg-amber-50 text-amber-600 border border-amber-200 hover:bg-amber-100 hover:border-amber-300 hover:shadow-xs transition-all duration-150 cursor-pointer shadow-xs"
                    >
                      <Pencil className="w-3 h-3" />
                      Edit
                    </button>

                    {/* Delete */}
                    <button
                      type="button"
                      onClick={() => setDeleteTarget(item)}
                      title="Hapus Surat"
                      className="inline-flex items-center justify-center p-1.5 rounded-sm text-xs font-semibold bg-rose-50 text-rose-600 border border-rose-200 hover:bg-rose-100 hover:border-rose-300 hover:shadow-xs transition-all duration-150 cursor-pointer shadow-xs"
                    >
                      <Trash2 className="w-3 h-3" />
                    </button>
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
