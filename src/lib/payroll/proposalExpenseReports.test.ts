import assert from 'node:assert/strict';
import test from 'node:test';
import {
  createExpenseReport,
  ensureExpenseRowIds,
  getExpenseReportRowCount,
  getExpenseReportTotal,
} from './proposalExpenseReports';

test('creates the report defaults reflected by the supplied vakasi documents', () => {
  const proposal = createExpenseReport('report-1', 'row-1', 'Vakasi Ujian Proposal', 'proposal_examiner');
  const munaqosyah = createExpenseReport('report-2', 'row-2', 'Vakasi Munaqosyah', 'munaqosyah_examiner');
  const pembimbing = createExpenseReport('report-3', 'row-3', 'Vakasi Pembimbing', 'pembimbing');

  assert.deepEqual(proposal.examinerRows.map((row) => [row.role, row.rate]), [
    ['Penguji Utama', 40000],
    ['Ketua Penguji', 35000],
  ]);
  assert.deepEqual(munaqosyah.examinerRows.map((row) => [row.role, row.rate]), [
    ['Penguji Utama', 55000],
    ['Ketua Penguji', 45000],
    ['Sekretaris', 35000],
  ]);
  assert.deepEqual(pembimbing.pembimbingRows.map((row) => [row.role, row.rate]), [
    ['Pembimbing 1', 140000],
    ['Pembimbing 2', 95000],
  ]);
});

test('calculates totals by report format', () => {
  const examiner = createExpenseReport('report-1', 'row-1', 'Penguji', 'proposal_examiner');
  examiner.examinerRows[0].studentCount = 2;
  examiner.examinerRows[1].studentCount = 3;
  assert.equal(getExpenseReportTotal(examiner), 185000);
  assert.equal(getExpenseReportRowCount(examiner), 2);

  const receipt = createExpenseReport('report-2', 'row-2', 'Nota', 'receipt');
  receipt.receiptRows[0].qty = 4;
  receipt.receiptRows[0].unitPrice = 12500;
  receipt.receiptRows.push({ id: 'receipt-2', itemName: 'ATK', qty: 2, unitPrice: 3000, note: '' });
  assert.equal(getExpenseReportTotal(receipt), 56000);
  assert.equal(getExpenseReportRowCount(receipt), 2);
});

test('normalizes legacy expense rows without replacing existing row IDs', () => {
  const normalized = ensureExpenseRowIds([
    { type: 'group_header', uraian: 'A. Ujian Proposal', rincianQty: '', rincianRate: 0 },
    { rowId: 'existing-row', type: 'item', uraian: 'Konsumsi', rincianQty: '2', rincianRate: 10000 },
    { type: 'item', uraian: '', rincianQty: '', rincianRate: 0 },
  ]);

  assert.equal(normalized[0].rowId, 'expense-row-1-a-ujian-proposal');
  assert.equal(normalized[1].rowId, 'existing-row');
  assert.equal(normalized[2].rowId, 'expense-row-3-item');
});
