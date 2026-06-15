import { BlueCollarEmployee, UraianEntry } from '@/types';
import { REKAP_COLUMNS, computeSlipAmount } from '@/utils/rekapConfig';

/**
 * Calculates the total structural allowance based on the descending-halving rules.
 */
export function calculateStructuralAllowance(positions: any[]): number {
  if (!positions || positions.length === 0) return 0;
  const sorted = [...positions].sort((a, b) => (Number(b.allowance) || 0) - (Number(a.allowance) || 0));
  let total = 0;
  sorted.forEach((pos, idx) => {
    const amt = Number(pos.allowance) || 0;
    if (idx === 0) {
      total += amt;
    } else {
      total += Math.round(amt / 2);
    }
  });
  return total;
}

/**
 * Calculates the total earnings for a blue collar employee.
 * Includes Gapok, Uraian components, BPJS allowance, and Tunjangan Beras.
 */
export function calculateTotalEarnings(
  emp: any,
  gapok: number,
  uraian?: UraianEntry,
  vakasiTambahanSum?: number,
  tunjanganFungsional?: number,
  presenceBonus = 0,
  presensiEarning = 0
): number {
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

    // T. Hari Tua (10% of Gaji Pokok)
    total += Math.round(gapok * 0.1);

    // Tunjangan Jabatan (Kofu) - use passed tunjanganFungsional or fallback
    const fAllowance = tunjanganFungsional !== undefined 
      ? tunjanganFungsional 
      : (Number(emp.academic_and_tier?.functional_tier) || 0);
    total += fAllowance;

    // Tunjangan Struktural
    const structuralAllowance = calculateStructuralAllowance(emp.employment_profile?.structural_positions || []);
    total += structuralAllowance;

    // Vakasi Tambahan (Loyalis)
    if (vakasiTambahanSum) {
      total += vakasiTambahanSum;
    }

    // Dynamic presence bonus
    if (presenceBonus) {
      total += presenceBonus;
    }

    // Dynamic presensi earning
    if (presensiEarning) {
      total += presensiEarning;
    }

    // BPJS & Beras Allowances (Loyalis)
    if (emp.bpjs?.t_bpjs_tk) {
      total += emp.bpjs.t_bpjs_tk;
    }
    if (emp.bpjs?.t_bpjs_kes) {
      total += emp.bpjs.t_bpjs_kes;
    }
    if (emp.salaryProfile?.tunjanganBeras) {
      total += emp.salaryProfile.tunjanganBeras;
    }

    return total;
  }

  let total = gapok;
  const jobCategory = emp.employment?.jobCategory || '';
  const columns = REKAP_COLUMNS[jobCategory];

  if (columns && uraian) {
    const processedKeys = new Set<string>();
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
        processedKeys.add(col.key);
      }
    }

    // Automatically include any custom dynamic columns in the total earnings calculation!
    if (uraian.values) {
      Object.entries(uraian.values).forEach(([key, amount]) => {
        if (!processedKeys.has(key) && key !== 'employeeId' && key !== 'name') {
          total += amount;
        }
      });
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
export function calculateTotalDeductions(
  emp: any,
  koperasiDeduction = 0,
  presenceDeduction = 0,
  presensiDeduction = 0,
  koperasiSaving = 0
): number {
  if (emp.employeeId?.startsWith('Loyalis_') || emp.id?.startsWith('Loyalis_') || emp.personal_info) {
    // White Collar / Loyalis deductions: include BPJS deduction, Savings deduction, presence deduction, presensi deduction, and koperasi saving
    const bpjsDeduction = emp.bpjs?.deductionAmount || 0;
    const savingsDeduction = emp.savings?.deductionAmount || 0;
    return koperasiDeduction + bpjsDeduction + savingsDeduction + presenceDeduction + presensiDeduction + koperasiSaving;
  }

  let total = 0;

  if (emp.bpjs?.deductionAmount) {
    total += Math.round(emp.bpjs.deductionAmount);
  }

  if (emp.deductions?.koperasiRochmad) {
    total += emp.deductions.koperasiRochmad;
  }

  total += koperasiDeduction;
  total += koperasiSaving;
  
  return total;
}

/**
 * Calculates net salary.
 */
export function calculateNetSalary(earnings: number, deductions: number): number {
  return earnings - deductions;
}
