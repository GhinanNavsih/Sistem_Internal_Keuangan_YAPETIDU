import assert from 'node:assert/strict';
import test from 'node:test';
import { getEmployeeRouteRedirect } from './employeeActivities';
import {
  awaitsReturnCheck,
  buildInspectionChecklist,
  canInspectVenues,
  facilityCategory,
  formatInspectionDate,
  isBookingEnded,
  normalizeMaintenanceLog,
  parseCheckInSubmission,
  parsePermanentFacility,
  planCheckIn,
  planRepairResolution,
  returnStage,
  validateCheckInSubmission,
  VENUE_INSPECTION_PATH,
  type CheckInSubmission,
  type EquipmentStock,
  type InspectionCatalog,
  type RawBuilding,
  type ResolvedCheckIn,
} from './venueInspection';
import { normalizeSimpelBooking, type SimpelBooking } from './venueReservation';

const catalog: InspectionCatalog = {
  buildings: [
    {
      id: 'GDG-03',
      nama: 'Gedung Kuliah Kampus Utama',
      singkatan: 'GKB',
      lokasi: '',
      ruanganList: [
        {
          nama: 'Theater Room',
          tipe: 'Aula',
          kapasitas: 150,
          lantai: 2,
          status: 'Tersedia',
          fasilitasBawaan: ['AC Split (4 unit)', 'Komputer', 'Kursi Audien (151 unit)', 'Remote Proyektor'],
        },
      ],
      inventarisList: [
        { nama: 'Kursi', jumlah: 50, kondisi: 'Baik' },
        { nama: 'Kursi Lipat', jumlah: 40, kondisi: 'Baik' },
      ],
    },
  ],
  equipment: [
    { id: 'FAS-1', nama: 'Kipas Angin Gantung', kategori: 'Utilitas', totalStok: 10 },
    { id: 'FAS-2', nama: 'Sound System Portable', kategori: 'Elektronik', totalStok: 3 },
  ],
};

function booking(overrides: Partial<SimpelBooking> = {}): SimpelBooking {
  return normalizeSimpelBooking('PJM-1', {
    pemohon: 'A. Khaerudin, S. Ag.',
    gedung: 'Gedung Kuliah Kampus Utama',
    ruangan: 'Theater Room',
    waktu: '2026-09-28',
    jam: '08:00 - 10:00',
    kegiatan: 'Pelatihan Puskom',
    status: 'disetujui',
    fasilitasTambahan: ['1x Kipas Angin Gantung'],
    ...overrides,
  });
}

const rawBuilding = (): RawBuilding => ({
  id: 'GDG-03',
  nama: 'Gedung Kuliah Kampus Utama',
  ruanganList: [
    { nama: 'Aula Kecil', status: 'Tersedia', images: ['data:image/png;base64,AAA'] },
    { nama: 'Theater Room', status: 'Tersedia', images: ['data:image/png;base64,BBB'], fasilitasBawaan: ['AC Split (4 unit)'] },
  ],
  inventarisList: [
    { nama: 'Kursi', jumlah: 50, kondisi: 'Baik' },
    { nama: 'Kursi Lipat', jumlah: 40, kondisi: 'Baik', assetCode: 'AST-1' },
  ],
});

const stock = (): EquipmentStock[] => [
  { id: 'FAS-1', nama: 'Kipas Angin Gantung', totalStok: 10, terpinjam: 4, penanggungJawab: 'Pak Budi', lokasiPenyimpanan: 'Gudang A' },
  { id: 'FAS-2', nama: 'Sound System Portable', totalStok: 3, terpinjam: 1, penanggungJawab: '', lokasiPenyimpanan: '' },
];

function allGood(checklist = buildInspectionChecklist(booking(), catalog)): CheckInSubmission {
  return {
    bookingId: 'PJM-1',
    permanent: checklist.permanent.map((item) => ({ key: item.key, status: 'baik' })),
    mobile: checklist.mobile.map((item) => ({ key: item.key, status: 'lengkap' })),
    roomCondition: 'Bersih',
    roomDamageTypes: [],
    notes: '',
  };
}

function resolved(submission: CheckInSubmission, target = booking()): ResolvedCheckIn {
  const result = validateCheckInSubmission(submission, buildInspectionChecklist(target, catalog));
  assert.ok(result.ok, result.ok ? '' : result.error);
  return result.value;
}

let idCounter = 0;
const plan = (inspection: ResolvedCheckIn, target = booking(), building: RawBuilding | null = rawBuilding()) =>
  planCheckIn({
    booking: target,
    inspection,
    building,
    equipment: stock(),
    actor: { uid: 'u1', name: 'Siti Kebersihan' },
    now: new Date('2026-09-28T04:00:00Z'),
    newId: () => `id${++idCounter}`,
  });

test('Teknisi, Kebersihan and Super Admin may inspect; other roles may not', () => {
  assert.equal(canInspectVenues({ role: 'super_admin' }), true);
  assert.equal(canInspectVenues({ role: 'honorer', permittedCategories: ['TEKNISI'] }), true);
  assert.equal(canInspectVenues({ role: 'honorer', permittedCategories: [' kebersihan '] }), true);
  assert.equal(canInspectVenues({ role: 'honorer', permittedCategories: ['PEKARYA'] }), false);
  assert.equal(canInspectVenues({ role: 'satker_head', permittedCategories: ['TEKNISI'] }), false);
  assert.equal(canInspectVenues({ role: 'loyalis' }), false);
  assert.equal(canInspectVenues(null), false);
});

test('the route guard lets only Teknisi/Kebersihan honorer open the page', () => {
  assert.equal(getEmployeeRouteRedirect({ role: 'honorer', permittedCategories: ['TEKNISI'] }, VENUE_INSPECTION_PATH), null);
  assert.equal(
    getEmployeeRouteRedirect({ role: 'honorer', permittedCategories: ['SOPIR'] }, VENUE_INSPECTION_PATH),
    '/employee/activities/sopir',
  );
});

test('parsePermanentFacility reads SIMPEL quantity styles', () => {
  assert.deepEqual(parsePermanentFacility('AC Split (4 unit)'), { name: 'AC Split', totalQty: 4 });
  assert.deepEqual(parsePermanentFacility('Kursi ( 12 )'), { name: 'Kursi', totalQty: 12 });
  assert.deepEqual(parsePermanentFacility('2x Speaker'), { name: 'Speaker', totalQty: 2 });
  assert.deepEqual(parsePermanentFacility('3 unit Mic'), { name: 'Mic', totalQty: 3 });
  assert.deepEqual(parsePermanentFacility('Komputer'), { name: 'Komputer', totalQty: 1 });
  assert.deepEqual(parsePermanentFacility('  '), { name: '', totalQty: 1 });
});

test('facilityCategory uses the catalog category first, then the name', () => {
  const building = catalog.buildings[0];
  assert.equal(facilityCategory('Kipas Angin Gantung', building, catalog.equipment), 'Utilitas');
  assert.equal(facilityCategory('Kursi Lipat', building, catalog.equipment), 'Mebel');
  assert.equal(facilityCategory('AC Split', building, catalog.equipment), 'Elektronik');
  assert.equal(facilityCategory('Remote Proyektor', building, catalog.equipment), 'Elektronik');
  assert.equal(facilityCategory('Backdrop', building, catalog.equipment), 'Utilitas');
  assert.equal(facilityCategory('Panggung Rakitan', building, catalog.equipment), 'Panggung');
});

test('the checklist has the room fixtures and the handed-over equipment, not fixtures twice', () => {
  const checklist = buildInspectionChecklist(
    booking({
      fasilitasTambahan: ['1x Kipas Angin Gantung'],
      fasilitasDiserahkan: ['2x Kursi Lipat', 'Komputer (Bawaan Ruangan)', '1x AC Split', '1x Kipas Angin Gantung'],
    }),
    catalog,
  );
  assert.deepEqual(
    checklist.permanent.map((item) => [item.key, item.name, item.totalQty, item.category]),
    [
      ['p0', 'AC Split', 4, 'Elektronik'],
      ['p1', 'Komputer', 1, 'Elektronik'],
      ['p2', 'Kursi Audien', 151, 'Mebel'],
      ['p3', 'Remote Proyektor', 1, 'Elektronik'],
    ],
  );
  assert.deepEqual(
    checklist.mobile.map((item) => [item.key, item.name, item.borrowedQty]),
    [
      ['m0', 'Kursi Lipat', 2],
      ['m1', 'Kipas Angin Gantung', 1],
    ],
  );

  const beforeHandover = buildInspectionChecklist(booking(), catalog);
  assert.deepEqual(beforeHandover.mobile.map((item) => item.name), ['Kipas Angin Gantung']);
});

test('awaitsReturnCheck follows SIMPEL: approved, or finished with equipment still out', () => {
  assert.equal(awaitsReturnCheck(booking()), true);
  assert.equal(awaitsReturnCheck(booking({ checkInSelesai: true })), false);
  assert.equal(awaitsReturnCheck(booking({ status: 'selesai' })), true);
  assert.equal(awaitsReturnCheck(booking({ status: 'selesai', fasilitasTambahan: [] })), false);
  assert.equal(awaitsReturnCheck(booking({ status: 'ditolak' })), false);
  assert.equal(awaitsReturnCheck(booking({ status: 'menunggu_biro_umum' })), false);
});

test('a booking ends at its last day and hour on the campus clock', () => {
  const b = booking();
  assert.equal(isBookingEnded(b, { date: '2026-09-28', minutes: 9 * 60 + 59 }), false);
  assert.equal(isBookingEnded(b, { date: '2026-09-28', minutes: 10 * 60 }), true);
  assert.equal(isBookingEnded(b, { date: '2026-09-29', minutes: 0 }), true);
  const group = booking({ sakuGroupDates: ['2026-09-28', '2026-09-29'] });
  assert.equal(isBookingEnded(group, { date: '2026-09-28', minutes: 23 * 60 }), false);
  assert.equal(isBookingEnded(booking({ jam: 'pagi' }), { date: '2026-09-28', minutes: 23 * 60 + 59 }), false);
});

test('returnStage mirrors SIMPEL', () => {
  const early = { date: '2026-09-28', minutes: 8 * 60 };
  assert.equal(returnStage(booking(), early), 'belum_diserahkan');
  assert.equal(returnStage(booking({ serahTerimaSelesai: true }), early), 'sudah_diserahkan');
  assert.equal(returnStage(booking({ serahTerimaSelesai: true, peminjamDiterima: true }), early), 'sedang_dipakai');
  assert.equal(returnStage(booking({ peminjamSiapKembali: true }), early), 'siap_dikembalikan');
  assert.equal(returnStage(booking(), { date: '2026-09-28', minutes: 11 * 60 }), 'siap_dikembalikan');
});

test('formatInspectionDate is short and Indonesian', () => {
  assert.equal(formatInspectionDate('2026-09-28'), '28 Sep 2026');
  assert.equal(formatInspectionDate('bukan tanggal'), 'bukan tanggal');
});

test('every item must be checked, and the checklist must not have changed', () => {
  const checklist = buildInspectionChecklist(booking(), catalog);
  const good = allGood(checklist);
  assert.equal(validateCheckInSubmission(good, checklist).ok, true);

  const unchecked = { ...good, permanent: good.permanent.map((v, i) => (i === 0 ? { ...v, status: null } : v)) };
  const uncheckedResult = validateCheckInSubmission(unchecked, checklist);
  assert.equal(uncheckedResult.ok, false);
  assert.match(uncheckedResult.ok ? '' : uncheckedResult.error, /AC Split belum diperiksa/);

  const missing = { ...good, mobile: [] };
  const missingResult = validateCheckInSubmission(missing, checklist);
  assert.deepEqual(missingResult.ok ? null : missingResult.stale, true);

  const duplicated = { ...good, permanent: [...good.permanent.slice(0, 3), good.permanent[0]] };
  assert.equal(validateCheckInSubmission(duplicated, checklist).ok, false);

  const noRoom = { ...good, roomCondition: null };
  assert.equal(validateCheckInSubmission(noRoom, checklist).ok, false);
});

test('quantities and damage choices are checked, not trusted', () => {
  const checklist = buildInspectionChecklist(booking(), catalog);
  const withDamage = (verdict: Partial<CheckInSubmission['permanent'][number]>) => ({
    ...allGood(checklist),
    permanent: allGood(checklist).permanent.map((v, i) => (i === 0 ? { ...v, status: 'rusak' as const, ...verdict } : v)),
  });
  assert.equal(validateCheckInSubmission(withDamage({ qtyRusak: 5 }), checklist).ok, false);
  assert.equal(validateCheckInSubmission(withDamage({ qtyRusak: 0 }), checklist).ok, false);
  assert.equal(validateCheckInSubmission(withDamage({ qtyRusak: 2, damageTypes: ['Kaki Patah / Bengkok'] }), checklist).ok, false);
  const ok = validateCheckInSubmission(
    withDamage({ qtyRusak: 2, condition: 'Rusak Berat', damageTypes: ['AC Mati / Bocor', 'AC Mati / Bocor'] }),
    checklist,
  );
  assert.ok(ok.ok);
  assert.deepEqual(ok.value.permanent[0], {
    ...checklist.permanent[0],
    status: 'rusak',
    qtyRusak: 2,
    condition: 'Rusak Berat',
    damageTypes: ['AC Mati / Bocor'],
  });

  // A single fixture is always one unit, whatever the browser sent.
  const single = { ...allGood(checklist), permanent: allGood(checklist).permanent.map((v, i) => (i === 1 ? { ...v, status: 'rusak' as const, qtyRusak: 9 } : v)) };
  const singleResult = validateCheckInSubmission(single, checklist);
  assert.ok(singleResult.ok);
  assert.equal(singleResult.value.permanent[1].qtyRusak, 1);

  const mobileSelisih = { ...allGood(checklist), mobile: [{ key: 'm0', status: 'selisih' as const, returnedQtyBaik: 2 }] };
  assert.equal(validateCheckInSubmission(mobileSelisih, checklist).ok, false);
});

test('parseCheckInSubmission turns junk into values validation refuses', () => {
  const parsed = parseCheckInSubmission({
    bookingId: ' PJM-1 ',
    permanent: [{ key: 'p0', status: 'hilang', qtyRusak: '3' }],
    mobile: 'x',
    roomCondition: 'Kotor',
    roomDamageTypes: ['Lantai Kotor', 5],
    notes: '  catatan  ',
  });
  assert.deepEqual(parsed, {
    bookingId: 'PJM-1',
    permanent: [{ key: 'p0', status: null, qtyRusak: undefined, condition: undefined, damageTypes: [] }],
    mobile: [],
    roomCondition: null,
    roomDamageTypes: ['Lantai Kotor'],
    notes: 'catatan',
  });
});

test('a clean return closes the booking and releases campus stock', () => {
  const result = plan(resolved(allGood()));
  assert.deepEqual(result.bookingPatch, {
    status: 'selesai',
    checkInSelesai: true,
    checkInAt: '2026-09-28T04:00:00.000Z',
    checkInOleh: 'Siti Kebersihan',
    checkInOlehUid: 'u1',
    checkInSource: 'saku',
  });
  assert.deepEqual(result.equipmentPatches, [{ id: 'FAS-1', patch: { terpinjam: 3, totalStok: 10, tersedia: 7 } }]);
  assert.equal(result.buildingPatch, null);
  assert.deepEqual(result.logs, []);
  assert.deepEqual(result.damageSummaries, []);
  assert.equal(result.notifications.length, 1);
  assert.equal(result.notifications[0].to, 'akhaerudinsag@unipdu.ac.id');
  assert.match(result.notifications[0].subject, /Pengembalian Sukses & Lengkap: PJM PJM-1/);
});

test('damage is logged and heavy damage leaves stock, as in SIMPEL', () => {
  const target = booking({ fasilitasDiserahkan: ['2x Kursi Lipat', '3x Kipas Angin Gantung', '1x Terpal Biru'] });
  const checklist = buildInspectionChecklist(target, catalog);
  const submission: CheckInSubmission = {
    ...allGood(checklist),
    permanent: allGood(checklist).permanent.map((v) =>
      v.key === 'p0' ? { ...v, status: 'rusak', qtyRusak: 1, damageTypes: ['Remote Hilang'] } : v,
    ),
    mobile: [
      { key: 'm0', status: 'selisih', returnedQtyBaik: 1, condition: 'Rusak Berat', damageTypes: ['Kaki Patah / Bengkok'] },
      { key: 'm1', status: 'selisih', returnedQtyBaik: 1, condition: 'Rusak Berat' },
      { key: 'm2', status: 'selisih', returnedQtyBaik: 0 },
    ],
    roomCondition: 'Maintenance',
    roomDamageTypes: ['Lantai Kotor'],
    notes: 'Setelah acara',
  };
  const result = plan(resolved(submission, target), target);

  assert.deepEqual(
    result.logs.map((log) => [log.fasilitasId, log.namaBarang, log.jumlah, log.kondisi, log.keterangan, log.sakuTarget?.kind]),
    [
      ['FIX-THEATER-ROOM-AC-SPLIT', 'Fasilitas Ruangan: AC Split (Theater Room)', 1, 'Rusak Ringan', '[Detail: Remote Hilang] Setelah acara', 'fixture'],
      ['GDG-GEDUNG-KULIAH-KAMPUS-UTAMA-KURSI-LIPAT', 'Gedung Kuliah Kampus Utama - Kursi Lipat', 1, 'Rusak Berat', '[Detail: Kaki Patah / Bengkok] Setelah acara', 'building-item'],
      ['FAS-1', 'Kipas Angin Gantung', 2, 'Rusak Berat', 'Setelah acara', 'equipment'],
      ['LAIN-TERPAL-BIRU', 'Terpal Biru', 1, 'Rusak Ringan', 'Setelah acara', 'other'],
      ['ROOM-THEATER-ROOM', 'Ruangan: Gedung Kuliah Kampus Utama - Theater Room', 1, 'Rusak Ringan', '[Detail: Lantai Kotor] Setelah acara', 'room'],
    ],
  );
  for (const log of result.logs) {
    assert.equal(log.status, 'Dalam Perbaikan');
    assert.equal(log.bookingId, 'PJM-1');
    assert.equal(log.tanggalLapor, '2026-09-28');
    assert.equal(log.source, 'saku');
  }
  assert.equal(result.logs[2].penanggungJawab, 'Pak Budi');
  assert.equal(new Set(result.logs.map((log) => log.id)).size, result.logs.length);

  // Campus stock: 3 back from loan, 2 written off.
  assert.deepEqual(result.equipmentPatches, [{ id: 'FAS-1', patch: { terpinjam: 1, totalStok: 8, tersedia: 7 } }]);

  // Building: "Kursi Lipat" (not the "Kursi" that comes first) loses 1; the room closes; other fields survive.
  const patch = result.buildingPatch!;
  assert.equal(patch.id, 'GDG-03');
  assert.deepEqual(patch.patch.inventarisList, [
    { nama: 'Kursi', jumlah: 50, kondisi: 'Baik' },
    { nama: 'Kursi Lipat', jumlah: 39, kondisi: 'Baik', assetCode: 'AST-1' },
  ]);
  assert.deepEqual(patch.patch.ruanganList, [
    { nama: 'Aula Kecil', status: 'Tersedia', images: ['data:image/png;base64,AAA'] },
    { nama: 'Theater Room', status: 'Maintenance', images: ['data:image/png;base64,BBB'], fasilitasBawaan: ['AC Split (4 unit)'] },
  ]);

  assert.equal(result.damageSummaries.length, 5);
  assert.equal(result.damageSummaries[4], 'Ruangan Theater Room dinonaktifkan (Status: Maintenance)');
  const borrower = result.notifications[result.notifications.length - 1];
  assert.match(borrower.subject, /Selesai dengan Catatan/);
  assert.equal(result.notifications.length, 6);
});

test('a returned item with no damage but a shortfall of zero writes no log', () => {
  const submission = { ...allGood(), mobile: [{ key: 'm0', status: 'selisih' as const, returnedQtyBaik: 1 }] };
  const result = plan(resolved(submission));
  assert.deepEqual(result.logs, []);
  assert.deepEqual(result.equipmentPatches, [{ id: 'FAS-1', patch: { terpinjam: 3, totalStok: 10, tersedia: 7 } }]);
});

test('a room SIMPEL cannot find is still logged, but nothing is closed', () => {
  const submission = { ...allGood(), roomCondition: 'Maintenance' as const };
  const result = plan(resolved(submission), booking(), null);
  assert.equal(result.buildingPatch, null);
  assert.equal(result.logs[0].sakuTarget?.kind, 'room');
  assert.equal(result.damageSummaries[0], 'Ruangan Theater Room butuh pembersihan / perawatan');
});

const log = (overrides: Record<string, unknown>) =>
  normalizeMaintenanceLog('MNT-1', {
    fasilitasId: 'FAS-1',
    namaBarang: 'Kipas Angin Gantung',
    jumlah: 2,
    kondisi: 'Rusak Berat',
    keterangan: 'Patah',
    status: 'Dalam Perbaikan',
    tanggalLapor: '2026-09-28',
    penanggungJawab: 'Pak Budi',
    ...overrides,
  });

const resolve = (
  target: ReturnType<typeof log>,
  options: { equipment?: EquipmentStock | null; building?: RawBuilding | null; otherOpenRoomLogs?: number } = {},
) =>
  planRepairResolution({
    log: target,
    equipment: options.equipment === undefined ? stock()[0] : options.equipment,
    building: options.building ?? null,
    otherOpenRoomLogs: options.otherOpenRoomLogs ?? 0,
    actor: { uid: 'u2', name: 'Andi Teknisi' },
    now: new Date('2026-09-29T02:00:00Z'),
  });

test('closing a campus-item repair returns heavy-damage units to stock (SIMPEL rule)', () => {
  const result = resolve(log({}));
  assert.deepEqual(result.logPatch, {
    status: 'Selesai',
    selesaiAt: '2026-09-29T02:00:00.000Z',
    selesaiOleh: 'Andi Teknisi',
    selesaiOlehUid: 'u2',
  });
  assert.deepEqual(result.equipmentPatch, { id: 'FAS-1', patch: { totalStok: 12, tersedia: 8 } });
  assert.deepEqual(result.restored, ['2 unit Kipas Angin Gantung kembali ke stok']);
  assert.equal(result.notifications[0].to, 'biroumum@unipdu.ac.id');

  const light = resolve(log({ kondisi: 'Rusak Ringan' }));
  assert.deepEqual(light.equipmentPatch, { id: 'FAS-1', patch: { totalStok: 10, tersedia: 6 } });
  assert.deepEqual(light.restored, []);
});

test('a SAKU log puts building stock back; a SIMPEL log for the same item does not', () => {
  const sakuLog = log({
    fasilitasId: 'GDG-GEDUNG-KULIAH-KAMPUS-UTAMA-KURSI-LIPAT',
    source: 'saku',
    sakuTarget: { kind: 'building-item', buildingId: 'GDG-03', itemName: 'Kursi Lipat' },
  });
  const result = resolve(sakuLog, { equipment: null, building: rawBuilding() });
  assert.deepEqual(result.buildingPatch?.patch.inventarisList, [
    { nama: 'Kursi', jumlah: 50, kondisi: 'Baik' },
    { nama: 'Kursi Lipat', jumlah: 42, kondisi: 'Baik', assetCode: 'AST-1' },
  ]);

  const simpelLog = log({ fasilitasId: 'GDG-GEDUNG-KULIAH-KAMPUS-UTAMA-KURSI-LIPAT' });
  assert.equal(resolve(simpelLog, { equipment: null, building: rawBuilding() }).buildingPatch, null);
});

test('a room reopens only when its last open log is closed', () => {
  const building = rawBuilding();
  (building.ruanganList[1] as Record<string, unknown>).status = 'Maintenance';
  const roomLog = log({
    fasilitasId: 'ROOM-THEATER-ROOM',
    namaBarang: 'Ruangan: Gedung Kuliah Kampus Utama - Theater Room',
    jumlah: 1,
    kondisi: 'Rusak Ringan',
    source: 'saku',
    sakuTarget: { kind: 'room', buildingId: 'GDG-03', roomName: 'Theater Room' },
  });

  const reopened = resolve(roomLog, { equipment: null, building });
  assert.deepEqual(reopened.buildingPatch?.patch.ruanganList, [
    { nama: 'Aula Kecil', status: 'Tersedia', images: ['data:image/png;base64,AAA'] },
    { nama: 'Theater Room', status: 'Tersedia', images: ['data:image/png;base64,BBB'], fasilitasBawaan: ['AC Split (4 unit)'] },
  ]);
  assert.deepEqual(reopened.restored, ['Ruangan Theater Room kembali tersedia']);

  assert.equal(resolve(roomLog, { equipment: null, building, otherOpenRoomLogs: 1 }).buildingPatch, null);
});
