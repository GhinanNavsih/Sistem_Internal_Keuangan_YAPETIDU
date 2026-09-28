/**
 * Pemeriksaan Ruang against the Firestore emulator ONLY: the return check and
 * repair transactions on a local stand-in for SIMPEL's database.
 * Never run against SIMPEL: `npm run test:venue-inspection:integration`.
 */
import assert from 'node:assert/strict';

const PROJECT = 'demo-venue-inspection';

async function main() {
  if (
    process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID !== PROJECT ||
    !/^(127\.0\.0\.1|localhost):8188$/.test(process.env.FIRESTORE_EMULATOR_HOST || '')
  ) {
    throw new Error('Refusing to run outside the Firestore emulator.');
  }

  // The functions take the database handle, so the emulator's own project stands in for SIMPEL.
  const { adminDb: db } = await import('../src/lib/firebase-admin');
  const { completeReturnCheck, listRepairLogs, listReturnInspections, resolveRepair } = await import(
    '../src/lib/server/venueInspections'
  );
  const { HttpError } = await import('../src/lib/server/auth');
  type Submission = Parameters<typeof completeReturnCheck>[2];

  const actor = { uid: 'teknisi-1', name: 'Andi Teknisi' };
  const building = {
    id: 'GDG-03',
    nama: 'Gedung Kuliah Kampus Utama',
    singkatan: 'GKB',
    images: ['data:image/png;base64,COVER'],
    ruanganList: [
      { nama: 'Aula Kecil', status: 'Tersedia', fasilitasBawaan: [] },
      {
        nama: 'Theater Room',
        status: 'Tersedia',
        images: ['data:image/png;base64,ROOM'],
        fasilitasBawaan: ['AC Split (4 unit)', 'Komputer'],
      },
    ],
    inventarisList: [{ nama: 'Kursi Lipat', jumlah: 40, kondisi: 'Baik' }],
  };
  await db.doc('simpel_gedung/GDG-03').set(building);
  await db.doc('simpel_fasilitas/FAS-1').set({
    id: 'FAS-1',
    nama: 'Kipas Angin Gantung',
    kategori: 'Utilitas',
    totalStok: 10,
    terpinjam: 4,
    tersedia: 6,
    penanggungJawab: 'Pak Budi',
    lokasiPenyimpanan: 'Gudang A',
  });
  const bookingBase = {
    pemohon: 'A. Khaerudin',
    tipePemohon: 'tu',
    kontak: '0812',
    gedung: 'Gedung Kuliah Kampus Utama',
    ruangan: 'Theater Room',
    waktu: '2026-09-28',
    jam: '08:00 - 10:00',
    kegiatan: 'Pelatihan Puskom',
    status: 'disetujui',
    fasilitasTambahan: ['2x Kursi Lipat', '3x Kipas Angin Gantung'],
    fasilitasDiserahkan: ['2x Kursi Lipat', '3x Kipas Angin Gantung', 'Komputer (Bawaan Ruangan)'],
    serahTerimaSelesai: true,
    suratBase64: 'x'.repeat(200_000),
  };
  await db.doc('simpel_bookings/PJM-1').set({ id: 'PJM-1', ...bookingBase });
  await db.doc('simpel_bookings/PJM-2').set({ id: 'PJM-2', ...bookingBase, fasilitasTambahan: [], fasilitasDiserahkan: [] });
  await db.doc('simpel_bookings/PJM-OLD').set({ id: 'PJM-OLD', ...bookingBase, status: 'selesai', checkInSelesai: true });
  await db.doc('simpel_maintenance/MNT-001').set({
    id: 'MNT-001',
    fasilitasId: 'FAS-1',
    namaBarang: 'Kipas Angin Gantung',
    jumlah: 1,
    kondisi: 'Rusak Berat',
    keterangan: 'Lama',
    status: 'Dalam Perbaikan',
    tanggalLapor: '2026-06-05',
    penanggungJawab: 'Pak Budi',
  });

  // 1. The list shows what waits for a check, with the checklist built from SIMPEL's data.
  const returns = await listReturnInspections(db, new Date('2026-09-28T05:00:00Z'));
  assert.deepEqual(returns.map((entry) => entry.id), ['PJM-1', 'PJM-2']);
  const first = returns[0];
  assert.equal(first.stage, 'siap_dikembalikan');
  assert.deepEqual(first.checklist.permanent.map((item) => [item.key, item.name, item.totalQty]), [
    ['p0', 'AC Split', 4],
    ['p1', 'Komputer', 1],
  ]);
  assert.deepEqual(first.checklist.mobile.map((item) => [item.key, item.name, item.borrowedQty]), [
    ['m0', 'Kursi Lipat', 2],
    ['m1', 'Kipas Angin Gantung', 3],
  ]);

  // 2. A checklist that no longer matches is refused.
  await assert.rejects(
    completeReturnCheck(db, actor, {
      bookingId: 'PJM-1',
      permanent: [{ key: 'p0', status: 'baik' }],
      mobile: [],
      roomCondition: 'Bersih',
      roomDamageTypes: [],
      notes: '',
    }),
    (error: unknown) => error instanceof HttpError && error.status === 409,
  );

  // 3. A check with damage writes everything SIMPEL's page writes.
  const submission: Submission = {
    bookingId: 'PJM-1',
    permanent: [
      { key: 'p0', status: 'rusak', qtyRusak: 1, condition: 'Rusak Ringan', damageTypes: ['Remote Hilang'] },
      { key: 'p1', status: 'baik' },
    ],
    mobile: [
      { key: 'm0', status: 'selisih', returnedQtyBaik: 1, condition: 'Rusak Berat', damageTypes: ['Kaki Patah / Bengkok'] },
      { key: 'm1', status: 'lengkap' },
    ],
    roomCondition: 'Maintenance',
    roomDamageTypes: ['Lantai Kotor'],
    notes: 'Setelah pelatihan',
  };
  const result = await completeReturnCheck(db, actor, submission, new Date('2026-09-28T05:00:00Z'));
  assert.equal(result.damageSummaries.length, 3);
  assert.equal(result.logIds.length, 3);

  const bookingAfter = (await db.doc('simpel_bookings/PJM-1').get()).data()!;
  assert.equal(bookingAfter.status, 'selesai');
  assert.equal(bookingAfter.checkInSelesai, true);
  assert.equal(bookingAfter.checkInOleh, 'Andi Teknisi');
  assert.equal(bookingAfter.checkInCatatan, 'Setelah pelatihan');
  assert.equal(bookingAfter.suratBase64.length, 200_000, 'other booking fields survive');

  const kipas = (await db.doc('simpel_fasilitas/FAS-1').get()).data()!;
  assert.deepEqual([kipas.totalStok, kipas.terpinjam, kipas.tersedia], [10, 1, 9]);
  assert.equal(kipas.lokasiPenyimpanan, 'Gudang A');

  const gedung = (await db.doc('simpel_gedung/GDG-03').get()).data()!;
  assert.deepEqual(gedung.inventarisList, [{ nama: 'Kursi Lipat', jumlah: 39, kondisi: 'Baik' }]);
  assert.equal(gedung.ruanganList[1].status, 'Maintenance');
  assert.deepEqual(gedung.ruanganList[1].images, ['data:image/png;base64,ROOM'], 'room photos survive');
  assert.equal(gedung.ruanganList[0].status, 'Tersedia');
  assert.deepEqual(gedung.images, ['data:image/png;base64,COVER']);

  const logs = await Promise.all(result.logIds.map((id) => db.doc(`simpel_maintenance/${id}`).get()));
  assert.deepEqual(
    logs.map((snapshot) => [snapshot.data()!.fasilitasId, snapshot.data()!.status, snapshot.data()!.source]),
    [
      ['FIX-THEATER-ROOM-AC-SPLIT', 'Dalam Perbaikan', 'saku'],
      ['GDG-GEDUNG-KULIAH-KAMPUS-UTAMA-KURSI-LIPAT', 'Dalam Perbaikan', 'saku'],
      ['ROOM-THEATER-ROOM', 'Dalam Perbaikan', 'saku'],
    ],
  );
  const emails = await db.collection('simpel_emails').get();
  assert.equal(emails.size, 4, 'three repair notices and the borrower notice');

  // 4. The same room cannot be checked in twice.
  await assert.rejects(
    completeReturnCheck(db, actor, submission),
    (error: unknown) => error instanceof HttpError && error.status === 409,
  );
  assert.deepEqual((await listReturnInspections(db)).map((entry) => entry.id), ['PJM-2']);

  // 5. Two Pekarya finishing the same room at once: exactly one wins.
  const quick: Submission = {
    bookingId: 'PJM-2',
    permanent: [
      { key: 'p0', status: 'baik' },
      { key: 'p1', status: 'baik' },
    ],
    mobile: [],
    roomCondition: 'Bersih',
    roomDamageTypes: [],
    notes: '',
  };
  const race = await Promise.allSettled([
    completeReturnCheck(db, actor, quick),
    completeReturnCheck(db, { uid: 'kebersihan-1', name: 'Siti Kebersihan' }, quick),
  ]);
  assert.deepEqual(race.map((entry) => entry.status).sort(), ['fulfilled', 'rejected']);

  // 6. Closing repairs puts things back.
  const [, buildingLogId, roomLogId] = result.logIds;
  const buildingRepair = await resolveRepair(db, actor, buildingLogId);
  assert.deepEqual(buildingRepair.restored, ['1 unit Kursi Lipat kembali ke inventaris Gedung Kuliah Kampus Utama']);
  const roomRepair = await resolveRepair(db, actor, roomLogId);
  assert.deepEqual(roomRepair.restored, ['Ruangan Theater Room kembali tersedia']);
  const gedungAfterRepairs = (await db.doc('simpel_gedung/GDG-03').get()).data()!;
  assert.deepEqual(gedungAfterRepairs.inventarisList, [{ nama: 'Kursi Lipat', jumlah: 40, kondisi: 'Baik' }]);
  assert.equal(gedungAfterRepairs.ruanganList[1].status, 'Tersedia');

  // SIMPEL's own log, closed the SIMPEL way.
  await resolveRepair(db, actor, 'MNT-001');
  const kipasAfterRepair = (await db.doc('simpel_fasilitas/FAS-1').get()).data()!;
  assert.deepEqual([kipasAfterRepair.totalStok, kipasAfterRepair.tersedia], [11, 10]);
  await assert.rejects(
    resolveRepair(db, actor, 'MNT-001'),
    (error: unknown) => error instanceof HttpError && error.status === 409,
  );

  const repairs = await listRepairLogs(db);
  assert.equal(repairs.filter((log) => log.status === 'Dalam Perbaikan').length, 1);
  assert.equal(repairs[0].status, 'Dalam Perbaikan', 'open repairs are listed first');

  console.log('Venue inspection emulator test passed.');
}

main().then(
  () => process.exit(0),
  (error) => {
    console.error(error);
    process.exit(1);
  },
);
