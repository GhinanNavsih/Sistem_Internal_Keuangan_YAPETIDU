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
| `S2` | Rp20,000 | Rp35,000 | Rp35,000 | Rp37,500 |
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
    allRecognizedLecturingAttendance = KJM excess
```

Therefore, every recognized lecturing-attendance unit for a Keluarga loyalis
flows into `Kelebihan Jam Mengajar`; there is no obligation amount to subtract
before determining the excess.

For non-Keluarga loyalis, if an employee's `jabatan` is anything other than
`Dosen`, reduce the teaching obligation by 2 SKS:

```text
obligationReduction = 2 × 14 = 28
```

If the employee's `jabatan` is `Dosen`, this particular 28-hour reduction does
not apply.

The obligation calculation is therefore:

```text
effectiveObligation = baseObligation - obligationReduction
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
because there is no attendance obligation to reduce.

## 5. KJM earning flow

The employee-level calculation follows this sequence:

```text
regularHours      = recognized regular teaching hours
consortiumHours   = recognized consortium teaching hours
totalTeaching     = regularHours + crossFacultyHours + consortiumHours
effectiveObligation = baseObligation - obligationReduction
rawExcess         = totalTeaching - effectiveObligation
countedExcess     = limited by the employee-category maximum
```

The counted excess is split into regular/faculty and adjusted consortium
components. The earnings are then calculated as:

```text
regularEarning    = recognizedRegularExcess × educationLevelRate
consortiumEarning = recognizedConsortiumExcess × Rp25,000
totalKJM          = regularEarning + consortiumEarning
```

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

## 7. Source context

These rules were confirmed while analyzing the uploaded `Konsorsium 20251.xlsx`
workbook, especially the `Dosen Rekap` and `VAKASI KJM 20251 ALL` sheets, with
the education-level rate matrix supplied separately as an image.
