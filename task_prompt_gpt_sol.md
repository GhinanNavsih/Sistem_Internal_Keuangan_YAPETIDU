# Task Prompt: Display Authentic Daily Attendance Logs on Employee Payslip Page

## Context & Goal
In the internal financial and payroll system (`Internal-BAK`), employees view their monthly payslip via `EmployeePayslipPage` (`src/app/employee/payslip/page.tsx`). Under section **"5. PRESENSI & BONUS PRESENSI"**, the employee needs a collapsible/dropdown section titled **"Detail Presensi Harian"** that displays their authentic daily attendance scan records (`dailyLogs`) uploaded by Finance in **Presensi Loyalis** (`PresensiLoyalisRawPage` at `src/app/dashboard/payroll/uraian/presensi-loyalis-raw/page.tsx`).

---

## Technical Specifications & Architecture

### 1. Database Storage Schema (Firestore)
- **Collection**: `LoyalisPresence`
- **Document ID Format**: `YYYY_MM` (e.g., `2026_07` for July 2026) or `YYYY-MM`.
- **Payload Structure**:
  ```json
  {
    "period": "2026-07",
    "workingDays": 26,
    "expectedHours": 6.5,
    "entries": {
      "01050526359": {
        "employeeId": "abc123xyz",
        "employeeName": "MUHAMMAD GHINAN NAVSIH, S.SI.D",
        "nipy": "01050526359",
        "minutes": 6625,
        "dailyLogs": [
          {
            "Tanggal": "01-07-2026",
            "Jam kerja": "MASUK",
            "Scan masuk": "07:22",
            "Scan pulang": "14:10",
            "duration": 390,
            "scanMasukAuto": false,
            "scanPulangAuto": false
          }
        ]
      }
    }
  }
  ```

---

## The Matching Challenge to Resolve

1. **Key Discrepancy**:
   - In `LoyalisPresence`, `entries` map keys can be indexed either by NIPY (`'01050526359'`), Excel Name, or Firestore Document ID (`'abc123xyz'`).
   - Unlinked employee profile placeholders with empty `dailyLogs: []` can exist alongside the actual imported record containing `dailyLogs: [...]`.

2. **Matching Strategy Required in `EmployeePayslipPage`**:
   - Look up document `LoyalisPresence/2026_07` (fallback to `2026-07`).
   - Iterate through `entries` and find the record where `dailyLogs` is non-empty (`dailyLogs.length > 0`) matching the logged-in employee via:
     1) Firestore Document ID (`employeeId === empId`)
     2) Cleaned NIPY digits (`normalizeNipy(item.nipy) === normalizeNipy(empNipy)`)
     3) Normalized Employee/Excel Name (`normalizeName(item.employeeName) === normalizeName(empName)`)

3. **Fallback for Non-Loyalis (Pekarya / Satpam / Honorer)**:
   - For non-Loyalis roles, if `LoyalisPresence` is absent, load and format daily activity records from the `ActivityReports` collection (`employeeId == empId` for the period window).

---

## Implementation Requirements

1. **UI Location**:
   - In `src/app/employee/payslip/page.tsx`, directly below the **Presensi & Bonus Presensi** formula calculation and stratum list in section 5.
   - Component: A collapsible accordion/dropdown button:
     - Title: `Detail Presensi Harian` (with count badge e.g. `(26 Log Scan)`).
     - State: `showDailyLogs` toggle.

2. **Table Layout**:
   - When expanded, render a responsive table:
     - `NO` | `TANGGAL` | `STATUS` | `SCAN MASUK` | `SCAN PULANG` | `DURASI (mnt)` | `PENDAPATAN (Rp)`
     - Format status badges: `MASUK` (emerald green badge), `Tidak Hadir` (rose red badge), `Libur Rutin` (slate grey badge).
     - Display `(Auto)` tag next to auto-filled scan times.
     - Calculate row income as `duration * 27.5`.

3. **Data Integrity**:
   - Must show real, authentic scan log data fetched from Firestore (`LoyalisPresence` or `ActivityReports`).

---

## Files to Inspect & Modify
1. `src/app/employee/payslip/page.tsx` – Payslip page UI & data loader.
2. `src/app/dashboard/payroll/uraian/presensi-loyalis-raw/page.tsx` – Reference for how `LoyalisPresence` entries and `dailyLogs` are constructed and saved.
3. `src/lib/payroll/attendance.ts` & `src/utils/payrollLogic.ts` – NIPY & name normalization utilities.
