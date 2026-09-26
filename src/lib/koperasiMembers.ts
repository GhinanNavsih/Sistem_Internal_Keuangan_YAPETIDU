import { isConvertedAway } from './employeeConversion';
import { normalizeName } from './payroll/employeeNames';
import { KOPERASI_NAME_OVERRIDES } from './payroll/koperasiNames';

export const KOPERASI_PAYMENT_STATUSES = ['Payroll Deduction', 'Yayasan Subsidy', 'Transfer', 'Pending Verification'] as const;
export const KOPERASI_PAYMENT_LABELS: Record<string, string> = {
  'Payroll Deduction': 'Potong Gaji',
  'Yayasan Subsidy': 'Subsidi Yayasan',
  Transfer: 'Transfer',
  'Pending Verification': 'Menunggu Verifikasi',
};
export const KOPERASI_MEMBERSHIP_STATUSES = ['approved', 'Pending', 'inactive', 'rejected', 'removed'] as const;
export const KOPERASI_ROLES = ['Member', 'Mitra', 'Cashier', 'Admin', 'BAK', 'Director', 'Wakil Rektor 2'] as const;
export const KOPERASI_STAFF_ROLES: readonly string[] = ['Cashier', 'Admin', 'BAK', 'Director', 'Wakil Rektor 2'];
export type KoperasiEmployeeCollection = 'Employees_Loyalis' | 'Employees_BlueCollar';
export interface KoperasiBankDetails { bank: string; nomorRekening: string }

export interface KoperasiMember {
  id: string;
  uid?: string | null;
  nama?: string;
  name?: string;
  fullName?: string;
  displayName?: string;
  email?: string;
  nik?: string;
  nomorAnggota?: string;
  memberNumber?: string;
  kantor?: string;
  office?: string;
  satuanKerja?: string;
  unit?: string;
  nomorWhatsapp?: string;
  membershipStatus?: string | null;
  status?: string | null;
  paymentStatus?: string | null;
  role?: string | null;
  iuranPokok?: number | null;
  iuranWajib?: number | null;
  bankDetails?: Partial<KoperasiBankDetails> | null;
}

export interface KoperasiEmployeeData {
  name?: string;
  email?: string;
  nik?: string;
  koperasiAuthUid?: string | null;
  koperasiUserId?: string | null;
  personal_info?: { name?: string; email?: string; nik?: string; status?: string };
  employment_profile?: { department_unit?: string };
  employment?: { status?: string; jobCategory?: string };
  flags?: { isActive?: boolean; isPayrollEligible?: boolean };
  banking_info?: { bank_name?: string | null; account_number?: string | number | null };
  bankAccount?: { bankName?: string | null; accountNumber?: string | number | null };
  conversion?: unknown;
}
export interface KoperasiEmployee extends KoperasiEmployeeData {
  id: string;
  collection: KoperasiEmployeeCollection;
  name: string;
  normalizedName: string;
}

type MemberRules = Pick<KoperasiMember, 'membershipStatus' | 'status' | 'paymentStatus' | 'iuranWajib'>;
export function koperasiMemberApproved(member: MemberRules | null | undefined): boolean {
  return (member?.membershipStatus ?? member?.status) === 'approved';
}

/** Same zero/missing fallback as the Koperasi monthly job. Only drafts use it. */
export function koperasiMonthlyIuranWajib(member: MemberRules | null | undefined): number {
  if (!koperasiMemberApproved(member) || member?.paymentStatus !== 'Payroll Deduction') return 0;
  const amount = Number(member.iuranWajib) || 25_000;
  return Number.isFinite(amount) ? Math.max(0, Math.round(amount)) : 0;
}

export function mirroredStatus(membershipStatus: string): string {
  // The Koperasi legacy status uses lowercase pending.
  return membershipStatus === 'Pending' ? 'pending' : membershipStatus;
}

export interface KoperasiMemberEdit {
  paymentStatus: string;
  membershipStatus: string;
  iuranPokok: number;
  iuranWajib: number;
  role: string;
  confirmStaffRole: boolean;
  note: string;
}
export function parseKoperasiMemberEdit(value: unknown): KoperasiMemberEdit {
  const data = value && typeof value === 'object' ? value as Record<string, unknown> : {};
  const text = (key: string) => typeof data[key] === 'string' ? (data[key] as string).trim() : '';
  // Do not coerce booleans, decimals or formatted text into valid money.
  const amount = (key: string) => typeof data[key] === 'number' ? data[key] as number : NaN;
  return {
    paymentStatus: text('paymentStatus'), membershipStatus: text('membershipStatus'),
    iuranPokok: amount('iuranPokok'), iuranWajib: amount('iuranWajib'),
    role: text('role'), confirmStaffRole: data.confirmStaffRole === true, note: text('note'),
  };
}

export function validateKoperasiMemberEdit(edit: KoperasiMemberEdit, current?: Pick<KoperasiMember, 'paymentStatus'>): Partial<Record<keyof KoperasiMemberEdit, string>> {
  const errors: Partial<Record<keyof KoperasiMemberEdit, string>> = {};
  if (!(KOPERASI_PAYMENT_STATUSES as readonly string[]).includes(edit.paymentStatus) ||
    (edit.paymentStatus === 'Pending Verification' && current?.paymentStatus !== 'Pending Verification')) {
    errors.paymentStatus = 'Pilih Status Pembayaran yang tersedia.';
  }
  if (!(KOPERASI_MEMBERSHIP_STATUSES as readonly string[]).includes(edit.membershipStatus)) errors.membershipStatus = 'Status keanggotaan tidak valid.';
  if (!(KOPERASI_ROLES as readonly string[]).includes(edit.role)) errors.role = 'Role tidak valid.';
  for (const field of ['iuranPokok', 'iuranWajib'] as const) {
    if (!Number.isInteger(edit[field]) || edit[field] < 1 || edit[field] > 10_000_000) errors[field] = 'Isi rupiah utuh antara Rp1 dan Rp10.000.000.';
  }
  if (KOPERASI_STAFF_ROLES.includes(edit.role) && !edit.confirmStaffRole) errors.confirmStaffRole = 'Konfirmasi pemberian akses staf Koperasi wajib dicentang.';
  if (edit.note.length > 500) errors.note = 'Catatan maksimal 500 karakter.';
  return errors;
}

export const KOPERASI_EDIT_FIELDS = ['paymentStatus', 'membershipStatus', 'iuranPokok', 'iuranWajib', 'role', 'status'] as const;
export type KoperasiMemberSnapshot = { [K in (typeof KOPERASI_EDIT_FIELDS)[number]]: NonNullable<KoperasiMember[K]> | null };
export function koperasiMemberSnapshot(member: Partial<KoperasiMember>): KoperasiMemberSnapshot {
  return Object.fromEntries(KOPERASI_EDIT_FIELDS.map(field => [field, member[field] ?? null])) as KoperasiMemberSnapshot;
}
export function diffKoperasiMember(before: Partial<KoperasiMember>, after: Partial<KoperasiMember>) {
  const oldValues = koperasiMemberSnapshot(before);
  const newValues = koperasiMemberSnapshot(after);
  return KOPERASI_EDIT_FIELDS.filter(field => oldValues[field] !== newValues[field])
    .map(field => ({ field, before: oldValues[field], after: newValues[field] }));
}

export function sakuBankDetails(employee: KoperasiEmployeeData, collection: KoperasiEmployeeCollection): KoperasiBankDetails {
  return collection === 'Employees_Loyalis'
    ? { bank: String(employee.banking_info?.bank_name ?? ''), nomorRekening: String(employee.banking_info?.account_number ?? '').replace(/\D/g, '') }
    : { bank: String(employee.bankAccount?.bankName ?? ''), nomorRekening: String(employee.bankAccount?.accountNumber ?? '').replace(/\D/g, '') };
}
export function hasSakuBank(bank: KoperasiBankDetails): boolean {
  return Boolean(bank.bank.trim() && bank.nomorRekening);
}
export function bankDetailsDiffer(a: Partial<KoperasiBankDetails> | null | undefined, b: KoperasiBankDetails): boolean {
  return (a?.bank ?? '') !== b.bank || (a?.nomorRekening ?? '') !== b.nomorRekening;
}
export function koperasiEmployeeActive(employee: KoperasiEmployeeData, collection: KoperasiEmployeeCollection): boolean {
  if (isConvertedAway(employee)) return false;
  return collection === 'Employees_Loyalis'
    ? employee.personal_info?.status === 'AKTIF'
    : employee.employment?.status === 'active' && employee.flags?.isActive !== false;
}
export function toKoperasiEmployee(id: string, collection: KoperasiEmployeeCollection, data: KoperasiEmployeeData): KoperasiEmployee {
  const name = collection === 'Employees_Loyalis' ? data.personal_info?.name || '' : data.name || '';
  return { ...data, id, collection, name, normalizedName: normalizeName(name),
    email: collection === 'Employees_Loyalis' ? data.personal_info?.email || '' : data.email || '',
    nik: collection === 'Employees_Loyalis' ? data.personal_info?.nik || '' : data.nik || '' };
}
export function employeeLinkedToMember(member: KoperasiMember, employee: KoperasiEmployeeData): boolean {
  return !isConvertedAway(employee) && Boolean(
    (employee.koperasiUserId && employee.koperasiUserId === member.id) ||
    (employee.koperasiAuthUid && employee.koperasiAuthUid === (member.uid || member.id)),
  );
}
export function rankKoperasiLinkCandidates(member: KoperasiMember, employees: readonly KoperasiEmployee[]) {
  const nik = String(member.nik || '').replace(/\D/g, '');
  const email = String(member.email || '').trim().toLowerCase();
  const name = normalizeName(KOPERASI_NAME_OVERRIDES[member.nama?.trim() || ''] || member.nama || '');
  return employees
    .filter(employee => koperasiEmployeeActive(employee, employee.collection) && !employee.koperasiAuthUid && !employee.koperasiUserId)
    .map(employee => {
      const match = nik && nik === String(employee.nik || '').replace(/\D/g, '') ? 'NIK'
        : email && email === String(employee.email || '').trim().toLowerCase() ? 'Email'
          : name && name === normalizeName(employee.name) ? 'Nama' : '';
      return { employee, match, score: match === 'NIK' ? 3 : match === 'Email' ? 2 : match === 'Nama' ? 1 : 0 };
    })
    .sort((a, b) => b.score - a.score || a.employee.name.localeCompare(b.employee.name, 'id') || a.employee.id.localeCompare(b.employee.id));
}
