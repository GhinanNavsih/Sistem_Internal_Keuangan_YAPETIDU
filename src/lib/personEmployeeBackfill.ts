/**
 * Which employee each existing login account belongs to, for filling in
 * `personEmployeeId` on accounts made before it existed (see
 * `@/lib/accountGroups`). Pure so it can be unit-tested; the reads and writes
 * are in `scripts/backfillPersonEmployeeId.ts`, which prints this plan and only
 * writes it with `--apply`.
 *
 * - honorer, loyalis and ketua shift accounts: their `linkedEmployeeId`, which
 *   is already checked against the employee record when the account is saved;
 * - any other role: the one active employee whose name matches the account's
 *   Nama Lengkap, ignoring titles, degrees, case, dots and apostrophes. No
 *   match, several matches or a one-word name is left for Super Admin to set by
 *   hand on the Users page, since a wrong guess would let one person into
 *   another person's account;
 * - Super Admin and disabled accounts, and accounts that already name an
 *   employee, are left alone. A second run therefore changes nothing.
 */
import { normalizeEmployeeId } from './accountGroups';
import { normalizeName } from './payroll/employeeNames';
import { isEmployeeLinkRole, normalizeUserRole } from './payroll/roles';

export interface BackfillAccount {
  uid: string;
  email?: unknown;
  displayName?: unknown;
  role?: unknown;
  disabled?: unknown;
  linkedEmployeeId?: unknown;
  personEmployeeId?: unknown;
}

export interface BackfillEmployee {
  employeeId: string;
  name: string;
  active: boolean;
}

interface AccountLabel {
  uid: string;
  email: string;
  displayName: string;
  role: string;
}

export interface BackfillAssignment extends AccountLabel {
  personEmployeeId: string;
  employeeName: string;
  source: 'linked_employee' | 'name_match';
}

export interface BackfillReview extends AccountLabel {
  reason:
    | 'linked_employee_missing'
    | 'name_too_short'
    | 'no_active_name_match'
    | 'several_active_name_matches';
  /** Employees with the same name (active or not), to help decide by hand. */
  candidates: { employeeId: string; name: string; active: boolean }[];
}

export interface BackfillSkip extends AccountLabel {
  reason: 'super_admin' | 'disabled' | 'already_linked' | 'unknown_role';
}

export interface BackfillPlan {
  assignments: BackfillAssignment[];
  needsReview: BackfillReview[];
  skipped: BackfillSkip[];
}

const MIN_NAME_WORDS = 2;

/**
 * The name key used to suggest an employee: `normalizeName` (titles and
 * degrees dropped, lowercase) with dots read as spaces and apostrophes dropped,
 * so "M. Ali" and "M Ali" or "Rofi'ah" and "Rofiah" agree. Null for a missing
 * or one-word name.
 */
export function personNameKey(name: unknown): string | null {
  if (typeof name !== 'string') return null;
  const key = normalizeName(name)
    .replace(/\./g, ' ')
    .replace(/['’`]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  if (!key || key.split(' ').length < MIN_NAME_WORDS) return null;
  return key;
}

function label(account: BackfillAccount): AccountLabel {
  return {
    uid: account.uid,
    email: typeof account.email === 'string' ? account.email : '',
    displayName: typeof account.displayName === 'string' ? account.displayName : '',
    role: typeof account.role === 'string' ? account.role : '',
  };
}

function byEmail(left: AccountLabel, right: AccountLabel): number {
  return left.email.localeCompare(right.email) || left.uid.localeCompare(right.uid);
}

export function planPersonEmployeeIdBackfill(
  accounts: readonly BackfillAccount[],
  employees: readonly BackfillEmployee[],
): BackfillPlan {
  const employeesById = new Map(employees.map((employee) => [employee.employeeId, employee]));
  const employeesByName = new Map<string, BackfillEmployee[]>();
  for (const employee of employees) {
    const key = personNameKey(employee.name);
    if (!key) continue;
    const group = employeesByName.get(key);
    if (group) group.push(employee);
    else employeesByName.set(key, [employee]);
  }

  const plan: BackfillPlan = { assignments: [], needsReview: [], skipped: [] };
  for (const account of accounts) {
    const who = label(account);
    const role = normalizeUserRole(account.role);
    if (!role) {
      plan.skipped.push({ ...who, reason: 'unknown_role' });
      continue;
    }
    if (role === 'super_admin') {
      plan.skipped.push({ ...who, reason: 'super_admin' });
      continue;
    }
    if (account.disabled === true) {
      plan.skipped.push({ ...who, reason: 'disabled' });
      continue;
    }
    if (normalizeEmployeeId(account.personEmployeeId)) {
      plan.skipped.push({ ...who, reason: 'already_linked' });
      continue;
    }

    if (isEmployeeLinkRole(role)) {
      const linkedId = normalizeEmployeeId(account.linkedEmployeeId);
      const employee = linkedId ? employeesById.get(linkedId) : undefined;
      if (linkedId && employee) {
        plan.assignments.push({
          ...who,
          personEmployeeId: linkedId,
          employeeName: employee.name,
          source: 'linked_employee',
        });
      } else {
        plan.needsReview.push({ ...who, reason: 'linked_employee_missing', candidates: [] });
      }
      continue;
    }

    const key = personNameKey(account.displayName);
    if (!key) {
      plan.needsReview.push({ ...who, reason: 'name_too_short', candidates: [] });
      continue;
    }
    const sameName = employeesByName.get(key) || [];
    const candidates = sameName.map(({ employeeId, name, active }) => ({ employeeId, name, active }));
    const active = sameName.filter((employee) => employee.active);
    if (active.length === 1) {
      plan.assignments.push({
        ...who,
        personEmployeeId: active[0].employeeId,
        employeeName: active[0].name,
        source: 'name_match',
      });
    } else {
      plan.needsReview.push({
        ...who,
        reason: active.length === 0 ? 'no_active_name_match' : 'several_active_name_matches',
        candidates,
      });
    }
  }

  plan.assignments.sort(byEmail);
  plan.needsReview.sort(byEmail);
  plan.skipped.sort(byEmail);
  return plan;
}
