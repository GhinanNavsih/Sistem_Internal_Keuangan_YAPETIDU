import { calculateGapok } from '@/lib/payroll/salaryMatrix';
import { PekaryaSlipPreview } from '@/lib/payroll/pekaryaSlipPreview';
import {
  buildInitialDeductions,
  buildInitialEarnings,
  SlipField,
} from '@/lib/payroll/slipBuilders';
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
   * sees. Absent only for Loyalis and while the period previews are loading.
   */
  pekaryaPreviews?: Record<string, PekaryaSlipPreview>;
}

export interface DashboardSavedSlip {
  earnings?: SlipField[];
  deductions?: SlipField[];
}

export interface DashboardSlipData {
  earnings: SlipField[];
  deductions: SlipField[];
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

function hasPresenceEntries(presenceData: any | null): boolean {
  return Boolean(
    presenceData?.entries && Object.keys(presenceData.entries).length > 0,
  );
}

function getPresenceBonus(
  employeeId: string,
  presenceData: any | null,
): number {
  if (hasPresenceEntries(presenceData) && !presenceData.entries[employeeId]) {
    return 0;
  }
  return 250000;
}

function getPresenceDeduction(
  employeeId: string,
  presenceData: any | null,
): number {
  const entry = hasPresenceEntries(presenceData)
    ? presenceData.entries[employeeId]
    : undefined;
  return entry?.deduction || 0;
}

function getPresensiEarning(
  employeeId: string,
  presenceData: any | null,
): number {
  const workingDays = presenceData?.workingDays || 25;
  const expectedHours = presenceData?.expectedHours || 6.5;
  if (hasPresenceEntries(presenceData) && !presenceData.entries[employeeId]) {
    return 0;
  }
  return Math.round(workingDays * expectedHours * 1650);
}

function getPresensiDeduction(
  employeeId: string,
  presenceData: any | null,
): number {
  const entry = hasPresenceEntries(presenceData)
    ? presenceData.entries[employeeId]
    : undefined;
  return Math.round(((entry?.absenceMinutes || 0) / 60) * 1650);
}

/**
 * Derive the exact earnings and deductions used by the payroll page for one
 * employee and one period. Persisted earnings are treated as the source of
 * truth; the canonical builders are used only when no saved earnings exist.
 */
export function buildDashboardSlipData(
  employee: any,
  collar: DashboardPayrollCollar,
  savedSlip: DashboardSavedSlip | undefined,
  inputs: DashboardPeriodInputs,
): DashboardSlipData {
  if (savedSlip?.earnings && savedSlip.earnings.length > 0) {
    return {
      earnings: savedSlip.earnings,
      deductions: savedSlip.deductions || [],
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
  const presenceBonus = getPresenceBonus(
    employee.id,
    inputs.loyalisPresenceData,
  );
  const presenceDeduction = getPresenceDeduction(
    employee.id,
    inputs.loyalisPresenceData,
  );
  const presensiEarning = getPresensiEarning(
    employee.id,
    inputs.loyalisPresenceData,
  );
  const presensiDeduction = getPresensiDeduction(
    employee.id,
    inputs.loyalisPresenceData,
  );

  // Pekarya earnings come from the shared preview whenever it has been
  // loaded; the local builder stays only for Loyalis and for a blue-collar
  // employee the preview does not cover (a non-Pekarya job category).
  const pekaryaPreview =
    collar === 'pekarya' ? inputs.pekaryaPreviews?.[employee.id] : undefined;

  return {
    earnings: pekaryaPreview
      ? pekaryaPreview.earnings
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
  };
}

export function sumSlipFields(fields: ReadonlyArray<SlipField>): number {
  return fields.reduce((sum, field) => sum + (field.amount || 0), 0);
}
