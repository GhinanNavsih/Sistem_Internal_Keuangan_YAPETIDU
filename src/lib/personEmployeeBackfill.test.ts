import assert from 'node:assert/strict';
import test from 'node:test';
import {
  personNameKey,
  planPersonEmployeeIdBackfill,
  type BackfillAccount,
  type BackfillEmployee,
} from './personEmployeeBackfill';

const employees: BackfillEmployee[] = [
  { employeeId: 'Loyalis_045', name: 'Indah Wahyuni, SS', active: true },
  { employeeId: 'Loyalis_046', name: 'Siti Rofiah', active: true },
  { employeeId: 'Loyalis_047', name: 'Siti Rofi\'ah, A. Md.', active: true },
  { employeeId: 'BC_061', name: 'Ahmad Fauzi', active: false },
  { employeeId: 'Loyalis_301', name: 'Ahmad Fauzi', active: true },
  { employeeId: 'BC_070', name: 'Budi Santoso', active: false },
];

const plan = (accounts: BackfillAccount[]) => planPersonEmployeeIdBackfill(accounts, employees);

test("Indah's three accounts all land on her employee record", () => {
  const result = plan([
    { uid: 'u-psa', email: 'psa@x', displayName: 'Indah Wahyuni, SS', role: 'satker_head_loyalis' },
    { uid: 'u-biro', email: 'biroumum@x', displayName: 'INDAH WAHYUNI, S.S', role: 'satker_head' },
    { uid: 'u-indah', email: 'indah@x', displayName: 'Indah W.', role: 'loyalis', linkedEmployeeId: 'Loyalis_045' },
  ]);
  assert.deepEqual(
    result.assignments.map(({ uid, personEmployeeId, source }) => ({ uid, personEmployeeId, source })),
    [
      { uid: 'u-biro', personEmployeeId: 'Loyalis_045', source: 'name_match' },
      { uid: 'u-indah', personEmployeeId: 'Loyalis_045', source: 'linked_employee' },
      { uid: 'u-psa', personEmployeeId: 'Loyalis_045', source: 'name_match' },
    ],
  );
  assert.equal(result.assignments[0].employeeName, 'Indah Wahyuni, SS');
  assert.deepEqual(result.needsReview, []);
});

test('employee-linked roles always take their linkedEmployeeId, never a name', () => {
  const result = plan([
    { uid: 'u-1', displayName: 'Siti Rofiah', role: 'honorer', linkedEmployeeId: 'BC_070' },
    { uid: 'u-2', displayName: 'Indah Wahyuni', role: 'ketua_shift_satpam', linkedEmployeeId: ' BC_061 ' },
  ]);
  assert.deepEqual(
    result.assignments.map(({ uid, personEmployeeId }) => ({ uid, personEmployeeId })),
    [
      { uid: 'u-1', personEmployeeId: 'BC_070' },
      { uid: 'u-2', personEmployeeId: 'BC_061' },
    ],
  );
});

test('a linked employee that does not exist is left for review', () => {
  const result = plan([
    { uid: 'u-1', role: 'loyalis', linkedEmployeeId: 'Loyalis_999' },
    { uid: 'u-2', role: 'honorer' },
  ]);
  assert.deepEqual(result.assignments, []);
  assert.deepEqual(result.needsReview.map(({ uid, reason }) => ({ uid, reason })), [
    { uid: 'u-1', reason: 'linked_employee_missing' },
    { uid: 'u-2', reason: 'linked_employee_missing' },
  ]);
});

test('only an unambiguous active name match is written', () => {
  const result = plan([
    // Two active records reduce to "siti rofiah": never guessed.
    { uid: 'u-siti', email: 'a@x', displayName: 'Siti Rofiah', role: 'satker_head' },
    // Only the converted (active) Loyalis record counts, not the closed Pekarya one.
    { uid: 'u-ahmad', email: 'b@x', displayName: 'Ahmad Fauzi', role: 'finance_verifier' },
    // Matches only an inactive record.
    { uid: 'u-budi', email: 'c@x', displayName: 'Budi Santoso', role: 'satker_head' },
    { uid: 'u-nobody', email: 'd@x', displayName: 'Tidak Ada', role: 'loyalis_admin' },
    { uid: 'u-short', email: 'e@x', displayName: 'Sunan', role: 'satker_head' },
  ]);
  assert.deepEqual(
    result.assignments.map(({ uid, personEmployeeId }) => ({ uid, personEmployeeId })),
    [{ uid: 'u-ahmad', personEmployeeId: 'Loyalis_301' }],
  );
  assert.deepEqual(result.needsReview.map(({ uid, reason }) => ({ uid, reason })), [
    { uid: 'u-siti', reason: 'several_active_name_matches' },
    { uid: 'u-budi', reason: 'no_active_name_match' },
    { uid: 'u-nobody', reason: 'no_active_name_match' },
    { uid: 'u-short', reason: 'name_too_short' },
  ]);
  const siti = result.needsReview.find((review) => review.uid === 'u-siti')!;
  assert.deepEqual(siti.candidates.map((candidate) => candidate.employeeId), ['Loyalis_046', 'Loyalis_047']);
  const budi = result.needsReview.find((review) => review.uid === 'u-budi')!;
  assert.deepEqual(budi.candidates, [{ employeeId: 'BC_070', name: 'Budi Santoso', active: false }]);
});

test('Super Admin, disabled, already linked and unknown-role accounts are left alone', () => {
  const result = plan([
    { uid: 'u-admin', displayName: 'Indah Wahyuni', role: 'super_admin' },
    { uid: 'u-off', displayName: 'Indah Wahyuni', role: 'satker_head', disabled: true },
    { uid: 'u-done', displayName: 'Indah Wahyuni', role: 'satker_head', personEmployeeId: 'Loyalis_046' },
    { uid: 'u-odd', displayName: 'Indah Wahyuni', role: 'user' },
  ]);
  assert.deepEqual(result.assignments, []);
  assert.deepEqual(result.needsReview, []);
  assert.deepEqual(
    result.skipped.map(({ uid, reason }) => ({ uid, reason })).sort((a, b) => a.uid.localeCompare(b.uid)),
    [
      { uid: 'u-admin', reason: 'super_admin' },
      { uid: 'u-done', reason: 'already_linked' },
      { uid: 'u-odd', reason: 'unknown_role' },
      { uid: 'u-off', reason: 'disabled' },
    ],
  );
});

test('a second run over the result changes nothing', () => {
  const accounts: BackfillAccount[] = [
    { uid: 'u-psa', displayName: 'Indah Wahyuni, SS', role: 'satker_head_loyalis' },
    { uid: 'u-indah', role: 'loyalis', linkedEmployeeId: 'Loyalis_045' },
  ];
  const first = plan(accounts);
  const applied = accounts.map((account) => ({
    ...account,
    personEmployeeId: first.assignments.find((assignment) => assignment.uid === account.uid)?.personEmployeeId,
  }));
  assert.deepEqual(plan(applied).assignments, []);
});

test('name keys ignore titles, degrees, case, spacing, dots and apostrophes', () => {
  const key = personNameKey('Indah Wahyuni, SS');
  assert.equal(key, 'indah wahyuni');
  assert.equal(personNameKey('Dr. Indah  Wahyuni SS'), key);
  assert.equal(personNameKey('M. Ali Nawawi, SE., MM'), personNameKey('M Ali Nawawi'));
  assert.equal(personNameKey("Siti Rofi'ah"), personNameKey('Siti Rofiah'));
  assert.notEqual(personNameKey('Muhamad Zaki'), personNameKey('Muhammad Zaki'));
  assert.equal(personNameKey('Gus Sunan'), null);
  assert.equal(personNameKey(undefined), null);
});
