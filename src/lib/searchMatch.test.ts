import assert from 'node:assert/strict';
import test from 'node:test';

import { normalizeSearchText, rankSearchOptions } from './searchMatch';

const OPTIONS = [
  { value: '1', label: '52137 · E tol & parkir' },
  { value: '2', label: '53010 · Perbaikan - Fakultas Ilmu Kesehatan' },
  { value: '3', label: '53011 · Perbaikan - Gedung Rektorat' },
  { value: '4', label: '53012 · Siti Rofi\'ah, A. Md.' },
];

const labelsFor = (query: string) => rankSearchOptions(OPTIONS, query).map((option) => option.value);

test('the typed name finds the account even when the catalog puts a dash between its words', () => {
  assert.deepEqual(labelsFor('Perbaikan Fakultas Ilmu Kesehatan'), ['2']);
});

test('the words can be typed in any order', () => {
  assert.deepEqual(labelsFor('kesehatan ilmu perbaikan'), ['2']);
});

test('punctuation, case and accents in the query do not block a match', () => {
  assert.deepEqual(labelsFor('e-tol parkir'), ['1']);
  assert.deepEqual(labelsFor('E TOL & PARKIR'), ['1']);
  assert.deepEqual(labelsFor('perbaikan - fakultas'), ['2']);
});

test('an apostrophe in the name is ignored', () => {
  assert.deepEqual(labelsFor('rofiah'), ['4']);
});

test('the account code matches too', () => {
  assert.deepEqual(labelsFor('52137'), ['1']);
});

test('a fragment of a word still matches, as the old contains-search did', () => {
  assert.deepEqual(labelsFor('fakul'), ['2']);
  assert.deepEqual(labelsFor('akultas'), ['2']);
});

test('the option whose label starts with the query comes first, then the rest in catalog order', () => {
  assert.deepEqual(labelsFor('perbaikan'), ['2', '3']);
  assert.deepEqual(labelsFor('53011 perbaikan'), ['3']);
  const ordered = [
    { value: 'a', label: 'Biaya Perbaikan Gedung' },
    { value: 'b', label: 'Perbaikan Gedung' },
    { value: 'c', label: 'Gedung Perbaikan' },
  ];
  assert.deepEqual(rankSearchOptions(ordered, 'perbaikan gedung').map((option) => option.value), ['b', 'a', 'c']);
});

test('an empty or punctuation-only query keeps every option in its original order', () => {
  assert.deepEqual(labelsFor(''), ['1', '2', '3', '4']);
  assert.deepEqual(labelsFor('  - & '), ['1', '2', '3', '4']);
});

test('a query that matches nothing returns nothing', () => {
  assert.deepEqual(labelsFor('listrik'), []);
});

test('normalizeSearchText folds case, accents and punctuation', () => {
  assert.equal(normalizeSearchText('  Perbaikan — Fakultas  Ilmu Kesehatan '), 'perbaikan fakultas ilmu kesehatan');
  assert.equal(normalizeSearchText('Café Rofi\'ah'), 'cafe rofiah');
});

const SATKERS = [
  { value: 'a', label: 'Badan Pelayanan Administrasi Keuangan', keywords: ['BPAK'] },
  { value: 'b', label: 'Badan Pelayanan Kemahasiswaan', keywords: ['BPKM'] },
  { value: 'c', label: 'Biro Administrasi Akademik', keywords: ['BAA'] },
  { value: 'd', label: 'Fakultas Agama Islam', keywords: ['FAI'] },
  { value: 'e', label: 'Biro Fai Umum' },
];
const satkerFor = (query: string) => rankSearchOptions(SATKERS, query).map((option) => option.value);

test('hidden keywords such as initials find the option, in any case', () => {
  assert.deepEqual(satkerFor('bpkm'), ['b']);
  assert.deepEqual(satkerFor('BAA'), ['c']);
  assert.deepEqual(satkerFor('bpak'), ['a']);
});

test('a keyword equal to the query ranks above a label that merely contains it', () => {
  assert.deepEqual(satkerFor('fai'), ['d', 'e']);
});

test('a keyword that starts with the query ranks like a label that starts with it', () => {
  assert.deepEqual(satkerFor('bp'), ['a', 'b']);
});

test('names still match as before when options carry keywords, and options without keywords are unaffected', () => {
  assert.deepEqual(satkerFor('kemahasiswaan'), ['b']);
  assert.deepEqual(labelsFor('perbaikan'), ['2', '3']);
});
