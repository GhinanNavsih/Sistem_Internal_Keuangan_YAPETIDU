import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildSeedTemplateRows,
  parseSeedRows,
  planSeed,
  previewOctoberCandidates,
  seedTemplateHeaders,
} from './bonusTriwulanSeed';

const ROSTER = [
  { employeeId: 'Loyalis_001', employeeName: 'Suspa', nipy: '1101', unit: 'BAK' },
  { employeeId: 'Loyalis_002', employeeName: 'Budi', nipy: '1102', unit: 'BAU' },
];

function row(employeeId: string, name: string, cells: [string, string, string, string]) {
  return {
    ID: employeeId,
    Nama: name,
    'Senam Agustus': cells[0],
    'Bonus Agustus': cells[1],
    'Senam September': cells[2],
    'Bonus September': cells[3],
  };
}

test('the template has one row per Loyalis and empty Y/T cells', () => {
  assert.deepEqual(seedTemplateHeaders(), [
    'ID', 'NIPY', 'Nama', 'Unit', 'Senam Agustus', 'Bonus Agustus', 'Senam September', 'Bonus September',
  ]);
  const rows = buildSeedTemplateRows(ROSTER);
  assert.equal(rows.length, 2);
  assert.equal(rows[0].ID, 'Loyalis_001');
  assert.equal(rows[0]['Senam Agustus'], '');
});

test('a filled sheet becomes the paper records of both months', () => {
  const parsed = parseSeedRows([
    row('Loyalis_001', 'Suspa', ['y', 'T', 'Ya', 'Y']),
    row('Loyalis_002', 'Budi', ['Y', 'T', 'tidak', 'T']),
    { ID: '', Nama: '' },
  ], ROSTER);
  assert.deepEqual(parsed.errors, []);
  assert.deepEqual(parsed.warnings, []);
  const plan = planSeed(parsed.entries);
  assert.deepEqual(plan.senamMetIds, {
    '2026-08': ['Loyalis_001', 'Loyalis_002'],
    '2026-09': ['Loyalis_001'],
  });
  assert.deepEqual(plan.recipients, {
    '2026-08': [],
    '2026-09': [{ employeeId: 'Loyalis_001', employeeName: 'Suspa' }],
  });
});

test('blanks, unknown or repeated people, a missing person and two payouts are refused', () => {
  const parsed = parseSeedRows([
    row('Loyalis_001', 'Suspa', ['Y', '', 'Y', 'T']),
    row('Loyalis_009', 'Orang Lain', ['Y', 'T', 'Y', 'T']),
    row('Loyalis_001', 'Suspa', ['Y', 'T', 'Y', 'T']),
  ], ROSTER);
  assert.deepEqual(parsed.errors, [
    'Baris 2 (Suspa): kolom "Bonus Agustus" harus Y atau T.',
    'Baris 3 (Orang Lain): ID Loyalis_009 bukan Loyalis pada Agustus/September.',
    'Baris 4 (Suspa): sudah ada di baris 2.',
    'Budi (Loyalis_002) belum ada di lembar.',
  ]);

  const twice = parseSeedRows([
    row('Loyalis_001', 'Suspa', ['Y', 'Y', 'Y', 'Y']),
    row('Loyalis_002', 'Budi', ['Y', 'T', 'Y', 'T']),
  ], ROSTER);
  assert.deepEqual(twice.errors, [
    'Baris 2 (Suspa): tidak mungkin menerima bonus di Agustus dan September sekaligus.',
  ]);
});

test('a payout without that month\'s Senam Pagi is only a warning', () => {
  const parsed = parseSeedRows([
    row('Loyalis_001', 'Suspa', ['T', 'Y', 'Y', 'T']),
    row('Loyalis_002', 'Budi', ['Y', 'T', 'Y', 'T']),
  ], ROSTER);
  assert.deepEqual(parsed.errors, []);
  assert.deepEqual(parsed.warnings, ['Suspa: menerima bonus Agustus tetapi Senam Agustus ditulis T.']);
});

test('October candidates: Strata 1 and Senam both months, paid in neither', () => {
  const parsed = parseSeedRows([
    row('Loyalis_001', 'Suspa', ['Y', 'T', 'Y', 'Y']),
    row('Loyalis_002', 'Budi', ['Y', 'T', 'Y', 'T']),
  ], ROSTER);
  const presence = {
    '2026-08': { Loyalis_001: { stratum: 1 }, Loyalis_002: { stratum: 1 } },
    '2026-09': { Loyalis_001: { stratum: 1 }, Loyalis_002: { stratum: 1 } },
  };
  assert.deepEqual(previewOctoberCandidates(parsed.entries, presence), ['Budi']);
  assert.deepEqual(
    previewOctoberCandidates(parsed.entries, { ...presence, '2026-09': { Loyalis_002: { stratum: 2 } } }),
    [],
  );
});
