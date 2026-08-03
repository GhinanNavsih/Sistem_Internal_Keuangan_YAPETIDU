import * as XLSX from 'xlsx';
import {
  normalizeAttendanceDate,
  normalizeAttendanceTime,
  normalizeNipy,
} from './attendance';

export type LoyalisPresenceWorkbookIssue =
  | 'IDENTITY_MISSING'
  | 'DATE_INVALID'
  | 'OUTSIDE_PERIOD'
  | 'STATUS_MISSING'
  | 'TIME_INVALID';

export interface LoyalisPresenceWorkbookRow {
  rowNumber: number;
  nipy: string;
  name: string;
  department: string;
  date: string;
  dateIso: string;
  workStatus: string;
  scanIn: string;
  scanOut: string;
  issues: LoyalisPresenceWorkbookIssue[];
}

export interface ParsedLoyalisPresenceWorkbook {
  sheetName: string;
  headers: string[];
  sourceRowCount: number;
  rows: LoyalisPresenceWorkbookRow[];
  outsidePeriodCount: number;
  invalidDateCount: number;
  invalidTimeCount: number;
  invalidStatusCount: number;
  missingIdentityCount: number;
}

type HeaderKey =
  | 'nipy'
  | 'pin'
  | 'name'
  | 'department'
  | 'date'
  | 'workStatus'
  | 'scanIn'
  | 'scanOut';

const HEADER_ALIASES: Record<HeaderKey, readonly string[]> = {
  nipy: ['nipy', 'niy'],
  pin: ['pin'],
  name: ['nama', 'namapegawai', 'name', 'employee', 'employeename'],
  department: ['departemen', 'department', 'unitkerja', 'satker'],
  date: ['tanggal', 'date', 'tanggalpresensi', 'presencedate'],
  workStatus: ['jamkerja', 'status', 'statuspresensi', 'kehadiran'],
  scanIn: ['scanmasuk', 'masuk', 'checkin', 'jammasuk', 'waktumasuk'],
  scanOut: ['scanpulang', 'pulang', 'checkout', 'jampulang', 'waktupulang'],
};

const HEADER_LOOKUP = new Map<string, HeaderKey>(
  Object.entries(HEADER_ALIASES).flatMap(([key, aliases]) =>
    aliases.map((alias) => [alias, key as HeaderKey]),
  ),
);

function normalizeHeader(value: unknown): string {
  return String(value ?? '')
    .normalize('NFKC')
    .replace(/\u00a0/g, ' ')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '');
}

function normalizeWorkStatus(value: unknown): string {
  const source = String(value ?? '').trim();
  const key = normalizeHeader(source);

  if (key === 'masuk' || key === 'hadir') return 'MASUK';
  if (key === 'tidakhadir' || key === 'absen' || key === 'alpha') {
    return 'Tidak Hadir';
  }
  if (key === 'liburrutin' || key === 'libur') return 'Libur Rutin';
  return source;
}

function formatDateForDisplay(dateIso: string): string {
  const [year, month, day] = dateIso.split('-');
  return `${day}-${month}-${year}`;
}

function isBlankRow(row: readonly unknown[]): boolean {
  return row.every((value) => String(value ?? '').trim() === '');
}

function findHeaderRow(rows: readonly (readonly unknown[])[]): {
  index: number;
  columns: Map<HeaderKey, number>;
} | null {
  const maxHeaderRows = Math.min(rows.length, 50);

  for (let rowIndex = 0; rowIndex < maxHeaderRows; rowIndex += 1) {
    const columns = new Map<HeaderKey, number>();
    rows[rowIndex].forEach((value, columnIndex) => {
      const key = HEADER_LOOKUP.get(normalizeHeader(value));
      if (key && !columns.has(key)) columns.set(key, columnIndex);
    });

    if (
      columns.has('name') &&
      columns.has('date') &&
      columns.has('workStatus')
    ) {
      return { index: rowIndex, columns };
    }
  }

  return null;
}

function getCell(
  row: readonly unknown[],
  columns: Map<HeaderKey, number>,
  key: HeaderKey,
): unknown {
  const index = columns.get(key);
  return index === undefined ? undefined : row[index];
}

export function parseLoyalisPresenceWorkbook(
  bytes: ArrayBuffer | Uint8Array,
  period: string,
): ParsedLoyalisPresenceWorkbook {
  if (!/^\d{4}-\d{2}$/.test(period)) {
    throw new Error('Periode presensi wajib menggunakan format YYYY-MM.');
  }

  const workbook = XLSX.read(bytes, {
    type: 'array',
    raw: true,
    cellDates: false,
  });

  let selectedSheetName = '';
  let selectedRows: unknown[][] = [];
  let selectedHeader: ReturnType<typeof findHeaderRow> = null;

  for (const sheetName of workbook.SheetNames) {
    const worksheet = workbook.Sheets[sheetName];
    const rows = XLSX.utils.sheet_to_json<unknown[]>(worksheet, {
      header: 1,
      defval: null,
      raw: true,
      blankrows: false,
    });
    const header = findHeaderRow(rows);
    if (header) {
      selectedSheetName = sheetName;
      selectedRows = rows;
      selectedHeader = header;
      break;
    }
  }

  if (!selectedSheetName || !selectedHeader) {
    throw new Error(
      'Format Excel tidak cocok. Pastikan memiliki kolom Nama, Tanggal, dan Jam kerja.',
    );
  }

  const headers = selectedRows[selectedHeader.index]
    .map((value) => String(value ?? '').trim())
    .filter(Boolean);
  const dataRows = selectedRows.slice(selectedHeader.index + 1);
  const sourceRowCount = dataRows.filter((row) => !isBlankRow(row)).length;
  const parsedRows: LoyalisPresenceWorkbookRow[] = [];
  let outsidePeriodCount = 0;
  let invalidDateCount = 0;
  let invalidTimeCount = 0;
  let invalidStatusCount = 0;
  let missingIdentityCount = 0;

  dataRows.forEach((row, dataIndex) => {
    if (isBlankRow(row)) return;

    const rowNumber = selectedHeader!.index + dataIndex + 2;
    const rawName = String(getCell(row, selectedHeader!.columns, 'name') ?? '').trim();
    const nipy =
      normalizeNipy(getCell(row, selectedHeader!.columns, 'nipy')) ||
      normalizeNipy(getCell(row, selectedHeader!.columns, 'pin'));
    const rawDate = getCell(row, selectedHeader!.columns, 'date');
    const dateIso = normalizeAttendanceDate(rawDate);
    const workStatus = normalizeWorkStatus(
      getCell(row, selectedHeader!.columns, 'workStatus'),
    );
    const rawScanIn = getCell(row, selectedHeader!.columns, 'scanIn');
    const rawScanOut = getCell(row, selectedHeader!.columns, 'scanOut');
    const scanInValue = normalizeAttendanceTime(rawScanIn);
    const scanOutValue = normalizeAttendanceTime(rawScanOut);
    const hasRawScanIn = rawScanIn !== undefined && rawScanIn !== null && rawScanIn !== '';
    const hasRawScanOut = rawScanOut !== undefined && rawScanOut !== null && rawScanOut !== '';
    const issues: LoyalisPresenceWorkbookIssue[] = [];

    if (!rawName && !nipy) {
      missingIdentityCount += 1;
      issues.push('IDENTITY_MISSING');
    }
    if (!dateIso) {
      invalidDateCount += 1;
      issues.push('DATE_INVALID');
    } else if (!dateIso.startsWith(`${period}-`)) {
      outsidePeriodCount += 1;
      issues.push('OUTSIDE_PERIOD');
    }
    if (!workStatus) {
      invalidStatusCount += 1;
      issues.push('STATUS_MISSING');
    }
    if ((hasRawScanIn && !scanInValue) || (hasRawScanOut && !scanOutValue)) {
      invalidTimeCount += 1;
      issues.push('TIME_INVALID');
    }

    if (
      !dateIso ||
      !dateIso.startsWith(`${period}-`) ||
      (!rawName && !nipy) ||
      !workStatus
    ) {
      return;
    }

    // A punch on a non-working status is a source-data artifact, not a payable
    // attendance event. Keep the row visible while preventing it from leaking
    // into the preview or saved daily logs.
    const isPresent = workStatus === 'MASUK';
    parsedRows.push({
      rowNumber,
      nipy,
      name: rawName,
      department: String(
        getCell(row, selectedHeader!.columns, 'department') ?? '',
      ).trim(),
      date: formatDateForDisplay(dateIso),
      dateIso,
      workStatus,
      scanIn: isPresent ? scanInValue || '' : '',
      scanOut: isPresent ? scanOutValue || '' : '',
      issues: Array.from(new Set(issues)),
    });
  });

  return {
    sheetName: selectedSheetName,
    headers,
    sourceRowCount,
    rows: parsedRows,
    outsidePeriodCount,
    invalidDateCount,
    invalidTimeCount,
    invalidStatusCount,
    missingIdentityCount,
  };
}
