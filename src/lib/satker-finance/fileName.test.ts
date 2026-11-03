import assert from 'node:assert/strict';
import test from 'node:test';
import { satkerInitials } from './fileName';

test('a SatKer name becomes the initials of its words', () => {
  assert.equal(satkerInitials('Badan Pelayanan Kemahasiswaan'), 'BPK');
  assert.equal(satkerInitials('Pusat Penjaminan Mutu'), 'PPM');
  assert.equal(satkerInitials('Fakultas Sains & Teknologi'), 'FST');
  assert.equal(satkerInitials('Biro Kepegawaian dan Umum'), 'BKU');
  assert.equal(satkerInitials('  hubungan   masyarakat '), 'HM');
});

test('a one-word name stays whole and the result is safe in a file name', () => {
  assert.equal(satkerInitials('PUSKOMNET'), 'PUSKOMNET');
  assert.equal(satkerInitials('Perpustakaan'), 'Perpustakaan');
  assert.equal(satkerInitials('Unit/A:B'), 'UnitAB');
  assert.equal(satkerInitials('& /'), 'SatKer');
  assert.equal(satkerInitials(''), 'SatKer');
});
