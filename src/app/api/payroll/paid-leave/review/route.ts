import { createHash } from 'node:crypto';
import { NextRequest } from 'next/server';
import admin, { adminDb } from '@/lib/firebase-admin';
import {
  annualPaidLeaveBalanceEntitlementForYear,
  annualPaidLeaveAttendanceCorrection,
  annualPaidLeaveDecisionIssue,
  annualPaidLeaveIdempotencyState,
  annualPaidLeavePayType,
  annualPaidLeaveQualifyingDate,
  isAnnualPaidLeaveEligible,
  type AnnualPaidLeaveRequest,
} from '@/lib/payroll/annualPaidLeave';
import {
  isPremiumAttendanceDate,
  pekaryaAttendanceAmount,
  resolveEmployeeAttendanceNipy,
} from '@/lib/payroll/attendance';
import {
  assertRequestId,
  isImmutablePayrollStatus,
  SATPAM_RATES,
} from '@/lib/payroll/domain';
import {
  applyApprovedPaidLeaveToLoyalisEntry,
  loyalisHasPayableAttendance,
  type LoyalisPaidLeaveEntry,
} from '@/lib/payroll/loyalisPaidLeave';
import {
  attendanceCorrectionHeadId,
  ATTENDANCE_IMPORTS_COLLECTION,
  PEKARYA_CORRECTIONS_COLLECTION,
  PEKARYA_CORRECTION_HEADS_COLLECTION,
  PEKARYA_PUBLICATIONS_COLLECTION,
  pekaryaPublicationId,
  loadPeriodPremiumDates,
} from '@/lib/server/attendanceStore';
import {
  ANNUAL_PAID_LEAVE_BALANCES_COLLECTION,
  ANNUAL_PAID_LEAVE_PAYROLL_POSTS_COLLECTION,
  ANNUAL_PAID_LEAVE_REQUESTS_COLLECTION,
  ANNUAL_PAID_LEAVE_REVISIONS_COLLECTION,
  annualPaidLeaveEmployeeDataMatches,
  annualPaidLeaveBalanceDocumentId,
  loadAnnualPaidLeaveEmployee,
  reviewerCanAccessAnnualPaidLeave,
} from '@/lib/server/annualPaidLeave';
import { buildFinancialAuditRecord, newFinancialAuditRef } from '@/lib/server/audit';
import {
  errorResponse,
  HttpError,
  requireAuthenticatedProfile,
  requireRole,
} from '@/lib/server/auth';
import { buildPekaryaAttendanceView } from '@/lib/server/pekaryaAttendance';
import { PEKARYA_OFFICIAL_LEAVE_REQUESTS_COLLECTION, officialLeaveRequestId } from '@/lib/server/pekaryaOfficialLeave';
import {
  buildPeriodMaterialization,
  isPeriodClosed,
  jakartaToday,
} from '@/lib/server/payrollPeriod';
import {
  SATPAM_ABSENCE_REQUESTS_COLLECTION,
  syncSatpamDutyReconciliation,
} from '@/lib/server/satpamDutyPlan';

export const dynamic = 'force-dynamic';

const REVIEWER_ROLES = [
  'super_admin',
  'satker_head',
  'loyalis_admin',
] as const;
const REVIEW_READER_ROLES = [...REVIEWER_ROLES, 'satker_head_loyalis'] as const;

function stableHash(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

function parseYear(value: string | null): number {
  const year = Number(value || jakartaToday().slice(0, 4));
  if (!Number.isInteger(year) || year < 2000 || year > 9999) {
    throw new HttpError(400, 'Tahun cuti tidak valid.');
  }
  return year;
}

function parseStatus(value: string | null): string {
  const status = value || 'pending';
  if (!['pending', 'approved', 'declined', 'withdrawn', 'all'].includes(status)) {
    throw new HttpError(400, 'Status cuti tidak valid.');
  }
  return status;
}

function satpamAbsenceRequestId(employeeId: string, leaveDate: string): string {
  return `${employeeId}__${leaveDate}`.replaceAll('-', '');
}

function matchingDate(record: FirebaseFirestore.DocumentData, date: string): boolean {
  return String(record.date || record.dutyDate || record.activityDate || '') === date;
}

function isApprovedCorrection(record: FirebaseFirestore.DocumentData, date: string): boolean {
  return matchingDate(record, date) && String(record.status || '') === 'approved';
}

function decisionIssueMessage(issue: NonNullable<ReturnType<typeof annualPaidLeaveDecisionIssue>>): string {
  return {
    period_closed: 'Periode payroll sudah ditutup; keputusan cuti tidak dapat diproses.',
    immutable_slip: 'Slip pegawai sudah immutable; gunakan koreksi finansial.',
    revision_conflict: 'Pengajuan telah berubah. Muat ulang sebelum memutuskan.',
    not_pending: 'Pengajuan ini sudah pernah diputuskan atau ditarik.',
    reserved_balance_missing: 'Saldo reservasi cuti tidak konsisten. Hubungi administrator.',
    payroll_post_exists: 'Posting payroll cuti tanggal ini sudah ada.',
    attendance_conflict: 'Presensi, izin, koreksi, atau laporan kerja berbayar sudah ada pada tanggal ini.',
  }[issue];
}

export async function GET(request: NextRequest) {
  try {
    const actor = await requireAuthenticatedProfile(request);
    requireRole(actor, REVIEW_READER_ROLES);
    const year = parseYear(request.nextUrl.searchParams.get('year'));
    const status = parseStatus(request.nextUrl.searchParams.get('status'));
    const period = request.nextUrl.searchParams.get('period')?.trim() || '';
    if (period && !/^\d{4}-\d{2}$/.test(period)) {
      throw new HttpError(400, 'Periode wajib menggunakan format YYYY-MM.');
    }

    const snapshot = await adminDb
      .collection(ANNUAL_PAID_LEAVE_REQUESTS_COLLECTION)
      .where('year', '==', year)
      .get();
    const requests = snapshot.docs
      .map((document) => ({
        id: document.id,
        ...document.data(),
        qualifyingDate: annualPaidLeaveQualifyingDate(
          String(document.data()?.serviceDate || ''),
        ),
      }) as AnnualPaidLeaveRequest)
      .filter((item) => {
        if (status !== 'all' && item.status !== status) return false;
        if (period && item.period !== period) return false;
        return actor.role === 'satker_head_loyalis'
          ? item.employeeKind === 'loyalis'
          : reviewerCanAccessAnnualPaidLeave(actor, {
              kind: item.employeeKind,
              category: item.category,
            });
      })
      .sort((left, right) => right.leaveDate.localeCompare(left.leaveDate));

    return Response.json(
      { year, status, period: period || null, requests },
      { headers: { 'Cache-Control': 'no-store' } },
    );
  } catch (error) {
    return errorResponse(error);
  }
}

export async function POST(request: NextRequest) {
  try {
    const actor = await requireAuthenticatedProfile(request);
    requireRole(actor, REVIEWER_ROLES);
    const body = (await request.json()) as Record<string, unknown>;
    const annualPaidLeaveRequestId = String(body.annualPaidLeaveRequestId || '');
    const action = String(body.action || '');
    const commandId = String(body.requestId || '');
    const expectedRevision = Number(body.expectedRevision);
    const decisionReason = String(body.reason || '').trim();
    if (!/^[A-Za-z0-9_-]{1,180}$/.test(annualPaidLeaveRequestId)) {
      throw new HttpError(400, 'ID pengajuan cuti tidak valid.');
    }
    if (action !== 'approve' && action !== 'decline') {
      throw new HttpError(400, 'Aksi keputusan cuti tidak valid.');
    }
    try {
      assertRequestId(commandId);
    } catch (error) {
      throw new HttpError(
        400,
        error instanceof Error ? error.message : 'requestId tidak valid.',
      );
    }
    if (!Number.isSafeInteger(expectedRevision) || expectedRevision < 1) {
      throw new HttpError(400, 'Revisi pengajuan tidak valid.');
    }
    if (decisionReason.length > 500 || (action === 'decline' && !decisionReason)) {
      throw new HttpError(
        400,
        action === 'decline'
          ? 'Alasan penolakan wajib diisi maksimal 500 karakter.'
          : 'Catatan keputusan maksimal 500 karakter.',
      );
    }

    const leaveRef = adminDb
      .collection(ANNUAL_PAID_LEAVE_REQUESTS_COLLECTION)
      .doc(annualPaidLeaveRequestId);
    const approving = action === 'approve';
    const initialLeaveSnapshot = await leaveRef.get();
    if (!initialLeaveSnapshot.exists) {
      throw new HttpError(404, 'Pengajuan cuti tahunan tidak ditemukan.');
    }
    const initialLeave = initialLeaveSnapshot.data() as AnnualPaidLeaveRequest;
    const employee = await loadAnnualPaidLeaveEmployee(
      initialLeave.employeeId,
      initialLeave.employeeKind,
    );
    if (!employee || (approving && !employee.active)) {
      throw new HttpError(409, 'Data pegawai aktif tidak ditemukan.');
    }
    if (!reviewerCanAccessAnnualPaidLeave(actor, employee)) {
      throw new HttpError(403, 'Anda tidak berwenang memutuskan cuti pegawai ini.');
    }
    if (
      approving &&
      (employee.kind !== initialLeave.employeeKind ||
        employee.category !== initialLeave.category ||
        employee.serviceDate !== initialLeave.serviceDate)
    ) {
      throw new HttpError(
        409,
        'Data pegawai berubah sejak pengajuan dibuat. Minta pegawai mengajukan ulang.',
      );
    }
    if (
      approving &&
      !isAnnualPaidLeaveEligible(employee.serviceDate, initialLeave.leaveDate)
    ) {
      throw new HttpError(409, 'Masa kerja pegawai belum memenuhi syarat pada tanggal cuti.');
    }

    const period = initialLeave.period;
    const leaveDate = initialLeave.leaveDate;
    const year = initialLeave.year;
    const isSatpam = employee.kind === 'blue_collar' && employee.category === 'SATPAM';
    const isRegularBlue = employee.kind === 'blue_collar' && !isSatpam;
    const calendar = approving ? await loadPeriodPremiumDates(period) : null;
    const loyalisHolidaySnapshot = employee.kind === 'loyalis' && approving
      ? await adminDb.collection('PayrollHolidayCalendars').doc(String(year)).get()
      : null;
    const rawLoyalisHolidayDates = loyalisHolidaySnapshot?.data()?.dates;
    const loyalisHolidayDates = Array.isArray(rawLoyalisHolidayDates)
      ? new Set(
          rawLoyalisHolidayDates.filter(
            (date: unknown): date is string => typeof date === 'string',
          ),
        )
      : null;
    const premium = Boolean(
      calendar &&
        isPremiumAttendanceDate(
          leaveDate,
          loyalisHolidayDates || calendar.premiumDates,
        ),
    );
    const payType = annualPaidLeavePayType(premium);

    let attendanceView: Awaited<ReturnType<typeof buildPekaryaAttendanceView>> | null = null;
    let employeeView: Awaited<ReturnType<typeof buildPekaryaAttendanceView>>['employees'][number] | null = null;
    let currentDay: Awaited<ReturnType<typeof buildPekaryaAttendanceView>>['employees'][number]['days'][number] | null = null;
    let nipy = '';
    if (approving && isRegularBlue) {
      nipy = resolveEmployeeAttendanceNipy(employee.raw);
      if (!nipy) {
        throw new HttpError(409, 'NIPY pegawai wajib dilengkapi sebelum cuti disetujui.');
      }
      attendanceView = await buildPekaryaAttendanceView(period, employee.category, {
        allowMissingActiveImport: true,
      });
      employeeView = attendanceView.employees.find(
        (candidate) => candidate.employeeId === employee.id,
      ) || null;
      if (!employeeView) {
        throw new HttpError(409, 'Pegawai tidak tersedia dalam presensi Pekarya periode ini.');
      }
      currentDay = employeeView.days.find((day) => day.date === leaveDate) || null;
      if (currentDay?.present) {
        throw new HttpError(409, 'Pegawai sudah memiliki presensi berbayar pada tanggal ini.');
      }
    }

    const balanceRef = adminDb
      .collection(ANNUAL_PAID_LEAVE_BALANCES_COLLECTION)
      .doc(annualPaidLeaveBalanceDocumentId(employee.id, year));
    const periodRef = adminDb.collection('PayrollPeriods').doc(period);
    const slipRef = adminDb
      .collection('PayrollSlipStates')
      .doc(`${period.replace('-', '_')}_${employee.id}`);
    const employeeRef = adminDb.collection(employee.collection).doc(employee.id);
    const idempotencyRef = adminDb
      .collection('FinancialIdempotencyKeys')
      .doc(`${actor.uid}__${commandId}`);
    const postRef = adminDb
      .collection(ANNUAL_PAID_LEAVE_PAYROLL_POSTS_COLLECTION)
      .doc(annualPaidLeaveRequestId);
    const officialLeaveRef = adminDb
      .collection(PEKARYA_OFFICIAL_LEAVE_REQUESTS_COLLECTION)
      .doc(officialLeaveRequestId(employee.id, leaveDate));
    const satpamAbsenceRef = adminDb
      .collection(SATPAM_ABSENCE_REQUESTS_COLLECTION)
      .doc(satpamAbsenceRequestId(employee.id, leaveDate));
    const correctionHeadRef = adminDb
      .collection(PEKARYA_CORRECTION_HEADS_COLLECTION)
      .doc(attendanceCorrectionHeadId(period, employee.id, leaveDate));
    const loyalisPresenceRef = adminDb
      .collection('LoyalisPresence')
      .doc(period.replace('-', '_'));
    const loyalisCorrectionsQuery = adminDb
      .collection('LoyalisPresenceCorrections')
      .where('employeeId', '==', employee.id);
    const activityReportsQuery = adminDb
      .collection('ActivityReports')
      .where('employeeId', '==', employee.id);
    const publicationRef = adminDb
      .collection(PEKARYA_PUBLICATIONS_COLLECTION)
      .doc(pekaryaPublicationId(period, employee.category));
    const uraianRef = adminDb
      .collection('UraianGaji')
      .doc(`${period.replace('-', '_')}_${employee.category}`);
    const importRef = adminDb.collection(ATTENDANCE_IMPORTS_COLLECTION).doc(period);
    const correctionRef = adminDb.collection(PEKARYA_CORRECTIONS_COLLECTION).doc();
    const requestHash = stableHash({
      annualPaidLeaveRequestId,
      action,
      commandId,
      expectedRevision,
      decisionReason,
    });

    const result = await adminDb.runTransaction(async (transaction) => {
      const [
        latestLeave,
        balanceSnapshot,
        periodSnapshot,
        slipSnapshot,
        latestEmployee,
        idempotencySnapshot,
        postSnapshot,
        officialLeaveSnapshot,
        satpamAbsenceSnapshot,
        correctionHeadSnapshot,
        loyalisPresenceSnapshot,
        loyalisCorrectionsSnapshot,
        activityReportsSnapshot,
        publicationSnapshot,
        uraianSnapshot,
        importSnapshot,
      ] = await Promise.all([
        transaction.get(leaveRef),
        transaction.get(balanceRef),
        transaction.get(periodRef),
        transaction.get(slipRef),
        transaction.get(employeeRef),
        transaction.get(idempotencyRef),
        transaction.get(postRef),
        transaction.get(officialLeaveRef),
        transaction.get(satpamAbsenceRef),
        transaction.get(correctionHeadRef),
        transaction.get(loyalisPresenceRef),
        transaction.get(loyalisCorrectionsQuery),
        transaction.get(activityReportsQuery),
        transaction.get(publicationRef),
        transaction.get(uraianRef),
        transaction.get(importRef),
      ]);

      if (idempotencySnapshot.exists) {
        if (
          annualPaidLeaveIdempotencyState(
            idempotencySnapshot.data()?.requestHash,
            requestHash,
          ) === 'conflict'
        ) {
          throw new HttpError(409, 'requestId sudah digunakan untuk keputusan lain.');
        }
        return {
          id: annualPaidLeaveRequestId,
          revision: Number(idempotencySnapshot.data()?.revision || expectedRevision),
          status: idempotencySnapshot.data()?.status,
          amount: Number(idempotencySnapshot.data()?.amount || 0),
          period,
          category: employee.category,
          employeeKind: employee.kind,
          idempotent: true,
        };
      }
      if (
        approving &&
        (!latestEmployee.exists ||
          !annualPaidLeaveEmployeeDataMatches(
            employee,
            latestEmployee.data() || {},
          ))
      ) {
        throw new HttpError(
          409,
          'Data pegawai berubah. Muat ulang sebelum menyetujui cuti.',
        );
      }
      const current = latestLeave.data() as AnnualPaidLeaveRequest | undefined;
      if (!current) throw new HttpError(404, 'Pengajuan cuti tahunan tidak ditemukan.');
      const balance = balanceSnapshot.data() || {};
      const reservedDays = Math.max(0, Number(balance.reservedDays || 0));
      const usedDays = Math.max(0, Number(balance.usedDays || 0));
      const hasStoredAttendanceConflict = approving && (
        officialLeaveSnapshot.data()?.status === 'approved' ||
        satpamAbsenceSnapshot.data()?.status === 'approved' ||
        correctionHeadSnapshot.data()?.present === true ||
        loyalisCorrectionsSnapshot.docs.some((document) =>
          isApprovedCorrection(document.data(), leaveDate),
        ) ||
        activityReportsSnapshot.docs.some((document) => {
          const report = document.data();
          return (
            matchingDate(report, leaveDate) &&
            report.status === 'approved' &&
            ['Harian', 'Jumat & Libur', 'Lembur Sendiri', 'Lembur Cover'].includes(
              String(report.shiftType || ''),
            )
          );
        })
      );
      const decisionIssue = annualPaidLeaveDecisionIssue({
        expectedRevision,
        currentRevision: Number(current.revision || 0),
        status: current.status,
        reservedDays,
        periodClosed: isPeriodClosed(periodSnapshot.data()),
        immutableSlip:
          slipSnapshot.exists && isImmutablePayrollStatus(slipSnapshot.data()?.status),
        payrollPostExists: postSnapshot.exists,
        approving,
        attendanceConflict: hasStoredAttendanceConflict,
      });
      if (decisionIssue) {
        throw new HttpError(409, decisionIssueMessage(decisionIssue));
      }

      if (approving && employee.kind === 'blue_collar' && calendar) {
        const materialization = buildPeriodMaterialization({
          period,
          periodData: periodSnapshot.data(),
          annualDates: Array.from(calendar.premiumDates),
          actorUid: actor.uid,
          reason: `Kalender periode dibekukan saat persetujuan cuti tahunan ${period}`,
        });
        if (materialization) {
          transaction.set(periodRef, materialization, { merge: true });
        }
      }

      let amount = 0;
      let loyalisPresenceAfter: Record<string, unknown> | null = null;
      if (approving) {
        if (employee.kind === 'loyalis' && loyalisPresenceSnapshot.exists) {
          const presence = loyalisPresenceSnapshot.data() || {};
          const entries = presence.entries && typeof presence.entries === 'object'
            ? { ...(presence.entries as Record<string, LoyalisPaidLeaveEntry>) }
            : {};
          const entry = entries[employee.id] || {
            employeeId: employee.id,
            employeeName: employee.name,
            minutes: 0,
            absenceMinutes:
              Number(presence.workingDays || 25) * Number(presence.expectedHours || 6.5) * 60,
            stratum: 5,
            deduction: 250_000,
            netBonus: 0,
            activeDaysCount: 0,
            incompleteDaysCount: 0,
            absentDaysCount: 0,
            dailyLogs: [],
          };
          if (loyalisHasPayableAttendance(entry, leaveDate)) {
            throw new HttpError(409, 'Presensi Loyalis berbayar sudah ada pada tanggal ini.');
          }
          entries[employee.id] = applyApprovedPaidLeaveToLoyalisEntry({
            entry,
            leaveDate,
            expectedHours: Number(presence.expectedHours || 6.5),
            workingDays: Number(presence.workingDays || 25),
            isOffDay: premium,
          });
          loyalisPresenceAfter = { ...presence, entries };
        }

        if (isRegularBlue) {
          if (!attendanceView || !employeeView || !calendar) {
            throw new HttpError(409, 'Data presensi Pekarya belum siap.');
          }
          if (String(importSnapshot.data()?.activeRevisionId || '') !== attendanceView.importRevisionId) {
            throw new HttpError(409, 'Revisi import presensi berubah. Muat ulang sebelum memutuskan.');
          }
          const currentCalendarRevision = Number(
            (periodSnapshot.data()?.workCalendar as { revision?: number } | undefined)?.revision || 1,
          );
          if (currentCalendarRevision !== calendar.revision) {
            throw new HttpError(409, 'Kalender kerja berubah. Muat ulang sebelum memutuskan.');
          }
          amount = pekaryaAttendanceAmount('07:30:00', '14:00:00', premium);
        } else if (isSatpam) {
          amount = SATPAM_RATES[payType];
        }
      }

      const revision = expectedRevision + 1;
      const now = admin.firestore.FieldValue.serverTimestamp();
      const after = {
        ...current,
        status: approving ? 'approved' : 'declined',
        qualifyingDate: employee.qualifyingDate,
        revision,
        decisionReason,
        decidedAt: now,
        decidedBy: actor.uid,
        decidedByName: actor.displayName,
        approvedPayType: approving ? payType : null,
        approvedAmount: approving ? amount : 0,
        updatedAt: now,
      };
      transaction.set(leaveRef, after);
      transaction.set(
        balanceRef,
        {
          ...balance,
          employeeId: employee.id,
          employeeKind: employee.kind,
          employeeCollection: employee.collection,
          year,
          entitlementDays: annualPaidLeaveBalanceEntitlementForYear(
            employee.serviceDate,
            year,
            jakartaToday(),
          ),
          reservedDays: reservedDays - 1,
          usedDays: usedDays + (approving ? 1 : 0),
          serviceDate: employee.serviceDate,
          qualifyingDate: employee.qualifyingDate,
          updatedAt: now,
          schemaVersion: 1,
        },
        { merge: true },
      );
      transaction.create(
        adminDb
          .collection(ANNUAL_PAID_LEAVE_REVISIONS_COLLECTION)
          .doc(`${annualPaidLeaveRequestId}__r${revision}`),
        {
          annualPaidLeaveRequestId,
          revision,
          action,
          before: current,
          after,
          actorUid: actor.uid,
          requestId: commandId,
          reason: decisionReason,
          createdAt: now,
        },
      );

      if (approving) {
        const payrollMode = employee.kind === 'loyalis'
          ? 'loyalis_presence_overlay'
          : isSatpam
            ? 'satpam_annual_leave'
            : 'pekarya_attendance_correction';
        transaction.create(postRef, {
          annualPaidLeaveRequestId,
          employeeId: employee.id,
          employeeName: employee.name,
          employeeKind: employee.kind,
          employeeCollection: employee.collection,
          category: employee.category,
          leaveDate,
          year,
          period,
          payType,
          amount,
          payrollMode,
          status: 'posted',
          postedAt: now,
          postedBy: actor.uid,
          sourceRevision: revision,
          schemaVersion: 1,
        });

        if (loyalisPresenceAfter) {
          transaction.set(loyalisPresenceRef, {
            ...loyalisPresenceAfter,
            updatedAt: now,
            annualPaidLeaveUpdatedAt: now,
            annualPaidLeaveUpdatedBy: actor.uid,
          });
        }

        if (isRegularBlue && attendanceView && employeeView) {
          const correction = annualPaidLeaveAttendanceCorrection();
          const record = {
            period,
            category: employee.category,
            employeeId: employee.id,
            employeeName: employee.name,
            nipy,
            date: leaveDate,
            revision: Number(correctionHeadSnapshot.data()?.revision || 0) + 1,
            supersedesCorrectionId: correctionHeadSnapshot.data()?.correctionId || null,
            rawValue: (currentDay as typeof currentDay & { rawValue?: unknown })?.rawValue || [],
            beforeEffectiveValue: currentDay
              ? {
                  workStatus: currentDay.workStatus,
                  scanIn: currentDay.scanIn,
                  scanOut: currentDay.scanOut,
                  present: currentDay.present,
                }
              : null,
            effectiveValue: correction,
            importRevisionId: attendanceView.importRevisionId,
            calendarRevision: attendanceView.calendarRevision,
            reason: `Cuti tahunan: ${String(current.reason || '')}\nKeputusan: ${decisionReason}`,
            actorUid: actor.uid,
            actorName: actor.displayName,
            sourceType: 'annual_paid_leave',
            sourceId: annualPaidLeaveRequestId,
            createdAt: now,
          };
          transaction.create(correctionRef, record);
          transaction.set(correctionHeadRef, {
            ...record,
            ...correction,
            correctionId: correctionRef.id,
            updatedAt: now,
          });

          if (
            publicationSnapshot.data()?.state === 'published' &&
            publicationSnapshot.data()?.stale !== true
          ) {
            if (!uraianSnapshot.exists) {
              throw new HttpError(409, 'Rekap Uraian publikasi tidak ditemukan. Publikasikan ulang kategori.');
            }
            let nextHarian = employeeView.harianCount;
            let nextPremium = employeeView.jumatLiburCount;
            let nextHarianAmount = employeeView.harianAmount;
            let nextPremiumAmount = employeeView.jumatLiburAmount;
            if (premium) {
              nextPremium += 1;
              nextPremiumAmount += amount;
            } else {
              nextHarian += 1;
              nextHarianAmount += amount;
            }
            const entries = {
              ...(uraianSnapshot.data()?.entries as Record<string, Record<string, unknown>>),
            };
            const existingEntry = entries[employee.id] || {};
            const existingValues = existingEntry.values && typeof existingEntry.values === 'object'
              ? (existingEntry.values as Record<string, unknown>)
              : {};
            const existingCounts = existingEntry.counts && typeof existingEntry.counts === 'object'
              ? (existingEntry.counts as Record<string, unknown>)
              : {};
            const nextPublicationRevision =
              Number(publicationSnapshot.data()?.publicationRevision || 0) + 1;
            entries[employee.id] = {
              ...existingEntry,
              employeeId: employee.id,
              name: employee.name,
              values: {
                ...existingValues,
                harian: nextHarianAmount,
                jumatLibur: nextPremiumAmount,
              },
              counts: {
                ...existingCounts,
                harian: nextHarian,
                jumatLibur: nextPremium,
              },
              attendanceSource: {
                importRevisionId: attendanceView.importRevisionId,
                calendarRevision: attendanceView.calendarRevision,
                publicationRevision: nextPublicationRevision,
              },
            };
            transaction.update(uraianRef, { entries, updatedAt: now });
            transaction.update(publicationRef, {
              publicationRevision: nextPublicationRevision,
              'totals.harian': Number(publicationSnapshot.data()?.totals?.harian || 0) + (premium ? 0 : 1),
              'totals.jumatLibur': Number(publicationSnapshot.data()?.totals?.jumatLibur || 0) + (premium ? 1 : 0),
              'totals.amount': Number(publicationSnapshot.data()?.totals?.amount || 0) + amount,
              correctedAt: now,
              correctedBy: actor.uid,
              stale: false,
              updatedAt: now,
            });
          }
        }
      }

      transaction.create(
        newFinancialAuditRef(),
        buildFinancialAuditRecord(actor, {
          action: approving ? 'ANNUAL_PAID_LEAVE_APPROVED' : 'ANNUAL_PAID_LEAVE_DECLINED',
          entityType: 'AnnualPaidLeaveRequest',
          entityId: annualPaidLeaveRequestId,
          requestId: commandId,
          reason: decisionReason,
          before: current,
          after,
          metadata: {
            employeeId: employee.id,
            employeeKind: employee.kind,
            category: employee.category,
            leaveDate,
            period,
            payType: approving ? payType : null,
            amount: approving ? amount : 0,
          },
        }),
      );
      transaction.create(idempotencyRef, {
        actorUid: actor.uid,
        requestId: commandId,
        requestHash,
        entityType: 'AnnualPaidLeaveRequest',
        entityId: annualPaidLeaveRequestId,
        revision,
        status: after.status,
        amount: approving ? amount : 0,
        createdAt: now,
      });
      return {
        id: annualPaidLeaveRequestId,
        revision,
        status: after.status,
        amount: approving ? amount : 0,
        period,
        category: employee.category,
        employeeKind: employee.kind,
        idempotent: false,
      };
    });

    let reconciliationWarning: string | null = null;
    if (approving && isSatpam && !result.idempotent) {
      try {
        await syncSatpamDutyReconciliation(period, actor.uid);
      } catch (error) {
        console.error('Annual paid leave Satpam reconciliation failed:', error);
        reconciliationWarning =
          'Cuti sudah disetujui, tetapi rekonsiliasi Satpam perlu dijalankan ulang.';
      }
    }
    return Response.json(
      { ...result, reconciliationWarning },
      { headers: { 'Cache-Control': 'no-store' } },
    );
  } catch (error) {
    return errorResponse(error);
  }
}
