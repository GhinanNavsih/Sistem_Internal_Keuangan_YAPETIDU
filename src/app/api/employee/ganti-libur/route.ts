import { createHash } from 'node:crypto';
import { NextRequest } from 'next/server';
import admin, { adminDb } from '@/lib/firebase-admin';
import { isDateOnly } from '@/lib/payroll/annualPaidLeave';
import { assertRequestId, isImmutablePayrollStatus } from '@/lib/payroll/domain';
import {
  GANTI_LIBUR_MAX_DAYS_PER_WEEK,
  GANTI_LIBUR_REQUIRED_SCAN_IN,
  GANTI_LIBUR_REQUIRED_SCAN_OUT,
  gantiLiburSubmitIssue,
  gantiLiburSubmitIssueMessage,
  gantiLiburWeekStart,
  isActiveGantiLiburStatus,
} from '@/lib/payroll/gantiLibur';
import { parseGantiLiburAttachmentPaths } from '@/lib/payroll/gantiLiburAttachments';
import { buildFinancialAuditRecord, newFinancialAuditRef } from '@/lib/server/audit';
import {
  ANNUAL_PAID_LEAVE_REQUESTS_COLLECTION,
  annualPaidLeaveDocumentId,
} from '@/lib/server/annualPaidLeave';
import {
  errorResponse,
  HttpError,
  requireAuthenticatedProfile,
} from '@/lib/server/auth';
import {
  GANTI_LIBUR_REQUESTS_COLLECTION,
  GANTI_LIBUR_REVISIONS_COLLECTION,
  employeeGantiLiburQuery,
  gantiLiburDocumentId,
  gantiLiburEmployeeFromData,
  gantiLiburRequestFromData,
  loadEmployeeGantiLiburRequests,
  loadGantiLiburAttachments,
  loadLoyalisOffDayChecker,
  loadLoyalisOffDayDates,
  requireSelfGantiLiburEmployee,
} from '@/lib/server/gantiLibur';
import {
  assertPeriodAcceptsInput,
  jakartaToday,
  shiftPeriod,
} from '@/lib/server/payrollPeriod';

export const dynamic = 'force-dynamic';

/** Months whose Jumat and Tanggal Merah the form can mark without a round trip. */
const OFF_DAY_MONTHS_BEFORE = 3;
const OFF_DAY_MONTHS_AFTER = 3;

function stableHash(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

function parseReason(value: unknown): string {
  if (value === undefined || value === null) return '';
  if (typeof value !== 'string' || value.trim().length > 500) {
    throw new HttpError(400, 'Alasan maksimal 500 karakter.');
  }
  return value.trim();
}

function parseDate(value: unknown, label: string): string {
  const date = String(value || '');
  if (!isDateOnly(date)) {
    throw new HttpError(400, `${label} wajib menggunakan format YYYY-MM-DD yang valid.`);
  }
  return date;
}

function parseExpectedRevision(value: unknown): number {
  const revision = Number(value ?? 0);
  if (!Number.isInteger(revision) || revision < 0) {
    throw new HttpError(400, 'Revisi pengajuan tidak valid.');
  }
  return revision;
}

export async function GET(request: NextRequest) {
  try {
    const actor = await requireAuthenticatedProfile(request);
    const employee = await requireSelfGantiLiburEmployee(actor);
    const today = jakartaToday();
    const currentMonth = today.slice(0, 7);
    const offDayMonths = Array.from(
      { length: OFF_DAY_MONTHS_BEFORE + OFF_DAY_MONTHS_AFTER + 1 },
      (_, index) => shiftPeriod(currentMonth, index - OFF_DAY_MONTHS_BEFORE),
    );
    const [requests, offDayDates] = await Promise.all([
      loadEmployeeGantiLiburRequests(employee.id),
      loadLoyalisOffDayDates(offDayMonths),
    ]);
    return Response.json(
      {
        employee,
        today,
        policy: {
          maxDaysPerWeek: GANTI_LIBUR_MAX_DAYS_PER_WEEK,
          requiredScanIn: GANTI_LIBUR_REQUIRED_SCAN_IN,
          requiredScanOut: GANTI_LIBUR_REQUIRED_SCAN_OUT,
        },
        offDayMonths,
        offDayDates: Array.from(offDayDates)
          .filter((date) => offDayMonths.includes(date.slice(0, 7)))
          .sort(),
        requests,
      },
      { headers: { 'Cache-Control': 'no-store' } },
    );
  } catch (error) {
    return errorResponse(error);
  }
}

export async function POST(request: NextRequest) {
  try {
    const actor = await requireAuthenticatedProfile(request);
    const employee = await requireSelfGantiLiburEmployee(actor);
    const body = (await request.json()) as Record<string, unknown>;
    const action = String(body.action || '');
    const commandId = String(body.requestId || '');
    try {
      assertRequestId(commandId);
    } catch (error) {
      throw new HttpError(
        400,
        error instanceof Error ? error.message : 'requestId tidak valid.',
      );
    }
    if (action !== 'submit' && action !== 'withdraw') {
      throw new HttpError(400, 'Aksi pengajuan ganti libur tidak valid.');
    }
    const workedDate = parseDate(body.workedDate, 'Tanggal masuk di hari libur');
    const expectedRevision = parseExpectedRevision(body.expectedRevision);
    const requestDocumentId = gantiLiburDocumentId(employee.id, workedDate);
    const requestRef = adminDb
      .collection(GANTI_LIBUR_REQUESTS_COLLECTION)
      .doc(requestDocumentId);
    const idempotencyRef = adminDb
      .collection('FinancialIdempotencyKeys')
      .doc(`${actor.uid}__${commandId}`);
    const now = admin.firestore.FieldValue.serverTimestamp();

    if (action === 'withdraw') {
      const requestHash = stableHash({
        action,
        employeeId: employee.id,
        workedDate,
        expectedRevision,
        commandId,
      });
      const result = await adminDb.runTransaction(async (transaction) => {
        const [requestSnapshot, idempotencySnapshot] = await Promise.all([
          transaction.get(requestRef),
          transaction.get(idempotencyRef),
        ]);
        if (idempotencySnapshot.exists) {
          if (idempotencySnapshot.data()?.requestHash !== requestHash) {
            throw new HttpError(409, 'requestId sudah digunakan untuk tindakan lain.');
          }
          return { id: requestDocumentId, status: 'withdrawn', idempotent: true };
        }
        const current = requestSnapshot.data();
        if (!current) throw new HttpError(404, 'Pengajuan ganti libur tidak ditemukan.');
        if (current.employeeId !== employee.id) {
          throw new HttpError(403, 'Pengajuan ganti libur bukan milik akun ini.');
        }
        if (Number(current.revision || 0) !== expectedRevision) {
          throw new HttpError(409, 'Pengajuan telah berubah. Muat ulang sebelum melanjutkan.');
        }
        if (current.status !== 'pending') {
          throw new HttpError(409, 'Hanya pengajuan yang menunggu yang dapat ditarik.');
        }
        const revision = expectedRevision + 1;
        const after = {
          ...current,
          status: 'withdrawn',
          revision,
          withdrawnAt: now,
          withdrawnBy: actor.uid,
          updatedAt: now,
        };
        transaction.set(requestRef, after);
        transaction.create(
          adminDb
            .collection(GANTI_LIBUR_REVISIONS_COLLECTION)
            .doc(`${requestDocumentId}__r${revision}`),
          {
            gantiLiburRequestId: requestDocumentId,
            revision,
            action,
            before: current,
            after,
            actorUid: actor.uid,
            requestId: commandId,
            reason: '',
            createdAt: now,
          },
        );
        transaction.create(
          newFinancialAuditRef(),
          buildFinancialAuditRecord(actor, {
            action: 'GANTI_LIBUR_WITHDRAWN',
            entityType: 'GantiLiburRequest',
            entityId: requestDocumentId,
            requestId: commandId,
            reason: '',
            before: current,
            after,
            metadata: {
              employeeId: employee.id,
              workedDate,
              dayOffDate: current.dayOffDate,
            },
          }),
        );
        transaction.create(idempotencyRef, {
          actorUid: actor.uid,
          requestId: commandId,
          requestHash,
          entityType: 'GantiLiburRequest',
          entityId: requestDocumentId,
          status: 'withdrawn',
          revision,
          createdAt: now,
        });
        return { id: requestDocumentId, status: 'withdrawn', idempotent: false };
      });
      return Response.json(result, { headers: { 'Cache-Control': 'no-store' } });
    }

    const dayOffDate = parseDate(body.dayOffDate, 'Tanggal ganti libur');
    const reason = parseReason(body.reason);
    const attachmentPaths = parseGantiLiburAttachmentPaths(body.attachmentPaths, employee.id);
    if (!attachmentPaths.ok) throw new HttpError(400, attachmentPaths.message);
    const attachments = await loadGantiLiburAttachments(attachmentPaths.paths);
    const workedPeriod = workedDate.slice(0, 7);
    const dayOffPeriod = dayOffDate.slice(0, 7);
    const isOffDay = await loadLoyalisOffDayChecker([workedDate, dayOffDate]);
    const periodRef = adminDb.collection('PayrollPeriods').doc(dayOffPeriod);
    const slipRef = adminDb
      .collection('PayrollSlipStates')
      .doc(`${dayOffPeriod.replace('-', '_')}_${employee.id}`);
    const employeeRef = adminDb.collection('Employees_Loyalis').doc(employee.id);
    const annualLeaveRef = adminDb
      .collection(ANNUAL_PAID_LEAVE_REQUESTS_COLLECTION)
      .doc(annualPaidLeaveDocumentId(employee.id, dayOffDate));
    const requestHash = stableHash({
      action,
      employeeId: employee.id,
      workedDate,
      dayOffDate,
      expectedRevision,
      reason,
      attachmentPaths: attachmentPaths.paths,
      commandId,
    });

    const result = await adminDb.runTransaction(async (transaction) => {
      const [
        requestSnapshot,
        employeeRequestsSnapshot,
        periodSnapshot,
        slipSnapshot,
        employeeSnapshot,
        annualLeaveSnapshot,
        idempotencySnapshot,
      ] = await Promise.all([
        transaction.get(requestRef),
        transaction.get(employeeGantiLiburQuery(employee.id)),
        transaction.get(periodRef),
        transaction.get(slipRef),
        transaction.get(employeeRef),
        transaction.get(annualLeaveRef),
        transaction.get(idempotencyRef),
      ]);

      if (idempotencySnapshot.exists) {
        if (idempotencySnapshot.data()?.requestHash !== requestHash) {
          throw new HttpError(409, 'requestId sudah digunakan untuk tindakan lain.');
        }
        return {
          id: requestDocumentId,
          status: idempotencySnapshot.data()?.status,
          revision: Number(idempotencySnapshot.data()?.revision || expectedRevision),
          idempotent: true,
        };
      }

      const current = requestSnapshot.data();
      const currentRevision = Number(current?.revision || 0);
      if (currentRevision !== expectedRevision) {
        throw new HttpError(409, 'Pengajuan telah berubah. Muat ulang sebelum melanjutkan.');
      }
      if (!gantiLiburEmployeeFromData(employee.id, employeeSnapshot.data())) {
        throw new HttpError(409, 'Data pegawai berubah. Muat ulang sebelum mengajukan.');
      }
      assertPeriodAcceptsInput(
        periodSnapshot.data(),
        'Periode payroll tanggal ganti libur sudah ditutup; pengajuan tidak dapat dibuat.',
      );
      if (slipSnapshot.exists && isImmutablePayrollStatus(slipSnapshot.data()?.status)) {
        throw new HttpError(
          409,
          'Slip bulan tanggal ganti libur sudah final; pengajuan tidak dapat dibuat.',
        );
      }
      const issue = gantiLiburSubmitIssue({
        requestId: requestDocumentId,
        workedDate,
        dayOffDate,
        isOffDay,
        currentStatus: current?.status,
        requests: employeeRequestsSnapshot.docs.map((document) =>
          gantiLiburRequestFromData(document.id, document.data()),
        ),
      });
      if (issue) throw new HttpError(409, gantiLiburSubmitIssueMessage(issue));
      if (isActiveGantiLiburStatus(annualLeaveSnapshot.data()?.status)) {
        throw new HttpError(
          409,
          'Tanggal ganti libur ini sudah diajukan sebagai cuti tahunan.',
        );
      }

      const revision = currentRevision + 1;
      const after = {
        id: requestDocumentId,
        employeeId: employee.id,
        employeeName: employee.name,
        employeeCollection: 'Employees_Loyalis',
        workedDate,
        workedPeriod,
        dayOffDate,
        dayOffPeriod,
        dayOffWeekStart: gantiLiburWeekStart(dayOffDate),
        reason,
        attachments,
        status: 'pending',
        revision,
        submittedBy: actor.uid,
        submittedByName: actor.displayName,
        submittedAt: now,
        decisionReason: null,
        decidedAt: null,
        decidedBy: null,
        attendanceCheck: null,
        updatedAt: now,
        schemaVersion: 1,
      };
      transaction.set(requestRef, after);
      transaction.create(
        adminDb
          .collection(GANTI_LIBUR_REVISIONS_COLLECTION)
          .doc(`${requestDocumentId}__r${revision}`),
        {
          gantiLiburRequestId: requestDocumentId,
          revision,
          action,
          before: current || null,
          after,
          actorUid: actor.uid,
          requestId: commandId,
          reason,
          createdAt: now,
        },
      );
      transaction.create(
        newFinancialAuditRef(),
        buildFinancialAuditRecord(actor, {
          action: 'GANTI_LIBUR_SUBMITTED',
          entityType: 'GantiLiburRequest',
          entityId: requestDocumentId,
          requestId: commandId,
          reason,
          before: current || null,
          after,
          metadata: { employeeId: employee.id, workedDate, dayOffDate },
        }),
      );
      transaction.create(idempotencyRef, {
        actorUid: actor.uid,
        requestId: commandId,
        requestHash,
        entityType: 'GantiLiburRequest',
        entityId: requestDocumentId,
        status: 'pending',
        revision,
        createdAt: now,
      });
      return { id: requestDocumentId, status: 'pending', revision, idempotent: false };
    });

    return Response.json(result, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    return errorResponse(error);
  }
}
