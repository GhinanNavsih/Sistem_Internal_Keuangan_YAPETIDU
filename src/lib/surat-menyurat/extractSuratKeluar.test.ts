import assert from 'node:assert/strict';
import test from 'node:test';
import { normalizeExtractedSuratKeluar } from './extractSuratKeluar';

test('model output for an outgoing letter is cleaned', () => {
  const result = normalizeExtractedSuratKeluar({
    nomorSurat: '  185/B.1/AAK/11/2026 ',
    tanggalSurat: '2026-11-17',
    tujuan: 'Bapak/Ibu Dosen\n UNIPDU \n\n',
    perihal: 'Undangan Rapat',
    lampiranKeterangan: '-',
    penandatanganNama: 'Dr. Mujianto Solichin',
    penandatanganJabatan: 'Wakil Rektor',
    ringkasan: 'x'.repeat(2000),
    extra: 'ignored',
  });
  assert.equal(result.nomorSurat, '185/B.1/AAK/11/2026');
  assert.equal(result.tanggalSurat, '2026-11-17');
  assert.equal(result.tujuan, 'Bapak/Ibu Dosen - UNIPDU');
  assert.equal(result.ringkasan.length, 2000);
  assert.ok(!('extra' in result));
});

test('missing, wrongly typed or impossible values stay blank', () => {
  const result = normalizeExtractedSuratKeluar({ nomorSurat: 5, tanggalSurat: '2026-02-30', tujuan: null });
  assert.deepEqual(Object.values(result).filter(Boolean), []);
  assert.deepEqual(Object.values(normalizeExtractedSuratKeluar('nope')).filter(Boolean), []);
  assert.equal(normalizeExtractedSuratKeluar({ tanggalSurat: '17 November 2026' }).tanggalSurat, '');
});
