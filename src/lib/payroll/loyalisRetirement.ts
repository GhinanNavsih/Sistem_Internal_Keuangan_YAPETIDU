import type { LoyalisType } from '@/lib/employeeConversion';
import { isDateOnly } from '@/lib/payroll/familyAllowance';

export interface LoyalisRetirementEmployee {
  id: string;
  name: string;
  active: boolean;
  type: LoyalisType | '';
  nik: unknown;
}

export interface LoyalisRetirementEntry {
  id: string;
  name: string;
  type: 'Admin' | 'Dosen';
  birthMonth: string;
  retirementMonth: string;
  estimated: boolean;
}

export interface LoyalisRetirementReviewItem {
  id: string;
  name: string;
  reason: 'type' | 'birthMonth';
}

export interface ConfirmedLoyalisBirthMonth {
  employeeId: string;
  birthMonth: string;
}

export function isLoyalisBirthMonth(value: unknown, today: string): value is string {
  return typeof value === 'string' && isDateOnly(`${value}-01`) && value <= today.slice(0, 7);
}

function estimateBirthMonth(nik: unknown, today: string): string | undefined {
  if (typeof nik !== 'string' && !(typeof nik === 'number' && Number.isSafeInteger(nik))) return;
  const digits = String(nik).trim();
  if (!/^\d{16}$/.test(digits)) return;

  const encodedDay = Number(digits.slice(6, 8));
  const day = String(encodedDay > 40 ? encodedDay - 40 : encodedDay).padStart(2, '0');
  const month = digits.slice(8, 10);
  const yearSuffix = Number(digits.slice(10, 12));
  const currentYear = Number(today.slice(0, 4));
  const currentCentury = Math.floor(currentYear / 100) * 100;
  // NIK carries a two-digit year. Retain only real dates with a plausible adult age.
  const dates = [currentCentury - 100, currentCentury]
    .map(century => `${century + yearSuffix}-${month}-${day}`)
    .filter(date => {
      if (!isDateOnly(date)) return false;
      const age = currentYear - Number(date.slice(0, 4)) - Number(date.slice(5) > today.slice(5));
      return age >= 18 && age <= 99;
    });
  return dates.length === 1 ? dates[0].slice(0, 7) : undefined;
}

export function buildLoyalisRetirementReview(
  employees: readonly LoyalisRetirementEmployee[],
  confirmed: readonly ConfirmedLoyalisBirthMonth[],
  today: string,
) {
  const currentMonth = today.slice(0, 7);
  const confirmedMonths = new Map(confirmed.map(row => [row.employeeId, row.birthMonth]));
  const scheduled: LoyalisRetirementEntry[] = [];
  const incomplete: LoyalisRetirementReviewItem[] = [];

  for (const { id, name, active, type, nik } of employees) {
    if (!active || type === 'Keluarga') continue;
    if (!type) {
      incomplete.push({ id, name, reason: 'type' });
      continue;
    }

    const confirmedMonth = confirmedMonths.get(id);
    const isConfirmed = isLoyalisBirthMonth(confirmedMonth, today);
    const birthMonth = isConfirmed ? confirmedMonth : estimateBirthMonth(nik, today);
    if (!birthMonth) {
      incomplete.push({ id, name, reason: 'birthMonth' });
      continue;
    }

    const retirementAge = type === 'Admin' ? 59 : 65;
    const retirementMonth = `${Number(birthMonth.slice(0, 4)) + retirementAge}${birthMonth.slice(4)}`;
    scheduled.push({ id, name, type, birthMonth, retirementMonth, estimated: !isConfirmed });
  }

  const byName = (left: { name: string; id: string }, right: { name: string; id: string }) =>
    left.name.localeCompare(right.name, 'id') || left.id.localeCompare(right.id);
  scheduled.sort((left, right) => left.retirementMonth.localeCompare(right.retirementMonth) || byName(left, right));
  const nextMonth = scheduled.find(row => row.retirementMonth >= currentMonth)?.retirementMonth;

  return {
    nextMonth,
    upcoming: scheduled.filter(row => row.retirementMonth === nextMonth),
    overdue: scheduled.filter(row => row.retirementMonth < currentMonth),
    incomplete: incomplete.sort(byName),
  };
}
