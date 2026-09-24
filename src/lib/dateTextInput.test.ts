import assert from 'node:assert/strict';
import test from 'node:test';
import {
  displayDateToIso,
  isCompleteDateText,
  isoToDisplayDate,
  maskDateInput,
} from './dateTextInput';

test('typing digits builds the dd/mm/yyyy mask one key at a time', () => {
  const steps = ['2', '25', '250', '2509', '25092', '250920', '2509202', '25092026'];
  assert.deepEqual(steps.map(maskDateInput), [
    '2',
    '25',
    '25/0',
    '25/09',
    '25/09/2',
    '25/09/20',
    '25/09/202',
    '25/09/2026',
  ]);
});

test('the mask never leaves a trailing slash, so Backspace cannot get stuck', () => {
  assert.equal(maskDateInput('25/'), '25');
  assert.equal(maskDateInput('25/09/'), '25/09');
  // Backspacing through the whole value walks back one digit at a time.
  let text = maskDateInput('25092026');
  const seen = [text];
  while (text) {
    text = maskDateInput(text.slice(0, -1));
    seen.push(text);
  }
  assert.deepEqual(seen, [
    '25/09/2026',
    '25/09/202',
    '25/09/20',
    '25/09/2',
    '25/09',
    '25/0',
    '25',
    '2',
    '',
  ]);
});

test('extra digits, separators and letters are ignored', () => {
  assert.equal(maskDateInput('250920261234'), '25/09/2026');
  assert.equal(maskDateInput('25-09-2026'), '25/09/2026');
  assert.equal(maskDateInput('25.09.2026'), '25/09/2026');
  assert.equal(maskDateInput('Jumat, 25/09/2026'), '25/09/2026');
  assert.equal(maskDateInput('abc'), '');
  assert.equal(maskDateInput(''), '');
});

test('a pasted yyyy-mm-dd date is converted, not scrambled', () => {
  assert.equal(maskDateInput('2026-09-25'), '25/09/2026');
  assert.equal(maskDateInput(' 2026-09-25 '), '25/09/2026');
});

test('a complete real date reads out as an ISO date', () => {
  assert.equal(displayDateToIso('25/09/2026'), '2026-09-25');
  assert.equal(displayDateToIso('29/02/2028'), '2028-02-29');
});

test('an incomplete or impossible date reads out as nothing', () => {
  assert.equal(displayDateToIso(''), '');
  assert.equal(displayDateToIso('25/09/202'), '');
  assert.equal(displayDateToIso('25/09'), '');
  assert.equal(displayDateToIso('31/02/2026'), '');
  assert.equal(displayDateToIso('29/02/2027'), '');
  assert.equal(displayDateToIso('00/09/2026'), '');
  assert.equal(displayDateToIso('25/13/2026'), '');
  assert.equal(displayDateToIso('25/09/0000'), '');
  assert.equal(displayDateToIso('2026-09-25'), '');
});

test('an ISO date shows as dd/mm/yyyy', () => {
  assert.equal(isoToDisplayDate('2026-09-25'), '25/09/2026');
  assert.equal(isoToDisplayDate('2026-02-30'), '');
  assert.equal(isoToDisplayDate(''), '');
  assert.equal(displayDateToIso(isoToDisplayDate('2026-12-01')), '2026-12-01');
});

test('a full-length text is told apart from one still being typed', () => {
  assert.equal(isCompleteDateText('25/09/2026'), true);
  assert.equal(isCompleteDateText('31/02/2026'), true);
  assert.equal(isCompleteDateText('25/09/202'), false);
  assert.equal(isCompleteDateText(''), false);
});
