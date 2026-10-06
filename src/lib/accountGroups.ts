/**
 * Which login accounts belong to the same person, so they can switch between
 * the roles of those accounts without logging out ("Ganti Peran").
 *
 * One person often holds several accounts, one per role (e.g. a Kepala SatKer
 * Pekarya account, a Kepala SatKer Loyalis account and their own Karyawan
 * Loyalis account). Each account names the employee it belongs to in
 * `personEmployeeId`: Super Admin sets it on the Users page, and for honorer,
 * loyalis and ketua shift accounts it is always their `linkedEmployeeId`.
 * Accounts naming the same employee are one person.
 *
 * A name never links accounts: two people can share one, and one person's name
 * can be written two ways. Never linked, in either direction: Super Admin
 * accounts, disabled accounts, and accounts that name no employee.
 *
 * A Pekarya converted to Loyalis gets a new employee id. `successors` maps the
 * closed `BC_NNN` record to the `Loyalis_NNN` the person moved to, so accounts
 * that still name the old record stay with the person.
 *
 * Firebase-free so it can be unit-tested. The server re-runs it before every
 * switch (`@/lib/server/linkedAccounts`), so a stale list in the browser can
 * only lead to a refused switch, never to someone else's account.
 */
import { normalizeUserRole, USER_ROLES, type UserRole } from './payroll/roles';

/** What the browser is told about one of the person's other accounts. */
export interface LinkedAccountSummary {
  uid: string;
  email: string;
  displayName: string;
  role: UserRole;
  permittedCategories: string[];
}

/** A `users` document reduced to what grouping needs. */
export interface GroupableAccount {
  uid: string;
  email?: unknown;
  role?: unknown;
  disabled?: unknown;
  personEmployeeId?: unknown;
}

/** A closed employee id → the id the same person continues under. */
export type EmployeeSuccessors = ReadonlyMap<string, string>;

export type EmployeeCollectionName =
  | 'Employees_BlueCollar'
  | 'Employees_Loyalis'
  | 'Employees_WhiteCollar';

const EMPLOYEE_ID_PATTERN = /^[A-Za-z0-9_-]{1,100}$/;

/** A trimmed employee id that is safe to use as a document id, or null. */
export function normalizeEmployeeId(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const id = value.trim();
  return EMPLOYEE_ID_PATTERN.test(id) ? id : null;
}

/**
 * The collection an employee id lives in, read from its prefix the way
 * `getEmployeeById` does: `Loyalis_…`, `WC_…`, and everything else (`BC_…`) is
 * a Pekarya record. Null for something that cannot be a document id.
 */
export function employeeCollectionForId(value: unknown): EmployeeCollectionName | null {
  const id = normalizeEmployeeId(value);
  if (!id) return null;
  if (id.startsWith('Loyalis_')) return 'Employees_Loyalis';
  if (id.startsWith('WC_')) return 'Employees_WhiteCollar';
  return 'Employees_BlueCollar';
}

const MAX_SUCCESSOR_HOPS = 5;

/** The employee id the person is known by today: `id`, or where it moved to. */
export function resolvePersonEmployeeId(
  value: unknown,
  successors: EmployeeSuccessors = new Map(),
): string | null {
  let id = normalizeEmployeeId(value);
  for (let hop = 0; id && hop < MAX_SUCCESSOR_HOPS; hop += 1) {
    const next = normalizeEmployeeId(successors.get(id));
    if (!next || next === id) break;
    id = next;
  }
  return id;
}

export function isGroupableAccount(account: GroupableAccount): boolean {
  const role = normalizeUserRole(account.role);
  return (
    !!role &&
    role !== 'super_admin' &&
    account.disabled !== true &&
    normalizeEmployeeId(account.personEmployeeId) !== null
  );
}

/** The person an account belongs to, or null when it never links. */
export function accountPersonKey(
  account: GroupableAccount,
  successors: EmployeeSuccessors = new Map(),
): string | null {
  return isGroupableAccount(account)
    ? resolvePersonEmployeeId(account.personEmployeeId, successors)
    : null;
}

function roleOrder(role: unknown): number {
  const normalized = normalizeUserRole(role);
  return normalized ? USER_ROLES.indexOf(normalized) : USER_ROLES.length;
}

function compareAccounts(left: GroupableAccount, right: GroupableAccount): number {
  return (
    roleOrder(left.role) - roleOrder(right.role) ||
    String(left.email ?? '').localeCompare(String(right.email ?? '')) ||
    left.uid.localeCompare(right.uid)
  );
}

/**
 * The person's other accounts, in role order. Empty when `self` does not link
 * (Super Admin, disabled, or no employee).
 */
export function findLinkedAccounts<T extends GroupableAccount>(
  self: GroupableAccount,
  accounts: readonly T[],
  successors: EmployeeSuccessors = new Map(),
): T[] {
  const key = accountPersonKey(self, successors);
  if (!key) return [];
  return accounts
    .filter(
      (account) =>
        account.uid !== self.uid && accountPersonKey(account, successors) === key,
    )
    .sort(compareAccounts);
}

/**
 * For every account with at least one linked account, those other accounts,
 * keyed by uid. The Users page shows it on each row, so Super Admin can see who
 * may switch into what before anyone does.
 */
export function linkedAccountsByUid<T extends GroupableAccount>(
  accounts: readonly T[],
  successors: EmployeeSuccessors = new Map(),
): Map<string, T[]> {
  const groups = new Map<string, T[]>();
  for (const account of accounts) {
    const key = accountPersonKey(account, successors);
    if (!key) continue;
    const group = groups.get(key);
    if (group) group.push(account);
    else groups.set(key, [account]);
  }

  const result = new Map<string, T[]>();
  for (const group of groups.values()) {
    if (group.length < 2) continue;
    const sorted = [...group].sort(compareAccounts);
    for (const account of sorted) {
      result.set(
        account.uid,
        sorted.filter((other) => other.uid !== account.uid),
      );
    }
  }
  return result;
}
