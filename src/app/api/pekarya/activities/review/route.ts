import { createHash } from 'node:crypto';
import { NextRequest } from 'next/server';
import admin, { adminDb } from '@/lib/firebase-admin';
import {
  assertRequestId,
  hasActivityEnded,
  isImmutablePayrollStatus,
} from '@/lib/payroll/domain';
import {
  assertNightCount,
  calculateDriverNetWage,
  calculateJourneyElapsedHours,
  calculateNightPremium,
  getMealAllowanceForDuration,
} from '@/lib/payroll/driverJourney';
import {
  activityDurationMinutes,
  approvedActivitySpjAmount,
  pekaryaPayrollPeriodForDate,
  satpamFoundItemFeeNeedsAdjustmentReason,
} from '@/lib/payroll/pekaryaSpj';
import { buildFinancialAuditRecord, newFinancialAuditRef } from '@/lib/server/audit';
import {
  errorResponse,
  HttpError,
  requireAuthenticatedProfile,
  requireRole,
} from '@/lib/server/auth';
import {
  annualCalendarRef,
  annualDatesFrom,
  assertPeriodAcceptsInput,
  buildPeriodMaterialization,
} from '@/lib/server/payrollPeriod';

export const dynamic = 'force-dynamic';

type ReviewAction = 'approve' | 'decline' | 'approve_driver';

interface ReviewItem {
  reportId: string;
  fee?: number;
  hasUangMakan?: boolean;
  reason?: string;
  driverReview?: {
    distanceKm: number;
    durationHours: number;
    fuelDelta: number;
    tollDelta: number;
    mealDelta: number;
    vehicleType: string;
    nightCount: number;
    points: string[];
  };
}

interface ReviewCommand {
  requestId: string;
  action: ReviewAction;
  items: ReviewItem[];
  reason: string;
}

function parseMoney(value: unknown, name: string, allowZero = true): number {
  if (
    typeof value !== 'number' ||
    !Number.isSafeInteger(value) ||
    value < (allowZero ? 0 : 1) ||
    value > 100_000_000
  ) {
    throw new HttpError(400, `${name} tidak valid.`);
  }
  return value;
}

function parseCommand(raw: unknown): ReviewCommand {
  if (!raw || typeof raw !== 'object') throw new HttpError(400, 'Perintah review tidak valid.');
  const value = raw as Partial<ReviewCommand>;
  if (typeof value.requestId !== 'string') throw new HttpError(400, 'requestId wajib diisi.');
  try {
    assertRequestId(value.requestId);
  } catch (error) {
    throw new HttpError(400, error instanceof Error ? error.message : 'requestId tidak valid.');
  }
  if (!value.action || !['approve', 'decline', 'approve_driver'].includes(value.action)) {
    throw new HttpError(400, 'Aksi review tidak valid.');
  }
  if (!Array.isArray(value.items) || value.items.length < 1 || value.items.length > 50) {
    throw new HttpError(400, 'Review harus memuat 1 sampai 50 laporan.');
  }
  const reason = typeof value.reason === 'string' ? value.reason.trim() : '';
  if (reason.length < 8 || reason.length > 500) {
    throw new HttpError(400, 'Alasan review wajib diisi antara 8 dan 500 karakter.');
  }
  const items = value.items.map((item) => {
    if (
      !item ||
      typeof item !== 'object' ||
      typeof item.reportId !== 'string' ||
      !/^[A-Za-z0-9_-]{1,180}$/.test(item.reportId)
    ) {
      throw new HttpError(400, 'ID laporan review tidak valid.');
    }
    if (value.action === 'approve') parseMoney(item.fee, 'Nominal SPJ', false);
    return item;
  });
  if (new Set(items.map((item) => item.reportId)).size !== items.length) {
    throw new HttpError(400, 'Laporan review tidak boleh duplikat.');
  }
  return { requestId: value.requestId, action: value.action, items, reason };
}

function validateDriverReview(value: ReviewItem['driverReview']) {
  if (!value) throw new HttpError(400, 'Rincian audit Sopir wajib diisi.');
  if (
    !Number.isFinite(value.distanceKm) ||
    value.distanceKm <= 0 ||
    value.distanceKm > 10_000 ||
    !Number.isFinite(value.durationHours) ||
    value.durationHours <= 0 ||
    value.durationHours > 10_000
  ) {
    throw new HttpError(400, 'Jarak atau durasi audit Sopir tidak valid.');
  }
  try {
    assertNightCount(value.nightCount);
  } catch (error) {
    throw new HttpError(
      400,
      error instanceof Error ? error.message : 'Jumlah malam tidak valid.',
    );
  }
  for (const [label, number] of [
    ['selisih BBM', value.fuelDelta],
    ['selisih tol', value.tollDelta],
    ['selisih makan', value.mealDelta],
  ] as const) {
    if (!Number.isFinite(number) || number < 0 || number > 100_000_000) {
      throw new HttpError(400, `Nilai ${label} tidak valid.`);
    }
  }
  if (
    typeof value.vehicleType !== 'string' ||
    value.vehicleType.length < 2 ||
    value.vehicleType.length > 80 ||
    !Array.isArray(value.points) ||
    value.points.length < 2 ||
    value.points.length > 30 ||
    value.points.some((point) => typeof point !== 'string' || point.length > 300)
  ) {
    throw new HttpError(400, 'Kendaraan atau rute audit Sopir tidak valid.');
  }
  return value;
}

function vehicleRate(vehicle: string): number {
  const rates: Record<string, number> = {
    Bis: 2500,
    Elf: 1350,
    'Kijang LGX': 1200,
    'Innova Hitam': 1250,
    'Innova Matic': 1450,
    Suzuki: 1000,
    'Suzuki XL7': 1000,
    Ndalem: 0,
  };
  return rates[vehicle] ?? 1000;
}

export async function POST(request: NextRequest) {
  try {
    const actor = await requireAuthenticatedProfile(request);
    requireRole(actor, ['super_admin', 'satker_head']);
    const command = parseCommand(await request.json());
    const requestHash = createHash('sha256').update(JSON.stringify(command)).digest('hex');

    const result = await adminDb.runTransaction(async (transaction) => {
      const idempotencyRef = adminDb
        .collection('FinancialIdempotencyKeys')
        .doc(`${actor.uid}__${command.requestId}`);
      const reportRefs = command.items.map((item) =>
        adminDb.collection('ActivityReports').doc(item.reportId),
      );
      const [idempotencySnapshot, ...reportSnapshots] = await Promise.all([
        transaction.get(idempotencyRef),
        ...reportRefs.map((ref) => transaction.get(ref)),
      ]);
      if (idempotencySnapshot.exists) {
        const previous = idempotencySnapshot.data()!;
        if (previous.requestHash !== requestHash) {
          throw new HttpError(409, 'requestId sudah digunakan untuk review berbeda.');
        }
        return { reviewed: previous.reviewedCount, idempotent: true };
      }

      const reports = reportSnapshots.map((snapshot, index) => {
        if (!snapshot.exists) {
          throw new HttpError(404, `Laporan ${command.items[index].reportId} tidak ditemukan.`);
        }
        return snapshot.data()!;
      });
      const reportPeriods = reports.map((report) => {
        if (typeof report.payrollPeriod === 'string') return report.payrollPeriod;
        if (typeof report.activityDate !== 'string') {
          throw new HttpError(409, 'Tanggal kegiatan historis tidak valid.');
        }
        return pekaryaPayrollPeriodForDate(report.activityDate);
      });
      const periodRefs = reportPeriods.map((period) =>
        adminDb.collection('PayrollPeriods').doc(period),
      );
      const slipRefs = reports.map((report, index) =>
        adminDb
          .collection('PayrollSlipStates')
          .doc(`${reportPeriods[index].replace('-', '_')}_${report.employeeId}`),
      );
      const employeeRefs = reports.map((report) =>
        adminDb.collection('Employees_BlueCollar').doc(String(report.employeeId || '')),
      );
      const journeyRefs = reports.map((report) =>
        report.journeyId ? adminDb.collection('DriverJourneys').doc(report.journeyId) : null,
      );
      const annualRefs = reportPeriods.map((period) => annualCalendarRef(period));
      const secondarySnapshots = await Promise.all([
        ...periodRefs.map((ref) => transaction.get(ref)),
        ...slipRefs.map((ref) => transaction.get(ref)),
        ...employeeRefs.map((ref) => transaction.get(ref)),
        ...journeyRefs.map((ref) => (ref ? transaction.get(ref) : Promise.resolve(null))),
        ...annualRefs.map((ref) => transaction.get(ref)),
      ]);
      const periodSnapshots = secondarySnapshots.slice(0, reports.length);
      const slipSnapshots = secondarySnapshots.slice(reports.length, reports.length * 2);
      const employeeSnapshots = secondarySnapshots.slice(
        reports.length * 2,
        reports.length * 3,
      );
      const journeySnapshots = secondarySnapshots.slice(
        reports.length * 3,
        reports.length * 4,
      );
      const annualSnapshots = secondarySnapshots.slice(reports.length * 4);

      const now = admin.firestore.FieldValue.serverTimestamp();
      // Periods are open by default, so an approval may be the first event that
      // gives a month a document. Freezing its calendar here means every fee
      // approved from this point is rated against a snapshot that a later
      // premium-date edit cannot retroactively change.
      const materializedPeriods = new Set<string>();
      reports.forEach((before, index) => {
        const item = command.items[index];
        const category = String(before.jobCategory || '');
        if (category === 'SATPAM' && Boolean(before.sourceOccurrenceId)) {
          throw new HttpError(409, 'Shift Satpam memakai alur verifikasi khusus.');
        }
        if (
          actor.role === 'satker_head' &&
          !actor.permittedCategories.includes(category)
        ) {
          throw new HttpError(403, `Anda tidak memiliki akses kategori ${category}.`);
        }
        if (before.status !== 'pending') {
          throw new HttpError(409, `Laporan ${item.reportId} sudah pernah direview.`);
        }
        const employee = employeeSnapshots[index]?.data();
        if (
          !employeeSnapshots[index]?.exists ||
          (employee?.employment?.status !== 'active' &&
            employee?.flags?.isActive !== true) ||
          employee?.employment?.jobCategory !== category
        ) {
          throw new HttpError(409, 'Data pegawai tidak aktif atau kategori laporan tidak cocok.');
        }
        if (
          command.action !== 'decline' &&
          category === 'SATPAM' &&
          before.reportKind === 'satpam_spj' &&
          !hasActivityEnded(
            String(before.activityDate || ''),
            String(before.timeStart || ''),
            String(before.timeEnd || ''),
          )
        ) {
          throw new HttpError(
            409,
            'Kegiatan ini belum selesai. SPJ dapat diaudit setelah waktu selesai terlewati.',
          );
        }
        assertPeriodAcceptsInput(periodSnapshots[index]?.data());
        if (slipSnapshots[index]?.exists && isImmutablePayrollStatus(slipSnapshots[index]?.data()?.status)) {
          throw new HttpError(409, 'Slip pegawai sudah dikunci; gunakan alur koreksi.');
        }

        let after: Record<string, unknown>;
        if (command.action === 'decline') {
          after = {
            ...before,
            status: 'declined',
            fee: 0,
            upahBersih: 0,
            declineReason: item.reason?.trim() || command.reason,
            reviewedAt: now,
            reviewedBy: actor.uid,
            reviewedByRole: actor.role,
            reviewRevision: Number(before.reviewRevision || 0) + 1,
          };
        } else if (command.action === 'approve_driver') {
          if (category !== 'SOPIR') {
            throw new HttpError(409, 'Audit Sopir hanya berlaku untuk kategori SOPIR.');
          }
          const review = validateDriverReview(item.driverReview);
          const authorizedJourney = journeySnapshots[index]?.data();
          const rate = vehicleRate(review.vehicleType);
          const baseOperationalCost =
            typeof authorizedJourney?.baseOperationalCost === 'number'
              ? authorizedJourney.baseOperationalCost
              : typeof before.baseOperationalCost === 'number'
                ? before.baseOperationalCost
              : Math.ceil(review.distanceKm * rate);
          const upahBersih = calculateDriverNetWage(
            review.distanceKm,
            review.durationHours,
            review.nightCount,
          );
          const preAuthorizedMeal =
            review.vehicleType === 'Ndalem'
              ? 0
              : typeof authorizedJourney?.mealAllowance === 'number' &&
                  authorizedJourney.mealAllowance > 0
                ? authorizedJourney.mealAllowance
                : typeof before.preAuthorizedMeal === 'number' &&
                    before.preAuthorizedMeal > 0
                  ? before.preAuthorizedMeal
                : getMealAllowanceForDuration(
                    Number(
                      authorizedJourney?.customDurationPP ||
                        before.customDurationPP ||
                        0,
                    ),
                    review.vehicleType,
                  );
          let actualJourneyDurationHours: number;
          try {
            actualJourneyDurationHours = calculateJourneyElapsedHours(
              String(before.timeStart || ''),
              String(before.timeEnd || ''),
              review.nightCount,
            );
          } catch (error) {
            throw new HttpError(
              409,
              error instanceof Error ? error.message : 'Durasi perjalanan tidak valid.',
            );
          }
          const ndalemMealMoney = Number(before.ndalemMealMoneyReceived ?? 0);
          const actualMealAllowance = getMealAllowanceForDuration(
            actualJourneyDurationHours,
            review.vehicleType,
            ndalemMealMoney,
          );
          const mealDelta =
            review.vehicleType === 'Ndalem'
              ? actualMealAllowance
              : Math.max(0, actualMealAllowance - preAuthorizedMeal);
          const preAuthorizedToll =
            typeof authorizedJourney?.tollParkingFee === 'number'
              ? authorizedJourney.tollParkingFee
              : Number(before.preAuthorizedToll || 0);
          const totalPreAuthorizedAllowance = baseOperationalCost + preAuthorizedToll;
          const actualFuel = Math.max(0, baseOperationalCost + review.fuelDelta);
          const actualToll = Math.max(0, preAuthorizedToll + review.tollDelta);
          const totalActualSpent =
            actualFuel + actualToll;
          const unspentCash = Math.max(
            0,
            totalPreAuthorizedAllowance - totalActualSpent,
          );
          const positiveDelta =
            review.fuelDelta + review.tollDelta + mealDelta;
          const reimburseDelta = Math.max(0, positiveDelta - unspentCash);
          const totalOperationalCost = Math.max(
            0,
            Math.ceil(
              Number(
                authorizedJourney?.totalOperationalCost ||
                  before.totalOperationalCost ||
                  baseOperationalCost,
              ) +
                positiveDelta -
                unspentCash,
            ),
          );
          after = {
            ...before,
            status: 'approved',
            fee: upahBersih,
            upahBersih,
            totalOperationalCost,
            distanceKm: review.distanceKm,
            durationHours: review.durationHours,
            fuelFee: actualFuel,
            extraFuelCost: review.fuelDelta,
            tollParkingFee: actualToll,
            extraTollCost: review.tollDelta,
            preAuthorizedMeal,
            preAuthorizedToll,
            totalPreAuthorizedAllowance,
            totalActualSpent,
            unspentCash,
            actualJourneyDurationHours,
            actualMealAllowance,
            extraMealAllowance: mealDelta,
            reimburseDelta,
            vehicleType: review.vehicleType,
            vehicleRate: rate,
            baseOperationalCost,
            nightCount: review.nightCount,
            nightPremium: calculateNightPremium(review.nightCount),
            points: review.points,
            tripType: review.distanceKm > 50 ? 'Luar Kota' : 'Dalam Kota',
            declineReason: '',
            reviewedAt: now,
            reviewedBy: actor.uid,
            reviewedByRole: actor.role,
            reviewRevision: Number(before.reviewRevision || 0) + 1,
          };
        } else {
          if (category === 'SOPIR') {
            throw new HttpError(409, 'Laporan SOPIR wajib memakai audit perjalanan.');
          }
          const isFoundItem = before.reportKind === 'satpam_found_item';
          const isReprimand = before.reportKind === 'satpam_reprimand';
          const isPhotoOnlyReport = isFoundItem || isReprimand;
          if (!isPhotoOnlyReport && before.activityType !== 'Buang Sampah') {
            try {
              activityDurationMinutes(String(before.timeStart || ''), String(before.timeEnd || ''));
            } catch (error) {
              throw new HttpError(
                409,
                error instanceof Error ? error.message : 'Durasi laporan tidak valid.',
              );
            }
          }
          const fee = parseMoney(item.fee, 'Nominal SPJ', false);
          if (
            isPhotoOnlyReport &&
            satpamFoundItemFeeNeedsAdjustmentReason(fee) &&
            (typeof item.reason !== 'string' || item.reason.trim().length < 8)
          ) {
            throw new HttpError(
              400,
              'Alasan penyesuaian nominal laporan wajib diisi minimal 8 karakter.',
            );
          }
          after = {
            ...before,
            status: 'approved',
            fee,
            upahBersih: 0,
            hasUangMakan: isPhotoOnlyReport ? false : Boolean(item.hasUangMakan),
            declineReason: '',
            reviewedAt: now,
            reviewedBy: actor.uid,
            reviewedByRole: actor.role,
            reviewRevision: Number(before.reviewRevision || 0) + 1,
          };
        }

        after = { ...after, payrollPeriod: reportPeriods[index] };
        if (
          command.action !== 'decline' &&
          !materializedPeriods.has(reportPeriods[index])
        ) {
          materializedPeriods.add(reportPeriods[index]);
          const materialization = buildPeriodMaterialization({
            period: reportPeriods[index],
            periodData: periodSnapshots[index]?.data(),
            annualDates: annualDatesFrom(annualSnapshots[index]),
            actorUid: actor.uid,
            reason: `Kalender periode dibekukan saat persetujuan SPJ ${reportPeriods[index]}`,
          });
          if (materialization) {
            transaction.set(periodRefs[index], materialization, { merge: true });
          }
        }
        transaction.set(reportRefs[index], after);
        const amount = approvedActivitySpjAmount(after);
        if (amount > 0) {
          const ledgerRef = adminDb
            .collection('PayrollLedgerEntries')
            .doc(`SPJ_ACTIVITY__${item.reportId}`);
          transaction.create(ledgerRef, {
            employeeId: before.employeeId,
            jobCategory: category,
            period: reportPeriods[index],
            sourceType: 'ActivityReport',
            sourceId: item.reportId,
            ...(category === 'SATPAM' &&
            (before.reportKind === 'satpam_spj' ||
              before.reportKind === 'satpam_found_item' ||
              before.reportKind === 'satpam_reprimand')
              ? { reportKind: before.reportKind }
              : {}),
            earningCode: 'SPJ',
            amount,
            status: 'active',
            approvedAt: now,
            approvedBy: actor.uid,
            schemaVersion: 1,
          });
        }
        const journeySnapshot = journeySnapshots[index];
        if (before.journeyId && journeyRefs[index] && journeySnapshot?.exists) {
          const driverReviewUpdate =
            command.action === 'approve_driver'
              ? {
                  totalOperationalCost: after.totalOperationalCost || 0,
                  newTotalDistanceKm: after.distanceKm || 0,
                  newTotalDurationHours: after.durationHours || 0,
                  fuelFee: after.fuelFee || 0,
                  extraFuelCost: after.extraFuelCost || 0,
                  tollParkingFee: after.tollParkingFee || 0,
                  extraTollCost: after.extraTollCost || 0,
                  extraMealAllowance: after.extraMealAllowance || 0,
                  reimburseDelta: after.reimburseDelta || 0,
                  vehicleName: after.vehicleType || '',
                  vehicleRate: after.vehicleRate || 0,
                  baseOperationalCost: after.baseOperationalCost || 0,
                  nightCount: after.nightCount ?? 0,
                  nightPremium: after.nightPremium || 0,
                  points: after.points || [],
                }
              : {};
          transaction.update(journeyRefs[index]!, {
            ...driverReviewUpdate,
            status: command.action === 'decline' ? 'declined' : 'completed',
            fee: command.action === 'decline' ? 0 : (after.totalOperationalCost || 0),
            upahBersih: command.action === 'decline' ? 0 : (after.upahBersih || 0),
            declineReason: command.action === 'decline' ? after.declineReason : '',
            reviewedAt: now,
            reviewedBy: actor.uid,
            updatedAt: now,
          });
        }
        transaction.create(
          newFinancialAuditRef(),
          buildFinancialAuditRecord(actor, {
            action:
              command.action === 'decline'
                ? 'PEKARYA_ACTIVITY_DECLINED'
                : 'PEKARYA_ACTIVITY_APPROVED',
            entityType: 'ActivityReport',
            entityId: item.reportId,
            reason: item.reason?.trim() || command.reason,
            requestId: command.requestId,
            before,
            after,
            metadata: {
              employeeId: before.employeeId,
              jobCategory: category,
              period: reportPeriods[index],
            },
          }),
        );
      });

      transaction.create(idempotencyRef, {
        requestHash,
        entityId: command.items.map((item) => item.reportId).join(','),
        resultingStatus: command.action === 'decline' ? 'declined' : 'approved',
        reviewedCount: command.items.length,
        createdAt: now,
      });
      return { reviewed: command.items.length, idempotent: false };
    });

    return Response.json(result);
  } catch (error) {
    return errorResponse(error);
  }
}
