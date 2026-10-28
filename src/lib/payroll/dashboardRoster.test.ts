import assert from 'node:assert/strict';
import test from 'node:test';
import { resolveDashboardPeriodRoster, type DashboardRosterEmployee } from './dashboardRoster';
import { buildDashboardSlipData, sumSlipFields } from './dashboardSlipData';

const active: DashboardRosterEmployee = { id: 'Loyalis_active', personal_info: { status: 'AKTIF' } };
const departed: DashboardRosterEmployee = { id: 'Loyalis_departed', personal_info: { status: 'KELUAR' } };
const saved = { status: 'locked', earnings: [{ label: 'Gaji Pokok', amount: 1_000_000 }], deductions: [] };
const base = { period: '2026_06', loyalisEmployees: [active, departed], blueEmployees: [], slips: {} };

test('a closed legacy period counts saved slips for departed staff, without adding later hires', () => {
  const roster = resolveDashboardPeriodRoster({ ...base, periodData: { attendanceStatus: 'closed' },
    slips: { Loyalis_departed: saved } });
  assert.equal(roster.source, 'saved_slips');
  assert.deepEqual(roster.members.map(m => m.employee.id), ['Loyalis_departed']);
  assert.deepEqual(roster.issues, []);
});

test('a sealed roster takes precedence over current activity and extraneous saved drafts', () => {
  const roster = resolveDashboardPeriodRoster({ ...base,
    periodData: { attendanceStatus: 'closed', payrollRosterSeal: { employeeIds: ['Loyalis_departed', 'Loyalis_departed'] } },
    slips: { Loyalis_departed: saved, Loyalis_active: { ...saved, status: 'draft' } } });
  assert.equal(roster.source, 'sealed_roster');
  assert.deepEqual(roster.members.map(m => m.employee.id), ['Loyalis_departed']);
});

test('a closed roster with a missing slip surfaces an issue instead of rebuilding old salaries', () => {
  const roster = resolveDashboardPeriodRoster({ ...base,
    periodData: { attendanceStatus: 'closed', payrollRosterSeal: { employeeIds: ['Loyalis_departed'] } } });
  assert.equal(roster.members.length, 0);
  assert.equal(roster.issues.length, 1);
});

test('saved legacy drafts count in closed periods but invalid slip statuses do not', () => {
  const roster = resolveDashboardPeriodRoster({ ...base, periodData: { attendanceStatus: 'closed' },
    slips: { Loyalis_departed: { ...saved, status: 'draft' }, Loyalis_active: { ...saved, status: 'pending' } } });
  assert.deepEqual(roster.members.map(m => m.employee.id), ['Loyalis_departed']);
});

test('open payroll uses eligible staff and preserves finalized slips after deactivation', () => {
  const roster = resolveDashboardPeriodRoster({ ...base, slips: { Loyalis_departed: saved } });
  assert.equal(roster.source, 'live_roster');
  assert.deepEqual(roster.members.map(m => m.employee.id), ['Loyalis_active', 'Loyalis_departed']);
  const withoutFinal = resolveDashboardPeriodRoster({ ...base, slips: { Loyalis_departed: { ...saved, status: 'draft' } } });
  assert.deepEqual(withoutFinal.members.map(m => m.employee.id), ['Loyalis_active']);
});

test('closed saved payroll survives a missing master profile', () => {
  const roster = resolveDashboardPeriodRoster({ ...base, loyalisEmployees: [],
    periodData: { attendanceStatus: 'closed' }, slips: { Loyalis_departed: saved } });
  assert.equal(roster.members[0].collar, 'loyalis');
  assert.equal(roster.members[0].slip, saved);
});

test('conversion boundaries apply to open payroll; closed payroll uses the saved old identity', () => {
  const blue: DashboardRosterEmployee = { id: 'BC_old', employment: { status: 'inactive' }, flags: { isActive: false },
    conversion: { toEmployeeId: 'Loyalis_new', effectivePeriod: '2026-10' } };
  const loyalis: DashboardRosterEmployee = { id: 'Loyalis_new', personal_info: { status: 'AKTIF' },
    conversion: { fromEmployeeId: 'BC_old', effectivePeriod: '2026-10' } };
  const roster = resolveDashboardPeriodRoster({ ...base, period: '2026_09', blueEmployees: [blue], loyalisEmployees: [loyalis],
    periodData: { attendanceStatus: 'closed' }, slips: { BC_old: saved } });
  assert.deepEqual(roster.members.map(m => [m.employee.id, m.collar]), [['BC_old', 'pekarya']]);
  assert.equal(resolveDashboardPeriodRoster({ ...base, period: '2026_09', blueEmployees: [blue], loyalisEmployees: [loyalis] }).members.length, 0);
});

test('a historical Pekarya category is resolved for the selected payroll month', () => {
  const blue: DashboardRosterEmployee = { id: 'BC_old', employment: { status: 'active', jobCategory: 'KEBERSIHAN',
    jobCategoryHistory: [{ category: 'SATPAM', effectiveFrom: '2026-01-01' }, { category: 'KEBERSIHAN', effectiveFrom: '2026-10-01' }] } };
  const roster = resolveDashboardPeriodRoster({ ...base, period: '2026_09', blueEmployees: [blue], loyalisEmployees: [],
    periodData: { attendanceStatus: 'closed' }, slips: { BC_old: saved } });
  assert.equal(roster.members[0].employee.employment?.jobCategory, 'SATPAM');
  assert.equal(blue.employment?.jobCategory, 'KEBERSIHAN');
});

test('closed saved drafts retain historical family allowance rather than today\'s dependents', () => {
  const data = buildDashboardSlipData({ family_allowance_metrics: { spouse_count: 0 } }, 'loyalis',
    { ...saved, status: 'draft', earnings: [...saved.earnings, { label: 'T. Keluarga', amount: 50_000 }] }, {
      targetDate: new Date(2026, 5, 1), isClosed: true, salaryMatrix: {}, uraianMap: {}, vakasiTambahanMap: {},
      vakasiTambahanListMap: {}, functionalAllowanceMap: {}, kepangkatanAllowanceMap: {}, koperasiDeductions: {},
      koperasiSavings: {}, loyalisPresenceData: null,
    });
  assert.equal(sumSlipFields(data.earnings), 1_050_000);
});
