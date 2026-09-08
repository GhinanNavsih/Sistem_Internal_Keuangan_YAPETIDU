import assert from 'node:assert/strict';
import test from 'node:test';
import { matchFunctionalAllowance } from './salaryMatrix';

const RENAMED_FUNCTIONAL_MATRIX = {
  'S3-fia': {
    education_level: 'S3-Fakultas Agama Islam',
    base_value: 900000,
    functional_tiers: { '1': 900000 },
  },
};

test('functional allowance matches the editable education level label', () => {
  assert.equal(
    matchFunctionalAllowance(
      'S3-Fakultas Agama Islam',
      1,
      RENAMED_FUNCTIONAL_MATRIX,
    ),
    900000,
  );
});

test('functional allowance retains the document id as a legacy label alias', () => {
  assert.equal(
    matchFunctionalAllowance('S3-fia', 1, RENAMED_FUNCTIONAL_MATRIX),
    900000,
  );
});
