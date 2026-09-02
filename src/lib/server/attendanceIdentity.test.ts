import assert from 'node:assert/strict';
import test from 'node:test';
import {
  AttendanceEmployeeIdentity,
  AttendanceIdentityIndex,
  isActiveBlueCollar,
  resolveIdentityByName,
} from './attendanceStore';
import { normalizeName } from '@/lib/payroll/employeeNames';

function indexOf(
  employees: Array<Partial<AttendanceEmployeeIdentity> & { name: string }>,
): AttendanceIdentityIndex {
  const identities = employees.map((employee, position) => ({
    employeeId: employee.employeeId || `BC_${position}`,
    employeeCollection: employee.employeeCollection || 'Employees_BlueCollar',
    name: employee.name,
    nipy: employee.nipy || `nipy-${position}`,
    active: employee.active ?? true,
    jobCategory: employee.jobCategory ?? 'KEBERSIHAN',
  })) as AttendanceEmployeeIdentity[];
  const byNipy = new Map<string, AttendanceEmployeeIdentity[]>();
  const byName = new Map<string, AttendanceEmployeeIdentity[]>();
  for (const identity of identities) {
    byNipy.set(identity.nipy, [...(byNipy.get(identity.nipy) || []), identity]);
    const key = normalizeName(identity.name);
    byName.set(key, [...(byName.get(key) || []), identity]);
  }
  return { identities, byNipy, byName };
}

test('a name recovers the employee when the file carries an unusable identifier', () => {
  const index = indexOf([
    { name: 'Eko Suprayitno', employeeId: 'BC_1' },
    { name: 'Nur Cahyadi', employeeId: 'BC_2' },
  ]);
  assert.equal(
    resolveIdentityByName(index, 'Eko Suprayitno', isActiveBlueCollar)?.employeeId,
    'BC_1',
  );
  // Degrees and titles in either direction still resolve.
  assert.equal(
    resolveIdentityByName(index, 'Eko Suprayitno, S.Kom', isActiveBlueCollar)
      ?.employeeId,
    'BC_1',
  );
});

test('the hand-kept override list resolves a known misspelling', () => {
  const index = indexOf([{ name: "Siti Rofi'ah, A. Md.", employeeId: 'BC_9' }]);
  assert.equal(
    resolveIdentityByName(index, 'Siti Rofiah', isActiveBlueCollar)?.employeeId,
    'BC_9',
  );
});

test('an ambiguous name is left unresolved rather than guessed at', () => {
  const index = indexOf([
    { name: 'Slamet Riadi', employeeId: 'BC_1' },
    { name: 'Slamet Raharjo', employeeId: 'BC_2' },
  ]);
  // "Slamet" is contained in both, so no single person is named.
  assert.equal(resolveIdentityByName(index, 'Slamet', isActiveBlueCollar), null);
});

test('inactive employees and other collections are never resolved onto', () => {
  const index = indexOf([
    { name: 'Budi Santoso', employeeId: 'BC_1', active: false },
    {
      name: 'Rina Wati',
      employeeId: 'LOY_1',
      employeeCollection: 'Employees_Loyalis',
    },
  ]);
  assert.equal(resolveIdentityByName(index, 'Budi Santoso', isActiveBlueCollar), null);
  assert.equal(resolveIdentityByName(index, 'Rina Wati', isActiveBlueCollar), null);
});

test('an unknown or empty name resolves to nobody', () => {
  const index = indexOf([{ name: 'Eko Suprayitno' }]);
  assert.equal(resolveIdentityByName(index, '', isActiveBlueCollar), null);
  assert.equal(
    resolveIdentityByName(index, 'Orang Tidak Dikenal', isActiveBlueCollar),
    null,
  );
});
