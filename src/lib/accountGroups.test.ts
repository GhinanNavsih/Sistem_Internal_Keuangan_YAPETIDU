import assert from 'node:assert/strict';
import test from 'node:test';
import {
  employeeCollectionForId,
  findLinkedAccounts,
  isGroupableAccount,
  linkedAccountsByUid,
  normalizeEmployeeId,
  resolvePersonEmployeeId,
  type GroupableAccount,
} from './accountGroups';

const indahPekarya: GroupableAccount = {
  uid: 'u-biroumum',
  email: 'biroumum@unipdu.ac.id',
  role: 'satker_head',
  personEmployeeId: 'Loyalis_045',
};
const indahLoyalis: GroupableAccount = {
  uid: 'u-indah',
  email: 'indahwahyuni@staf.unipdu.ac.id',
  role: 'loyalis',
  personEmployeeId: 'Loyalis_045',
};
const indahSatkerLoyalis: GroupableAccount = {
  uid: 'u-psa',
  email: 'psa@unipdu.ac.id',
  role: 'satker_head_loyalis',
  personEmployeeId: 'Loyalis_045',
};
const someoneElse: GroupableAccount = {
  uid: 'u-other',
  email: 'other@unipdu.ac.id',
  role: 'loyalis',
  personEmployeeId: 'Loyalis_046',
};
const indahAccounts = [indahPekarya, indahLoyalis, indahSatkerLoyalis, someoneElse];

const uids = (accounts: readonly GroupableAccount[]) => accounts.map((account) => account.uid);

test('accounts naming the same employee find each other, never themselves', () => {
  assert.deepEqual(uids(findLinkedAccounts(indahLoyalis, indahAccounts)), ['u-biroumum', 'u-psa']);
  assert.deepEqual(uids(findLinkedAccounts(indahPekarya, indahAccounts)), ['u-psa', 'u-indah']);
  assert.deepEqual(uids(findLinkedAccounts(someoneElse, indahAccounts)), []);
});

test('linked accounts are listed in role order, then by email', () => {
  assert.deepEqual(uids(findLinkedAccounts(indahSatkerLoyalis, indahAccounts)), [
    'u-biroumum',
    'u-indah',
  ]);
});

test('a different employee is a different person, whatever the names say', () => {
  const namesake = { uid: 'u-namesake', role: 'satker_head', personEmployeeId: 'BC_201' };
  assert.deepEqual(uids(findLinkedAccounts(indahLoyalis, [...indahAccounts, namesake])), [
    'u-biroumum',
    'u-psa',
  ]);
  assert.deepEqual(findLinkedAccounts(namesake, [...indahAccounts, namesake]), []);
});

test('an account that names no employee never links', () => {
  for (const personEmployeeId of [undefined, null, '', '   ', 42, 'Loyalis/045']) {
    const unlinked = { uid: 'u-none', role: 'satker_head', personEmployeeId };
    assert.equal(isGroupableAccount(unlinked), false, String(personEmployeeId));
    assert.deepEqual(findLinkedAccounts(unlinked, [unlinked, indahLoyalis]), []);
  }
});

test('ids are compared trimmed', () => {
  const padded = { ...indahPekarya, personEmployeeId: ' Loyalis_045 ' };
  assert.deepEqual(uids(findLinkedAccounts(padded, [padded, indahLoyalis])), ['u-indah']);
});

test('Super Admin accounts never link, in either direction', () => {
  const admin = { uid: 'u-admin', role: 'super_admin', personEmployeeId: 'Loyalis_045' };
  const accounts = [...indahAccounts, admin];
  assert.equal(isGroupableAccount(admin), false);
  assert.deepEqual(findLinkedAccounts(admin, accounts), []);
  assert.ok(!uids(findLinkedAccounts(indahLoyalis, accounts)).includes('u-admin'));
});

test('a disabled account never links', () => {
  const disabled = { ...indahPekarya, disabled: true };
  const accounts = [disabled, indahLoyalis, indahSatkerLoyalis];
  assert.deepEqual(uids(findLinkedAccounts(indahLoyalis, accounts)), ['u-psa']);
  assert.deepEqual(findLinkedAccounts(disabled, accounts), []);
});

test('an account with an unknown role never links', () => {
  const broken = { ...indahPekarya, role: 'user' };
  assert.equal(isGroupableAccount(broken), false);
  assert.deepEqual(uids(findLinkedAccounts(indahLoyalis, [broken, indahLoyalis])), []);
});

test('a retired role id still links as its successor', () => {
  const legacy = { uid: 'u-legacy', role: 'employee_admin', personEmployeeId: 'Loyalis_045' };
  assert.deepEqual(uids(findLinkedAccounts(indahLoyalis, [legacy, indahLoyalis])), ['u-legacy']);
});

test('accounts naming a converted Pekarya record stay with the person', () => {
  // BC_061 was converted to Loyalis_301: the login account moved to the new id,
  // a second account of the same person still names the closed record.
  const successors = new Map([['BC_061', 'Loyalis_301']]);
  const convertedAccount = { uid: 'u-converted', role: 'loyalis', personEmployeeId: 'Loyalis_301' };
  const headAccount = { uid: 'u-head', role: 'satker_head', personEmployeeId: 'BC_061' };
  const accounts = [convertedAccount, headAccount];

  assert.deepEqual(uids(findLinkedAccounts(convertedAccount, accounts, successors)), ['u-head']);
  assert.deepEqual(uids(findLinkedAccounts(headAccount, accounts, successors)), ['u-converted']);
  assert.deepEqual(findLinkedAccounts(headAccount, accounts), [], 'without the map they differ');
});

test('successor chains are followed, and a loop cannot hang', () => {
  assert.equal(resolvePersonEmployeeId('BC_1', new Map([['BC_1', 'BC_2'], ['BC_2', 'Loyalis_3']])), 'Loyalis_3');
  assert.equal(resolvePersonEmployeeId('Loyalis_9', new Map([['BC_1', 'Loyalis_3']])), 'Loyalis_9');
  const looped = resolvePersonEmployeeId('BC_1', new Map([['BC_1', 'BC_2'], ['BC_2', 'BC_1']]));
  assert.ok(looped === 'BC_1' || looped === 'BC_2');
  assert.equal(resolvePersonEmployeeId(null), null);
});

test('employee ids map to their collection by prefix', () => {
  assert.equal(employeeCollectionForId('Loyalis_045'), 'Employees_Loyalis');
  assert.equal(employeeCollectionForId('WC_002'), 'Employees_WhiteCollar');
  assert.equal(employeeCollectionForId('BC_061'), 'Employees_BlueCollar');
  assert.equal(employeeCollectionForId(' BC_061 '), 'Employees_BlueCollar');
  assert.equal(employeeCollectionForId('Loyalis/045'), null, 'never a nested path');
  assert.equal(employeeCollectionForId(''), null);
  assert.equal(employeeCollectionForId(undefined), null);
  assert.equal(normalizeEmployeeId(' Loyalis_045 '), 'Loyalis_045');
});

test('the Users page map covers every linked account and skips lone ones', () => {
  const map = linkedAccountsByUid(indahAccounts);
  assert.deepEqual([...map.keys()].sort(), ['u-biroumum', 'u-indah', 'u-psa']);
  assert.deepEqual(uids(map.get('u-indah')!), ['u-biroumum', 'u-psa']);
  assert.equal(map.has('u-other'), false);
});
