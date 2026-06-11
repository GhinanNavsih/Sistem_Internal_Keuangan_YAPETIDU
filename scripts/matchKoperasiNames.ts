import * as admin from 'firebase-admin';
import * as fs from 'fs';
import * as path from 'path';
import * as dotenv from 'dotenv';

dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });

// ─── Initialize Firebase Admin for Internal-BAK ───
const serviceAccountPath = path.resolve(process.cwd(), 'service-account.json');

if (!admin.apps.length) {
  if (fs.existsSync(serviceAccountPath)) {
    console.log('Using service-account.json...');
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

// ─── Robust name normalization ───

/**
 * Regex pattern that matches common Indonesian academic/religious title tokens.
 * This catches S.Pd, M.Kes, S.Kep.Ns., A.Md.Keb., SST, SS, SE, SH, etc.
 */
const TITLE_PATTERN = /^(KH\.?|Hj\.?|HJ\.?|H\.?|Ust\.?|Ustadz|Ustadzah|Gus|Nyai|Ning|Lora|Prof\.?|Dr\.?|DR\.?|Drs\.?|DRS\.?|Dra\.?|DRA\.?|Ir\.?|IR\.?)$/i;

/**
 * Matches degree-like tokens: S.Pd, M.Kes, S.Kep.Ns., A.Md., SST, SE, SS, SH, PhD, Ners, Apt, Lc, etc.
 * Broadly: starts with S., M., A., or is a known standalone like SE, SS, SH, SST, PhD, Ners, Apt, Lc, MM, MBA
 */
const DEGREE_PATTERN = /^(S\.|M\.|A\.|SST|SE|SS|SH|ST|MA|MM|MBA|MSi|PhD|Ph\.D\.?|Ners\.?|Apt\.?|Lc\.?|LC\.?|Ns\.?|Dr\.?|DR\.?|M\.?Pd\.?I?|M\.?Tr\.?|Keb\.?|Kes\.?)/i;

/**
 * Strip academic/religious titles from a name and normalize for matching.
 * Strategy:
 * 1. Remove everything after the first comma (commas always precede degree suffixes)
 * 2. Strip known prefix titles from the front
 * 3. Strip degree-like tokens from the back
 * 4. Clean up trailing dots/punctuation and normalize whitespace
 */
function normalizeName(fullName: string): string {
  let name = fullName.trim();

  // Step 1: If there's a comma, take only the part before it
  // e.g. "Siti Rofiah, S.Pd.I" → "Siti Rofiah"
  // But also handle "Name, SE, M.A" pattern
  const commaIdx = name.indexOf(',');
  if (commaIdx > 0) {
    name = name.substring(0, commaIdx).trim();
  }

  // Step 2: Split into tokens
  let tokens = name.split(/\s+/);

  // Step 3: Remove prefix titles from the front
  while (tokens.length > 1) {
    if (TITLE_PATTERN.test(tokens[0])) {
      tokens.shift();
    } else {
      break;
    }
  }

  // Step 4: Remove degree-like tokens from the back
  while (tokens.length > 1) {
    const last = tokens[tokens.length - 1];
    // Check if it looks like a degree token
    if (DEGREE_PATTERN.test(last)) {
      tokens.pop();
    } else {
      break;
    }
  }

  // Step 5: Join, clean up trailing dots/punctuation, normalize
  let result = tokens.join(' ');
  // Remove trailing dots, commas
  result = result.replace(/[.,]+$/g, '');
  // Lowercase and trim
  return result.toLowerCase().trim();
}

// Manual overrides mapping: simpanPinjamName (raw as in koperasi) -> originalName in Internal-BAK
const MANUAL_OVERRIDES: Record<string, string> = {
  'Siti Rofiah': "Siti Rofi'ah, A. Md.",
  'Ririn Susilawati': 'Ririn Susilowati, S.H.I, M.E.I',
  'Irva Arina Alawiyyah': 'Irva Arina Alawiyah, SE',
  'Sunan': 'ALFIS SUNAN',
  'Aifi Rokhim': 'AIFI ROHIM',
  'Binti Qaniah': "Binti Qoni'ah, SS, M. Hum",
  'Dina Eka Shofiana': 'Dina Eka Sofiana, SE, M.A',
  'Dina Eka Shofiana ': 'Dina Eka Sofiana, SE, M.A',
  'M Qomaruzzaman': 'M. Qomaruzzaman, S. Sos',
  'Helmi Annuchasari': 'Helmi Anuchasari, S.KM., M.KM',
};

async function main() {
  console.log('─── Name Matching Script ───\n');

  // 1. Load simpanPinjam data (already exported)
  const spPath = path.join(process.cwd(), 'simpanPinjam.json');
  const spData: any[] = JSON.parse(fs.readFileSync(spPath, 'utf8'));
  const activeSP = spData.filter(d => d.status === 'Disetujui dan Aktif' && (d.sisaHutang || 0) > 0);
  console.log(`simpanPinjam: ${spData.length} total, ${activeSP.length} active with remaining debt`);

  // 2. Fetch Internal-BAK employees (both collar types)
  const [loyalisSnap, blueCollarSnap] = await Promise.all([
    db.collection('Employees_Loyalis').get(),
    db.collection('Employees_BlueCollar').get(),
  ]);

  interface InternalEmployee {
    docId: string;
    originalName: string;
    normalizedName: string;
    collection: string;
  }

  const internalEmployees: InternalEmployee[] = [];

  loyalisSnap.docs.forEach(doc => {
    const data = doc.data();
    const name = data.personal_info?.name || '';
    if (name) {
      internalEmployees.push({
        docId: doc.id,
        originalName: name,
        normalizedName: normalizeName(name),
        collection: 'Employees_Loyalis',
      });
    }
  });

  blueCollarSnap.docs.forEach(doc => {
    const data = doc.data();
    const name = data.name || '';
    if (name) {
      internalEmployees.push({
        docId: doc.id,
        originalName: name,
        normalizedName: normalizeName(name),
        collection: 'Employees_BlueCollar',
      });
    }
  });

  console.log(`Internal-BAK employees: ${loyalisSnap.size} Loyalis + ${blueCollarSnap.size} Blue Collar = ${internalEmployees.length} total with names\n`);

  // 3. Match names
  interface MatchResult {
    simpanPinjamName: string;
    simpanPinjamId: string;
    loanAmount: number;
    tenor: number;
    cicilanPerBulan: number;
    sisaHutang: number;
    jumlahMenyicil: number;
    matchedInternalName: string | null;
    matchedDocId: string | null;
    matchedCollection: string | null;
    normalizedKoperasi: string;
    normalizedInternal: string | null;
  }

  const results: MatchResult[] = [];
  const matched: MatchResult[] = [];
  const unmatched: MatchResult[] = [];

  for (const loan of activeSP) {
    const spName = loan.userData?.namaLengkap || '';
    const normalizedSP = normalizeName(spName);
    const cicilan = Math.round(loan.jumlahPinjaman / loan.tenor);

    // Try exact normalized match
    let match = internalEmployees.find(emp => emp.normalizedName === normalizedSP);

    // Try manual override
    const overrideName = MANUAL_OVERRIDES[spName.trim()];
    if (overrideName) {
      const overrideMatch = internalEmployees.find(emp => emp.originalName === overrideName);
      if (overrideMatch) {
        match = overrideMatch;
      }
    }

    const result: MatchResult = {
      simpanPinjamName: spName,
      simpanPinjamId: loan.id,
      loanAmount: loan.jumlahPinjaman,
      tenor: loan.tenor,
      cicilanPerBulan: cicilan,
      sisaHutang: loan.sisaHutang,
      jumlahMenyicil: loan.jumlahMenyicil || 0,
      matchedInternalName: match ? match.originalName : null,
      matchedDocId: match ? match.docId : null,
      matchedCollection: match ? match.collection : null,
      normalizedKoperasi: normalizedSP,
      normalizedInternal: match ? match.normalizedName : null,
    };

    results.push(result);
    if (match) {
      matched.push(result);
    } else {
      unmatched.push(result);
    }
  }

  // 4. Print summary
  console.log('═══════════════════════════════════════════════════════════');
  console.log(`  MATCHED: ${matched.length} / ${activeSP.length}`);
  console.log('═══════════════════════════════════════════════════════════\n');

  for (const m of matched) {
    console.log(`  ✅ "${m.simpanPinjamName}" → "${m.matchedInternalName}" (${m.matchedCollection})`);
    console.log(`     Cicilan: Rp ${m.cicilanPerBulan.toLocaleString('id-ID')} / bulan (${m.jumlahMenyicil}/${m.tenor})\n`);
  }

  if (unmatched.length > 0) {
    console.log('═══════════════════════════════════════════════════════════');
    console.log(`  UNMATCHED: ${unmatched.length}`);
    console.log('═══════════════════════════════════════════════════════════\n');

    for (const u of unmatched) {
      console.log(`  ❌ "${u.simpanPinjamName}" (normalized: "${u.normalizedKoperasi}")`);
      // Show close matches
      const closeMatches = internalEmployees
        .filter(emp => {
          const parts = u.normalizedKoperasi.split(' ');
          return parts.some(p => p.length >= 3 && emp.normalizedName.includes(p));
        })
        .slice(0, 3);
      if (closeMatches.length > 0) {
        console.log(`     Possible matches:`);
        closeMatches.forEach(cm => {
          console.log(`       → "${cm.originalName}" (normalized: "${cm.normalizedName}")`);
        });
      }
      console.log('');
    }
  }

  // 5. Write JSON output
  const outputPath = path.join(process.cwd(), 'koperasi_name_matching.json');
  const output = {
    generatedAt: new Date().toISOString(),
    summary: {
      totalActiveLoans: activeSP.length,
      matched: matched.length,
      unmatched: unmatched.length,
      totalInternalEmployees: internalEmployees.length,
    },
    matched: matched.map(m => ({
      simpanPinjamName: m.simpanPinjamName,
      simpanPinjamId: m.simpanPinjamId,
      internalName: m.matchedInternalName,
      internalDocId: m.matchedDocId,
      internalCollection: m.matchedCollection,
      normalizedKey: m.normalizedKoperasi,
      loanAmount: m.loanAmount,
      tenor: m.tenor,
      cicilanPerBulan: m.cicilanPerBulan,
      sisaHutang: m.sisaHutang,
      jumlahMenyicil: m.jumlahMenyicil,
    })),
    unmatched: unmatched.map(u => ({
      simpanPinjamName: u.simpanPinjamName,
      simpanPinjamId: u.simpanPinjamId,
      normalizedKey: u.normalizedKoperasi,
      loanAmount: u.loanAmount,
      tenor: u.tenor,
      cicilanPerBulan: u.cicilanPerBulan,
      sisaHutang: u.sisaHutang,
      jumlahMenyicil: u.jumlahMenyicil,
    })),
  };

  fs.writeFileSync(outputPath, JSON.stringify(output, null, 2), 'utf8');
  console.log(`\n✅ Results written to: ${outputPath}`);
}

main().then(() => process.exit(0)).catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
