import * as admin from 'firebase-admin';
import * as path from 'path';
import * as fs from 'fs';
import * as dotenv from 'dotenv';
import * as XLSX from 'xlsx';

dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });

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

interface ExcelRow {
  NAMA: string;
  POTONGAN: number;
}

async function findCollisions() {
  const excelPath = path.resolve(process.cwd(), 'Potongan BPJS.xlsx');
  const workbook = XLSX.readFile(excelPath);
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json(sheet) as ExcelRow[];

  const loyalisSnap = await db.collection('Employees_Loyalis')
    .where('personal_info.status', '==', 'AKTIF')
    .get();

  const dbEmployees = loyalisSnap.docs.map(doc => ({
    id: doc.id,
    name: doc.data().personal_info?.name || '',
    normalizedName: normalizeName(doc.data().personal_info?.name || ''),
  }));

  const employeeMatches = new Map<string, string[]>();

  for (const row of rows) {
    const rawName = row.NAMA || '';
    const cleanRaw = rawName.trim();
    const normLookup = normalizeName(cleanRaw);

    // Find match
    let matchedEmp = dbEmployees.find(emp => emp.name.toLowerCase().trim() === cleanRaw.toLowerCase()) ||
                     dbEmployees.find(emp => emp.normalizedName === normLookup) ||
                     dbEmployees.find(emp => emp.normalizedName.includes(normLookup) || normLookup.includes(emp.normalizedName));

    if (matchedEmp) {
      const existing = employeeMatches.get(matchedEmp.name) || [];
      existing.push(rawName);
      employeeMatches.set(matchedEmp.name, existing);
    }
  }

  console.log('Collisions (Multiple Excel names mapping to same DB employee):');
  employeeMatches.forEach((excelNames, dbName) => {
    if (excelNames.length > 1) {
      console.log(`- DB Employee: "${dbName}" was matched by Excel entries: ${JSON.stringify(excelNames)}`);
    }
  });
}

findCollisions().catch(console.error);
