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
8. **Presensi Penalty**: `Working Days * Expected Hours * Rp 1.650` earnings; shortfall deduction `Round(Absence Minutes / 60 * Rp 1.650)`.
