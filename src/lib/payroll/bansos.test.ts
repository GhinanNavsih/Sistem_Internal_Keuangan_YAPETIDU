import assert from 'node:assert/strict';
import test from 'node:test';
import {
  bansosCounts,
  bansosEventId,
  bansosStatus,
  buildBansosEventWorkers,
  defaultBansosAmount,
  planBansosDecision,
  possibleDuplicate,
  validateBansosSubmission,
  type BansosRequest,
} from './bansos';

const TODAY = '2026-10-07';

test('default amounts follow the kind and the employee class', () => {
  assert.equal(defaultBansosAmount('melahirkan', 'loyalis'), 500_000);
  assert.equal(defaultBansosAmount('melahirkan', 'pekarya'), 500_000);
  assert.equal(defaultBansosAmount('duka', 'loyalis'), 1_000_000);
  assert.equal(defaultBansosAmount('duka', 'pekarya'), 750_000);
});

test('one event per month and kind', () => {
  assert.equal(bansosEventId('2026-10', 'duka'), 'BANSOS_2026-10_DUKA');
  assert.equal(bansosEventId('2026-10', 'melahirkan'), 'BANSOS_2026-10_MELAHIRKAN');
});

test('status: paid needs both sides, a rejection by either ends it', () => {
  assert.equal(bansosStatus({ adminDecision: 'pending', financeDecision: 'pending' }), 'awaiting_both');
  assert.equal(bansosStatus({ adminDecision: 'accepted', financeDecision: 'pending' }), 'awaiting_finance');
  assert.equal(bansosStatus({ adminDecision: 'pending', financeDecision: 'accepted' }), 'awaiting_admin');
  assert.equal(bansosStatus({ adminDecision: 'accepted', financeDecision: 'accepted' }), 'paid');
  assert.equal(bansosStatus({ adminDecision: 'accepted', financeDecision: 'rejected' }), 'rejected');
  assert.equal(bansosStatus({ adminDecision: 'accepted', financeDecision: 'accepted', withdrawn: true }), 'withdrawn');
});

test('Duka needs a relationship and a name; Melahirkan only the date', () => {
  assert.deepEqual(
    validateBansosSubmission({ kind: 'melahirkan', eventDate: '2026-10-01', subjectName: '  ' }, TODAY),
    { kind: 'melahirkan', eventDate: '2026-10-01', subjectName: '' },
  );
  assert.throws(() => validateBansosSubmission({ kind: 'duka', eventDate: '2026-10-01', subjectName: 'Ahmad' }, TODAY), /hubungan/);
  assert.throws(() => validateBansosSubmission({ kind: 'duka', eventDate: '2026-10-01', relationship: 'ayah' }, TODAY), /Nama/);
  assert.throws(
    () => validateBansosSubmission({ kind: 'duka', eventDate: '2026-10-01', relationship: 'lainnya', subjectName: 'Ahmad' }, TODAY),
    /Tuliskan hubungan/,
  );
  assert.deepEqual(
    validateBansosSubmission({
      kind: 'duka', eventDate: '2026-10-01', relationship: 'lainnya', relationshipOther: ' Paman ', subjectName: ' Ahmad  Fauzi ',
    }, TODAY),
    { kind: 'duka', eventDate: '2026-10-01', subjectName: 'Ahmad Fauzi', relationship: 'lainnya', relationshipOther: 'Paman' },
  );
});

test('the date must be real and not in the future', () => {
  assert.throws(() => validateBansosSubmission({ kind: 'melahirkan', eventDate: '2026-10-08' }, TODAY), /setelah hari ini/);
  assert.throws(() => validateBansosSubmission({ kind: 'melahirkan', eventDate: '2026-02-30' }, TODAY), /wajib diisi/);
  assert.throws(() => validateBansosSubmission({ kind: 'lainnya', eventDate: '2026-10-01' }, TODAY), /jenis ajuan/);
});

const pending = { adminDecision: 'pending', financeDecision: 'pending', amount: 1_000_000 } as const;

test('either side may go first; the second acceptance pays', () => {
  const adminFirst = planBansosDecision(pending, 'admin', 'accept');
  assert.equal(adminFirst.willBePaid, false);
  const financeSecond = planBansosDecision({ ...pending, adminDecision: 'accepted' }, 'finance', 'accept', { amount: 900_000 });
  assert.equal(financeSecond.willBePaid, true);
  assert.equal(financeSecond.amount, 900_000);

  const financeFirst = planBansosDecision(pending, 'finance', 'accept', { amount: 1_000_000 });
  assert.equal(financeFirst.willBePaid, false);
  const adminSecond = planBansosDecision({ ...pending, financeDecision: 'accepted' }, 'admin', 'accept');
  assert.equal(adminSecond.willBePaid, true);
  assert.equal(adminSecond.amount, 1_000_000, 'the amount Super Admin set is kept');
});

test('only Super Admin sets the amount, and only a whole positive rupiah', () => {
  assert.throws(() => planBansosDecision(pending, 'admin', 'accept', { amount: 5 }), /Super Admin/);
  assert.throws(() => planBansosDecision(pending, 'finance', 'accept', { amount: 0 }), /Nominal/);
  assert.throws(() => planBansosDecision(pending, 'finance', 'accept', { amount: 1.5 }), /Nominal/);
  assert.throws(() => planBansosDecision(pending, 'finance', 'accept'), /Nominal/);
});

test('decided sides reset before deciding again; a rejection blocks the other side', () => {
  assert.throws(() => planBansosDecision({ ...pending, adminDecision: 'accepted' }, 'admin', 'reject', { reason: 'Tidak sesuai' }), /Batalkan/);
  assert.throws(() => planBansosDecision(pending, 'admin', 'reset'), /Belum ada/);
  assert.throws(() => planBansosDecision(pending, 'admin', 'reject'), /Alasan/);
  assert.throws(() => planBansosDecision({ ...pending, adminDecision: 'rejected' }, 'finance', 'accept', { amount: 1 }), /ditolak Admin Karyawan/);
  const unpaid = planBansosDecision({ adminDecision: 'accepted', financeDecision: 'accepted', amount: 1 }, 'admin', 'reset');
  assert.equal(unpaid.wasPaid, true);
  assert.equal(unpaid.willBePaid, false);
  assert.throws(() => planBansosDecision({ ...pending, withdrawn: true }, 'admin', 'accept'), /ditarik/);
});

function request(overrides: Partial<BansosRequest>): BansosRequest {
  return {
    id: 'r1', employeeId: 'Loyalis_001', employeeCollection: 'Employees_Loyalis', employeeClass: 'loyalis',
    employeeName: 'Ani', kind: 'duka', eventDate: '2026-10-01', subjectName: 'Budi', relationship: 'ayah',
    proofName: 'surat.pdf', proofUrl: 'https://x', proofContentType: 'application/pdf', proofSize: 10,
    adminDecision: 'accepted', financeDecision: 'accepted', amount: 1_000_000, period: '2026-10',
    withdrawn: false, status: 'paid', revision: 3, submittedAt: '2026-10-02T00:00:00.000Z',
    ...overrides,
  };
}

test('event workers: only paid ajuan, summed per employee, Pekarya keeps its category', () => {
  const workers = buildBansosEventWorkers([
    request({ id: 'a', amount: 1_000_000 }),
    request({ id: 'b', amount: 250_000 }),
    request({ id: 'c', employeeId: 'BC_001', employeeCollection: 'Employees_BlueCollar', employeeName: 'Ali', jobCategory: 'SATPAM', amount: 750_000 }),
    request({ id: 'd', employeeId: 'Loyalis_002', status: 'awaiting_admin' }),
  ]);
  assert.deepEqual(workers, [
    { employeeId: 'BC_001', employeeName: 'Ali', payGiven: 750_000, employeeCollection: 'Employees_BlueCollar', jobCategory: 'SATPAM' },
    { employeeId: 'Loyalis_001', employeeName: 'Ani', payGiven: 1_250_000, employeeCollection: 'Employees_Loyalis' },
  ]);
  assert.deepEqual(
    bansosCounts([request({}), request({ status: 'awaiting_both' }), request({ status: 'rejected' }), request({ status: 'withdrawn' })]),
    { waiting: 1, paid: 1, rejected: 1 },
  );
});

test('possible duplicate: same employee, kind and date; for Duka also the same person', () => {
  const base = request({ id: 'new', status: 'awaiting_both' });
  assert.equal(possibleDuplicate(base, [request({ id: 'old', subjectName: ' budi ' })]), true);
  assert.equal(possibleDuplicate(base, [request({ id: 'old', subjectName: 'Citra' })]), false);
  assert.equal(possibleDuplicate(base, [request({ id: 'old', status: 'rejected' })]), false);
  assert.equal(possibleDuplicate(base, [request({ id: 'new' })]), false, 'not itself');
  const birth = request({ id: 'new', kind: 'melahirkan', subjectName: '', status: 'awaiting_both' });
  assert.equal(possibleDuplicate(birth, [request({ id: 'old', kind: 'melahirkan', subjectName: 'Bayi' })]), true);
});
