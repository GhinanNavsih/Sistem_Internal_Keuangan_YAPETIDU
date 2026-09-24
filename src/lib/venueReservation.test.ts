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
  getDateRangeList,
  globalEquipmentFor,
  isValidDateString,
  isVenueReservationPath,
  jakartaNow,
  MAX_MULTI_DAY_RANGE,
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
  sakuGroupId,
  slotsOverlap,
  toReservationView,
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
  for (const role of ['finance_verifier', 'satker_head', 'loyalis_admin', 'honorer', 'loyalis'] as const) {
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

test('reservations with dates before today evaluate to selesai unless rejected/cancelled', () => {
  const today = '2026-09-21';
  // Past approved booking that staff never checked in -> selesai
  assert.equal(
    reservationPhase(
      { status: 'disetujui', waktu: '2026-08-16', serahTerimaSelesai: true, peminjamDiterima: true },
      today,
    ),
    'selesai',
  );
  // Past pending booking that was never approved -> selesai
  assert.equal(
    reservationPhase({ status: 'menunggu_biro_umum', waktu: '2026-07-15' }, today),
    'selesai',
  );
  // Past rejected booking stays ditolak
  assert.equal(
    reservationPhase({ status: 'ditolak', waktu: '2026-07-15' }, today),
    'ditolak',
  );
  // Past cancelled booking stays dibatalkan
  assert.equal(
    reservationPhase({ status: 'ditolak', cancelledBy: 'pemohon', waktu: '2026-07-15' }, today),
    'dibatalkan',
  );
  // Today's booking follows normal lifecycle
  assert.equal(
    reservationPhase({ status: 'disetujui', waktu: '2026-09-21' }, today),
    'terjadwal',
  );
  // Future booking follows normal lifecycle
  assert.equal(
    reservationPhase({ status: 'disetujui', waktu: '2026-09-22' }, today),
    'terjadwal',
  );
  // Allowed actions for past bookings are empty
  assert.deepEqual(
    allowedReservationActions({ status: 'disetujui', waktu: '2026-08-16' }, today),
    [],
  );
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

test('getDateRangeList generates chronological dates within limits', () => {
  // Single day
  assert.deepEqual(getDateRangeList('2026-10-01', '2026-10-01'), ['2026-10-01']);

  // Multi-day within same month
  assert.deepEqual(getDateRangeList('2026-10-01', '2026-10-04'), [
    '2026-10-01',
    '2026-10-02',
    '2026-10-03',
    '2026-10-04',
  ]);

  // Crossing month boundary
  assert.deepEqual(getDateRangeList('2026-10-30', '2026-11-02'), [
    '2026-10-30',
    '2026-10-31',
    '2026-11-01',
    '2026-11-02',
  ]);

  // Invalid date format
  assert.deepEqual(getDateRangeList('invalid', '2026-10-04'), []);
  assert.deepEqual(getDateRangeList('2026-10-01', 'invalid'), []);

  // End date before start date
  assert.deepEqual(getDateRangeList('2026-10-05', '2026-10-01'), []);

  // Exceeding MAX_MULTI_DAY_RANGE (14 days)
  assert.deepEqual(getDateRangeList('2026-10-01', '2026-10-15'), []); // 15 days -> empty
  assert.equal(getDateRangeList('2026-10-01', '2026-10-14').length, 14); // 14 days -> valid
});

test('validateReservationRequest supports multi-day date range', () => {
  const catalog = { buildings: BUILDINGS, equipment: EQUIPMENT };
  const baseReq = request({
    waktu: '2026-10-01',
    waktuSelesai: '2026-10-03',
    jamMulai: '08:00',
    jamSelesai: '12:00',
    kegiatan: 'Pekan Olahraga Mahasiswa',
  });

  const validation = validateReservationRequest(baseReq, catalog, NOW);
  assert.equal(validation.ok, true);
  if (validation.ok) {
    assert.deepEqual(validation.value.dates, ['2026-10-01', '2026-10-02', '2026-10-03']);
    assert.equal(validation.value.waktuSelesai, '2026-10-03');
  }

  // Range reversed
  const reversed = validateReservationRequest(
    request({ ...baseReq, waktuSelesai: '2026-09-30' }),
    catalog,
    NOW,
  );
  assert.equal(reversed.ok, false);
  if (!reversed.ok) {
    assert.match(reversed.error, /Tanggal selesai harus sama atau setelah tanggal mulai/);
  }

  // Range exceeds limit
  const tooLong = validateReservationRequest(
    request({ ...baseReq, waktuSelesai: '2026-10-20' }),
    catalog,
    NOW,
  );
  assert.equal(tooLong.ok, false);
  if (!tooLong.ok) {
    assert.match(tooLong.error, /Reservasi multi-hari maksimal 14 hari/);
  }
});

test('buildSakuBooking supports multi-day series metadata', () => {
  const catalog = { buildings: BUILDINGS, equipment: EQUIPMENT };
  const baseReq = request({
    waktu: '2026-10-01',
    waktuSelesai: '2026-10-03',
    jamMulai: '08:00',
    jamSelesai: '12:00',
    kegiatan: 'Pelatihan Multi-Hari',
  });
  const validation = validateReservationRequest(baseReq, catalog, NOW);
  assert.equal(validation.ok, true);
  if (!validation.ok) return;

  const dates = validation.value.dates;
  const groupId = sakuGroupId(1789900000000, 'abc');

  const bookingDay2 = buildSakuBooking({
    id: 'PJM-S-2',
    reservation: validation.value,
    actor: { uid: 'uid-123', role: 'satker_head_loyalis', email: null, displayName: 'SatKer Loyalis' },
    nowIso: '2026-09-19T03:00:00.000Z',
    today: '2026-09-19',
    waktu: '2026-10-02',
    kegiatan: 'Pelatihan Multi-Hari (Hari 2/3)',
    group: {
      id: groupId,
      dates,
      index: 2,
      total: 3,
    },
  });

  assert.equal(bookingDay2.id, 'PJM-S-2');
  assert.equal(bookingDay2.waktu, '2026-10-02');
  assert.equal(bookingDay2.kegiatan, 'Pelatihan Multi-Hari (Hari 2/3)');
  assert.equal(bookingDay2.sakuGroupId, groupId);
  assert.deepEqual(bookingDay2.sakuGroupDates, dates);
  assert.equal(bookingDay2.sakuGroupIndex, 2);
  assert.equal(bookingDay2.sakuGroupTotal, 3);

  // Normalize preserves group fields
  const normalized = normalizeSimpelBooking('PJM-S-2', bookingDay2);
  assert.equal(normalized.sakuGroupId, groupId);
  assert.deepEqual(normalized.sakuGroupDates, dates);
  assert.equal(normalized.sakuGroupIndex, 2);
  assert.equal(normalized.sakuGroupTotal, 3);

  // toReservationView maps group fields
  const view = toReservationView(normalized, 'satker_head_loyalis', 'uid-123');
  assert.equal(view.groupId, groupId);
  assert.deepEqual(view.groupDates, dates);
  assert.equal(view.groupIndex, 2);
  assert.equal(view.groupTotal, 3);
  assert.equal(view.isOwner, true);
  assert.ok(view.allowedActions.includes('cancel'));
});

test('toReservationView manages ownership and permissions for owner, other user, and super admin', () => {
  const booking = normalizeSimpelBooking('PJM-S-TEST', {
    kegiatan: 'Rapat Koordinasi',
    pemohon: 'Biro Administrasi',
    kontak: '081234567890',
    gedung: 'GOR Unipdu',
    ruangan: 'Lapangan Utama Futsal & Badminton',
    waktu: '2026-10-01',
    jam: '08:00 - 12:00',
    status: 'disetujui',
    source: 'saku',
    sakuUid: 'owner-uid-1',
    sakuDisplayName: 'Owner User',
  });

  // 1. Owner viewing their own reservation
  const ownerView = toReservationView(booking, 'satker_head_loyalis', 'owner-uid-1');
  assert.equal(ownerView.isOwner, true);
  assert.equal(ownerView.allowedActions.length > 0, true);
  assert.ok(ownerView.allowedActions.includes('cancel'));

  // 2. Another Kepala SatKer viewing someone else's reservation
  const otherView = toReservationView(booking, 'satker_head_loyalis', 'other-uid-2');
  assert.equal(otherView.isOwner, false);
  assert.equal(otherView.allowedActions.length, 0); // Must NOT be able to cancel or mutate someone else's reservation

  // 3. Super admin viewing someone else's reservation
  const adminView = toReservationView(booking, 'super_admin', 'admin-uid');
  assert.equal(adminView.isOwner, false);
  assert.equal(adminView.allowedActions.length > 0, true); // Admin retains ability to cancel
});

test('venue reservation handles uploaded confirmation letter (SK)', () => {
  const dummyDataUrl = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';

  // 1. parseReservationRequest parses and validates surat
  const parsed = parseReservationRequest({
    ...request(),
    suratName: ' Surat_Konfirmasi.png ',
    suratBase64: dummyDataUrl,
  });
  assert.equal(parsed.suratName, 'Surat_Konfirmasi.png');
  assert.equal(parsed.suratBase64, dummyDataUrl);

  // Invalid base64 (not starting with data:) is ignored
  const parsedBad = parseReservationRequest({
    suratName: 'bad.png',
    suratBase64: 'http://malicious-site.com/fake.png',
  });
  assert.equal(parsedBad.suratBase64, undefined);

  // 2. validateReservationRequest propagates surat fields
  const validated = validateReservationRequest(parsed, { buildings: BUILDINGS, equipment: EQUIPMENT }, NOW);
  assert.equal(validated.ok, true);
  if (!validated.ok) return;
  assert.equal(validated.value.suratName, 'Surat_Konfirmasi.png');
  assert.equal(validated.value.suratBase64, dummyDataUrl);

  // 3. buildSakuBooking includes surat fields on booking
  const booking = buildSakuBooking({
    id: 'PJM-S-TEST-SK',
    reservation: validated.value,
    actor: { uid: 'uid-1', role: 'satker_head_loyalis', email: null, displayName: '' },
    nowIso: '2026-09-19T03:00:00.000Z',
    today: '2026-09-19',
  });
  assert.equal(booking.suratName, 'Surat_Konfirmasi.png');
  assert.equal(booking.suratBase64, dummyDataUrl);

  // 4. toReservationView exposes suratName and hasSurat flag
  const viewWithSurat = toReservationView(booking, 'satker_head_loyalis', 'uid-1');
  assert.equal(viewWithSurat.suratName, 'Surat_Konfirmasi.png');
  assert.equal(viewWithSurat.hasSurat, true);

  const viewWithoutSurat = toReservationView({ ...booking, suratName: undefined, suratBase64: undefined });
  assert.equal(viewWithoutSurat.suratName, null);
  assert.equal(viewWithoutSurat.hasSurat, false);
});

test('venue reservation handles multiple uploaded confirmation/proof files (suratFiles)', () => {
  const dummyPdf = 'data:application/pdf;base64,JVBERi0xLjQKJcTl8uXrp...';
  const dummyJpg = 'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQEASABIAAD...';

  // 1. parseReservationRequest parses array of files and populates fallback single-file fields
  const parsed = parseReservationRequest({
    ...request(),
    suratFiles: [
      { name: 'SK_Peminjaman.pdf', base64: dummyPdf },
      { name: 'Bukti_Rektorat.jpg', base64: dummyJpg },
    ],
  });
  assert.equal(parsed.suratFiles?.length, 2);
  assert.equal(parsed.suratFiles?.[0].name, 'SK_Peminjaman.pdf');
  assert.equal(parsed.suratFiles?.[1].name, 'Bukti_Rektorat.jpg');
  assert.equal(parsed.suratName, 'SK_Peminjaman.pdf');
  assert.equal(parsed.suratBase64, dummyPdf);

  // 2. validateReservationRequest propagates suratFiles
  const validated = validateReservationRequest(parsed, { buildings: BUILDINGS, equipment: EQUIPMENT }, NOW);
  assert.equal(validated.ok, true);
  if (!validated.ok) return;
  assert.equal(validated.value.suratFiles?.length, 2);

  // 3. buildSakuBooking persists suratFiles and backward compatible fields
  const booking = buildSakuBooking({
    id: 'PJM-S-TEST-MULTI',
    reservation: validated.value,
    actor: { uid: 'uid-1', role: 'satker_head_loyalis', email: null, displayName: '' },
    nowIso: '2026-09-19T03:00:00.000Z',
    today: '2026-09-19',
  });
  assert.equal(booking.suratFiles?.length, 2);
  assert.equal(booking.suratName, 'SK_Peminjaman.pdf');
  assert.equal(booking.suratBase64, dummyPdf);

  // 4. toReservationView sets suratCount and hasSurat
  const view = toReservationView(booking, 'satker_head_loyalis', 'uid-1');
  assert.equal(view.hasSurat, true);
  assert.equal(view.suratCount, 2);
  assert.equal(view.suratName, 'SK_Peminjaman.pdf');
});

