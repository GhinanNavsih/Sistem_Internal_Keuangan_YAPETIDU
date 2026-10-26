# Firestore collections

## Database Collections (Firestore)

**Primary app** (`db`/`adminDb`) unless noted. ~43 active top-level collections; grouped by domain:

**Employee master data**: `Employees_WhiteCollar`, `Employees_BlueCollar`, `Employees_Loyalis` (nested `personal_info.*`), `JabatanStruktural` (position lookup).

**Salary matrices** — four independently-versioned top-level collections (each keyed by a version doc like `2026_v1` with a `rows` subcollection + `_config.activeVersion`): `SalaryMatrix` (blue-collar gapok), `SalaryMatrix_WhiteCollar` (white-collar gapok), `SalaryMatrix_Functional` (functional allowance tiers), `SalaryMatrix_Kepangkatan` (rank/promotion allowance).

**Attendance / presence**: `LoyalisPresence` (monthly import, keyed by period), `LoyalisPresenceCorrections`, `AttendanceImports` (blue-collar/Pekarya raw import batches), `GantiLiburRequests` + `GantiLiburRequestRevisions` (Loyalis compensatory day off, server-only; see `docs/features/payroll-library.md`).

**Activity / SPJ reporting**: `ActivityReports` (SOPIR/SATPAM/PEKARYA activity & journey submissions), `ActivityReportRevisions` (audit trail), `ActivityReportsIndex` / `PekaryaActivityIndexes` (dedup indexes), `KegiatanSpj` (per-event SPJ fees), `DriverJourneys` (driver trip records), `DriverPiketSchedules` (driver standby roster), `ProposalKegiatan` (combined Kegiatan SatKer proposals and LPJ; client page `/dashboard/payroll/uraian/kegiatan-satker`), `VakasiTambahan` (supplemental duty allowance events, filtered by `period`), `UraianGaji` (itemized pay component breakdown).

**Satpam duty/shift**: `SatpamDutyPlans` (8-day rotation plans), `SatpamShiftTeams`, `ShiftOccurrences` (materialized per-date/post/team shifts), `GuardDutyIndexes` (dedup index), `SatpamAbsenceRequestRevisions`.

**Payroll core**: `PayrollPeriods`, `PayrollSlipStates` (per-employee-per-period slip — holds the earnings/deductions/taxes money rows, not just a status; doc id `{period}_{employeeId}`, shape in `PayrollSlipStateDocument`. Writable statuses are draft/locked/payment_created/paid (`PayrollStatus`); `confirmed` is read-only legacy that `isImmutablePayrollStatus` and the employee payslip query still honour; `pending` is not a slip status — it belongs to `PayrollCorrectionRequests`), `PayrollPayments`, `PayrollLedgerEntries`, `PayrollDeliveryEvents` (email delivery idempotency), `PayrollHolidayCalendars`, `PayrollCorrectionRequests`, `PayrollHistoricalCorrections`, `PayrollKoperasiProgressions` (payroll↔Koperasi bridge saga state), `FinancialIdempotencyKeys`, `FinancialAuditLogs`.

**BanSos**: `BansosRequests` (server-only; one doc per Ajuan Duka / Melahirkan, see `docs/features/santunan-bansos.md`).

**Bonus Triwulan**: `SenamPagi` (server-only; one doc per month: sessions keyed by date, each listing who was present) and `BonusTriwulan` (server-only; one doc per month: who was paid). See `docs/features/bonus-triwulan.md`.

**Admin / auth / misc**: `users` (one per login account; `personEmployeeId` names the employee it belongs to, for role switching, see `docs/features/account-switching.md`), `EmpEditLog`, `admin_impersonation_sessions`, `audit_logs`, `reactivation_tokens`, `VenueReservationContacts` (server-only; one doc per account holding the WhatsApp number and unit name last used for a venue booking), `DriverJourneySimulations` (server-only; one doc per saved Simulasi Biaya Perjalanan) and `DriverRouteQuotes` (server-only; Google route + toll answers keyed by a hash of the route points, reused for 7 days).

**`Koperasi Unipdu` (secondary Firebase app)**: accessed via `secondaryApp`/`secondaryDb` (client) and `koperasiAdminDb()` in `src/lib/koperasi-admin.ts` (server, separate service-account credential). Collections: `simpanPinjam` (loan/savings records — writes go through `koperasiAdminDb()` only) and `users` (Koperasi-project member records, matched to primary-app employees via `koperasiAuthUid`).

**`SIMPEL UNIPDU` (third Firebase project, `peminjaman-fasilitas-be85b`)**: the campus facility-lending app (separate repo `~/Documents/simpel-unipdu`, client-only Next.js, no server of its own). Accessed only server-side via `simpelAdminDb()` in `src/lib/simpel-admin.ts` (key: `simpel-service-account.json`, `SIMPEL_SERVICE_ACCOUNT`, or `SIMPEL_CLIENT_EMAIL` + `SIMPEL_PRIVATE_KEY`; the project comes from the key, so a scratch key means a scratch project). SAKU reads `simpel_gedung`, `simpel_fasilitas`, `simpel_bookings`, `simpel_maintenance`, and writes `simpel_bookings` (reservations, return checks), `simpel_emails` (SIMPEL's in-app notification bell), `simpel_saku_locks` (per-date transaction lock, SAKU-only), and — from Pemeriksaan Ruang only — `simpel_maintenance` (repair log), stock fields of `simpel_fasilitas` and the `inventarisList`/`ruanganList` arrays of `simpel_gedung`.

Legacy/migration-only collections (`MasterData`, unsuffixed `Employees`) exist only in one-off `scripts/`, superseded by the collections above — don't treat them as live schema.
