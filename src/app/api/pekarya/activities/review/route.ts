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
  calculateEditableDriverJourneyTimeline,
  calculateDriverNetWage,
  calculateDriverReimbursementSettlement,
  calculateJourneyElapsedHours,
  calculateNightPremium,
  DEFAULT_FUEL_PROCUREMENT_MODE,
  DRIVER_VEHICLE_NAMES,
  isDriverVehicleName,
  isFuelProcurementMode,
  getMealAllowanceForDuration,
  normalizeDriverJourneyLocation,
  type DriverJourneyLocation,
} from '@/lib/payroll/driverJourney';
import {
  CURRENT_FUEL_RESERVATION_VERSION,
  commitFuelReservation,
  createFuelLedgerContext,
  flushFuelLedger,
  releaseFuelReservation,
  reservationFields,
  reservationFromJourney,
  reserveFuel,
  type FuelReservationRecord,
  VehicleFuelConflictError,
} from '@/lib/payroll/vehicleFuel';
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
    /** Cumulative Google Directions travel time between destinations; drives Komponen Waktu. */
    routeDurationHours?: number;
    timeStart?: string;
    timeEnd?: string;
    dateStart?: string;
    dateEnd?: string;
    isMultiDay?: boolean;
    actualFuelExpenditure: number;
    fuelDelta: number;
    tollDelta: number;
    mealDelta: number;
    ndalemMealMoneyReceived: number;
    vehicleType: string;
    nightCount: number;
    points: string[];
    startPointLocation?: DriverJourneyLocation | null;
    mainDestinationLocations?: Array<DriverJourneyLocation | null>;
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
  if (
    value.routeDurationHours !== undefined &&
    (!Number.isFinite(value.routeDurationHours) ||
      value.routeDurationHours < 0 ||
      value.routeDurationHours > 10_000)
  ) {
    throw new HttpError(400, 'Durasi tempuh rute audit Sopir tidak valid.');
  }
  try {
    assertNightCount(value.nightCount);
  } catch (error) {
    throw new HttpError(
      400,
      error instanceof Error ? error.message : 'Jumlah malam tidak valid.',
    );
  }
  for (const [label, time] of [
    ['jam berangkat', value.timeStart],
    ['jam tiba', value.timeEnd],
  ] as const) {
    if (
      time !== undefined &&
      (typeof time !== 'string' || !/^([01]\d|2[0-3]):([0-5]\d)$/.test(time))
    ) {
      throw new HttpError(400, `${label} audit tidak valid.`);
    }
  }
  for (const [label, date] of [
    ['tanggal mulai', value.dateStart],
    ['tanggal selesai', value.dateEnd],
  ] as const) {
    if (
      date !== undefined &&
      (typeof date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(date))
    ) {
      throw new HttpError(400, `${label} audit tidak valid.`);
    }
  }
  if (value.isMultiDay !== undefined && typeof value.isMultiDay !== 'boolean') {
    throw new HttpError(400, 'Status lintas hari audit tidak valid.');
  }
  if (!Number.isSafeInteger(value.actualFuelExpenditure)) {
    throw new HttpError(400, 'Nilai pembelian BBM aktual tidak valid.');
  }
  for (const [label, number, allowNegative] of [
    ['pembelian BBM aktual', value.actualFuelExpenditure, false],
    ['selisih BBM', value.fuelDelta, true],
    ['selisih tol', value.tollDelta, true],
    ['selisih makan', value.mealDelta, false],
    ['uang diberikan selama perjalanan', value.ndalemMealMoneyReceived, false],
  ] as const) {
    if (
      !Number.isFinite(number) ||
      (!allowNegative && number < 0) ||
      number < -100_000_000 ||
      number > 100_000_000
    ) {
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

  const startPointLocation = value.startPointLocation === undefined
    ? undefined
    : normalizeDriverJourneyLocation(value.startPointLocation, value.points[0]);
  if (value.startPointLocation !== undefined && value.startPointLocation !== null && !startPointLocation) {
    throw new HttpError(400, 'Koordinat titik awal audit tidak valid.');
  }

  let mainDestinationLocations: Array<DriverJourneyLocation | null> | undefined;
  if (value.mainDestinationLocations !== undefined) {
    const rawLocations = value.mainDestinationLocations;
    if (
      !Array.isArray(rawLocations) ||
      rawLocations.length !== value.points.length - 1
    ) {
      throw new HttpError(400, 'Koordinat tujuan audit tidak sesuai dengan rute.');
    }
    // Paired positionally rather than through `normalizeDriverJourneyLocations`,
    // which caps its addresses at MAX_MAIN_DESTINATIONS. `points` accepts up to
    // 30 stops, so normalizing through it returned a short array: coordinates
    // past the cap were dropped on write, and the length check above could
    // never be satisfied by a client that capped its payload the same way.
    mainDestinationLocations = value.points.slice(1).map((address, index) => (
      normalizeDriverJourneyLocation(rawLocations[index], address)
    ));
    const hasInvalidLocation = rawLocations.some((location, index) => (
      location !== null && mainDestinationLocations?.[index] === null
    ));
    if (hasInvalidLocation) {
      throw new HttpError(400, 'Koordinat tujuan audit tidak valid.');
    }
  }

  return {
    ...value,
    startPointLocation,
    mainDestinationLocations,
  };
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
      const hasDriverJourney = reports.some(
        (report, index) =>
          String(report.jobCategory || '') === 'SOPIR' && Boolean(journeySnapshots[index]?.exists),
      );
      const fuelContext = hasDriverJourney
        ? await createFuelLedgerContext(
            transaction,
            DRIVER_VEHICLE_NAMES.filter((vehicleName) => vehicleName !== 'Ndalem'),
            {
              uid: actor.uid,
              displayName: actor.displayName,
              role: actor.role,
            },
          )
        : null;
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
        // A confirmed SOPIR journey may be re-audited while its payroll
        // period is still open (assertPeriodAcceptsInput below enforces
        // that). Standard-direct fuel reimbursement never touches the
        // accumulation ledger, so it is safe to recompute; hold/procure
        // modes are settled against a shared vehicle balance the moment
        // they are first approved and cannot be un-committed here.
        const isDriverReEdit =
          command.action === 'approve_driver' &&
          category === 'SOPIR' &&
          before.status === 'approved';
        if (
          isDriverReEdit &&
          isFuelProcurementMode(before.fuelProcurementMode) &&
          before.fuelProcurementMode !== DEFAULT_FUEL_PROCUREMENT_MODE
        ) {
          throw new HttpError(
            409,
            `Laporan ${item.reportId} memakai akumulasi BBM yang sudah final; gunakan proses koreksi resmi untuk mengubahnya.`,
          );
        }
        if (before.status !== 'pending' && !isDriverReEdit) {
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
        let journeyFuelReservationUpdate: Record<string, unknown> = {};
        if (command.action === 'decline') {
          const authorizedJourney = journeySnapshots[index]?.data();
          const existingReservation = authorizedJourney
            ? reservationFromJourney(authorizedJourney)
            : null;
          if (fuelContext && existingReservation?.fuelReservationState === 'reserved') {
            const releasedReservation = releaseFuelReservation(
              fuelContext,
              existingReservation,
              'Laporan perjalanan ditolak; reservasi BBM dikembalikan',
              String(before.journeyId || ''),
            );
            journeyFuelReservationUpdate = reservationFields(releasedReservation);
          }
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
          const reviewTimeStart = review.timeStart ?? String(before.timeStart || '');
          const reviewTimeEnd = review.timeEnd ?? String(before.timeEnd || '');
          const originalDateStart = String(
            before.dateStart || before.activityDate || reportPeriods[index],
          );
          const reviewDateStart = review.dateStart ?? originalDateStart;
          const reviewDateEnd = review.dateEnd ?? String(before.dateEnd || originalDateStart);
          const reviewIsMultiDay =
            review.isMultiDay ?? before.isMultiDay === true;
          const originalIsMultiDay =
            before.isMultiDay === true || String(before.dateEnd || originalDateStart) > originalDateStart;
          const timelineChanged =
            (review.timeStart !== undefined && review.timeStart !== String(before.timeStart || '')) ||
            (review.timeEnd !== undefined && review.timeEnd !== String(before.timeEnd || '')) ||
            (review.dateStart !== undefined && review.dateStart !== originalDateStart) ||
            (review.dateEnd !== undefined && review.dateEnd !== String(before.dateEnd || originalDateStart)) ||
            (review.isMultiDay !== undefined && review.isMultiDay !== (before.isMultiDay === true));
          let editedTimeline;
          try {
            editedTimeline = calculateEditableDriverJourneyTimeline({
              dateStart: reviewDateStart,
              dateEnd: reviewDateEnd,
              timeStart: reviewTimeStart,
              timeEnd: reviewTimeEnd,
              isMultiDay: reviewIsMultiDay,
            });
            if (editedTimeline.durationHours <= 0) {
              throw new Error('Jam tiba dan tanggal tidak membentuk durasi perjalanan yang valid.');
            }
          } catch (error) {
            throw new HttpError(
              409,
              error instanceof Error ? error.message : 'Waktu perjalanan audit tidak valid.',
            );
          }
          if (!isDriverVehicleName(review.vehicleType)) {
            throw new HttpError(400, 'Kendaraan audit tidak dikenal.');
          }
          const fuelProcurementMode = isFuelProcurementMode(authorizedJourney?.fuelProcurementMode)
            ? authorizedJourney.fuelProcurementMode
            : DEFAULT_FUEL_PROCUREMENT_MODE;
          if (review.vehicleType === 'Ndalem' && fuelProcurementMode !== DEFAULT_FUEL_PROCUREMENT_MODE) {
            throw new HttpError(409, 'Kendaraan Ndalem tidak dapat menggunakan akumulasi BBM.');
          }
          const authorizedVehicleName = String(authorizedJourney?.vehicleName || before.vehicleType || '');
          const vehicleChanged = authorizedVehicleName !== review.vehicleType;
          const effectiveNightCount = timelineChanged
            ? review.nightCount
            : originalIsMultiDay
              ? review.nightCount
              : 0;
          const rate = vehicleRate(review.vehicleType);
          const baseOperationalCost = vehicleChanged
            // ActivityReports store the submitted round-trip distance; the
            // authorization document already stores its one-way x 2 baseline.
            ? Math.ceil(review.distanceKm * rate)
            : typeof authorizedJourney?.baseOperationalCost === 'number'
              ? authorizedJourney.baseOperationalCost
              : typeof before.baseOperationalCost === 'number'
                ? before.baseOperationalCost
                : Math.ceil(review.distanceKm * rate);
          const existingReservation = authorizedJourney
            ? reservationFromJourney(authorizedJourney)
            : null;
          let finalReservation: FuelReservationRecord = existingReservation || {
            fuelReservationVersion: CURRENT_FUEL_RESERVATION_VERSION,
            fuelReservationId: `FUEL-${before.journeyId || item.reportId}-REVIEW-${command.requestId}`,
            fuelReservationState: 'none',
            fuelReservationVehicleName: review.vehicleType,
            fuelProcurementMode,
            baseFuelAllowance: Math.ceil(baseOperationalCost),
            heldFuelAmount: 0,
            procuredAccumulatedAmount: 0,
          };
          const journeyId = String(before.journeyId || item.reportId);
          const auditedBaseFuelAllowance = Math.ceil(baseOperationalCost);
          const mustRebuildReservation = Boolean(
            existingReservation?.fuelReservationState === 'reserved' &&
            (
              existingReservation.fuelReservationVehicleName !== review.vehicleType ||
              existingReservation.fuelProcurementMode !== fuelProcurementMode ||
              existingReservation.baseFuelAllowance !== auditedBaseFuelAllowance
            ),
          );
          if (
            fuelContext &&
            existingReservation?.fuelReservationState === 'reserved' &&
            mustRebuildReservation
          ) {
            finalReservation = releaseFuelReservation(
              fuelContext,
              existingReservation,
              'Rekonsiliasi reservasi saat audit perjalanan',
              journeyId,
            );
          }
          if (fuelProcurementMode !== DEFAULT_FUEL_PROCUREMENT_MODE) {
            if (!fuelContext) {
              throw new HttpError(409, 'Ledger saldo BBM tidak tersedia untuk audit perjalanan.');
            }
            const reservedReservation =
              existingReservation?.fuelReservationState === 'reserved' && !mustRebuildReservation
                ? existingReservation
                : reserveFuel(fuelContext, {
                    journeyId,
                    reservationId: `FUEL-${before.journeyId || item.reportId}-REVIEW-${command.requestId}`,
                    vehicleName: review.vehicleType,
                    mode: fuelProcurementMode,
                    baseFuelAllowance: auditedBaseFuelAllowance,
                    reason: 'Reservasi ulang BBM berdasarkan hasil audit perjalanan',
                  });
            const approvedFuelExpenditure = fuelProcurementMode === 'procure_release'
              ? Math.ceil(review.actualFuelExpenditure)
              : undefined;
            if (fuelProcurementMode === 'procure_release') {
              const fuelReceiptUrl = String(
                before.fuelReceiptUrl || authorizedJourney?.fuelReceiptUrl || '',
              ).trim();
              if (!approvedFuelExpenditure || !fuelReceiptUrl) {
                throw new HttpError(
                  409,
                  'Pencairan BBM wajib memiliki nominal pembelian aktual dan struk yang disetujui.',
                );
              }
            }
            finalReservation = commitFuelReservation(
              fuelContext,
              reservedReservation,
              journeyId,
              approvedFuelExpenditure,
            );
          } else if (fuelContext && existingReservation?.fuelReservationState === 'reserved') {
            finalReservation = {
              ...finalReservation,
              fuelReservationState: 'released',
              fuelProcurementMode: DEFAULT_FUEL_PROCUREMENT_MODE,
              fuelReservationVehicleName: review.vehicleType,
              baseFuelAllowance: Math.ceil(baseOperationalCost),
              heldFuelAmount: 0,
              procuredAccumulatedAmount: 0,
            };
          }
          journeyFuelReservationUpdate = reservationFields({
            ...finalReservation,
            fuelProcurementMode,
            fuelReservationVehicleName: review.vehicleType,
            baseFuelAllowance: auditedBaseFuelAllowance,
            heldFuelAmount: fuelProcurementMode === 'hold_accumulate'
              ? Math.ceil(baseOperationalCost)
              : 0,
          });
          let actualJourneyDurationHours: number;
          try {
            actualJourneyDurationHours = calculateJourneyElapsedHours(
              reviewTimeStart,
              reviewTimeEnd,
              effectiveNightCount,
            );
          } catch (error) {
            throw new HttpError(
              409,
              error instanceof Error ? error.message : 'Durasi perjalanan tidak valid.',
            );
          }
          const finalDurationHours = timelineChanged
            ? actualJourneyDurationHours
            : review.durationHours;
          // Cumulative Google Directions travel time between destinations, as
          // recomputed by the auditor's route. Drives Komponen Waktu only —
          // finalDurationHours (elapsed clock time) keeps driving meal allowance.
          const travelTimeHours = typeof review.routeDurationHours === 'number'
            ? review.routeDurationHours
            : finalDurationHours;
          const baseDriverWage = calculateDriverNetWage({
            distanceKm: review.distanceKm,
            travelTimeHours,
            elapsedDurationHours: finalDurationHours,
            nightCount: effectiveNightCount,
          });
          const originalPreAuthorizedMeal =
            typeof authorizedJourney?.mealAllowance === 'number' &&
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
          const preAuthorizedMeal =
            review.vehicleType === 'Ndalem'
              ? 0
              : timelineChanged
                ? getMealAllowanceForDuration(actualJourneyDurationHours, review.vehicleType)
                : originalPreAuthorizedMeal;
          const ndalemMealMoney = review.ndalemMealMoneyReceived;
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
            typeof authorizedJourney?.preAuthorizedToll === 'number'
              ? authorizedJourney.preAuthorizedToll
              : typeof authorizedJourney?.tollParkingFee === 'number'
                ? authorizedJourney.tollParkingFee
                : Number(before.preAuthorizedToll || 0);
          const fuelAllowance = review.vehicleType === 'Ndalem' ? 0 : baseOperationalCost;
          const extraOperationalCost = Math.max(0, Number(before.extraOperationalCost || 0));
          const settlement = calculateDriverReimbursementSettlement({
            fuelAllowance,
            fuelSpent:
              fuelProcurementMode === 'hold_accumulate' || review.vehicleType === 'Ndalem'
                ? 0
                : Math.ceil(review.actualFuelExpenditure),
            tollAllowance: preAuthorizedToll,
            tollSpent: Math.max(0, preAuthorizedToll + review.tollDelta),
            additionalReimbursement: mealDelta + extraOperationalCost,
            fuelProcurementMode,
            procuredAccumulatedAmount: finalReservation.procuredAccumulatedAmount,
          });
          const actualFuel =
            fuelProcurementMode === 'hold_accumulate' || review.vehicleType === 'Ndalem'
              ? 0
              : Math.ceil(review.actualFuelExpenditure);
          const actualToll = Math.max(0, preAuthorizedToll + review.tollDelta);
          // The journey document is updated with the driver's submitted
          // actuals before review. Rebuild from the original allowance
          // components here so approval never applies the delta twice.
          const initialTotalOperationalCost =
            settlement.effectiveFuelAllowance +
            preAuthorizedMeal +
            preAuthorizedToll;
          const totalOperationalCost = Math.max(
            0,
            Math.ceil(
              initialTotalOperationalCost +
                settlement.netOperationalDelta +
                mealDelta +
                extraOperationalCost,
            ),
          );
          const upahBersih = Math.max(
            0,
            baseDriverWage - settlement.remainingUnspentCash,
          );
          after = {
            ...before,
            status: 'approved',
            fee: upahBersih,
            upahBersih,
            baseDriverWage,
            totalOperationalCost,
            distanceKm: review.distanceKm,
            measuredDistanceKm: review.distanceKm,
            durationHours: finalDurationHours,
            routeDurationHours: travelTimeHours,
            timeStart: reviewTimeStart,
            timeEnd: reviewTimeEnd,
            dateStart: editedTimeline.dateStart,
            dateEnd: editedTimeline.dateEnd,
            isMultiDay: timelineChanged
              ? editedTimeline.isMultiDay
              : before.isMultiDay === true,
            crossesMidnight: reviewTimeEnd < reviewTimeStart,
            customDurationPP: timelineChanged
              ? finalDurationHours
              : before.customDurationPP,
            componentJarak: Math.ceil(review.distanceKm * 300),
            componentWaktu: Math.ceil(travelTimeHours * 5_000),
            fuelFee: actualFuel,
            extraFuelCost: settlement.extraFuelCost,
            tollParkingFee: actualToll,
            extraTollCost: settlement.extraTollCost,
            preAuthorizedMeal,
            preAuthorizedToll,
            totalPreAuthorizedAllowance: settlement.totalPreAuthorizedAllowance,
            totalActualSpent: settlement.totalActualSpent,
            unspentCash: settlement.unspentCash,
            remainingUnspentCash: settlement.remainingUnspentCash,
            netOperationalDelta: settlement.netOperationalDelta,
            fuelAllowanceSurplus: settlement.fuelAllowanceSurplus,
            tollAllowanceSurplus: settlement.tollAllowanceSurplus,
            actualJourneyDurationHours,
            actualMealAllowance,
            extraMealAllowance: mealDelta,
            ndalemMealMoneyReceived: ndalemMealMoney,
            positiveReimburseDelta: settlement.positiveReimburseDelta,
            reimburseDelta: settlement.reimburseDelta,
            fuelProcurementMode,
            heldFuelAmount: finalReservation.heldFuelAmount,
            procuredAccumulatedAmount: finalReservation.procuredAccumulatedAmount,
            fuelAllowanceForSettlement: settlement.effectiveFuelAllowance,
            fuelTotalAllocation: settlement.effectiveFuelAllowance,
            vehicleType: review.vehicleType,
            vehicleRate: rate,
            baseOperationalCost: fuelAllowance,
            nightCount: effectiveNightCount,
            nightPremium: calculateNightPremium(effectiveNightCount),
            points: review.points,
            ...(review.startPointLocation !== undefined
              ? { startPointLocation: review.startPointLocation }
              : {}),
            ...(review.mainDestinationLocations !== undefined
              ? { mainDestinationLocations: review.mainDestinationLocations }
              : {}),
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
        const ledgerRef = adminDb
          .collection('PayrollLedgerEntries')
          .doc(`SPJ_ACTIVITY__${item.reportId}`);
        if (amount > 0) {
          const ledgerEntry = {
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
          };
          // A re-edit of an already-confirmed journey replaces its ledger
          // entry outright; `create()` would abort the transaction since
          // the doc from the original approval already exists.
          if (isDriverReEdit) {
            transaction.set(ledgerRef, ledgerEntry);
          } else {
            transaction.create(ledgerRef, ledgerEntry);
          }
        } else if (isDriverReEdit) {
          // The re-edit zeroed out the payable amount; drop the stale
          // entry from the original approval rather than leaving it active.
          transaction.delete(ledgerRef);
        }
        const journeySnapshot = journeySnapshots[index];
        if (before.journeyId && journeyRefs[index] && journeySnapshot?.exists) {
          const driverReviewUpdate =
            command.action === 'approve_driver'
              ? {
                  totalOperationalCost: after.totalOperationalCost || 0,
                  newTotalDistanceKm: after.distanceKm || 0,
                  measuredDistanceKm: after.distanceKm || 0,
                  newTotalDurationHours: after.durationHours || 0,
                  fuelFee: after.fuelFee || 0,
                  extraFuelCost: after.extraFuelCost || 0,
                  tollParkingFee: after.tollParkingFee || 0,
                  extraTollCost: after.extraTollCost || 0,
                  mealAllowance: after.preAuthorizedMeal || 0,
                  preAuthorizedMeal: after.preAuthorizedMeal || 0,
                  preAuthorizedToll: after.preAuthorizedToll || 0,
                  ndalemMealMoneyReceived: after.ndalemMealMoneyReceived || 0,
                  draftNdalemMealMoneyReceived: after.ndalemMealMoneyReceived || 0,
                  customDurationPP: after.customDurationPP || 0,
                  extraMealAllowance: after.extraMealAllowance || 0,
                  positiveReimburseDelta: after.positiveReimburseDelta || 0,
                  reimburseDelta: after.reimburseDelta || 0,
                  unspentCash: after.unspentCash || 0,
                  remainingUnspentCash: after.remainingUnspentCash || 0,
                  netOperationalDelta: after.netOperationalDelta || 0,
                  fuelAllowanceSurplus: after.fuelAllowanceSurplus || 0,
                  tollAllowanceSurplus: after.tollAllowanceSurplus || 0,
                  totalPreAuthorizedAllowance: after.totalPreAuthorizedAllowance || 0,
                  totalActualSpent: after.totalActualSpent || 0,
                  vehicleName: after.vehicleType || '',
                  vehicleRate: after.vehicleRate || 0,
                  baseOperationalCost: after.baseOperationalCost || 0,
                  baseDriverWage: after.baseDriverWage || 0,
                  nightCount: after.nightCount ?? 0,
                  nightPremium: after.nightPremium || 0,
                  points: after.points || [],
                  startPoint: Array.isArray(after.points) ? after.points[0] || '' : '',
                  endPoint: Array.isArray(after.points) ? after.points[1] || '' : '',
                  mainDestinations: Array.isArray(after.points) ? after.points.slice(1) : [],
                  startPointLocation: after.startPointLocation ?? null,
                  mainDestinationLocations: after.mainDestinationLocations || [],
                  fuelProcurementMode: after.fuelProcurementMode || DEFAULT_FUEL_PROCUREMENT_MODE,
                  heldFuelAmount: after.heldFuelAmount || 0,
                  procuredAccumulatedAmount: after.procuredAccumulatedAmount || 0,
                  fuelAllowanceForSettlement: after.fuelAllowanceForSettlement || 0,
                  fuelTotalAllocation: after.fuelTotalAllocation || 0,
                }
              : {};
          const shouldClearFuelReceiptEvidence =
            Number(after.fuelFee || 0) <= 0 || !String(after.fuelReceiptUrl || '').trim();
          const shouldClearTollReceiptEvidence =
            Number(after.tollParkingFee || 0) <= 0 || !String(after.tollReceiptUrl || '').trim();
          transaction.update(journeyRefs[index]!, {
            ...driverReviewUpdate,
            ...journeyFuelReservationUpdate,
            status: command.action === 'decline' ? 'declined' : 'completed',
            fee: command.action === 'decline' ? 0 : (after.totalOperationalCost || 0),
            upahBersih: command.action === 'decline' ? 0 : (after.upahBersih || 0),
            dateStart: after.dateStart || after.activityDate || before.activityDate,
            dateEnd: after.dateEnd || after.dateStart || after.activityDate || before.activityDate,
            isMultiDay: after.isMultiDay === true,
            nightCount: after.nightCount ?? 0,
            nightPremium: after.nightPremium ?? 0,
            timeStart: after.timeStart || '',
            timeEnd: after.timeEnd || '',
            submittedDurationHours: after.durationHours || 0,
            newTotalDurationHours: after.durationHours || 0,
            componentJarak: after.componentJarak ?? Math.ceil(Number(after.distanceKm || 0) * 300),
            componentWaktu: after.componentWaktu ?? Math.ceil(Number(after.routeDurationHours ?? after.durationHours ?? 0) * 5_000),
            points: after.points || [],
            startPoint: Array.isArray(after.points) ? after.points[0] || '' : '',
            endPoint: Array.isArray(after.points) ? after.points[1] || '' : '',
            mainDestinations: Array.isArray(after.points) ? after.points.slice(1) : [],
            startPointLocation: after.startPointLocation ?? null,
            mainDestinationLocations: after.mainDestinationLocations || [],
            extraActivities: after.extraActivities || [],
            fuelReceiptEvidence: shouldClearFuelReceiptEvidence
              ? admin.firestore.FieldValue.delete()
              : (after.fuelReceiptEvidence ?? admin.firestore.FieldValue.delete()),
            tollReceiptEvidence: shouldClearTollReceiptEvidence
              ? admin.firestore.FieldValue.delete()
              : (after.tollReceiptEvidence ?? admin.firestore.FieldValue.delete()),
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

      if (fuelContext) {
        flushFuelLedger(fuelContext);
      }

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
    if (error instanceof VehicleFuelConflictError) {
      return errorResponse(new HttpError(409, error.message));
    }
    return errorResponse(error);
  }
}
