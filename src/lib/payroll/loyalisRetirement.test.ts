import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildLoyalisRetirementReview, isLoyalisBirthMonth, type LoyalisRetirementEmployee } from './loyalisRetirement';

const today = '2026-11-01';

function employee(id: string, type: LoyalisRetirementEmployee['type'], nik: unknown, active = true): LoyalisRetirementEmployee {
  return { id, name: id, type, nik, active };
}

test('Admin retires at 59 and Dosen at 65, with all employees in the earliest month', () => {
  const employees = [
    employee('Admin A', 'Admin', '0000013011670001'),
    employee('Dosen B', 'Dosen', '0000017011610002'),
    employee('Dosen berikutnya', 'Dosen', '0000010112610003'),
    employee('Keluarga', 'Keluarga', '0000010111600004'),
    employee('Nonaktif', 'Admin', '0000010111600005', false),
  ];

  const review = buildLoyalisRetirementReview(employees, [], today);
  assert.equal(review.nextMonth, '2026-11');
  assert.deepEqual(review.upcoming.map(entry => entry.name), ['Admin A', 'Dosen B']);
  assert.ok(review.upcoming.every(entry => entry.estimated && entry.retirementMonth === '2026-11'));
  assert.deepEqual(review.overdue, []);
  assert.deepEqual(review.incomplete, []);

  const december = buildLoyalisRetirementReview(employees, [], '2026-12-01');
  assert.equal(december.nextMonth, '2026-12');
  assert.deepEqual(december.overdue.map(entry => entry.name), ['Admin A', 'Dosen B']);
});

test('validates the date encoded in a NIK and resolves the century using the adult age range', () => {
  const review = buildLoyalisRetirementReview([
    employee('Leap day', 'Admin', '0000016902000001'),
    employee('Invalid month', 'Admin', '0000010113670001'),
    employee('Invalid leap day', 'Admin', '0000012902010001'),
    employee('Invalid day offset', 'Dosen', '0000017211670001'),
    employee('Unclear century', 'Dosen', '0000010101200001'),
    employee('Missing NIK', 'Admin', undefined),
    employee('Missing type', '', '0000010111670001'),
  ], [], today);

  assert.equal(review.nextMonth, '2059-02');
  assert.equal(review.upcoming[0].birthMonth, '2000-02');
  assert.deepEqual(review.incomplete.map(({ name, reason }) => [name, reason]), [
    ['Invalid day offset', 'birthMonth'],
    ['Invalid leap day', 'birthMonth'],
    ['Invalid month', 'birthMonth'],
    ['Missing NIK', 'birthMonth'],
    ['Missing type', 'type'],
    ['Unclear century', 'birthMonth'],
  ]);
});

test('a confirmed birth month replaces an estimate and supplies missing dates', () => {
  const review = buildLoyalisRetirementReview([
    employee('Admin', 'Admin', '0000010111670001'),
    employee('Dosen', 'Dosen', null),
  ], [
    { employeeId: 'Admin', birthMonth: '1967-12' },
    { employeeId: 'Dosen', birthMonth: '1960-01' },
  ], today);
  assert.equal(review.nextMonth, '2026-12');
  assert.equal(review.upcoming[0].estimated, false);
  assert.equal(review.overdue[0].retirementMonth, '2025-01');
  assert.equal(review.overdue[0].estimated, false);
  assert.deepEqual(review.incomplete, []);
  assert.equal(isLoyalisBirthMonth('2026-12', today), false);
  assert.equal(isLoyalisBirthMonth('1967-1', today), false);
  assert.equal(isLoyalisBirthMonth('1967-12', today), true);
});
