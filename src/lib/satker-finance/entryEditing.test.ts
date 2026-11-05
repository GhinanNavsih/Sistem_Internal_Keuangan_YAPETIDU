import assert from 'node:assert/strict';
import test from 'node:test';
import { entryChangeBlocker, reversedEntryIds } from './entryEditing';

const academicYear = '2026-2027';
const blocker = (change: 'edit' | 'delete', monthIndex: number, extra: Partial<Parameters<typeof entryChangeBlocker>[0]> = {}) =>
  entryChangeBlocker({ change, entry: { kind: 'ADVANCED', monthIndex }, reversed: false, academicYear, ...extra });

test('journals can be edited and deleted in every fiscal month', () => {
  for (let month = 1; month <= 12; month++) {
    assert.equal(blocker('edit', month), null);
    assert.equal(blocker('delete', month), null);
    for (let target = 1; target <= 12; target++) assert.equal(blocker('edit', month, { newMonthIndex: target }), null);
  }
});
test('invalid source or destination months are refused', () => {
  assert.match(blocker('edit', 13)!, /Bulan jurnal/);
  assert.match(blocker('edit', 9, { newMonthIndex: 0 })!, /tanggal baru/);
});
test('a reversal can be deleted but must not be edited independently', () => {
  const entry = { kind: 'REVERSAL' as const, monthIndex: 9 };
  assert.match(blocker('edit', 9, { entry })!, /pembalik/);
  assert.equal(blocker('delete', 9, { entry }), null);
});
test('depreciation is rebuilt from the register but may be deleted', () => {
  const entry = { kind: 'DEPRECIATION' as const, monthIndex: 9 };
  assert.match(blocker('edit', 9, { entry })!, /aset tetap/);
  assert.equal(blocker('delete', 9, { entry }), null);
});
test('a reversed journal must have its reversal removed first', () => {
  for (const change of ['edit', 'delete'] as const) assert.match(blocker(change, 9, { reversed: true })!, /sudah dibalik/);
});
test('reversed journals are found from their reversal references', () => {
  assert.deepEqual([...reversedEntryIds([{}, { reversesEntryId: 'a' }, { reversesEntryId: 'b' }, { reversesEntryId: 'a' }])].sort(), ['a', 'b']);
});
