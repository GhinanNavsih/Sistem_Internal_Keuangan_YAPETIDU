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
  reportId?: string;
  reportType?: ExpenseReportType;
}

export interface ExpenseReportDefinition {
  type: ExpenseReportType;
  label: string;
  shortLabel: string;
  description: string;
  sourceDocument: string;
  defaultTitle: string;
  accent: 'blue' | 'violet' | 'amber' | 'emerald' | 'indigo' | 'rose';
}

export const EXPENSE_REPORT_DEFINITIONS: ExpenseReportDefinition[] = [
  {
    type: 'proposal_examiner',
    label: 'Vakasi Penguji Proposal',
    shortLabel: 'Penguji Proposal',
    description: 'Daftar penguji utama dan ketua penguji beserta jumlah mahasiswa dan tarif vakasi.',
    sourceDocument: 'Vakasi Penguji Proposal Skripsi 25-26.pdf',
    defaultTitle: 'VAKASI PENGUJI PROPOSAL SKRIPSI',
    accent: 'blue',
  },
  {
    type: 'munaqosyah_examiner',
    label: 'Vakasi Penguji Munaqosyah',
    shortLabel: 'Penguji Munaqosyah',
    description: 'Daftar penguji utama, ketua penguji, dan sekretaris munaqosyah.',
    sourceDocument: 'Vakasi Penguji Munaqosyah Skripsi 25-26.pdf',
    defaultTitle: 'VAKASI PENGUJI MUNAQOSYAH SKRIPSI',
    accent: 'indigo',
  },
  {
    type: 'pembimbing',
    label: 'Vakasi Pembimbing',
    shortLabel: 'Pembimbing',
    description: 'Daftar pembimbing 1 dan pembimbing 2 berdasarkan jumlah mahasiswa.',
    sourceDocument: 'Vakasi Pembimbing Skripsi 25-26.pdf',
    defaultTitle: 'VAKASI PEMBIMBING SKRIPSI',
    accent: 'emerald',
  },
  {
    type: 'pedoman_kti',
    label: 'Vakasi Penyusun Pedoman KTI',
    shortLabel: 'Penyusun Pedoman KTI',
    description: 'Daftar penyusun pedoman, tugas, dan nominal vakasi masing-masing.',
    sourceDocument: 'Vakasi Penyusun Pedoman KTI Skripsi 25-26.pdf',
    defaultTitle: 'VAKASI PENYUSUN PEDOMAN KTI',
    accent: 'violet',
  },
  {
    type: 'committee',
    label: 'Vakasi Kepanitiaan',
    shortLabel: 'Kepanitiaan',
    description: 'Daftar panitia dan nominal vakasi yang menjadi bagian dari biaya kepanitiaan.',
    sourceDocument: 'Vakasi Kepanitiaan Skripsi FAI25-26.pdf',
    defaultTitle: 'KEPANITIAAN SKRIPSI',
    accent: 'rose',
  },
  {
    type: 'receipt',
    label: 'Kwitansi / Nota',
    shortLabel: 'Kwitansi / Nota',
    description: 'Rincian pembelian dan bukti pengeluaran untuk konsumsi, ATK, rapat, atau biaya lain.',
    sourceDocument: 'LPJ (Kwitansi dan Nota).pdf',
    defaultTitle: 'LPJ KWITANSI DAN NOTA',
    accent: 'amber',
  },
];

export interface ExaminerReportRow {
  id: string;
  employeeId: string;
  employeeName: string;
  role: string;
  studentCount: number;
  rate: number;
}

export interface PembimbingReportRow {
  id: string;
  employeeId: string;
  employeeName: string;
  role: string;
  studentCount: number;
  rate: number;
}

export interface PedomanReportRow {
  id: string;
  employeeId: string;
  employeeName: string;
  task: string;
  amount: number;
}

export interface CommitteeReportRow {
  id: string;
  employeeId: string;
  employeeName: string;
  amount: number;
}

export interface ReceiptReportRow {
  id: string;
  itemName: string;
  qty: number;
  unitPrice: number;
  note: string;
}

export interface ExpenseReport {
  id: string;
  expenseRowId: string;
  expenseLabel: string;
  reportType: ExpenseReportType;
  title: string;
  notes: string;
  examinerRows: ExaminerReportRow[];
  pembimbingRows: PembimbingReportRow[];
  pedomanRows: PedomanReportRow[];
  committeeRows: CommitteeReportRow[];
  receiptRows: ReceiptReportRow[];
}

export function createStableId(prefix: string): string {
  const cryptoApi = typeof globalThis !== 'undefined' ? globalThis.crypto : undefined;
  if (cryptoApi?.randomUUID) {
    return `${prefix}-${cryptoApi.randomUUID()}`;
  }
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

export function getExpenseReportDefinition(type: ExpenseReportType): ExpenseReportDefinition {
  return EXPENSE_REPORT_DEFINITIONS.find((definition) => definition.type === type) || EXPENSE_REPORT_DEFINITIONS[0];
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

function createExaminerRow(role: string, rate: number): ExaminerReportRow {
  return {
    id: createStableId('examiner-row'),
    employeeId: '',
    employeeName: '',
    role,
    studentCount: 0,
    rate,
  };
}

function createPembimbingRow(role: string, rate: number): PembimbingReportRow {
  return {
    id: createStableId('pembimbing-row'),
    employeeId: '',
    employeeName: '',
    role,
    studentCount: 0,
    rate,
  };
}

function createPedomanRow(): PedomanReportRow {
  return {
    id: createStableId('pedoman-row'),
    employeeId: '',
    employeeName: '',
    task: '',
    amount: 0,
  };
}

function createCommitteeRow(): CommitteeReportRow {
  return {
    id: createStableId('committee-row'),
    employeeId: '',
    employeeName: '',
    amount: 0,
  };
}

function createReceiptRow(): ReceiptReportRow {
  return {
    id: createStableId('receipt-row'),
    itemName: '',
    qty: 1,
    unitPrice: 0,
    note: '',
  };
}

export function createExpenseReport(
  id: string,
  expenseRowId: string,
  expenseLabel: string,
  reportType: ExpenseReportType,
): ExpenseReport {
  const examinerRows = reportType === 'proposal_examiner'
    ? [createExaminerRow('Penguji Utama', 40000), createExaminerRow('Ketua Penguji', 35000)]
    : reportType === 'munaqosyah_examiner'
      ? [
        createExaminerRow('Penguji Utama', 55000),
        createExaminerRow('Ketua Penguji', 45000),
        createExaminerRow('Sekretaris', 35000),
      ]
      : [];

  return {
    id,
    expenseRowId,
    expenseLabel,
    reportType,
    title: getExpenseReportDefinition(reportType).defaultTitle,
    notes: '',
    examinerRows,
    pembimbingRows: reportType === 'pembimbing'
      ? [createPembimbingRow('Pembimbing 1', 140000), createPembimbingRow('Pembimbing 2', 95000)]
      : [],
    pedomanRows: reportType === 'pedoman_kti' ? [createPedomanRow()] : [],
    committeeRows: reportType === 'committee' ? [createCommitteeRow()] : [],
    receiptRows: reportType === 'receipt' ? [createReceiptRow()] : [],
  };
}

export function getExpenseReportTotal(report: ExpenseReport): number {
  if (report.reportType === 'proposal_examiner' || report.reportType === 'munaqosyah_examiner') {
    return report.examinerRows.reduce((sum, row) => sum + row.studentCount * row.rate, 0);
  }
  if (report.reportType === 'pembimbing') {
    return report.pembimbingRows.reduce((sum, row) => sum + row.studentCount * row.rate, 0);
  }
  if (report.reportType === 'pedoman_kti') {
    return report.pedomanRows.reduce((sum, row) => sum + row.amount, 0);
  }
  if (report.reportType === 'committee') {
    return report.committeeRows.reduce((sum, row) => sum + row.amount, 0);
  }
  return report.receiptRows.reduce((sum, row) => sum + row.qty * row.unitPrice, 0);
}

export function getExpenseReportRowCount(report: ExpenseReport): number {
  if (report.reportType === 'proposal_examiner' || report.reportType === 'munaqosyah_examiner') return report.examinerRows.length;
  if (report.reportType === 'pembimbing') return report.pembimbingRows.length;
  if (report.reportType === 'pedoman_kti') return report.pedomanRows.length;
  if (report.reportType === 'committee') return report.committeeRows.length;
  return report.receiptRows.length;
}

export function ensureExpenseRowIds<T extends ProposalExpenseRow>(rows: T[]): T[] {
  return rows.map((row, index) => {
    if (row.rowId) return row;
    const label = row.uraian.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 24) || row.type;
    return { ...row, rowId: `expense-row-${index + 1}-${label}` };
  });
}
