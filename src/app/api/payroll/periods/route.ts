import { NextRequest } from 'next/server';
import admin, { adminDb } from '@/lib/firebase-admin';
import { buildFinancialAuditRecord, newFinancialAuditRef } from '@/lib/server/audit';
import {
  errorResponse,
  HttpError,
  requireAuthenticatedProfile,
  requireRole,
} from '@/lib/server/auth';

export const dynamic = 'force-dynamic';

type AttendanceStatus = 'open' | 'closed';

export async function POST(request: NextRequest) {
  try {
    const actor = await requireAuthenticatedProfile(request);
    requireRole(actor, ['super_admin', 'finance_verifier']);
    const body = await request.json();
    const period = typeof body.period === 'string' ? body.period : '';
    const attendanceStatus = body.attendanceStatus as AttendanceStatus;
    const holidays = Array.isArray(body.holidays)
      ? body.holidays.filter((h: any) => typeof h === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(h))
      : [];
    const reason =
      typeof body.reason === 'string' && body.reason.trim().length > 0
        ? body.reason.trim()
        : (attendanceStatus === 'open'
            ? `Membuka periode ${period} dengan ${holidays.length} tanggal merah`
            : `Menutup periode ${period}`);

    if (!/^\d{4}-\d{2}$/.test(period)) {
      throw new HttpError(400, 'Periode wajib menggunakan format YYYY-MM.');
    }
    if (!['open', 'closed'].includes(attendanceStatus)) {
      throw new HttpError(400, 'Status periode tidak valid.');
    }

    const result = await adminDb.runTransaction(async (transaction) => {
      const periodRef = adminDb.collection('PayrollPeriods').doc(period);
      const calendarRef = adminDb
        .collection('PayrollHolidayCalendars')
        .doc(period.slice(0, 4));
      const [snapshot, calendarSnapshot] = await Promise.all([
        transaction.get(periodRef),
        transaction.get(calendarRef),
      ]);
      const before = snapshot.exists ? snapshot.data()! : null;
      if (attendanceStatus === 'closed' && !before) {
        throw new HttpError(409, 'Periode harus dibuka sebelum dapat ditutup.');
      }
      if (before?.attendanceStatus === 'closed' && attendanceStatus === 'open') {
        throw new HttpError(
          409,
          'Periode yang sudah ditutup tidak dapat dibuka kembali; gunakan proses koreksi.',
        );
      }

      // Sync calendar snapshot or create auto-version if calendar doesn't exist yet
      const year = period.slice(0, 4);
      const calData = calendarSnapshot.exists ? calendarSnapshot.data()! : { version: `ID-${year}-V1`, dates: [] };
      const existingDates: string[] = Array.isArray(calData.dates) ? calData.dates : [];
      const mergedDates = Array.from(new Set([...existingDates, ...holidays])).sort();

      transaction.set(
        calendarRef,
        {
          year,
          version: calData.version || `ID-${year}-V1`,
          dates: mergedDates,
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
          updatedBy: actor.uid,
        },
        { merge: true },
      );

      const after = {
        period,
        attendanceStatus,
        holidays,
        datePolicy: 'shift_start_date',
        timeZone: 'Asia/Jakarta',
        holidayCalendarVersion: calData.version || `ID-${year}-V1`,
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        updatedBy: actor.uid,
        schemaVersion: 1,
      };
      transaction.set(periodRef, after, { merge: true });
      transaction.create(
        newFinancialAuditRef(),
        buildFinancialAuditRecord(actor, {
          action: attendanceStatus === 'open' ? 'PAYROLL_PERIOD_OPENED' : 'PAYROLL_PERIOD_CLOSED',
          entityType: 'PayrollPeriod',
          entityId: period,
          reason,
          before,
          after,
        }),
      );
      return after;
    });

    return Response.json(result, { status: 201 });
  } catch (error) {
    return errorResponse(error);
  }
}
