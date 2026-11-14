import { InstitutionScope, SifatSurat, TemplateType } from './types';

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

export const KATEGORI_SURAT_MASUK = [
  'Undangan / Rapat',
  'Pemberitahuan / Informasi',
  'Permohonan / Pengajuan',
  'Surat Edaran (SE)',
  'Surat Keputusan (SK)',
  'Instruksi Rektorat',
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

export const KLASIFIKASI_KEARSIPAN_POPULAR: { code: string; name: string }[] = [
  { code: '000', name: '000 · Umum' },
  { code: '005', name: '005 · Undangan' },
  { code: '010', name: '010 · Urusan Dalam Kantor' },
  { code: '020', name: '020 · Peralatan & Perlengkapan' },
  { code: '100', name: '100 · Pemerintahan' },
  { code: '166', name: '166 · Kerja Sama Antar Lembaga' },
  { code: '400', name: '400 · Kesejahteraan Rakyat' },
  { code: '420', name: '420 · Pendidikan & Pengajaran' },
  { code: '700', name: '700 · Pengawasan & Audit' },
  { code: '800', name: '800 · Kepegawaian' },
  { code: '820', name: '820 · Pengangkatan / Sk Pegawai' },
  { code: '880', name: '880 · Pensiun / Purna Tugas' },
  { code: '900', name: '900 · Keuangan & Anggaran' },
  { code: '920', name: '920 · Spj & Pertanggungjawaban' },
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
    id: 'edaran',
    title: 'Surat Edaran Internal',
    desc: 'Pemberitahuan atau arahan kepada unit dan pegawai di lingkungan institusi.',
  },
  {
    id: 'rekomendasi',
    title: 'Surat Rekomendasi',
    desc: 'Rekomendasi resmi untuk seseorang atau kegiatan.',
  },
  {
    id: 'balasan',
    title: 'Surat Balasan',
    desc: 'Tanggapan atas surat, permohonan, atau undangan yang diterima.',
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
