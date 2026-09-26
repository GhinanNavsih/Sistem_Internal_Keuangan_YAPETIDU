/**
 * Pekarya → Loyalis conversion rules. Pure: no Firebase import, so the API
 * route, the dialog, the payroll roster and the payslip page all read the same
 * answer to "which record pays this person in this month?".
 *
 * A conversion never renames a record. The person gets a new
 * `Employees_Loyalis/Loyalis_NNN` document and the old
 * `Employees_BlueCollar/BC_NNN` one is closed with a pointer to it, so every
 * slip, report and journey filed under the old id stays where it is. Both
 * documents carry a `conversion` block naming the month the switch took
 * effect: the old record pays every month before it, the new one every month
 * from it onwards.
 */
import { normalizeNipy } from './payroll/attendance';

export const EMPLOYEE_CONVERSION_REASON_MIN_LENGTH = 8;
export const EMPLOYEE_CONVERSION_REASON_MAX_LENGTH = 500;
/** From this day of the month the admin is reminded the whole month pays as Loyalis. */
export const EMPLOYEE_CONVERSION_LATE_MONTH_DAY = 11;

export const LOYALIS_TYPES = ['Keluarga', 'Dosen', 'Admin'] as const;
export type LoyalisType = (typeof LOYALIS_TYPES)[number];

export type ConversionEmployeeCollection =
  | 'Employees_BlueCollar'
  | 'Employees_Loyalis';

/** Stored on the new Loyalis record. */
export interface ConversionFromLink {
  fromCollection: 'Employees_BlueCollar';
  fromEmployeeId: string;
  effectivePeriod: string;
}

/** Stored on the closed Pekarya record. */
export interface ConversionToLink {
  toCollection: 'Employees_Loyalis';
  toEmployeeId: string;
  effectivePeriod: string;
}

export interface LoyalisConversionInput {
  name: string;
  nik: string;
  phone: string;
  email: string;
  bankName: string;
  accountNumber: string;
  /** Mulai Kerja, YYYY-MM-DD. */
  dateOfHire: string;
  /** Masa Kerja Diakui, YYYY-MM-DD; empty means not recognised separately. */
  dateRecognized: string;
  departmentUnit: string;
  loyalisType: LoyalisType | '';
  isDosen: boolean | null;
  educationLevel: string;
  /** Golongan. Only a Super Admin may send a non-empty value. */
  levelCode: string;
  bpjsTk: number;
  bpjsKes: number;
  spouseCount: number;
  childrenSd: number;
  childrenSltp: number;
  childrenSlta: number;
  childrenPt: number;
}

export type LoyalisConversionInputErrors = Partial<
  Record<keyof LoyalisConversionInput, string>
>;

export type EmployeeConversionIssueCode =
  | 'PREVIOUS_PERIOD_OPEN'
  | 'EFFECTIVE_PERIOD_CLOSED'
  | 'EMPLOYEE_INACTIVE'
  | 'ALREADY_CONVERTED'
  | 'SLIP_IN_EFFECTIVE_PERIOD'
  | 'PENDING_ACTIVITY_REPORTS'
  | 'ACTIVITY_IN_EFFECTIVE_PERIOD'
  | 'OPEN_DRIVER_JOURNEYS'
  | 'DRIVER_JOURNEYS_IN_EFFECTIVE_PERIOD'
  | 'UPCOMING_DRIVER_PIKET'
  | 'SPJ_EVENT_IN_EFFECTIVE_PERIOD'
  | 'URAIAN_IN_EFFECTIVE_PERIOD'
  | 'PENDING_OFFICIAL_LEAVE'
  | 'PENDING_SATPAM_ABSENCE'
  | 'PENDING_ANNUAL_LEAVE'
  | 'SATPAM_TEAM_MEMBER'
  | 'MULTIPLE_LINKED_ACCOUNTS'
  | 'LINKED_ACCOUNT_ROLE'
  | 'NIPY_OWNED_ELSEWHERE'
  | 'NO_LINKED_ACCOUNT'
  | 'LINKED_ACCOUNT_DISABLED'
  | 'NO_NIPY'
  | 'LEVEL_CODE_EMPTY'
  | 'LATE_IN_MONTH';

export interface EmployeeConversionIssue {
  code: EmployeeConversionIssueCode;
  message: string;
}

export interface EmployeeConversionFacts {
  today: string;
  effectivePeriod: string;
  previousPeriodClosed: boolean;
  effectivePeriodClosed: boolean;
  employeeActive: boolean;
  alreadyConverted: boolean;
  nipy: string;
  /** Periods (YYYY-MM) at or after the effective one that already hold a slip. */
  slipPeriodsFromEffective: string[];
  pendingActivityReports: number;
  activityReportsInEffectivePeriod: number;
  openDriverJourneys: number;
  driverJourneysInEffectivePeriod: number;
  upcomingDriverPiket: number;
  spjEventsInEffectivePeriod: number;
  uraianPaidInEffectivePeriod: boolean;
  pendingOfficialLeave: number;
  pendingSatpamAbsences: number;
  pendingAnnualLeave: number;
  satpamTeamNames: string[];
  linkedAccounts: Array<{ uid: string; role: string; disabled: boolean }>;
  /** Name of another record already holding this NIPY, if any. */
  nipyOwnedElsewhere: string | null;
  levelCodeProvided: boolean;
}

const PERIOD_RE = /^(\d{4})[-_](\d{2})$/;
const DATE_ONLY_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

export function normalizeConversionPeriod(value: unknown): string {
  const match = PERIOD_RE.exec(String(value ?? '').trim());
  return match ? `${match[1]}-${match[2]}` : '';
}

export function shiftConversionPeriod(period: string, months: number): string {
  const normalized = normalizeConversionPeriod(period);
  if (!normalized) throw new Error('Periode tidak valid.');
  const [year, month] = normalized.split('-').map(Number);
  const shifted = new Date(Date.UTC(year, month - 1 + months, 1));
  return `${shifted.getUTCFullYear()}-${String(shifted.getUTCMonth() + 1).padStart(2, '0')}`;
}

/**
 * The switch always takes effect at the start of the month it is made in
 * (Jakarta date). Every payroll period since 2026-08 is the calendar month, so
 * the whole of that month pays as Loyalis and the month before stays Pekarya.
 */
export function conversionEffectivePeriod(todayDateOnly: string): string {
  if (!isValidDateOnly(todayDateOnly)) throw new Error('Tanggal tidak valid.');
  return todayDateOnly.slice(0, 7);
}

/** Last calendar day of the month before `period`, as YYYY-MM-DD. */
export function lastDayBeforePeriod(period: string): string {
  const normalized = normalizeConversionPeriod(period);
  if (!normalized) throw new Error('Periode tidak valid.');
  const [year, month] = normalized.split('-').map(Number);
  const lastDay = new Date(Date.UTC(year, month - 1, 0));
  return lastDay.toISOString().slice(0, 10);
}

export function isValidDateOnly(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  const match = DATE_ONLY_RE.exec(value);
  if (!match) return false;
  const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])];
  const date = new Date(Date.UTC(year, month - 1, day));
  return (
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day
  );
}

type AnyRecord = Record<string, unknown>;

function asRecord(value: unknown): AnyRecord {
  return value && typeof value === 'object' ? (value as AnyRecord) : {};
}

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function money(value: unknown): number {
  const amount = Number(value);
  return Number.isFinite(amount) && amount > 0 ? Math.round(amount) : 0;
}

function count(value: unknown): number {
  const amount = Number(value);
  return Number.isSafeInteger(amount) && amount > 0 ? amount : 0;
}

/**
 * A stored date as YYYY-MM-DD: Pekarya keeps ISO strings, Loyalis keeps
 * Firestore Timestamps (anything with `toDate()`).
 */
export function storedDateOnly(value: unknown): string {
  if (!value) return '';
  if (typeof value === 'string') {
    const candidate = value.slice(0, 10);
    return isValidDateOnly(candidate) ? candidate : '';
  }
  const maybeTimestamp = value as { toDate?: () => Date };
  const date =
    typeof maybeTimestamp.toDate === 'function'
      ? maybeTimestamp.toDate()
      : value instanceof Date
        ? value
        : null;
  if (!date || Number.isNaN(date.getTime())) return '';
  return date.toISOString().slice(0, 10);
}

export function readConversionFromLink(data: unknown): ConversionFromLink | null {
  const conversion = asRecord(asRecord(data).conversion);
  const fromEmployeeId = text(conversion.fromEmployeeId);
  const effectivePeriod = normalizeConversionPeriod(conversion.effectivePeriod);
  if (!fromEmployeeId || !effectivePeriod) return null;
  return { fromCollection: 'Employees_BlueCollar', fromEmployeeId, effectivePeriod };
}

export function readConversionToLink(data: unknown): ConversionToLink | null {
  const conversion = asRecord(asRecord(data).conversion);
  const toEmployeeId = text(conversion.toEmployeeId);
  const effectivePeriod = normalizeConversionPeriod(conversion.effectivePeriod);
  if (!toEmployeeId || !effectivePeriod) return null;
  return { toCollection: 'Employees_Loyalis', toEmployeeId, effectivePeriod };
}

/** A Pekarya record whose person now lives in `Employees_Loyalis`. */
export function isConvertedAway(data: unknown): boolean {
  return readConversionToLink(data) !== null;
}

/**
 * Whether a record takes part in `period`'s payroll. Records never touched by a
 * conversion always do (their own active flags still decide eligibility); a
 * converted Loyalis record only from its effective month, and the closed
 * Pekarya record only before it.
 */
export function employeeInPayrollPeriod(
  collection: string,
  data: unknown,
  period: string,
): boolean {
  const normalizedPeriod = normalizeConversionPeriod(period);
  if (!normalizedPeriod) return true;
  if (collection === 'Employees_Loyalis') {
    const from = readConversionFromLink(data);
    return !from || normalizedPeriod >= from.effectivePeriod;
  }
  if (collection === 'Employees_BlueCollar') {
    const to = readConversionToLink(data);
    return !to || normalizedPeriod < to.effectivePeriod;
  }
  return true;
}

/**
 * For a converted Loyalis record: the Pekarya record that owns `period`'s slip,
 * or null when the Loyalis record itself does.
 */
export function conversionSourceForPeriod(
  loyalisData: unknown,
  period: string,
): { employeeId: string; collection: 'Employees_BlueCollar' } | null {
  const from = readConversionFromLink(loyalisData);
  const normalizedPeriod = normalizeConversionPeriod(period);
  if (!from || !normalizedPeriod || normalizedPeriod >= from.effectivePeriod) {
    return null;
  }
  return { employeeId: from.fromEmployeeId, collection: 'Employees_BlueCollar' };
}

/** Next free `Loyalis_NNN` id, padded to three digits like the employees page. */
export function nextLoyalisEmployeeId(existingIds: Iterable<string>): string {
  let highest = 0;
  for (const id of existingIds) {
    const match = /^Loyalis_(\d+)$/.exec(id);
    if (match) highest = Math.max(highest, Number(match[1]));
  }
  return `Loyalis_${String(highest + 1).padStart(3, '0')}`;
}

/** The form's starting values, read from the Pekarya record. */
export function prefillLoyalisConversionInput(
  blueCollar: unknown,
): LoyalisConversionInput {
  const data = asRecord(blueCollar);
  const employment = asRecord(data.employment);
  const bank = asRecord(data.bankAccount);
  const startDate = storedDateOnly(employment.startDate);
  return {
    name: text(data.name),
    nik: text(data.nik),
    phone: text(data.phoneNumber),
    email: text(data.email),
    bankName: text(bank.bankName),
    accountNumber: text(bank.accountNumber),
    dateOfHire: startDate,
    dateRecognized: storedDateOnly(employment.dateRecognized) || startDate,
    departmentUnit: '',
    loyalisType: '',
    isDosen: false,
    educationLevel: '',
    levelCode: '',
    bpjsTk: 0,
    bpjsKes: 0,
    spouseCount: 0,
    childrenSd: 0,
    childrenSltp: 0,
    childrenSlta: 0,
    childrenPt: 0,
  };
}

/**
 * Reads an untrusted form payload. Unknown or malformed values fall back to
 * empty so `validateLoyalisConversionInput` can name them.
 */
export function parseLoyalisConversionInput(value: unknown): LoyalisConversionInput {
  const input = asRecord(value);
  const loyalisType = LOYALIS_TYPES.find((option) => option === input.loyalisType) || '';
  return {
    name: text(input.name),
    nik: text(input.nik),
    phone: text(input.phone),
    email: text(input.email),
    bankName: text(input.bankName),
    accountNumber: text(input.accountNumber),
    dateOfHire: text(input.dateOfHire),
    dateRecognized: text(input.dateRecognized),
    departmentUnit: text(input.departmentUnit).toUpperCase(),
    loyalisType,
    isDosen: typeof input.isDosen === 'boolean' ? input.isDosen : null,
    educationLevel: text(input.educationLevel),
    levelCode: text(input.levelCode).replace(/^Gol\.\s*/i, ''),
    bpjsTk: Number(input.bpjsTk),
    bpjsKes: Number(input.bpjsKes),
    spouseCount: Number(input.spouseCount),
    childrenSd: Number(input.childrenSd),
    childrenSltp: Number(input.childrenSltp),
    childrenSlta: Number(input.childrenSlta),
    childrenPt: Number(input.childrenPt),
  };
}

export function validateLoyalisConversionInput(
  input: LoyalisConversionInput,
  options: { canSetLevelCode: boolean },
): LoyalisConversionInputErrors {
  const errors: LoyalisConversionInputErrors = {};
  if (!input.name || input.name.length > 200) errors.name = 'Nama wajib diisi.';
  if (input.nik.length > 64) errors.nik = 'NIK terlalu panjang.';
  if (input.phone.length > 32) errors.phone = 'Nomor telepon terlalu panjang.';
  if (input.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(input.email)) {
    errors.email = 'Format email tidak valid.';
  }
  if (input.bankName.length > 64) errors.bankName = 'Nama bank terlalu panjang.';
  if (input.accountNumber.length > 64) {
    errors.accountNumber = 'Nomor rekening terlalu panjang.';
  }
  if (!isValidDateOnly(input.dateOfHire)) {
    errors.dateOfHire = 'Tanggal Mulai Kerja wajib diisi.';
  }
  if (input.dateRecognized && !isValidDateOnly(input.dateRecognized)) {
    errors.dateRecognized = 'Tanggal Masa Kerja Diakui tidak valid.';
  }
  if (!input.departmentUnit || input.departmentUnit.length > 100) {
    errors.departmentUnit = 'Unit kerja wajib dipilih.';
  }
  if (!input.loyalisType) errors.loyalisType = 'Tipe Loyalis wajib dipilih.';
  if (input.educationLevel.length > 100) {
    errors.educationLevel = 'Pendidikan terlalu panjang.';
  }
  if (input.levelCode && !options.canSetLevelCode) {
    errors.levelCode = 'Hanya Super Admin yang dapat mengisi golongan.';
  } else if (input.levelCode.length > 20) {
    errors.levelCode = 'Golongan tidak valid.';
  }
  for (const field of ['bpjsTk', 'bpjsKes'] as const) {
    const amount = input[field];
    if (!Number.isFinite(amount) || amount < 0 || amount > 100_000_000) {
      errors[field] = 'Nominal tidak valid.';
    }
  }
  for (const field of [
    'spouseCount',
    'childrenSd',
    'childrenSltp',
    'childrenSlta',
    'childrenPt',
  ] as const) {
    const amount = input[field];
    if (!Number.isSafeInteger(amount) || amount < 0 || amount > 20) {
      errors[field] = 'Jumlah tidak valid.';
    }
  }
  return errors;
}

function dateOnlyToUtcDate(value: string): Date | null {
  return isValidDateOnly(value) ? new Date(`${value}T00:00:00.000Z`) : null;
}

/**
 * The new Loyalis document, shaped like the employees page's own Loyalis save
 * (`resetForm('loyalis')`). Dates are UTC-midnight `Date`s, which the Admin
 * SDK stores as Timestamps, matching the page's `Timestamp.fromDate(new
 * Date('YYYY-MM-DD'))`. The server adds `conversion` and `audit`.
 */
export function buildLoyalisEmployeeDocument(
  blueCollar: unknown,
  input: LoyalisConversionInput,
): AnyRecord {
  const data = asRecord(blueCollar);
  const nipy = normalizeNipy(data.nipy);
  const bpjs = asRecord(data.bpjs);
  const deductions = asRecord(data.deductions);
  const salaryProfile = asRecord(data.salaryProfile);
  const document: AnyRecord = {
    nipy: nipy || null,
    personal_info: {
      name: input.name,
      employee_id_niy: nipy || null,
      nik: input.nik || null,
      tax_id_npwp: null,
      status: 'AKTIF',
      phone: input.phone,
      email: input.email,
    },
    banking_info: {
      bank_name: input.bankName || null,
      account_number: input.accountNumber || null,
    },
    employment_profile: {
      job_role: null,
      department_unit: input.departmentUnit,
      date_of_hire: dateOnlyToUtcDate(input.dateOfHire),
      date_recognized: dateOnlyToUtcDate(input.dateRecognized),
      date_exit: null,
      structural_positions: [],
    },
    academic_and_tier: {
      education_level: input.educationLevel || null,
      education_code: null,
      functional_tier: null,
      level_code: input.levelCode || null,
      base_salary_tier: null,
    },
    loyalisType: input.loyalisType || null,
    isDosen: input.isDosen,
    family_allowance_metrics: {
      spouse_count: count(input.spouseCount),
      children_sd: count(input.childrenSd),
      children_sltp: count(input.childrenSltp),
      children_slta: count(input.childrenSlta),
      children_pt: count(input.childrenPt),
    },
    ziz: { deductionAmount: money(asRecord(data.ziz).deductionAmount) },
    savings: { deductionAmount: money(asRecord(data.savings).deductionAmount) },
    pinlu: { deductionAmount: money(asRecord(data.pinlu).deductionAmount) },
    tht: { deductionAmount: money(asRecord(data.tht).deductionAmount) },
    bpjs: {
      t_bpjs_tk: money(input.bpjsTk),
      t_bpjs_kes: money(input.bpjsKes),
      deductionAmount: money(bpjs.deductionAmount),
    },
    salaryProfile: { tunjanganBeras: money(salaryProfile.tunjanganBeras) },
    kepangkatan: { cummulativeCredit: 0 },
    t_instruksional: 0,
    koperasiUserId: text(data.koperasiUserId) || null,
    koperasiAuthUid: text(data.koperasiAuthUid) || null,
  };
  if (Object.keys(deductions).length > 0) {
    document.deductions = {
      koperasiRochmad: money(deductions.koperasiRochmad),
      ...(text(deductions.kodeKopRochmad)
        ? { kodeKopRochmad: text(deductions.kodeKopRochmad) }
        : {}),
    };
  }
  return document;
}

function monthLabel(period: string): string {
  const months = [
    'Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni',
    'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember',
  ];
  const [year, month] = period.split('-').map(Number);
  return `${months[month - 1] || period} ${year}`;
}

export function conversionPeriodLabel(period: string): string {
  const normalized = normalizeConversionPeriod(period);
  return normalized ? monthLabel(normalized) : period;
}

/**
 * Everything that would leave money or a request stranded under the old
 * record. Blockers stop the conversion; warnings are shown but allowed.
 */
export function collectConversionIssues(facts: EmployeeConversionFacts): {
  blockers: EmployeeConversionIssue[];
  warnings: EmployeeConversionIssue[];
} {
  const blockers: EmployeeConversionIssue[] = [];
  const warnings: EmployeeConversionIssue[] = [];
  const effective = monthLabel(facts.effectivePeriod);
  const previous = monthLabel(shiftConversionPeriod(facts.effectivePeriod, -1));
  const block = (code: EmployeeConversionIssueCode, message: string) =>
    blockers.push({ code, message });
  const warn = (code: EmployeeConversionIssueCode, message: string) =>
    warnings.push({ code, message });

  if (facts.alreadyConverted) {
    block('ALREADY_CONVERTED', 'Pegawai ini sudah dialihkan ke Loyalis.');
  } else if (!facts.employeeActive) {
    block('EMPLOYEE_INACTIVE', 'Hanya Pekarya aktif yang dapat dialihkan.');
  }
  if (!facts.previousPeriodClosed) {
    block(
      'PREVIOUS_PERIOD_OPEN',
      `Payroll ${previous} belum ditutup. Tunggu periode itu ditutup agar slip Pekarya terakhirnya tetap dibayar.`,
    );
  }
  if (facts.effectivePeriodClosed) {
    block('EFFECTIVE_PERIOD_CLOSED', `Payroll ${effective} sudah ditutup.`);
  }
  if (facts.slipPeriodsFromEffective.length > 0) {
    block(
      'SLIP_IN_EFFECTIVE_PERIOD',
      `Sudah ada slip Pekarya untuk ${facts.slipPeriodsFromEffective.map(monthLabel).join(', ')}.`,
    );
  }
  if (facts.pendingActivityReports > 0) {
    block(
      'PENDING_ACTIVITY_REPORTS',
      `${facts.pendingActivityReports} laporan kegiatan masih menunggu tinjauan. Setujui atau tolak dulu di Tinjau Aktivitas.`,
    );
  }
  if (facts.activityReportsInEffectivePeriod > 0) {
    block(
      'ACTIVITY_IN_EFFECTIVE_PERIOD',
      `Ada ${facts.activityReportsInEffectivePeriod} laporan kegiatan Pekarya di ${effective}; bulan itu dibayar sebagai Loyalis sehingga laporan tersebut tidak akan terbayar.`,
    );
  }
  if (facts.openDriverJourneys > 0) {
    block(
      'OPEN_DRIVER_JOURNEYS',
      `${facts.openDriverJourneys} perjalanan sopir masih berjalan atau menunggu tinjauan. Selesaikan atau alihkan ke sopir lain.`,
    );
  }
  if (facts.driverJourneysInEffectivePeriod > 0) {
    block(
      'DRIVER_JOURNEYS_IN_EFFECTIVE_PERIOD',
      `Ada ${facts.driverJourneysInEffectivePeriod} perjalanan sopir di ${effective} yang tidak akan terbayar sebagai Loyalis.`,
    );
  }
  if (facts.upcomingDriverPiket > 0) {
    block(
      'UPCOMING_DRIVER_PIKET',
      `Masih terjadwal ${facts.upcomingDriverPiket} piket sopir mulai hari ini. Ganti sopirnya di jadwal piket.`,
    );
  }
  if (facts.spjEventsInEffectivePeriod > 0) {
    block(
      'SPJ_EVENT_IN_EFFECTIVE_PERIOD',
      `Terdaftar di ${facts.spjEventsInEffectivePeriod} kegiatan SPJ Pekarya ${effective}. Hapus dari daftar pekerja kegiatan itu.`,
    );
  }
  if (facts.uraianPaidInEffectivePeriod) {
    block(
      'URAIAN_IN_EFFECTIVE_PERIOD',
      `Rekap Pekarya ${effective} sudah berisi nominal untuk pegawai ini. Kosongkan barisnya dulu.`,
    );
  }
  if (facts.pendingOfficialLeave > 0) {
    block(
      'PENDING_OFFICIAL_LEAVE',
      `${facts.pendingOfficialLeave} pengajuan izin resmi Pekarya masih menunggu keputusan.`,
    );
  }
  if (facts.pendingSatpamAbsences > 0) {
    block(
      'PENDING_SATPAM_ABSENCE',
      `${facts.pendingSatpamAbsences} pengajuan izin Satpam masih menunggu keputusan.`,
    );
  }
  if (facts.pendingAnnualLeave > 0) {
    block(
      'PENDING_ANNUAL_LEAVE',
      `${facts.pendingAnnualLeave} pengajuan cuti tahunan masih menunggu keputusan.`,
    );
  }
  if (facts.satpamTeamNames.length > 0) {
    block(
      'SATPAM_TEAM_MEMBER',
      `Masih tercatat di regu Satpam ${facts.satpamTeamNames.join(', ')}. Ganti anggota regu itu dulu.`,
    );
  }
  if (facts.linkedAccounts.length > 1) {
    block(
      'MULTIPLE_LINKED_ACCOUNTS',
      'Lebih dari satu akun login tertaut ke pegawai ini. Rapikan di menu Pengguna.',
    );
  } else if (facts.linkedAccounts.length === 1) {
    const [account] = facts.linkedAccounts;
    if (account.role !== 'honorer') {
      block(
        'LINKED_ACCOUNT_ROLE',
        account.role === 'ketua_shift_satpam'
          ? 'Akun login pegawai ini adalah Ketua Shift Satpam. Tunjuk ketua pengganti dulu.'
          : `Akun login pegawai ini berperan "${account.role}", bukan honorer.`,
      );
    } else if (account.disabled) {
      warn(
        'LINKED_ACCOUNT_DISABLED',
        'Akun login pegawai ini nonaktif. Akun tetap dialihkan ke Loyalis, tetapi tetap nonaktif.',
      );
    }
  } else {
    warn(
      'NO_LINKED_ACCOUNT',
      'Pegawai ini belum punya akun login. Super Admin dapat membuatkan akun Loyalis nanti.',
    );
  }
  if (facts.nipyOwnedElsewhere) {
    block(
      'NIPY_OWNED_ELSEWHERE',
      `NIPY ${facts.nipy} juga tercatat pada ${facts.nipyOwnedElsewhere}. Perbaiki NIPY ganda itu dulu.`,
    );
  }
  if (!facts.nipy) {
    warn(
      'NO_NIPY',
      'Pegawai ini belum punya NIPY. Isi NIPY Loyalis-nya setelah pengalihan agar presensinya terbaca.',
    );
  }
  if (!facts.levelCodeProvided) {
    warn(
      'LEVEL_CODE_EMPTY',
      'Golongan belum diisi; Super Admin perlu mengisinya sebelum payroll bulan ini disiapkan.',
    );
  }
  const day = Number(facts.today.slice(8, 10));
  if (day >= EMPLOYEE_CONVERSION_LATE_MONTH_DAY) {
    warn(
      'LATE_IN_MONTH',
      `Sudah lewat pertengahan bulan. Seluruh ${effective} tetap dibayar sebagai Loyalis.`,
    );
  }
  return { blockers, warnings };
}
