import { createHash } from 'node:crypto';
import { NextRequest } from 'next/server';
import admin, { adminDb } from '@/lib/firebase-admin';
import {
  ATTENDANCE_PAYROLL_START_PERIOD,
  isPremiumAttendanceDate,
  normalizeAttendanceTime,
  PEKARYA_ATTENDANCE_RATES,
  resolveEmployeeAttendanceNipy,
} from '@/lib/payroll/attendance';
import { assertRequestId, isImmutablePayrollStatus } from '@/lib/payroll/domain';
import { pekaryaPayrollWindow } from '@/lib/payroll/pekaryaSpj';
import {
  isPekaryaOfficialLeaveCategory,
  isValidAttendanceScanRange,
} from '@/lib/payroll/pekaryaOfficialLeave';
import {
  attendanceCorrectionHeadId,
  ATTENDANCE_IMPORTS_COLLECTION,
  PEKARYA_CORRECTIONS_COLLECTION,
  PEKARYA_CORRECTION_HEADS_COLLECTION,
  PEKARYA_PUBLICATIONS_COLLECTION,
  pekaryaPublicationId,
} from '@/lib/server/attendanceStore';
import {
  buildPekaryaAttendanceView,
} from '@/lib/server/pekaryaAttendance';
import { buildFinancialAuditRecord, newFinancialAuditRef } from '@/lib/server/audit';
import {
  errorResponse,
  HttpError,
  requireAuthenticatedProfile,
  requireRole,
} from '@/lib/server/auth';
import { assertPeriodAcceptsInput } from '@/lib/server/payrollPeriod';

export const dynamic = 'force-dynamic';

function optionalTime(body: Record<string, unknown>, key: string) {
  if (!(key in body)) return undefined;
  if (body[key] === null || body[key] === '') return null;
  const value = normalizeAttendanceTime(body[key]);
  if (!value) throw new HttpError(400, `${key} wajib menggunakan format HH:mm:ss.`);
  return value;
}

export async function POST(request: NextRequest) {
  try {
    const actor = await requireAuthenticatedProfile(request);
    requireRole(actor, ['satker_head']);
    const body = (await request.json()) as Record<string, unknown>;
    const period = String(body.period || '');
    const category = String(body.category || '').trim().toUpperCase();
    const employeeId = String(body.employeeId || '');
    const date = String(body.date || '');
    const reason = String(body.reason || '').trim();
    const requestId = String(body.requestId || '');
    const expectedRevision = Number(body.expectedRevision || 0);
    try {
      assertRequestId(requestId);
    } catch (error) {
      throw new HttpError(
        400,
        error instanceof Error ? error.message : 'requestId tidak valid.',
      );
    }
    if (!/^\d{4}-\d{2}$/.test(period) || period < ATTENDANCE_PAYROLL_START_PERIOD) {
      throw new HttpError(400, 'Presensi Pekarya berlaku mulai periode 2026-08.');
    }
    const window = pekaryaPayrollWindow(period);
    if (
      !/^\d{4}-\d{2}-\d{2}$/.test(date) ||
      date < window.startsOn ||
      date > window.endsOn
    ) {
      throw new HttpError(400, 'Tanggal koreksi berada di luar periode payroll.');
    }
    if (
      !isPekaryaOfficialLeaveCategory(category) ||
      !actor.permittedCategories.includes(category)
    ) {
      throw new HttpError(403, 'Kategori koreksi tidak diizinkan.');
    }
    if (reason.length < 8 || reason.length > 500) {
      throw new HttpError(400, 'Alasan koreksi wajib diisi antara 8 dan 500 karakter.');
    }
    if (!Number.isSafeInteger(expectedRevision) || expectedRevision < 0) {
      throw new HttpError(400, 'Revisi koreksi tidak valid.');
    }
    const present =
      typeof body.present === 'boolean' ? body.present : undefined;
    const workStatus =
      typeof body.workStatus === 'string'
        ? body.workStatus.trim().toUpperCase()
        : undefined;
    const scanIn = optionalTime(body, 'scanIn');
    const scanOut = optionalTime(body, 'scanOut');
    if (
      present === undefined &&
      workStatus === undefined &&
      scanIn === undefined &&
      scanOut === undefined
    ) {
      throw new HttpError(400, 'Isi setidaknya satu nilai koreksi.');
    }

    const employeeRef = adminDb.collection('Employees_BlueCollar').doc(employeeId);
    const employeeSnapshot = await employeeRef.get();
    const employee = employeeSnapshot.data();
    if (
      !employeeSnapshot.exists ||
      employee?.employment?.jobCategory !== category ||
      employee?.employment?.status !== 'active' ||
      employee?.flags?.isActive === false ||
      employee?.flags?.isPayrollEligible === false
    ) {
      throw new HttpError(409, 'Pegawai aktif pada kategori ini tidak ditemukan.');
    }
    const nipy = resolveEmployeeAttendanceNipy(employee || {});
    if (!nipy) {
      throw new HttpError(409, 'NIPY pegawai wajib dilengkapi sebelum koreksi.');
    }
    const view = await buildPekaryaAttendanceView(period, category);
    const employeeView = view.employees.find(
      (candidate) => candidate.employeeId === employeeId,
    );
    if (!employeeView) {
      throw new HttpError(409, 'Pegawai tidak tersedia dalam presensi Pekarya periode ini.');
    }
    const rawDay =
      employeeView?.days.find((day) => day.date === date) || null;
    const headRef = adminDb
      .collection(PEKARYA_CORRECTION_HEADS_COLLECTION)
      .doc(attendanceCorrectionHeadId(period, employeeId, date));
    const correctionRef = adminDb
      .collection(PEKARYA_CORRECTIONS_COLLECTION)
      .doc();
    const idempotencyRef = adminDb
      .collection('FinancialIdempotencyKeys')
      .doc(`${actor.uid}__${requestId}`);
    const publicationRef = adminDb
      .collection(PEKARYA_PUBLICATIONS_COLLECTION)
      .doc(pekaryaPublicationId(period, category));
    const uraianRef = adminDb
      .collection('UraianGaji')
      .doc(`${period.replace('-', '_')}_${category}`);
    const slipRef = adminDb
      .collection('PayrollSlipStates')
      .doc(`${period.replace('-', '_')}_${employeeId}`);
    const importRef = adminDb
      .collection(ATTENDANCE_IMPORTS_COLLECTION)
      .doc(period);
    const requestHash = createHash('sha256')
      .update(
        JSON.stringify({
          period,
          category,
          employeeId,
          date,
          present,
          workStatus,
          scanIn,
          scanOut,
          expectedRevision,
          importRevisionId: view.importRevisionId,
          calendarRevision: view.calendarRevision,
        }),
      )
      .digest('hex');
    const result = await adminDb.runTransaction(async (transaction) => {
      const [
        periodSnapshot,
        headSnapshot,
        idempotencySnapshot,
        publicationSnapshot,
        uraianSnapshot,
        slipSnapshot,
        importSnapshot,
      ] =
        await Promise.all([
          transaction.get(adminDb.collection('PayrollPeriods').doc(period)),
          transaction.get(headRef),
          transaction.get(idempotencyRef),
          transaction.get(publicationRef),
          transaction.get(uraianRef),
          transaction.get(slipRef),
          transaction.get(importRef),
        ]);
      if (idempotencySnapshot.exists) {
        if (idempotencySnapshot.data()?.requestHash !== requestHash) {
          throw new HttpError(409, 'requestId sudah digunakan untuk koreksi lain.');
        }
        return {
          correctionId: String(idempotencySnapshot.data()?.correctionId || ''),
          revision: Number(idempotencySnapshot.data()?.revision || 0),
          wasPublished: Boolean(publicationSnapshot.data()?.state === 'published'),
          idempotent: true,
        };
      }
      assertPeriodAcceptsInput(periodSnapshot.data());
      if (
        slipSnapshot.exists &&
        isImmutablePayrollStatus(slipSnapshot.data()?.status)
      ) {
        throw new HttpError(
          409,
          'Slip pegawai sudah immutable; gunakan koreksi finansial.',
        );
      }
      if (
        String(importSnapshot.data()?.activeRevisionId || '') !==
        view.importRevisionId
      ) {
        throw new HttpError(
          409,
          'Revisi import presensi berubah. Muat ulang sebelum mengoreksi.',
        );
      }
      const currentCalendarRevision = Number(
        (periodSnapshot.data()?.workCalendar as { revision?: number } | undefined)
          ?.revision || 1,
      );
      if (currentCalendarRevision !== view.calendarRevision) {
        throw new HttpError(
          409,
          'Kalender kerja berubah. Muat ulang sebelum mengoreksi.',
        );
      }
      const currentRevision = Number(headSnapshot.data()?.revision || 0);
      if (currentRevision !== expectedRevision) {
        throw new HttpError(
          409,
          'Koreksi telah berubah. Muat ulang halaman agar data terbaru tidak tertimpa.',
        );
      }
      const revision = currentRevision + 1;
      const now = admin.firestore.FieldValue.serverTimestamp();
      const previousEffective =
        headSnapshot.data()?.effectiveValue &&
        typeof headSnapshot.data()?.effectiveValue === 'object'
          ? headSnapshot.data()!.effectiveValue
          : {};
      const effective: Record<string, unknown> = {
        ...previousEffective,
        ...(present !== undefined ? { present } : {}),
        ...(workStatus !== undefined ? { workStatus } : {}),
        ...(scanIn !== undefined ? { scanIn } : {}),
        ...(scanOut !== undefined ? { scanOut } : {}),
      };
      if (present === false) {
        effective.scanIn = null;
        effective.scanOut = null;
        if (workStatus === undefined) effective.workStatus = 'TIDAK MASUK';
      }
      const hasEffectiveScanIn =
        effective.scanIn !== null && effective.scanIn !== undefined;
      const hasEffectiveScanOut =
        effective.scanOut !== null && effective.scanOut !== undefined;
      const normalizedEffectiveScanIn = hasEffectiveScanIn
        ? normalizeAttendanceTime(effective.scanIn)
        : null;
      const normalizedEffectiveScanOut = hasEffectiveScanOut
        ? normalizeAttendanceTime(effective.scanOut)
        : null;
      if (
        (hasEffectiveScanIn && !normalizedEffectiveScanIn) ||
        (hasEffectiveScanOut && !normalizedEffectiveScanOut) ||
        (normalizedEffectiveScanIn &&
          normalizedEffectiveScanOut &&
          !isValidAttendanceScanRange(
            normalizedEffectiveScanIn,
            normalizedEffectiveScanOut,
          ))
      ) {
        throw new HttpError(
          400,
          'Scan pulang harus lebih lambat dari scan masuk.',
        );
      }
      if (hasEffectiveScanIn) effective.scanIn = normalizedEffectiveScanIn;
      if (hasEffectiveScanOut) effective.scanOut = normalizedEffectiveScanOut;
      const record = {
        period,
        category,
        employeeId,
        employeeName: String(employee.name || ''),
        nipy,
        date,
        revision,
        supersedesCorrectionId: headSnapshot.data()?.correctionId || null,
        rawValue: rawDay
          ? ((rawDay as typeof rawDay & { rawValue?: unknown }).rawValue || [])
          : [],
        beforeEffectiveValue: rawDay
          ? {
              workStatus: rawDay.workStatus,
              scanIn: rawDay.scanIn,
              scanOut: rawDay.scanOut,
              present: rawDay.present,
            }
          : null,
        effectiveValue: effective,
        importRevisionId: view.importRevisionId,
        calendarRevision: view.calendarRevision,
        reason,
        actorUid: actor.uid,
        actorName: actor.displayName,
        createdAt: now,
      };
      transaction.create(correctionRef, record);
      transaction.set(headRef, {
        ...record,
        ...effective,
        correctionId: correctionRef.id,
        updatedAt: now,
      });
      if (
        publicationSnapshot.data()?.state === 'published' &&
        publicationSnapshot.data()?.stale !== true
      ) {
        if (!uraianSnapshot.exists) {
          throw new HttpError(
            409,
            'Rekap Uraian publikasi tidak ditemukan. Publikasikan ulang kategori.',
          );
        }
        const oldPayType = rawDay?.present ? rawDay.payType : null;
        let nextHarian = employeeView?.harianCount || 0;
        let nextPremium = employeeView?.jumatLiburCount || 0;
        if (oldPayType === 'Harian') nextHarian = Math.max(0, nextHarian - 1);
        if (oldPayType === 'Jumat & Libur') {
          nextPremium = Math.max(0, nextPremium - 1);
        }
        const nextPresent =
          typeof effective.present === 'boolean'
            ? effective.present
            : Boolean(rawDay?.present);
        if (nextPresent) {
          if (
            isPremiumAttendanceDate(date, new Set(view.premiumDates))
          ) {
            nextPremium += 1;
          } else {
            nextHarian += 1;
          }
        }
        const entries = {
          ...(uraianSnapshot.data()?.entries as Record<
            string,
            Record<string, unknown>
          >),
        };
        const existingEntry = entries[employeeId] || {};
        const values: Record<string, unknown> = {
          ...((existingEntry.values as Record<string, unknown>) || {}),
          harian: nextHarian * PEKARYA_ATTENDANCE_RATES.Harian,
          jumatLibur:
            nextPremium * PEKARYA_ATTENDANCE_RATES['Jumat & Libur'],
        };
        delete values.presensi;
        const counts: Record<string, unknown> = {
          ...((existingEntry.counts as Record<string, unknown>) || {}),
          harian: nextHarian,
          jumatLibur: nextPremium,
        };
        const nextPublicationRevision =
          Number(publicationSnapshot.data()?.publicationRevision || 0) + 1;
        entries[employeeId] = {
          ...existingEntry,
          employeeId,
          name: String(employee.name || ''),
          values,
          counts,
          attendanceSource: {
            importRevisionId: view.importRevisionId,
            calendarRevision: view.calendarRevision,
            publicationRevision: nextPublicationRevision,
          },
        };
        const oldAmount = employeeView?.totalAmount || 0;
        const nextAmount =
          nextHarian * PEKARYA_ATTENDANCE_RATES.Harian +
          nextPremium * PEKARYA_ATTENDANCE_RATES['Jumat & Libur'];
        transaction.update(uraianRef, {
          entries,
          attendancePublication: {
            importRevisionId: view.importRevisionId,
            calendarRevision: view.calendarRevision,
            publicationRevision: nextPublicationRevision,
          },
          updatedAt: now,
        });
        transaction.update(publicationRef, {
          publicationRevision: nextPublicationRevision,
          'totals.harian':
            Number(publicationSnapshot.data()?.totals?.harian || 0) -
            (employeeView?.harianCount || 0) +
            nextHarian,
          'totals.jumatLibur':
            Number(publicationSnapshot.data()?.totals?.jumatLibur || 0) -
            (employeeView?.jumatLiburCount || 0) +
            nextPremium,
          'totals.amount':
            Number(publicationSnapshot.data()?.totals?.amount || 0) -
            oldAmount +
            nextAmount,
          correctedAt: now,
          correctedBy: actor.uid,
          stale: false,
          updatedAt: now,
        });
      }
      transaction.create(
        newFinancialAuditRef(),
        buildFinancialAuditRecord(actor, {
          action: 'PEKARYA_ATTENDANCE_CORRECTED',
          entityType: 'PekaryaAttendanceDay',
          entityId: `${period}:${employeeId}:${date}`,
          reason,
          requestId,
          before: rawDay,
          after: effective,
          metadata: {
            category,
            importRevisionId: view.importRevisionId,
            calendarRevision: view.calendarRevision,
            revision,
          },
        }),
      );
      transaction.create(idempotencyRef, {
        actorUid: actor.uid,
        requestId,
        requestHash,
        correctionId: correctionRef.id,
        revision,
        createdAt: now,
      });
      return {
        correctionId: correctionRef.id,
        revision,
        wasPublished: publicationSnapshot.data()?.state === 'published',
        idempotent: false,
      };
    });
    return Response.json(result);
  } catch (error) {
    return errorResponse(error);
  }
}
