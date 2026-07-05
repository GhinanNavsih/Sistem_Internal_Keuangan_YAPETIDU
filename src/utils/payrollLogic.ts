import { differenceInYears } from 'date-fns';
import { Employee, SalaryMatrix } from '@/types';
import { doc, getDoc, collection, query, where, getDocs } from 'firebase/firestore';
import { db } from '@/lib/firebase';

export function calculateYearsOfService(joinDate: Date, targetDate: Date): number {
  const nextMonth5th = new Date(targetDate.getFullYear(), targetDate.getMonth() + 1, 5);
  
  // Normalize both dates to midnight local time to avoid time of day / timezone mismatches
  const d1 = new Date(joinDate.getFullYear(), joinDate.getMonth(), joinDate.getDate());
  const d2 = new Date(nextMonth5th.getFullYear(), nextMonth5th.getMonth(), nextMonth5th.getDate());
  
  return differenceInYears(d2, d1);
}

export function calculateGapok(
  employee: Employee,
  matrix: SalaryMatrix,
  targetDate: Date
): number {
  const baseDate = employee.dateRecognized || employee.joinDate;
  const years = calculateYearsOfService(baseDate, targetDate);
  const gradeKey = employee.gradeLevel ? employee.gradeLevel.replace(/^Gol\.\s*/i, '') : '';
  const gradeMatrix = matrix[gradeKey] || matrix[employee.gradeLevel];
  
  if (!gradeMatrix) return 0;
  
  const availableYears = Object.keys(gradeMatrix).map(Number).sort((a, b) => b - a);
  const minYear = Math.min(...availableYears);
  const effectiveYears = years < minYear ? minYear : years;
  
  const applicableYear = availableYears.find((y) => effectiveYears >= y);

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

export function matchFunctionalAllowance(
  educationLevel: string | undefined | null,
  functionalTier: number | string | undefined | null,
  functionalMatrix: Record<string, { base_value: number; functional_tiers: Record<string, number> }>
): number {
  if (!educationLevel) return 0;
  
  // Clean educationLevel and take 6-char prefix
  const cleanEmpPrefix = educationLevel.trim().substring(0, 6).toUpperCase();
  
  // Find matching row in matrix
  const matchedKey = Object.keys(functionalMatrix).find(key => 
    key.trim().substring(0, 6).toUpperCase() === cleanEmpPrefix
  );
  
  if (!matchedKey) return 0;
  
  const row = functionalMatrix[matchedKey];
  const tierStr = String(functionalTier !== undefined && functionalTier !== null ? functionalTier : '').trim();
  
  // If functionalTier is specifically '0', return 0
  if (tierStr === '0') {
    return 0;
  }

  // If functionalTier is empty/null, default to base_value
  if (!tierStr || tierStr === 'null' || tierStr === 'undefined') {
    return row.base_value;
  }
  
  // If tier is in functional_tiers, return it
  if (row.functional_tiers[tierStr] !== undefined) {
    return row.functional_tiers[tierStr];
  }
  
  // Fallback to base_value
  return row.base_value;
}

const TITLE_PATTERN = /^(KH\.?|Hj\.?|HJ\.?|H\.?|Ust\.?|Ustadz|Ustadzah|Gus|Nyai|Ning|Lora|Prof\.?|Dr\.?|DR\.?|Drs\.?|DRS\.?|Dra\.?|DRA\.?|Ir\.?|IR\.?)$/i;
const DEGREE_PATTERN = /^(S\.|M\.|A\.|SST|SE|SS|SH|ST|MA|MM|MBA|MSi|PhD|Ph\.D\.?|Ners\.?|Apt\.?|Lc\.?|LC\.?|Ns\.?|Dr\.?|DR\.?|M\.?Pd\.?I?|M\.?Tr\.?|Keb\.?|Kes\.?)$/i;

export function normalizeName(fullName: string): string {
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

export const MANUAL_OVERRIDES: Record<string, string> = {
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
  
  // Confirmed matches for Koperasi users:
  'Afsah Novita Sari': 'Afsah Novitasari, S.Si, M.Pd,',
  'Anggria Maduratih': 'Anggrea Maduratih, S.AB',
  'M Abdul Rokhim': 'Mokhamad Abdul Rokhim',
  'Khoirul Anwar': 'KHOIRUL A',
  'M Ali Nawawi': 'M.Ali Nawawi, SE., MM',
  'M Fatoni': 'FATHONI',
  'Maisarah ': 'Maisaroh, M.Si',
  'Maisarah': 'Maisaroh, M.Si',
  'Muhamad Zaki ': 'Muhammad Zaky, SE.M.Pd',
  'Muhamad Zaki': 'Muhammad Zaky, SE.M.Pd',
  'Muhammad Fuady': 'MUHAMAD FUADY',
  'Muhammad Miftakhul Syaikhuddin': 'Muhammad Miftakhul Syakhuddin',
  'Muhammad Zulfikar Asumta ': "DR.dr.H.M. Zulfikar As'ad, MMR",
  'Muhammad Zulfikar Asumta': "DR.dr.H.M. Zulfikar As'ad, MMR",
  'Mukhamad Masrur': 'M. Masrur, S. Kom.M. Kom.',
  'Nurul Lailiyah.s.ab.m.si': 'Nurul Lailiyah',
  'Sholihuddin': 'Sholahuddin, S.Pdi',
  'Siti Asiah M. Pd': 'Siti Asiah, M.Pd.',
  'Suspahariati': 'Hj. Suspa Hariati, S. Sos.',
  'Ahmad Mundzir': 'Achmad Mundzir, S.HI',
  'Ahmad Zahro': 'Prof. DR.H. Ahmad Zahro, MA.',
  'Dian Puspita Yani ': 'Dian Puspitayani, SST.M.Kes.',
  'Dian Puspita Yani': 'Dian Puspitayani, SST.M.Kes.',
  'Sabrina Dwi Prihartini': 'Hj.Sabrina Dwi Prihatini, SKM., M.Kes',
  'Mujianto Solichin': 'Dr. Mujianto Sholichin, M. PdI.',
  'Siti Roudhotul Jannah ': 'Siti Roudhatul Jannah, SST.Keb. M. Tr. Keb.',
  'Siti Roudhotul Jannah': 'Siti Roudhatul Jannah, SST.Keb. M. Tr. Keb.',
};

