import assert from 'node:assert/strict';
import test from 'node:test';
import { suggestLinkCandidate } from './attendanceLinkSuggestion';

const people = [
  { id: 'BC_053', name: 'Khoirul Anam' },
  { id: 'BC_054', name: 'Pribadi' },
  { id: 'BC_037', name: 'Muhamad Fuady' },
  { id: 'BC_051', name: 'Muhammad Soleh' },
];

test('an exact name, ignoring case, is suggested', () => {
  assert.equal(suggestLinkCandidate('khoirul anam', people)?.id, 'BC_053');
  assert.equal(suggestLinkCandidate('Pribadi', people)?.id, 'BC_054');
});

test('the scanner spelling of a name still finds its owner', () => {
  assert.equal(suggestLinkCandidate('Muhammad Fuadi', people)?.id, 'BC_037');
});

test('a different person who shares a first name is not suggested', () => {
  assert.equal(suggestLinkCandidate('Muhammad Alhimny Rusidy, SKM', people), null);
});

test('unrelated and very short names get no suggestion', () => {
  assert.equal(suggestLinkCandidate('Eddy Kurniawan, S.Kom.', people), null);
  assert.equal(suggestLinkCandidate('Fais', people), null);
  assert.equal(suggestLinkCandidate('', people), null);
});

test('two equally close employees give no suggestion', () => {
  const twins = [
    { id: 'A', name: 'Slamet Raharjo' },
    { id: 'B', name: 'Slamet Raharja' },
  ];
  assert.equal(suggestLinkCandidate('Slamet Raharji', twins), null);
});

test('titles and degrees do not get in the way', () => {
  const staff = [{ id: 'X', name: 'Nurdin Bramono' }];
  assert.equal(suggestLinkCandidate('Nurdin Bramono, SS. M.Hum', staff)?.id, 'X');
});
