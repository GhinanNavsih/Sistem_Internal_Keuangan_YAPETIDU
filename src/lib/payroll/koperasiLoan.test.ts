import test from 'node:test';
import assert from 'node:assert/strict';
import {
  composeKoperasiLoanHistoryTrail,
  koperasiMonthlyInstallment,
  koperasiPaidInstallments,
  koperasiProjectedPaidInstallments,
  koperasiProjectedRemainingBalance,
  projectKoperasiLoanForPeriod,
  resolveKoperasiLoanStatus,
  selectKoperasiActiveLoans,
  selectKoperasiLineageHeads,
} from './koperasiLoan';

const timestamp = (seconds: number) => ({ seconds, nanoseconds: 0 });

test('latest history status is authoritative and installment events remain active', () => {
  const loan = {
    status: 'Menunggu Persetujuan Restrukturisasi',
    history: [
      { status: 'Disetujui dan Aktif', timestamp: timestamp(100) },
      { status: 'Pembayaran Cicilan', timestamp: timestamp(200) },
    ],
  };

  assert.equal(resolveKoperasiLoanStatus(loan), 'Disetujui dan Aktif');
});

test('loan math uses the recorded paid-installment count from Simpan Pinjam', () => {
  const loan = { jumlahPinjaman: 3_900_000, tenor: 12, jumlahMenyicil: 11 };
  assert.equal(koperasiMonthlyInstallment(loan), 325_000);
  assert.equal(koperasiPaidInstallments(loan), 11);
});

test('history trail includes restructuring ancestors in audit order', () => {
  const oldLoan = {
    id: 'old-loan',
    history: [{ status: 'Disetujui dan Aktif', timestamp: timestamp(100) }],
  };
  const newLoan = {
    id: 'new-loan',
    restructuredFromLoanId: 'old-loan',
    history: [{ status: 'Menunggu Persetujuan BAK', timestamp: timestamp(200) }],
  };

  const trail = composeKoperasiLoanHistoryTrail(newLoan, [oldLoan, newLoan]);
  assert.deepEqual(trail.map(segment => segment.loanId), ['old-loan', 'new-loan']);
  assert.equal(trail[0].entries[0].status, 'Disetujui dan Aktif');
  assert.equal(trail[1].entries[0].status, 'Menunggu Persetujuan BAK');
});

test('period projection excludes future payments and uses the period status', () => {
  const loan = {
    status: 'Menunggu Persetujuan Restrukturisasi',
    jumlahPinjaman: 3_900_000,
    tenor: 12,
    sisaHutang: 325_000,
    jumlahMenyicil: 11,
    tanggalPengajuan: timestamp(100),
    history: [
      { status: 'Disetujui dan Aktif', timestamp: timestamp(100) },
      { status: 'Pembayaran Cicilan', timestamp: timestamp(200) },
      { status: 'Pembayaran Cicilan', timestamp: timestamp(300) },
      { status: 'Pembayaran Cicilan', timestamp: timestamp(400) },
      { status: 'Menunggu Persetujuan Restrukturisasi', timestamp: timestamp(500) },
    ],
  };

  const projection = projectKoperasiLoanForPeriod(loan, new Date(250 * 1000));
  assert.ok(projection);
  assert.equal(projection.status, 'Disetujui dan Aktif');
  assert.equal(projection.paidInstallments, 1);
  assert.equal(projection.sisaHutang, 3_575_000);
  assert.equal(projection.history.length, 2);
});

test('period projection does not show a loan before its application date', () => {
  const loan = {
    status: 'Menunggu Persetujuan BAK',
    jumlahPinjaman: 10_000_000,
    tenor: 10,
    tanggalPengajuan: timestamp(500),
    history: [{ status: 'Menunggu Persetujuan BAK', timestamp: timestamp(500) }],
  };

  assert.equal(projectKoperasiLoanForPeriod(loan, new Date(499 * 1000)), null);
});

test('future restructuring does not hide the historical loan head', () => {
  const oldLoan = { id: 'old-loan', sisaHutang: 325_000 };
  const futureLoan = { id: 'new-loan', restructuredFromLoanId: 'old-loan', sisaHutang: 10_000_000 };

  assert.deepEqual(selectKoperasiLineageHeads([oldLoan]), [oldLoan]);
  assert.deepEqual(selectKoperasiLineageHeads([oldLoan, futureLoan]), [futureLoan]);
});

test('employee loan cards exclude rejected restructuring applications', () => {
  const rejectedProposal = {
    id: 'rejected-proposal',
    status: 'Ditolak BAK',
    restructuredFromLoanId: 'previous-loan',
    history: [{ status: 'Ditolak BAK', timestamp: timestamp(200) }],
  };
  const activeLoan = {
    id: 'active-loan',
    status: 'Disetujui dan Aktif',
    restructuredFromLoanId: 'previous-loan',
    history: [{ status: 'Disetujui dan Aktif', timestamp: timestamp(200) }],
  };

  assert.deepEqual(
    selectKoperasiActiveLoans([rejectedProposal, activeLoan]),
    [activeLoan],
  );
});

test('selected-period installment projection advances June from 10/12 to 11/12', () => {
  const juneProjection = {
    paidInstallments: 10,
    tenor: 12,
    sisaHutang: 650_000,
    cicilan: 325_000,
  };

  assert.equal(koperasiProjectedPaidInstallments(juneProjection), 11);
  assert.equal(koperasiProjectedRemainingBalance(juneProjection), 325_000);
  assert.equal(Math.round((koperasiProjectedPaidInstallments(juneProjection) / juneProjection.tenor) * 100), 92);
});
