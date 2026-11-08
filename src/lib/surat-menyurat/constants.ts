import { InstitutionScope, SifatSurat, StatusSuratMasuk, StatusSuratKeluar, TemplateType } from './types';

export const SURAT_MENYURAT_PATH = '/dashboard/surat-menyurat';

export function isSuratMenyuratPath(pathname: string): boolean {
  return pathname === SURAT_MENYURAT_PATH || pathname.startsWith(`${SURAT_MENYURAT_PATH}/`);
}

export const INSTITUTION_SCOPES: { id: InstitutionScope; label: string; short: string; logo: string; subtitle: string }[] = [
  {
    id: 'UNIPDU',
    label: 'UNIPDU (Sekretariat Rektorat)',
    short: 'UNIPDU',
    logo: '/Logo UNIPDU.png',
    subtitle: 'Universitas Pesantren Tinggi Darul \'Ulum Jombang',
  },
  {
    id: 'YAPETIDU',
    label: 'YAPETIDU (Yayasan Darul \'Ulum)',
    short: 'YAPETIDU',
    logo: '/Logo YAPETIDU (Transparent bg).png',
    subtitle: 'Yayasan Pesantren Tinggi Darul \'Ulum Jombang',
  },
  {
    id: 'SATKER',
    label: 'Satuan Kerja / Fakultas',
    short: 'SatKer',
    logo: '/Logo UNIPDU.png',
    subtitle: 'Unit Kerja / Fakultas / Lembaga Loyalis',
  },
];

export const KODE_SURAT_KELUAR_OPTIONS: { code: string; label: string; desc: string }[] = [
  { code: 'AU', label: 'AU · Administrasi Umum', desc: 'Surat edaran, pemberitahuan, pengumuman, permohonan' },
  { code: 'SK', label: 'SK · Surat Keputusan', desc: 'Penetapan pejabat, dosen tetap, purna tugas, reward' },
  { code: 'ST', label: 'ST · Surat Tugas', desc: 'Penugasan diklat, workshop, delegasi kegiatan dinas' },
  { code: 'MoU', label: 'MoU · Kerjasama Lembaga', desc: 'Nota kesepahaman atau perjanjian kemitraan eksternal' },
  { code: 'SP', label: 'SP · Pengantar / Permohonan', desc: 'Pengantar dokumen berkas dan usulan' },
  { code: 'YPTDU', label: 'YPTDU · Khusus Yayasan', desc: 'Kode persuratan tingkat pengurus yayasan' },
];

export const SIFAT_SURAT_OPTIONS: { value: SifatSurat; label: string; tone: string }[] = [
  { value: 'biasa', label: 'Biasa', tone: 'bg-slate-100 text-slate-700 border-slate-200' },
  { value: 'penting', label: 'Penting', tone: 'bg-amber-50 text-amber-700 border-amber-200' },
  { value: 'segera', label: 'Segera', tone: 'bg-rose-50 text-rose-700 border-rose-200' },
  { value: 'rahasia', label: 'Rahasia', tone: 'bg-purple-50 text-purple-700 border-purple-200' },
];

export const STATUS_SURAT_MASUK_OPTIONS: { value: StatusSuratMasuk; label: string; tone: string }[] = [
  { value: 'menunggu_disposisi', label: 'Menunggu Disposisi', tone: 'bg-amber-50 text-amber-700 border-amber-200' },
  { value: 'diproses', label: 'Sedang Diproses', tone: 'bg-sky-50 text-sky-700 border-sky-200' },
  { value: 'selesai', label: 'Selesai', tone: 'bg-emerald-50 text-emerald-700 border-emerald-200' },
  { value: 'diarsipkan', label: 'Diarsipkan', tone: 'bg-slate-100 text-slate-600 border-slate-200' },
];

export const STATUS_SURAT_KELUAR_OPTIONS: { value: StatusSuratKeluar; label: string; tone: string }[] = [
  { value: 'draft', label: 'Draft', tone: 'bg-slate-100 text-slate-600 border-slate-200' },
  { value: 'disetujui', label: 'Disetujui', tone: 'bg-indigo-50 text-indigo-700 border-indigo-200' },
  { value: 'terkirim', label: 'Terkirim', tone: 'bg-emerald-50 text-emerald-700 border-emerald-200' },
  { value: 'diarsipkan', label: 'Diarsipkan', tone: 'bg-slate-100 text-slate-600 border-slate-200' },
];

export const KATEGORI_SURAT_MASUK = [
  'Undangan / Rapat',
  'Pemberitahuan / Informasi',
  'Permohonan / Pengajuan',
  'Surat Edaran (SE)',
  'Surat Keputusan (SK)',
  'Instruksi / Disposisi Rektorat',
  'Kerjasama / MoU',
  'Laporan / Evaluasi',
  'Lainnya',
];

export const KATEGORI_SURAT_KELUAR = [
  'Surat Tugas',
  'Surat Keterangan',
  'Surat Undangan',
  'Surat Pengantar',
  'Surat Permohonan',
  'Surat Edaran Internal',
  'Surat Rekomendasi',
  'Surat Balasan',
  'Lainnya',
];

export const INSTRUKSI_DISPOSISI_PRESETS = [
  'Tindak lanjuti segera',
  'Hadiri dan wakili',
  'Koordinasikan dengan tim / pihak terkait',
  'Pelajari & siapkan bahan pertimbangan',
  'Siapkan balasan / tanggapan surat',
  'Jadwalkan rapat / pertemuan',
  'Untuk diketahui & dipedomani',
  'Arsipkan',
];

export const DISPOSISI_DESTINATIONS = [
  'Wakil Rektor I (Akademik & Kemahasiswaan)',
  'Wakil Rektor II (SDM & Keuangan)',
  'Sekretariat Rektorat',
  'Fakultas Agama Islam (FAI)',
  'Fakultas Bahasa dan Sastra (FBS)',
  'Fakultas Sains & Teknologi (FST / FT / FMIPA)',
  'Fakultas Ilmu Kesehatan (FIK)',
  'Fakultas Bisnis dan Informatika (FIA)',
  'Lembaga Penelitian & Pengabdian Masyarakat (LPPM)',
  'Badan Penjaminan Mutu (BPM / PJM)',
  'Biro Administrasi Akademik (BAAK)',
  'Biro Administrasi Keuangan (BAK)',
  'Perpustakaan Universitas',
  'Bagian Umum & Sarana Prasarana',
];

export const DISPOSISI_ACTIONS = [
  'Tanggapan dan Saran',
  'Proses lebih lanjut',
  'Koordinasi / Konfirmasikan',
  'Jadwalkan rapat / Pertemuan',
  'Untuk diketahui / Dipedomani',
  'Arsipkan',
];

export const KLASIFIKASI_KEARSIPAN_POPULAR: { code: string; name: string }[] = [
  { code: '000', name: '000 · UMUM' },
  { code: '005', name: '005 · Undangan' },
  { code: '010', name: '010 · Urusan Dalam Kantor' },
  { code: '020', name: '020 · Peralatan & Perlengkapan' },
  { code: '100', name: '100 · PEMERINTAHAN' },
  { code: '166', name: '166 · Kerja Sama Antar Lembaga' },
  { code: '400', name: '400 · KESEJAHTERAAN RAKYAT' },
  { code: '420', name: '420 · Pendidikan & Pengajaran' },
  { code: '700', name: '700 · PENGAWASAN & AUDIT' },
  { code: '800', name: '800 · KEPEGAWAIAN' },
  { code: '820', name: '820 · Pengangkatan / SK Pegawai' },
  { code: '880', name: '880 · Pensiun / Purna Tugas' },
  { code: '900', name: '900 · KEUANGAN & ANGGARAN' },
  { code: '920', name: '920 · SPJ & Pertanggungjawaban' },
];

export const TEMPLATE_OPTIONS: { id: TemplateType; title: string; desc: string }[] = [
  {
    id: 'tugas',
    title: 'Surat Tugas',
    desc: 'Penugasan dosen atau staf untuk kegiatan, pelatihan, seminar, atau perjalanan dinas.',
  },
  {
    id: 'keterangan',
    title: 'Surat Keterangan',
    desc: 'Menerangkan status aktif, tugas akademik, atau keterangan resmi lainnya.',
  },
  {
    id: 'undangan',
    title: 'Surat Undangan',
    desc: 'Undangan rapat internal, evaluasi koordinasi, atau workshop unit.',
  },
  {
    id: 'pengantar',
    title: 'Surat Pengantar',
    desc: 'Pengantar pengiriman berkas laporan, proposal, dokumen ke Rektorat atau unit lain.',
  },
  {
    id: 'permohonan',
    title: 'Surat Permohonan',
    desc: 'Permohonan sarana, narasumber, izin, atau dukungan pelaksanaan kegiatan.',
  },
  {
    id: 'custom',
    title: 'Format Bebas (Custom)',
    desc: 'Format surat resmi standar dengan kop SatKer tanpa format isian template kaku.',
  },
];

export const ROMAN_MONTHS = [
  'I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X', 'XI', 'XII',
];
