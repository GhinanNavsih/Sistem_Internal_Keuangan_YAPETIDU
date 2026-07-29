import { randomUUID } from 'node:crypto';
import { NextRequest, NextResponse } from 'next/server';
import admin from '@/lib/firebase-admin';
import { adminDb } from '@/lib/firebase-admin';
import { assertDateOnly } from '@/lib/payroll/domain';
import {
  DRIVER_VEHICLE_RATES,
  calculateEstimatedDriverWage,
  getMealAllowanceForDuration,
} from '@/lib/payroll/driverJourney';
import { pekaryaPayrollPeriodForDate } from '@/lib/payroll/pekaryaSpj';
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
    if (actor.role !== 'honorer' || !actor.linkedEmployeeId) {
      throw new HttpError(403, 'Hanya akun Sopir yang dapat memuat perjalanan dinas.');
    }
    if (!actor.permittedCategories.includes('SOPIR')) {
      throw new HttpError(403, 'Akun ini tidak terdaftar sebagai Sopir.');
    }

    const searchParams = new URL(request.url).searchParams;
    const requestedDriverId = searchParams.get('driverId');
    if (requestedDriverId && requestedDriverId !== actor.linkedEmployeeId) {
      throw new HttpError(403, 'Anda hanya dapat memuat perjalanan milik sendiri.');
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
      if (!canDriverAccessJourney(journey, actor)) {
        throw new HttpError(403, 'Perjalanan dinas ini bukan milik Anda.');
      }
      return NextResponse.json({ journey: { id: journeySnapshot.id, ...journey } });
    }

    const snapshot = await adminDb
      .collection('DriverJourneys')
      .where('employeeId', '==', actor.linkedEmployeeId)
      .get();

    const journeys = snapshot.docs.map((document) => ({
      id: document.id,
      ...document.data(),
    }));

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
      const startPoint = stringField(body?.startPoint, 'Titik awal', 300);
      const endPoint = stringField(body?.endPoint, 'Tujuan perjalanan', 300);
      const vehicleName = stringField(body?.vehicleName, 'Jenis kendaraan', 80);
      if (!(vehicleName in DRIVER_VEHICLE_RATES)) {
        throw new HttpError(400, 'Jenis kendaraan tidak dikenal.');
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

        const rate = DRIVER_VEHICLE_RATES[vehicleName as keyof typeof DRIVER_VEHICLE_RATES];
        const baseOperationalCost = distanceKm * 2 * rate;
        const mealAllowance = vehicleName === 'Ndalem'
          ? 0
          : getMealAllowanceForDuration(customDurationPP, vehicleName);
        const totalOperationalCost = baseOperationalCost + mealAllowance + tollParkingFee;
        const status = assignedTo ? 'assigned' : 'unassigned';
        const now = admin.firestore.FieldValue.serverTimestamp();
        const journeyData: Record<string, unknown> = {
          activityName,
          activityDate,
          journeyDate: activityDate,
          startPoint,
          endPoint,
          vehicleName,
          vehicleRate: rate,
          distanceKm,
          totalDistanceKm: distanceKm * 2,
          durationHours,
          customDurationPP,
          baseOperationalCost,
          mealAllowance,
          tollParkingFee,
          totalOperationalCost,
          estimatedComponentJarak: wageEst.compJarak,
          estimatedComponentWaktu: wageEst.compWaktu,
          estimatedBaseDriverWage: wageEst.baseWage,
          estimatedMaxDriverWage: wageEst.maxWage,
          destinationImageUrl: typeof body?.destinationImageUrl === 'string' ? body.destinationImageUrl : null,
          assignedTo,
          assignedToName,
          status,
          period,
          payrollPeriod: period,
          updatedAt: now,
          authorizedBy: actor.uid,
          authorizedByName: actor.displayName,
        };

        if (!existing) {
          journeyData.id = journeyId;
          journeyData.createdAt = now;
          journeyData.authorizedAt = now;
          journeyData.createdBy = actor.uid;
        }
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
        const [scheduleSnapshot, activeJourneySnapshot] = await Promise.all([
          transaction.get(scheduleQuery),
          transaction.get(activeJourneyQuery),
        ]);
        const hasSchedule = scheduleSnapshot.docs.some(
          (schedule) => schedule.data().driverId === actor.linkedEmployeeId,
        );
        if (!hasSchedule) {
          throw new HttpError(409, 'Anda tidak memiliki jadwal Piket aktif untuk hari ini.');
        }
        if (activeJourneySnapshot.docs.some((journey) => journey.data().status === 'claimed')) {
          throw new HttpError(409, 'Anda masih memiliki perjalanan aktif yang belum diselesaikan.');
        }

        const selfWageEst = calculateEstimatedDriverWage(distanceKm * 2, durationHours * 2);
        const now = admin.firestore.FieldValue.serverTimestamp();
        transaction.create(journeyRef, {
          id: journeyId,
          activityName,
          activityDate,
          journeyDate: activityDate,
          startPoint,
          endPoint,
          vehicleName: 'Ndalem',
          vehicleRate: 0,
          distanceKm,
          totalDistanceKm: distanceKm * 2,
          durationHours,
          customDurationPP: durationHours * 2,
          baseOperationalCost: 0,
          mealAllowance: 0,
          tollParkingFee,
          totalOperationalCost: tollParkingFee,
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
          createdBy: actor.uid,
          period,
          payrollPeriod: period,
        });
        return { journeyId, status: 'claimed' };
      });

      return NextResponse.json(result, { status: 201 });
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
        if (activeSnapshot.docs.some((journey) => journey.data().status === 'claimed')) {
          throw new HttpError(409, 'Anda masih memiliki perjalanan aktif yang belum diselesaikan.');
        }
        const journey = journeySnapshot.data()!;
        const status = String(journey.status || '');
        if (status === 'assigned' && journey.assignedTo !== actor.linkedEmployeeId) {
          throw new HttpError(409, 'Perjalanan ini ditugaskan kepada sopir lain.');
        }
        if (!['unassigned', 'open', 'assigned'].includes(status)) {
          throw new HttpError(409, 'Perjalanan ini sudah diambil atau sedang diproses sopir lain.');
        }
        transaction.update(journeyRef, {
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
        if (
          journey.status !== 'claimed' ||
          (journey.employeeId !== actor.linkedEmployeeId && journey.claimedBy !== actor.uid)
        ) {
          throw new HttpError(403, 'Perjalanan ini bukan klaim aktif Anda.');
        }
        const isSelfCreated = Boolean(
          journey.isSelfCreatedPiketSpj || journeyId.startsWith('JRN-PIKET-'),
        );
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
      if (draft.date !== undefined) draftData.draftDate = dateField(draft.date, 'Tanggal draft');
      if (draft.dateEnd !== undefined && draft.dateEnd !== '') draftData.draftDateEnd = dateField(draft.dateEnd, 'Tanggal selesai draft');
      if (draft.isMultiDay !== undefined && typeof draft.isMultiDay !== 'boolean') throw new HttpError(400, 'Status multi-hari tidak valid.');
      if (draft.isMultiDay !== undefined) draftData.draftIsMultiDay = draft.isMultiDay;
      for (const [source, target] of [['timeStart', 'draftTimeStart'], ['timeEnd', 'draftTimeEnd']] as const) {
        if (draft[source] !== undefined) draftData[target] = stringField(draft[source], source, 5);
      }
      if (draft.nightCount !== undefined) draftData.draftNightCount = numberField(draft.nightCount, 'Jumlah malam', { min: 0, max: 365, integer: true });
      for (const [source, target] of [['ndalemMealMoneyReceived', 'draftNdalemMealMoneyReceived'], ['fuelFee', 'draftFuelFee'], ['tollParkingFee', 'draftTollParkingFee']] as const) {
        if (draft[source] !== undefined) draftData[target] = numberField(draft[source], source, { min: 0, max: MAX_MONEY });
      }
      for (const [source, target] of [['fuelReceiptUrl', 'draftFuelReceiptUrl'], ['tollReceiptUrl', 'draftTollReceiptUrl']] as const) {
        if (draft[source] !== undefined) draftData[target] = typeof draft[source] === 'string' ? draft[source].slice(0, 20_000) : '';
      }
      if (draft.extraActivities !== undefined) {
        if (!Array.isArray(draft.extraActivities) || draft.extraActivities.length > 30) throw new HttpError(400, 'Lokasi tambahan tidak valid.');
        draftData.draftExtraActivities = draft.extraActivities;
      }
      for (const [source, target] of [['calculatedDistanceKm', 'draftCalculatedDistanceKm'], ['calculatedDurationHours', 'draftCalculatedDurationHours']] as const) {
        if (draft[source] !== undefined) draftData[target] = numberField(draft[source], source, { min: 0, max: 10_000 });
      }
      if (draft.endPoint !== undefined) {
        draftData.draftEndPoint = stringField(draft.endPoint, 'Tujuan perjalanan', 300);
        draftData.endPoint = draftData.draftEndPoint;
      }

      const journeyRef = adminDb.collection('DriverJourneys').doc(journeyId);
      await adminDb.runTransaction(async (transaction) => {
        const journeySnapshot = await transaction.get(journeyRef);
        if (!journeySnapshot.exists) throw new HttpError(404, 'Perjalanan dinas tidak ditemukan.');
        const journey = journeySnapshot.data()!;
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
    return errorResponse(error);
  }
}
