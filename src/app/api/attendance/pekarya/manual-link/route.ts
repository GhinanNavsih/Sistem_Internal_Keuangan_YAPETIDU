import { createHash } from 'node:crypto';
import { NextRequest } from 'next/server';
import admin, { adminDb } from '@/lib/firebase-admin';
import {
  ATTENDANCE_PAYROLL_START_PERIOD,
  resolveEmployeeAttendanceNipy,
} from '@/lib/payroll/attendance';
import { assertRequestId } from '@/lib/payroll/domain';
import {
  attendanceJoinNipy,
  ATTENDANCE_MANUAL_LINKS_COLLECTION,
  attendanceManualLinkId,
  PEKARYA_PUBLICATIONS_COLLECTION,
  pekaryaPublicationId,
} from '@/lib/server/attendanceStore';
import { loadDepartmentUnmatchedRows } from '@/lib/server/pekaryaAttendance';
import { buildFinancialAuditRecord, newFinancialAuditRef } from '@/lib/server/audit';
import {
  errorResponse,
  HttpError,
  requireAuthenticatedProfile,
  requireRole,
} from '@/lib/server/auth';
import { assertPeriodAcceptsInput } from '@/lib/server/payrollPeriod';

export const dynamic = 'force-dynamic';

function assertPeriod(period: string) {
  if (
    !/^\d{4}-\d{2}$/.test(period) ||
    period < ATTENDANCE_PAYROLL_START_PERIOD
  ) {
    throw new HttpError(400, 'Presensi Pekarya berlaku mulai periode 2026-08.');
  }
}

/**
 * Resolves the blue-collar employee a link may point at, enforcing that the
 * actor is allowed to act on that employee's category. A null category list
 * means the actor is unrestricted.
 */
async function resolveLinkTarget(
  employeeId: string,
  permittedCategories: readonly string[] | null,
) {
  if (!employeeId) {
    throw new HttpError(400, 'employeeId wajib diisi.');
  }
  const snapshot = await adminDb
    .collection('Employees_BlueCollar')
    .doc(employeeId)
    .get();
  const employee = snapshot.data();
  if (
    !snapshot.exists ||
    employee?.employment?.status !== 'active' ||
    employee?.flags?.isActive === false ||
    employee?.flags?.isPayrollEligible === false
  ) {
    throw new HttpError(409, 'Pegawai blue collar aktif tidak ditemukan.');
  }
  const category = String(employee?.employment?.jobCategory || '')
    .trim()
    .toUpperCase();
  if (!category) {
    throw new HttpError(409, 'Kategori pegawai belum diisi pada data master.');
  }
  if (permittedCategories && !permittedCategories.includes(category)) {
    throw new HttpError(403, 'Kategori pegawai ini tidak diizinkan untuk Anda.');
  }
  // A real NIPY is preferred, but its absence no longer blocks the link: the
  // row joins on a synthetic per-employee token instead (attendanceJoinNipy),
  // so the reviewer isn't stuck waiting on a separate NIPY-assignment process
  // just to see attendance they can already identify by name. Publishing that
  // employee's pay still requires a real NIPY — see publishBlocked in
  // buildPekaryaAttendanceView, which this link does not bypass.
  const nipy = resolveEmployeeAttendanceNipy(employee || {});
  return {
    category,
    nipy,
    joinNipy: attendanceJoinNipy({ employeeId, nipy }),
    name: String(employee?.name || ''),
  };
}

export async function POST(request: NextRequest) {
  try {
    const actor = await requireAuthenticatedProfile(request);
    requireRole(actor, ['super_admin', 'satker_head']);
    const body = (await request.json()) as Record<string, unknown>;
    const period = String(body.period || '');
    const sourceKey = String(body.sourceKey || '').trim();
    const employeeId = String(body.employeeId || '').trim();
    const requestId = String(body.requestId || '');
    try {
      assertRequestId(requestId);
    } catch (error) {
      throw new HttpError(
        400,
        error instanceof Error ? error.message : 'requestId tidak valid.',
      );
    }
    assertPeriod(period);
    if (!sourceKey) {
      throw new HttpError(400, 'sourceKey wajib diisi.');
    }

    const permittedCategories = actor.permittedCategories.map((item) =>
      item.trim().toUpperCase(),
    );
    const target = await resolveLinkTarget(
      employeeId,
      actor.role === 'super_admin' ? null : permittedCategories,
    );

    // The row must genuinely be unresolved in the active import — otherwise a
    // link would silently move somebody else's already-matched attendance.
    const unmatched = await loadDepartmentUnmatchedRows(period, {
      allowMissingActiveImport: true,
    });
    const sourceRow = unmatched.find((row) => row.sourceKey === sourceKey);
    if (!sourceRow) {
      throw new HttpError(
        409,
        'Baris presensi ini sudah tidak menunggu penghubungan. Muat ulang halaman.',
      );
    }

    const linkRef = adminDb
      .collection(ATTENDANCE_MANUAL_LINKS_COLLECTION)
      .doc(attendanceManualLinkId(period, sourceKey));
    const idempotencyRef = adminDb
      .collection('FinancialIdempotencyKeys')
      .doc(`${actor.uid}__${requestId}`);
    const publicationRef = adminDb
      .collection(PEKARYA_PUBLICATIONS_COLLECTION)
      .doc(pekaryaPublicationId(period, target.category));
    const requestHash = createHash('sha256')
      .update(JSON.stringify({ period, sourceKey, employeeId }))
      .digest('hex');

    await adminDb.runTransaction(async (transaction) => {
      const [periodSnapshot, idempotencySnapshot, publicationSnapshot] =
        await Promise.all([
          transaction.get(adminDb.collection('PayrollPeriods').doc(period)),
          transaction.get(idempotencyRef),
          transaction.get(publicationRef),
        ]);
      if (idempotencySnapshot.exists) {
        if (idempotencySnapshot.data()?.requestHash !== requestHash) {
          throw new HttpError(
            409,
            'requestId sudah digunakan untuk penghubungan lain.',
          );
        }
        return;
      }
      assertPeriodAcceptsInput(periodSnapshot.data());
      const now = admin.firestore.FieldValue.serverTimestamp();
      transaction.set(linkRef, {
        period,
        sourceKey,
        sourceNipy: sourceRow.sourceNipy,
        sourceName: sourceRow.sourceName,
        department: sourceRow.department,
        system: 'pekarya',
        employeeId,
        employeeCollection: 'Employees_BlueCollar',
        employeeName: target.name,
        // The join value the attendance pipeline actually matches on — a real
        // NIPY when the employee has one, otherwise the synthetic token.
        nipy: target.joinNipy,
        hasRealNipy: Boolean(target.nipy),
        jobCategory: target.category,
        linkedBy: actor.uid,
        linkedByRole: actor.role,
        linkedAt: now,
        requestId,
        schemaVersion: 1,
      });
      transaction.create(idempotencyRef, {
        requestHash,
        entityType: 'AttendanceManualLink',
        entityId: linkRef.id,
        createdAt: now,
      });
      // Linked days change what the employee is owed, so a rekap published
      // before the link no longer reflects the attendance behind it.
      if (publicationSnapshot.exists) {
        transaction.update(publicationRef, {
          state: 'stale',
          stale: true,
          staleReason: 'attendance_manual_link',
          staleAt: now,
        });
      }
      transaction.create(
        newFinancialAuditRef(),
        buildFinancialAuditRecord(actor, {
          action: 'ATTENDANCE_MANUAL_LINK_CREATED',
          entityType: 'AttendanceManualLink',
          entityId: linkRef.id,
          requestId,
          reason: `Menghubungkan baris presensi ${sourceRow.sourceName || sourceKey} ke ${target.name}.`,
          before: null,
          after: {
            period,
            sourceKey,
            sourceNipy: sourceRow.sourceNipy,
            department: sourceRow.department,
            employeeId,
            nipy: target.nipy,
            joinNipy: target.joinNipy,
            dates: sourceRow.dates,
          },
        }),
      );
    });

    return Response.json(
      { linked: true, employeeId, sourceKey, dates: sourceRow.dates },
      { status: 201 },
    );
  } catch (error) {
    return errorResponse(error);
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const actor = await requireAuthenticatedProfile(request);
    requireRole(actor, ['super_admin', 'satker_head']);
    const period = request.nextUrl.searchParams.get('period') || '';
    const sourceKey = request.nextUrl.searchParams.get('sourceKey') || '';
    assertPeriod(period);
    if (!sourceKey) {
      throw new HttpError(400, 'sourceKey wajib diisi.');
    }
    const linkRef = adminDb
      .collection(ATTENDANCE_MANUAL_LINKS_COLLECTION)
      .doc(attendanceManualLinkId(period, sourceKey));

    await adminDb.runTransaction(async (transaction) => {
      const [periodSnapshot, linkSnapshot] = await Promise.all([
        transaction.get(adminDb.collection('PayrollPeriods').doc(period)),
        transaction.get(linkRef),
      ]);
      if (!linkSnapshot.exists) {
        throw new HttpError(404, 'Penghubungan presensi tidak ditemukan.');
      }
      assertPeriodAcceptsInput(periodSnapshot.data());
      const before = linkSnapshot.data()!;
      const category = String(before.jobCategory || '')
        .trim()
        .toUpperCase();
      if (
        actor.role !== 'super_admin' &&
        !actor.permittedCategories
          .map((item) => item.trim().toUpperCase())
          .includes(category)
      ) {
        throw new HttpError(403, 'Kategori pegawai ini tidak diizinkan untuk Anda.');
      }
      // Read before writing: a category that was never published must not gain
      // a publication document that only says it is stale.
      const publicationRef = category
        ? adminDb
            .collection(PEKARYA_PUBLICATIONS_COLLECTION)
            .doc(pekaryaPublicationId(period, category))
        : null;
      const publicationSnapshot = publicationRef
        ? await transaction.get(publicationRef)
        : null;
      const now = admin.firestore.FieldValue.serverTimestamp();
      transaction.delete(linkRef);
      if (publicationRef && publicationSnapshot?.exists) {
        transaction.update(publicationRef, {
          state: 'stale',
          stale: true,
          staleReason: 'attendance_manual_link',
          staleAt: now,
        });
      }
      transaction.create(
        newFinancialAuditRef(),
        buildFinancialAuditRecord(actor, {
          action: 'ATTENDANCE_MANUAL_LINK_REMOVED',
          entityType: 'AttendanceManualLink',
          entityId: linkRef.id,
          reason: `Membatalkan penghubungan baris presensi ${before.sourceName || sourceKey}.`,
          before,
          after: null,
        }),
      );
    });

    return Response.json({ removed: true, sourceKey });
  } catch (error) {
    return errorResponse(error);
  }
}
