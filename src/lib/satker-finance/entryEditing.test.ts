import assert from 'node:assert/strict';
import test from 'node:test';
import {
  canCorrectByReversal,
  entryChangeBlocker,
  fiscalPeriod,
  isReportOpen,
  lockedThroughPeriod,
  reversedEntryIds,
  type ReportStatus,
} from './entryEditing';

const academicYear = '2026-2027';
// Fiscal periods: 1 Sep, 2 Okt, 3 Nov, 4 Des, 5 Jan, … 12 Agu.
const sep = 9, oct = 10, nov = 11, jan = 1;

const open = (monthIndex: number): ReportStatus => ({ monthIndex, status: 'DRAFT' });
const sealed = (monthIndex: number, status = 'APPROVED'): ReportStatus => ({ monthIndex, status });
const blocker = (
  change: 'edit' | 'delete',
  monthIndex: number,
  reports: ReportStatus[],
  extra: Partial<Parameters<typeof entryChangeBlocker>[0]> = {},
) => entryChangeBlocker({ change, entry: { kind: 'ADVANCED', monthIndex }, reversed: false, academicYear, reports, ...extra });

test('only a draft or a requested revision keeps a month open', () => {
  for (const status of [undefined, null, '', 'DRAFT', 'REVISION_REQUESTED']) assert.equal(isReportOpen(status), true, String(status));
  for (const status of ['SUBMITTED', 'BAK_APPROVED', 'APPROVED']) assert.equal(isReportOpen(status), false, status);
});

test('fiscal periods run September to August', () => {
  assert.equal(fiscalPeriod(academicYear, sep), 1);
  assert.equal(fiscalPeriod(academicYear, jan), 5);
  assert.equal(fiscalPeriod(academicYear, 8), 12);
  assert.equal(fiscalPeriod(academicYear, 13), null);
});

test('the lock reaches the latest sealed month, whatever its neighbours say', () => {
  assert.equal(lockedThroughPeriod(academicYear, []), 0);
  assert.equal(lockedThroughPeriod(academicYear, [open(sep), open(oct)]), 0);
  assert.equal(lockedThroughPeriod(academicYear, [sealed(sep)]), 1);
  assert.equal(lockedThroughPeriod(academicYear, [sealed(sep), sealed(oct, 'SUBMITTED'), open(nov)]), 2);
  // A later sealed month seals the open ones before it too.
  assert.equal(lockedThroughPeriod(academicYear, [open(sep), sealed(nov, 'BAK_APPROVED')]), 3);
  assert.equal(lockedThroughPeriod(academicYear, [sealed(sep), { monthIndex: oct, status: 'REVISION_REQUESTED' }]), 1);
});

test('a journal in an open month can be edited and deleted', () => {
  assert.equal(blocker('edit', oct, [sealed(sep), open(oct)]), null);
  assert.equal(blocker('delete', oct, [sealed(sep)]), null);
  assert.equal(blocker('edit', oct, [sealed(sep), { monthIndex: oct, status: 'REVISION_REQUESTED' }]), null);
});

test('a journal is locked once its month or any later month is sealed', () => {
  assert.match(blocker('edit', sep, [sealed(sep)])!, /terkunci/);
  assert.match(blocker('delete', sep, [sealed(sep, 'SUBMITTED')])!, /terkunci/);
  // October is open but November was submitted: October is sealed with it.
  assert.match(blocker('edit', oct, [open(oct), sealed(nov, 'SUBMITTED')])!, /terkunci/);
  assert.equal(blocker('edit', nov, [sealed(sep), sealed(oct)]), null);
});

test('moving a journal needs the new month open as well', () => {
  const reports = [sealed(sep), sealed(oct), open(nov)];
  assert.equal(blocker('edit', nov, reports, { newMonthIndex: 12 }), null);
  assert.match(blocker('edit', nov, reports, { newMonthIndex: sep })!, /Tanggal baru/);
  assert.match(blocker('edit', nov, reports, { newMonthIndex: oct })!, /Tanggal baru/);
  assert.match(blocker('edit', nov, reports, { newMonthIndex: 13 })!, /Tanggal baru/);
  assert.equal(blocker('edit', nov, reports, { newMonthIndex: nov }), null);
});

test('a closed year changes nothing', () => {
  assert.match(blocker('edit', nov, [], { yearStatus: 'CLOSED' })!, /ditutup/);
  assert.match(blocker('delete', nov, [], { yearStatus: 'CLOSED' })!, /ditutup/);
  assert.equal(blocker('edit', nov, [], { yearStatus: 'ACTIVE' }), null);
});

test('a reversing journal can be deleted but not edited', () => {
  const entry = { kind: 'REVERSAL' as const, monthIndex: nov };
  assert.match(entryChangeBlocker({ change: 'edit', entry, reversed: false, academicYear, reports: [] })!, /pembalik/);
  assert.equal(entryChangeBlocker({ change: 'delete', entry, reversed: false, academicYear, reports: [] }), null);
});

test('a journal that has been reversed can be neither edited nor deleted', () => {
  for (const change of ['edit', 'delete'] as const) {
    assert.match(blocker(change, nov, [], { reversed: true })!, /sudah dibalik/);
  }
});

test('reversed journals are found from the reversals that point at them', () => {
  const ids = reversedEntryIds([{}, { reversesEntryId: 'voucher-1' }, { reversesEntryId: 'voucher-2' }, { reversesEntryId: 'voucher-1' }]);
  assert.deepEqual([...ids].sort(), ['voucher-1', 'voucher-2']);
});

test('a sealed month is corrected by a reversal only for a live, unreversed journal in an open year', () => {
  assert.equal(canCorrectByReversal({ entry: { kind: 'ADVANCED' }, reversed: false }), true);
  assert.equal(canCorrectByReversal({ entry: { kind: 'EXPENSE' }, reversed: false, yearStatus: 'ACTIVE' }), true);
  assert.equal(canCorrectByReversal({ entry: { kind: 'REVERSAL' }, reversed: false }), false);
  assert.equal(canCorrectByReversal({ entry: { kind: 'ADVANCED' }, reversed: true }), false);
  assert.equal(canCorrectByReversal({ entry: { kind: 'ADVANCED' }, reversed: false, yearStatus: 'CLOSED' }), false);
});
