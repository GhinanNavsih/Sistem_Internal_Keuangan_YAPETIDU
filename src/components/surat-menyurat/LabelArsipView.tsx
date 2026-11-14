"use client";

import React, { useState, useMemo } from 'react';
import { SuratMasuk, SuratKeluar, InstitutionScope } from '@/lib/surat-menyurat/types';
import { formatLetterDate } from '@/lib/surat-menyurat/date';
import { formatKodeArsip } from '@/lib/surat-menyurat/numbering';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Printer, Tag, FileText, CheckCircle2 } from 'lucide-react';

interface Props {
  suratMasukList: SuratMasuk[];
  suratKeluarList: SuratKeluar[];
  defaultScope?: InstitutionScope;
}

export default function LabelArsipView({
  suratMasukList,
  suratKeluarList,
  defaultScope = 'UNIPDU',
}: Props) {
  const [selectedType, setSelectedType] = useState<'masuk' | 'keluar'>('keluar');
  const [filterQuery, setFilterQuery] = useState('');

  const activeItems = useMemo(() => {
    if (selectedType === 'masuk') {
      return suratMasukList.map((item, idx) => ({
        id: item.id,
        type: 'SURAT MASUK' as const,
        seq: item.nomorUrut || idx + 1,
        nomorSurat: item.nomorSurat,
        partner: item.pengirim,
        perihal: item.perihal,
        tanggal: item.tanggalSurat,
        kodeArsip: item.kodeArsip || formatKodeArsip({
          type: 'masuk',
          institutionScope: item.institutionScope || defaultScope,
          sequenceNumber: item.nomorUrut || idx + 1,
        }),
      }));
    } else {
      return suratKeluarList.map((item, idx) => ({
        id: item.id,
        type: 'SURAT KELUAR' as const,
        seq: item.nomorUrut || idx + 1,
        nomorSurat: item.nomorSurat,
        partner: item.tujuan,
        perihal: item.perihal,
        tanggal: item.tanggalSurat,
        kodeArsip: item.kodeArsip || formatKodeArsip({
          type: 'keluar',
          institutionScope: item.institutionScope || defaultScope,
          sequenceNumber: item.nomorUrut || idx + 1,
        }),
      }));
    }
  }, [selectedType, suratMasukList, suratKeluarList, defaultScope]);

  const filteredItems = useMemo(() => {
    if (!filterQuery.trim()) return activeItems;
    const q = filterQuery.toLowerCase();
    return activeItems.filter(
      (it) =>
        it.nomorSurat.toLowerCase().includes(q) ||
        it.kodeArsip.toLowerCase().includes(q) ||
        it.partner.toLowerCase().includes(q) ||
        it.perihal.toLowerCase().includes(q)
    );
  }, [activeItems, filterQuery]);

  const handlePrint = () => {
    window.print();
  };

  return (
    <div className="space-y-6 p-6">
      {/* Controls Bar (Hidden when printing) */}
      <div className="print:hidden flex flex-wrap items-center justify-between gap-4 bg-slate-50 p-4 rounded-md border border-slate-200">
        <div className="flex items-center gap-3">
          <div className="flex bg-white p-1 rounded-sm border border-slate-200 shadow-xs">
            <button
              type="button"
              onClick={() => setSelectedType('keluar')}
              className={`px-3 py-1.5 rounded-xs text-xs font-semibold cursor-pointer transition-all ${
                selectedType === 'keluar'
                  ? 'bg-indigo-600 text-white shadow-xs'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              Label Surat Keluar ({suratKeluarList.length})
            </button>
            <button
              type="button"
              onClick={() => setSelectedType('masuk')}
              className={`px-3 py-1.5 rounded-xs text-xs font-semibold cursor-pointer transition-all ${
                selectedType === 'masuk'
                  ? 'bg-sky-600 text-white shadow-xs'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              Label Surat Masuk ({suratMasukList.length})
            </button>
          </div>

          <input
            type="text"
            placeholder="Saring label arsip..."
            value={filterQuery}
            onChange={(e) => setFilterQuery(e.target.value)}
            className="bg-white border border-slate-200 text-xs font-semibold rounded-sm px-3 py-1.5 text-slate-700 outline-none focus:ring-2 focus:ring-indigo-500 shadow-xs min-w-[200px]"
          />
        </div>

        <Button
          type="button"
          onClick={handlePrint}
          className="rounded-sm bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-semibold flex items-center gap-2 shadow-xs cursor-pointer"
        >
          <Printer className="w-3.5 h-3.5" />
          Cetak Stiker Label Arsip
        </Button>
      </div>

      {/* Grid of Printable Archive Labels (Replicating LABEL SURAT sheets) */}
      <div className="print:m-0 print:p-0">
        <div className="text-center print:block hidden mb-4">
          <h2 className="text-sm font-bold uppercase tracking-wider text-slate-800">
            LABEL KARTU KENDALI & STIKER BINDER ARSIP — {selectedType === 'keluar' ? 'SURAT KELUAR' : 'SURAT MASUK'}
          </h2>
          <p className="text-[10px] text-slate-500">APLIKASI PERSURATAN DARUL &apos;ULUM 2026</p>
        </div>

        {filteredItems.length === 0 ? (
          <div className="p-16 text-center text-slate-400 font-medium text-xs">
            Tidak ada data label arsip untuk ditampilkan.
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4 print:grid-cols-4 print:gap-2">
            {filteredItems.map((item) => (
              <div
                key={item.id}
                className="bg-white border-2 border-slate-800 rounded-sm p-3.5 flex flex-col justify-between shadow-xs print:shadow-none print:border-slate-800 print:break-inside-avoid h-[160px]"
              >
                {/* Header Tag */}
                <div className="flex items-center justify-between border-b border-slate-300 pb-1.5 mb-1.5">
                  <span
                    className={`text-[9px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded-xs ${
                      item.type === 'SURAT KELUAR'
                        ? 'bg-indigo-100 text-indigo-900 border border-indigo-200'
                        : 'bg-sky-100 text-sky-900 border border-sky-200'
                    }`}
                  >
                    {item.type}
                  </span>
                  <span className="font-mono font-bold text-xs text-slate-900">
                    No. {String(item.seq).padStart(3, '0')}
                  </span>
                </div>

                {/* Body Content */}
                <div className="space-y-1 flex-1 overflow-hidden">
                  <span className="font-mono text-xs font-bold text-slate-900 block truncate" title={item.nomorSurat}>
                    {item.nomorSurat}
                  </span>
                  <span className="text-[10px] text-slate-600 block truncate" title={item.partner}>
                    {item.partner}
                  </span>
                  <span className="text-[10px] text-slate-500 block truncate italic" title={item.perihal}>
                    {item.perihal}
                  </span>
                </div>

                {/* Footer Archive Locator Tag */}
                <div className="pt-1.5 border-t border-slate-300 flex items-center justify-between text-[10px]">
                  <span className="font-mono font-extrabold text-slate-900 bg-slate-100 px-1.5 py-0.5 rounded-xs border border-slate-300">
                    {item.kodeArsip}
                  </span>
                  <span className="text-slate-400 font-mono text-[9px]">{formatLetterDate(item.tanggal)}</span>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
