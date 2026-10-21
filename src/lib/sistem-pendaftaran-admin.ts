import * as admin from 'firebase-admin';
import * as path from 'path';
import * as fs from 'fs';

/**
 * Server-side admin handle on the "Sistem Pendaftaran Event" Firebase project
 * (`sistem-pendaftaran-event`), the event registration app.
 *
 * Server only: the browser never touches this project, so every route that uses
 * it checks the caller's role first (the Admin SDK bypasses security rules).
 *
 * Credentials are deliberately separate from the primary, Koperasi and SIMPEL
 * projects': a leak of one must not grant the others. The project is taken from
 * the key itself, so pointing SAKU at a scratch copy only means swapping the key
 * (then restart the server).
 */

const SISTEM_PENDAFTARAN_APP_NAME = 'sistem-pendaftaran';
const SISTEM_PENDAFTARAN_SERVICE_ACCOUNT_FILE = 'sistem-pendaftaran-service-account.json';

function fromServiceAccountJson(json: string, source: string): admin.credential.Credential | null {
  try {
    const serviceAccount = JSON.parse(json) as Record<string, unknown>;
    if (typeof serviceAccount.project_id !== 'string' || !serviceAccount.project_id) {
      console.error(`${source} has no project_id.`);
      return null;
    }
    return admin.credential.cert(serviceAccount as admin.ServiceAccount);
  } catch (err) {
    console.error(`Failed to parse ${source}:`, err);
    return null;
  }
}

function resolveSistemPendaftaranCredential(): admin.credential.Credential | null {
  const filePath = path.resolve(process.cwd(), SISTEM_PENDAFTARAN_SERVICE_ACCOUNT_FILE);
  if (fs.existsSync(filePath)) {
    return fromServiceAccountJson(
      fs.readFileSync(filePath, 'utf8'),
      SISTEM_PENDAFTARAN_SERVICE_ACCOUNT_FILE,
    );
  }

  const inlineJson = process.env.SISTEM_PENDAFTARAN_SERVICE_ACCOUNT;
  if (inlineJson) {
    return fromServiceAccountJson(inlineJson, 'SISTEM_PENDAFTARAN_SERVICE_ACCOUNT');
  }

  return null;
}

let cachedApp: admin.app.App | null | undefined;

function sistemPendaftaranApp(): admin.app.App | null {
  if (cachedApp !== undefined) return cachedApp;

  const existing = admin.apps.find((candidate) => candidate?.name === SISTEM_PENDAFTARAN_APP_NAME);
  if (existing) {
    cachedApp = existing as admin.app.App;
    return cachedApp;
  }

  const credential = resolveSistemPendaftaranCredential();
  if (!credential) {
    cachedApp = null;
    return null;
  }

  cachedApp = admin.initializeApp({ credential }, SISTEM_PENDAFTARAN_APP_NAME);
  return cachedApp;
}

/**
 * Whether the credentials are present. Routes check this so a missing key
 * surfaces as an explanatory 503 instead of a stack trace.
 */
export function isSistemPendaftaranAdminConfigured(): boolean {
  return sistemPendaftaranApp() !== null;
}

export function sistemPendaftaranAdminDb(): admin.firestore.Firestore {
  const app = sistemPendaftaranApp();
  if (!app) {
    throw new Error(
      'Kredensial Sistem Pendaftaran Event belum dikonfigurasi di server. ' +
        `Tambahkan ${SISTEM_PENDAFTARAN_SERVICE_ACCOUNT_FILE} atau variabel SISTEM_PENDAFTARAN_SERVICE_ACCOUNT.`,
    );
  }
  return app.firestore();
}
