import * as admin from 'firebase-admin';
import * as path from 'path';
import * as dotenv from 'dotenv';

dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });

if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.cert(path.resolve(process.cwd(), 'service-account.json')),
    projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
  });
}
const db = admin.firestore();

async function main() {
  // 1. Check PayrollSlipStates - what periods exist?
  const slipSnap = await db.collection('PayrollSlipStates').get();
  const periodCounts: Record<string, { total: number; confirmed: number; printed: number; totalGross: number; totalDeductions: number }> = {};
  
  slipSnap.docs.forEach(d => {
    const data = d.data();
    const period = data.period || d.id.split('_').slice(0, 2).join('_');
    if (!periodCounts[period]) {
      periodCounts[period] = { total: 0, confirmed: 0, printed: 0, totalGross: 0, totalDeductions: 0 };
    }
    periodCounts[period].total++;
    if (data.status === 'confirmed') periodCounts[period].confirmed++;
    if (data.status === 'printed') periodCounts[period].printed++;
    
    const earnings = (data.earnings || []).reduce((sum: number, e: any) => sum + (e.amount || 0), 0);
    const deductions = (data.deductions || []).reduce((sum: number, d: any) => sum + (d.amount || 0), 0);
    periodCounts[period].totalGross += earnings;
    periodCounts[period].totalDeductions += deductions;
  });
  
  console.log('\n=== PayrollSlipStates by Period ===');
  const sortedPeriods = Object.keys(periodCounts).sort();
  sortedPeriods.forEach(p => {
    const c = periodCounts[p];
    console.log(`  ${p}: ${c.total} slips (${c.confirmed} confirmed, ${c.printed} printed) | Gross: Rp ${c.totalGross.toLocaleString('id-ID')} | Deductions: Rp ${c.totalDeductions.toLocaleString('id-ID')} | Net: Rp ${(c.totalGross - c.totalDeductions).toLocaleString('id-ID')}`);
  });

  // 2. Check UraianGaji - what periods exist?
  const uraianSnap = await db.collection('UraianGaji').get();
  const uraianPeriods = uraianSnap.docs.map(d => d.id).sort();
  console.log('\n=== UraianGaji Document IDs ===');
  uraianPeriods.forEach(id => console.log(`  ${id}`));

  // 3. Check LoyalisPresence - what periods exist?
  const presenceSnap = await db.collection('LoyalisPresence').get();
  console.log('\n=== LoyalisPresence Document IDs ===');
  presenceSnap.docs.map(d => d.id).sort().forEach(id => console.log(`  ${id}`));

  // 4. Employee counts
  const [loySnap, bcSnap] = await Promise.all([
    db.collection('Employees_Loyalis').get(),
    db.collection('Employees_BlueCollar').get(),
  ]);
  const activeLoy = loySnap.docs.filter(d => d.data().personal_info?.status === 'AKTIF').length;
  const activeBC = bcSnap.docs.filter(d => d.data().flags?.isActive !== false).length;
  console.log(`\n=== Employee Counts ===`);
  console.log(`  Loyalis: ${activeLoy} active / ${loySnap.size} total`);
  console.log(`  Blue Collar (Pekarya): ${activeBC} active / ${bcSnap.size} total`);

  // 5. Check VakasiTambahan
  const vakasiSnap = await db.collection('VakasiTambahan').get();
  console.log('\n=== VakasiTambahan Documents ===');
  console.log(`  Total: ${vakasiSnap.size}`);
  vakasiSnap.docs.slice(0, 3).forEach(d => console.log(`  Sample: ${d.id}`));

  // 6. Any other financial collections?
  console.log('\n=== Checking for other potentially useful collections ===');
  const rootCollections = await db.listCollections();
  const collNames = rootCollections.map(c => c.id).sort();
  console.log('  All collections:', collNames.join(', '));
}

main().then(() => process.exit(0)).catch(err => {
  console.error(err);
  process.exit(1);
});
