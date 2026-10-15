import assert from 'node:assert/strict';
import test from 'node:test';
import {
  BANSOS_RELATIONSHIPS,
  assertBansosHandover,
  bansosCounts,
  bansosEmployeeView,
  bansosEventId,
  bansosRelationshipLabel,
  bansosStatus,
  buildBansosEventWorkers,
  defaultBansosAmount,
  planBansosDecision,
  possibleDuplicate,
  validateBansosSubmission,
  type BansosRequest,
} from './santunan';

const TODAY = '2026-10-07';

test('default amounts follow the kind and the employee class', () => {
  assert.equal(defaultBansosAmount('melahirkan', 'loyalis'), 500_000);
  assert.equal(defaultBansosAmount('melahirkan', 'pekarya'), 300_000);
  assert.equal(defaultBansosAmount('duka', 'loyalis'), 1_000_000);
  assert.equal(defaultBansosAmount('duka', 'pekarya'), 750_000);
});

test('one event per month and kind', () => {
  assert.equal(bansosEventId('2026-10', 'duka'), 'BANSOS_2026-10_DUKA');
  assert.equal(bansosEventId('2026-10', 'melahirkan'), 'BANSOS_2026-10_MELAHIRKAN');
});

test('status: approval needs both sides, a rejection by either ends it', () => {
  const birth = { kind: 'melahirkan' } as const;
  assert.equal(bansosStatus({ ...birth, adminDecision: 'pending', financeDecision: 'pending' }), 'awaiting_both');
  assert.equal(bansosStatus({ ...birth, adminDecision: 'accepted', financeDecision: 'pending' }), 'awaiting_finance');
  assert.equal(bansosStatus({ ...birth, adminDecision: 'pending', financeDecision: 'accepted' }), 'awaiting_admin');
  assert.equal(bansosStatus({ ...birth, adminDecision: 'accepted', financeDecision: 'accepted' }), 'paid');
  assert.equal(bansosStatus({ ...birth, adminDecision: 'accepted', financeDecision: 'rejected' }), 'rejected');
  assert.equal(bansosStatus({ ...birth, adminDecision: 'accepted', financeDecision: 'accepted', withdrawn: true }), 'withdrawn');
});

test('status: an approved Duka waits for the cash, then is done; it is never on the slip', () => {
  const approved = { kind: 'duka', adminDecision: 'accepted', financeDecision: 'accepted' } as const;
  assert.equal(bansosStatus(approved), 'awaiting_handover');
  assert.equal(bansosStatus({ ...approved, handedOver: true }), 'handed_over');
  assert.equal(planBansosDecision({ ...approved, financeDecision: 'pending', amount: 1 }, 'finance', 'accept').willBePaid, false);
});

test('Duka accepts birth parents, children and a typed-in Lainnya only', () => {
  assert.deepEqual(BANSOS_RELATIONSHIPS.map((option) => option.value), ['ibu', 'ayah', 'anak', 'lainnya']);
  assert.throws(
    () => validateBansosSubmission({ kind: 'duka', eventDate: '2026-10-01', relationship: 'ayah_mertua', subjectName: 'Ahmad' }, TODAY),
    /hubungan/,
  );
  assert.equal(bansosRelationshipLabel({ relationship: 'ibu' }), 'Ibu Kandung');
  // An ajuan stored before the list was narrowed keeps its label.
  assert.equal(bansosRelationshipLabel({ relationship: 'ayah_mertua' }), 'Ayah Mertua');
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

const pending = { kind: 'melahirkan', adminDecision: 'pending', financeDecision: 'pending', amount: 500_000 } as const;

test('either side may go first; the second acceptance pays', () => {
  const adminFirst = planBansosDecision(pending, 'admin', 'accept');
  assert.equal(adminFirst.willBePaid, false);
  const financeSecond = planBansosDecision({ ...pending, adminDecision: 'accepted' }, 'finance', 'accept', { amount: 400_000 });
  assert.equal(financeSecond.willBePaid, true);
  assert.equal(financeSecond.amount, 400_000);

  const financeFirst = planBansosDecision(pending, 'finance', 'accept', { amount: 450_000 });
  assert.equal(financeFirst.willBePaid, false);
  const adminSecond = planBansosDecision({ ...pending, financeDecision: 'accepted', amount: 450_000 }, 'admin', 'accept');
  assert.equal(adminSecond.willBePaid, true);
  assert.equal(adminSecond.amount, 450_000, 'the amount Super Admin set is kept');
});

test('either side sets the amount when accepting, but Super Admin has the last word', () => {
  assert.equal(planBansosDecision(pending, 'admin', 'accept', { amount: 250_000 }).amount, 250_000, 'Admin Karyawan may set it first');
  assert.equal(planBansosDecision(pending, 'finance', 'accept').amount, 500_000, 'no amount keeps the stored one');
  const financeAccepted = { ...pending, financeDecision: 'accepted', amount: 450_000 } as const;
  assert.throws(() => planBansosDecision(financeAccepted, 'admin', 'accept', { amount: 500_000 }), /ditetapkan Super Admin/);
  assert.equal(planBansosDecision(financeAccepted, 'admin', 'accept', { amount: 450_000 }).amount, 450_000, 'repeating it is fine');
  assert.throws(() => planBansosDecision(pending, 'finance', 'accept', { amount: 0 }), /Nominal/);
  assert.throws(() => planBansosDecision(pending, 'admin', 'accept', { amount: 1.5 }), /Nominal/);
});

test('a Duka is handed over only once both accepted, and then nothing changes', () => {
  const duka = { kind: 'duka', adminDecision: 'accepted', financeDecision: 'accepted', withdrawn: false, handedOver: false } as const;
  assert.doesNotThrow(() => assertBansosHandover(duka));
  assert.throws(() => assertBansosHandover({ ...duka, financeDecision: 'pending' }), /sama-sama menerima/);
  assert.throws(() => assertBansosHandover({ ...duka, handedOver: true }), /sudah ditandai/);
  assert.throws(() => assertBansosHandover({ ...duka, kind: 'melahirkan' }), /bersama gaji/);
  assert.throws(() => planBansosDecision({ ...duka, handedOver: true, amount: 1 }, 'admin', 'reset'), /sudah diserahkan/);
});

test('decided sides reset before deciding again; a rejection blocks the other side', () => {
  assert.throws(() => planBansosDecision({ ...pending, adminDecision: 'accepted' }, 'admin', 'reject', { reason: 'Tidak sesuai' }), /Batalkan/);
  assert.throws(() => planBansosDecision(pending, 'admin', 'reset'), /Belum ada/);
  assert.throws(() => planBansosDecision(pending, 'admin', 'reject'), /Alasan/);
  assert.throws(() => planBansosDecision({ ...pending, adminDecision: 'rejected' }, 'finance', 'accept', { amount: 1 }), /ditolak Admin Karyawan/);
  const unpaid = planBansosDecision({ ...pending, adminDecision: 'accepted', financeDecision: 'accepted' }, 'admin', 'reset');
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
    withdrawn: false, handedOver: false, status: 'paid', revision: 3, submittedAt: '2026-10-02T00:00:00.000Z',
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

test('the employee sees the amount only once it is paid or handed over', () => {
  assert.equal(bansosEmployeeView(request({ kind: 'melahirkan', status: 'awaiting_finance' })).amount, undefined);
  assert.equal(bansosEmployeeView(request({ status: 'awaiting_handover' })).amount, undefined);
  assert.equal(bansosEmployeeView(request({ kind: 'melahirkan', status: 'paid', amount: 300_000 })).amount, 300_000);
  assert.equal(bansosEmployeeView(request({ status: 'handed_over' })).amount, 1_000_000);
  assert.equal('possibleDuplicate' in bansosEmployeeView(request({ possibleDuplicate: true })), false);
});
