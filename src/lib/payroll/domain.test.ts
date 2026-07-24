import assert from 'node:assert/strict';
import test from 'node:test';
import {
  calculatePayrollTotals,
  dedupeSatpamActivityReports,
  getRegularSatpamPayType,
  getShiftIsoBounds,
  guardDutyIndexId,
  isTransferEligibleStatus,
  payrollPeriodForDutyDate,
  SATPAM_RATES,
  shiftOccurrenceId,
} from './domain';

test('Thursday night remains Thursday regular duty and ends Friday', () => {
  assert.equal(getRegularSatpamPayType('2026-07-23', new Set()), 'Harian');
  assert.deepEqual(getShiftIsoBounds('2026-07-23', 'Malam'), {
    startsAtIso: '2026-07-23T22:00:00+07:00',
    endsAtIso: '2026-07-24T08:00:00+07:00',
  });
  assert.equal(payrollPeriodForDutyDate('2026-07-23'), '2026-07');
});

test('Friday and configured holidays use the premium rate', () => {
  assert.equal(getRegularSatpamPayType('2026-07-24', new Set()), 'Jumat & Libur');
  assert.equal(
    getRegularSatpamPayType('2026-08-17', new Set(['2026-08-17'])),
    'Jumat & Libur',
  );
});

test('month-end night shift stays in the start-date payroll period', () => {
  assert.deepEqual(getShiftIsoBounds('2026-07-31', 'Malam'), {
    startsAtIso: '2026-07-31T22:00:00+07:00',
    endsAtIso: '2026-08-01T08:00:00+07:00',
  });
  assert.equal(payrollPeriodForDutyDate('2026-07-31'), '2026-07');
  assert.equal(getRegularSatpamPayType('2026-07-31', new Set()), 'Jumat & Libur');
});

test('canonical Satpam rates match the approved pay structure', () => {
  assert.deepEqual(SATPAM_RATES, {
    Harian: 12_500,
    'Jumat & Libur': 25_000,
    'Lembur Sendiri': 30_000,
    'Lembur Cover': 50_000,
    'Off-Duty': 0,
  });
});

test('financial and occurrence identifiers are deterministic', () => {
  assert.equal(
    shiftOccurrenceId('team_1', '2026-07-24', 'Malam'),
    shiftOccurrenceId('team_1', '2026-07-24', 'Malam'),
  );
  assert.equal(
    guardDutyIndexId('2026-07-24', 'Malam', 'SAT-001'),
    '20260724__malam__SAT-001',
  );
});

test('legacy read path deduplicates financial identity without mutating inputs', () => {
  const reports = [
    {
      id: 'a',
      employeeId: 'E1',
      activityDate: '2026-07-24',
      shiftName: 'Pagi',
      postName: 'Pos 1',
      shiftType: 'Harian',
      fee: 12_500,
    },
    {
      id: 'b',
      employeeId: 'E1',
      activityDate: '2026-07-24',
      shiftName: 'Pagi',
      postName: 'Pos 1',
      shiftType: 'Harian',
      fee: 12_500,
    },
  ];
  const result = dedupeSatpamActivityReports(reports);
  assert.equal(result.length, 1);
  assert.equal(reports.length, 2);
});

test('negative net pay is rejected and transfer eligibility is locked-only', () => {
  assert.throws(
    () => calculatePayrollTotals([{ label: 'Gaji', amount: 1 }], [{ label: 'Potongan', amount: 2 }]),
    /tidak boleh negatif/,
  );
  assert.equal(isTransferEligibleStatus('draft'), false);
  assert.equal(isTransferEligibleStatus('finance_verified'), false);
  assert.equal(isTransferEligibleStatus('confirmed'), true);
  assert.equal(isTransferEligibleStatus('locked'), true);
  assert.equal(isTransferEligibleStatus('paid'), true);
});
