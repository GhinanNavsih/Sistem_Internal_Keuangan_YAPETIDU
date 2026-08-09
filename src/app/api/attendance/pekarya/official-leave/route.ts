import { createHash } from 'node:crypto';
import { NextRequest } from 'next/server';
import admin, { adminDb } from '@/lib/firebase-admin';
import {
  ATTENDANCE_PAYROLL_START_PERIOD,
  normalizeAttendanceTime,
  resolveEmployeeAttendanceNipy,
} from '@/lib/payroll/attendance';
import {
  assertDateOnly,
  assertPekaryaActivityProofUrl,
  assertRequestId,
  type PhotoAuditMetadata,
} from '@/lib/payroll/domain';
import { pekaryaPayrollPeriodForDate, pekaryaPayrollWindow } from '@/lib/payroll/pekaryaSpj';
import {
  isPekaryaOfficialLeaveCategory,
  isValidAttendanceScanRange,
  PEKARYA_OFFICIAL_LEAVE_TYPE,
} from '@/lib/payroll/pekaryaOfficialLeave';
import {
  PEKARYA_OFFICIAL_LEAVE_REQUESTS_COLLECTION,
  PEKARYA_OFFICIAL_LEAVE_REVISIONS_COLLECTION,
  officialLeaveRequestId,
} from '@/lib/server/pekaryaOfficialLeave';
import { buildFinancialAuditRecord, newFinancialAuditRef } from '@/lib/server/audit';
import {
  errorResponse,
  HttpError,
  requireAuthenticatedProfile,
  requireRole,
} from '@/lib/server/auth';
import { assertPeriodAcceptsInput } from '@/lib/server/payrollPeriod';

export const dynamic = 'force-dynamic';

function validAttendancePeriod(period: string): boolean {
  return /^\d{4}-\d{2}$/.test(period) && period >= ATTENDANCE_PAYROLL_START_PERIOD;
}

function activeEmployee(data: FirebaseFirestore.DocumentData | undefined): boolean {
  return (
    data?.employment?.status === 'active' &&
    data?.flags?.isActive !== false &&
    data?.flags?.isPayrollEligible !== false
  );
}

function employeeCategory(data: FirebaseFirestore.DocumentData | undefined): string {
  return String(data?.employment?.jobCategory || '').trim().toUpperCase();
}

function stableHash(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

function parsePhotoAuditMetadata(value: unknown): PhotoAuditMetadata {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new HttpError(400, 'Metadata audit foto tidak valid.');
  }
  const item = value as Record<string, unknown>;
  const stringOrNull = (key: string, max: number): string | null => {
    const field = item[key];
    if (field === null) return null;
    if (typeof field !== 'string' || field.trim().length > max) {
      throw new HttpError(400, `Metadata ${key} tidak valid.`);
    }
    return field.trim() || null;
  };
  const numberOrNull = (key: string, min: number, max: number): number | null => {
    const field = item[key];
    if (field === null) return null;
    if (
      typeof field !== 'number' ||
      !Number.isFinite(field) ||
      field < min ||
      field > max
    ) {
      throw new HttpError(400, `Metadata ${key} tidak valid.`);
    }
    return field;
  };
  if (typeof item.hasExif !== 'boolean') {
    throw new HttpError(400, 'Metadata hasExif tidak valid.');
  }
  const latitude = numberOrNull('latitude', -90, 90);
  const longitude = numberOrNull('longitude', -180, 180);
  if ((latitude === null) !== (longitude === null)) {
    throw new HttpError(400, 'Koordinat foto harus lengkap.');
  }
  return {
    capturedAt: stringOrNull('capturedAt', 64),
    latitude,
    longitude,
    deviceName: stringOrNull('deviceName', 200),
    hasExif: item.hasExif,
    locationName: stringOrNull('locationName', 200),
    locationAddress: stringOrNull('locationAddress', 500),
    locationPlaceId: stringOrNull('locationPlaceId', 200),
  };
}

async function loadLinkedPekarya(actor: Awaited<ReturnType<typeof requireAuthenticatedProfile>>) {
  if (!actor.linkedEmployeeId) {
    throw new HttpError(409, 'Akun belum terhubung ke data Pekarya.');
  }
  const employeeSnapshot = await adminDb
    .collection('Employees_BlueCollar')
    .doc(actor.linkedEmployeeId)
    .get();
  const employee = employeeSnapshot.data();
  const category = employeeCategory(employee);
  if (
    !employeeSnapshot.exists ||
    !activeEmployee(employee) ||
    !isPekaryaOfficialLeaveCategory(category)
  ) {
    throw new HttpError(
      409,
      'Akun ini tidak terhubung ke pegawai Pekarya non-Satpam yang aktif.',
    );
  }
  if (
    actor.permittedCategories.length > 0 &&
    !actor.permittedCategories.includes(category)
  ) {
    throw new HttpError(403, 'Akun ini tidak memiliki akses ke kategori pegawainya.');
  }
  return { employeeSnapshot, employee, category, employeeId: actor.linkedEmployeeId };
}

function validatePeriodAndDate(period: string, date: string): void {
  if (!validAttendancePeriod(period)) {
    throw new HttpError(
      400,
      'Pengajuan presensi Pekarya berlaku mulai periode payroll 2026-08.',
    );
  }
  try {
    assertDateOnly(date);
  } catch (error) {
    throw new HttpError(
      400,
      error instanceof Error ? error.message : 'Tanggal presensi tidak valid.',
    );
  }
  const window = pekaryaPayrollWindow(period);
  if (
    date < window.startsOn ||
    date > window.endsOn ||
    pekaryaPayrollPeriodForDate(date) !== period
  ) {
    throw new HttpError(400, 'Tanggal presensi berada di luar periode payroll.');
  }
}

export async function GET(request: NextRequest) {
  try {
    const actor = await requireAuthenticatedProfile(request);
    const period = request.nextUrl.searchParams.get('period')?.trim() || '';
    const requestedCategory =
      request.nextUrl.searchParams.get('category')?.trim().toUpperCase() || '';
    if (!validAttendancePeriod(period)) {
      throw new HttpError(400, 'Periode wajib menggunakan format YYYY-MM mulai 2026-08.');
    }

    let employeeId = '';
    let category = requestedCategory;
    const isEmployee = actor.role === 'honorer';
    if (isEmployee) {
      const linked = await loadLinkedPekarya(actor);
      employeeId = linked.employeeId;
      category = linked.category;
    } else {
      requireRole(actor, ['super_admin', 'finance_verifier', 'satker_head']);
      if (category && !isPekaryaOfficialLeaveCategory(category)) {
        throw new HttpError(400, 'Kategori Pekarya tidak valid untuk pengajuan presensi.');
      }
      if (
        actor.role === 'satker_head' &&
        (category
          ? !actor.permittedCategories.includes(category)
          : actor.permittedCategories.filter(isPekaryaOfficialLeaveCategory).length === 0)
      ) {
        throw new HttpError(403, 'Anda tidak memiliki akses ke kategori Pekarya ini.');
      }
    }

    const snapshot = await adminDb
      .collection(PEKARYA_OFFICIAL_LEAVE_REQUESTS_COLLECTION)
      .where('period', '==', period)
      .get();
    const requests = snapshot.docs
      .map((document): { id: string; [key: string]: unknown } => ({
        id: document.id,
        ...(document.data() as Record<string, unknown>),
      }))
      .filter((item) =>
        (!employeeId || String(item.employeeId || '') === employeeId) &&
        (!category || String(item.category || '') === category) &&
        (actor.role !== 'satker_head' ||
          actor.permittedCategories.includes(String(item.category || ''))),
      )
      .sort((left, right) =>
        String(right.date || '').localeCompare(String(left.date || '')),
      );
    return Response.json(
      { period, category, requests },
      { headers: { 'Cache-Control': 'no-store' } },
    );
  } catch (error) {
    return errorResponse(error);
  }
}

export async function POST(request: NextRequest) {
  try {
    const actor = await requireAuthenticatedProfile(request);
    requireRole(actor, ['honorer']);
    const linked = await loadLinkedPekarya(actor);
    const body = (await request.json()) as Record<string, unknown>;
    const action = String(body.action || 'submit');
    const period = String(body.period || '');
    const date = String(body.date || '');
    const requestId = String(body.requestId || '');
    const expectedRevision = Number(body.expectedRevision || 0);
    const rawReportType = body.reportType;
    const reportType =
      rawReportType === undefined ? 'izin_resmi' : String(rawReportType);
    validatePeriodAndDate(period, date);
    try {
      assertRequestId(requestId);
    } catch (error) {
      throw new HttpError(
        400,
        error instanceof Error ? error.message : 'requestId tidak valid.',
      );
    }
    if (!Number.isSafeInteger(expectedRevision) || expectedRevision < 0) {
      throw new HttpError(400, 'Revisi pengajuan tidak valid.');
    }
    if (action !== 'submit' && action !== 'withdraw') {
      throw new HttpError(400, 'Aksi pengajuan presensi tidak valid.');
    }
    if (reportType !== 'scan' && reportType !== 'izin_resmi') {
      throw new HttpError(400, 'Jenis pengajuan presensi tidak valid.');
    }

    let reason = '';
    let evidenceUrl: string | null = null;
    let evidenceAuditMetadata: PhotoAuditMetadata | null = null;
    let scanIn: string | null = null;
    let scanOut: string | null = null;
    if (action === 'submit') {
      reason = String(body.reason || '').trim();
      if (reason.length < 8 || reason.length > 500) {
        throw new HttpError(400, 'Alasan pengajuan wajib diisi antara 8 dan 500 karakter.');
      }
      if (reportType === 'scan') {
        scanIn = normalizeAttendanceTime(body.scanIn);
        scanOut = normalizeAttendanceTime(body.scanOut);
        if (!scanIn || !scanOut) {
          throw new HttpError(
            400,
            'Scan masuk dan scan pulang wajib diisi dengan format jam yang valid.',
          );
        }
        if (!isValidAttendanceScanRange(scanIn, scanOut)) {
          throw new HttpError(
            400,
            'Scan pulang harus lebih lambat dari scan masuk.',
          );
        }
      }
      if (body.evidenceUrl) {
        if (typeof body.evidenceUrl !== 'string') {
          throw new HttpError(400, 'URL bukti izin tidak valid.');
        }
        try {
          assertPekaryaActivityProofUrl(body.evidenceUrl, linked.employeeId);
        } catch (error) {
          throw new HttpError(
            400,
            error instanceof Error ? error.message : 'URL bukti izin tidak valid.',
          );
        }
        evidenceUrl = body.evidenceUrl;
        if (body.evidenceAuditMetadata !== undefined && body.evidenceAuditMetadata !== null) {
          evidenceAuditMetadata = parsePhotoAuditMetadata(body.evidenceAuditMetadata);
        }
      }
    }

    const requestDocumentId = officialLeaveRequestId(linked.employeeId, date);
    const requestRef = adminDb
      .collection(PEKARYA_OFFICIAL_LEAVE_REQUESTS_COLLECTION)
      .doc(requestDocumentId);
    const idempotencyRef = adminDb
      .collection('FinancialIdempotencyKeys')
      .doc(`${actor.uid}__${requestId}`);
    const requestHash = stableHash({
      action,
      employeeId: linked.employeeId,
      period,
      date,
      reportType,
      scanIn,
      scanOut,
      reason,
      evidenceUrl,
      evidenceAuditMetadata,
      expectedRevision,
    });
    const result = await adminDb.runTransaction(async (transaction) => {
      const [beforeSnapshot, idempotencySnapshot, periodSnapshot] = await Promise.all([
        transaction.get(requestRef),
        transaction.get(idempotencyRef),
        transaction.get(adminDb.collection('PayrollPeriods').doc(period)),
      ]);
      if (idempotencySnapshot.exists) {
        if (idempotencySnapshot.data()?.requestHash !== requestHash) {
          throw new HttpError(409, 'requestId sudah digunakan untuk pengajuan lain.');
        }
        return {
          id: requestDocumentId,
          revision: Number(idempotencySnapshot.data()?.revision || expectedRevision),
          status: idempotencySnapshot.data()?.status,
          idempotent: true,
        };
      }
      assertPeriodAcceptsInput(
        periodSnapshot.data(),
        'Periode payroll sudah ditutup; pengajuan izin tidak dapat diubah.',
      );
      const before = beforeSnapshot.exists ? beforeSnapshot.data()! : null;
      const currentRevision = Number(before?.revision || 0);
      if (currentRevision !== expectedRevision) {
        throw new HttpError(409, 'Pengajuan telah berubah. Muat ulang lalu coba lagi.');
      }
      if (action === 'withdraw' && (!before || before.status !== 'pending')) {
        throw new HttpError(409, 'Hanya pengajuan yang masih menunggu yang dapat ditarik.');
      }
      if (
        action === 'submit' &&
        before &&
        !['declined', 'withdrawn'].includes(String(before.status || ''))
      ) {
        throw new HttpError(409, 'Pengajuan tanggal ini masih aktif atau sudah disetujui.');
      }
      const revision = currentRevision + 1;
      const now = admin.firestore.FieldValue.serverTimestamp();
      const after =
        action === 'withdraw'
          ? {
              ...before,
              status: 'withdrawn',
              revision,
              withdrawnAt: now,
              withdrawnBy: actor.uid,
              updatedAt: now,
            }
          : {
              employeeId: linked.employeeId,
              employeeName: String(linked.employee?.name || actor.displayName),
              employeeNipy: resolveEmployeeAttendanceNipy(linked.employee || {}),
              category: linked.category,
              period,
              date,
              reportType,
              leaveType:
                reportType === 'izin_resmi' ? PEKARYA_OFFICIAL_LEAVE_TYPE : null,
              scanIn,
              scanOut,
              reason,
              evidenceUrl,
              evidenceAuditMetadata,
              status: 'pending',
              revision,
              submittedAt: now,
              submittedBy: actor.uid,
              updatedAt: now,
              schemaVersion: 1,
            };
      transaction.set(requestRef, after);
      transaction.create(
        adminDb
          .collection(PEKARYA_OFFICIAL_LEAVE_REVISIONS_COLLECTION)
          .doc(`${requestDocumentId}__r${revision}`),
        {
          officialLeaveRequestId: requestDocumentId,
          revision,
          action,
          before,
          after,
          actorUid: actor.uid,
          requestId,
          createdAt: now,
        },
      );
      transaction.create(
        newFinancialAuditRef(),
        buildFinancialAuditRecord(actor, {
          action:
            action === 'withdraw'
              ? `PEKARYA_${reportType === 'scan' ? 'ATTENDANCE' : 'OFFICIAL_LEAVE'}_WITHDRAWN`
              : `PEKARYA_${reportType === 'scan' ? 'ATTENDANCE' : 'OFFICIAL_LEAVE'}_SUBMITTED`,
          entityType:
            reportType === 'scan'
              ? 'PekaryaAttendanceRequest'
              : 'PekaryaOfficialLeaveRequest',
          entityId: requestDocumentId,
          requestId,
          reason:
            reason ||
            `Pengajuan ${reportType === 'scan' ? 'presensi' : 'izin resmi'} ditarik oleh pegawai.`,
          before,
          after,
          metadata: { category: linked.category, date },
        }),
      );
      transaction.create(idempotencyRef, {
        actorUid: actor.uid,
        requestId,
        requestHash,
        entityType:
          reportType === 'scan'
            ? 'PekaryaAttendanceRequest'
            : 'PekaryaOfficialLeaveRequest',
        entityId: requestDocumentId,
        revision,
        status: after.status,
        createdAt: now,
      });
      return {
        id: requestDocumentId,
        revision,
        status: after.status,
        idempotent: false,
      };
    });
    return Response.json(result, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    return errorResponse(error);
  }
}
