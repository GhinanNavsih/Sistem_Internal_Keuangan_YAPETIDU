import './initEnv';
import * as admin from 'firebase-admin';
import * as path from 'path';
import * as fs from 'fs';
import { normalizeName, MANUAL_OVERRIDES } from '../src/utils/payrollLogic';

const serviceAccountPath = path.resolve(process.cwd(), 'service-account.json');

if (!admin.apps.length) {
  if (fs.existsSync(serviceAccountPath)) {
    admin.initializeApp({
      credential: admin.credential.cert(serviceAccountPath),
      projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
    });
  } else {
    admin.initializeApp({
      credential: admin.credential.applicationDefault(),
      projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
    });
  }
}

const db = admin.firestore();

const TARGETS = [
  "Moh. Faizal Fuad Aziz, M.Pd.",
  "H. Ahmad Haibat Kannaby Zaimuddin,S.I.P",
  "Herjanti Nursuksmaningtyas Santoso, S.S, M.Si.",
  "H. Ahmad Laroibafih Zulfikar, S.H",
  "Ashlaha Baladina, S.I.Kom.",
  "Muhammad Fajrul Alam Ulin Nuha, S.Kom., M.Kom",
  "Muhammad Al Himmy Rusydy, S.KM",
  "Royyan Amigo, S.Mat., M.Mat",
  "Muhammad Ghinan Navsih, S.Si.D",
  "Ir. Syarif Hidayatulloh",
  "Nufan Balafif, S.Kom., MM",
  "H. Harun Ar Rasyid, S.Pd.I",
  "Hj. Anna Qomariana, SE, M.Pdi",
  "Indah Sumiyarsih, SE."
];

async function run() {
  const empSnap = await db.collection('Employees_Loyalis').get();
  const dbEmployees = empSnap.docs.map(doc => ({
    id: doc.id,
    name: doc.data().personal_info?.name || doc.data().name || '',
    normalized: normalizeName(doc.data().personal_info?.name || doc.data().name || ''),
    raw: doc.data()
  }));

  console.log("Checking target employees...");
  for (const target of TARGETS) {
    const normTarget = normalizeName(target);
    let match = dbEmployees.find(emp => emp.normalized === normTarget);
    if (!match) {
      const overridden = MANUAL_OVERRIDES[target.trim()];
      if (overridden) {
        match = dbEmployees.find(emp => emp.normalized === normalizeName(overridden));
      }
    }
    if (!match) {
      match = dbEmployees.find(emp => emp.normalized.includes(normTarget) || normTarget.includes(emp.normalized));
    }

    if (match) {
      const raw = match.raw;
      console.log(`\nEmployee: ${match.name} (${match.id})`);
      console.log(` - functional_tier: ${raw.academic_and_tier?.functional_tier}`);
      console.log(` - structural_positions:`, JSON.stringify(raw.employment_profile?.structural_positions || [], null, 2));
      console.log(` - kepangkatan:`, JSON.stringify(raw.kepangkatan || {}, null, 2));
    } else {
      console.log(`\n❌ Could not find employee matching: "${target}"`);
    }
  }
}

run().catch(console.error);
