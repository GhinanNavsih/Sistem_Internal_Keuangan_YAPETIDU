export interface PayrollEmployeeData {
  name?: unknown;
  employment?: { status?: unknown };
  flags?: { isActive?: unknown; isPayrollEligible?: unknown };
  personal_info?: { name?: unknown; status?: unknown };
}

export type PayrollEmployeeCollection =
  | 'Employees_BlueCollar'
  | 'Employees_Loyalis';

export interface PayrollRosterSource {
  id: string;
  data: PayrollEmployeeData;
}

export interface PayrollRosterEntry {
  employeeId: string;
  employeeCollection: PayrollEmployeeCollection;
  name: string;
}

export interface PayrollRosterResult {
  entries: PayrollRosterEntry[];
  duplicateEmployeeIds: string[];
}

export function isPayrollEmployeeEligible(
  employeeCollection: PayrollEmployeeCollection,
  data: PayrollEmployeeData,
): boolean {
  if (employeeCollection === 'Employees_Loyalis') {
    return data.personal_info?.status === 'AKTIF';
  }

  return (
    data.employment?.status === 'active' &&
    data.flags?.isActive !== false &&
    data.flags?.isPayrollEligible !== false
  );
}

function payrollEmployeeName(
  employeeCollection: PayrollEmployeeCollection,
  data: PayrollEmployeeData,
): string {
  return String(
    employeeCollection === 'Employees_Loyalis'
      ? data.personal_info?.name || ''
      : data.name || '',
  ).trim();
}

export function buildPayrollRoster(
  blueEmployees: readonly PayrollRosterSource[],
  loyalisEmployees: readonly PayrollRosterSource[],
): PayrollRosterResult {
  const entries = [
    ...blueEmployees
      .filter(({ data }) =>
        isPayrollEmployeeEligible('Employees_BlueCollar', data),
      )
      .map(({ id, data }) => ({
        employeeId: id,
        employeeCollection: 'Employees_BlueCollar' as const,
        name: payrollEmployeeName('Employees_BlueCollar', data),
      })),
    ...loyalisEmployees
      .filter(({ data }) =>
        isPayrollEmployeeEligible('Employees_Loyalis', data),
      )
      .map(({ id, data }) => ({
        employeeId: id,
        employeeCollection: 'Employees_Loyalis' as const,
        name: payrollEmployeeName('Employees_Loyalis', data),
      })),
  ].sort((left, right) =>
    left.employeeId.localeCompare(right.employeeId) ||
    left.employeeCollection.localeCompare(right.employeeCollection),
  );

  const counts = new Map<string, number>();
  for (const entry of entries) {
    counts.set(entry.employeeId, (counts.get(entry.employeeId) || 0) + 1);
  }

  return {
    entries,
    duplicateEmployeeIds: Array.from(counts.entries())
      .filter(([, count]) => count > 1)
      .map(([employeeId]) => employeeId)
      .sort(),
  };
}

export function missingPayrollRosterEntries(
  roster: readonly PayrollRosterEntry[],
  slipEmployeeIds: ReadonlySet<string>,
): PayrollRosterEntry[] {
  return roster.filter((entry) => !slipEmployeeIds.has(entry.employeeId));
}
