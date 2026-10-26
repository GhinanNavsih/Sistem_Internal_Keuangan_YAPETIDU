# Internal-BAK — Project Knowledge

Next.js 16 (App Router), React 19, TypeScript, Tailwind 4, shadcn/ui, Firebase (Auth, Firestore, Storage). This file holds what most tasks need. Each area below has its own doc: read it before changing that area.

## Commands

- `npm run dev`, `npm run build`
- `npm test`: `tsx --test` over the `*.test.ts` files (no Jest or Vitest).
- Emulator integration tests (`npm run test:*:integration`) need Java.
- Scripts in `scripts/` are dry-run unless given `--apply`; some also need an `--ids` allowlist. Most are not in `package.json`: run them with `tsx scripts/<file>.ts`.

## Where code lives

- `src/lib/payroll/`: pure domain rules with tests. No Firebase imports.
- `src/lib/server/`: server-only code (Admin SDK, transactions).
- `src/lib/*-admin.ts`: Admin SDK handles for each Firebase project.
- `src/utils/generate*Pdf.ts`, `generate*Xlsx.ts`: one generator per document.
- `src/components/ui/`: shadcn primitives. UI rules: `UI_UX_PRINCIPLES.md`.
- `CONTEXT.md` is the glossary. `docs/adr/` records decisions; don't "fix" what an ADR records.

## Firebase projects

- **Primary** (`db` / `adminDb`): the default. Collections: `docs/firestore-collections.md`.
- **Koperasi Unipdu** (`secondaryDb` on the client, `koperasiAdminDb()` on the server): write only through `koperasiAdminDb()`. See `docs/features/koperasi.md`.
- **SIMPEL UNIPDU** (`simpelAdminDb()`, server-only): the key decides the project, so a scratch key means a scratch project. SAKU never changes bookings SIMPEL made itself. See `docs/features/venue-reservations.md`.

## Roles and access

Roles are in `src/lib/payroll/roles.ts` (`USER_ROLES`); route confinement is in `src/components/ProtectedRoute.tsx`. Route sets per role: `docs/rbac.md`.

- `super_admin`: unrestricted. Redirected out of `/employee/*` unless previewing.
- `finance_verifier`: payroll pages; verifies and operates payments.
- `satker_head`: Pekarya (blue collar) department head.
- `satker_head_loyalis`: Loyalis department head.
- `loyalis_admin` (shown as **Admin Karyawan**; the id is unchanged): employee data, santunan, presence.
- `honorer`: blue-collar portal (`/employee/*`), narrowed to one activity workflow.
- `loyalis`: Loyalis employee portal.
- `ketua_shift_satpam`: Satpam shift lead.

There is no generic `employee` role.

- Never re-derive an employee's activity workflow. Use `getEmployeeActivityWorkflow(profile)` (`src/lib/employeeActivities.ts`); page checks, nav links and the route guard must agree.
- Landing pages come from `getRoleHomePath(profile)` (`src/lib/roleHome.ts`) only.
- Accounts of one person switch roles by `personEmployeeId`, never by name. See `docs/features/account-switching.md`.

## Payroll

- Slip statuses: `draft`, `locked`, `payment_created`, `paid`. `confirmed` is legacy and read-only. `pending` belongs to `PayrollCorrectionRequests`, never to a slip.
- Profile and presence edits reach draft slips through the propagation modules; locked and paid slips keep their figures.
- Calculation rules: `docs/features/payroll-calculation.md`. Module map and name matching: `docs/features/payroll-library.md`.

## Feature areas

Read the linked doc before changing the area.

- Venue reservations, `/dashboard/reservasi-ruang`: `docs/features/venue-reservations.md`
- Venue return checks, `/dashboard/pemeriksaan-ruang`: `docs/features/venue-inspections.md`
- Driver cost simulation, `/dashboard/simulasi-perjalanan`: `docs/features/simulasi-perjalanan.md`
- Santunan (Ajuan Duka / Melahirkan): `docs/features/santunan-bansos.md`
- Bonus Triwulan and Senam Pagi: `docs/features/bonus-triwulan.md`
- Pekarya → Loyalis conversion: `docs/features/employee-conversion.md`
- SatKer finance books: `docs/features/satker-finance.md`
- Koperasi page and loans: `docs/features/koperasi.md`
- Account switching (Ganti Peran): `docs/features/account-switching.md`
- Uraian OCR (`/api/parse-rekap`): `docs/features/uraian-ocr.md`

## Agent skills

- Issues: `docs/agents/issue-tracker.md` (GitHub Issues). Triage labels: `docs/agents/triage-labels.md`.
- Domain: `docs/agents/domain.md`.
