/** Exercises surat creation through the real route and isolated Firebase emulators. */
import assert from 'node:assert/strict';
import { NextRequest } from 'next/server';

const PROJECT = 'demo-satker-surat';

async function main() {
  if (process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID !== PROJECT ||
    !/^(127\.0\.0\.1|localhost):8188$/.test(process.env.FIRESTORE_EMULATOR_HOST || '') ||
    !/^(127\.0\.0\.1|localhost):9198$/.test(process.env.FIREBASE_AUTH_EMULATOR_HOST || '')) {
    throw new Error('Refusing to run outside the surat emulators.');
  }

  const { adminDb } = await import('../src/lib/firebase-admin');
  const { POST, GET } = await import('../src/app/api/satker-surat/route');
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
    { label: 'masuk tanpa usia arsip', body: { ...common, type: 'masuk', tanggalDiterima: '2026-11-10', pengirim: 'Rektorat' }, absent: ['usiaArsip'] },
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
  console.log('Satker surat integration passed: incoming and outgoing writes, optional fields, batch range, and listing.');
}

main().catch(error => { console.error(error); process.exitCode = 1; });
