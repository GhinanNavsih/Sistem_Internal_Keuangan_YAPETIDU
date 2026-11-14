export type SuratType = 'masuk' | 'keluar';

export type SifatSurat = 'biasa' | 'penting' | 'segera' | 'rahasia';

export type TemplateType = 'tugas' | 'keterangan' | 'undangan' | 'pengantar' | 'permohonan' | 'edaran' | 'rekomendasi' | 'balasan' | 'custom';

export type InstitutionScope = 'UNIPDU' | 'YAPETIDU' | 'SATKER';

import type { LetterDraftPayload } from './templates';

export interface SuratAttachment {
  id: string;
  name: string;
  url: string;
  contentType: string;
  size: number;
  uploadedAt: string;
}

export interface SuratMasuk {
  id: string;
  institutionScope?: InstitutionScope;
  nomorUrut?: number;
  kodeSurat?: string;
  kodeArsip?: string;
  usiaArsip?: string;
  satkerId: string;
  satkerName: string;
  nomorSurat: string;
  tanggalSurat: string; // YYYY-MM-DD
  tanggalDiterima: string; // YYYY-MM-DD
  pengirim: string;
  penerima: string;
  perihal: string;
  sifat: SifatSurat;
  kategori: string;
  ringkasan?: string;
  attachments: SuratAttachment[];
  createdAt: string;
  updatedAt: string;
  createdByUid: string;
  createdByName: string;
}

export interface SuratKeluar {
  id: string;
  institutionScope?: InstitutionScope;
  nomorUrut?: number;
  nomorUrutEnd?: number; // For batch multi-recipient ranges (e.g. 011-015)
  kodeSurat?: string;
  kodeArsip?: string;
  usiaArsip?: string;
  satkerId: string;
  satkerName: string;
  nomorSurat: string;
  tanggalSurat: string; // YYYY-MM-DD
  tujuan: string;
  perihal: string;
  sifat: SifatSurat;
  kategori: string;
  ringkasan?: string;
  penandatanganNama: string;
  penandatanganJabatan: string;
  templateType?: TemplateType;
  contentBody?: string;
  letterDraft?: LetterDraftPayload;
  lampiranKeterangan?: string;
  attachments: SuratAttachment[];
  createdAt: string;
  updatedAt: string;
  createdByUid: string;
  createdByName: string;
}

export interface SuratStats {
  totalMasuk: number;
  totalKeluar: number;
  suratBulanIni: number;
}

