/**
 * Server side of "Ganti Peran": finds the signed-in person's other accounts and
 * hands out a session for one of them. Which accounts belong together is
 * decided by `@/lib/accountGroups` (the employee each account names); this file
 * reads `users` and the employee records' conversion links, and mints the token.
 *
 * Every role check in SAKU (Firestore and Storage rules, `requireAuthenticatedProfile`)
 * reads `users/{token uid}`, so a switch is a real sign-in as the other uid, the
 * same mechanism as Super Admin's "Login via Custom Token". The browser cannot
 * read other `users` documents, so the list comes from here, and the switch
 * re-derives it instead of trusting what the browser shows.
 */
import { adminAuth, adminDb } from '@/lib/firebase-admin';
import {
  employeeCollectionForId,
  findLinkedAccounts,
  isGroupableAccount,
  linkedAccountsByUid,
  normalizeEmployeeId,
  type EmployeeSuccessors,
  type GroupableAccount,
  type LinkedAccountSummary,
} from '@/lib/accountGroups';
import { readConversionFromLink, readConversionToLink } from '@/lib/employeeConversion';
import { normalizeUserRole } from '@/lib/payroll/roles';
import { HttpError, type AuthenticatedProfile } from '@/lib/server/auth';

const ACCOUNT_FIELDS = [
  'email',
  'displayName',
  'role',
  'permittedCategories',
  'disabled',
  'personEmployeeId',
] as const;

interface StoredAccount extends GroupableAccount {
  displayName?: unknown;
  permittedCategories?: unknown;
}

/** The named employee records, read with only their `conversion` field, keyed by id. */
async function readConversions(ids: Iterable<string>): Promise<Map<string, unknown>> {
  const refs = [...new Set(ids)].flatMap((id) => {
    const collection = employeeCollectionForId(id);
    return collection ? [adminDb.collection(collection).doc(id)] : [];
  });
  const records = new Map<string, unknown>();
  for (let offset = 0; offset < refs.length; offset += 100) {
    const snapshots = await adminDb.getAll(...refs.slice(offset, offset + 100), {
      fieldMask: ['conversion'],
    });
    for (const snapshot of snapshots) {
      if (snapshot.exists) records.set(snapshot.id, snapshot.data());
    }
  }
  return records;
}

/**
 * Where each converted Pekarya record that `accounts` name moved to. Only
 * those records are read.
 */
export async function loadEmployeeSuccessors(
  accounts: readonly GroupableAccount[],
): Promise<EmployeeSuccessors> {
  const pekaryaIds = accounts.flatMap((account) => {
    const id = isGroupableAccount(account) ? normalizeEmployeeId(account.personEmployeeId) : null;
    return id && employeeCollectionForId(id) === 'Employees_BlueCollar' ? [id] : [];
  });
  const successors = new Map<string, string>();
  for (const [id, record] of await readConversions(pekaryaIds)) {
    const movedTo = readConversionToLink(record);
    if (movedTo) successors.set(id, movedTo.toEmployeeId);
  }
  return successors;
}

/** For the Users page: the uids each account can switch to, decided as a switch would. */
export async function linkedAccountUidsByUid(
  accounts: readonly GroupableAccount[],
): Promise<Map<string, string[]>> {
  const successors = await loadEmployeeSuccessors(accounts);
  const result = new Map<string, string[]>();
  for (const [uid, linked] of linkedAccountsByUid(accounts, successors)) {
    result.set(uid, linked.map((account) => account.uid));
  }
  return result;
}

function toSummary(account: StoredAccount): LinkedAccountSummary {
  return {
    uid: account.uid,
    email: typeof account.email === 'string' ? account.email : '',
    displayName: typeof account.displayName === 'string' ? account.displayName : '',
    // Only groupable accounts reach here, and those always have a valid role.
    role: normalizeUserRole(account.role)!,
    permittedCategories: Array.isArray(account.permittedCategories)
      ? account.permittedCategories.filter((item): item is string => typeof item === 'string')
      : [],
  };
}

/**
 * The caller's other accounts, in role order. Empty for Super Admin, a disabled
 * account, or an account that names no employee.
 *
 * Reads only what can belong to the person: the employee ids that stand for
 * them (the one the account names, the Loyalis record a converted Pekarya
 * record moved to, and the Pekarya record a converted Loyalis record came
 * from), then the accounts naming one of those ids.
 */
export async function listLinkedAccounts(uid: string): Promise<LinkedAccountSummary[]> {
  const selfSnapshot = await adminDb.collection('users').doc(uid).get();
  if (!selfSnapshot.exists) return [];
  const self: StoredAccount = { uid, ...selfSnapshot.data() };
  const ownId = isGroupableAccount(self) ? normalizeEmployeeId(self.personEmployeeId) : null;
  if (!ownId) return [];

  const successors = new Map<string, string>();
  const personIds = new Set([ownId]);
  const ownRecord = (await readConversions([ownId])).get(ownId);
  const movedTo = readConversionToLink(ownRecord);
  const currentId = movedTo?.toEmployeeId ?? ownId;
  if (movedTo) {
    successors.set(ownId, currentId);
    personIds.add(currentId);
  }
  const currentRecord = movedTo ? (await readConversions([currentId])).get(currentId) : ownRecord;
  const cameFrom = readConversionFromLink(currentRecord);
  if (cameFrom) {
    successors.set(cameFrom.fromEmployeeId, currentId);
    personIds.add(cameFrom.fromEmployeeId);
  }

  const candidates = await adminDb
    .collection('users')
    .where('personEmployeeId', 'in', [...personIds])
    .select(...ACCOUNT_FIELDS)
    .get();
  const accounts: StoredAccount[] = candidates.docs.map((document) => ({
    uid: document.id,
    ...document.data(),
  }));
  return findLinkedAccounts(self, accounts, successors).map(toSummary);
}

function errorCode(error: unknown): string | undefined {
  if (!error || typeof error !== 'object' || !('code' in error)) return undefined;
  return typeof error.code === 'string' ? error.code : undefined;
}

/**
 * Checks that `targetUid` is one of the caller's own accounts, records the
 * switch in `audit_logs`, and returns a custom token the browser signs in with.
 */
export async function startAccountSwitch(
  caller: AuthenticatedProfile,
  targetUid: string,
): Promise<{ customToken: string; target: LinkedAccountSummary }> {
  if (caller.impersonatedBy) {
    // The restore button of an impersonation session would otherwise lead back
    // to Super Admin from an account the session never started in.
    throw new HttpError(409, 'Kembali ke sesi Super Admin terlebih dahulu sebelum berganti peran.');
  }
  if (targetUid === caller.uid) {
    throw new HttpError(400, 'Anda sudah menggunakan akun ini.');
  }

  const target = (await listLinkedAccounts(caller.uid)).find(
    (account) => account.uid === targetUid,
  );
  if (!target) {
    throw new HttpError(403, 'Akun tersebut tidak terhubung dengan akun Anda.');
  }

  try {
    const record = await adminAuth.getUser(targetUid);
    if (record.disabled) {
      throw new HttpError(403, 'Akun tujuan telah dinonaktifkan.');
    }
  } catch (error) {
    if (error instanceof HttpError) throw error;
    if (errorCode(error) === 'auth/user-not-found') {
      throw new HttpError(404, 'Akun tujuan tidak ditemukan.');
    }
    throw error;
  }

  await adminDb.collection('audit_logs').add({
    action: 'ACCOUNT_SWITCHED',
    actorUid: caller.uid,
    actorEmail: caller.email,
    actorRole: caller.role,
    targetUid,
    targetEmail: target.email,
    targetRole: target.role,
    timestamp: new Date().toISOString(),
  });

  const customToken = await adminAuth.createCustomToken(targetUid, { switchedFrom: caller.uid });
  return { customToken, target };
}
