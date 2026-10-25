import assert from 'node:assert/strict';
import test from 'node:test';
import {
  deleteDriverJourneySimulationDraft,
  DRIVER_JOURNEY_SIMULATION_DRAFTS_COLLECTION,
  getDriverJourneySimulationDraft,
  saveDriverJourneySimulationDraft,
} from './driverJourneySimulations';
import type { AuthenticatedProfile } from './auth';

function createMockFirestore() {
  const store = new Map<string, Map<string, Record<string, unknown>>>();

  const getCollection = (col: string) => {
    let map = store.get(col);
    if (!map) {
      map = new Map();
      store.set(col, map);
    }
    return map;
  };

  const db = {
    collection(colName: string) {
      const colMap = getCollection(colName);
      return {
        doc(id: string) {
          return {
            async get() {
              const data = colMap.get(id);
              return {
                exists: data !== undefined,
                data: () => (data ? { ...data } : undefined),
              };
            },
            async set(data: Record<string, unknown>) {
              colMap.set(id, { ...data });
            },
            async delete() {
              colMap.delete(id);
            },
          };
        },
      };
    },
  };

  return db as any;
}

const mockActor: AuthenticatedProfile = {
  uid: 'user_loyalis_123',
  email: 'loyalis@unipdu.ac.id',
  role: 'satker_head_loyalis',
  displayName: 'Kepala SatKer Loyalis',
  permittedCategories: [],
};

test('saves, reads, and deletes driver journey simulation drafts in Firestore', async () => {
  const db = createMockFirestore();

  // Initially empty
  const initial = await getDriverJourneySimulationDraft(db, mockActor);
  assert.equal(initial, null);

  // Save draft
  const draftForm = {
    eventName: 'Seminar Entrepreneurship',
    journeys: [
      {
        key: 'journey-1',
        stops: ['Surabaya'],
        stopLocations: [{ address: 'Surabaya', latitude: -7.25, longitude: 112.75 }],
        vehicleName: 'Kendaraan Sendiri' as const,
        withoutDriver: true,
        departureDate: '2026-11-01',
        departureTime: '08:00',
        returnDate: '2026-11-01',
        returnTime: '17:00',
        tollSource: 'google' as const,
        tollInput: '',
        parkingInput: '20000',
        quote: null,
        quoteKey: '',
      },
    ],
  };

  await saveDriverJourneySimulationDraft(db, mockActor, {
    form: draftForm,
    savedId: null,
  });

  // Read draft back
  const loaded = await getDriverJourneySimulationDraft(db, mockActor);
  assert.notEqual(loaded, null);
  assert.equal(loaded?.savedId, null);
  assert.equal(loaded?.form.eventName, 'Seminar Entrepreneurship');
  assert.equal(loaded?.form.journeys.length, 1);
  assert.equal(loaded?.form.journeys[0].vehicleName, 'Kendaraan Sendiri');
  assert.equal(loaded?.form.journeys[0].withoutDriver, true);
  assert.equal(loaded?.form.journeys[0].parkingInput, '20000');

  // Delete draft
  await deleteDriverJourneySimulationDraft(db, mockActor);
  const afterDelete = await getDriverJourneySimulationDraft(db, mockActor);
  assert.equal(afterDelete, null);
});
