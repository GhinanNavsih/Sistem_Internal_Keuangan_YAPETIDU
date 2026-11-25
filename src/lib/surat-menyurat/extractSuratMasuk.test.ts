import assert from 'node:assert/strict';
import test from 'node:test';
import { normalizeExtractedSuratMasuk } from './extractSuratMasuk';

test('normalizes Gemini fields and keeps the text whole', () => {
  const result = normalizeExtractedSuratMasuk({ nomorSurat: ' 123/A ', tanggalSurat: '2026-11-12', pengirim: 'x'.repeat(200), penerima: null, perihal: ['invalid'], ringkasan: 'y'.repeat(1200), status: 'selesai' });
  assert.equal(result.nomorSurat, '123/A');
  assert.equal(result.tanggalSurat, '2026-11-12');
  assert.equal(result.pengirim.length, 200);
  assert.equal(result.penerima, '');
  assert.equal(result.perihal, '');
  assert.equal(result.ringkasan.length, 1200);
  assert.equal('status' in result, false);
});

test('does not infer or accept invalid dates', () => {
  for (const value of [null, {}, { tanggalSurat: '12 November 2026' }, { tanggalSurat: '2026-02-30' }, { tanggalSurat: '2026-11-12 extra' }]) {
    assert.equal(normalizeExtractedSuratMasuk(value).tanggalSurat, '');
  }
});
