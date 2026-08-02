# Satpam Monthly Duty Plan

This guide explains how the monthly Satpam duty plan works, how daily reports
are paid, how scheduled duties are counted, and when a Satpam receives the
monthly attendance bonus.

The duty plan is the schedule of obligations. The Ketua Shift's approved daily
report is the source of truth for work that actually happened. Attendance scans
are supporting evidence only; a missing scan does not by itself remove an
approved shift payment.

## Who prepares the plan?

The `Ketua Shift` prepares and publishes the plan for their own ten-person team.
The team consists of:

- one Ketua Shift recorded at Pos 2 Stasiun while serving as the roaming
  coordinator;
- one monthly permanent guard at Pos 9 Hurun-inn;
- seven rotating post guards; and
- one rotating member marked **Libur**.

The system still records nine unique primary post assignments and one unique
Libur member each day. The Ketua patrols every post, takes the optional report
photos, and submits the actual roster for the team.

The Ketua Shift can plan the immediately following calendar month before
Superadmin opens that payroll period. This is called **Perencanaan awal**. Daily
shift reports, absence requests, attendance processing, and payroll posting
remain unavailable until Superadmin opens the period.

## The eight-day rotation

The Ketua first chooses the monthly permanent Pos 9 guard. The remaining eight
members then follow this order:

`Pos 1 → Pos 8 → Pos 6 → Pos 5 → Pos 7 → Pos 4 → Pos 3 → Libur`

When there is no compatible previous plan, the Ketua assigns the eight rotating
members to the first date's seven posts and Libur slot. The server advances each
member one slot per calendar date. Day 9 therefore repeats Day 1.

When the previous period has the same roster, Ketua, and permanent Pos 9 guard,
the new period continues from the next rotation step automatically. A roster or
fixed-guard change requires a new manual first-date arrangement. The actual
shift name still follows the applicable Pagi/Sore/Malam team rota.

The plan is saved with a revision and a roster snapshot. A team-roster change
marks affected future dates stale and requires the plan to be regenerated or
corrected.

### Pos 9 Satpam across teams

Each published team plan names one monthly **Pos 9 Satpam Regu** for Pos 9
Hurun-inn. The three non-stale team plans therefore form the period's complete
set of three Pos 9 Satpam. The Ketua normally selects the Pos 9 Satpam from
their own regu, but the daily report also allows any active Satpam as a
substitute so an unexpected replacement can be recorded. Pos 2 remains the
Ketua Shift / Keliling assignment.

When a Ketua selects one of the other two designated Pos 9 Satpam, the report
defaults to **Harian**. The Ketua may explicitly choose **Lembur Sendiri** or
**Lembur Cover** for that cross-team Pos 9 assignment. Harian is retained even
on a Friday or holiday for this special cross-team case, as requested by the
operational rule. Lembur Cover must identify the member being covered, normally
the regu's own planned Pos 9 Satpam.

An employee who is not one of the three designated Pos 9 Satpam receives a
**Pos 9 guard mismatch** warning for Kepala SatKer review; the report can still
be submitted and the auditor decides whether the substitution is acceptable.
These Pos 9 rules do not change the nine-post uniqueness check or the separate
bonus-duty reconciliation.

## Daily reporting and payment classification

The Ketua Shift submits the actual roster for each date. The form is deliberately
flexible: a partial roster, missing photos, duplicate rows, or a difference from
the plan can be submitted and will be shown as an auditor warning.

The server counts distinct guards and valid posts. Duplicate rows cannot create
duplicate payable entries.

### Regular scheduled work

A guard who is scheduled on a primary post and appears in the approved actual
roster receives one regular payment:

| Work date | Pay type | Rate |
|---|---|---:|
| Normal non-Friday, non-holiday | `Harian` | Rp12,500 |
| Friday or selected holiday | `Jumat & Libur` | Rp25,000 |

If a scheduled guard moves to another post, the guard still receives one
regular payment. The move is recorded as a schedule difference for audit; it
does not become Cover pay.

### Lembur Cover

`Lembur Cover` is paid at **Rp50,000** when a guard who was not scheduled for the
primary post fills a missing primary post. This includes the planned Libur guard
covering for a planned guard who did not work, and an external or unusual guard
covering a post.

The report may be submitted with fewer than nine primary guards, but the
classification remains subject to auditor review before approval.

### Lembur Sendiri

`Lembur Sendiri` is paid at **Rp30,000** only when:

- the guard is the member marked Libur for that date;
- nine distinct primary guards already occupy the nine primary posts; and
- the Libur guard is added as the tenth worker rather than replacing a post
  guard.

Working on a Libur date is extra work. It does not satisfy or replace a missed
scheduled duty for the monthly bonus.

## Requesting an absence

A Satpam can use **Ajukan Izin** for one of their scheduled-duty dates while the
period is open. The request includes an absence type and reason; evidence is
optional. A request submitted after the shift starts is marked late.

The Kepala SatKer approves or declines the request:

- An approved absence pays a fixed **Rp12,500** entitlement.
- The fixed amount is the same on a regular day, Friday, or holiday.
- The approved absence fulfills that scheduled-duty obligation for the bonus.
- It does not create a false worked-shift report.
- A substitute who actually works receives the applicable `Lembur Cover`
  payment, whether the absence is approved or declined.

If an approved absence and actual work exist for the same scheduled obligation,
the system blocks financial approval until the Kepala SatKer resolves the
conflict. Absence decisions are revisioned and cannot be silently overwritten.

## Required duties and the Rp100,000 bonus

For each team member, the system creates a monthly reconciliation:

- **Required duties**: distinct payroll dates on which the published plan assigns
  the member to a primary post.
- **Fulfilled by work**: required dates satisfied by an approved actual primary
  assignment.
- **Fulfilled by absence**: required dates satisfied by a Kepala-approved
  absence.
- **Missed duties**: required dates with neither an approved work assignment nor
  an approved absence.
- **Pending/conflicting duties**: dates still awaiting review or containing a
  work-versus-absence conflict.
- **Extra duties**: `Lembur Cover` and `Lembur Sendiri` work. These are displayed
  separately and never increase fulfilled duties.

A Satpam is eligible for the monthly bonus only when all of these conditions are
true:

1. The payroll period is complete and every planned shift has ended.
2. The member has at least one required duty.
3. `fulfilledDuties >= requiredDuties`.
4. There are no pending duties.
5. There are no work-versus-absence conflicts.

An eligible member receives `bonusPresensiBulanan = 1`, worth **Rp100,000**.
Otherwise the value is zero. The field is calculated by the server and is
read-only for canonical periods.

The Ketua at Pos 2 and permanent Pos 9 guard have a required duty on every
payroll date. Each rotating member has a required duty on seven dates per
complete eight-day cycle; their Libur date is excluded.

### Example

Suppose Rusmanto has 15 required duties:

- 14 approved worked duties;
- 1 approved absence; and
- 3 Lembur Sendiri dates.

His fulfilled duties are 15 and his extra duties are 3, so he qualifies for the
Rp100,000 bonus. The three extra dates do not replace any required duty.

If he instead has 14 fulfilled duties and works five Libur dates, he does not
qualify: the Libur work is extra and the required duty remains missed.

## Editing and review rules

- Future rotating assignments may be edited by the Ketua Shift until the
  scheduled shift starts. The canonical Pos 2 Ketua and Pos 9 permanent guard
  remain locked in the plan; real substitutions are recorded in the flexible
  daily report.
- A started or already reported date requires a Kepala SatKer correction with a
  reason and an audit before/after record.
- A first publication after some shifts have already started enters backfill
  review for those dates.
- Every plan revision and roster snapshot is retained.
- A stale plan, missing daily report, unresolved classification, pending absence,
  or unacknowledged backfill prevents financial approval.

The plan remains separate from the actual report: planned assignments, actual
assignments, substitutions, anomalies, and auditor corrections are all kept so
the difference can be explained later.

## Attendance verification

Attendance is joined by NIPY and duty date. For a `Malam` assignment, a valid
scan on the shift start date or the following date can verify presence.

The following conditions are warnings for review and do not independently add
or remove Satpam pay:

- report without an attendance scan;
- attendance scan without a report;
- incomplete punch;
- identity mismatch; and
- attendance during an approved absence.

## Period closing checklist

Before a Satpam payroll period can close, each team must have:

- a current published duty plan;
- all late backfills and past corrections confirmed by Kepala SatKer;
- no pending daily shift reviews;
- no pending absence requests;
- no unresolved work-versus-absence conflicts;
- no stale plan or report revisions; and
- a current duty and bonus reconciliation.

Missing attendance scans remain visible warnings and do not block closing by
themselves. Payroll uniqueness, approved classifications, and immutable paid
slips remain financially strict.

## Main screens

| Screen | Purpose |
|---|---|
| `Jadwal Regu Satu Periode` | Select Pos 9, set or continue the eight-day rotation, preview, and publish |
| Satpam shift report | Submit the actual daily roster and optional evidence |
| `Ajukan Izin Satpam` | Request an absence for a scheduled duty |
| Pekarya Attendance / Satpam tabs | Review plan differences, absences, attendance warnings, and bonus reconciliation |
| Rekap Uraian | Show approved Satpam pay types and the monthly bonus |
