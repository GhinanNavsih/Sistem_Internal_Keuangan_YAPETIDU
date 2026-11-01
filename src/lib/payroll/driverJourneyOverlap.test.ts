import assert from 'node:assert/strict';
import test from 'node:test';
import {
  describeDriverJourneyOverlap,
  driverJourneySpan,
  driverOverlapSearchPeriods,
  findOverlappingDriverReport,
  type PeerDriverReport,
} from './driverJourneyOverlap';

function peer(overrides: Partial<PeerDriverReport> & { id: string }): PeerDriverReport {
  return {
    status: 'approved',
    jobCategory: 'SOPIR',
    activityName: 'piket pak ufik',
    activityDate: '2026-09-05',
    dateStart: '2026-09-05',
    dateEnd: '2026-09-05',
    timeStart: '07:00',
    timeEnd: '14:00',
    ...overrides,
  };
}

function spanOf(dateStart: string, timeStart: string, dateEnd: string, timeEnd: string) {
  const span = driverJourneySpan({ dateStart, timeStart, dateEnd, timeEnd });
  assert.ok(span);
  return span;
}

test('a trip that rolls past midnight ends on the next calendar day', () => {
  const span = driverJourneySpan({ dateStart: '2026-09-05', timeStart: '22:00', timeEnd: '05:30' });
  assert.ok(span);
  assert.equal((span.endMs - span.startMs) / 3_600_000, 7.5);
});

test('a span without usable times is null', () => {
  assert.equal(driverJourneySpan({ dateStart: '2026-09-05', timeStart: '', timeEnd: '10:00' }), null);
  assert.equal(driverJourneySpan({ dateStart: '2026-09-05', timeStart: '10:00', timeEnd: '10:00' }), null);
});

test('buamat 5 Sep: a morning trip inside a two-day trip overlaps for 7h10m', () => {
  const longTrip = peer({
    id: 'long',
    timeStart: '07:00',
    dateEnd: '2026-09-06',
    timeEnd: '23:02',
  });
  const found = findOverlappingDriverReport(spanOf('2026-09-05', '06:30', '2026-09-05', '14:10'), [longTrip]);
  assert.equal(found?.reportId, 'long');
  assert.equal(found?.overlapMinutes, 430);
});

test('trips that only touch at the boundary do not overlap', () => {
  const morning = peer({ id: 'morning', timeStart: '07:00', timeEnd: '12:00' });
  assert.equal(
    findOverlappingDriverReport(spanOf('2026-09-05', '12:00', '2026-09-05', '15:00'), [morning]),
    null,
  );
});

test('a declined report blocks nothing, a pending one does', () => {
  const candidate = spanOf('2026-09-05', '08:00', '2026-09-05', '10:00');
  assert.equal(
    findOverlappingDriverReport(candidate, [peer({ id: 'old', status: 'declined' })]),
    null,
  );
  assert.equal(
    findOverlappingDriverReport(candidate, [peer({ id: 'new', status: 'pending' })])?.reportId,
    'new',
  );
});

test('the report being edited is not its own overlap', () => {
  const candidate = spanOf('2026-09-05', '08:00', '2026-09-05', '10:00');
  assert.equal(
    findOverlappingDriverReport(candidate, [peer({ id: 'self' })], { excludeReportId: 'self' }),
    null,
  );
});

test('reports of other job categories are ignored', () => {
  const candidate = spanOf('2026-09-05', '08:00', '2026-09-05', '10:00');
  assert.equal(
    findOverlappingDriverReport(candidate, [peer({ id: 'x', jobCategory: 'KEBERSIHAN' })]),
    null,
  );
});

test('the largest overlap is the one reported', () => {
  const candidate = spanOf('2026-09-05', '08:00', '2026-09-05', '12:00');
  const found = findOverlappingDriverReport(candidate, [
    peer({ id: 'small', timeStart: '11:30', timeEnd: '13:00' }),
    peer({ id: 'big', timeStart: '07:00', timeEnd: '11:00' }),
  ]);
  assert.equal(found?.reportId, 'big');
});

test('the message names the clashing report in Jakarta time', () => {
  const found = findOverlappingDriverReport(
    spanOf('2026-09-10', '09:30', '2026-09-10', '14:00'),
    [
      peer({
        id: 'school',
        activityName: 'antar jemput sekolah tgl 9 September (UNIPDU Jombang → SD)',
        activityDate: '2026-09-10',
        dateStart: '2026-09-10',
        dateEnd: '2026-09-10',
        timeStart: '06:30',
        timeEnd: '16:00',
      }),
    ],
  );
  assert.ok(found);
  assert.equal(
    describeDriverJourneyOverlap(found),
    'Waktu perjalanan bertumpuk 4 jam 30 menit dengan laporan "antar jemput sekolah tgl 9 September" ' +
      '(10/09 06:30 – 10/09 16:00). Satu sopir tidak dapat menjalani dua perjalanan pada waktu yang sama: ' +
      'perbaiki tanggal/jam, atau tolak laporan yang salah.',
  );
});

test('the search spans both months around a month boundary', () => {
  assert.deepEqual(driverOverlapSearchPeriods('2026-09-01', '2026-09-01'), ['2026-08', '2026-09']);
  assert.deepEqual(driverOverlapSearchPeriods('2026-09-15', '2026-09-15'), ['2026-09']);
  assert.deepEqual(driverOverlapSearchPeriods('2026-09-29', '2026-10-01'), ['2026-09', '2026-10']);
});
