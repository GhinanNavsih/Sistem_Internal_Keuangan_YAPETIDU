import assert from 'node:assert/strict';
import test from 'node:test';
import { buildKoperasiPayrollAmountMaps } from './koperasiAmounts';

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
    [{ id: 'member-1', nama: 'Siti Rofiah', status: 'approved' }],
  );

  assert.equal(result.deductions['employee-1'], 100_000);
  assert.equal(result.savings['employee-1'], 25_000);
});
