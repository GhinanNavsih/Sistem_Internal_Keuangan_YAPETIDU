import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildExpenseReportWorkers,
  createExpenseReport,
  createExpenseReportRow,
  ensureExpenseRowIds,
  getExpenseGroupRows,
  getExpenseReportActualTotal,
  getExpenseReportBudgetTotal,
  normalizeExpenseReportLinksToGroups,
  normalizeExpenseReport,
  parseProposalQty,
  ProposalExpenseRow,
  sanitizeForFirestore,
  seedExpenseReportRows,
  validateExpenseReport,
} from './proposalExpenseReports';

test('removes undefined fields without altering Firestore-compatible class values', () => {
  class Sentinel {}
  const sentinel = new Sentinel();
  const cleaned = sanitizeForFirestore({
    omitted: undefined,
    nested: { keep: 'value', omitted: undefined },
    list: [undefined, { keep: 1, omitted: undefined }],
    sentinel,
  });

  assert.deepEqual(cleaned, {
    nested: { keep: 'value' },
    list: [null, { keep: 1 }],
    sentinel,
  });
  assert.equal(cleaned.sentinel, sentinel);
});

test('uses the proposal quantity parser for generic report totals', () => {
  const report = createExpenseReport('report-1', 'group-1', 'Honorarium', 'employee', [
    createExpenseReportRow({ uraian: 'Penguji', rincianQty: '2 x 50%', rincianRate: 100_000, realisasi: 75_000 }),
    createExpenseReportRow({ uraian: 'Ketua', rincianQty: '3', rincianRate: 50_000, realisasi: 125_000 }),
  ]);

  assert.equal(parseProposalQty('2 x 50%'), 1);
  assert.equal(getExpenseReportBudgetTotal(report), 250_000);
  assert.equal(getExpenseReportActualTotal(report), 200_000);
});

test('seeds a report only from the selected LPJ header group children', () => {
  const rows = ensureExpenseRowIds([
    { type: 'group_header', uraian: 'A. Penguji', rincianQty: '', rincianRate: 0 },
    { type: 'item', uraian: 'Ujian 1', rincianQty: '2', rincianRate: 40_000, realisasi: 35_000 },
    { type: 'item', uraian: 'Ujian 2', rincianQty: '1', rincianRate: 60_000, realisasi: 60_000 },
    { type: 'group_header', uraian: 'B. Konsumsi', rincianQty: '', rincianRate: 0 },
    { type: 'item', uraian: 'Air minum', rincianQty: '10', rincianRate: 3_000, realisasi: 25_000 },
  ]);

  assert.equal(getExpenseGroupRows(rows, 0).length, 2);
  assert.deepEqual(seedExpenseReportRows(rows, 0).map((row) => [row.uraian, row.rincianQty, row.rincianRate, row.realisasi]), [
    ['Ujian 1', '2', 40_000, 35_000],
    ['Ujian 2', '1', 60_000, 60_000],
  ]);
});

test('validates connected employees, stale searches, and duplicate employees', () => {
  const report = createExpenseReport('report-1', 'group-1', 'Pembayaran Penguji', 'employee', [
    createExpenseReportRow({ id: 'row-1', uraian: 'Penguji', employeeId: 'e1', employeeName: 'Satu', employeeSearchText: 'Satu', rincianQty: '1', rincianRate: 100_000, realisasi: 90_000 }),
    createExpenseReportRow({ id: 'row-2', uraian: 'Ketua', employeeId: 'e1', employeeName: 'Satu', employeeSearchText: 'Satu', rincianQty: '1', rincianRate: 100_000, realisasi: 90_000 }),
    createExpenseReportRow({ id: 'row-3', uraian: 'Sekretaris', employeeSearchText: 'Nama tidak ditemukan', rincianQty: '1', rincianRate: 50_000, realisasi: 50_000 }),
  ]);
  report.title = 'Pembayaran Penguji';

  const result = validateExpenseReport(report);
  assert.equal(result.valid, false);
  assert.deepEqual(result.duplicateEmployeeIds, ['e1']);
  assert.ok(result.errors.some((error) => error.includes('pegawai yang sama')));
  assert.ok(result.errors.some((error) => error.includes('pencarian pegawai belum dihubungkan')));
});

test('expense-only reports do not require employees and use actual amounts for payroll workers only in employee mode', () => {
  const report = createExpenseReport('report-1', 'group-1', 'Konsumsi', 'expense', [
    createExpenseReportRow({ uraian: 'Konsumsi rapat', rincianQty: '4', rincianRate: 25_000, realisasi: 90_000 }),
  ]);
  report.title = 'Kwitansi Konsumsi';
  assert.equal(validateExpenseReport(report).valid, true);
  assert.deepEqual(buildExpenseReportWorkers(report), []);
});

test('approved employee workers are paid from REALISASI and not ANGGARAN', () => {
  const report = createExpenseReport('report-1', 'group-1', 'Pembayaran', 'employee', [
    createExpenseReportRow({ uraian: 'Penguji', employeeId: 'e1', employeeName: 'Satu', rincianQty: '2', rincianRate: 100_000, realisasi: 125_000 }),
  ]);
  assert.deepEqual(buildExpenseReportWorkers(report), [{ employeeId: 'e1', employeeName: 'Satu', payGiven: 125_000 }]);
});

test('normalizes the old example-based report shape into generic rows', () => {
  const normalized = normalizeExpenseReport({
    id: 'legacy-1',
    expenseRowId: 'group-1',
    expenseLabel: 'A. Ujian Proposal',
    reportType: 'proposal_examiner',
    title: 'VAKASI PENGUJI PROPOSAL',
    notes: '',
    examinerRows: [{ id: 'old-row', employeeId: 'e1', employeeName: 'Satu', role: 'Penguji', studentCount: 2, rate: 40_000 }],
  });

  assert.ok(normalized);
  assert.equal(normalized?.mode, 'employee');
  assert.equal(normalized?.source, 'legacy');
  assert.equal(normalized?.legacyReportType, 'proposal_examiner');
  assert.deepEqual(normalized?.rows[0], {
    id: 'old-row',
    uraian: 'Penguji',
    employeeId: 'e1',
    employeeName: 'Satu',
    employeeSearchText: 'Satu',
    rincianQty: '2',
    rincianRate: 40_000,
    realisasi: 80_000,
    note: '',
  });
});

test('normalizes legacy expense rows without replacing existing row IDs', () => {
  const normalized = ensureExpenseRowIds([
    { type: 'group_header', uraian: 'A. Pengeluaran', rincianQty: '', rincianRate: 0 },
    { rowId: 'existing-row', type: 'item', uraian: 'Konsumsi', rincianQty: '2', rincianRate: 10_000 },
    { type: 'item', uraian: '', rincianQty: '', rincianRate: 0 },
  ]);

  assert.equal(normalized[0].rowId, 'expense-row-1-a-pengeluaran');
  assert.equal(normalized[1].rowId, 'existing-row');
  assert.equal(normalized[2].rowId, 'expense-row-3-item');
});

test('moves a legacy child-row link to its containing group header', () => {
  const rows: ProposalExpenseRow[] = ensureExpenseRowIds([
    { type: 'group_header', uraian: 'A. Tim', rincianQty: '', rincianRate: 0 },
    { type: 'item', uraian: 'Honor', rincianQty: '1', rincianRate: 100_000, reportId: 'legacy-report' },
  ]);
  const report = normalizeExpenseReport({
    id: 'legacy-report',
    expenseRowId: rows[1].rowId,
    expenseLabel: 'Honor',
    reportType: 'committee',
    title: 'Laporan Lama',
    committeeRows: [{ id: 'old-row', employeeId: 'e1', employeeName: 'Satu', amount: 100_000 }],
  });
  assert.ok(report);
  const normalized = normalizeExpenseReportLinksToGroups(rows, [report!]);
  assert.equal(normalized.rows[0].reportId, 'legacy-report');
  assert.equal(normalized.rows[1].reportId, undefined);
  assert.equal(normalized.reports[0].expenseRowId, normalized.rows[0].rowId);
});
