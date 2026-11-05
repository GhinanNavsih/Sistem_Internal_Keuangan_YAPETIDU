import { test } from 'node:test';
import assert from 'node:assert/strict';
import { deriveGenderFromNik, formatGenderLabel } from './gender';

test('deriveGenderFromNik identifies female from day > 40', () => {
  // Female born on 6th of July -> day digits = 46
  assert.equal(deriveGenderFromNik('3517194607760004'), 'female');
  // Female born on 1st -> day digits = 41
  assert.equal(deriveGenderFromNik('3517194101900001'), 'female');
  // Female born on 31st -> day digits = 71
  assert.equal(deriveGenderFromNik('3517197112850002'), 'female');
  // Formatted string with spaces or dots
  assert.equal(deriveGenderFromNik('35.17.19.460776.0004'), 'female');
});

test('deriveGenderFromNik identifies male from day 01-31', () => {
  // Male born on 6th of July -> day digits = 06
  assert.equal(deriveGenderFromNik('3517190607760004'), 'male');
  // Male born on 1st -> day digits = 01
  assert.equal(deriveGenderFromNik('3517190101900001'), 'male');
  // Male born on 31st -> day digits = 31
  assert.equal(deriveGenderFromNik('3517193112850002'), 'male');
  // Formatted string with dashes
  assert.equal(deriveGenderFromNik('351719-060776-0004'), 'male');
});

test('deriveGenderFromNik returns null on invalid NIKs', () => {
  assert.equal(deriveGenderFromNik(null), null);
  assert.equal(deriveGenderFromNik(undefined), null);
  assert.equal(deriveGenderFromNik(''), null);
  assert.equal(deriveGenderFromNik('12345'), null); // too short
  assert.equal(deriveGenderFromNik('3517190007760004'), null); // day 00
  assert.equal(deriveGenderFromNik('3517193507760004'), null); // day 35 (invalid)
  assert.equal(deriveGenderFromNik('3517197507760004'), null); // day 75 (invalid)
  assert.equal(deriveGenderFromNik('3517194007760004'), null); // day 40 (invalid)
});

test('formatGenderLabel formats labels correctly', () => {
  assert.equal(formatGenderLabel('female'), 'Perempuan');
  assert.equal(formatGenderLabel('male'), 'Laki-laki');
  assert.equal(formatGenderLabel(null), '-');
  assert.equal(formatGenderLabel(undefined), '-');
});
