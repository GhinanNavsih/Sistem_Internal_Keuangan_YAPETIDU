# Payroll Period Lifecycle

This document explains what happens when a payroll period is opened in the UNIPDU Internal Super App, which workflows depend on it, and which TypeScript files enforce the lifecycle.

## Purpose

Opening a payroll period starts the controlled data-collection and review window for a particular payroll month.

It does **not** immediately calculate salaries, lock payslips, create bank payments, or modify historical payroll records.

The period status is stored in Firestore as:

```text
PayrollPeriods/{YYYY-MM}
```

An opened period contains data similar to:

```ts
{
  period: "2026-07",
  attendanceStatus: "open",
  datePolicy: "shift_start_date",
  timeZone: "Asia/Jakarta",
  workCalendar: {
    revision: 1,
    annualVersion: "ID-2026-V1",
    premiumDates: ["2026-08-07", "2026-08-14", "2026-08-17"]
  },
  updatedAt: ServerTimestamp,
  updatedBy: "<firebase-user-id>",
  schemaVersion: 1
}
```

## Lifecycle

```text
BELUM DIATUR
    |
    | Buka Periode
    v
DIBUKA
    |
    | Attendance, activity, SPJ, and review collection
    |
    | Tutup Permanen
    v
DITUTUP
    |
    | Finance verification, authorization, locking, and payment
    v
FINAL PAYROLL
```

### 1. Unconfigured (`BELUM DIATUR`)

No `PayrollPeriods/{YYYY-MM}` document exists for the selected period.

Consequences:

- Pekarya activity submissions are rejected.
- Driver journey reports are rejected.
- Satpam shift submissions are rejected.
- Kepala SatKer activity reviews are rejected.
- Pekarya SPJ event creation or revision is rejected.
- Final payroll processing cannot begin.

### 2. Open (`DIBUKA`)

The period document exists with:

```ts
attendanceStatus: "open"
```

Consequences:

- Pekarya can submit and resubmit activity reports.
- Drivers can submit completed journey reports.
- Ketua Shift can submit Satpam attendance and post assignments.
- Kepala SatKer can approve or reject pending Pekarya and driver activities.
- Kepala SatKer can create or revise collective Pekarya SPJ events.
- Finance can create and refresh draft payslips.
- The period owns an editable calendar snapshot. Fridays remain automatic.
- Finance verification, final authorization, locking, and payment remain blocked.

### 3. Closed (`DITUTUP`)

The period document contains:

```ts
attendanceStatus: "closed"
```

Consequences:

- New attendance, activity, driver, and SPJ submissions are rejected.
- Pending activity reviews are rejected.
- Finance verification can begin.
- Authorized payslips can be locked into immutable snapshots.
- Payment instructions can be created only from locked payslips.
- Completed payment references can be recorded.

A closed period cannot be reopened through the normal period endpoint. Corrections must use the formal correction workflow so that the original locked payroll remains auditable.

## Period Calendar Snapshot and Revisions

Before a period can be opened, an annual calendar must exist for the relevant year:

```text
PayrollHolidayCalendars/{YYYY}
```

Opening a period copies applicable dates into `PayrollPeriods/{YYYY-MM}.workCalendar`.
Later annual-calendar changes do not silently rewrite the period.

While the period remains open, Superadmin can use **Edit Kalender Periode** to
add or remove non-Friday premium dates. Every update requires a reason,
`requestId`, and expected revision and creates an immutable
`FinancialAuditLogs` before/after record.

An update after attendance publication marks affected Pekarya categories stale.
Affected approved regular Satpam assignments return to auditor review, while
their original report and approval evidence remain intact. Lembur Sendiri and
Lembur Cover are not reopened. Closed periods and immutable slips reject
calendar edits.

## Shared Attendance Import (August 2026 onward)

`loyalis_presence_admin` or Superadmin uploads one monthly XLS/XLSX for Loyalis
and Pekarya. A dedicated `NIPY` column is authoritative; `PIN` is used only
when `NIPY` is absent. If both values disagree, the row is invalid.
For existing Loyalis records, `personal_info.employee_id_niy` is accepted as
the attendance NIPY, so existing NIY values do not need to be re-entered.
Employee administration keeps the canonical `nipy` value and legacy Loyalis
NIY field synchronized whenever that identifier is edited.

The server stores:

- the original workbook and SHA-256 hash;
- an immutable normalized row set with second-level scan times;
- uploader and activation revision;
- a replacement diff and the complete revision history.

Names are display-only diagnostics. Payroll matching is exact by the unique
NIPY index maintained from employee administration.

### Pekarya NIPY issuance

Active Pekarya receive an 11-digit permanent NIPY from:

`category prefix + employment.startDate as DDMMYY + category sequence`

Kebersihan, including IC and Ponti, uses prefix `13`; Sopir uses `14`;
Satpam uses `15`; and Teknisi uses `16`. Initial sequences follow numeric
`BC_###` order within each grouped category. Future issuance uses a
transactional category counter and never renumbers an issued employee.

Superadmin and Employee Admin may issue formula-generated NIPYs. Missing start
dates block the final NIPY but may retain an audited sequence reservation.
Category or start-date changes do not silently alter an issued NIPY. Only
Superadmin may explicitly reissue it from corrected source data, retaining the
assigned suffix and recording the before/after identity in `FinancialAuditLogs`.
Direct client writes to `nipy`, `nipyAssignment`, the identity index, and the
sequence counters are prohibited.

For active non-Satpam Pekarya, one valid scan on a `MASUK` row pays one full
day. A regular day is Harian (Rp12.500); Friday or a selected holiday is Jumat
& Libur (Rp25.000). Duration, lateness, and early departure do not reduce pay.
A one-sided scan remains payable with a warning.

Satpam attendance is verification evidence only. Approved Ketua Shift
assignments remain the sole source of Satpam shift pay; Malam evidence may be
found on the duty date or following date.

Kepala SatKer corrections are append-only overlays. A correction never changes
the imported row, and records raw/effective values, actor, reason, import
revision, calendar revision, and superseded correction.

## Satpam Duty Plan (Newly Opened Periods)

Every newly opened period is marked `satpamDutyPlanRequired`. July 2026 is an
explicit trial exception so the already-open July period can use and demonstrate
the workflow before August. Other previously opened periods keep their legacy
behavior. For each ten-person team, Ketua Shift
publishes a ten-day seed containing nine unique posts and one unique Off-duty
member per day; every member must be Off-duty exactly once. The server repeats
that matrix over the exact payroll window and retains every revision.

Ketua Shift may also prepare and publish the immediately following calendar
month before Superadmin opens its payroll period. This advance plan is limited
to one upcoming month. Daily reports, absence requests, attendance processing,
and payroll posting remain unavailable until the period is officially open.
Opening the period preserves the already-published plan.

Daily reports remain flexible and may be submitted without a plan, but a
missing, stale, or unreconciled plan blocks financial approval and period
closing. The server derives:

- regular Harian/Jumat & Libur for planned-on guards;
- Lembur Cover Rp50.000 when the planned Off-duty or an external substitute
  fills a primary post;
- Lembur Sendiri Rp30.000 only when the planned Off-duty guard is the tenth
  worker after nine distinct guards occupy nine distinct posts.

An approved Satpam absence creates a separate Rp12.500 entitlement, fulfills
the scheduled obligation, and suppresses the expected-attendance warning.
Off-day work remains an extra duty and never replaces a missed scheduled duty.
After every shift or absence decision, the server reconciles required,
fulfilled, missed, pending, conflicting, and extra duties. Only a fully
fulfilled, conflict-free completed period writes one Rp100.000 monthly
attendance bonus.

Team changes mark future plan dates stale. Started dates and reported dates can
only be corrected by the scoped Kepala SatKer with a reason and before/after
financial audit. Attendance scans remain verification evidence and never
independently create or remove Satpam pay.

## Roles

| Action | Authorized roles |
|---|---|
| Configure holiday calendar | `super_admin` |
| Edit an open period calendar | `super_admin` |
| Upload/replace shared attendance workbook | `super_admin`, `loyalis_presence_admin` |
| Issue formula-based Pekarya NIPY | `super_admin`, `employee_admin` |
| Reissue an incorrect Pekarya NIPY | `super_admin` |
| Review, correct, and publish Pekarya attendance | scoped `satker_head` |
| Publish/edit future Satpam duty plan | `ketua_shift_satpam` |
| Correct started Satpam plan dates / review absence | scoped `satker_head` |
| Open payroll period | `super_admin`, `finance_verifier` |
| Permanently close payroll period | `super_admin`, `finance_verifier` |
| Submit Pekarya activity | Linked `honorer` account |
| Submit Satpam shift | `ketua_shift_satpam` |
| Review Pekarya activity | `satker_head`, `super_admin` |
| Verify payroll | `finance_verifier`, `super_admin` |
| Authorize payroll | `payroll_authorizer`, `super_admin` |

Every period opening or closure requires a reason between 8 and 500 characters.

The operation creates an immutable record in:

```text
FinancialAuditLogs
```

The audit record contains the actor, action, entity, timestamp, reason, previous state, and resulting state.

## What Opening a Period Enables

| Process | Effect while the period is open |
|---|---|
| Pekarya reporting | Activity reports can be submitted or resubmitted |
| Driver reporting | Multi-day journey reports can be submitted |
| Satpam attendance | Daily post assignments can be submitted |
| Kepala SatKer review | Pending reports can be approved or rejected |
| Collective SPJ | Pekarya SPJ events can be created or revised |
| Payslip preparation | Draft payslips can be generated or refreshed |
| Holiday configuration | Calendar for the year becomes protected |
| Period calendar correction | Superadmin may revision the period snapshot |
| Shared attendance | Import, corrections, and scoped category publication |
| Final payroll | Verification, locking, and payment remain blocked until closure |

## What Opening a Period Does Not Do

Opening a period does not:

- Generate every employee's payslip automatically.
- Approve pending activities automatically.
- Recalculate historical payroll.
- Change previously locked payslips.
- Create a payment instruction.
- Mark any employee as paid.
- Unlock an immutable payroll slip.
- Reopen a previously closed period.
- Modify employee master data.

## Affected Pages

### Payroll Bulanan

File:

```text
src/app/dashboard/payroll/page.tsx
```

Responsibilities:

- Reads the selected `PayrollPeriods` document.
- Displays `BELUM DIATUR`, `DIBUKA`, or `DITUTUP`.
- Provides the **Buka Periode** and **Tutup Permanen** controls.
- Provides the **Kalender Libur** control.
- Creates and refreshes draft payslips.
- Starts finance verification, authorization, locking, and payment after closure.

### Employee Activities

File:

```text
src/app/employee/activities/page.tsx
```

Responsibilities:

- Submits normal Pekarya activity reports.
- Submits Satpam shift attendance and post assignments.
- Submits driver reports handled through the main activity flow.

The page does not directly decide whether a period is open. The server endpoint performs the authoritative check during submission.

### Driver Journey Report

File:

```text
src/app/employee/activities/journey-report/page.tsx
```

Responsibilities:

- Submits completed driver journey reports.
- Sends the activity date, route, duration, night count, expenses, and driver wage evidence.

The report is accepted only when its resolved payroll period is open.

### Kepala SatKer Activity Review

File:

```text
src/app/dashboard/payroll/activity-review/page.tsx
```

Responsibilities:

- Reviews pending Pekarya activity reports.
- Audits driver journey distance, duration, night premium, meal allowance, and reimbursements.
- Approves or rejects reports.

The server rejects review mutations when the report's payroll period is not open.

### Pekarya SPJ Entry

File:

```text
src/app/dashboard/payroll/uraian/spj-pekarya/page.tsx
```

Responsibilities:

- Creates collective SPJ activities.
- Assigns eligible employees to an SPJ event.
- Revises existing SPJ events while the period is open.

### Rekap Pekarya

File:

```text
src/app/dashboard/payroll/uraian/rekap-pekarya/page.tsx
```

Responsibilities:

- Reads individual activity and collective SPJ results.
- Displays the values that will feed the Pekarya payroll recap.

Opening a period does not directly change this page, but it enables the source activities that appear in the recap.

## Backend Enforcement

### Period State Handler

```text
src/app/api/payroll/periods/route.ts
```

Responsibilities:

- Validates the `YYYY-MM` period.
- Allows only `open` and `closed` states.
- Requires a reason.
- Requires a configured holiday calendar before opening.
- Prevents a period from being closed before it is opened.
- Permanently prevents reopening a closed period.
- Stores the period state transactionally.
- Creates a financial audit record.

### Holiday Calendar Handler

```text
src/app/api/payroll/holiday-calendars/route.ts
```

Responsibilities:

- Creates versioned annual holiday calendars.
- Prevents calendar replacement while a period in that year is open.
- Creates a financial audit record for every version change.

### Pekarya Activity Submission

```text
src/app/api/pekarya/activities/route.ts
```

Responsibilities:

- Resolves the payroll period from the activity date.
- Rejects submission unless `attendanceStatus === "open"`.
- Rejects modifications when the employee's payslip is already immutable.
- Writes the report transactionally and idempotently.

### Activity Review

```text
src/app/api/pekarya/activities/review/route.ts
```

Responsibilities:

- Verifies that every reviewed report belongs to an open period.
- Rejects reviews after period closure.
- Rejects reviews when a payslip is already immutable.
- Writes approvals, ledger entries, and audit records transactionally.

### Satpam Shift Submission

```text
src/app/api/satpam/shifts/route.ts
```

Responsibilities:

- Resolves the period from the Satpam duty date.
- Requires an open period.
- Requires the relevant holiday calendar.
- Prevents duplicate shift occurrences.
- Stores the verified shift and audit information transactionally.

### Pekarya SPJ Events

```text
src/app/api/pekarya/spj-events/route.ts
```

Responsibilities:

- Requires an open payroll period.
- Rejects inactive or category-mismatched recipients.
- Rejects changes involving immutable payslips.
- Prevents duplicate or conflicting SPJ event revisions.

### Payslip Lifecycle

```text
src/app/api/payroll/slips/route.ts
```

Responsibilities:

- Requires a configured period before draft creation.
- Allows `save_draft` while the period is open.
- Requires the period to be closed before:
  - Finance verification.
  - Payroll authorization.
  - Final locking.
  - Payment instruction creation.
  - Payment completion.
- Preserves locked payroll snapshots and routes later changes through corrections.

## Firestore Security Rules

File:

```text
Current_Firestore_Rules.md
```

The rules permit authorized finance roles to read `PayrollPeriods`.

Client applications cannot directly create or modify payroll period documents. All mutations go through authenticated API handlers using Firebase Admin, which ensures that validation, transactions, idempotency, and financial audit logging cannot be bypassed.

## Operational Procedure

### Opening

1. Select the required month on **Payroll Bulanan**.
2. Configure the annual holiday calendar if it does not exist.
3. Click **Buka Periode**.
4. Enter a meaningful reason of at least 8 characters.
5. Confirm that the status changes to **DIBUKA**.
6. Notify operational users that reporting and review are available.

### Before Permanent Closure

Confirm that:

- All Satpam shifts have been submitted.
- All Pekarya activities have been submitted.
- All driver journeys have been submitted.
- All pending reports have been reviewed.
- All collective SPJ events have been entered.
- Missing or rejected reports have been resolved.
- Draft payslip totals have been reviewed.

### Closing

1. Click **Tutup Permanen**.
2. Enter a meaningful closure reason.
3. Confirm that the status changes to **DITUTUP**.
4. Begin finance verification and authorization.
5. Lock approved payslips.
6. Create payment instructions only from locked snapshots.

## Summary

Opening a payroll period starts the operational input and review phase.

Closing the period ends input and starts the controlled financial finalization phase.

The separation ensures that payroll is not verified, locked, or paid while attendance and SPJ source data can still change.
