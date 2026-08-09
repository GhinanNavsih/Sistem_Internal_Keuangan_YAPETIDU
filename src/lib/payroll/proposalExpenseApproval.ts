import {
  buildExpenseReportWorkers,
  ExpenseReport,
  ExpenseReportWorker,
  ProposalExpenseRow,
  validateExpenseReport,
} from './proposalExpenseReports';

export interface LpjApprovalValidation {
  valid: boolean;
  errors: string[];
  linkedReports: ExpenseReport[];
  workersByReport: Map<string, ExpenseReportWorker[]>;
}
/**
 * Pure approval validation shared by the protected API and focused tests.
 * It deliberately treats LPJ group headers as the only legal link target.
 */
export function validateLpjApproval(
  lpjRows: ProposalExpenseRow[],
  reports: ExpenseReport[],
  activeEmployeeIds?: Set<string>,
): LpjApprovalValidation {
  const errors: string[] = [];
  const reportsById = new Map(reports.map((report) => [report.id, report]));
  const linkedReports: ExpenseReport[] = [];
  const workersByReport = new Map<string, ExpenseReportWorker[]>();
  const referencedReportIds = new Set<string>();

  lpjRows.forEach((row, index) => {
    if (row.type === 'item' && row.reportId) {
      errors.push(`Baris anak LPJ ${index + 1} tidak boleh memiliki hubungan laporan.`);
    }
  });

  lpjRows.forEach((row, index) => {
    if (row.type !== 'group_header' || !row.uraian.trim()) return;
    if (!row.reportId) {
      errors.push(`Header grup "${row.uraian}" belum terhubung ke laporan.`);
      return;
    }
    referencedReportIds.add(row.reportId);
    const report = reportsById.get(row.reportId);
    if (!report) {
      errors.push(`Laporan untuk header grup "${row.uraian}" tidak ditemukan.`);
      return;
    }
    if (report.expenseRowId !== row.rowId) {
      errors.push(`Laporan "${report.title || report.id}" tidak cocok dengan rowId header grup "${row.uraian}".`);
      return;
    }

    const validation = validateExpenseReport(report);
    validation.errors.forEach((error) => errors.push(`${report.title || `Laporan ${index + 1}`}: ${error}`));
    if (report.mode === 'employee') {
      validation.populatedRows.forEach((reportRow) => {
        if (activeEmployeeIds && reportRow.employeeId && !activeEmployeeIds.has(reportRow.employeeId)) {
          errors.push(`${report.title || `Laporan ${index + 1}`}: pegawai "${reportRow.employeeName || reportRow.employeeId}" tidak aktif atau tidak ditemukan.`);
        }
      });
      if (!validation.errors.length) {
        workersByReport.set(report.id, buildExpenseReportWorkers(report));
      }
    }
    linkedReports.push(report);
  });

  reports.forEach((report) => {
    if (!referencedReportIds.has(report.id)) {
      errors.push(`Laporan "${report.title || report.id}" tidak terhubung ke header grup LPJ.`);
    }
  });

  return {
    valid: errors.length === 0,
    errors: Array.from(new Set(errors)),
    linkedReports,
    workersByReport,
  };
}
