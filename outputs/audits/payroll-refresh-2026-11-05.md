# Payroll refresh review — 5 November 2026

Production Firestore was inspected read-only. No production payroll, event,
payment, Koperasi, or audit document was modified.

## Confirmed refresh defects

- Single-slip **Terapkan Perubahan** updated only local form state. A second
  **Simpan Perubahan** was required. Confirmation now saves once and reports
  success or an error in the dialog.
- Replacing the Pekarya preview object reinitialized the editor
  and could dismiss its comparison. Initialization now belongs to the editing
  session, rather than every source-object change.
- Bulk refresh stopped at the first failed employee, leaving prior successful
  database writes absent from local state. It now publishes each successful
  response, continues processing, and retains failed rows with their errors.
- Bulk comparison could list an unsaved slip, then omit it from Apply. Listed
  editable changes now follow the same save path, including new drafts.
- Duplicate labels were compared and merged using the first matching row.
  A base `Lembur` row and a vakasi event with the same name could duplicate pay.
  Comparison now sums matching labels and applies each selected total once.
- Bulk refresh used cached employee profiles and could leave the displayed
  saved slips stale. Source reads now explicitly use the server and reconcile
  the screen with saved values. Saves use server-returned canonical rows.
- Refresh now supplies the reviewed draft revision. The API refuses stale
  revisions, preserves tax selection, and returns canonical rows on retries.

## Historical discrepancy requiring review

October is permanently closed. All 237 slips are locked. November has no saved
slips at the time of the audit. Nine bulk-refresh SAVE_DRAFT audit records were
found from 1 November onward.

For approved event `2026-10_Lembur_auflod`, 10 locked October snapshots contain
two identical positive `Lembur` amounts. Their combined earning exceeds this
event's recipient amounts by **Rp175.000**. This is a source-to-snapshot
discrepancy requiring financial review, not a payment/refund determination.

| Employee ID | Event amount | Locked Lembur total | Difference |
| --- | ---: | ---: | ---: |
| Loyalis_036 | Rp10.000 | Rp20.000 | Rp10.000 |
| Loyalis_054 | Rp25.000 | Rp50.000 | Rp25.000 |
| Loyalis_060 | Rp25.000 | Rp50.000 | Rp25.000 |
| Loyalis_069 | Rp10.000 | Rp20.000 | Rp10.000 |
| Loyalis_071 | Rp10.000 | Rp20.000 | Rp10.000 |
| Loyalis_101 | Rp25.000 | Rp50.000 | Rp25.000 |
| Loyalis_111 | Rp25.000 | Rp50.000 | Rp25.000 |
| Loyalis_140 | Rp25.000 | Rp50.000 | Rp25.000 |
| Loyalis_152 | Rp10.000 | Rp20.000 | Rp10.000 |
| Loyalis_182 | Rp10.000 | Rp20.000 | Rp10.000 |

For `2026_10_Loyalis_036`, the FinancialAuditLogs SAVE_DRAFT record at
**4 November 2026, 15:03:37 WIB** has a `bulk_refresh_` request ID and proves:

```text
before: Lembur 0 + Lembur 10,000 = 10,000
after:  Lembur 10,000 + Lembur 10,000 = 20,000
```

The audit establishes a refresh-caused duplication for this slip. The remaining
listed discrepancies should be reconciled against their full audit history
before any historical correction. Locked snapshots were preserved.

## Validation

- `npm test`: auth, leave, 964 unit tests, proposal/vakasi lifecycle tests, and
  payroll-refresh interaction tests passed at validation time. The final focused
  refresh run passed all 10 interaction scenarios.
- `npm run test:payroll-refresh:integration`: real API, Auth and Firestore
  emulator writes passed. Koperasi HTTP used an isolated fixture; no real loans
  were advanced. Coverage includes tax preservation, idempotency, concurrent
  edits, stale/new-draft conflicts, authorization and immutable/closed guards.
- TypeScript and production build passed.
- Safari: actual PaySlipDialog and Base UI controls in an isolated fixture;
  preview replacement retained the comparison, confirmation saved exactly
  once, failure stayed visible, and retry succeeded without a second save.
- Browser fixture persistence was simulated. Production was inspected read-only.
