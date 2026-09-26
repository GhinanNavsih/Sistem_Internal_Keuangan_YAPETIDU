import assert from 'node:assert/strict';
import test from 'node:test';
import { buildKoperasiPayrollAmountMaps } from './koperasiAmounts';

test('savings follow payment status, authoritative membership status and the member amount', () => {
  const employee = { id: 'employee-1', koperasiUserId: 'member-1' };
  const member = { id: 'member-1', status: 'approved', membershipStatus: 'approved', paymentStatus: 'Payroll Deduction', iuranWajib: 75_000 };
  const savings = (changes: Partial<typeof member>) => buildKoperasiPayrollAmountMaps('2026-09', [employee], [], [{ ...member, ...changes }]).savings['employee-1'];
  assert.equal(savings({}), 75_000);
  assert.equal(savings({ iuranWajib: 0 }), 25_000);
  for (const paymentStatus of ['Transfer', 'Pending Verification', 'Yayasan Subsidy', '']) assert.equal(savings({ paymentStatus }), 0);
  for (const membershipStatus of ['Pending', 'inactive', 'rejected', 'removed']) assert.equal(savings({ membershipStatus }), 0);
});

test('another member with the same name cannot override an explicit savings link', () => {
  const employee = { id: 'employee-1', name: 'Nama Sama', koperasiUserId: 'member-1' };
  const members = [
    { id: 'member-1', nama: 'Nama Sama', membershipStatus: 'approved', paymentStatus: 'Payroll Deduction', iuranWajib: 75000 },
    { id: 'member-2', nama: 'Nama Sama', membershipStatus: 'inactive', paymentStatus: 'Transfer' },
  ];
  for (const users of [members, [...members].reverse()]) {
    assert.equal(buildKoperasiPayrollAmountMaps('2026-09', [employee], [], users).savings['employee-1'], 75000);
  }
});

const timestamp = (iso: string) => ({
  toMillis: () => new Date(iso).getTime(),
});

test('Koperasi payroll amounts are calculated for the selected payroll period', () => {
  const employee = {
    id: 'employee-1',
    name: 'Pegawai Satu',
    koperasiAuthUid: 'koperasi-user-1',
  };
  const julyLoan = {
    id: 'july-loan',
    userId: 'koperasi-user-1',
    status: 'Disetujui dan Aktif',
    jumlahPinjaman: 3_900_000,
    tenor: 12,
    jumlahMenyicil: 2,
    sisaHutang: 3_250_000,
    tanggalDisetujui: timestamp('2026-07-02T00:00:00+07:00'),
  };
  const augustLoan = {
    ...julyLoan,
    id: 'august-loan',
    jumlahPinjaman: 1_200_000,
    tanggalDisetujui: timestamp('2026-08-01T00:00:00+07:00'),
  };

  assert.equal(
    buildKoperasiPayrollAmountMaps(
      '2026-07',
      [employee],
      [julyLoan, augustLoan],
      [],
    ).deductions['employee-1'],
    325_000,
  );
  assert.equal(
    buildKoperasiPayrollAmountMaps(
      '2026-08',
      [employee],
      [julyLoan, augustLoan],
      [],
    ).deductions['employee-1'],
    425_000,
  );
});

test('Koperasi savings and fallback names map to the payroll employee', () => {
  const result = buildKoperasiPayrollAmountMaps(
    '2026-07',
    [{ id: 'employee-1', personal_info: { name: 'Siti Rofi\'ah, A. Md.' } }],
    [
      {
        id: 'loan-1',
        userId: 'borrower-1',
        userData: { namaLengkap: 'Siti Rofiah' },
        status: 'Disetujui dan Aktif',
        jumlahPinjaman: 1_200_000,
        tenor: 12,
        jumlahMenyicil: 0,
        sisaHutang: 1_200_000,
      },
    ],
    [{ id: 'member-1', nama: 'Siti Rofiah', status: 'approved', paymentStatus: 'Payroll Deduction' }],
  );

  assert.equal(result.deductions['employee-1'], 100_000);
  assert.equal(result.savings['employee-1'], 25_000);
});

test('original installment remains payable while restructuring is pending approval', () => {
  const employee = {
    id: 'Loyalis_070',
    personal_info: { name: 'Khamim Mansyur,S.AB' },
    koperasiAuthUid: '8k7erklRjiaJzXIJ4RJjfn38O9k1',
  };
  const originalLoan = {
    id: 'lxZoVJ1IIDfPJGembkSb',
    userId: '8k7erklRjiaJzXIJ4RJjfn38O9k1',
    userData: { namaLengkap: 'Khamim Mansyur' },
    status: 'Menunggu Persetujuan Restrukturisasi',
    jumlahPinjaman: 2_000_000,
    tenor: 10,
    jumlahMenyicil: 8,
    sisaHutang: 400_000,
    tanggalDisetujui: timestamp('2025-11-08T00:00:00+07:00'),
    history: [
      { status: 'Disetujui dan Aktif', timestamp: timestamp('2025-11-10T00:00:00+07:00') },
      { status: 'Pembayaran Cicilan', timestamp: timestamp('2026-07-07T00:00:00+07:00') },
      { status: 'Menunggu Persetujuan Restrukturisasi', timestamp: timestamp('2026-08-03T00:00:00+07:00') },
    ],
  };
  const pendingReplacement = {
    id: 'F9Q2sLi7czDl2wfqGfB6',
    userId: '8k7erklRjiaJzXIJ4RJjfn38O9k1',
    userData: { namaLengkap: 'Khamim Mansyur' },
    status: 'Menunggu Persetujuan Wakil Rektor 2',
    jumlahPinjaman: 4_800_000,
    tenor: 12,
    jumlahMenyicil: 0,
    sisaHutang: 4_800_000,
    tanggalDisetujui: timestamp('2026-08-03T00:00:00+07:00'),
    history: [
      { status: 'Menunggu Persetujuan Wakil Rektor 2', timestamp: timestamp('2026-08-03T00:00:00+07:00') },
    ],
  };

  const result = buildKoperasiPayrollAmountMaps(
    '2026-08',
    [employee],
    [originalLoan, pendingReplacement],
    [],
  );

  assert.equal(result.deductions['Loyalis_070'], 200_000);
});

test('a Pekarya record converted to Loyalis never matches a loan or membership', () => {
  const converted = {
    id: 'BC_012',
    name: 'Ahmad Fauzi',
    koperasiAuthUid: 'kop-uid-1',
    conversion: { toEmployeeId: 'Loyalis_046', effectivePeriod: '2026-10' },
  };
  const loyalis = {
    id: 'Loyalis_046',
    personal_info: { name: 'Ahmad Fauzi' },
    koperasiAuthUid: 'kop-uid-1',
  };
  const loan = {
    id: 'loan-1',
    userId: 'kop-uid-1',
    userData: { namaLengkap: 'Ahmad Fauzi' },
    status: 'Disetujui dan Aktif',
    jumlahPinjaman: 1_200_000,
    tenor: 12,
    jumlahMenyicil: 1,
    sisaHutang: 1_100_000,
    tanggalDisetujui: timestamp('2026-08-03T00:00:00+07:00'),
    history: [
      { status: 'Disetujui dan Aktif', timestamp: timestamp('2026-08-03T00:00:00+07:00') },
    ],
  };
  const member = { id: 'kop-user-1', uid: 'kop-uid-1', nama: 'Ahmad Fauzi', status: 'approved', paymentStatus: 'Payroll Deduction' };

  const result = buildKoperasiPayrollAmountMaps('2026-10', [converted, loyalis], [loan], [member]);
  assert.equal(result.deductions['BC_012'], undefined);
  assert.equal(result.deductions['Loyalis_046'], 100_000);
  assert.equal(result.savings['BC_012'], undefined);
  assert.equal(result.savings['Loyalis_046'], 25_000);

  // Without a Koperasi uid the name fallback must not pick the old record either.
  const byName = buildKoperasiPayrollAmountMaps(
    '2026-10',
    [
      { ...converted, koperasiAuthUid: null },
      { ...loyalis, koperasiAuthUid: null },
    ],
    [{ ...loan, userId: 'unlinked' }],
    [],
  );
  assert.deepEqual(Object.keys(byName.deductions), ['Loyalis_046']);
});
