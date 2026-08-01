import { differenceInYears } from 'date-fns';
import { Employee, SalaryMatrix } from '@/types';

/**
 * The pure half of the salary-matrix logic. It lives here rather than in
 * @/utils/payrollLogic because that module imports the client Firebase SDK at
 * the top level, which an API route cannot pull in. payrollLogic re-exports
 * everything below, so its existing importers are unaffected.
 */

export function calculateYearsOfService(joinDate: Date, targetDate: Date): number {
  const nextMonth5th = new Date(targetDate.getFullYear(), targetDate.getMonth() + 1, 5);

  // Normalize both dates to midnight local time to avoid time of day / timezone mismatches
  const d1 = new Date(joinDate.getFullYear(), joinDate.getMonth(), joinDate.getDate());
  const d2 = new Date(nextMonth5th.getFullYear(), nextMonth5th.getMonth(), nextMonth5th.getDate());

  return differenceInYears(d2, d1);
}

/** Everything calculateGapok actually reads; Employee satisfies it. */
export type GapokEmployee = Pick<Employee, 'gradeLevel' | 'joinDate' | 'dateRecognized'>;

export function calculateGapok(
  employee: GapokEmployee,
  matrix: SalaryMatrix,
  targetDate: Date
): number {
  const baseDate = employee.dateRecognized || employee.joinDate;
  const years = calculateYearsOfService(baseDate, targetDate);
  const gradeKey = employee.gradeLevel ? employee.gradeLevel.replace(/^Gol\.\s*/i, '') : '';
  const gradeMatrix = matrix[gradeKey] || matrix[employee.gradeLevel];

  if (!gradeMatrix) return 0;

  const availableYears = Object.keys(gradeMatrix).map(Number).sort((a, b) => b - a);
  const minYear = Math.min(...availableYears);
  const effectiveYears = years < minYear ? minYear : years;

  const applicableYear = availableYears.find((y) => effectiveYears >= y);

  if (applicableYear !== undefined) {
    return gradeMatrix[applicableYear];
  }

  return 0;
}

export function matchFunctionalAllowance(
  educationLevel: string | undefined | null,
  functionalTier: number | string | undefined | null,
  functionalMatrix: Record<string, { base_value: number; functional_tiers: Record<string, number> }>
): number {
  if (!educationLevel) return 0;

  // Clean educationLevel and take 6-char prefix
  const cleanEmpPrefix = educationLevel.trim().substring(0, 6).toUpperCase();

  // Find matching row in matrix
  const matchedKey = Object.keys(functionalMatrix).find(key =>
    key.trim().substring(0, 6).toUpperCase() === cleanEmpPrefix
  );

  if (!matchedKey) return 0;

  const row = functionalMatrix[matchedKey];
  const tierStr = String(functionalTier !== undefined && functionalTier !== null ? functionalTier : '').trim();

  // If functionalTier is specifically '0', return 0
  if (tierStr === '0') {
    return 0;
  }

  // If functionalTier is empty/null, default to base_value
  if (!tierStr || tierStr === 'null' || tierStr === 'undefined') {
    return row.base_value;
  }

  // If tier is in functional_tiers, return it
  if (row.functional_tiers[tierStr] !== undefined) {
    return row.functional_tiers[tierStr];
  }

  // Fallback to base_value
  return row.base_value;
}

/**
 * The subset of an employee document the slip builders need in order to reach a
 * Gaji Pokok. Both SDKs are handled: the admin SDK and the client SDK produce
 * Timestamps, while seeded/imported documents can hold ISO strings.
 */
export interface SlipEmployeeView {
  id: string;
  gradeLevel: string;
  joinDate: Date;
  dateRecognized?: Date;
  role: string;
}

/** Firestore dates arrive as an admin/client Timestamp, a raw {seconds}, or an ISO string. */
function toDate(value: unknown): Date | undefined {
  if (!value) return undefined;
  if (value instanceof Date) return value;
  if (typeof value === 'object') {
    const candidate = value as { toDate?: () => Date; seconds?: number };
    if (typeof candidate.toDate === 'function') return candidate.toDate();
    if (typeof candidate.seconds === 'number') return new Date(candidate.seconds * 1000);
    return undefined;
  }
  if (typeof value !== 'string' && typeof value !== 'number') return undefined;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? undefined : parsed;
}

export interface ProfileLike {
  id: string;
  academic_and_tier?: { level_code?: string };
  employment_profile?: {
    date_of_hire?: unknown;
    date_recognized?: unknown;
    job_role?: string;
  };
  salaryProfile?: { salaryGradeCode?: string };
  employment?: {
    startDate?: unknown;
    dateRecognized?: unknown;
    jobCategory?: string;
  };
}

export function toSlipEmployeeView(
  raw: ProfileLike,
  collar: 'loyalis' | 'blue',
): SlipEmployeeView {
  if (collar === 'loyalis') {
    return {
      id: raw.id,
      gradeLevel: raw.academic_and_tier?.level_code || '',
      joinDate: toDate(raw.employment_profile?.date_of_hire) || new Date(),
      dateRecognized: toDate(raw.employment_profile?.date_recognized),
      role: raw.employment_profile?.job_role || '',
    };
  }
  return {
    id: raw.id,
    gradeLevel: raw.salaryProfile?.salaryGradeCode || '',
    joinDate: toDate(raw.employment?.startDate) || new Date(),
    dateRecognized: toDate(raw.employment?.dateRecognized),
    role: raw.employment?.jobCategory || '',
  };
}
