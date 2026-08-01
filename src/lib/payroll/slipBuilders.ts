import { UraianEntry, RekapColumn } from '@/types';
import { getRekapColumns, computeSlipAmount } from '@/utils/rekapConfig';

/**
 * The canonical earnings/deductions builders for a payslip.
 *
 * These used to live inside PaySlipDialog, which made them unreachable from an
 * API route. They are pure and free of Firebase imports so both the dashboard
 * and the server can derive the same numbers from the same employee document.
 */
export interface SlipField {
  label: string;
  amount: number;
}

/**
 * The rekap columns a blue-collar slip is built from, for one Uraian entry.
 *
 * Which column set applies depends on the entry itself: once attendance is
 * published, `presensi` is replaced by the `harian` / `jumatLibur` pair. Both
 * the builder below and the Uraian propagation route resolve it through here,
 * so the set of labels the rekap owns can never drift from the set the builder
 * actually emits.
 */
export function resolveRekapColumnsForSlip(
  jobCategory: string,
  uraian?: UraianEntry,
  customColumns?: RekapColumn[],
): RekapColumn[] {
  const attendanceDerived =
    Boolean((uraian as { attendanceSource?: unknown } | undefined)?.attendanceSource) ||
    Boolean(
      uraian?.values &&
        ('harian' in uraian.values || 'jumatLibur' in uraian.values) &&
        !('presensi' in uraian.values),
    );
  return [
    ...getRekapColumns(jobCategory, attendanceDerived ? '2026-08' : undefined),
    ...(customColumns || []),
  ];
}

/**
 * Build initial earnings rows from whatever we know about the employee.
 */
export function buildInitialEarnings(
  emp: any,
  gapok: number,
  activeTab?: string,
  uraian?: UraianEntry,
  vakasiTambahanSum?: number,
  vakasiTambahanList?: { eventName: string; payGiven: number }[],
  tunjanganFungsional?: number,
  tunjanganKepangkatan?: number,
  customColumns?: RekapColumn[],
  presenceBonus = 0,
  presensiEarning = 0
): SlipField[] {
  const earnings: SlipField[] = [];

  if (activeTab === 'loyalis') {
    // White Collar / Loyalis calculations
    earnings.push({ label: 'Gaji Pokok', amount: gapok });

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
    earnings.push({ label: 'T. Keluarga', amount: tunjKeluarga });

    // Tunjangan Jabatan (Kofu) -> mapped to T. Fungsional
    earnings.push({ label: 'T. Fungsional', amount: tunjanganFungsional ?? 0 });

    // Kepangkatan
    const tKepangkatan = tunjanganKepangkatan !== undefined
      ? tunjanganKepangkatan
      : (emp.kepangkatan?.t_kepangkatan || 0);
    earnings.push({ label: 'Kepangkatan', amount: tKepangkatan });

    // Instruksional
    const tInstruksional = emp.t_instruksional || 0;
    earnings.push({ label: 'Instruksional', amount: tInstruksional });

    // T. Hari Tua (10% of Gaji Pokok)
    earnings.push({ label: 'T. Hari Tua', amount: Math.round(gapok * 0.1) });

    // T. BPJS TK
    earnings.push({ label: 'T. BPJS TK', amount: emp.bpjs?.t_bpjs_tk || 0 });

    // T. BPJS KES
    earnings.push({ label: 'T. BPJS KES', amount: emp.bpjs?.t_bpjs_kes || 0 });

    // Beras
    const tunjBeras = emp.salaryProfile?.tunjanganBeras || 0;
    earnings.push({ label: 'Beras', amount: tunjBeras });

    // Presensi
    earnings.push({ label: 'Presensi', amount: presensiEarning });

    // Bonus Presensi
    earnings.push({ label: 'Bonus Presensi', amount: presenceBonus });

    // Piket
    earnings.push({ label: 'Piket', amount: 0 });

    // Lembur
    earnings.push({ label: 'Lembur', amount: 0 });

    // Struktural
    const positions = emp.employment_profile?.structural_positions || [];
    if (positions.length > 0) {
      const sorted = [...positions].sort((a: any, b: any) => (Number(b.allowance) || 0) - (Number(a.allowance) || 0));
      sorted.forEach((pos, idx) => {
        const amt = Number(pos.allowance) || 0;
        if (idx === 0) {
          earnings.push({ label: `Struktural: ${pos.name}`, amount: amt });
        } else {
          const adjustedAmt = Math.round(amt / 2);
          earnings.push({
            label: `Struktural: ${pos.name} (50% dari Rp ${amt.toLocaleString('id-ID')})`,
            amount: adjustedAmt,
          });
        }
      });
    } else {
      const structuralRole = emp.employment_profile?.department_unit || emp.employment_profile?.job_role || 'Struktural';
      earnings.push({ label: `Struktural: ${structuralRole}`, amount: 0 });
    }

    // Vakasi Tambahan - show each event worked
    if (vakasiTambahanList && vakasiTambahanList.length > 0) {
      vakasiTambahanList.forEach((item) => {
        earnings.push({ label: item.eventName, amount: item.payGiven });
      });
    } else if (vakasiTambahanSum && vakasiTambahanSum > 0) {
      earnings.push({ label: 'Vakasi Tambahan', amount: vakasiTambahanSum });
    }
  } else {
    const jobCategory = emp.employment?.jobCategory || '';
    const allCols = resolveRekapColumnsForSlip(jobCategory, uraian, customColumns);

    // Gaji Pokok – always known
    earnings.push({ label: 'Gaji Pokok', amount: gapok });

    if (allCols.length > 0) {
      for (const col of allCols) {
        if (col.slipLabel) {
          let amount = 0;
          if (uraian) {
            if (col.type === 'count' && uraian.counts && uraian.counts[col.key] !== undefined) {
              amount = computeSlipAmount(col, uraian.counts[col.key]);
            } else if (uraian.values && uraian.values[col.key] !== undefined) {
              amount = uraian.values[col.key] ?? 0;
            }
          }
          // Auto-fill SPJ from vakasiTambahanSum or emp.spjAmount if amount is 0
          if (col.key === 'spj' && amount === 0) {
            if (vakasiTambahanSum && vakasiTambahanSum > 0) {
              amount = vakasiTambahanSum;
            } else if (emp.spjAmount) {
              amount = emp.spjAmount;
            }
          }
          earnings.push({ label: col.slipLabel, amount });
        }
      }
    }

    // BPJS Allowance – we have this
    if (emp.bpjs?.allowanceAmount) {
      earnings.push({ label: 'BPJS (Tunjangan)', amount: Math.round(emp.bpjs.allowanceAmount) });
    }

    // Tunjangan Beras
    earnings.push({
      label: 'Tunjangan Beras',
      amount: emp.salaryProfile?.tunjanganBeras ?? 0
    });

    // Vakasi Tambahan for Pekarya if detailed items exist
    if (vakasiTambahanList && vakasiTambahanList.length > 0) {
      vakasiTambahanList.forEach((item) => {
        earnings.push({ label: item.eventName, amount: item.payGiven });
      });
    }
  }

  return earnings;
}

/**
 * Build initial deduction rows.
 */
export function buildInitialDeductions(
  emp: any,
  activeTab?: string,
  koperasiDeduction = 0,
  presenceDeduction = 0,
  presensiDeduction = 0,
  koperasiSaving = 0
): SlipField[] {
  const deductions: SlipField[] = [];

  if (activeTab === 'loyalis') {
    // White Collar / Loyalis deductions
    deductions.push({ label: 'Koperasi Rochmad', amount: emp.deductions?.koperasiRochmad || 0 });
    deductions.push({ label: 'BPJS', amount: emp.bpjs?.deductionAmount || 0 });
    deductions.push({ label: 'Tabungan Hari Tua BNI Simponi', amount: emp.tht?.deductionAmount || 0 });
    deductions.push({ label: 'Tabungan', amount: emp.savings?.deductionAmount || 0 });
    deductions.push({ label: 'Zakat Infaq Sodaqoh', amount: emp.ziz?.deductionAmount || 0 });
    deductions.push({ label: 'Revisi Gaji', amount: 0 });
    deductions.push({ label: 'Pinlu/Tagihan', amount: emp.pinlu?.deductionAmount || 0 });
    deductions.push({ label: 'Pinjaman Kop. UNIPDU', amount: koperasiDeduction });
    deductions.push({ label: 'Potongan Presensi', amount: presensiDeduction });
    deductions.push({ label: 'Potongan Bonus Presensi', amount: presenceDeduction });
    deductions.push({ label: 'Iuran Wajib Kop. UNIPDU', amount: koperasiSaving });
  } else {
    // Blue Collar deductions matching standardized layout
    deductions.push({ label: 'Koperasi Rochmad', amount: emp.deductions?.koperasiRochmad || 0 });
    deductions.push({ label: 'BPJS', amount: emp.bpjs?.deductionAmount ? Math.round(emp.bpjs.deductionAmount) : 0 });
    deductions.push({ label: 'Tabungan Hari Tua BNI Simponi', amount: emp.tht?.deductionAmount || 0 });
    deductions.push({ label: 'Tabungan', amount: emp.savings?.deductionAmount || 0 });
    deductions.push({ label: 'Zakat Infaq Sodaqoh', amount: emp.ziz?.deductionAmount || 0 });
    deductions.push({ label: 'Revisi Gaji', amount: 0 });
    deductions.push({ label: 'Pinlu/Tagihan', amount: emp.pinlu?.deductionAmount || 0 });
    deductions.push({ label: 'Pinjaman Kop. UNIPDU', amount: koperasiDeduction || 0 });
    deductions.push({ label: 'Potongan Presensi', amount: presensiDeduction || 0 });
    deductions.push({ label: 'Potongan Bonus Presensi', amount: presenceDeduction || 0 });
    deductions.push({ label: 'Iuran Wajib Kop. UNIPDU', amount: koperasiSaving || 0 });
  }

  return deductions;
}
