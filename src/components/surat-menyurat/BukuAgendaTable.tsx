"use client";

import React, { useState, useMemo } from 'react';
import { SuratMasuk, SuratKeluar, InstitutionScope } from '@/lib/surat-menyurat/types';
import { calculateUsiaArsip, formatKodeArsip } from '@/lib/surat-menyurat/numbering';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Calendar,
  Clock,
  Eye,
  FileCheck,
  FileText,
  Inbox,
  Send,
  Tag,
  Search,
} from 'lucide-react';

interface Props {
  suratMasukList: SuratMasuk[];
  suratKeluarList: SuratKeluar[];
  scopeFilter: string;
  onOpenDetail: (surat: SuratMasuk | SuratKeluar, type: 'masuk' | 'keluar') => void;
  onOpenDisposisi: (surat: SuratMasuk) => void;
}

export default function BukuAgendaTable({
  suratMasukList,
  suratKeluarList,
  scopeFilter,
  onOpenDetail,
  onOpenDisposisi,
}: Props) {
  const [activeFilter, setActiveFilter] = useState<'all' | 'masuk' | 'keluar'>('all');
  const [searchQuery, setSearchQuery] = useState('');

  // Combine both incoming and outgoing into unified ledger
  const allRows = useMemo(() => {
    const masuk = suratMasukList.map((m, idx) => ({
      id: m.id,
      raw: m,
      type: 'masuk' as const,
      institutionScope: m.institutionScope || 'UNIPDU',
      nomorUrut: m.nomorUrut || idx + 1,
      alamat: m.pengirim,
      ditujukanKe: m.penerima,
      nomorSurat: m.nomorSurat,
      tanggalSurat: m.tanggalSurat,
      perihal: m.perihal,
      kodeSurat: m.kodeSurat || m.kategori || 'BU',
      sifat: m.sifat,
      kodeArsip: m.kodeArsip || formatKodeArsip({
        type: 'masuk',
        institutionScope: m.institutionScope || 'UNIPDU',
        sequenceNumber: m.nomorUrut || idx + 1,
      }),
      usiaArsip: m.usiaArsip || calculateUsiaArsip(m.tanggalSurat),
      status: m.status,
      disposisi: m.disposisi,
    }));

    const keluar = suratKeluarList.map((k, idx) => ({
      id: k.id,
      raw: k,
      type: 'keluar' as const,
      institutionScope: k.institutionScope || 'UNIPDU',
      nomorUrut: k.nomorUrut || idx + 1,
      alamat: k.tujuan,
      ditujukanKe: k.penandatanganNama || 'Rektor',
      nomorSurat: k.nomorSurat,
      tanggalSurat: k.tanggalSurat,
      perihal: k.perihal,
      kodeSurat: k.kodeSurat || k.kategori || 'AU',
      sifat: k.sifat,
      kodeArsip: k.kodeArsip || formatKodeArsip({
        type: 'keluar',
        institutionScope: k.institutionScope || 'UNIPDU',
        sequenceNumber: k.nomorUrut || idx + 1,
      }),
      usiaArsip: k.usiaArsip || calculateUsiaArsip(k.tanggalSurat),
      status: k.status,
      disposisi: null,
    }));

    // Merge and sort by sequence / date
    const merged = [...masuk, ...keluar];
    return merged.sort((a, b) => {
      if (a.nomorUrut !== b.nomorUrut) return a.nomorUrut - b.nomorUrut;
      return new Date(b.tanggalSurat).getTime() - new Date(a.tanggalSurat).getTime();
    });
  }, [suratMasukList, suratKeluarList]);

  const filtered = useMemo(() => {
    return allRows.filter((r) => {
      if (activeFilter !== 'all' && r.type !== activeFilter) return false;
      if (scopeFilter !== 'all' && r.institutionScope !== scopeFilter) return false;

      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        const text = [r.nomorSurat, r.alamat, r.perihal, r.kodeArsip, r.kodeSurat]
          .filter(Boolean)
          .join(' ')
          .toLowerCase();
        if (!text.includes(q)) return false;
      }
      return true;
    });
  }, [allRows, activeFilter, scopeFilter, searchQuery]);

  return (
    <div className="space-y-4">
      {/* Sub Toolbar */}
      <div className="flex flex-wrap items-center justify-between gap-4 px-8 py-3 bg-slate-50 border-b border-slate-200">
        <div className="flex items-center gap-2">
          <div className="flex bg-white p-1 rounded-sm border border-slate-200 shadow-xs">
            <button
              type="button"
              onClick={() => setActiveFilter('all')}
              className={`px-3 py-1 rounded-xs text-xs font-semibold cursor-pointer transition-all ${
                activeFilter === 'all'
                  ? 'bg-slate-800 text-white shadow-xs'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              Semua Agenda ({allRows.length})
            </button>
            <button
              type="button"
              onClick={() => setActiveFilter('masuk')}
              className={`px-3 py-1 rounded-xs text-xs font-semibold cursor-pointer transition-all ${
                activeFilter === 'masuk'
                  ? 'bg-sky-600 text-white shadow-xs'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              Surat Masuk ({suratMasukList.length})
            </button>
            <button
              type="button"
              onClick={() => setActiveFilter('keluar')}
              className={`px-3 py-1 rounded-xs text-xs font-semibold cursor-pointer transition-all ${
                activeFilter === 'keluar'
                  ? 'bg-indigo-600 text-white shadow-xs'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              Surat Keluar ({suratKeluarList.length})
            </button>
          </div>
        </div>

        <div className="relative min-w-[240px]">
          <span className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-slate-400">
            <Search className="w-3.5 h-3.5" />
          </span>
          <input
            type="text"
            placeholder="Cari agenda, nomor, kode arsip..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full bg-white border border-slate-200 text-slate-700 placeholder:text-slate-400 text-xs font-semibold rounded-sm pl-9 pr-3 py-1.5 outline-none focus:border-indigo-500 shadow-xs"
          />
        </div>
      </div>

      {/* Ledger Table */}
      {filtered.length === 0 ? (
        <div className="p-16 text-center text-slate-400 font-medium text-xs">
          Tidak ada data buku agenda yang sesuai filter.
        </div>
      ) : (
        <Table>
          <TableHeader className="bg-slate-50/70">
            <TableRow className="border-slate-200">
              <TableHead className="font-semibold text-slate-600 pl-8 w-16">No.</TableHead>
              <TableHead className="font-semibold text-slate-600 w-24">Tipe</TableHead>
              <TableHead className="font-semibold text-slate-600">Nomor Surat & Tanggal</TableHead>
              <TableHead className="font-semibold text-slate-600">Pihak / Alamat</TableHead>
              <TableHead className="font-semibold text-slate-600">Perihal / Hal</TableHead>
              <TableHead className="font-semibold text-slate-600">Kode & Sifat</TableHead>
              <TableHead className="font-semibold text-slate-600">Kode Arsip & Usia</TableHead>
              <TableHead className="font-semibold text-slate-600 text-right pr-8">Aksi</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {filtered.map((row) => (
              <TableRow key={`${row.type}-${row.id}`} className="border-slate-100 hover:bg-slate-50/50 transition-colors">
                {/* No. Urut */}
                <TableCell className="font-mono font-bold text-xs text-slate-600 pl-8 py-3.5 align-top">
                  {row.nomorUrut}
                </TableCell>

                {/* Tipe Badge */}
                <TableCell className="py-3.5 align-top">
                  <span
                    className={`inline-flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-xs uppercase tracking-wider border ${
                      row.type === 'masuk'
                        ? 'bg-sky-50 text-sky-800 border-sky-200'
                        : 'bg-indigo-50 text-indigo-800 border-indigo-200'
                    }`}
                  >
                    {row.type === 'masuk' ? <Inbox className="w-2.5 h-2.5" /> : <Send className="w-2.5 h-2.5" />}
                    {row.type}
                  </span>
                </TableCell>

                {/* Nomor Surat & Tanggal */}
                <TableCell className="py-3.5 align-top">
                  <span className="font-mono font-bold text-xs text-slate-900 block truncate max-w-[200px]" title={row.nomorSurat}>
                    {row.nomorSurat}
                  </span>
                  <div className="flex items-center gap-1 text-[11px] text-slate-400 mt-1">
                    <Calendar className="w-3 h-3 text-slate-400" />
                    <span>{row.tanggalSurat}</span>
                  </div>
                </TableCell>

                {/* Pihak / Alamat */}
                <TableCell className="py-3.5 align-top">
                  <span className="font-semibold text-xs text-slate-800 block truncate max-w-[180px]" title={row.alamat}>
                    {row.alamat}
                  </span>
                  <span className="text-[10px] text-slate-400 block truncate max-w-[180px]">
                    {row.type === 'masuk' ? `Ke: ${row.ditujukanKe}` : `Oleh: ${row.ditujukanKe}`}
                  </span>
                </TableCell>

                {/* Perihal */}
                <TableCell className="py-3.5 align-top">
                  <span className="font-medium text-xs text-slate-800 block line-clamp-2 max-w-[240px]" title={row.perihal}>
                    {row.perihal}
                  </span>
                </TableCell>

                {/* Kode Surat & Sifat */}
                <TableCell className="py-3.5 align-top">
                  <div className="flex flex-col gap-1 items-start">
                    <span className="font-mono text-[10px] font-bold text-slate-700 bg-slate-100 border border-slate-200 px-1.5 py-0.5 rounded-xs">
                      {row.kodeSurat}
                    </span>
                    <span className="text-[10px] font-semibold text-slate-500 uppercase">
                      {row.sifat}
                    </span>
                  </div>
                </TableCell>

                {/* Kode Arsip & Usia Arsip */}
                <TableCell className="py-3.5 align-top">
                  <span className="font-mono text-[11px] font-bold text-indigo-700 bg-indigo-50 border border-indigo-100 px-1.5 py-0.5 rounded-xs block truncate max-w-[140px]" title={row.kodeArsip}>
                    {row.kodeArsip}
                  </span>
                  <div className="flex items-center gap-1 text-[10px] text-slate-400 mt-1">
                    <Clock className="w-2.5 h-2.5 text-slate-400" />
                    <span>{row.usiaArsip}</span>
                  </div>
                </TableCell>

                {/* Actions */}
                <TableCell className="text-right pr-8 py-3.5 align-top">
                  <div className="flex items-center justify-end gap-1.5">
                    <button
                      type="button"
                      onClick={() => onOpenDetail(row.raw as any, row.type)}
                      className="px-2 py-1 rounded-xs text-[11px] font-semibold bg-white border border-slate-200 text-slate-700 hover:bg-slate-50 transition-colors shadow-xs cursor-pointer inline-flex items-center gap-1"
                    >
                      <Eye className="w-3 h-3 text-slate-400" />
                      Detail
                    </button>

                    {row.type === 'masuk' && (
                      <button
                        type="button"
                        onClick={() => onOpenDisposisi(row.raw as SuratMasuk)}
                        className="px-2 py-1 rounded-xs text-[11px] font-semibold bg-indigo-50 border border-indigo-200 text-indigo-700 hover:bg-indigo-100 transition-colors shadow-xs cursor-pointer inline-flex items-center gap-1"
                      >
                        <FileCheck className="w-3 h-3 text-indigo-500" />
                        Disposisi
                      </button>
                    )}
                  </div>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </div>
  );
}
