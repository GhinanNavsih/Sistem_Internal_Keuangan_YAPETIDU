/**
 * Backfills the annual `PayrollHolidayCalendars/{year}` accumulator with the
 * officially declared Indonesian national holidays (SKB 3 Menteri).
 *
 * Dry-run by default; pass `--apply` to write.
 *
 * This mirrors POST /api/payroll/holiday-calendars exactly, including its
 * refusal to rewrite the annual document while a materialized period in that
 * year is still open. That lock is the reason this exists as a script rather
 * than a raw Firestore patch: the annual accumulator seeds a period's frozen
 * `workCalendar` at materialization time, so rewriting it under an open,
 * already-frozen period could re-rate work that was approved against the
 * previous calendar.
 *
 * Scope note: only the 17 *national holidays* are written. `getRegularSatpamPayType`
 * takes `nationalHolidayDates`, and cuti bersama (collective leave) is a
 * separate category that carries its own pay policy — it is deliberately NOT
 * added here. Fridays are likewise omitted: `normalizePeriodPremiumDates`
 * unions them in by rule, so listing them in the annual document is redundant.
 *
 * Usage:
 *   tsx scripts/backfillHolidayCalendar.ts --year 2026
 *   tsx scripts/backfillHolidayCalendar.ts --year 2026 --apply
 */
import admin, { adminDb } from '../src/lib/firebase-admin';
import { assertDateOnly } from '../src/lib/payroll/domain';
import { buildFinancialAuditRecord, newFinancialAuditRef } from '../src/lib/server/audit';
import type { AuthenticatedProfile } from '../src/lib/server/auth';
import { isPeriodClosed, isPeriodMaterialized } from '../src/lib/server/payrollPeriod';

/**
 * Indonesian national holidays per SKB 3 Menteri. Cuti bersama is excluded on
 * purpose — see the scope note above.
 */
const NATIONAL_HOLIDAYS: Record<string, Array<{ date: string; name: string }>> = {
  '2026': [
    { date: '2026-01-01', name: 'Tahun Baru Masehi' },
    { date: '2026-01-16', name: "Isra Mikraj Nabi Muhammad SAW" },
    { date: '2026-02-17', name: 'Tahun Baru Imlek 2577 Kongzili' },
    { date: '2026-03-19', name: 'Hari Suci Nyepi (Tahun Baru Saka 1948)' },
    { date: '2026-03-21', name: 'Idul Fitri 1447 Hijriah (hari pertama)' },
    { date: '2026-03-22', name: 'Idul Fitri 1447 Hijriah (hari kedua)' },
    { date: '2026-04-03', name: 'Wafat Isa Almasih' },
    { date: '2026-04-05', name: 'Kebangkitan Isa Almasih (Paskah)' },
    { date: '2026-05-01', name: 'Hari Buruh Internasional' },
    { date: '2026-05-14', name: 'Kenaikan Isa Almasih' },
    { date: '2026-05-27', name: 'Idul Adha 1447 Hijriah' },
    { date: '2026-05-31', name: 'Hari Raya Waisak 2570' },
    { date: '2026-06-01', name: 'Hari Lahir Pancasila' },
    { date: '2026-06-16', name: 'Tahun Baru Islam 1448 Hijriah' },
    { date: '2026-08-17', name: 'Proklamasi Kemerdekaan RI' },
    { date: '2026-08-25', name: 'Maulid Nabi Muhammad SAW' },
    { date: '2026-12-25', name: 'Hari Raya Natal' },
  ],
};

function argValue(flag: string): string {
  const index = process.argv.indexOf(flag);
  return index >= 0 ? process.argv[index + 1] || '' : '';
}

async function main() {
  const year = argValue('--year');
  const apply = process.argv.includes('--apply');
  if (!/^\d{4}$/.test(year)) {
    throw new Error('Gunakan --year YYYY.');
  }
  const holidays = NATIONAL_HOLIDAYS[year];
  if (!holidays) {
    throw new Error(
      `Daftar hari libur nasional ${year} belum terdaftar di skrip ini. Tambahkan dahulu dari SKB 3 Menteri.`,
    );
  }

  const version = `ID-${year}-NATIONAL-SKB`;
  const reason = `Backfill hari libur nasional ${year} sesuai SKB 3 Menteri.`;
  const dates = Array.from(new Set(holidays.map((holiday) => holiday.date))).sort();
  for (const date of dates) {
    assertDateOnly(date);
    if (!date.startsWith(`${year}-`)) {
      throw new Error(`Tanggal ${date} berada di luar tahun ${year}.`);
    }
  }

  const calendarRef = adminDb.collection('PayrollHolidayCalendars').doc(year);
  const [beforeSnapshot, periodsSnapshot] = await Promise.all([
    calendarRef.get(),
    adminDb.collection('PayrollPeriods').get(),
  ]);
  const before = beforeSnapshot.exists ? beforeSnapshot.data()! : null;
  const beforeDates: string[] = Array.isArray(before?.dates)
    ? before.dates.filter((date: unknown): date is string => typeof date === 'string')
    : [];

  const blocking = periodsSnapshot.docs.filter(
    (snapshot) =>
      String(snapshot.data().period || snapshot.id).startsWith(`${year}-`) &&
      isPeriodMaterialized(snapshot.data()) &&
      !isPeriodClosed(snapshot.data()),
  );

  const added = dates.filter((date) => !beforeDates.includes(date));
  const removed = beforeDates.filter((date) => !dates.includes(date));

  console.log(`Kalender ${year}: versi ${before?.version ?? '(belum ada)'} -> ${version}`);
  console.log(`  sebelum : ${beforeDates.length} tanggal`);
  console.log(`  sesudah : ${dates.length} tanggal`);
  console.log(`\n  ditambahkan (${added.length}):`);
  for (const date of added) {
    const name = holidays.find((holiday) => holiday.date === date)?.name ?? '';
    console.log(`    + ${date}  ${name}`);
  }
  console.log(`\n  dihapus (${removed.length}):`);
  for (const date of removed) {
    console.log(`    - ${date}  (redundan: hari Jumat sudah premium menurut aturan)`);
  }

  if (blocking.length > 0) {
    console.log(
      `\nDIBLOKIR: periode terbuka yang sudah membekukan kalender: ${blocking
        .map((snapshot) => snapshot.id)
        .join(', ')}.`,
    );
    console.log(
      'Tutup periode tersebut lebih dahulu, sesuai penguncian di POST /api/payroll/holiday-calendars.',
    );
    console.log('Tidak ada perubahan yang ditulis.');
    return;
  }
  if (before && before.version === version) {
    console.log('\nVersi kalender yang sama sudah ada. Tidak ada perubahan yang ditulis.');
    return;
  }
  if (!apply) {
    console.log('\nDRY RUN. Jalankan ulang dengan --apply untuk menulis perubahan.');
    return;
  }

  const actor: AuthenticatedProfile = {
    uid: 'script:backfillHolidayCalendar',
    email: null,
    role: 'super_admin',
    displayName: 'backfillHolidayCalendar script',
    permittedCategories: [],
  };
  const next = {
    year,
    version,
    dates,
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    updatedBy: actor.uid,
    schemaVersion: 1,
  };
  const batch = adminDb.batch();
  batch.set(calendarRef, next);
  batch.create(
    newFinancialAuditRef(),
    buildFinancialAuditRecord(actor, {
      action: 'HOLIDAY_CALENDAR_VERSION_CREATED',
      entityType: 'PayrollHolidayCalendar',
      entityId: year,
      reason,
      before,
      after: { ...next, updatedAt: null },
    }),
  );
  await batch.commit();
  console.log('\nDITERAPKAN. Kalender diperbarui dan dicatat di FinancialAuditLogs.');
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
