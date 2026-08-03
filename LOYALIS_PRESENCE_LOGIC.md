# Loyalis Presensi and Bonus Presensi

This document describes the current Loyalis attendance calculation used by the
monthly Presensi Loyalis calculator and the payroll dashboard.

It covers two payroll components:

- **Presensi**: the expected attendance-hours earning, reduced by a deduction
  for absence minutes.
- **Bonus Presensi**: a monthly attendance bonus of up to Rp250,000, reduced by
  the absence stratum.

Pekarya daily attendance and the Satpam monthly attendance bonus use different
rules and are not covered here.

## Source of truth

The monthly result is stored in the `LoyalisPresence` collection. The document
period is the selected payroll period, and `entries` is keyed by the Loyalis
employee ID.

The main fields are:

```text
workingDays       configured working days for the month
expectedHours     expected hours per working day
mode              "worked" or "absent"
entries           calculated result for each employee
```

The current implementation is defined in:

- `src/app/dashboard/payroll/uraian/presensi-loyalis-raw/page.tsx` — input,
  matching, stratum calculation, and persistence.
- `src/app/dashboard/payroll/uraian/presence-corrections/page.tsx` — approved
  correction application and recalculation using the same work-time window.
- `src/lib/payroll/loyalisPresenceWindow.ts` — official time-window bounds,
  duration calculation, and single-scan auto-fill behavior.
- `src/lib/payroll/uraianPropagation.ts` — payroll amount calculation and
  propagation rules.
- `src/app/dashboard/payroll/page.tsx` — payroll dashboard display logic.

## Input modes

The calculator first determines the employee's absence minutes, represented by
`x`.

### Official daily work-time window

Only work time inside the official Loyalis window from **07:30:00 through
14:00:00** contributes to the daily duration. Scans outside the window remain
available in the daily log for audit, but they do not add work minutes.

For a valid scan-in and scan-out, the calculation is:

```text
effectiveIn  = max(07:30, scanIn)
effectiveOut = min(14:00, scanOut)

dailyDuration = effectiveOut > effectiveIn
  ? ceil(min(expectedHours × 60, effectiveOut - effectiveIn))
  : 0
```

Seconds are included before rounding up to the next whole minute. For example,
`08:45:58` to `14:08:04` is bounded to `08:45:58` to `14:00:00`, which is
314 minutes and 2 seconds, or **315 minutes**.

If only one scan is present and auto-fill is enabled, the missing scan is
generated 150 minutes away from the supplied scan. The generated timestamp is
then clamped to the same `07:30:00`–`14:00:00` window, and the resulting pair is
processed by the formula above. This means a single scan near either boundary
can produce less than 150 payable minutes.

### Worked-minutes mode

The uploaded value is treated as minutes worked:

```text
expectedMinutes = workingDays × expectedHours × 60
absenceMinutes  = max(expectedMinutes - workedMinutes, 0)
```

Extra minutes do not create an additional payment; they simply produce zero
absence minutes.

### Absent-minutes mode

The uploaded value is treated directly as absence minutes:

```text
absenceMinutes = uploadedAbsentMinutes
```

## Strata and Bonus Presensi deduction

The strata thresholds are based on the configured number of working days. The
thresholds are minutes of absence, not days of absence.

| Stratum | Absence condition | Bonus gross | Bonus deduction | Net bonus |
| --- | --- | ---: | ---: | ---: |
| 1 | `x = 0` | Rp250,000 | Rp0 | Rp250,000 |
| 2 | `0 < x ≤ workingDays × 30` | Rp250,000 | Rp100,000 | Rp150,000 |
| 3 | `workingDays × 30 < x ≤ workingDays × 35` | Rp250,000 | Rp150,000 | Rp100,000 |
| 4 | `workingDays × 35 < x ≤ workingDays × 40` | Rp250,000 | Rp200,000 | Rp50,000 |
| 5 | `x > workingDays × 40` | Rp250,000 | Rp250,000 | Rp0 |

The calculator stores both `deduction` and `netBonus`. Payroll posts the gross
Rp250,000 under **Bonus Presensi** and posts `deduction` under **Potongan Bonus
Presensi**. Therefore:

```text
netBonus = Rp250,000 - Potongan Bonus Presensi
```

## Presensi earning and deduction

The gross Presensi earning is the full expected attendance-hours value:

```text
Presensi gross = workingDays × expectedHours × Rp1,650
```

The shortfall is deducted separately:

```text
Potongan Presensi = round((absenceMinutes / 60) × Rp1,650)
```

The resulting Loyalis attendance contribution to payroll is:

```text
Net attendance = Presensi gross
               - Potongan Presensi
               + Rp250,000
               - Potongan Bonus Presensi
```

The hourly rate is Rp1,650. The default configuration is 25 working days and
6.5 expected hours per day:

```text
Expected minutes = 25 × 6.5 × 60 = 9,750 minutes
Presensi gross   = 25 × 6.5 × Rp1,650 = Rp268,125
```

## Worked examples

### No absence

With `x = 0`:

```text
Presensi gross              Rp268,125
Potongan Presensi           Rp0
Bonus Presensi gross        Rp250,000
Potongan Bonus Presensi     Rp0
Net attendance              Rp518,125
```

### 600 minutes absent with the default 25-day configuration

`600 ≤ 25 × 30`, so the employee is in Stratum 2:

```text
Presensi gross              Rp268,125
Potongan Presensi           round(600 / 60 × Rp1,650) = Rp16,500
Bonus Presensi gross        Rp250,000
Potongan Bonus Presensi     Rp100,000
Net attendance              Rp401,625
```

## Employees missing from the workbook

When the calculator saves a result, every active Loyalis is materialized in
`entries`:

- an employee found in the workbook receives the calculated minutes and
  stratum;
- an active employee not found in the workbook is written as
  `isNotFoundInExcel: true`, with full expected absence, Stratum 5, a
  Rp250,000 Bonus Presensi deduction, and zero net bonus.

This prevents an omitted employee from silently receiving the full attendance
amount.

For an older or incomplete `LoyalisPresence` document where `entries` exists
but a particular employee has no entry, the payroll fallback treats that
employee as having zero Presensi and zero Bonus Presensi. A period with no
entries at all uses the legacy fallback of full Presensi and full Bonus
Presensi for every employee.

## Matching and corrections

Attendance matching is authoritative by normalized NIPY. Whitespace is removed
and the value is uppercased, so values such as `11 041010 174` and
`11041010174` resolve to the same identity. Names are used for diagnostics and
manual linking, not as the final payroll identity when a NIPY is available.

The calculator can also apply attendance corrections before saving. Corrections
change the effective daily logs/minutes used by the calculation; the original
import remains available for audit.

## Payroll propagation

After a Loyalis presence result is saved, the payroll process uses these four
rows:

### Earnings

- `Presensi`
- `Bonus Presensi`

### Deductions

- `Potongan Presensi`
- `Potongan Bonus Presensi`

The server-side helper in `src/lib/payroll/uraianPropagation.ts` mirrors the
dashboard calculation so that refreshed draft payslips and propagated draft
payslips produce the same amounts. Finalized payslips are not silently changed
by a later presence edit.

## Related tests

The behavior is covered by the payroll propagation tests, especially the
Loyalis presence cases in `src/lib/payroll/uraianPropagation.test.ts`, and by
the official-window cases in `src/lib/payroll/loyalisPresenceWindow.test.ts`.
