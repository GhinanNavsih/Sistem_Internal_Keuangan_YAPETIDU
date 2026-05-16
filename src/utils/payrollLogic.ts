import { differenceInYears } from 'date-fns';
import { Employee, SalaryMatrix } from '@/types';
import { doc, getDoc, collection, query, where, getDocs } from 'firebase/firestore';
import { db } from '@/lib/firebase';

export function calculateYearsOfService(joinDate: Date, targetDate: Date): number {
  return differenceInYears(targetDate, joinDate);
}

export function calculateGapok(
  employee: Employee,
  matrix: SalaryMatrix,
  targetDate: Date
): number {
  const years = calculateYearsOfService(employee.joinDate, targetDate);
  const gradeMatrix = matrix[employee.gradeLevel];
  
  if (!gradeMatrix) return 0;
  
  const availableYears = Object.keys(gradeMatrix).map(Number).sort((a, b) => b - a);
  const applicableYear = availableYears.find((y) => years >= y);

  if (applicableYear !== undefined) {
    return gradeMatrix[applicableYear];
  }
  
  return 0;
}

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
  // IDs prefixed BC_ are blue collar, WC_ are white collar
  const collectionName = employeeId.startsWith('WC_') ? 'Employees_WhiteCollar' : 'Employees_BlueCollar';
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
