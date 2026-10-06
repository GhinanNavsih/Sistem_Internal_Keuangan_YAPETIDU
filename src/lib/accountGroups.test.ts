import assert from 'node:assert/strict';
import test from 'node:test';
import {
  findLinkedAccounts,
  isGroupableAccount,
  linkedAccountsByUid,
  personKey,
  type GroupableAccount,
} from './accountGroups';

const indahPekarya: GroupableAccount = {
  uid: 'u-biroumum',
  email: 'biroumum@unipdu.ac.id',
  displayName: 'Indah Wahyuni, SS',
  role: 'satker_head',
};
const indahLoyalis: GroupableAccount = {
  uid: 'u-indah',
  email: 'indahwahyuni@staf.unipdu.ac.id',
  displayName: 'Indah Wahyuni, SS',
  role: 'loyalis',
};
const indahSatkerLoyalis: GroupableAccount = {
  uid: 'u-psa',
  email: 'psa@unipdu.ac.id',
  displayName: 'Indah Wahyuni, SS',
  role: 'satker_head_loyalis',
};
const someoneElse: GroupableAccount = {
  uid: 'u-other',
  email: 'other@unipdu.ac.id',
  displayName: 'Siti Rofiah',
  role: 'loyalis',
};
const indahAccounts = [indahPekarya, indahLoyalis, indahSatkerLoyalis, someoneElse];

const uids = (accounts: readonly GroupableAccount[]) => accounts.map((account) => account.uid);

test('the three accounts of one person find each other, never themselves', () => {
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

test('titles, degrees, case, spacing, dots and apostrophes do not split a person', () => {
  const key = personKey('Indah Wahyuni, SS');
  assert.equal(key, 'indah wahyuni');
  assert.equal(personKey('Indah Wahyuni'), key);
  assert.equal(personKey('INDAH  WAHYUNI, S.S'), key);
  assert.equal(personKey('Dr. Indah Wahyuni SS'), key);
  assert.equal(personKey('M. Ali Nawawi, SE., MM'), personKey('M Ali Nawawi'));
  assert.equal(personKey("Siti Rofi'ah, A. Md."), personKey('Siti Rofiah'));
});

test('a different spelling is a different person', () => {
  assert.notEqual(personKey('Muhamad Zaki'), personKey('Muhammad Zaki'));
});

test('a one-word or missing name never links', () => {
  assert.equal(personKey('Admin'), null);
  assert.equal(personKey('Gus Sunan'), null);
  assert.equal(personKey(''), null);
  assert.equal(personKey(undefined), null);

  const first = { uid: 'a', displayName: 'Sunan', role: 'satker_head' };
  const second = { uid: 'b', displayName: 'Sunan', role: 'loyalis' };
  assert.deepEqual(findLinkedAccounts(first, [first, second]), []);
});

test('Super Admin accounts never link, in either direction', () => {
  const admin = { uid: 'u-admin', displayName: 'Indah Wahyuni', role: 'super_admin' };
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

test('an account opted out of grouping neither sees nor is seen', () => {
  const optedOut = { ...indahPekarya, accountGroupExcluded: true };
  const accounts = [optedOut, indahLoyalis, indahSatkerLoyalis];
  assert.deepEqual(uids(findLinkedAccounts(indahLoyalis, accounts)), ['u-psa']);
  assert.deepEqual(findLinkedAccounts(optedOut, accounts), []);
});

test('an account with an unknown role never links', () => {
  const broken = { ...indahPekarya, role: 'user' };
  assert.equal(isGroupableAccount(broken), false);
  assert.deepEqual(uids(findLinkedAccounts(indahLoyalis, [broken, indahLoyalis])), []);
});

test('a retired role id still links as its successor', () => {
  const legacy = { uid: 'u-legacy', displayName: 'Indah Wahyuni', role: 'employee_admin' };
  assert.deepEqual(uids(findLinkedAccounts(indahLoyalis, [legacy, indahLoyalis])), ['u-legacy']);
});

test('the Users page map covers every linked account and skips lone ones', () => {
  const map = linkedAccountsByUid(indahAccounts);
  assert.deepEqual([...map.keys()].sort(), ['u-biroumum', 'u-indah', 'u-psa']);
  assert.deepEqual(uids(map.get('u-indah')!), ['u-biroumum', 'u-psa']);
  assert.equal(map.has('u-other'), false);
});
