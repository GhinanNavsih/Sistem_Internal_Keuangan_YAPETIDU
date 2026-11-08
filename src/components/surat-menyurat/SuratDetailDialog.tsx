"use client";

import React from 'react';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { SuratMasuk, SuratKeluar } from '@/lib/surat-menyurat/types';
import { SIFAT_SURAT_OPTIONS, STATUS_SURAT_MASUK_OPTIONS, STATUS_SURAT_KELUAR_OPTIONS } from '@/lib/surat-menyurat/constants';
import { calculateUsiaArsip, formatKodeArsip } from '@/lib/surat-menyurat/numbering';
import { FileText, Download, Calendar, User, Building, FileCheck, ArrowUpRight, ArrowDownLeft, Paperclip, Printer, Clock } from 'lucide-react';

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  surat: SuratMasuk | SuratKeluar | null;
  type: 'masuk' | 'keluar';
  onOpenDisposisi?: (surat: SuratMasuk) => void;
}

export default function SuratDetailDialog({
  open,
  onOpenChange,
  surat,
  type,
  onOpenDisposisi,
}: Props) {
  if (!surat) return null;

  const isMasuk = type === 'masuk';
  const masuk = isMasuk ? (surat as SuratMasuk) : null;
  const keluar = !isMasuk ? (surat as SuratKeluar) : null;

  const sifatOpt = SIFAT_SURAT_OPTIONS.find((s) => s.value === surat.sifat) || SIFAT_SURAT_OPTIONS[0];
  const statusOpt = isMasuk
    ? STATUS_SURAT_MASUK_OPTIONS.find((st) => st.value === surat.status)
    : STATUS_SURAT_KELUAR_OPTIONS.find((st) => st.value === surat.status);
  const statusTone = statusOpt?.tone || 'bg-slate-100 text-slate-700';

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl max-w-2xl bg-white rounded-md p-6 border border-slate-100 shadow-[0_20px_50px_rgba(0,0,0,0.1)] max-h-[90vh] overflow-y-auto">
        <DialogHeader className="space-y-1">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              {isMasuk ? (
                <div className="p-1.5 rounded-sm bg-sky-50 text-sky-600 border border-sky-100">
                  <ArrowDownLeft className="w-4 h-4" />
                </div>
              ) : (
                <div className="p-1.5 rounded-sm bg-indigo-50 text-indigo-600 border border-indigo-100">
                  <ArrowUpRight className="w-4 h-4" />
                </div>
              )}
              <DialogTitle className="text-xl font-bold tracking-tight text-slate-900">
                Detail {isMasuk ? 'Surat Masuk' : 'Surat Keluar'}
              </DialogTitle>
            </div>
            <div className="flex items-center gap-2">
              <Badge variant="outline" className={`rounded-sm text-[11px] font-semibold py-0.5 border ${sifatOpt.tone}`}>
                {sifatOpt.label}
              </Badge>
              <Badge variant="outline" className={`rounded-sm text-[11px] font-semibold py-0.5 border ${statusTone}`}>
                {statusOpt?.label || surat.status}
              </Badge>
            </div>
          </div>
          <DialogDescription className="text-xs text-slate-500">
            {surat.satkerName} · Didaftarkan oleh {surat.createdByName}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 my-2">
          {/* Header Info Card */}
          <div className="bg-slate-50 rounded-md p-4 border border-slate-200 space-y-2.5 text-xs">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <span className="text-slate-400 block text-[11px] font-medium">Nomor Surat</span>
                <span className="font-bold text-slate-800 text-sm font-mono">{surat.nomorSurat}</span>
                {surat.nomorUrut && (
                  <span className="text-[10px] text-slate-500 font-mono block mt-0.5">
                    No. Urut Agenda: {surat.nomorUrut}
                  </span>
                )}
              </div>
              <div>
                <span className="text-slate-400 block text-[11px] font-medium">Kode Arsip & Usia</span>
                <span className="font-semibold text-indigo-700 font-mono block">
                  {surat.kodeArsip || formatKodeArsip({
                    type,
                    institutionScope: surat.institutionScope || 'UNIPDU',
                    sequenceNumber: surat.nomorUrut || 1,
                  })}
                </span>
                <span className="text-[10px] text-slate-500 flex items-center gap-1 mt-0.5">
                  <Clock className="w-2.5 h-2.5 text-slate-400" />
                  {calculateUsiaArsip(surat.tanggalSurat)}
                </span>
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-1 border-t border-slate-200">
              <div>
                <span className="text-slate-400 block text-[11px] font-medium">
                  {isMasuk ? 'Pengirim' : 'Tujuan / Penerima'}
                </span>
                <span className="font-semibold text-slate-800">
                  {isMasuk ? masuk?.pengirim : keluar?.tujuan}
                </span>
              </div>
              <div>
                <span className="text-slate-400 block text-[11px] font-medium">
                  {isMasuk ? 'Ditujukan Kepada' : 'Penandatangan'}
                </span>
                <span className="font-semibold text-slate-800">
                  {isMasuk
                    ? masuk?.penerima
                    : `${keluar?.penandatanganNama || '-'} (${keluar?.penandatanganJabatan || '-'})`}
                </span>
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-1 border-t border-slate-200">
              <div className="flex items-center gap-1.5 text-slate-600">
                <Calendar className="w-3.5 h-3.5 text-slate-400" />
                <span>Tanggal Surat: <strong className="text-slate-700">{surat.tanggalSurat}</strong></span>
              </div>
              {isMasuk && masuk?.tanggalDiterima && (
                <div className="flex items-center gap-1.5 text-slate-600">
                  <Calendar className="w-3.5 h-3.5 text-slate-400" />
                  <span>Diterima: <strong className="text-slate-700">{masuk.tanggalDiterima}</strong></span>
                </div>
              )}
            </div>
          </div>

          {/* Perihal & Ringkasan */}
          <div className="space-y-1.5">
            <span className="text-xs font-semibold text-slate-700">Perihal Surat</span>
            <div className="p-3 bg-white border border-slate-200 rounded-sm text-xs font-medium text-slate-800">
              {surat.perihal}
            </div>
          </div>

          {surat.ringkasan && (
            <div className="space-y-1.5">
              <span className="text-xs font-semibold text-slate-700">Ringkasan / Isi Pokok</span>
              <div className="p-3 bg-white border border-slate-200 rounded-sm text-xs text-slate-600 leading-relaxed whitespace-pre-wrap">
                {surat.ringkasan}
              </div>
            </div>
          )}

          {/* Surat Masuk: Disposisi Section */}
          {isMasuk && (
            <div className="space-y-2 pt-1">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold text-slate-700 flex items-center gap-1.5">
                  <FileCheck className="w-4 h-4 text-indigo-600" />
                  Disposisi Kepala SatKer
                </span>
                {onOpenDisposisi && masuk && (
                  <button
                    type="button"
                    onClick={() => {
                      onOpenChange(false);
                      onOpenDisposisi(masuk);
                    }}
                    className="inline-flex items-center gap-1 px-3 py-1.5 rounded-sm text-xs font-semibold bg-indigo-50 text-indigo-600 border border-indigo-200 hover:bg-indigo-100 transition-all cursor-pointer shadow-sm"
                  >
                    {masuk.disposisi ? 'Edit Disposisi' : '+ Beri Disposisi'}
                  </button>
                )}
              </div>

              {masuk?.disposisi ? (
                <div className="bg-indigo-50/60 border border-indigo-100 rounded-md p-3.5 text-xs space-y-2">
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                    <div>
                      <span className="text-indigo-500 font-medium text-[11px] block">Instruksi</span>
                      <strong className="text-slate-800 text-xs">{masuk.disposisi.instruksi}</strong>
                    </div>
                    <div>
                      <span className="text-indigo-500 font-medium text-[11px] block">Diteruskan Kepada</span>
                      <strong className="text-slate-800 text-xs">{masuk.disposisi.diteruskanKepada}</strong>
                    </div>
                  </div>
                  {masuk.disposisi.catatan && (
                    <div className="pt-1.5 border-t border-indigo-100/80">
                      <span className="text-indigo-500 font-medium text-[11px] block">Catatan Disposisi</span>
                      <p className="text-slate-700 text-xs mt-0.5">{masuk.disposisi.catatan}</p>
                    </div>
                  )}
                  <div className="text-[10px] text-indigo-400 pt-1 flex justify-between">
                    <span>Oleh: {masuk.disposisi.disposisiOleh || 'Kepala SatKer'}</span>
                    <span>Tgl: {masuk.disposisi.tanggalDisposisi}</span>
                  </div>
                </div>
              ) : (
                <div className="p-3 bg-amber-50/70 border border-amber-200/80 rounded-sm text-xs text-amber-800 flex items-center justify-between">
                  <span>Surat ini belum memiliki disposisi dari Kepala SatKer.</span>
                  {onOpenDisposisi && masuk && (
                    <button
                      type="button"
                      onClick={() => {
                        onOpenChange(false);
                        onOpenDisposisi(masuk);
                      }}
                      className="inline-flex items-center gap-1 px-3 py-1.5 rounded-sm text-xs font-semibold bg-amber-600 hover:bg-amber-700 text-white shadow-sm cursor-pointer"
                    >
                      Beri Disposisi
                    </button>
                  )}
                </div>
              )}
            </div>
          )}

          {/* Lampiran / Berkas */}
          <div className="space-y-2 pt-1">
            <span className="text-xs font-semibold text-slate-700 flex items-center gap-1.5">
              <Paperclip className="w-3.5 h-3.5 text-slate-500" />
              Berkas Lampiran ({surat.attachments?.length || 0})
            </span>

            {surat.attachments && surat.attachments.length > 0 ? (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                {surat.attachments.map((file, idx) => (
                  <a
                    key={file.id || idx}
                    href={file.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center justify-between p-2.5 rounded-sm border border-slate-200 bg-white hover:border-indigo-300 hover:bg-slate-50 transition-all text-xs group shadow-sm"
                  >
                    <div className="flex items-center gap-2 truncate max-w-[200px]">
                      <FileText className="w-4 h-4 text-indigo-500 shrink-0" />
                      <span className="truncate font-medium text-slate-700 group-hover:text-indigo-600">
                        {file.name}
                      </span>
                    </div>
                    <Download className="w-3.5 h-3.5 text-slate-400 group-hover:text-indigo-600 shrink-0" />
                  </a>
                ))}
              </div>
            ) : (
              <p className="text-xs text-slate-400 italic">Tidak ada berkas yang dilampirkan.</p>
            )}
          </div>
        </div>

        <DialogFooter className="pt-2">
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
