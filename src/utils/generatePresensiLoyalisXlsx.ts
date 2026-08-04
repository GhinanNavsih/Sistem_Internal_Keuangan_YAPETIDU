import * as XLSX from 'xlsx';
import { MONTHS_ID } from '@/utils/rekapConfig';

export interface PresensiLoyalisExportRow {
  excelName: string;
  nipy?: string;
  employeeId?: string | null;
  employeeName?: string | null;
  activeDaysCount: number;
  incompleteDaysCount: number;
  absentDaysCount: number;
  minutes: number;
  absenceMinutes: number;
  stratum: number;
  deduction: number;
  netBonus: number;
  isMatched: boolean;
  isNotFoundInExcel?: boolean;
  dailyLogs?: any[];
}

export interface PresensiLoyalisExportOptions {
  month: number;
  year: number;
  workingDays: number;
  expectedHours: number;
  rows: PresensiLoyalisExportRow[];
  strataFilter?: string;
}

export function buildPresensiLoyalisWorkbook(options: PresensiLoyalisExportOptions): { workbook: XLSX.WorkBook; filename: string } {
  const monthName = MONTHS_ID[options.month - 1] || `Bulan ${options.month}`;
  const periodStr = `${monthName} ${options.year}`;
  const targetMinutes = options.workingDays * options.expectedHours * 60;
  const strataLabel =
    !options.strataFilter || options.strataFilter === 'all'
      ? 'Semua Strata'
      : `Strata ${options.strataFilter}`;

  // Header information rows
  const headerInfo = [
    ['DATA PERHITUNGAN PRESENSI LOYALIS TERSIMPAN'],
    [`PERIODE: ${periodStr.toUpperCase()}`],
    [
      `Hari Kerja Config: ${options.workingDays} Hari | Target Menit: ${targetMinutes.toLocaleString(
        'id-ID'
      )} Menit | Filter: ${strataLabel}`,
    ],
    [],
  ];

  // Column titles
  const tableHeader = [
    'NO',
    'NAMA PEGAWAI',
    'NIPY / ID PEGAWAI',
    'HARI AKTIF',
    'HARI TIDAK LENGKAP',
    'HARI TIDAK HADIR',
    'TOTAL MENIT KERJA',
    'KEKURANGAN (MENIT)',
    'UPAH PRESENSI (RP)',
    'STRATA BONUS',
    'POTONGAN PRESENSI (RP)',
    'BONUS PRESENSI (RP)',
    'STATUS DATA',
  ];

  let totalActiveDays = 0;
  let totalIncompleteDays = 0;
  let totalAbsentDays = 0;
  let totalMinutes = 0;
  let totalAbsenceMinutes = 0;
  let totalUpah = 0;
  let totalDeduction = 0;
  let totalBonus = 0;

  const dataRows = options.rows.map((row, idx) => {
    const isMatched = row.isMatched;
    const name = row.employeeName || row.excelName || '-';
    const nipyOrId = row.nipy
      ? row.nipy
      : row.employeeId
      ? row.employeeId
      : '-';

    const activeDays = row.activeDaysCount || 0;
    const incompleteDays = row.incompleteDaysCount || 0;
    const absentDays = row.absentDaysCount || 0;
    const mins = row.minutes || 0;
    const absMins = isMatched ? row.absenceMinutes || 0 : 0;
    const upah = isMatched ? Math.max(0, Math.round((mins / 60) * 1650)) : 0;
    const stratum = isMatched ? `Strata ${row.stratum || 5}` : '-';
    const deduct = isMatched ? row.deduction || 0 : 0;
    const bonus = isMatched ? row.netBonus || 0 : 0;

    let statusStr = 'Belum Terhubung';
    if (isMatched) {
      statusStr = row.isNotFoundInExcel ? 'Tidak Ada di Excel' : 'Terhubung';
    }

    totalActiveDays += activeDays;
    totalIncompleteDays += incompleteDays;
    totalAbsentDays += absentDays;
    totalMinutes += mins;
    totalAbsenceMinutes += absMins;
    totalUpah += upah;
    totalDeduction += deduct;
    totalBonus += bonus;

    return [
      idx + 1,
      name,
      nipyOrId,
      activeDays,
      incompleteDays,
      absentDays,
      mins,
      absMins,
      upah,
      stratum,
      deduct,
      bonus,
      statusStr,
    ];
  });

  // Summary Row
  const summaryRow = [
    '',
    'TOTAL',
    '',
    totalActiveDays,
    totalIncompleteDays,
    totalAbsentDays,
    totalMinutes,
    totalAbsenceMinutes,
    totalUpah,
    '',
    totalDeduction,
    totalBonus,
    '',
  ];

  const worksheetData = [
    ...headerInfo,
    tableHeader,
    ...dataRows,
    [],
    summaryRow,
  ];

  const worksheet = XLSX.utils.aoa_to_sheet(worksheetData);

  // Column formatting & width adjustments
  worksheet['!cols'] = [
    { wch: 6 },  // NO
    { wch: 32 }, // NAMA PEGAWAI
    { wch: 22 }, // NIPY / ID PEGAWAI
    { wch: 14 }, // HARI AKTIF
    { wch: 20 }, // HARI TIDAK LENGKAP
    { wch: 16 }, // HARI TIDAK HADIR
    { wch: 20 }, // TOTAL MENIT KERJA
    { wch: 20 }, // KEKURANGAN (MENIT)
    { wch: 20 }, // UPAH PRESENSI (RP)
    { wch: 16 }, // STRATA BONUS
    { wch: 24 }, // POTONGAN PRESENSI (RP)
    { wch: 22 }, // BONUS PRESENSI (RP)
    { wch: 18 }, // STATUS DATA
  ];

  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, 'Rekap Presensi Loyalis');

  // If daily logs are available in rows, add a 2nd sheet for daily log detail
  const allDailyLogRows: any[][] = [];
  options.rows.forEach((row) => {
    if (row.dailyLogs && row.dailyLogs.length > 0) {
      row.dailyLogs.forEach((log) => {
        allDailyLogRows.push([
          row.employeeName || row.excelName || '-',
          row.nipy || row.employeeId || '-',
          log.Tanggal || '-',
          log['Jam kerja'] || '-',
          log['Scan masuk'] || '-',
          log['Scan pulang'] || '-',
          log.duration !== undefined && log.duration !== null ? `${log.duration} min` : '-',
        ]);
      });
    }
  });

  if (allDailyLogRows.length > 0) {
    const dailySheetData = [
      ['DETAIL LOG PRESENSI HARIAN LOYALIS'],
      [`PERIODE: ${periodStr.toUpperCase()}`],
      [],
      [
        'NAMA PEGAWAI',
        'NIPY / ID',
        'TANGGAL',
        'STATUS JAM KERJA',
        'SCAN MASUK',
        'SCAN PULANG',
        'DURASI KERJA',
      ],
      ...allDailyLogRows,
    ];
    const dailyWorksheet = XLSX.utils.aoa_to_sheet(dailySheetData);
    dailyWorksheet['!cols'] = [
      { wch: 32 },
      { wch: 20 },
      { wch: 14 },
      { wch: 18 },
      { wch: 14 },
      { wch: 14 },
      { wch: 16 },
    ];
    XLSX.utils.book_append_sheet(
      workbook,
      dailyWorksheet,
      'Detail Log Harian'
    );
  }

  const cleanMonth = String(options.month).padStart(2, '0');
  const filename = `Data_Perhitungan_Presensi_Tersimpan_Loyalis_${options.year}_${cleanMonth}.xlsx`;
  return { workbook, filename };
}

export function generatePresensiLoyalisXlsx(options: PresensiLoyalisExportOptions): void {
  const { workbook, filename } = buildPresensiLoyalisWorkbook(options);
  XLSX.writeFile(workbook, filename);
}

