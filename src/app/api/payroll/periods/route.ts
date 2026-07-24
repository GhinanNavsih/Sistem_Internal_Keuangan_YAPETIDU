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
    const reason = typeof body.reason === 'string' ? body.reason.trim() : '';

    if (!/^\d{4}-\d{2}$/.test(period)) {
      throw new HttpError(400, 'Periode wajib menggunakan format YYYY-MM.');
    }
    if (!['open', 'closed'].includes(attendanceStatus)) {
      throw new HttpError(400, 'Status periode tidak valid.');
    }
    if (reason.length < 8 || reason.length > 500) {
      throw new HttpError(400, 'Alasan wajib diisi antara 8 dan 500 karakter.');
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
      if (attendanceStatus === 'open' && !calendarSnapshot.exists) {
        throw new HttpError(
          409,
          `Kalender hari libur ${period.slice(0, 4)} wajib dikonfigurasi sebelum periode dibuka.`,
        );
      }
      const after = {
        period,
        attendanceStatus,
        datePolicy: 'shift_start_date',
        timeZone: 'Asia/Jakarta',
        holidayCalendarVersion:
          before?.holidayCalendarVersion ||
          calendarSnapshot.data()?.version ||
          null,
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
