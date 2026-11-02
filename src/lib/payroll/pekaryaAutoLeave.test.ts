import assert from 'node:assert/strict';
import test from 'node:test';
import { pekaryaAutoLeaveCandidates, applyAutomaticPekaryaLeave, type AutoLeaveScheduledDuty } from './pekaryaAutoLeave';
import { planAutoAbsenceLeave } from './autoAbsenceLeave';
import { type AttendanceNormalizedRow, consolidateAttendanceDays } from './attendance';
import { PEKARYA_JOB_CATEGORIES } from './pekaryaSpj';
import { buildSatpamAttendanceDetail } from './satpamAttendanceDetail';

const row = (date: string, overrides: Partial<AttendanceNormalizedRow> = {}): AttendanceNormalizedRow => ({
  rowNumber: 1, nipy: 'N1', identifierSource: 'NIPY', sourcePin: null, sourceNipy: 'N1', name: 'Pegawai', department: 'CS',
  date, workStatus: 'TIDAK HADIR', scanIn: null, scanOut: null, issues: [], ...overrides,
});
const duty = (date: string, shiftName: AutoLeaveScheduledDuty['shiftName']): AutoLeaveScheduledDuty => ({
  dutyDate: date, shiftName, planId: 'plan', planRevision: 1, teamId: 'team_1',
});
function candidates(overrides: Partial<Parameters<typeof pekaryaAutoLeaveCandidates>[0]> = {}) {
  const rows = overrides.rows || [row('2026-10-01')];
  return pekaryaAutoLeaveCandidates({ period: '2026-10', category: 'KEBERSIHAN', nipy: 'N1', identityValid: true,
    importAvailable: true, rows, days: consolidateAttendanceDays(rows), premiumDates: new Set(), blockedDates: new Set(),
    workDates: new Set(), schedules: [], now: new Date('2026-11-02T00:00:00+07:00'), ...overrides });
}

for (const category of PEKARYA_JOB_CATEGORIES.filter((category) => category !== 'SATPAM')) {
  test(`${category}: only completed, represented working absences qualify`, () => {
    const result = candidates({ category, rows: [row('2026-10-01'), row('2026-10-02'), row('2026-10-03')], premiumDates: new Set(['2026-10-03']) });
    assert.deepEqual(result.dates, ['2026-10-01']);
    assert.ok(result.held.some((item) => item.date === '2026-10-04'));
    assert.deepEqual(candidates({ category, now: new Date('2026-10-01T13:59:59+07:00') }).dates, []);
  });
}
test('missing data, ambiguous identities, invalid rows and pending submissions never spend leave', () => {
  for (const input of [{ rows: [] }, { identityValid: false }, { importAvailable: false },
    { rows: [row('2026-10-01', { issues: ['TIME_INVALID'] })] }, { blockedDates: new Set(['2026-10-01']) }]) {
    const result = candidates(input);
    assert.deepEqual(result.dates, []);
    assert.ok(result.held.length);
  }
});
test('a partial punch, corrected presence, or journey credit prevents automatic cuti', () => {
  assert.deepEqual(candidates({ rows: [row('2026-10-01', { scanIn: '08:00:00' })] }).dates, []);
  const days = consolidateAttendanceDays([row('2026-10-01')]);
  assert.deepEqual(candidates({ days: [{ ...days[0], present: true, journeyCredit: { scanIn: true, scanOut: false, journeyIds: ['J1'] } }] }).dates, []);
});
for (const shiftName of ['Pagi', 'Sore', 'Malam'] as const) {
  test(`SATPAM ${shiftName}: uses the published scheduled bounds and waits for full evidence`, () => {
    const rows = [row('2026-10-01'), row('2026-10-02')];
    const result = candidates({ category: 'SATPAM', rows, schedules: [duty('2026-10-01', shiftName)] });
    assert.deepEqual(result.dates, ['2026-10-01']);
    const shift = result.shifts.get('2026-10-01')!;
    assert.equal(shift.startsAtIso.slice(11, 16), { Pagi: '07:00', Sore: '15:00', Malam: '23:00' }[shiftName]);
    assert.equal(shift.endsAtIso.slice(11, 16), { Pagi: '15:00', Sore: '23:00', Malam: '07:00' }[shiftName]);
    assert.deepEqual(candidates({ category: 'SATPAM', rows, schedules: [duty('2026-10-01', shiftName)], workDates: new Set(['2026-10-01']) }).dates, []);
  });
}
test('night at month end waits for the following morning, and any next-day punch prevents deduction', () => {
  const input = { category: 'SATPAM', schedules: [duty('2026-10-31', 'Malam')] };
  assert.deepEqual(candidates({ ...input, rows: [row('2026-10-31')] }).dates, []);
  assert.deepEqual(candidates({ ...input, rows: [row('2026-10-31'), row('2026-11-01')] }).dates, ['2026-10-31']);
  assert.deepEqual(candidates({ ...input, rows: [row('2026-10-31'), row('2026-11-01', { scanOut: '07:00:00' })] }).dates, []);
  assert.deepEqual(candidates({ ...input, rows: [row('2026-10-31'), row('2026-11-01')], now: new Date('2026-11-01T06:59:59+07:00') }).dates, []);
});
test('Satpam duplicates and unpublished/no schedule are held, including on premium days', () => {
  assert.ok(candidates({ category: 'SATPAM' }).held.length);
  assert.deepEqual(candidates({ category: 'SATPAM', schedules: [duty('2026-10-01', 'Pagi'), duty('2026-10-01', 'Sore')] }).dates, []);
  assert.deepEqual(candidates({ category: 'SATPAM', rows: [row('2026-10-02')], schedules: [duty('2026-10-02', 'Pagi')] }).dates, ['2026-10-02']);
});
test('the shared allocator respects date entitlement, reservations and manual usage; replays and refunds are deterministic', () => {
  const input = { period: '2026-10', serviceDate: '2018-01-01', absentDates: ['2026-10-03', '2026-10-01', '2026-10-02'],
    blockedDates: new Set<string>(), existingAutoDates: new Set<string>(), balance: { usedDays: 0, reservedDays: 1, manualUsedDays: 1 } };
  const first = planAutoAbsenceLeave(input);
  assert.deepEqual(first.cover, ['2026-10-01']);
  assert.equal(first.uncovered.length, 2);
  assert.deepEqual(planAutoAbsenceLeave({ ...input, balance: { ...input.balance, usedDays: 1 }, existingAutoDates: new Set(first.cover) }).keep, first.cover);
  assert.deepEqual(planAutoAbsenceLeave({ ...input, absentDates: [], balance: { ...input.balance, usedDays: 1 }, existingAutoDates: new Set(first.cover) }).release, first.cover);
});
test('regular credit overlays evidence and is never treated as an actual punch', () => {
  const raw = consolidateAttendanceDays([row('2026-10-01')]);
  const effective = applyAutomaticPekaryaLeave(raw, [{ annualPaidLeaveRequestId: 'R1', employeeId: 'E1', leaveDate: '2026-10-01', category: 'TEKNISI', source: 'auto_absence', status: 'posted' }], new Map([['E1', 'N1']]));
  assert.equal(raw[0].present, false);
  assert.equal(effective[0].scanIn, '07:30:00');
  assert.equal(effective[0].scanOut, '14:00:00');
  assert.equal(effective[0].annualPaidLeaveCredit?.automatic, true);
});
test('Satpam auto credit displays the whole scheduled night, correct premium wage, and yields to approved work', () => {
  const shift = candidates({ category: 'SATPAM', rows: [row('2026-10-02'), row('2026-10-03')], schedules: [duty('2026-10-02', 'Malam')] }).shifts.get('2026-10-02')!;
  const input = { employee: { employeeId: 'E1', name: 'Satpam', nipy: 'N1' }, planDays: [], reports: [], coverReports: [],
    absences: [{ id: 'R1', dutyDate: '2026-10-02', shiftName: 'Malam', status: 'approved', reportType: 'izin_resmi' as const,
      payable: true, approvedPayType: 'Jumat & Libur', approvedAmount: 25_000, leaveKind: 'annual_leave' as const, automatic: true, scheduledShift: shift }],
    scanDays: new Map(), premiumDates: new Set<string>(), preserveRecordedPayment: false, employeeNames: new Map<string, string>(), now: new Date('2026-11-02') };
  const result = buildSatpamAttendanceDetail(input);
  assert.equal(result.days[0].scanIn, '23:00');
  assert.equal(result.days[0].scanOutDate, '2026-10-03');
  assert.equal(result.totalAmount, 25_000);
  const work = buildSatpamAttendanceDetail({ ...input, reports: [{ id: 'W1', employeeId: 'E1', dutyDate: '2026-10-02', shiftName: 'Malam', shiftType: 'Jumat & Libur', status: 'approved', fee: 25_000, coveredEmployeeId: null }] });
  assert.equal(work.totalAmount, 25_000);
  assert.equal(work.days[0].automaticAnnualLeave, undefined);
});
