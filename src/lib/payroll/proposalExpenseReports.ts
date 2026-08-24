/**
 * Generic reports attached to LPJ expense-group headers.
 *
 * The legacy report type and row interfaces at the bottom of this file are
 * intentionally kept as a read adapter. They are not used by the new UI,
 * but allow documents created before the generic report workflow to remain
 * readable and editable.
 */

export type ExpenseReportMode = 'employee' | 'expense';

/** Maximum size of a receipt persisted for an expense-only report. */
export const MAX_EXPENSE_REPORT_RECEIPT_BYTES = 1 * 1024 * 1024;

/** @deprecated Only used while normalizing old example-based documents. */
export type ExpenseReportType =
  | 'proposal_examiner'
  | 'munaqosyah_examiner'
  | 'pembimbing'
  | 'pedoman_kti'
  | 'committee'
  | 'receipt';

export interface ProposalExpenseRow {
  rowId?: string;
  type: 'item' | 'group_header';
  uraian: string;
  rincianQty: string;
  rincianRate: number;
  realisasi?: number;
  /** Stable link stored only on LPJ group-header rows. */
  reportId?: string;
  /** @deprecated Legacy records may still contain the old report type. */
  reportType?: ExpenseReportType;
}

export interface ExpenseReportRow {
  id: string;
  parentRowId?: string;
  parentUraian?: string;
  uraian: string;
  employeeId: string;
  employeeName: string;
  /** Search text is kept so an unfinished draft can be reopened safely. */
  employeeSearchText?: string;
  rincianQty: string;
  rincianRate: number;
  realisasi: number;
  note: string;
}

export interface ExpenseReportReceipt {
  url: string;
  fileName: string;
  /** The header item's uraian at upload time, so printouts don't need a separate lookup. */
  label: string;
}

export interface ExpenseReport {
  id: string;
  /** Must match the rowId of an LPJ group_header row. */
  expenseRowId: string;
  expenseLabel: string;
  title: string;
  mode: ExpenseReportMode;
  notes: string;
  rows: ExpenseReportRow[];
  /** Expense-mode only: one uploaded receipt per locked header item, keyed by its rowId. */
  receipts: Record<string, ExpenseReportReceipt>;
  source: 'custom' | 'legacy';
  /** @deprecated Present only when this report came from an old document. */
  legacyReportType?: ExpenseReportType;
  /** Original legacy payload, retained for a lossless read/migration path. */
  legacy?: Record<string, unknown>;
}

export interface ExpenseReportValidation {
  valid: boolean;
  errors: string[];
  populatedRows: ExpenseReportRow[];
  /** Informational only; repeated employee rows are valid in the report sandbox. */
  duplicateEmployeeIds: string[];
}

export function createStableId(prefix: string): string {
  const cryptoApi = typeof globalThis !== 'undefined' ? globalThis.crypto : undefined;
  if (cryptoApi?.randomUUID) {
    return `${prefix}-${cryptoApi.randomUUID()}`;
  }
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

/** Matches the quantity grammar already used by the proposal and LPJ pages. */
export function parseProposalQty(value: string): number {
  if (!value) return 0;
  const trimmed = String(value).trim();
  if (!trimmed) return 0;
  const parts = trimmed.split(/[xX\*]/);
  if (parts.length > 1) {
    let product = 1;
    for (const part of parts) {
      const cleanPart = part.trim();
      const match = cleanPart.match(/[\d.]+/);
      if (!match) continue;
      let parsed = parseFloat(match[0]);
      if (cleanPart.includes('%')) parsed /= 100;
      product *= parsed;
    }
    return Number.isFinite(product) ? product : 0;
  }
  if (trimmed.endsWith('%')) {
    const match = trimmed.match(/[\d.]+/);
    return match ? parseFloat(match[0]) / 100 : 1;
  }
  const match = trimmed.match(/[\d.]+/);
  // Descriptive quantities such as "Penanggung Jawab" represent one unit.
  return match ? parseFloat(match[0]) : 1;
}

export function createProposalExpenseRow(type: 'item' | 'group_header' = 'item'): ProposalExpenseRow {
  const row: ProposalExpenseRow = {
    rowId: createStableId('expense-row'),
    type,
    uraian: '',
    rincianQty: '',
    rincianRate: 0,
  };
  if (type === 'item') row.realisasi = 0;
  return row;
}

function toFiniteNumber(value: unknown, fallback = 0): number {
  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function normalizeText(value: unknown): string {
  return typeof value === 'string' ? value : value == null ? '' : String(value);
}

function isPlainObject(value: object): value is Record<string, unknown> {
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

/**
 * Removes undefined values before a proposal is sent to Firestore.
 *
 * Firestore sentinels, Timestamps, Dates, and references are class instances,
 * so only plain application objects are traversed. This keeps values such as
 * serverTimestamp() intact while cleaning legacy/UI objects at every depth.
 */
export function sanitizeForFirestore<T>(data: T): T {
  if (data === undefined) return null as unknown as T;
  if (data === null || typeof data !== 'object') return data;
  if (Array.isArray(data)) {
    return data.map((item) => sanitizeForFirestore(item)) as unknown as T;
  }
  if (!isPlainObject(data)) return data;

  const cleaned: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(data)) {
    if (value !== undefined) {
      cleaned[key] = sanitizeForFirestore(value);
    }
  }
  return cleaned as T;
}

function normalizeRow(raw: Partial<ExpenseReportRow> | Record<string, unknown>, index: number): ExpenseReportRow {
  const employeeName = normalizeText(raw.employeeName);
  const employeeId = normalizeText(raw.employeeId);
  const employeeSearchText = normalizeText(raw.employeeSearchText || employeeName);
  const rincianQty = normalizeText(raw.rincianQty);
  const rincianRate = Math.max(0, toFiniteNumber(raw.rincianRate));
  const storedRealisasi = Math.max(0, toFiniteNumber(raw.realisasi));
  const parsedQty = parseProposalQty(rincianQty);
  const calculatedRealisasi = Number.isFinite(parsedQty) ? parsedQty * rincianRate : 0;
  const row: ExpenseReportRow = {
    id: normalizeText(raw.id) || `expense-report-row-${index + 1}`,
    uraian: normalizeText(raw.uraian),
    employeeId,
    employeeName,
    employeeSearchText,
    rincianQty,
    rincianRate,
    realisasi: storedRealisasi > 0 ? storedRealisasi : calculatedRealisasi,
    note: normalizeText(raw.note),
  };
  if (raw.parentRowId) row.parentRowId = normalizeText(raw.parentRowId);
  if (raw.parentUraian) row.parentUraian = normalizeText(raw.parentUraian);
  return row;
}

export function createExpenseReportRow(seed: Partial<ExpenseReportRow> = {}): ExpenseReportRow {
  return normalizeRow({
    id: createStableId('expense-report-row'),
    uraian: '',
    employeeId: '',
    employeeName: '',
    employeeSearchText: '',
    rincianQty: '',
    rincianRate: 0,
    realisasi: 0,
    note: '',
    ...seed,
  }, 0);
}

/** Returns only children belonging to a given group header. */
export function getExpenseGroupRows(
  expenseRows: ProposalExpenseRow[],
  groupIndex: number,
): ProposalExpenseRow[] {
  if (expenseRows[groupIndex]?.type !== 'group_header') return [];
  const rows: ProposalExpenseRow[] = [];
  for (let index = groupIndex + 1; index < expenseRows.length; index += 1) {
    if (expenseRows[index].type === 'group_header') break;
    rows.push(expenseRows[index]);
  }
  return rows;
}

/**
 * Seeds a new report from the linked LPJ group's children. The child rows are
 * copied rather than referenced so the report can be edited independently.
 */
export function seedExpenseReportRows(
  expenseRows: ProposalExpenseRow[],
  groupIndex: number,
): ExpenseReportRow[] {
  const seeded = getExpenseGroupRows(expenseRows, groupIndex)
    .filter((row) => row.uraian.trim() || row.rincianQty.trim() || row.rincianRate || row.realisasi)
    .map((row, index) => createExpenseReportRow({
      id: createStableId(`expense-report-row-${index + 1}`),
      parentRowId: row.rowId,
      parentUraian: row.uraian,
      uraian: row.uraian,
      rincianQty: row.rincianQty,
      rincianRate: Math.max(0, toFiniteNumber(row.rincianRate)),
      realisasi: Math.max(0, toFiniteNumber(row.realisasi ?? parseProposalQty(row.rincianQty) * row.rincianRate)),
    }));
  return seeded.length > 0 ? seeded : [createExpenseReportRow()];
}

/** Returns report rows assigned to one locked LPJ detail item. */
export function getExpenseReportRowsForItem(
  report: ExpenseReport,
  item: Pick<ProposalExpenseRow, 'rowId' | 'uraian'>,
): ExpenseReportRow[] {
  return report.rows.filter((row) => {
    if (row.parentRowId) return row.parentRowId === item.rowId;
    if (row.parentUraian) return row.parentUraian === item.uraian;
    return row.uraian === item.uraian;
  });
}

/** Sums the quantities assigned to one locked LPJ detail item. */
export function getExpenseReportRowsQuantity(
  rows: ExpenseReportRow[],
  parseQty: (value: string) => number = parseProposalQty,
): number {
  return rows.reduce((sum, row) => sum + parseQty(row.rincianQty || '1'), 0);
}

/** Matches the report table's displayed subtotal for one locked LPJ detail item. */
export function getExpenseReportRowsSubtotal(
  rows: ExpenseReportRow[],
  parseQty: (value: string) => number = parseProposalQty,
): number {
  return rows.reduce((sum, row) => {
    const qty = parseQty(row.rincianQty || '1');
    return sum + (row.realisasi > 0 ? row.realisasi : qty * row.rincianRate);
  }, 0);
}

export function createExpenseReport(
  id: string,
  expenseRowId: string,
  expenseLabel: string,
  mode: ExpenseReportMode = 'employee',
  seedRows: ExpenseReportRow[] = [createExpenseReportRow()],
): ExpenseReport {
  return {
    id,
    expenseRowId,
    expenseLabel,
    title: '',
    mode,
    notes: '',
    rows: seedRows.map((row, index) => normalizeRow(row, index)),
    receipts: {},
    source: 'custom',
  };
}

export function getExpenseReportBudgetTotal(
  report: ExpenseReport,
  parseQty: (value: string) => number = parseProposalQty,
): number {
  return report.rows.reduce((sum, row) => {
    const qty = parseQty(row.rincianQty);
    return sum + (Number.isFinite(qty) ? qty : 0) * Math.max(0, toFiniteNumber(row.rincianRate));
  }, 0);
}

export function getExpenseReportActualTotal(report: ExpenseReport): number {
  return report.rows.reduce((sum, row) => sum + Math.max(0, toFiniteNumber(row.realisasi)), 0);
}

/**
 * Returns whether a report contains user-entered content worth keeping linked.
 * The title assigned by the editor when it opens a new report is only a
 * placeholder and must not turn an untouched draft into a linked report.
 */
export function hasExpenseReportContent(report: ExpenseReport): boolean {
  const title = report.title.trim();
  const defaultTitle = report.expenseLabel.trim() ? `Laporan ${report.expenseLabel.trim()}` : '';
  const hasCustomTitle = Boolean(title && title !== defaultTitle);
  const hasReceipt = Object.keys(report.receipts).length > 0;
  const hasRowContent = report.rows.some((row) => Boolean(
    row.uraian.trim() ||
    row.employeeId.trim() ||
    row.employeeName.trim() ||
    row.employeeSearchText?.trim() ||
    row.rincianQty.trim() ||
    row.rincianRate > 0 ||
    row.realisasi > 0 ||
    row.note.trim(),
  ));

  return hasCustomTitle || Boolean(report.notes.trim()) || hasReceipt || hasRowContent;
}

/** Kept as the generic replacement for the former type-specific total helper. */
export function getExpenseReportTotal(
  report: ExpenseReport,
  parseQty: (value: string) => number = parseProposalQty,
): number {
  return getExpenseReportBudgetTotal(report, parseQty);
}

export function getExpenseReportRowCount(report: ExpenseReport): number {
  return report.rows.length;
}

function isPopulatedRow(row: ExpenseReportRow): boolean {
  return Boolean(
    row.uraian.trim() ||
    row.employeeId.trim() ||
    row.employeeName.trim() ||
    row.employeeSearchText?.trim() ||
    row.rincianQty.trim() ||
    row.rincianRate ||
    row.realisasi ||
    row.note.trim(),
  );
}

export function validateExpenseReport(
  report: ExpenseReport,
  parseQty: (value: string) => number = parseProposalQty,
  getRowLabel: (row: ExpenseReportRow, index: number) => string = (_row, index) => `Baris ${index + 1}`,
): ExpenseReportValidation {
  const errors: string[] = [];
  const populatedRows = report.rows.filter(isPopulatedRow);
  const duplicateEmployeeIds: string[] = [];

  if (!report.expenseRowId.trim()) errors.push('Laporan belum terhubung ke header grup LPJ.');
  if (!report.title.trim()) errors.push('Judul laporan wajib diisi.');
  if (populatedRows.length === 0) errors.push('Tambahkan setidaknya satu rincian laporan.');

  const seenEmployeeIds = new Set<string>();
  report.rows.forEach((row, index) => {
    if (!isPopulatedRow(row)) return;
    const rowLabel = getRowLabel(row, index);
    const qty = parseQty(row.rincianQty);
    const rate = toFiniteNumber(row.rincianRate, NaN);
    const actual = toFiniteNumber(row.realisasi, NaN);
    if (!row.uraian.trim()) errors.push(`${rowLabel}: uraian wajib diisi.`);
    if (!Number.isFinite(qty) || qty <= 0) errors.push(`${rowLabel}: QTY harus lebih besar dari 0.`);
    if (!Number.isFinite(rate) || rate < 0) errors.push(`${rowLabel}: RATE tidak valid.`);
    if (!Number.isFinite(actual) || actual < 0) errors.push(`${rowLabel}: REALISASI tidak valid.`);

    if (report.mode === 'employee') {
      if (!row.employeeId.trim() || !row.employeeName.trim()) {
        errors.push(`${rowLabel}: pilih pegawai dari hasil pencarian dan hubungkan.`);
      }
      if (row.employeeId && seenEmployeeIds.has(row.employeeId)) {
        duplicateEmployeeIds.push(row.employeeId);
      }
      if (row.employeeId) seenEmployeeIds.add(row.employeeId);
      if (row.employeeSearchText?.trim() && !row.employeeId) {
        errors.push(`${rowLabel}: pencarian pegawai belum dihubungkan.`);
      }
    }
  });

  return { valid: errors.length === 0, errors, populatedRows, duplicateEmployeeIds };
}

function normalizeLegacyRows(raw: Record<string, unknown>, type: ExpenseReportType): ExpenseReportRow[] {
  const employeeRows = (value: unknown): Record<string, unknown>[] => Array.isArray(value)
    ? value.filter((row): row is Record<string, unknown> => Boolean(row && typeof row === 'object'))
    : [];

  if (type === 'receipt') {
    const rows = employeeRows(raw.receiptRows);
    return (rows.length ? rows : [{}]).map((row, index) => createExpenseReportRow({
      id: normalizeText(row.id) || createStableId(`legacy-receipt-${index + 1}`),
      uraian: normalizeText(row.itemName),
      rincianQty: normalizeText(row.qty || ''),
      rincianRate: Math.max(0, toFiniteNumber(row.unitPrice)),
      realisasi: Math.max(0, toFiniteNumber(row.qty) * toFiniteNumber(row.unitPrice)),
      note: normalizeText(row.note),
    }));
  }

  const rows = type === 'proposal_examiner' || type === 'munaqosyah_examiner'
    ? employeeRows(raw.examinerRows)
    : type === 'pembimbing'
      ? employeeRows(raw.pembimbingRows)
      : type === 'pedoman_kti'
        ? employeeRows(raw.pedomanRows)
        : employeeRows(raw.committeeRows);

  return (rows.length ? rows : [{}]).map((row, index) => {
    const qty = type === 'pedoman_kti' || type === 'committee'
      ? '1'
      : normalizeText(row.studentCount || '');
    const rate = type === 'pedoman_kti'
      ? toFiniteNumber(row.amount)
      : type === 'committee'
        ? toFiniteNumber(row.amount)
        : toFiniteNumber(row.rate);
    return createExpenseReportRow({
      id: normalizeText(row.id) || createStableId(`legacy-report-${index + 1}`),
      uraian: normalizeText(row.role || row.task || (type === 'committee' ? 'Kepanitiaan' : '')),
      employeeId: normalizeText(row.employeeId),
      employeeName: normalizeText(row.employeeName),
      employeeSearchText: normalizeText(row.employeeName),
      rincianQty: qty,
      rincianRate: Math.max(0, rate),
      realisasi: Math.max(0, type === 'pedoman_kti' || type === 'committee'
        ? rate
        : toFiniteNumber(row.studentCount) * rate),
    });
  });
}

function normalizeReceipts(raw: unknown): Record<string, ExpenseReportReceipt> {
  if (!raw || typeof raw !== 'object') return {};
  const result: Record<string, ExpenseReportReceipt> = {};
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    if (!value || typeof value !== 'object') continue;
    const url = normalizeText((value as Record<string, unknown>).url);
    if (!url) continue;
    result[key] = {
      url,
      fileName: normalizeText((value as Record<string, unknown>).fileName) || 'Bukti',
      label: normalizeText((value as Record<string, unknown>).label) || 'Bukti Pengeluaran',
    };
  }
  return result;
}

/**
 * Converts both the generic shape and the former example-specific shape to
 * the generic model. Unknown legacy fields are retained under `legacy`.
 */
export function normalizeExpenseReport(
  raw: unknown,
  fallback: Partial<Pick<ExpenseReport, 'expenseRowId' | 'expenseLabel'>> = {},
): ExpenseReport | null {
  if (!raw || typeof raw !== 'object') return null;
  const value = raw as Record<string, unknown>;
  const id = normalizeText(value.id);
  if (!id) return null;

  const legacyType = normalizeText(value.legacyReportType || value.reportType) as ExpenseReportType;
  const hasValidLegacyType = [
    'proposal_examiner',
    'munaqosyah_examiner',
    'pembimbing',
    'pedoman_kti',
    'committee',
    'receipt',
  ].includes(legacyType);
  const isGeneric = value.mode === 'employee' || value.mode === 'expense' || Array.isArray(value.rows);
  const mode: ExpenseReportMode = value.mode === 'expense' || legacyType === 'receipt' ? 'expense' : 'employee';
  const rows = isGeneric
    ? (Array.isArray(value.rows) ? value.rows : []).map((row, index) => normalizeRow(
      row as Record<string, unknown>,
      index,
    ))
    : hasValidLegacyType
      ? normalizeLegacyRows(value, legacyType)
      : [];

  return {
    id,
    expenseRowId: normalizeText(value.expenseRowId || fallback.expenseRowId),
    expenseLabel: normalizeText(value.expenseLabel || fallback.expenseLabel),
    title: normalizeText(value.title) || (hasValidLegacyType ? `Laporan ${normalizeText(value.expenseLabel || fallback.expenseLabel)}` : ''),
    mode,
    notes: normalizeText(value.notes),
    rows: rows.length ? rows : [createExpenseReportRow()],
    receipts: normalizeReceipts(value.receipts),
    source: isGeneric && value.source === 'legacy' ? 'legacy' : hasValidLegacyType ? 'legacy' : 'custom',
    ...(hasValidLegacyType ? { legacyReportType: legacyType } : {}),
    ...(!isGeneric && hasValidLegacyType ? { legacy: value } : {}),
  };
}

export function normalizeExpenseReports(rawReports: unknown, fallbackRows: ProposalExpenseRow[] = []): ExpenseReport[] {
  if (!Array.isArray(rawReports)) return [];
  return rawReports.map((raw) => {
    const value = raw && typeof raw === 'object' ? raw as Record<string, unknown> : {};
    const fallbackRow = fallbackRows.find((row) => row.reportId === value.id);
    return normalizeExpenseReport(raw, {
      expenseRowId: fallbackRow?.rowId,
      expenseLabel: fallbackRow?.uraian,
    });
  }).filter((report): report is ExpenseReport => Boolean(report));
}

/**
 * Legacy UI versions could put a link on an individual child row. Preserve
 * the first such link at its containing group header and clear child links so
 * the new group-only rule has one canonical representation.
 */
export function normalizeExpenseReportLinksToGroups(
  rows: ProposalExpenseRow[],
  reports: ExpenseReport[],
): { rows: ProposalExpenseRow[]; reports: ExpenseReport[] } {
  const nextRows = rows.map((row) => ({ ...row }));
  const nextReports = reports
    .filter(hasExpenseReportContent)
    .map((report) => ({ ...report }));
  const reportIds = new Set(nextReports.map((report) => report.id));

  nextRows.forEach((row) => {
    if (row.reportId && !reportIds.has(row.reportId)) {
      delete row.reportId;
      delete row.reportType;
    }
  });

  let groupIndex = -1;

  nextRows.forEach((row, index) => {
    if (row.type === 'group_header') {
      groupIndex = index;
      return;
    }
    if (row.type !== 'item' || !row.reportId || groupIndex < 0) return;
    const group = nextRows[groupIndex];
    if (!group.reportId) group.reportId = row.reportId;
    const report = nextReports.find((candidate) => candidate.id === row.reportId);
    if (report && report.expenseRowId === row.rowId && group.rowId) report.expenseRowId = group.rowId;
    delete row.reportId;
    delete row.reportType;
  });

  nextRows.forEach((row) => {
    if (row.type !== 'group_header' || !row.reportId || !row.rowId) return;
    const report = nextReports.find((candidate) => candidate.id === row.reportId);
    if (report) report.expenseRowId = row.rowId;
  });

  return { rows: nextRows, reports: nextReports };
}

export function ensureExpenseRowIds<T extends ProposalExpenseRow>(rows: T[]): T[] {
  return rows.map((row, index) => {
    if (row.rowId) return row;
    const label = row.uraian.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 24) || row.type;
    return { ...row, rowId: `expense-row-${index + 1}-${label}` };
  });
}
