"use client";

import React, { useState, useEffect, useRef } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useAuth } from '@/lib/AuthContext';
import { SIFAT_SURAT_OPTIONS, STATUS_SURAT_MASUK_OPTIONS, KATEGORI_SURAT_MASUK } from '@/lib/surat-menyurat/constants';
import { SifatSurat, StatusSuratMasuk, SuratAttachment, SuratMasuk } from '@/lib/surat-menyurat/types';
import { UPLOAD_ACCEPT, UPLOAD_TYPES_TEXT, uploadFileProblem } from '@/lib/uploadFileTypes';
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
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const isEdit = Boolean(suratToEdit);

  useEffect(() => {
    if (suratToEdit) {
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

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0 || !user) return;

    try {
      setUploading(true);
      setError('');
      const idToken = await user.getIdToken();

      for (let i = 0; i < files.length; i++) {
        const file = files[i];

        const problem = uploadFileProblem(file);
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
          throw new Error(json.error || 'Gagal mengunggah berkas.');
        }

        setAttachments((prev) => [...prev, json.attachment]);
      }
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Gagal mengunggah berkas.');
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const handleRemoveAttachment = (id: string) => {
    setAttachments((prev) => prev.filter((a) => a.id !== id));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user) return;

    if (!nomorSurat.trim()) {
      setError('Nomor surat wajib diisi.');
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
        type: 'masuk',
        ...(suratToEdit ? { id: suratToEdit.id } : {}),
        nomorSurat: nomorSurat.trim(),
        tanggalSurat,
        tanggalDiterima,
        pengirim: pengirim.trim(),
        penerima: penerima.trim(),
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

  const sifatLabel = SIFAT_SURAT_OPTIONS.find((opt) => opt.value === sifat)?.label || 'Biasa';
  const statusLabel = STATUS_SURAT_MASUK_OPTIONS.find((opt) => opt.value === status)?.label || 'Menunggu Disposisi';

  return (
    <form
      onSubmit={handleSubmit}
      className="rounded-md border border-slate-200 bg-white p-6 shadow-sm space-y-5 text-left"
    >
      {/* Header Bar */}
      <div className="flex items-center justify-between pb-3 border-b border-slate-100">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-sm bg-indigo-50 border border-indigo-100 flex items-center justify-center text-indigo-600">
            {isEdit ? <Pencil className="w-4 h-4" /> : <Plus className="w-4 h-4" />}
          </div>
          <div>
            <h3 className="text-sm font-bold text-slate-800">
              {isEdit ? `Edit Surat Masuk: ${suratToEdit?.nomorSurat}` : 'Tambah Surat Masuk'}
            </h3>
            <p className="text-[11px] text-slate-400">
              {isEdit
                ? 'Perbarui data dan dokumen surat masuk yang tercatat'
                : 'Catat surat masuk resmi yang diterima oleh satuan kerja Anda'}
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

      {/* Row 1: Nomor, Kategori, Tanggal Surat, Tanggal Diterima */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <div>
          <Label className="text-xs font-semibold text-slate-700 block mb-1.5">Nomor Surat *</Label>
          <Input
            value={nomorSurat}
            onChange={(e) => setNomorSurat(e.target.value)}
            placeholder="Contoh: 124/REK/UNIPDU/XI/2026"
            className="rounded-sm bg-white border-slate-200 text-xs h-9"
            required
          />
        </div>

        <div>
          <Label className="text-xs font-semibold text-slate-700 block mb-1.5">Kategori Surat</Label>
          <Select value={kategori} onValueChange={(val) => val && setKategori(val)}>
            <SelectTrigger className="w-full rounded-sm bg-white border-slate-200 text-xs h-9">
              <SelectValue>{kategori}</SelectValue>
            </SelectTrigger>
            <SelectContent className="rounded-md border border-slate-200 bg-white p-1 shadow-xl">
              {KATEGORI_SURAT_MASUK.map((kat) => (
                <SelectItem
                  key={kat}
                  value={kat}
                  className="rounded-sm py-2 pr-8 pl-3 text-xs font-medium text-slate-700 focus:bg-indigo-50 focus:text-indigo-900 data-[selected]:font-semibold data-[selected]:text-indigo-700"
                >
                  {kat}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
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
      </div>

      {/* Row 2: Pengirim, Penerima, Sifat, Status */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <div>
          <Label className="text-xs font-semibold text-slate-700 block mb-1.5">Pengirim Surat *</Label>
          <Input
            value={pengirim}
            onChange={(e) => setPengirim(e.target.value)}
            placeholder="Contoh: Rektorat UNIPDU / LPPM"
            className="rounded-sm bg-white border-slate-200 text-xs h-9"
            required
          />
        </div>

        <div>
          <Label className="text-xs font-semibold text-slate-700 block mb-1.5">Ditujukan Kepada</Label>
          <Input
            value={penerima}
            onChange={(e) => setPenerima(e.target.value)}
            placeholder="Contoh: Kepala SatKer"
            className="rounded-sm bg-white border-slate-200 text-xs h-9"
          />
        </div>

        <div>
          <Label className="text-xs font-semibold text-slate-700 block mb-1.5">Sifat Surat</Label>
          <Select value={sifat} onValueChange={(val) => val && setSifat(val as SifatSurat)}>
            <SelectTrigger className="w-full rounded-sm bg-white border-slate-200 text-xs h-9">
              <SelectValue>{sifatLabel}</SelectValue>
            </SelectTrigger>
            <SelectContent className="rounded-md border border-slate-200 bg-white p-1 shadow-xl">
              {SIFAT_SURAT_OPTIONS.map((opt) => (
                <SelectItem
                  key={opt.value}
                  value={opt.value}
                  className="rounded-sm py-2 pr-8 pl-3 text-xs font-medium text-slate-700 focus:bg-indigo-50 focus:text-indigo-900 data-[selected]:font-semibold data-[selected]:text-indigo-700"
                >
                  {opt.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div>
          <Label className="text-xs font-semibold text-slate-700 block mb-1.5">Status Surat</Label>
          <Select value={status} onValueChange={(val) => val && setStatus(val as StatusSuratMasuk)}>
            <SelectTrigger className="w-full rounded-sm bg-white border-slate-200 text-xs h-9">
              <SelectValue>{statusLabel}</SelectValue>
            </SelectTrigger>
            <SelectContent className="rounded-md border border-slate-200 bg-white p-1 shadow-xl">
              {STATUS_SURAT_MASUK_OPTIONS.map((opt) => (
                <SelectItem
                  key={opt.value}
                  value={opt.value}
                  className="rounded-sm py-2 pr-8 pl-3 text-xs font-medium text-slate-700 focus:bg-indigo-50 focus:text-indigo-900 data-[selected]:font-semibold data-[selected]:text-indigo-700"
                >
                  {opt.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      {/* Row 3: Perihal & Ringkasan */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div>
          <Label className="text-xs font-semibold text-slate-700 block mb-1.5">Perihal / Hal *</Label>
          <Input
            value={perihal}
            onChange={(e) => setPerihal(e.target.value)}
            placeholder="Contoh: Undangan Koordinasi Pelaksanaan Program Kerja 2026"
            className="rounded-sm bg-white border-slate-200 text-xs h-9"
            required
          />
        </div>

        <div>
          <Label className="text-xs font-semibold text-slate-700 block mb-1.5">Ringkasan / Isi Pokok Surat</Label>
          <Input
            value={ringkasan}
            onChange={(e) => setRingkasan(e.target.value)}
            placeholder="Ringkasan atau catatan singkat mengenai isi surat..."
            className="rounded-sm bg-white border-slate-200 text-xs h-9"
          />
        </div>
      </div>

      {/* Row 4: Lampiran Berkas */}
      <div className="pt-2 border-t border-slate-100 space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <Label className="text-xs font-semibold text-slate-700 flex items-center gap-1.5">
              <Paperclip className="w-3.5 h-3.5 text-slate-500" />
              Lampiran Berkas / Salinan Surat Masuk
            </Label>
            <p className="text-[11px] text-slate-400 mt-0.5">
              {UPLOAD_TYPES_TEXT} (maks. 5 MB)
            </p>
          </div>

          <div>
            <input
              ref={fileInputRef}
              type="file"
              accept={UPLOAD_ACCEPT}
              multiple
              className="hidden"
              onChange={handleFileUpload}
              disabled={uploading}
            />
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              disabled={uploading}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-sm text-xs font-semibold bg-white text-slate-700 border border-slate-200 hover:bg-slate-50 hover:shadow-xs transition-all shadow-xs cursor-pointer disabled:opacity-50"
            >
              {uploading ? (
                <>
                  <Loader2 className="w-3.5 h-3.5 animate-spin text-indigo-600" />
                  Mengunggah...
                </>
              ) : (
                <>
                  <Upload className="w-3.5 h-3.5 text-slate-500" />
                  Lampirkan berkas
                </>
              )}
            </button>
          </div>
        </div>

        {attachments.length > 0 && (
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-2 pt-1">
            {attachments.map((file) => (
              <div
                key={file.id}
                className="flex items-center justify-between p-2 rounded-sm border border-slate-200 bg-slate-50/60 text-xs"
              >
                <div className="flex items-center gap-2 min-w-0 pr-2">
                  <FileText className="w-4 h-4 text-slate-400 shrink-0" />
                  <span className="truncate font-medium text-slate-700" title={file.name}>
                    {file.name}
                  </span>
                </div>
                <button
                  type="button"
                  onClick={() => handleRemoveAttachment(file.id)}
                  className="text-slate-400 hover:text-rose-600 p-1 rounded-sm transition-colors shrink-0 cursor-pointer"
                  title="Hapus lampiran"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Action Footer */}
      <div className="pt-3 border-t border-slate-100 flex items-center justify-end gap-2.5">
        <button
          type="button"
          onClick={onCancel}
          disabled={saving}
          className="inline-flex items-center px-4 py-2 text-xs font-semibold rounded-sm border border-slate-200 text-slate-700 bg-white hover:bg-slate-50 transition-all shadow-xs cursor-pointer disabled:opacity-50"
        >
          Batal
        </button>

        <Button
          type="submit"
          disabled={saving || uploading}
          className="rounded-sm bg-indigo-600 hover:bg-indigo-700 text-white font-semibold text-xs px-4 py-2 shadow-xs cursor-pointer flex items-center gap-1.5"
        >
          {saving && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
          {isEdit ? 'Simpan Perubahan' : 'Catat Surat Masuk'}
        </Button>
      </div>
    </form>
  );
}
