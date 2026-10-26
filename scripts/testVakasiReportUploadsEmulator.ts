/** Signed-report uploads against Auth, Firestore and Storage emulators only. */
import assert from 'node:assert/strict';
import { NextRequest } from 'next/server';
import { MAX_UPLOAD_BYTES } from '../src/lib/uploadFileTypes';

const PROJECT = 'demo-vakasi-reports';
const PERIOD = '2026-10';
const pad = (bytes: Buffer) => Buffer.concat([bytes, Buffer.alloc(Math.max(0, 32 - bytes.length))]);
const ftyp = (brand: string) => pad(Buffer.concat([Buffer.from([0, 0, 0, 24]), Buffer.from(`ftyp${brand}`)]));

async function signUp(email: string) {
  const response = await fetch(`http://${process.env.FIREBASE_AUTH_EMULATOR_HOST}/identitytoolkit.googleapis.com/v1/accounts:signUp?key=demo`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email, password: 'password123', returnSecureToken: true }),
  });
  const identity = await response.json();
  assert.ok(identity.idToken);
  return { uid: identity.localId as string, authorization: `Bearer ${identity.idToken}` };
}

async function main() {
  if (process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID !== PROJECT ||
    !/^(127\.0\.0\.1|localhost):8188$/.test(process.env.FIRESTORE_EMULATOR_HOST || '') ||
    !/^(127\.0\.0\.1|localhost):9198$/.test(process.env.FIREBASE_AUTH_EMULATOR_HOST || '') ||
    !/^(127\.0\.0\.1|localhost):9298$/.test(process.env.FIREBASE_STORAGE_EMULATOR_HOST || '')) {
    throw new Error(`Refusing to run outside the ${PROJECT} emulators.`);
  }
  const { adminDb, adminStorage } = await import('../src/lib/firebase-admin');
  const { POST } = await import('../src/app/api/uploads/vakasi-reports/route');
  const head = await signUp('head@example.test');
  const employee = await signUp('employee@example.test');
  const finance = await signUp('finance@example.test');
  await adminDb.doc(`users/${head.uid}`).set({ role: 'satker_head_loyalis' });
  await adminDb.doc(`users/${employee.uid}`).set({ role: 'loyalis' });
  await adminDb.doc(`users/${finance.uid}`).set({ role: 'finance_verifier' });
  await adminDb.doc(`PayrollPeriods/${PERIOD}`).set({ attendanceStatus: 'open' });

  const upload = (file: File | null, authorization = head.authorization, period = PERIOD) => {
    const form = new FormData();
    form.set('period', period);
    form.set('eventSeg', 'report-fixture');
    if (file) form.set('file', file);
    return POST(new NextRequest('http://localhost/api/uploads/vakasi-reports', {
      method: 'POST', headers: authorization ? { authorization } : {}, body: form,
    }));
  };
  const expectStatus = async (response: Response, expected: number) => {
    const body = await response.json();
    assert.equal(response.status, expected, body.error);
    return body;
  };
  const jpg = pad(Buffer.from([0xff, 0xd8, 0xff, 0xe0]));
  const file = (bytes: Uint8Array = jpg, name = 'report.jpg', type = 'image/jpeg') => new File([new Uint8Array(bytes)], name, { type });
  await expectStatus(await upload(file(), ''), 401);
  await expectStatus(await upload(file(), employee.authorization), 403);
  await expectStatus(await upload(null), 400);
  await expectStatus(await upload(file(), head.authorization, 'invalid'), 400);
  await expectStatus(await upload(file(Buffer.alloc(0))), 400);
  await expectStatus(await upload(file(Buffer.from('MZ executable renamed as PDF'), 'report.pdf', 'application/pdf')), 400);
  await expectStatus(await upload(file(Buffer.alloc(MAX_UPLOAD_BYTES + 1))), 400);
  await adminDb.doc(`PayrollPeriods/${PERIOD}`).update({ attendanceStatus: 'closed' });
  await expectStatus(await upload(file()), 409);
  await adminDb.doc(`PayrollPeriods/${PERIOD}`).update({ attendanceStatus: 'open' });
  assert.equal((await adminDb.collection('FinancialAuditLogs').get()).size, 0, 'rejected uploads create no audit evidence');

  const samples: [Buffer, string, string][] = [
    [jpg, 'jpg', 'image/jpeg'],
    [pad(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])), 'png', 'image/png'],
    [pad(Buffer.from('RIFF\0\0\0\0WEBPVP8 ')), 'webp', 'image/webp'],
    [pad(Buffer.from('GIF89a')), 'gif', 'image/gif'],
    [pad(Buffer.from('BM')), 'bmp', 'image/bmp'],
    [ftyp('avif'), 'avif', 'image/avif'],
    [ftyp('heic'), 'heic', 'image/heic'],
    [ftyp('mif1'), 'heif', 'image/heif'],
    [pad(Buffer.from([0x49, 0x49, 0x2a, 0x00])), 'tiff', 'image/tiff'],
    [Buffer.from('%PDF-1.7\npage one\npage two\n%%EOF'), 'pdf', 'application/pdf'],
  ];
  const stored: { path: string; url: string }[] = [];
  for (const [bytes, extension, contentType] of samples) {
    // The declared type and extension are intentionally wrong. Only the bytes
    // may determine acceptance, stored type and canonical Storage extension.
    const body = await expectStatus(await upload(file(bytes, 'misnamed.exe', 'application/octet-stream')), 200);
    const storagePath = decodeURIComponent(new URL(body.url).pathname.split('/o/')[1]);
    assert.ok(storagePath.endsWith(`.${extension}`));
    const object = adminStorage.bucket().file(storagePath);
    const [metadata] = await object.getMetadata();
    assert.equal(metadata.contentType, contentType);
    const [downloaded] = await object.download();
    assert.deepEqual(downloaded, bytes, 'keep the entire file, including every PDF page');
    stored.push({ path: storagePath, url: body.url });
  }
  await expectStatus(await upload(file(ftyp('heic'), 'IMG_001.HEIC', '')), 200);
  await expectStatus(await upload(file(), finance.authorization), 200);
  const maxSizeFile = Buffer.alloc(MAX_UPLOAD_BYTES);
  jpg.copy(maxSizeFile);
  await expectStatus(await upload(file(maxSizeFile)), 200);

  // Repeated uploads retain both immutable objects and independent audit
  // references, even after the event stops pointing at its original evidence.
  await adminDb.doc('VakasiTambahan/report-fixture').set({ period: PERIOD, reportFileUrl: stored[0].url, reportFileName: 'original.jpg' });
  await adminDb.doc('VakasiTambahan/report-fixture').update({ reportFileUrl: stored[1].url, reportFileName: 'replacement.png' });
  await adminDb.doc('VakasiTambahan/report-fixture').update({ reportFileUrl: null, reportFileName: null });
  const audits = await adminDb.collection('FinancialAuditLogs').where('action', '==', 'VAKASI_REPORT_UPLOADED').get();
  assert.equal(audits.size, samples.length + 3);
  for (const object of stored) {
    assert.equal((await adminStorage.bucket().file(object.path).exists())[0], true);
    const audit = audits.docs.find(doc => doc.data().entityId === object.path)?.data();
    assert.equal(audit?.after.url, object.url);
    assert.equal(audit?.actorUid, head.uid);
    assert.equal(audit?.after.fileName, 'misnamed.exe');
    assert.equal(audit?.metadata.period, PERIOD);
  }
  console.log(`PASS signed reports: all ${samples.length} formats, byte validation, 5 MB boundary, roles, closed periods, stored MIME types, intact files and retained audit evidence`);
}

main().catch(error => { console.error(error); process.exitCode = 1; });
