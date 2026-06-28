import './initEnv';
import * as admin from 'firebase-admin';
import * as path from 'path';
import * as fs from 'fs';
import { calculateYearsOfService, calculateGapok } from '../src/utils/payrollLogic';
import { calculateTotalEarnings } from '../src/utils/salaryCalculator';
import { buildInitialEarnings } from '../src/components/PaySlipDialog';

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

// Mock context loading of matrices, functional allowance maps, and koperasi deductions
async function run() {
  const selectedPeriod = '2026_06';
  
  // 1. Fetch data from Firestore
  console.log('Fetching active employees...');
  const activeLoyalisSnap = await db.collection('Employees_Loyalis').get();
  const activePekaryaSnap = await db.collection('Employees_BlueCollar').get();
  
  const activeLoyalis = activeLoyalisSnap.docs
    .map(d => ({ id: d.id, ...d.data() }))
    .filter((e: any) => e.personal_info?.status === 'AKTIF');
  
  const activePekarya = activePekaryaSnap.docs
    .map(d => ({ id: d.id, ...d.data() }))
    .filter((e: any) => e.flags?.isActive !== false);

  console.log(`Active Loyalis count: ${activeLoyalis.length}`);
  console.log(`Active Pekarya count: ${activePekarya.length}`);

  // Fetch matrices
  console.log('Fetching matrices...');
  const matrixBlueSnap = await db.collection('Settings').doc('BlueCollarSalaryMatrix').get();
  const matrixWhiteSnap = await db.collection('Settings').doc('WhiteCollarSalaryMatrix').get();
  const salaryMatrixBlue = matrixBlueSnap.data() || {};
  const salaryMatrixWhite = matrixWhiteSnap.data() || {};

  // Fetch functional allowances
  const functionalAllowanceMap: Record<string, number> = {};
  const fAllowanceSnap = await db.collection('Settings').doc('FunctionalAllowances').get();
  if (fAllowanceSnap.exists) {
    const data = fAllowanceSnap.data() || {};
    Object.entries(data).forEach(([key, val]: [string, any]) => {
      functionalAllowanceMap[key] = Number(val) || 0;
    });
  }

  // Fetch slips for selectedPeriod
  console.log('Fetching slips...');
  const slipSnap = await db.collection('PayrollSlipStates').get();
  const slips = slipSnap.docs.map(doc => ({ id: doc.id, ...doc.data() }));

  const selectedPeriodSlipsMap: Record<string, any> = {};
  slips.forEach((d: any) => {
    const period = d.period || d.id.substring(0, 7);
    const employeeId = d.employeeId || d.id.substring(period.length + 1);
    if (period === selectedPeriod) {
      selectedPeriodSlipsMap[employeeId] = d;
    }
  });

  // Fetch UraianGaji
  console.log('Fetching UraianGaji...');
  const uraianSnapshot = await db.collection('UraianGaji').get();
  const selectedPeriodUraianMap: Record<string, any> = {};
  uraianSnapshot.docs.forEach(d => {
    if (d.id.startsWith(selectedPeriod)) {
      selectedPeriodUraianMap[d.id] = d.data();
    }
  });

  // Fetch LoyalisPresence
  console.log('Fetching LoyalisPresence...');
  const presenceSnap = await db.collection('LoyalisPresence').doc(selectedPeriod).get();
  const selectedPeriodLoyalisPresence = presenceSnap.exists ? presenceSnap.data() : null;

  // Fetch VakasiTambahan
  console.log('Fetching VakasiTambahan...');
  const periodToken = selectedPeriod.replace('_', '-');
  const vakasiSnapshot = await db.collection('VakasiTambahan').get();
  const selectedPeriodVakasiTambahanMap: Record<string, number> = {};
  const selectedPeriodVakasiEvents: string[] = [];
  
  vakasiSnapshot.docs.forEach(d => {
    const data = d.data();
    if (data.period === periodToken && (!data.status || data.status === 'approved')) {
      if (data.eventName) {
        selectedPeriodVakasiEvents.push(data.eventName);
      }
      const workers = data.eventWorkers || {};
      Object.entries(workers).forEach(([empId, w]: [string, any]) => {
        selectedPeriodVakasiTambahanMap[empId] = (selectedPeriodVakasiTambahanMap[empId] || 0) + (w.payGiven || 0);
      });
    }
  });

  // Run the aggregation logic
  const targetDateObj = new Date(2026, 5, 1); // June 2026
  const earningsBreakdown: Record<string, number> = {};

  const getLoyalisPresenceBonus = (empId: string): number => {
    if (selectedPeriodLoyalisPresence?.entries && Object.keys(selectedPeriodLoyalisPresence.entries).length > 0) {
      const entry = selectedPeriodLoyalisPresence.entries[empId];
      if (!entry || entry.isNotFoundInExcel) return 0;
    }
    return 250000;
  };

  const getLoyalisPresensiEarning = (empId: string): number => {
    const workingDays = selectedPeriodLoyalisPresence?.workingDays || 25;
    const expectedHours = selectedPeriodLoyalisPresence?.expectedHours || 6.5;
    if (selectedPeriodLoyalisPresence?.entries && Object.keys(selectedPeriodLoyalisPresence.entries).length > 0) {
      const entry = selectedPeriodLoyalisPresence.entries[empId];
      if (!entry || entry.isNotFoundInExcel) return 0;
    }
    return Math.round(workingDays * expectedHours * 1650);
  };

  // Loop Loyalis
  console.log('\n--- Aggregating Loyalis ---');
  activeLoyalis.forEach((emp: any) => {
    const slip = selectedPeriodSlipsMap[emp.id];
    let earningsList: { label: string; amount: number }[] = [];

    if (slip && slip.status !== 'draft' && slip.earnings) {
      earningsList = slip.earnings;
      console.log(`Loyalis Employee: ${emp.id} (${emp.personal_info?.name}) has saved slip with status "${slip.status}". Earnings labels:`, earningsList.map(e => `"${e.label}" (Rp ${e.amount})`).join(', '));
    } else {
      const joinDateVal = emp.employment_profile?.date_of_hire?.toDate?.() || 
                          (emp.employment_profile?.date_of_hire ? new Date(emp.employment_profile.date_of_hire) : new Date());
      const gradeLevel = emp.academic_and_tier?.level_code || '';
      const mappedEmp = { joinDate: joinDateVal, gradeLevel } as any;
      const gapokVal = calculateGapok(mappedEmp, salaryMatrixWhite, targetDateObj);

      earningsList = buildInitialEarnings(
        emp,
        gapokVal,
        'loyalis',
        undefined,
        selectedPeriodVakasiTambahanMap[emp.id] ?? 0,
        undefined,
        functionalAllowanceMap[emp.id] ?? 0,
        undefined,
        undefined,
        getLoyalisPresenceBonus(emp.id),
        getLoyalisPresensiEarning(emp.id)
      );
    }

    earningsList.forEach((e: any) => {
      const label = e.label || 'Lain-lain';
      if (e.amount > 0) {
        earningsBreakdown[label] = (earningsBreakdown[label] || 0) + e.amount;
      }
    });
  });

  // Loop Pekarya
  console.log('\n--- Aggregating Pekarya ---');
  activePekarya.forEach((emp: any) => {
    const slip = selectedPeriodSlipsMap[emp.id];
    let earningsList: { label: string; amount: number }[] = [];

    if (slip && slip.status !== 'draft' && slip.earnings) {
      earningsList = slip.earnings;
    } else {
      const joinDateVal = emp.employment?.startDate ? new Date(emp.employment.startDate) : new Date();
      const gradeLevel = emp.salaryProfile?.salaryGradeCode || '';
      const mappedEmp = { joinDate: joinDateVal, gradeLevel } as any;
      const gapokVal = calculateGapok(mappedEmp, salaryMatrixBlue, targetDateObj);
      const uraianEntry = selectedPeriodUraianMap[`${selectedPeriod}_${emp.employment?.jobCategory}`]?.entries?.[emp.id];

      earningsList = buildInitialEarnings(
        emp,
        gapokVal,
        'pekarya',
        uraianEntry
      );
    }

    earningsList.forEach((e: any) => {
      const label = e.label || 'Lain-lain';
      if (e.amount > 0) {
        earningsBreakdown[label] = (earningsBreakdown[label] || 0) + e.amount;
      }
    });
  });

  console.log('\n--- Final Earnings Breakdown (Pre-consolidation) ---');
  console.log(JSON.stringify(earningsBreakdown, null, 2));
}

run().catch(console.error);
