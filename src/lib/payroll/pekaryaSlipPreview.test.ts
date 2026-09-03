import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildPekaryaSlipPreview,
  overlayPekaryaAttendanceEarnings,
  PekaryaPreviewInputs,
  resolveSlipPreviewScope,
  shouldValidateNewSlipSources,
  validateNewSlipGapok,
} from './pekaryaSlipPreview';
import { DriverPiketSchedule } from './driverPiket';
import { SalaryMatrix, UraianEntry } from '@/types';

/**
 * Fixture: Abdul Kholik (BC_001), SOPIR, payroll period 2026-08.
 *
 * Every figure below is the employee's real August 2026 data. He joined on
 * 1998-08-01, which is 28 years of service measured to the 5th of the month
 * after the payslip month, and his master-data grade is F. His profile still
 * carries `baseSalaryAmount: 264_750` — the grade F / 27-year row — which is
 * exactly the stale snapshot the matrix lookup has to override.
 */

const GRADE_F_ROWS: Record<number, number> = {
  25: 256_000, 26: 260_500, 27: 264_750, 28: 269_000, 29: 273_250,
};

const SALARY_MATRIX: SalaryMatrix = { F: GRADE_F_ROWS };

const KHOLIK = {
  id: 'BC_001',
  name: 'Abdul Kholik',
  salaryProfile: {
    salaryGradeCode: 'F',
    // The stale denormalized copy. Nothing may ever read it.
    baseSalaryAmount: 264_750,
    tunjanganBeras: 60_000,
  },
  employment: { jobCategory: 'SOPIR', startDate: '1998-08-01', status: 'active' },
  bpjs: { allowanceAmount: 472_878, deductionAmount: 472_878 },
};

/**
 * Ten Piket assignments in August 2026. 2026-08-07 is a Friday and
 * 2026-08-17 is Indonesian Independence Day, so with the period's work
 * calendar materialized both rate as premium and the remaining eight are
 * ordinary days.
 */
const PIKET_DATES = [
  '2026-08-03', '2026-08-05', '2026-08-06', '2026-08-07', '2026-08-09',
  '2026-08-11', '2026-08-13', '2026-08-15', '2026-08-17', '2026-08-19',
];

const PIKET_SCHEDULES: DriverPiketSchedule[] = PIKET_DATES.map((date) => ({
  id: `PIKET-${date}`,
  period: '2026-08',
  date,
  stationKey: 'sekolah',
  stationName: 'Sekolah',
  driverId: 'BC_001',
  driverName: 'Abdul Kholik',
}));

const AUGUST_PREMIUM_DATES = [
  '2026-08-07', '2026-08-14', '2026-08-17', '2026-08-21', '2026-08-28',
];

function kholikInputs(
  overrides: Partial<PekaryaPreviewInputs> = {},
): PekaryaPreviewInputs {
  return {
    employee: KHOLIK,
    period: '2026-08',
    targetDate: new Date(2026, 7, 1),
    salaryMatrix: SALARY_MATRIX,
    matrixVersion: '2026_v1',
    approvedActivitySpj: 553_068,
    approvedEventSpj: 0,
    piketSchedules: PIKET_SCHEDULES,
    premiumDates: AUGUST_PREMIUM_DATES,
    ...overrides,
  };
}

function amountOf(
  earnings: readonly { label: string; amount: number }[],
  label: string,
): number | undefined {
  return earnings.find((row) => row.label === label)?.amount;
}

function totalOf(earnings: readonly { amount: number }[]): number {
  return earnings.reduce((sum, row) => sum + row.amount, 0);
}

// ─── The reference fixture ───────────────────────────────────────────────

test('Abdul Kholik August 2026: every row and the total', () => {
  const preview = buildPekaryaSlipPreview(kholikInputs());
  const { earnings, meta } = preview;

  // Grade F at 28 years of service, from the matrix — not the 264.750 profile
  // snapshot that would otherwise be one service year behind.
  assert.equal(amountOf(earnings, 'Gaji Pokok'), 269_000);
  assert.equal(meta.gradeLevel, 'F');
  assert.equal(meta.serviceYears, 28);
  assert.equal(meta.effectiveMatrixYear, 28);
  assert.equal(meta.matrixVersion, '2026_v1');
  assert.equal(meta.gapokStatus, 'ok');

  // 8 ordinary Piket days at Rp12.500, 2 premium days at Rp25.000.
  assert.equal(amountOf(earnings, 'Presensi Harian'), 100_000);
  assert.equal(amountOf(earnings, 'Jumat & Libur'), 50_000);
  // All 10 days also earn the flat Rp15.000 Piket rate.
  assert.equal(amountOf(earnings, 'Piket'), 150_000);

  assert.equal(amountOf(earnings, 'SPJ'), 553_068);
  assert.equal(amountOf(earnings, 'BPJS (Tunjangan)'), 472_878);
  assert.equal(amountOf(earnings, 'Tunjangan Beras'), 60_000);

  assert.equal(totalOf(earnings), 1_654_946);
  assert.equal(meta.spjSource, 'activity_and_events');
  assert.equal(meta.attendanceSource, 'piket_estimate');
});

test('the profile base salary is never a fallback for a missing matrix', () => {
  const preview = buildPekaryaSlipPreview(kholikInputs({ salaryMatrix: {} }));

  assert.equal(amountOf(preview.earnings, 'Gaji Pokok'), 0);
  assert.notEqual(amountOf(preview.earnings, 'Gaji Pokok'), 264_750);
  assert.equal(preview.meta.gapokStatus, 'matrix_unavailable');
  assert.equal(preview.meta.canCreateSlip, false);
  assert.ok(
    preview.meta.warnings.some(
      (warning) => warning.code === 'matrix_unavailable' && warning.blocking,
    ),
  );
});

test('an unknown grade blocks the slip instead of silently paying zero', () => {
  const preview = buildPekaryaSlipPreview(
    kholikInputs({
      employee: {
        ...KHOLIK,
        salaryProfile: { ...KHOLIK.salaryProfile, salaryGradeCode: 'ZZ' },
      },
    }),
  );

  assert.equal(amountOf(preview.earnings, 'Gaji Pokok'), 0);
  assert.equal(preview.meta.gapokStatus, 'grade_unknown');
  assert.equal(preview.meta.canCreateSlip, false);
});

test('service years below the matrix floor clamp to the lowest row', () => {
  const preview = buildPekaryaSlipPreview(
    kholikInputs({
      employee: {
        ...KHOLIK,
        employment: { ...KHOLIK.employment, startDate: '2026-01-01' },
      },
    }),
  );

  assert.equal(preview.meta.serviceYears, 0);
  assert.equal(preview.meta.effectiveMatrixYear, 25);
  assert.equal(amountOf(preview.earnings, 'Gaji Pokok'), 256_000);
});

// ─── SPJ precedence ──────────────────────────────────────────────────────

test('approved event SPJ is added on top of approved activity SPJ', () => {
  const preview = buildPekaryaSlipPreview(
    kholikInputs({ approvedEventSpj: 75_000 }),
  );

  assert.equal(amountOf(preview.earnings, 'SPJ'), 628_068);
  assert.equal(totalOf(preview.earnings), 1_729_946);
});

test('an unapproved or duplicated report never reaches the preview', () => {
  // Approval and de-duplication happen in sumApprovedActivitySpj upstream;
  // what the preview must guarantee is that it publishes that sum verbatim
  // rather than re-deriving or topping it up from another source.
  const preview = buildPekaryaSlipPreview(
    kholikInputs({ approvedActivitySpj: 0, approvedEventSpj: 0 }),
  );

  assert.equal(amountOf(preview.earnings, 'SPJ'), 0);
});

test('a published Uraian SPJ does not override the canonical activity sum', () => {
  const uraianEntry: UraianEntry = {
    employeeId: 'BC_001',
    name: 'Abdul Kholik',
    values: { spj: 999_000 },
  };
  const preview = buildPekaryaSlipPreview(kholikInputs({ uraianEntry }));

  assert.equal(amountOf(preview.earnings, 'SPJ'), 553_068);
});

test('July 2026 SOPIR keeps the manual Uraian SPJ as authoritative', () => {
  const uraianEntry: UraianEntry = {
    employeeId: 'BC_001',
    name: 'Abdul Kholik',
    values: { spj: 412_500 },
  };
  const preview = buildPekaryaSlipPreview(
    kholikInputs({
      period: '2026-07',
      targetDate: new Date(2026, 6, 1),
      uraianEntry,
      approvedActivitySpj: 553_068,
    }),
  );

  assert.equal(amountOf(preview.earnings, 'SPJ'), 412_500);
  assert.equal(preview.meta.spjSource, 'uraian_manual');
});

test('a July 2026 paper-SPJ KEBERSIHAN employee uses the sealed rekap value', () => {
  const preview = buildPekaryaSlipPreview(
    kholikInputs({
      period: '2026-07',
      targetDate: new Date(2026, 6, 1),
      employee: {
        ...KHOLIK,
        id: 'BC_053',
        employment: { ...KHOLIK.employment, jobCategory: 'KEBERSIHAN' },
      },
      uraianEntry: {
        employeeId: 'BC_053',
        name: 'Paper SPJ',
        values: { spj: 180_000 },
      },
      approvedActivitySpj: 640_000,
    }),
  );

  assert.equal(amountOf(preview.earnings, 'SPJ'), 180_000);
  assert.equal(preview.meta.spjSource, 'uraian_manual');
});

// ─── Attendance precedence ───────────────────────────────────────────────

test('published Uraian attendance replaces the Piket estimate', () => {
  const uraianEntry: UraianEntry = {
    employeeId: 'BC_001',
    name: 'Abdul Kholik',
    values: { harian: 262_500, jumatLibur: 75_000, piket: 165_000 },
    counts: { harian: 23, jumatLibur: 4, piket: 11 },
  };
  const preview = buildPekaryaSlipPreview(kholikInputs({ uraianEntry }));

  assert.equal(amountOf(preview.earnings, 'Presensi Harian'), 262_500);
  assert.equal(amountOf(preview.earnings, 'Jumat & Libur'), 75_000);
  assert.equal(amountOf(preview.earnings, 'Piket'), 165_000);
  assert.equal(preview.meta.attendanceSource, 'uraian');
  assert.equal(preview.meta.isProvisional, false);
});

test('a published zero stays zero rather than reverting to the estimate', () => {
  const uraianEntry: UraianEntry = {
    employeeId: 'BC_001',
    name: 'Abdul Kholik',
    values: { harian: 0, jumatLibur: 0, piket: 0 },
  };
  const preview = buildPekaryaSlipPreview(kholikInputs({ uraianEntry }));

  assert.equal(amountOf(preview.earnings, 'Presensi Harian'), 0);
  assert.equal(amountOf(preview.earnings, 'Jumat & Libur'), 0);
  assert.equal(amountOf(preview.earnings, 'Piket'), 0);
});

test('without a materialized calendar only Fridays rate as premium', () => {
  // The same ten Piket days split 9/1 when 17 August has not been entered as
  // a holiday, which is what makes materializing the period calendar a
  // payroll-relevant act rather than a formality.
  const preview = buildPekaryaSlipPreview(
    kholikInputs({
      premiumDates: ['2026-08-07', '2026-08-14', '2026-08-21', '2026-08-28'],
    }),
  );

  assert.equal(amountOf(preview.earnings, 'Presensi Harian'), 112_500);
  assert.equal(amountOf(preview.earnings, 'Jumat & Libur'), 25_000);
  assert.equal(amountOf(preview.earnings, 'Piket'), 150_000);
});

test('estimated attendance marks the preview provisional', () => {
  const preview = buildPekaryaSlipPreview(kholikInputs());
  assert.equal(preview.meta.isProvisional, true);
});

// ─── Publication gate ────────────────────────────────────────────────────

test('an unpublished attendance period blocks creating a new slip', () => {
  const preview = buildPekaryaSlipPreview(
    kholikInputs({
      attendanceGate: {
        required: true,
        satisfied: false,
        reason: 'Presensi SOPIR belum dipublikasikan.',
      },
    }),
  );

  assert.equal(preview.meta.canCreateSlip, false);
  assert.equal(preview.meta.isProvisional, true);
  assert.deepEqual(
    preview.meta.warnings.map((warning) => warning.code),
    ['attendance_unpublished'],
  );
});

test('an active upload supplies exact rupiah provisionally without satisfying publication', () => {
  const preview = buildPekaryaSlipPreview(
    kholikInputs({
      attendanceGate: {
        required: true,
        satisfied: false,
        reason: 'Presensi SOPIR belum dipublikasikan.',
      },
      uploadedAttendanceEntry: {
        employeeId: 'BC_001',
        name: 'Abdul Kholik',
        values: { harian: 236_540, jumatLibur: 100_004 },
        // Counts remain available for audit, but must not be multiplied back
        // into a different amount on the slip.
        counts: { harian: 23, jumatLibur: 4 },
      },
    }),
  );

  assert.equal(amountOf(preview.earnings, 'Presensi Harian'), 236_540);
  assert.equal(amountOf(preview.earnings, 'Jumat & Libur'), 100_004);
  assert.equal(preview.meta.attendanceSource, 'uploaded_attendance');
  assert.equal(preview.meta.isProvisional, true);
  assert.equal(preview.meta.canCreateSlip, false);
  assert.deepEqual(
    preview.meta.warnings.map((warning) => warning.code),
    ['attendance_unpublished'],
  );
});

test('an editable draft overlays only current attendance and migrates its old label', () => {
  const merged = overlayPekaryaAttendanceEarnings(
    [
      { label: 'Gaji Pokok', amount: 999_000 },
      { label: 'Vakasi Harian', amount: 12_500 },
      { label: 'Jumat & Libur', amount: 25_000 },
      { label: 'SPJ', amount: 777_000 },
    ],
    [
      { label: 'Gaji Pokok', amount: 269_000 },
      { label: 'Presensi Harian', amount: 236_540 },
      { label: 'Jumat & Libur', amount: 100_004 },
      { label: 'SPJ', amount: 553_068 },
    ],
  );

  assert.deepEqual(merged, [
    { label: 'Gaji Pokok', amount: 999_000 },
    { label: 'Presensi Harian', amount: 236_540 },
    { label: 'Jumat & Libur', amount: 100_004 },
    { label: 'SPJ', amount: 777_000 },
  ]);
});

test('an unpublished Uraian row cannot override the Piket estimate', () => {
  const preview = buildPekaryaSlipPreview(
    kholikInputs({
      attendanceGate: {
        required: true,
        satisfied: false,
        reason: 'Presensi SOPIR sudah kedaluwarsa.',
      },
      uraianCustomColumns: [
        {
          key: 'tunjanganLembur',
          label: 'Tunjangan Lembur',
          type: 'currency',
          slipLabel: 'Tunjangan Lembur',
        },
      ],
      uraianEntry: {
        employeeId: 'BC_001',
        name: 'Abdul Kholik',
        values: {
          harian: 999_999,
          jumatLibur: 999_999,
          piket: 999_999,
          tunjanganLembur: 999_999,
        },
      },
    }),
  );

  assert.equal(amountOf(preview.earnings, 'Presensi Harian'), 100_000);
  assert.equal(amountOf(preview.earnings, 'Jumat & Libur'), 50_000);
  assert.equal(amountOf(preview.earnings, 'Piket'), 150_000);
  assert.equal(amountOf(preview.earnings, 'Tunjangan Lembur'), 0);
  assert.equal(preview.meta.attendanceSource, 'piket_estimate');
  assert.equal(preview.meta.canCreateSlip, false);
  assert.deepEqual(
    preview.meta.warnings.map((warning) => warning.code),
    ['attendance_unpublished'],
  );
});

test('a published period without the employee row is still blocked', () => {
  const preview = buildPekaryaSlipPreview(
    kholikInputs({ attendanceGate: { required: true, satisfied: true } }),
  );

  assert.equal(preview.meta.canCreateSlip, false);
  assert.deepEqual(
    preview.meta.warnings.map((warning) => warning.code),
    ['uraian_entry_missing'],
  );
});

test('a published period with the employee row can create a slip', () => {
  const preview = buildPekaryaSlipPreview(
    kholikInputs({
      attendanceGate: { required: true, satisfied: true },
      uraianEntry: {
        employeeId: 'BC_001',
        name: 'Abdul Kholik',
        values: { harian: 100_000, jumatLibur: 50_000, piket: 150_000 },
      },
    }),
  );

  assert.equal(preview.meta.canCreateSlip, true);
  assert.equal(preview.meta.isProvisional, false);
  assert.deepEqual(preview.meta.warnings, []);
});

test('SATPAM preview keeps Rekap shift values while reconciliation is pending', () => {
  const preview = buildPekaryaSlipPreview(
    kholikInputs({
      employee: {
        ...KHOLIK,
        employment: { ...KHOLIK.employment, jobCategory: 'SATPAM' },
      },
      attendanceGate: { required: true, satisfied: true },
      uraianEntry: {
        employeeId: 'BC_001',
        name: 'Abdul Kholik',
        values: {
          harian: 137_500,
          jumatLibur: 50_000,
          lemburSendiri: 30_000,
          lemburCover: 50_000,
          bonusPresensiBulanan: 100_000,
        },
        counts: {
          harian: 11,
          jumatLibur: 2,
          lemburSendiri: 1,
          lemburCover: 1,
        },
      },
      piketSchedules: [],
    }),
  );

  assert.equal(amountOf(preview.earnings, 'Vakasi Harian'), 137_500);
  assert.equal(amountOf(preview.earnings, 'Jumat & Libur'), 50_000);
  assert.equal(amountOf(preview.earnings, 'Lembur Sendiri'), 30_000);
  assert.equal(amountOf(preview.earnings, 'Lembur Cover'), 50_000);
  assert.equal(amountOf(preview.earnings, 'Bonus Presensi Bulanan'), 100_000);
  assert.equal(preview.meta.attendanceSource, 'uraian');
  assert.equal(preview.meta.isProvisional, true);
  assert.equal(preview.meta.canCreateSlip, false);
  assert.deepEqual(
    preview.meta.warnings.map((warning) => warning.code),
    ['satpam_duty_unreconciled'],
  );
});

test('SATPAM shift values remain visible when the period reconciliation itself is pending', () => {
  const preview = buildPekaryaSlipPreview(
    kholikInputs({
      employee: {
        ...KHOLIK,
        employment: { ...KHOLIK.employment, jobCategory: 'SATPAM' },
      },
      attendanceGate: {
        required: true,
        satisfied: false,
        reason: 'Rencana dinas Satpam belum selesai diperiksa.',
      },
      uraianEntry: {
        employeeId: 'BC_001',
        name: 'Abdul Kholik',
        values: {
          harian: 137_500,
          jumatLibur: 50_000,
          lemburSendiri: 30_000,
          lemburCover: 50_000,
          bonusPresensiBulanan: 100_000,
        },
        counts: {
          harian: 11,
          jumatLibur: 2,
          lemburSendiri: 1,
          lemburCover: 1,
        },
      },
      piketSchedules: [],
    }),
  );

  assert.equal(amountOf(preview.earnings, 'Vakasi Harian'), 137_500);
  assert.equal(amountOf(preview.earnings, 'Jumat & Libur'), 50_000);
  assert.equal(amountOf(preview.earnings, 'Lembur Sendiri'), 30_000);
  assert.equal(amountOf(preview.earnings, 'Lembur Cover'), 50_000);
  assert.equal(amountOf(preview.earnings, 'Bonus Presensi Bulanan'), 100_000);
  assert.equal(preview.meta.attendanceSource, 'uraian');
  assert.equal(preview.meta.canCreateSlip, false);
  assert.deepEqual(
    preview.meta.warnings.map((warning) => warning.code),
    ['attendance_unpublished'],
  );
});

test('SATPAM preview accepts a reconciled employee row', () => {
  const preview = buildPekaryaSlipPreview(
    kholikInputs({
      employee: {
        ...KHOLIK,
        employment: { ...KHOLIK.employment, jobCategory: 'SATPAM' },
      },
      attendanceGate: { required: true, satisfied: true },
      uraianEntry: {
        employeeId: 'BC_001',
        name: 'Abdul Kholik',
        values: {
          harian: 250_000,
          jumatLibur: 100_000,
          bonusPresensiBulanan: 100_000,
        },
        satpamDutySource: { planId: 'SATPAM-2026-08' },
      },
      piketSchedules: [],
    }),
  );

  assert.equal(amountOf(preview.earnings, 'Vakasi Harian'), 250_000);
  assert.equal(amountOf(preview.earnings, 'Jumat & Libur'), 100_000);
  assert.equal(amountOf(preview.earnings, 'Bonus Presensi Bulanan'), 100_000);
  assert.equal(preview.meta.attendanceSource, 'uraian');
  assert.equal(preview.meta.canCreateSlip, true);
});

// ─── Custom columns ──────────────────────────────────────────────────────

test('custom Uraian columns are appended to the preview rows', () => {
  const preview = buildPekaryaSlipPreview(
    kholikInputs({
      uraianCustomColumns: [
        {
          key: 'tunjanganLembur',
          label: 'Tunjangan Lembur',
          type: 'currency',
          slipLabel: 'Tunjangan Lembur',
        },
      ],
      uraianEntry: {
        employeeId: 'BC_001',
        name: 'Abdul Kholik',
        values: { tunjanganLembur: 45_000 },
      },
    }),
  );

  assert.equal(amountOf(preview.earnings, 'Tunjangan Lembur'), 45_000);
});

// ─── /api/payroll/slip-preview authorization ─────────────────────────────

const FINANCE_ROLES = ['super_admin', 'finance_verifier'];

test('finance without an employeeId gets the whole period', () => {
  assert.deepEqual(
    resolveSlipPreviewScope({ role: 'finance_verifier', financeRoles: FINANCE_ROLES }),
    { kind: 'period' },
  );
});

test('finance may narrow the request to one employee', () => {
  assert.deepEqual(
    resolveSlipPreviewScope({
      role: 'super_admin',
      financeRoles: FINANCE_ROLES,
      requestedEmployeeId: 'BC_001',
    }),
    { kind: 'employee', employeeId: 'BC_001' },
  );
});

test('an employee-portal role is confined to its own linked employee', () => {
  assert.deepEqual(
    resolveSlipPreviewScope({
      role: 'honorer',
      financeRoles: FINANCE_ROLES,
      linkedEmployeeId: 'BC_001',
    }),
    { kind: 'employee', employeeId: 'BC_001' },
  );
});

test('asking for someone else is refused, not silently narrowed', () => {
  const scope = resolveSlipPreviewScope({
    role: 'honorer',
    financeRoles: FINANCE_ROLES,
    linkedEmployeeId: 'BC_001',
    requestedEmployeeId: 'BC_002',
  });

  assert.equal(scope.kind, 'denied');
  assert.equal(scope.kind === 'denied' && scope.status, 403);
});

test('an unlinked portal account is a conflict, not a forbidden', () => {
  const scope = resolveSlipPreviewScope({
    role: 'ketua_shift_satpam',
    financeRoles: FINANCE_ROLES,
  });

  assert.equal(scope.kind, 'denied');
  assert.equal(scope.kind === 'denied' && scope.status, 409);
});

test('every other role is refused outright', () => {
  for (const role of ['satker_head', 'employee_admin', 'loyalis_presence_admin']) {
    const scope = resolveSlipPreviewScope({ role, financeRoles: FINANCE_ROLES });
    assert.equal(scope.kind, 'denied', role);
    assert.equal(scope.kind === 'denied' && scope.status, 403, role);
  }
});

// ─── New-slip Gaji Pokok guard ───────────────────────────────────────────

const OK_RESOLUTION = {
  amount: 269_000,
  gradeKey: 'F',
  serviceYears: 28,
  effectiveYear: 28,
  status: 'ok' as const,
};

test('canonical sources are revalidated only when a slip is first created', () => {
  assert.equal(shouldValidateNewSlipSources(null), true);
  assert.equal(shouldValidateNewSlipSources(undefined), true);
  assert.equal(shouldValidateNewSlipSources({ status: 'draft' }), false);
});

test('a new slip carrying the matrix Gaji Pokok is accepted', () => {
  assert.equal(
    validateNewSlipGapok(
      [
        { label: 'Gaji Pokok', amount: 269_000 },
        { label: 'SPJ', amount: 553_068 },
      ],
      OK_RESOLUTION,
      '2026_v1',
    ),
    null,
  );
});

test('a new slip carrying the stale profile salary is refused', () => {
  const error = validateNewSlipGapok(
    [{ label: 'Gaji Pokok', amount: 264_750 }],
    OK_RESOLUTION,
    '2026_v1',
  );

  assert.ok(error);
  assert.match(error!, /269\.000/);
});

test('a duplicated Gaji Pokok row is refused even when the sum matches', () => {
  assert.ok(
    validateNewSlipGapok(
      [
        { label: 'Gaji Pokok', amount: 134_500 },
        { label: 'Gapok', amount: 134_500 },
      ],
      OK_RESOLUTION,
      '2026_v1',
    ),
  );
});

test('a missing Gaji Pokok row is refused', () => {
  assert.ok(
    validateNewSlipGapok([{ label: 'SPJ', amount: 553_068 }], OK_RESOLUTION, '2026_v1'),
  );
});

test('an unreadable matrix refuses the write before comparing amounts', () => {
  const error = validateNewSlipGapok(
    [{ label: 'Gaji Pokok', amount: 0 }],
    { ...OK_RESOLUTION, amount: 0, status: 'grade_unknown', effectiveYear: null },
    '2026_v1',
  );

  assert.ok(error);
  assert.match(error!, /matriks gaji aktif \(2026_v1\)/);
});
