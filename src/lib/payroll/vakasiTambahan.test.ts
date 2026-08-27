import assert from 'node:assert/strict';
import test from 'node:test';
import {
  isPayableVakasiTambahan,
  vakasiApprovedEarningsForEmployee,
  vakasiEventNamesForEmployee,
  vakasiOwnedEarningPredicate,
  VAKASI_FALLBACK_EARNING_LABEL,
  type VakasiTambahanEventLike,
} from './vakasiTambahan';

test('isPayableVakasiTambahan accepts approved and status-less records, rejects sandbox and other statuses', () => {
  assert.equal(isPayableVakasiTambahan({ status: 'approved' }), true);
  assert.equal(isPayableVakasiTambahan({}), true);
  assert.equal(isPayableVakasiTambahan({ status: 'pending_review' }), false);
  assert.equal(isPayableVakasiTambahan({ status: 'declined' }), false);
  assert.equal(
    isPayableVakasiTambahan({ status: 'approved', sourceKind: 'proposal_lpj_report' }),
    false,
  );
});

test('an approved event becomes exactly one earnings row for a worker it lists', () => {
  const events: VakasiTambahanEventLike[] = [
    {
      eventName: 'Peringatan Hari Santri',
      status: 'approved',
      eventWorkers: { emp1: { payGiven: 300_000 }, emp2: { payGiven: 250_000 } },
    },
  ];

  assert.deepEqual(vakasiApprovedEarningsForEmployee(events, 'emp1'), [
    { label: 'Peringatan Hari Santri', amount: 300_000 },
  ]);
  assert.deepEqual(vakasiApprovedEarningsForEmployee(events, 'emp3'), []);
});

test('two approved events sharing a name are summed into one row, not two', () => {
  // mergeOwnedFields keys its fresh rows by normalized label — two separate
  // {label, amount} entries with the same label would silently collapse to
  // whichever this Map saw last, dropping the other event's pay entirely.
  const events: VakasiTambahanEventLike[] = [
    { eventName: 'Piket Ramadhan', status: 'approved', eventWorkers: { emp1: { payGiven: 100_000 } } },
    { eventName: 'Piket Ramadhan', status: 'approved', eventWorkers: { emp1: { payGiven: 50_000 } } },
  ];

  assert.deepEqual(vakasiApprovedEarningsForEmployee(events, 'emp1'), [
    { label: 'Piket Ramadhan', amount: 150_000 },
  ]);
});

test('a pending, declined, or sandbox event contributes no earnings row', () => {
  const events: VakasiTambahanEventLike[] = [
    { eventName: 'Menunggu', status: 'pending_review', eventWorkers: { emp1: { payGiven: 100_000 } } },
    { eventName: 'Ditolak', status: 'declined', eventWorkers: { emp1: { payGiven: 100_000 } } },
    {
      eventName: 'LPJ Sandbox',
      status: 'approved',
      sourceKind: 'proposal_lpj_report',
      eventWorkers: { emp1: { payGiven: 100_000 } },
    },
  ];

  assert.deepEqual(vakasiApprovedEarningsForEmployee(events, 'emp1'), []);
});

test('event names cover every status a worker was ever listed under, not just approved', () => {
  // This is what lets a merge remove a stale row: the predicate must still
  // recognize the label as Vakasi-owned after the event stops being approved.
  const events: VakasiTambahanEventLike[] = [
    { eventName: 'Kegiatan A', status: 'declined', eventWorkers: { emp1: { payGiven: 100_000 } } },
    { eventName: 'Kegiatan B', status: 'pending_review', eventWorkers: { emp1: { payGiven: 50_000 } } },
  ];

  const names = vakasiEventNamesForEmployee(events, 'emp1');
  assert.equal(names.has('kegiatan a'), true);
  assert.equal(names.has('kegiatan b'), true);
});

test('event names exclude a worker not listed on that event, and exclude sandbox events entirely', () => {
  const events: VakasiTambahanEventLike[] = [
    { eventName: 'Kegiatan A', status: 'approved', eventWorkers: { emp2: { payGiven: 100_000 } } },
    {
      eventName: 'LPJ Sandbox',
      status: 'approved',
      sourceKind: 'proposal_lpj_report',
      eventWorkers: { emp1: { payGiven: 100_000 } },
    },
  ];

  assert.deepEqual(Array.from(vakasiEventNamesForEmployee(events, 'emp1')), []);
});

test('the ownership predicate recognizes past event names case/whitespace-insensitively, plus the fallback label', () => {
  const predicate = vakasiOwnedEarningPredicate(new Set(['peringatan hari santri']));

  assert.equal(predicate(' Peringatan Hari Santri '), true);
  assert.equal(predicate(VAKASI_FALLBACK_EARNING_LABEL), true);
  assert.equal(predicate('Gaji Pokok'), false);
  assert.equal(predicate('Unrelated Event'), false);
});

test('a worker dropped from an event, or an event moved off approved, disappears via the predicate + fresh-list combination', () => {
  // Simulates the merge a propagation route performs: a stored row for an
  // event that is no longer approved (or no longer lists this worker) is
  // recognized as owned (so it is eligible to be removed) but does not
  // appear in the fresh approved list (so it actually gets removed).
  const allEvents: VakasiTambahanEventLike[] = [
    { eventName: 'Kegiatan Lama', status: 'declined', eventWorkers: { emp1: { payGiven: 100_000 } } },
  ];

  const eventNames = vakasiEventNamesForEmployee(allEvents, 'emp1');
  const predicate = vakasiOwnedEarningPredicate(eventNames);
  const fresh = vakasiApprovedEarningsForEmployee(allEvents, 'emp1');

  assert.equal(predicate('Kegiatan Lama'), true);
  assert.deepEqual(fresh, []);
});
