import { createHash } from 'node:crypto';
import { NextRequest } from 'next/server';
import admin, { adminDb } from '@/lib/firebase-admin';
import {
  SATPAM_RATES,
  getRegularSatpamPayType,
  guardDutyIndexId,
  isImmutablePayrollStatus,
} from '@/lib/payroll/domain';
import {
  normalizePeriodPremiumDates,
  periodDateRange,
  periodCalendarFromData,
  periodFridayDates,
} from '@/lib/payroll/calendar';
import { pekaryaPayrollWindow } from '@/lib/payroll/pekaryaSpj';
import {
  PEKARYA_PUBLICATIONS_COLLECTION,
} from '@/lib/server/attendanceStore';
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
import { ATTENDANCE_PAYROLL_START_PERIOD } from '@/lib/payroll/attendance';

export const dynamic = 'force-dynamic';

function assertPeriod(period: string) {
  if (!/^\d{4}-\d{2}$/.test(period)) {
    throw new HttpError(400, 'Periode wajib menggunakan format YYYY-MM.');
  }
}

function parseDates(value: unknown, period: string): string[] {
  if (!Array.isArray(value)) {
    throw new HttpError(400, 'Daftar tanggal premium wajib berupa array.');
  }
  if (value.some((date) => typeof date !== 'string')) {
    throw new HttpError(400, 'Semua tanggal premium wajib berupa teks YYYY-MM-DD.');
  }
  const source = value as string[];
  const window = pekaryaPayrollWindow(period);
  const validDates = new Set(periodDateRange(period));
  if (
    source.some(
      (date) =>
        !/^\d{4}-\d{2}-\d{2}$/.test(date) ||
        !validDates.has(date) ||
        date < window.startsOn ||
        date > window.endsOn,
    )
  ) {
    throw new HttpError(
      400,
      `Tanggal premium harus berada dalam jendela payroll ${window.startsOn} sampai ${window.endsOn}.`,
    );
  }
  const normalized = normalizePeriodPremiumDates(period, source);
  return normalized;
}

async function loadCalendarContext(period: string) {
  const periodRef = adminDb.collection('PayrollPeriods').doc(period);
  const annualRef = adminDb
    .collection('PayrollHolidayCalendars')
    .doc(period.slice(0, 4));
  const [periodSnapshot, annualSnapshot] = await Promise.all([
    periodRef.get(),
    annualRef.get(),
  ]);
  const annualDates =
    annualSnapshot.exists && Array.isArray(annualSnapshot.data()?.dates)
      ? annualSnapshot
          .data()!
          .dates.filter((date: unknown): date is string => typeof date === 'string')
      : [];
  // Periods are open by default, so a month with no document still has a usable
  // calendar: every Friday is premium automatically and nationally declared
  // dates come from the annual accumulator until an administrator edits them.
  return {
    periodRef,
    periodSnapshot,
    annualSnapshot,
    calendar: periodCalendarFromData(
      period,
      periodSnapshot.exists ? periodSnapshot.data()! : null,
      annualDates,
    ),
  };
}

async function impactForDates(period: string, beforeDates: string[], afterDates: string[]) {
  const changedDates = Array.from(
    new Set(
      [...beforeDates, ...afterDates].filter(
        (date) => beforeDates.includes(date) !== afterDates.includes(date),
      ),
    ),
  ).sort();
  const [occurrencesSnapshot, publicationsSnapshot, slipSnapshot] = await Promise.all([
    adminDb.collection('ShiftOccurrences').where('payrollPeriod', '==', period).get(),
    adminDb
      .collection(PEKARYA_PUBLICATIONS_COLLECTION)
      .where('period', '==', period)
      .get(),
    adminDb
      .collection('PayrollSlipStates')
      .where('period', '==', period.replace('-', '_'))
      .get(),
  ]);
  const occurrences = occurrencesSnapshot.docs.filter((snapshot) =>
    changedDates.includes(String(snapshot.data().dutyDate || '')),
  );
  const reportIds = occurrences.flatMap((snapshot) =>
    Array.isArray(snapshot.data().reportIds)
      ? snapshot
          .data()
          .reportIds.filter((id: unknown): id is string => typeof id === 'string')
      : [],
  );
  const reportSnapshots =
    reportIds.length > 0
      ? await adminDb.getAll(
          ...reportIds.map((id) => adminDb.collection('ActivityReports').doc(id)),
        )
      : [];
  const affectedReports = reportSnapshots.filter((snapshot) => {
    if (!snapshot.exists) return false;
    const report = snapshot.data()!;
    if (!['Harian', 'Jumat & Libur'].includes(String(report.shiftType || ''))) {
      return false;
    }
    const nextType = getRegularSatpamPayType(
      String(report.dutyDate || report.activityDate || ''),
      new Set(afterDates),
    );
    return report.shiftType !== nextType;
  });
  const immutableSlips = slipSnapshot.docs.filter((snapshot) =>
    isImmutablePayrollStatus(snapshot.data().status),
  );
  return {
    changedDates,
    affectedPublicationCount: publicationsSnapshot.docs.filter(
      (snapshot) =>
        snapshot.data().state === 'published' &&
        snapshot.data().stale !== true,
    ).length,
    affectedOccurrenceCount: occurrences.length,
    affectedPendingRegularAssignments: affectedReports.filter(
      (snapshot) => snapshot.data()?.status === 'pending',
    ).length,
    affectedApprovedRegularAssignments: affectedReports.filter(
      (snapshot) => snapshot.data()?.status === 'approved',
    ).length,
    immutableSlipCount: immutableSlips.length,
    occurrenceSnapshots: occurrences,
    affectedReportSnapshots: affectedReports,
    publicationSnapshots: publicationsSnapshot.docs,
  };
}

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ period: string }> },
) {
  try {
    const actor = await requireAuthenticatedProfile(request);
    requireRole(actor, [
      'super_admin',
      'finance_verifier',
      'satker_head',
      'loyalis_presence_admin',
    ]);
    const { period } = await context.params;
    assertPeriod(period);
    const current = await loadCalendarContext(period);
    return Response.json(
      {
        period,
        attendanceStatus:
          current.periodSnapshot.data()?.attendanceStatus === 'closed'
            ? 'closed'
            : 'open',
        materialized: isPeriodMaterialized(current.periodSnapshot.data()),
        calendar: current.calendar,
        fridayDates: periodFridayDates(period),
      },
      { headers: { 'Cache-Control': 'no-store' } },
    );
  } catch (error) {
    return errorResponse(error);
  }
}

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ period: string }> },
) {
  try {
    const actor = await requireAuthenticatedProfile(request);
    requireRole(actor, ['super_admin']);
    const { period } = await context.params;
    assertPeriod(period);
    const body = await request.json();
    const current = await loadCalendarContext(period);
    const proposedDates = parseDates(body.premiumDates, period);
    const impact = await impactForDates(
      period,
      current.calendar.premiumDates,
      proposedDates,
    );
    return Response.json({
      period,
      before: current.calendar,
      proposed: {
        ...current.calendar,
        premiumDates: proposedDates,
      },
      impact: {
        changedDates: impact.changedDates,
        affectedPublicationCount: impact.affectedPublicationCount,
        affectedOccurrenceCount: impact.affectedOccurrenceCount,
        affectedPendingRegularAssignments: impact.affectedPendingRegularAssignments,
        affectedApprovedRegularAssignments: impact.affectedApprovedRegularAssignments,
        immutableSlipCount: impact.immutableSlipCount,
      },
    });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function PATCH(
  request: NextRequest,
  context: { params: Promise<{ period: string }> },
) {
  try {
    const actor = await requireAuthenticatedProfile(request);
    requireRole(actor, ['super_admin']);
    const { period } = await context.params;
    assertPeriod(period);
    const body = await request.json();
    const premiumDates = parseDates(body.premiumDates, period);
    const expectedRevision = Number(body.expectedRevision);
    const reason = typeof body.reason === 'string' ? body.reason.trim() : '';
    const requestId = typeof body.requestId === 'string' ? body.requestId.trim() : '';
    if (
      !Number.isSafeInteger(expectedRevision) ||
      expectedRevision < 1 ||
      reason.length < 8 ||
      !/^[A-Za-z0-9_-]{8,128}$/.test(requestId)
    ) {
      throw new HttpError(400, 'Revisi, alasan, atau requestId kalender tidak valid.');
    }
    const requestHash = createHash('sha256')
      .update(JSON.stringify({ period, premiumDates, expectedRevision }))
      .digest('hex');
    const idempotencyRef = adminDb
      .collection('FinancialIdempotencyKeys')
      .doc(`${actor.uid}__${requestId}`);
    const previousRequest = await idempotencyRef.get();
    if (previousRequest.exists) {
      if (previousRequest.data()?.requestHash !== requestHash) {
        throw new HttpError(409, 'requestId sudah digunakan untuk kalender berbeda.');
      }
      return Response.json({
        period,
        calendar: {
          revision: Number(previousRequest.data()?.revision || expectedRevision + 1),
          premiumDates,
        },
        idempotent: true,
      });
    }

    const current = await loadCalendarContext(period);
    if (isPeriodClosed(current.periodSnapshot.data())) {
      throw new HttpError(409, 'Kalender periode yang sudah ditutup tidak dapat diubah.');
    }
    if (current.calendar.revision !== expectedRevision) {
      throw new HttpError(409, 'Kalender telah berubah. Muat ulang sebelum menyimpan.');
    }
    const impact = await impactForDates(
      period,
      current.calendar.premiumDates,
      premiumDates,
    );
    if (impact.immutableSlipCount > 0) {
      throw new HttpError(
        409,
        'Ada slip payroll immutable pada periode ini; gunakan alur koreksi finansial.',
      );
    }
    if (impact.changedDates.length === 0) {
      return Response.json({
        period,
        calendar: current.calendar,
        impact: { changedDates: [] },
        idempotent: true,
      });
    }

    const nextRevision = expectedRevision + 1;
    const transactionResult = await adminDb.runTransaction(async (transaction) => {
      const [latestPeriod, idempotencySnapshot] = await Promise.all([
        transaction.get(current.periodRef),
        transaction.get(idempotencyRef),
      ]);
      if (idempotencySnapshot.exists) {
        const previous = idempotencySnapshot.data()!;
        if (previous.requestHash !== requestHash) {
          throw new HttpError(409, 'requestId sudah digunakan untuk kalender berbeda.');
        }
        return {
          revision: Number(previous.revision || nextRevision),
          idempotent: true,
        };
      }
      const latestCalendar = periodCalendarFromData(
        period,
        latestPeriod.exists ? latestPeriod.data()! : null,
        current.calendar.premiumDates,
      );
      if (
        isPeriodClosed(latestPeriod.data()) ||
        latestCalendar.revision !== expectedRevision
      ) {
        throw new HttpError(409, 'Kalender atau status periode telah berubah.');
      }
      // Setting a month's premium dates is the other way a period becomes
      // materialized. Nothing can have been approved against it yet -- an
      // approval would have materialized it first -- so this is revision 1 and
      // there is no prior rating left to reconcile.
      const isFirstCalendar = !isPeriodMaterialized(latestPeriod.data());
      const next = {
        revision: isFirstCalendar ? 1 : nextRevision,
        annualVersion: current.calendar.annualVersion,
        premiumDates,
        reason,
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        updatedBy: actor.uid,
      };
      transaction.set(
        current.periodRef,
        {
          period,
          datePolicy: 'shift_start_date',
          timeZone: 'Asia/Jakarta',
          ...(current.calendar.annualVersion
            ? { holidayCalendarVersion: current.calendar.annualVersion }
            : {}),
          ...(isFirstCalendar
            ? {
                materializedAt: admin.firestore.FieldValue.serverTimestamp(),
                materializedBy: actor.uid,
                ...(period >= ATTENDANCE_PAYROLL_START_PERIOD
                  ? { satpamDutyPlanRequired: true, satpamDutyPlanSchemaVersion: 1 }
                  : {}),
              }
            : {}),
          workCalendar: next,
          holidays: premiumDates,
          calendarReconciliationStatus: isFirstCalendar ? 'complete' : 'pending',
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
          updatedBy: actor.uid,
          schemaVersion: 1,
        },
        { merge: true },
      );
      transaction.create(
        newFinancialAuditRef(),
        buildFinancialAuditRecord(actor, {
          action: 'PAYROLL_PERIOD_CALENDAR_UPDATED',
          entityType: 'PayrollPeriod',
          entityId: period,
          requestId,
          reason,
          before: latestCalendar,
          after: next,
          metadata: {
            changedDates: impact.changedDates,
            affectedApprovedRegularAssignments:
              impact.affectedApprovedRegularAssignments,
          },
        }),
      );
      transaction.create(idempotencyRef, {
        requestHash,
        entityType: 'PayrollPeriodCalendar',
        entityId: period,
        revision: next.revision,
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
      });
      return { revision: next.revision, idempotent: false };
    });

    if (!transactionResult.idempotent) {
      try {
        const writer = adminDb.bulkWriter();
        const afterSet = new Set(premiumDates);
        const affectedByOccurrence = new Map<
          string,
          Array<FirebaseFirestore.DocumentSnapshot>
        >();
        for (const reportSnapshot of impact.affectedReportSnapshots) {
          const occurrenceId = String(reportSnapshot.data()?.sourceOccurrenceId || '');
          const list = affectedByOccurrence.get(occurrenceId) || [];
          list.push(reportSnapshot);
          affectedByOccurrence.set(occurrenceId, list);
        }

        for (const occurrenceSnapshot of impact.occurrenceSnapshots) {
          const occurrence = occurrenceSnapshot.data();
          const affected = affectedByOccurrence.get(occurrenceSnapshot.id) || [];
          if (affected.length === 0) continue;
          const nextType = getRegularSatpamPayType(
            String(occurrence.dutyDate || ''),
            afterSet,
          );
          const reopened = affected.filter(
            (snapshot) => snapshot.data()?.status === 'approved',
          );
          const pending = affected.filter(
            (snapshot) => snapshot.data()?.status === 'pending',
          );
          for (const reportSnapshot of affected) {
            const before = reportSnapshot.data()!;
            const isApproved = before.status === 'approved';
            writer.update(reportSnapshot.ref, {
              shiftType: nextType,
              fee: SATPAM_RATES[nextType],
              calendarRevision: nextRevision,
              holidayCalendarVersion: `PERIOD-${period}-R${nextRevision}`,
              ...(isApproved
                ? {
                    status: 'pending',
                    calendarReopenedAt:
                      admin.firestore.FieldValue.serverTimestamp(),
                    calendarReopenedBy: actor.uid,
                    calendarReopenedFromApproval: {
                      shiftType: before.shiftType,
                      fee: before.fee,
                      approvedAt: before.approvedAt || null,
                      approvedBy: before.approvedBy || null,
                    },
                  }
                : {}),
            });
            if (isApproved) {
              writer.delete(
                adminDb.collection('PayrollLedgerEntries').doc(reportSnapshot.id),
              );
              writer.delete(
                adminDb
                  .collection('GuardDutyIndexes')
                  .doc(
                    guardDutyIndexId(
                      String(occurrence.dutyDate || ''),
                      String(
                        occurrence.reportedShiftName || occurrence.shiftName || '',
                      ) as 'Pagi' | 'Sore' | 'Malam',
                      String(before.employeeId || ''),
                    ),
                  ),
              );
            }
            writer.create(
              newFinancialAuditRef(),
              buildFinancialAuditRecord(actor, {
                action: isApproved
                  ? 'SATPAM_SHIFT_REOPENED_FOR_CALENDAR'
                  : 'SATPAM_PENDING_RATE_RECALCULATED',
                entityType: 'ActivityReport',
                entityId: reportSnapshot.id,
                requestId,
                reason,
                before,
                after: {
                  status: isApproved ? 'pending' : before.status,
                  shiftType: nextType,
                  fee: SATPAM_RATES[nextType],
                  calendarRevision: nextRevision,
                },
              }),
            );
          }
          const existingPending = Array.isArray(occurrence.pendingReportIds)
            ? occurrence.pendingReportIds.filter(
                (id: unknown): id is string => typeof id === 'string',
              )
            : [];
          const pendingReportIds = Array.from(
            new Set([
              ...existingPending,
              ...reopened.map((snapshot) => snapshot.id),
              ...pending.map((snapshot) => snapshot.id),
            ]),
          );
          const anomalyCodes = Array.isArray(occurrence.anomalyCodes)
            ? occurrence.anomalyCodes.filter(
                (code: unknown): code is string => typeof code === 'string',
              )
            : [];
          writer.update(occurrenceSnapshot.ref, {
            regularPayType: nextType,
            calendarRevision: nextRevision,
            holidayCalendarVersion: `PERIOD-${period}-R${nextRevision}`,
            pendingReportIds,
            pendingAssignmentCount: pendingReportIds.length,
            approvedAssignmentCount: Math.max(
              0,
              Number(occurrence.approvedAssignmentCount || 0) - reopened.length,
            ),
            ...(pendingReportIds.length > 0
              ? {
                  status: 'pending_review',
                  reviewStatus: 'pending',
                  anomalyCodes: Array.from(
                    new Set([
                      ...anomalyCodes,
                      'CALENDAR_CHANGED_AFTER_APPROVAL',
                    ]),
                  ),
                }
              : {}),
            updatedAt: admin.firestore.FieldValue.serverTimestamp(),
          });
        }

        impact.publicationSnapshots.forEach((snapshot) => {
          writer.update(snapshot.ref, {
            state: 'stale',
            stale: true,
            staleReason: 'calendar_revision_changed',
            staleAt: admin.firestore.FieldValue.serverTimestamp(),
            requiredCalendarRevision: nextRevision,
          });
        });
        await writer.close();
        const loyalisPresenceRef = adminDb
          .collection('LoyalisPresence')
          .doc(period.replace('-', '_'));
        const loyalisPresenceSnapshot = await loyalisPresenceRef.get();
        if (loyalisPresenceSnapshot.exists) {
          await loyalisPresenceRef.update({
            sourceCalendarStale: true,
            requiredCalendarRevision: nextRevision,
            updatedAt: admin.firestore.FieldValue.serverTimestamp(),
          });
        }
        await current.periodRef.update({
          calendarReconciliationStatus: 'complete',
          calendarReconciledAt: admin.firestore.FieldValue.serverTimestamp(),
        });
      } catch (error) {
        await current.periodRef.update({
          calendarReconciliationStatus: 'failed',
          calendarReconciliationError:
            error instanceof Error ? error.message.slice(0, 500) : 'unknown',
        });
        throw error;
      }
    }

    return Response.json({
      period,
      calendar: {
        revision: transactionResult.revision,
        annualVersion: current.calendar.annualVersion,
        premiumDates,
      },
      impact: {
        changedDates: impact.changedDates,
        affectedPublicationCount: impact.affectedPublicationCount,
        affectedPendingRegularAssignments: impact.affectedPendingRegularAssignments,
        reopenedApprovedRegularAssignments:
          impact.affectedApprovedRegularAssignments,
      },
      idempotent: transactionResult.idempotent,
    });
  } catch (error) {
    return errorResponse(error);
  }
}
