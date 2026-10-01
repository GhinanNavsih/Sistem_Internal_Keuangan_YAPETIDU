/** Enrollment history is retained so an older payroll period can be recalculated. */
export const DEPENDENT_LEVELS = ['SD', 'SLTP', 'SLTA', 'S1', 'S2'] as const;
export type DependentLevel = (typeof DEPENDENT_LEVELS)[number];
export type StoredDependentLevel = DependentLevel | 'PT'; // Existing college counts have no degree information.

export interface DependentEnrollment {
  id: string;
  /** Stable identity shared by all school stages of one child. Old rows use id. */
  child_id?: string;
  level: StoredDependentLevel;
  enrolled_at: string;
  /**
   * SD children are entered by birth date instead of enrolment: the allowance
   * runs from birth to the 13th birthday, so a child who has not started school
   * yet is covered too. `enrolled_at` then mirrors this date as the allowance
   * start. Older SD rows have no birth date and keep ending at enrolment + 6 years.
   */
  birth_date?: string;
  /** The first date on which a manually removed dependent is ineligible. */
  ended_at?: string;
  /** Admin has reviewed graduation and confirmed there is no next school stage. */
  no_further_study?: boolean;
}

export interface DependentChild {
  id: string;
  stages: DependentEnrollment[];
  latest: DependentEnrollment;
}

const NEXT_LEVEL: Partial<Record<DependentLevel, DependentLevel>> = {
  SD: 'SLTP', SLTP: 'SLTA', SLTA: 'S1', S1: 'S2',
};

export function nextDependentLevel(level: StoredDependentLevel): DependentLevel | null {
  return level === 'PT' ? null : NEXT_LEVEL[level] || null;
}

export interface FamilyAllowanceMetrics {
  spouse_count?: number;
  children_sd?: number;
  children_sltp?: number;
  children_slta?: number;
  children_pt?: number;
  children_s1?: number;
  children_s2?: number;
  dependents?: DependentEnrollment[];
  [key: string]: unknown;
}

const YEARS: Record<DependentLevel, number> = { SD: 6, SLTP: 3, SLTA: 3, S1: 4, S2: 2 };
const COUNT_FIELD: Record<StoredDependentLevel, keyof FamilyAllowanceMetrics> = {
  SD: 'children_sd', SLTP: 'children_sltp', SLTA: 'children_slta',
  S1: 'children_s1', S2: 'children_s2', PT: 'children_pt',
};

function count(value: unknown): number {
  const number = Number(value);
  return Number.isSafeInteger(number) && number > 0 ? Math.min(number, 100) : 0;
}

function isUndatedLegacyDependent(dependent: DependentEnrollment): boolean {
  return /^legacy-(SD|SLTP|SLTA|S1|S2|PT)-\d+$/.test(dependent.id) &&
    dependent.level === dependent.id.split('-')[1];
}

export function isDateOnly(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

export function dateOnly(value: Date | string): string {
  if (typeof value === 'string') return value.slice(0, 10);
  return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, '0')}-${String(value.getDate()).padStart(2, '0')}`;
}

export function todayInJakarta(): string {
  return new Date(Date.now() + 7 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

/** Adds whole years; a leap-day date lands on the final day of February in the target year. */
function addYearsClamped(date: string, years: number): string {
  const [year, month, day] = date.split('-').map(Number);
  const lastDay = new Date(Date.UTC(year + years, month, 0)).getUTCDate();
  return `${year + years}-${String(month).padStart(2, '0')}-${String(Math.min(day, lastDay)).padStart(2, '0')}`;
}

/** A leap-day enrollment ends on the final day of February in the target year. */
export function graduationDate(enrolledAt: string, level: DependentLevel): string {
  if (!isDateOnly(enrolledAt)) throw new Error('Tanggal masuk sekolah tidak valid.');
  return addYearsClamped(enrolledAt, YEARS[level]);
}

/** SD age 7 plus the 6 years of SD. */
export const SD_GRADUATION_AGE = 13;

/** The 13th birthday, when an SD child's allowance ends. */
export function sdGraduationDateFromBirth(birthDate: string): string {
  if (!isDateOnly(birthDate)) throw new Error('Tanggal lahir tidak valid.');
  return addYearsClamped(birthDate, SD_GRADUATION_AGE);
}

/**
 * The first day a stage no longer pays: the 13th birthday for an SD child
 * entered by birth date, enrolment + the school's years otherwise. A college
 * row of unknown degree (`PT`) has no end date.
 */
export function stageGraduationDate(
  stage: Pick<DependentEnrollment, 'level' | 'enrolled_at' | 'birth_date'>,
): string {
  if (stage.level === 'PT') return '';
  if (stage.level === 'SD' && isDateOnly(stage.birth_date)) return sdGraduationDateFromBirth(stage.birth_date);
  return graduationDate(stage.enrolled_at, stage.level);
}

/** Old records have counts only. Keep them eligible until an admin supplies dates. */
export function dependentHistory(metrics: FamilyAllowanceMetrics | null | undefined): DependentEnrollment[] {
  if (Array.isArray(metrics?.dependents)) return metrics.dependents;
  const result: DependentEnrollment[] = [];
  const s1 = count(metrics?.children_s1);
  const s2 = count(metrics?.children_s2);
  const collegeUnclassified = Math.max(0, count(metrics?.children_pt) - s1 - s2);
  for (const level of ['SD', 'SLTP', 'SLTA', 'S1', 'S2', 'PT'] as const) {
    const total = level === 'PT' ? collegeUnclassified : count(metrics?.[COUNT_FIELD[level]]);
    for (let index = 0; index < total; index++) {
      result.push({ id: `legacy-${level}-${index + 1}`, level, enrolled_at: '' });
    }
  }
  return result;
}

export function dependentChildren(metrics: FamilyAllowanceMetrics | null | undefined): DependentChild[] {
  const children = new Map<string, DependentEnrollment[]>();
  for (const stage of dependentHistory(metrics)) {
    // Read paths must tolerate malformed legacy documents. The save validator
    // still rejects them instead of silently persisting a damaged history.
    if (!stage || typeof stage.id !== 'string' || !stage.id ||
      !['SD', 'SLTP', 'SLTA', 'S1', 'S2', 'PT'].includes(stage.level)) continue;
    const id = typeof stage.child_id === 'string' && stage.child_id ? stage.child_id : stage.id;
    const stages = children.get(id) || [];
    stages.push(stage);
    children.set(id, stages);
  }
  return [...children].map(([id, stages]) => ({ id, stages, latest: stages[stages.length - 1] }));
}

export function pendingGraduatedChildren(metrics: FamilyAllowanceMetrics | null | undefined, asOf: Date | string) {
  const day = dateOnly(asOf);
  return dependentChildren(metrics).flatMap((child, index) => {
    const latest = child.latest;
    if (latest.level === 'PT' || latest.level === 'S2' || !isDateOnly(latest.enrolled_at) ||
      latest.ended_at || latest.no_further_study) return [];
    const graduatedAt = stageGraduationDate(latest);
    return graduatedAt <= day ? [{ ...child, childNumber: index + 1, graduatedAt }] : [];
  });
}

export function isDependentEligible(dependent: DependentEnrollment, asOf: Date | string): boolean {
  const day = dateOnly(asOf);
  if (dependent.ended_at && isDateOnly(dependent.ended_at) && dependent.ended_at <= day) return false;
  // Only legacy entries can remain eligible without a date. A newly added row
  // cannot affect pay until its required enrollment date has been entered.
  if (!isDateOnly(dependent.enrolled_at)) return !dependent.enrolled_at && isUndatedLegacyDependent(dependent);
  if (dependent.enrolled_at > day) return false;
  return dependent.level === 'PT' || day < stageGraduationDate(dependent);
}

export function eligibleFamilyMetrics(metrics: FamilyAllowanceMetrics | null | undefined, asOf: Date | string) {
  const result = {
    spouse_count: count(metrics?.spouse_count),
    children_sd: 0, children_sltp: 0, children_slta: 0,
    children_s1: 0, children_s2: 0, children_pt: 0,
  };
  const day = dateOnly(asOf);
  for (const child of dependentChildren(metrics)) {
    // Later enrollment supersedes the previous stage. A gap between stages
    // therefore pays nothing, and linked stages can never double count.
    const dependent = [...child.stages].reverse().find(stage =>
      isDateOnly(stage.enrolled_at) ? stage.enrolled_at <= day :
        !stage.enrolled_at && isUndatedLegacyDependent(stage),
    );
    if (!dependent || !isDependentEligible(dependent, day)) continue;
    switch (dependent.level) {
      case 'SD': result.children_sd++; break;
      case 'SLTP': result.children_sltp++; break;
      case 'SLTA': result.children_slta++; break;
      case 'S1': result.children_s1++; result.children_pt++; break;
      case 'S2': result.children_s2++; result.children_pt++; break;
      case 'PT': result.children_pt++; break;
    }
  }
  return result;
}

/** Use month end so enrollment counts in its month and graduation stops it. */
export function familyAllowancePeriodDate(period?: string | Date): string {
  const token = period instanceof Date
    ? `${period.getFullYear()}-${String(period.getMonth() + 1).padStart(2, '0')}`
    : period || '';
  const match = /^(\d{4})[-_](0[1-9]|1[0-2])$/.exec(token);
  if (!match) return todayInJakarta();
  const lastDay = new Date(Date.UTC(Number(match[1]), Number(match[2]), 0)).getUTCDate();
  return `${match[1]}-${match[2]}-${lastDay}`;
}

export function familyAllowancePercentage(metrics: ReturnType<typeof eligibleFamilyMetrics>): number {
  return metrics.spouse_count * 0.05 + metrics.children_sd * 0.05 +
    metrics.children_sltp * 0.075 + metrics.children_slta * 0.1 + metrics.children_pt * 0.125;
}

/** Keep draft and newly locked T. Keluarga in sync with profile dependents. */
export function synchronizeFamilyAllowanceEarnings<T extends { label: string; amount: number }>(
  fields: readonly T[],
  metrics: FamilyAllowanceMetrics | null | undefined,
  period: string,
): T[] {
  if (!metrics) return [...fields];
  const gapok = fields.find((field) => field.label.trim().toLowerCase() === 'gaji pokok')?.amount;
  if (gapok === undefined) return [...fields];
  const expected = Math.round(gapok * familyAllowancePercentage(
    eligibleFamilyMetrics(metrics, familyAllowancePeriodDate(period)),
  ));
  let seen = false;
  const updated = fields.flatMap((field) => {
    const label = field.label.trim().toLowerCase();
    if (label !== 't. keluarga' && label !== 'tunjangan keluarga') return [field];
    if (seen) return [];
    seen = true;
    return [{ ...field, amount: expected }];
  });
  return seen ? updated : [...updated, { label: 'T. Keluarga', amount: expected } as T];
}

export function validateDependentHistory(metrics: FamilyAllowanceMetrics, today: string): void {
  if (!Array.isArray(metrics.dependents)) return;
  if (metrics.dependents.length > 100) throw new Error('Jumlah riwayat tanggungan terlalu banyak.');
  const ids = new Set<string>();
  for (const dependent of metrics.dependents) {
    if (!dependent || typeof dependent.id !== 'string' || !dependent.id || ids.has(dependent.id) ||
      !['SD', 'SLTP', 'SLTA', 'S1', 'S2', 'PT'].includes(dependent.level)) {
      throw new Error('Data tanggungan keluarga tidak valid.');
    }
    ids.add(dependent.id);
    if (dependent.child_id !== undefined && (typeof dependent.child_id !== 'string' || !dependent.child_id)) {
      throw new Error('Identitas anak pada riwayat tanggungan tidak valid.');
    }
    if (dependent.no_further_study !== undefined && typeof dependent.no_further_study !== 'boolean') {
      throw new Error('Keputusan pendidikan lanjutan tidak valid.');
    }
    if (!dependent.enrolled_at && !isUndatedLegacyDependent(dependent)) {
      throw new Error(dependent.level === 'SD'
        ? 'Tanggal lahir anak SD wajib diisi.'
        : `Tanggal pertama masuk ${dependent.level} wajib diisi untuk setiap anak.`);
    }
    if (dependent.birth_date !== undefined) {
      if (dependent.level !== 'SD') {
        throw new Error('Tanggal lahir hanya digunakan untuk anak SD.');
      }
      if (!isDateOnly(dependent.birth_date) || dependent.birth_date > today) {
        throw new Error('Tanggal lahir anak harus tanggal yang valid dan tidak di masa depan.');
      }
      if (dependent.enrolled_at !== dependent.birth_date) {
        throw new Error('Tanggal mulai tunjangan anak SD harus sama dengan tanggal lahirnya.');
      }
    }
    if (dependent.level === 'PT' && dependent.enrolled_at) {
      throw new Error('Anak kuliah lama harus dipilih S1 atau S2 sebelum tanggal masuk dicatat.');
    }
    if (dependent.enrolled_at && (!isDateOnly(dependent.enrolled_at) || dependent.enrolled_at > today)) {
      throw new Error(`Tanggal pertama masuk ${dependent.level} harus tanggal yang valid dan tidak di masa depan.`);
    }
    if (dependent.ended_at && !isDateOnly(dependent.ended_at)) {
      throw new Error('Tanggal berhenti tunjangan tidak valid.');
    }
  }
  for (const child of dependentChildren(metrics)) {
    if (child.stages.length === 1) {
      const stage = child.latest;
      if (stage.no_further_study && (stage.level === 'PT' || stage.level === 'S2' ||
        !isDateOnly(stage.enrolled_at) || stageGraduationDate(stage) > today)) {
        throw new Error('Keputusan tidak lanjut hanya dapat dicatat setelah anak lulus.');
      }
      continue;
    }
    if (!ids.has(child.id) || child.stages[0].id !== child.id) {
      throw new Error('Riwayat jenjang anak harus terhubung ke jenjang pertamanya.');
    }
    for (let index = 1; index < child.stages.length; index++) {
      const previous = child.stages[index - 1];
      const current = child.stages[index];
      const legacyTransition = !previous.enrolled_at && isUndatedLegacyDependent(previous) &&
        (previous.level === 'PT'
          ? current.level === 'S1' || current.level === 'S2'
          : nextDependentLevel(previous.level) === current.level);
      const datedTransition = previous.level !== 'PT' && isDateOnly(previous.enrolled_at) &&
        nextDependentLevel(previous.level) === current.level && isDateOnly(current.enrolled_at) &&
        current.enrolled_at >= stageGraduationDate(previous);
      if ((!legacyTransition && !datedTransition) || !isDateOnly(current.enrolled_at) ||
        previous.no_further_study || previous.ended_at) {
        throw new Error('Jenjang lanjutan harus sesuai urutan sekolah dan dimulai setelah jenjang sebelumnya lulus.');
      }
    }
    if (child.stages.some(stage => stage !== child.latest && stage.no_further_study)) {
      throw new Error('Keputusan tidak lanjut hanya berlaku untuk jenjang terakhir.');
    }
    const latest = child.latest;
    if (latest.no_further_study && (latest.level === 'S2' ||
      stageGraduationDate(latest) > today)) {
      throw new Error('Keputusan tidak lanjut hanya dapat dicatat setelah anak lulus.');
    }
  }
}

/** Numeric fields remain a current snapshot for older readers; history decides payroll eligibility. */
export function withCurrentFamilyCounts(metrics: FamilyAllowanceMetrics, asOf: Date | string): FamilyAllowanceMetrics {
  return { ...metrics, ...eligibleFamilyMetrics(metrics, asOf) };
}
