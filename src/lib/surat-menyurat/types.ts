export type SuratType = 'masuk' | 'keluar';

export type SifatSurat = 'biasa' | 'penting' | 'segera' | 'rahasia';

export type StatusSuratMasuk = 'menunggu_disposisi' | 'diproses' | 'selesai' | 'diarsipkan';

export type StatusSuratKeluar = 'draft' | 'disetujui' | 'terkirim' | 'diarsipkan';

export type TemplateType = 'tugas' | 'keterangan' | 'undangan' | 'pengantar' | 'permohonan' | 'custom';

export interface SuratAttachment {
  id: string;
  name: string;
  url: string;
  contentType: string;
  size: number;
  uploadedAt: string;
}

export interface DisposisiSurat {
  instruksi: string; // e.g. "Tindak Lanjuti", "Hadiri / Wakili", "Koordinasikan", "Pelajari & Laporkan", "Arsipkan"
  diteruskanKepada: string; // e.g. "Sekretaris SatKer", "Bendahara", "Staf Administrasi", "Kaprodi"
  catatan?: string;
  tanggalDisposisi: string;
  disposisiOleh: string; // Nama Kepala SatKer
  disposisiOlehUid: string;
}

export interface SuratMasuk {
  id: string;
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
  status: StatusSuratMasuk;
  disposisi?: DisposisiSurat | null;
  attachments: SuratAttachment[];
  createdAt: string;
  updatedAt: string;
  createdByUid: string;
  createdByName: string;
}

export interface SuratKeluar {
  id: string;
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
  status: StatusSuratKeluar;
  templateType?: TemplateType;
  contentBody?: string;
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
  menungguDisposisi: number;
  diproses: number;
  selesaiMasuk: number;
  draftKeluar: number;
  terkirimKeluar: number;
  suratBulanIni: number;
}
