import type { firestore } from 'firebase-admin';
import type { SimulationDraft, SimulationForm } from '@/components/driver-simulation/simulationForm';
import {
  calculateSimulation,
  simulationRoutePoints,
  SimulationInputError,
  type RouteQuote,
  type SimulationInput,
  type SimulationJourneyResult,
  type SimulationView,
} from '@/lib/driverJourneySimulation';
import { HttpError, type AuthenticatedProfile } from '@/lib/server/auth';
import { loadRouteQuote } from '@/lib/server/driverRouteQuotes';

/**
 * Saved Simulasi Biaya Perjalanan, one document each. Every figure is worked
 * out here from the stored route answers, never taken from the browser. Only
 * the account that made a Simulasi sees it; Super Admin sees and may change
 * all of them. Server-only; the Firestore rules refuse browser access.
 */
type Firestore = firestore.Firestore;

export const DRIVER_JOURNEY_SIMULATIONS_COLLECTION = 'DriverJourneySimulations';
export const DRIVER_JOURNEY_SIMULATION_DRAFTS_COLLECTION = 'DriverJourneySimulationDrafts';
const SUPER_ADMIN_LIST_LIMIT = 200;

export type { SimulationDraft };

function isoOf(value: unknown): string {
  if (value instanceof Date) return value.toISOString();
  if (value && typeof value === 'object' && 'toDate' in value &&
    typeof (value as { toDate?: unknown }).toDate === 'function') {
    return (value as { toDate: () => Date }).toDate().toISOString();
  }
  return typeof value === 'string' ? value : '';
}

function toView(
  id: string,
  data: firestore.DocumentData,
  actor: AuthenticatedProfile,
): SimulationView {
  return {
    id,
    eventName: String(data.eventName || ''),
    ownerName: String(data.ownerName || ''),
    isOwner: data.ownerUid === actor.uid,
    journeys: Array.isArray(data.journeys) ? (data.journeys as SimulationJourneyResult[]) : [],
    grandTotal: Number(data.grandTotal || 0),
    calculatedAt: isoOf(data.calculatedAt),
    updatedAt: isoOf(data.updatedAt),
  };
}

function canSee(actor: AuthenticatedProfile, data: firestore.DocumentData): boolean {
  return actor.role === 'super_admin' || data.ownerUid === actor.uid;
}

/** Figures for a Simulasi, measuring each route through the shared route store. */
async function calculate(db: Firestore, input: SimulationInput, now: Date) {
  const quotes: RouteQuote[] = [];
  // One after another: two Perjalanan on the same route then share one answer.
  for (const journey of input.journeys) {
    quotes.push(await loadRouteQuote(db, simulationRoutePoints(journey.stops, journey.stopLocations), now));
  }
  try {
    return calculateSimulation(input.journeys, quotes);
  } catch (error) {
    if (error instanceof SimulationInputError) throw new HttpError(400, error.message);
    if (error instanceof Error) throw new HttpError(400, error.message);
    throw error;
  }
}

function documentFields(input: SimulationInput, result: Awaited<ReturnType<typeof calculate>>, now: Date) {
  return {
    eventName: input.eventName,
    journeys: result.journeys,
    grandTotal: result.grandTotal,
    calculatedAt: now,
    updatedAt: now,
  };
}

export async function listDriverJourneySimulations(
  db: Firestore,
  actor: AuthenticatedProfile,
): Promise<SimulationView[]> {
  const collection = db.collection(DRIVER_JOURNEY_SIMULATIONS_COLLECTION);
  // Owners filter on one field and sort here, so no composite index is needed.
  const snapshot = actor.role === 'super_admin'
    ? await collection.orderBy('updatedAt', 'desc').limit(SUPER_ADMIN_LIST_LIMIT).get()
    : await collection.where('ownerUid', '==', actor.uid).get();
  return snapshot.docs
    .map((document) => toView(document.id, document.data(), actor))
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

export async function getDriverJourneySimulation(
  db: Firestore,
  actor: AuthenticatedProfile,
  id: string,
): Promise<SimulationView> {
  const snapshot = await db.collection(DRIVER_JOURNEY_SIMULATIONS_COLLECTION).doc(id).get();
  const data = snapshot.data();
  if (!snapshot.exists || !data || !canSee(actor, data)) {
    throw new HttpError(404, 'Simulasi tidak ditemukan.');
  }
  return toView(snapshot.id, data, actor);
}

export async function createDriverJourneySimulation(
  db: Firestore,
  actor: AuthenticatedProfile,
  input: SimulationInput,
  now: Date = new Date(),
): Promise<SimulationView> {
  const result = await calculate(db, input, now);
  const ref = db.collection(DRIVER_JOURNEY_SIMULATIONS_COLLECTION).doc();
  const fields = {
    ...documentFields(input, result, now),
    ownerUid: actor.uid,
    ownerName: actor.displayName || actor.email || '',
    createdAt: now,
  };
  await ref.set(fields);
  return toView(ref.id, fields, actor);
}

/** Saves changes, or with the same content works the figures out again ("Hitung ulang"). */
export async function updateDriverJourneySimulation(
  db: Firestore,
  actor: AuthenticatedProfile,
  id: string,
  input: SimulationInput,
  now: Date = new Date(),
): Promise<SimulationView> {
  const ref = db.collection(DRIVER_JOURNEY_SIMULATIONS_COLLECTION).doc(id);
  const before = await ref.get();
  const beforeData = before.data();
  if (!before.exists || !beforeData || !canSee(actor, beforeData)) {
    throw new HttpError(404, 'Simulasi tidak ditemukan.');
  }
  const result = await calculate(db, input, now);
  const fields = documentFields(input, result, now);
  await ref.set(fields, { merge: true });
  return toView(id, { ...beforeData, ...fields }, actor);
}

export async function deleteDriverJourneySimulation(
  db: Firestore,
  actor: AuthenticatedProfile,
  id: string,
): Promise<void> {
  const ref = db.collection(DRIVER_JOURNEY_SIMULATIONS_COLLECTION).doc(id);
  const snapshot = await ref.get();
  const data = snapshot.data();
  if (!snapshot.exists || !data || !canSee(actor, data)) {
    throw new HttpError(404, 'Simulasi tidak ditemukan.');
  }
  await ref.delete();
}

export async function getDriverJourneySimulationDraft(
  db: Firestore,
  actor: AuthenticatedProfile,
): Promise<SimulationDraft | null> {
  const doc = await db.collection(DRIVER_JOURNEY_SIMULATION_DRAFTS_COLLECTION).doc(actor.uid).get();
  if (!doc.exists) return null;
  const data = doc.data();
  if (!data || !data.form || typeof data.form !== 'object') return null;
  const form = data.form as SimulationForm;
  if (!Array.isArray(form.journeys)) return null;

  return {
    savedId: typeof data.savedId === 'string' && data.savedId ? data.savedId : null,
    form: {
      eventName: typeof form.eventName === 'string' ? form.eventName : '',
      journeys: form.journeys.map((j) => ({
        key: typeof j.key === 'string' ? j.key : `journey-${Date.now()}`,
        stops: Array.isArray(j.stops) ? j.stops.map(String) : [],
        stopLocations: Array.isArray(j.stopLocations) ? j.stopLocations : [],
        vehicleName: typeof j.vehicleName === 'string' ? j.vehicleName : '',
        withoutDriver: Boolean(j.withoutDriver),
        departureDate: typeof j.departureDate === 'string' ? j.departureDate : '',
        departureTime: typeof j.departureTime === 'string' ? j.departureTime : '',
        returnDate: typeof j.returnDate === 'string' ? j.returnDate : '',
        returnTime: typeof j.returnTime === 'string' ? j.returnTime : '',
        tollSource: j.tollSource === 'manual' ? 'manual' : 'google',
        tollInput: typeof j.tollInput === 'string' ? j.tollInput : '',
        parkingInput: typeof j.parkingInput === 'string' ? j.parkingInput : '',
        quote: j.quote && typeof j.quote === 'object' ? j.quote : null,
        quoteKey: typeof j.quoteKey === 'string' ? j.quoteKey : '',
      })),
    },
    updatedAt: isoOf(data.updatedAt),
  };
}

export async function saveDriverJourneySimulationDraft(
  db: Firestore,
  actor: AuthenticatedProfile,
  draft: { form: SimulationForm; savedId: string | null },
  now: Date = new Date(),
): Promise<void> {
  const ref = db.collection(DRIVER_JOURNEY_SIMULATION_DRAFTS_COLLECTION).doc(actor.uid);
  await ref.set({
    ownerUid: actor.uid,
    savedId: typeof draft.savedId === 'string' && draft.savedId ? draft.savedId : null,
    form: draft.form,
    updatedAt: now,
  });
}

export async function deleteDriverJourneySimulationDraft(
  db: Firestore,
  actor: AuthenticatedProfile,
): Promise<void> {
  const ref = db.collection(DRIVER_JOURNEY_SIMULATION_DRAFTS_COLLECTION).doc(actor.uid);
  await ref.delete();
}
