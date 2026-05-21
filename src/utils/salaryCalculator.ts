import { BlueCollarEmployee, UraianEntry } from '@/types';
import { REKAP_COLUMNS, computeSlipAmount } from '@/utils/rekapConfig';

/**
 * Calculates the total earnings for a blue collar employee.
 * Includes Gapok, Uraian components, BPJS allowance, and Tunjangan Beras.
 */
export function calculateTotalEarnings(emp: any, gapok: number, uraian?: UraianEntry): number {
  if (emp.employeeId?.startsWith('Loyalis_') || emp.id?.startsWith('Loyalis_') || emp.personal_info) {
    // White Collar / Loyalis calculations
    let total = gapok;

    // Tunjangan Keluarga formula
    const metrics = emp.family_allowance_metrics;
    let spouseCount = 0, sd = 0, sltp = 0, slta = 0, pt = 0;
    if (metrics) {
      spouseCount = Number(metrics.spouse_count) || 0;
      sd = Number(metrics.children_sd) || 0;
      sltp = Number(metrics.children_sltp) || 0;
      slta = Number(metrics.children_slta) || 0;
      pt = Number(metrics.children_pt) || 0;
    }
    const familyPct = (spouseCount * 0.05) + (sd * 0.05) + (sltp * 0.075) + (slta * 0.1) + (pt * 0.125);
    const tunjKeluarga = Math.round(gapok * familyPct);
    total += tunjKeluarga;

    // Tunjangan Jabatan (Kofu)
    const tunjJabatan = Number(emp.academic_and_tier?.functional_tier) || 0;
    total += tunjJabatan;

    return total;
  }

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
export function calculateTotalDeductions(emp: any): number {
  if (emp.employeeId?.startsWith('Loyalis_') || emp.id?.startsWith('Loyalis_') || emp.personal_info) {
    // White Collar / Loyalis deductions initially default to 0
    return 0;
  }

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

