# Proposal kegiatan persistence

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
- Browser create/update writes to `ProposalKegiatan` are denied. This blocks
  older tabs from taking ownership or reverting approval. Existing authorized
  reads and explicit deletions retain their role and open-period checks.
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
