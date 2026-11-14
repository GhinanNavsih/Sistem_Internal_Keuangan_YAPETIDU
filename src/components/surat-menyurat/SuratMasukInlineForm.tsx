"use client";

import React, { useState, useEffect, useRef } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { AutoResizeTextarea } from '@/components/ui/auto-resize-textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useAuth } from '@/lib/AuthContext';
import {
  STATUS_SURAT_MASUK_OPTIONS,
  KATEGORI_SURAT_MASUK,
  INSTITUTION_SCOPES,
  KLASIFIKASI_KEARSIPAN_POPULAR,
} from '@/lib/surat-menyurat/constants';
import { formatKodeArsip } from '@/lib/surat-menyurat/numbering';
import {
  InstitutionScope,
  SifatSurat,
  StatusSuratMasuk,
  SuratAttachment,
  SuratMasuk,
} from '@/lib/surat-menyurat/types';
import { UPLOAD_ACCEPT, UPLOAD_TYPES_TEXT, uploadFileProblem } from '@/lib/uploadFileTypes';
import type { ExtractedSuratMasuk } from '@/lib/surat-menyurat/extractSuratMasuk';
import { AlertCircle, FileText, Loader2, Paperclip, Pencil, Plus, Trash2, Upload, X } from 'lucide-react';

interface Props {
  suratToEdit?: SuratMasuk | null;
  defaultSatkerName: string;
  targetSatkerId?: string;
  onCancel: () => void;
  onSuccess: (data: SuratMasuk) => void;
}

export default function SuratMasukInlineForm({
  suratToEdit,
  defaultSatkerName,
  targetSatkerId,
  onCancel,
  onSuccess,
}: Props) {
  const { user } = useAuth();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [institutionScope, setInstitutionScope] = useState<InstitutionScope>('UNIPDU');
  const [nomorUrut, setNomorUrut] = useState<number>(1);
  const [kodeSurat, setKodeSurat] = useState('BU');
  const [kodeArsip, setKodeArsip] = useState('');
  const [klasifikasiCode, setKlasifikasiCode] = useState('100');

  const [nomorSurat, setNomorSurat] = useState('');
  const [tanggalSurat, setTanggalSurat] = useState('');
  const [tanggalDiterima, setTanggalDiterima] = useState('');
  const [pengirim, setPengirim] = useState('');
  const [penerima, setPenerima] = useState('');
  const [perihal, setPerihal] = useState('');
  const [sifat, setSifat] = useState<SifatSurat>('biasa');
  const [kategori, setKategori] = useState(KATEGORI_SURAT_MASUK[0]);
  const [ringkasan, setRingkasan] = useState('');
  const [status, setStatus] = useState<StatusSuratMasuk>('menunggu_disposisi');
  const [attachments, setAttachments] = useState<SuratAttachment[]>([]);

  const [uploading, setUploading] = useState(false);
  const [analyzing, setAnalyzing] = useState(false);
  const [analysisMessage, setAnalysisMessage] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const isEdit = Boolean(suratToEdit);

  useEffect(() => {
    if (suratToEdit) {
      setInstitutionScope(suratToEdit.institutionScope || 'UNIPDU');
      setNomorUrut(suratToEdit.nomorUrut || 1);
      setKodeSurat(suratToEdit.kodeSurat || 'BU');
      setKodeArsip(suratToEdit.kodeArsip || '');

      setNomorSurat(suratToEdit.nomorSurat || '');
      setTanggalSurat(suratToEdit.tanggalSurat || '');
      setTanggalDiterima(suratToEdit.tanggalDiterima || '');
      setPengirim(suratToEdit.pengirim || '');
      setPenerima(suratToEdit.penerima || '');
      setPerihal(suratToEdit.perihal || '');
      setSifat(suratToEdit.sifat || 'biasa');
      setKategori(suratToEdit.kategori || KATEGORI_SURAT_MASUK[0]);
      setRingkasan(suratToEdit.ringkasan || '');
      setStatus(suratToEdit.status || 'menunggu_disposisi');
      setAttachments(suratToEdit.attachments || []);
    } else {
      const today = new Date().toISOString().slice(0, 10);
      const initialScope: InstitutionScope = 'UNIPDU';

      setInstitutionScope(initialScope);
      setNomorUrut(1);
      setKodeSurat('BU');
      setKlasifikasiCode('100');
      const autoArsip = formatKodeArsip({
        type: 'masuk',
        institutionScope: initialScope,
        sequenceNumber: 1,
        klasifikasiCode: '100',
      });
      setKodeArsip(autoArsip);

      setNomorSurat('');
      setTanggalSurat(today);
      setTanggalDiterima(today);
      setPengirim('');
      setPenerima(`Kepala ${defaultSatkerName || 'SatKer'}`);
      setPerihal('');
      setSifat('biasa');
      setKategori(KATEGORI_SURAT_MASUK[0]);
      setRingkasan('');
      setStatus('menunggu_disposisi');
      setAttachments([]);
    }
    setError('');
  }, [suratToEdit, defaultSatkerName]);

  const handleUpdateArsip = (seq: number, klas: string) => {
    const auto = formatKodeArsip({
      type: 'masuk',
      institutionScope,
      sequenceNumber: seq,
      klasifikasiCode: klas,
    });
    setKodeArsip(auto);
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0 || !user) return;

    const initial = { nomorSurat, tanggalSurat, pengirim, penerima, perihal, ringkasan };
    let firstUploaded: File | null = null;
    try {
      setUploading(true);
      setError('');
      setAnalysisMessage('');
      const idToken = await user.getIdToken();

      for (let i = 0; i < files.length; i++) {
        const file = files[i];

        const problem = uploadFileProblem(file, 10 * 1024 * 1024);
        if (problem) {
          throw new Error(`${file.name}: ${problem}`);
        }

        const formData = new FormData();
        formData.append('file', file);

        const res = await fetch('/api/satker-surat/upload', {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${idToken}`,
          },
          body: formData,
        });

        const json = await res.json();
        if (!res.ok || !json.ok) {
          throw new Error(json.error || `Gagal mengunggah file ${file.name}`);
        }

        setAttachments((prev) => [...prev, json.attachment]);
        if (!firstUploaded) firstUploaded = file;
      }
      if (firstUploaded) {
        setAnalyzing(true);
        try {
          const data = new FormData();
          data.append('file', firstUploaded);
          const response = await fetch('/api/satker-surat/parse', { method: 'POST', headers: { Authorization: `Bearer ${idToken}` }, body: data });
          const result = await response.json();
          if (!response.ok || !result.ok) throw new Error(result.error || 'Analisis surat gagal.');
          const extracted = result.data as ExtractedSuratMasuk;
          const today = new Date().toISOString().slice(0, 10);
          if (extracted.nomorSurat && !initial.nomorSurat.trim()) setNomorSurat((prev) => prev === initial.nomorSurat ? extracted.nomorSurat : prev);
          if (!initial.tanggalSurat || (!isEdit && initial.tanggalSurat === today)) setTanggalSurat((prev) => prev === initial.tanggalSurat ? extracted.tanggalSurat : prev);
          if (extracted.pengirim && !initial.pengirim.trim()) setPengirim((prev) => prev === initial.pengirim ? extracted.pengirim : prev);
          if (extracted.penerima && (!initial.penerima.trim() || (!isEdit && initial.penerima === `Kepala ${defaultSatkerName || 'SatKer'}`))) setPenerima((prev) => prev === initial.penerima ? extracted.penerima : prev);
          if (extracted.perihal && !initial.perihal.trim()) setPerihal((prev) => prev === initial.perihal ? extracted.perihal : prev);
          if (extracted.ringkasan && !initial.ringkasan.trim()) setRingkasan((prev) => prev === initial.ringkasan ? extracted.ringkasan : prev);
          setAnalysisMessage(Object.values(extracted).some(Boolean) ? 'Analisis selesai. Periksa dan lengkapi data sebelum menyimpan.' : 'Informasi surat tidak terbaca. Isi data secara manual atau coba berkas lain.');
        } catch (err: unknown) {
          setAnalysisMessage(`Berkas sudah diunggah, tetapi analisis gagal: ${err instanceof Error ? err.message : 'Silakan isi data secara manual.'}`);
        } finally {
          setAnalyzing(false);
        }
      }
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Gagal mengunggah berkas.');
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const handleRemoveAttachment = (attId: string) => {
    setAttachments((prev) => prev.filter((a) => a.id !== attId));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user) return;

    if (!nomorSurat.trim()) {
      setError('Nomor surat wajib diisi.');
      return;
    }
    if (!tanggalSurat) {
      setError('Tanggal surat wajib diisi.');
      return;
    }
    if (!tanggalDiterima) {
      setError('Tanggal diterima wajib diisi.');
      return;
    }
    if (!pengirim.trim()) {
      setError('Pengirim surat wajib diisi.');
      return;
    }
    if (!perihal.trim()) {
      setError('Perihal surat wajib diisi.');
      return;
    }

    try {
      setSaving(true);
      setError('');
      const idToken = await user.getIdToken();

      const payload = {
        ...(isEdit && suratToEdit ? { id: suratToEdit.id } : {}),
        type: 'masuk',
        institutionScope,
        nomorUrut,
        kodeSurat,
        kodeArsip: kodeArsip.trim() || undefined,
        nomorSurat: nomorSurat.trim(),
        tanggalSurat,
        tanggalDiterima,
        pengirim: pengirim.trim(),
        penerima: (penerima.trim() || `Kepala ${defaultSatkerName}`),
        perihal: perihal.trim(),
        sifat,
        kategori,
        ringkasan: ringkasan.trim(),
        status,
        attachments,
        ...(targetSatkerId ? { satkerId: targetSatkerId } : {}),
      };

      const res = await fetch('/api/satker-surat', {
        method: isEdit ? 'PUT' : 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${idToken}`,
        },
        body: JSON.stringify(payload),
      });

      const json = await res.json();
      if (!res.ok || !json.ok) {
        throw new Error(json.error || 'Gagal menyimpan surat masuk.');
      }

      onSuccess(json.data);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Terjadi kesalahan saat menyimpan.');
    } finally {
      setSaving(false);
    }
  };

  const statusLabel = STATUS_SURAT_MASUK_OPTIONS.find((opt) => opt.value === status)?.label || 'Menunggu Disposisi';

  return (
    <form
      onSubmit={handleSubmit}
      className="rounded-md border border-slate-200 bg-white p-6 shadow-sm space-y-5 text-left"
    >
      {/* Header Bar */}
      <div className="flex items-center justify-between pb-3 border-b border-slate-100">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-sm bg-sky-50 border border-sky-100 flex items-center justify-center text-sky-600">
            {isEdit ? <Pencil className="w-4 h-4" /> : <Plus className="w-4 h-4" />}
          </div>
          <div>
            <h3 className="text-sm font-bold text-slate-800">
              {isEdit ? `Edit Surat Masuk: ${suratToEdit?.nomorSurat}` : 'Catat Surat Masuk (Buku Agenda)'}
            </h3>
            <p className="text-[11px] text-slate-400">
              {isEdit
                ? 'Perbarui data naskah masuk dan kelengkapan arsip'
                : 'Pencatatan agenda surat masuk dan penomoran kode klasifikasi kearsipan'}
            </p>
          </div>
        </div>
        <button
          type="button"
          onClick={onCancel}
          className="text-slate-400 hover:text-slate-600 p-1 rounded-sm hover:bg-slate-100 transition-colors cursor-pointer"
          title="Tutup formulir"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      {/* Error Banner */}
      {error && (
        <div className="flex items-center gap-2 p-3 rounded-md bg-rose-50 border border-rose-200 text-rose-700 text-xs">
          <AlertCircle className="w-4 h-4 shrink-0" />
          <span>{error}</span>
        </div>
      )}
      {analysisMessage && <div role="status" className="rounded-sm border border-sky-200 bg-sky-50 p-2.5 text-xs text-sky-800">{analysisMessage}</div>}

      {/* Agenda & Klasifikasi Strip */}
      <div className={`p-4 bg-slate-50 border border-slate-200 rounded-sm grid grid-cols-1 sm:grid-cols-2 ${isEdit ? 'lg:grid-cols-4' : 'lg:grid-cols-3'} gap-4`}>
        {isEdit && <div>
          <Label className="text-xs font-semibold text-slate-700 block mb-1.5">Institusi / Lingkup</Label>
          <Select
            value={institutionScope}
            onValueChange={(val) => {
              if (val) {
                setInstitutionScope(val as InstitutionScope);
              }
            }}
          >
            <SelectTrigger className="w-full rounded-sm bg-white border-slate-200 text-xs h-9">
              <SelectValue />
            </SelectTrigger>
            <SelectContent className="rounded-md border border-slate-200 bg-white p-1 shadow-xl">
              {INSTITUTION_SCOPES.map((scope) => (
                <SelectItem
                  key={scope.id}
                  value={scope.id}
                  className="rounded-sm py-2 pr-8 pl-3 text-xs font-medium text-slate-700 focus:bg-indigo-50 focus:text-indigo-900"
                >
                  {scope.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>}

        <div>
          <Label className="text-xs font-semibold text-slate-700 block mb-1.5">No. Urut Agenda</Label>
          <Input
            type="number"
            min={1}
            value={nomorUrut}
            onChange={(e) => {
              const val = parseInt(e.target.value, 10) || 1;
              setNomorUrut(val);
              handleUpdateArsip(val, klasifikasiCode);
            }}
            className="rounded-sm bg-white border-slate-200 text-xs h-9 font-mono"
            required
          />
        </div>

        <div>
          <Label className="text-xs font-semibold text-slate-700 block mb-1.5">Klasifikasi Kearsipan (000-900)</Label>
          <Select
            value={klasifikasiCode}
            onValueChange={(val) => {
              if (val) {
                setKlasifikasiCode(val);
                handleUpdateArsip(nomorUrut, val);
              }
            }}
          >
            <SelectTrigger className="w-full min-h-9 h-auto rounded-sm bg-white border-slate-200 text-xs whitespace-normal *:data-[slot=select-value]:line-clamp-none">
              <SelectValue>{KLASIFIKASI_KEARSIPAN_POPULAR.find((item) => item.code === klasifikasiCode)?.name || klasifikasiCode}</SelectValue>
            </SelectTrigger>
            <SelectContent className="rounded-md border border-slate-200 bg-white p-1 shadow-xl max-h-56">
              {KLASIFIKASI_KEARSIPAN_POPULAR.map((k) => (
                <SelectItem
                  key={k.code}
                  value={k.code}
                  className="rounded-sm py-2 pr-8 pl-3 text-xs font-medium text-slate-700 focus:bg-indigo-50 focus:text-indigo-900"
                >
                  {k.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div>
          <Label className="text-xs font-semibold text-slate-700 block mb-1.5">Kode Arsip Fisik</Label>
          <Input
            value={kodeArsip}
            onChange={(e) => setKodeArsip(e.target.value)}
            placeholder="A.1.R1.100,01"
            className="rounded-sm bg-white border-slate-200 text-xs h-9 font-mono font-bold text-sky-800"
          />
        </div>
      </div>

      {/* Row 1: Nomor Surat Pengirim, Tanggal Surat, Tanggal Diterima, Status */}
      <div className={`grid grid-cols-1 sm:grid-cols-2 ${isEdit ? "lg:grid-cols-4" : "lg:grid-cols-3"} gap-4`}>
        <div>
          <Label className="text-xs font-semibold text-slate-700 block mb-1.5">Nomor Surat Pengirim *</Label>
          <Input
            value={nomorSurat}
            onChange={(e) => setNomorSurat(e.target.value)}
            placeholder="cth: 001/PJM/Unipdu/I/2026"
            className="rounded-sm bg-white border-slate-200 text-xs h-9 font-mono"
            required
          />
        </div>

        <div>
          <Label className="text-xs font-semibold text-slate-700 block mb-1.5">Tanggal Surat *</Label>
          <Input
            type="date"
            value={tanggalSurat}
            onChange={(e) => setTanggalSurat(e.target.value)}
            className="rounded-sm bg-white border-slate-200 text-xs h-9"
            required
          />
        </div>

        <div>
          <Label className="text-xs font-semibold text-slate-700 block mb-1.5">Tanggal Diterima *</Label>
          <Input
            type="date"
            value={tanggalDiterima}
            onChange={(e) => setTanggalDiterima(e.target.value)}
            className="rounded-sm bg-white border-slate-200 text-xs h-9"
            required
          />
        </div>

        {isEdit && (
          <div>
            <Label className="text-xs font-semibold text-slate-700 block mb-1.5">Status Penanganan</Label>
            <Select value={status} onValueChange={(val) => val && setStatus(val as StatusSuratMasuk)}>
              <SelectTrigger className="w-full rounded-sm bg-white border-slate-200 text-xs h-9">
                <SelectValue>{statusLabel}</SelectValue>
              </SelectTrigger>
              <SelectContent className="rounded-md border border-slate-200 bg-white p-1 shadow-xl">
                {STATUS_SURAT_MASUK_OPTIONS.map((opt) => (
                  <SelectItem
                    key={opt.value}
                    value={opt.value}
                    className="rounded-sm py-2 pr-8 pl-3 text-xs font-medium text-slate-700 focus:bg-indigo-50 focus:text-indigo-900"
                  >
                    {opt.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}
      </div>

      {/* Row 2: Pengirim & Penerima */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div>
          <Label className="text-xs font-semibold text-slate-700 block mb-1.5">Pengirim Surat / Lembaga Asal *</Label>
          <Input
            value={pengirim}
            onChange={(e) => setPengirim(e.target.value)}
            placeholder="cth: LLDIKTI Wilayah VII / Dinas Pendidikan / LPPM Unipdu"
            className="rounded-sm bg-white border-slate-200 text-xs h-9"
            required
          />
        </div>

        <div>
          <Label className="text-xs font-semibold text-slate-700 block mb-1.5">Ditujukan Kepada</Label>
          <Input
            value={penerima}
            onChange={(e) => setPenerima(e.target.value)}
            placeholder={`cth: Rektor UNIPDU / Kepala ${defaultSatkerName}`}
            className="rounded-sm bg-white border-slate-200 text-xs h-9"
          />
        </div>
      </div>

      {/* Row 3: Perihal */}
      <div>
        <div>
          <Label className="text-xs font-semibold text-slate-700 block mb-1.5">Perihal / Hal Surat *</Label>
          <Input
            value={perihal}
            onChange={(e) => setPerihal(e.target.value)}
            placeholder="cth: Undangan Sosialisasi / Permohonan Kerjasama / SK Dosen"
            className="rounded-sm bg-white border-slate-200 text-xs h-9"
            required
          />
        </div>

      </div>

      {/* Row 4: Ringkasan */}
      <div>
        <Label className="text-xs font-semibold text-slate-700 block mb-1.5">Ringkasan Isi Surat</Label>
        <AutoResizeTextarea
          value={ringkasan}
          onChange={(e) => setRingkasan(e.target.value)}
          placeholder="Ringkasan atau catatan poin penting naskah masuk..."
          minRows={3}
          className="w-full rounded-sm bg-white border border-slate-200 text-xs p-3 text-slate-700 outline-none focus:border-indigo-500 focus:ring-4 focus:ring-indigo-100 transition-all"
        />
      </div>

      {/* Row 5: Berkas Lampiran */}
      <div>
        <div className="flex items-center justify-between mb-2">
          <Label className="text-xs font-semibold text-slate-700">Berkas Lampiran / Salinan Naskah</Label>
          <span className="text-[11px] text-slate-400">Format: {UPLOAD_TYPES_TEXT} (Maks 10MB)</span>
        </div>

        {attachments.length > 0 && (
          <div className="space-y-2 mb-3">
            {attachments.map((att) => (
              <div
                key={att.id}
                className="flex items-center justify-between p-2.5 rounded-sm bg-slate-50 border border-slate-200 text-xs"
              >
                <div className="flex items-center gap-2 truncate max-w-[80%]">
                  <FileText className="w-4 h-4 text-sky-600 shrink-0" />
                  <a
                    href={att.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="font-medium text-sky-600 hover:underline truncate"
                  >
                    {att.name}
                  </a>
                  <span className="text-[10px] text-slate-400">({Math.round(att.size / 1024)} KB)</span>
                </div>
                <button
                  type="button"
                  onClick={() => handleRemoveAttachment(att.id)}
                  className="text-rose-600 hover:text-rose-800 p-1 rounded-sm hover:bg-rose-50 transition-colors cursor-pointer"
                  title="Hapus berkas"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>
            ))}
          </div>
        )}

        <div className="flex items-center gap-2">
          <input
            ref={fileInputRef}
            type="file"
            accept={UPLOAD_ACCEPT}
            multiple
            onChange={handleFileUpload}
            className="hidden"
            id="file-upload-masuk"
          />
          <Button
            type="button"
            variant="outline"
            disabled={uploading || analyzing}
            onClick={() => fileInputRef.current?.click()}
            className="rounded-sm border-dashed border-slate-300 text-slate-600 hover:bg-slate-50 text-xs h-9 flex items-center gap-2 shadow-xs cursor-pointer"
          >
            {analyzing ? (
              <><Loader2 className="w-3.5 h-3.5 animate-spin text-sky-600" /> Menganalisis surat...</>
            ) : uploading ? (
              <>
                <Loader2 className="w-3.5 h-3.5 animate-spin text-sky-600" />
                Mengunggah...
              </>
            ) : (
              <>
                <Upload className="w-3.5 h-3.5 text-slate-400" />
                Unggah Salinan Surat
              </>
            )}
          </Button>
        </div>
        <p className="mt-2 text-[11px] text-slate-500">Berkas surat pertama dianalisis dengan Gemini untuk mengisi data. Periksa hasilnya sebelum menyimpan.</p>
      </div>

      {/* Footer Actions */}
      <div className="flex items-center justify-end gap-3 pt-3 border-t border-slate-100">
        <Button
          type="button"
          variant="outline"
          onClick={onCancel}
          disabled={saving}
          className="rounded-sm border-slate-200 text-slate-600 hover:bg-slate-50 text-xs h-9 cursor-pointer"
        >
          Batal
        </Button>
        <Button
          type="submit"
          disabled={saving || uploading || analyzing}
          className="rounded-sm bg-sky-600 hover:bg-sky-700 text-white text-xs font-semibold h-9 flex items-center gap-2 shadow-sm cursor-pointer"
        >
          {saving ? (
            <>
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
              Menyimpan...
            </>
          ) : (
            isEdit ? 'Simpan Perubahan' : 'Catat Surat Masuk'
          )}
        </Button>
      </div>
    </form>
  );
}
