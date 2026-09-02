import { calculateGapok } from '@/lib/payroll/salaryMatrix';
import { PekaryaSlipPreview } from '@/lib/payroll/pekaryaSlipPreview';
import {
  buildInitialDeductions,
  buildInitialEarnings,
  SlipField,
} from '@/lib/payroll/slipBuilders';
import { recalculateSlipTaxes } from '@/lib/payroll/payrollTax';
import { loyalisPresenceAmounts } from '@/lib/payroll/uraianPropagation';
import { mergeSatpamLegacyBonusIntoTunjangan } from '@/lib/payroll/satpamCompensation';
import { SalaryMatrix } from '@/types';

export type DashboardPayrollCollar = 'loyalis' | 'pekarya';

export interface DashboardVakasiItem {
  eventName: string;
  payGiven: number;
  isEndOfMonth?: boolean;
}

export interface DashboardPeriodInputs {
  targetDate: Date;
  salaryMatrix: SalaryMatrix;
  uraianMap: Record<string, any>;
  vakasiTambahanMap: Record<string, number>;
  vakasiTambahanListMap: Record<string, DashboardVakasiItem[]>;
  functionalAllowanceMap: Record<string, number>;
  kepangkatanAllowanceMap: Record<string, number>;
  koperasiDeductions: Record<string, number>;
  koperasiSavings: Record<string, number>;
  loyalisPresenceData: any | null;
  /**
   * Pekarya earnings as calculated by /api/payroll/slip-preview, keyed by
   * employee id. When an entry exists it is authoritative: it is the same
   * object the employee's own payslip page renders, so the dashboard cannot
   * show a different Gaji Pokok, SPJ, or attendance figure than the employee
   * sees. If it is absent for Pekarya, this helper deliberately returns no
   * money rows so callers can surface an unavailable/retry state.
   */
  pekaryaPreviews?: Record<string, PekaryaSlipPreview>;
}

export interface DashboardSavedSlip {
  earnings?: SlipField[];
  deductions?: SlipField[];
  taxes?: SlipField[];
  taxApplied?: boolean;
}

export interface DashboardSlipData {
  earnings: SlipField[];
  deductions: SlipField[];
  /** Income tax rows — a category of its own, never part of `deductions`. */
  taxes: SlipField[];
}

function toDateOrNow(value: any): Date {
  return value?.toDate?.() || (value ? new Date(value) : new Date());
}

function getEmployeeForGapok(
  employee: any,
  collar: DashboardPayrollCollar,
): { joinDate: Date; dateRecognized?: Date; gradeLevel: string } {
  if (collar === 'loyalis') {
    return {
      joinDate: toDateOrNow(employee.employment_profile?.date_of_hire),
      dateRecognized: employee.employment_profile?.date_recognized?.toDate?.() ||
        (employee.employment_profile?.date_recognized
          ? new Date(employee.employment_profile.date_recognized)
          : undefined),
      gradeLevel: employee.academic_and_tier?.level_code || '',
    };
  }

  return {
    joinDate: employee.employment?.startDate
      ? new Date(employee.employment.startDate)
      : new Date(),
    gradeLevel: employee.salaryProfile?.salaryGradeCode || '',
  };
}

/**
 * Derive the exact earnings and deductions used by the payroll page for one
 * employee and one period. Persisted earnings are treated as the source of
 * truth. Unsaved Pekarya rows require the shared server preview; only Loyalis
 * may use the local builder.
 */
export function buildDashboardSlipData(
  employee: any,
  collar: DashboardPayrollCollar,
  savedSlip: DashboardSavedSlip | undefined,
  inputs: DashboardPeriodInputs,
): DashboardSlipData {
  if (Array.isArray(savedSlip?.earnings)) {
    const earnings =
      collar === 'pekarya' && employee.employment?.jobCategory === 'SATPAM'
        ? mergeSatpamLegacyBonusIntoTunjangan(savedSlip.earnings)
        : savedSlip.earnings;
    const deductions = savedSlip.deductions || [];
    return {
      earnings,
      deductions,
      // The stored amount is never trusted: the 5% is re-derived from the
      // rows this helper actually returns, the same way the server does.
      taxes: recalculateSlipTaxes(savedSlip, earnings, deductions),
    };
  }

  const employeeForGapok = getEmployeeForGapok(employee, collar);
  const gapok = calculateGapok(
    employeeForGapok,
    inputs.salaryMatrix,
    inputs.targetDate,
  );
  const period = `${inputs.targetDate.getFullYear()}_${String(
    inputs.targetDate.getMonth() + 1,
  ).padStart(2, '0')}`;
  const category = collar === 'loyalis'
    ? employee.employment_profile?.department_unit || 'Staf'
    : employee.employment?.jobCategory || '';
  const uraianEntry = inputs.uraianMap[`${period}_${category}`]?.entries?.[
    employee.id
  ];
  // Shared with the Uraian/Loyalis propagation route, so a slip built here
  // and one propagated onto a saved draft always agree.
  const {
    presenceBonus,
    presenceDeduction,
    presensiEarning,
    presensiDeduction,
  } = loyalisPresenceAmounts(inputs.loyalisPresenceData, employee.id);

  // Pekarya has no local fallback. A missing preview means the source is
  // unavailable, not that the employee earned zero (or that an older builder
  // may reconstruct a close-looking substitute).
  const pekaryaPreview =
    collar === 'pekarya' ? inputs.pekaryaPreviews?.[employee.id] : undefined;

  if (collar === 'pekarya' && !pekaryaPreview) {
    return { earnings: [], deductions: [], taxes: [] };
  }

  return {
    earnings: collar === 'pekarya'
      ? pekaryaPreview!.earnings
      : buildInitialEarnings(
        employee,
        gapok,
        collar,
        uraianEntry,
        inputs.vakasiTambahanMap[employee.id] ?? 0,
        inputs.vakasiTambahanListMap[employee.id] ?? [],
        inputs.functionalAllowanceMap[employee.id] ?? 0,
        inputs.kepangkatanAllowanceMap[employee.id] ?? 0,
        [],
        presenceBonus,
        presensiEarning,
      ),
    deductions: buildInitialDeductions(
      employee,
      collar,
      inputs.koperasiDeductions[employee.id] || 0,
      presenceDeduction,
      presensiDeduction,
      inputs.koperasiSavings[employee.id] || 0,
    ),
    // A slip that has never been saved carries no tax: the selection is an
    // explicit super-admin action, never inferred from calculated rows.
    taxes: [],
  };
}

export function sumSlipFields(fields: ReadonlyArray<SlipField>): number {
  return fields.reduce((sum, field) => sum + (field.amount || 0), 0);
}
