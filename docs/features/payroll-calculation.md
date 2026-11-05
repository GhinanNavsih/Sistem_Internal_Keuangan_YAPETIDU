# Payroll calculation

## Payroll Calculation Logic

### White-collar salary (`src/utils/payrollLogic.ts`, pure logic split into `src/lib/payroll/salaryMatrix.ts` so it's importable from API routes without the client SDK)

1. **Gaji Pokok (Base Salary)**: `calculateGapok()`. Years of service from `joinDate`/`dateRecognized`, adjusted forward to the 5th of the target payslip month, mapped to the active `SalaryMatrix_WhiteCollar` version with lower-bound clamping.
2. **Tunjangan Keluarga**: Spouse 5% of Gapok; children SD 5% / SLTP 7.5% / SLTA 10% / PT 12.5%.
   - An SD child is entered by **birth date** (`birth_date`, mirrored into `enrolled_at` as the allowance start): paid from birth, so a child not yet in school counts, and it stops in the month of the 13th birthday (`stageGraduationDate` in `familyAllowance.ts`, same month-end rule as graduation). Older SD rows saved with a masuk date and no `birth_date` keep ending at masuk + 6 years. The employee request page (`/employee/family-allowance`) asks for the birth date and an akta/KK proof for SD.
3. **Tunjangan Fungsional**: matches a 6-char standardized `educationLevel` prefix in `SalaryMatrix_Functional`.
4. **Tunjangan Struktural**: multi-position stacking — highest position 100%, subsequent positions 50% each.
5. **Tunjangan Hari Tua**: flat 10% of Gapok.
6. **Tunjangan BPJS**: from `bpjs.t_bpjs_tk` / `bpjs.t_bpjs_kes`.
7. **Beras**: `salaryProfile.tunjanganBeras`.
8. **Presensi & Bonus Presensi** (Loyalis; rules in `src/lib/payroll/loyalisPresencePay.ts`, `loyalisPresenceAmounts`):
   - **From period 2026-11** (`LOYALIS_NET_PRESENCE_START_PERIOD`): both are 0 until the period's `LoyalisPresence` has imported entries. After the import both are paid **net** on the earnings side, and the slip has no Potongan Presensi / Potongan Bonus Presensi rows.
     - Presensi = `Round(Working Days × Expected Hours × Rp 1.650) − Round(Absence Minutes / 60 × Rp 1.650)`, floored at 0.
     - Bonus Presensi = Rp 250.000 − the stratum deduction: 250k / 150k / 100k / 50k for Strata 1–4, 0 for Strata 5.
     - Strata 5 loses only the bonus; the minutes worked are still paid. A Loyalis missing from the imported entries earns neither.
     - PPh 21 TER is worked out on gross earnings, so a shortfall now also lowers taxable gross.
   - **Before 2026-11** (legacy, kept so locked slips never drift): full `Working Days × Expected Hours × Rp 1.650` and Rp 250.000 credited even before import, then the shortfall `Round(Absence Minutes / 60 × Rp 1.650)` and the stratum deduction come back as the two Potongan rows.
   - The Presensi Loyalis page shows the roster total against everyone present every working day and on time (**Selisih Terhadap Kehadiran Ideal**, `summarizeLoyalisPresenceDelta`).
