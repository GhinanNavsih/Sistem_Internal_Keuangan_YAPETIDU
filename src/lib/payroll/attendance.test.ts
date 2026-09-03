import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import {
  attendanceDayKey,
  attendanceWorkedSeconds,
  autoFillAttendanceScan,
  classifyAttendanceDepartment,
  consolidateAttendanceDays,
  hasSatpamAttendanceEvidence,
  isPremiumAttendanceDate,
  normalizeAttendanceWorkbookRow,
  normalizeNipy,
  pekaryaAttendanceAmount,
  resolveEmployeeAttendanceNipy,
  summarizePekaryaAttendance,
} from './attendance';
import { parseAttendanceWorkbook } from '../server/attendanceWorkbook';

test('NIPY is preferred and conflicting PIN is reported', () => {
  const row = normalizeAttendanceWorkbookRow(
    {
      NIPY: ' np-001 ',
      PIN: '2',
      Tanggal: '01-08-2026',
      'Jam kerja': 'MASUK',
      'Scan masuk': '08:01:02',
      'Scan pulang': '14:02:03',
    },
    2,
    '2026-08',
  );
  assert.equal(row.nipy, 'NP-001');
  assert.equal(row.identifierSource, 'NIPY');
  assert.ok(row.issues.includes('IDENTIFIER_CONFLICT'));
});

test('existing Loyalis NIY is accepted as the attendance NIPY', () => {
  assert.equal(normalizeNipy('11 041010 174'), '11041010174');
  assert.equal(
    resolveEmployeeAttendanceNipy({
      personal_info: { employee_id_niy: ' 11010901001 ' },
    }),
    '11010901001',
  );
  assert.equal(
    resolveEmployeeAttendanceNipy({
      nipy: 'new-001',
      personal_info: { employee_id_niy: 'legacy-001' },
    }),
    'NEW-001',
  );
});

test('PIN falls back to NIPY and a one-sided MASUK punch is payable with warning', () => {
  const row = normalizeAttendanceWorkbookRow(
    {
      PIN: 'bc-001',
      Nama: 'Petugas',
      Tanggal: '02-08-2026',
      'Jam kerja': 'MASUK',
      'Scan masuk': '07:59:59',
      'Scan pulang': '',
    },
    2,
    '2026-08',
  );
  const days = consolidateAttendanceDays([row]);
  const summary = summarizePekaryaAttendance(
    normalizeNipy('bc-001'),
    days,
    new Set(),
  );
  assert.equal(summary.payableDays, 1);
  assert.equal(summary.harianCount, 1);
  assert.equal(summary.incompletePunchCount, 1);
});

test('Friday and configured holidays classify as Jumat & Libur and are paid for their hours', () => {
  const rows = [
    normalizeAttendanceWorkbookRow(
      {
        NIPY: 'P1',
        Tanggal: '07-08-2026',
        'Jam kerja': 'MASUK',
        'Scan masuk': '07:30:00',
        'Scan pulang': '14:00:00',
      },
      2,
      '2026-08',
    ),
    normalizeAttendanceWorkbookRow(
      {
        NIPY: 'P1',
        Tanggal: '11-08-2026',
        'Jam kerja': 'MASUK',
        'Scan masuk': '07:00:00',
        'Scan pulang': '20:00:00',
      },
      3,
      '2026-08',
    ),
  ];
  const summary = summarizePekaryaAttendance(
    'P1',
    consolidateAttendanceDays(rows),
    new Set(['2026-08-11']),
  );
  assert.equal(isPremiumAttendanceDate('2026-08-07', new Set()), true);
  assert.equal(summary.harianCount, 0);
  assert.equal(summary.jumatLiburCount, 2);
  // Both days fill the whole 07:30-14:00 window; the second scanned well
  // outside it and is clamped to the same 6.5 hours as the first.
  assert.equal(summary.days[0].amount, 25_001);
  assert.equal(summary.days[1].amount, 25_001);
});

test('pay is counted time on site, rounded up to the rupiah', () => {
  assert.equal(pekaryaAttendanceAmount('07:30:00', '14:00:00'), 12_500);
  // 1 second of work is Rp 0,534 and still owes a whole rupiah.
  assert.equal(pekaryaAttendanceAmount('08:00:00', '08:00:01'), 1);
  assert.equal(attendanceWorkedSeconds('08:00:00', '09:00:00'), 3_600);
  assert.equal(pekaryaAttendanceAmount('08:00:00', '09:00:00'), 1_924);
});

test('only time inside the 07:30-14:00 window is counted', () => {
  // Scanning early and leaving late earns the window, never more than 6.5h.
  assert.equal(attendanceWorkedSeconds('05:54:31', '17:15:58'), 23_400);
  assert.equal(pekaryaAttendanceAmount('05:54:31', '17:15:58'), 12_500);
  // Arriving late costs only the time actually missed.
  assert.equal(attendanceWorkedSeconds('08:30:00', '14:00:00'), 19_800);
  // A shift lying entirely outside the window counts for nothing.
  assert.equal(attendanceWorkedSeconds('14:30:00', '17:00:00'), 0);
  assert.equal(attendanceWorkedSeconds('05:00:00', '07:00:00'), 0);
});

test('Friday and holiday seconds are paid at the premium rate', () => {
  assert.equal(
    pekaryaAttendanceAmount('08:00:00', '09:00:00', true),
    2 * 1_924 - 1,
  );
  // A full premium window is worth twice a full ordinary one.
  assert.equal(pekaryaAttendanceAmount('07:30:00', '14:00:00', false), 12_500);
  assert.equal(pekaryaAttendanceAmount('07:30:00', '14:00:00', true), 25_001);
});

test('a forgotten scan is filled in 150 minutes off the one recorded, like Loyalis', () => {
  // Forgot scan pulang: scan keluar becomes scan masuk + 9,000 seconds.
  assert.equal(autoFillAttendanceScan('07:30:00', 'out'), '10:00:00');
  assert.equal(attendanceWorkedSeconds('07:30:00', null), 9_000);
  // Forgot scan masuk: scan masuk becomes scan keluar - 9,000 seconds.
  assert.equal(autoFillAttendanceScan('14:00:00', 'in'), '11:30:00');
  assert.equal(attendanceWorkedSeconds(null, '14:00:00'), 9_000);
  // Neither scan exists to fill from.
  assert.equal(autoFillAttendanceScan(null, 'out'), null);
  assert.equal(attendanceWorkedSeconds(null, null), 0);
  // The generated side is still clamped into the work window: a scan masuk
  // at 13:00 would fill scan keluar to 15:30, but the window ends at 14:00.
  assert.equal(autoFillAttendanceScan('13:00:00', 'out'), '14:00:00');
  assert.equal(attendanceWorkedSeconds('13:00:00', null), 3_600);
});

test('the offset is measured from the window boundary, not the raw scan, for a scan outside the window', () => {
  // Clocking in early earns no less than clocking in exactly at 07:30 would:
  // the known scan is clamped to the window boundary first, then offset by
  // 150 minutes from there — not offset from the raw early time and clamped
  // afterward, which would eat into the 150 minutes at the boundary.
  assert.equal(autoFillAttendanceScan('05:54:31', 'out'), '10:00:00');
  assert.equal(attendanceWorkedSeconds('05:54:31', null), 9_000);
  assert.equal(pekaryaAttendanceAmount('05:54:31', null), 4_808);

  // Symmetric for a late departure with a forgotten scan masuk.
  assert.equal(autoFillAttendanceScan('16:00:00', 'in'), '11:30:00');
  assert.equal(attendanceWorkedSeconds(null, '16:00:00'), 9_000);
  assert.equal(pekaryaAttendanceAmount(null, '16:00:00'), 4_808);
});

test('the day the scan was forgotten on is still paid for its filled time, and still flagged', () => {
  const oneSided = normalizeAttendanceWorkbookRow(
    { NIPY: 'P1', Tanggal: '04-08-2026', 'Jam kerja': 'CS', 'Scan masuk': '07:30:00' },
    2,
    '2026-08',
  );
  assert.ok(oneSided.issues.includes('INCOMPLETE_PUNCH'));
  const summary = summarizePekaryaAttendance(
    'P1',
    consolidateAttendanceDays([oneSided]),
    new Set(),
  );
  assert.equal(summary.harianCount, 1);
  // 9,000 seconds at the base rate, rounded up.
  assert.equal(summary.totalAmount, 4_808);
  // Still flagged for review — the day was never actually verified.
  assert.equal(summary.incompletePunchCount, 1);
  const [day] = summary.days;
  assert.equal(day.scanIn, '07:30:00');
  assert.equal(day.scanInAuto, false);
  assert.equal(day.scanOut, '10:00:00');
  assert.equal(day.scanOutAuto, true);
  // A scan pair that runs backwards is unusable rather than negative pay.
  assert.equal(pekaryaAttendanceAmount('14:00:00', '07:30:00'), 0);
});

test('a role label in the status column counts as a day on site', () => {
  const rows = ['STAFF', 'CS', 'SATPAM', 'TEKNISI'].map((status, index) =>
    normalizeAttendanceWorkbookRow(
      {
        NIPY: 'P1',
        Tanggal: `0${index + 1}-08-2026`,
        'Jam kerja': status,
        'Scan masuk': '07:30:00',
        'Scan pulang': '14:00:00',
      },
      index + 2,
      '2026-08',
    ),
  );
  const days = consolidateAttendanceDays(rows);
  assert.equal(days.every((day) => day.present), true);
  assert.equal(
    days.some((day) => day.issues.includes('SCAN_WITHOUT_MASUK')),
    false,
  );
  const absent = normalizeAttendanceWorkbookRow(
    { NIPY: 'P1', Tanggal: '05-08-2026', 'Jam kerja': 'Tidak Hadir' },
    6,
    '2026-08',
  );
  assert.equal(consolidateAttendanceDays([absent])[0].present, false);
});

test('duplicate employee-days produce at most one payment', () => {
  const rows = [
    normalizeAttendanceWorkbookRow(
      {
        PIN: 'P1',
        Tanggal: '03-08-2026',
        'Jam kerja': 'MASUK',
        'Scan masuk': '08:00',
      },
      2,
      '2026-08',
    ),
    normalizeAttendanceWorkbookRow(
      {
        PIN: 'P1',
        Tanggal: '03-08-2026',
        'Jam kerja': 'MASUK',
        'Scan pulang': '14:00',
      },
      3,
      '2026-08',
    ),
  ];
  const days = consolidateAttendanceDays(rows);
  assert.equal(days.length, 1);
  assert.ok(days[0].issues.includes('DUPLICATE_EMPLOYEE_DAY'));
  assert.equal(summarizePekaryaAttendance('P1', days, new Set()).payableDays, 1);
});

test('correction overlays can grant or remove presence without changing raw rows', () => {
  const row = normalizeAttendanceWorkbookRow(
    {
      NIPY: 'P1',
      Tanggal: '04-08-2026',
      'Jam kerja': 'Tidak Hadir',
    },
    2,
    '2026-08',
  );
  const grant = consolidateAttendanceDays(
    [row],
    new Map([[attendanceDayKey('P1', '2026-08-04'), { present: true }]]),
  );
  assert.equal(grant[0].present, true);
  assert.equal(grant[0].corrected, true);
  assert.equal(row.workStatus, 'TIDAK HADIR');

  const remove = consolidateAttendanceDays(
    [
      normalizeAttendanceWorkbookRow(
        {
          NIPY: 'P2',
          Tanggal: '04-08-2026',
          'Jam kerja': 'MASUK',
          'Scan masuk': '08:00',
        },
        3,
        '2026-08',
      ),
    ],
    new Map([[attendanceDayKey('P2', '2026-08-04'), { present: false }]]),
  );
  assert.equal(remove[0].present, false);

  const noScanGrant = consolidateAttendanceDays(
    [],
    new Map([
      [
        attendanceDayKey('P3', '2026-08-10'),
        { present: true, workStatus: 'MASUK' },
      ],
    ]),
  );
  assert.equal(noScanGrant.length, 1);
  assert.equal(noScanGrant[0].sourceRows[0], 0);
  assert.equal(
    summarizePekaryaAttendance('P3', noScanGrant, new Set()).harianCount,
    1,
  );
});

test('Malam evidence may come from its start date or following date', () => {
  const nextDayRow = normalizeAttendanceWorkbookRow(
    {
      NIPY: 'SAT-1',
      Tanggal: '06-08-2026',
      'Jam kerja': 'MASUK',
      'Scan pulang': '08:02:01',
    },
    2,
    '2026-08',
  );
  const days = consolidateAttendanceDays([nextDayRow]);
  assert.equal(
    hasSatpamAttendanceEvidence('SAT-1', '2026-08-05', 'Malam', days),
    true,
  );
  assert.equal(
    hasSatpamAttendanceEvidence('SAT-1', '2026-08-05', 'Pagi', days),
    false,
  );
});

test('June reference workbook parses its observed structure', () => {
  const workbookPath = path.resolve(process.cwd(), 'raw data presensi juni.xlsx');
  if (!fs.existsSync(workbookPath)) return;
  const parsed = parseAttendanceWorkbook(fs.readFileSync(workbookPath), '2026-06');
  assert.equal(parsed.sourceRowCount, 6_639);
  assert.equal(new Set(parsed.rows.map((row) => row.nipy)).size, 222);
  assert.equal(
    parsed.rows.filter((row) => row.issues.includes('INCOMPLETE_PUNCH')).length,
    574,
  );
});

test('department routing sends the blue collar departments to Pekarya', () => {
  assert.equal(classifyAttendanceDepartment('TEKNISI'), 'pekarya');
  assert.equal(classifyAttendanceDepartment(' cs '), 'pekarya');
  assert.equal(classifyAttendanceDepartment('Security'), 'pekarya');
  assert.equal(classifyAttendanceDepartment('driver'), 'pekarya');
});

test('every other department, including a blank one, stays with Loyalis', () => {
  assert.equal(classifyAttendanceDepartment('SDM'), 'loyalis');
  assert.equal(classifyAttendanceDepartment('REKTORAT'), 'loyalis');
  assert.equal(classifyAttendanceDepartment('FIK'), 'loyalis');
  assert.equal(classifyAttendanceDepartment(''), 'loyalis');
  assert.equal(classifyAttendanceDepartment(null), 'loyalis');
  assert.equal(classifyAttendanceDepartment(undefined), 'loyalis');
  // A department that merely contains a routed word is not a routed department.
  assert.equal(classifyAttendanceDepartment('BIRO UMUM'), 'loyalis');
  assert.equal(classifyAttendanceDepartment('CSR'), 'loyalis');
});

test('August reference workbook splits into the two review systems', () => {
  const workbookPath = path.resolve(process.cwd(), '2026_08.xlsx');
  if (!fs.existsSync(workbookPath)) return;
  const parsed = parseAttendanceWorkbook(fs.readFileSync(workbookPath), '2026-08');
  const pekarya = parsed.rows.filter(
    (row) => classifyAttendanceDepartment(row.department) === 'pekarya',
  );
  assert.equal(parsed.rows.length, 7_936);
  assert.equal(pekarya.length, 992);
  assert.deepEqual(
    Array.from(new Set(pekarya.map((row) => row.department))).sort(),
    ['CS', 'SECURITY', 'TEKNISI'],
  );
  // Every blue collar worker is exported with the scanner's own short PIN
  // rather than a payroll NIPY, which is why routing cannot depend on it.
  assert.equal(
    pekarya.every((row) => row.nipy.length <= 4),
    true,
  );
});
