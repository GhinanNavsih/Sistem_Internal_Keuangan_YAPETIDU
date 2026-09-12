# Kelebihan Jam Mengajar (KJM) Rules

This document records the business rules confirmed for calculating Loyalis
Kelebihan Jam Mengajar (KJM). The rules are intended to guide a future app
implementation and to preserve the meaning of the `Konsorsium 20251` workbook.

## 1. Loyalis type and lecturer flag

The app should store `loyalisType` and `isDosen` as independent fields. They
are not mutually exclusive: for example, an employee can have
`loyalisType = "Keluarga"` and `isDosen = true`.

The `loyalisType` field is determined from the first two digits of the
employee's NIPY:

| NIPY prefix | Initial loyalis type |
| --- | --- |
| `01` or `10` | `Keluarga` |
| `11` | `Dosen` |
| `12` | `Admin` |

### Independent `isDosen` rule

An employee is a lecturer when their education level is not in the
`Administrasi` group:

```text
if education_level belongs to the Administrasi group:
    isDosen = false
else if education_level is non-blank:
    isDosen = true
else:
    isDosen = unresolved; flag for review
```

Because the source values include degree prefixes such as `S1-Administrasi`
and `S2-Sosial`, the group comparison should detect the education group within
the normalized value. A non-Administrasi value such as `S2-Sosial`, `S2-Eksakta`,
`S2-Kesehatan`, or `Khusus` produces `isDosen = true`. `Khusus` is explicitly
a lecturer marker, not an unresolved lecturer decision; it should still be
flagged separately because it is not currently present in the rate matrix.

The NIPY-derived `loyalisType` is retained even when `isDosen` is true. This
is particularly important for legacy admins who became lecturers without a
NIPY change:

```text
Nurdin Bramono
NIPY:             12010902068
loyalisType:      Admin
education_level:  S2-Sosial
isDosen:          true
```

Similarly, a family employee with a non-Administrasi education level retains
`loyalisType = "Keluarga"` while receiving `isDosen = true`.

Missing or unrecognized values should be flagged for review. An unrecognized,
non-blank education value follows the non-Administrasi rule for `isDosen`, but
may still require a separate rate-matrix decision.

## 2. Education-level rate matrix

The rate is applied to each recognized regular excess-teaching hour. The
education level selects the row, and the education group selects the column.

| education_level | Administrasi | Sosial | Eksakta | Kesehatan |
| --- | ---: | ---: | ---: | ---: |
| `D2` | Rp20,000 | Rp20,000 | Rp20,000 | Rp20,000 |
| `D3` | Rp20,000 | Rp20,000 | Rp20,000 | Rp20,000 |
| `D4` | Rp20,000 | Rp20,000 | Rp20,000 | Rp20,000 |
| `S1` | Rp20,000 | Rp20,000 | Rp20,000 | Rp20,000 |
| `S2` | Rp20,000 | Rp20,000 | Rp35,000 | Rp37,500 |
| `S3` | Rp20,000 | Rp35,000 | Rp50,000 | Rp50,000 |

For consortium teaching, use a flat rate of **Rp25,000 per recognized
consortium hour**, regardless of education level.

## 3. Attendance recognition

The attendance cap is 14 meetings for each course's attendance count. When
converted into SKS-attendance, that cap becomes 14 × SKS. For each course:

```text
recognizedAttendance = MIN(attendance, 14)
recognizedWeightedAttendance = SKS × recognizedAttendance
```

In the workbook's `Dosen Rekap` structure, the practical interpretation is:

- the raw/working attendance and its weighted value are calculated first;
- the acknowledged attendance is capped at 14;
- the acknowledged weighted value is then multiplied by SKS;
- the acknowledged value is allocated to regular teaching or consortium
  teaching.

If a course is marked as consortium (`K`), its recognized weighted attendance
goes to the consortium total. Otherwise, it goes to the regular/faculty total.

```text
if consortium:
    regularRecognized = 0
    consortiumRecognized = recognizedWeightedAttendance
else:
    regularRecognized = recognizedWeightedAttendance
    consortiumRecognized = 0
```

## 4. Jabatan-based obligation reduction

In `VAKASI KJM 20251 ALL`, column L represents the reduction for additional
duties (`PENGURANGAN Tambahan tugas`).

### Keluarga has no attendance obligation

An employee whose `loyalisType` is `Keluarga` has no attendance obligation.
This rule takes precedence over the jabatan-based reduction and remains true
even when the independent `isDosen` flag is `true`:

```text
if loyalisType == "Keluarga":
    baseObligation = 0
    obligationReduction = 0
    effectiveObligation = 0
    countedExcess = MIN(allRecognizedLecturingAttendance, 252)
```

Therefore, every recognized lecturing-attendance unit for a Keluarga loyalis
flows into `Kelebihan Jam Mengajar`; there is no obligation amount to subtract
before determining the excess. As subsequently confirmed, Keluarga is capped
at **252 recognized SKS-attendance units**, not uncapped.

### Base obligation by stored loyalisType

- Normal `Dosen`: 8 SKS × 14 = **112** units.
- `Admin`: **0**, including Admin whose independent `isDosen` is true.
- `Keluarga`: **0**.

### Kesehatan obligation override

For a `Dosen` whose `education_level` contains the string `Kesehatan`,
case-insensitively (for example, `S2-Kesehatan` or `S3-Kesehatan`), the
attendance obligation is **4 SKS × 14 = 56** units. Attendance above 56 is
calculated as Kelebihan Jam Mengajar. This is the effective obligation for the
health-education exception, so the normal 112-unit Dosen base and the separate
28-unit jabatan reduction are not applied to it again.

The category rules still take precedence: Keluarga remains at zero obligation,
and Admin remains at zero obligation even if their education level contains
`Kesehatan`.

For an active Admin or Keluarga employee with teaching rows in the KJM source,
`isDosen` does not block calculation. The stored `loyalisType` controls the
obligation and cap. The `isDosen` requirement is reserved for records stored
as `Dosen`.

Do not derive this obligation from `academic_and_tier.functional_tier`.

For non-Keluarga loyalis, if an employee's `jabatan` is anything other than
`Dosen`, reduce the teaching obligation by 2 SKS:

```text
obligationReduction = 2 × 14 = 28
```

If the employee's `jabatan` is `Dosen`, this particular 28-hour reduction does
not apply.

The obligation calculation is therefore:

```text
effectiveObligation = MAX(0, baseObligation - obligationReduction)

For a Dosen in the Kesehatan group, use `effectiveObligation = 56` before
calculating excess.
```

In the workbook terminology:

```text
VAKASI K = base teaching obligation
VAKASI L = obligation reduction
VAKASI M = K - L = effective obligation
```

The `jabatan` rule is separate from `isDosen`. The NIPY-derived category and the
education-derived lecturer flag must not be replaced by the jabatan-based
obligation calculation. For Keluarga, the jabatan reduction is not applicable
because there is no attendance obligation to reduce. The same applies to Admin:
zero obligation must never become negative. Missing Dosen jabatan requires review.

### Category caps and service date (confirmed 2026-09-08)

| Stored loyalisType | Maximum recognized excess |
| --- | ---: |
| Keluarga | 252 |
| Dosen | 252 |
| Admin, recognized service below 12 years | 84 |
| Admin, recognized service 12 years or above | 126 |

Use `employment_profile.date_recognized` (Tanggal Diakui), not the hire date
or NIPY, compared with the selected payroll period. Exactly 12 years belongs
to the **126** category. The app uses the selected month's last calendar day
as the visible service assessment date, never the computer's current date.
Missing/future recognized dates for Admin block approval.

## 5. KJM earning flow

The employee-level calculation follows this sequence:

```text
regularHours      = recognized regular teaching hours
consortiumHours   = recognized consortium teaching hours
totalTeaching     = regularHours + consortiumHours
effectiveObligation = MAX(0, baseObligation - obligationReduction)
rawExcess         = MAX(0, totalTeaching - effectiveObligation)
countedExcess     = limited by the employee-category maximum
recognizedConsortiumExcess = MIN(consortiumHours, countedExcess)
recognizedRegularExcess = countedExcess - recognizedConsortiumExcess
```

The counted excess is split into regular/faculty and adjusted consortium
components. The earnings are then calculated as:

```text
regularEarning    = recognizedRegularExcess × educationLevelRate
consortiumEarning = recognizedConsortiumExcess × Rp25,000
totalKJM          = regularEarning + consortiumEarning
```

Regular totals include courses across all programs/faculties; do not add a
second cross-faculty total for courses already imported. Consortium takes
priority within counted excess, matching the workbook's R/Y allocation.
The active `SalaryMatrix_ExcessAttendance` version is authoritative. The S2-Sosial
rate above corrects the earlier transcription to match the supplied rate table.

The final per-employee value is the workbook's
`TOTAL HR KELEBIHAN JAM MENGAJAR` column.

## 6. App implementation requirements

The app should retain the raw and adjusted values separately. At minimum, a
course-level calculation record should preserve:

- employee/NIPY and source record identifier;
- raw attendance;
- any adjusted attendance value;
- adjustment type and reason;
- SKS and recognized weighted attendance;
- consortium marker;
- regular and consortium recognized totals.

Employee-level records should preserve:

- `loyalisType` and its NIPY-prefix classification source;
- `isDosen` and its education-level classification source;
- `education_level` and selected rate;
- `jabatan`;
- base obligation and the 28-hour reduction, if applicable;
- regular excess, consortium excess, and final KJM earning.

This audit information is important because the workbook contains manual
attendance adjustments and manually entered obligation/rate values in addition
to formulas.

### Upload, review, approval

- Import only `Kontrak Asli` and `Tetap Asli` (case-insensitive names).
- Preserve source sheet, row, lecturer block, course, class, program, SKS and
  raw attendance. Normalize lecturer blocks into individual course records.
- In the rekap, exclude `Tetap Asli` rows when the source `Prodi` (column I)
  contains `NERS`, the source `Kelas` (column E) contains `RPL`, or the source
  `Nama Mata Kuliah` (column C) contains `Praktek` or `Praktik`, ignoring case.
  Keep these raw rows for auditability, but do not show or calculate them in
  the rekap. The same text in `Kontrak Asli` does not trigger this filter.
- Ignore matching Non-Aktif Loyalis. Never automatically fuzzy-match names;
  unresolved/ambiguous NIPY matches require explicit assignment or exclusion
  with a reason. Stored employee classification is authoritative.
- Raw sheets do not contain reliable consortium markers. The review workflow
  first presents a Mata Kuliah classification section, grouped by program and
  Kode MK. Every group defaults to `Reguler`; the admin checks `Konsorsium?`
  only for consortium groups. That checkbox applies to every class/source row
  in the group. The admin then confirms the completed classification before
  continuing to lecturer mapping, attendance corrections, and approval.
- Keep attendance corrections separate from raw values and require a reason.
- A missing matrix match (including Khusus) requires an explicit matrix
  degree/group selection with a reason; never silently substitute a rate.
- Upload/save creates an unpaid draft. Only explicit admin approval publishes
  the server-calculated total to the selected payroll month as KJM earnings.
- Preserve the reviewed employee/rate snapshot. A changed master snapshot
  requires recalculation/review before approval.
- Prevent duplicate semester/employee payments, stale approval, closed-period
  writes and changes affecting locked/paid payslips. Retain approval audit.
- Existing draft payslips and the approved KJM earning are updated atomically,
  including recalculation of any selected payroll tax. Verified/non-draft slips
  must return to draft before approval or cancellation. Missing slips read the
  approved earning when subsequently generated.
- An admin can cancel approval while the period and recipient slips remain
  editable. Cancellation removes this earning and releases its semester claims;
  it does not delete the raw import or audit history.
- A draft import can be explicitly deleted from the KJM page after confirmation.
  This removes the extracted raw data, edits, and draft calculation (and any
  matching voided projection/claim left by a cancellation), while retaining the
  deletion audit entry. An approved import must be cancelled first; approved
  payroll data is never silently deleted.
- Current page: `/dashboard/payroll/uraian/kjm` (super admin only). Imports live
  in server-owned `KjmImports`; approved amounts project to `VakasiTambahan`
  with `sourceKind = "kjm_import"`. Generic Vakasi editing cannot mutate them.

### Verification and release

- `npm run test:kjm`: deterministic rules, parser and payable-earning tests.
- `npm run test:kjm:integration`: isolated `demo-kjm` Auth/Firestore emulator
  tests for draft/save/approval/cancellation, concurrency, master changes,
  duplicate claims, period/slip guards and client-write denial. Never uses
  production payroll data.
- Deploy `Current_Firestore_Rules.md` with the app release so client writes
  cannot bypass the server-owned KJM projection. No production payroll import
  or approval is part of these automated tests.

## 7. Source context

These rules were confirmed while analyzing the uploaded `Konsorsium 20251.xlsx`
workbook, especially the `Dosen Rekap` and `VAKASI KJM 20251 ALL` sheets, with
the education-level rate matrix supplied separately as an image.
