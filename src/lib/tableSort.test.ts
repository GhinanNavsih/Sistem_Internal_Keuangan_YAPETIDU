import assert from 'node:assert/strict';
import test from 'node:test';
import { nextTableSort, sortTableRows, type TableSort } from './tableSort';

type Column = 'name' | 'rank';
const accessors = {
  name: (row: { name: string; rank: number }) => row.name,
  rank: (row: { name: string; rank: number }) => row.rank,
};

test('header clicks cycle ascending, descending, then the default order', () => {
  const first = nextTableSort<Column>(null, 'name');
  assert.deepEqual(first, { key: 'name', direction: 'asc' });
  const second = nextTableSort<Column>(first, 'name');
  assert.deepEqual(second, { key: 'name', direction: 'desc' });
  assert.equal(nextTableSort<Column>(second, 'name'), null);
});

test('clicking another column starts it ascending', () => {
  const current: TableSort<Column> = { key: 'name', direction: 'desc' };
  assert.deepEqual(nextTableSort(current, 'rank'), { key: 'rank', direction: 'asc' });
});

test('no sort keeps the incoming order and never mutates the input', () => {
  const rows = [{ name: 'B', rank: 2 }, { name: 'A', rank: 1 }];
  const result = sortTableRows(rows, null, accessors);
  assert.deepEqual(result, rows);
  assert.notEqual(result, rows);
});

test('names sort case-insensitively and descending reverses them', () => {
  const rows = [
    { name: 'sri', rank: 1 },
    { name: 'Dwi', rank: 2 },
    { name: 'Nur', rank: 3 },
  ];
  assert.deepEqual(
    sortTableRows(rows, { key: 'name', direction: 'asc' }, accessors).map((row) => row.name),
    ['Dwi', 'Nur', 'sri'],
  );
  assert.deepEqual(
    sortTableRows(rows, { key: 'name', direction: 'desc' }, accessors).map((row) => row.name),
    ['sri', 'Nur', 'Dwi'],
  );
});

test('ties keep the incoming order in both directions', () => {
  const rows = [
    { name: 'first', rank: 1 },
    { name: 'second', rank: 1 },
    { name: 'third', rank: 0 },
  ];
  assert.deepEqual(
    sortTableRows(rows, { key: 'rank', direction: 'asc' }, accessors).map((row) => row.name),
    ['third', 'first', 'second'],
  );
  assert.deepEqual(
    sortTableRows(rows, { key: 'rank', direction: 'desc' }, accessors).map((row) => row.name),
    ['first', 'second', 'third'],
  );
});

test('digits inside text sort as numbers', () => {
  const rows = [{ name: 'Hari 10', rank: 0 }, { name: 'Hari 9', rank: 0 }];
  assert.deepEqual(
    sortTableRows(rows, { key: 'name', direction: 'asc' }, accessors).map((row) => row.name),
    ['Hari 9', 'Hari 10'],
  );
});
