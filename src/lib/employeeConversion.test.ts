import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildLoyalisEmployeeDocument,
  collectConversionIssues,
  conversionEffectivePeriod,
  conversionSourceForPeriod,
  employeeInPayrollPeriod,
  EmployeeConversionFacts,
  isConvertedAway,
  lastDayBeforePeriod,
  nextLoyalisEmployeeId,
  parseLoyalisConversionInput,
  prefillLoyalisConversionInput,
  shiftConversionPeriod,
  validateLoyalisConversionInput,
} from './employeeConversion';

/** Reads a dotted path out of a built document. */
function at(document: Record<string, unknown>, path: string): unknown {
  return path
    .split('.')
    .reduce<unknown>(
      (value, key) =>
        value && typeof value === 'object' ? (value as Record<string, unknown>)[key] : undefined,
      document,
    );
}

const pekarya = {
  employeeId: 'BC_012',
  name: 'Ahmad Fauzi',
  nik: '3517000000000001',
  phoneNumber: '081234567890',
  email: 'ahmad@example.com',
  nipy: '15010320001',
  employment: {
    status: 'active',
    jobCategory: 'SATPAM',
    startDate: '2020-03-01',
    dateRecognized: '',
  },
  bankAccount: { bankName: 'BSI', accountNumber: '7001234567', accountHolderName: 'Ahmad Fauzi' },
  bpjs: { allowanceAmount: 150000, deductionAmount: 50000 },
  deductions: { koperasiRochmad: 100000, kodeKopRochmad: 'KR-12' },
  salaryProfile: { salaryGradeCode: 'P2', tunjanganBeras: 75000 },
  flags: { isActive: true, isPayrollEligible: true },
  koperasiAuthUid: 'kop-uid-1',
  koperasiUserId: 'kop-user-1',
};

test('the effective period is the Jakarta month the switch is made in', () => {
  assert.equal(conversionEffectivePeriod('2026-10-03'), '2026-10');
  assert.equal(conversionEffectivePeriod('2027-01-31'), '2027-01');
  assert.throws(() => conversionEffectivePeriod('2026-02-30'));
  assert.equal(shiftConversionPeriod('2027-01', -1), '2026-12');
  assert.equal(shiftConversionPeriod('2026_12', 1), '2027-01');
  assert.equal(lastDayBeforePeriod('2026-03'), '2026-02-28');
  assert.equal(lastDayBeforePeriod('2027-01'), '2026-12-31');
});

test('new Loyalis ids continue after the highest existing number', () => {
  assert.equal(nextLoyalisEmployeeId([]), 'Loyalis_001');
  assert.equal(
    nextLoyalisEmployeeId(['Loyalis_009', 'Loyalis_045', 'Loyalis_010', 'BC_900', 'Loyalis_x']),
    'Loyalis_046',
  );
  assert.equal(nextLoyalisEmployeeId(['Loyalis_999']), 'Loyalis_1000');
});

test('prefill carries both service dates over, Diakui falling back to Mulai', () => {
  const input = prefillLoyalisConversionInput(pekarya);
  assert.equal(input.name, 'Ahmad Fauzi');
  assert.equal(input.phone, '081234567890');
  assert.equal(input.dateOfHire, '2020-03-01');
  assert.equal(input.dateRecognized, '2020-03-01');
  assert.equal(
    prefillLoyalisConversionInput({
      ...pekarya,
      employment: { ...pekarya.employment, dateRecognized: '2021-07-01' },
    }).dateRecognized,
    '2021-07-01',
  );
  assert.equal(input.departmentUnit, '');
  assert.equal(input.levelCode, '');
});

test('validation requires unit, type and start date; golongan is Super Admin only', () => {
  const input = {
    ...prefillLoyalisConversionInput(pekarya),
    departmentUnit: 'BAK',
    loyalisType: 'Admin' as const,
  };
  assert.deepEqual(validateLoyalisConversionInput(input, { canSetLevelCode: false }), {});

  const errors = validateLoyalisConversionInput(
    { ...input, departmentUnit: '', loyalisType: '', dateOfHire: '', levelCode: 'III/a' },
    { canSetLevelCode: false },
  );
  assert.ok(errors.departmentUnit);
  assert.ok(errors.loyalisType);
  assert.ok(errors.dateOfHire);
  assert.ok(errors.levelCode);
  assert.deepEqual(
    validateLoyalisConversionInput({ ...input, levelCode: 'III/a' }, { canSetLevelCode: true }),
    {},
  );
});

test('parsing an untrusted payload normalizes and never trusts unknown types', () => {
  const parsed = parseLoyalisConversionInput({
    name: '  Ahmad  ',
    departmentUnit: 'bak',
    loyalisType: 'Pimpinan',
    isDosen: 'true',
    levelCode: 'Gol. III/a',
    bpjsTk: '1000',
  });
  assert.equal(parsed.name, 'Ahmad');
  assert.equal(parsed.departmentUnit, 'BAK');
  assert.equal(parsed.loyalisType, '');
  assert.equal(parsed.isDosen, null);
  assert.equal(parsed.levelCode, 'III/a');
  assert.equal(parsed.bpjsTk, 1000);
  assert.ok(Number.isNaN(parsed.spouseCount));
  assert.ok(
    validateLoyalisConversionInput(parsed, { canSetLevelCode: true }).spouseCount,
  );
});

test('the Loyalis document maps Pekarya fields and moves the NIPY', () => {
  const document = buildLoyalisEmployeeDocument(pekarya, {
    ...prefillLoyalisConversionInput(pekarya),
    departmentUnit: 'BAK',
    loyalisType: 'Keluarga',
    bpjsTk: 100000,
    bpjsKes: 50000,
    spouseCount: 1,
    childrenSd: 2,
  });
  assert.equal(at(document, 'nipy'), '15010320001');
  assert.equal(at(document, 'personal_info.employee_id_niy'), '15010320001');
  assert.equal(at(document, 'personal_info.status'), 'AKTIF');
  assert.equal(at(document, 'personal_info.phone'), '081234567890');
  assert.equal(at(document, 'banking_info.account_number'), '7001234567');
  const dateOfHire = at(document, 'employment_profile.date_of_hire');
  assert.ok(dateOfHire instanceof Date);
  assert.equal(dateOfHire.toISOString(), '2020-03-01T00:00:00.000Z');
  assert.equal(at(document, 'employment_profile.department_unit'), 'BAK');
  assert.equal(at(document, 'employment_profile.job_role'), null);
  assert.equal(at(document, 'academic_and_tier.level_code'), null);
  assert.deepEqual(at(document, 'bpjs'), { t_bpjs_tk: 100000, t_bpjs_kes: 50000, deductionAmount: 50000 });
  assert.deepEqual(at(document, 'deductions'), { koperasiRochmad: 100000, kodeKopRochmad: 'KR-12' });
  assert.equal(at(document, 'salaryProfile.tunjanganBeras'), 75000);
  assert.equal(at(document, 'salaryProfile.salaryGradeCode'), undefined);
  assert.equal(at(document, 'family_allowance_metrics.children_sd'), 2);
  assert.equal(at(document, 'koperasiAuthUid'), 'kop-uid-1');
  assert.equal(at(document, 'koperasiUserId'), 'kop-user-1');
});

test('a Pekarya record without optional data still maps to a complete shape', () => {
  const minimal = { name: 'Budi', employment: { startDate: '2024-01-02' } };
  const document = buildLoyalisEmployeeDocument(minimal, {
    ...prefillLoyalisConversionInput(minimal),
    departmentUnit: 'FT',
    loyalisType: 'Admin',
  });
  assert.equal(at(document, 'nipy'), null);
  assert.equal(at(document, 'personal_info.employee_id_niy'), null);
  assert.equal(at(document, 'koperasiAuthUid'), null);
  assert.equal(at(document, 'deductions'), undefined);
  assert.equal(at(document, 'bpjs.deductionAmount'), 0);
  assert.equal(at(document, 'ziz.deductionAmount'), 0);
});

test('each record pays only its own side of the effective month', () => {
  const loyalis = { conversion: { fromEmployeeId: 'BC_012', effectivePeriod: '2026-10' } };
  const blue = { conversion: { toEmployeeId: 'Loyalis_046', effectivePeriod: '2026-10' } };
  assert.equal(employeeInPayrollPeriod('Employees_Loyalis', loyalis, '2026-09'), false);
  assert.equal(employeeInPayrollPeriod('Employees_Loyalis', loyalis, '2026-10'), true);
  assert.equal(employeeInPayrollPeriod('Employees_Loyalis', loyalis, '2026_11'), true);
  assert.equal(employeeInPayrollPeriod('Employees_BlueCollar', blue, '2026-09'), true);
  assert.equal(employeeInPayrollPeriod('Employees_BlueCollar', blue, '2026-10'), false);
  assert.equal(employeeInPayrollPeriod('Employees_BlueCollar', {}, '2026-10'), true);
  assert.equal(employeeInPayrollPeriod('Employees_Loyalis', {}, '2026-01'), true);
  assert.equal(isConvertedAway(blue), true);
  assert.equal(isConvertedAway(loyalis), false);
  assert.equal(isConvertedAway({}), false);
});

test('the payslip reads months before the switch from the Pekarya record', () => {
  const loyalis = { conversion: { fromEmployeeId: 'BC_012', effectivePeriod: '2026-10' } };
  assert.deepEqual(conversionSourceForPeriod(loyalis, '2026-09'), {
    employeeId: 'BC_012',
    collection: 'Employees_BlueCollar',
  });
  assert.equal(conversionSourceForPeriod(loyalis, '2026-10'), null);
  assert.equal(conversionSourceForPeriod({}, '2026-09'), null);
});

const cleanFacts: EmployeeConversionFacts = {
  today: '2026-10-03',
  effectivePeriod: '2026-10',
  previousPeriodClosed: true,
  effectivePeriodClosed: false,
  employeeActive: true,
  alreadyConverted: false,
  nipy: '15010320001',
  slipPeriodsFromEffective: [],
  pendingActivityReports: 0,
  activityReportsInEffectivePeriod: 0,
  openDriverJourneys: 0,
  driverJourneysInEffectivePeriod: 0,
  upcomingDriverPiket: 0,
  spjEventsInEffectivePeriod: 0,
  uraianPaidInEffectivePeriod: false,
  pendingOfficialLeave: 0,
  pendingSatpamAbsences: 0,
  pendingAnnualLeave: 0,
  satpamTeamNames: [],
  linkedAccounts: [{ uid: 'u1', role: 'honorer', disabled: false }],
  nipyOwnedElsewhere: null,
  levelCodeProvided: true,
};

test('a clean Pekarya has no blockers and no warnings', () => {
  assert.deepEqual(collectConversionIssues(cleanFacts), { blockers: [], warnings: [] });
});

test('every stranded item is reported as its own blocker', () => {
  const cases: Array<[Partial<EmployeeConversionFacts>, string]> = [
    [{ previousPeriodClosed: false }, 'PREVIOUS_PERIOD_OPEN'],
    [{ effectivePeriodClosed: true }, 'EFFECTIVE_PERIOD_CLOSED'],
    [{ employeeActive: false }, 'EMPLOYEE_INACTIVE'],
    [{ alreadyConverted: true }, 'ALREADY_CONVERTED'],
    [{ slipPeriodsFromEffective: ['2026-10'] }, 'SLIP_IN_EFFECTIVE_PERIOD'],
    [{ pendingActivityReports: 1 }, 'PENDING_ACTIVITY_REPORTS'],
    [{ activityReportsInEffectivePeriod: 2 }, 'ACTIVITY_IN_EFFECTIVE_PERIOD'],
    [{ openDriverJourneys: 1 }, 'OPEN_DRIVER_JOURNEYS'],
    [{ driverJourneysInEffectivePeriod: 1 }, 'DRIVER_JOURNEYS_IN_EFFECTIVE_PERIOD'],
    [{ upcomingDriverPiket: 3 }, 'UPCOMING_DRIVER_PIKET'],
    [{ spjEventsInEffectivePeriod: 1 }, 'SPJ_EVENT_IN_EFFECTIVE_PERIOD'],
    [{ uraianPaidInEffectivePeriod: true }, 'URAIAN_IN_EFFECTIVE_PERIOD'],
    [{ pendingOfficialLeave: 1 }, 'PENDING_OFFICIAL_LEAVE'],
    [{ pendingSatpamAbsences: 1 }, 'PENDING_SATPAM_ABSENCE'],
    [{ pendingAnnualLeave: 1 }, 'PENDING_ANNUAL_LEAVE'],
    [{ satpamTeamNames: ['Regu A'] }, 'SATPAM_TEAM_MEMBER'],
    [
      {
        linkedAccounts: [
          { uid: 'u1', role: 'honorer', disabled: false },
          { uid: 'u2', role: 'honorer', disabled: false },
        ],
      },
      'MULTIPLE_LINKED_ACCOUNTS',
    ],
    [
      { linkedAccounts: [{ uid: 'u1', role: 'ketua_shift_satpam', disabled: false }] },
      'LINKED_ACCOUNT_ROLE',
    ],
    [{ nipyOwnedElsewhere: 'Siti (Loyalis_003)' }, 'NIPY_OWNED_ELSEWHERE'],
  ];
  for (const [override, code] of cases) {
    const { blockers } = collectConversionIssues({ ...cleanFacts, ...override });
    assert.deepEqual(
      blockers.map((issue) => issue.code),
      [code],
      `expected only ${code}`,
    );
  }
});

test('an inactive record that was converted reports only the conversion', () => {
  const { blockers } = collectConversionIssues({
    ...cleanFacts,
    employeeActive: false,
    alreadyConverted: true,
  });
  assert.deepEqual(blockers.map((issue) => issue.code), ['ALREADY_CONVERTED']);
});

test('warnings do not block the switch', () => {
  const { blockers, warnings } = collectConversionIssues({
    ...cleanFacts,
    today: '2026-10-20',
    nipy: '',
    linkedAccounts: [],
    levelCodeProvided: false,
  });
  assert.deepEqual(blockers, []);
  assert.deepEqual(
    warnings.map((issue) => issue.code).sort(),
    ['LATE_IN_MONTH', 'LEVEL_CODE_EMPTY', 'NO_LINKED_ACCOUNT', 'NO_NIPY'],
  );
  assert.deepEqual(
    collectConversionIssues({
      ...cleanFacts,
      linkedAccounts: [{ uid: 'u1', role: 'honorer', disabled: true }],
    }).warnings.map((issue) => issue.code),
    ['LINKED_ACCOUNT_DISABLED'],
  );
});
