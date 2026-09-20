import assert from 'node:assert/strict';
import test from 'node:test';
import {
  cleanPhoneNumber,
  findEmployeePhone,
  readSavedContact,
  toEmployeeContactRecord,
} from './venueReservationContact';

test('a number is reduced to plain digits', () => {
  assert.equal(cleanPhoneNumber('0812 3456 7890'), '081234567890');
  assert.equal(cleanPhoneNumber('0812-3456-7890'), '081234567890');
  assert.equal(cleanPhoneNumber('(0812) 3456 7890'), '081234567890');
  assert.equal(cleanPhoneNumber('0812-3456-7890 (WA)'), '081234567890');
  assert.equal(cleanPhoneNumber(81234567890), '81234567890', 'a number cell read as a number');
});

test('an Indonesian number always comes out in the local 0812… form', () => {
  assert.equal(cleanPhoneNumber('+62 812-3456-7890'), '081234567890');
  assert.equal(cleanPhoneNumber('+6281234567890'), '081234567890');
  assert.equal(cleanPhoneNumber('6281234567890'), '081234567890', 'no plus sign');
  assert.equal(cleanPhoneNumber('+62 0812-3456-7890'), '081234567890', 'stray zero after the country code');
  // Copied from WhatsApp, with invisible left-to-right marks around it.
  assert.equal(cleanPhoneNumber('‪+62 812-3456-7890‬'), '081234567890');
  assert.equal(cleanPhoneNumber('‎+62 812-3456-7890'), '081234567890');
});

test('a number from another country keeps its + sign', () => {
  assert.equal(cleanPhoneNumber('+1 415 555 2671'), '+14155552671');
  assert.equal(cleanPhoneNumber('+65 9123 4567'), '+6591234567');
});

test('with several numbers in one field, the first usable one wins', () => {
  assert.equal(cleanPhoneNumber('081234567890 / 085712345678'), '081234567890');
  assert.equal(cleanPhoneNumber('081234567890, 085712345678'), '081234567890');
  assert.equal(cleanPhoneNumber('081234567890 atau 085712345678'), '081234567890');
  assert.equal(cleanPhoneNumber('- / 085712345678'), '085712345678');
});

test('anything that is not a usable number is refused', () => {
  for (const raw of ['', '   ', '-', 'belum ada', '123', '12345678901234567890', null, undefined, {}, ['0812']]) {
    assert.equal(cleanPhoneNumber(raw), null, JSON.stringify(raw) ?? String(raw));
  }
});

test('employee documents are read in both stored shapes', () => {
  assert.deepEqual(toEmployeeContactRecord({ personal_info: { name: 'Ahmad Fauzi', phone: '0812' } }), {
    name: 'Ahmad Fauzi',
    phone: '0812',
  });
  assert.deepEqual(toEmployeeContactRecord({ name: 'Siti Aminah', phoneNumber: '0857' }), {
    name: 'Siti Aminah',
    phone: '0857',
  });
  assert.equal(toEmployeeContactRecord({ personal_info: { phone: '0812' } }), null, 'no name');
  assert.equal(toEmployeeContactRecord(null), null);
  assert.equal(toEmployeeContactRecord('x'), null);
});

const RECORDS = [
  { name: 'Dr. Ahmad Fauzi, M.Pd', phone: '0812-3456-7890' },
  { name: 'Siti Aminah, S.E.', phone: '' },
  { name: 'Budi Santoso', phone: '0857 1111 2222' },
  { name: 'Budi Santoso, S.Kom', phone: '0858 3333 4444' },
  { name: 'Rina Wati', phone: 'belum ada' },
];

test('the phone comes from the one employee with the same name, titles ignored', () => {
  assert.equal(findEmployeePhone('Ahmad Fauzi', RECORDS), '081234567890');
  assert.equal(findEmployeePhone('  DR. AHMAD FAUZI ', RECORDS), '081234567890');
  assert.equal(findEmployeePhone('Ahmad Fauzi, M.Pd', RECORDS), '081234567890');
});

test('no match, an ambiguous match, or a record without a usable number all mean "unknown"', () => {
  assert.equal(findEmployeePhone('Orang Lain', RECORDS), null, 'no such employee');
  assert.equal(findEmployeePhone('Budi Santoso', RECORDS), null, 'two employees with that name');
  assert.equal(findEmployeePhone('Siti Aminah', RECORDS), null, 'record has no number');
  assert.equal(findEmployeePhone('Rina Wati', RECORDS), null, 'record has no usable number');
  assert.equal(findEmployeePhone('', RECORDS), null);
  assert.equal(findEmployeePhone('Ahmad Fauzi', []), null);
});

test('a saved contact is read defensively', () => {
  assert.deepEqual(readSavedContact({ phoneNumber: '0812-3456-7890', pemohon: ' Fakultas Ekonomi ' }), {
    phone: '081234567890',
    pemohon: 'Fakultas Ekonomi',
  });
  assert.deepEqual(readSavedContact({ phoneNumber: 'abc', pemohon: '<b>x</b>' }), { phone: null, pemohon: null });
  assert.deepEqual(readSavedContact(undefined), { phone: null, pemohon: null });
  assert.deepEqual(readSavedContact('junk'), { phone: null, pemohon: null });
});
