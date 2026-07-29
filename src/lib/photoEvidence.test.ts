import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizePhotoAuditMetadata } from './photoEvidence';

test('normalizes valid capture metadata and preserves resolved place context', () => {
  const result = normalizePhotoAuditMetadata({
    capturedAt: '2026-07-28T11:32:13',
    latitude: -7.547755,
    longitude: 112.280334,
    deviceName: 'Xiaomi 24117RN76O',
    hasExif: true,
    locationName: 'Gedung Rektorat Unipdu',
    locationAddress: 'Peterongan, Jombang, Jawa Timur',
    locationPlaceId: 'place-id',
  });

  assert.deepEqual(result, {
    capturedAt: '2026-07-28T11:32:13',
    latitude: -7.547755,
    longitude: 112.280334,
    deviceName: 'Xiaomi 24117RN76O',
    hasExif: true,
    locationName: 'Gedung Rektorat Unipdu',
    locationAddress: 'Peterongan, Jombang, Jawa Timur',
    locationPlaceId: 'place-id',
  });
});

test('drops invalid coordinates and oversized metadata fields', () => {
  const result = normalizePhotoAuditMetadata({
    capturedAt: 'x'.repeat(65),
    latitude: 91,
    longitude: 200,
    deviceName: 'x'.repeat(201),
    hasExif: false,
    locationName: 'x'.repeat(201),
    locationAddress: 'x'.repeat(501),
    locationPlaceId: 'x'.repeat(201),
  });

  assert.deepEqual(result, {
    capturedAt: null,
    latitude: null,
    longitude: null,
    deviceName: null,
    hasExif: false,
    locationName: null,
    locationAddress: null,
    locationPlaceId: null,
  });
});
