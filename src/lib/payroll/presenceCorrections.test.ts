import assert from 'node:assert/strict';
import test from 'node:test';
import { isPresenceCorrectionVisibleToEmployee } from './presenceCorrections';

test('employee history hides only explicitly soft-deleted requests', () => {
  assert.equal(isPresenceCorrectionVisibleToEmployee({}), true);
  assert.equal(isPresenceCorrectionVisibleToEmployee({ hiddenFromEmployee: false }), true);
  assert.equal(isPresenceCorrectionVisibleToEmployee({ hiddenFromEmployee: true }), false);
});
