import * as admin from 'firebase-admin';
import * as path from 'path';
import * as fs from 'fs';

/**
 * Server-side admin handle on the separate `koperasi-unipdu` Firebase project.
 *
 * The browser only ever reads the cooperative database (see `secondaryDb` in
 * `@/lib/firebase`), so every member-initiated write — loan applications,
 * restructuring, cancellations — has to run here where the actor's identity and
 * the loan's current state can both be checked before anything is persisted.
 *
 * Credentials are deliberately separate from the primary project's: a leak of
 * one must not grant the other.
 */

const KOPERASI_APP_NAME = 'koperasi';
const KOPERASI_PROJECT_ID = 'koperasi-unipdu';
const KOPERASI_SERVICE_ACCOUNT_FILE = 'koperasi-service-account.json';

function resolveKoperasiCredential(): admin.credential.Credential | null {
  const filePath = path.resolve(process.cwd(), KOPERASI_SERVICE_ACCOUNT_FILE);
  if (fs.existsSync(filePath)) {
    return admin.credential.cert(filePath);
  }

  const inlineJson = process.env.KOPERASI_SERVICE_ACCOUNT;
  if (inlineJson) {
    try {
      return admin.credential.cert(JSON.parse(inlineJson));
    } catch (err) {
      console.error('Failed to parse KOPERASI_SERVICE_ACCOUNT env variable:', err);
      return null;
    }
  }

  const clientEmail = process.env.KOPERASI_CLIENT_EMAIL;
  const privateKey = process.env.KOPERASI_PRIVATE_KEY;
  if (clientEmail && privateKey) {
    return admin.credential.cert({
      projectId: KOPERASI_PROJECT_ID,
      clientEmail,
      privateKey: privateKey.replace(/\\n/g, '\n'),
    });
  }

  return null;
}

let cachedApp: admin.app.App | null | undefined;

function koperasiApp(): admin.app.App | null {
  if (cachedApp !== undefined) return cachedApp;

  const existing = admin.apps.find((candidate) => candidate?.name === KOPERASI_APP_NAME);
  if (existing) {
    cachedApp = existing as admin.app.App;
    return cachedApp;
  }

  const credential = resolveKoperasiCredential();
  if (!credential) {
    cachedApp = null;
    return null;
  }

  cachedApp = admin.initializeApp(
    { credential, projectId: KOPERASI_PROJECT_ID },
    KOPERASI_APP_NAME,
  );
  return cachedApp;
}

/**
 * Whether cooperative credentials are present. Routes check this so a missing
 * service account surfaces as an explanatory 503 instead of a stack trace.
 */
export function isKoperasiAdminConfigured(): boolean {
  return koperasiApp() !== null;
}

export function koperasiAdminDb(): admin.firestore.Firestore {
  const app = koperasiApp();
  if (!app) {
    throw new Error(
      'Kredensial Koperasi UNIPDU belum dikonfigurasi di server. ' +
        `Tambahkan ${KOPERASI_SERVICE_ACCOUNT_FILE} atau variabel KOPERASI_SERVICE_ACCOUNT.`,
    );
  }
  return app.firestore();
}

export const KOPERASI_LOANS_COLLECTION = 'simpanPinjam';
export const KOPERASI_USERS_COLLECTION = 'users';
