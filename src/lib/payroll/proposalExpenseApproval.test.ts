import assert from 'node:assert/strict';
import test from 'node:test';
import {
  createExpenseReport,
  createExpenseReportRow,
  ensureExpenseRowIds,
  ProposalExpenseRow,
} from './proposalExpenseReports';
import { validateLpjApproval } from './proposalExpenseApproval';

function makeRows(): ProposalExpenseRow[] {
  return ensureExpenseRowIds([
    { type: 'group_header', uraian: 'A. Pembayaran Tim', rincianQty: '', rincianRate: 0 },
    { type: 'item', uraian: 'Honor', rincianQty: '2', rincianRate: 100_000, realisasi: 150_000 },
  ]);
}

test('requires every populated LPJ group header to have a matching report', () => {
  const rows = makeRows();
  const result = validateLpjApproval(rows, []);
  assert.equal(result.valid, false);
  assert.ok(result.errors[0].includes('belum terhubung'));
});

test('rejects links stored on child expense rows', () => {
  const rows = makeRows();
  rows[1].reportId = 'report-1';
  const result = validateLpjApproval(rows, []);
  assert.ok(result.errors.some((error) => error.includes('Baris anak LPJ')));
});

test('requires active employees and produces report workers from actuals', () => {
  const rows = makeRows();
  const report = createExpenseReport('report-1', rows[0].rowId!, rows[0].uraian, 'employee', [
    createExpenseReportRow({
      uraian: 'Honor',
      employeeId: 'e1',
      employeeName: 'Pegawai Satu',
      rincianQty: '2',
      rincianRate: 100_000,
      realisasi: 150_000,
    }),
  ]);
  report.title = 'Pembayaran Tim';
  rows[0].reportId = report.id;

  const result = validateLpjApproval(rows, [report], new Set(['e1']));
  assert.equal(result.valid, true);
  assert.deepEqual(result.workersByReport.get('report-1'), [{ employeeId: 'e1', employeeName: 'Pegawai Satu', payGiven: 150_000 }]);
});

test('rejects an employee that is no longer active', () => {
  const rows = makeRows();
  const report = createExpenseReport('report-1', rows[0].rowId!, rows[0].uraian, 'employee', [
    createExpenseReportRow({ uraian: 'Honor', employeeId: 'stale', employeeName: 'Pegawai Lama', rincianQty: '1', rincianRate: 100_000, realisasi: 100_000 }),
  ]);
  report.title = 'Pembayaran Tim';
  rows[0].reportId = report.id;
  const result = validateLpjApproval(rows, [report], new Set());
  assert.equal(result.valid, false);
  assert.ok(result.errors.some((error) => error.includes('tidak aktif')));
});
