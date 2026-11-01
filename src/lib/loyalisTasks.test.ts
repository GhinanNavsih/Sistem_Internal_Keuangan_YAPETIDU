import assert from 'node:assert/strict';
import test from 'node:test';
import {
  isLoyalisTaskOverdue,
  isLoyalisTaskPath,
  parseLoyalisTaskAssignee,
  planLoyalisTaskStatusChange,
  sortLoyalisTasks,
  summarizeLoyalisTasks,
  validateLoyalisTaskFields,
  type LoyalisTaskView,
} from './loyalisTasks';

const TODAY = '2026-11-01';

function task(overrides: Partial<LoyalisTaskView>): LoyalisTaskView {
  return {
    id: 't',
    assigneeEmployeeId: 'Loyalis_001',
    assigneeName: 'Loyalis A',
    title: 'Tugas',
    description: '',
    dueDate: null,
    status: 'open',
    createdAt: '2026-10-01T00:00:00.000Z',
    updatedAt: '2026-10-01T00:00:00.000Z',
    completedAt: null,
    ...overrides,
  };
}

test('a task needs a title; title and description are trimmed', () => {
  assert.throws(() => validateLoyalisTaskFields({ title: '   ' }, TODAY), /Judul tugas wajib diisi/);
  assert.throws(() => validateLoyalisTaskFields(null, TODAY), /Judul tugas wajib diisi/);
  assert.deepEqual(
    validateLoyalisTaskFields({ title: '  Susun laporan  ', description: ' Bulan Oktober ' }, TODAY),
    { title: 'Susun laporan', description: 'Bulan Oktober', dueDate: null },
  );
});

test('title and description have length limits', () => {
  assert.throws(() => validateLoyalisTaskFields({ title: 'x'.repeat(121) }, TODAY), /maksimal 120/);
  assert.throws(
    () => validateLoyalisTaskFields({ title: 'ok', description: 'x'.repeat(2001) }, TODAY),
    /maksimal 2000/,
  );
  assert.equal(validateLoyalisTaskFields({ title: 'x'.repeat(120) }, TODAY).title.length, 120);
});

test('a due date is optional, must be a real date, and cannot be in the past', () => {
  assert.equal(validateLoyalisTaskFields({ title: 'a', dueDate: '' }, TODAY).dueDate, null);
  assert.equal(validateLoyalisTaskFields({ title: 'a', dueDate: '2026-11-01' }, TODAY).dueDate, '2026-11-01');
  assert.throws(() => validateLoyalisTaskFields({ title: 'a', dueDate: '2026-10-31' }, TODAY), /sebelum hari ini/);
  assert.throws(() => validateLoyalisTaskFields({ title: 'a', dueDate: '2026-02-30' }, TODAY), /tidak valid/);
  assert.throws(() => validateLoyalisTaskFields({ title: 'a', dueDate: '01/11/2026' }, TODAY), /tidak valid/);
});

test('editing keeps an overdue task\'s own due date but rejects a different past one', () => {
  const edited = validateLoyalisTaskFields({ title: 'a', dueDate: '2026-10-20' }, TODAY, '2026-10-20');
  assert.equal(edited.dueDate, '2026-10-20');
  assert.throws(
    () => validateLoyalisTaskFields({ title: 'a', dueDate: '2026-10-21' }, TODAY, '2026-10-20'),
    /sebelum hari ini/,
  );
});

test('the assignee must be a plausible employee id', () => {
  assert.equal(parseLoyalisTaskAssignee({ assigneeEmployeeId: ' Loyalis_007 ' }), 'Loyalis_007');
  assert.throws(() => parseLoyalisTaskAssignee({}), /Pilih Loyalis/);
  assert.throws(() => parseLoyalisTaskAssignee({ assigneeEmployeeId: 'a/b' }), /tidak valid/);
});

test('a task moves between open and completed in both directions; same status is a no-op', () => {
  assert.deepEqual(planLoyalisTaskStatusChange('open', 'completed'), { changed: true, status: 'completed' });
  assert.deepEqual(planLoyalisTaskStatusChange('completed', 'open'), { changed: true, status: 'open' });
  assert.deepEqual(planLoyalisTaskStatusChange('completed', 'completed'), { changed: false, status: 'completed' });
  assert.throws(() => planLoyalisTaskStatusChange('open', 'done'), /Status tugas tidak valid/);
});

test('only an open task with a past due date is overdue', () => {
  assert.equal(isLoyalisTaskOverdue(task({ dueDate: '2026-10-31' }), TODAY), true);
  assert.equal(isLoyalisTaskOverdue(task({ dueDate: '2026-11-01' }), TODAY), false);
  assert.equal(isLoyalisTaskOverdue(task({ dueDate: null }), TODAY), false);
  assert.equal(isLoyalisTaskOverdue(task({ dueDate: '2026-10-01', status: 'completed' }), TODAY), false);
});

test('open tasks sort by due date, undated after, completed last', () => {
  const sorted = sortLoyalisTasks([
    task({ id: 'done-old', status: 'completed', completedAt: '2026-10-05T00:00:00.000Z' }),
    task({ id: 'undated-old', createdAt: '2026-10-01T00:00:00.000Z' }),
    task({ id: 'due-later', dueDate: '2026-12-01' }),
    task({ id: 'done-new', status: 'completed', completedAt: '2026-10-20T00:00:00.000Z' }),
    task({ id: 'undated-new', createdAt: '2026-10-15T00:00:00.000Z' }),
    task({ id: 'overdue', dueDate: '2026-10-10' }),
  ]).map((item) => item.id);
  assert.deepEqual(sorted, ['overdue', 'due-later', 'undated-new', 'undated-old', 'done-new', 'done-old']);
});

test('sorting does not change the list it was given', () => {
  const tasks = [task({ id: 'b', dueDate: '2026-12-01' }), task({ id: 'a', dueDate: '2026-11-05' })];
  sortLoyalisTasks(tasks);
  assert.deepEqual(tasks.map((item) => item.id), ['b', 'a']);
});

test('the page exists for a Loyalis with any task, completed or not', () => {
  assert.deepEqual(summarizeLoyalisTasks([]), { hasTasks: false, openCount: 0 });
  assert.deepEqual(summarizeLoyalisTasks([task({ status: 'completed' })]), { hasTasks: true, openCount: 0 });
  assert.deepEqual(
    summarizeLoyalisTasks([task({}), task({ status: 'completed' }), task({})]),
    { hasTasks: true, openCount: 2 },
  );
});

test('both task pages are recognised by path', () => {
  assert.equal(isLoyalisTaskPath('/employee/tugas'), true);
  assert.equal(isLoyalisTaskPath('/dashboard/tugas'), true);
  assert.equal(isLoyalisTaskPath('/employee/tugasku'), false);
  assert.equal(isLoyalisTaskPath('/employee/payslip'), false);
});
