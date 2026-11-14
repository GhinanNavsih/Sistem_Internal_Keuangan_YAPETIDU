/** Exercises surat creation through the real route and isolated Firebase emulators. */
import assert from 'node:assert/strict';
import { NextRequest } from 'next/server';
import { draftFromSurat, getDefaultDraft } from '../src/lib/surat-menyurat/templates';

const PROJECT = 'demo-satker-surat';

async function main() {
  if (process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID !== PROJECT ||
    !/^(127\.0\.0\.1|localhost):8188$/.test(process.env.FIRESTORE_EMULATOR_HOST || '') ||
    !/^(127\.0\.0\.1|localhost):9198$/.test(process.env.FIREBASE_AUTH_EMULATOR_HOST || '')) {
    throw new Error('Refusing to run outside the surat emulators.');
  }

  const { adminDb } = await import('../src/lib/firebase-admin');
  const { POST, PUT, GET } = await import('../src/app/api/satker-surat/route');
  const signup = await fetch(`http://${process.env.FIREBASE_AUTH_EMULATOR_HOST}/identitytoolkit.googleapis.com/v1/accounts:signUp?key=demo`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email: 'surat@example.test', password: 'password123', returnSecureToken: true }),
  });
  const identity = await signup.json();
  assert.ok(identity.idToken);
  await adminDb.doc(`users/${identity.localId}`).set({ role: 'super_admin', displayName: 'Test Admin' });
  const headers = { authorization: `Bearer ${identity.idToken}`, 'content-type': 'application/json' };
  const common = { institutionScope: 'SATKER', nomorUrut: 1, kodeSurat: 'SP', kodeArsip: 'S.REKTOR,001', nomorSurat: '001/A/AU/11/2026', tanggalSurat: '2026-11-10', perihal: 'Undangan Ujian' };
  const cases = [
    { label: 'keluar tanpa rentang', body: { ...common, type: 'keluar', tujuan: 'Pembina Tilawah' }, absent: ['nomorUrutEnd', 'usiaArsip', 'templateType', 'contentBody', 'lampiranKeterangan'] },
    { label: 'keluar dengan rentang', body: { ...common, type: 'keluar', tujuan: 'Pembina Tilawah', nomorUrutEnd: 5 }, absent: ['usiaArsip', 'templateType', 'contentBody', 'lampiranKeterangan'] },
    { label: 'masuk tanpa usia arsip', body: { ...common, type: 'masuk', tanggalDiterima: '2026-11-10', pengirim: 'Rektorat' }, absent: ['usiaArsip', 'status'] },
    { label: 'keluar tanpa metadata opsional', body: { type: 'keluar', nomorSurat: '002', tanggalSurat: '2026-11-10', tujuan: 'Tujuan', perihal: 'Perihal' }, absent: ['institutionScope', 'nomorUrut', 'kodeSurat', 'kodeArsip', 'usiaArsip'] },
    { label: 'keluar dengan metadata', body: { ...common, type: 'keluar', tujuan: 'Tujuan', nomorUrutEnd: 5, usiaArsip: '1 tahun', templateType: 'tugas', contentBody: 'Isi', lampiranKeterangan: 'Satu berkas' }, absent: [] },
  ];
  const failures: string[] = [];
  for (const item of cases) {
    const response = await POST(new NextRequest('http://localhost/api/satker-surat', { method: 'POST', headers, body: JSON.stringify(item.body) }));
    const json = await response.json();
    if (response.status !== 200) {
      failures.push(`${item.label}: ${response.status} ${json.error}`);
      continue;
    }
    const stored = (await adminDb.doc(`SatkerLetters/${json.data.id}`).get()).data();
    assert.ok(stored, item.label);
    assert.equal(Object.hasOwn(stored, 'status'), false, `${item.label}: status`);
    assert.equal(Object.hasOwn(json.data, 'status'), false, `${item.label}: response status`);
    for (const key of item.absent) assert.equal(Object.hasOwn(stored, key), false, `${item.label}: ${key}`);
    for (const key of ['nomorUrutEnd', 'usiaArsip', 'templateType', 'contentBody', 'lampiranKeterangan'] as const) {
      if (key in item.body) assert.equal(stored[key], item.body[key as keyof typeof item.body], `${item.label}: ${key}`);
    }
  }
  assert.deepEqual(failures, [], failures.join('\n'));
  const list = await GET(new NextRequest('http://localhost/api/satker-surat', { headers }));
  assert.equal(list.status, 200);
  const data = await list.json();
  assert.equal(data.suratKeluar.length, 4);
  assert.equal(data.suratMasuk.length, 1);
  assert.equal(Object.hasOwn(data.suratMasuk[0], 'status'), false);
  assert.equal(data.stats.totalMasuk, 1);

  // Older stored letters remain editable and visible without their retired fields.
  const incomingRef = adminDb.doc(`SatkerLetters/${data.suratMasuk[0].id}`);
  await incomingRef.update({ status: 'menunggu_disposisi', kategori: 'Instruksi / Disposisi Rektorat', disposisi: { catatan: 'Catatan lama' } });
  const legacyList = await (await GET(new NextRequest('http://localhost/api/satker-surat', { headers }))).json();
  assert.equal(Object.hasOwn(legacyList.suratMasuk[0], 'status'), false);
  assert.equal(legacyList.suratMasuk[0].kategori, 'Instruksi Rektorat');
  assert.equal(Object.hasOwn(legacyList.suratMasuk[0], 'disposisi'), false);
  assert.equal(legacyList.stats.totalMasuk, 1);
  let legacyUpdate = await PUT(new NextRequest('http://localhost/api/satker-surat', { method: 'PUT', headers,
    body: JSON.stringify({ id: data.suratMasuk[0].id, perihal: 'Perihal baru', status: 'baru' }) }));
  assert.equal(legacyUpdate.status, 200);
  assert.equal(Object.hasOwn((await legacyUpdate.json()).data, 'disposisi'), false);
  assert.deepEqual((await incomingRef.get()).data()?.disposisi, { catatan: 'Catatan lama' });
  assert.equal((await incomingRef.get()).data()?.status, 'menunggu_disposisi');
  legacyUpdate = await PUT(new NextRequest('http://localhost/api/satker-surat', { method: 'PUT', headers,
    body: JSON.stringify({ id: data.suratMasuk[0].id, disposisi: { catatan: 'Baru' } }) }));
  assert.equal(legacyUpdate.status, 400);
  assert.deepEqual((await incomingRef.get()).data()?.disposisi, { catatan: 'Catatan lama' });

  // A recorded outgoing letter gains a reusable manuscript without a new agenda entry.
  const existing = data.suratKeluar.find((item: { nomorUrutEnd?: number }) => item.nomorUrutEnd === 5);
  assert.ok(existing);
  const originalCount = (await adminDb.collection('SatkerLetters').get()).size;
  const attachment = { id: 'a', name: 'scan.pdf', url: 'https://example.test/scan.pdf', contentType: 'application/pdf', size: 100, uploadedAt: '2026-11-10' };
  await adminDb.doc(`SatkerLetters/${existing.id}`).update({ attachments: [attachment], status: 'terkirim', ringkasan: 'Catatan agenda' });
  const draft = { ...draftFromSurat(existing, 'BAK'), tujuanNama: 'Pembina Tilawah', tujuanJabatanInstansi: 'Unit A',
    tujuanAlamatKota: 'di Jombang', isiParagraf1: 'Undangan rapat', isiParagraf2: 'Hari: Selasa\nWaktu: 09.00',
    penandatanganNipy: '123', lampiranKeterangan: 'Satu berkas' };
  const update = (body: unknown) => PUT(new NextRequest('http://localhost/api/satker-surat', { method: 'PUT', headers, body: JSON.stringify(body) }));
  let response = await update({ id: existing.id, letterDraft: draft, tujuan: 'Pembina Tilawah - Unit A', contentBody: 'Undangan rapat\n\nHari: Selasa\nWaktu: 09.00', lampiranKeterangan: 'Satu berkas' });
  assert.equal(response.status, 200, JSON.stringify(await response.clone().json()));
  let stored = (await adminDb.doc(`SatkerLetters/${existing.id}`).get()).data()!;
  assert.deepEqual(stored.letterDraft, draft);
  assert.equal(stored.status, 'terkirim');
  assert.equal(stored.ringkasan, 'Catatan agenda');
  assert.equal(stored.nomorUrutEnd, 5);
  assert.deepEqual(stored.attachments, [attachment]);
  const reopened = draftFromSurat({ ...stored, id: existing.id } as typeof existing, 'BAK');
  assert.equal(reopened.isiParagraf2, 'Hari: Selasa\nWaktu: 09.00');
  assert.equal(reopened.tujuanJabatanInstansi, 'Unit A');
  assert.equal(reopened.penandatanganNipy, '123');
  response = await update({ id: existing.id, letterDraft: { ...draft, isiParagraf2: 'Waktu: 10.00' }, contentBody: 'Waktu: 10.00' });
  assert.equal(response.status, 200);
  assert.equal((await adminDb.collection('SatkerLetters').get()).size, originalCount);
  stored = (await adminDb.doc(`SatkerLetters/${existing.id}`).get()).data()!;
  assert.equal(stored.letterDraft.isiParagraf2, 'Waktu: 10.00');
  const refreshed = await GET(new NextRequest('http://localhost/api/satker-surat', { headers }));
  const reopenedFromApi = (await refreshed.json()).suratKeluar.find((item: { id: string }) => item.id === existing.id);
  assert.equal(Object.hasOwn(reopenedFromApi, 'status'), false);
  assert.equal(draftFromSurat(reopenedFromApi, 'BAK').isiParagraf2, 'Waktu: 10.00');
  response = await update({ id: existing.id, letterDraft: { ...draft, isiParagraf1: 'x'.repeat(10001) } });
  assert.equal(response.status, 400);
  assert.equal((await adminDb.doc(`SatkerLetters/${existing.id}`).get()).data()?.letterDraft.isiParagraf2, 'Waktu: 10.00');
  response = await update({ id: data.suratMasuk[0].id, letterDraft: draft });
  assert.equal(response.status, 400, 'incoming letters cannot acquire a manuscript');
  const otherSignup = await fetch(`http://${process.env.FIREBASE_AUTH_EMULATOR_HOST}/identitytoolkit.googleapis.com/v1/accounts:signUp?key=demo`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email: 'other@example.test', password: 'password123', returnSecureToken: true }),
  });
  const other = await otherSignup.json();
  await adminDb.doc(`users/${other.localId}`).set({ role: 'satker_head_loyalis', displayName: 'Other', satkerName: 'Other Satker' });
  response = await PUT(new NextRequest('http://localhost/api/satker-surat', { method: 'PUT',
    headers: { ...headers, authorization: `Bearer ${other.idToken}` }, body: JSON.stringify({ id: existing.id, letterDraft: draft }) }));
  assert.equal(response.status, 403, 'a different SatKer cannot change the manuscript');

  // The standalone composer also stores its complete draft for later reopening.
  const newDraft = { ...getDefaultDraft('BAK'), nomorSurat: '003', tanggalSurat: '2026-11-10', perihal: 'Rapat' };
  response = await POST(new NextRequest('http://localhost/api/satker-surat', { method: 'POST', headers,
    body: JSON.stringify({ type: 'keluar', nomorSurat: '003', tanggalSurat: '2026-11-10', tujuan: 'Penerima', perihal: 'Rapat', letterDraft: newDraft }) }));
  assert.equal(response.status, 200, JSON.stringify(await response.clone().json()));
  const created = (await response.json()).data;
  assert.deepEqual((await adminDb.doc(`SatkerLetters/${created.id}`).get()).data()?.letterDraft, newDraft);
  console.log('Satker surat integration passed: creation, manuscript save/reopen/update, metadata preservation, validation, and listing.');
}

main().catch(error => { console.error(error); process.exitCode = 1; });
