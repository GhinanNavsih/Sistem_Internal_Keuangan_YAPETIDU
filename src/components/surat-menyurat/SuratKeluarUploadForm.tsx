"use client";

import React, { useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { AutoResizeTextarea } from '@/components/ui/auto-resize-textarea';
import { OptionSelect } from '@/components/ui/option-select';
import { useAuth } from '@/lib/AuthContext';
import { KATEGORI_SURAT_KELUAR } from '@/lib/surat-menyurat/constants';
import type { ExtractedSuratKeluar } from '@/lib/surat-menyurat/extractSuratKeluar';
import type { SuratAttachment, SuratKeluar } from '@/lib/surat-menyurat/types';
import { UPLOAD_ACCEPT, UPLOAD_TYPES_TEXT, uploadFileProblem } from '@/lib/uploadFileTypes';
import { AlertCircle, ArrowLeft, FileText, Loader2, Trash2, Upload } from 'lucide-react';
import IndonesianDatePicker from './IndonesianDatePicker';

interface Props {
  /** A letter already recorded from a scan, being corrected. */
  surat?: SuratKeluar | null;
  targetSatkerId?: string;
  /** Back to writing the letter in the editor; absent when correcting a recorded scan. */
  onBack?: () => void;
  onClose: () => void;
  onSaved: (data: SuratKeluar) => void;
}

/**
 * Records an outgoing letter from a scan or photo of the signed original: the file is uploaded, the AI reads
 * its number, date, recipient and subject, and the person checks them before saving.
 */
export default function SuratKeluarUploadForm({ surat = null, targetSatkerId, onBack, onClose, onSaved }: Props) {
  const { user } = useAuth();
  const fileInput = useRef<HTMLInputElement>(null);
  const isEdit = Boolean(surat);
  const today = new Date().toISOString().slice(0, 10);

  const [nomorSurat, setNomorSurat] = useState(surat?.nomorSurat || '');
  const [tanggalSurat, setTanggalSurat] = useState(surat?.tanggalSurat || today);
  const [tujuan, setTujuan] = useState(surat?.tujuan || '');
  const [perihal, setPerihal] = useState(surat?.perihal || '');
  const [lampiran, setLampiran] = useState(surat?.lampiranKeterangan || '');
  const [penandatanganNama, setPenandatanganNama] = useState(surat?.penandatanganNama || '');
  const [penandatanganJabatan, setPenandatanganJabatan] = useState(surat?.penandatanganJabatan || '');
  const [kategori, setKategori] = useState(surat?.kategori || 'Lainnya');
  const [ringkasan, setRingkasan] = useState(surat?.ringkasan || '');
  const [attachments, setAttachments] = useState<SuratAttachment[]>(surat?.attachments || []);

  const [uploading, setUploading] = useState(false);
  const [analyzing, setAnalyzing] = useState(false);
  const [analysisMessage, setAnalysisMessage] = useState('');
  const [dragActive, setDragActive] = useState(false);
  const [fieldsRevealed, setFieldsRevealed] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const busy = uploading || analyzing;
  // A new letter starts as one big upload area; the fields appear once the letter is read (or on request).
  const showFields = isEdit || fieldsRevealed || (attachments.length > 0 && !busy);

  const uploadFiles = async (files: File[]) => {
    if (files.length === 0 || !user || busy) return;
    const initial = { nomorSurat, tanggalSurat, tujuan, perihal, lampiran, penandatanganNama, penandatanganJabatan, ringkasan };
    let first: File | null = null;
    try {
      setUploading(true);
      setError('');
      setAnalysisMessage('');
      const idToken = await user.getIdToken();
      for (const file of files) {
        const problem = uploadFileProblem(file, 10 * 1024 * 1024);
        if (problem) throw new Error(`${file.name}: ${problem}`);
        const body = new FormData();
        body.append('file', file);
        const res = await fetch('/api/satker-surat/upload', { method: 'POST', headers: { Authorization: `Bearer ${idToken}` }, body });
        const json = await res.json();
        if (!res.ok || !json.ok) throw new Error(json.error || `Gagal mengunggah file ${file.name}`);
        setAttachments((prev) => [...prev, json.attachment]);
        if (!first) first = file;
      }
      if (first) {
        setAnalyzing(true);
        try {
          const data = new FormData();
          data.append('file', first);
          data.append('type', 'keluar');
          const response = await fetch('/api/satker-surat/parse', { method: 'POST', headers: { Authorization: `Bearer ${idToken}` }, body: data });
          const result = await response.json();
          if (!response.ok || !result.ok) throw new Error(result.error || 'Analisis surat gagal.');
          const read = result.data as ExtractedSuratKeluar;
          // The AI only fills what is still empty (or still the default date), never what the person typed.
          const fill = (value: string, current: string, set: (next: string) => void) => {
            if (value && !current.trim()) set(value);
          };
          fill(read.nomorSurat, initial.nomorSurat, setNomorSurat);
          fill(read.tujuan, initial.tujuan, setTujuan);
          fill(read.perihal, initial.perihal, setPerihal);
          fill(read.lampiranKeterangan, initial.lampiran, setLampiran);
          fill(read.penandatanganNama, initial.penandatanganNama, setPenandatanganNama);
          fill(read.penandatanganJabatan, initial.penandatanganJabatan, setPenandatanganJabatan);
          fill(read.ringkasan, initial.ringkasan, setRingkasan);
          if (read.tanggalSurat && (!initial.tanggalSurat || (!isEdit && initial.tanggalSurat === today))) setTanggalSurat(read.tanggalSurat);
          setAnalysisMessage(Object.values(read).some(Boolean) ? 'Analisis selesai. Periksa dan lengkapi data sebelum menyimpan.' : 'Informasi surat tidak terbaca. Isi data secara manual atau coba berkas lain.');
        } catch (err: unknown) {
          setAnalysisMessage(`Berkas sudah diunggah, tetapi analisis gagal: ${err instanceof Error ? err.message : 'Silakan isi data secara manual.'}`);
        } finally {
          setAnalyzing(false);
          setFieldsRevealed(true);
        }
      }
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Gagal mengunggah berkas.');
    } finally {
      setUploading(false);
    }
  };

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!user) return;
    if (attachments.length === 0) return setError('Unggah berkas surat yang telah ditandatangani.');
    if (!nomorSurat.trim()) return setError('Nomor surat wajib diisi.');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(tanggalSurat)) return setError('Tanggal surat wajib diisi.');
    if (!tujuan.trim()) return setError('Tujuan surat wajib diisi.');
    if (!perihal.trim()) return setError('Perihal surat wajib diisi.');

    try {
      setSaving(true);
      setError('');
      const idToken = await user.getIdToken();
      const payload = {
        ...(surat ? { id: surat.id } : { type: 'keluar', institutionScope: 'UNIPDU', sifat: 'biasa', ...(targetSatkerId ? { satkerId: targetSatkerId } : {}) }),
        kategori,
        nomorSurat: nomorSurat.trim(),
        tanggalSurat,
        tujuan: tujuan.trim(),
        perihal: perihal.trim(),
        lampiranKeterangan: lampiran.trim(),
        penandatanganNama: penandatanganNama.trim(),
        penandatanganJabatan: penandatanganJabatan.trim(),
        ringkasan: ringkasan.trim(),
        attachments,
      };
      const res = await fetch('/api/satker-surat', {
        method: surat ? 'PUT' : 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${idToken}` },
        body: JSON.stringify(payload),
      });
      const json = await res.json();
      if (!res.ok || !json.ok) throw new Error(json.error || 'Gagal menyimpan surat keluar.');
      onSaved(json.data);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Terjadi kesalahan saat menyimpan.');
    } finally {
      setSaving(false);
    }
  };

  const inputClass = 'rounded-sm bg-white border-slate-200 text-xs h-9';

  return (
    <form onSubmit={handleSubmit} className="rounded-md border border-slate-200 bg-white p-6 shadow-sm space-y-5 text-left">
      <div className="flex items-center justify-between pb-3 border-b border-slate-100">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-sm bg-sky-50 border border-sky-100 flex items-center justify-center text-sky-600">
            <Upload className="w-4 h-4" />
          </div>
          <div>
            <h3 className="text-sm font-bold text-slate-800">{isEdit ? `Edit Surat Keluar: ${surat?.nomorSurat}` : 'Unggah Surat Keluar'}</h3>
            <p className="text-[11px] text-slate-400">Unggah surat yang sudah ditandatangani dan dipindai, data agenda terisi otomatis oleh AI</p>
          </div>
        </div>
        {onBack && (
          <button type="button" onClick={onBack} className="inline-flex items-center gap-1.5 rounded-sm px-2.5 py-1.5 text-xs font-semibold text-slate-600 hover:bg-slate-100 cursor-pointer">
            <ArrowLeft className="size-3.5" />
            Kembali ke editor
          </button>
        )}
      </div>

      {error && (
        <div className="flex items-center gap-2 p-3 rounded-md bg-rose-50 border border-rose-200 text-rose-700 text-xs">
          <AlertCircle className="w-4 h-4 shrink-0" />
          <span>{error}</span>
        </div>
      )}
      {analysisMessage && <div role="status" className="rounded-sm border border-sky-200 bg-sky-50 p-2.5 text-xs text-sky-800">{analysisMessage}</div>}

      <input
        ref={fileInput}
        type="file"
        accept={UPLOAD_ACCEPT}
        multiple
        onChange={(event) => {
          const files = Array.from(event.target.files ?? []);
          event.target.value = '';
          void uploadFiles(files);
        }}
        className="hidden"
      />

      {!showFields && (
        <div>
          <button
            type="button"
            disabled={busy}
            onClick={() => fileInput.current?.click()}
            onDragOver={(event) => {
              event.preventDefault();
              if (!busy) setDragActive(true);
            }}
            onDragLeave={() => setDragActive(false)}
            onDrop={(event) => {
              event.preventDefault();
              setDragActive(false);
              void uploadFiles(Array.from(event.dataTransfer.files));
            }}
            className={`flex w-full flex-col items-center justify-center gap-3 rounded-lg border-2 border-dashed px-6 py-16 text-center transition-colors cursor-pointer disabled:cursor-wait ${
              dragActive ? 'border-sky-500 bg-sky-50' : 'border-slate-300 bg-slate-50/60 hover:border-sky-400 hover:bg-sky-50/50'
            }`}
          >
            {busy ? (
              <>
                <Loader2 className="size-10 animate-spin text-sky-600" />
                <span className="text-base font-semibold text-slate-800">{analyzing ? 'Membaca surat dengan AI...' : 'Mengunggah surat...'}</span>
                <span className="text-xs text-slate-500">Data surat akan terisi otomatis. Mohon tunggu sebentar.</span>
              </>
            ) : (
              <>
                <span className="flex size-14 items-center justify-center rounded-full bg-sky-100 text-sky-600">
                  <Upload className="size-7" />
                </span>
                <span className="text-base font-semibold text-slate-800">Unggah Surat</span>
                <span className="text-xs text-slate-500">Klik atau tarik berkas surat ke sini. AI akan membaca surat dan mengisi data secara otomatis.</span>
                <span className="text-[11px] text-slate-400">Format: {UPLOAD_TYPES_TEXT} (Maks 10MB)</span>
              </>
            )}
          </button>
          <button type="button" disabled={busy} onClick={() => setFieldsRevealed(true)} className="mx-auto mt-3 block text-xs font-semibold text-sky-700 hover:underline disabled:opacity-50 cursor-pointer">
            Isi data secara manual
          </button>
        </div>
      )}

      {showFields && (
        <>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            <div>
              <Label className="text-xs font-semibold text-slate-700 block mb-1.5">Nomor Surat *</Label>
              <Input value={nomorSurat} onChange={(e) => setNomorSurat(e.target.value)} placeholder="cth: 185/B.1/AAK/11/2026" className={`${inputClass} font-mono`} required />
            </div>
            <div>
              <Label htmlFor="keluar-upload-tanggal" className="text-xs font-semibold text-slate-700 block mb-1.5">Tanggal Surat *</Label>
              <IndonesianDatePicker id="keluar-upload-tanggal" label="Tanggal Surat" value={tanggalSurat} onValueChange={setTanggalSurat} required />
            </div>
            <div>
              <Label htmlFor="keluar-upload-kategori" className="text-xs font-semibold text-slate-700 block mb-1.5">Kategori</Label>
              <OptionSelect id="keluar-upload-kategori" value={kategori} onValueChange={setKategori} options={KATEGORI_SURAT_KELUAR.map((item) => ({ value: item, label: item }))} size="sm" className="w-full" />
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <Label className="text-xs font-semibold text-slate-700 block mb-1.5">Tujuan Surat (Kepada Yth.) *</Label>
              <Input value={tujuan} onChange={(e) => setTujuan(e.target.value)} placeholder="cth: Bapak/Ibu Dosen UNIPDU" className={inputClass} required />
            </div>
            <div>
              <Label className="text-xs font-semibold text-slate-700 block mb-1.5">Perihal / Hal *</Label>
              <Input value={perihal} onChange={(e) => setPerihal(e.target.value)} placeholder="cth: Undangan Rapat" className={inputClass} required />
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div>
              <Label className="text-xs font-semibold text-slate-700 block mb-1.5">Lampiran</Label>
              <Input value={lampiran} onChange={(e) => setLampiran(e.target.value)} placeholder="cth: 1 (satu) berkas" className={inputClass} />
            </div>
            <div>
              <Label className="text-xs font-semibold text-slate-700 block mb-1.5">Nama Penandatangan</Label>
              <Input value={penandatanganNama} onChange={(e) => setPenandatanganNama(e.target.value)} className={inputClass} />
            </div>
            <div>
              <Label className="text-xs font-semibold text-slate-700 block mb-1.5">Jabatan Penandatangan</Label>
              <Input value={penandatanganJabatan} onChange={(e) => setPenandatanganJabatan(e.target.value)} className={inputClass} />
            </div>
          </div>

          <div>
            <Label className="text-xs font-semibold text-slate-700 block mb-1.5">Ringkasan Isi Surat</Label>
            <AutoResizeTextarea
              value={ringkasan}
              onChange={(e) => setRingkasan(e.target.value)}
              placeholder="Ringkasan atau catatan poin penting surat keluar..."
              minRows={3}
              className="w-full rounded-sm bg-white border border-slate-200 text-xs p-3 text-slate-700 outline-none focus:border-indigo-500 focus:ring-4 focus:ring-indigo-100 transition-all"
            />
          </div>

          <div>
            <div className="flex items-center justify-between mb-2">
              <Label className="text-xs font-semibold text-slate-700">Berkas Surat (hasil pindai) *</Label>
              <span className="text-[11px] text-slate-400">Format: {UPLOAD_TYPES_TEXT} (Maks 10MB)</span>
            </div>
            {attachments.length > 0 && (
              <div className="space-y-2 mb-3">
                {attachments.map((file) => (
                  <div key={file.id} className="flex items-center justify-between p-2.5 rounded-sm bg-slate-50 border border-slate-200 text-xs">
                    <div className="flex items-center gap-2 truncate max-w-[80%]">
                      <FileText className="w-4 h-4 text-sky-600 shrink-0" />
                      <a href={file.url} target="_blank" rel="noopener noreferrer" className="font-medium text-sky-600 hover:underline truncate">
                        {file.name}
                      </a>
                      <span className="text-[10px] text-slate-400">({Math.round(file.size / 1024)} KB)</span>
                    </div>
                    <button type="button" onClick={() => setAttachments((prev) => prev.filter((item) => item.id !== file.id))} className="text-rose-600 hover:text-rose-800 p-1 rounded-sm hover:bg-rose-50 transition-colors cursor-pointer" title="Hapus berkas">
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                ))}
              </div>
            )}
            <Button type="button" variant="outline" disabled={busy} onClick={() => fileInput.current?.click()} className="rounded-sm border-dashed border-slate-300 text-slate-600 hover:bg-slate-50 text-xs h-9 flex items-center gap-2 shadow-xs cursor-pointer">
              {analyzing ? (
                <>
                  <Loader2 className="w-3.5 h-3.5 animate-spin text-sky-600" /> Menganalisis surat...
                </>
              ) : uploading ? (
                <>
                  <Loader2 className="w-3.5 h-3.5 animate-spin text-sky-600" /> Mengunggah...
                </>
              ) : (
                <>
                  <Upload className="w-3.5 h-3.5 text-slate-400" /> Unggah Berkas Lain
                </>
              )}
            </Button>
          </div>
        </>
      )}

      <div className="flex items-center justify-end gap-3 pt-3 border-t border-slate-100">
        <Button type="button" variant="outline" onClick={onClose} disabled={saving} className="rounded-sm border-slate-200 text-slate-600 hover:bg-slate-50 text-xs h-9 cursor-pointer">
          Batal
        </Button>
        {showFields && (
          <Button type="submit" disabled={saving || busy} className="rounded-sm bg-sky-600 hover:bg-sky-700 text-white text-xs font-semibold h-9 flex items-center gap-2 shadow-sm cursor-pointer">
            {saving ? (
              <>
                <Loader2 className="w-3.5 h-3.5 animate-spin" /> Menyimpan...
              </>
            ) : isEdit ? (
              'Simpan Perubahan'
            ) : (
              'Catat Surat Keluar'
            )}
          </Button>
        )}
      </div>
    </form>
  );
}
