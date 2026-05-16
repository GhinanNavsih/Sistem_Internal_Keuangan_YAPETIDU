import { BlueCollarEmployee, UraianEntry } from '@/types';
import { REKAP_COLUMNS, computeSlipAmount } from '@/utils/rekapConfig';

/**
 * Calculates the total earnings for a blue collar employee.
 * Includes Gapok, Uraian components, BPJS allowance, and Tunjangan Beras.
 */
export function calculateTotalEarnings(emp: BlueCollarEmployee, gapok: number, uraian?: UraianEntry): number {
  let total = gapok;
  const jobCategory = emp.employment?.jobCategory || '';
  const columns = REKAP_COLUMNS[jobCategory];

  if (columns && uraian) {
    for (const col of columns) {
      if (col.slipLabel) {
        // If it's a count column and we have the raw count, compute it.
        // Otherwise, use the value from the values map (which is already a nominal currency amount).
        let amount = 0;
        if (col.type === 'count' && uraian.counts && uraian.counts[col.key] !== undefined) {
          amount = computeSlipAmount(col, uraian.counts[col.key]);
        } else {
          amount = uraian.values[col.key] ?? 0;
        }
        total += amount;
      }
    }
  }

  if (emp.bpjs?.allowanceAmount) {
    total += Math.round(emp.bpjs.allowanceAmount);
  }

  if (emp.salaryProfile?.tunjanganBeras) {
    total += emp.salaryProfile.tunjanganBeras;
  }

  return total;
}

/**
 * Calculates the total deductions for a blue collar employee.
 * Includes BPJS deductions and Koperasi Rochmad.
 */
export function calculateTotalDeductions(emp: BlueCollarEmployee): number {
  let total = 0;

  if (emp.bpjs?.deductionAmount) {
    total += Math.round(emp.bpjs.deductionAmount);
  }

  if (emp.deductions?.koperasiRochmad) {
    total += emp.deductions.koperasiRochmad;
  }

  // Note: Add other deductions here as they become available in the schema
  
  return total;
}

/**
 * Calculates net salary.
 */
export function calculateNetSalary(earnings: number, deductions: number): number {
  return earnings - deductions;
}
