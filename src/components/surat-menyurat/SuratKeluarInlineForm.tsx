"use client";

import React, { useState, useEffect, useRef } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useAuth } from '@/lib/AuthContext';
import { SIFAT_SURAT_OPTIONS, STATUS_SURAT_KELUAR_OPTIONS, KATEGORI_SURAT_KELUAR } from '@/lib/surat-menyurat/constants';
import { deriveSatkerCode, formatNomorSuratKeluar } from '@/lib/surat-menyurat/numbering';
import { SifatSurat, StatusSuratKeluar, SuratAttachment, SuratKeluar } from '@/lib/surat-menyurat/types';
import { UPLOAD_ACCEPT, UPLOAD_TYPES_TEXT, uploadFileProblem } from '@/lib/uploadFileTypes';
import { AlertCircle, FileText, Loader2, Paperclip, Pencil, Plus, Sparkles, Trash2, Upload, X } from 'lucide-react';

interface Props {
  suratToEdit?: SuratKeluar | null;
  defaultSatkerName: string;
  defaultKepalaName?: string;
  nextSequence: number;
  targetSatkerId?: string;
  onCancel: () => void;
  onSuccess: (data: SuratKeluar) => void;
}

export default function SuratKeluarInlineForm({
  suratToEdit,
  defaultSatkerName,
  defaultKepalaName = '',
  nextSequence,
  targetSatkerId,
  onCancel,
  onSuccess,
}: Props) {
  const { user } = useAuth();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [nomorSurat, setNomorSurat] = useState('');
  const [tanggalSurat, setTanggalSurat] = useState('');
  const [tujuan, setTujuan] = useState('');
  const [perihal, setPerihal] = useState('');
  const [sifat, setSifat] = useState<SifatSurat>('biasa');
  const [kategori, setKategori] = useState(KATEGORI_SURAT_KELUAR[0]);
  const [ringkasan, setRingkasan] = useState('');
  const [penandatanganNama, setPenandatanganNama] = useState('');
  const [penandatanganJabatan, setPenandatanganJabatan] = useState('');
  const [status, setStatus] = useState<StatusSuratKeluar>('terkirim');
  const [attachments, setAttachments] = useState<SuratAttachment[]>([]);

  const [uploading, setUploading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const isEdit = Boolean(suratToEdit);

  useEffect(() => {
    if (suratToEdit) {
      setNomorSurat(suratToEdit.nomorSurat || '');
      setTanggalSurat(suratToEdit.tanggalSurat || '');
      setTujuan(suratToEdit.tujuan || '');
      setPerihal(suratToEdit.perihal || '');
      setSifat(suratToEdit.sifat || 'biasa');
      setKategori(suratToEdit.kategori || KATEGORI_SURAT_KELUAR[0]);
      setRingkasan(suratToEdit.ringkasan || '');
      setPenandatanganNama(suratToEdit.penandatanganNama || defaultKepalaName);
      setPenandatanganJabatan(suratToEdit.penandatanganJabatan || `Kepala ${defaultSatkerName}`);
      setStatus(suratToEdit.status || 'terkirim');
      setAttachments(suratToEdit.attachments || []);
    } else {
      const today = new Date().toISOString().slice(0, 10);
      const code = deriveSatkerCode(defaultSatkerName);
      const autoNo = formatNomorSuratKeluar({
        sequenceNumber: nextSequence,
        satkerCode: code,
        date: new Date(),
      });
      setNomorSurat(autoNo);
      setTanggalSurat(today);
      setTujuan('');
      setPerihal('');
      setSifat('biasa');
      setKategori(KATEGORI_SURAT_KELUAR[0]);
      setRingkasan('');
      setPenandatanganNama(defaultKepalaName || '');
      setPenandatanganJabatan(`Kepala ${defaultSatkerName || 'SatKer'}`);
      setStatus('terkirim');
      setAttachments([]);
    }
    setError('');
  }, [suratToEdit, defaultSatkerName, defaultKepalaName, nextSequence]);

  const handleGenerateNumber = () => {
    const code = deriveSatkerCode(defaultSatkerName);
    const date = tanggalSurat ? new Date(tanggalSurat) : new Date();
    const autoNo = formatNomorSuratKeluar({
      sequenceNumber: nextSequence,
      satkerCode: code,
      date,
    });
    setNomorSurat(autoNo);
  };

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
    if (!tujuan.trim()) {
      setError('Tujuan / penerima surat wajib diisi.');
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
        type: 'keluar',
        ...(suratToEdit ? { id: suratToEdit.id } : {}),
        nomorSurat: nomorSurat.trim(),
        tanggalSurat,
        tujuan: tujuan.trim(),
        perihal: perihal.trim(),
        sifat,
        kategori,
        ringkasan: ringkasan.trim(),
        penandatanganNama: penandatanganNama.trim(),
        penandatanganJabatan: penandatanganJabatan.trim(),
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
        throw new Error(json.error || 'Gagal menyimpan surat keluar.');
      }

      onSuccess(json.data);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Terjadi kesalahan saat menyimpan.');
    } finally {
      setSaving(false);
    }
  };

  const statusLabel = STATUS_SURAT_KELUAR_OPTIONS.find((opt) => opt.value === status)?.label || 'Terkirim';
  const sifatLabel = SIFAT_SURAT_OPTIONS.find((opt) => opt.value === sifat)?.label || 'Biasa';

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
              {isEdit ? `Edit Surat Keluar: ${suratToEdit?.nomorSurat}` : 'Catat Surat Keluar'}
            </h3>
            <p className="text-[11px] text-slate-400">
              {isEdit
                ? 'Perbarui data dan salinan berkas surat keluar resmi'
                : 'Catat surat keluar resmi yang diterbitkan oleh satuan kerja Anda'}
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

      {/* Row 1: Nomor Surat, Kategori, Tanggal Surat, Status */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <div>
          <div className="flex items-center justify-between mb-1.5">
            <Label className="text-xs font-semibold text-slate-700">Nomor Surat *</Label>
            {!isEdit && (
              <button
                type="button"
                onClick={handleGenerateNumber}
                className="text-[10px] font-semibold text-indigo-700 bg-indigo-50 hover:bg-indigo-100 border border-indigo-200 px-2 py-0.5 rounded-sm inline-flex items-center gap-1 cursor-pointer transition-colors shadow-xs"
                title="Generate nomor otomatis sesuai urutan"
              >
                <Sparkles className="w-2.5 h-2.5 text-indigo-600" />
                Auto No
              </button>
            )}
          </div>
          <Input
            value={nomorSurat}
            onChange={(e) => setNomorSurat(e.target.value)}
            placeholder="001/SATKER/UNIPDU/XI/2026"
            className="rounded-sm bg-white border-slate-200 text-xs h-9 font-mono"
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
              {KATEGORI_SURAT_KELUAR.map((kat) => (
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
          <Label className="text-xs font-semibold text-slate-700 block mb-1.5">Status Surat</Label>
          <Select value={status} onValueChange={(val) => val && setStatus(val as StatusSuratKeluar)}>
            <SelectTrigger className="w-full rounded-sm bg-white border-slate-200 text-xs h-9">
              <SelectValue>{statusLabel}</SelectValue>
            </SelectTrigger>
            <SelectContent className="rounded-md border border-slate-200 bg-white p-1 shadow-xl">
              {STATUS_SURAT_KELUAR_OPTIONS.map((opt) => (
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

      {/* Row 2: Tujuan, Sifat, Penandatangan Nama, Jabatan */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <div>
          <Label className="text-xs font-semibold text-slate-700 block mb-1.5">Tujuan / Penerima *</Label>
          <Input
            value={tujuan}
            onChange={(e) => setTujuan(e.target.value)}
            placeholder="Contoh: Rektor UNIPDU / Dosen / Mahasiswa"
            className="rounded-sm bg-white border-slate-200 text-xs h-9"
            required
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
          <Label className="text-xs font-semibold text-slate-700 block mb-1.5">Nama Penandatangan</Label>
          <Input
            value={penandatanganNama}
            onChange={(e) => setPenandatanganNama(e.target.value)}
            placeholder="Nama pejabat penandatangan..."
            className="rounded-sm bg-white border-slate-200 text-xs h-9"
          />
        </div>

        <div>
          <Label className="text-xs font-semibold text-slate-700 block mb-1.5">Jabatan Penandatangan</Label>
          <Input
            value={penandatanganJabatan}
            onChange={(e) => setPenandatanganJabatan(e.target.value)}
            placeholder={`Contoh: Kepala ${defaultSatkerName || 'SatKer'}`}
            className="rounded-sm bg-white border-slate-200 text-xs h-9"
          />
        </div>
      </div>

      {/* Row 3: Perihal & Ringkasan */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div>
          <Label className="text-xs font-semibold text-slate-700 block mb-1.5">Perihal / Hal *</Label>
          <Input
            value={perihal}
            onChange={(e) => setPerihal(e.target.value)}
            placeholder="Contoh: Surat Pengantar Laporan Pertanggungjawaban SatKer"
            className="rounded-sm bg-white border-slate-200 text-xs h-9"
            required
          />
        </div>

        <div>
          <Label className="text-xs font-semibold text-slate-700 block mb-1.5">Ringkasan / Isi Pokok Surat</Label>
          <Input
            value={ringkasan}
            onChange={(e) => setRingkasan(e.target.value)}
            placeholder="Ringkasan atau uraian pokok surat keluar..."
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
              Lampiran Berkas / Salinan Surat Keluar
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
          {isEdit ? 'Simpan Perubahan' : 'Catat Surat Keluar'}
        </Button>
      </div>
    </form>
  );
}
