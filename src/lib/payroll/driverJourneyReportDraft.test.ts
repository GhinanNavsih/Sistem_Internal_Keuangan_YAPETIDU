import assert from 'node:assert/strict';
import test from 'node:test';
import {
  driverJourneyReportDraftPayload,
  isLocalJourneyReportDraftNewer,
  JourneyReportDraftSaveQueue,
  type DriverJourneyReportDraftState,
  type JourneyReportDraftSaveStatus,
} from './driverJourneyReportDraft';

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => { resolve = done; });
  return { promise, resolve };
}

const reportDraftFixture: DriverJourneyReportDraftState = {
  formDate: '2026-10-01',
  formDateEnd: '2026-10-02',
  formIsMultiDay: true,
  formTimeStart: '08:00',
  formTimeEnd: '09:30',
  formNightCount: 1,
  formNdalemMealMoneyFee: '50.000',
  formFuelFee: '100.000',
  formTollParkingFee: '25.000',
  formFuelReceiptUrls: ['https://example.test/fuel.jpg'],
  formTollReceiptUrls: [],
  formFuelReceiptEvidence: [{
    url: 'https://example.test/fuel.jpg',
    auditMetadata: {
      capturedAt: '2026-10-01T01:00:00Z', latitude: -7.55, longitude: 112.3,
      deviceName: 'Test camera', hasExif: true,
      locationName: null, locationAddress: null, locationPlaceId: null,
    },
  }],
  formTollReceiptEvidence: [],
  startPoint: 'Unipdu',
  startPointLocation: { address: 'Unipdu', latitude: -7.55, longitude: 112.3 },
  mainDestinations: ['Surabaya', 'Jombang'],
  mainDestinationLocations: [null, null],
  extraActivities: [
    { type: 'tambah_lokasi', destination: 'Surabaya', distanceKm: 90 },
    { type: 'tambah_lokasi', destination: 'Jombang', distanceKm: 80 },
  ],
  calculatedDistanceKm: 180,
  calculatedDurationHours: 4,
  outboundDistanceKm: 90,
  outboundDurationHours: 2,
  updatedAt: 100,
};

test('draft preserves route order, arrival, dates, money, and receipt evidence', () => {
  const payload = driverJourneyReportDraftPayload(reportDraftFixture);
  assert.equal(payload.date, '2026-10-01');
  assert.equal(payload.dateEnd, '2026-10-02');
  assert.equal(payload.timeEnd, '09:30');
  assert.equal(payload.nightCount, 1);
  assert.equal(payload.fuelFee, 100_000);
  assert.equal(payload.tollParkingFee, 25_000);
  assert.equal(payload.ndalemMealMoneyReceived, 50_000);
  assert.deepEqual(payload.mainDestinations, ['Surabaya', 'Jombang']);
  assert.deepEqual(payload.extraActivities, reportDraftFixture.extraActivities);
  assert.deepEqual(payload.startPointLocation, reportDraftFixture.startPointLocation);
  assert.equal(payload.calculatedDistanceKm, 180);
  assert.equal(payload.calculatedDurationHours, 4);
  assert.deepEqual(payload.fuelReceiptEvidence, reportDraftFixture.formFuelReceiptEvidence);
  assert.equal(payload.clientUpdatedAt, 100);
});

test('incomplete drafts retain successful uploads and explicit cleared inputs', () => {
  const payload = driverJourneyReportDraftPayload({
    ...reportDraftFixture, formFuelFee: '', formTimeEnd: '', formIsMultiDay: false,
    mainDestinations: [], mainDestinationLocations: [], extraActivities: [],
  });
  assert.equal(payload.fuelFee, 0);
  assert.equal(payload.fuelReceiptUrl, 'https://example.test/fuel.jpg');
  assert.deepEqual(payload.fuelReceiptEvidence, reportDraftFixture.formFuelReceiptEvidence);
  assert.equal(payload.timeEnd, '');
  assert.equal(payload.dateEnd, '2026-10-01');
  assert.equal(payload.nightCount, 0);
  assert.deepEqual(payload.mainDestinations, []);
  assert.equal(payload.endPoint, '');
});

test('an acknowledged or older local draft cannot replace newer database progress', () => {
  assert.equal(isLocalJourneyReportDraftNewer(100, 100), false);
  assert.equal(isLocalJourneyReportDraftNewer(100, 200), false);
  assert.equal(isLocalJourneyReportDraftNewer(200, 100), true);
  assert.equal(isLocalJourneyReportDraftNewer(100, undefined), true);
});

test('rapid input is saved in order, with the newest pending snapshot last', async () => {
  const gate = deferred();
  const writes: string[] = [];
  const statuses: JourneyReportDraftSaveStatus[] = [];
  let active = 0;
  const queue = new JourneyReportDraftSaveQueue(async (snapshot) => {
    assert.equal(++active, 1, 'draft requests must never overlap');
    writes.push(snapshot);
    if (writes.length === 1) await gate.promise;
    active--;
  }, (status) => statuses.push(status));
  queue.update('arrival 09:00');
  queue.update('arrival 09:30');
  queue.update('arrival 09:30; fuel 100000');
  gate.resolve();
  assert.equal(await queue.flush(), true);
  assert.deepEqual(writes, ['arrival 09:00', 'arrival 09:30; fuel 100000']);
  assert.equal(statuses.at(-1), 'saved');
  queue.update('arrival 09:30; fuel 100000');
  await queue.flush();
  assert.equal(writes.length, 2, 'status renders must not resave identical input');
});

test('a network failure retains the newest draft for automatic retry', async () => {
  const writes: string[] = [];
  const statuses: JourneyReportDraftSaveStatus[] = [];
  let offline = true;
  const queue = new JourneyReportDraftSaveQueue(async (snapshot) => {
    writes.push(snapshot);
    if (offline) throw new Error('offline');
  }, (status) => statuses.push(status));
  queue.update('fuel 100000');
  assert.equal(await queue.flush(), false);
  assert.equal(statuses.at(-1), 'error');
  offline = false;
  assert.equal(await queue.flush(), true);
  assert.deepEqual(writes, ['fuel 100000', 'fuel 100000']);
  assert.equal(statuses.at(-1), 'saved');
});

test('failure of an older request does not requeue it ahead of newer input', async () => {
  const gate = deferred();
  const writes: string[] = [];
  const queue = new JourneyReportDraftSaveQueue(async (snapshot) => {
    writes.push(snapshot);
    if (writes.length === 1) {
      await gate.promise;
      throw new Error('old request failed');
    }
  }, () => {});
  queue.update('old');
  queue.update('new');
  gate.resolve();
  assert.equal(await queue.flush(), true);
  assert.deepEqual(writes, ['old', 'new']);
});

test('submission waits for an active save and prevents queued drafts from following it', async () => {
  const gate = deferred();
  const writes: string[] = [];
  const queue = new JourneyReportDraftSaveQueue(async (snapshot) => {
    writes.push(snapshot);
    await gate.promise;
  }, () => {});
  queue.update('old');
  queue.update('new');
  let stopped = false;
  const stopping = queue.pause().then(() => { stopped = true; });
  await Promise.resolve();
  assert.equal(stopped, false);
  gate.resolve();
  await stopping;
  queue.update('new');
  assert.deepEqual(writes, ['old']);
  queue.resume();
  queue.update('new');
  await queue.flush();
  assert.deepEqual(writes, ['old', 'new']);
});
