# Internal-BAK — Project Knowledge

## Stack

- **Framework**: Next.js 16.2.5 (App Router, Turbopack), React 19.2.4
- **Language**: TypeScript 5
- **Styling**: Tailwind CSS 4, shadcn/ui primitives (`src/components/ui/`), `class-variance-authority` + `tailwind-merge` for variant styling, `lucide-react` icons
- **Database**: Firebase Firestore & Storage (client SDK v12.12.1 + `firebase-admin` v13.8.0). A secondary Firebase project ("Koperasi Unipdu") is wired in alongside the primary one — see Database Collections below.
- **Auth**: Firebase Authentication (email/password)
- **OCR/AI Scanning**: Gemini API (`@google/generative-ai`) + `tesseract.js` + `pdfjs-dist`
- **PDF Generation**: jsPDF 4 + jspdf-autotable 5 (see the many `src/utils/generate*Pdf.ts` files, one per document type)
- **Excel Utilities**: XLSX (SheetJS) for spreadsheet imports/seeds/exports
- **Other notable deps**: `date-fns` (date math), `exifreader` (photo EXIF metadata audit, see `src/lib/exif.ts`), `nodemailer` (payslip/notification email), `recharts` (dashboard charts), `dotenv` (script env loading via `scripts/initEnv.ts`)
- **Tests**: no Jest/Vitest — `npm test` runs `tsx --test` directly over ~26 `*.test.ts` files, concentrated in `src/lib/payroll/`

---

## Project Structure

```text
src/
├── app/
│   ├── api/                       # 17 route groups / ~57 endpoints: admin, attendance, auth, employee,
│   │                              #   driver-journeys, events, facility-reports, koperasi, maps, payroll,
│   │                              #   pekarya, satpam, uploads, parse-rekap, calculate-route, proxy-image
│   ├── dashboard/
│   │   ├── employees/             # Employee master data admin
│   │   ├── users/                 # User/role management
│   │   └── payroll/
│   │       ├── page.tsx           # Payroll Bulanan landing
│   │       ├── activity-review/   # Approve/audit honorer activity + SOPIR trip reports
│   │       ├── driver-journeys/   # Driver trip assignment/dashboard
│   │       ├── pekarya-dashboard/
│   │       ├── facility-reports/
│   │       ├── master/            # Salary matrix / master data editing
│   │       ├── simpan-pinjam/     # Koperasi loan admin view
│   │       └── uraian/            # Blue-collar rekap module + subpages: pelaporan-kegiatan,
│   │                              #   presence-corrections, presensi-loyalis(-raw), presensi-pekarya,
│   │                              #   proposal-kegiatan, rekap-pekarya, spj-pekarya, vakasi-loyalis
│   ├── employee/                  # Employee/honorer portal: activities (+ journey-report), payslip,
│   │                              #   driver-history, leave, satpam-duty-plan, presensi-correction,
│   │                              #   facility-reports, simpan-pinjam
│   ├── globals.css
│   ├── layout.tsx
│   └── page.tsx
├── components/
│   ├── Sidebar.tsx / GlobalHeader.tsx / EmployeeNavigationMenu.tsx / SatkerPekaryaNavBar.tsx
│   ├── ProtectedRoute.tsx         # Auth + per-role route confinement (see RBAC below)
│   ├── DriverJourneyAuditDialog.tsx  # SOPIR trip audit/edit modal
│   ├── PaySlipDialog.tsx          # Individual pay slip modal
│   ├── Cetak*Dialog.tsx           # Print/export dialogs (one per report type: Payroll, Rekap,
│   │                              #   Kebutuhan Dana Gaji, Potongan Gaji, Tunjangan Jabatan,
│   │                              #   Vakasi Lain-lain/Pimpinan-Staf, Kegiatan Loyalis, Gabungan)
│   ├── pekarya/ , satpam/         # Domain-specific panels (leave, duty/absence, shift-swap)
│   └── ui/                        # shadcn primitives (button, dialog, table, select, etc.)
├── lib/
│   ├── firebase.ts                # Primary + secondary (`secondaryApp`/`secondaryDb`) client config
│   ├── firebase-admin.ts          # Admin SDK (adminDb/adminAuth/adminStorage)
│   ├── koperasi-admin.ts          # Admin SDK for the secondary Koperasi project
│   ├── AuthContext.tsx / DashboardDataContext.tsx / BulkEmailContext.tsx
│   ├── server/                    # Server-only helpers: audit.ts, auth.ts, attendanceStore.ts,
│   │                              #   satpamDutyPlan.ts, satpamFlexibility.ts, koperasiPayrollBridge.ts,
│   │                              #   payrollKoperasiSaga.ts, payrollPeriod.ts, storageUpload.ts
│   └── payroll/                   # ~29 modules (+23 test files), the core payroll library — see below
├── types/index.ts
└── utils/                         # PDF/XLSX generators (generate*Pdf.ts / generate*Xlsx.ts, one per
                                   #   document) + payrollLogic.ts, salaryCalculator.ts, ocrParser.ts,
                                   #   rekapConfig.ts, satpamRotation.ts, whatsappHelper.ts
scripts/                           # ~125 files. Only ~16 are wired into package.json (see Key Scripts);
                                   #   the rest are ad hoc one-off migration/inspection scripts run via
                                   #   `tsx scripts/<file>.ts` directly — don't assume npm coverage.
```

---

## Authentication & RBAC

Roles are defined in `src/lib/payroll/roles.ts` (`USER_ROLES`) and enforced by route-level confinement in `src/components/ProtectedRoute.tsx`. There is **no generic `employee` role** — the closest equivalent is `honorer`.

### Roles:
- `super_admin`: Unrestricted. Redirected out of `/employee/*` back to `/dashboard/users` unless previewing.
- `finance_verifier`: Confined to `/dashboard/payroll*`. Can verify/operate payments alongside `super_admin` (`canVerifyPayroll`, `canOperatePayments`).
- `satker_head`: Department head for blue collar (Pekarya) operations. Confined to `/dashboard/payroll/activity-review`, `/dashboard/payroll/uraian*`, `/dashboard/payroll/driver-journeys*`, `/dashboard/payroll/pekarya-dashboard*`, `/dashboard/payroll/facility-reports*`.
- `satker_head_loyalis`: Department head for Loyalis operations. Confined to `/dashboard/payroll/uraian*`.
- `employee_admin`: Confined to `/dashboard/employees`. Can edit employee profiles (`EMPLOYEE_PROFILE_EDITOR_ROLES`, alongside `super_admin`).
- `honorer`: Generic honorer/blue-collar portal role. Confined to `/employee/*`.
- `loyalis`: Confined to a fixed Loyalis route set: `/employee/payslip`, `/employee/presensi-correction`, `/employee/facility-reports`, `/employee/simpan-pinjam`.
- `loyalis_presence_admin`: Confined to `/dashboard/payroll/uraian/presensi-loyalis-raw` and `/dashboard/payroll/uraian/presence-corrections`.
- `ketua_shift_satpam`: Satpam shift lead. Confined to `/employee/activities`, `/employee/satpam-duty-plan`, `/employee/leave`, `/employee/payslip` — reports daily work, maintains the once-per-period duty plan, views own payslip.

`URAIAN_EDITOR_ROLES` (who may save an Uraian rekap / Loyalis presence calculator, triggering propagation to draft slips): `super_admin`, `finance_verifier`, `satker_head`, `satker_head_loyalis`.

---

## Database Collections (Firestore)

**Primary app** (`db`/`adminDb`) unless noted. ~43 active top-level collections; grouped by domain:

**Employee master data**: `Employees_WhiteCollar`, `Employees_BlueCollar`, `Employees_Loyalis` (nested `personal_info.*`), `JabatanStruktural` (position lookup).

**Salary matrices** — four independently-versioned top-level collections (each keyed by a version doc like `2026_v1` with a `rows` subcollection + `_config.activeVersion`): `SalaryMatrix` (blue-collar gapok), `SalaryMatrix_WhiteCollar` (white-collar gapok), `SalaryMatrix_Functional` (functional allowance tiers), `SalaryMatrix_Kepangkatan` (rank/promotion allowance).

**Attendance / presence**: `LoyalisPresence` (monthly import, keyed by period), `LoyalisPresenceCorrections`, `AttendanceImports` (blue-collar/Pekarya raw import batches).

**Activity / SPJ reporting**: `ActivityReports` (SOPIR/SATPAM/PEKARYA activity & journey submissions), `ActivityReportRevisions` (audit trail), `ActivityReportsIndex` / `PekaryaActivityIndexes` (dedup indexes), `KegiatanSpj` (per-event SPJ fees), `DriverJourneys` (driver trip records), `DriverPiketSchedules` (driver standby roster), `ProposalKegiatan` (LPJ budget proposal headers), `PelaporanKegiatan` (LPJ realization reports), `VakasiTambahan` (supplemental duty allowance events, filtered by `period`), `UraianGaji` (itemized pay component breakdown).

**Satpam duty/shift**: `SatpamDutyPlans` (8-day rotation plans), `SatpamShiftTeams`, `ShiftOccurrences` (materialized per-date/post/team shifts), `GuardDutyIndexes` (dedup index), `SatpamAbsenceRequestRevisions`.

**Payroll core**: `PayrollPeriods`, `PayrollSlipStates` (per-employee-per-period slip — holds the earnings/deductions money rows, not just a status; doc id `{period}_{employeeId}`, shape in `PayrollSlipStateDocument`. Writable statuses are draft/locked/payment_created/paid (`PayrollStatus`); `confirmed` is read-only legacy that `isImmutablePayrollStatus` and the employee payslip query still honour; `pending` is not a slip status — it belongs to `PayrollCorrectionRequests`), `PayrollPayments`, `PayrollLedgerEntries`, `PayrollDeliveryEvents` (email delivery idempotency), `PayrollHolidayCalendars`, `PayrollCorrectionRequests`, `PayrollHistoricalCorrections`, `PayrollKoperasiProgressions` (payroll↔Koperasi bridge saga state), `FinancialIdempotencyKeys`, `FinancialAuditLogs`.

**Admin / auth / misc**: `users`, `EmpEditLog`, `admin_impersonation_sessions`, `audit_logs`, `reactivation_tokens`.

**`Koperasi Unipdu` (secondary Firebase app)**: accessed via `secondaryApp`/`secondaryDb` (client) and `koperasiAdminDb()` in `src/lib/koperasi-admin.ts` (server, separate service-account credential). Collections: `simpanPinjam` (loan/savings records — writes go through `koperasiAdminDb()` only) and `users` (Koperasi-project member records, matched to primary-app employees via `koperasiAuthUid`).

Legacy/migration-only collections (`MasterData`, unsuffixed `Employees`) exist only in one-off `scripts/`, superseded by the collections above — don't treat them as live schema.

---

## Payroll Calculation Logic

### White-collar salary (`src/utils/payrollLogic.ts`, pure logic split into `src/lib/payroll/salaryMatrix.ts` so it's importable from API routes without the client SDK)

1. **Gaji Pokok (Base Salary)**: `calculateGapok()`. Years of service from `joinDate`/`dateRecognized`, adjusted forward to the 5th of the target payslip month, mapped to the active `SalaryMatrix_WhiteCollar` version with lower-bound clamping.
2. **Tunjangan Keluarga**: Spouse 5% of Gapok; children SD 5% / SLTP 7.5% / SLTA 10% / PT 12.5%.
3. **Tunjangan Fungsional**: matches a 6-char standardized `educationLevel` prefix in `SalaryMatrix_Functional`.
4. **Tunjangan Struktural**: multi-position stacking — highest position 100%, subsequent positions 50% each.
5. **Tunjangan Hari Tua**: flat 10% of Gapok.
6. **Tunjangan BPJS**: from `bpjs.t_bpjs_tk` / `bpjs.t_bpjs_kes`.
7. **Beras**: `salaryProfile.tunjanganBeras`.
8. **Presensi Penalty**: `Working Days * Expected Hours * Rp 1.650` earnings; shortfall deduction `Round(Absence Minutes / 60 * Rp 1.650)`.

### The wider payroll library (`src/lib/payroll/`, ~29 modules, most load-bearing ones have a paired `.test.ts`)

- **`domain.ts`** — shared kernel: Satpam post/pay-type constants and resolvers, `SATPAM_RATES`/`SHIFT_TIMES`, payroll-period-token helpers, `calculatePayrollTotals`, and the status guards `isImmutablePayrollStatus`/`isTransferEligibleStatus` that gate whether a slip can still be edited. Most other payroll modules import from here.
- **`driverJourney.ts`** — SOPIR trip wages: per-vehicle rate table, distance/duration/night-premium (`calculateNightPremium`) constants, meal allowance tiers, fuel procurement modes (hold_accumulate/procure_release/standard_direct), reimbursement settlement (`calculateDriverReimbursementSettlement`), net wage (`calculateDriverNetWage`), and journey timeline normalization (`calculateEditableDriverJourneyTimeline` — the single source of truth for overnight/lintas-hari inference, shared by submission and audit).
- **`vehicleFuel.ts`** — Firestore-backed vehicle fuel ledger (reservation state machine: none→reserved→committed→released) supporting `driverJourney.ts`'s procurement modes.
- **`driverPiket.ts`** — driver standby ("piket") duty scheduling across 5 fixed stations + ad-hoc extras.
- **`satpamDutyPlan.ts`** — generates/validates the 8-day Satpam rotation plan, handles Libur swaps, classifies duty assignments into pay types (Harian/Jumat & Libur/Lembur Sendiri/Lembur Cover/Off-Duty).
- **`satpamAttendance.ts`** — default scan-in/out times per Satpam shift + scan-range validation.
- **`pekaryaSpj.ts`** — Pekarya job categories (SATPAM/SOPIR/PEKARYA/TEKNISI/KEBERSIHAN/KEBERSIHAN_PONTI/PONTI) and activity types; computes approved SPJ amounts and payroll period windows.
- **`pekaryaOfficialLeave.ts`** — official-leave (`izin_resmi`) fixed scan times and request lifecycle.
- **`attendance.ts`** — general Pekarya attendance normalization/consolidation (NIPY/PIN resolution, duplicate-day consolidation, `PEKARYA_ATTENDANCE_RATES`).
- **`loyalisPresenceWindow.ts`** / **`loyalisPresenceWorkbook.ts`** — Loyalis presence: single-scan auto-fill and work-window (07:30–14:00) duration calculation; parsing of uploaded presence Excel workbooks into normalized rows with issue flagging.
- **`presenceCorrections.ts`** — employee-submitted presence correction requests (tap_in/tap_out/both/izin_resmi) and their pending/approved/rejected lifecycle.
- **`calendar.ts`** — per-period work calendar and premium-date (Friday/holiday) resolution.
- **`koperasiLoan.ts`** — read-only loan status/installment/balance projection at a given period, restructuring lineage.
- **`koperasiLoanApplication.ts`** — write-side application rules: min/max amount & tenor, admin fees, eligibility, restructuring quotes.
- **`koperasiAmounts.ts`** / **`koperasiNames.ts`** — builds per-employee deduction/savings maps for payslips, matched by normalized name.
- **`proposalExpenseReports.ts`** / **`proposalExpenseApproval.ts`** — LPJ expense-report CRUD, budget-vs-actual totals, approval validation.
- **`slipBuilders.ts`** — canonical earnings/deductions row builders for a payslip (Firebase-free, reachable from API routes).
- **`slipPropagation.ts`** — rules for pushing an employee-profile edit onto an already-saved slip (which fields are profile-owned vs. owned by koperasi/presence/SPJ systems).
- **`uraianPropagation.ts`** — counterpart for pushing Uraian rekap / Loyalis presence data onto draft slips; also computes Loyalis presence bonus/hourly rate.
- **`dashboardSlipData.ts`** — assembles the dashboard's period-level slip view across all the above.
- **`payrollRoster.ts`** — builds the eligible-employee roster per payroll run.
- **`nipy.ts`** — generates/validates Pekarya NIPY employee-ID codes (category-prefixed: KEBERSIHAN=13, SOPIR=14, SATPAM=15, TEKNISI=16).
- **`vakasiTambahan.ts`** — guards against LPJ/proposal sandbox data leaking into real payroll earnings.
- **`roles.ts`** — `UserRole` union and capability checks (see RBAC above).
- **`client.ts`** — browser-side authenticated fetch helpers for payroll API routes.

---

## Name Matching & Overrides

Since names in raw spreadsheet imports often mismatch official Firestore user documents:
- **`normalizeName(fullName)`**: strips trailing academic degrees, prepended titles (KH, Hj, Ust, Prof, etc.), lowercases/trims.
- **`MANUAL_OVERRIDES`**: hardcoded exact-match dictionary for edge cases (e.g. `Siti Rofiah` → `Siti Rofi'ah, A. Md.`).
- **`src/lib/payroll/koperasiNames.ts`**: equivalent name-normalization used specifically to match Koperasi loan/member records to payroll employees.

---

## OCR Processing Pipeline (Uraian)

Physical presence printouts are parsed via the [/api/parse-rekap](file:///Users/ghinannavsih/Documents/Internal-BAK/src/app/api/parse-rekap/route.ts) route: an uploaded PNG/JPEG is sent to Gemini (`gemini-1.5-flash`) with a structured-extraction prompt that returns per-row `y_top`/`y_bottom` coordinates plus column values; outputs then flow to `UraianTable` components matching [rekapConfig.ts](file:///Users/ghinannavsih/Documents/Internal-BAK/src/utils/rekapConfig.ts) indices.

---

## Key Scripts & Commands

- **Run dev environment**: `npm run dev`
- **Build application**: `npm run build`
- **Test**: `npm test` (runs `tsx --test` over the payroll/server/util test suite directly)

`scripts/` holds ~125 files; only the ones below are wired into `package.json`. The rest are ad hoc one-off migration/inspection scripts (`inspect*`, `check*`, `compare*`, `find*`, etc.) run directly via `tsx scripts/<file>.ts` — don't assume every script has an npm entry.

- **Migration**: `migrate:salary-matrix`, `migrate:employees`, `migrate:employees-master`, `migrate:top-level`, `migrate:blue-collar`, `migrate:koperasi-rochmad`
- **Seed / one-off data patch**: `seed:white-collar-matrix`, `update:tunjangan-beras`, `reset:koperasi-rochmad`
- **Audit (read-only, safe to run anytime)**: `audit:satpam-payroll`, `audit:pekarya-spj`, `audit:driver-seed-date`
- **Reconcile**: `reconcile:satpam-flexible`, `recompute:driver-komponen-waktu`
- **Fix/repair (dry-run by default; require an explicit `--apply` flag, some also require an `--ids` allowlist)**: `fix:driver-short-trip-meal`, `fix:driver-seed-date`
