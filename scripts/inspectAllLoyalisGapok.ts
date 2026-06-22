import './initEnv';
import * as admin from 'firebase-admin';
import * as path from 'path';
import * as fs from 'fs';
import { calculateYearsOfService, calculateGapok } from '../src/utils/payrollLogic';

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

async function run() {
  // Fetch active salary matrix for white collar
  const rootSnap = await db.collection('SalaryMatrix_WhiteCollar').doc('_config').get();
  if (!rootSnap.exists) {
    console.error('Config not found');
    return;
  }
  const activeVersion = rootSnap.data()?.activeVersion;
  const matrixSnap = await db.collection('SalaryMatrix_WhiteCollar').doc(activeVersion).collection('rows').get();
  const matrix: any = {};
  matrixSnap.docs.forEach((d: any) => {
    const data = d.data();
    const tahun = data.tahun;
    const salaries = data.salaries || {};
    Object.entries(salaries).forEach(([grade, amount]) => {
      if (!matrix[grade]) matrix[grade] = {};
      matrix[grade][tahun] = amount;
    });
  });

  const snap = await db.collection('Employees_Loyalis').get();
  console.log(`Total Loyalis employees in DB: ${snap.size}`);
  
  let nullLevelCode = 0;
  let zeroGapok = 0;
  const targetDate = new Date(2026, 5, 1); // June 2026

  const samples: any[] = [];
  const activeNoGapok: any[] = [];

  snap.docs.forEach((doc: any) => {
    const data = doc.data();
    const name = data.personal_info?.name || data.name;
    const tier = data.academic_and_tier || {};
    const levelCode = tier.level_code;
    
    // Map to employee object expected by calculateGapok
    const joinDateVal = data.employment_profile?.date_of_hire?.toDate?.() || 
                        (data.employment_profile?.date_of_hire ? new Date(data.employment_profile.date_of_hire) : new Date());
    
    const emp = {
      id: doc.id,
      name: name || '',
      role: data.employment_profile?.department_unit || 'Staf',
      gradeLevel: levelCode || '',
      joinDate: joinDateVal,
      isActive: data.personal_info?.status === 'AKTIF',
      phoneNumber: data.personal_info?.phone || '',
      email: data.personal_info?.email || '',
      raw: data,
      rowIndex: 0
    };

    const gapok = calculateGapok(emp, matrix, targetDate);

    if (!levelCode) {
      nullLevelCode++;
    }
    if (gapok === 0) {
      zeroGapok++;
      if (emp.isActive) {
        activeNoGapok.push({ id: doc.id, name, levelCode, jobRole: data.employment_profile?.job_role });
      }
    }
  });

  console.log(`Active or inactive Loyalis with null level_code: ${nullLevelCode}`);
  console.log(`Active or inactive Loyalis with zero calculated gapok: ${zeroGapok}`);
  console.log(`Active Loyalis with zero calculated gapok: ${activeNoGapok.length}`);
  console.log('Samples of active Loyalis with zero calculated gapok (first 15):');
  console.log(JSON.stringify(activeNoGapok.slice(0, 15), null, 2));

  console.log('\n--- DETAILED ACADEMIC AND TIER FOR ZERO GAPOK EMPLOYEES ---');
  for (const emp of activeNoGapok) {
    const docSnap = await db.collection('Employees_Loyalis').doc(emp.id).get();
    if (docSnap.exists) {
      console.log(`Employee: ${emp.name} (${emp.id})`);
      console.log('Academic & Tier:', JSON.stringify(docSnap.data()!.academic_and_tier, null, 2));
    }
  }

  // Detailed debug for Loyalis_251 and Loyalis_253
  console.log('\n--- DEBUG FOR LOYALIS_251 ---');
  const d251 = await db.collection('Employees_Loyalis').doc('Loyalis_251').get();
  if (d251.exists) {
    const data = d251.data()!;
    const joinDateVal = data.employment_profile?.date_of_hire?.toDate?.() || 
                        (data.employment_profile?.date_of_hire ? new Date(data.employment_profile.date_of_hire) : new Date());
    const years = calculateYearsOfService(joinDateVal, targetDate);
    const levelCode = data.academic_and_tier?.level_code;
    const gradeMatrix = matrix[levelCode || ''];
    console.log({
      name: data.personal_info?.name,
      joinDate: joinDateVal,
      years,
      levelCode,
      hasGradeMatrix: !!gradeMatrix,
      gradeMatrixKeys: gradeMatrix ? Object.keys(gradeMatrix) : null
    });
  }

  console.log('\n--- DEBUG FOR LOYALIS_253 ---');
  const d253 = await db.collection('Employees_Loyalis').doc('Loyalis_253').get();
  if (d253.exists) {
    const data = d253.data()!;
    const joinDateVal = data.employment_profile?.date_of_hire?.toDate?.() || 
                        (data.employment_profile?.date_of_hire ? new Date(data.employment_profile.date_of_hire) : new Date());
    const years = calculateYearsOfService(joinDateVal, targetDate);
    const levelCode = data.academic_and_tier?.level_code;
    const gradeMatrix = matrix[levelCode || ''];
    console.log({
      name: data.personal_info?.name,
      joinDate: joinDateVal,
      years,
      levelCode,
      hasGradeMatrix: !!gradeMatrix,
      gradeMatrixKeys: gradeMatrix ? Object.keys(gradeMatrix) : null
    });
  }
}

run().catch(console.error);
