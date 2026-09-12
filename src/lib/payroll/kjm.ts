/** Shared, deterministic KJM calculation. No client-supplied money is accepted. */
export const KJM_SOURCE_KIND = 'kjm_import';
export const KJM_RULE_VERSION = '2026-09-09-health-obligation-v1';
export type KjmType = 'Keluarga' | 'Dosen' | 'Admin';
export interface KjmCourse {
  id: string; sheet: string; row: number; lecturer: string; nipy: string;
  program: string; code: string; name: string; kelas: string;
  sks: number; attendance: number;
}
export interface KjmCourseGroup {
  key: string; program: string; code: string; name: string;
  courseIds: string[]; classes: string[]; sks: number[];
}
export interface KjmEmployee {
  id: string; name: string; nipy: string; active: boolean;
  type: string; isDosen: boolean | null; education: string; role: string;
  recognizedDate: string;
}
export interface KjmRate { degree: string; group: string; amount: number }
export interface KjmAdjustment { consortium?: boolean; attendance?: number; exclude?: boolean; reason?: string }
export interface KjmAssignment { employeeId?: string; exclude?: boolean; reason?: string; rateKey?: string }
export interface KjmEdits {
  courses: Record<string, KjmAdjustment>;
  lecturers: Record<string, KjmAssignment>;
  consortiumReviewed: boolean;
}
export interface KjmResult {
  employee: KjmEmployee; regular: number; consortium: number;
  base: number; reduction: number; obligation: number; cap: number;
  excess: number; regularExcess: number; consortiumExcess: number;
  rate: number; rateKey: string; regularPay: number; consortiumPay: number; total: number;
}
export const emptyKjmEdits = (): KjmEdits => ({ courses: {}, lecturers: {}, consortiumReviewed: false });
export const normalizeKjmNipy = (value: unknown) => String(value ?? '').replace(/\s+/g, '');
const normalizeKjmCoursePart = (value: unknown) => String(value ?? '').trim().toLocaleLowerCase('id-ID').replace(/\s+/g, ' ');
export function isKjmCourseExcludedFromRekap(course: Pick<KjmCourse, 'sheet' | 'program' | 'kelas' | 'name'>): boolean {
  if (normalizeKjmCoursePart(course.sheet) !== 'tetap asli') return false;
  return normalizeKjmCoursePart(course.program).includes('ners') ||
    normalizeKjmCoursePart(course.kelas).includes('rpl') ||
    normalizeKjmCoursePart(course.name).includes('praktek') ||
    normalizeKjmCoursePart(course.name).includes('praktik');
}
export function filterKjmCourses(courses: readonly KjmCourse[]): KjmCourse[] {
  return courses.filter(course => !isKjmCourseExcludedFromRekap(course));
}
export function kjmCourseGroupKey(course: Pick<KjmCourse, 'program' | 'code'>): string {
  return JSON.stringify([normalizeKjmCoursePart(course.program), normalizeKjmCoursePart(course.code)]);
}
export function groupKjmCourses(courses: readonly KjmCourse[]): KjmCourseGroup[] {
  const groups = new Map<string, KjmCourseGroup>();
  for (const course of courses) {
    const key = kjmCourseGroupKey(course);
    const group = groups.get(key) || {
      key, program: course.program, code: course.code, name: course.name,
      courseIds: [], classes: [], sks: [],
    };
    group.courseIds.push(course.id);
    if (course.kelas && !group.classes.includes(course.kelas)) group.classes.push(course.kelas);
    if (!group.sks.includes(course.sks)) group.sks.push(course.sks);
    groups.set(key, group);
  }
  return [...groups.values()].sort((a, b) => `${a.program} ${a.code} ${a.name}`.localeCompare(`${b.program} ${b.code} ${b.name}`, 'id-ID'));
}
export function kjmAssessmentDate(period: string): string {
  if (!/^20\d{2}-(0[1-9]|1[0-2])$/.test(period)) throw new Error('Periode tidak valid.');
  const [year, month] = period.split('-').map(Number);
  return `${period}-${new Date(Date.UTC(year, month, 0)).getUTCDate()}`;
}
export function kjmAdminCap(recognized: string, period: string): number {
  const asOf = kjmAssessmentDate(period);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(recognized) || recognized > asOf ||
      !Number.isFinite(Date.parse(recognized)) || new Date(recognized).toISOString().slice(0, 10) !== recognized) {
    throw new Error('Tanggal Diakui Admin kosong/tidak valid/melebihi periode.');
  }
  const anniversary = `${Number(recognized.slice(0, 4)) + 12}${recognized.slice(4)}`;
  return asOf >= anniversary ? 126 : 84;
}
function isKjmHealthEducation(education: string): boolean {
  return education.toLocaleLowerCase('id-ID').includes('kesehatan');
}
export function calculateKjm(employee: KjmEmployee, regular: number, consortium: number, rate: KjmRate, period: string): KjmResult {
  if (!['Keluarga', 'Dosen', 'Admin'].includes(employee.type)) throw new Error('Tipe Loyalis belum valid.');
  if (!employee.active) throw new Error('Pegawai Non-Aktif tidak boleh dibayar.');
  if (employee.type === 'Dosen' && employee.isDosen !== true) throw new Error('Status isDosen belum true; periksa master pegawai.');
  if (![regular, consortium, rate.amount].every(n => Number.isFinite(n) && n >= 0) || !Number.isSafeInteger(rate.amount)) throw new Error('Jam/rate tidak valid.');
  if (employee.type === 'Dosen' && !employee.role.trim()) throw new Error('Jabatan Dosen belum diisi di master pegawai.');
  const healthObligation = employee.type === 'Dosen' && isKjmHealthEducation(employee.education) ? 56 : null;
  const base = employee.type === 'Dosen' ? healthObligation ?? 112 : 0;
  const reduction = base && healthObligation === null && employee.role.trim().toLowerCase() !== 'dosen' ? 28 : 0;
  const obligation = Math.max(0, base - reduction);
  const cap = employee.type === 'Admin' ? kjmAdminCap(employee.recognizedDate, period) : 252;
  const excess = Math.min(cap, Math.max(0, regular + consortium - obligation));
  const consortiumExcess = Math.min(consortium, excess);
  const regularExcess = excess - consortiumExcess;
  const regularPay = Math.round(regularExcess * rate.amount);
  const consortiumPay = Math.round(consortiumExcess * 25000);
  const total = regularPay + consortiumPay;
  if (!Number.isSafeInteger(total) || total > 100_000_000) throw new Error('Nilai KJM melampaui batas validasi.');
  return { employee, regular, consortium, base, reduction, obligation, cap, excess, regularExcess, consortiumExcess,
    rate: rate.amount, rateKey: `${rate.degree}-${rate.group}`, regularPay, consortiumPay, total };
}

export function reviewKjm(courses: KjmCourse[], edits: KjmEdits, employees: KjmEmployee[], rates: KjmRate[], period: string) {
  kjmAssessmentDate(period);
  const issues: string[] = [];
  const ignored: string[] = [];
  const assignments: Record<string, string> = {};
  const totals = new Map<string, { regular: number; consortium: number; rateKey: string }>();
  const seenCourses = new Map<string, string>();
  const includedCourses = filterKjmCourses(courses);
  const ids = new Set(courses.map(c => c.id));
  const allLecturers = [...new Set(courses.map(c => c.lecturer))];
  const lecturers = [...new Set(includedCourses.map(c => c.lecturer))];
  if (!edits.consortiumReviewed) issues.push('Konfirmasi pemeriksaan penandaan konsorsium belum dicentang.');
  if (Object.keys(edits.courses).some(id => !ids.has(id)) || Object.keys(edits.lecturers).some(id => !allLecturers.includes(id))) {
    issues.push('Koreksi merujuk baris/dosen yang tidak ada dalam sumber.');
  }
  for (const lecturer of lecturers) {
    const source = includedCourses.filter(c => c.lecturer === lecturer);
    const assignment = edits.lecturers[lecturer] || {};
    const exact = employees.filter(e => e.nipy && e.nipy === source[0].nipy);
    // Inactive source identities cannot be reassigned to another active employee.
    if (exact.length > 0 && exact.every(e => !e.active)) { ignored.push(`${lecturer}: Non-Aktif`); continue; }
    if (assignment.exclude) {
      if (!assignment.reason?.trim()) issues.push(`${lecturer}: alasan pengecualian wajib.`);
      ignored.push(`${lecturer}: ${assignment.reason || 'tanpa alasan'}`); continue;
    }
    const eligible = exact.filter(e => e.active);
    const employee = assignment.employeeId ? employees.find(e => e.id === assignment.employeeId && e.active) : eligible.length === 1 ? eligible[0] : undefined;
    if (!employee) { issues.push(`${lecturer}: pilih pegawai aktif atau kecualikan dengan alasan.`); continue; }
    assignments[lecturer] = employee.id;
    const defaultRate = rates.find(r => `${r.degree}-${r.group}`.toLowerCase() === employee.education.trim().toLowerCase());
    const rateKey = assignment.rateKey || (defaultRate ? `${defaultRate.degree}-${defaultRate.group}` : '');
    const previous = totals.get(employee.id);
    if (previous && previous.rateKey !== rateKey) issues.push(`${employee.name}: rate berbeda pada beberapa blok dosen.`);
    const sum = previous || { regular: 0, consortium: 0, rateKey };
    for (const course of source) {
      const edit = edits.courses[course.id] || {};
      if (edit.exclude) continue;
      const attendance = edit.attendance ?? course.attendance;
      if (!Number.isInteger(attendance) || attendance < 0 || attendance > 100 || !Number.isFinite(course.sks) || course.sks <= 0 || course.sks > 30) {
        issues.push(`${course.sheet}:${course.row}: SKS/hadir tidak valid.`); continue;
      }
      const weighted = course.sks * Math.min(attendance, 14);
      const identity = JSON.stringify([employee.id, course.program.trim().toLowerCase(), course.code, course.kelas]);
      const first = seenCourses.get(identity);
      if (first) issues.push(`${course.sheet}:${course.row}: mata kuliah/kelas duplikat dengan ${first}; kecualikan satu baris dengan alasan.`);
      else seenCourses.set(identity, `${course.sheet}:${course.row}`);
      if (edit.consortium) sum.consortium += weighted; else sum.regular += weighted;
    }
    totals.set(employee.id, sum);
  }
  const results: KjmResult[] = [];
  for (const [id, sum] of totals) {
    const employee = employees.find(e => e.id === id)!;
    const rate = rates.find(r => `${r.degree}-${r.group}` === sum.rateKey);
    if (!rate) { issues.push(`${employee.name}: pendidikan tidak ditemukan di matrix; pilih rate dan alasan.`); continue; }
    try { results.push(calculateKjm(employee, sum.regular, sum.consortium, rate, period)); }
    catch (e) { issues.push(`${employee.name}: ${(e as Error).message}`); }
  }
  if (!results.length) issues.push('Tidak ada pegawai yang dapat dihitung.');
  return { results, issues, ignored, assignments, total: results.reduce((n, r) => n + r.total, 0), assessmentDate: kjmAssessmentDate(period) };
}
export type KjmReview = ReturnType<typeof reviewKjm>;
