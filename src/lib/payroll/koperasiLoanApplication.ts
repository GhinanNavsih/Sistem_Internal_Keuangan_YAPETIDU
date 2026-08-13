/**
 * Member-facing rules for Koperasi UNIPDU loans.
 *
 * `koperasiLoan.ts` covers reading an existing loan (status resolution,
 * installment math, restructuring ancestry). This module covers the other
 * direction — what a member is allowed to submit, and what the resulting
 * numbers are — so the employee page and the API route that persists the write
 * agree on every threshold instead of each carrying its own copy.
 */

import {
  resolveKoperasiLoanStatus,
  type KoperasiLoanLike,
} from '@/lib/payroll/koperasiLoan';

export const KOPERASI_MIN_LOAN = 1_000_000;
export const KOPERASI_MAX_LOAN = 10_000_000;
export const KOPERASI_MIN_TENOR = 3;
export const KOPERASI_MAX_TENOR = 12;
export const KOPERASI_MAX_PURPOSE_LENGTH = 120;
export const KOPERASI_MAX_NOTE_LENGTH = 500;

export const KOPERASI_BANKS = [
  'BSI',
  'BCA',
  'BRI',
  'Mandiri',
  'BNI',
  'Bank Jatim',
  'BTN',
] as const;

export type KoperasiBank = (typeof KOPERASI_BANKS)[number];

export function isKoperasiBank(value: unknown): value is KoperasiBank {
  return typeof value === 'string' && (KOPERASI_BANKS as readonly string[]).includes(value);
}

/**
 * Administration fee brackets, inclusive of the transfer cost, deducted at
 * disbursement rather than added to the principal.
 */
export const KOPERASI_ADMIN_FEE_TIERS = [
  { label: 'Rp 1 JT – 2 JT', minExclusive: 999_999, fee: 100_000 },
  { label: '> Rp 2 JT – 4 JT', minExclusive: 2_000_000, fee: 200_000 },
  { label: '> Rp 4 JT – 6 JT', minExclusive: 4_000_000, fee: 300_000 },
  { label: '> Rp 6 JT – 8 JT', minExclusive: 6_000_000, fee: 400_000 },
  { label: '> Rp 8 JT – 10 JT', minExclusive: 8_000_000, fee: 500_000 },
] as const;

export function koperasiAdminFee(loanAmount: number): number {
  const amount = Number(loanAmount) || 0;
  // Walk the brackets high-to-low so the largest satisfied threshold wins.
  for (let index = KOPERASI_ADMIN_FEE_TIERS.length - 1; index >= 0; index -= 1) {
    const tier = KOPERASI_ADMIN_FEE_TIERS[index];
    if (amount > tier.minExclusive) return tier.fee;
  }
  return 0;
}

/** Statuses where the application is still live and blocks a second one. */
export const KOPERASI_ACTIVE_STATUSES = [
  'Menunggu Persetujuan BAK',
  'Menunggu Persetujuan Wakil Rektor 2',
  'Direvisi BAK',
  'Disetujui dan Aktif',
  'Menunggu Transfer BAK',
  'Menunggu Persetujuan Restrukturisasi',
] as const;

/** Statuses where the application has come to rest, for the history tab. */
export const KOPERASI_PAST_STATUSES = [
  'Lunas',
  'Ditolak BAK',
  'Ditolak Wakil Rektor 2',
  'Dibatalkan',
  'Revisi Ditolak Anggota',
  'Direstrukturisasi',
] as const;

export function isKoperasiActiveStatus(status: string): boolean {
  return (KOPERASI_ACTIVE_STATUSES as readonly string[]).includes(status);
}

export function isKoperasiPastStatus(status: string): boolean {
  return (KOPERASI_PAST_STATUSES as readonly string[]).includes(status);
}

/**
 * Outstanding balance, falling back to principal minus paid installments when
 * an older document predates the stored `sisaHutang` field.
 */
export function koperasiOutstandingBalance(loan: KoperasiLoanLike): number {
  const stored = Number(loan.sisaHutang);
  if (Number.isFinite(stored)) return Math.max(0, Math.round(stored));

  const principal = Math.max(0, Number(loan.jumlahPinjaman) || 0);
  const tenor = Math.max(1, Number(loan.tenor) || 1);
  const paid = Math.max(0, Number(loan.jumlahMenyicil) || 0);
  return Math.max(0, principal - paid * Math.round(principal / tenor));
}

/** Installments still owed on an active loan. */
export function koperasiRemainingTenor(loan: KoperasiLoanLike): number {
  const tenor = Math.max(0, Math.floor(Number(loan.tenor) || 0));
  const paid = Math.max(0, Math.floor(Number(loan.jumlahMenyicil) || 0));
  return Math.max(0, tenor - paid);
}

/** The cooperative allows one live application at a time. */
export function canApplyForKoperasiLoan(loans: readonly KoperasiLoanLike[]): boolean {
  return !loans.some((loan) => isKoperasiActiveStatus(resolveKoperasiLoanStatus(loan)));
}

export function canRestructureKoperasiLoan(loan: KoperasiLoanLike): boolean {
  return resolveKoperasiLoanStatus(loan) === 'Disetujui dan Aktif';
}

/** Only a request BAK has not yet acted on can be withdrawn by the member. */
export function canCancelKoperasiLoan(loan: KoperasiLoanLike): boolean {
  return resolveKoperasiLoanStatus(loan) === 'Menunggu Persetujuan BAK';
}

export function canRespondToKoperasiRevision(loan: KoperasiLoanLike): boolean {
  return resolveKoperasiLoanStatus(loan) === 'Direvisi BAK';
}

export interface KoperasiLoanApplicationInput {
  amount: number;
  tenor: number;
  purpose: string;
  bank: string;
  accountNumber: string;
  note?: string;
}

/**
 * Returns the first violated rule as an Indonesian sentence, or `null` when the
 * application is submittable.
 */
export function validateKoperasiLoanApplication(
  input: KoperasiLoanApplicationInput,
): string | null {
  const amount = Number(input.amount);
  if (!Number.isFinite(amount) || !Number.isInteger(amount)) {
    return 'Jumlah pinjaman tidak valid.';
  }
  if (amount < KOPERASI_MIN_LOAN || amount > KOPERASI_MAX_LOAN) {
    return `Jumlah pinjaman harus antara Rp ${KOPERASI_MIN_LOAN.toLocaleString('id-ID')} - Rp ${KOPERASI_MAX_LOAN.toLocaleString('id-ID')}.`;
  }

  const tenor = Number(input.tenor);
  if (!Number.isInteger(tenor) || tenor < KOPERASI_MIN_TENOR || tenor > KOPERASI_MAX_TENOR) {
    return `Pilih tenor antara ${KOPERASI_MIN_TENOR} - ${KOPERASI_MAX_TENOR} bulan.`;
  }

  const purpose = String(input.purpose || '').trim();
  if (!purpose) return 'Tujuan pinjaman harus diisi.';
  if (purpose.length > KOPERASI_MAX_PURPOSE_LENGTH) {
    return `Tujuan pinjaman maksimal ${KOPERASI_MAX_PURPOSE_LENGTH} karakter.`;
  }

  if (!isKoperasiBank(input.bank)) return 'Silakan pilih bank untuk transfer.';

  const accountNumber = String(input.accountNumber || '').trim();
  if (!/^\d{6,25}$/.test(accountNumber)) {
    return 'Nomor rekening harus berupa 6 - 25 digit angka.';
  }

  if ((input.note || '').length > KOPERASI_MAX_NOTE_LENGTH) {
    return `Catatan tambahan maksimal ${KOPERASI_MAX_NOTE_LENGTH} karakter.`;
  }

  return null;
}

export interface KoperasiRestructuringQuote {
  /** Balance rolled over from the loan being replaced. */
  carriedBalance: number;
  /** Installments still owed on the loan being replaced. */
  carriedTenor: number;
  additionalAmount: number;
  additionalTenor: number;
  newTotal: number;
  newTenor: number;
  adminFee: number;
  monthlyInstallment: number;
  /** Largest top-up that keeps the new total inside the cooperative's ceiling. */
  maxAdditionalAmount: number;
  error: string | null;
}

/**
 * Price a restructuring: the outstanding balance of the current loan is carried
 * into a brand-new loan together with the requested top-up, and the tenor
 * likewise extends the installments still owed.
 */
export function quoteKoperasiRestructuring(
  loan: KoperasiLoanLike,
  additionalAmount: number,
  additionalTenor: number,
): KoperasiRestructuringQuote {
  const carriedBalance = koperasiOutstandingBalance(loan);
  const carriedTenor = koperasiRemainingTenor(loan);
  const topUp = Math.max(0, Math.floor(Number(additionalAmount) || 0));
  const extraTenor = Math.max(0, Math.floor(Number(additionalTenor) || 0));

  const newTotal = carriedBalance + topUp;
  const newTenor = carriedTenor + extraTenor;
  const adminFee = koperasiAdminFee(newTotal);
  const monthlyInstallment = newTenor > 0 ? Math.round(newTotal / newTenor) : 0;
  const maxAdditionalAmount = Math.max(0, KOPERASI_MAX_LOAN - carriedBalance);

  let error: string | null = null;
  if (!canRestructureKoperasiLoan(loan)) {
    error = 'Hanya pinjaman yang berstatus aktif yang dapat direstrukturisasi.';
  } else if (topUp <= 0) {
    error = 'Jumlah pinjaman tambahan harus lebih dari Rp 0.';
  } else if (extraTenor < KOPERASI_MIN_TENOR || extraTenor > KOPERASI_MAX_TENOR) {
    error = `Pilih tenor tambahan antara ${KOPERASI_MIN_TENOR} - ${KOPERASI_MAX_TENOR} bulan.`;
  } else if (newTotal < KOPERASI_MIN_LOAN || newTotal > KOPERASI_MAX_LOAN) {
    error = `Total pinjaman baru harus antara Rp ${KOPERASI_MIN_LOAN.toLocaleString('id-ID')} - Rp ${KOPERASI_MAX_LOAN.toLocaleString('id-ID')}.`;
  } else if (newTenor <= 0) {
    error = 'Tenor pinjaman baru tidak valid.';
  }

  return {
    carriedBalance,
    carriedTenor,
    additionalAmount: topUp,
    additionalTenor: extraTenor,
    newTotal,
    newTenor,
    adminFee,
    monthlyInstallment,
    maxAdditionalAmount,
    error,
  };
}

export type KoperasiStatusTone = 'success' | 'pending' | 'warning' | 'danger' | 'neutral' | 'restructure';

export function koperasiLoanStatusTone(status: string): KoperasiStatusTone {
  switch (status) {
    case 'Disetujui dan Aktif':
      return 'success';
    case 'Lunas':
      return 'neutral';
    case 'Direvisi BAK':
    case 'Menunggu Transfer BAK':
      return 'warning';
    case 'Menunggu Persetujuan Restrukturisasi':
    case 'Direstrukturisasi':
      return 'restructure';
    case 'Ditolak BAK':
    case 'Ditolak Wakil Rektor 2':
    case 'Dibatalkan':
    case 'Revisi Ditolak Anggota':
      return 'danger';
    default:
      return 'pending';
  }
}

/** How far along the approval chain an application has travelled, for the tracker UI. */
export const KOPERASI_APPROVAL_STEPS = [
  'Menunggu Persetujuan BAK',
  'Menunggu Persetujuan Wakil Rektor 2',
  'Menunggu Transfer BAK',
  'Disetujui dan Aktif',
] as const;

export function koperasiApprovalStepIndex(status: string): number {
  if (status === 'Lunas') return KOPERASI_APPROVAL_STEPS.length - 1;
  return (KOPERASI_APPROVAL_STEPS as readonly string[]).indexOf(status);
}
