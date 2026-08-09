import { NextRequest } from 'next/server';
import admin, { adminDb } from '@/lib/firebase-admin';
import {
  DEFAULT_DRIVER_VEHICLE_NAME,
  isDriverVehicleName,
} from '@/lib/payroll/driverJourney';
import {
  applyManualAdjustment,
  createFuelLedgerContext,
  flushFuelLedger,
  getVehicleFuelBalance,
  getVehicleFuelBalances,
  getVehicleFuelLedger,
  MAX_VEHICLE_FUEL_ADJUSTMENT,
} from '@/lib/payroll/vehicleFuel';
import {
  errorResponse,
  HttpError,
  requireAuthenticatedProfile,
} from '@/lib/server/auth';

export const dynamic = 'force-dynamic';

function requireManager(actor: Awaited<ReturnType<typeof requireAuthenticatedProfile>>): void {
  if (actor.role !== 'super_admin' && actor.role !== 'satker_head') {
    throw new HttpError(403, 'Anda tidak memiliki kewenangan untuk mengelola saldo BBM kendaraan.');
  }
  if (actor.role === 'satker_head' && !actor.permittedCategories.includes('SOPIR')) {
    throw new HttpError(403, 'Anda tidak memiliki kewenangan untuk perjalanan Sopir.');
  }
}

function requireVehicle(value: string | null): string {
  if (!value || !isDriverVehicleName(value) || value === DEFAULT_DRIVER_VEHICLE_NAME) {
    throw new HttpError(400, 'Kendaraan akumulasi BBM tidak valid.');
  }
  return value;
}

function canDriverAccessJourney(
  data: FirebaseFirestore.DocumentData,
  actor: Awaited<ReturnType<typeof requireAuthenticatedProfile>>,
): boolean {
  return Boolean(
    actor.linkedEmployeeId &&
    (data.employeeId === actor.linkedEmployeeId || data.assignedTo === actor.linkedEmployeeId),
  );
}

export async function GET(request: NextRequest) {
  try {
    const actor = await requireAuthenticatedProfile(request);
    const params = new URL(request.url).searchParams;
    const requestedVehicle = params.get('vehicleName');
    const requestedJourneyId = params.get('journeyId');
    const includeHistory = params.get('history') === 'true';

    if (actor.role === 'super_admin' || actor.role === 'satker_head') {
      requireManager(actor);
      if (requestedVehicle) {
        const vehicleName = requireVehicle(requestedVehicle);
        const balance = await getVehicleFuelBalance(vehicleName as Parameters<typeof getVehicleFuelBalance>[0]);
        return Response.json({
          balance,
          history: includeHistory
            ? await getVehicleFuelLedger(vehicleName as Parameters<typeof getVehicleFuelLedger>[0])
            : undefined,
        });
      }
      const balances = await getVehicleFuelBalances();
      return Response.json({ balances });
    }

    if (actor.role !== 'honorer' || !actor.linkedEmployeeId || !actor.permittedCategories.includes('SOPIR')) {
      throw new HttpError(403, 'Hanya akun Sopir yang dapat melihat saldo kendaraannya.');
    }
    if (!requestedJourneyId || !/^[A-Za-z0-9_-]{1,180}$/.test(requestedJourneyId)) {
      throw new HttpError(400, 'ID perjalanan tidak valid.');
    }
    const journeySnapshot = await adminDb.collection('DriverJourneys').doc(requestedJourneyId).get();
    if (!journeySnapshot.exists || !canDriverAccessJourney(journeySnapshot.data()!, actor)) {
      throw new HttpError(403, 'Perjalanan dinas ini bukan milik Anda.');
    }
    const vehicleName = String(journeySnapshot.data()?.vehicleName || '');
    if (!isDriverVehicleName(vehicleName) || vehicleName === DEFAULT_DRIVER_VEHICLE_NAME) {
      return Response.json({ balance: null });
    }
    return Response.json({ balance: await getVehicleFuelBalance(vehicleName) });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function POST(request: NextRequest) {
  try {
    const actor = await requireAuthenticatedProfile(request);
    requireManager(actor);
    const body = await request.json().catch(() => null) as Record<string, unknown> | null;
    const vehicleName = requireVehicle(typeof body?.vehicleName === 'string' ? body.vehicleName : null);
    const delta = body?.delta;
    if (
      typeof delta !== 'number' ||
      !Number.isSafeInteger(delta) ||
      Math.abs(delta) > MAX_VEHICLE_FUEL_ADJUSTMENT
    ) {
      throw new HttpError(400, 'Penyesuaian saldo BBM tidak valid.');
    }
    const reason = typeof body?.reason === 'string' ? body.reason.trim() : '';
    if (reason.length < 8 || reason.length > 500) {
      throw new HttpError(400, 'Alasan penyesuaian saldo wajib diisi antara 8 dan 500 karakter.');
    }
    const requestId = typeof body?.requestId === 'string' ? body.requestId.trim() : '';
    if (!/^[A-Za-z0-9_-]{8,180}$/.test(requestId)) {
      throw new HttpError(400, 'requestId penyesuaian tidak valid.');
    }

    const result = await adminDb.runTransaction(async (transaction) => {
      const idempotencyRef = adminDb
        .collection('FinancialIdempotencyKeys')
        .doc(`${actor.uid}__vehicle_fuel__${requestId}`);
      const idempotencySnapshot = await transaction.get(idempotencyRef);
      if (idempotencySnapshot.exists) {
        return idempotencySnapshot.data()?.result || { idempotent: true };
      }
      const context = await createFuelLedgerContext(transaction, [vehicleName], {
        uid: actor.uid,
        displayName: actor.displayName,
        role: actor.role,
      });
      const balance = applyManualAdjustment(context, {
        vehicleName: vehicleName as Parameters<typeof applyManualAdjustment>[1]['vehicleName'],
        delta,
        reason,
        requestId,
      });
      flushFuelLedger(context);
      const response = { vehicleName, balance, idempotent: false };
      transaction.create(idempotencyRef, {
        requestHash: `${vehicleName}:${delta}:${reason}`,
        entityId: vehicleName,
        resultingStatus: 'applied',
        result: response,
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
      });
      return response;
    });
    return Response.json(result);
  } catch (error) {
    return errorResponse(error);
  }
}
