import assert from 'node:assert/strict';
import test from 'node:test';
import {
  autoLeaveAbsentDates,
  describeAutoLeaveSummary,
  isAutoLeavePeriod,
  loyalisLogDateToIso,
  planLoyalisAutoLeave,
  type AutoLeavePlanInput,
  type AutoLeaveSummary,
} from './loyalisAutoLeave';

// Five full years of service before September 2026, under ten: 3 days a year.
const BASE: AutoLeavePlanInput = {
  period: '2026-09',
  serviceDate: '2018-01-01',
  absentDates: [],
  blockedDates: new Set(),
  existingAutoDates: new Set(),
  balance: { reservedDays: 0, usedDays: 0, manualUsedDays: 0 },
};

function plan(overrides: Partial<AutoLeavePlanInput>) {
  return planLoyalisAutoLeave({ ...BASE, ...overrides });
}

test('absent days are covered earliest first until the balance runs out', () => {
  const result = plan({
    absentDates: ['2026-09-21', '2026-09-03', '2026-09-08', '2026-09-15', '2026-09-28'],
  });
  assert.deepEqual(result.cover, ['2026-09-03', '2026-09-08', '2026-09-15']);
  assert.deepEqual(result.uncovered, [
    { date: '2026-09-21', reason: 'saldo_habis' },
    { date: '2026-09-28', reason: 'saldo_habis' },
  ]);
  assert.deepEqual(result.release, []);
});

test('an empty balance leaves every absent day absent', () => {
  const result = plan({
    absentDates: ['2026-09-03', '2026-09-04'],
    balance: { reservedDays: 1, usedDays: 1, manualUsedDays: 1 },
  });
  assert.deepEqual(result.cover, []);
  assert.deepEqual(result.uncovered.map((item) => item.reason), ['saldo_habis', 'saldo_habis']);
});

test('the balance held by a pending request and by manual days comes off the top', () => {
  const result = plan({
    absentDates: ['2026-09-03', '2026-09-04', '2026-09-07'],
    balance: { reservedDays: 1, usedDays: 0, manualUsedDays: 1 },
  });
  assert.deepEqual(result.cover, ['2026-09-03']);
  assert.equal(result.uncovered.length, 2);
});

test('before five full years of service there is no balance to spend', () => {
  const result = plan({ serviceDate: '2024-01-01', absentDates: ['2026-09-03'] });
  assert.deepEqual(result.cover, []);
  assert.deepEqual(result.uncovered, [{ date: '2026-09-03', reason: 'belum_berhak' }]);
});

test('each day is held to the entitlement of its own date', () => {
  // The fifth anniversary falls on 15 September 2026: the first leave day is the 16th.
  const result = plan({
    serviceDate: '2021-09-15',
    absentDates: ['2026-09-10', '2026-09-20'],
  });
  assert.deepEqual(result.cover, ['2026-09-20']);
  assert.deepEqual(result.uncovered, [{ date: '2026-09-10', reason: 'belum_berhak' }]);
});

test('a day with any submission or correction is left alone', () => {
  const result = plan({
    absentDates: ['2026-09-03', '2026-09-04'],
    blockedDates: new Set(['2026-09-03']),
  });
  assert.deepEqual(result.cover, ['2026-09-04']);
  assert.deepEqual(result.uncovered, []);
});

test('planning again after the plan was applied changes nothing', () => {
  const absentDates = ['2026-09-03', '2026-09-04', '2026-09-07', '2026-09-08'];
  const first = plan({ absentDates });
  assert.equal(first.cover.length, 3);
  const second = plan({
    absentDates,
    existingAutoDates: new Set(first.cover),
    balance: { reservedDays: 0, usedDays: first.cover.length, manualUsedDays: 0 },
  });
  assert.deepEqual(second.cover, []);
  assert.deepEqual(second.release, []);
  assert.deepEqual(second.keep, first.cover);
  assert.deepEqual(second.uncovered, [{ date: '2026-09-08', reason: 'saldo_habis' }]);
});

test('a day that is no longer absent is released and its balance freed', () => {
  const result = plan({
    absentDates: ['2026-09-04'],
    existingAutoDates: new Set(['2026-09-03', '2026-09-04']),
    balance: { reservedDays: 0, usedDays: 2, manualUsedDays: 0 },
  });
  assert.deepEqual(result.release, ['2026-09-03']);
  assert.deepEqual(result.keep, ['2026-09-04']);
  assert.deepEqual(result.cover, []);
});

test('a day submitted for after it was covered is released', () => {
  const result = plan({
    absentDates: ['2026-09-03'],
    blockedDates: new Set(['2026-09-03']),
    existingAutoDates: new Set(['2026-09-03']),
    balance: { reservedDays: 1, usedDays: 1, manualUsedDays: 0 },
  });
  assert.deepEqual(result.release, ['2026-09-03']);
});

test('when the balance is taken elsewhere the later automatic day is the one released', () => {
  const result = plan({
    absentDates: ['2026-09-03', '2026-09-04'],
    existingAutoDates: new Set(['2026-09-03', '2026-09-04']),
    // Two pending requests now hold two of the three days.
    balance: { reservedDays: 2, usedDays: 2, manualUsedDays: 0 },
  });
  assert.deepEqual(result.keep, ['2026-09-03']);
  assert.deepEqual(result.release, ['2026-09-04']);
  assert.deepEqual(result.uncovered, [{ date: '2026-09-04', reason: 'saldo_habis' }]);
});

test('months before the first applicable period are never planned', () => {
  assert.equal(isAutoLeavePeriod('2026-08'), false);
  assert.equal(isAutoLeavePeriod('2026-09'), true);
  assert.equal(isAutoLeavePeriod('2027-01'), true);
  assert.equal(isAutoLeavePeriod('bogus'), false);
  const result = plan({
    period: '2026-08',
    absentDates: ['2026-08-03'],
    existingAutoDates: new Set(['2026-08-04']),
  });
  assert.deepEqual(result, { cover: [], release: [], keep: [], uncovered: [] });
});

test('only absent working days of the period are read from the daily logs', () => {
  const dates = autoLeaveAbsentDates(
    [
      { Tanggal: '03-09-2026', 'Jam kerja': 'Tidak Hadir' },
      { Tanggal: '03-09-2026', 'Jam kerja': 'TIDAK HADIR' },
      { Tanggal: '04-09-2026', 'Jam kerja': 'MASUK' },
      { Tanggal: '05-09-2026', 'Jam kerja': ' tidak hadir ' },
      { Tanggal: '11-09-2026', 'Jam kerja': 'Tidak Hadir' },
      { Tanggal: '30-08-2026', 'Jam kerja': 'Tidak Hadir' },
      { Tanggal: '10-09-2026', 'Jam kerja': 'CUTI' },
      { Tanggal: 'garbled', 'Jam kerja': 'Tidak Hadir' },
    ],
    '2026-09',
    (date) => date === '2026-09-11',
  );
  assert.deepEqual(dates, ['2026-09-03', '2026-09-05']);
  assert.deepEqual(autoLeaveAbsentDates(undefined, '2026-09', () => false), []);
});

test('log dates read as ISO dates only when they are real dates', () => {
  assert.equal(loyalisLogDateToIso('29-09-2026'), '2026-09-29');
  assert.equal(loyalisLogDateToIso('31-02-2026'), '');
  assert.equal(loyalisLogDateToIso('2026-09-29'), '');
  assert.equal(loyalisLogDateToIso(undefined), '');
});

test('the save message reports what the run did, and nothing when it did nothing', () => {
  const result = (overrides: Partial<AutoLeaveSummary['results'][number]>) => ({
    employeeId: 'L1',
    employeeName: 'Ani',
    covered: [],
    released: [],
    uncovered: [],
    ...overrides,
  });
  assert.equal(describeAutoLeaveSummary({ period: '2026-09', applicable: true, results: [] }), '');
  assert.equal(
    describeAutoLeaveSummary({
      period: '2026-08',
      applicable: false,
      note: 'Cuti otomatis hanya berlaku untuk periode mulai 2026-09.',
      results: [],
    }),
    ' Cuti otomatis hanya berlaku untuk periode mulai 2026-09.',
  );
  const message = describeAutoLeaveSummary({
    period: '2026-09',
    applicable: true,
    results: [
      result({ covered: ['2026-09-03', '2026-09-04'] }),
      result({ employeeName: 'Budi', covered: ['2026-09-08'] }),
      result({ employeeName: 'Citra', released: ['2026-09-09'] }),
      result({ employeeName: 'Dedi', uncovered: [{ date: '2026-09-10', reason: 'saldo_habis' }] }),
      result({ employeeName: 'Eka', skipped: 'Slip periode ini sudah final.' }),
    ],
  });
  assert.match(message, /Cuti otomatis dipakai 3 hari untuk 2 pegawai\./);
  assert.match(message, /1 hari cuti otomatis dikembalikan/);
  assert.match(message, /1 hari tetap tidak hadir.*: Dedi\./);
  assert.match(message, /Tidak diproses: Eka \(Slip periode ini sudah final\.\)\./);
});
