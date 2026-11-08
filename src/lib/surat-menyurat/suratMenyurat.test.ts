import assert from 'node:assert/strict';
import test from 'node:test';
import { isSuratMenyuratPath, SURAT_MENYURAT_PATH, SIFAT_SURAT_OPTIONS, STATUS_SURAT_MASUK_OPTIONS } from './constants';
import { deriveSatkerCode, formatNomorSuratKeluar, formatNomorSuratKeluarTemplate, formatKodeArsip, calculateUsiaArsip, getRomanMonth } from './numbering';
import { validateSuratMasukInput, validateSuratKeluarInput } from './validation';
import { applyTemplateDefaults, getDefaultDraft } from './templates';

test('isSuratMenyuratPath correctly matches path and subpaths', () => {
  assert.equal(isSuratMenyuratPath(SURAT_MENYURAT_PATH), true);
  assert.equal(isSuratMenyuratPath(`${SURAT_MENYURAT_PATH}/detail`), true);
  assert.equal(isSuratMenyuratPath('/dashboard/surat-menyurat-lain'), false);
  assert.equal(isSuratMenyuratPath('/dashboard/payroll'), false);
});

test('getRomanMonth produces accurate Roman numeral for months', () => {
  assert.equal(getRomanMonth(1), 'I');
  assert.equal(getRomanMonth(4), 'IV');
  assert.equal(getRomanMonth(7), 'VII');
  assert.equal(getRomanMonth(11), 'XI');
  assert.equal(getRomanMonth(12), 'XII');
  // fallback for invalid month
  assert.equal(getRomanMonth(0), 'I');
  assert.equal(getRomanMonth(13), 'I');
});

test('deriveSatkerCode infers recognizable abbreviations', () => {
  assert.equal(deriveSatkerCode('Fakultas Agama Islam'), 'FAI');
  assert.equal(deriveSatkerCode('Fakultas Ilmu Kesehatan'), 'FIK');
  assert.equal(deriveSatkerCode('Lembaga Penelitian dan Pengabdian'), 'LPPM');
  assert.equal(deriveSatkerCode('Biro Administrasi Akademik dan Kemahasiswaan'), 'BAAK');
  assert.equal(deriveSatkerCode('Biro Administrasi Keuangan'), 'BAK');
  assert.equal(deriveSatkerCode('Unit Khusus Baru'), 'UKB');
  assert.equal(deriveSatkerCode(''), 'SATKER');
});

test('formatNomorSuratKeluar creates standard UNIPDU letter numbers', () => {
  const date = new Date(2026, 10, 7); // November 2026
  const nomor = formatNomorSuratKeluar({
    sequenceNumber: 8,
    satkerCode: 'FAI',
    date,
  });
  assert.equal(nomor, '008/FAI/UNIPDU/XI/2026');
});

test('validateSuratMasukInput validates required fields and accepts valid payload', () => {
  const invalid = validateSuratMasukInput({ nomorSurat: '' });
  assert.equal(invalid.ok, false);
  assert.match(invalid.error || '', /Nomor surat/);

  const invalidDate = validateSuratMasukInput({
    nomorSurat: '123/R/2026',
    tanggalSurat: 'invalid-date',
    pengirim: 'Rektorat',
    perihal: 'Rapat',
  });
  assert.equal(invalidDate.ok, false);
  assert.match(invalidDate.error || '', /Tanggal surat/);

  const valid = validateSuratMasukInput({
    nomorSurat: '045/UNIPDU/R/XI/2026',
    tanggalSurat: '2026-11-05',
    tanggalDiterima: '2026-11-06',
    pengirim: 'Rektorat UNIPDU',
    penerima: 'Dekan FAI',
    perihal: 'Undangan Rapat Koordinasi Anggaran',
    sifat: 'penting',
    kategori: 'Undangan / Rapat',
    ringkasan: 'Rapat pembahasan RKAT',
    status: 'menunggu_disposisi',
    attachments: [],
  });

  assert.equal(valid.ok, true);
  assert.equal(valid.data?.nomorSurat, '045/UNIPDU/R/XI/2026');
  assert.equal(valid.data?.sifat, 'penting');
  assert.equal(valid.data?.status, 'menunggu_disposisi');
});

test('validateSuratKeluarInput validates required fields and accepts valid payload', () => {
  const invalid = validateSuratKeluarInput({ nomorSurat: '' });
  assert.equal(invalid.ok, false);

  const valid = validateSuratKeluarInput({
    nomorSurat: '001/FAI/UNIPDU/XI/2026',
    tanggalSurat: '2026-11-07',
    tujuan: 'Dosen Fakultas Agama Islam',
    perihal: 'Surat Tugas Seminar Nasional',
    sifat: 'biasa',
    kategori: 'Surat Tugas',
    penandatanganNama: 'Dr. H. M. Zulfikar, M.Pd.I',
    penandatanganJabatan: 'Dekan Fakultas Agama Islam',
    status: 'draft',
    templateType: 'tugas',
    contentBody: 'Isi surat...',
    attachments: [],
  });

  assert.equal(valid.ok, true);
  assert.equal(valid.data?.tujuan, 'Dosen Fakultas Agama Islam');
  assert.equal(valid.data?.status, 'draft');
});

test('applyTemplateDefaults populates appropriate text for each template type', () => {
  const base = getDefaultDraft('Fakultas Agama Islam', 'Dekan FAI', 'Dekan');

  const tugas = applyTemplateDefaults(base, 'tugas', 'Fakultas Agama Islam', 'Dekan FAI', 'Dekan');
  assert.equal(tugas.perihal, 'Surat Tugas Pelaksanaan Kegiatan');
  assert.match(tugas.isiParagraf1, /memberikan tugas kepada/);

  const undangan = applyTemplateDefaults(base, 'undangan', 'Fakultas Agama Islam', 'Dekan FAI', 'Dekan');
  assert.equal(undangan.perihal, 'Undangan Rapat Koordinasi SatKer');
  assert.match(undangan.isiParagraf1, /rapat koordinasi/);

  const pengantar = applyTemplateDefaults(base, 'pengantar', 'Fakultas Agama Islam', 'Dekan FAI', 'Dekan');
  assert.equal(pengantar.perihal, 'Surat Pengantar Dokumen / Laporan');
  assert.match(tugas.isiParagraf3, /dipergunakan sebagaimana mestinya/);
});

test('formatNomorSuratKeluarTemplate formats UNIPDU and YAPETIDU single & batch letter numbers matching Excel', () => {
  const date = new Date(2026, 0, 15); // January 2026

  // UNIPDU single
  const unipduSingle = formatNomorSuratKeluarTemplate({
    sequenceNumber: 1,
    institutionScope: 'UNIPDU',
    kodeSurat: 'SK',
    date,
  });
  assert.equal(unipduSingle, '001/A/SK/1/2026');

  // UNIPDU batch multi-recipient range (e.g. 011-015/A/AU/1/2026)
  const unipduBatch = formatNomorSuratKeluarTemplate({
    sequenceNumber: 11,
    sequenceNumberEnd: 15,
    institutionScope: 'UNIPDU',
    kodeSurat: 'AU',
    date,
  });
  assert.equal(unipduBatch, '011-015/A/AU/1/2026');

  // YAPETIDU single
  const yapetiduSingle = formatNomorSuratKeluarTemplate({
    sequenceNumber: 7,
    institutionScope: 'YAPETIDU',
    kodeSurat: 'SK',
    date: new Date(2026, 1, 23), // February
  });
  assert.equal(yapetiduSingle, '007/YPTDU/SK/2/2026');

  // YAPETIDU batch
  const yapetiduBatch = formatNomorSuratKeluarTemplate({
    sequenceNumber: 3,
    sequenceNumberEnd: 5,
    institutionScope: 'YAPETIDU',
    kodeSurat: 'AU',
    date,
  });
  assert.equal(yapetiduBatch, '003-005/YPTDU/AU/1/2026');
});

test('calculateUsiaArsip produces exact archival age in years and months matching Excel formula', () => {
  const asOf = new Date(2026, 10, 8); // 8 Nov 2026
  const usia = calculateUsiaArsip('2026-01-15', asOf);
  // ~297 days elapsed -> 0 tahun 9 bulan
  assert.equal(usia, '0 tahun 9 bulan');

  const oldDate = calculateUsiaArsip('2024-01-01', asOf);
  // ~1042 days elapsed -> 2 tahun ... bulan
  assert.match(oldDate, /2 tahun/);

  assert.equal(calculateUsiaArsip(''), '-');
});

test('formatKodeArsip creates proper UNIPDU, YAPETIDU, and incoming archive locators', () => {
  const unipduArsip = formatKodeArsip({
    type: 'keluar',
    institutionScope: 'UNIPDU',
    sequenceNumber: 1,
  });
  assert.equal(unipduArsip, 'S.REKTOR,001');

  const yapetiduArsip = formatKodeArsip({
    type: 'keluar',
    institutionScope: 'YAPETIDU',
    sequenceNumber: 8,
  });
  assert.equal(yapetiduArsip, 'S.YPTDU.A.100.8');

  const masukArsip = formatKodeArsip({
    type: 'masuk',
    sequenceNumber: 5,
    klasifikasiCode: '166',
  });
  assert.equal(masukArsip, 'A.1.R1.166,05');
});
