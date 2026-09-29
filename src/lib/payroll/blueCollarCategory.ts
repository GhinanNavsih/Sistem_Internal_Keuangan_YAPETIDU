/** The employee's current category is operational; payroll needs its category at the period. */
export interface BlueCollarCategoryChange {
  category: string;
  effectiveFrom: string;
}

export interface BlueCollarCategoryEmployee {
  employment?: {
    jobCategory?: string;
    startDate?: unknown;
    jobCategoryHistory?: BlueCollarCategoryChange[];
  };
}

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;
const PERIOD = /^\d{4}-\d{2}$/;

export function jobCategoryForPayrollPeriod(
  employee: BlueCollarCategoryEmployee,
  period: string,
): string {
  const current = String(employee.employment?.jobCategory || '').trim();
  if (!PERIOD.test(period)) return current;
  const history = employee.employment?.jobCategoryHistory;
  if (!Array.isArray(history) || history.length === 0) return current;
  const valid = history
    .filter((entry) =>
      entry && typeof entry.category === 'string' && entry.category.trim() &&
      typeof entry.effectiveFrom === 'string' && DATE_ONLY.test(entry.effectiveFrom),
    )
    .sort((left, right) => left.effectiveFrom.localeCompare(right.effectiveFrom));
  if (valid.length === 0) return current;
  const targetDate = `${period}-01`;
  return [...valid].reverse().find((entry) => entry.effectiveFrom <= targetDate)?.category ||
    valid[0].category;
}

export function withPayrollJobCategory<T extends BlueCollarCategoryEmployee>(
  employee: T,
  period: string,
): T {
  return {
    ...employee,
    employment: {
      ...employee.employment,
      jobCategory: jobCategoryForPayrollPeriod(employee, period),
    },
  } as T;
}

/** Called inside the authenticated transfer transaction after reading the latest profile. */
export function appendJobCategoryChange(
  employee: BlueCollarCategoryEmployee,
  nextCategory: string,
  effectiveFrom: string,
): BlueCollarCategoryChange[] {
  const previous = String(employee.employment?.jobCategory || '').trim();
  if (!previous || !nextCategory.trim() || previous === nextCategory) {
    throw new Error('Kategori lama dan baru wajib berbeda dan terisi.');
  }
  if (!DATE_ONLY.test(effectiveFrom) || !effectiveFrom.endsWith('-01')) {
    throw new Error('Perpindahan kategori harus efektif pada tanggal 1 periode payroll.');
  }
  const existing = employee.employment?.jobCategoryHistory;
  const history = Array.isArray(existing) && existing.length > 0
    ? [...existing]
    : [{
        category: previous,
        effectiveFrom:
          typeof employee.employment?.startDate === 'string' &&
          DATE_ONLY.test(employee.employment.startDate)
            ? employee.employment.startDate
            : '1900-01-01',
      }];
  const latest = history[history.length - 1];
  if (latest.category !== previous || latest.effectiveFrom >= effectiveFrom) {
    throw new Error('Riwayat kategori tidak cocok dengan profil atau tanggal perpindahan.');
  }
  return [...history, { category: nextCategory.trim(), effectiveFrom }];
}
