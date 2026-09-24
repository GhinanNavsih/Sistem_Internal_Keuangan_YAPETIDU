import assert from 'node:assert/strict';
import test from 'node:test';

import { filterPositionOptions, type PositionOption } from './structuralPositionPicker';

const OPTIONS: PositionOption[] = [
  { id: 'a', name: 'Ketua Senat', satker: 'REKTORAT' },
  { id: 'b', name: 'Kaprodi Bahasa Inggris', satker: 'FAK. BISNIS, BAHASA DAN PENDIDIKAN' },
  { id: 'c', name: 'Kaprodi Bahasa Inggris', satker: 'PASCASARJANA' },
];

test('an empty search lists every position that is not yet taken', () => {
  assert.deepEqual(filterPositionOptions(OPTIONS, [], '  ').map((option) => option.id), ['a', 'b', 'c']);
});

test('search matches the name or the satker, ignoring case', () => {
  assert.deepEqual(filterPositionOptions(OPTIONS, [], 'senat').map((option) => option.id), ['a']);
  assert.deepEqual(filterPositionOptions(OPTIONS, [], 'pasca').map((option) => option.id), ['c']);
});

test('a position already on the employee is hidden, but only for that satker', () => {
  const taken = [{ name: ' kaprodi bahasa inggris ', satker: 'pascasarjana' }];
  assert.deepEqual(filterPositionOptions(OPTIONS, taken, 'kaprodi').map((option) => option.id), ['b']);
});

test('taken entries with missing fields do not hide anything', () => {
  assert.equal(filterPositionOptions(OPTIONS, [{}, { name: null, satker: undefined }], '').length, 3);
});
