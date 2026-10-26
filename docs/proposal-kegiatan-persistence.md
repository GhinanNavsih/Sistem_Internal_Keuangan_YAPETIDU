# Kegiatan SatKer persistence

## Unified route

`/dashboard/payroll/uraian/kegiatan-satker` provides both the proposal and LPJ
stages. The former `proposal-kegiatan` and `pelaporan-kegiatan` page URLs redirect
there permanently, preserving period query parameters. The API endpoints,
`ProposalKegiatan` collection, and local draft keys keep their existing names so
existing drafts and older API clients remain compatible.

The standalone reporting page is retired. Historical budget cloning reads only
`ProposalKegiatan`; client writes to the former `PelaporanKegiatan` collection
are denied to prevent older tabs from recreating deleted test reports.

## Why events disappeared

The earlier client included the signed-in editor's `submittedBy` fields in full
document saves. Reviewing or saving a head's event as Super Admin could therefore
change its owner. The head's list filters by `submittedBy`, so the event remained
in Firestore but disappeared from that account's list.

Commit `a925277` stopped those owner/status rewrites in the updated autosave and
manual draft paths. It did not address navigation before the 1.2 second save
delay, edits skipped during the 500 millisecond load guard, or older tabs whose
direct Firestore writes were still accepted by the rules.

## Persistence boundary

- The page captures unfinished input immediately in account- and period-scoped
  local storage. It uses one stable event ID, flushes queued saves on navigation,
  and recovers pending drafts after a remount or network failure.
- Writes use `POST /api/payroll/proposal-kegiatan`. The API derives the creator
  from the authenticated user, requires the request's originating account to
  match that identity, preserves existing ownership and period, checks revisions
  and allowed stages, and audits changes.
- Request IDs make lost-response retries idempotent. A recovered draft can
  continue its own preceding request; unrelated concurrent writes return a
  conflict and keep the draft locally. The page can preserve that draft as a
  separate copy before loading the latest stored event.
- Approval uses the stored proposal budget and preserves existing LPJ input.
  LPJ approval also checks the revision and advances it.
- All browser mutations of `ProposalKegiatan` are denied. This blocks
  older tabs from taking ownership, reverting approval, or leaving orphan
  payments after deletion. Deletion uses the audited API with the existing
  Super Admin / owning Kepala SatKer permissions and open-period checks.
- Confirmed deletion pauses the draft queue and waits for requests already in
  progress without saving pending input. Previously, flushing a stale draft
  first could fail its revision check and prevent deletion from even reaching
  Firestore. Local drafts are now removed only after deletion succeeds; a failed
  deletion retains them for recovery or retry.

## Regression commands

```sh
npm run test:proposal-kegiatan:page
npm run test:proposal-kegiatan:integration
npm test
```

The first command mounts the actual React page with deterministic time and
isolated transport boundaries. The second uses the real APIs and Firestore/Auth
emulators, including the legacy write payload that formerly changed ownership.
The page checks also run automatically after `npm test`.

## Report quantity expressions

Saving an expense report previously inserted the sum of its evaluated child
quantities into the leading number of the LPJ expression while retaining its
multipliers. Saving an unchanged `30 Botol x 2 sesi` therefore produced
`60 Botol x 2 sesi`. The modal's confirmation preview repeated this mistake.
Both paths now share a formatter that preserves the expression's numeric total.
Page regressions open the actual report editor and cover unchanged quantities,
edited quantities, confirmation values, and repeated saves.

## Receipt uploads

The non-pegawai report mode uses the shared image/PDF format list, detects the
actual format from the bytes, and prepares files before sending them. There is
no input file-size cap. Images above 1 MB are compressed, HEIC/HEIF and TIFF are
converted for viewing, and PDF compression retains all pages. Small images and
PDFs remain intact when no conversion is needed. The server validates the actual
type, enforces the 1 MB stored result, and keeps its extension and content type
consistent. Existing evidence files remain in Storage when links are removed.

## Release and historical data

Deploy the new application/API before publishing the Firestore rules that deny
direct browser writes, then reload open proposal pages. Code and emulator
success do not establish that production runs these protections.

The prevention changes do not reassign historical records. Repair an owner only
from an authoritative identity mapping and record the change in the audit log;
an event title alone does not establish its original creator.

## Employee payments

LPJ approval requires `expectedRevision` and `requestId`. The authenticated API
validates active Loyalis recipients and integer rupiah amounts in the same
transaction as approval, then publishes one approved `VakasiTambahan` event per
employee report. Repeated recipient rows are summed from REALISASI; explicit
zero amounts stay zero. Expense-only reports do not create payroll entries.

The new source kind is `proposal_lpj_payroll`, with deterministic
`LPJ_PAYROLL_` IDs derived from the proposal/report pair. Historical
`proposal_lpj_report` sandbox entries remain non-payable. Neither the browser
nor the generic Vakasi API may mutate generated entries. Vakasi Karyawan shows
them as managed records with a link back to Kegiatan SatKer.

Revision and deletion void generated events and remove their earnings from
editable slips. Approval, withdrawal and deletion check affected slip locks
before committing. Approved source content stays locked until revision.
Financial audit records retain deleted event content and payment provenance.

After the transaction, the existing Vakasi propagation recomputes draft slips.
The durable operation in `FinancialIdempotencyKeys` retains affected employee
IDs and a pending/complete sync state, including after deletion. Failed sync
does not misreport the committed decision as a failed approval. Retry through
`POST /api/payroll/proposal-kegiatan/sync` with its `operationId`; the page
exposes the retry for pending operations. Each retry reevaluates current slip
statuses; merges never add an earning twice. A missing slip is normal: its
future generation reads the approved source event.

## Editing and order

Super Admin confirms each focus visit to an editable field on an event whose
immutable `creatorRole` is not `super_admin`. Unknown creator roles are protected.
Related mutation controls use the same guard, including portal-based report
editors. Cancelling and opening/closing an unchanged report never save data.

The edit confirmation disables pointer dismissal: an input's pointer press
opens the popup before release, so that same gesture's trailing click can land
on the newly mounted backdrop. Without this protection the dialog immediately
closes as an outside press. Real-dialog regressions exercise complete mouse,
touch and pen gesture sequences; explicit cancellation and Escape still work.

The displayed form owns its expected revision. A clean form refreshes when
another editor saves; a dirty form keeps its local values and conflicts instead
of adopting the other editor's revision. Unsaved report and signature edits also
block that revision advancement.

Events sort newest-created first, using the same comparator for server records
and local drafts. Local first-created times survive retries and remounts.

Preview metadata recovery with:

```sh
npm run backfill:proposal-metadata
```

`--apply` performs the repair (optionally `--ids=id1,id2`). Missing `createdAt`
comes from Firestore's document creation time. Creator roles come only from
matching creation audit evidence; unresolved roles remain protected. Repairs
preserve ownership, content, status, revision and `updatedAt`, with a separate
audit record. The 26 October 2026 dry run found 11 timestamps and three creator
roles to restore across 14 records; it made no production changes.

Deploy the compatible application/API before the new mutation-denying rules.
Then apply the reviewed metadata repair, reload older tabs, and verify an
approved LPJ's source entries and editable-slip totals. Do not replay historical
approvals automatically. Pushing, deployment and applying this repair are
separate release actions.
