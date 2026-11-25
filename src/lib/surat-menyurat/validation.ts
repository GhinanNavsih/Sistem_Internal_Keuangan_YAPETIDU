import { InstitutionScope, SifatSurat, SuratAttachment } from './types';

const VALID_SIFAT: readonly SifatSurat[] = ['biasa', 'penting', 'segera', 'rahasia'];
const VALID_SCOPES: readonly InstitutionScope[] = ['UNIPDU', 'YAPETIDU', 'SATKER'];
const ISO_DATE_REGEX = /^\d{4}-\d{2}-\d{2}$/;

export function sanitizeText(val: unknown): string {
  if (typeof val !== 'string') return '';
  return val.trim();
}

export function validateSuratMasukInput(raw: Record<string, unknown>): {
  ok: boolean;
  error?: string;
  data?: {
    institutionScope?: InstitutionScope;
    nomorUrut?: number;
    kodeSurat?: string;
    kodeArsip?: string;
    usiaArsip?: string;
    nomorSurat: string;
    tanggalSurat: string;
    tanggalDiterima: string;
    pengirim: string;
    penerima: string;
    perihal: string;
    sifat: SifatSurat;
    kategori: string;
    ringkasan: string;
    attachments: SuratAttachment[];
  };
} {
  const nomorSurat = sanitizeText(raw.nomorSurat);
  if (!nomorSurat) return { ok: false, error: 'Nomor surat wajib diisi.' };

  const tanggalSurat = sanitizeText(raw.tanggalSurat);
  if (!ISO_DATE_REGEX.test(tanggalSurat)) return { ok: false, error: 'Tanggal surat tidak valid (YYYY-MM-DD).' };

  const tanggalDiterima = sanitizeText(raw.tanggalDiterima);
  if (!ISO_DATE_REGEX.test(tanggalDiterima)) return { ok: false, error: 'Tanggal diterima tidak valid (YYYY-MM-DD).' };

  const pengirim = sanitizeText(raw.pengirim);
  if (!pengirim) return { ok: false, error: 'Pengirim surat wajib diisi.' };

  const penerima = sanitizeText(raw.penerima) || 'Kepala SatKer';
  const perihal = sanitizeText(raw.perihal);
  if (!perihal) return { ok: false, error: 'Perihal surat wajib diisi.' };

  const sifat = (raw.sifat as SifatSurat) || 'biasa';
  if (!VALID_SIFAT.includes(sifat)) return { ok: false, error: 'Sifat surat tidak valid.' };

  const kategori = sanitizeText(raw.kategori) || 'Lainnya';
  const ringkasan = sanitizeText(raw.ringkasan);

  const institutionScope = (raw.institutionScope && VALID_SCOPES.includes(raw.institutionScope as InstitutionScope))
    ? (raw.institutionScope as InstitutionScope)
    : undefined;

  const nomorUrut = typeof raw.nomorUrut === 'number' && raw.nomorUrut > 0 ? raw.nomorUrut : undefined;
  const kodeSurat = sanitizeText(raw.kodeSurat) || undefined;
  const kodeArsip = sanitizeText(raw.kodeArsip) || undefined;
  const usiaArsip = sanitizeText(raw.usiaArsip) || undefined;

  const attachments = Array.isArray(raw.attachments) ? (raw.attachments as SuratAttachment[]) : [];

  return {
    ok: true,
    data: {
      institutionScope,
      nomorUrut,
      kodeSurat,
      kodeArsip,
      usiaArsip,
      nomorSurat,
      tanggalSurat,
      tanggalDiterima,
      pengirim,
      penerima,
      perihal,
      sifat,
      kategori,
      ringkasan,
      attachments,
    },
  };
}

export function validateSuratKeluarInput(raw: Record<string, unknown>): {
  ok: boolean;
  error?: string;
  data?: {
    institutionScope?: InstitutionScope;
    nomorUrut?: number;
    nomorUrutEnd?: number;
    kodeSurat?: string;
    kodeArsip?: string;
    usiaArsip?: string;
    nomorSurat: string;
    tanggalSurat: string;
    tujuan: string;
    perihal: string;
    sifat: SifatSurat;
    kategori: string;
    ringkasan: string;
    penandatanganNama: string;
    penandatanganJabatan: string;
    templateType?: string;
    contentBody?: string;
    lampiranKeterangan?: string;
    attachments: SuratAttachment[];
  };
} {
  const nomorSurat = sanitizeText(raw.nomorSurat);
  if (!nomorSurat) return { ok: false, error: 'Nomor surat keluar wajib diisi.' };

  const tanggalSurat = sanitizeText(raw.tanggalSurat);
  if (!ISO_DATE_REGEX.test(tanggalSurat)) return { ok: false, error: 'Tanggal surat tidak valid (YYYY-MM-DD).' };

  const tujuan = sanitizeText(raw.tujuan);
  if (!tujuan) return { ok: false, error: 'Tujuan surat wajib diisi.' };

  const perihal = sanitizeText(raw.perihal);
  if (!perihal) return { ok: false, error: 'Perihal surat keluar wajib diisi.' };

  const sifat = (raw.sifat as SifatSurat) || 'biasa';
  if (!VALID_SIFAT.includes(sifat)) return { ok: false, error: 'Sifat surat tidak valid.' };

  const kategori = sanitizeText(raw.kategori) || 'Lainnya';
  const ringkasan = sanitizeText(raw.ringkasan);
  const penandatanganNama = sanitizeText(raw.penandatanganNama);
  const penandatanganJabatan = sanitizeText(raw.penandatanganJabatan);

  const institutionScope = (raw.institutionScope && VALID_SCOPES.includes(raw.institutionScope as InstitutionScope))
    ? (raw.institutionScope as InstitutionScope)
    : undefined;

  const nomorUrut = typeof raw.nomorUrut === 'number' && raw.nomorUrut > 0 ? raw.nomorUrut : undefined;
  const nomorUrutEnd = typeof raw.nomorUrutEnd === 'number' && raw.nomorUrutEnd > 0 ? raw.nomorUrutEnd : undefined;
  const kodeSurat = sanitizeText(raw.kodeSurat) || undefined;
  const kodeArsip = sanitizeText(raw.kodeArsip) || undefined;
  const usiaArsip = sanitizeText(raw.usiaArsip) || undefined;

  const templateType = sanitizeText(raw.templateType) || undefined;
  const contentBody = typeof raw.contentBody === 'string' ? raw.contentBody : undefined;
  const lampiranKeterangan = sanitizeText(raw.lampiranKeterangan) || undefined;
  const attachments = Array.isArray(raw.attachments) ? (raw.attachments as SuratAttachment[]) : [];

  return {
    ok: true,
    data: {
      institutionScope,
      nomorUrut,
      nomorUrutEnd,
      kodeSurat,
      kodeArsip,
      usiaArsip,
      nomorSurat,
      tanggalSurat,
      tujuan,
      perihal,
      sifat,
      kategori,
      ringkasan,
      penandatanganNama,
      penandatanganJabatan,
      templateType,
      contentBody,
      lampiranKeterangan,
      attachments,
    },
  };
}
