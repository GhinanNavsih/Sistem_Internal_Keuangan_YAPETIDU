"use client";

import React, { useState, useMemo, useEffect } from 'react';
import Image from 'next/image';
import { SuratMasuk, InstitutionScope, DisposisiSurat } from '@/lib/surat-menyurat/types';
import { DISPOSISI_DESTINATIONS, DISPOSISI_ACTIONS } from '@/lib/surat-menyurat/constants';
import { calculateUsiaArsip, formatKodeArsip } from '@/lib/surat-menyurat/numbering';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Printer, Check, ArrowLeft, ArrowRight, Save, Loader2, Sparkles } from 'lucide-react';

interface Props {
  suratList: SuratMasuk[];
  selectedSuratId?: string | null;
  onSelectSuratId?: (id: string) => void;
  onSaveDisposisi?: (suratId: string, disposisi: DisposisiSurat) => Promise<void>;
  defaultScope?: InstitutionScope;
  currentUserName?: string;
}

export default function LembarDisposisiView({
  suratList,
  selectedSuratId,
  onSelectSuratId,
  onSaveDisposisi,
  defaultScope = 'UNIPDU',
  currentUserName = 'Rektor UNIPDU',
}: Props) {
  // Sort letters by nomorUrut or date
  const sortedSurat = useMemo(() => {
    return [...suratList].sort((a, b) => {
      const numA = a.nomorUrut || 0;
      const numB = b.nomorUrut || 0;
      if (numA !== numB) return numA - numB;
      return new Date(b.tanggalSurat).getTime() - new Date(a.tanggalSurat).getTime();
    });
  }, [suratList]);

  const [activeSuratId, setActiveSuratId] = useState<string>(
    selectedSuratId || sortedSurat[0]?.id || ''
  );

  useEffect(() => {
    if (selectedSuratId) {
      setActiveSuratId(selectedSuratId);
    } else if (!activeSuratId && sortedSurat.length > 0) {
      setActiveSuratId(sortedSurat[0].id);
    }
  }, [selectedSuratId, sortedSurat, activeSuratId]);

  const currentSurat = useMemo(() => {
    return sortedSurat.find((s) => s.id === activeSuratId) || sortedSurat[0] || null;
  }, [sortedSurat, activeSuratId]);

  const currentIndex = useMemo(() => {
    return sortedSurat.findIndex((s) => s.id === activeSuratId);
  }, [sortedSurat, activeSuratId]);

  // Form states for the disposition sheet
  const [diteruskanList, setDiteruskanList] = useState<string[]>([]);
  const [tindakanList, setTindakanList] = useState<string[]>([]);
  const [catatan, setCatatan] = useState('');
  const [instruksiText, setInstruksiText] = useState('');
  const [saving, setSaving] = useState(false);
  const [saveSuccess, setSaveSuccess] = useState(false);

  useEffect(() => {
    if (currentSurat) {
      const d = currentSurat.disposisi;
      setDiteruskanList(d?.diteruskanChecklist || (d?.diteruskanKepada ? [d.diteruskanKepada] : []));
      setTindakanList(d?.tindakanChecklist || (d?.instruksi ? [d.instruksi] : [DISPOSISI_ACTIONS[0]]));
      setCatatan(d?.catatan || '');
      setInstruksiText(d?.instruksi || '');
      setSaveSuccess(false);
    }
  }, [currentSurat]);

  const toggleDiteruskan = (dest: string) => {
    setDiteruskanList((prev) =>
      prev.includes(dest) ? prev.filter((d) => d !== dest) : [...prev, dest]
    );
  };

  const toggleTindakan = (action: string) => {
    setTindakanList((prev) => {
      const next = prev.includes(action) ? prev.filter((a) => a !== action) : [...prev, action];
      if (next.length > 0) {
        setInstruksiText(next.join(', '));
      }
      return next;
    });
  };

  const handleSave = async () => {
    if (!currentSurat || !onSaveDisposisi) return;
    try {
      setSaving(true);
      const combinedInstruksi = tindakanList.length > 0 ? tindakanList.join(', ') : (instruksiText || 'Tindak lanjuti');
      const combinedDiteruskan = diteruskanList.length > 0 ? diteruskanList.join(', ') : 'Sekretaris';

      await onSaveDisposisi(currentSurat.id, {
        instruksi: combinedInstruksi,
        diteruskanKepada: combinedDiteruskan,
        diteruskanChecklist: diteruskanList,
        tindakanChecklist: tindakanList,
        catatan: catatan.trim(),
        tanggalDisposisi: new Date().toISOString().slice(0, 10),
        disposisiOleh: currentUserName,
        disposisiOlehUid: '',
      });
      setSaveSuccess(true);
      setTimeout(() => setSaveSuccess(false), 3000);
    } finally {
      setSaving(false);
    }
  };

  const handlePrint = () => {
    window.print();
  };

  const isYapetidu = currentSurat?.institutionScope === 'YAPETIDU' || defaultScope === 'YAPETIDU';
  const seqNum = currentSurat?.nomorUrut || (currentIndex >= 0 ? currentIndex + 1 : 1);
  const kodeArsip = currentSurat?.kodeArsip || formatKodeArsip({
    type: 'masuk',
    institutionScope: isYapetidu ? 'YAPETIDU' : 'UNIPDU',
    sequenceNumber: seqNum,
  });
  const usiaArsip = currentSurat ? calculateUsiaArsip(currentSurat.tanggalSurat) : '-';

  if (!currentSurat) {
    return (
      <div className="p-16 text-center text-slate-500">
        <p className="font-semibold text-base text-slate-700">Belum ada surat masuk untuk dibuatkan disposisi.</p>
        <p className="text-xs text-slate-400 mt-1">Silakan daftarkan surat masuk terlebih dahulu pada tab Agenda Surat Masuk.</p>
      </div>
    );
  }

  return (
    <div className="space-y-6 p-6">
      {/* Control Toolbar (Hidden on print) */}
      <div className="print:hidden flex flex-wrap items-center justify-between gap-4 bg-slate-50 p-4 rounded-md border border-slate-200">
        <div className="flex items-center gap-3">
          <span className="text-xs font-bold text-slate-700">Pilih Surat Masuk (Agenda A1):</span>
          <select
            value={currentSurat.id}
            onChange={(e) => {
              setActiveSuratId(e.target.value);
              onSelectSuratId?.(e.target.value);
            }}
            className="bg-white border border-slate-300 text-xs font-semibold rounded-sm px-3 py-2 text-slate-800 outline-none focus:ring-2 focus:ring-indigo-500 shadow-sm max-w-md truncate"
          >
            {sortedSurat.map((s, idx) => (
              <option key={s.id} value={s.id}>
                No. {s.nomorUrut || idx + 1} · {s.nomorSurat} — {s.pengirim} ({s.perihal})
              </option>
            ))}
          </select>

          {/* Prev / Next buttons */}
          <div className="flex items-center gap-1">
            <button
              type="button"
              disabled={currentIndex <= 0}
              onClick={() => {
                if (currentIndex > 0) {
                  const prevId = sortedSurat[currentIndex - 1].id;
                  setActiveSuratId(prevId);
                  onSelectSuratId?.(prevId);
                }
              }}
              className="p-1.5 rounded-sm bg-white border border-slate-200 text-slate-600 hover:bg-slate-100 disabled:opacity-40 disabled:cursor-not-allowed shadow-xs cursor-pointer"
              title="Surat Sebelumnya"
            >
              <ArrowLeft className="w-3.5 h-3.5" />
            </button>
            <span className="text-xs font-semibold text-slate-500 px-1">
              {currentIndex + 1} / {sortedSurat.length}
            </span>
            <button
              type="button"
              disabled={currentIndex >= sortedSurat.length - 1}
              onClick={() => {
                if (currentIndex < sortedSurat.length - 1) {
                  const nextId = sortedSurat[currentIndex + 1].id;
                  setActiveSuratId(nextId);
                  onSelectSuratId?.(nextId);
                }
              }}
              className="p-1.5 rounded-sm bg-white border border-slate-200 text-slate-600 hover:bg-slate-100 disabled:opacity-40 disabled:cursor-not-allowed shadow-xs cursor-pointer"
              title="Surat Selanjutnya"
            >
              <ArrowRight className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>

        <div className="flex items-center gap-3">
          {onSaveDisposisi && (
            <Button
              type="button"
              onClick={handleSave}
              disabled={saving}
              className="rounded-sm bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-semibold flex items-center gap-2 shadow-sm"
            >
              {saving ? (
                <>
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  Menyimpan...
                </>
              ) : saveSuccess ? (
                <>
                  <Check className="w-3.5 h-3.5 text-emerald-300" />
                  Tersimpan!
                </>
              ) : (
                <>
                  <Save className="w-3.5 h-3.5" />
                  Simpan Arahan Disposisi
                </>
              )}
            </Button>
          )}

          <Button
            type="button"
            onClick={handlePrint}
            variant="outline"
            className="rounded-sm border-slate-300 text-slate-700 bg-white hover:bg-slate-50 text-xs font-semibold flex items-center gap-2 shadow-xs cursor-pointer"
          >
            <Printer className="w-3.5 h-3.5 text-slate-500" />
            Cetak Lembar Disposisi
          </Button>
        </div>
      </div>

      {/* Printable Lembar Disposisi Sheet (Formatted exactly like the Excel DISPOSISI layout) */}
      <div className="bg-white border border-slate-300 shadow-md rounded-md p-8 max-w-4xl mx-auto print:border-none print:shadow-none print:p-0 print:m-0 font-serif text-slate-900">
        {/* Kop Surat */}
        <div className="flex items-center justify-between pb-4 border-b-4 border-double border-slate-900 mb-4">
          <div className="w-20 h-20 relative flex items-center justify-center shrink-0">
            <Image
              src={isYapetidu ? '/Logo YAPETIDU (Transparent bg).png' : '/Logo UNIPDU.png'}
              alt="Logo Institusi"
              width={80}
              height={80}
              priority
              className="object-contain"
            />
          </div>

          <div className="text-center flex-1 px-4">
            <h2 className="text-lg font-bold tracking-tight uppercase">
              {isYapetidu
                ? "YAYASAN PESANTREN TINGGI DARUL 'ULUM JOMBANG"
                : "UNIVERSITAS PESANTREN TINGGI DARUL 'ULUM JOMBANG"}
            </h2>
            <h3 className="text-sm font-bold tracking-wider uppercase text-slate-800">
              {isYapetidu ? 'YAPETIDU' : 'SEKRETARIAT REKTORAT'}
            </h3>
            <p className="text-[11px] text-slate-600 mt-1">
              PP. Darul Ulum Tromol Pos 10 Jombang 61481, Telp. (0321) 876771, 873655 Fax : (0321) 876771
            </p>
            <p className="text-[10px] text-slate-500">
              Website : www.unipdu.ac.id, e-mail : rektorat@unipdu.ac.id
            </p>
          </div>

          <div className="w-20 text-right print:hidden">
            <span className="text-[10px] text-slate-400 font-sans block">Aplikasi Persuratan</span>
            <span className="text-xs font-bold font-sans text-indigo-600 block">Tahun 2026</span>
          </div>
        </div>

        {/* Title */}
        <div className="text-center my-4">
          <h1 className="text-base font-extrabold tracking-widest uppercase underline decoration-1 underline-offset-4">
            L E M B A R &nbsp; D I S P O S I S I
          </h1>
        </div>

        {/* Metadata Table */}
        <div className="border border-slate-900 text-xs mb-4">
          <div className="grid grid-cols-2 divide-x divide-slate-900">
            {/* Left Column */}
            <div className="p-3 space-y-2">
              <div className="flex">
                <span className="w-28 font-semibold">Surat dari</span>
                <span className="w-3 text-center">:</span>
                <span className="flex-1 font-bold">{currentSurat.pengirim}</span>
              </div>
              <div className="flex">
                <span className="w-28 font-semibold">No. Surat</span>
                <span className="w-3 text-center">:</span>
                <span className="flex-1 font-mono font-medium">{currentSurat.nomorSurat}</span>
              </div>
              <div className="flex">
                <span className="w-28 font-semibold">Tgl. Surat</span>
                <span className="w-3 text-center">:</span>
                <span className="flex-1">{currentSurat.tanggalSurat}</span>
              </div>
              <div className="flex">
                <span className="w-28 font-semibold">Sifat Surat</span>
                <span className="w-3 text-center">:</span>
                <span className="flex-1 font-bold uppercase">{currentSurat.sifat}</span>
              </div>
            </div>

            {/* Right Column */}
            <div className="p-3 space-y-2">
              <div className="flex">
                <span className="w-28 font-semibold">Pengolah</span>
                <span className="w-3 text-center">:</span>
                <span className="flex-1">{currentSurat.satkerName || 'Kepala Tata Usaha'}</span>
              </div>
              <div className="flex">
                <span className="w-28 font-semibold">Diterima Tgl.</span>
                <span className="w-3 text-center">:</span>
                <span className="flex-1">{currentSurat.tanggalDiterima}</span>
              </div>
              <div className="flex">
                <span className="w-28 font-semibold">No. Agenda</span>
                <span className="w-3 text-center">:</span>
                <span className="flex-1 font-bold text-sm">{seqNum}</span>
              </div>
              <div className="flex">
                <span className="w-28 font-semibold">Kode Arsip</span>
                <span className="w-3 text-center">:</span>
                <span className="flex-1 font-mono font-semibold">{kodeArsip}</span>
              </div>
            </div>
          </div>

          {/* Hal / Isi Ringkas Row */}
          <div className="border-t border-slate-900 p-3 bg-slate-50/50">
            <span className="font-semibold block mb-1">Perihal / Hal :</span>
            <p className="text-xs font-bold leading-relaxed whitespace-pre-wrap">{currentSurat.perihal}</p>
            {currentSurat.ringkasan && (
              <p className="text-[11px] text-slate-700 italic mt-1 leading-normal">
                Ringkasan: {currentSurat.ringkasan}
              </p>
            )}
          </div>
        </div>

        {/* Routing & Action Grid (Matches Excel DISPOSISI R25-R36) */}
        <div className="border border-slate-900 grid grid-cols-2 divide-x divide-slate-900 text-xs mb-4">
          {/* Left Column: Diteruskan kepada Sdr. */}
          <div className="p-3 space-y-2">
            <h4 className="font-bold underline mb-2">Diteruskan kepada Sdr. :</h4>
            <div className="space-y-1.5 font-sans text-[11px]">
              {DISPOSISI_DESTINATIONS.map((dest) => {
                const checked = diteruskanList.includes(dest);
                return (
                  <label
                    key={dest}
                    className="flex items-center gap-2 cursor-pointer hover:text-indigo-600 transition-colors select-none"
                    onClick={(e) => {
                      e.preventDefault();
                      toggleDiteruskan(dest);
                    }}
                  >
                    <div
                      className={`w-3.5 h-3.5 border border-slate-900 rounded-none flex items-center justify-center shrink-0 ${
                        checked ? 'bg-slate-900 text-white' : 'bg-white'
                      }`}
                    >
                      {checked && <Check className="w-3 h-3 stroke-[3]" />}
                    </div>
                    <span className={checked ? 'font-bold text-slate-900' : 'text-slate-700'}>
                      {dest}
                    </span>
                  </label>
                );
              })}
            </div>
          </div>

          {/* Right Column: Dengan hormat harap */}
          <div className="p-3 space-y-3">
            <div>
              <h4 className="font-bold underline mb-2">Dengan hormat harap :</h4>
              <div className="space-y-2 font-sans text-[11px]">
                {DISPOSISI_ACTIONS.map((action) => {
                  const checked = tindakanList.includes(action);
                  return (
                    <label
                      key={action}
                      className="flex items-center gap-2 cursor-pointer hover:text-indigo-600 transition-colors select-none"
                      onClick={(e) => {
                        e.preventDefault();
                        toggleTindakan(action);
                      }}
                    >
                      <div
                        className={`w-3.5 h-3.5 border border-slate-900 rounded-none flex items-center justify-center shrink-0 ${
                          checked ? 'bg-slate-900 text-white' : 'bg-white'
                        }`}
                      >
                        {checked && <Check className="w-3 h-3 stroke-[3]" />}
                      </div>
                      <span className={checked ? 'font-bold text-slate-900' : 'text-slate-700'}>
                        {action}
                      </span>
                    </label>
                  );
                })}
              </div>
            </div>

            {/* Usia Arsip Tracker badge */}
            <div className="pt-2 border-t border-slate-300 font-sans text-[11px] text-slate-600">
              <span>Usia Arsip Saat Ini: <strong>{usiaArsip}</strong></span>
            </div>
          </div>
        </div>

        {/* Catatan Disposisi & Tanda Tangan Block */}
        <div className="border border-slate-900 grid grid-cols-3 divide-x divide-slate-900 text-xs">
          <div className="col-span-2 p-3 space-y-2">
            <h4 className="font-bold underline">Catatan :</h4>
            <textarea
              value={catatan}
              onChange={(e) => setCatatan(e.target.value)}
              placeholder="Tuliskan catatan atau instruksi tambahan pimpinan di sini..."
              rows={4}
              className="w-full bg-slate-50 border border-slate-300 rounded-xs p-2 text-xs font-sans text-slate-800 outline-none focus:ring-1 focus:ring-indigo-500 print:bg-transparent print:border-none print:p-0 print:resize-none"
            />
          </div>

          <div className="p-3 text-center flex flex-col justify-between">
            <span className="font-semibold block">
              Jombang, {new Date().toLocaleDateString('id-ID', { day: 'numeric', month: 'long', year: 'numeric' })}
            </span>
            <span className="font-bold block text-slate-800">
              {isYapetidu ? 'Ketua Yayasan' : 'Rektor'}
            </span>
            <div className="h-16 flex items-end justify-center">
              <span className="border-b border-slate-900 pb-0.5 inline-block font-bold">
                ( &nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp; )
              </span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
