import test from 'node:test';
import assert from 'node:assert/strict';
import {
  canApplyForKoperasiLoan,
  canCancelKoperasiLoan,
  canRespondToKoperasiRevision,
  canRestructureKoperasiLoan,
  koperasiAdminFee,
  koperasiApprovalStepIndex,
  koperasiLoanStatusTone,
  koperasiOutstandingBalance,
  koperasiRemainingTenor,
  quoteKoperasiRestructuring,
  validateKoperasiLoanApplication,
} from './koperasiLoanApplication';

const validApplication = {
  amount: 3_000_000,
  tenor: 6,
  purpose: 'Biaya pendidikan anak',
  bank: 'BSI',
  accountNumber: '1234567890',
};

test('admin fee brackets follow the cooperative schedule', () => {
  assert.equal(koperasiAdminFee(900_000), 0);
  assert.equal(koperasiAdminFee(1_000_000), 100_000);
  assert.equal(koperasiAdminFee(2_000_000), 100_000);
  assert.equal(koperasiAdminFee(2_000_001), 200_000);
  assert.equal(koperasiAdminFee(4_000_000), 200_000);
  assert.equal(koperasiAdminFee(6_000_000), 300_000);
  assert.equal(koperasiAdminFee(8_000_000), 400_000);
  assert.equal(koperasiAdminFee(10_000_000), 500_000);
});

test('a complete application passes validation', () => {
  assert.equal(validateKoperasiLoanApplication(validApplication), null);
});

test('validation rejects amounts outside the cooperative ceiling', () => {
  assert.match(
    validateKoperasiLoanApplication({ ...validApplication, amount: 999_999 }) || '',
    /Jumlah pinjaman harus antara/,
  );
  assert.match(
    validateKoperasiLoanApplication({ ...validApplication, amount: 10_000_001 }) || '',
    /Jumlah pinjaman harus antara/,
  );
});

test('validation rejects tenor outside 3-12 months', () => {
  assert.match(
    validateKoperasiLoanApplication({ ...validApplication, tenor: 2 }) || '',
    /tenor antara 3 - 12 bulan/,
  );
  assert.match(
    validateKoperasiLoanApplication({ ...validApplication, tenor: 13 }) || '',
    /tenor antara 3 - 12 bulan/,
  );
});

test('validation rejects a missing purpose, unknown bank, and non-numeric account', () => {
  assert.match(
    validateKoperasiLoanApplication({ ...validApplication, purpose: '   ' }) || '',
    /Tujuan pinjaman harus diisi/,
  );
  assert.match(
    validateKoperasiLoanApplication({ ...validApplication, bank: 'Bank Antah Berantah' }) || '',
    /pilih bank/,
  );
  assert.match(
    validateKoperasiLoanApplication({ ...validApplication, accountNumber: '12ab' }) || '',
    /Nomor rekening/,
  );
});

test('outstanding balance prefers the stored figure and falls back to derived', () => {
  assert.equal(koperasiOutstandingBalance({ sisaHutang: 1_500_000 }), 1_500_000);
  // 6M over 6 months = 1M per installment; two paid leaves 4M.
  assert.equal(
    koperasiOutstandingBalance({ jumlahPinjaman: 6_000_000, tenor: 6, jumlahMenyicil: 2 }),
    4_000_000,
  );
  // A settled loan never reports a negative balance.
  assert.equal(
    koperasiOutstandingBalance({ jumlahPinjaman: 6_000_000, tenor: 6, jumlahMenyicil: 9 }),
    0,
  );
});

test('remaining tenor never drops below zero', () => {
  assert.equal(koperasiRemainingTenor({ tenor: 12, jumlahMenyicil: 5 }), 7);
  assert.equal(koperasiRemainingTenor({ tenor: 12, jumlahMenyicil: 15 }), 0);
});

test('a live application blocks a second one, a settled one does not', () => {
  assert.equal(canApplyForKoperasiLoan([]), true);
  assert.equal(canApplyForKoperasiLoan([{ status: 'Lunas' }, { status: 'Dibatalkan' }]), true);
  assert.equal(canApplyForKoperasiLoan([{ status: 'Menunggu Persetujuan BAK' }]), false);
  assert.equal(canApplyForKoperasiLoan([{ status: 'Disetujui dan Aktif' }]), false);
});

test('an installment event still counts as an active loan for the one-at-a-time rule', () => {
  const payingLoan = {
    status: 'Disetujui dan Aktif',
    history: [
      { status: 'Disetujui dan Aktif' },
      { status: 'Pembayaran Cicilan' },
    ],
  };
  assert.equal(canApplyForKoperasiLoan([payingLoan]), false);
  assert.equal(canRestructureKoperasiLoan(payingLoan), true);
});

test('member actions are gated on the resolved status', () => {
  assert.equal(canRestructureKoperasiLoan({ status: 'Disetujui dan Aktif' }), true);
  assert.equal(canRestructureKoperasiLoan({ status: 'Menunggu Persetujuan BAK' }), false);
  // A restructuring already in flight must not spawn another one.
  assert.equal(
    canRestructureKoperasiLoan({ status: 'Menunggu Persetujuan Restrukturisasi' }),
    false,
  );

  assert.equal(canCancelKoperasiLoan({ status: 'Menunggu Persetujuan BAK' }), true);
  assert.equal(canCancelKoperasiLoan({ status: 'Disetujui dan Aktif' }), false);

  assert.equal(canRespondToKoperasiRevision({ status: 'Direvisi BAK' }), true);
  assert.equal(canRespondToKoperasiRevision({ status: 'Menunggu Persetujuan BAK' }), false);
});

test('restructuring rolls the outstanding balance and remaining tenor forward', () => {
  const loan = {
    status: 'Disetujui dan Aktif',
    jumlahPinjaman: 6_000_000,
    tenor: 12,
    jumlahMenyicil: 4,
    sisaHutang: 4_000_000,
  };

  const quote = quoteKoperasiRestructuring(loan, 2_000_000, 6);

  assert.equal(quote.error, null);
  assert.equal(quote.carriedBalance, 4_000_000);
  assert.equal(quote.carriedTenor, 8);
  assert.equal(quote.newTotal, 6_000_000);
  assert.equal(quote.newTenor, 14);
  assert.equal(quote.adminFee, 300_000);
  assert.equal(quote.monthlyInstallment, Math.round(6_000_000 / 14));
  assert.equal(quote.maxAdditionalAmount, 6_000_000);
});

test('restructuring refuses a top-up that breaches the Rp 10 JT ceiling', () => {
  const loan = {
    status: 'Disetujui dan Aktif',
    jumlahPinjaman: 9_000_000,
    tenor: 12,
    jumlahMenyicil: 0,
    sisaHutang: 9_000_000,
  };

  const quote = quoteKoperasiRestructuring(loan, 2_000_000, 6);
  assert.match(quote.error || '', /Total pinjaman baru harus antara/);
  assert.equal(quote.maxAdditionalAmount, 1_000_000);

  // Exactly at the ceiling is allowed.
  assert.equal(quoteKoperasiRestructuring(loan, 1_000_000, 6).error, null);
});

test('restructuring refuses zero top-up, bad tenor, and inactive loans', () => {
  const loan = {
    status: 'Disetujui dan Aktif',
    jumlahPinjaman: 6_000_000,
    tenor: 12,
    jumlahMenyicil: 4,
    sisaHutang: 4_000_000,
  };

  assert.match(quoteKoperasiRestructuring(loan, 0, 6).error || '', /harus lebih dari Rp 0/);
  assert.match(quoteKoperasiRestructuring(loan, 1_000_000, 2).error || '', /tenor tambahan/);
  assert.match(quoteKoperasiRestructuring(loan, 1_000_000, 13).error || '', /tenor tambahan/);
  assert.match(
    quoteKoperasiRestructuring({ ...loan, status: 'Lunas' }, 1_000_000, 6).error || '',
    /berstatus aktif/,
  );
});

test('status tones separate settled, rejected, and restructuring states', () => {
  assert.equal(koperasiLoanStatusTone('Disetujui dan Aktif'), 'success');
  assert.equal(koperasiLoanStatusTone('Lunas'), 'neutral');
  assert.equal(koperasiLoanStatusTone('Direvisi BAK'), 'warning');
  assert.equal(koperasiLoanStatusTone('Ditolak BAK'), 'danger');
  assert.equal(koperasiLoanStatusTone('Direstrukturisasi'), 'restructure');
  assert.equal(koperasiLoanStatusTone('Menunggu Persetujuan BAK'), 'pending');
});

test('approval tracker positions each waiting state, and settles at the end', () => {
  assert.equal(koperasiApprovalStepIndex('Menunggu Persetujuan BAK'), 0);
  assert.equal(koperasiApprovalStepIndex('Menunggu Persetujuan Wakil Rektor 2'), 1);
  assert.equal(koperasiApprovalStepIndex('Menunggu Transfer BAK'), 2);
  assert.equal(koperasiApprovalStepIndex('Disetujui dan Aktif'), 3);
  assert.equal(koperasiApprovalStepIndex('Lunas'), 3);
  // Terminal failures sit outside the happy path.
  assert.equal(koperasiApprovalStepIndex('Ditolak BAK'), -1);
});
