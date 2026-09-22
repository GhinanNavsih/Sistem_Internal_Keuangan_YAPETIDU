import assert from 'node:assert/strict';
import test from 'node:test';
import {
  pekaryaLeaveDraftStorageKey,
  satpamLeaveDraftStorageKey,
  isPekaryaLeaveDraftEmpty,
  isSatpamLeaveDraftEmpty,
  serializePekaryaLeaveDraft,
  parsePekaryaLeaveDraft,
  serializeSatpamLeaveDraft,
  parseSatpamLeaveDraft,
  savePekaryaLeaveDraft,
  readPekaryaLeaveDraft,
  clearPekaryaLeaveDraft,
  saveSatpamLeaveDraft,
  readSatpamLeaveDraft,
  clearSatpamLeaveDraft,
  type PekaryaLeaveDraftPayload,
  type SatpamLeaveDraftPayload,
} from './leaveDraft';
import { normalizePhotoAuditMetadata } from '../photoEvidence';

test('storage keys are safely scoped to employeeId', () => {
  assert.equal(pekaryaLeaveDraftStorageKey(''), '');
  assert.equal(pekaryaLeaveDraftStorageKey('   '), '');
  assert.equal(satpamLeaveDraftStorageKey(''), '');
  assert.equal(pekaryaLeaveDraftStorageKey('EMP_001'), 'unipdu:leave-draft:pekarya:v1:EMP_001');
  assert.equal(satpamLeaveDraftStorageKey('EMP_002'), 'unipdu:leave-draft:satpam:v1:EMP_002');
});

test('detects empty vs filled Pekarya drafts', () => {
  assert.equal(isPekaryaLeaveDraftEmpty(null), true);
  assert.equal(isPekaryaLeaveDraftEmpty({}), true);
  assert.equal(
    isPekaryaLeaveDraftEmpty({
      reportType: 'izin_resmi',
      scanIn: '08:00',
      scanOut: '14:00',
      reason: '',
      date: '',
      evidence: null,
    }),
    true,
  );

  assert.equal(isPekaryaLeaveDraftEmpty({ reason: 'Sakit gigi' }), false);
  assert.equal(isPekaryaLeaveDraftEmpty({ date: '2026-09-22' }), false);
  assert.equal(isPekaryaLeaveDraftEmpty({ reportType: 'scan' }), false);
  assert.equal(isPekaryaLeaveDraftEmpty({ scanIn: '07:30' }), false);
  assert.equal(isPekaryaLeaveDraftEmpty({ scanOut: '15:00' }), false);
  assert.equal(
    isPekaryaLeaveDraftEmpty({
      evidence: {
        url: 'https://example.com/photo.jpg',
        auditMetadata: normalizePhotoAuditMetadata({}),
      },
    }),
    false,
  );
});

test('detects empty vs filled Satpam drafts', () => {
  assert.equal(isSatpamLeaveDraftEmpty(null), true);
  assert.equal(isSatpamLeaveDraftEmpty({}), true);
  assert.equal(
    isSatpamLeaveDraftEmpty({
      reportType: 'izin_resmi',
      absenceType: 'sakit',
      scanIn: '08:00',
      scanOut: '14:00',
      reason: '',
      dutyDate: '',
      period: '',
    }),
    true,
  );

  assert.equal(isSatpamLeaveDraftEmpty({ reason: 'Perlu ke bank' }), false);
  assert.equal(isSatpamLeaveDraftEmpty({ dutyDate: '2026-09-23' }), false);
  assert.equal(isSatpamLeaveDraftEmpty({ period: '2026-09' }), false);
  assert.equal(isSatpamLeaveDraftEmpty({ reportType: 'scan' }), false);
  assert.equal(isSatpamLeaveDraftEmpty({ absenceType: 'darurat' }), false);
});

test('serializes and parses Pekarya drafts with full fidelity', () => {
  const payload: PekaryaLeaveDraftPayload = {
    date: '2026-09-22',
    reportType: 'scan',
    scanIn: '08:15',
    scanOut: '14:30',
    reason: 'Fingerprint error pada pintu gerbang timur',
    evidence: {
      url: 'https://storage.googleapis.com/proof.jpg',
      auditMetadata: normalizePhotoAuditMetadata({
        latitude: -7.543,
        longitude: 112.234,
        capturedAt: '2026-09-22T08:15:00Z',
      }),
    },
  };

  const serialized = serializePekaryaLeaveDraft(payload);
  const parsed = parsePekaryaLeaveDraft(serialized);

  assert.ok(parsed);
  assert.equal(parsed.date, '2026-09-22');
  assert.equal(parsed.reportType, 'scan');
  assert.equal(parsed.scanIn, '08:15');
  assert.equal(parsed.scanOut, '14:30');
  assert.equal(parsed.reason, 'Fingerprint error pada pintu gerbang timur');
  assert.equal(parsed.evidence?.url, 'https://storage.googleapis.com/proof.jpg');
  assert.equal(parsed.evidence?.auditMetadata?.latitude, -7.543);
});

test('handles malformed and corrupt Pekarya drafts gracefully', () => {
  assert.equal(parsePekaryaLeaveDraft(null), null);
  assert.equal(parsePekaryaLeaveDraft(''), null);
  assert.equal(parsePekaryaLeaveDraft('not json'), null);
  assert.equal(parsePekaryaLeaveDraft('[]'), null);
  assert.equal(parsePekaryaLeaveDraft(JSON.stringify({ version: 999 })), null);
});

test('serializes and parses Satpam drafts with full fidelity', () => {
  const payload: SatpamLeaveDraftPayload = {
    period: '2026-09',
    dutyDate: '2026-09-24',
    reportType: 'izin_resmi',
    absenceType: 'sakit',
    scanIn: '08:00',
    scanOut: '14:00',
    reason: 'Rawat inap di rumah sakit',
  };

  const serialized = serializeSatpamLeaveDraft(payload);
  const parsed = parseSatpamLeaveDraft(serialized);

  assert.ok(parsed);
  assert.equal(parsed.period, '2026-09');
  assert.equal(parsed.dutyDate, '2026-09-24');
  assert.equal(parsed.reportType, 'izin_resmi');
  assert.equal(parsed.absenceType, 'sakit');
  assert.equal(parsed.reason, 'Rawat inap di rumah sakit');
});

test('reads, writes, and clears drafts in localStorage safely', () => {
  const store = new Map<string, string>();
  (globalThis as any).window = {
    localStorage: {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, val: string) => store.set(key, val),
      removeItem: (key: string) => store.delete(key),
    },
  };

  const employeeId = 'EMP_TEST_101';

  // 1. Initial state: nothing stored
  assert.equal(readPekaryaLeaveDraft(employeeId), null);

  // 2. Save Pekarya draft
  savePekaryaLeaveDraft(employeeId, {
    date: '2026-09-22',
    reason: 'Izin menghadiri wisuda keluarga',
    reportType: 'izin_resmi',
  });

  const restored = readPekaryaLeaveDraft(employeeId);
  assert.ok(restored);
  assert.equal(restored.reason, 'Izin menghadiri wisuda keluarga');

  // 3. Clear Pekarya draft
  clearPekaryaLeaveDraft(employeeId);
  assert.equal(readPekaryaLeaveDraft(employeeId), null);

  // 4. Save and clear Satpam draft
  const satpamId = 'EMP_SATPAM_202';
  saveSatpamLeaveDraft(satpamId, {
    dutyDate: '2026-09-25',
    reason: 'Izin dinas luar',
  });
  const satpamRestored = readSatpamLeaveDraft(satpamId);
  assert.ok(satpamRestored);
  assert.equal(satpamRestored.reason, 'Izin dinas luar');

  clearSatpamLeaveDraft(satpamId);
  assert.equal(readSatpamLeaveDraft(satpamId), null);

  delete (globalThis as any).window;
});
