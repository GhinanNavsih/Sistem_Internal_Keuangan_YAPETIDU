import {
  KOPERASI_NAME_OVERRIDES,
  normalizeKoperasiName,
} from '@/lib/payroll/koperasiNames';
import {
  KOPERASI_ACTIVE_LOAN_STATUS,
  isKoperasiPayrollPayableStatus,
  resolveKoperasiLoanStatus,
  type KoperasiLoanLike,
} from '@/lib/payroll/koperasiLoan';
import { isConvertedAway } from '@/lib/employeeConversion';
import { koperasiMonthlyIuranWajib } from '@/lib/koperasiMembers';

interface PayrollEmployeeLike {
  id: string;
  name?: string;
  personal_info?: { name?: string };
  koperasiAuthUid?: string | null;
  koperasiUserId?: string | null;
  conversion?: unknown;
}

interface KoperasiPayrollLoanLike extends KoperasiLoanLike {
  id: string;
  userId?: string;
  userData?: { namaLengkap?: string };
}

interface KoperasiUserLike {
  id: string;
  uid?: string;
  nama?: string;
  status?: string;
  membershipStatus?: string;
  paymentStatus?: string;
  iuranWajib?: number | null;
}

export interface KoperasiPayrollAmountMaps {
  deductions: Record<string, number>;
  savings: Record<string, number>;
}

function timestampMillis(value: unknown): number {
  if (!value) return 0;
  if (value instanceof Date) return value.getTime();
  if (typeof value === 'string' || typeof value === 'number') {
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? 0 : parsed.getTime();
  }
  const candidate = value as {
    toMillis?: () => number;
    toDate?: () => Date;
    seconds?: number;
  };
  if (typeof candidate.toMillis === 'function') return candidate.toMillis();
  if (typeof candidate.toDate === 'function') return candidate.toDate().getTime();
  return typeof candidate.seconds === 'number' ? candidate.seconds * 1000 : 0;
}

function activationPeriod(loan: KoperasiPayrollLoanLike): string | null {
  let millis = timestampMillis(loan.tanggalDisetujui);
  if (!millis) {
    const activeHistory = (loan.history || [])
      .filter((entry) => entry.status === KOPERASI_ACTIVE_LOAN_STATUS)
      .map((entry) => timestampMillis(entry.timestamp))
      .filter((value) => value > 0);
    if (activeHistory.length > 0) millis = Math.min(...activeHistory);
  }
  if (!millis) return null;
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Jakarta',
    year: 'numeric',
    month: '2-digit',
  }).formatToParts(new Date(millis));
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}`;
}

function isPayrollEligibleLoan(
  loan: KoperasiPayrollLoanLike,
  payrollPeriod: string,
): boolean {
  const tenor = Math.floor(Number(loan.tenor) || 0);
  const paid = Math.max(0, Math.floor(Number(loan.jumlahMenyicil) || 0));
  const balance = Math.max(0, Math.round(Number(loan.sisaHutang) || 0));
  const installment = tenor > 0
    ? Math.round((Number(loan.jumlahPinjaman) || 0) / tenor)
    : 0;
  const activated = activationPeriod(loan);
  return (
    isKoperasiPayrollPayableStatus(resolveKoperasiLoanStatus(loan)) &&
    tenor > 0 &&
    paid < tenor &&
    balance > 0 &&
    installment > 0 &&
    (!activated || activated <= payrollPeriod)
  );
}

function employeeName(employee: PayrollEmployeeLike): string {
  return String(employee.name || employee.personal_info?.name || '').trim();
}

function nameMatches(sourceName: string, targetName: string): boolean {
  if (!sourceName || !targetName) return false;
  if (normalizeKoperasiName(sourceName) === normalizeKoperasiName(targetName)) return true;
  const override = KOPERASI_NAME_OVERRIDES[sourceName.trim()];
  return Boolean(override) &&
    normalizeKoperasiName(override) === normalizeKoperasiName(targetName);
}

export function buildKoperasiPayrollAmountMaps(
  payrollPeriod: string,
  allEmployees: readonly PayrollEmployeeLike[],
  loans: readonly KoperasiPayrollLoanLike[],
  users: readonly KoperasiUserLike[],
): KoperasiPayrollAmountMaps {
  const deductions: Record<string, number> = {};
  const savings: Record<string, number> = {};
  // A Pekarya converted to Loyalis keeps its Koperasi link (the final Pekarya
  // slip still needs it at Verifikasi & Kunci), so only the new Loyalis record
  // may match, or the same installment would be counted twice.
  const employees = allEmployees.filter((employee) => !isConvertedAway(employee));

  for (const loan of loans) {
    if (!isPayrollEligibleLoan(loan, payrollPeriod)) continue;
    const uidMatches = employees.filter(
      (employee) =>
        employee.koperasiAuthUid &&
        employee.koperasiAuthUid === loan.userId,
    );
    const matches = uidMatches.length > 0
      ? uidMatches
      : employees.filter((employee) =>
          nameMatches(
            String(loan.userData?.namaLengkap || ''),
            employeeName(employee),
          ),
        );
    const installment = Math.round(
      (Number(loan.jumlahPinjaman) || 0) / (Number(loan.tenor) || 1),
    );
    for (const employee of matches) {
      deductions[employee.id] = (deductions[employee.id] || 0) + installment;
    }
  }

  for (const user of users) {
    const userUid = user.uid || user.id;
    const uidMatches = employees.filter(
      (employee) =>
        (employee.koperasiUserId && employee.koperasiUserId === user.id) ||
        (employee.koperasiAuthUid && employee.koperasiAuthUid === userUid),
    );
    const matches = uidMatches.length > 0
      ? uidMatches
      : employees.filter((employee) =>
          // A confirmed link wins over another member with the same name.
          !employee.koperasiAuthUid && !employee.koperasiUserId &&
          nameMatches(String(user.nama || ''), employeeName(employee)),
        );
    for (const employee of matches) {
      savings[employee.id] = koperasiMonthlyIuranWajib(user);
    }
  }

  return { deductions, savings };
}
