import { createHash } from 'node:crypto';
import { NextRequest } from 'next/server';
import admin, { adminDb } from '@/lib/firebase-admin';
import {
  assertPekaryaActivityProofUrl,
  assertRequestId,
  isImmutablePayrollStatus,
  type PhotoAuditMetadata,
  type PhotoEvidence,
} from '@/lib/payroll/domain';
import {
  calculateJourneyDateTimeTimings,
  calculateDriverNetWage,
  calculateNightPremium,
  canonicalizeDriverJourneyTimeline,
  getMealAllowanceForDuration,
} from '@/lib/payroll/driverJourney';
import {
  activityDurationMinutes,
  assertSatpamFoundItemPhotoCount,
  assertPekaryaActivityType,
  isPekaryaJobCategory,
  buildPekaryaActivityIdentity,
  pekaryaPayrollPeriodForDate,
  SATPAM_FOUND_ITEM_RECOMMENDED_FEE,
  SATPAM_REPRIMAND_RECOMMENDED_FEE,
} from '@/lib/payroll/pekaryaSpj';
import { buildFinancialAuditRecord, newFinancialAuditRef } from '@/lib/server/audit';
import {
  errorResponse,
  HttpError,
  requireAuthenticatedProfile,
  requireRole,
} from '@/lib/server/auth';
import { assertPeriodAcceptsInput } from '@/lib/server/payrollPeriod';

export const dynamic = 'force-dynamic';

interface SubmitActivityCommand {
  requestId: string;
  reportId?: string;
  reportKind?: 'satpam_spj' | 'satpam_found_item' | 'satpam_reprimand';
  itemName?: string;
  activityName: string;
  activityType: string;
  activityDate: string;
  timeStart: string;
  timeEnd?: string;
  driverData?: Record<string, unknown>;
  proofPhoto?: PhotoEvidence;
  proofPhotos?: PhotoEvidence[];
}

const SAFE_REPORT_ID = /^[A-Za-z0-9_-]{1,180}$/;
const ALLOWED_DRIVER_FIELDS = [
  'tripType',
  'vehicleType',
  'nightCount',
  'isMultiDay',
  'dateStart',
  'dateEnd',
  'fuelFee',
  'tollParkingFee',
  'fuelReceiptUrl',
  'tollReceiptUrl',
  'fuelReceiptEvidence',
  'tollReceiptEvidence',
  'points',
  'distanceKm',
  'durationHours',
  'routeDurationHours',
  'journeyId',
  'extraActivities',
  'extraDistanceKm',
  'extraOperationalCost',
  'extraFuelCost',
  'extraTollCost',
  'extraMealAllowance',
  'actualMealAllowance',
  'positiveReimburseDelta',
  'baseDriverWage',
  'upahBersih',
  'reimburseDelta',
  'unspentCash',
  'remainingUnspentCash',
  'baseOperationalCost',
  'preAuthorizedMeal',
  'preAuthorizedToll',
  'customDurationPP',
  'totalPreAuthorizedAllowance',
  'totalActualSpent',
  'totalOperationalCost',
  'vehicleRate',
  'componentJarak',
  'componentWaktu',
  'nightPremium',
  'reportedEndPoint',
  'ndalemMealMoneyReceived',
] as const;

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
    if (typeof field !== 'number' || !Number.isFinite(field) || field < min || field > max) {
      throw new HttpError(400, `Metadata ${key} tidak valid.`);
    }
    return field;
  };
  if (typeof item.hasExif !== 'boolean') throw new HttpError(400, 'Metadata hasExif tidak valid.');
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

function parseReceiptEvidence(value: unknown, receiptUrls: unknown, fieldName: string) {
  if (!Array.isArray(value) || value.length > 20) {
    throw new HttpError(400, `${fieldName} tidak valid.`);
  }
  const urls = typeof receiptUrls === 'string'
    ? receiptUrls.split(',').map((url) => url.trim()).filter(Boolean)
    : [];
  if (value.length !== urls.length) {
    throw new HttpError(400, `${fieldName} harus sesuai dengan setiap foto bukti.`);
  }
  const expectedUrls = new Set(urls);
  return value.map((entry) => {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
      throw new HttpError(400, `${fieldName} tidak valid.`);
    }
    const item = entry as Record<string, unknown>;
    if (typeof item.url !== 'string' || !expectedUrls.has(item.url)) {
      throw new HttpError(400, `URL pada ${fieldName} tidak sesuai.`);
    }
    return { url: item.url, auditMetadata: parsePhotoAuditMetadata(item.auditMetadata) };
  });
}

function parseProofPhoto(value: unknown): PhotoEvidence {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new HttpError(400, 'Foto bukti tidak valid.');
  }
  const item = value as Record<string, unknown>;
  if (typeof item.url !== 'string' || !item.url) {
    throw new HttpError(400, 'URL foto bukti tidak valid.');
  }
  return { url: item.url, auditMetadata: parsePhotoAuditMetadata(item.auditMetadata) };
}

function parseProofPhotos(value: unknown): PhotoEvidence[] {
  if (!Array.isArray(value)) {
    throw new HttpError(400, 'Laporan wajib memiliki 1 sampai 5 foto.');
  }
  try {
    assertSatpamFoundItemPhotoCount(value.length);
  } catch (error) {
    throw new HttpError(
      400,
      error instanceof Error ? error.message : 'Jumlah foto laporan tidak valid.',
    );
  }
  const photos = value.map(parseProofPhoto);
  if (new Set(photos.map((photo) => photo.url)).size !== photos.length) {
    throw new HttpError(400, 'Foto laporan tidak boleh duplikat.');
  }
  return photos;
}

function parseCommand(raw: unknown): SubmitActivityCommand {
  if (!raw || typeof raw !== 'object') {
    throw new HttpError(400, 'Laporan kegiatan tidak valid.');
  }
  const value = raw as Partial<SubmitActivityCommand>;
  if (typeof value.requestId !== 'string') {
    throw new HttpError(400, 'requestId wajib diisi.');
  }
  try {
    assertRequestId(value.requestId);
  } catch (error) {
    throw new HttpError(400, error instanceof Error ? error.message : 'requestId tidak valid.');
  }
  if (value.reportId && !SAFE_REPORT_ID.test(value.reportId)) {
    throw new HttpError(400, 'ID laporan tidak valid.');
  }
  if (
    value.reportKind !== undefined &&
    value.reportKind !== 'satpam_spj' &&
    value.reportKind !== 'satpam_found_item' &&
    value.reportKind !== 'satpam_reprimand'
  ) {
    throw new HttpError(400, 'Jenis laporan Satpam tidak valid.');
  }
  const isFoundItem = value.reportKind === 'satpam_found_item';
  const isReprimand = value.reportKind === 'satpam_reprimand';
  // Found-item and reprimand reports share the same shape: a short
  // description plus 1-5 photos, no activity type or time window.
  const isPhotoOnlyReport = isFoundItem || isReprimand;
  const rawName = isPhotoOnlyReport ? value.itemName ?? value.activityName : value.activityName;
  let activityName =
    typeof rawName === 'string' ? rawName.normalize('NFKC').trim() : '';
  if (activityName.length > 180) {
    activityName = activityName.slice(0, 177) + '...';
  }
  if (activityName.length < 2) {
    throw new HttpError(
      400,
      isFoundItem
        ? 'Nama barang wajib diisi minimal 2 karakter.'
        : isReprimand
          ? 'Keterangan teguran wajib diisi minimal 2 karakter.'
          : 'Nama kegiatan wajib diisi minimal 2 karakter.',
    );
  }
  if (!isPhotoOnlyReport) {
    try {
      assertPekaryaActivityType(value.activityType);
    } catch (error) {
      throw new HttpError(400, error instanceof Error ? error.message : 'Jenis kegiatan tidak valid.');
    }
  }
  if (typeof value.activityDate !== 'string') {
    throw new HttpError(400, 'Tanggal atau waktu kegiatan tidak valid.');
  }
  if (
    !isPhotoOnlyReport &&
    (typeof value.timeStart !== 'string' ||
      (value.timeEnd !== undefined && typeof value.timeEnd !== 'string'))
  ) {
    throw new HttpError(400, 'Tanggal atau waktu kegiatan tidak valid.');
  }
  return {
    requestId: value.requestId,
    reportId: value.reportId,
    reportKind: value.reportKind,
    activityName,
    itemName: isPhotoOnlyReport ? activityName : undefined,
    activityType: isFoundItem
      ? 'Penemuan Barang'
      : isReprimand
        ? 'Teguran Pengendara'
        : value.activityType!,
    activityDate: value.activityDate,
    timeStart: isPhotoOnlyReport ? '' : value.timeStart!,
    timeEnd: isPhotoOnlyReport ? '' : value.timeEnd || '',
    driverData:
      value.driverData && typeof value.driverData === 'object' ? value.driverData : undefined,
    proofPhoto: value.proofPhoto === undefined ? undefined : parseProofPhoto(value.proofPhoto),
    proofPhotos: isPhotoOnlyReport ? parseProofPhotos(value.proofPhotos) : undefined,
  };
}

function sanitizeDriverData(
  value: Record<string, unknown> | undefined,
  category: string,
  activityDate: string,
): Record<string, unknown> {
  if (category !== 'SOPIR') return {};
  if (!value) throw new HttpError(400, 'Rincian perjalanan Sopir wajib diisi.');
  const result: Record<string, unknown> = {};
  for (const key of ALLOWED_DRIVER_FIELDS) {
    if (value[key] !== undefined) result[key] = value[key];
  }

  try {
    Object.assign(
      result,
      canonicalizeDriverJourneyTimeline({
        activityDate,
        dateStart: result.dateStart,
        dateEnd: result.dateEnd,
        isMultiDay: result.isMultiDay,
        nightCount: result.nightCount,
      }),
    );
  } catch (error) {
    throw new HttpError(
      400,
      error instanceof Error ? error.message : 'Timeline perjalanan tidak valid.',
    );
  }

  const boundedMoneyFields = [
    'fuelFee',
    'tollParkingFee',
    'extraOperationalCost',
    'extraFuelCost',
    'extraTollCost',
    'extraMealAllowance',
    'actualMealAllowance',
    'positiveReimburseDelta',
    'baseDriverWage',
    'upahBersih',
    'reimburseDelta',
    'unspentCash',
    'remainingUnspentCash',
    'baseOperationalCost',
    'preAuthorizedMeal',
    'preAuthorizedToll',
    'totalPreAuthorizedAllowance',
    'totalActualSpent',
    'totalOperationalCost',
    'componentJarak',
    'componentWaktu',
    'nightPremium',
    'ndalemMealMoneyReceived',
  ];
  for (const key of boundedMoneyFields) {
    const number = result[key];
    if (
      number !== undefined &&
      (typeof number !== 'number' ||
        !Number.isFinite(number) ||
        number < 0 ||
        number > 100_000_000)
    ) {
      throw new HttpError(400, `Nilai ${key} tidak valid.`);
    }
  }

  const normalizeReceipt = (
    feeKey: 'fuelFee' | 'tollParkingFee',
    urlKey: 'fuelReceiptUrl' | 'tollReceiptUrl',
    evidenceKey: 'fuelReceiptEvidence' | 'tollReceiptEvidence',
    evidenceLabel: string,
  ) => {
    const fee = typeof result[feeKey] === 'number' ? result[feeKey] as number : 0;
    const receiptUrl = typeof result[urlKey] === 'string'
      ? result[urlKey].split(',').map((url) => url.trim()).filter(Boolean).join(',')
      : '';

    if (fee <= 0 || !receiptUrl) {
      result[feeKey] = 0;
      result[urlKey] = '';
      delete result[evidenceKey];
      return;
    }

    result[urlKey] = receiptUrl;
    if (result[evidenceKey] !== undefined) {
      result[evidenceKey] = parseReceiptEvidence(
        result[evidenceKey],
        receiptUrl,
        evidenceLabel,
      );
    }
  };

  normalizeReceipt('fuelFee', 'fuelReceiptUrl', 'fuelReceiptEvidence', 'Metadata bukti BBM');
  normalizeReceipt('tollParkingFee', 'tollReceiptUrl', 'tollReceiptEvidence', 'Metadata bukti Tol & Parkir');

  for (const key of ['distanceKm', 'durationHours', 'extraDistanceKm', 'customDurationPP']) {
    const number = result[key];
    if (
      number !== undefined &&
      (typeof number !== 'number' || !Number.isFinite(number) || number < 0 || number > 10_000)
    ) {
      throw new HttpError(400, `Nilai ${key} tidak valid.`);
    }
  }
  if (result.points !== undefined) {
    if (
      !Array.isArray(result.points) ||
      result.points.length < 2 ||
      result.points.length > 30 ||
      result.points.some((point) => typeof point !== 'string' || point.length > 300)
    ) {
      throw new HttpError(400, 'Rute perjalanan tidak valid.');
    }
  }
  if (
    result.journeyId !== undefined &&
    (typeof result.journeyId !== 'string' || !SAFE_REPORT_ID.test(result.journeyId))
  ) {
    throw new HttpError(400, 'ID perjalanan tidak valid.');
  }
  if (
    result.reportedEndPoint !== undefined &&
    (typeof result.reportedEndPoint !== 'string' || !result.reportedEndPoint.trim() || result.reportedEndPoint.length > 300)
  ) {
    throw new HttpError(400, 'Tujuan perjalanan tidak valid.');
  }

  const distanceKm = typeof result.distanceKm === 'number' ? result.distanceKm : 0;
  const durationHours = typeof result.durationHours === 'number' ? result.durationHours : 0;
  const nightCount = typeof result.nightCount === 'number' ? result.nightCount : 0;
  result.routeDurationHours = durationHours;
  result.componentJarak = Math.ceil(distanceKm * 300);
  result.componentWaktu = Math.ceil(durationHours * 5_000);
  result.nightPremium = calculateNightPremium(nightCount);
  result.baseDriverWage = calculateDriverNetWage(
    distanceKm,
    durationHours,
    nightCount,
  );
  result.upahBersih = result.baseDriverWage;
  return result;
}

export async function GET(request: NextRequest) {
  try {
    const actor = await requireAuthenticatedProfile(request);
    requireRole(actor, [
      'super_admin',
      'satker_head',
      'honorer',
      'ketua_shift_satpam',
    ]);
    const { searchParams } = new URL(request.url);
    const reportId = searchParams.get('reportId') || '';
    if (!SAFE_REPORT_ID.test(reportId) || searchParams.get('revisions') !== 'true') {
      throw new HttpError(400, 'Permintaan riwayat laporan tidak valid.');
    }

    const reportSnapshot = await adminDb.collection('ActivityReports').doc(reportId).get();
    if (!reportSnapshot.exists) {
      throw new HttpError(404, 'Laporan tidak ditemukan.');
    }
    const report = reportSnapshot.data()!;
    const ownsReport = actor.linkedEmployeeId === report.employeeId;
    const mayAudit =
      actor.role === 'super_admin' ||
      (actor.role === 'satker_head' &&
        actor.permittedCategories.includes(String(report.jobCategory || '')));
    if (!ownsReport && !mayAudit) {
      throw new HttpError(403, 'Anda tidak memiliki akses ke riwayat laporan ini.');
    }

    const revisionsSnapshot = await adminDb
      .collection('ActivityReportRevisions')
      .where('reportId', '==', reportId)
      .get();
    const revisions = revisionsSnapshot.docs
      .map((document) => {
        const revision = document.data();
        const snapshot = revision.snapshot || {};
        return {
          revision: Number(revision.revision || 1),
          submittedAt:
            typeof revision.submittedAt?.toDate === 'function'
              ? revision.submittedAt.toDate().toISOString()
              : null,
          itemName: String(snapshot.itemName || snapshot.activityName || ''),
          activityDate: String(snapshot.activityDate || ''),
          photoCount: Array.isArray(snapshot.proofPhotos)
            ? snapshot.proofPhotos.length
            : snapshot.photoUrl
              ? 1
              : 0,
        };
      })
      .sort((left, right) => right.revision - left.revision);
    return Response.json({ reportId, revisions });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function POST(request: NextRequest) {
  try {
    const actor = await requireAuthenticatedProfile(request);
    requireRole(actor, ['honorer', 'ketua_shift_satpam']);
    if (!actor.linkedEmployeeId) {
      throw new HttpError(409, 'Akun belum terhubung ke data pegawai.');
    }
    const command = parseCommand(await request.json());
    const isFoundItem = command.reportKind === 'satpam_found_item';
    const isReprimand = command.reportKind === 'satpam_reprimand';
    const isPhotoOnlyReport = isFoundItem || isReprimand;
    const payrollPeriod = pekaryaPayrollPeriodForDate(command.activityDate);
    if (!isPhotoOnlyReport && !/^([01]\d|2[0-3]):([0-5]\d)$/.test(command.timeStart)) {
      throw new HttpError(400, 'Waktu mulai wajib menggunakan format HH:MM.');
    }
    if (!isPhotoOnlyReport && command.activityType !== 'Buang Sampah') {
      if (!/^([01]\d|2[0-3]):([0-5]\d)$/.test(command.timeEnd || '')) {
        throw new HttpError(400, 'Waktu selesai wajib menggunakan format HH:MM.');
      }
    }

    const employeeId = actor.linkedEmployeeId;
    if (command.proofPhoto) {
      try {
        assertPekaryaActivityProofUrl(command.proofPhoto.url, employeeId);
      } catch (error) {
        throw new HttpError(400, error instanceof Error ? error.message : 'Foto bukti tidak valid.');
      }
    }
    for (const photo of command.proofPhotos || []) {
      try {
        assertPekaryaActivityProofUrl(photo.url, employeeId);
      } catch (error) {
        throw new HttpError(
          400,
          error instanceof Error ? error.message : 'Foto laporan tidak valid.',
        );
      }
    }
    const requestHash = createHash('sha256').update(JSON.stringify(command)).digest('hex');
    const safeEmployeeId = employeeId.replace(/[^A-Za-z0-9_-]/g, '_').slice(0, 72);
    const reportId = command.reportId || `PEK-${safeEmployeeId}-${command.requestId}`;
    const identity = isPhotoOnlyReport
      ? [isFoundItem ? 'found_item' : 'reprimand', reportId].join('__')
      : buildPekaryaActivityIdentity(
          employeeId,
          command.activityDate,
          command.timeStart,
          command.timeEnd,
          command.activityName,
        );

    const result = await adminDb.runTransaction(async (transaction) => {
      const employeeRef = adminDb.collection('Employees_BlueCollar').doc(employeeId);
      const reportRef = adminDb.collection('ActivityReports').doc(reportId);
      const indexRef = adminDb.collection('PekaryaActivityIndexes').doc(identity);
      const periodRef = adminDb.collection('PayrollPeriods').doc(payrollPeriod);
      const slipRef = adminDb
        .collection('PayrollSlipStates')
        .doc(`${payrollPeriod.replace('-', '_')}_${employeeId}`);
      const idempotencyRef = adminDb
        .collection('FinancialIdempotencyKeys')
        .doc(`${actor.uid}__${command.requestId}`);
      const [employeeSnapshot, reportSnapshot, indexSnapshot, periodSnapshot, slipSnapshot, idemSnapshot] =
        await Promise.all([
          transaction.get(employeeRef),
          transaction.get(reportRef),
          transaction.get(indexRef),
          transaction.get(periodRef),
          transaction.get(slipRef),
          transaction.get(idempotencyRef),
        ]);

      if (idemSnapshot.exists) {
        const previous = idemSnapshot.data()!;
        if (previous.requestHash !== requestHash || previous.entityId !== reportId) {
          throw new HttpError(409, 'requestId sudah digunakan untuk laporan berbeda.');
        }
        return { reportId, status: previous.resultingStatus, idempotent: true };
      }
      if (!employeeSnapshot.exists) {
        throw new HttpError(404, 'Data Pekarya yang terhubung tidak ditemukan.');
      }
      const employee = employeeSnapshot.data()!;
      const storedJobCategory = employee.employment?.jobCategory;
      const permittedFallback = actor.permittedCategories.find(isPekaryaJobCategory);
      const jobCategory = isPekaryaJobCategory(storedJobCategory)
        ? storedJobCategory
        : permittedFallback;
      if (!jobCategory) {
        throw new HttpError(409, 'Pegawai tidak aktif atau kategori tidak mendukung laporan ini.');
      }
      if (isPhotoOnlyReport && jobCategory !== 'SATPAM') {
        throw new HttpError(403, 'Laporan ini hanya dapat diajukan oleh Satpam.');
      }
      if (
        jobCategory === 'SATPAM' &&
        !isPhotoOnlyReport &&
        !/^([01]\d|2[0-3]):([0-5]\d)$/.test(command.timeEnd || '')
      ) {
        throw new HttpError(
          400,
          'SPJ pribadi Satpam wajib memiliki waktu selesai.',
        );
      }
      const identityAnomalies: string[] = [];
      if (
        employee.employment?.status !== 'active' &&
        employee.flags?.isActive !== true
      ) {
        identityAnomalies.push('EMPLOYEE_STATUS_NEEDS_REVIEW');
      }
      if (!isPekaryaJobCategory(storedJobCategory)) {
        identityAnomalies.push('EMPLOYEE_CATEGORY_NEEDS_REVIEW');
      }
      if (
        !isPhotoOnlyReport &&
        jobCategory !== 'SOPIR' &&
        (jobCategory === 'SATPAM' || command.activityType !== 'Buang Sampah')
      ) {
        try {
          activityDurationMinutes(command.timeStart, command.timeEnd || '');
        } catch (error) {
          throw new HttpError(
            400,
            error instanceof Error ? error.message : 'Durasi tidak valid.',
          );
        }
      }
      assertPeriodAcceptsInput(periodSnapshot.data());
      if (slipSnapshot.exists && isImmutablePayrollStatus(slipSnapshot.data()?.status)) {
        throw new HttpError(409, 'Slip periode ini sudah dikunci; ajukan koreksi resmi.');
      }
      const before = reportSnapshot.exists ? reportSnapshot.data()! : null;
      if (command.reportId) {
        if (!reportSnapshot.exists || before?.employeeId !== employeeId) {
          throw new HttpError(404, 'Laporan yang akan diajukan ulang tidak ditemukan.');
        }
        if (
          before?.reportKind === 'satpam_shift_assignment' ||
          Boolean(before?.sourceOccurrenceId)
        ) {
          throw new HttpError(
            409,
            'Laporan shift hanya dapat diubah dari menu Lapor Shift Regu.',
          );
        }
        if (!['pending', 'declined'].includes(before.status)) {
          throw new HttpError(409, 'Laporan yang sudah disetujui tidak dapat diubah.');
        }
        const existingKind =
          before.reportKind ||
          (jobCategory === 'SATPAM' ? 'satpam_spj' : 'pekarya_activity');
        const requestedKind = isFoundItem
          ? 'satpam_found_item'
          : isReprimand
            ? 'satpam_reprimand'
            : jobCategory === 'SATPAM'
              ? 'satpam_spj'
              : 'pekarya_activity';
        if (existingKind !== requestedKind) {
          throw new HttpError(409, 'Jenis laporan tidak dapat diubah setelah dibuat.');
        }
      } else if (reportSnapshot.exists) {
        throw new HttpError(409, 'ID laporan sudah ada.');
      }
      if (indexSnapshot.exists && indexSnapshot.data()?.reportId !== reportId) {
        throw new HttpError(409, 'Kegiatan yang sama sudah pernah dilaporkan.');
      }

      const driverData = sanitizeDriverData(
        command.driverData,
        jobCategory,
        command.activityDate,
      );
      if (jobCategory === 'SOPIR') {
        try {
          const journeyTimings = calculateJourneyDateTimeTimings({
            dateStart: String(driverData.dateStart || command.activityDate),
            dateEnd: String(driverData.dateEnd || driverData.dateStart || command.activityDate),
            timeStart: command.timeStart,
            timeEnd: command.timeEnd || '',
            isMultiDay: driverData.isMultiDay === true,
          });
          if (journeyTimings.durationHours <= 0) {
            throw new Error('Jam tiba dan tanggal tidak membentuk durasi perjalanan yang valid.');
          }
          const actualJourneyDurationHours = journeyTimings.durationHours;
          const distanceKm = typeof driverData.distanceKm === 'number' ? driverData.distanceKm : 0;
          const nightCount = typeof driverData.nightCount === 'number' ? driverData.nightCount : 0;
          driverData.durationHours = actualJourneyDurationHours;
          driverData.componentWaktu = Math.ceil(actualJourneyDurationHours * 5_000);
          driverData.nightPremium = calculateNightPremium(nightCount);
          driverData.baseDriverWage = calculateDriverNetWage(
            distanceKm,
            actualJourneyDurationHours,
            nightCount,
          );
          driverData.upahBersih = driverData.baseDriverWage;
          const vehicleType =
            typeof driverData.vehicleType === 'string' ? driverData.vehicleType : '';
          const ndalemMealMoneyReceived = Number(driverData.ndalemMealMoneyReceived ?? 0);
          const actualMealAllowance = getMealAllowanceForDuration(
            actualJourneyDurationHours,
            vehicleType,
            ndalemMealMoneyReceived,
          );
          const preAuthorizedMeal =
            typeof driverData.preAuthorizedMeal === 'number'
              ? driverData.preAuthorizedMeal
              : 0;
          driverData.actualJourneyDurationHours = actualJourneyDurationHours;
          driverData.actualMealAllowance = actualMealAllowance;
          driverData.extraMealAllowance = Math.max(
            0,
            actualMealAllowance - preAuthorizedMeal,
          );
        } catch (error) {
          throw new HttpError(
            400,
            error instanceof Error ? error.message : 'Durasi perjalanan tidak valid.',
          );
        }
      }
      const journeyId = typeof driverData.journeyId === 'string' ? driverData.journeyId : null;
      let journeyRef: FirebaseFirestore.DocumentReference | null = null;
      let journeyBefore: FirebaseFirestore.DocumentData | null = null;
      if (journeyId) {
        journeyRef = adminDb.collection('DriverJourneys').doc(journeyId);
        const journeySnapshot = await transaction.get(journeyRef);
        if (!journeySnapshot.exists) {
          throw new HttpError(404, 'Perjalanan dinas tidak ditemukan.');
        }
        journeyBefore = journeySnapshot.data()!;
        const ownsJourney =
          journeyBefore.employeeId === employeeId ||
          journeyBefore.assignedTo === employeeId;
        if (!ownsJourney || !['claimed', 'submitted', 'completed'].includes(journeyBefore.status)) {
          throw new HttpError(409, 'Perjalanan dinas tidak dimiliki oleh pegawai ini.');
        }
        const vehicleType =
          typeof driverData.vehicleType === 'string' ? driverData.vehicleType : '';
        const authorizedDurationHours = Number(
          journeyBefore.customDurationPP ||
            (journeyBefore.durationHours ? journeyBefore.durationHours * 2 : 0),
        );
        const preAuthorizedMeal =
          vehicleType === 'Ndalem'
            ? 0
            : typeof journeyBefore.mealAllowance === 'number' &&
                journeyBefore.mealAllowance > 0
              ? journeyBefore.mealAllowance
              : getMealAllowanceForDuration(authorizedDurationHours, vehicleType);
        const preAuthorizedToll = Number(
          journeyBefore.preAuthorizedToll !== undefined && journeyBefore.preAuthorizedToll !== null
            ? journeyBefore.preAuthorizedToll
            : (journeyBefore.status === 'claimed' ? journeyBefore.tollParkingFee || 0 : 0)
        );
        const baseOperationalCost =
          typeof journeyBefore.baseOperationalCost === 'number'
            ? journeyBefore.baseOperationalCost
            : Math.max(
                0,
                Number(journeyBefore.totalOperationalCost || 0) -
                  preAuthorizedMeal -
                  preAuthorizedToll,
              );
        const fuelFee = Number(driverData.fuelFee || 0);
        const tollParkingFee = Number(driverData.tollParkingFee || 0);
        const actualMealAllowance = Number(driverData.actualMealAllowance || 0);
        const extraFuelCost =
          vehicleType === 'Ndalem' ? 0 : Math.max(0, fuelFee - baseOperationalCost);
        const extraTollCost = Math.max(0, tollParkingFee - preAuthorizedToll);
        const extraMealAllowance =
          vehicleType === 'Ndalem'
            ? actualMealAllowance
            : Math.max(0, actualMealAllowance - preAuthorizedMeal);
        const positiveReimburseDelta =
          extraFuelCost + extraTollCost + extraMealAllowance;
        const totalPreAuthorizedAllowance = baseOperationalCost + preAuthorizedToll;
        const totalActualSpent = fuelFee + tollParkingFee;
        const unspentCash = Math.max(
          0,
          totalPreAuthorizedAllowance - totalActualSpent,
        );

        Object.assign(driverData, {
          preAuthorizedMeal,
          preAuthorizedToll,
          customDurationPP: authorizedDurationHours,
          baseOperationalCost,
          extraFuelCost,
          extraTollCost,
          extraMealAllowance,
          positiveReimburseDelta,
          totalPreAuthorizedAllowance,
          totalActualSpent,
          unspentCash,
          reimburseDelta: Math.max(0, positiveReimburseDelta - unspentCash),
          remainingUnspentCash: Math.max(0, unspentCash - positiveReimburseDelta),
          totalOperationalCost: Number(journeyBefore.totalOperationalCost || 0),
          vehicleRate: Number(journeyBefore.vehicleRate || 0),
        });
      }

      const now = admin.firestore.FieldValue.serverTimestamp();
      const after = {
        employeeId,
        employeeName: String(employee.name || actor.displayName || ''),
        jobCategory,
        reportKind: isFoundItem
          ? 'satpam_found_item'
          : isReprimand
            ? 'satpam_reprimand'
            : jobCategory === 'SATPAM'
              ? 'satpam_spj'
              : 'pekarya_activity',
        period: payrollPeriod,
        payrollPeriod,
        activityName: command.activityName,
        activityType: command.activityType,
        activityDate: command.activityDate,
        timeStart: isPhotoOnlyReport ? '' : command.timeStart,
        timeEnd:
          isPhotoOnlyReport || command.activityType === 'Buang Sampah'
            ? ''
            : command.timeEnd,
        crossesMidnight:
          !isPhotoOnlyReport &&
          command.activityType !== 'Buang Sampah' &&
          (jobCategory === 'SOPIR'
            ? Number(driverData.nightCount || 0) > 0
            : Boolean(command.timeEnd && command.timeEnd < command.timeStart)),
        status: 'pending',
        fee: 0,
        declineReason: '',
        reviewedAt: null,
        reviewedBy: null,
        submittedAt: now,
        firstSubmittedAt: before?.firstSubmittedAt || before?.submittedAt || now,
        submissionRevision: Number(before?.submissionRevision || 0) + 1,
        source: isFoundItem
          ? 'satpam_found_item_form'
          : isReprimand
            ? 'satpam_reprimand_form'
            : jobCategory === 'SOPIR'
              ? 'honorer_driver_report'
              : 'honorer_activity_form',
        identityAnomalies,
        schemaVersion: isPhotoOnlyReport ? 3 : 2,
        ...driverData,
        ...(command.proofPhoto
          ? {
              photoUrl: command.proofPhoto.url,
              photoAuditMetadata: command.proofPhoto.auditMetadata,
            }
          : {}),
        ...(isPhotoOnlyReport
          ? {
              itemName: command.activityName,
              proofPhotos: command.proofPhotos,
              photoUrl: command.proofPhotos![0].url,
              photoAuditMetadata: command.proofPhotos![0].auditMetadata,
              submittedFeeRecommendation: isFoundItem
                ? SATPAM_FOUND_ITEM_RECOMMENDED_FEE
                : SATPAM_REPRIMAND_RECOMMENDED_FEE,
            }
          : {}),
        // Employee-submitted calculations are evidence only. The approved
        // financial amount remains zero until Kepala SatKer reviews it.
        submittedFeeEstimate:
          typeof driverData.upahBersih === 'number' ? driverData.upahBersih : 0,
        upahBersih: 0,
      };

      transaction.set(reportRef, after);
      transaction.create(
        adminDb
          .collection('ActivityReportRevisions')
          .doc(`${reportId}__r${after.submissionRevision}`),
        {
          reportId,
          employeeId,
          payrollPeriod,
          reportKind: after.reportKind,
          revision: after.submissionRevision,
          submittedAt: now,
          submittedBy: actor.uid,
          snapshot: after,
          schemaVersion: 1,
        },
      );
      transaction.set(indexRef, {
        reportId,
        employeeId,
        payrollPeriod,
        createdAt: indexSnapshot.exists ? indexSnapshot.data()?.createdAt : now,
        updatedAt: now,
      });
      if (journeyRef) {
        const journeyEvidence = { ...driverData };
        delete journeyEvidence.journeyId;
        const submittedUpahEstimate =
          typeof journeyEvidence.upahBersih === 'number' ? journeyEvidence.upahBersih : 0;
        delete journeyEvidence.upahBersih;
        const submittedDistanceKm =
          typeof journeyEvidence.distanceKm === 'number' ? journeyEvidence.distanceKm : 0;
        const submittedDurationHours =
          typeof journeyEvidence.durationHours === 'number' ? journeyEvidence.durationHours : 0;
        const submittedVehicleType =
          typeof journeyEvidence.vehicleType === 'string' ? journeyEvidence.vehicleType : '';
        const submittedTripType =
          typeof journeyEvidence.tripType === 'string' ? journeyEvidence.tripType : '';
        const submittedEndPoint =
          typeof journeyEvidence.reportedEndPoint === 'string'
            ? journeyEvidence.reportedEndPoint.trim()
            : '';
        delete journeyEvidence.distanceKm;
        delete journeyEvidence.durationHours;
        delete journeyEvidence.vehicleType;
        delete journeyEvidence.tripType;
        delete journeyEvidence.reportedEndPoint;
        delete journeyEvidence.fuelReceiptEvidence;
        delete journeyEvidence.tollReceiptEvidence;
        const submittedPoints = Array.isArray(driverData.points) ? driverData.points : [];
        const submittedExtraActivities = Array.isArray(driverData.extraActivities)
          ? driverData.extraActivities
          : [];
        const shouldClearFuelReceiptEvidence =
          Number(driverData.fuelFee || 0) <= 0 ||
          !String(driverData.fuelReceiptUrl || '').trim();
        const shouldClearTollReceiptEvidence =
          Number(driverData.tollParkingFee || 0) <= 0 ||
          !String(driverData.tollReceiptUrl || '').trim();
        const journeyUpdate: Record<string, unknown> = {
          ...journeyEvidence,
          status: 'submitted',
          period: payrollPeriod,
          payrollPeriod,
          activityDocId: reportId,
          activityDate: command.activityDate,
          timeStart: command.timeStart,
          timeEnd: command.timeEnd,
          dateStart: driverData.dateStart,
          dateEnd: driverData.dateEnd,
          isMultiDay: driverData.isMultiDay === true,
          nightCount: driverData.nightCount,
          nightPremium: driverData.nightPremium,
          baseDriverWage: driverData.baseDriverWage,
          upahBersih: submittedUpahEstimate,
          componentJarak: driverData.componentJarak,
          componentWaktu: driverData.componentWaktu,
          routeDurationHours: driverData.routeDurationHours,
          points: submittedPoints,
          extraActivities: submittedExtraActivities,
          submittedUpahEstimate,
          submittedDistanceKm,
          submittedDurationHours,
          submittedVehicleType,
          submittedTripType,
          newTotalDistanceKm: submittedDistanceKm,
          newTotalDurationHours: submittedDurationHours,
          submittedAt: now,
          updatedAt: now,
          draftDate: admin.firestore.FieldValue.delete(),
          draftDateEnd: admin.firestore.FieldValue.delete(),
          draftIsMultiDay: admin.firestore.FieldValue.delete(),
          draftTimeStart: admin.firestore.FieldValue.delete(),
          draftTimeEnd: admin.firestore.FieldValue.delete(),
          draftNightCount: admin.firestore.FieldValue.delete(),
          draftNdalemMealMoneyReceived: admin.firestore.FieldValue.delete(),
          draftFuelFee: admin.firestore.FieldValue.delete(),
          draftTollParkingFee: admin.firestore.FieldValue.delete(),
          draftFuelReceiptUrl: admin.firestore.FieldValue.delete(),
          draftTollReceiptUrl: admin.firestore.FieldValue.delete(),
          draftFuelReceiptEvidence: admin.firestore.FieldValue.delete(),
          draftTollReceiptEvidence: admin.firestore.FieldValue.delete(),
          draftExtraActivities: admin.firestore.FieldValue.delete(),
          draftCalculatedDistanceKm: admin.firestore.FieldValue.delete(),
          draftCalculatedDurationHours: admin.firestore.FieldValue.delete(),
          draftEndPoint: admin.firestore.FieldValue.delete(),
        };
        journeyUpdate.fuelReceiptEvidence = shouldClearFuelReceiptEvidence
          ? admin.firestore.FieldValue.delete()
          : (driverData.fuelReceiptEvidence ?? admin.firestore.FieldValue.delete());
        journeyUpdate.tollReceiptEvidence = shouldClearTollReceiptEvidence
          ? admin.firestore.FieldValue.delete()
          : (driverData.tollReceiptEvidence ?? admin.firestore.FieldValue.delete());
        if (submittedEndPoint) journeyUpdate.endPoint = submittedEndPoint;
        transaction.update(journeyRef, {
          ...journeyUpdate,
        });
      }
      transaction.create(
        newFinancialAuditRef(),
        buildFinancialAuditRecord(actor, {
          action: before ? 'PEKARYA_ACTIVITY_RESUBMITTED' : 'PEKARYA_ACTIVITY_SUBMITTED',
          entityType: 'ActivityReport',
          entityId: reportId,
          reason: before ? 'Pengajuan ulang laporan kegiatan Pekarya' : 'Pengajuan laporan kegiatan Pekarya',
          requestId: command.requestId,
          before,
          after,
          metadata: { payrollPeriod, jobCategory, journeyId },
        }),
      );
      transaction.create(idempotencyRef, {
        requestHash,
        entityId: reportId,
        resultingStatus: 'pending',
        createdAt: now,
      });
      return { reportId, status: 'pending', payrollPeriod, idempotent: false };
    });

    return Response.json(result, { status: 201 });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const actor = await requireAuthenticatedProfile(request);
    requireRole(actor, ['honorer', 'ketua_shift_satpam']);
    const { searchParams } = new URL(request.url);
    const reportId = searchParams.get('reportId');
    const journeyIdParam = searchParams.get('journeyId');

    if (!reportId && !journeyIdParam) {
      throw new HttpError(400, 'Parameter reportId atau journeyId harus diisi.');
    }

    const employeeId = actor.linkedEmployeeId;
    if (!employeeId) {
      throw new HttpError(403, 'Profil Anda belum terhubung dengan data pegawai.');
    }

    const result = await adminDb.runTransaction(async (transaction) => {
      // ── READ PHASE ──
      let targetReportRef: FirebaseFirestore.DocumentReference | null = null;
      let reportData: FirebaseFirestore.DocumentData | null = null;

      if (reportId) {
        targetReportRef = adminDb.collection('ActivityReports').doc(reportId);
        const reportSnap = await transaction.get(targetReportRef);
        if (reportSnap.exists) {
          reportData = reportSnap.data()!;
        }
      }

      if (!reportData && journeyIdParam) {
        const arQuery = adminDb.collection('ActivityReports').where('journeyId', '==', journeyIdParam);
        const arSnap = await transaction.get(arQuery);
        if (!arSnap.empty) {
          targetReportRef = arSnap.docs[0].ref;
          reportData = arSnap.docs[0].data();
        }
      }

      if (reportData && targetReportRef) {
        if (reportData.employeeId !== employeeId) {
          throw new HttpError(403, 'Laporan kegiatan ini bukan milik Anda.');
        }
        if (isImmutablePayrollStatus(reportData.status)) {
          throw new HttpError(409, 'Laporan yang telah disetujui tidak dapat dihapus.');
        }
      }

      const targetJourneyId = journeyIdParam || (reportData ? reportData.journeyId : null);
      let jRef: FirebaseFirestore.DocumentReference | null = null;
      let jData: FirebaseFirestore.DocumentData | null = null;

      if (targetJourneyId) {
        jRef = adminDb.collection('DriverJourneys').doc(targetJourneyId);
        const jSnap = await transaction.get(jRef);
        if (jSnap.exists) {
          jData = jSnap.data()!;
        }
      }

      // ── WRITE PHASE ──
      if (reportData && targetReportRef) {
        transaction.delete(targetReportRef);
        const identity = buildPekaryaActivityIdentity(
          employeeId,
          String(reportData.activityDate || ''),
          String(reportData.timeStart || ''),
          reportData.timeEnd ? String(reportData.timeEnd) : undefined,
          String(reportData.activityName || ''),
        );
        transaction.delete(adminDb.collection('PekaryaActivityIndexes').doc(identity));
        // Remove the old collection entry as a compatibility cleanup for data
        // written before the index collection was renamed.
        transaction.delete(adminDb.collection('ActivityReportsIndex').doc(targetReportRef.id));
      }

      if (jData && jRef && targetJourneyId) {
        const owns = jData.employeeId === employeeId || jData.claimedBy === actor.uid || jData.assignedTo === employeeId;
        if (owns) {
          const isSelfCreated = Boolean(
            jData.isSelfCreatedPiketSpj || targetJourneyId.startsWith('JRN-PIKET-'),
          );
          if (isSelfCreated) {
            transaction.delete(jRef);
          } else {
            transaction.update(jRef, {
              status: jData.assignedTo ? 'assigned' : 'unassigned',
              activityDocId: admin.firestore.FieldValue.delete(),
              employeeId: admin.firestore.FieldValue.delete(),
              employeeName: admin.firestore.FieldValue.delete(),
              claimedBy: admin.firestore.FieldValue.delete(),
              claimedByName: admin.firestore.FieldValue.delete(),
              claimedAt: admin.firestore.FieldValue.delete(),
              draftTimeStart: admin.firestore.FieldValue.delete(),
              draftTimeEnd: admin.firestore.FieldValue.delete(),
              draftNightCount: admin.firestore.FieldValue.delete(),
              draftFuelFee: admin.firestore.FieldValue.delete(),
              draftTollParkingFee: admin.firestore.FieldValue.delete(),
              draftFuelReceiptUrl: admin.firestore.FieldValue.delete(),
              draftTollReceiptUrl: admin.firestore.FieldValue.delete(),
              draftExtraActivities: admin.firestore.FieldValue.delete(),
              draftCalculatedDistanceKm: admin.firestore.FieldValue.delete(),
              draftCalculatedDurationHours: admin.firestore.FieldValue.delete(),
              updatedAt: admin.firestore.FieldValue.serverTimestamp(),
            });
          }
        }
      }

      transaction.create(
        newFinancialAuditRef(),
        buildFinancialAuditRecord(actor, {
          action: 'PEKARYA_ACTIVITY_DELETED',
          entityType: 'ActivityReport',
          entityId: reportId || targetJourneyId || 'deleted_report',
          reason: 'Penghapusan/pembatalan laporan kegiatan Pekarya/Sopir',
          requestId: `del_${Date.now()}`,
          before: reportData || null,
          after: null,
          metadata: { targetJourneyId },
        }),
      );

      return { success: true, message: 'Laporan berhasil dihapus.' };
    });

    return Response.json(result, { status: 200 });
  } catch (error) {
    return errorResponse(error);
  }
}
