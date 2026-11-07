"use client";

import React, { useState, useEffect } from 'react';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { INSTRUKSI_DISPOSISI_PRESETS } from '@/lib/surat-menyurat/constants';
import { SuratMasuk, DisposisiSurat } from '@/lib/surat-menyurat/types';
import { FileCheck, Loader2, Send } from 'lucide-react';

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  surat: SuratMasuk | null;
  onSave: (suratId: string, disposisi: DisposisiSurat) => Promise<void>;
  currentUserName: string;
}

export default function SuratDisposisiDialog({
  open,
  onOpenChange,
  surat,
  onSave,
  currentUserName,
}: Props) {
  const [instruksi, setInstruksi] = useState('');
  const [diteruskanKepada, setDiteruskanKepada] = useState('');
  const [catatan, setCatatan] = useState('');
  const [tanggalDisposisi, setTanggalDisposisi] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (surat) {
      if (surat.disposisi) {
        setInstruksi(surat.disposisi.instruksi || '');
        setDiteruskanKepada(surat.disposisi.diteruskanKepada || '');
        setCatatan(surat.disposisi.catatan || '');
        setTanggalDisposisi(surat.disposisi.tanggalDisposisi || new Date().toISOString().slice(0, 10));
      } else {
        setInstruksi(INSTRUKSI_DISPOSISI_PRESETS[0]);
        setDiteruskanKepada('Sekretaris SatKer');
        setCatatan('');
        setTanggalDisposisi(new Date().toISOString().slice(0, 10));
      }
      setError('');
    }
  }, [surat, open]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!surat) return;
    if (!instruksi.trim()) {
      setError('Instruksi disposisi wajib diisi.');
      return;
    }

    try {
      setSaving(true);
      setError('');
      await onSave(surat.id, {
        instruksi: instruksi.trim(),
        diteruskanKepada: diteruskanKepada.trim() || 'Staf SatKer',
        catatan: catatan.trim(),
        tanggalDisposisi: tanggalDisposisi || new Date().toISOString().slice(0, 10),
        disposisiOleh: currentUserName,
        disposisiOlehUid: '',
      });
      onOpenChange(false);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Gagal menyimpan disposisi.');
    } finally {
      setSaving(false);
    }
  };

  if (!surat) return null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg bg-white rounded-md p-6 border border-slate-100 shadow-[0_20px_50px_rgba(0,0,0,0.1)]">
        <DialogHeader className="space-y-1">
          <div className="flex items-center gap-2 text-indigo-600">
            <FileCheck className="w-5 h-5" />
            <DialogTitle className="text-xl font-bold tracking-tight text-slate-900">
              Lembar Disposisi Kepala SatKer
            </DialogTitle>
          </div>
          <DialogDescription className="text-xs text-slate-500">
            Berikan instruksi atau arahan tindak lanjut atas surat masuk berikut.
          </DialogDescription>
        </DialogHeader>

        {/* Ringkasan Surat */}
        <div className="bg-slate-50 border border-slate-200 rounded-sm p-3.5 text-xs space-y-1.5 mt-1">
          <div className="flex justify-between">
            <span className="text-slate-500 font-medium">Nomor Surat:</span>
            <span className="font-semibold text-slate-800">{surat.nomorSurat}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-slate-500 font-medium">Pengirim:</span>
            <span className="font-semibold text-slate-800">{surat.pengirim}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-slate-500 font-medium">Perihal:</span>
            <span className="font-semibold text-slate-800 text-right truncate max-w-[280px]">{surat.perihal}</span>
          </div>
        </div>

        {error && (
          <div className="text-xs font-medium text-rose-600 bg-rose-50 border border-rose-200 p-2.5 rounded-sm">
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4 mt-2">
          {/* Instruksi Presets */}
          <div className="space-y-1.5">
            <Label className="text-xs font-semibold text-slate-700">Instruksi Disposisi</Label>
            <div className="flex flex-wrap gap-1.5 mb-2">
              {INSTRUKSI_DISPOSISI_PRESETS.map((preset) => (
                <button
                  key={preset}
                  type="button"
                  onClick={() => setInstruksi(preset)}
                  className={`text-xs px-2.5 py-1 rounded-sm border transition-all cursor-pointer font-semibold ${
                    instruksi === preset
                      ? 'bg-indigo-50 border-indigo-300 text-indigo-700'
                      : 'bg-white border-slate-200 text-slate-600 hover:bg-slate-50'
                  }`}
                >
                  {preset}
                </button>
              ))}
            </div>
            <Input
              value={instruksi}
              onChange={(e) => setInstruksi(e.target.value)}
              placeholder="Atau ketik instruksi khusus..."
              className="text-xs font-semibold bg-white rounded-sm border-slate-200"
              required
            />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label className="text-xs font-semibold text-slate-700">Diteruskan Kepada</Label>
              <Input
                value={diteruskanKepada}
                onChange={(e) => setDiteruskanKepada(e.target.value)}
                placeholder="Contoh: Sekretaris SatKer, Bendahara..."
                className="text-xs font-semibold bg-white rounded-sm border-slate-200"
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs font-semibold text-slate-700">Tanggal Disposisi</Label>
              <Input
                type="date"
                value={tanggalDisposisi}
                onChange={(e) => setTanggalDisposisi(e.target.value)}
                className="text-xs font-semibold bg-white rounded-sm border-slate-200"
                required
              />
            </div>
          </div>

          <div className="space-y-1.5">
            <Label className="text-xs font-semibold text-slate-700">Catatan Tambahan (Opsional)</Label>
            <textarea
              rows={3}
              value={catatan}
              onChange={(e) => setCatatan(e.target.value)}
              placeholder="Catatan atau poin penting yang perlu diperhatikan..."
              className="w-full text-xs font-medium p-2.5 rounded-sm border border-slate-200 focus:outline-none focus:ring-4 focus:ring-indigo-100 focus:border-indigo-500 transition-all bg-white"
            />
          </div>

          <DialogFooter className="gap-2 sm:gap-2 pt-2">
            <button
              type="button"
              onClick={() => onOpenChange(false)}
              disabled={saving}
              className="inline-flex items-center gap-2 px-4 py-2 text-xs font-semibold rounded-sm border border-slate-200 text-slate-700 bg-white hover:bg-slate-50 transition-all duration-150 shadow-sm cursor-pointer disabled:opacity-50"
            >
              Batal
            </button>
            <Button
              type="submit"
              disabled={saving}
              className="rounded-sm bg-indigo-600 hover:bg-indigo-700 text-white font-semibold flex items-center gap-2 shadow-md shadow-indigo-100 disabled:opacity-50 text-xs px-4 py-2"
            >
              {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Send className="w-3.5 h-3.5" />}
              {saving ? 'Menyimpan...' : 'Simpan Disposisi'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
