"use client";

import React, { useState, useEffect, useRef } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useAuth } from '@/lib/AuthContext';
import {
  SIFAT_SURAT_OPTIONS,
  STATUS_SURAT_KELUAR_OPTIONS,
  KATEGORI_SURAT_KELUAR,
  KODE_SURAT_KELUAR_OPTIONS,
  INSTITUTION_SCOPES,
} from '@/lib/surat-menyurat/constants';
import {
  deriveSatkerCode,
  formatNomorSuratKeluarTemplate,
  formatKodeArsip,
} from '@/lib/surat-menyurat/numbering';
import {
  InstitutionScope,
  SifatSurat,
  StatusSuratKeluar,
  SuratAttachment,
  SuratKeluar,
} from '@/lib/surat-menyurat/types';
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

  const [institutionScope, setInstitutionScope] = useState<InstitutionScope>('UNIPDU');
  const [kodeSurat, setKodeSurat] = useState('AU');
  const [nomorUrut, setNomorUrut] = useState<number>(nextSequence);
  const [nomorUrutEnd, setNomorUrutEnd] = useState<string>('');
  const [kodeArsip, setKodeArsip] = useState('');

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
      setInstitutionScope(suratToEdit.institutionScope || 'UNIPDU');
      setKodeSurat(suratToEdit.kodeSurat || 'AU');
      setNomorUrut(suratToEdit.nomorUrut || 1);
      setNomorUrutEnd(suratToEdit.nomorUrutEnd ? String(suratToEdit.nomorUrutEnd) : '');
      setKodeArsip(suratToEdit.kodeArsip || '');

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
      const initialScope: InstitutionScope =
        defaultSatkerName.toLowerCase().includes('yapetidu') || defaultSatkerName.toLowerCase().includes('yayasan')
          ? 'YAPETIDU'
          : 'UNIPDU';

      const initialSeq = Math.max(1, nextSequence);
      setInstitutionScope(initialScope);
      setKodeSurat('AU');
      setNomorUrut(initialSeq);
      setNomorUrutEnd('');

      const autoNo = formatNomorSuratKeluarTemplate({
        sequenceNumber: initialSeq,
        institutionScope: initialScope,
        kodeSurat: 'AU',
        date: new Date(),
      });
      const autoArsip = formatKodeArsip({
        type: 'keluar',
        institutionScope: initialScope,
        sequenceNumber: initialSeq,
      });

      setNomorSurat(autoNo);
      setKodeArsip(autoArsip);
      setTanggalSurat(today);
      setTujuan('');
      setPerihal('');
      setSifat('biasa');
      setKategori(KATEGORI_SURAT_KELUAR[0]);
      setRingkasan('');
      setPenandatanganNama(defaultKepalaName || '');
      setPenandatanganJabatan(
        initialScope === 'YAPETIDU'
          ? 'Ketua Yayasan'
          : `Kepala ${defaultSatkerName || 'SatKer'}`
      );
      setStatus('terkirim');
      setAttachments([]);
    }
    setError('');
  }, [suratToEdit, defaultSatkerName, defaultKepalaName, nextSequence]);

  const handleGenerateNumber = () => {
    const date = tanggalSurat ? new Date(tanggalSurat) : new Date();
    const endNum = nomorUrutEnd && parseInt(nomorUrutEnd, 10) > nomorUrut ? parseInt(nomorUrutEnd, 10) : undefined;
    const satkerCode = deriveSatkerCode(defaultSatkerName);

    const autoNo = formatNomorSuratKeluarTemplate({
      sequenceNumber: nomorUrut,
      sequenceNumberEnd: endNum,
      institutionScope,
      satkerCode,
      kodeSurat,
      date,
    });

    const autoArsip = formatKodeArsip({
      type: 'keluar',
      institutionScope,
      sequenceNumber: nomorUrut,
    });

    setNomorSurat(autoNo);
    setKodeArsip(autoArsip);
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
          throw new Error(json.error || `Gagal mengunggah file ${file.name}`);
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

  const handleRemoveAttachment = (attId: string) => {
    setAttachments((prev) => prev.filter((a) => a.id !== attId));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user) return;

    if (!nomorSurat.trim()) {
      setError('Nomor surat keluar wajib diisi.');
      return;
    }
    if (!tanggalSurat) {
      setError('Tanggal surat wajib diisi.');
      return;
    }
    if (!tujuan.trim()) {
      setError('Tujuan surat wajib diisi.');
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

      const endNum = nomorUrutEnd && parseInt(nomorUrutEnd, 10) > nomorUrut ? parseInt(nomorUrutEnd, 10) : undefined;

      const payload = {
        ...(isEdit && suratToEdit ? { id: suratToEdit.id } : {}),
        type: 'keluar',
        institutionScope,
        nomorUrut,
        ...(endNum ? { nomorUrutEnd: endNum } : {}),
        kodeSurat,
        kodeArsip: kodeArsip.trim() || undefined,
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
              {isEdit ? `Edit Surat Keluar: ${suratToEdit?.nomorSurat}` : 'Catat Surat Keluar (Agenda Template)'}
            </h3>
            <p className="text-[11px] text-slate-400">
              {isEdit
                ? 'Perbarui data dan salinan berkas surat keluar resmi'
                : 'Penerbitan surat keluar sesuai standar format nomor & arsip 2026'}
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

      {/* Template Setup Controls: Scope, Kode Surat, Nomor Urut & Batch Range */}
      <div className="p-4 bg-slate-50 border border-slate-200 rounded-sm grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <div>
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
        </div>

        <div>
          <Label className="text-xs font-semibold text-slate-700 block mb-1.5">Kode Jenis Surat</Label>
          <Select
            value={kodeSurat}
            onValueChange={(val) => {
              if (val) {
                setKodeSurat(val);
              }
            }}
          >
            <SelectTrigger className="w-full rounded-sm bg-white border-slate-200 text-xs h-9 font-mono">
              <SelectValue />
            </SelectTrigger>
            <SelectContent className="rounded-md border border-slate-200 bg-white p-1 shadow-xl">
              {KODE_SURAT_KELUAR_OPTIONS.map((opt) => (
                <SelectItem
                  key={opt.code}
                  value={opt.code}
                  className="rounded-sm py-2 pr-8 pl-3 text-xs font-medium text-slate-700 focus:bg-indigo-50 focus:text-indigo-900"
                >
                  {opt.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div>
          <Label className="text-xs font-semibold text-slate-700 block mb-1.5">Nomor Urut (Agenda)</Label>
          <Input
            type="number"
            min={1}
            value={nomorUrut}
            onChange={(e) => setNomorUrut(parseInt(e.target.value, 10) || 1)}
            className="rounded-sm bg-white border-slate-200 text-xs h-9 font-mono"
            required
          />
        </div>

        <div>
          <div className="flex items-center justify-between mb-1.5">
            <Label className="text-xs font-semibold text-slate-700">Batch Range (Kolektif)</Label>
            <span className="text-[10px] text-slate-400">Opsional</span>
          </div>
          <Input
            type="number"
            min={nomorUrut + 1}
            placeholder={`cth: ${nomorUrut + 4} (011-015)`}
            value={nomorUrutEnd}
            onChange={(e) => setNomorUrutEnd(e.target.value)}
            className="rounded-sm bg-white border-slate-200 text-xs h-9 font-mono"
          />
        </div>
      </div>

      {/* Row 1: Nomor Surat, Kode Arsip, Tanggal Surat, Status */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <div>
          <div className="flex items-center justify-between mb-1.5">
            <Label className="text-xs font-semibold text-slate-700">Nomor Surat *</Label>
            <button
              type="button"
              onClick={handleGenerateNumber}
              className="text-[10px] font-semibold text-indigo-700 bg-indigo-50 hover:bg-indigo-100 border border-indigo-200 px-2 py-0.5 rounded-sm inline-flex items-center gap-1 cursor-pointer transition-colors shadow-xs"
              title="Perbarui nomor surat otomatis sesuai urutan & kode"
            >
              <Sparkles className="w-2.5 h-2.5 text-indigo-600" />
              Terapkan Format
            </button>
          </div>
          <Input
            value={nomorSurat}
            onChange={(e) => setNomorSurat(e.target.value)}
            placeholder="001/A/SK/1/2026"
            className="rounded-sm bg-white border-slate-200 text-xs h-9 font-mono font-bold text-slate-800"
            required
          />
        </div>

        <div>
          <Label className="text-xs font-semibold text-slate-700 block mb-1.5">Kode Arsip</Label>
          <Input
            value={kodeArsip}
            onChange={(e) => setKodeArsip(e.target.value)}
            placeholder="S.REKTOR,001"
            className="rounded-sm bg-white border-slate-200 text-xs h-9 font-mono font-semibold text-indigo-700"
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
                  className="rounded-sm py-2 pr-8 pl-3 text-xs font-medium text-slate-700 focus:bg-indigo-50 focus:text-indigo-900"
                >
                  {opt.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      {/* Row 2: Alamat Tujuan / Penerima & Perihal */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div>
          <Label className="text-xs font-semibold text-slate-700 block mb-1.5">
            Alamat Penerima / Tujuan Surat *
          </Label>
          <Input
            value={tujuan}
            onChange={(e) => setTujuan(e.target.value)}
            placeholder="cth: Pusat Jaminan Mutu (PJM) / Nama Dosen / Instansi"
            className="rounded-sm bg-white border-slate-200 text-xs h-9"
            required
          />
        </div>

        <div>
          <Label className="text-xs font-semibold text-slate-700 block mb-1.5">Perihal / Hal Surat *</Label>
          <Input
            value={perihal}
            onChange={(e) => setPerihal(e.target.value)}
            placeholder="cth: Undangan Rapat / SK Pegawai Tetap / MoU Kemitraan"
            className="rounded-sm bg-white border-slate-200 text-xs h-9"
            required
          />
        </div>
      </div>

      {/* Row 3: Sifat, Kategori, Penandatangan */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div>
          <Label className="text-xs font-semibold text-slate-700 block mb-1.5">Sifat Surat</Label>
          <Select value={sifat} onValueChange={(val) => val && setSifat(val as SifatSurat)}>
            <SelectTrigger className="w-full rounded-sm bg-white border-slate-200 text-xs h-9">
              <SelectValue />
            </SelectTrigger>
            <SelectContent className="rounded-md border border-slate-200 bg-white p-1 shadow-xl">
              {SIFAT_SURAT_OPTIONS.map((opt) => (
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

        <div>
          <Label className="text-xs font-semibold text-slate-700 block mb-1.5">Kategori Dokumen</Label>
          <Select value={kategori} onValueChange={(val) => val && setKategori(val)}>
            <SelectTrigger className="w-full rounded-sm bg-white border-slate-200 text-xs h-9">
              <SelectValue>{kategori}</SelectValue>
            </SelectTrigger>
            <SelectContent className="rounded-md border border-slate-200 bg-white p-1 shadow-xl">
              {KATEGORI_SURAT_KELUAR.map((kat) => (
                <SelectItem
                  key={kat}
                  value={kat}
                  className="rounded-sm py-2 pr-8 pl-3 text-xs font-medium text-slate-700 focus:bg-indigo-50 focus:text-indigo-900"
                >
                  {kat}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div>
          <Label className="text-xs font-semibold text-slate-700 block mb-1.5">Penandatangan Resmi</Label>
          <Input
            value={penandatanganNama}
            onChange={(e) => setPenandatanganNama(e.target.value)}
            placeholder="cth: Rektor / Ketua Yayasan"
            className="rounded-sm bg-white border-slate-200 text-xs h-9"
          />
        </div>
      </div>

      {/* Row 4: Ringkasan / Isi Pokok */}
      <div>
        <Label className="text-xs font-semibold text-slate-700 block mb-1.5">Ringkasan / Catatan Penting</Label>
        <textarea
          value={ringkasan}
          onChange={(e) => setRingkasan(e.target.value)}
          placeholder="Ringkasan isi surat atau instruksi pengiriman khusus..."
          rows={3}
          className="w-full rounded-sm bg-white border border-slate-200 text-xs p-3 text-slate-700 outline-none focus:border-indigo-500 focus:ring-4 focus:ring-indigo-100 transition-all"
        />
      </div>

      {/* Row 5: Berkas Salinan / Lampiran */}
      <div>
        <div className="flex items-center justify-between mb-2">
          <Label className="text-xs font-semibold text-slate-700">Berkas Salinan (PDF / Gambar / Dokumen)</Label>
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
                  <FileText className="w-4 h-4 text-indigo-600 shrink-0" />
                  <a
                    href={att.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="font-medium text-indigo-600 hover:underline truncate"
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
            id="file-upload-keluar"
          />
          <Button
            type="button"
            variant="outline"
            disabled={uploading}
            onClick={() => fileInputRef.current?.click()}
            className="rounded-sm border-dashed border-slate-300 text-slate-600 hover:bg-slate-50 text-xs h-9 flex items-center gap-2 shadow-xs cursor-pointer"
          >
            {uploading ? (
              <>
                <Loader2 className="w-3.5 h-3.5 animate-spin text-indigo-600" />
                Mengunggah...
              </>
            ) : (
              <>
                <Upload className="w-3.5 h-3.5 text-slate-400" />
                Unggah Berkas Lampiran
              </>
            )}
          </Button>
        </div>
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
          disabled={saving || uploading}
          className="rounded-sm bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-semibold h-9 flex items-center gap-2 shadow-sm cursor-pointer"
        >
          {saving ? (
            <>
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
              Menyimpan...
            </>
          ) : (
            isEdit ? 'Simpan Perubahan' : 'Catat Surat Keluar'
          )}
        </Button>
      </div>
    </form>
  );
}
