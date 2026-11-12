import assert from 'node:assert/strict';
import test from 'node:test';
import { isSuratMenyuratPath, SURAT_MENYURAT_PATH, SIFAT_SURAT_OPTIONS, STATUS_SURAT_MASUK_OPTIONS, TEMPLATE_OPTIONS, KATEGORI_SURAT_KELUAR } from './constants';
import { deriveSatkerCode, formatNomorSuratKeluar, formatNomorSuratKeluarTemplate, formatKodeArsip, calculateUsiaArsip, getRomanMonth } from './numbering';
import { validateSuratMasukInput, validateSuratKeluarInput } from './validation';
import { applyTemplateDefaults, draftFromSurat, draftRecipient, formatPenandatanganJabatan, getDefaultDraft, parseLetterDraft } from './templates';
import type { SuratKeluar } from './types';

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

test('each outgoing letter category has a distinct template that survives draft validation', () => {
  const base = getDefaultDraft('BAK', 'Kepala BAK', 'Kepala');
  const options = TEMPLATE_OPTIONS.filter((option) => option.id !== 'custom');
  assert.deepEqual(options.map((option) => option.title), KATEGORI_SURAT_KELUAR.filter((category) => category !== 'Lainnya'));
  const openings = new Set<string>();
  for (const option of options) {
    const draft = applyTemplateDefaults(base, option.id, 'BAK', 'Kepala BAK', 'Kepala');
    assert.ok(draft.salamPembuka && draft.isiParagraf1 && draft.isiParagraf2 && draft.isiParagraf3 && draft.salamPenutup, option.title);
    assert.deepEqual(parseLetterDraft(draft), draft);
    assert.equal(draftFromSurat({ nomorSurat: draft.nomorSurat, tanggalSurat: draft.tanggalSurat, tujuan: draftRecipient(draft), perihal: draft.perihal, satkerName: 'BAK', penandatanganNama: draft.penandatanganNama, penandatanganJabatan: draft.penandatanganJabatan, letterDraft: draft } as SuratKeluar, 'BAK').templateType, option.id);
    openings.add(draft.isiParagraf1);
  }
  assert.equal(openings.size, options.length);
});

test('edits belong to the saved letter and do not change the next letter template', () => {
  const makeDraft = () => getDefaultDraft('BAK', 'Kepala BAK', 'Kepala');
  for (const option of TEMPLATE_OPTIONS) {
    const template = applyTemplateDefaults(makeDraft(), option.id, 'BAK', 'Kepala BAK', 'Kepala');
    const edited = { ...template, nomorSurat: '001/BAK', perihal: 'Perihal khusus', isiParagraf1: 'Pembuka khusus', isiParagraf2: 'Isi khusus', isiParagraf3: 'Penutup khusus' };
    const saved = parseLetterDraft(edited);
    assert.ok(saved);
    const letter = { nomorSurat: saved.nomorSurat, tanggalSurat: saved.tanggalSurat, tujuan: draftRecipient(saved), perihal: saved.perihal, satkerName: 'BAK', penandatanganNama: saved.penandatanganNama, penandatanganJabatan: saved.penandatanganJabatan, letterDraft: saved } as SuratKeluar;
    assert.equal(draftFromSurat(letter, 'BAK').isiParagraf2, 'Isi khusus');
    const next = applyTemplateDefaults(makeDraft(), option.id, 'BAK', 'Kepala BAK', 'Kepala');
    assert.deepEqual(next, template, option.title);
    assert.notEqual(next.isiParagraf2, edited.isiParagraf2);
  }
  const initial = makeDraft();
  const tugas = applyTemplateDefaults(initial, 'tugas', 'BAK', 'Kepala BAK', 'Kepala');
  assert.equal(initial.isiParagraf3, tugas.isiParagraf3);
});

test('task drafts preserve multiple assigned employees from both collections', () => {
  const draft = { ...getDefaultDraft('BAK'), assignedPeople: [
    { id: 'loyalis-1', collection: 'Employees_Loyalis' as const, name: 'Ahmad', role: 'Staf' },
    { id: 'pekarya-1', collection: 'Employees_BlueCollar' as const, name: 'Budi', role: 'Teknisi' },
  ], taskAssigner: { id: 'head-1', collection: 'Employees_Loyalis' as const, name: 'Siti', role: 'Dekan' }, penandatanganNama: 'Siti', penandatanganJabatan: 'Dekan' };
  assert.deepEqual(parseLetterDraft(draft), draft);
  assert.equal(parseLetterDraft({ ...draft, assignedPeople: [draft.assignedPeople[0], draft.assignedPeople[0]] }), null);
  assert.equal(parseLetterDraft({ ...draft, assignedPeople: [{ ...draft.assignedPeople[0], collection: 'other' }] }), null);
  assert.equal(parseLetterDraft({ ...draft, taskAssigner: { ...draft.taskAssigner, collection: 'other' } }), null);
  const letter = { nomorSurat: '001', tanggalSurat: draft.tanggalSurat, tujuan: draftRecipient(draft), perihal: draft.perihal, satkerName: 'BAK', penandatanganNama: draft.penandatanganNama, penandatanganJabatan: draft.penandatanganJabatan, letterDraft: draft } as SuratKeluar;
  assert.deepEqual(draftFromSurat(letter, 'BAK').assignedPeople, draft.assignedPeople);
  assert.deepEqual(draftFromSurat(letter, 'BAK').taskAssigner, draft.taskAssigner);
  assert.equal(draftFromSurat(letter, 'BAK').penandatanganJabatan, 'Dekan');
});

test('recorded and legacy letters reopen with their actual agenda data and text', () => {
  const surat = {
    nomorSurat: '001/A/AU/11/2026', tanggalSurat: '2026-11-10', tujuan: 'Fatmah', perihal: 'Undangan Rapat',
    satkerName: 'BAK', penandatanganNama: 'Kepala BAK', penandatanganJabatan: 'Kepala',
    contentBody: 'Teks lama\n\nBaris kedua',
  } as SuratKeluar;
  const legacy = draftFromSurat(surat, 'Lain');
  assert.equal(legacy.nomorSurat, surat.nomorSurat);
  assert.equal(legacy.tujuanNama, 'Fatmah');
  assert.equal(legacy.isiParagraf2, surat.contentBody);
  assert.equal(legacy.isiParagraf1, '');
  const saved = { ...legacy, tujuanJabatanInstansi: 'BAK', tujuanAlamatKota: 'di Jombang', penandatanganNipy: '123', isiParagraf1: 'Pembuka' };
  assert.deepEqual(parseLetterDraft(saved), saved);
  const reopened = draftFromSurat({ ...surat, tujuan: draftRecipient(saved), letterDraft: saved }, 'Lain');
  assert.equal(reopened.tujuanJabatanInstansi, 'BAK');
  assert.equal(reopened.penandatanganNipy, '123');
  assert.equal(reopened.isiParagraf1, 'Pembuka');
  const agendaChanged = draftFromSurat({ ...surat, tujuan: 'Penerima Baru', perihal: 'Hal Baru', letterDraft: saved }, 'Lain');
  assert.equal(agendaChanged.tujuanNama, 'Penerima Baru');
  assert.equal(agendaChanged.tujuanJabatanInstansi, '');
  assert.equal(agendaChanged.perihal, 'Hal Baru');
  assert.equal(agendaChanged.isiParagraf1, 'Pembuka');
  assert.equal(parseLetterDraft({ ...saved, isiParagraf1: 'x'.repeat(10001) }), null);

  // Draft with SatKer head contact details
  const withContacts = {
    ...saved,
    satkerHeadEmail: 'bak@unipdu.ac.id',
    satkerHeadPhone: '081234567890',
  };
  assert.deepEqual(parseLetterDraft(withContacts), withContacts);
  assert.equal(parseLetterDraft({ ...withContacts, satkerHeadEmail: 'x'.repeat(151) }), null);
  assert.equal(parseLetterDraft({ ...withContacts, satkerHeadPhone: 'x'.repeat(51) }), null);

  const defaultWithContacts = getDefaultDraft('BAK', 'Ahmad', 'Kepala BAK', 'bak@unipdu.ac.id', '081234567890');
  assert.equal(defaultWithContacts.satkerHeadEmail, 'bak@unipdu.ac.id');
  assert.equal(defaultWithContacts.satkerHeadPhone, '081234567890');

  const reopenedWithContacts = draftFromSurat({ ...surat, letterDraft: withContacts }, 'Lain');
  assert.equal(reopenedWithContacts.satkerHeadEmail, 'bak@unipdu.ac.id');
  assert.equal(reopenedWithContacts.satkerHeadPhone, '081234567890');

  // Verify formatPenandatanganJabatan prevents repeating SatKer name
  assert.equal(formatPenandatanganJabatan('Kepala Pusat Komputer Net', 'Pusat Komputer Net'), 'Kepala Pusat Komputer Net');
  assert.equal(formatPenandatanganJabatan('Kepala Pusat Komputer Net Pusat Komputer Net', 'Pusat Komputer Net'), 'Kepala Pusat Komputer Net');
  assert.equal(formatPenandatanganJabatan('Kepala', 'Pusat Komputer Net'), 'Kepala Pusat Komputer Net');
  assert.equal(formatPenandatanganJabatan('Kepala Satuan Kerja', 'Pusat Komputer Net'), 'Kepala Pusat Komputer Net');
  assert.equal(formatPenandatanganJabatan('Dekan Fakultas Agama Islam', 'Fakultas Agama Islam'), 'Dekan Fakultas Agama Islam');
  assert.equal(getDefaultDraft('Pusat Komputer Net', 'Ahmad', 'Kepala Pusat Komputer Net').penandatanganJabatan, 'Kepala Pusat Komputer Net');
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
