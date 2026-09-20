import * as admin from 'firebase-admin';
import * as path from 'path';
import * as fs from 'fs';

/**
 * Server-side admin handle on SIMPEL UNIPDU's Firebase project: the campus
 * facility-lending app (simpel-unipdu repo) where Pekarya prepare, hand over
 * and check in rooms and equipment.
 *
 * SAKU writes venue reservations straight into SIMPEL's collections, always
 * from here: the browser never touches SIMPEL's database, so the caller's role,
 * the reservation's owner and its current state are all checked first.
 *
 * Credentials are deliberately separate from the primary and Koperasi
 * projects': a leak of one must not grant the others. The project is taken from
 * the key itself, so pointing SAKU at a scratch copy of SIMPEL for testing only
 * means swapping the key (then restart the server).
 */

const SIMPEL_APP_NAME = 'simpel';
const SIMPEL_DEFAULT_PROJECT_ID = 'peminjaman-fasilitas-be85b';
const SIMPEL_SERVICE_ACCOUNT_FILE = 'simpel-service-account.json';

interface ResolvedCredential {
  credential: admin.credential.Credential;
  projectId: string;
}

function fromServiceAccountJson(json: string, source: string): ResolvedCredential | null {
  try {
    const serviceAccount = JSON.parse(json) as Record<string, unknown>;
    const projectId = typeof serviceAccount.project_id === 'string' ? serviceAccount.project_id : '';
    if (!projectId) {
      console.error(`${source} has no project_id.`);
      return null;
    }
    return {
      credential: admin.credential.cert(serviceAccount as admin.ServiceAccount),
      projectId,
    };
  } catch (err) {
    console.error(`Failed to parse ${source}:`, err);
    return null;
  }
}

function resolveSimpelCredential(): ResolvedCredential | null {
  const filePath = path.resolve(process.cwd(), SIMPEL_SERVICE_ACCOUNT_FILE);
  if (fs.existsSync(filePath)) {
    return fromServiceAccountJson(fs.readFileSync(filePath, 'utf8'), SIMPEL_SERVICE_ACCOUNT_FILE);
  }

  const inlineJson = process.env.SIMPEL_SERVICE_ACCOUNT;
  if (inlineJson) {
    return fromServiceAccountJson(inlineJson, 'SIMPEL_SERVICE_ACCOUNT');
  }

  const clientEmail = process.env.SIMPEL_CLIENT_EMAIL;
  const privateKey = process.env.SIMPEL_PRIVATE_KEY;
  if (clientEmail && privateKey) {
    const projectId = process.env.SIMPEL_PROJECT_ID || SIMPEL_DEFAULT_PROJECT_ID;
    return {
      credential: admin.credential.cert({
        projectId,
        clientEmail,
        privateKey: privateKey.replace(/\\n/g, '\n'),
      }),
      projectId,
    };
  }

  return null;
}

let cachedApp: admin.app.App | null | undefined;

function simpelApp(): admin.app.App | null {
  if (cachedApp !== undefined) return cachedApp;

  const existing = admin.apps.find((candidate) => candidate?.name === SIMPEL_APP_NAME);
  if (existing) {
    cachedApp = existing as admin.app.App;
    return cachedApp;
  }

  const resolved = resolveSimpelCredential();
  if (!resolved) {
    cachedApp = null;
    return null;
  }

  cachedApp = admin.initializeApp(
    { credential: resolved.credential, projectId: resolved.projectId },
    SIMPEL_APP_NAME,
  );
  return cachedApp;
}

/**
 * Whether SIMPEL credentials are present. Routes check this so a missing key
 * surfaces as an explanatory 503 instead of a stack trace.
 */
export function isSimpelAdminConfigured(): boolean {
  return simpelApp() !== null;
}

/** Which SIMPEL project SAKU is writing to, shown to Super Admin on the page. */
export function simpelProjectId(): string {
  return simpelApp()?.options.projectId || '';
}

export function simpelAdminDb(): admin.firestore.Firestore {
  const app = simpelApp();
  if (!app) {
    throw new Error(
      'Kredensial SIMPEL UNIPDU belum dikonfigurasi di server. ' +
        `Tambahkan ${SIMPEL_SERVICE_ACCOUNT_FILE} atau variabel SIMPEL_SERVICE_ACCOUNT.`,
    );
  }
  return app.firestore();
}

export const SIMPEL_BOOKINGS_COLLECTION = 'simpel_bookings';
export const SIMPEL_BUILDINGS_COLLECTION = 'simpel_gedung';
export const SIMPEL_EQUIPMENT_COLLECTION = 'simpel_fasilitas';
export const SIMPEL_NOTIFICATIONS_COLLECTION = 'simpel_emails';
/**
 * One document per date that every SAKU reservation for that date reads and
 * writes inside its transaction, so two reservations for the same day run one
 * after the other and cannot both take the last free slot or item. SIMPEL
 * itself never reads this collection.
 */
export const SIMPEL_RESERVATION_LOCKS_COLLECTION = 'simpel_saku_locks';
