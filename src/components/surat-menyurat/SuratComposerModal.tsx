"use client";

import React, { useState, useEffect } from 'react';
import Image from 'next/image';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useAuth } from '@/lib/AuthContext';
import { TEMPLATE_OPTIONS } from '@/lib/surat-menyurat/constants';
import { deriveSatkerCode, formatNomorSuratKeluar } from '@/lib/surat-menyurat/numbering';
import { applyTemplateDefaults, getDefaultDraft, LetterDraftPayload } from '@/lib/surat-menyurat/templates';
import { SuratKeluar, TemplateType } from '@/lib/surat-menyurat/types';
import { Columns2, Edit3, Eye, FileText, Loader2, Printer, Save, Sparkles, Wand2 } from 'lucide-react';

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  defaultSatkerName: string;
  defaultKepalaName?: string;
  nextSequence: number;
  onSavedToSuratKeluar?: (data: SuratKeluar) => void;
}

export default function SuratComposerModal({
  open,
  onOpenChange,
  defaultSatkerName,
  defaultKepalaName = '',
  nextSequence,
  onSavedToSuratKeluar,
}: Props) {
  const { user } = useAuth();
  const [draft, setDraft] = useState<LetterDraftPayload>(() =>
    getDefaultDraft(defaultSatkerName, defaultKepalaName, `Kepala ${defaultSatkerName}`)
  );
  const [viewMode, setViewMode] = useState<'both' | 'edit' | 'preview'>('both');
  const [saving, setSaving] = useState(false);
  const [saveSuccess, setSaveSuccess] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    if (open) {
      const code = deriveSatkerCode(defaultSatkerName);
      const autoNo = formatNomorSuratKeluar({
        sequenceNumber: nextSequence,
        satkerCode: code,
        date: new Date(),
      });
      const initial = getDefaultDraft(defaultSatkerName, defaultKepalaName, `Kepala ${defaultSatkerName}`);
      initial.nomorSurat = autoNo;
      setDraft(initial);
      setError('');
      setSaveSuccess('');
    }
  }, [open, defaultSatkerName, defaultKepalaName, nextSequence]);

  const handleTemplateChange = (newType: TemplateType) => {
    setDraft((prev) =>
      applyTemplateDefaults(prev, newType, defaultSatkerName, defaultKepalaName, `Kepala ${defaultSatkerName}`)
    );
  };

  const handleGenerateNumber = () => {
    const code = deriveSatkerCode(defaultSatkerName);
    const date = draft.tanggalSurat ? new Date(draft.tanggalSurat) : new Date();
    const autoNo = formatNomorSuratKeluar({
      sequenceNumber: nextSequence,
      satkerCode: code,
      date,
    });
    setDraft((prev) => ({ ...prev, nomorSurat: autoNo }));
  };

  const handlePrint = () => {
    const printContent = document.getElementById('printable-official-letter');
    if (!printContent) return;

    const printWindow = window.open('', '_blank');
    if (!printWindow) {
      alert('Mohon izinkan pop-up browser untuk mencetak surat.');
      return;
    }

    printWindow.document.write(`
      <!DOCTYPE html>
      <html>
        <head>
          <title>${draft.perihal || 'Surat Resmi UNIPDU'}</title>
          <style>
            @page {
              size: A4 portrait;
              margin: 20mm 20mm 20mm 20mm;
            }
            body {
              font-family: 'Times New Roman', Times, serif;
              color: #111;
              line-height: 1.5;
              font-size: 12pt;
              margin: 0;
              padding: 0;
            }
            .kop-container {
              display: flex;
              align-items: center;
              justify-content: space-between;
              border-bottom: 3px double #111;
              padding-bottom: 8px;
              margin-bottom: 20px;
            }
            .kop-text {
              flex: 1;
              text-align: center;
              padding: 0 10px;
            }
            .kop-instansi {
              font-size: 13pt;
              font-weight: bold;
              text-transform: uppercase;
              letter-spacing: 0.5px;
              margin: 0;
            }
            .kop-satker {
              font-size: 15pt;
              font-weight: bold;
              text-transform: uppercase;
              letter-spacing: 1px;
              margin: 2px 0;
            }
            .kop-alamat {
              font-size: 9pt;
              margin: 2px 0 0 0;
            }
            .letter-meta {
              display: flex;
              justify-content: space-between;
              margin-bottom: 16px;
              font-size: 11pt;
            }
            .meta-left table {
              border-collapse: collapse;
            }
            .meta-left td {
              padding: 1px 4px;
              vertical-align: top;
            }
            .destination-block {
              margin: 16px 0;
              font-size: 11pt;
            }
            .letter-content {
              margin: 20px 0;
              text-align: justify;
              font-size: 11.5pt;
            }
            .letter-content p {
              margin-bottom: 12px;
              text-indent: 28px;
            }
            .letter-content .raw-block {
              white-space: pre-wrap;
              margin: 10px 0 10px 28px;
              font-family: inherit;
            }
            .signature-block {
              margin-top: 36px;
              float: right;
              width: 250px;
              text-align: center;
              font-size: 11pt;
            }
            .sign-space {
              height: 75px;
            }
            .sign-name {
              font-weight: bold;
              text-decoration: underline;
            }
          </style>
        </head>
        <body>
          ${printContent.innerHTML}
          <script>
            window.onload = function() {
              window.print();
              window.onafterprint = function() { window.close(); };
            };
          </script>
        </body>
      </html>
    `);
    printWindow.document.close();
  };

  const handleSaveToSuratKeluar = async () => {
    if (!user) return;
    if (!draft.nomorSurat.trim()) {
      setError('Nomor surat wajib diisi.');
      return;
    }
    if (!draft.perihal.trim()) {
      setError('Perihal surat wajib diisi.');
      return;
    }

    try {
      setSaving(true);
      setError('');
      setSaveSuccess('');
      const idToken = await user.getIdToken();

      const combinedBody = [
        draft.salamPembuka,
        draft.isiParagraf1,
        draft.isiParagraf2,
        draft.isiParagraf3,
        draft.salamPenutup,
      ].filter(Boolean).join('\n\n');

      const payload = {
        type: 'keluar',
        nomorSurat: draft.nomorSurat.trim(),
        tanggalSurat: draft.tanggalSurat,
        tujuan: `${draft.tujuanNama} - ${draft.tujuanJabatanInstansi}`.trim(),
        perihal: draft.perihal.trim(),
        sifat: 'biasa',
        kategori:
          draft.templateType === 'tugas'
            ? 'Surat Tugas'
            : draft.templateType === 'undangan'
            ? 'Surat Undangan'
            : 'Surat Keluar',
        ringkasan: combinedBody.slice(0, 300),
        penandatanganNama: draft.penandatanganNama.trim(),
        penandatanganJabatan: draft.penandatanganJabatan.trim(),
        status: 'draft',
        templateType: draft.templateType,
        contentBody: combinedBody,
        lampiranKeterangan: draft.lampiranKeterangan,
        attachments: [],
      };

      const res = await fetch('/api/satker-surat', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${idToken}`,
        },
        body: JSON.stringify(payload),
      });

      const json = await res.json();
      if (!res.ok || !json.ok) {
        throw new Error(json.error || 'Gagal menyimpan ke Surat Keluar.');
      }

      setSaveSuccess('Surat berhasil disimpan ke daftar Surat Keluar (Status: Draft)!');
      if (onSavedToSuratKeluar) onSavedToSuratKeluar(json.data);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Gagal menyimpan.');
    } finally {
      setSaving(false);
    }
  };

  const formatDateIndo = (isoDate: string) => {
    if (!isoDate) return '';
    try {
      const d = new Date(isoDate);
      return d.toLocaleDateString('id-ID', {
        day: 'numeric',
        month: 'long',
        year: 'numeric',
      });
    } catch {
      return isoDate;
    }
  };

  // Shared Form Fields JSX
  const renderEditorForm = () => (
    <div className="space-y-4">
      {/* Nomor Surat & Tanggal */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div className="space-y-1">
          <div className="flex items-center justify-between">
            <Label className="text-xs font-semibold text-slate-700">Nomor Surat</Label>
            <button
              type="button"
              onClick={handleGenerateNumber}
              className="text-[10px] text-indigo-600 font-bold flex items-center gap-1 cursor-pointer hover:underline"
            >
              <Sparkles className="w-2.5 h-2.5" /> Auto No
            </button>
          </div>
          <Input
            value={draft.nomorSurat}
            onChange={(e) => setDraft((prev) => ({ ...prev, nomorSurat: e.target.value }))}
            className="text-xs font-semibold bg-white rounded-sm border-slate-200"
          />
        </div>
        <div className="space-y-1">
          <Label className="text-xs font-semibold text-slate-700">Tanggal Surat</Label>
          <Input
            type="date"
            value={draft.tanggalSurat}
            onChange={(e) => setDraft((prev) => ({ ...prev, tanggalSurat: e.target.value }))}
            className="text-xs font-semibold bg-white rounded-sm border-slate-200"
          />
        </div>
      </div>

      {/* Lampiran & Perihal */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div className="space-y-1">
          <Label className="text-xs font-semibold text-slate-700">Lampiran</Label>
          <Input
            value={draft.lampiranKeterangan}
            onChange={(e) => setDraft((prev) => ({ ...prev, lampiranKeterangan: e.target.value }))}
            placeholder="Contoh: - atau 1 (satu) Berkas"
            className="text-xs font-semibold bg-white rounded-sm border-slate-200"
          />
        </div>
        <div className="space-y-1">
          <Label className="text-xs font-semibold text-slate-700">Perihal / Hal</Label>
          <Input
            value={draft.perihal}
            onChange={(e) => setDraft((prev) => ({ ...prev, perihal: e.target.value }))}
            className="text-xs font-semibold bg-white rounded-sm border-slate-200 text-slate-900"
          />
        </div>
      </div>

      {/* Penerima Surat Block */}
      <div className="p-3 bg-slate-50 border border-slate-200 rounded-sm space-y-2">
        <span className="text-xs font-bold text-slate-700 block">Tujuan Surat (Kepada Yth.)</span>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          <Input
            value={draft.tujuanNama}
            onChange={(e) => setDraft((prev) => ({ ...prev, tujuanNama: e.target.value }))}
            placeholder="Nama / Pihak yang dituju"
            className="text-xs font-semibold bg-white rounded-sm border-slate-200"
          />
          <Input
            value={draft.tujuanJabatanInstansi}
            onChange={(e) => setDraft((prev) => ({ ...prev, tujuanJabatanInstansi: e.target.value }))}
            placeholder="Jabatan / Unit / Instansi"
            className="text-xs font-semibold bg-white rounded-sm border-slate-200"
          />
        </div>
        <Input
          value={draft.tujuanAlamatKota}
          onChange={(e) => setDraft((prev) => ({ ...prev, tujuanAlamatKota: e.target.value }))}
          placeholder="Kota / Lokasi (contoh: di Jombang / di Tempat)"
          className="text-xs font-semibold bg-white rounded-sm border-slate-200"
        />
      </div>

      {/* Isi Surat */}
      <div className="space-y-2">
        <Label className="text-xs font-bold text-slate-700">Isi Naskah Surat</Label>
        <Input
          value={draft.salamPembuka}
          onChange={(e) => setDraft((prev) => ({ ...prev, salamPembuka: e.target.value }))}
          placeholder="Salam Pembuka"
          className="text-xs font-semibold bg-white rounded-sm border-slate-200"
        />

        <textarea
          rows={2}
          value={draft.isiParagraf1}
          onChange={(e) => setDraft((prev) => ({ ...prev, isiParagraf1: e.target.value }))}
          placeholder="Paragraf pembuka..."
          className="w-full text-xs font-medium p-2.5 rounded-sm border border-slate-200 focus:outline-none focus:ring-4 focus:ring-indigo-100 focus:border-indigo-500 transition-all bg-white resize-y"
        />

        <textarea
          rows={4}
          value={draft.isiParagraf2}
          onChange={(e) => setDraft((prev) => ({ ...prev, isiParagraf2: e.target.value }))}
          placeholder="Isi utama / rincian kegiatan / poin penting..."
          className="w-full text-xs p-2.5 rounded-sm border border-slate-200 focus:outline-none focus:ring-4 focus:ring-indigo-100 focus:border-indigo-500 transition-all bg-white font-mono resize-y"
        />

        <textarea
          rows={2}
          value={draft.isiParagraf3}
          onChange={(e) => setDraft((prev) => ({ ...prev, isiParagraf3: e.target.value }))}
          placeholder="Paragraf penutup..."
          className="w-full text-xs font-medium p-2.5 rounded-sm border border-slate-200 focus:outline-none focus:ring-4 focus:ring-indigo-100 focus:border-indigo-500 transition-all bg-white resize-y"
        />

        <Input
          value={draft.salamPenutup}
          onChange={(e) => setDraft((prev) => ({ ...prev, salamPenutup: e.target.value }))}
          placeholder="Salam Penutup"
          className="text-xs font-semibold bg-white rounded-sm border-slate-200"
        />
      </div>

      {/* Penandatangan Block */}
      <div className="p-3 bg-slate-50 border border-slate-200 rounded-sm space-y-2">
        <span className="text-xs font-bold text-slate-700 block">Penandatangan Surat</span>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          <Input
            value={draft.penandatanganNama}
            onChange={(e) => setDraft((prev) => ({ ...prev, penandatanganNama: e.target.value }))}
            placeholder="Nama Lengkap & Gelar"
            className="text-xs font-semibold bg-white rounded-sm border-slate-200"
          />
          <Input
            value={draft.penandatanganJabatan}
            onChange={(e) => setDraft((prev) => ({ ...prev, penandatanganJabatan: e.target.value }))}
            placeholder="Jabatan Resmi"
            className="text-xs font-semibold bg-white rounded-sm border-slate-200"
          />
        </div>
        <Input
          value={draft.penandatanganNipy}
          onChange={(e) => setDraft((prev) => ({ ...prev, penandatanganNipy: e.target.value }))}
          placeholder="NIPY / NIDN (Opsional)"
          className="text-xs font-semibold bg-white rounded-sm border-slate-200"
        />
      </div>
    </div>
  );

  // Shared Preview Paper JSX
  const renderPreviewPaper = () => (
    <div
      id="printable-official-letter"
      className="bg-white shadow-xl border border-slate-200 rounded-xs p-8 sm:p-12 w-full min-w-[540px] max-w-[210mm] text-slate-900 font-serif text-[12.5px] leading-relaxed select-text"
      style={{ minHeight: '297mm' }}
    >
      {/* Kop Surat Resmi UNIPDU */}
      <div className="kop-container border-b-4 border-double border-slate-900 pb-3 mb-6 flex items-center justify-between gap-3">
        <div className="w-14 h-14 relative shrink-0 flex items-center justify-center">
          <Image
            src="/Logo UNIPDU.png"
            alt="Logo UNIPDU"
            width={56}
            height={56}
            priority
            className="object-contain"
          />
        </div>
        <div className="kop-text flex-1 text-center">
          <h3 className="kop-instansi text-xs font-bold uppercase tracking-wider text-slate-800 m-0">
            UNIVERSITAS PESANTREN TINGGI DARUL &apos;ULUM
          </h3>
          <h2 className="kop-satker text-sm sm:text-base font-extrabold uppercase tracking-wide text-slate-900 my-0.5">
            {draft.satkerName || defaultSatkerName || 'SATUAN KERJA'}
          </h2>
          <p className="kop-alamat text-[10px] text-slate-600 m-0">
            Kompleks Pondok Pesantren Darul &apos;Ulum Rejoso, Peterongan, Jombang 61481 | Website: www.unipdu.ac.id
          </p>
        </div>
        <div className="w-14 shrink-0" />
      </div>

      {/* Nomor, Lampiran, Hal & Tanggal */}
      <div className="letter-meta flex justify-between items-start mb-6 text-xs">
        <div className="meta-left space-y-0.5">
          <div className="flex">
            <span className="w-16">Nomor</span>
            <span className="w-3">:</span>
            <span className="font-semibold">{draft.nomorSurat || '.../.../UNIPDU/.../2026'}</span>
          </div>
          <div className="flex">
            <span className="w-16">Lampiran</span>
            <span className="w-3">:</span>
            <span>{draft.lampiranKeterangan || '-'}</span>
          </div>
          <div className="flex">
            <span className="w-16">Hal</span>
            <span className="w-3">:</span>
            <span className="font-semibold underline">{draft.perihal || 'Surat Dinas'}</span>
          </div>
        </div>

        <div className="text-right">
          <span>Jombang, {formatDateIndo(draft.tanggalSurat) || '....................'}</span>
        </div>
      </div>

      {/* Kepada Yth */}
      <div className="destination-block mb-6 text-xs">
        <p className="m-0">Kepada Yth.</p>
        <p className="font-bold m-0">{draft.tujuanNama || 'Bapak / Ibu'}</p>
        {draft.tujuanJabatanInstansi && <p className="m-0">{draft.tujuanJabatanInstansi}</p>}
        <p className="m-0 italic">{draft.tujuanAlamatKota || 'di Tempat'}</p>
      </div>

      {/* Isi Surat */}
      <div className="letter-content space-y-3 text-xs text-justify">
        {draft.salamPembuka && (
          <p className="italic font-medium">{draft.salamPembuka}</p>
        )}
        {draft.isiParagraf1 && (
          <p className="indent-6 leading-relaxed">{draft.isiParagraf1}</p>
        )}
        {draft.isiParagraf2 && (
          <div className="raw-block pl-6 whitespace-pre-wrap font-mono text-[11px] leading-relaxed bg-slate-50/50 p-2 border-l-2 border-slate-300 rounded-sm">
            {draft.isiParagraf2}
          </div>
        )}
        {draft.isiParagraf3 && (
          <p className="indent-6 leading-relaxed">{draft.isiParagraf3}</p>
        )}
        {draft.salamPenutup && (
          <p className="italic font-medium pt-1">{draft.salamPenutup}</p>
        )}
      </div>

      {/* Tanda Tangan */}
      <div className="signature-block mt-10 ml-auto w-64 text-center text-xs">
        <p className="m-0 font-medium">{draft.penandatanganJabatan || 'Kepala SatKer'},</p>
        <div className="sign-space h-20" />
        <p className="sign-name font-bold underline m-0">
          {draft.penandatanganNama || '................................'}
        </p>
        {draft.penandatanganNipy && (
          <p className="text-[11px] text-slate-600 m-0">NIPY: {draft.penandatanganNipy}</p>
        )}
      </div>
    </div>
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-[96vw] max-w-[96vw] sm:max-w-[96vw] lg:max-w-7xl h-[94vh] max-h-[94vh] bg-white rounded-md p-6 border border-slate-100 shadow-[0_20px_50px_rgba(0,0,0,0.1)] flex flex-col overflow-hidden">
        {/* Header Bar */}
        <DialogHeader className="space-y-1 pb-3 border-b border-slate-100 shrink-0">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <div className="p-1.5 rounded-sm bg-indigo-50 text-indigo-600 border border-indigo-100">
                <Wand2 className="w-5 h-5" />
              </div>
              <div>
                <DialogTitle className="text-xl font-bold tracking-tight text-slate-900">
                  Pembuat Surat Resmi SatKer
                </DialogTitle>
                <DialogDescription className="text-xs text-slate-500">
                  Susun surat dinas resmi dengan kop SatKer, format standar, dan cetak langsung ke PDF.
                </DialogDescription>
              </div>
            </div>

            {/* View Mode Toggle & Action Buttons */}
            <div className="flex flex-wrap items-center gap-2">
              <div className="flex rounded-md bg-slate-100 p-1 text-xs font-semibold">
                <button
                  type="button"
                  onClick={() => setViewMode('edit')}
                  className={`px-3 py-1.5 rounded-sm transition-all cursor-pointer flex items-center gap-1 ${
                    viewMode === 'edit'
                      ? 'bg-white shadow-sm text-indigo-600 font-bold'
                      : 'text-slate-500 hover:text-slate-700'
                  }`}
                >
                  <Edit3 className="w-3.5 h-3.5" />
                  Edit
                </button>
                <button
                  type="button"
                  onClick={() => setViewMode('preview')}
                  className={`px-3 py-1.5 rounded-sm transition-all cursor-pointer flex items-center gap-1 ${
                    viewMode === 'preview'
                      ? 'bg-white shadow-sm text-indigo-600 font-bold'
                      : 'text-slate-500 hover:text-slate-700'
                  }`}
                >
                  <Eye className="w-3.5 h-3.5" />
                  Preview
                </button>
                <button
                  type="button"
                  onClick={() => setViewMode('both')}
                  className={`px-3 py-1.5 rounded-sm transition-all cursor-pointer flex items-center gap-1 ${
                    viewMode === 'both'
                      ? 'bg-white shadow-sm text-indigo-600 font-bold'
                      : 'text-slate-500 hover:text-slate-700'
                  }`}
                >
                  <Columns2 className="w-3.5 h-3.5" />
                  Keduanya
                </button>
              </div>

              <button
                type="button"
                onClick={handlePrint}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-sm border border-slate-200 text-slate-700 bg-white hover:bg-slate-50 transition-all shadow-sm cursor-pointer"
              >
                <Printer className="w-3.5 h-3.5 text-indigo-600" />
                Cetak / PDF
              </button>

              <Button
                type="button"
                disabled={saving}
                onClick={handleSaveToSuratKeluar}
                className="rounded-sm bg-indigo-600 hover:bg-indigo-700 text-white font-semibold flex items-center gap-1.5 shadow-md shadow-indigo-100 text-xs px-3.5 py-1.5 cursor-pointer disabled:opacity-50"
              >
                {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
                {saving ? 'Menyimpan...' : 'Simpan ke Surat Keluar'}
              </Button>
            </div>
          </div>
        </DialogHeader>

        {/* Notifications */}
        {error && (
          <div className="text-xs font-medium text-rose-600 bg-rose-50 border border-rose-200 p-2.5 rounded-sm my-1 shrink-0">
            {error}
          </div>
        )}
        {saveSuccess && (
          <div className="text-xs font-medium text-emerald-700 bg-emerald-50 border border-emerald-200 p-2.5 rounded-sm my-1 shrink-0">
            {saveSuccess}
          </div>
        )}

        {/* Template Selector Bar */}
        <div className="py-2.5 shrink-0 flex items-center gap-2 overflow-x-auto border-b border-slate-100">
          <span className="text-xs font-semibold text-slate-500 shrink-0">Pilih Template:</span>
          {TEMPLATE_OPTIONS.map((tpl) => (
            <button
              key={tpl.id}
              type="button"
              onClick={() => handleTemplateChange(tpl.id)}
              className={`text-xs px-3 py-1.5 rounded-sm border transition-all shrink-0 cursor-pointer font-semibold ${
                draft.templateType === tpl.id
                  ? 'bg-indigo-50 border-indigo-300 text-indigo-700 font-bold shadow-xs'
                  : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50'
              }`}
            >
              {tpl.title}
            </button>
          ))}
        </div>

        {/* Content Body */}
        <div className="flex-1 min-h-0 py-3 overflow-hidden">
          {viewMode === 'both' ? (
            <div className="h-full flex flex-col lg:flex-row gap-6 min-h-0">
              {/* Left Column: Form Fields */}
              <div className="w-full lg:w-[45%] xl:w-[42%] h-full overflow-y-auto pr-3">
                {renderEditorForm()}
              </div>

              {/* Right Column: Live A4 Visual Preview */}
              <div className="w-full lg:w-[55%] xl:w-[58%] h-full bg-slate-100/90 rounded-md p-4 sm:p-6 overflow-auto flex justify-center items-start border border-slate-200">
                {renderPreviewPaper()}
              </div>
            </div>
          ) : viewMode === 'edit' ? (
            <div className="h-full overflow-y-auto max-w-3xl mx-auto w-full px-2">
              {renderEditorForm()}
            </div>
          ) : (
            <div className="h-full bg-slate-100/90 rounded-md p-4 sm:p-6 overflow-auto flex justify-center items-start border border-slate-200">
              {renderPreviewPaper()}
            </div>
          )}
        </div>

        {/* Footer */}
        <DialogFooter className="pt-3 border-t border-slate-100 shrink-0">
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
