# SatKer financial reporting setup

The implementation for `SATKER_FINANCIAL_REPORTING_SYSTEM.md` is available at
`/dashboard/satker-finance`. Its accounts catalog is derived from
`5. PUSKOMNET 26 - 27.xlsx`: all 129 codes are present, while only the 36
codes with a usable name and accounting metadata can initially be posted.
The Super Administrator can complete inactive codes in **Pengaturan** before
they are used.

## Production activation

1. Deploy the application together with `Current_Firestore_Rules.md` and
   `storage.rules`. Financial records and receipt photos are server managed;
   direct client access is denied by these rules.
2. In **Manajemen Pengguna**, create the `rector_finance` account and, where
   needed, `satker_finance_admin` accounts. Existing
   `satker_head_loyalis` accounts can also prepare unit reports.
3. As Super Administrator, create each unit in **Keuangan SatKer →
   Pengaturan** and assign its actual head and secretary accounts. Existing
   Loyalis employee fields do not identify a unique financial SatKer, so the
   assignment must be made by a human who knows the organization.
4. For each academic year, enter balanced September 1 opening balances.
   Opening balances lock when the first journal entry or monthly report is
   posted. Review the balances against approved prior year records.
5. Enable scheduled Firestore backups in the production Google Cloud project
   and periodically verify a restore in a separate environment. A backup
   schedule is infrastructure configuration and is not created by this code.

The supplied PUSKOMNET workbook reports an unmatched debit/credit difference
of **Rp 7,074,450**. It is deliberately not imported. Reconcile that source
before entering any historical balances or transactions.

## Workflow and checks

- SatKer editors post balanced vouchers and submit a month after the previous
  month has been approved. Submission locks that month and later submissions
  prevent backdated changes.
- A posted journal can be edited or deleted from the journal history while its
  month, and every month after it, is still open (no report yet, a draft, or a
  revision BAK asked for). Edits and deletions keep the journal as it was in the
  audit trail, a deletion needs a reason, and receipt photos are never removed
  from Storage. Once a month is sent to BAK its journals are sealed, together
  with the months before it, and are corrected with a reversing journal in an
  open month instead. A journal and its reversal are only changed as a pair:
  neither can be edited alone, and the reversal can be deleted to undo it.
- Super Administrator checks the submitted report as BAK, then Rektorat
  approves it. Either reviewer can request a documented revision; prior
  submitted snapshots and audit entries remain available.
- The approved PDF includes the preparer and approver names, a QR code, and a
  public verification page. Receipt photos remain private to authorized unit
  editors and financial reviewers.
- `npm test` checks the accounting engine; `npm run
  test:satker-finance:integration` checks authentication, Firestore rules,
  Storage, unit access, posting, approvals, revisions, and consolidation on
  Firebase emulators.

No production collections are seeded or changed by the implementation.
