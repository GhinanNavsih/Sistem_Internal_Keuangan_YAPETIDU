import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildSeedTemplateRows,
  matchRekapNames,
  parseRekapSheet,
  parseSeedRows,
  planSeed,
  previewOctoberCandidates,
  rekapMinAttended,
  seedTemplateHeaders,
} from './bonusTriwulanSeed';

const ROSTER = [
  { employeeId: 'Loyalis_001', employeeName: 'Suspa', nipy: '1101', unit: 'BAK' },
  { employeeId: 'Loyalis_002', employeeName: 'Budi', nipy: '1102', unit: 'BAU' },
];

function row(employeeId: string, name: string, cells: [string, string]) {
  return {
    ID: employeeId,
    Nama: name,
    'Bonus Agustus': cells[0],
    'Bonus September': cells[1],
  };
}

test('the template has one row per Loyalis and empty Y/T cells for who was paid', () => {
  assert.deepEqual(seedTemplateHeaders(), ['ID', 'NIPY', 'Nama', 'Unit', 'Bonus Agustus', 'Bonus September']);
  const rows = buildSeedTemplateRows(ROSTER);
  assert.equal(rows.length, 2);
  assert.equal(rows[0].ID, 'Loyalis_001');
  assert.equal(rows[0]['Bonus Agustus'], '');
  assert.equal('Senam Agustus' in rows[0], false, 'Senam Pagi comes from the attendance recap');
});

test('a filled sheet becomes the paid recipients of both months', () => {
  const parsed = parseSeedRows([
    row('Loyalis_001', 'Suspa', ['t', 'Y']),
    row('Loyalis_002', 'Budi', ['Tidak', 'T']),
    { ID: '', Nama: '' },
  ], ROSTER);
  assert.deepEqual(parsed.errors, []);
  assert.deepEqual(planSeed(parsed.entries).recipients, {
    '2026-08': [],
    '2026-09': [{ employeeId: 'Loyalis_001', employeeName: 'Suspa' }],
  });
});

test('blanks, unknown or repeated people, a missing person and two payouts are refused', () => {
  const parsed = parseSeedRows([
    row('Loyalis_001', 'Suspa', ['', 'T']),
    row('Loyalis_009', 'Orang Lain', ['T', 'T']),
    row('Loyalis_001', 'Suspa', ['T', 'T']),
  ], ROSTER);
  assert.deepEqual(parsed.errors, [
    'Baris 2 (Suspa): kolom "Bonus Agustus" harus Y atau T.',
    'Baris 3 (Orang Lain): ID Loyalis_009 bukan Loyalis pada Agustus/September.',
    'Baris 4 (Suspa): sudah ada di baris 2.',
    'Budi (Loyalis_002) belum ada di lembar.',
  ]);

  const twice = parseSeedRows([
    row('Loyalis_001', 'Suspa', ['Y', 'Y']),
    row('Loyalis_002', 'Budi', ['T', 'T']),
  ], ROSTER);
  assert.deepEqual(twice.errors, [
    'Baris 2 (Suspa): tidak mungkin menerima bonus di Agustus dan September sekaligus.',
  ]);
});

test('October candidates: Strata 1 both months, paid in neither, at most one miss across both', () => {
  const entries = parseSeedRows([
    row('Loyalis_001', 'Suspa', ['T', 'Y']),
    row('Loyalis_002', 'Budi', ['T', 'T']),
  ], ROSTER).entries;
  const presence = {
    '2026-08': { Loyalis_001: { stratum: 1 }, Loyalis_002: { stratum: 1 } },
    '2026-09': { Loyalis_001: { stratum: 1 }, Loyalis_002: { stratum: 1 } },
  };
  const misses = {
    '2026-08': { Loyalis_001: 0, Loyalis_002: 1 },
    '2026-09': { Loyalis_001: 0, Loyalis_002: 0 },
  };
  assert.deepEqual(previewOctoberCandidates(entries, presence, misses), ['Budi'], 'Suspa was paid in September');

  assert.deepEqual(
    previewOctoberCandidates(entries, presence, { ...misses, '2026-09': { Loyalis_001: 0, Loyalis_002: 1 } }),
    [],
    'one miss in each month is two in all',
  );
  assert.deepEqual(
    previewOctoberCandidates(entries, { ...presence, '2026-09': { Loyalis_002: { stratum: 2 } } }, misses),
    [],
  );
  assert.deepEqual(
    previewOctoberCandidates(entries, presence, { ...misses, '2026-08': { Loyalis_001: 0 } }),
    [],
    'someone the Senam Pagi record does not list is left out',
  );
});

const GRID = [
  ['REKAPAN AHAD SEHAT SEPTEMBER 2026', '', '', '', '', ''],
  ['NO', ' NAMA', '06/09', '13/09', '20/09', 'TOTAL'],
  ['1', 'Suspahariati, S. Sos, MM.', '1', '', '1', '2'],
  ['2', 'Budi, S.Kom', '1', '', '', '1'],
  ['3', 'Citra, M.Pd', '', '', '1', '2'],
  ['', '', '', '', '', ''],
];

test('the recap sheet gives the sessions held and each person\'s attendance', () => {
  const parsed = parseRekapSheet(GRID, '2026-09');
  assert.ok('sheet' in parsed);
  assert.deepEqual(parsed.sheet.sessionDates, ['2026-09-06', '2026-09-20'], '13/09 had nobody, so it was not held');
  assert.deepEqual(parsed.sheet.rows.map((row) => [row.name, row.attended]), [
    ['Suspahariati, S. Sos, MM.', 2],
    ['Budi, S.Kom', 1],
    ['Citra, M.Pd', 1],
  ]);
  assert.equal(parsed.sheet.warnings.length, 2);
  assert.match(parsed.sheet.warnings[0], /13\/09 tidak ada yang hadir/);
  assert.match(parsed.sheet.warnings[1], /Citra, M.Pd\): TOTAL 2 tidak sama dengan jumlah tanda 1/);
  assert.equal(rekapMinAttended(parsed.sheet.sessionDates.length), 1);
  assert.equal(rekapMinAttended(3), 2, 'three sessions: at most one miss');
  assert.equal(rekapMinAttended(0), 0);
});

test('the recap sheet is refused when it is not the right shape or month', () => {
  assert.deepEqual(parseRekapSheet([['x']], '2026-09'), { error: 'Baris judul dengan kolom NAMA tidak ditemukan.' });
  assert.deepEqual(parseRekapSheet([['NAMA', 'TOTAL']], '2026-09'), { error: 'Kolom tanggal sesi (dd/mm) tidak ditemukan.' });
  assert.deepEqual(
    parseRekapSheet([['NAMA', '06/08']], '2026-09'),
    { error: 'Kolom 06/08 bukan bulan September.' },
  );
  assert.deepEqual(parseRekapSheet([['NAMA', '06/09'], ['A', '']], '2026-09'), { error: 'Tidak ada sesi dengan peserta.' });
});

const LOYALIS = [
  { employeeId: 'L1', employeeName: 'Hj. Suspa Hariati, S.Sos., M.M.' },
  { employeeId: 'L2', employeeName: 'Binti Qoni\'ah, S.S., M.Hum.' },
  { employeeId: 'L3', employeeName: 'Irva Arina Alawiyah, S.E.' },
  { employeeId: 'L4', employeeName: 'Ana Rahmawati, M.Pd' },
  { employeeId: 'L5', employeeName: 'M. Achyar, S.AB.' },
];
const rekap = (name: string, attended = 3, line = 3) => ({ line, name, attended });

test('names match by identity, truncation or a typo, and say how', () => {
  const [exact, typo, prefix, spacing] = matchRekapNames([
    rekap('Ana Rahmawati, M.Pd.'),
    rekap('Binti Qani\'ah, SS. M.Hum'),
    rekap('Irva Arina A.'),
    rekap('Suspahariati, S. Sos, MM.'),
  ], LOYALIS);
  assert.deepEqual([exact.employeeId, exact.method], ['L4', 'exact']);
  assert.deepEqual([typo.employeeId, typo.method], ['L2', 'fuzzy']);
  assert.deepEqual([prefix.employeeId, prefix.method], ['L3', 'prefix']);
  assert.deepEqual([spacing.employeeId, spacing.method], ['L1', 'fuzzy']);
});

test('a name with no near match stays unmatched, with the nearest names suggested', () => {
  const [unknown] = matchRekapNames([rekap('Hj. Arifa Retnowuni, S.Psi., M.Kes')], LOYALIS);
  assert.equal(unknown.employeeId, null);
  assert.equal(unknown.note, 'Tidak ada nama yang cocok.');
  assert.equal(unknown.suggestions.length, 2);
});

test('two sheet names never take one person: the better match wins', () => {
  const [loose, exact] = matchRekapNames([rekap('Ana Rahmawat'), rekap('Ana Rahmawati, M.Pd.', 3, 4)], LOYALIS);
  assert.equal(exact.employeeId, 'L4');
  assert.equal(loose.employeeId, null);
  assert.match(loose.note, /sudah dipakai baris "Ana Rahmawati, M.Pd."/);
});

test('overrides settle what the rules cannot, including "not a Loyalis"', () => {
  const [achyar, gone, wrong, clash] = matchRekapNames(
    [rekap('Achyar, S.AB'), rekap('Sumargono'), rekap('X'), rekap('Y')],
    LOYALIS,
    { 'Achyar, S.AB': 'L5', Sumargono: null, X: 'L99', Y: 'L5' },
  );
  assert.deepEqual([achyar.employeeId, achyar.method], ['L5', 'override']);
  assert.equal(gone.employeeId, null);
  assert.match(gone.note, /Bukan Loyalis aktif/);
  assert.match(wrong.note, /L99 tidak ada/);
  assert.match(clash.note, /L5 sudah dipakai/);
});

test('a name that fits two people equally is left for a person to decide', () => {
  const [ambiguous] = matchRekapNames([rekap('Ahmad Arif')], [
    { employeeId: 'A', employeeName: 'Ahmad Arif, S.AB.' },
    { employeeId: 'B', employeeName: 'Ahmad Arif, S.Kom.' },
  ]);
  assert.equal(ambiguous.employeeId, null);
  assert.match(ambiguous.note, /Beberapa nama cocok/);
});
