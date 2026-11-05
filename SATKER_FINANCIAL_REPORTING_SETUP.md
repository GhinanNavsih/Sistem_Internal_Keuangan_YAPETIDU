# SatKer financial books setup

The books are available at `/dashboard/satker-finance`. The shared catalog derives from `5. PUSKOMNET 26 - 27.xlsx`; Super Admin can complete inactive accounts in **Pengaturan**. Assigned editors can customize their own unit's catalog in **Akun**.

## Activation

1. Deploy the application with `Current_Firestore_Rules.md` and `storage.rules`. Financial records and receipts are server managed; direct client access remains denied.
2. Assign each book's real head and finance secretary as editors. `satker_head_loyalis` and `satker_finance_admin` can edit their assigned books; Super Admin can manage every book. BAK and Rektorat retain their authorized read access and consolidation.
3. In **Akun**, enter balanced September 1 opening balances for the selected academic year. Review them against the prior year's records. Openings are managed separately for each year and can be corrected after journals have been posted.
4. Configure scheduled Firestore backups and verify restores separately. Application code does not configure infrastructure backups.

The supplied PUSKOMNET workbook has an unmatched debit/credit difference of **Rp 7,074,450** and is not automatically imported. Reconcile the source before entering its balances or transactions.

## Daily work and paper reporting

- Editors post balanced journals, attach receipts, and correct any month or academic year without a submission or closing step.
- Edit or delete a journal from its history. Deletion requires a reason; changes retain their before/after audit records. Remove a reversal before changing its source journal. Rebuild generated depreciation from **Aset Tetap**.
- Saved journal receipts can be previewed, removed, or replaced. **Urungkan** restores a staged removal, **Batal** discards changes, and **Simpan perubahan** persists them. Archived files remain in Storage for the audit trail.
- Use **Rekonsiliasi Bank** to compare books with cash counts or bank statements. Repost depreciation in affected months after changing an asset.
- In **Arus Kas**, configure the two printed signature places: **Ketua SatKer** and **WarKu**. Choose active Loyalis or edit their names and titles. The PDF uses the current choices; **Simpan konfigurasi tanda tangan** stores them for this SatKer, independently of the report editor and unit profile head.
- Select a month in **Arus Kas**, download **PDF Arus Kas + bukti**, print it, and hand the hard copy to BAK's office. There is no digital submission, draft status, approval, revision request, or official signed PDF/QR workflow.
- Existing historical reporting records stay archived in Firestore and have no effect on editing. No production financial data needs to be changed for this release.

Run `npx tsx --test src/lib/satker-finance/*.test.ts`, `npm run test:satker-finance:page`, and `npm run test:satker-finance:integration` for accounting, page interaction, and protected API/database coverage.
