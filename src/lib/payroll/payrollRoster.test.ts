import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildPayrollRoster,
  isPayrollEmployeeEligible,
  missingPayrollRosterEntries,
} from './payrollRoster';

test('payroll eligibility uses the same strict rules for Pekarya and Loyalis', () => {
  assert.equal(
    isPayrollEmployeeEligible('Employees_BlueCollar', {
      employment: { status: 'active' },
      flags: { isActive: true, isPayrollEligible: true },
    }),
    true,
  );
  assert.equal(
    isPayrollEmployeeEligible('Employees_BlueCollar', {
      employment: { status: 'inactive' },
      flags: { isActive: true, isPayrollEligible: true },
    }),
    false,
  );
  assert.equal(
    isPayrollEmployeeEligible('Employees_BlueCollar', {
      employment: { status: 'active' },
      flags: { isPayrollEligible: false },
    }),
    false,
  );
  assert.equal(
    isPayrollEmployeeEligible('Employees_Loyalis', {
      personal_info: { status: 'AKTIF' },
    }),
    true,
  );
  assert.equal(
    isPayrollEmployeeEligible('Employees_Loyalis', {
      personal_info: { status: 'NONAKTIF' },
    }),
    false,
  );
});

test('roster coverage exposes missing slips and duplicate employee ids', () => {
  const roster = buildPayrollRoster(
    [
      {
        id: 'shared-id',
        data: {
          name: 'Pekarya Satu',
          employment: { status: 'active' },
          flags: { isActive: true, isPayrollEligible: true },
        },
      },
      {
        id: 'inactive',
        data: {
          name: 'Tidak Aktif',
          employment: { status: 'inactive' },
          flags: { isActive: true, isPayrollEligible: true },
        },
      },
    ],
    [
      {
        id: 'shared-id',
        data: { personal_info: { name: 'Loyalis Satu', status: 'AKTIF' } },
      },
      {
        id: 'loyalis-2',
        data: { personal_info: { name: 'Loyalis Dua', status: 'AKTIF' } },
      },
    ],
  );

  assert.deepEqual(roster.duplicateEmployeeIds, ['shared-id']);
  assert.deepEqual(
    missingPayrollRosterEntries(
      roster.entries,
      new Set(['shared-id']),
    ).map((entry) => entry.employeeId),
    ['loyalis-2'],
  );
});
