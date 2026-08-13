import { randomUUID } from 'node:crypto';
import { NextRequest, NextResponse } from 'next/server';
import admin from '@/lib/firebase-admin';
import { adminDb } from '@/lib/firebase-admin';
import { assertDateOnly } from '@/lib/payroll/domain';
import {
  calculateDriverJourneyOperationalCosts,
  calculateEstimatedDriverWage,
  DEFAULT_DRIVER_JOURNEY_POINT,
  DEFAULT_DRIVER_VEHICLE_NAME,
  DEFAULT_FUEL_PROCUREMENT_MODE,
  isFuelProcurementMode,
  isDriverVehicleName,
  MAX_MAIN_DESTINATIONS,
  normalizeDriverJourneyDestinations,
  normalizeDriverJourneyLocation,
  type DriverJourneyLocation,
  type DriverVehicleName,
} from '@/lib/payroll/driverJourney';
import {
  CURRENT_FUEL_RESERVATION_VERSION,
  createFuelLedgerContext,
  flushFuelLedger,
  getBalanceFromContext,
  getVehicleFuelBalance,
  getVehicleFuelBalances,
  releaseFuelReservation,
  reservationFields,
  reservationFromJourney,
  reserveFuel,
  type FuelReservationRecord,
  VehicleFuelConflictError,
} from '@/lib/payroll/vehicleFuel';
import { hasClaimedDriverJourney } from '@/lib/payroll/driverPiket';
import {
  buildPekaryaActivityIdentity,
  pekaryaPayrollPeriodForDate,
} from '@/lib/payroll/pekaryaSpj';
import { buildFinancialAuditRecord, newFinancialAuditRef } from '@/lib/server/audit';
import {
  errorResponse,
  HttpError,
  requireAuthenticatedProfile,
  requireRole,
} from '@/lib/server/auth';

export const dynamic = 'force-dynamic';

const SAFE_JOURNEY_ID = /^JRN-[A-Za-z0-9_-]{6,180}$/;
const MAX_MONEY = 100_000_000;

function requireSopirProfile(actor: Awaited<ReturnType<typeof requireAuthenticatedProfile>>) {
  requireRole(actor, ['honorer']);
  if (!actor.linkedEmployeeId || !actor.permittedCategories.includes('SOPIR')) {
    throw new HttpError(403, 'Akun ini tidak terdaftar sebagai Sopir.');
  }
}

function requireJourneyManager(actor: Awaited<ReturnType<typeof requireAuthenticatedProfile>>) {
  requireRole(actor, ['super_admin', 'satker_head']);
  if (actor.role !== 'super_admin' && !actor.permittedCategories.includes('SOPIR')) {
    throw new HttpError(403, 'Anda tidak memiliki kewenangan untuk perjalanan Sopir.');
  }
}

function stringField(value: unknown, field: string, maxLength: number): string {
  if (typeof value !== 'string' || !value.trim() || value.trim().length > maxLength) {
    throw new HttpError(400, `${field} tidak valid.`);
  }
  return value.trim();
}

function numberField(
  value: unknown,
  field: string,
  options: { min?: number; max?: number; integer?: boolean } = {},
): number {
  if (
    typeof value !== 'number' ||
    !Number.isFinite(value) ||
    (options.min !== undefined && value < options.min) ||
    (options.max !== undefined && value > options.max) ||
    (options.integer && !Number.isSafeInteger(value))
  ) {
    throw new HttpError(400, `${field} tidak valid.`);
  }
  return value;
}

function dateField(value: unknown, field: string): string {
  const date = stringField(value, field, 10);
  try {
    assertDateOnly(date);
  } catch (error) {
    throw new HttpError(400, error instanceof Error ? error.message : `${field} tidak valid.`);
  }
  return date;
}

function mainDestinationsField(value: unknown, legacyEndPoint?: unknown): string[] {
  const rawValues = value === undefined
    ? [legacyEndPoint]
    : value;
  if (!Array.isArray(rawValues) || rawValues.length < 1 || rawValues.length > MAX_MAIN_DESTINATIONS) {
    throw new HttpError(
      400,
      `Tujuan utama harus berisi 1 sampai ${MAX_MAIN_DESTINATIONS} lokasi.`,
    );
  }
  return rawValues.map((item, index) => {
    if (typeof item !== 'string' || !item.trim() || item.trim().length > 300) {
      throw new HttpError(400, `Tujuan utama ke-${index + 1} tidak valid.`);
    }
    return item.trim();
  });
}

function journeyLocationField(
  value: unknown,
  address: string,
  field: string,
): DriverJourneyLocation | null | undefined {
  if (value === undefined) return undefined;
  if (value === null) return null;
  const location = normalizeDriverJourneyLocation(value, address);
  if (!location) throw new HttpError(400, `${field} tidak valid.`);
  return location;
}

function journeyLocationsField(
  value: unknown,
  addresses: string[],
  field: string,
): Array<DriverJourneyLocation | null> | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value) || value.length !== addresses.length) {
    throw new HttpError(400, `${field} tidak valid.`);
  }
  return value.map((item, index) => {
    const location = journeyLocationField(item, addresses[index], `${field} ke-${index + 1}`);
    return location ?? null;
  });
}

function jakartaToday(): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Jakarta',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
}

function canDriverAccessJourney(
  data: FirebaseFirestore.DocumentData,
  actor: Awaited<ReturnType<typeof requireAuthenticatedProfile>>,
): boolean {
  return Boolean(
    actor.linkedEmployeeId &&
    (
      data.employeeId === actor.linkedEmployeeId ||
      data.assignedTo === actor.linkedEmployeeId
    )
  );
}

function payrollPeriodFromJourney(data: FirebaseFirestore.DocumentData): string {
  const storedPeriod = [data.payrollPeriod, data.period].find(
    (value) => typeof value === 'string' && /^\d{4}-\d{2}$/.test(value),
  );
  if (typeof storedPeriod === 'string') return storedPeriod;
  const activityDate = String(data.activityDate || data.journeyDate || '');
  try {
    assertDateOnly(activityDate);
    return pekaryaPayrollPeriodForDate(activityDate);
  } catch {
    throw new HttpError(409, 'Periode payroll perjalanan tidak dapat ditentukan.');
  }
}

function journeyFuelMode(data: FirebaseFirestore.DocumentData): 'hold_accumulate' | 'procure_release' | 'standard_direct' {
  return isFuelProcurementMode(data.fuelProcurementMode)
    ? data.fuelProcurementMode
    : DEFAULT_FUEL_PROCUREMENT_MODE;
}

async function attachVehicleFuelBalance(
  journey: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const vehicleName = typeof journey.vehicleName === 'string' ? journey.vehicleName : '';
  if (!isDriverVehicleName(vehicleName) || vehicleName === DEFAULT_DRIVER_VEHICLE_NAME) {
    return {
      ...journey,
      fuelProcurementMode: journeyFuelMode(journey),
      fuelBalance: null,
    };
  }
  return {
    ...journey,
    fuelProcurementMode: journeyFuelMode(journey),
    fuelBalance: await getVehicleFuelBalance(vehicleName),
  };
}

async function assertJourneyPeriodOpen(
  transaction: FirebaseFirestore.Transaction,
  period: string,
): Promise<void> {
  const snapshot = await transaction.get(
    adminDb.collection('PayrollPeriods').doc(period),
  );
  if (snapshot.data()?.attendanceStatus === 'closed') {
    throw new HttpError(
      409,
      `Periode payroll ${period} sudah ditutup; perjalanan dan bukti historisnya tidak dapat diubah.`,
    );
  }
}

/**
 * Returns the authenticated driver's journeys. The client used to call this
 * endpoint while it did not exist, then fall back to a direct Firestore read.
 * Keeping this read behind the Admin SDK gives the report page a reliable,
 * authenticated path without widening browser rules for arbitrary employee
 * IDs.
 */
export async function GET(request: NextRequest) {
  try {
    const actor = await requireAuthenticatedProfile(request);
    const searchParams = new URL(request.url).searchParams;
    const requestedDriverId = searchParams.get('driverId');
    const requestedPeriod = searchParams.get('period');

    const isManager = actor.role === 'super_admin' || actor.role === 'satker_head';
    if (!isManager) {
      if (actor.role !== 'honorer' || !actor.linkedEmployeeId) {
        throw new HttpError(403, 'Hanya akun Sopir yang dapat memuat perjalanan dinas.');
      }
      if (!actor.permittedCategories.includes('SOPIR')) {
        throw new HttpError(403, 'Akun ini tidak terdaftar sebagai Sopir.');
      }
      if (requestedDriverId && requestedDriverId !== actor.linkedEmployeeId) {
        throw new HttpError(403, 'Anda hanya dapat memuat perjalanan milik sendiri.');
      }
    } else if (actor.role === 'satker_head' && !actor.permittedCategories.includes('SOPIR')) {
      throw new HttpError(403, 'Anda tidak memiliki kewenangan untuk perjalanan Sopir.');
    }

    const requestedJourneyId = searchParams.get('journeyId');
    if (requestedJourneyId) {
      if (!SAFE_JOURNEY_ID.test(requestedJourneyId)) {
        throw new HttpError(400, 'ID perjalanan tidak valid.');
      }
      const journeySnapshot = await adminDb.collection('DriverJourneys').doc(requestedJourneyId).get();
      if (!journeySnapshot.exists) {
        throw new HttpError(404, 'Perjalanan dinas tidak ditemukan.');
      }
      const journey = journeySnapshot.data()!;
      if (!isManager && !canDriverAccessJourney(journey, actor)) {
        throw new HttpError(403, 'Perjalanan dinas ini bukan milik Anda.');
      }
      return NextResponse.json({
        journey: await attachVehicleFuelBalance({ id: journeySnapshot.id, ...journey }),
      });
    }

    let query: FirebaseFirestore.Query = adminDb.collection('DriverJourneys');
    if (requestedPeriod) {
      query = query.where('period', '==', requestedPeriod);
    }
    if (!isManager) {
      query = query.where('employeeId', '==', actor.linkedEmployeeId!);
    }
    const snapshot = await query.get();

    const balances = new Map(
      (await getVehicleFuelBalances()).map((balance) => [balance.vehicleName, balance]),
    );
    const journeys = snapshot.docs.map((document) => {
      const data = document.data();
      const vehicleName = isDriverVehicleName(data.vehicleName) ? data.vehicleName : null;
      return {
        id: document.id,
        ...data,
        fuelProcurementMode: journeyFuelMode(data),
        fuelBalance: vehicleName ? balances.get(vehicleName) || null : null,
      };
    });

    return NextResponse.json({ journeys });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function POST(request: NextRequest) {
  try {
    const actor = await requireAuthenticatedProfile(request);
    const body = await request.json().catch(() => null) as Record<string, unknown> | null;
    const action = typeof body?.action === 'string' ? body.action : '';

    if (action === 'authorize') {
      requireJourneyManager(actor);

      const activityName = stringField(body?.activityName, 'Nama kegiatan', 180);
      const activityDate = dateField(body?.activityDate, 'Tanggal perjalanan');
      const period = stringField(body?.period, 'Periode', 7);
      const expectedPeriod = pekaryaPayrollPeriodForDate(activityDate);
      if (period !== expectedPeriod) {
        throw new HttpError(409, `Tanggal perjalanan berada pada periode payroll ${expectedPeriod}.`);
      }
      const startPoint = body?.startPoint === undefined
        ? DEFAULT_DRIVER_JOURNEY_POINT
        : stringField(body.startPoint, 'Titik awal', 300);
      const mainDestinations = mainDestinationsField(body?.mainDestinations, body?.endPoint);
      const endPoint = mainDestinations[0];
      const startPointLocation = journeyLocationField(
        body?.startPointLocation,
        startPoint,
        'Koordinat titik awal',
      );
      const mainDestinationLocations = journeyLocationsField(
        body?.mainDestinationLocations,
        mainDestinations,
        'Koordinat tujuan utama',
      );
      const requestedVehicleName = stringField(body?.vehicleName, 'Jenis kendaraan', 80);
      if (!isDriverVehicleName(requestedVehicleName)) {
        throw new HttpError(400, 'Jenis kendaraan tidak dikenal.');
      }
      const vehicleName = requestedVehicleName;
      const requestedFuelMode = body?.fuelProcurementMode === undefined
        ? DEFAULT_FUEL_PROCUREMENT_MODE
        : body.fuelProcurementMode;
      if (!isFuelProcurementMode(requestedFuelMode)) {
        throw new HttpError(400, 'Mode pengadaan BBM tidak valid.');
      }
      if (vehicleName === DEFAULT_DRIVER_VEHICLE_NAME && requestedFuelMode !== DEFAULT_FUEL_PROCUREMENT_MODE) {
        throw new HttpError(400, 'Kendaraan Ndalem hanya menggunakan Pengisian Standard.');
      }
      const distanceKm = numberField(body?.distanceKm, 'Jarak satu arah', { min: 0.001, max: 10_000 });
      const durationHours = numberField(body?.durationHours, 'Durasi satu arah', { min: 0.001, max: 10_000 });
      const customDurationPP = numberField(
        body?.customDurationPP ?? durationHours * 2,
        'Durasi perjalanan PP',
        { min: 0.001, max: 20_000 },
      );
      const tollParkingFee = numberField(body?.tollParkingFee ?? 0, 'Tol & parkir', { min: 0, max: MAX_MONEY });
      const requestedJourneyId = body?.journeyId;
      const journeyId = requestedJourneyId
        ? stringField(requestedJourneyId, 'ID perjalanan', 180)
        : `JRN-${activityDate.replaceAll('-', '')}-${randomUUID().replaceAll('-', '').slice(0, 12).toUpperCase()}`;
      if (!SAFE_JOURNEY_ID.test(journeyId)) {
        throw new HttpError(400, 'ID perjalanan tidak valid.');
      }
      const reservationId = `FUEL-${journeyId}-${randomUUID().replaceAll('-', '').slice(0, 16).toUpperCase()}`;

      const assignedTo = typeof body?.assignedTo === 'string' && body.assignedTo.trim()
        ? body.assignedTo.trim()
        : null;
      if (assignedTo && !/^[A-Za-z0-9_-]{1,180}$/.test(assignedTo)) {
        throw new HttpError(400, 'ID Sopir tidak valid.');
      }
      const journeyRef = adminDb.collection('DriverJourneys').doc(journeyId);
      const result = await adminDb.runTransaction(async (transaction) => {
        const existingSnapshot = await transaction.get(journeyRef);
        const existing = existingSnapshot.exists ? existingSnapshot.data()! : null;
        await assertJourneyPeriodOpen(transaction, period);
        if (existing) {
          const existingPeriod = payrollPeriodFromJourney(existing);
          if (existingPeriod !== period) {
            await assertJourneyPeriodOpen(transaction, existingPeriod);
          }
        }
        if (existing && !['unassigned', 'open', 'assigned'].includes(String(existing.status || ''))) {
          throw new HttpError(409, 'Perjalanan yang sudah dimulai atau diproses tidak dapat diubah.');
        }

        const wageEst = calculateEstimatedDriverWage(distanceKm * 2, customDurationPP);
        const assignedTo = typeof body?.assignedTo === 'string' && body.assignedTo.trim().length > 0 ? body.assignedTo.trim() : null;
        let assignedToName: string | null = null;
        if (assignedTo) {
          const driverSnapshot = await transaction.get(
            adminDb.collection('Employees_BlueCollar').doc(assignedTo),
          );
          if (
            !driverSnapshot.exists ||
            driverSnapshot.data()?.employment?.status !== 'active' ||
            driverSnapshot.data()?.employment?.jobCategory !== 'SOPIR'
          ) {
            throw new HttpError(400, 'Sopir yang dipilih tidak aktif atau bukan kategori SOPIR.');
          }
          assignedToName = String(driverSnapshot.data()?.name || 'Sopir');
        }

        const baseOperationalCosts = calculateDriverJourneyOperationalCosts(
          distanceKm,
          customDurationPP,
          vehicleName,
          tollParkingFee,
        );
        const previousReservation = existing ? reservationFromJourney(existing) : null;
        if (previousReservation?.fuelReservationState === 'committed') {
          throw new HttpError(409, 'Reservasi BBM yang sudah diselesaikan tidak dapat diedit.');
        }
        const balanceVehicles = [
          vehicleName,
          previousReservation?.fuelReservationVehicleName,
        ].filter(
          (value): value is DriverVehicleName =>
            typeof value === 'string' &&
            isDriverVehicleName(value) &&
            value !== DEFAULT_DRIVER_VEHICLE_NAME,
        );
        const fuelContext = balanceVehicles.length > 0
          ? await createFuelLedgerContext(transaction, balanceVehicles, {
              uid: actor.uid,
              displayName: actor.displayName,
              role: actor.role,
            })
          : null;
        if (fuelContext && previousReservation?.fuelReservationState === 'reserved') {
          releaseFuelReservation(
            fuelContext,
            previousReservation,
            'Revisi otorisasi perjalanan sebelum klaim',
            journeyId,
          );
        }
        let reservation: FuelReservationRecord;
        if (requestedFuelMode === DEFAULT_FUEL_PROCUREMENT_MODE) {
          reservation = {
            fuelReservationVersion: CURRENT_FUEL_RESERVATION_VERSION,
            fuelReservationId: reservationId,
            fuelReservationState: 'none',
            fuelReservationVehicleName: vehicleName,
            fuelProcurementMode: requestedFuelMode,
            baseFuelAllowance: Math.ceil(baseOperationalCosts.baseOperationalCost),
            heldFuelAmount: 0,
            procuredAccumulatedAmount: 0,
          };
        } else if (fuelContext) {
          reservation = reserveFuel(fuelContext, {
            journeyId,
            reservationId,
            vehicleName,
            mode: requestedFuelMode,
            baseFuelAllowance: baseOperationalCosts.baseOperationalCost,
            reason: 'Reservasi BBM saat otorisasi perjalanan',
          });
        } else {
          throw new HttpError(409, 'Saldo BBM kendaraan tidak dapat diproses.');
        }
        const operationalCosts = calculateDriverJourneyOperationalCosts(
          distanceKm,
          customDurationPP,
          vehicleName,
          tollParkingFee,
          {
            fuelProcurementMode: requestedFuelMode,
            procuredAccumulatedAmount: reservation.procuredAccumulatedAmount,
          },
        );
        const status = assignedTo ? 'assigned' : 'unassigned';
        const now = admin.firestore.FieldValue.serverTimestamp();
        const journeyData: Record<string, unknown> = {
          activityName,
          activityDate,
          journeyDate: activityDate,
          startPoint,
          endPoint,
          mainDestinations,
          ...(startPointLocation !== undefined ? { startPointLocation } : {}),
          ...(mainDestinationLocations !== undefined ? { mainDestinationLocations } : {}),
          vehicleName,
          vehicleRate: operationalCosts.vehicleRate,
          distanceKm,
          totalDistanceKm: distanceKm * 2,
          durationHours,
          customDurationPP,
          baseOperationalCost: operationalCosts.baseOperationalCost,
          mealAllowance: operationalCosts.mealAllowance,
          tollParkingFee,
          preAuthorizedToll: tollParkingFee,
          totalOperationalCost: operationalCosts.totalOperationalCost,
          ...reservationFields(reservation),
          fuelModeSelectionRequired: false,
          estimatedComponentJarak: wageEst.compJarak,
          estimatedComponentWaktu: wageEst.compWaktu,
          estimatedBaseDriverWage: wageEst.baseWage,
          estimatedMaxDriverWage: wageEst.maxWage,
          // Location-only flow: clear historical Google Places photo URLs so
          // rendering a journey cannot trigger the Places Photo SKU.
          destinationImageUrl: null,
          assignedTo,
          assignedToName,
          status,
          period,
          payrollPeriod: period,
          updatedAt: now,
          authorizedBy: actor.uid,
          authorizedByName: actor.displayName,
        };

        if (existing && startPointLocation === undefined && existing.startPoint !== startPoint) {
          journeyData.startPointLocation = null;
        }
        if (
          existing &&
          mainDestinationLocations === undefined &&
          JSON.stringify(normalizeDriverJourneyDestinations(existing.mainDestinations, existing.endPoint)) !==
            JSON.stringify(mainDestinations)
        ) {
          journeyData.mainDestinationLocations = mainDestinations.map(() => null);
        }

        if (!existing) {
          journeyData.id = journeyId;
          journeyData.createdAt = now;
          journeyData.authorizedAt = now;
          journeyData.createdBy = actor.uid;
        }
        if (fuelContext) flushFuelLedger(fuelContext);
        transaction.set(journeyRef, journeyData, { merge: true });
        return { journeyId, status };
      });

      return NextResponse.json(result, { status: 201 });
    }

    if (action === 'create_self') {
      requireSopirProfile(actor);
      const activityName = stringField(body?.activityName, 'Nama kegiatan', 180);
      const startPoint = stringField(body?.startPoint, 'Titik awal', 300);
      const endPoint = stringField(body?.endPoint, 'Tujuan perjalanan', 300);
      const startPointLocation = journeyLocationField(
        body?.startPointLocation,
        startPoint,
        'Koordinat titik awal',
      );
      const endPointLocation = journeyLocationField(
        body?.endPointLocation,
        endPoint,
        'Koordinat tujuan perjalanan',
      );
      if (
        body?.vehicleName !== undefined &&
        body?.vehicleName !== null &&
        typeof body.vehicleName !== 'string'
      ) {
        throw new HttpError(400, 'Jenis kendaraan tidak valid.');
      }
      const requestedVehicleName =
        typeof body?.vehicleName === 'string' && body.vehicleName.trim()
          ? body.vehicleName.trim()
          : DEFAULT_DRIVER_VEHICLE_NAME;
      if (!isDriverVehicleName(requestedVehicleName)) {
        throw new HttpError(400, 'Jenis kendaraan tidak dikenal.');
      }
      const vehicleName = requestedVehicleName;
      const distanceKm = numberField(body?.distanceKm, 'Jarak satu arah', { min: 0.001, max: 10_000 });
      const durationHours = numberField(body?.durationHours, 'Durasi satu arah', { min: 0.001, max: 10_000 });
      const tollParkingFee = numberField(body?.tollParkingFee ?? 0, 'Tol & parkir', { min: 0, max: MAX_MONEY });
      const activityDate = jakartaToday();
      const period = pekaryaPayrollPeriodForDate(activityDate);
      const journeyId = `JRN-PIKET-${activityDate.replaceAll('-', '')}-${randomUUID().replaceAll('-', '').slice(0, 12).toUpperCase()}`;
      const journeyRef = adminDb.collection('DriverJourneys').doc(journeyId);

      const result = await adminDb.runTransaction(async (transaction) => {
        const scheduleQuery = adminDb.collection('DriverPiketSchedules').where('date', '==', activityDate);
        const activeJourneyQuery = adminDb
          .collection('DriverJourneys')
          .where('employeeId', '==', actor.linkedEmployeeId);
        const periodRef = adminDb.collection('PayrollPeriods').doc(period);
        const [scheduleSnapshot, activeJourneySnapshot, periodSnapshot] = await Promise.all([
          transaction.get(scheduleQuery),
          transaction.get(activeJourneyQuery),
          transaction.get(periodRef),
        ]);
        if (periodSnapshot.data()?.attendanceStatus === 'closed') {
          throw new HttpError(
            409,
            `Periode payroll ${period} sudah ditutup; perjalanan baru tidak dapat dibuat.`,
          );
        }
        const hasSchedule = scheduleSnapshot.docs.some(
          (schedule) => schedule.data().driverId === actor.linkedEmployeeId,
        );
        if (!hasSchedule) {
          throw new HttpError(409, 'Anda tidak memiliki jadwal Piket aktif untuk hari ini.');
        }
        // Read the driver's complete journey set in this transaction. A
        // submitted journey is deliberately not a blocker; only an unresolved
        // claimed journey prevents overlapping reports.
        if (hasClaimedDriverJourney(activeJourneySnapshot.docs.map((journey) => journey.data()))) {
          throw new HttpError(409, 'Anda masih memiliki perjalanan aktif yang belum diselesaikan.');
        }

        const selfWageEst = calculateEstimatedDriverWage(distanceKm * 2, durationHours * 2);
        const operationalCosts = calculateDriverJourneyOperationalCosts(
          distanceKm,
          durationHours * 2,
          vehicleName,
          tollParkingFee,
        );
        const now = admin.firestore.FieldValue.serverTimestamp();
        const selfFuelFields = vehicleName === DEFAULT_DRIVER_VEHICLE_NAME
          ? {
              fuelProcurementMode: DEFAULT_FUEL_PROCUREMENT_MODE,
              fuelReservationVersion: CURRENT_FUEL_RESERVATION_VERSION,
              fuelReservationId: `FUEL-${journeyId}`,
              fuelReservationState: 'none',
              fuelReservationVehicleName: vehicleName,
              heldFuelAmount: 0,
              procuredAccumulatedAmount: 0,
              fuelAllowanceForSettlement: 0,
              fuelTotalAllocation: 0,
              fuelModeSelectionRequired: false,
            }
          : {
              fuelProcurementMode: null,
              fuelModeSelectionRequired: true,
            };
        transaction.create(journeyRef, {
          id: journeyId,
          activityName,
          activityDate,
          journeyDate: activityDate,
          startPoint,
          endPoint,
          mainDestinations: [endPoint],
          ...(startPointLocation !== undefined ? { startPointLocation } : {}),
          ...(endPointLocation !== undefined
            ? { mainDestinationLocations: [endPointLocation] }
            : {}),
          vehicleName,
          vehicleRate: operationalCosts.vehicleRate,
          distanceKm,
          totalDistanceKm: distanceKm * 2,
          durationHours,
          customDurationPP: durationHours * 2,
          baseOperationalCost: operationalCosts.baseOperationalCost,
          mealAllowance: operationalCosts.mealAllowance,
          tollParkingFee,
          preAuthorizedToll: tollParkingFee,
          totalOperationalCost: operationalCosts.totalOperationalCost,
          ...selfFuelFields,
          estimatedComponentJarak: selfWageEst.compJarak,
          estimatedComponentWaktu: selfWageEst.compWaktu,
          estimatedBaseDriverWage: selfWageEst.baseWage,
          estimatedMaxDriverWage: selfWageEst.maxWage,
          employeeId: actor.linkedEmployeeId,
          employeeName: actor.displayName,
          claimedBy: actor.uid,
          claimedByName: actor.displayName,
          claimedAt: now,
          status: 'claimed',
          isSelfCreatedPiketSpj: true,
          createdAt: now,
          authorizedAt: now,
          authorizedBy: actor.uid,
          authorizedByName: actor.displayName,
          authorizationMode: 'driver_piket_self',
          createdBy: actor.uid,
          period,
          payrollPeriod: period,
        });
        return { journeyId, status: 'claimed' };
      });

      return NextResponse.json(result, { status: 201 });
    }

    if (action === 'select_fuel_mode') {
      requireSopirProfile(actor);
      const journeyId = stringField(body?.journeyId, 'ID perjalanan', 180);
      if (!SAFE_JOURNEY_ID.test(journeyId)) throw new HttpError(400, 'ID perjalanan tidak valid.');
      const requestedFuelMode = body?.fuelProcurementMode;
      if (!isFuelProcurementMode(requestedFuelMode)) {
        throw new HttpError(400, 'Mode pengadaan BBM tidak valid.');
      }
      const journeyRef = adminDb.collection('DriverJourneys').doc(journeyId);
      const reservationId = `FUEL-${journeyId}-${randomUUID().replaceAll('-', '').slice(0, 16).toUpperCase()}`;
      const result = await adminDb.runTransaction(async (transaction) => {
        const journeySnapshot = await transaction.get(journeyRef);
        if (!journeySnapshot.exists) throw new HttpError(404, 'Perjalanan dinas tidak ditemukan.');
        const journey = journeySnapshot.data()!;
        await assertJourneyPeriodOpen(transaction, payrollPeriodFromJourney(journey));
        if (!canDriverAccessJourney(journey, actor)) {
          throw new HttpError(403, 'Perjalanan dinas ini bukan milik Anda.');
        }
        if (!journey.isSelfCreatedPiketSpj && !journeyId.startsWith('JRN-PIKET-')) {
          throw new HttpError(403, 'Mode BBM mandiri hanya berlaku untuk SPJ Piket mandiri.');
        }
        if (String(journey.status || '') !== 'claimed') {
          throw new HttpError(409, 'Mode BBM hanya dapat dipilih saat perjalanan masih aktif.');
        }
        if (journey.fuelModeSelectionRequired !== true) {
          if (journeyFuelMode(journey) === requestedFuelMode) {
            return {
              journeyId,
              fuelProcurementMode: journeyFuelMode(journey),
              heldFuelAmount: Number(journey.heldFuelAmount || 0),
              procuredAccumulatedAmount: Number(journey.procuredAccumulatedAmount || 0),
              fuelAllowanceForSettlement: Number(journey.fuelAllowanceForSettlement || 0),
              fuelTotalAllocation: Number(journey.fuelTotalAllocation || 0),
              fuelBalance: null,
              idempotent: true,
            };
          }
          throw new HttpError(409, 'Mode BBM perjalanan sudah dikunci.');
        }
        if (journey.vehicleName === DEFAULT_DRIVER_VEHICLE_NAME && requestedFuelMode !== DEFAULT_FUEL_PROCUREMENT_MODE) {
          throw new HttpError(400, 'Kendaraan Ndalem hanya menggunakan Pengisian Standard.');
        }

        const vehicleName = journey.vehicleName as string;
        if (!isDriverVehicleName(vehicleName)) {
          throw new HttpError(409, 'Jenis kendaraan perjalanan tidak valid.');
        }
        const baseFuelAllowance = Math.ceil(Number(journey.baseOperationalCost || 0));
        const balanceVehicles = vehicleName === DEFAULT_DRIVER_VEHICLE_NAME ? [] : [vehicleName];
        const fuelContext = balanceVehicles.length > 0
          ? await createFuelLedgerContext(transaction, balanceVehicles, {
              uid: actor.uid,
              displayName: actor.displayName,
              role: actor.role,
            })
          : null;
        let reservation: FuelReservationRecord;
        if (requestedFuelMode === DEFAULT_FUEL_PROCUREMENT_MODE) {
          reservation = {
            fuelReservationVersion: CURRENT_FUEL_RESERVATION_VERSION,
            fuelReservationId: reservationId,
            fuelReservationState: 'none',
            fuelReservationVehicleName: vehicleName,
            fuelProcurementMode: requestedFuelMode,
            baseFuelAllowance,
            heldFuelAmount: 0,
            procuredAccumulatedAmount: 0,
          };
        } else if (fuelContext) {
          reservation = reserveFuel(fuelContext, {
            journeyId,
            reservationId,
            vehicleName,
            mode: requestedFuelMode,
            baseFuelAllowance,
            reason: 'Reservasi BBM saat pemilihan mode SPJ Piket mandiri',
          });
        } else {
          throw new HttpError(409, 'Saldo BBM kendaraan tidak dapat diproses.');
        }
        const totalOperationalCost =
          (reservation.fuelProcurementMode === 'hold_accumulate'
            ? 0
            : reservation.baseFuelAllowance + reservation.procuredAccumulatedAmount) +
          Number(journey.mealAllowance || 0) +
          Number(journey.tollParkingFee || 0);
        if (fuelContext) flushFuelLedger(fuelContext);
        const selectedFuelFields = reservationFields(reservation);
        transaction.update(journeyRef, {
          ...selectedFuelFields,
          fuelModeSelectionRequired: false,
          totalOperationalCost,
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        });
        return {
          journeyId,
          fuelProcurementMode: requestedFuelMode,
          ...selectedFuelFields,
          totalOperationalCost,
          fuelBalance: fuelContext && vehicleName !== DEFAULT_DRIVER_VEHICLE_NAME
            ? getBalanceFromContext(fuelContext, vehicleName)
            : null,
          idempotent: false,
        };
      });
      return NextResponse.json(result);
    }

    if (action === 'claim') {
      requireSopirProfile(actor);
      const journeyId = stringField(body?.journeyId, 'ID perjalanan', 180);
      if (!SAFE_JOURNEY_ID.test(journeyId)) throw new HttpError(400, 'ID perjalanan tidak valid.');
      const journeyRef = adminDb.collection('DriverJourneys').doc(journeyId);
      const result = await adminDb.runTransaction(async (transaction) => {
        const activeQuery = adminDb.collection('DriverJourneys').where('employeeId', '==', actor.linkedEmployeeId);
        const [journeySnapshot, activeSnapshot] = await Promise.all([
          transaction.get(journeyRef),
          transaction.get(activeQuery),
        ]);
        if (!journeySnapshot.exists) throw new HttpError(404, 'Perjalanan dinas tidak ditemukan.');
        if (hasClaimedDriverJourney(activeSnapshot.docs.map((journey) => journey.data()))) {
          throw new HttpError(409, 'Anda masih memiliki perjalanan aktif yang belum diselesaikan.');
        }
        const journey = journeySnapshot.data()!;
        await assertJourneyPeriodOpen(
          transaction,
          payrollPeriodFromJourney(journey),
        );
        const status = String(journey.status || '');
        if (status === 'assigned' && journey.assignedTo !== actor.linkedEmployeeId) {
          throw new HttpError(409, 'Perjalanan ini ditugaskan kepada sopir lain.');
        }
        if (!['unassigned', 'open', 'assigned'].includes(status)) {
          throw new HttpError(409, 'Perjalanan ini sudah diambil atau sedang diproses sopir lain.');
        }
        const existingReservation = reservationFromJourney(journey);
        let reservationUpdate: Record<string, unknown> = {};
        if (
          existingReservation &&
          existingReservation.fuelReservationState === 'released' &&
          existingReservation.fuelProcurementMode !== DEFAULT_FUEL_PROCUREMENT_MODE
        ) {
          const vehicleName = existingReservation.fuelReservationVehicleName;
          if (vehicleName === DEFAULT_DRIVER_VEHICLE_NAME || !isDriverVehicleName(vehicleName)) {
            throw new HttpError(409, 'Kendaraan reservasi BBM tidak valid.');
          }
          const fuelContext = await createFuelLedgerContext(transaction, [vehicleName], {
            uid: actor.uid,
            displayName: actor.displayName,
            role: actor.role,
          });
          const reReserved = reserveFuel(fuelContext, {
            journeyId,
            reservationId: `FUEL-${journeyId}-CLAIM-${randomUUID().replaceAll('-', '').slice(0, 16).toUpperCase()}`,
            vehicleName,
            mode: existingReservation.fuelProcurementMode,
            baseFuelAllowance: existingReservation.baseFuelAllowance,
            reason: 'Reservasi ulang BBM saat klaim ulang perjalanan',
          });
          reservationUpdate = reservationFields(reReserved);
          flushFuelLedger(fuelContext);
        }
        transaction.update(journeyRef, {
          ...reservationUpdate,
          status: 'claimed',
          employeeId: actor.linkedEmployeeId,
          employeeName: actor.displayName,
          claimedBy: actor.uid,
          claimedByName: actor.displayName,
          claimedAt: admin.firestore.FieldValue.serverTimestamp(),
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        });
        return { journeyId, status: 'claimed' };
      });
      return NextResponse.json(result);
    }

    if (action === 'cancel_claim') {
      requireSopirProfile(actor);
      const journeyId = stringField(body?.journeyId, 'ID perjalanan', 180);
      if (!SAFE_JOURNEY_ID.test(journeyId)) throw new HttpError(400, 'ID perjalanan tidak valid.');
      const journeyRef = adminDb.collection('DriverJourneys').doc(journeyId);
      const result = await adminDb.runTransaction(async (transaction) => {
        const journeySnapshot = await transaction.get(journeyRef);
        if (!journeySnapshot.exists) throw new HttpError(404, 'Perjalanan dinas tidak ditemukan.');
        const journey = journeySnapshot.data()!;
        await assertJourneyPeriodOpen(
          transaction,
          payrollPeriodFromJourney(journey),
        );
        if (
          journey.status !== 'claimed' ||
          (journey.employeeId !== actor.linkedEmployeeId && journey.claimedBy !== actor.uid)
        ) {
          throw new HttpError(403, 'Perjalanan ini bukan klaim aktif Anda.');
        }
        const isSelfCreated = Boolean(
          journey.isSelfCreatedPiketSpj || journeyId.startsWith('JRN-PIKET-'),
        );
        const reservation = reservationFromJourney(journey);
        const fuelContext = reservation?.fuelReservationState === 'reserved'
          ? await createFuelLedgerContext(transaction, [reservation.fuelReservationVehicleName], {
              uid: actor.uid,
              displayName: actor.displayName,
              role: actor.role,
            })
          : null;
        const releasedReservation = fuelContext && reservation
          ? releaseFuelReservation(fuelContext, reservation, 'Pembatalan klaim perjalanan oleh Sopir', journeyId)
          : reservation;
        if (fuelContext) flushFuelLedger(fuelContext);
        if (isSelfCreated) {
          transaction.delete(journeyRef);
          return { journeyId, status: 'deleted' };
        }
        transaction.update(journeyRef, {
          status: journey.assignedTo ? 'assigned' : 'unassigned',
          employeeId: admin.firestore.FieldValue.delete(),
          employeeName: admin.firestore.FieldValue.delete(),
          claimedBy: admin.firestore.FieldValue.delete(),
          claimedByName: admin.firestore.FieldValue.delete(),
          claimedAt: admin.firestore.FieldValue.delete(),
          ...(releasedReservation ? reservationFields(releasedReservation) : {}),
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        });
        return { journeyId, status: journey.assignedTo ? 'assigned' : 'unassigned' };
      });
      return NextResponse.json(result);
    }

    if (action === 'save_draft') {
      requireSopirProfile(actor);
      const journeyId = stringField(body?.journeyId, 'ID perjalanan', 180);
      if (!SAFE_JOURNEY_ID.test(journeyId)) throw new HttpError(400, 'ID perjalanan tidak valid.');
      if (!body?.draft || typeof body.draft !== 'object') {
        throw new HttpError(400, 'Data draft perjalanan tidak valid.');
      }
      const draft = body.draft as Record<string, unknown>;
      const draftData: Record<string, unknown> = {};
      if (draft.isMultiDay !== undefined && typeof draft.isMultiDay !== 'boolean') throw new HttpError(400, 'Status multi-hari tidak valid.');
      const draftIsMultiDay = draft.isMultiDay === true;
      const draftDate = draft.date !== undefined ? dateField(draft.date, 'Tanggal draft') : '';
      if (draft.date !== undefined) draftData.draftDate = draftDate;
      if (!draftIsMultiDay && draftDate) {
        draftData.draftDateEnd = draftDate;
      } else if (draft.dateEnd !== undefined && draft.dateEnd !== '') {
        draftData.draftDateEnd = dateField(draft.dateEnd, 'Tanggal selesai draft');
      }
      if (draft.isMultiDay !== undefined) draftData.draftIsMultiDay = draftIsMultiDay;
      for (const [source, target] of [['timeStart', 'draftTimeStart'], ['timeEnd', 'draftTimeEnd']] as const) {
        if (draft[source] !== undefined) draftData[target] = stringField(draft[source], source, 5);
      }
      if (draft.nightCount !== undefined) {
        draftData.draftNightCount = draftIsMultiDay
          ? numberField(draft.nightCount, 'Jumlah malam', { min: 0, max: 365, integer: true })
          : 0;
      }
      for (const [source, target] of [['ndalemMealMoneyReceived', 'draftNdalemMealMoneyReceived'], ['fuelFee', 'draftFuelFee'], ['tollParkingFee', 'draftTollParkingFee']] as const) {
        if (draft[source] !== undefined) draftData[target] = numberField(draft[source], source, { min: 0, max: MAX_MONEY });
      }
      const normalizeDraftReceipt = (
        feeSource: 'fuelFee' | 'tollParkingFee',
        urlSource: 'fuelReceiptUrl' | 'tollReceiptUrl',
        evidenceSource: 'fuelReceiptEvidence' | 'tollReceiptEvidence',
        urlTarget: 'draftFuelReceiptUrl' | 'draftTollReceiptUrl',
        evidenceTarget: 'draftFuelReceiptEvidence' | 'draftTollReceiptEvidence',
      ) => {
        if (
          draft[feeSource] === undefined &&
          draft[urlSource] === undefined &&
          draft[evidenceSource] === undefined
        ) {
          return;
        }
        const fee = draft[feeSource] === undefined
          ? 0
          : numberField(draft[feeSource], feeSource, { min: 0, max: MAX_MONEY });
        const url = typeof draft[urlSource] === 'string'
          ? draft[urlSource].split(',').map((item) => item.trim()).filter(Boolean).join(',')
          : '';
        if (fee <= 0 || !url) {
          draftData[urlTarget] = '';
          draftData[evidenceTarget] = admin.firestore.FieldValue.delete();
          return;
        }
        draftData[urlTarget] = url.slice(0, 20_000);
        if (draft[evidenceSource] !== undefined) {
          if (!Array.isArray(draft[evidenceSource]) || draft[evidenceSource].length > 20) {
            throw new HttpError(400, `${evidenceSource} tidak valid.`);
          }
          draftData[evidenceTarget] = draft[evidenceSource];
        } else {
          draftData[evidenceTarget] = admin.firestore.FieldValue.delete();
        }
      };
      normalizeDraftReceipt(
        'fuelFee',
        'fuelReceiptUrl',
        'fuelReceiptEvidence',
        'draftFuelReceiptUrl',
        'draftFuelReceiptEvidence',
      );
      normalizeDraftReceipt(
        'tollParkingFee',
        'tollReceiptUrl',
        'tollReceiptEvidence',
        'draftTollReceiptUrl',
        'draftTollReceiptEvidence',
      );
      if (draft.extraActivities !== undefined) {
        if (!Array.isArray(draft.extraActivities) || draft.extraActivities.length > 30) throw new HttpError(400, 'Lokasi tambahan tidak valid.');
        draftData.draftExtraActivities = draft.extraActivities;
      }
      for (const [source, target] of [['calculatedDistanceKm', 'draftCalculatedDistanceKm'], ['calculatedDurationHours', 'draftCalculatedDurationHours']] as const) {
        if (draft[source] !== undefined) draftData[target] = numberField(draft[source], source, { min: 0, max: 10_000 });
      }
      if (draft.startPoint !== undefined) {
        const draftStartPoint = stringField(draft.startPoint, 'Titik awal', 300);
        draftData.draftStartPoint = draftStartPoint;
        draftData.startPoint = draftStartPoint;
      }
      if (draft.mainDestinations !== undefined) {
        const draftMainDestinations = mainDestinationsField(draft.mainDestinations);
        draftData.draftMainDestinations = draftMainDestinations;
        draftData.mainDestinations = draftMainDestinations;
        draftData.draftEndPoint = draftMainDestinations[0];
        draftData.endPoint = draftMainDestinations[0];
      } else if (draft.endPoint !== undefined) {
        draftData.draftEndPoint = stringField(draft.endPoint, 'Tujuan perjalanan', 300);
        draftData.endPoint = draftData.draftEndPoint;
        draftData.draftMainDestinations = [draftData.draftEndPoint];
        draftData.mainDestinations = [draftData.draftEndPoint];
      }
      if (draft.startPointLocation !== undefined) {
        const locationAddress = typeof draftData.startPoint === 'string'
          ? draftData.startPoint
          : (
              draft.startPointLocation === null
                ? ''
                : stringField(draft.startPoint, 'Titik awal', 300)
            );
        const location = journeyLocationField(
          draft.startPointLocation,
          locationAddress,
          'Koordinat titik awal',
        );
        draftData.draftStartPointLocation = location;
        draftData.startPointLocation = location;
      }
      if (draft.mainDestinationLocations !== undefined) {
        const locationAddresses = Array.isArray(draftData.mainDestinations)
          ? draftData.mainDestinations as string[]
          : mainDestinationsField(draft.mainDestinations, draft.endPoint);
        const locations = journeyLocationsField(
          draft.mainDestinationLocations,
          locationAddresses,
          'Koordinat tujuan utama',
        );
        draftData.draftMainDestinationLocations = locations;
        draftData.mainDestinationLocations = locations;
      }

      const journeyRef = adminDb.collection('DriverJourneys').doc(journeyId);
      await adminDb.runTransaction(async (transaction) => {
        const journeySnapshot = await transaction.get(journeyRef);
        if (!journeySnapshot.exists) throw new HttpError(404, 'Perjalanan dinas tidak ditemukan.');
        const journey = journeySnapshot.data()!;
        await assertJourneyPeriodOpen(
          transaction,
          payrollPeriodFromJourney(journey),
        );
        if (
          !['claimed', 'submitted', 'declined'].includes(String(journey.status || '')) ||
          journey.employeeId !== actor.linkedEmployeeId
        ) {
          throw new HttpError(403, 'Draft hanya dapat diubah oleh sopir yang sedang memegang perjalanan.');
        }
        transaction.update(journeyRef, {
          ...draftData,
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        });
      });
      return NextResponse.json({ journeyId, saved: true });
    }

    throw new HttpError(400, 'Aksi perjalanan tidak dikenal.');
  } catch (error) {
    if (error instanceof VehicleFuelConflictError) {
      return errorResponse(new HttpError(409, error.message));
    }
    return errorResponse(error);
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const actor = await requireAuthenticatedProfile(request);
    requireJourneyManager(actor);

    const { searchParams } = new URL(request.url);
    const requestedJourneyId = searchParams.get('journeyId');
    let journeyId = requestedJourneyId ? requestedJourneyId.trim() : '';

    if (!journeyId) {
      try {
        const body = await request.json();
        if (typeof body?.journeyId === 'string') {
          journeyId = body.journeyId.trim();
        }
      } catch { }
    }

    if (!journeyId || !SAFE_JOURNEY_ID.test(journeyId)) {
      throw new HttpError(400, 'ID perjalanan tidak valid.');
    }

    const journeyRef = adminDb.collection('DriverJourneys').doc(journeyId);

    const result = await adminDb.runTransaction(async (transaction) => {
      const journeySnapshot = await transaction.get(journeyRef);
      if (!journeySnapshot.exists) {
        throw new HttpError(404, 'Perjalanan dinas tidak ditemukan.');
      }

      const journey = journeySnapshot.data()!;
      await assertJourneyPeriodOpen(
        transaction,
        payrollPeriodFromJourney(journey),
      );
      const status = String(journey.status || '');

      if (status === 'claimed') {
        throw new HttpError(
          409,
          'Perjalanan yang sedang aktif jalan tidak dapat dihapus. Batalkan klaim terlebih dahulu.',
        );
      }
      if (status === 'completed') {
        throw new HttpError(
          409,
          'Perjalanan yang sudah selesai tidak dapat dihapus.',
        );
      }

      // Check if there is an ActivityReport linked to this journey
      const activityDocId = typeof journey.activityDocId === 'string' ? journey.activityDocId : null;
      const reportDeletes: Array<{
        reportRef: FirebaseFirestore.DocumentReference;
        indexRef?: FirebaseFirestore.DocumentReference;
      }> = [];
      if (activityDocId) {
        const reportRef = adminDb.collection('ActivityReports').doc(activityDocId);
        const reportSnapshot = await transaction.get(reportRef);
        if (reportSnapshot.exists) {
          // Clean up PekaryaActivityIndex if present
          const reportData = reportSnapshot.data()!;
          const identity = buildPekaryaActivityIdentity(
            String(reportData.employeeId || ''),
            String(reportData.activityDate || ''),
            String(reportData.timeStart || ''),
            reportData.timeEnd ? String(reportData.timeEnd) : undefined,
            String(reportData.activityName || ''),
          );
          const indexRef = adminDb.collection('PekaryaActivityIndexes').doc(identity);
          reportDeletes.push({ reportRef, indexRef });
        }
      } else {
        // Also check if any report has journeyId == journeyId
        const reportQuery = adminDb.collection('ActivityReports').where('journeyId', '==', journeyId);
        const reportSnapshots = await transaction.get(reportQuery);
        reportSnapshots.docs.forEach((doc) => {
          reportDeletes.push({ reportRef: doc.ref });
        });
      }

      const reservation = reservationFromJourney(journey);
      const fuelContext = reservation?.fuelReservationState === 'reserved'
        ? await createFuelLedgerContext(transaction, [reservation.fuelReservationVehicleName], {
            uid: actor.uid,
            displayName: actor.displayName,
            role: actor.role,
          })
        : null;
      if (fuelContext && reservation) {
        releaseFuelReservation(fuelContext, reservation, 'Penghapusan perjalanan sebelum penyelesaian', journeyId);
        flushFuelLedger(fuelContext);
      }

      for (const reportDelete of reportDeletes) {
        transaction.delete(reportDelete.reportRef);
        if (reportDelete.indexRef) transaction.delete(reportDelete.indexRef);
      }

      // Delete the DriverJourney document
      transaction.delete(journeyRef);

      // Add financial audit record
      transaction.create(
        newFinancialAuditRef(),
        buildFinancialAuditRecord(actor, {
          action: 'DRIVER_JOURNEY_DELETED',
          entityType: 'DriverJourney',
          entityId: journeyId,
          reason: 'Penghapusan perjalanan dinas oleh Kepala SatKer / Admin',
          before: journey,
          after: null,
          metadata: { status, journeyId },
        }),
      );

      return { journeyId, deleted: true };
    });

    return NextResponse.json(result);
  } catch (error) {
    if (error instanceof VehicleFuelConflictError) {
      return errorResponse(new HttpError(409, error.message));
    }
    return errorResponse(error);
  }
}
