import assert from 'node:assert/strict';
import test from 'node:test';
import {
  ALREADY_SENT_NOTE,
  buildEmailHistory,
  mergeEmailDetail,
  STALE_SENDING_MS,
  UNCONFIRMED_SEND_MESSAGE,
  type DeliveryEventInput,
} from './emailHistory';

const now = Date.UTC(2026, 10, 5, 8, 0, 0);
const employees = new Map([
  ['a', { name: 'Ani', email: 'ani@x.id' }],
  ['b', { name: 'Budi', email: 'budi@x.id' }],
  ['c', { name: 'Citra', email: 'citra@x.id' }],
  ['d', { name: 'Dodi', email: 'dodi@x.id' }],
]);
const delivery = (patch: Partial<DeliveryEventInput> & { employeeId: string }): DeliveryEventInput => ({
  status: 'sent',
  recipient: '',
  requestedAt: now - 60_000,
  sentAt: null,
  error: '',
  ...patch,
});

test('a slip marked emailSent is sent, with the recorded time', () => {
  const [row] = buildEmailHistory({
    slips: [{ employeeId: 'a', status: 'locked', emailSent: true, emailSentAt: now - 1000 }],
    deliveries: [delivery({ employeeId: 'a', recipient: 'old@x.id' })],
    employees,
    now,
  });
  assert.equal(row.status, 'sent');
  assert.equal(row.sentAt, new Date(now - 1000).toISOString());
  assert.equal(row.email, 'old@x.id', 'shows the address it actually went to');
  assert.equal(row.attempts, 1);
});

test('a failure after an earlier success still reads as sent', () => {
  const [row] = buildEmailHistory({
    slips: [{ employeeId: 'a', status: 'paid', emailSent: true, emailSentAt: now - 5000 }],
    deliveries: [
      delivery({ employeeId: 'a', requestedAt: now - 6000 }),
      delivery({ employeeId: 'a', status: 'failed', error: 'SMTP down', requestedAt: now - 1000 }),
    ],
    employees,
    now,
  });
  assert.equal(row.status, 'sent');
  assert.equal(row.attempts, 2);
});

test('only the latest attempt decides failed vs in flight', () => {
  const rows = buildEmailHistory({
    slips: [
      { employeeId: 'b', status: 'locked', emailSent: false, emailSentAt: null },
      { employeeId: 'c', status: 'locked', emailSent: false, emailSentAt: null },
      { employeeId: 'd', status: 'locked', emailSent: false, emailSentAt: null },
    ],
    deliveries: [
      delivery({ employeeId: 'b', status: 'failed', error: 'Kotak masuk penuh' }),
      delivery({ employeeId: 'c', status: 'sending', requestedAt: now - 10_000 }),
      delivery({ employeeId: 'd', status: 'sending', requestedAt: now - STALE_SENDING_MS - 1 }),
    ],
    employees,
    now,
  });
  const byId = new Map(rows.map((row) => [row.employeeId, row]));
  assert.equal(byId.get('b')?.status, 'failed');
  assert.equal(byId.get('b')?.error, 'Kotak masuk penuh');
  assert.equal(byId.get('c')?.status, 'sending');
  assert.equal(byId.get('d')?.status, 'failed', 'a send that never reported back is not trusted');
  assert.equal(byId.get('d')?.error, UNCONFIRMED_SEND_MESSAGE);
});

test('locked slips with no attempts are listed as not sent; drafts are left out', () => {
  const rows = buildEmailHistory({
    slips: [
      { employeeId: 'a', status: 'locked', emailSent: false, emailSentAt: null },
      { employeeId: 'b', status: 'draft', emailSent: false, emailSentAt: null },
    ],
    deliveries: [],
    employees,
    now,
  });
  assert.deepEqual(rows.map((row) => [row.employeeId, row.status, row.email]), [['a', 'not_sent', 'ani@x.id']]);
});

test('rows are sorted by name', () => {
  const rows = buildEmailHistory({
    slips: ['c', 'a', 'b'].map((employeeId) => ({ employeeId, status: 'locked', emailSent: false, emailSentAt: null })),
    deliveries: [],
    employees,
    now,
  });
  assert.deepEqual(rows.map((row) => row.employeeName), ['Ani', 'Budi', 'Citra']);
});

test('the live queue is laid over history, but a recorded send always wins', () => {
  const history = buildEmailHistory({
    slips: [
      { employeeId: 'a', status: 'locked', emailSent: true, emailSentAt: now },
      { employeeId: 'b', status: 'locked', emailSent: false, emailSentAt: null },
      { employeeId: 'c', status: 'locked', emailSent: false, emailSentAt: null },
      { employeeId: 'd', status: 'locked', emailSent: false, emailSentAt: null },
    ],
    deliveries: [],
    employees,
    now,
  });
  const rows = mergeEmailDetail(history, [
    { employeeId: 'a', employeeName: 'Ani', email: 'ani@x.id', status: 'pending' },
    { employeeId: 'b', employeeName: 'Budi', email: 'budi@x.id', status: 'sending' },
    { employeeId: 'c', employeeName: 'Citra', email: 'citra@x.id', status: 'failed', error: 'Timeout' },
  ]);
  const byId = new Map(rows.map((row) => [row.employeeId, row]));
  assert.equal(byId.get('a')?.status, 'sent');
  assert.equal(byId.get('b')?.status, 'sending');
  assert.equal(byId.get('c')?.status, 'failed');
  assert.equal(byId.get('c')?.note, 'Timeout');
  assert.equal(byId.get('d')?.status, 'not_sent');
});

test('a queue item the server skipped is shown as sent with a note', () => {
  const [row] = mergeEmailDetail(null, [
    { employeeId: 'a', employeeName: 'Ani', email: 'ani@x.id', status: 'success', alreadySent: true },
  ]);
  assert.equal(row.status, 'sent');
  assert.equal(row.note, ALREADY_SENT_NOTE);
});

test('without history the queue alone is shown', () => {
  const rows = mergeEmailDetail(null, [
    { employeeId: 'b', employeeName: 'Budi', email: 'budi@x.id', status: 'pending' },
    { employeeId: 'a', employeeName: 'Ani', email: 'ani@x.id', status: 'success' },
  ]);
  assert.deepEqual(rows.map((row) => [row.employeeName, row.status]), [['Ani', 'sent'], ['Budi', 'pending']]);
});
