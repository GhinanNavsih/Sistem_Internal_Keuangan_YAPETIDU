"use client";

import React from 'react';
import Image from 'next/image';
import { formatPenandatanganJabatan, type LetterDraftPayload } from '@/lib/surat-menyurat/templates';
import { formatLetterDate } from '@/lib/surat-menyurat/date';

/** Draft fields the paper shows, and the composer lets people edit in place. */
export type LetterField = Exclude<keyof LetterDraftPayload, 'templateType' | 'assignedPeople' | 'taskAssigner'>;

interface Props {
  draft: LetterDraftPayload;
  defaultSatkerName: string;
  isYapetidu: boolean;
  /** Head's contact for the letterhead; blank shows a placeholder unless `readOnly`. */
  email: string;
  phone: string;
  /** Set when the paper is printed from the DOM by id. */
  id?: string;
  /** Plain viewing: no placeholders for missing contact details. */
  readOnly?: boolean;
  /** Wraps a field's text so the composer can make it editable in place. */
  renderField?: (field: LetterField, display: string, label: string, multiline?: boolean) => React.ReactNode;
  /** Keeps an empty field visible while it is being edited. */
  isEditing?: (field: LetterField) => boolean;
}

/** The official letter on an A4 sheet: letterhead, body and signature. */
export default function LetterPaper({
  draft,
  defaultSatkerName,
  isYapetidu,
  email,
  phone,
  id,
  readOnly = false,
  renderField,
  isEditing,
}: Props) {
  const field = (name: LetterField, display: string, label: string, multiline = false): React.ReactNode =>
    renderField ? renderField(name, display, label, multiline) : display;
  const editing = (name: LetterField) => Boolean(isEditing?.(name));

  const emailDisplay = email || '{satker_head_email}';
  const phoneDisplay = phone || '{satker_head_phone_number}';
  const emailFormatted = emailDisplay.startsWith('{') ? `email:${emailDisplay}` : `email: ${emailDisplay}`;

  return (
    <div
      id={id}
      className="bg-white shadow-xl border border-slate-200 rounded-xs p-6 sm:p-8 md:p-10 w-full min-w-[540px] max-w-[210mm] text-slate-900 font-serif text-[12.5px] leading-relaxed select-text"
      style={{ minHeight: '297mm' }}
    >
      {/* Kop surat sesuai lingkup surat yang dicatat */}
      <div className="kop-container border-b-4 border-double border-slate-900 pb-3 mb-6 flex items-center justify-between gap-2 sm:gap-3">
        <div className="w-14 h-14 relative shrink-0 flex items-center justify-center">
          <Image
            src={isYapetidu ? '/Logo YAPETIDU (Transparent bg).png' : '/Logo UNIPDU.png'}
            alt={isYapetidu ? 'Logo YAPETIDU' : 'Logo UNIPDU'}
            width={56}
            height={56}
            priority
            className="object-contain"
          />
        </div>
        <div className="kop-text flex-1 text-center min-w-0 px-1 sm:px-2">
          <h1 className="kop-instansi text-xs sm:text-sm md:text-[15px] lg:text-[16px] font-black uppercase tracking-tight text-slate-900 m-0 leading-tight whitespace-nowrap">
            {isYapetidu ? "YAYASAN PESANTREN TINGGI DARUL 'ULUM JOMBANG" : 'UNIVERSITAS PESANTREN TINGGI DARUL ULUM'}
          </h1>
          <h2 className="kop-satker text-[11px] sm:text-xs md:text-[13px] lg:text-sm font-bold uppercase tracking-tight text-slate-800 my-1 leading-snug whitespace-nowrap">
            {field('satkerName', draft.satkerName || defaultSatkerName || 'SATUAN KERJA', 'nama SatKer')}
          </h2>
          <p className="kop-alamat text-[9px] sm:text-[9.5px] md:text-[10px] text-slate-600 m-0 leading-tight whitespace-nowrap">
            Alamat: PP Darul Ulum, Tromol Pos 10 Peterongan Jombang Jawa Timur 61481
          </p>
          <p className="kop-kontak text-[9px] sm:text-[9.5px] md:text-[10px] text-slate-600 mt-0.5 m-0 leading-tight whitespace-nowrap">
            Website: unipdu.ac.id
            {(!readOnly || email) && <> | {field('satkerHeadEmail', emailFormatted, 'email')}</>}
            {(!readOnly || phone) && <> | Telp. {field('satkerHeadPhone', phoneDisplay, 'telepon')}</>}
          </p>
        </div>
        <div className="w-14 shrink-0" />
      </div>

      {/* Nomor, Lampiran, Hal */}
      <div className="letter-meta mb-6 text-xs">
        <div className="meta-left space-y-0.5">
          <div className="flex">
            <span className="w-16">Nomor</span>
            <span className="w-3">:</span>
            <span className="font-semibold">{field('nomorSurat', draft.nomorSurat, 'nomor surat')}</span>
          </div>
          <div className="flex">
            <span className="w-16">Lampiran</span>
            <span className="w-3">:</span>
            <span>{field('lampiranKeterangan', draft.lampiranKeterangan || '-', 'lampiran')}</span>
          </div>
          <div className="flex">
            <span className="w-16 shrink-0">Hal</span>
            <span className="w-3 shrink-0">:</span>
            <span className="min-w-0 flex-1 font-semibold underline whitespace-pre-wrap">{field('perihal', draft.perihal || 'Surat Dinas', 'perihal', true)}</span>
          </div>
        </div>
      </div>

      {/* Kepada Yth */}
      <div className="destination-block mb-6 text-xs">
        <p className="m-0">Kepada Yth.</p>
        <p className="font-bold m-0">{field('tujuanNama', draft.tujuanNama || 'Bapak / Ibu', 'nama penerima')}</p>
        {(draft.tujuanJabatanInstansi || editing('tujuanJabatanInstansi')) && <p className="m-0">{field('tujuanJabatanInstansi', draft.tujuanJabatanInstansi, 'instansi penerima')}</p>}
        <p className="m-0 italic">{field('tujuanAlamatKota', draft.tujuanAlamatKota || 'di Tempat', 'alamat penerima')}</p>
      </div>

      {/* Isi Surat */}
      <div className="letter-content space-y-3 text-xs text-justify">
        {(draft.salamPembuka || editing('salamPembuka')) && (
          <p className="italic font-medium">{field('salamPembuka', draft.salamPembuka, 'salam pembuka', true)}</p>
        )}
        {draft.templateType === 'tugas' && draft.taskAssigner && <div className="whitespace-pre-line">Pemberi tugas:<br />Nama: {draft.penandatanganNama}<br />Jabatan: {draft.penandatanganJabatan}</div>}
        {(draft.isiParagraf1 || editing('isiParagraf1')) && (
          <p className="indent-6 leading-relaxed whitespace-pre-line">{field('isiParagraf1', draft.isiParagraf1, 'paragraf pembuka', true)}</p>
        )}
        {draft.templateType === 'tugas' && (draft.assignedPeople || []).length > 0 && <ol className="list-decimal pl-8">{draft.assignedPeople?.map((person) => <li key={`${person.collection}:${person.id}`}>{person.name}{person.role ? ` — ${person.role}` : ''}</li>)}</ol>}
        {(draft.isiParagraf2 || editing('isiParagraf2')) && (
          <div className="raw-block pl-6 whitespace-pre-wrap font-mono text-[11px] leading-relaxed bg-slate-50/50 p-2 border-l-2 border-slate-300 rounded-sm">
            {field('isiParagraf2', draft.isiParagraf2, 'isi surat', true)}
          </div>
        )}
        {(draft.isiParagraf3 || editing('isiParagraf3')) && (
          <p className="indent-6 leading-relaxed whitespace-pre-line">{field('isiParagraf3', draft.isiParagraf3, 'paragraf penutup', true)}</p>
        )}
        {(draft.salamPenutup || editing('salamPenutup')) && (
          <p className="italic font-medium pt-1">{field('salamPenutup', draft.salamPenutup, 'salam penutup', true)}</p>
        )}
      </div>

      {/* Tanda Tangan */}
      <div className="signature-block mt-10 ml-auto w-64 text-center text-xs">
        <p className="signature-date m-0 text-slate-800 font-medium">
          Jombang, {field('tanggalSurat', formatLetterDate(draft.tanggalSurat), 'tanggal surat')}
        </p>
        <p className="m-0 font-medium mt-1">
          {field('penandatanganJabatan', draft.templateType === 'tugas' && draft.taskAssigner ? draft.penandatanganJabatan : formatPenandatanganJabatan(draft.penandatanganJabatan, draft.satkerName || defaultSatkerName), 'jabatan penandatangan')},
        </p>
        <div className="sign-space h-20" />
        <p className="sign-name font-bold underline m-0">
          {field('penandatanganNama', draft.penandatanganNama, 'nama penandatangan')}
        </p>
        {(draft.penandatanganNipy || editing('penandatanganNipy')) && (
          <p className="text-[11px] text-slate-600 m-0">NIPY: {field('penandatanganNipy', draft.penandatanganNipy, 'NIPY')}</p>
        )}
      </div>
    </div>
  );
}
