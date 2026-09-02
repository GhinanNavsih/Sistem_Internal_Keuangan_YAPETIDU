import assert from 'node:assert/strict';
import test from 'node:test';
import { getRekapColumns } from '@/utils/rekapConfig';
import {
  getSatpamTunjanganJabatan,
  isSatpamLegacyBonusColumn,
  mergeSatpamLegacyBonusIntoTunjangan,
  normalizeSatpamUraianEntry,
} from './satpamCompensation';

const entry = (values: Record<string, number>, counts?: Record<string, number>) => ({
  employeeId: 'BC_001',
  name: 'Satpam',
  values,
  ...(counts ? { counts } : {}),
});

test('Satpam Tunjangan Jabatan includes the universal allowance and Ketua role allowance', () => {
  assert.equal(getSatpamTunjanganJabatan(false), 50_000);
  assert.equal(getSatpamTunjanganJabatan(true), 150_000);
});

test('SATPAM rekap no longer exposes Bonus Presensi Mutlak', () => {
  const columns = getRekapColumns('SATPAM');
  assert.equal(
    columns.some((column) => column.key === 'bonusMutlak'),
    false,
  );
  assert.equal(
    columns.some((column) => column.key === 'tunjanganJabatan'),
    true,
  );
  assert.equal(
    isSatpamLegacyBonusColumn({
      key: 'bonusMutlak',
      label: 'Bonus Presensi Mutlak',
      slipLabel: 'Bonus Presensi Mutlak',
    }),
    true,
  );
});

test('a legacy regular Satpam bonus moves into Tunjangan Jabatan', () => {
  const normalized = normalizeSatpamUraianEntry(
    entry({ tunjanganJabatan: 0, bonusMutlak: 50_000 }, { bonusMutlak: 1 }),
    false,
  );

  assert.equal(normalized.values.tunjanganJabatan, 50_000);
  assert.equal('bonusMutlak' in normalized.values, false);
  assert.equal(normalized.counts, undefined);
});

test('a legacy Ketua allowance keeps the role amount and adds the universal amount', () => {
  const normalized = normalizeSatpamUraianEntry(
    entry({ tunjanganJabatan: 100_000, bonusMutlak: 50_000 }),
    true,
  );

  assert.equal(normalized.values.tunjanganJabatan, 150_000);
  assert.equal('bonusMutlak' in normalized.values, false);
});

test('new Satpam rows receive the minimum allowance even without a legacy field', () => {
  assert.equal(
    normalizeSatpamUraianEntry(entry({}), false).values.tunjanganJabatan,
    50_000,
  );
  assert.equal(
    normalizeSatpamUraianEntry(entry({}), true).values.tunjanganJabatan,
    150_000,
  );
  assert.equal(
    normalizeSatpamUraianEntry(entry({ tunjanganJabatan: 200_000 }), false)
      .values.tunjanganJabatan,
    200_000,
  );
});

test('old generated Satpam slips display one consolidated allowance row', () => {
  const earnings = mergeSatpamLegacyBonusIntoTunjangan([
    { label: 'Gaji Pokok', amount: 1_000_000 },
    { label: 'Tunjangan Jabatan', amount: 100_000 },
    { label: 'Bonus Presensi Mutlak', amount: 50_000 },
  ]);

  assert.deepEqual(earnings, [
    { label: 'Gaji Pokok', amount: 1_000_000 },
    { label: 'Tunjangan Jabatan', amount: 150_000 },
  ]);
});
