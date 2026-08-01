# Payroll Period Lifecycle

This document explains how payroll periods collect and finalize data in the UNIPDU Internal Super App, which workflows depend on them, and which TypeScript files enforce the lifecycle.

## Purpose

A payroll period is the controlled data-collection and review window for a
particular payroll month. Collection is automatic; only permanent closure is an
explicit administrative act.

Closing a period does **not** immediately calculate salaries, lock payslips, create bank payments, or modify historical payroll records. It ends collection and starts finance verification.

The period status is stored in Firestore as:

```text
PayrollPeriods/{YYYY-MM}
```

A materialized period contains data similar to:

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

Periods are **open by default**. There is no "open the period" action: a month
collects work from the moment it begins and stops only when it is permanently
closed. This removes the recurring month-end outage where field staff could not
report because the next period had not been opened yet, while the previous one
could not be closed until Finance had finished its audit.

```text
DIBUKA (implicit -- no document required)
    |
    | Attendance, activity, SPJ, and review collection
    |
    | First approval or red-date edit materializes the period
    |
    | Tutup Permanen
    v
DITUTUP
    |
    | Finance verification, authorization, locking, and payment
    v
FINAL PAYROLL
```

### 1. Open (`DIBUKA`)

Either no `PayrollPeriods/{YYYY-MM}` document exists yet, or one exists without
`attendanceStatus: "closed"`. Both states behave identically for collection.

Consequences:

- Pekarya can submit and resubmit activity reports.
- Drivers can submit completed journey reports.
- Ketua Shift can submit Satpam attendance and post assignments.
- Kepala SatKer can approve or reject pending Pekarya and driver activities.
- Kepala SatKer can create or revise collective Pekarya SPJ events.
- Finance can create and refresh draft payslips.
- The period owns an editable calendar snapshot. Fridays remain automatic.
- Finance verification, final authorization, locking, and payment remain blocked.

### 2. Materialization

A period gains its `PayrollPeriods/{YYYY-MM}` document the first time one of
these happens, whichever comes first:

1. **A Kepala SatKer approves anything** in that period — activity SPJ, Satpam
   shift, or an auditor shift correction.
2. **Superadmin sets the month's red dates** through *Tanggal Merah Periode*.
3. **The period is permanently closed.**

Materialization freezes `workCalendar` at revision 1. That snapshot is what
stops a later premium-date edit from silently re-rating work that was already
approved against the previous calendar, so it must exist before any money is
committed. Until it does, the effective calendar is derived on read: every
Friday in the window is premium automatically, plus any nationally declared
dates recorded for the year.

Because Fridays are always derived, an untouched month never mis-rates Harian
versus Jumat & Libur. Only nationally declared holidays require an explicit red-
date edit.

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

Nationally declared dates accumulate per year in:

```text
PayrollHolidayCalendars/{YYYY}
```

Materializing a period copies the applicable dates into
`PayrollPeriods/{YYYY-MM}.workCalendar`. Later annual-calendar changes do not
silently rewrite a materialized period, and the annual calendar cannot be
replaced while a materialized, not-yet-closed period exists for that year.

Until the period remains open, Superadmin can use **Tanggal Merah Periode** to
add or remove non-Friday premium dates. Doing so on a month that has not been
materialized yet creates it at revision 1. Every update requires a reason,
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

## Satpam Duty Plan

Every period from 2026-08 onward requires a duty plan, whether or not it has
been materialized; materialized periods also carry `satpamDutyPlanRequired`. July 2026 is an
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
| Set period red dates | `super_admin` |
| Permanently close payroll period | `super_admin`, `finance_verifier` |
| Submit Pekarya activity | Linked `honorer` account |
| Submit Satpam shift | `ketua_shift_satpam` |
| Review Pekarya activity | `satker_head`, `super_admin` |
| Verify payroll | `finance_verifier`, `super_admin` |
| Authorize payroll | `payroll_authorizer`, `super_admin` |

Every period closure and every red-date edit requires a reason between 8 and
500 characters.

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

An open period does not by itself:

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
- Displays `DIBUKA` or `DITUTUP`.
- Provides the **Tutup Permanen** and **Tanggal Merah Periode** controls.
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
- Materializes a never-opened period on closure so its calendar is pinned.
- Permanently prevents reopening a closed period.
- Rejects explicit open requests, which are no longer required.
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
- Rejects submission only when that period is permanently closed.
- Rejects modifications when the employee's payslip is already immutable.
- Writes the report transactionally and idempotently.

### Activity Review

```text
src/app/api/pekarya/activities/review/route.ts
```

Responsibilities:

- Rejects reviews only after period closure.
- Materializes the period and freezes its calendar on the first approval.
- Rejects reviews when a payslip is already immutable.
- Writes approvals, ledger entries, and audit records transactionally.

### Satpam Shift Submission

```text
src/app/api/satpam/shifts/route.ts
```

Responsibilities:

- Resolves the period from the Satpam duty date.
- Rejects submission only for a permanently closed period.
- Derives the pay calendar even when the period is not yet materialized.
- Prevents duplicate shift occurrences.
- Stores the verified shift and audit information transactionally.

### Pekarya SPJ Events

```text
src/app/api/pekarya/spj-events/route.ts
```

Responsibilities:

- Rejects a permanently closed payroll period.
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

### Starting a Month

No action is required. Reporting and review are available as soon as the month
begins.

The one recommended step is to record nationally declared holidays before the
first approval in that month:

1. Select the required month on **Payroll Bulanan**.
2. Click **Tanggal Merah Periode**.
3. Tick the nationally declared dates. Fridays are always premium and cannot be
   unticked.
4. Enter a meaningful reason of at least 8 characters.

Doing this before the first approval avoids a mid-month calendar revision, which
would return already-approved regular Satpam assignments to auditor review.

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
