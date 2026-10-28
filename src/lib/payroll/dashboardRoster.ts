import { isImmutablePayrollStatus } from './domain';
import { buildPayrollRoster, type PayrollEmployeeCollection, type PayrollEmployeeData } from './payrollRoster';
import type { DashboardSavedSlip, DashboardPayrollCollar } from './dashboardSlipData';
import { withPayrollJobCategory, type BlueCollarCategoryChange } from './blueCollarCategory';

export interface DashboardRosterEmployee extends PayrollEmployeeData {
  id: string;
  employment?: PayrollEmployeeData['employment'] & { jobCategory?: string; jobCategoryHistory?: BlueCollarCategoryChange[]; startDate?: unknown };
  employment_profile?: { department_unit?: string };
  [key: string]: unknown;
}

export interface DashboardRosterSlip extends DashboardSavedSlip {
  employeeCollection?: string;
}

export interface DashboardPayrollPeriod {
  attendanceStatus?: string;
  payrollRosterSeal?: { employeeIds?: string[] };
}

export interface DashboardRosterMember {
  employee: DashboardRosterEmployee;
  collar: DashboardPayrollCollar;
  slip?: DashboardRosterSlip;
}

export interface DashboardPeriodRoster {
  source: 'sealed_roster' | 'saved_slips' | 'live_roster';
  closed: boolean;
  members: DashboardRosterMember[];
  issues: string[];
}

/** Closed payroll membership comes from that month's records, never today's status. */
export function resolveDashboardPeriodRoster(input: {
  period: string;
  periodData?: DashboardPayrollPeriod;
  loyalisEmployees: readonly DashboardRosterEmployee[];
  blueEmployees: readonly DashboardRosterEmployee[];
  slips: Readonly<Record<string, DashboardRosterSlip>>;
}): DashboardPeriodRoster {
  const { period, periodData, loyalisEmployees, blueEmployees, slips } = input;
  const closed = periodData?.attendanceStatus === 'closed';
  const sealedIds = periodData?.payrollRosterSeal?.employeeIds;
  const source = closed
    ? Array.isArray(sealedIds) ? 'sealed_roster' : 'saved_slips'
    : 'live_roster';
  const result: DashboardPeriodRoster = { source, closed, members: [], issues: [] };
  const employees = new Map<string, { employee: DashboardRosterEmployee; collar: DashboardPayrollCollar }>();
  for (const [list, collar] of [[loyalisEmployees, 'loyalis'], [blueEmployees, 'pekarya']] as const) {
    for (const employee of list) {
      if (employees.has(employee.id)) {
        result.issues.push(`ID pegawai payroll digunakan pada dua kelompok: ${employee.id}.`);
      }
      employees.set(employee.id, { employee, collar });
    }
  }

  let ids: string[];
  if (closed) {
    ids = Array.isArray(sealedIds) ? sealedIds : Object.keys(slips).filter(id =>
      slips[id].status === 'draft' || isImmutablePayrollStatus(slips[id].status),
    );
  } else {
    ids = buildPayrollRoster(
      blueEmployees.map(employee => ({ id: employee.id, data: employee })),
      loyalisEmployees.map(employee => ({ id: employee.id, data: employee })),
      period.replace('_', '-'),
    ).entries.map(entry => entry.employeeId);
    // An employee deactivated after finalization still owns their finalized pay.
    ids.push(...Object.keys(slips).filter(id => isImmutablePayrollStatus(slips[id].status)));
  }

  let missingSlips = 0;
  let unknownEmployees = 0;
  for (const id of [...new Set(ids)].sort()) {
    const slip = slips[id];
    if (closed && !Array.isArray(slip?.earnings)) {
      missingSlips++;
      continue;
    }
    let member = employees.get(id);
    if (!member) {
      // Legacy slips did not store the collection. Their stable IDs retain it.
      const collection: PayrollEmployeeCollection | undefined =
        slip?.employeeCollection === 'Employees_Loyalis' || /^Loyalis_/.test(id)
          ? 'Employees_Loyalis'
          : slip?.employeeCollection === 'Employees_BlueCollar' || /^BC_/.test(id)
            ? 'Employees_BlueCollar' : undefined;
      if (!collection) {
        unknownEmployees++;
        continue;
      }
      member = { employee: { id }, collar: collection === 'Employees_Loyalis' ? 'loyalis' : 'pekarya' };
    }
    result.members.push({
      ...member,
      employee: member.collar === 'pekarya'
        ? withPayrollJobCategory(member.employee, period.replace('_', '-')) : member.employee,
      slip,
    });
  }
  if (missingSlips) result.issues.push(`${missingSlips} pegawai dalam roster tersimpan belum memiliki data slip.`);
  if (unknownEmployees) result.issues.push(`${unknownEmployees} pegawai dalam slip belum dapat dikenali kelompoknya.`);
  return result;
}
