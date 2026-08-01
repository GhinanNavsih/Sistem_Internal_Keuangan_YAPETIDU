import { NextRequest } from 'next/server';
import admin, { adminDb } from '@/lib/firebase-admin';
import { assertDateOnly } from '@/lib/payroll/domain';
import { buildFinancialAuditRecord, newFinancialAuditRef } from '@/lib/server/audit';
import {
  errorResponse,
  HttpError,
  requireAuthenticatedProfile,
  requireRole,
} from '@/lib/server/auth';
import {
  isPeriodClosed,
  isPeriodMaterialized,
} from '@/lib/server/payrollPeriod';

export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  try {
    const actor = await requireAuthenticatedProfile(request);
    requireRole(actor, ['super_admin']);
    const body = await request.json();
    const year = typeof body.year === 'string' ? body.year : '';
    const version = typeof body.version === 'string' ? body.version.trim() : '';
    const reason = typeof body.reason === 'string' ? body.reason.trim() : '';
    const dates: string[] = Array.isArray(body.dates)
      ? body.dates.filter((date: unknown): date is string => typeof date === 'string')
      : [];

    if (!/^\d{4}$/.test(year) || version.length < 4 || reason.length < 8) {
      throw new HttpError(400, 'Tahun, versi, atau alasan kalender tidak valid.');
    }
    const uniqueDates: string[] = Array.from(new Set<string>(dates)).sort();
    for (const date of uniqueDates) {
      assertDateOnly(date);
      if (!date.startsWith(`${year}-`)) {
        throw new HttpError(400, `Tanggal ${date} berada di luar tahun ${year}.`);
      }
    }

    const calendarRef = adminDb.collection('PayrollHolidayCalendars').doc(year);
    const after = await adminDb.runTransaction(async (transaction) => {
      // Only a period that already froze its calendar can be invalidated by an
      // annual rewrite. Under open-by-default every future month is implicitly
      // open, so keying this lock on status alone would freeze the annual
      // calendar permanently. Filtering in memory also avoids the inequality
      // query, which would skip materialized periods that carry no
      // attendanceStatus field at all.
      const openPeriodsQuery = adminDb.collection('PayrollPeriods');
      const [beforeSnapshot, openPeriodsSnapshot] = await Promise.all([
        transaction.get(calendarRef),
        transaction.get(openPeriodsQuery),
      ]);
      const openPeriodInYear = openPeriodsSnapshot.docs.find(
        (snapshot) =>
          String(snapshot.data().period || snapshot.id).startsWith(`${year}-`) &&
          isPeriodMaterialized(snapshot.data()) &&
          !isPeriodClosed(snapshot.data()),
      );
      if (openPeriodInYear) {
        throw new HttpError(
          409,
          `Kalender ${year} dikunci oleh periode terbuka ${openPeriodInYear.id}. Tutup periode terlebih dahulu.`,
        );
      }
      const before = beforeSnapshot.exists ? beforeSnapshot.data()! : null;
      if (before && before.version === version) {
        throw new HttpError(409, 'Versi kalender yang sama sudah ada.');
      }
      const next = {
        year,
        version,
        dates: uniqueDates,
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        updatedBy: actor.uid,
        schemaVersion: 1,
      };
      transaction.set(calendarRef, next);
      transaction.create(
        newFinancialAuditRef(),
        buildFinancialAuditRecord(actor, {
          action: 'HOLIDAY_CALENDAR_VERSION_CREATED',
          entityType: 'PayrollHolidayCalendar',
          entityId: year,
          reason,
          before,
          after: next,
        }),
      );
      return next;
    });
    return Response.json(after, { status: 201 });
  } catch (error) {
    return errorResponse(error);
  }
}
