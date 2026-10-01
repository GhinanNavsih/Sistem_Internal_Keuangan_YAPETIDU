/** Draft autosave round trips through the real API, writing ONLY to local emulators. */
import assert from 'node:assert/strict';
import { NextRequest } from 'next/server';
import { driverJourneyReportDraftPayload, type DriverJourneyReportDraftState } from '../src/lib/payroll/driverJourneyReportDraft';

const PROJECT = 'demo-driver-journey-draft';

async function main() {
  if (
    process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID !== PROJECT ||
    !/^(localhost|127\.0\.0\.1):8188$/.test(process.env.FIRESTORE_EMULATOR_HOST || '') ||
    !/^(localhost|127\.0\.0\.1):9198$/.test(process.env.FIREBASE_AUTH_EMULATOR_HOST || '')
  ) {
    throw new Error('This test requires the demo journey draft Firestore and Auth emulators.');
  }
  const { adminDb: db } = await import('../src/lib/firebase-admin');
  const { GET, POST } = await import('../src/app/api/driver-journeys/route');
  const signup = await fetch(
    `http://${process.env.FIREBASE_AUTH_EMULATOR_HOST}/identitytoolkit.googleapis.com/v1/accounts:signUp?key=demo`,
    {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'draft-driver@example.test', password: 'password123', returnSecureToken: true }),
    },
  );
  const identity = await signup.json();
  assert.ok(identity.idToken, JSON.stringify(identity));
  await db.doc(`users/${identity.localId}`).set({
    role: 'honorer', displayName: 'Draft test driver', linkedEmployeeId: 'DRIVER_DRAFT_TEST',
    permittedCategories: ['SOPIR'],
  });
  const journeyId = 'JRN-DRAFT-TEST-20261001';
  const journeyRef = db.doc(`DriverJourneys/${journeyId}`);
  await db.doc('PayrollPeriods/2026-10').set({ attendanceStatus: 'open' });
  await journeyRef.set({
    id: journeyId, status: 'claimed', employeeId: 'DRIVER_DRAFT_TEST',
    payrollPeriod: '2026-10', activityDate: '2026-10-01', vehicleName: 'Suzuki XL7',
    startPoint: 'Unipdu', mainDestinations: ['Surabaya'], endPoint: 'Surabaya',
  });
  const evidence = {
    url: 'https://example.test/fuel.jpg',
    auditMetadata: {
      capturedAt: '2026-10-01T01:00:00Z', latitude: -7.55, longitude: 112.3,
      deviceName: 'Test camera', hasExif: true,
      locationName: null, locationAddress: null, locationPlaceId: null,
    },
  };
  const state: DriverJourneyReportDraftState = {
    formDate: '2026-10-01', formDateEnd: '2026-10-01', formIsMultiDay: false,
    formTimeStart: '', formTimeEnd: '', formNightCount: 0,
    formNdalemMealMoneyFee: '', formFuelFee: '', formTollParkingFee: '',
    formFuelReceiptUrls: [evidence.url], formTollReceiptUrls: [],
    formFuelReceiptEvidence: [evidence], formTollReceiptEvidence: [],
    startPoint: 'Unipdu', startPointLocation: { address: 'Unipdu', latitude: -7.55, longitude: 112.3 },
    mainDestinations: ['Surabaya', 'Jombang'], mainDestinationLocations: [null, null],
    extraActivities: [
      { type: 'tambah_lokasi', destination: 'Surabaya', distanceKm: 90, durationHours: 2 },
      { type: 'tambah_lokasi', destination: 'Jombang', distanceKm: 80, durationHours: 2 },
    ],
    calculatedDistanceKm: 180, calculatedDurationHours: 4,
    outboundDistanceKm: 90, outboundDurationHours: 2, updatedAt: 100,
  };
  const save = async (draft = driverJourneyReportDraftPayload(state), expectedStatus = 200) => {
    const response = await POST(new NextRequest('http://localhost/api/driver-journeys', {
      method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${identity.idToken}` },
      body: JSON.stringify({ action: 'save_draft', journeyId, draft }),
    }));
    const result = await response.json();
    assert.equal(response.status, expectedStatus, JSON.stringify(result));
    return (await journeyRef.get()).data()!;
  };

  // An upload made before either clock or amount is entered must survive.
  let stored = await save();
  assert.equal(stored.draftTimeStart, '');
  assert.equal(stored.draftTimeEnd, '');
  assert.equal(stored.draftFuelFee, 0);
  assert.equal(stored.draftFuelReceiptUrl, evidence.url);
  assert.deepEqual(stored.draftFuelReceiptEvidence, [evidence]);
  assert.deepEqual(stored.draftMainDestinations, ['Surabaya', 'Jombang']);

  state.formTimeStart = '08:00';
  state.formTimeEnd = '14:30';
  state.formFuelFee = '150.000';
  state.formTollParkingFee = '25.000';
  state.formTollReceiptUrls = ['https://example.test/toll.jpg'];
  state.formTollReceiptEvidence = [{ ...evidence, url: state.formTollReceiptUrls[0] }];
  state.updatedAt = 200;
  stored = await save();
  assert.equal(stored.draftTimeEnd, '14:30');
  assert.equal(stored.draftFuelFee, 150_000);
  assert.equal(stored.draftTollParkingFee, 25_000);
  assert.deepEqual(stored.draftTollReceiptEvidence, state.formTollReceiptEvidence);

  // Reopening through the authenticated GET returns the saved draft, not a UI-only copy.
  const restored = await GET(new NextRequest(`http://localhost/api/driver-journeys?journeyId=${journeyId}`, {
    headers: { Authorization: `Bearer ${identity.idToken}` },
  }));
  assert.equal(restored.status, 200);
  const remote = (await restored.json()).journey;
  assert.equal(remote.draftTimeEnd, '14:30');
  assert.deepEqual(remote.draftFuelReceiptEvidence, [evidence]);

  state.formDate = '2026-10-02';
  state.formDateEnd = '2026-10-03';
  state.formIsMultiDay = true;
  state.formNightCount = 1;
  state.mainDestinations.reverse();
  state.extraActivities.reverse();
  state.updatedAt = 300;
  stored = await save();
  assert.equal(stored.draftDate, '2026-10-02');
  assert.equal(stored.draftDateEnd, '2026-10-03');
  assert.equal(stored.draftNightCount, 1);
  assert.deepEqual(stored.draftMainDestinations, ['Jombang', 'Surabaya']);
  assert.deepEqual(stored.draftExtraActivities, state.extraActivities);
  assert.equal(stored.draftCalculatedDistanceKm, 180);

  // Explicit removal of the final destination, arrival, and proofs persists too.
  state.formDate = '';
  state.formDateEnd = '';
  state.formTimeEnd = '';
  state.mainDestinations = [];
  state.mainDestinationLocations = [];
  state.extraActivities = [];
  state.formFuelReceiptUrls = [];
  state.formFuelReceiptEvidence = [];
  state.formTollReceiptUrls = [];
  state.formTollReceiptEvidence = [];
  state.formFuelFee = '';
  state.updatedAt = 400;
  stored = await save();
  assert.equal(stored.draftDate, '');
  assert.equal(stored.draftDateEnd, '');
  assert.equal(stored.draftTimeEnd, '');
  assert.deepEqual(stored.draftMainDestinations, []);
  assert.equal(stored.draftEndPoint, '');
  assert.equal(stored.draftFuelReceiptUrl, '');
  assert.equal(stored.draftFuelReceiptEvidence, undefined);
  assert.equal(stored.draftTollReceiptEvidence, undefined);

  // Old sessions and users that no longer hold the journey cannot overwrite progress.
  const currentDraft = driverJourneyReportDraftPayload(state);
  stored = await save({ ...currentDraft, clientUpdatedAt: 399, fuelFee: 99 }, 409);
  assert.equal(stored.draftFuelFee, 0);
  await save({ ...currentDraft, fuelFee: -1 }, 400);
  await save({ ...currentDraft, timeEnd: '123456' }, 400);
  await db.doc('PayrollPeriods/2026-10').update({ attendanceStatus: 'closed' });
  await save(currentDraft, 409);
  await db.doc('PayrollPeriods/2026-10').update({ attendanceStatus: 'open' });
  await journeyRef.update({ employeeId: 'OTHER_DRIVER' });
  await save(currentDraft, 403);
  await journeyRef.update({ employeeId: 'DRIVER_DRAFT_TEST', status: 'completed' });
  await save(currentDraft, 403);
  assert.equal((await journeyRef.get()).data()!.draftClientUpdatedAt, 400);
  console.log('PASS: draft API/database round trips, blank fields, ordered routes, upload retention/removal, stale writes, ownership and closed-period protection.');
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
