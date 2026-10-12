# Bonus Triwulan Rules

This document records the business rules for the Loyalis **Bonus Triwulan**
(quarterly reward) and the **Senam Pagi** attendance it depends on, as
implemented in SAKU. Before October 2026 the bonus was worked out by hand on
paper.

The rules are pure code in `src/lib/payroll/bonusTriwulan.ts`, with tests in
`bonusTriwulan.test.ts`. If a rule here changes, change it there too.

## 1. The rule in one paragraph

A Loyalis earns **Rp500.000** when, over **three payroll months in a row**,
**both** are true:

1. the person reached **Strata 1** Bonus Presensi in **each** of the three
   months, and
2. the person **missed at most one** Senam Pagi session in **total**: every
   session held in the three months is counted together ("all but one"), not
   month by month.

The bonus is paid on the payslip of the third month, as an earning named
**Bonus Triwulan**.

## 2. Every streak starts fresh

Months that already paid a bonus cannot count toward the next one. Think of a
card that takes three stamps: once the card is full and paid, a new card
starts at zero.

```text
month M pays  when  Strata 1 in each of M-2, M-1 and M
              and   at most 1 missed Senam Pagi session across M-2, M-1 and M
              and   no bonus was paid in M-2 or in M-1
```

Someone who qualifies every month is therefore paid **every third month**.

### Examples

Suspa reaches Strata 1 in April, May and June, and misses one Senam Pagi
session in the whole quarter:

| Month | Strata | Sessions held | Missed |
| --- | --- | --- | --- |
| April | 1 | 4 | 1 |
| May | 1 | 4 | 0 |
| June | 1 | 4 | 0 |
| **April–June** | all 1 | **12** | **1 (within the limit)** |

Result: **Rp500.000 on the June payslip.**

Then, with no misses and Strata 1 in July, August and September:

| Month | Result |
| --- | --- |
| July | nothing: June paid, so the count restarts |
| August | nothing |
| September | **Rp500.000 on the September payslip** |

More cases:

| Case | Result |
| --- | --- |
| One miss in April and another in June | Two in total: fails, even though no single month has more than one |
| Two misses in May | Two in total: fails |
| No misses at all | Passes |
| Strata 2 in the middle month | Fails, whatever the attendance |
| Paid in August or September 2026 | Not eligible in October 2026: the October window (Aug, Sep, Oct) contains a payout |
| A month with no Senam Pagi at all, marked as such | Adds no sessions and no misses; the limit is checked on the other months |
| Only one session in the whole window, and the person missed it | Still allowed: one miss is permitted |

## 3. Strata 1

Strata 1 means **no shortfall minutes** in the month's Loyalis presence. The
strata table and how shortfall minutes are counted are in
[LOYALIS_PRESENCE_LOGIC.md](LOYALIS_PRESENCE_LOGIC.md).

- The figure is read from the saved `LoyalisPresence` of that month **with
  approved cuti and ganti libur applied**. It is the same figure the payslip's
  Bonus Presensi uses.
- A person missing from the presence data, or marked as not found in the
  scanner export, does not qualify.
- A month with no saved presence cannot be decided (see section 6).

## 4. Senam Pagi

Senam Pagi is the morning exercise held several times a month. It has its own
roll call, recorded at `/dashboard/payroll/uraian/senam-pagi`.

- **Independent of scans.** It has nothing to do with scan masuk/pulang, cuti
  or ganti libur. Every absence counts, whatever the reason.
- **Present is what is recorded.** A session stores who was present. A session
  nobody recorded can never count as attended.
- **The limit is on the three months together.** Missed sessions are counted
  per person across every session of M-2, M-1 and M; two or more fail the
  condition (`SENAM_PAGI_MAX_MISSES = 1`). Once someone is over the limit,
  recording more months cannot undo it.
- **No Senam Pagi this month.** A month without any session must be marked
  "Tidak ada Senam Pagi bulan ini". It adds no sessions and no misses. A month
  nobody filled in is never treated as recorded.
- **Sessions** are one per date, inside the month, and cannot be dated in the
  future.
- **Who records:** Admin Karyawan and Super Admin. Badan Keuangan can read the
  page but not record.
- **Locked after the period closes.** A closed payroll period refuses changes.

## 5. Who is eligible

- A Loyalis on the payroll in month M (active, and for someone converted from
  Pekarya, only from the month of conversion).
- Earlier months are looked up by the person's employee ID. A person who was
  not a Loyalis in an earlier month has no presence there and does not
  qualify.

## 6. Missing data pays nobody

If any month in the window lacks an input, **nobody** is awarded for month M,
and the Bonus Triwulan tab lists what is missing:

- the Loyalis presence of a month has not been saved;
- the Senam Pagi of a month has not been recorded;
- the earlier months' results are unknown (for August and September 2026 these
  come from the paper records, see section 9).

## 7. When it is calculated

The bonus is recalculated, and draft slips updated, whenever any of these
happen:

- a Senam Pagi session is saved, deleted, or the month is marked "Tidak ada
  Senam Pagi";
- "Simpan Data Presensi" is pressed on the Loyalis presence calculator;
- "Hitung ulang" is pressed on the Bonus Triwulan tab.

Other rules:

- **Automatic from October 2026.** Months before it are read from the paper
  records and are not calculated.
- **Closing a month is blocked** (from October 2026) until Senam Pagi is
  recorded for it and the stored result matches a fresh calculation. This
  catches changes no save saw, for example a presence correction approved
  later.
- **Locked or paid slips are never rewritten.** If a change would add or remove
  the row on a locked slip, the recalculation is refused with a message naming
  the employee. The attendance itself is still saved.
- **A change in month M also recalculates month M+1** when that month already
  has a calculated result and is still open, because a payout in M resets M+1's
  count.

## 8. What appears where

- **Payslip:** an earning named "Bonus Triwulan", Rp500.000. In the PDF it is
  listed with the other extra earnings under "Vakasi Tambahan". It behaves like
  any other earning, so the payroll tax rules apply to it as usual.
- **Vakasi Tambahan page:** a read-only event "Bonus Triwulan" per month with
  the recipients. It cannot be edited by hand; Firestore rules and the Vakasi
  API both refuse it.
- **Senam Pagi page:** the roll call; a recap of each person's misses this month
  and over the three months, with a status ("Tidak memenuhi" once over the
  limit, "Memenuhi" when all three months are recorded and within it, "Belum
  lengkap" otherwise); and the Bonus Triwulan tab with each person's three
  months (Strata and attendance), their Senam Pagi total, and either "Dapat
  Rp500.000" or the reason they did not get it.

## 9. Data and history

| Collection | Holds |
| --- | --- |
| `SenamPagi/{YYYY-MM}` | Sessions with who was present, or `noSessions`; for a paper month, the sessions held and how many each person missed (`paperSessionCount`, `paperMisses`) |
| `BonusTriwulan/{YYYY-MM}` | Who was paid that month; read by the next two months |
| `VakasiTambahan/BONUS_TRIWULAN_{YYYY-MM}` | The payout event that puts the earning on slips |

All three are written only by the server. Every change is audited in
`FinancialAuditLogs`.

### August and September 2026 (paper records)

The system starts with October 2026, so the two months before it come from
the paper records through `npm run seed:bonus-triwulan` (dry run unless
`--apply`):

- `-- --senam-sheet recap.xlsx --month 2026-09` loads a Senam Pagi attendance
  recap (a name column plus one dd/mm column of 1s per session). Names are
  matched to the roster. It stores how many sessions each Loyalis missed
  (anyone the recap does not list missed them all). A person who could still
  qualify (at most one miss in that month) but cannot be matched stops the run
  until it is settled with `--map`.
- `-- --template x.xlsx` then `-- --file x.xlsx` loads the Y/T sheet for who was
  paid in August and September, and previews who can still earn the bonus in
  October.

October cannot be calculated until **August's Senam Pagi** and **who was paid in
August and September** are loaded. A paper month saved in the older per-month
form (only who "met" the rule) is read as not recorded, so September's recap
has to be loaded again with this version (`--apply`); the command is safe to
repeat.

## 10. Decisions confirmed by the user

- Strata 1 in each of three months in a row, plus at most one missed Senam Pagi
  session across all sessions of those three months. (First built as one miss
  per month; corrected on 2026-10-12.)
- Every streak starts fresh after a payout.
- Senam Pagi is independent of scan attendance, cuti and ganti libur.
- Admin Karyawan and Super Admin record Senam Pagi.
- The paper seed records both who was paid and who met Senam Pagi for August
  and September.

## 11. Where it lives

| Concern | File |
| --- | --- |
| Rules (pure, tested) | `src/lib/payroll/bonusTriwulan.ts` |
| Server: calculation, payout, close check | `src/lib/server/bonusTriwulan.ts` |
| Presence used for Strata | `src/lib/server/loyalisPresence.ts` |
| API | `/api/payroll/senam-pagi`, `/api/payroll/bonus-triwulan` |
| Page | `src/app/dashboard/payroll/uraian/senam-pagi/page.tsx` |
| Paper seed | `scripts/seedBonusTriwulan.ts`, `src/lib/payroll/bonusTriwulanSeed.ts` |
| Integration test | `npm run test:bonus-triwulan:integration` |
