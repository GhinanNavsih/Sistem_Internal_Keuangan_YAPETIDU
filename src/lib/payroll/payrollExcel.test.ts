import test from 'node:test';
import assert from 'node:assert/strict';
import { itemizePekaryaVakasiForExport, type PayrollVakasiSpjEvent } from './payrollExcel';
import { VAKASI_PEKARYA_PROJECTION_SOURCE_KIND } from './vakasiTambahan';

const earnings = [
  { label: 'Gaji Pokok', amount: 500_000 },
  { label: 'SPJ', amount: 300_000 },
  { label: 'Tunjangan Beras', amount: 60_000 },
];
const event = (overrides: Partial<PayrollVakasiSpjEvent> = {}): PayrollVakasiSpjEvent => ({
  id: 'event_1',
  sourceKind: VAKASI_PEKARYA_PROJECTION_SOURCE_KIND,
  period: '2026-09',
  jobCategory: 'SATPAM',
  status: 'approved',
  eventName: 'Workshop',
  eventWorkers: { BC_001: { payGiven: 100_000 } },
  ...overrides,
});
const exportFor = (events: PayrollVakasiSpjEvent[], fields = earnings) =>
  itemizePekaryaVakasiForExport({
    employeeId: 'BC_001', jobCategory: 'SATPAM', period: '2026-09',
    earnings: fields, events,
  });
const sum = (fields: typeof earnings) => fields.reduce((total, field) => total + field.amount, 0);

test('Vakasi becomes named Excel columns without changing saved gross pay or other earnings', () => {
  const before = structuredClone(earnings);
  const result = exportFor([event(), event({ id: 'event_2', eventName: 'Koreksi Gaji', eventWorkers: { BC_001: { payGiven: 50_000 } } })]);
  assert.deepEqual(result, [
    { label: 'Gaji Pokok', amount: 500_000 },
    { label: 'SPJ', amount: 150_000 },
    { label: 'Tunjangan Beras', amount: 60_000 },
    { label: 'Vakasi: Koreksi Gaji', amount: 50_000 },
    { label: 'Vakasi: Workshop', amount: 100_000 },
  ]);
  assert.equal(sum(result), sum(earnings));
  assert.deepEqual(earnings, before);
});

test('duplicate event names aggregate and duplicate documents never double-count', () => {
  const first = event();
  const result = exportFor([first, first, event({ id: 'event_2' })]);
  assert.equal(result.find(field => field.label === 'SPJ')?.amount, 100_000);
  assert.equal(result.find(field => field.label === 'Vakasi: Workshop')?.amount, 200_000);
  assert.equal(sum(result), sum(earnings));
});

test('other employees, periods, categories, pending/declined events and ordinary SPJ are excluded', () => {
  assert.deepEqual(exportFor([
    event({ eventWorkers: { BC_002: { payGiven: 100_000 } } }),
    event({ id: 'other_period', period: '2026-08' }),
    event({ id: 'other_category', jobCategory: 'SOPIR' }),
    event({ id: 'pending', status: 'pending_review' }),
    event({ id: 'declined', status: 'declined' }),
    event({ id: 'ordinary', sourceKind: undefined }),
    event({ id: 'sandbox', sourceKind: 'proposal_lpj_report' }),
  ]), earnings);
});

test('event names that match salary labels remain separate and fully itemized SPJ becomes zero', () => {
  const result = exportFor([event({ eventName: 'Gaji Pokok', eventWorkers: { BC_001: { payGiven: 300_000 } } })]);
  assert.equal(result.find(field => field.label === 'Gaji Pokok')?.amount, 500_000);
  assert.equal(result.find(field => field.label === 'Vakasi: Gaji Pokok')?.amount, 300_000);
  assert.equal(result.find(field => field.label === 'SPJ')?.amount, 0);
  assert.equal(sum(result), sum(earnings));
});

test('invalid or zero payouts follow the canonical SPJ reader and do not add columns', () => {
  for (const amount of [0, -1, 0.5, NaN, Infinity]) {
    assert.deepEqual(exportFor([event({ eventWorkers: { BC_001: { payGiven: amount } } })]), earnings);
  }
});

test('legacy payable projections and multiple saved SPJ rows preserve their total', () => {
  const original = [...earnings, { label: ' spj ', amount: 50_000 }];
  const result = exportFor([event({ status: undefined })], original);
  assert.equal(result.find(field => field.label === 'SPJ')?.amount, 250_000);
  assert.equal(sum(result), sum(original));
});

test('stale or missing SPJ refuses export instead of increasing salary or inventing a negative remainder', () => {
  assert.throws(() => exportFor([event({ eventWorkers: { BC_001: { payGiven: 400_000 } } })]), /Rincian Vakasi melebihi SPJ/);
  assert.throws(() => exportFor([event()], [earnings[0]]), /Rincian Vakasi melebihi SPJ/);
});

test('an unnamed payable projection is surfaced rather than silently hidden in SPJ', () => {
  assert.throws(() => exportFor([event({ eventName: ' ' })]), /Nama kegiatan Vakasi belum tersedia/);
});
