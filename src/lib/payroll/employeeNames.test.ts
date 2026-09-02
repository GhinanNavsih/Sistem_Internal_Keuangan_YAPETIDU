import assert from 'node:assert/strict';
import test from 'node:test';
import { normalizeName, MANUAL_OVERRIDES } from './employeeNames';

test('normalizeName drops titles, degrees and punctuation before comparing', () => {
  assert.equal(normalizeName('Abdul Ghofar, S. Kep., Ners. M.Pd.I'), 'abdul ghofar');
  assert.equal(normalizeName('KH. Ahmad Zahro, MA.'), 'ahmad zahro');
  assert.equal(normalizeName('  Eko   Suprayitno  '), 'eko suprayitno');
  // A single-token name is never stripped away to nothing.
  assert.equal(normalizeName('Sunan'), 'sunan');
});

test('the override list maps a known misspelling onto the official record', () => {
  assert.equal(MANUAL_OVERRIDES['Siti Rofiah'], "Siti Rofi'ah, A. Md.");
  assert.equal(
    normalizeName(MANUAL_OVERRIDES['Siti Rofiah']),
    normalizeName("Siti Rofi'ah, A. Md."),
  );
});
