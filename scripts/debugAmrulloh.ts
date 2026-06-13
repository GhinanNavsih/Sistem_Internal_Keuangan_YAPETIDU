import * as admin from 'firebase-admin';
import * as path from 'path';
import * as fs from 'fs';
import * as dotenv from 'dotenv';

dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });

const serviceAccountPath = path.resolve(process.cwd(), 'service-account.json');

if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.cert(serviceAccountPath),
    projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
  });
}

const db = admin.firestore();

const TITLE_PATTERN = /^(KH\.?|Hj\.?|HJ\.?|H\.?|Ust\.?|Ustadz|Ustadzah|Gus|Nyai|Ning|Lora|Prof\.?|Dr\.?|DR\.?|Drs\.?|DRS\.?|Dra\.?|DRA\.?|Ir\.?|IR\.?)$/i;
const DEGREE_PATTERN = /^(S\.|M\.|A\.|SST|SE|SS|SH|ST|MA|MM|MBA|MSi|PhD|Ph\.D\.?|Ners\.?|Apt\.?|Lc\.?|LC\.?|Ns\.?|Dr\.?|DR\.?|M\.?Pd\.?I?|M\.?Tr\.?|Keb\.?|Kes\.?)/i;

function normalizeName(fullName: string): string {
  let name = fullName.trim();
  const commaIdx = name.indexOf(',');
  if (commaIdx > 0) {
    name = name.substring(0, commaIdx).trim();
  }
  let tokens = name.split(/\s+/);
  while (tokens.length > 1) {
    if (TITLE_PATTERN.test(tokens[0])) {
      tokens.shift();
    } else {
      break;
    }
  }
  while (tokens.length > 1) {
    const last = tokens[tokens.length - 1];
    if (DEGREE_PATTERN.test(last)) {
      tokens.pop();
    } else {
      break;
    }
  }
  let result = tokens.join(' ');
  result = result.replace(/[.,]+$/g, '');
  return result.toLowerCase().trim();
}

async function run() {
  const snap = await db.collection('Employees_Loyalis')
    .where('personal_info.status', '==', 'AKTIF')
    .get();

  const dbEmployees = snap.docs.map(doc => ({
    id: doc.id,
    name: doc.data().personal_info?.name || '',
    normalizedName: normalizeName(doc.data().personal_info?.name || ''),
  }));

  const amrullohNorm = normalizeName("Amrulloh,Lc,M.Th.I");
  console.log(`Amrulloh normalized: "${amrullohNorm}"`);

  // Let's print all employees in the db containing or containing in "amrulloh"
  for (const emp of dbEmployees) {
    if (emp.normalizedName.includes(amrullohNorm) || amrullohNorm.includes(emp.normalizedName)) {
      console.log(`Match: DB Employee "${emp.name}" (normalized: "${emp.normalizedName}")`);
    }
  }
}

run().catch(console.error);
