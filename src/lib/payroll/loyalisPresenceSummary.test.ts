import assert from 'node:assert/strict';
import test from 'node:test';
import { periodCalendarFromData } from './calendar';
import { loyalisLogDateToIso } from './loyalisAutoLeave';
import { loyalisPresenceStratum } from './loyalisPaidLeave';
import { recalculateLoyalisSummary } from './loyalisPresenceSummary';
import { loyalisPresenceAmounts } from './uraianPropagation';

const workingDay = () => false;
const log = (status = '', scanIn = '07:30', scanOut = '14:00', date = '01-09-2026') => ({
  Tanggal: date,
  'Jam kerja': status,
  'Scan masuk': scanIn,
  'Scan pulang': scanOut,
});

test('valid scans are payable with blank, source-specific and paid-leave statuses', () => {
  for (const status of ['', 'Staff', 'Dosen', 'MASUK', '  masuk  ', 'CUTI', 'GANTI LIBUR']) {
    const result = recalculateLoyalisSummary([log(status, '07:11:44', '14:03:14')], 6.5, workingDay);
    assert.equal(result.minutes, 390, status);
    assert.equal(result.activeDaysCount, 1, status);
    assert.equal(result.incompleteDaysCount, 0, status);
    assert.equal(result.dailyLogs[0]['Jam kerja'], status, 'the source label remains intact');
  }
});

test('an explicit absence excludes kept scans without changing their audit evidence', () => {
  const rows = [log('  Tidak Hadir  ', '07:30', '14:00')];
  const original = structuredClone(rows);
  const result = recalculateLoyalisSummary(rows, 6.5, workingDay);
  assert.equal(result.minutes, 0);
  assert.equal(result.absentDaysCount, 1);
  assert.equal(result.activeDaysCount, 0);
  assert.equal(result.incompleteDaysCount, 0);
  assert.equal(result.dailyLogs[0]['Scan masuk'], '07:30');
  assert.deepEqual(rows, original, 'summary calculation does not mutate the input');
});

test('missing or invalid scans cannot earn minutes', () => {
  const result = recalculateLoyalisSummary([
    log('', '', ''),
    log('Staff', 'not-a-time', '14:00'),
    log('MASUK', '07:30', 'invalid'),
  ], 6.5, workingDay);
  assert.equal(result.minutes, 0);
  assert.equal(result.incompleteDaysCount, 3);
  assert.equal(result.activeDaysCount, 0);
});

test('single scans share auto-fill rules and respect explicitly disabled auto-fill', () => {
  const result = recalculateLoyalisSummary([
    log('', '08:00', ''),
    log('Staff', '', '13:00'),
    { ...log('', '08:00', ''), scanPulangAuto: false },
    { ...log('Staff', '', '13:00'), scanMasukAuto: false },
  ], 6.5, workingDay);
  assert.equal(result.minutes, 300);
  assert.equal(result.activeDaysCount, 2);
  assert.equal(result.incompleteDaysCount, 2);
  assert.equal(result.dailyLogs[0]['Scan pulang'], '10:30:00');
  assert.equal(result.dailyLogs[0].scanPulangAuto, true);
  assert.equal(result.dailyLogs[1]['Scan masuk'], '10:30:00');
  assert.equal(result.dailyLogs[1].scanMasukAuto, true);
  assert.equal(result.dailyLogs[2]['Scan pulang'], '');
  assert.equal(result.dailyLogs[3]['Scan masuk'], '');
  assert.deepEqual(recalculateLoyalisSummary(result.dailyLogs, 6.5, workingDay), result);
});

test('the current calendar excludes Fridays and holidays despite stale row flags', () => {
  const offDays = new Set(periodCalendarFromData('2026-09', {
    workCalendar: { premiumDates: ['2026-09-10'] },
  }).premiumDates);
  const result = recalculateLoyalisSummary([
    { ...log('', '07:30', '14:00', '04-09-2026'), isOffDay: false },
    { ...log('CUTI', '07:30', '14:00', '10-09-2026'), isOffDay: false },
    log('Tidak Hadir', '', '', '11-09-2026'),
    { ...log('', '07:30', '14:00', '01-09-2026'), isOffDay: true },
  ], 6.5, (tanggal) => offDays.has(loyalisLogDateToIso(tanggal)));
  assert.equal(result.minutes, 390);
  assert.equal(result.activeDaysCount, 1);
  assert.equal(result.absentDaysCount, 0);
  assert.equal(result.incompleteDaysCount, 0);
  assert.equal(result.offDayScannedCount, 2);
  assert.equal(result.offDayExcludedMinutes, 780);
  assert.deepEqual(result.dailyLogs.map((row) => row.isOffDay), [true, true, true, false]);
});

test('recalculating a corrected month retains scan and approved leave minutes', () => {
  const rows = [
    { ...log('', '07:11:44', '14:03:14'), sourceRowNumber: 17, duration: 0 },
    log('Staff', '08:39:45', '14:24:00', '02-09-2026'),
    log('CUTI', '07:30', '14:00', '03-09-2026'),
    log('GANTI LIBUR', '07:30', '14:00', '05-09-2026'),
    log('MASUK', '07:30', '14:00', '19-09-2026'),
  ];
  const result = recalculateLoyalisSummary(rows, 6.5, workingDay);
  assert.equal(result.minutes, 1_881);
  const importedRow = result.dailyLogs[0];
  assert.ok('sourceRowNumber' in importedRow);
  assert.equal(importedRow.sourceRowNumber, 17);
  assert.equal(result.dailyLogs[0].duration, 390);
  assert.deepEqual(recalculateLoyalisSummary(result.dailyLogs, 6.5, workingDay), result);
});

test('September regression: blank-status scans are retained alongside two approved full days', () => {
  // Scan times from the diagnosed month, without employee identity or payroll
  // details. Three single scans already have their saved automatic fills.
  const scans = [
    ['07:11:44', '14:03:14'], ['08:39:45', '14:24:00'], ['08:45:06', '16:39:33'], ['', ''],
    ['07:07:15', '16:54:45'], ['07:11:38', '16:26:25'], ['10:22:06', '16:50:13'], ['08:55:26', '14:13:14'],
    ['07:02:47', '15:27:35'], ['06:59:14', '16:35:24'], ['', ''], ['08:21:54', '14:15:51'],
    ['07:18:25', '10:00:00'], ['07:09:36', '14:09:57'], ['07:13:25', '15:49:26'], ['08:22:19', '10:52:19'],
    ['08:11:27', '15:37:43'], ['', ''], ['07:30', '14:00'], ['07:30', '14:00'],
    ['11:30:00', '15:11:22'], ['07:57:30', '16:44:42'], ['08:01:26', '16:37:29'], ['07:41:14', '14:16:07'],
    ['', ''], ['10:38:39', '16:19:01'], ['10:03:01', '16:57:33'], ['06:50:57', '14:14:05'],
    ['08:08:17', '14:47:48'], ['07:55:26', '14:00:00'],
  ];
  const rows = scans.map(([scanIn, scanOut], index) => {
    const day = index + 1;
    return {
      ...log(day === 19 || day === 20 ? 'MASUK' : '', scanIn, scanOut, `${String(day).padStart(2, '0')}-09-2026`),
      scanMasukAuto: day === 21,
      scanPulangAuto: day === 13 || day === 16,
      duration: day === 19 || day === 20 ? 390 : 0,
    };
  });
  const offDays = new Set(periodCalendarFromData('2026-09', {}).premiumDates);
  const summary = recalculateLoyalisSummary(rows, 6.5, (tanggal) => offDays.has(loyalisLogDateToIso(tanggal)));
  assert.equal(summary.minutes, 8_455);
  assert.equal(summary.activeDaysCount, 26);
  assert.equal(summary.incompleteDaysCount, 0);
  const absenceMinutes = 26 * 6.5 * 60 - summary.minutes;
  const stratum = loyalisPresenceStratum(absenceMinutes, 26);
  const amounts = loyalisPresenceAmounts({
    workingDays: 26,
    expectedHours: 6.5,
    entries: { employee: { absenceMinutes, deduction: stratum.deduction } },
  }, 'employee');
  assert.equal(absenceMinutes, 1_685);
  assert.equal(amounts.presensiEarning - amounts.presensiDeduction, 232_512);
  assert.equal(amounts.presenceBonus - amounts.presenceDeduction, 0);
});
