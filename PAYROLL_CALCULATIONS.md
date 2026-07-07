# Payroll Earning Details Calculation Guide

This document explains the formulas, logic, and database fields used to calculate every earning item on the employee payslip.

---

## 1. Gaji Pokok (Base Salary)

Gaji Pokok is determined dynamically based on the employee's Grade Level, Years of Service, and the active Salary Matrix.

*   **Reference Code:** [calculateGapok](file:///Users/ghinannavsih/Documents/Internal-BAK/src/utils/payrollLogic.ts#L16-L39)
*   **Base Date:** `dateRecognized` (if available), otherwise falling back to `joinDate`.
*   **Years of Service Calculation:** Calculated as the difference in years between the Base Date and the 5th of the next month of the target payslip period.
*   **Grade Level:** Extracted from `academic_and_tier.level_code` or `employment_profile.grade_level` (with prefix `"Gol. "` removed if present).
*   **Logic:**
    1. Fetches the active version of `SalaryMatrix_WhiteCollar`.
    2. Retrieves the row mapping years of service to salary amounts for the grade level.
    3. If the computed years of service are less than the minimum year listed in the matrix, it clamps to that minimum year.
    4. Matches the salary for the highest year in the matrix that is less than or equal to the employee's adjusted years of service.

---

## 2. Tunjangan Keluarga (Family Allowance)

Calculated as a percentage of the Gaji Pokok, based on the number of dependents (spouse and children) registered in the system.

*   **Percentage Formula:**
    *   **Spouse (`spouse_count`):** 5% (0.05)
    *   **Child in SD (`children_sd`):** 5% (0.05)
    *   **Child in SLTP (`children_sltp`):** 7.5% (0.075)
    *   **Child in SLTA (`children_slta`):** 10% (0.10)
    *   **Child in PT / Higher Education (`children_pt`):** 12.5% (0.125)
*   **Formula:**
    $$\text{Tunjangan Keluarga} = \text{Gaji Pokok} \times \sum (\text{dependent\_percentage})$$
    $$\text{Tunjangan Keluarga} = \text{Round}\left(\text{Gaji Pokok} \times \left( \text{spouse} \times 0.05 + \text{sd} \times 0.05 + \text{sltp} \times 0.075 + \text{slta} \times 0.10 + \text{pt} \times 0.125 \right)\right)$$

---

## 3. Tunjangan Fungsional (Functional Allowance)

Determined by the employee's education level and functional tier matching against the functional matrix.

*   **Reference Code:** [matchFunctionalAllowance](file:///Users/ghinannavsih/Documents/Internal-BAK/src/utils/payrollLogic.ts#L116-L153)
*   **Source Fields:** `academic_and_tier.education_level` and `academic_and_tier.functional_tier`.
*   **Logic:**
    1. Standardizes the education level by matching its first 6 characters (case-insensitive).
    2. Matches it to a row in the active version of `SalaryMatrix_Functional`.
    3. If `functional_tier` is specifically `'0'`, the allowance is `0`.
    4. If `functional_tier` is empty or undefined, it defaults to the `base_value` for that education level.
    5. If a matching tier is found in the row's `functional_tiers` mapping, it returns the value for that tier; otherwise, it falls back to the `base_value`.

---

## 4. Tunjangan Kepangkatan (Rank Allowance)

Based on the cumulative credit score of the employee.

*   **Source Fields:** `kepangkatan.cummulativeCredit`
*   **Logic:**
    1. Fetches the active version of `SalaryMatrix_Kepangkatan`.
    2. Matches the employee's cumulative credit score against the matrix rows.
    3. Returns the corresponding `allowance` for that credit score (defaults to `0` if not found).

---

## 5. Tunjangan Struktural (Structural Allowance)

Determined by the structural positions held by the employee. Multiple positions are calculated using a tiered system to prevent full stacking.

*   **Source Fields:** `employment_profile.structural_positions`
*   **Logic:**
    1. Structural positions are sorted in descending order by their allowance amounts.
    2. The position with the **highest** allowance is paid at **100%**.
    3. All other subsequent structural positions are paid at **50%** of their respective allowances.
    4. If the employee has no structural positions, the unit or role defaults to `0` allowance.

---

## 6. Tunjangan Instruksional

*   **Source Fields:** `t_instruksional`
*   **Calculation:** Directly takes the value defined in `employee.t_instruksional` (defaults to `0` if not present).

---

## 7. Tunjangan Hari Tua (Pension Allowance)

An allowance allocated for retirement savings.

*   **Formula:**
    $$\text{Tunjangan Hari Tua} = \text{Round}(\text{Gaji Pokok} \times 10\%)$$

---

## 8. Tunjangan BPJS Ketenagakerjaan & BPJS Kesehatan

Yayasan-subsidized allowances for employee health and work security programs.

*   **Source Fields:**
    *   **T. BPJS TK:** `bpjs.t_bpjs_tk` (defaults to `0`)
    *   **T. BPJS KES:** `bpjs.t_bpjs_kes` (defaults to `0`)

---

## 9. BERAS (Rice Allowance)

*   **Source Fields:** `salaryProfile.tunjanganBeras`
*   **Calculation:** Directly takes the value defined in `employee.salaryProfile.tunjanganBeras` (defaults to `0` if not present).

---

## 10. Presensi & Bonus Presensi (Attendance Earning)

Attendance earnings are set to maximum values under Penerimaan (Earnings), and any shortfalls are deducted under Potongan (Deductions).

*   **Presensi (Attendance Hours Earning):**
    *   **Expected Earning:**
        $$\text{Expected Earning} = \text{Working Days} \times \text{Expected Hours} \times \text{Rp } 1,650$$
        *(Working Days is based on the actual number of active working days in the calendar month)*
    *   **Deduction (under Potongan):**
        $$\text{Potongan Presensi} = \text{Round}\left(\frac{\text{Absence Minutes}}{60} \times \text{Rp } 1,650\right)$$
*   **Bonus Presensi:**
    *   **Default Earning:** Flat `Rp 250,000` (max possible bonus).
    *   **Deduction (under Potongan):** Evaluated from the uploaded presence entries for the period (`deduction` field).

---

## 11. Vakasi Tambahan (Additional Vacation/Event Pay)

Pay given for participation in approved events during the period.

*   **Source Collection:** `VakasiTambahan`
*   **Logic:**
    1. Looks for documents where `period` matches the target token (`YYYY-MM`) and the `status` is `'approved'` (or not set).
    2. Sums up all `payGiven` entries matching the employee's ID (`empId`) under the `eventWorkers` field.
