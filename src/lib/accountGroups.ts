/**
 * Which login accounts belong to the same person, so they can switch between
 * the roles of those accounts without logging out ("Ganti Peran").
 *
 * One person often holds several accounts, one per role (e.g. a Kepala SatKer
 * Pekarya account, a Kepala SatKer Loyalis account and their own Karyawan
 * Loyalis account). Nothing but the name ties them together: SatKer accounts
 * carry no `linkedEmployeeId`. So accounts are grouped by Nama Lengkap
 * (`displayName`) with titles and degrees ignored, under these limits:
 *   - a name of one word never links, since it is too likely to be shared;
 *   - Super Admin accounts never link, in either direction;
 *   - a disabled account never links;
 *   - Super Admin can set `accountGroupExcluded` on an account (two different
 *     people with the same name), which takes it out of every group.
 *
 * Firebase-free so it can be unit-tested. The server re-runs it before every
 * switch (`@/lib/server/linkedAccounts`), so a stale list in the browser can
 * only lead to a refused switch, never to someone else's account.
 */
import { normalizeName } from './payroll/employeeNames';
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
  displayName?: unknown;
  role?: unknown;
  disabled?: unknown;
  accountGroupExcluded?: unknown;
}

const MIN_NAME_WORDS = 2;

/**
 * The person a name points at: `normalizeName` (titles and degrees dropped,
 * lowercase) with dots read as spaces and apostrophes dropped, so "M. Ali" and
 * "M Ali" or "Rofi'ah" and "Rofiah" agree. Null when there is no usable name.
 */
export function personKey(displayName: unknown): string | null {
  if (typeof displayName !== 'string') return null;
  const key = normalizeName(displayName)
    .replace(/\./g, ' ')
    .replace(/['’`]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  if (!key || key.split(' ').length < MIN_NAME_WORDS) return null;
  return key;
}

export function isGroupableAccount(account: GroupableAccount): boolean {
  const role = normalizeUserRole(account.role);
  return (
    !!role &&
    role !== 'super_admin' &&
    account.disabled !== true &&
    account.accountGroupExcluded !== true &&
    personKey(account.displayName) !== null
  );
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
 * The person's other accounts: same name key, each groupable. Empty when `self`
 * is not groupable itself (Super Admin, disabled, opted out, one-word name).
 */
export function findLinkedAccounts<T extends GroupableAccount>(
  self: GroupableAccount,
  accounts: readonly T[],
): T[] {
  if (!isGroupableAccount(self)) return [];
  const key = personKey(self.displayName);
  return accounts
    .filter(
      (account) =>
        account.uid !== self.uid &&
        isGroupableAccount(account) &&
        personKey(account.displayName) === key,
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
): Map<string, T[]> {
  const groups = new Map<string, T[]>();
  for (const account of accounts) {
    if (!isGroupableAccount(account)) continue;
    const key = personKey(account.displayName)!;
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
