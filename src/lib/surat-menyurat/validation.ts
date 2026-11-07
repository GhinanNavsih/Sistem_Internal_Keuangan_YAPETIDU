import { SifatSurat, StatusSuratMasuk, StatusSuratKeluar, SuratAttachment } from './types';

const VALID_SIFAT: readonly SifatSurat[] = ['biasa', 'penting', 'segera', 'rahasia'];
const VALID_STATUS_MASUK: readonly StatusSuratMasuk[] = ['menunggu_disposisi', 'diproses', 'selesai', 'diarsipkan'];
const VALID_STATUS_KELUAR: readonly StatusSuratKeluar[] = ['draft', 'disetujui', 'terkirim', 'diarsipkan'];
const ISO_DATE_REGEX = /^\d{4}-\d{2}-\d{2}$/;

export function sanitizeText(val: unknown, max = 300): string {
  if (typeof val !== 'string') return '';
  return val.trim().slice(0, max);
}

export function validateSuratMasukInput(raw: Record<string, unknown>): {
  ok: boolean;
  error?: string;
  data?: {
    nomorSurat: string;
    tanggalSurat: string;
    tanggalDiterima: string;
    pengirim: string;
    penerima: string;
    perihal: string;
    sifat: SifatSurat;
    kategori: string;
    ringkasan: string;
    status: StatusSuratMasuk;
    attachments: SuratAttachment[];
  };
} {
  const nomorSurat = sanitizeText(raw.nomorSurat, 100);
  if (!nomorSurat) return { ok: false, error: 'Nomor surat wajib diisi.' };

  const tanggalSurat = sanitizeText(raw.tanggalSurat, 10);
  if (!ISO_DATE_REGEX.test(tanggalSurat)) return { ok: false, error: 'Tanggal surat tidak valid (YYYY-MM-DD).' };

  const tanggalDiterima = sanitizeText(raw.tanggalDiterima, 10);
  if (!ISO_DATE_REGEX.test(tanggalDiterima)) return { ok: false, error: 'Tanggal diterima tidak valid (YYYY-MM-DD).' };

  const pengirim = sanitizeText(raw.pengirim, 150);
  if (!pengirim) return { ok: false, error: 'Pengirim surat wajib diisi.' };

  const penerima = sanitizeText(raw.penerima, 150) || 'Kepala SatKer';
  const perihal = sanitizeText(raw.perihal, 250);
  if (!perihal) return { ok: false, error: 'Perihal surat wajib diisi.' };

  const sifat = (raw.sifat as SifatSurat) || 'biasa';
  if (!VALID_SIFAT.includes(sifat)) return { ok: false, error: 'Sifat surat tidak valid.' };

  const kategori = sanitizeText(raw.kategori, 100) || 'Lainnya';
  const ringkasan = sanitizeText(raw.ringkasan, 1000);

  const status = (raw.status as StatusSuratMasuk) || 'menunggu_disposisi';
  if (!VALID_STATUS_MASUK.includes(status)) return { ok: false, error: 'Status surat masuk tidak valid.' };

  const attachments = Array.isArray(raw.attachments) ? (raw.attachments as SuratAttachment[]) : [];

  return {
    ok: true,
    data: {
      nomorSurat,
      tanggalSurat,
      tanggalDiterima,
      pengirim,
      penerima,
      perihal,
      sifat,
      kategori,
      ringkasan,
      status,
      attachments,
    },
  };
}

export function validateSuratKeluarInput(raw: Record<string, unknown>): {
  ok: boolean;
  error?: string;
  data?: {
    nomorSurat: string;
    tanggalSurat: string;
    tujuan: string;
    perihal: string;
    sifat: SifatSurat;
    kategori: string;
    ringkasan: string;
    penandatanganNama: string;
    penandatanganJabatan: string;
    status: StatusSuratKeluar;
    templateType?: string;
    contentBody?: string;
    lampiranKeterangan?: string;
    attachments: SuratAttachment[];
  };
} {
  const nomorSurat = sanitizeText(raw.nomorSurat, 100);
  if (!nomorSurat) return { ok: false, error: 'Nomor surat keluar wajib diisi.' };

  const tanggalSurat = sanitizeText(raw.tanggalSurat, 10);
  if (!ISO_DATE_REGEX.test(tanggalSurat)) return { ok: false, error: 'Tanggal surat tidak valid (YYYY-MM-DD).' };

  const tujuan = sanitizeText(raw.tujuan, 150);
  if (!tujuan) return { ok: false, error: 'Tujuan / penerima surat wajib diisi.' };

  const perihal = sanitizeText(raw.perihal, 250);
  if (!perihal) return { ok: false, error: 'Perihal surat wajib diisi.' };

  const sifat = (raw.sifat as SifatSurat) || 'biasa';
  if (!VALID_SIFAT.includes(sifat)) return { ok: false, error: 'Sifat surat tidak valid.' };

  const kategori = sanitizeText(raw.kategori, 100) || 'Surat Keluar';
  const ringkasan = sanitizeText(raw.ringkasan, 1000);
  const penandatanganNama = sanitizeText(raw.penandatanganNama, 150);
  const penandatanganJabatan = sanitizeText(raw.penandatanganJabatan, 150);

  const status = (raw.status as StatusSuratKeluar) || 'draft';
  if (!VALID_STATUS_KELUAR.includes(status)) return { ok: false, error: 'Status surat keluar tidak valid.' };

  const templateType = sanitizeText(raw.templateType, 50) || undefined;
  const contentBody = typeof raw.contentBody === 'string' ? raw.contentBody.slice(0, 5000) : undefined;
  const lampiranKeterangan = sanitizeText(raw.lampiranKeterangan, 100);

  const attachments = Array.isArray(raw.attachments) ? (raw.attachments as SuratAttachment[]) : [];

  return {
    ok: true,
    data: {
      nomorSurat,
      tanggalSurat,
      tujuan,
      perihal,
      sifat,
      kategori,
      ringkasan,
      penandatanganNama,
      penandatanganJabatan,
      status,
      templateType,
      contentBody,
      lampiranKeterangan,
      attachments,
    },
  };
}
