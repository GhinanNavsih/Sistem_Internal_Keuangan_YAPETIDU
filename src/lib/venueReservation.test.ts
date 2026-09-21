import assert from 'node:assert/strict';
import test from 'node:test';
import { canReserveVenues, VENUE_RESERVATION_ROLES } from './payroll/roles';
import {
  addDays,
  allowedReservationActions,
  buildSakuBooking,
  buildSimpelEmailHtml,
  buildVenuePhotos,
  buildSimpelNotification,
  canPerformReservationAction,
  equipmentAvailability,
  findEquipmentShortages,
  findRoomConflicts,
  formatFacility,
  formatJam,
  globalEquipmentFor,
  isValidDateString,
  isVenueReservationPath,
  jakartaNow,
  normalizeSimpelBooking,
  parseClock,
  parseFacility,
  parseJam,
  parseReservationRequest,
  pickVenuePhoto,
  reservationActionPatch,
  reservationActionRefusal,
  reservationCreatedNotifications,
  reservationPhase,
  resolveVenuePhoto,
  sakuBookingId,
  slotsOverlap,
  validateReservationRequest,
  type AvailabilityContext,
  type BookingSlot,
  type SimpelBuilding,
  type SimpelEquipment,
  type VenueReservationRequest,
} from './venueReservation';

const GOR: SimpelBuilding = {
  id: 'GDG-01',
  nama: 'GOR Unipdu (Gelora R.A. Wahid Hasyim)',
  singkatan: 'GELORA',
  lokasi: 'Sektor Selatan',
  ruanganList: [
    {
      nama: 'Lapangan Utama Futsal & Badminton',
      tipe: 'Meeting Room',
      kapasitas: 1500,
      lantai: 1,
      status: 'Tersedia',
      fasilitasBawaan: ['Tribun Penonton', 'Toilet Atlet'],
    },
    {
      nama: 'Ruang Media & Sekretariat',
      tipe: 'Meeting Room',
      kapasitas: 40,
      lantai: 2,
      status: 'Maintenance',
      fasilitasBawaan: ['AC Split'],
    },
  ],
  inventarisList: [
    { nama: 'Sound System Portable 2000W', jumlah: 2, kondisi: 'Baik' },
    { nama: 'Kursi Lipat Plastik (Chitose)', jumlah: 500, kondisi: 'Baik' },
  ],
};

const GKB: SimpelBuilding = {
  id: 'GDG-03',
  nama: 'Gedung Kuliah Bersama A',
  singkatan: 'GKB A',
  lokasi: 'Sektor Tengah',
  ruanganList: [
    {
      nama: 'Ruang Seminar GKB 301',
      tipe: 'Kelas',
      kapasitas: 120,
      lantai: 3,
      status: 'Tersedia',
      fasilitasBawaan: ['LCD Projector Gantung', 'Sound Kelas'],
    },
  ],
  inventarisList: [],
};

const BUILDINGS = [GOR, GKB];

const EQUIPMENT: SimpelEquipment[] = [
  { id: 'INV-EL-004', nama: 'Mic Wireless Shure SM58 Duo Set', kategori: 'Elektronik', totalStok: 10 },
  { id: 'INV-EL-003', nama: 'LCD Projector Epson Portable 4000 Lumens', kategori: 'Elektronik', totalStok: 3 },
  { id: 'INV-MB-001', nama: 'Kursi Lipat Plastik (Chitose)', kategori: 'Mebel', totalStok: 1200 },
];

function slot(overrides: Partial<BookingSlot>): BookingSlot {
  return {
    id: 'PJM-0101',
    status: 'disetujui',
    waktu: '2026-10-01',
    jam: '08:00 - 10:00',
    gedung: GOR.nama,
    ruangan: 'Lapangan Utama Futsal & Badminton',
    fasilitasTambahan: [],
    ...overrides,
  };
}

function context(bookings: BookingSlot[], overrides: Partial<AvailabilityContext> = {}): AvailabilityContext {
  return {
    buildings: BUILDINGS,
    equipment: EQUIPMENT,
    bookings,
    waktu: '2026-10-01',
    jam: '09:00 - 11:00',
    gedung: GOR.nama,
    ruangan: 'Lapangan Utama Futsal & Badminton',
    ...overrides,
  };
}

function request(overrides: Partial<VenueReservationRequest> = {}): VenueReservationRequest {
  return {
    gedungId: 'GDG-01',
    ruangan: 'Lapangan Utama Futsal & Badminton',
    waktu: '2026-10-01',
    jamMulai: '13:00',
    jamSelesai: '15:00',
    kegiatan: 'Rapat Koordinasi Loyalis',
    pemohon: 'SatKer Loyalis',
    kontak: '0812-3456-7890',
    equipment: [],
    ...overrides,
  };
}

const NOW = { date: '2026-09-19', minutes: 10 * 60 };

test('only Super Admin and Kepala SatKer Loyalis may reserve venues', () => {
  assert.deepEqual([...VENUE_RESERVATION_ROLES], ['super_admin', 'satker_head_loyalis']);
  assert.equal(canReserveVenues('super_admin'), true);
  assert.equal(canReserveVenues('satker_head_loyalis'), true);
  for (const role of ['finance_verifier', 'satker_head', 'employee_admin', 'honorer', 'loyalis'] as const) {
    assert.equal(canReserveVenues(role), false, role);
  }
  assert.equal(canReserveVenues(null), false);
});

test('the reservation page path matches only itself and its sub-routes', () => {
  assert.equal(isVenueReservationPath('/dashboard/reservasi-ruang'), true);
  assert.equal(isVenueReservationPath('/dashboard/reservasi-ruang/baru'), true);
  assert.equal(isVenueReservationPath('/dashboard/reservasi-ruangan'), false);
  assert.equal(isVenueReservationPath('/dashboard/payroll/uraian'), false);
});

test('parseJam reads the formats SIMPEL users type', () => {
  assert.deepEqual(parseJam('08:00 - 10:00'), { start: 480, end: 600 });
  assert.deepEqual(parseJam('07:30 - 11:45 WIB'), { start: 450, end: 705 });
  assert.deepEqual(parseJam('07.30-11.45'), { start: 450, end: 705 });
  assert.deepEqual(parseJam('08:00 – 10:00'), { start: 480, end: 600 });
  assert.deepEqual(parseJam('08.00 s.d. 10.00'), { start: 480, end: 600 });
  assert.deepEqual(parseJam('08:00 s/d 10:00'), { start: 480, end: 600 });
  assert.deepEqual(parseJam('08:00 - 24:00'), { start: 480, end: 1440 });
});

test('parseJam gives up on anything it cannot read safely', () => {
  assert.equal(parseJam('Seharian'), null);
  assert.equal(parseJam(''), null);
  assert.equal(parseJam(undefined), null);
  assert.equal(parseJam('22:00 - 02:00'), null, 'overnight');
  assert.equal(parseJam('10:00 - 10:00'), null, 'empty range');
  assert.equal(parseJam('08:75 - 10:00'), null, 'bad minutes');
});

test('slots clash only when their hours overlap', () => {
  assert.equal(slotsOverlap('08:00 - 10:00', '09:30 - 11:00'), true, 'partial overlap');
  assert.equal(slotsOverlap('08:00 - 12:00', '09:00 - 10:00'), true, 'contained');
  assert.equal(slotsOverlap('08:00 - 10:00', '10:00 - 12:00'), false, 'touching ends');
  assert.equal(slotsOverlap('08:00 - 10:00', '13:00 - 15:00'), false, 'disjoint');
  assert.equal(slotsOverlap('08:00 - 10:00', '13:00 - 15:00 WIB'), false, 'WIB suffix');
});

test('an unreadable jam counts as the whole day', () => {
  assert.equal(slotsOverlap('pagi sampai sore', '20:00 - 21:00'), true);
  assert.equal(slotsOverlap('06:00 - 07:00', 'Seharian'), true);
});

test('clock and jam formatting', () => {
  assert.equal(parseClock('07:05'), 425);
  assert.equal(parseClock('23:59'), 1439);
  assert.equal(parseClock('24:00'), null);
  assert.equal(parseClock('7:05'), null);
  assert.equal(formatJam('13:00', '15:30'), '13:00 - 15:30');
  assert.deepEqual(parseJam(formatJam('13:00', '15:30')), { start: 780, end: 930 });
});

test('jakartaNow uses the campus clock, not UTC', () => {
  // 17:30 UTC on the 18th is 00:30 on the 19th in Jakarta (UTC+7).
  assert.deepEqual(jakartaNow(new Date('2026-09-18T17:30:00Z')), { date: '2026-09-19', minutes: 30 });
});

test('date helpers', () => {
  assert.equal(isValidDateString('2026-02-28'), true);
  assert.equal(isValidDateString('2026-02-30'), false);
  assert.equal(isValidDateString('2026-2-3'), false);
  assert.equal(addDays('2026-12-31', 1), '2027-01-01');
});

test('equipment lines round-trip in SIMPEL format', () => {
  assert.equal(formatFacility(1, 'Gawang'), '1x Gawang');
  assert.deepEqual(parseFacility(formatFacility(500, 'Kursi Lipat Plastik (Chitose)')), {
    qty: 500,
    name: 'Kursi Lipat Plastik (Chitose)',
  });
  assert.deepEqual(parseFacility('Gawang'), { qty: 1, name: 'Gawang' });
});

test('room conflicts: same room, same date, overlapping hours', () => {
  const request = { waktu: '2026-10-01', jam: '09:00 - 11:00', building: GOR, ruangan: 'Lapangan Utama Futsal & Badminton' };
  assert.equal(findRoomConflicts([slot({})], request).length, 1);
  assert.equal(findRoomConflicts([slot({ jam: '11:00 - 12:00' })], request).length, 0, 'different hours');
  assert.equal(findRoomConflicts([slot({ waktu: '2026-10-02' })], request).length, 0, 'different date');
  assert.equal(findRoomConflicts([slot({ ruangan: 'Ruang Media & Sekretariat' })], request).length, 0, 'different room');
  assert.equal(findRoomConflicts([slot({})], request, 'PJM-0101').length, 0, 'itself');
});

test('room conflicts: pending requests hold the room, finished ones do not', () => {
  const request = { waktu: '2026-10-01', jam: '09:00 - 11:00', building: GOR, ruangan: 'Lapangan Utama Futsal & Badminton' };
  for (const status of ['menunggu_bak', 'menunggu_biro_umum', 'menunggu_konfirmasi_mhs', 'direvisi_mhs', 'disetujui']) {
    assert.equal(findRoomConflicts([slot({ status })], request).length, 1, status);
  }
  for (const status of ['ditolak', 'selesai', 'dikembalikan']) {
    assert.equal(findRoomConflicts([slot({ status })], request).length, 0, status);
  }
});

test('room conflicts: older bookings that use a short building name still count', () => {
  const gor = { waktu: '2026-10-01', jam: '09:00 - 11:00', building: GOR, ruangan: 'Lapangan Utama Futsal & Badminton' };
  assert.equal(findRoomConflicts([slot({ gedung: 'GOR Unipdu' })], gor).length, 1);

  const gkb = { waktu: '2026-10-01', jam: '09:00 - 11:00', building: GKB, ruangan: 'Ruang Seminar GKB 301' };
  assert.equal(findRoomConflicts([slot({ gedung: 'Gedung GKB A', ruangan: 'Ruang Seminar GKB 301' })], gkb).length, 1);
});

test('building stock: only approved bookings at overlapping hours in the same building consume it', () => {
  const bookings = [
    slot({ id: 'A', fasilitasTambahan: ['1x Sound System Portable 2000W'] }), // 08-10 overlaps 09-11
    slot({ id: 'B', jam: '13:00 - 15:00', fasilitasTambahan: ['1x Sound System Portable 2000W'] }), // later
    slot({ id: 'C', status: 'menunggu_biro_umum', fasilitasTambahan: ['1x Sound System Portable 2000W'] }), // pending
    slot({ id: 'D', gedung: GKB.nama, ruangan: 'Ruang Seminar GKB 301', fasilitasTambahan: ['1x Sound System Portable 2000W'] }), // other building
  ];
  assert.deepEqual(equipmentAvailability(context(bookings), '1x Sound System Portable 2000W'), {
    name: 'Sound System Portable 2000W',
    source: 'building',
    total: 2,
    allocated: 1,
    remaining: 1,
  });
});

test('global stock is shared across buildings', () => {
  const bookings = [
    slot({ id: 'A', gedung: GKB.nama, ruangan: 'Ruang Seminar GKB 301', fasilitasTambahan: ['2x LCD Projector Epson Portable 4000 Lumens'] }),
  ];
  const availability = equipmentAvailability(context(bookings), '1x LCD Projector Epson Portable 4000 Lumens');
  assert.equal(availability?.source, 'global');
  assert.equal(availability?.remaining, 1);
  assert.deepEqual(findEquipmentShortages(context(bookings), ['2x LCD Projector Epson Portable 4000 Lumens']), [
    { name: 'LCD Projector Epson Portable 4000 Lumens', requested: 2, remaining: 1 },
  ]);
});

test("a room's built-in facilities are always available and never consume stock", () => {
  assert.equal(equipmentAvailability(context([]), '1x Tribun Penonton')?.source, 'room');
  // "2x LCD Projector" in GKB 301 is its built-in "LCD Projector Gantung", so it
  // takes nothing from the global projector stock it would otherwise match.
  const bookings = [
    slot({ id: 'A', gedung: GKB.nama, ruangan: 'Ruang Seminar GKB 301', fasilitasTambahan: ['2x LCD Projector'] }),
  ];
  const availability = equipmentAvailability(
    context(bookings, { gedung: GKB.nama, ruangan: 'Ruang Seminar GKB 301' }),
    '1x LCD Projector Epson Portable 4000 Lumens',
  );
  assert.equal(availability?.remaining, 3);
});

test('items in no catalog are unknown', () => {
  assert.equal(equipmentAvailability(context([]), '1x Helikopter'), null);
});

test('global items the building stocks itself are not offered twice', () => {
  const names = globalEquipmentFor(GOR, EQUIPMENT).map((item) => item.nama);
  assert.equal(names.includes('Kursi Lipat Plastik (Chitose)'), false);
  assert.equal(names.includes('Mic Wireless Shure SM58 Duo Set'), true);
});

test('a valid request becomes canonical SIMPEL values', () => {
  const result = validateReservationRequest(
    request({ equipment: [{ name: 'mic wireless shure sm58 duo set', qty: 2 }, { name: 'Sound System Portable 2000W', qty: 1 }] }),
    { buildings: BUILDINGS, equipment: EQUIPMENT },
    NOW,
  );
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.value.jam, '13:00 - 15:00');
  assert.equal(result.value.building.id, 'GDG-01');
  assert.deepEqual(result.value.fasilitasTambahan, ['2x Mic Wireless Shure SM58 Duo Set', '1x Sound System Portable 2000W']);
});

test('invalid requests are refused with a reason', () => {
  const catalog = { buildings: BUILDINGS, equipment: EQUIPMENT };
  const refused = (overrides: Partial<VenueReservationRequest>, now = NOW) => {
    const result = validateReservationRequest(request(overrides), catalog, now);
    assert.equal(result.ok, false, JSON.stringify(overrides));
    return result.ok ? '' : result.error;
  };

  assert.match(refused({ waktu: '2026-09-18' }), /sudah lewat/);
  assert.match(refused({ waktu: '2027-12-01' }), /satu tahun/);
  assert.match(refused({ waktu: '2026-02-30' }), /tidak valid/);
  assert.match(refused({ jamMulai: '15:00', jamSelesai: '13:00' }), /setelah jam mulai/);
  assert.match(refused({ jamMulai: '9', jamSelesai: '10:00' }), /format JJ:MM/);
  assert.match(refused({ waktu: '2026-09-19', jamMulai: '08:00', jamSelesai: '09:30' }), /hari ini sudah lewat/);
  assert.match(refused({ kegiatan: '' }), /wajib diisi/);
  assert.match(refused({ kegiatan: '<img src=x onerror=alert(1)>' }), /tanda < atau >/);
  assert.match(refused({ kegiatan: 'x'.repeat(151) }), /maksimal 150/);
  assert.match(refused({ kontak: '123' }), /tidak valid/);
  assert.match(refused({ kontak: '0812abc34567' }), /tidak valid/);
  assert.match(refused({ gedungId: 'GDG-99' }), /Gedung tidak ditemukan/);
  assert.match(refused({ ruangan: 'Ruang Rahasia' }), /Ruangan tidak ditemukan/);
  assert.match(refused({ ruangan: 'Ruang Media & Sekretariat' }), /perawatan/);
  assert.match(refused({ equipment: [{ name: 'Helikopter', qty: 1 }] }), /tidak ada di katalog/);
  assert.match(
    refused({ equipment: [{ name: 'Mic Wireless Shure SM58 Duo Set', qty: 1 }, { name: 'MIC WIRELESS SHURE SM58 DUO SET', qty: 1 }] }),
    /lebih dari sekali/,
  );
  assert.match(refused({ equipment: [{ name: 'Mic Wireless Shure SM58 Duo Set', qty: 0 }] }), /minimal 1/);
  assert.match(refused({ equipment: [{ name: 'Mic Wireless Shure SM58 Duo Set', qty: 1.5 }] }), /minimal 1/);
  assert.match(refused({ equipment: [{ name: 'Mic Wireless Shure SM58 Duo Set', qty: 11 }] }), /melebihi stok/);
  assert.match(refused({ sakuEventId: 'bad id!' }), /ID kegiatan/);
});

test("today is allowed while the event hasn't ended", () => {
  const result = validateReservationRequest(
    request({ waktu: '2026-09-19', jamMulai: '09:00', jamSelesai: '12:00' }),
    { buildings: BUILDINGS, equipment: EQUIPMENT },
    NOW,
  );
  assert.equal(result.ok, true);
});

test('untrusted bodies are coerced before validation', () => {
  const parsed = parseReservationRequest({
    gedungId: ' GDG-01 ',
    waktu: 20261001,
    equipment: [{ name: ' Gawang ', qty: '3' }, 'junk'],
  });
  assert.equal(parsed.gedungId, 'GDG-01');
  assert.equal(parsed.waktu, '');
  assert.deepEqual(parsed.equipment[0], { name: 'Gawang', qty: 3 });
  assert.equal(parsed.equipment[1].name, '');
  assert.deepEqual(parseReservationRequest(null).equipment, []);
});

test('a SAKU booking is a plain approved SIMPEL booking with extra fields', () => {
  const validated = validateReservationRequest(
    request({ equipment: [{ name: 'Mic Wireless Shure SM58 Duo Set', qty: 2 }] }),
    { buildings: BUILDINGS, equipment: EQUIPMENT },
    NOW,
  );
  assert.equal(validated.ok, true);
  if (!validated.ok) return;

  const booking = buildSakuBooking({
    id: 'PJM-S-TEST-ABC123',
    reservation: validated.value,
    actor: { uid: 'uid-1', role: 'satker_head_loyalis', email: null, displayName: '' },
    nowIso: '2026-09-19T03:00:00.000Z',
    today: '2026-09-19',
  });

  // Pinned: the fields and values SIMPEL's pages read.
  assert.deepEqual(booking, {
    id: 'PJM-S-TEST-ABC123',
    pemohon: 'SatKer Loyalis',
    tipePemohon: 'tu',
    kontak: '0812-3456-7890',
    gedung: 'GOR Unipdu (Gelora R.A. Wahid Hasyim)',
    ruangan: 'Lapangan Utama Futsal & Badminton',
    waktu: '2026-10-01',
    jam: '13:00 - 15:00',
    kegiatan: 'Rapat Koordinasi Loyalis',
    status: 'disetujui',
    fasilitasTambahan: ['2x Mic Wireless Shure SM58 Duo Set'],
    tanggalDibuat: '2026-09-19',
    source: 'saku',
    sakuUid: 'uid-1',
    sakuRole: 'satker_head_loyalis',
    autoApproved: true,
    createdAt: '2026-09-19T03:00:00.000Z',
  });
  assert.equal(Object.values(booking).some((value) => value === undefined), false, 'Firestore rejects undefined');
  assert.equal(reservationPhase(booking), 'terjadwal');
});

test('booking ids never follow SIMPEL count-based numbering', () => {
  const id = sakuBookingId(Date.UTC(2026, 8, 19), 'a1b2c3');
  assert.match(id, /^PJM-S-[0-9A-Z]+-A1B2C3$/);
  assert.notEqual(id, sakuBookingId(Date.UTC(2026, 8, 19), 'a1b2c4'));
});

test('the lifecycle follows the flags SIMPEL sets, in order', () => {
  const base = { status: 'disetujui' };
  assert.equal(reservationPhase({ status: 'menunggu_biro_umum' }), 'menunggu');
  assert.equal(reservationPhase(base), 'terjadwal');
  assert.equal(reservationPhase({ ...base, serahTerimaSelesai: true }), 'diserahkan');
  assert.equal(reservationPhase({ ...base, serahTerimaSelesai: true, peminjamDiterima: true }), 'diterima');
  assert.equal(
    reservationPhase({ ...base, serahTerimaSelesai: true, peminjamDiterima: true, peminjamSiapKembali: true }),
    'menunggu_checkin',
  );
  assert.equal(reservationPhase({ status: 'selesai' }), 'selesai');
  assert.equal(reservationPhase({ status: 'dikembalikan' }), 'selesai');
  assert.equal(reservationPhase({ status: 'ditolak' }), 'ditolak');
  assert.equal(reservationPhase({ status: 'ditolak', cancelledBy: 'biro_umum' }), 'dibatalkan');
});

test('owner buttons appear only at the right step', () => {
  assert.deepEqual(allowedReservationActions({ status: 'disetujui' }), ['cancel']);
  assert.deepEqual(allowedReservationActions({ status: 'disetujui', fasilitasDiserahkan: ['1x Gawang'] }), []);
  assert.deepEqual(allowedReservationActions({ status: 'disetujui', serahTerimaSelesai: true }), ['confirm-receipt']);
  assert.deepEqual(
    allowedReservationActions({ status: 'disetujui', serahTerimaSelesai: true, peminjamDiterima: true }),
    ['ready-return'],
  );
  assert.deepEqual(
    allowedReservationActions({
      status: 'disetujui',
      serahTerimaSelesai: true,
      peminjamDiterima: true,
      peminjamSiapKembali: true,
    }),
    [],
  );
  for (const status of ['selesai', 'ditolak']) {
    assert.deepEqual(allowedReservationActions({ status }), [], status);
  }
  assert.equal(canPerformReservationAction({ status: 'disetujui' }, 'ready-return'), false);
});

test('refusals explain what to do next', () => {
  assert.match(reservationActionRefusal({ status: 'disetujui', serahTerimaSelesai: true }, 'cancel'), /Biro Umum/);
  assert.match(reservationActionRefusal({ status: 'disetujui' }, 'confirm-receipt'), /belum diserahkan/);
  assert.match(reservationActionRefusal({ status: 'disetujui' }, 'ready-return'), /belum diserahkan/);
  assert.match(reservationActionRefusal({ status: 'disetujui', serahTerimaSelesai: true }, 'ready-return'), /Konfirmasi penerimaan/);
  assert.match(reservationActionRefusal({ status: 'selesai' }, 'cancel'), /sudah selesai/);
});

test('actions write only their own fields', () => {
  const nowIso = '2026-10-01T08:00:00.000Z';
  assert.deepEqual(reservationActionPatch('confirm-receipt', { nowIso }), {
    peminjamDiterima: true,
    peminjamDiterimaAt: nowIso,
  });
  assert.deepEqual(reservationActionPatch('ready-return', { nowIso }), {
    peminjamSiapKembali: true,
    peminjamSiapKembaliAt: nowIso,
  });
  assert.deepEqual(reservationActionPatch('cancel', { nowIso, cancelReason: ' Acara ditunda ' }), {
    status: 'ditolak',
    alasanPenolakan: 'Dibatalkan oleh pemohon melalui SAKU: Acara ditunda',
    cancelledBy: 'pemohon',
    cancelledAt: nowIso,
  });
  assert.match(
    String(reservationActionPatch('cancel', { nowIso, cancelledByAdmin: true }).alasanPenolakan),
    /Super Admin/,
  );
});

test('SIMPEL documents with missing or odd fields are read safely', () => {
  const booking = normalizeSimpelBooking('PJM-0107', {
    gedung: 'GOR Unipdu',
    fasilitasTambahan: ['1x Gawang', 7, null],
    serahTerimaSelesai: 'yes',
    cancelledBy: 'someone',
  });
  assert.equal(booking.id, 'PJM-0107');
  assert.deepEqual(booking.fasilitasTambahan, ['1x Gawang']);
  assert.equal(booking.serahTerimaSelesai, undefined);
  assert.equal(booking.cancelledBy, undefined);
  assert.equal(booking.status, '');
});

test('notifications escape everything and match SIMPEL id/timestamp formats', () => {
  const html = buildSimpelEmailHtml('Judul <b>', 'Intro & "kutip"', [{ label: 'Kegiatan', value: '<script>x</script>' }]);
  assert.equal(html.includes('<script>'), false);
  assert.equal(html.includes('&lt;script&gt;'), true);
  assert.equal(html.includes('Intro &amp; &quot;kutip&quot;'), true);

  const notification = buildSimpelNotification(
    { to: 'maintenance@unipdu.ac.id', subject: 'S', bodyHtml: '<div></div>' },
    new Date('2026-09-19T03:05:00Z'),
    42,
  );
  assert.equal(notification.id, `EML-${Date.parse('2026-09-19T03:05:00Z')}-42`);
  // 03:05 UTC is 10:05 in Jakarta; the separators follow the id-ID locale, as in SIMPEL.
  assert.match(notification.timestamp, /^19 Sep,? 10[.:]05 WIB$/);
  assert.equal(notification.read, false);
});

test('a venue photo must be an embedded image or an https link, and not too big', () => {
  const png = 'data:image/png;base64,iVBORw0KGgo=';
  assert.equal(pickVenuePhoto(png), png);
  assert.equal(pickVenuePhoto('data:image/jpeg;base64,/9j/4AAQSkZJRg=='), 'data:image/jpeg;base64,/9j/4AAQSkZJRg==');
  assert.equal(pickVenuePhoto('https://images.unsplash.com/photo-1?w=800&q=80'), 'https://images.unsplash.com/photo-1?w=800&q=80');
  for (const bad of [
    'data:image/svg+xml;base64,PHN2Zz4=', // can carry scripts
    'javascript:alert(1)',
    'http://example.com/a.jpg',
    'https://exa mple.com/a.jpg',
    'https://example.com/a"onerror="x',
    'data:image/png;base64,' + 'A'.repeat(300_000),
    'data:text/html;base64,PGh0bWw+',
    '',
    '   ',
    null,
    undefined,
    42,
  ]) {
    assert.equal(pickVenuePhoto(bad), null, String(bad).slice(0, 40));
  }
});

test('the first usable photo wins, in the order given', () => {
  const png = 'data:image/png;base64,iVBORw0KGgo=';
  assert.equal(pickVenuePhoto(undefined, ['javascript:x', png, 'https://a.example/b.jpg']), png);
  assert.equal(pickVenuePhoto('', [], 'https://a.example/b.jpg'), 'https://a.example/b.jpg');
  assert.equal(pickVenuePhoto([], undefined), null);
});

test('each building and room gets one cover photo, and gaps are null', () => {
  const png = 'data:image/png;base64,iVBORw0KGgo=';
  const jpg = 'data:image/jpeg;base64,/9j/4AAQ';
  const photos = buildVenuePhotos([
    {
      id: 'GDG-01',
      data: {
        imageUrl: png,
        images: [jpg],
        ruanganList: [{ nama: 'Meeting Room 1', images: [jpg, png] }, { nama: 'Meeting Room 2', images: [] }, { images: [png] }],
      },
    },
    { id: 'GDG-02', data: { images: [jpg], ruanganList: [] } }, // no imageUrl: falls back to the list
    { id: 'GDG-03', data: { imageUrl: 'javascript:x' } },
    { id: 'GDG-04', data: 'junk' },
  ]);
  assert.deepEqual(photos.buildings, { 'GDG-01': png, 'GDG-02': jpg, 'GDG-03': null, 'GDG-04': null });
  assert.deepEqual(photos.rooms['GDG-01'], { 'Meeting Room 1': jpg, 'Meeting Room 2': null }, 'a room without a name is skipped');
  assert.deepEqual(photos.rooms['GDG-02'], {});
  assert.deepEqual(photos.rooms['GDG-04'], {});
});

test('resolveVenuePhoto prefers room photo, falls back to building photo, and resolves by name and abbreviation', () => {
  const bldgPng = 'data:image/png;base64,iVBORw0KGgo=';
  const roomJpg = 'data:image/jpeg;base64,/9j/4AAQ';
  const photos = buildVenuePhotos([
    {
      id: 'GDG-03',
      data: {
        nama: 'Gedung Kuliah Kampus Utama',
        singkatan: 'Kampus Utama',
        imageUrl: bldgPng,
        ruanganList: [
          { nama: 'Meeting Room 1', images: [roomJpg] },
          { nama: 'Meeting Room 2', images: [] }, // no room photo: should fall back to building photo
        ],
      },
    },
    {
      id: 'GDG-01',
      data: {
        nama: "Gelora Abi As'ad (GOR UNIPDU)",
        singkatan: 'GELORA',
        imageUrl: bldgPng,
        ruanganList: [],
      },
    },
  ]);

  // 1. Room photo preferred over building photo
  assert.equal(
    resolveVenuePhoto(photos, 'Gedung Kuliah Kampus Utama', 'Meeting Room 1'),
    roomJpg,
    'Room with photo returns the room photo',
  );

  // 2. Case and whitespace insensitivity
  assert.equal(
    resolveVenuePhoto(photos, '  gedung kuliah kampus utama  ', 'meeting room 1'),
    roomJpg,
    'Handles case and whitespace differences',
  );

  // 3. Lookup using building abbreviation (singkatan)
  assert.equal(
    resolveVenuePhoto(photos, 'Kampus Utama', 'Meeting Room 1'),
    roomJpg,
    'Resolves using building abbreviation',
  );

  // 4. Fallback to building photo when room has no photo
  assert.equal(
    resolveVenuePhoto(photos, 'Gedung Kuliah Kampus Utama', 'Meeting Room 2'),
    bldgPng,
    'Falls back to building photo when room has no photo',
  );

  // 5. Whole building venue (no rooms) returns building photo
  assert.equal(
    resolveVenuePhoto(photos, "Gelora Abi As'ad (GOR UNIPDU)", 'Lapangan'),
    bldgPng,
    'Returns building photo for building venue',
  );

  // 6. Non-matching venue returns null
  assert.equal(resolveVenuePhoto(photos, 'Gedung Tidak Ada', 'Ruang X'), null);
  assert.equal(resolveVenuePhoto(null, 'Gedung Kuliah Kampus Utama'), null);
});

test('a new reservation notifies Pekarya and Biro Umum', () => {
  const booking = normalizeSimpelBooking('PJM-S-1', {
    pemohon: 'SatKer Loyalis',
    gedung: GOR.nama,
    ruangan: 'Lapangan Utama Futsal & Badminton',
    waktu: '2026-10-01',
    jam: '13:00 - 15:00',
    kegiatan: 'Rapat',
    status: 'disetujui',
  });
  assert.deepEqual(
    reservationCreatedNotifications(booking).map((draft) => draft.to),
    ['maintenance@unipdu.ac.id', 'biroumum@unipdu.ac.id'],
  );
});
