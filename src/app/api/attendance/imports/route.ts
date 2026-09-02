import { createHash } from 'node:crypto';
import { NextRequest } from 'next/server';
import admin, { adminDb, adminStorage } from '@/lib/firebase-admin';
import {
  ATTENDANCE_PAYROLL_START_PERIOD,
  AttendanceNormalizedRow,
  attendanceDayKey,
} from '@/lib/payroll/attendance';
import {
  ATTENDANCE_IMPORTS_COLLECTION,
  ATTENDANCE_REVISIONS_COLLECTION,
  ATTENDANCE_ROWS_COLLECTION,
  PEKARYA_PUBLICATIONS_COLLECTION,
  attendanceImportRevisionId,
  loadActiveAttendanceRows,
  loadAttendanceEmployeeIdentities,
} from '@/lib/server/attendanceStore';
import { parseAttendanceWorkbook } from '@/lib/server/attendanceWorkbook';
import { buildFinancialAuditRecord, newFinancialAuditRef } from '@/lib/server/audit';
import {
  errorResponse,
  HttpError,
  requireAuthenticatedProfile,
  requireRole,
} from '@/lib/server/auth';
import { assertPeriodAcceptsInput, isPeriodClosed } from '@/lib/server/payrollPeriod';

export const dynamic = 'force-dynamic';

const MAX_FILE_BYTES = 20 * 1024 * 1024;

function assertPeriod(period: string) {
  if (!/^\d{4}-\d{2}$/.test(period) || period < ATTENDANCE_PAYROLL_START_PERIOD) {
    throw new HttpError(
      400,
      `Import presensi terpadu hanya tersedia mulai periode ${ATTENDANCE_PAYROLL_START_PERIOD}.`,
    );
  }
}

function relevantRows(rows: readonly AttendanceNormalizedRow[]) {
  return rows.filter(
    (row) =>
      row.nipy &&
      row.date &&
      !row.issues.includes('IDENTIFIER_CONFLICT') &&
      !row.issues.includes('IDENTIFIER_MISSING') &&
      !row.issues.includes('DATE_INVALID') &&
      !row.issues.includes('TIME_INVALID') &&
      !row.issues.includes('OUTSIDE_PERIOD'),
  );
}

async function summarizeImport(
  period: string,
  rows: readonly AttendanceNormalizedRow[],
) {
  const { identities, byNipy } = await loadAttendanceEmployeeIdentities();
  const usable = relevantRows(rows);
  const keys = new Map<string, number>();
  for (const row of usable) {
    const key = attendanceDayKey(row.nipy, row.date);
    keys.set(key, (keys.get(key) || 0) + 1);
  }
  const presentNipys = new Set(usable.map((row) => row.nipy));
  const matched = new Set<string>();
  const matchedLoyalis = new Set<string>();
  const matchedPekarya = new Set<string>();
  const matchedSatpam = new Set<string>();
  const unknownNipys = new Set<string>();
  for (const nipy of presentNipys) {
    const candidates = byNipy.get(nipy) || [];
    if (candidates.length !== 1) {
      if (candidates.length === 0) unknownNipys.add(nipy);
      continue;
    }
    const identity = candidates[0];
    matched.add(nipy);
    if (identity.employeeCollection === 'Employees_Loyalis') {
      matchedLoyalis.add(nipy);
    } else if (identity.employeeCollection === 'Employees_BlueCollar') {
      matchedPekarya.add(nipy);
      if (identity.jobCategory === 'SATPAM') matchedSatpam.add(nipy);
    }
  }
  const activeMissingNipy = identities.filter(
    (identity) =>
      identity.active &&
      (identity.employeeCollection === 'Employees_Loyalis' ||
        identity.employeeCollection === 'Employees_BlueCollar') &&
      !identity.nipy,
  );
  const duplicateMasterNipys = Array.from(byNipy.entries())
    .filter(([, candidates]) => candidates.length > 1)
    .map(([nipy, candidates]) => ({
      nipy,
      employeeIds: candidates.map((candidate) => candidate.employeeId),
    }));
  return {
    sourceRowCount: rows.length,
    usableRowCount: usable.length,
    uniqueNipyCount: presentNipys.size,
    employeeDayCount: keys.size,
    duplicateEmployeeDayCount: Array.from(keys.values()).filter((count) => count > 1)
      .length,
    incompletePunchCount: usable.filter((row) =>
      row.issues.includes('INCOMPLETE_PUNCH'),
    ).length,
    invalidRowCount: rows.length - usable.length,
    outsidePeriodCount: rows.filter((row) => row.issues.includes('OUTSIDE_PERIOD'))
      .length,
    matchedNipyCount: matched.size,
    matchedLoyalisCount: matchedLoyalis.size,
    matchedPekaryaCount: matchedPekarya.size,
    matchedSatpamCount: matchedSatpam.size,
    unknownNipyCount: unknownNipys.size,
    unknownNipys: Array.from(unknownNipys).sort().slice(0, 100),
    activeEmployeeMissingNipyCount: activeMissingNipy.length,
    activeEmployeeMissingNipy: activeMissingNipy
      .map((identity) => ({
        employeeId: identity.employeeId,
        name: identity.name,
        employeeCollection: identity.employeeCollection,
        jobCategory: identity.jobCategory,
      }))
      .slice(0, 100),
    duplicateMasterNipyCount: duplicateMasterNipys.length,
    duplicateMasterNipys: duplicateMasterNipys.slice(0, 100),
  };
}

function rowFingerprint(row: AttendanceNormalizedRow) {
  return JSON.stringify([
    row.nipy,
    row.date,
    row.workStatus,
    row.scanIn,
    row.scanOut,
    row.name,
    row.department,
  ]);
}

async function compareWithActive(period: string, rows: readonly AttendanceNormalizedRow[]) {
  try {
    const active = await loadActiveAttendanceRows(period);
    const beforeMap = new Map(
      relevantRows(active.rows).map((row) => [
        `${attendanceDayKey(row.nipy, row.date)}__${row.rowNumber}`,
        rowFingerprint(row),
      ]),
    );
    const afterMap = new Map(
      relevantRows(rows).map((row) => [
        `${attendanceDayKey(row.nipy, row.date)}__${row.rowNumber}`,
        rowFingerprint(row),
      ]),
    );
    let added = 0;
    let removed = 0;
    let changed = 0;
    for (const [key, value] of afterMap) {
      if (!beforeMap.has(key)) added += 1;
      else if (beforeMap.get(key) !== value) changed += 1;
    }
    for (const key of beforeMap.keys()) {
      if (!afterMap.has(key)) removed += 1;
    }
    return {
      previousRevision: Number(active.importData.activeRevision || 0),
      added,
      removed,
      changed,
    };
  } catch {
    return { previousRevision: 0, added: relevantRows(rows).length, removed: 0, changed: 0 };
  }
}

function safeFilename(filename: string) {
  const normalized = filename.replace(/[^A-Za-z0-9._-]/g, '_').slice(-120);
  return normalized || 'attendance.xlsx';
}

function isoDateToDisplay(dateIso: string) {
  const [year, month, day] = dateIso.split('-');
  return `${day}-${month}-${year}`;
}

interface LoyalisDailyLog {
  Tanggal: string;
  'Jam kerja': string;
  'Scan masuk': string;
  'Scan pulang': string;
}

async function buildActiveLoyalisRows(period: string): Promise<
  Array<{
    excelName: string;
    nipy: string;
    employeeId: string;
    employeeName: string;
    dailyLogs: LoyalisDailyLog[];
  }>
> {
  const [{ rows }, { byNipy }] = await Promise.all([
    loadActiveAttendanceRows(period, { allowMissingActiveImport: true }),
    loadAttendanceEmployeeIdentities(),
  ]);
  const grouped = new Map<
    string,
    {
      excelName: string;
      nipy: string;
      employeeId: string;
      employeeName: string;
      rows: Array<{ dateIso: string; date: string; workStatus: string; scanIn: string; scanOut: string }>;
    }
  >();
  for (const row of relevantRows(rows)) {
    const candidates = (byNipy.get(row.nipy) || []).filter(
      (identity) => identity.employeeCollection === 'Employees_Loyalis' && identity.active,
    );
    if (candidates.length !== 1) continue;
    const identity = candidates[0];
    const existing = grouped.get(identity.employeeId);
    const entry = existing || {
      excelName: row.name || row.nipy,
      nipy: row.nipy,
      employeeId: identity.employeeId,
      employeeName: identity.name,
      rows: [],
    };
    // Only an explicit "TIDAK HADIR" means no attendance event that day. Any
    // other status label — "MASUK" or a source-specific one like "STAFF" —
    // means the employee was present, so its real scan times are kept.
    const isPresent = row.workStatus !== 'TIDAK HADIR';
    entry.rows.push({
      dateIso: row.date,
      date: isoDateToDisplay(row.date),
      workStatus: row.workStatus,
      scanIn: isPresent ? row.scanIn || '' : '',
      scanOut: isPresent ? row.scanOut || '' : '',
    });
    grouped.set(identity.employeeId, entry);
  }
  return Array.from(grouped.values()).map((entry) => ({
    excelName: entry.excelName,
    nipy: entry.nipy,
    employeeId: entry.employeeId,
    employeeName: entry.employeeName,
    dailyLogs: entry.rows
      .sort((left, right) => left.dateIso.localeCompare(right.dateIso))
      .map((row) => ({
        Tanggal: row.date,
        'Jam kerja': row.workStatus,
        'Scan masuk': row.scanIn,
        'Scan pulang': row.scanOut,
      })),
  }));
}

export async function GET(request: NextRequest) {
  try {
    const actor = await requireAuthenticatedProfile(request);
    requireRole(actor, [
      'super_admin',
      'finance_verifier',
      'loyalis_presence_admin',
    ]);
    const period = request.nextUrl.searchParams.get('period') || '';
    const includeDownload =
      request.nextUrl.searchParams.get('includeDownload') === 'true';
    const scope = request.nextUrl.searchParams.get('scope') || '';
    assertPeriod(period);
    const [rootSnapshot, revisionsSnapshot, loyalisRows] = await Promise.all([
      adminDb.collection(ATTENDANCE_IMPORTS_COLLECTION).doc(period).get(),
      adminDb
        .collection(ATTENDANCE_REVISIONS_COLLECTION)
        .where('period', '==', period)
        .get(),
      scope === 'loyalis' ? buildActiveLoyalisRows(period) : Promise.resolve(null),
    ]);
    const revisions = await Promise.all(
      revisionsSnapshot.docs.map(async (snapshot) => {
        const data = snapshot.data();
        let downloadUrl: string | null = null;
        if (includeDownload && typeof data.storagePath === 'string') {
          [downloadUrl] = await adminStorage
            .bucket()
            .file(data.storagePath)
            .getSignedUrl({
              action: 'read',
              expires: Date.now() + 15 * 60 * 1000,
            });
        }
        return { id: snapshot.id, ...data, downloadUrl };
      }),
    );
    return Response.json(
      {
        import: rootSnapshot.exists ? { id: rootSnapshot.id, ...rootSnapshot.data() } : null,
        revisions: revisions
          .sort(
            (left, right) =>
              Number((right as Record<string, unknown>).revision || 0) -
              Number((left as Record<string, unknown>).revision || 0),
          ),
        ...(loyalisRows ? { loyalisRows } : {}),
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
    requireRole(actor, ['super_admin', 'loyalis_presence_admin']);
    const form = await request.formData();
    const file = form.get('file');
    const period = String(form.get('period') || '');
    const mode = String(form.get('mode') || 'preview');
    const requestId = String(form.get('requestId') || '');
    const reason = String(form.get('reason') || '').trim();
    const expectedRevision = Number(form.get('expectedRevision') || 0);
    assertPeriod(period);
    if (!(file instanceof File)) {
      throw new HttpError(400, 'File XLSX presensi wajib dipilih.');
    }
    if (file.size < 1 || file.size > MAX_FILE_BYTES) {
      throw new HttpError(400, 'Ukuran file presensi harus di antara 1 byte dan 20 MB.');
    }
    if (!/\.xlsx?$/i.test(file.name)) {
      throw new HttpError(400, 'File presensi wajib menggunakan format XLS atau XLSX.');
    }
    if (!['preview', 'activate'].includes(mode)) {
      throw new HttpError(400, 'Mode import tidak valid.');
    }
    if (
      mode === 'activate' &&
      (!/^[A-Za-z0-9_-]{8,128}$/.test(requestId) || reason.length < 8)
    ) {
      throw new HttpError(400, 'requestId dan alasan aktivasi wajib valid.');
    }

    const periodSnapshot = await adminDb.collection('PayrollPeriods').doc(period).get();
    assertPeriodAcceptsInput(periodSnapshot.data());
    const bytes = new Uint8Array(await file.arrayBuffer());
    const hash = createHash('sha256').update(bytes).digest('hex');
    const parsed = parseAttendanceWorkbook(bytes, period);
    const [summary, differences] = await Promise.all([
      summarizeImport(period, parsed.rows),
      compareWithActive(period, parsed.rows),
    ]);
    const preview = {
      period,
      fileName: file.name,
      fileSize: file.size,
      sha256: hash,
      sheetName: parsed.sheetName,
      headers: parsed.headers,
      summary,
      differences,
    };
    if (mode === 'preview') {
      return Response.json(preview);
    }

    const rootRef = adminDb.collection(ATTENDANCE_IMPORTS_COLLECTION).doc(period);
    const requestHash = createHash('sha256')
      .update(JSON.stringify({ period, hash, expectedRevision }))
      .digest('hex');
    const claim = await adminDb.runTransaction(async (transaction) => {
      const idempotencyRef = adminDb
        .collection('FinancialIdempotencyKeys')
        .doc(`${actor.uid}__${requestId}`);
      const [rootSnapshot, idempotencySnapshot] = await Promise.all([
        transaction.get(rootRef),
        transaction.get(idempotencyRef),
      ]);
      if (idempotencySnapshot.exists) {
        const previous = idempotencySnapshot.data()!;
        if (previous.requestHash !== requestHash) {
          throw new HttpError(409, 'requestId sudah digunakan untuk import berbeda.');
        }
        return {
          revision: Number(previous.revision),
          revisionId: String(previous.entityId),
          previousRevisionId:
            typeof previous.previousRevisionId === 'string'
              ? previous.previousRevisionId
              : null,
          idempotent: true,
        };
      }
      const root = rootSnapshot.exists ? rootSnapshot.data()! : null;
      const activeRevision = Number(root?.activeRevision || 0);
      if (activeRevision !== expectedRevision) {
        throw new HttpError(
          409,
          'Revisi import telah berubah. Muat ulang pratinjau sebelum mengaktifkan.',
        );
      }
      if (root?.activeFileHash === hash) {
        return {
          revision: activeRevision,
          revisionId: String(root.activeRevisionId),
          previousRevisionId: null,
          idempotent: true,
          alreadyActive: true,
        };
      }
      const revision = activeRevision + 1;
      const revisionId = attendanceImportRevisionId(period, revision);
      const revisionRef = adminDb
        .collection(ATTENDANCE_REVISIONS_COLLECTION)
        .doc(revisionId);
      transaction.create(revisionRef, {
        period,
        revision,
        status: 'writing',
        fileName: file.name,
        fileSize: file.size,
        fileHash: hash,
        summary,
        differences,
        uploadedBy: actor.uid,
        uploadedByRole: actor.role,
        uploadedAt: admin.firestore.FieldValue.serverTimestamp(),
        schemaVersion: 1,
      });
      transaction.create(idempotencyRef, {
        requestHash,
        entityType: 'AttendanceImportRevision',
        entityId: revisionId,
        previousRevisionId:
          typeof root?.activeRevisionId === 'string' ? root.activeRevisionId : null,
        revision,
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
      });
      return {
        revision,
        revisionId,
        previousRevisionId:
          typeof root?.activeRevisionId === 'string' ? root.activeRevisionId : null,
        idempotent: false,
      };
    });

    if (!('alreadyActive' in claim)) {
      const storagePath = `attendance-imports/${period}/${claim.revisionId}/${safeFilename(file.name)}`;
      await adminStorage.bucket().file(storagePath).save(Buffer.from(bytes), {
        resumable: false,
        contentType:
          file.type ||
          'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        metadata: {
          metadata: {
            period,
            revisionId: claim.revisionId,
            sha256: hash,
            uploadedBy: actor.uid,
          },
        },
      });

      const writer = adminDb.bulkWriter();
      parsed.rows.forEach((row) => {
        const rowId = createHash('sha256')
          .update(`${claim.revisionId}|${row.rowNumber}`)
          .digest('hex');
        writer.set(adminDb.collection(ATTENDANCE_ROWS_COLLECTION).doc(rowId), {
          ...row,
          period,
          revision: claim.revision,
          revisionId: claim.revisionId,
          schemaVersion: 1,
        });
      });
      await writer.close();

      await adminDb.runTransaction(async (transaction) => {
        const loyalisPresenceRef = adminDb
          .collection('LoyalisPresence')
          .doc(period.replace('-', '_'));
        const [latestRoot, periodLatest, loyalisPresenceSnapshot] = await Promise.all([
          transaction.get(rootRef),
          transaction.get(adminDb.collection('PayrollPeriods').doc(period)),
          transaction.get(loyalisPresenceRef),
        ]);
        const activeRevision = Number(latestRoot.data()?.activeRevision || 0);
        if (activeRevision !== expectedRevision) {
          throw new HttpError(
            409,
            'Import lain telah diaktifkan lebih dahulu. Revisi ini disimpan tetapi tidak diaktifkan.',
          );
        }
        if (isPeriodClosed(periodLatest.data())) {
          throw new HttpError(409, 'Periode telah ditutup sebelum import selesai.');
        }
        const now = admin.firestore.FieldValue.serverTimestamp();
        const calendarRevision = Number(
          periodLatest.data()?.workCalendar?.revision || 1,
        );
        transaction.set(rootRef, {
          period,
          activeRevision: claim.revision,
          activeRevisionId: claim.revisionId,
          activeFileHash: hash,
          calendarRevisionAtImport: calendarRevision,
          status: 'active',
          summary,
          updatedAt: now,
          updatedBy: actor.uid,
          schemaVersion: 1,
        });
        transaction.update(
          adminDb.collection(ATTENDANCE_REVISIONS_COLLECTION).doc(claim.revisionId),
          {
            status: 'active',
            storagePath,
            activatedAt: now,
            activatedBy: actor.uid,
            calendarRevision,
          },
        );
        if (claim.previousRevisionId) {
          transaction.update(
            adminDb
              .collection(ATTENDANCE_REVISIONS_COLLECTION)
              .doc(claim.previousRevisionId),
            { status: 'superseded', supersededAt: now },
          );
        }
        if (loyalisPresenceSnapshot.exists) {
          transaction.update(loyalisPresenceRef, {
            sourceImportRevision: claim.revision,
            sourceImportRevisionId: claim.revisionId,
            sourceImportStale: true,
            updatedAt: now,
          });
        }
        transaction.create(
          newFinancialAuditRef(),
          buildFinancialAuditRecord(actor, {
            action:
              claim.revision === 1
                ? 'ATTENDANCE_IMPORT_ACTIVATED'
                : 'ATTENDANCE_IMPORT_REPLACED',
            entityType: 'AttendanceImport',
            entityId: period,
            requestId,
            reason,
            before: latestRoot.exists ? latestRoot.data() : null,
            after: {
              activeRevision: claim.revision,
              activeRevisionId: claim.revisionId,
              fileHash: hash,
              summary,
            },
          }),
        );
      });

      const publicationsSnapshot = await adminDb
        .collection(PEKARYA_PUBLICATIONS_COLLECTION)
        .where('period', '==', period)
        .get();
      if (!publicationsSnapshot.empty) {
        const staleWriter = adminDb.bulkWriter();
        publicationsSnapshot.docs.forEach((snapshot) => {
          staleWriter.update(snapshot.ref, {
            state: 'stale',
            stale: true,
            staleReason: 'attendance_import_replaced',
            staleAt: admin.firestore.FieldValue.serverTimestamp(),
          });
        });
        await staleWriter.close();
      }
    }

    return Response.json(
      {
        ...preview,
        activeRevision: claim.revision,
        activeRevisionId: claim.revisionId,
        idempotent: claim.idempotent,
      },
      { status: 201 },
    );
  } catch (error) {
    return errorResponse(error);
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const actor = await requireAuthenticatedProfile(request);
    requireRole(actor, ['super_admin', 'loyalis_presence_admin']);
    const period = request.nextUrl.searchParams.get('period') || '';
    const revisionId = request.nextUrl.searchParams.get('revisionId') || '';
    assertPeriod(period);
    if (!revisionId) {
      throw new HttpError(400, 'revisionId wajib diisi.');
    }

    const periodSnapshot = await adminDb.collection('PayrollPeriods').doc(period).get();
    assertPeriodAcceptsInput(periodSnapshot.data());

    const revisionRef = adminDb.collection(ATTENDANCE_REVISIONS_COLLECTION).doc(revisionId);
    const revisionData = await adminDb.runTransaction(async (transaction) => {
      const revisionSnapshot = await transaction.get(revisionRef);
      if (!revisionSnapshot.exists) {
        throw new HttpError(404, 'Revisi import tidak ditemukan.');
      }
      const data = revisionSnapshot.data()!;
      if (data.period !== period) {
        throw new HttpError(400, 'Revisi import tidak sesuai dengan periode.');
      }
      // Only a stuck/incomplete revision may be removed this way — it never
      // became the active file and holds no audit value. An active or
      // superseded revision stays, matching the "file lama tetap disimpan
      // untuk audit" guarantee shown before activation.
      if (data.status !== 'writing') {
        throw new HttpError(
          409,
          'Hanya revisi yang gagal/tidak selesai diaktifkan (status "writing") yang dapat dihapus.',
        );
      }
      transaction.delete(revisionRef);
      return data;
    });

    const rowsSnapshot = await adminDb
      .collection(ATTENDANCE_ROWS_COLLECTION)
      .where('revisionId', '==', revisionId)
      .get();
    if (!rowsSnapshot.empty) {
      const writer = adminDb.bulkWriter();
      rowsSnapshot.docs.forEach((snapshot) => writer.delete(snapshot.ref));
      await writer.close();
    }

    const storagePath =
      typeof revisionData.storagePath === 'string'
        ? revisionData.storagePath
        : typeof revisionData.fileName === 'string'
          ? `attendance-imports/${period}/${revisionId}/${safeFilename(revisionData.fileName)}`
          : null;
    if (storagePath) {
      await adminStorage.bucket().file(storagePath).delete({ ignoreNotFound: true });
    }

    return Response.json({ deleted: true, revisionId });
  } catch (error) {
    return errorResponse(error);
  }
}
