import test from 'node:test';
import assert from 'node:assert';
import { buildPresensiLoyalisWorkbook, PresensiLoyalisExportRow } from './generatePresensiLoyalisXlsx';

test('buildPresensiLoyalisWorkbook creates an excel workbook with correct sheets and rows', () => {
  const sampleRows: PresensiLoyalisExportRow[] = [
    {
      excelName: 'Ahmad Loyalis',
      nipy: '12345',
      employeeId: 'EMP001',
      employeeName: 'Ahmad Loyalis',
      activeDaysCount: 25,
      incompleteDaysCount: 0,
      absentDaysCount: 0,
      minutes: 9750,
      absenceMinutes: 0,
      stratum: 1,
      deduction: 0,
      netBonus: 250000,
      isMatched: true,
      isNotFoundInExcel: false,
      dailyLogs: [
        {
          Tanggal: '01-08-2026',
          'Jam kerja': 'Masuk',
          'Scan masuk': '07:30',
          'Scan pulang': '14:00',
          duration: 390,
        },
      ],
    },
    {
      excelName: 'Budi Santoso',
      nipy: '67890',
      employeeId: 'EMP002',
      employeeName: 'Budi Santoso',
      activeDaysCount: 20,
      incompleteDaysCount: 2,
      absentDaysCount: 3,
      minutes: 7800,
      absenceMinutes: 1950,
      stratum: 5,
      deduction: 250000,
      netBonus: 0,
      isMatched: true,
      isNotFoundInExcel: false,
    },
  ];

  const { workbook, filename } = buildPresensiLoyalisWorkbook({
    month: 8,
    year: 2026,
    workingDays: 25,
    expectedHours: 6.5,
    rows: sampleRows,
    strataFilter: 'all',
  });

  assert.ok(workbook, 'Workbook should be generated');
  assert.strictEqual(filename, 'Data_Perhitungan_Presensi_Tersimpan_Loyalis_2026_08.xlsx');
  assert.strictEqual(workbook.SheetNames.length, 2);
  assert.strictEqual(workbook.SheetNames[0], 'Rekap Presensi Loyalis');
  assert.strictEqual(workbook.SheetNames[1], 'Detail Log Harian');
});
