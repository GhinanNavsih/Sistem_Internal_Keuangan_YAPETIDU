import assert from 'node:assert/strict';
import test from 'node:test';
import { applySlipRefresh, diffSlipRefresh, refreshFieldKey } from './slipRefresh';

test('an overtime base row and identically named events produce one correct, repeatable change', () => {
  const current = { earnings: [{ label: 'Lembur', amount: 0 }, { label: 'Lembur', amount: 10000 }], deductions: [] };
  const fresh = { earnings: [{ label: 'Lembur', amount: 0 }, { label: 'Lembur', amount: 25000 }, { label: 'Lembur', amount: 15000 }], deductions: [] };
  const diffs = diffSlipRefresh(current, fresh);
  assert.deepEqual(diffs, [{ type: 'earnings', label: 'Lembur', oldValue: 10000, newValue: 40000 }]);
  const updated = applySlipRefresh(current, diffs);
  assert.deepEqual(updated.earnings, [{ label: 'Lembur', amount: 40000 }]);
  assert.deepEqual(diffSlipRefresh(updated, fresh), []);
});

test('unchecked fields and manually entered rows remain intact; selected deletions remove all occurrences', () => {
  const current = { earnings: [{ label: 'Gaji Pokok', amount: 100 }, { label: 'Manual', amount: 20 }], deductions: [{ label: 'Potongan', amount: 5 }, { label: 'potongan ', amount: 3 }] };
  const fresh = { earnings: [{ label: 'Gaji Pokok', amount: 150 }], deductions: [] };
  const diffs = diffSlipRefresh(current, fresh);
  const selected = new Set(diffs.filter(d => d.label !== 'Manual').map(refreshFieldKey));
  assert.deepEqual(applySlipRefresh(current, diffs, selected), { earnings: [{ label: 'Gaji Pokok', amount: 150 }, { label: 'Manual', amount: 20 }], deductions: [] });
  assert.equal(current.earnings[0].amount, 100, 'comparison baseline is not mutated');
});
