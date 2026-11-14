"use client";

import React, { useEffect, useRef, useState } from 'react';
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
import { OptionSelect } from '@/components/ui/option-select';
import { AutoResizeTextarea } from '@/components/ui/auto-resize-textarea';
import { useAuth } from '@/lib/AuthContext';
import { TEMPLATE_OPTIONS } from '@/lib/surat-menyurat/constants';
import { formatNomorSuratKeluar, satkerCodeFor } from '@/lib/surat-menyurat/numbering';
import { applyTemplateDefaults, draftFromSurat, draftRecipient, getDefaultDraft, LetterDraftPayload, AssignedPerson } from '@/lib/surat-menyurat/templates';
import { SuratKeluar, TemplateType } from '@/lib/surat-menyurat/types';
import LetterPaper, { type LetterField } from './LetterPaper';
import IndonesianDatePicker from './IndonesianDatePicker';
import { Loader2, Printer, Save, Sparkles, Wand2, Trash2 } from 'lucide-react';

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  defaultSatkerName: string;
  /** The SatKer head's saved initials; the number's SatKer code is guessed from the name without them. */
  defaultSatkerInitials?: string;
  defaultKepalaName?: string;
  defaultKepalaEmail?: string;
  defaultKepalaPhone?: string;
  nextSequence: number;
  targetSatkerId?: string;
  inline?: boolean;
  surat?: SuratKeluar | null;
  onSavedToSuratKeluar?: (data: SuratKeluar) => void;
}

export default function SuratComposerModal({
  open,
  onOpenChange,
  defaultSatkerName,
  defaultSatkerInitials,
  defaultKepalaName = '',
  defaultKepalaEmail = '',
  defaultKepalaPhone = '',
  nextSequence,
  targetSatkerId,
  inline = false,
  surat = null,
  onSavedToSuratKeluar,
}: Props) {
  const { user, profile } = useAuth();
  const isYapetidu = surat?.institutionScope === 'YAPETIDU';
  const [draft, setDraft] = useState<LetterDraftPayload>(() => {
    if (surat) return draftFromSurat(surat, defaultSatkerName);
    const initial = getDefaultDraft(
      defaultSatkerName,
      defaultKepalaName,
      'Kepala',
      defaultKepalaEmail || profile?.email || user?.email || '',
      defaultKepalaPhone || profile?.phoneNumber || profile?.phone || '',
    );
    initial.nomorSurat = formatNomorSuratKeluar({ sequenceNumber: nextSequence, satkerCode: satkerCodeFor(defaultSatkerInitials, defaultSatkerName), date: new Date() });
    return initial;
  });
  const [savedId, setSavedId] = useState<string | null>(surat?.id || null);
  const savedTemplateType = useRef(draft.templateType);
  const [lastSavedDraft, setLastSavedDraft] = useState<string | null>(surat?.letterDraft ? JSON.stringify(draft) : null);
  const [saving, setSaving] = useState(false);
  const savingRef = useRef(false);
  const [saveSuccess, setSaveSuccess] = useState('');
  const [error, setError] = useState('');
  const [editingPreview, setEditingPreview] = useState<Exclude<keyof LetterDraftPayload, 'templateType' | 'assignedPeople' | 'taskAssigner'> | null>(null);
  const [people, setPeople] = useState<AssignedPerson[]>([]);
  const [peopleLoaded, setPeopleLoaded] = useState(false);
  const [peopleError, setPeopleError] = useState('');
  const [peopleRetry, setPeopleRetry] = useState(0);
  const peopleLoading = !peopleLoaded && !peopleError;
  const [personSearch, setPersonSearch] = useState('');
  const [personSearchOpen, setPersonSearchOpen] = useState(false);
  const [assignerSearch, setAssignerSearch] = useState('');
  const [assignerSearchOpen, setAssignerSearchOpen] = useState(false);

  useEffect(() => {
    if (draft.templateType !== 'tugas' || !user || peopleLoaded) return;
    let cancelled = false;
    user.getIdToken().then((token) => fetch('/api/satker-surat/employees', { headers: { Authorization: `Bearer ${token}` } }))
      .then(async (response) => { const data = await response.json(); if (!response.ok || !data.ok) throw new Error(data.error || 'Gagal memuat pegawai.'); return data.people as AssignedPerson[]; })
      .then((list) => { if (!cancelled) { setPeople(list); setPeopleLoaded(true); setPeopleError(''); } })
      .catch((err) => { if (!cancelled) setPeopleError(err instanceof Error ? err.message : 'Gagal memuat pegawai.'); });
    return () => { cancelled = true; };
  }, [draft.templateType, user, peopleLoaded, peopleRetry]);

  const handleTemplateChange = (newType: TemplateType) => {
    setDraft((prev) => {
      const next = applyTemplateDefaults(prev, newType, prev.satkerName, prev.penandatanganNama, prev.penandatanganJabatan);
      if (isYapetidu) {
        next.isiParagraf1 = next.isiParagraf1.replace("Universitas Pesantren Tinggi Darul 'Ulum (UNIPDU) Jombang", "Yayasan Pesantren Tinggi Darul 'Ulum Jombang");
      }
      return savedId ? { ...next, perihal: prev.perihal, tujuanNama: prev.tujuanNama,
        tujuanJabatanInstansi: prev.tujuanJabatanInstansi, tujuanAlamatKota: prev.tujuanAlamatKota,
        penandatanganNama: prev.penandatanganNama, penandatanganJabatan: prev.penandatanganJabatan } : next;
    });
  };

  const handleGenerateNumber = () => {
    const code = satkerCodeFor(defaultSatkerInitials, defaultSatkerName);
    const date = draft.tanggalSurat ? new Date(draft.tanggalSurat) : new Date();
    const autoNo = formatNomorSuratKeluar({
      sequenceNumber: nextSequence,
      satkerCode: code,
      date,
    });
    setDraft((prev) => ({ ...prev, nomorSurat: autoNo }));
  };

  const handlePrint = async () => {
    if (savingRef.current) return;
    const printContent = document.getElementById('printable-official-letter');
    if (!printContent) return;
    const letterHtml = printContent.innerHTML;
    const numberPart = draft.nomorSurat.trim().split('/')[0].trim().replace(/[\\<>:"|?*\x00-\x1f]/g, '-');
    const orderNumber = /^\d+$/.test(numberPart) ? numberPart.padStart(3, '0') : numberPart;
    const templateTitle = TEMPLATE_OPTIONS.find((option) => option.id === draft.templateType)?.title || 'Surat';
    const suratType = templateTitle.replace(/^Surat\s+/i, '');
    const [year, month, day] = draft.tanggalSurat.split('-');
    const printTitle = `${orderNumber} ${suratType} ${day}-${month}-${year?.slice(-2)}`;

    const printWindow = window.open('', '_blank');
    const saved = await handleSaveToSuratKeluar();
    if (!saved) {
      printWindow?.close();
      return;
    }
    if (!printWindow) {
      alert('Surat berhasil disimpan. Mohon izinkan pop-up browser untuk mencetak surat.');
      return;
    }

    printWindow.document.write(`
      <!DOCTYPE html>
      <html>
        <head>
          <title></title>
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
              min-width: 0;
            }
            .kop-instansi {
              font-size: 13.5pt;
              font-weight: 800;
              text-transform: uppercase;
              letter-spacing: 0.2px;
              line-height: 1.2;
              margin: 0;
              white-space: nowrap;
            }
            .kop-satker {
              font-size: 11pt;
              font-weight: bold;
              text-transform: uppercase;
              letter-spacing: 0.2px;
              line-height: 1.25;
              margin: 3px 0;
              white-space: nowrap;
            }
            .kop-alamat {
              font-size: 8.5pt;
              margin: 2px 0 0 0;
              line-height: 1.3;
              white-space: nowrap;
            }
            .kop-kontak {
              font-size: 8.5pt;
              margin: 1px 0 0 0;
              line-height: 1.3;
              white-space: nowrap;
            }
            .kop-container img { width: 56px; height: 56px; object-fit: contain; }
            .letter-meta {
              display: flex;
              justify-content: space-between;
              margin-bottom: 16px;
              font-size: 11pt;
            }
            .meta-left table {
              border-collapse: collapse;
            }
            .meta-left > div { display: flex; }
            .meta-left > div > span:first-child { width: 65px; flex-shrink: 0; }
            .meta-left > div > span:nth-child(2) { width: 12px; flex-shrink: 0; }
            .kop-container img { width: 56px; height: 56px; object-fit: contain; }
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
              white-space: pre-line;
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
            .signature-date {
              margin: 0 0 4px 0;
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
          ${letterHtml}
          <script>
            window.onload = function() {
              window.print();
              window.onafterprint = function() { window.close(); };
            };
          </script>
        </body>
      </html>
    `);
    printWindow.document.title = printTitle;
    printWindow.document.close();
  };

  const handleSaveToSuratKeluar = async () => {
    if (savingRef.current) return false;
    if (!user) {
      setError('Silakan masuk untuk menyimpan surat.');
      return false;
    }
    if (!draft.nomorSurat.trim()) {
      setError('Nomor surat wajib diisi.');
      return false;
    }
    if (!draft.perihal.trim()) {
      setError('Perihal surat wajib diisi.');
      return false;
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(draft.tanggalSurat)) {
      setError('Tanggal surat wajib diisi.');
      return false;
    }
    const tujuan = draftRecipient(draft);
    if (!tujuan || tujuan.length > 150) {
      setError('Tujuan surat wajib diisi dan maksimal 150 karakter.');
      return false;
    }

    savingRef.current = true;
    try {
      setSaving(true);
      setError('');
      setSaveSuccess('');
      const idToken = await user.getIdToken();

      const combinedBody = [
        draft.salamPembuka,
        ...(draft.templateType === 'tugas' && draft.taskAssigner ? [`Pemberi tugas:\nNama: ${draft.penandatanganNama}\nJabatan: ${draft.penandatanganJabatan || '-'}`] : []),
        draft.isiParagraf1,
        ...(draft.templateType === 'tugas' ? [(draft.assignedPeople || []).map((person, index) => `${index + 1}. ${person.name}${person.role ? ` — ${person.role}` : ''}`).join('\n')] : []),
        draft.isiParagraf2,
        draft.isiParagraf3,
        draft.salamPenutup,
      ].filter(Boolean).join('\n\n');

      const kategori = draft.templateType === 'custom' ? 'Lainnya' : TEMPLATE_OPTIONS.find((option) => option.id === draft.templateType)?.title || 'Lainnya';
      const payload = {
        ...(!savedId && targetSatkerId ? { satkerId: targetSatkerId } : {}),
        ...(savedId ? { id: savedId } : { type: 'keluar', institutionScope: 'UNIPDU', sifat: 'biasa', attachments: [] }),
        ...(!savedId || savedTemplateType.current !== draft.templateType ? { kategori } : {}),
        nomorSurat: draft.nomorSurat.trim(),
        tanggalSurat: draft.tanggalSurat,
        tujuan,
        perihal: draft.perihal.trim(),
        ...(!savedId ? { ringkasan: combinedBody.slice(0, 300) } : {}),
        penandatanganNama: draft.penandatanganNama.trim(),
        penandatanganJabatan: draft.penandatanganJabatan.trim(),
        templateType: draft.templateType,
        contentBody: combinedBody.slice(0, 10000),
        lampiranKeterangan: draft.lampiranKeterangan,
        letterDraft: draft,
      };

      const res = await fetch('/api/satker-surat', {
        method: savedId ? 'PUT' : 'POST',
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

      setSavedId(json.data.id);
      savedTemplateType.current = draft.templateType;
      setLastSavedDraft(JSON.stringify(draft));
      setSaveSuccess('Naskah berhasil disimpan pada Surat Keluar.');
      if (onSavedToSuratKeluar) onSavedToSuratKeluar(json.data);
      return true;
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Gagal menyimpan.');
      return false;
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  };

  // Shared Form Fields JSX
  const renderEditorForm = () => (
    <div className="space-y-4">
      {/* Pengaturan Kop SatKer */}
      <div className="p-3 bg-slate-50 border border-slate-200 rounded-sm space-y-2">
        <div className="flex items-center justify-between">
          <span className="text-xs font-bold text-slate-700 block">Kop Surat & Identitas SatKer</span>
          <span className="text-[10px] text-slate-500 font-medium">Header resmi surat dinas</span>
        </div>
        <div className="space-y-1">
          <Label className="text-[11px] font-semibold text-slate-600">Nama Satuan Kerja (SatKer)</Label>
          <Input
            value={draft.satkerName}
            onChange={(e) => setDraft((prev) => ({ ...prev, satkerName: e.target.value }))}
            placeholder="Contoh: BIRO ADMINISTRASI KEUANGAN (BAK)"
            className="text-xs font-semibold bg-white rounded-sm border-slate-200 uppercase"
          />
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          <div className="space-y-1">
            <Label className="text-[11px] font-semibold text-slate-600">Email SatKer / Kepala</Label>
            <Input
              type="text"
              value={draft.satkerHeadEmail || ''}
              onChange={(e) => setDraft((prev) => ({ ...prev, satkerHeadEmail: e.target.value }))}
              placeholder="email:{satker_head_email}"
              className="text-xs font-semibold bg-white rounded-sm border-slate-200"
            />
          </div>
          <div className="space-y-1">
            <Label className="text-[11px] font-semibold text-slate-600">No. Telp Kepala SatKer</Label>
            <Input
              type="text"
              value={draft.satkerHeadPhone || ''}
              onChange={(e) => setDraft((prev) => ({ ...prev, satkerHeadPhone: e.target.value }))}
              placeholder="Telp. {satker_head_phone_number}"
              className="text-xs font-semibold bg-white rounded-sm border-slate-200"
            />
          </div>
        </div>
      </div>

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
          <Label htmlFor="composer-tanggal-surat" className="text-xs font-semibold text-slate-700">Tanggal Surat</Label>
          <IndonesianDatePicker
            id="composer-tanggal-surat"
            label="Tanggal Surat"
            value={draft.tanggalSurat}
            onValueChange={(value) => setDraft((prev) => ({ ...prev, tanggalSurat: value }))}
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
          <AutoResizeTextarea
            minRows={1}
            value={draft.perihal}
            onChange={(e) => setDraft((prev) => ({ ...prev, perihal: e.target.value }))}
            placeholder="Perihal naskah dinas..."
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
        {draft.templateType === 'tugas' && <div className="space-y-2 rounded-sm border border-slate-200 bg-slate-50 p-3">
          <span className="block text-xs font-bold text-slate-700">Pemberi Tugas / Penandatangan</span>
          {draft.taskAssigner && <div className="flex items-center gap-2"><div className="flex-1 rounded-sm border border-slate-200 bg-white px-3 py-2 text-xs text-slate-800">{draft.taskAssigner.name} <span className="text-slate-500">· {draft.taskAssigner.collection === 'Employees_Loyalis' ? 'Loyalis' : 'Pekarya'}{draft.taskAssigner.role ? ` · ${draft.taskAssigner.role}` : ''}</span></div><button type="button" aria-label="Hapus pemberi tugas" onClick={() => setDraft((prev) => { const next = { ...prev }; delete next.taskAssigner; next.penandatanganNama = ''; next.penandatanganJabatan = ''; next.penandatanganNipy = ''; return next; })} className="p-2 text-rose-600"><Trash2 className="h-4 w-4" /></button></div>}
          <div className="relative">
            <Input aria-label="Cari pemberi tugas" placeholder={draft.taskAssigner ? 'Ganti pemberi tugas...' : 'Cari pemberi tugas...'} value={assignerSearch} autoComplete="off" onFocus={() => setAssignerSearchOpen(true)} onChange={(e) => { setAssignerSearch(e.target.value); setAssignerSearchOpen(true); }} onBlur={() => window.setTimeout(() => setAssignerSearchOpen(false), 200)} onKeyDown={(e) => { if (e.key === 'Escape') setAssignerSearchOpen(false); }} className="rounded-sm border-slate-200 bg-white text-xs" />
            {assignerSearchOpen && <div className="absolute left-0 right-0 top-full z-50 max-h-48 overflow-y-auto rounded-md border border-slate-200 bg-white shadow-xl">
              {peopleLoading ? <div className="p-3 text-xs text-slate-500">Memuat pegawai...</div> : peopleError ? <div className="p-3 text-xs text-rose-600">{peopleError} <button type="button" className="underline" onClick={() => { setPeopleError(''); setPeopleRetry((count) => count + 1); }}>Coba lagi</button></div> : (['Employees_Loyalis', 'Employees_BlueCollar'] as const).map((collection) => {
                const matches = people.filter((person) => person.collection === collection && `${person.name} ${person.role}`.toLocaleLowerCase('id').includes(assignerSearch.trim().toLocaleLowerCase('id')));
                return matches.length ? <div key={collection}><div className="sticky top-0 bg-slate-50 px-4 py-1.5 text-[9px] font-bold uppercase text-slate-500">{collection === 'Employees_Loyalis' ? 'Loyalis' : 'Pekarya'}</div>{matches.map((person) => <button key={person.id} type="button" onClick={() => { setDraft((prev) => ({ ...prev, taskAssigner: person, penandatanganNama: person.name.slice(0, 100), penandatanganJabatan: person.role.slice(0, 100), penandatanganNipy: '' })); setAssignerSearch(''); setAssignerSearchOpen(false); }} className="flex w-full justify-between gap-3 px-4 py-2 text-left text-xs text-slate-700 hover:bg-slate-50"><span>{person.name}</span><span className="text-[10px] text-slate-400">{person.role}</span></button>)}</div> : null;
              })}
              {!peopleLoading && !peopleError && !people.some((person) => `${person.name} ${person.role}`.toLocaleLowerCase('id').includes(assignerSearch.trim().toLocaleLowerCase('id'))) && <div className="p-3 text-xs text-slate-500">Pegawai tidak ditemukan.</div>}
            </div>}
          </div>
          <p className="text-[11px] text-slate-500">Nama dan jabatan pemberi tugas digunakan sebagai penandatangan dan dapat disunting di bawah.</p>
        </div>}
        {draft.templateType === 'tugas' && <div className="space-y-2 rounded-sm border border-slate-200 bg-slate-50 p-3">
          <span className="block text-xs font-bold text-slate-700">Pegawai yang Ditugaskan</span>
          {(draft.assignedPeople || []).map((person) => <div key={`${person.collection}:${person.id}`} className="flex items-center gap-2">
            <div className="flex-1 rounded-sm border border-slate-200 bg-white px-3 py-2 text-xs text-slate-800">{person.name} <span className="text-slate-500">· {person.collection === 'Employees_Loyalis' ? 'Loyalis' : 'Pekarya'}{person.role ? ` · ${person.role}` : ''}</span></div>
            <button type="button" aria-label={`Hapus ${person.name}`} onClick={() => setDraft((prev) => ({ ...prev, assignedPeople: (prev.assignedPeople || []).filter((item) => item.id !== person.id || item.collection !== person.collection) }))} className="p-2 text-rose-600"><Trash2 className="h-4 w-4" /></button>
          </div>)}
          <div className="relative">
            <Input placeholder={(draft.assignedPeople || []).length >= 100 ? "Maksimal 100 pegawai" : "Cari Pegawai..."} disabled={(draft.assignedPeople || []).length >= 100} value={personSearch} autoComplete="off" onFocus={() => setPersonSearchOpen(true)} onChange={(e) => { setPersonSearch(e.target.value); setPersonSearchOpen(true); }} onBlur={() => window.setTimeout(() => setPersonSearchOpen(false), 200)} onKeyDown={(e) => { if (e.key === 'Escape') setPersonSearchOpen(false); }} className="rounded-sm border-slate-200 bg-white text-xs" />
            {personSearchOpen && <div className="absolute left-0 right-0 top-full z-50 max-h-48 overflow-y-auto rounded-md border border-slate-200 bg-white shadow-xl">
              {peopleLoading ? <div className="p-3 text-xs text-slate-500">Memuat pegawai...</div> : peopleError ? <div className="p-3 text-xs text-rose-600">{peopleError} <button type="button" className="underline" onClick={() => { setPeopleError(''); setPeopleRetry((count) => count + 1); }}>Coba lagi</button></div> : (['Employees_Loyalis', 'Employees_BlueCollar'] as const).map((collection) => {
                const matches = people.filter((person) => person.collection === collection && `${person.name} ${person.role}`.toLocaleLowerCase('id').includes(personSearch.trim().toLocaleLowerCase('id')) && !(draft.assignedPeople || []).some((selected) => selected.id === person.id && selected.collection === person.collection));
                return matches.length ? <div key={collection}><div className="sticky top-0 bg-slate-50 px-4 py-1.5 text-[9px] font-bold uppercase text-slate-500">{collection === 'Employees_Loyalis' ? 'Loyalis' : 'Pekarya'}</div>{matches.map((person) => <button key={person.id} type="button" onClick={() => { setDraft((prev) => ({ ...prev, assignedPeople: [...(prev.assignedPeople || []), person] })); setPersonSearch(''); setPersonSearchOpen(false); }} className="flex w-full justify-between gap-3 px-4 py-2 text-left text-xs text-slate-700 hover:bg-slate-50"><span>{person.name}</span><span className="text-[10px] text-slate-400">{person.role}</span></button>)}</div> : null;
              })}
              {!peopleLoading && !peopleError && !people.some((person) => `${person.name} ${person.role}`.toLocaleLowerCase('id').includes(personSearch.trim().toLocaleLowerCase('id')) && !(draft.assignedPeople || []).some((selected) => selected.id === person.id && selected.collection === person.collection)) && <div className="p-3 text-xs text-slate-500">Pegawai tidak ditemukan atau sudah dipilih.</div>}
            </div>}
          </div>
        </div>}
        <AutoResizeTextarea
          minRows={1}
          value={draft.salamPembuka}
          onChange={(e) => setDraft((prev) => ({ ...prev, salamPembuka: e.target.value }))}
          placeholder="Salam Pembuka"
          className="text-xs font-semibold bg-white rounded-sm border-slate-200"
        />

        <AutoResizeTextarea
          minRows={2}
          value={draft.isiParagraf1}
          onChange={(e) => setDraft((prev) => ({ ...prev, isiParagraf1: e.target.value }))}
          placeholder="Paragraf pembuka..."
          className="w-full text-xs font-medium p-2.5 rounded-sm border border-slate-200 focus:outline-none focus:ring-4 focus:ring-indigo-100 focus:border-indigo-500 transition-all bg-white"
        />

        <AutoResizeTextarea
          minRows={3}
          value={draft.isiParagraf2}
          onChange={(e) => setDraft((prev) => ({ ...prev, isiParagraf2: e.target.value }))}
          placeholder="Isi utama / rincian kegiatan / poin penting..."
          className="w-full text-xs p-2.5 rounded-sm border border-slate-200 focus:outline-none focus:ring-4 focus:ring-indigo-100 focus:border-indigo-500 transition-all bg-white font-mono"
        />

        <AutoResizeTextarea
          minRows={2}
          value={draft.isiParagraf3}
          onChange={(e) => setDraft((prev) => ({ ...prev, isiParagraf3: e.target.value }))}
          placeholder="Paragraf penutup..."
          className="w-full text-xs font-medium p-2.5 rounded-sm border border-slate-200 focus:outline-none focus:ring-4 focus:ring-indigo-100 focus:border-indigo-500 transition-all bg-white"
        />

        <AutoResizeTextarea
          minRows={1}
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

  const previewField = (
    field: LetterField,
    display: string,
    label: string,
    multiline = false,
  ) => {
    if (editingPreview === field) {
      if (field === 'tanggalSurat') {
        return <IndonesianDatePicker value={draft.tanggalSurat} label="Tanggal surat" initiallyOpen onValueChange={(value) => setDraft((prev) => ({ ...prev, tanggalSurat: value }))} onClose={() => setEditingPreview(null)} />;
      }
      const props = {
        autoFocus: true,
        'aria-label': label,
        value: draft[field] || '',
        onChange: (event: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
          setDraft((prev) => ({ ...prev, [field]: event.target.value })),
        onBlur: () => setEditingPreview(null),
        onKeyDown: (event: React.KeyboardEvent<HTMLInputElement | HTMLTextAreaElement>) => {
          if (event.key === 'Escape' || (!multiline && event.key === 'Enter')) event.currentTarget.blur();
        },
        className: field === 'perihal'
          ? 'block w-full min-w-0 resize-none border-0 bg-transparent p-0 font-inherit text-inherit underline outline outline-1 outline-indigo-400 focus:outline-2'
          : 'w-full min-w-0 rounded border border-indigo-400 bg-white px-1 text-inherit font-inherit text-slate-900 outline-none focus:ring-2 focus:ring-indigo-200',
        ...(field === 'perihal' ? { style: { fieldSizing: 'content' as const, fontFamily: 'inherit', fontSize: 'inherit', fontWeight: 'inherit', lineHeight: 'inherit' } } : {}),
      };
      return multiline ? <textarea {...props} rows={field === 'perihal' ? 1 : Math.max(2, (draft[field] || '').split('\n').length)} /> : <input {...props} type="text" />;
    }
    return <span role="button" tabIndex={0} title={`Klik dua kali untuk mengedit ${label}`} className="cursor-text rounded-sm hover:bg-indigo-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-indigo-500" onDoubleClick={() => setEditingPreview(field)} onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); setEditingPreview(field); } }}>{display}</span>;
  };

  // Shared Preview Paper JSX
  const renderPreviewPaper = () => (
    <LetterPaper
      id="printable-official-letter"
      draft={draft}
      defaultSatkerName={defaultSatkerName}
      isYapetidu={isYapetidu}
      email={draft.satkerHeadEmail || defaultKepalaEmail || profile?.email || user?.email || ''}
      phone={draft.satkerHeadPhone || defaultKepalaPhone || profile?.phoneNumber || profile?.phone || ''}
      renderField={previewField}
      isEditing={(field) => editingPreview === field}
    />
  );

  const content = (
      <div className={inline ? 'bg-white rounded-md p-6 border border-slate-200 shadow-sm flex flex-col' : 'h-full flex flex-col overflow-hidden'}>
        {/* Header Bar */}
        <DialogHeader className="space-y-1 pb-3 border-b border-slate-100 shrink-0">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <div className="p-1.5 rounded-sm bg-indigo-50 text-indigo-600 border border-indigo-100">
                <Wand2 className="w-5 h-5" />
              </div>
              <div>
                {inline ? <><h2 className="text-xl font-bold tracking-tight text-slate-900">{surat ? 'Edit Surat Keluar' : 'Catat Surat Keluar'}</h2><p className="text-xs text-slate-500">{surat ? 'Ubah isi surat dan lihat hasilnya secara langsung.' : 'Susun surat dinas dan lihat hasilnya secara langsung.'}</p></> : <><DialogTitle className="text-xl font-bold tracking-tight text-slate-900">Pembuat Surat Resmi SatKer</DialogTitle><DialogDescription className="text-xs text-slate-500">Susun surat dinas resmi dengan kop SatKer, format standar, dan cetak langsung ke PDF.</DialogDescription></>}
              </div>
            </div>
          </div>
        </DialogHeader>

        {/* Notifications */}
        {error && (
          <div className="text-xs font-medium text-rose-600 bg-rose-50 border border-rose-200 p-2.5 rounded-sm my-1 shrink-0">
            {error}
          </div>
        )}
        {saveSuccess && lastSavedDraft === JSON.stringify(draft) && (
          <div className="text-xs font-medium text-emerald-700 bg-emerald-50 border border-emerald-200 p-2.5 rounded-sm my-1 shrink-0">
            {saveSuccess}
          </div>
        )}
        {/* Template Selector Bar */}
        <div className="py-2.5 shrink-0 flex flex-wrap items-center gap-2 border-b border-slate-100">
          <Label htmlFor="surat-template" className="text-xs font-semibold text-slate-500 shrink-0">Pilih Template:</Label>
          <OptionSelect
            id="surat-template"
            value={draft.templateType}
            onValueChange={(value) => {
              const template = TEMPLATE_OPTIONS.find((option) => option.id === value);
              if (template) handleTemplateChange(template.id);
            }}
            options={TEMPLATE_OPTIONS.map((template) => ({ value: template.id, label: template.title }))}
            size="sm"
            className="w-full max-w-64"
          />
          {/* Action Buttons */}
          <div className="ml-auto flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={handlePrint}
              disabled={saving}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-sm border border-slate-200 text-slate-700 bg-white hover:bg-slate-50 transition-all shadow-sm cursor-pointer disabled:opacity-50"
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
              {saving ? 'Menyimpan...' : savedId ? (inline ? 'Simpan Perubahan' : 'Simpan Naskah') : 'Simpan ke Surat Keluar'}
            </Button>
          </div>
        </div>

        {/* Content Body */}
        <div className={inline ? 'py-3 overflow-x-auto' : 'flex-1 min-h-0 py-3 overflow-x-auto overflow-y-hidden'}>
            <div className="h-full min-w-[900px] flex flex-row gap-6 min-h-0">
              {/* Left Column: Form Fields */}
              <div className={inline ? 'w-[45%] xl:w-[42%] pr-3' : 'w-[45%] xl:w-[42%] h-full overflow-y-auto pr-3'}>
                {renderEditorForm()}
              </div>

              {/* Right Column: Live A4 Visual Preview */}
              <div className={`w-[55%] xl:w-[58%] ${inline ? '' : 'h-full'} bg-slate-100/90 rounded-md p-4 sm:p-6 overflow-auto flex justify-center items-start border border-slate-200`}>
                {renderPreviewPaper()}
              </div>
            </div>
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
      </div>
  );
  if (inline) return content;
  return <Dialog open={open} onOpenChange={onOpenChange}><DialogContent className="w-[96vw] max-w-[96vw] sm:max-w-[96vw] lg:max-w-7xl h-[94vh] max-h-[94vh] bg-white rounded-md p-6 border border-slate-100 shadow-[0_20px_50px_rgba(0,0,0,0.1)] overflow-hidden">{content}</DialogContent></Dialog>;
}
