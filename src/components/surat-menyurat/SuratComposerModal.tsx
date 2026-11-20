"use client";

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useEditor } from '@tiptap/react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { OptionSelect } from '@/components/ui/option-select';
import { useAuth } from '@/lib/AuthContext';
import { TEMPLATE_OPTIONS } from '@/lib/surat-menyurat/constants';
import { formatNomorSuratKeluar, satkerCodeFor } from '@/lib/surat-menyurat/numbering';
import { applyTemplateDefaults, draftFromSurat, draftRecipient, getDefaultDraft, LetterDraftPayload, AssignedPerson, TUJUAN_MAX_LENGTH } from '@/lib/surat-menyurat/templates';
import { SuratKeluar, TemplateType } from '@/lib/surat-menyurat/types';
import { extractLetterFields, letterDocText, sanitizeLetterDoc, type LetterDoc } from '@/lib/surat-menyurat/letterDoc';
import { buildLetterDoc } from '@/lib/surat-menyurat/letterDocBuild';
import LetterPaper from './LetterPaper';
import LetterToolbar from './LetterToolbar';
import { letterDocExtensions, LetterEditorContext, type LetterEditorControls } from './letterDocExtensions';
import { LETTER_PRINT_CSS } from './letterPaperCss';
import { Loader2, Printer, Save, Sparkles, Wand2 } from 'lucide-react';

const NO_PEOPLE: AssignedPerson[] = [];

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
  /** The editor works on the whole letter; an older letter, or a fresh template, is laid out from its fields first. */
  const withDoc = (value: LetterDraftPayload): LetterDraftPayload => (value.letterDoc ? value : { ...value, letterDoc: buildLetterDoc(value, { isYapetidu }) });
  const [draft, setDraft] = useState<LetterDraftPayload>(() => {
    if (surat) return withDoc(draftFromSurat(surat, defaultSatkerName));
    const initial = getDefaultDraft(
      defaultSatkerName,
      defaultKepalaName,
      'Kepala',
      defaultKepalaEmail || profile?.email || user?.email || '',
      defaultKepalaPhone || profile?.phoneNumber || profile?.phone || '',
    );
    initial.nomorSurat = formatNomorSuratKeluar({ sequenceNumber: nextSequence, satkerCode: satkerCodeFor(defaultSatkerInitials, defaultSatkerName), date: new Date() });
    return withDoc(initial);
  });
  const [savedId, setSavedId] = useState<string | null>(surat?.id || null);
  const savedTemplateType = useRef(draft.templateType);
  const [lastSavedDraft, setLastSavedDraft] = useState<string | null>(surat?.letterDraft ? JSON.stringify(draft) : null);
  const [saving, setSaving] = useState(false);
  const savingRef = useRef(false);
  const [saveSuccess, setSaveSuccess] = useState('');
  const [error, setError] = useState('');
  const [people, setPeople] = useState<AssignedPerson[]>([]);
  const [peopleLoaded, setPeopleLoaded] = useState(false);
  const [peopleError, setPeopleError] = useState('');
  const [peopleRetry, setPeopleRetry] = useState(0);
  const peopleLoading = !peopleLoaded && !peopleError;

  useEffect(() => {
    if (draft.templateType !== 'tugas' || !user || peopleLoaded) return;
    let cancelled = false;
    user.getIdToken().then((token) => fetch('/api/satker-surat/employees', { headers: { Authorization: `Bearer ${token}` } }))
      .then(async (response) => { const data = await response.json(); if (!response.ok || !data.ok) throw new Error(data.error || 'Gagal memuat pegawai.'); return data.people as AssignedPerson[]; })
      .then((list) => { if (!cancelled) { setPeople(list); setPeopleLoaded(true); setPeopleError(''); } })
      .catch((err) => { if (!cancelled) setPeopleError(err instanceof Error ? err.message : 'Gagal memuat pegawai.'); });
    return () => { cancelled = true; };
  }, [draft.templateType, user, peopleLoaded, peopleRetry]);

  const lastDoc = useRef<LetterDoc | undefined>(draft.letterDoc);
  const extensions = useMemo(() => letterDocExtensions(), []);
  const editor = useEditor({
    extensions,
    content: draft.letterDoc,
    immediatelyRender: false,
    editorProps: { attributes: { 'aria-label': 'Isi surat', lang: 'id', spellcheck: 'true' } },
    onUpdate: ({ editor: current }) => {
      const letterDoc = current.getJSON() as LetterDoc;
      lastDoc.current = letterDoc;
      // The number, subject, date, recipient and signer are read back from what is written on the paper.
      const fields = extractLetterFields(letterDoc);
      setDraft((prev) => ({ ...prev, ...fields, letterDoc }));
    },
  });
  // A new letter from outside the editor (choosing another template) replaces what it shows.
  useEffect(() => {
    if (!editor || !draft.letterDoc || draft.letterDoc === lastDoc.current) return;
    lastDoc.current = draft.letterDoc;
    editor.commands.setContent(draft.letterDoc, { emitUpdate: false });
  }, [editor, draft.letterDoc]);

  const handleTemplateChange = (newType: TemplateType) => {
    setDraft((prev) => {
      const next = applyTemplateDefaults(prev, newType, prev.satkerName, prev.penandatanganNama, prev.penandatanganJabatan);
      if (isYapetidu) {
        next.isiParagraf1 = next.isiParagraf1.replace("Universitas Pesantren Tinggi Darul 'Ulum (UNIPDU) Jombang", "Yayasan Pesantren Tinggi Darul 'Ulum Jombang");
      }
      const result = savedId ? { ...next, perihal: prev.perihal, tujuanNama: prev.tujuanNama,
        tujuanAlamatKota: prev.tujuanAlamatKota,
        penandatanganNama: prev.penandatanganNama, penandatanganJabatan: prev.penandatanganJabatan } : next;
      delete result.letterDoc;
      return withDoc(result);
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
    if (editor) editor.commands.setLetterField('nomorSurat', autoNo);
    else setDraft((prev) => ({ ...prev, nomorSurat: autoNo }));
  };

  const handlePrint = async () => {
    if (savingRef.current) return;
    const printContent = document.getElementById('printable-official-letter');
    if (!printContent) return;
    // The preview's own page guides and spacing do not belong in the printout.
    const printCopy = printContent.cloneNode(true) as HTMLElement;
    printCopy.querySelectorAll('[data-letter-screen-only]').forEach((node) => node.remove());
    printCopy.querySelectorAll('[contenteditable]').forEach((node) => node.removeAttribute('contenteditable'));
    // The preview pushes the closing block down by itself when a page break would split it; the printer does that on its own.
    printCopy.querySelectorAll<HTMLElement>('.letter-closing').forEach((node) => node.style.removeProperty('margin-top'));
    const letterHtml = printCopy.innerHTML;
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
          <meta charset="utf-8">
          <title></title>
          <style>${LETTER_PRINT_CSS}</style>
        </head>
        <body>
          <div class="letter-sheet"><div class="letter-doc">${letterHtml}</div></div>
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
    // Say so here when the letter itself is the problem, instead of the server's general refusal.
    if (draft.letterDoc && !sanitizeLetterDoc(draft.letterDoc)) {
      setError('Isi surat memuat bagian yang tidak dapat disimpan atau gambar/teks terlalu besar. Perkecil atau hapus gambar, lalu coba lagi.');
      return false;
    }
    const tujuan = draftRecipient(draft);
    if (!tujuan || tujuan.length > TUJUAN_MAX_LENGTH) {
      setError(`Tujuan surat wajib diisi dan maksimal ${TUJUAN_MAX_LENGTH} karakter.`);
      return false;
    }

    savingRef.current = true;
    try {
      setSaving(true);
      setError('');
      setSaveSuccess('');
      const idToken = await user.getIdToken();

      const combinedBody = [
        ...(draft.templateType === 'tugas' && draft.taskAssigner ? [`Pemberi tugas:\nNama: ${draft.penandatanganNama}\nJabatan: ${draft.penandatanganJabatan || '-'}`] : []),
        letterDocText(draft.letterDoc, draft.assignedPeople),
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
        // The written letter replaces the fields older letters used for greetings and body.
        letterDraft: { ...draft, salamPembuka: '', salamPenutup: '', isiParagraf1: '', isiParagraf2: '', isiParagraf3: '' },
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

  const directory = { people, loading: peopleLoading, error: peopleError, retry: () => { setPeopleError(''); setPeopleRetry((count) => count + 1); } };
  const pickAssigner = (person: AssignedPerson) => {
    setDraft((prev) => ({ ...prev, taskAssigner: person }));
    // The task giver signs the letter, so the signature takes their name and title (and no NIPY).
    editor?.chain().setLetterField('penandatanganNama', person.name.slice(0, 100)).setLetterField('penandatanganJabatan', `${person.role.slice(0, 100)},`).setLetterField('penandatanganNipy', '').run();
  };
  const controls: LetterEditorControls = {
    assigned: draft.assignedPeople ?? NO_PEOPLE,
    directory,
    onAddPerson: (person) => setDraft((prev) => ((prev.assignedPeople || []).length >= 100 ? prev : { ...prev, assignedPeople: [...(prev.assignedPeople || []), person] })),
    onRemovePerson: (person) => setDraft((prev) => ({ ...prev, assignedPeople: (prev.assignedPeople || []).filter((item) => item.id !== person.id || item.collection !== person.collection) })),
    assigner: draft.taskAssigner,
    signerName: draft.penandatanganNama,
    signerTitle: draft.penandatanganJabatan,
    onPickAssigner: pickAssigner,
    onClearAssigner: () => {
      setDraft((prev) => { const next = { ...prev }; delete next.taskAssigner; return next; });
      editor?.chain().setLetterField('penandatanganNama', '').setLetterField('penandatanganJabatan', '').setLetterField('penandatanganNipy', '').run();
    },
  };

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
                {inline ? <><h2 className="text-xl font-bold tracking-tight text-slate-900">{surat ? 'Edit Surat Keluar' : 'Catat Surat Keluar'}</h2><p className="text-xs text-slate-500">Tulis dan ubah langsung pada kertas, seperti di Word atau Google Docs.</p></> : <><DialogTitle className="text-xl font-bold tracking-tight text-slate-900">Pembuat Surat Resmi SatKer</DialogTitle><DialogDescription className="text-xs text-slate-500">Susun surat dinas resmi dengan kop SatKer, format standar, dan cetak langsung ke PDF.</DialogDescription></>}
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
              onClick={handleGenerateNumber}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-sm border border-slate-200 text-slate-700 bg-white hover:bg-slate-50 transition-all shadow-sm cursor-pointer"
            >
              <Sparkles className="w-3.5 h-3.5 text-indigo-600" />
              Nomor Otomatis
            </button>
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

        {/* Content Body: the letter itself, written in place */}
        <div className={inline ? 'py-3' : 'flex-1 min-h-0 py-3'}>
          <div className={`bg-slate-100/90 rounded-md overflow-auto border border-slate-200 ${inline ? 'max-h-[calc(100dvh-12rem)] min-h-[32rem]' : 'h-full'}`}>
            <div className="sticky top-0 z-10 flex justify-center bg-slate-100/90 px-4 pt-3 pb-2 backdrop-blur-sm">
              <LetterToolbar editor={editor} onError={setError} />
            </div>
            <div className="flex items-start justify-center px-4 pb-4 pt-2 sm:px-6 sm:pb-6">
              <LetterEditorContext.Provider value={controls}>
                <LetterPaper id="printable-official-letter" draft={draft} isYapetidu={isYapetidu} editor={editor} />
              </LetterEditorContext.Provider>
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
