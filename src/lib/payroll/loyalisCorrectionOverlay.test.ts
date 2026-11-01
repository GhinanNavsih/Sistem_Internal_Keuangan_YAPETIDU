import assert from 'node:assert/strict';
import test from 'node:test';
import {
  applyApprovedCorrectionsToDailyLogs,
  applyApprovedCorrectionsToLoyalisEntry,
  calculateLoyalisPresenceStratum,
  isApplicableApprovedCorrection,
  loyalisCorrectionOverlayApplies,
  type ApprovedLoyalisCorrection,
} from './loyalisCorrectionOverlay';
import type { LoyalisPaidLeaveDailyLog } from './loyalisPaidLeave';

const row = (
  date: string,
  status: string,
  scanIn = '',
  scanOut = '',
  extra: Record<string, unknown> = {},
): LoyalisPaidLeaveDailyLog => ({
  Tanggal: date,
  'Jam kerja': status,
  'Scan masuk': scanIn,
  'Scan pulang': scanOut,
  ...extra,
});

const correction = (
  overrides: Partial<ApprovedLoyalisCorrection> = {},
): ApprovedLoyalisCorrection => ({
  id: 'Loyalis_089_261011',
  employeeId: 'Loyalis_089',
  date: '2026-10-11',
  type: 'izin_resmi',
  status: 'approved',
  ...overrides,
});

const noOffDays = () => false;

test('an approved izin resmi turns the absent day into a full 07:30–14:00 day', () => {
  const { dailyLogs, changed } = applyApprovedCorrectionsToDailyLogs(
    [row('11-10-2026', 'TIDAK HADIR')],
    [correction()],
  );
  assert.equal(changed, true);
  assert.equal(dailyLogs[0]['Jam kerja'], 'MASUK');
  assert.equal(dailyLogs[0]['Scan masuk'], '07:30');
  assert.equal(dailyLogs[0]['Scan pulang'], '14:00');
  assert.equal(dailyLogs[0].appliedCorrectionId, 'Loyalis_089_261011');
});

test('masuk and pulang corrections replace only the scan they name', () => {
  const tapIn = applyApprovedCorrectionsToDailyLogs(
    [row('24-10-2026', 'MASUK', '11:30:00', '14:00:26', { scanMasukAuto: true })],
    [correction({ id: 'in', date: '2026-10-24', type: 'tap_in', checkInTime: '08:00' })],
  ).dailyLogs[0];
  assert.equal(tapIn['Scan masuk'], '08:00');
  assert.equal(tapIn['Scan pulang'], '14:00:26');
  assert.equal(tapIn.scanMasukAuto, false);

  const tapOut = applyApprovedCorrectionsToDailyLogs(
    [row('21-10-2026', 'MASUK', '07:03:00', '10:00:00', { scanPulangAuto: true })],
    [correction({ id: 'out', date: '2026-10-21', type: 'tap_out', checkOutTime: '14:08' })],
  ).dailyLogs[0];
  assert.equal(tapOut['Scan masuk'], '07:03:00');
  assert.equal(tapOut['Scan pulang'], '14:08');
  assert.equal(tapOut.scanPulangAuto, false);

  const both = applyApprovedCorrectionsToDailyLogs(
    [row('13-10-2026', 'TIDAK HADIR')],
    [correction({ id: 'both', date: '2026-10-13', type: 'both', checkInTime: '07:00', checkOutTime: '14:00' })],
  ).dailyLogs[0];
  assert.equal(both['Scan masuk'], '07:00');
  assert.equal(both['Scan pulang'], '14:00');
});

test('a day the scanner file does not list at all is added', () => {
  const { dailyLogs } = applyApprovedCorrectionsToDailyLogs(
    [row('12-10-2026', 'MASUK', '07:30', '14:00')],
    [correction({ date: '2026-10-11' })],
  );
  assert.deepEqual(dailyLogs.map((log) => log.Tanggal), ['11-10-2026', '12-10-2026']);
});

test('applying twice changes nothing, and a hand edit made afterwards is kept', () => {
  const first = applyApprovedCorrectionsToDailyLogs(
    [row('11-10-2026', 'TIDAK HADIR')],
    [correction()],
  );
  const again = applyApprovedCorrectionsToDailyLogs(first.dailyLogs, [correction()]);
  assert.equal(again.changed, false);

  const edited = first.dailyLogs.map((log) => ({ ...log, 'Scan pulang': '13:00' }));
  const afterEdit = applyApprovedCorrectionsToDailyLogs(edited, [correction()]);
  assert.equal(afterEdit.changed, false);
  assert.equal(afterEdit.dailyLogs[0]['Scan pulang'], '13:00');
});

test('a re-uploaded scanner file gets the corrections applied again', () => {
  const corrections = [correction()];
  const firstPass = applyApprovedCorrectionsToDailyLogs([row('11-10-2026', 'TIDAK HADIR')], corrections);
  assert.equal(firstPass.dailyLogs[0]['Jam kerja'], 'MASUK');
  // The new file knows nothing of the correction: the row is back to absent.
  const reuploaded = [row('11-10-2026', 'TIDAK HADIR')];
  const secondPass = applyApprovedCorrectionsToDailyLogs(reuploaded, corrections);
  assert.equal(secondPass.changed, true);
  assert.equal(secondPass.dailyLogs[0]['Jam kerja'], 'MASUK');
});

test('only approved, unconverted izin and scan corrections count', () => {
  for (const override of [
    { status: 'pending' },
    { status: 'rejected' },
    { typeChangedTo: 'cuti_tahunan' },
    { type: 'cuti_tahunan' },
    { type: 'ganti_libur' },
    { date: '11-10-2026' },
  ]) {
    assert.equal(isApplicableApprovedCorrection(correction(override)), false, JSON.stringify(override));
  }
  assert.equal(isApplicableApprovedCorrection(correction()), true);
});

test('a CUTI or GANTI LIBUR day keeps its credit', () => {
  for (const status of ['CUTI', 'GANTI LIBUR']) {
    const { dailyLogs, changed } = applyApprovedCorrectionsToDailyLogs(
      [row('11-10-2026', status, '07:30', '14:00')],
      [correction()],
    );
    assert.equal(changed, false, status);
    assert.equal(dailyLogs[0]['Jam kerja'], status);
  }
});

test('the overlay starts at October 2026', () => {
  assert.equal(loyalisCorrectionOverlayApplies('2026-09'), false);
  assert.equal(loyalisCorrectionOverlayApplies('2026-10'), true);
  assert.equal(loyalisCorrectionOverlayApplies('2027-01'), true);
  assert.equal(loyalisCorrectionOverlayApplies('2026_10'), false);
});

test('entry totals and strata follow the corrected day', () => {
  const workingDays = 26;
  const logs = Array.from({ length: 25 }, (_, index) =>
    row(`${String(index + 1).padStart(2, '0')}-10-2026`, 'MASUK', '07:30', '14:00'),
  );
  logs.push(row('26-10-2026', 'TIDAK HADIR'));
  const absentEntry = {
    minutes: 25 * 390,
    ...calculateLoyalisPresenceStratum(25 * 390, 'worked', workingDays, 6.5),
    dailyLogs: logs,
  };
  assert.equal(absentEntry.stratum, 2);

  const result = applyApprovedCorrectionsToLoyalisEntry({
    entry: absentEntry,
    corrections: [correction({ date: '2026-10-26' })],
    expectedHours: 6.5,
    workingDays,
    mode: 'worked',
    isOffDay: noOffDays,
  });
  assert.equal(result.minutes, 26 * 390);
  assert.equal(result.absenceMinutes, 0);
  assert.equal(result.stratum, 1);
  assert.equal(result.netBonus, 250_000);
  assert.equal(result.absentDaysCount, 0);
});

test('an entry with nothing to apply is returned untouched', () => {
  const entry = { minutes: 1_234, dailyLogs: [row('11-10-2026', 'MASUK', '07:30', '14:00')] };
  const result = applyApprovedCorrectionsToLoyalisEntry({
    entry,
    corrections: [correction({ status: 'pending' })],
    expectedHours: 6.5,
    workingDays: 26,
    mode: 'worked',
    isOffDay: noOffDays,
  });
  assert.equal(result, entry);
});

test('stratum thresholds follow the working-day count', () => {
  // The same shortfall lands on a different strata when n differs.
  assert.equal(calculateLoyalisPresenceStratum(8_940, 'worked', 25, 6.5).stratum, 3);
  assert.equal(calculateLoyalisPresenceStratum(8_940, 'worked', 26, 6.5).stratum, 5);
  assert.equal(calculateLoyalisPresenceStratum(10_140, 'worked', 26, 6.5).stratum, 1);
  assert.equal(calculateLoyalisPresenceStratum(12_000, 'worked', 26, 6.5).absenceMinutes, 0);
});
