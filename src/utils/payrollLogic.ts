import { doc, getDoc, collection, query, where, getDocs } from 'firebase/firestore';
import { db } from '@/lib/firebase';

// The pure salary math lives in @/lib/payroll/salaryMatrix so server code can
// use it without pulling in the client Firebase SDK. Re-exported here so every
// existing importer of this module keeps working.
export {
  calculateYearsOfService,
  calculateGapok,
  matchFunctionalAllowance,
  toSlipEmployeeView,
} from '@/lib/payroll/salaryMatrix';
export type { SlipEmployeeView } from '@/lib/payroll/salaryMatrix';

export async function getBaseSalary(tahun: number, gradeCode: string): Promise<number | null> {
  try {
    // 1. Get active version
    const rootRef = doc(db, 'SalaryMatrix', '_config');
    const rootSnap = await getDoc(rootRef);
    
    if (!rootSnap.exists() || !rootSnap.data().activeVersion) {
      throw new Error('Active Salary Matrix version not found.');
    }
    
    const activeVersion = rootSnap.data().activeVersion;

    // 2. Fetch specific year row
    const rowRef = doc(db, 'SalaryMatrix', activeVersion, 'rows', `year_${tahun}`);
    const rowSnap = await getDoc(rowRef);

    if (!rowSnap.exists()) {
      throw new Error(`Salary data for year ${tahun} not found in version ${activeVersion}.`);
    }

    const data = rowSnap.data();
    const salaries = data.salaries;

    if (!salaries || salaries[gradeCode] === undefined) {
      throw new Error(`Salary grade ${gradeCode} not found for year ${tahun}.`);
    }

    return salaries[gradeCode];
  } catch (error) {
    console.error('Error in getBaseSalary:', error);
    throw error;
  }
}

export async function getEmployeeById(employeeId: string): Promise<any | null> {
  let collectionName = 'Employees_BlueCollar';
  if (employeeId.startsWith('WC_')) {
    collectionName = 'Employees_WhiteCollar';
  } else if (employeeId.startsWith('Loyalis_')) {
    collectionName = 'Employees_Loyalis';
  }
  try {
    const docRef = doc(db, collectionName, employeeId);
    const docSnap = await getDoc(docRef);
    if (docSnap.exists()) {
      return { id: docSnap.id, ...docSnap.data() };
    }
    return null;
  } catch (error) {
    console.error(`Error fetching employee ${employeeId}:`, error);
    throw error;
  }
}

export async function getActiveEmployeesByJobCategory(
  jobCategory: string,
  collarType: 'blue_collar' | 'white_collar' = 'blue_collar'
): Promise<any[]> {
  const collectionName = collarType === 'white_collar' ? 'Employees_WhiteCollar' : 'Employees_BlueCollar';
  try {
    const colRef = collection(db, collectionName);
    const q = query(
      colRef,
      where('employment.jobCategory', '==', jobCategory),
      where('flags.isActive', '==', true),
      where('flags.isPayrollEligible', '==', true)
    );
    const querySnapshot = await getDocs(q);
    return querySnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
  } catch (error) {
    console.error(`Error fetching active employees for category ${jobCategory}:`, error);
    throw error;
  }
}

// Name matching lives in @/lib/payroll/employeeNames so server code can use it
// without pulling in the client Firebase SDK. Re-exported here so every
// existing importer of this module keeps working.
export { normalizeName, MANUAL_OVERRIDES } from '@/lib/payroll/employeeNames';

