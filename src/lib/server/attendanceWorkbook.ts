import * as XLSX from 'xlsx';
import {
  AttendanceNormalizedRow,
  normalizeAttendanceWorkbookRows,
} from '@/lib/payroll/attendance';

export interface ParsedAttendanceWorkbook {
  sheetName: string;
  rows: AttendanceNormalizedRow[];
  sourceRowCount: number;
  headers: string[];
}

export function parseAttendanceWorkbook(
  bytes: ArrayBuffer | Uint8Array | Buffer,
  period: string,
): ParsedAttendanceWorkbook {
  const workbook = XLSX.read(bytes, {
    type: bytes instanceof ArrayBuffer ? 'array' : 'buffer',
    raw: true,
    cellDates: false,
  });
  const sheetName = workbook.SheetNames[0];
  if (!sheetName) {
    throw new Error('Workbook presensi tidak memiliki sheet.');
  }
  const worksheet = workbook.Sheets[sheetName];
  const sourceRows = XLSX.utils.sheet_to_json<Record<string, unknown>>(worksheet, {
    defval: null,
    raw: true,
  });
  if (sourceRows.length === 0) {
    throw new Error('Workbook presensi kosong.');
  }
  const headers = Object.keys(sourceRows[0]);
  const normalizedHeaders = new Set(headers.map((header) => header.trim().toUpperCase()));
  if (
    !normalizedHeaders.has('TANGGAL') ||
    !normalizedHeaders.has('JAM KERJA') ||
    (!normalizedHeaders.has('NIPY') && !normalizedHeaders.has('PIN'))
  ) {
    throw new Error(
      'Format workbook wajib memiliki Tanggal, Jam kerja, serta NIPY atau PIN.',
    );
  }
  return {
    sheetName,
    rows: normalizeAttendanceWorkbookRows(sourceRows, period),
    sourceRowCount: sourceRows.length,
    headers,
  };
}

