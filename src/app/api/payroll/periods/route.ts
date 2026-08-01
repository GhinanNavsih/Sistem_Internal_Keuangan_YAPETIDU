import { NextRequest } from 'next/server';
import admin, { adminDb } from '@/lib/firebase-admin';
import { buildFinancialAuditRecord, newFinancialAuditRef } from '@/lib/server/audit';
import {
  errorResponse,
  HttpError,
  requireAuthenticatedProfile,
  requireRole,
} from '@/lib/server/auth';
import { pekaryaPayrollWindow } from '@/lib/payroll/pekaryaSpj';
import {
  ATTENDANCE_PAYROLL_START_PERIOD,
} from '@/lib/payroll/attendance';
import {
  normalizePeriodPremiumDates,
  periodCalendarFromData,
} from '@/lib/payroll/calendar';
import { isSatpamDutyPlanRequired } from '@/lib/payroll/satpamDutyPlan';
import {
  ATTENDANCE_IMPORTS_COLLECTION,
  PEKARYA_PUBLICATIONS_COLLECTION,
  loadAttendanceEmployeeIdentities,
  pekaryaPublicationId,
} from '@/lib/server/attendanceStore';
import { syncSatpamDutyReconciliation } from '@/lib/server/satpamDutyPlan';
import {
  isPeriodClosed,
  isPeriodMaterialized,
  livePeriodWindow,
} from '@/lib/server/payrollPeriod';

export const dynamic = 'force-dynamic';

type AttendanceStatus = 'open' | 'closed';

export async function GET(request: NextRequest) {
  try {
    await requireAuthenticatedProfile(request);
    const snapshot = await adminDb.collection('PayrollPeriods').get();
    const byPeriod = new Map(
      snapshot.docs
        .filter((document) => /^\d{4}-\d{2}$/.test(document.id))
        .map((document) => [document.id, document.data()]),
    );

    // Periods accept input by default, so the answer is no longer "which
    // documents say open" -- an untouched month has no document at all. The
    // reportable set is the live window around today plus any existing period
    // that has not been permanently closed.
    const candidates = new Set<string>(byPeriod.keys());
    for (const period of livePeriodWindow()) candidates.add(period);

    const openPeriods = Array.from(candidates)
      .filter((period) => !isPeriodClosed(byPeriod.get(period)))
      .map((period) => {
        const window = pekaryaPayrollWindow(period);
        const calendar = periodCalendarFromData(period, byPeriod.get(period));
        return {
          period,
          startDate: window.startsOn,
          endDate: window.endsOn,
          calendarRevision: calendar.revision,
          premiumDates: calendar.premiumDates,
          materialized: isPeriodMaterialized(byPeriod.get(period)),
        };
      })
      .sort((left, right) => left.startDate.localeCompare(right.startDate));
    return Response.json(
      { openPeriods },
      { headers: { 'Cache-Control': 'no-store' } },
    );
  } catch (error) {
    return errorResponse(error);
  }
}

export async function POST(request: NextRequest) {
  try {
    const actor = await requireAuthenticatedProfile(request);
    requireRole(actor, ['super_admin', 'finance_verifier']);
    const body = await request.json();
    const period = typeof body.period === 'string' ? body.period : '';
    const attendanceStatus = body.attendanceStatus as AttendanceStatus;
    const holidays = Array.isArray(body.holidays)
      ? body.holidays.filter(
          (holiday: unknown): holiday is string =>
            typeof holiday === 'string' &&
            /^\d{4}-\d{2}-\d{2}$/.test(holiday),
        )
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

    if (
      attendanceStatus === 'closed' &&
      period >= ATTENDANCE_PAYROLL_START_PERIOD
    ) {
      const [
        periodBeforeClose,
        attendanceImport,
        loyalisPresence,
        identityData,
        reopenedShiftSnapshot,
      ] = await Promise.all([
        adminDb.collection('PayrollPeriods').doc(period).get(),
        adminDb.collection(ATTENDANCE_IMPORTS_COLLECTION).doc(period).get(),
        adminDb.collection('LoyalisPresence').doc(period.replace('-', '_')).get(),
        loadAttendanceEmployeeIdentities(),
        adminDb
          .collection('ShiftOccurrences')
          .where('payrollPeriod', '==', period)
          .get(),
      ]);
      if (
        !attendanceImport.exists ||
        !attendanceImport.data()?.activeRevisionId
      ) {
        throw new HttpError(
          409,
          'Import presensi terpadu harus diaktifkan sebelum periode ditutup.',
        );
      }
      // An unmaterialized period never had a calendar revision to reconcile;
      // closure pins it for the first time.
      if (
        isPeriodMaterialized(periodBeforeClose.data()) &&
        periodBeforeClose.data()?.calendarReconciliationStatus !== 'complete'
      ) {
        throw new HttpError(
          409,
          'Rekonsiliasi perubahan kalender belum selesai.',
        );
      }
      const importRevision = Number(attendanceImport.data()?.activeRevision || 0);
      if (
        !loyalisPresence.exists ||
        loyalisPresence.data()?.sourceImportStale === true ||
        loyalisPresence.data()?.sourceCalendarStale === true ||
        Number(loyalisPresence.data()?.sourceImportRevision || 0) !==
          importRevision ||
        Number(loyalisPresence.data()?.sourceCalendarRevision || 0) !==
          Number(periodBeforeClose.data()?.workCalendar?.revision || 1)
      ) {
        throw new HttpError(
          409,
          'Presensi Loyalis belum diproses dari revisi import aktif.',
        );
      }
      const missingNipy = identityData.identities.filter(
        (identity) =>
          identity.active &&
          (identity.employeeCollection === 'Employees_BlueCollar' ||
            identity.employeeCollection === 'Employees_Loyalis') &&
          !identity.nipy,
      );
      const duplicateNipy = Array.from(identityData.byNipy.values()).filter(
        (items) => items.filter((item) => item.active).length > 1,
      );
      if (missingNipy.length > 0 || duplicateNipy.length > 0) {
        throw new HttpError(
          409,
          `Identitas NIPY belum siap: ${missingNipy.length} kosong dan ${duplicateNipy.length} duplikat.`,
        );
      }
      const categories = Array.from(
        new Set(
          identityData.identities.flatMap((identity) =>
            identity.active &&
            identity.employeeCollection === 'Employees_BlueCollar' &&
            identity.jobCategory &&
            identity.jobCategory !== 'SATPAM'
              ? [identity.jobCategory]
              : [],
          ),
        ),
      );
      const publicationSnapshots =
        categories.length > 0
          ? await adminDb.getAll(
              ...categories.map((category) =>
                adminDb
                  .collection(PEKARYA_PUBLICATIONS_COLLECTION)
                  .doc(pekaryaPublicationId(period, category)),
              ),
            )
          : [];
      const calendarRevision = periodCalendarFromData(
        period,
        periodBeforeClose.data()!,
      ).revision;
      const staleCategory = publicationSnapshots.find(
        (snapshot) =>
          !snapshot.exists ||
          snapshot.data()?.state !== 'published' ||
          snapshot.data()?.stale === true ||
          Number(snapshot.data()?.importRevision || 0) !== importRevision ||
          Number(snapshot.data()?.calendarRevision || 0) !== calendarRevision,
      );
      if (staleCategory) {
        throw new HttpError(
          409,
          'Semua kategori Pekarya non-Satpam harus dipublikasikan dari revisi presensi dan kalender terbaru.',
        );
      }
      const calendarReopened = reopenedShiftSnapshot.docs.find((snapshot) => {
        if (
          !['pending_review', 'under_review'].includes(
            String(snapshot.data().status || ''),
          )
        ) {
          return false;
        }
        const codes = snapshot.data().anomalyCodes;
        return (
          Array.isArray(codes) &&
          codes.includes('CALENDAR_CHANGED_AFTER_APPROVAL')
        );
      });
      if (calendarReopened) {
        throw new HttpError(
          409,
          'Ada shift Satpam yang dibuka kembali karena perubahan kalender.',
        );
      }
    }

    if (attendanceStatus === 'closed') {
      const satpamPeriodSnapshot = await adminDb
        .collection('PayrollPeriods')
        .doc(period)
        .get();
      if (
        satpamPeriodSnapshot.exists &&
        isSatpamDutyPlanRequired(
          period,
          satpamPeriodSnapshot.data() || null,
        )
      ) {
        const teamsSnapshot = await adminDb.collection('SatpamShiftTeams').get();
        const dutyReconciliation = await syncSatpamDutyReconciliation(
          period,
          actor.uid,
        );
        if (dutyReconciliation.plans.length !== teamsSnapshot.size) {
          throw new HttpError(
            409,
            `Rencana dinas Satpam belum lengkap: ${dutyReconciliation.plans.length} dari ${teamsSnapshot.size} regu.`,
          );
        }
        if (!dutyReconciliation.periodComplete) {
          throw new HttpError(
            409,
            'Periode belum dapat ditutup sebelum seluruh shift Satpam berakhir.',
          );
        }
        if (dutyReconciliation.blockers.length > 0) {
          throw new HttpError(
            409,
            `Rekonsiliasi Satpam belum selesai: ${dutyReconciliation.blockers.join(' ')}`,
          );
        }
      }
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
      // Periods are open by default, so closing a month that nobody explicitly
      // opened is normal and must materialize it rather than be rejected.
      if (before?.attendanceStatus === 'closed' && attendanceStatus === 'open') {
        throw new HttpError(
          409,
          'Periode yang sudah ditutup tidak dapat dibuka kembali; gunakan proses koreksi.',
        );
      }
      if (attendanceStatus === 'open' && !isPeriodClosed(before)) {
        throw new HttpError(
          409,
          'Periode sudah menerima input secara otomatis; tindakan membuka periode tidak diperlukan lagi.',
        );
      }

      // Sync calendar snapshot or create auto-version if calendar doesn't exist yet
      const year = period.slice(0, 4);
      const calData = calendarSnapshot.exists ? calendarSnapshot.data()! : { version: `ID-${year}-V1`, dates: [] };
      const existingDates: string[] = Array.isArray(calData.dates) ? calData.dates : [];
      const mergedDates = Array.from(new Set([...existingDates, ...holidays])).sort();
      const periodPremiumDates = normalizePeriodPremiumDates(
        period,
        [...existingDates, ...holidays],
      );

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
        holidays: before?.holidays || periodPremiumDates,
        datePolicy: 'shift_start_date',
        timeZone: 'Asia/Jakarta',
        holidayCalendarVersion: calData.version || `ID-${year}-V1`,
        // A month that collected work without ever being explicitly opened has
        // no frozen calendar yet. Closure is the last moment it can be pinned,
        // so the closed snapshot records exactly what the period was rated on.
        ...(isPeriodMaterialized(before)
          ? {}
          : {
              satpamDutyPlanRequired:
                before?.satpamDutyPlanRequired === true ||
                period >= ATTENDANCE_PAYROLL_START_PERIOD,
              satpamDutyPlanSchemaVersion: 1,
              workCalendar: {
                revision: 1,
                annualVersion: calData.version || `ID-${year}-V1`,
                premiumDates: periodPremiumDates,
                reason,
                updatedAt: admin.firestore.FieldValue.serverTimestamp(),
                updatedBy: actor.uid,
              },
              calendarReconciliationStatus: 'complete',
            }),
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
