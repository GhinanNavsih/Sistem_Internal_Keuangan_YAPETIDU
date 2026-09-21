import assert from 'node:assert/strict';
import test from 'node:test';
import {
  addDays,
  contactNumberError,
  type SimpelBuilding,
  type SimpelRoom,
} from './venueReservation';
import {
  clampQuantity,
  completeTime,
  defaultReservationDate,
  durationLabel,
  firstInvalidStep,
  formatPhoneInput,
  formatReservationDate,
  formatReservationDateRange,
  isBlankDraft,
  maskTimeInput,
  parseSavedDraft,
  progressPercent,
  RESERVATION_STEPS,
  serializeDraft,
  soleBookableRoom,
  stepIndex,
  stepperIncrement,
  validateStep,
  type ReservationDraft,
  type SavedDraft,
  type StepContext,
} from './venueReservationForm';

const ROOM: SimpelRoom = {
  nama: 'Meeting Room 1',
  tipe: 'Meeting Room',
  kapasitas: 150,
  lantai: 1,
  status: 'Tersedia',
  fasilitasBawaan: [],
};
const ROOM_IN_MAINTENANCE: SimpelRoom = { ...ROOM, nama: 'Meeting Room 2', status: 'Maintenance' };
const BUILDING: SimpelBuilding = {
  id: 'GDG-03',
  nama: 'Gedung Kuliah Kampus Utama',
  singkatan: 'Kampus Utama',
  lokasi: 'Sektor Tengah',
  ruanganList: [ROOM, ROOM_IN_MAINTENANCE],
  inventarisList: [],
};

function draft(overrides: Partial<ReservationDraft> = {}): ReservationDraft {
  return {
    kegiatan: 'Rapat Koordinasi Loyalis',
    waktu: '2026-10-01',
    jamMulai: '08:00',
    jamSelesai: '10:00',
    gedungId: 'GDG-03',
    ruangan: 'Meeting Room 1',
    pemohon: 'Badan Administrasi Keuangan (BAK)',
    kontak: '0812-3456-7890',
    ...overrides,
  };
}

function context(overrides: Partial<StepContext> = {}): StepContext {
  return {
    today: '2026-09-19',
    nowMinutes: 10 * 60,
    building: BUILDING,
    room: ROOM,
    scheduleReady: true,
    conflictCount: 0,
    shortageText: null,
    ...overrides,
  };
}

const messages = (step: Parameters<typeof validateStep>[0], d: ReservationDraft, c: StepContext) =>
  validateStep(step, d, c).map((issue) => `${issue.field}: ${issue.message}`);

test('the form has three steps, and the easy questions come first', () => {
  assert.deepEqual(RESERVATION_STEPS.map((step) => step.id), ['acara', 'tempat', 'konfirmasi']);
  assert.equal(stepIndex('tempat'), 1);
});

test('progress counts the step you are on, so the first screen already shows a third', () => {
  assert.deepEqual([0, 1, 2].map(progressPercent), [33, 67, 100]);
});

test('step 1 needs a clean activity name', () => {
  assert.deepEqual(validateStep('acara', draft(), context()), []);
  assert.match(messages('acara', draft({ kegiatan: '' }), context())[0], /^kegiatan: .*wajib diisi/);
  assert.match(messages('acara', draft({ kegiatan: '   ' }), context())[0], /wajib diisi/);
  assert.match(messages('acara', draft({ kegiatan: '<b>rapat</b>' }), context())[0], /tanda < atau >/);
  assert.match(messages('acara', draft({ kegiatan: 'x'.repeat(151) }), context())[0], /maksimal 150/);
});

test('step 1 also needs a date that is not past and hours that make sense', () => {
  assert.deepEqual(validateStep('acara', draft(), context()), []);
  assert.match(messages('acara', draft({ waktu: '' }), context())[0], /^waktu: Pilih tanggal/);
  assert.match(messages('acara', draft({ waktu: '2026-09-18' }), context())[0], /sudah lewat/);
  assert.match(messages('acara', draft({ waktu: addDays('2026-09-19', 367) }), context())[0], /satu tahun/);
  assert.match(messages('acara', draft({ jamMulai: '' }), context())[0], /^jam: Isi jam/);
  assert.match(messages('acara', draft({ jamMulai: '10:00', jamSelesai: '10:00' }), context())[0], /setelah jam mulai/);
  assert.match(
    messages('acara', draft({ waktu: '2026-09-19', jamMulai: '08:00', jamSelesai: '09:30' }), context())[0],
    /sudah lewat hari ini/,
  );
  // Today is fine while the event has not ended yet.
  assert.deepEqual(
    validateStep('acara', draft({ waktu: '2026-09-19', jamMulai: '09:00', jamSelesai: '12:00' }), context()),
    [],
  );
});

test("the date is not judged as past before the campus clock is known", () => {
  assert.deepEqual(validateStep('acara', draft({ waktu: '2020-01-01' }), context({ today: '' })), []);
});

test('step 2 needs an available room, and says why when it is not', () => {
  assert.deepEqual(validateStep('tempat', draft(), context()), []);
  assert.match(messages('tempat', draft(), context({ building: undefined, room: undefined }))[0], /^gedung: Pilih gedung/);
  assert.match(messages('tempat', draft(), context({ room: undefined }))[0], /^ruangan: Pilih ruangan/);
  assert.match(messages('tempat', draft(), context({ room: ROOM_IN_MAINTENANCE }))[0], /perawatan/);
  assert.match(messages('tempat', draft(), context({ scheduleReady: false }))[0], /^ketersediaan: Jadwal SIMPEL masih dimuat/);
  assert.match(messages('tempat', draft(), context({ conflictCount: 1 }))[0], /bentrok/);
  assert.match(
    messages('tempat', draft(), context({ shortageText: 'Kursi (sisa 2, diminta 5)' }))[0],
    /Peralatan tidak mencukupi.*Kursi \(sisa 2, diminta 5\)/,
  );
});

test('a clash is reported before a shortage', () => {
  const result = messages('tempat', draft(), context({ conflictCount: 2, shortageText: 'Kursi (sisa 0, diminta 1)' }));
  assert.equal(result.length, 1);
  assert.match(result[0], /bentrok/);
});

test('step 3 needs a name and a valid phone number', () => {
  assert.deepEqual(validateStep('konfirmasi', draft(), context()), []);
  const both = validateStep('konfirmasi', draft({ pemohon: '', kontak: '12' }), context());
  assert.deepEqual(both.map((issue) => issue.field), ['pemohon', 'kontak']);
  assert.match(messages('konfirmasi', draft({ kontak: '' }), context())[0], /^kontak: Nomor WhatsApp wajib diisi/);
});

test('the earliest unfinished step is the one to go back to', () => {
  assert.equal(firstInvalidStep(draft(), context()), null);
  assert.equal(firstInvalidStep(draft({ kontak: '' }), context()), 'konfirmasi');
  assert.equal(firstInvalidStep(draft({ jamMulai: '' }), context()), 'acara');
  assert.equal(firstInvalidStep(draft({ kegiatan: '', jamMulai: '', kontak: '' }), context()), 'acara');
  assert.equal(firstInvalidStep(draft(), context({ conflictCount: 1 })), 'tempat');
});

test('a time box accepts only digits and puts the ":" in by itself', () => {
  assert.equal(maskTimeInput('0930'), '09:30');
  assert.equal(maskTimeInput('09:30'), '09:30', 'typing the colon is harmless');
  assert.equal(maskTimeInput('9'), '09', 'a lone 3-9 can only be the hour');
  assert.equal(maskTimeInput('1'), '1', 'a lone 0-2 may still grow into 10-23');
  assert.equal(maskTimeInput('093'), '09:3');
  assert.equal(maskTimeInput('abc'), '');
  assert.equal(maskTimeInput('12345'), '12:34', 'nothing past HH:MM');
});

test('a time box never holds an impossible time', () => {
  assert.equal(maskTimeInput('2599'), '23:59');
  assert.equal(maskTimeInput('99'), '23');
  assert.equal(maskTimeInput('1075'), '10:59');
  assert.equal(maskTimeInput('0860'), '08:59');
  for (const raw of ['', '0', '08', '08:0', '08:00', '2359', '9999', '  7 : 5 ']) {
    const once = maskTimeInput(raw);
    assert.equal(maskTimeInput(once), once, `idempotent for "${raw}"`);
  }
});

test('leaving a half-typed time box completes it', () => {
  assert.equal(completeTime('8'), '08:00');
  assert.equal(completeTime('08'), '08:00');
  assert.equal(completeTime('08:3'), '08:30');
  assert.equal(completeTime('08:30'), '08:30');
  assert.equal(completeTime(''), '');
});

test('the date starts as tomorrow on the campus clock', () => {
  assert.equal(defaultReservationDate('2026-09-19'), '2026-09-20');
  assert.equal(defaultReservationDate('2026-12-31'), '2027-01-01');
  assert.equal(defaultReservationDate('2026-02-28'), '2026-03-01');
  assert.equal(defaultReservationDate(''), '', 'clock not known yet');
  assert.equal(defaultReservationDate('bukan tanggal'), '');
});

test('durations read the way people say them', () => {
  assert.equal(durationLabel('08:00', '10:00'), '2 jam');
  assert.equal(durationLabel('08:00', '09:30'), '1 jam 30 menit');
  assert.equal(durationLabel('08:00', '08:45'), '45 menit');
  assert.equal(durationLabel('10:00', '08:00'), null);
  assert.equal(durationLabel('', '08:00'), null);
});

test('the date reads in Indonesian, and a bad date is left as typed', () => {
  assert.match(formatReservationDate('2026-10-01'), /2026/);
  assert.equal(formatReservationDate('bukan tanggal'), 'bukan tanggal');
});

test('a building with exactly one bookable room can be picked for the user', () => {
  assert.equal(soleBookableRoom(BUILDING)?.nama, 'Meeting Room 1');
  assert.equal(soleBookableRoom({ ...BUILDING, ruanganList: [ROOM, { ...ROOM, nama: 'Meeting Room 3' }] }), undefined);
  assert.equal(soleBookableRoom({ ...BUILDING, ruanganList: [ROOM_IN_MAINTENANCE] }), undefined);
  assert.equal(soleBookableRoom({ ...BUILDING, ruanganList: [] }), undefined);
  assert.equal(soleBookableRoom(undefined), undefined);
});

const NOW = new Date('2026-09-21T03:00:00Z');
const SAVED: SavedDraft = {
  step: 1,
  kegiatan: 'Rapat Koordinasi',
  waktuInput: '2026-10-01',
  jamMulai: '08:00',
  jamSelesai: '10:00',
  gedungId: 'GDG-03',
  ruangan: 'Meeting Room 1',
  quantities: { 'Mic Wireless Shure SM58 Duo Set': 2 },
};
const stored = (overrides: Record<string, unknown> = {}) =>
  JSON.stringify({ ...JSON.parse(serializeDraft(SAVED, NOW)), ...overrides });

test('a half-filled form is saved and comes back exactly as left', () => {
  assert.deepEqual(parseSavedDraft(serializeDraft(SAVED, NOW), NOW), SAVED);
  // The date is still the default (tomorrow) until the user picks one.
  const defaultDate = { ...SAVED, waktuInput: null };
  assert.deepEqual(parseSavedDraft(serializeDraft(defaultDate, NOW), NOW), defaultDate);
});

test('only what was entered is kept, never a phone number', () => {
  const keys = Object.keys(JSON.parse(serializeDraft(SAVED, NOW))).sort();
  assert.deepEqual(keys, ['gedungId', 'jamMulai', 'jamSelesai', 'kegiatan', 'quantities', 'ruangan', 'savedAt', 'step', 'v', 'waktuInput']);
});

test('a draft older than a week, or from the future, is dropped', () => {
  const day = 24 * 60 * 60 * 1000;
  assert.notEqual(parseSavedDraft(serializeDraft(SAVED, new Date(NOW.getTime() - 6 * day)), NOW), null);
  assert.equal(parseSavedDraft(serializeDraft(SAVED, new Date(NOW.getTime() - 8 * day)), NOW), null);
  assert.equal(parseSavedDraft(serializeDraft(SAVED, new Date(NOW.getTime() + day)), NOW), null);
});

test('a damaged or unknown entry counts as no draft', () => {
  for (const raw of [null, '', 'not json', '{}', '[]', '"text"', '42', stored({ v: 2 }), stored({ savedAt: 'yesterday' })]) {
    assert.equal(parseSavedDraft(raw, NOW), null, String(raw));
  }
  for (const bad of [{ kegiatan: 5 }, { kegiatan: 'x'.repeat(151) }, { jamMulai: 'abc' }, { jamSelesai: '12:345' }, { gedungId: null }, { ruangan: {} }]) {
    assert.equal(parseSavedDraft(stored(bad), NOW), null, JSON.stringify(bad));
  }
});

test('odd values are cleaned up rather than trusted', () => {
  const cleaned = parseSavedDraft(
    stored({
      step: 9,
      waktuInput: '2026-13-45',
      quantities: { Kursi: 3, Negatif: -1, Pecahan: 1.5, Teks: 'dua', Besar: 1_000_000 },
    }),
    NOW,
  );
  assert.equal(cleaned?.step, 0, 'a step that does not exist');
  assert.equal(cleaned?.waktuInput, null, 'not a real date');
  assert.deepEqual(cleaned?.quantities, { Kursi: 3 });
  assert.equal(parseSavedDraft(stored({ step: 2 }), NOW)?.step, 2);
});

test('a form with nothing entered is not worth keeping', () => {
  const blank: SavedDraft = { step: 0, kegiatan: '  ', waktuInput: null, jamMulai: '', jamSelesai: '', gedungId: '', ruangan: '', quantities: {} };
  assert.equal(isBlankDraft(blank), true);
  assert.equal(isBlankDraft({ ...blank, waktuInput: '' }), true, 'a cleared date is not an entry');
  assert.equal(isBlankDraft({ ...blank, quantities: { Kursi: 0 } }), true);
  for (const filled of [{ kegiatan: 'Rapat' }, { waktuInput: '2026-10-01' }, { jamMulai: '0' }, { gedungId: 'GDG-01' }, { quantities: { Kursi: 2 } }]) {
    assert.equal(isBlankDraft({ ...blank, ...filled }), false, JSON.stringify(filled));
  }
  assert.equal(parseSavedDraft(serializeDraft(blank, NOW), NOW), null);
});

test('quantities stay within stock, and big stocks move in tens', () => {
  assert.equal(clampQuantity(5, 3), 3);
  assert.equal(clampQuantity(-2, 3), 0);
  assert.equal(clampQuantity(2.9, 5), 2);
  assert.equal(clampQuantity(Number.NaN, 5), 0);
  assert.equal(stepperIncrement(10), 1);
  assert.equal(stepperIncrement(30), 1);
  assert.equal(stepperIncrement(31), 10);
  assert.equal(stepperIncrement(500), 10);
});

test('phone numbers: digits, spaces and + ( ) -, between 8 and 15 digits', () => {
  assert.equal(contactNumberError('0812-3456-7890'), null);
  assert.equal(contactNumberError('+62 812 3456 7890'), null);
  assert.equal(contactNumberError('081234567890'), null);
  assert.match(contactNumberError('') ?? '', /wajib diisi/);
  assert.match(contactNumberError('   ') ?? '', /wajib diisi/);
  assert.match(contactNumberError('123') ?? '', /tidak valid/);
  assert.match(contactNumberError('0812abc34567') ?? '', /tidak valid/);
  assert.match(contactNumberError('1234567890123456') ?? '', /tidak valid/, '16 digits');
});

// Whatever masking rule is chosen for formatPhoneInput, these must keep holding.
test('phone masking keeps its contract for local numbers', () => {
  for (const raw of ['0812', '0812345', '081234567890', '0812-3456-7890', '0812 3456 7890', '0812345678901']) {
    const once = formatPhoneInput(raw);
    assert.equal(typeof once, 'string');
    assert.equal(formatPhoneInput(once), once, `idempotent for "${raw}"`);
    assert.equal(once.replace(/\D/g, ''), raw.replace(/\D/g, ''), `keeps every digit of "${raw}"`);
    assert.match(once, /^[0-9+()\-\s]*$/, `only allowed characters for "${raw}"`);
  }
  assert.equal(formatPhoneInput(''), '');
  assert.equal(contactNumberError(formatPhoneInput('081234567890')), null);
});

test('formatReservationDateRange formats single-day, same month, crossing months and years correctly', () => {
  // Same start and end date
  assert.equal(
    formatReservationDateRange('2026-10-01', '2026-10-01'),
    formatReservationDate('2026-10-01'),
  );

  // Same month
  assert.equal(
    formatReservationDateRange('2026-10-01', '2026-10-04'),
    'Kam, 1 Okt – Min, 4 Okt 2026 (4 hari)',
  );

  // Different month same year
  assert.equal(
    formatReservationDateRange('2026-10-30', '2026-11-02'),
    'Jum, 30 Okt – Sen, 2 Nov 2026 (4 hari)',
  );

  // Different year
  assert.equal(
    formatReservationDateRange('2026-12-30', '2027-01-02'),
    'Rab, 30 Des – Sab, 2 Jan 2027 (4 hari)',
  );

  // Fallback for null or invalid
  assert.equal(formatReservationDateRange('2026-10-01', null), formatReservationDate('2026-10-01'));
});

test('step 1 validates multi-day date range requirements when isMultiDay is true', () => {
  const baseMultiDay = draft({
    isMultiDay: true,
    waktu: '2026-10-01',
    waktuSelesai: '2026-10-03',
  });

  // Valid multi-day draft
  assert.deepEqual(validateStep('acara', baseMultiDay, context()), []);

  // Missing waktuSelesai
  assert.match(
    messages('acara', { ...baseMultiDay, waktuSelesai: '' }, context())[0],
    /^waktuSelesai: Pilih tanggal selesai/,
  );

  // waktuSelesai before waktu
  assert.match(
    messages('acara', { ...baseMultiDay, waktuSelesai: '2026-09-30' }, context())[0],
    /^waktuSelesai: Tanggal selesai harus setelah tanggal mulai/,
  );

  // Range exceeds 14 days
  assert.match(
    messages('acara', { ...baseMultiDay, waktuSelesai: '2026-10-20' }, context())[0],
    /^waktuSelesai: Rentang multi-hari maksimal 14 hari/,
  );
});

test('draft serialization and parsing preserves isMultiDay and waktuSelesaiInput', () => {
  const sampleDraft: SavedDraft = {
    step: 0,
    kegiatan: 'Pelatihan Multi-Hari',
    waktuInput: '2026-10-01',
    waktuSelesai: '2026-10-04',
    isMultiDay: true,
    jamMulai: '08:00',
    jamSelesai: '12:00',
    gedungId: 'GDG-03',
    ruangan: 'Meeting Room 1',
    quantities: {},
  };

  const serialized = serializeDraft(sampleDraft, new Date('2026-09-19T00:00:00Z'));
  const parsed = parseSavedDraft(serialized, new Date('2026-09-19T00:00:00Z'));

  assert.equal(parsed?.isMultiDay, true);
  assert.equal(parsed?.waktuInput, '2026-10-01');
  assert.equal(parsed?.waktuSelesai, '2026-10-04');
});

