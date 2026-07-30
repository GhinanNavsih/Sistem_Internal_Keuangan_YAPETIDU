import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import {
  attendanceDayKey,
  consolidateAttendanceDays,
  hasSatpamAttendanceEvidence,
  isPremiumAttendanceDate,
  normalizeAttendanceWorkbookRow,
  normalizeNipy,
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

test('Friday and configured holidays use Jumat & Libur while duration is ignored', () => {
  const rows = [
    normalizeAttendanceWorkbookRow(
      {
        NIPY: 'P1',
        Tanggal: '07-08-2026',
        'Jam kerja': 'MASUK',
        'Scan masuk': '10:00:00',
      },
      2,
      '2026-08',
    ),
    normalizeAttendanceWorkbookRow(
      {
        NIPY: 'P1',
        Tanggal: '11-08-2026',
        'Jam kerja': 'MASUK',
        'Scan pulang': '10:00:01',
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
  assert.equal(summary.totalAmount, 50_000);
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
