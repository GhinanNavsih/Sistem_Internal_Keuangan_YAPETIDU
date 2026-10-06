/**
 * Server side of "Ganti Peran": finds the signed-in person's other accounts and
 * hands out a session for one of them. Which accounts belong together is
 * decided by `@/lib/accountGroups`; this file only reads `users` and mints the
 * token.
 *
 * Every role check in SAKU (Firestore and Storage rules, `requireAuthenticatedProfile`)
 * reads `users/{token uid}`, so a switch is a real sign-in as the other uid, the
 * same mechanism as Super Admin's "Login via Custom Token". The browser cannot
 * read other `users` documents, so the list comes from here, and the switch
 * re-derives it instead of trusting what the browser shows.
 */
import { adminAuth, adminDb } from '@/lib/firebase-admin';
import {
  findLinkedAccounts,
  type GroupableAccount,
  type LinkedAccountSummary,
} from '@/lib/accountGroups';
import { normalizeUserRole } from '@/lib/payroll/roles';
import { HttpError, type AuthenticatedProfile } from '@/lib/server/auth';

interface StoredAccount extends GroupableAccount {
  permittedCategories?: unknown;
}

async function loadAccounts(): Promise<StoredAccount[]> {
  const snapshot = await adminDb
    .collection('users')
    .select('email', 'displayName', 'role', 'permittedCategories', 'disabled', 'accountGroupExcluded')
    .get();
  return snapshot.docs.map((document) => ({ uid: document.id, ...document.data() }));
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

/** The caller's other accounts, in role order. Empty for Super Admin or an opted-out account. */
export async function listLinkedAccounts(uid: string): Promise<LinkedAccountSummary[]> {
  const accounts = await loadAccounts();
  const self = accounts.find((account) => account.uid === uid);
  return self ? findLinkedAccounts(self, accounts).map(toSummary) : [];
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
