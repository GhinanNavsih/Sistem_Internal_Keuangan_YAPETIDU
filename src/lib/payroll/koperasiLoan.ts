/**
 * Canonical read-only processing for Koperasi UNIPDU loan records.
 *
 * The audit page and employee payslip both consume the same cooperative
 * documents.  Keeping status resolution, installment math, and restructuring
 * ancestry here prevents the payslip from inventing a synthetic loan timeline
 * when the audit page already has the authoritative history.
 */

export interface KoperasiLoanHistoryLike {
  status: string;
  notes?: string;
  updatedBy?: string;
  timestamp?: {
    seconds?: number;
    nanoseconds?: number;
    toMillis?: () => number;
    toDate?: () => Date;
  };
}

export interface KoperasiLoanLike {
  id?: string;
  status?: string;
  jumlahPinjaman?: number;
  tenor?: number;
  sisaHutang?: number;
  jumlahMenyicil?: number;
  tanggalPengajuan?: unknown;
  tanggalDisetujui?: unknown;
  history?: KoperasiLoanHistoryLike[];
  restructuredFromLoanId?: string;
  restructuredToLoanId?: string;
}

export interface KoperasiLoanHistorySegment {
  loanId: string;
  loanLabel: string;
  entries: KoperasiLoanHistoryLike[];
}

export const KOPERASI_ACTIVE_LOAN_STATUS = 'Disetujui dan Aktif';
export const KOPERASI_PAYMENT_HISTORY_STATUS = 'Pembayaran Cicilan';
export const KOPERASI_PAID_LOAN_STATUS = 'Lunas';
export const KOPERASI_PENDING_RESTRUCTURING_STATUS = 'Menunggu Persetujuan Restrukturisasi';

function timestampMillis(value: unknown): number {
  if (!value) return 0;
  if (value instanceof Date) return value.getTime();
  if (typeof value === 'string' || typeof value === 'number') {
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? 0 : parsed.getTime();
  }
  const candidate = value as {
    toMillis?: () => number;
    toDate?: () => Date;
    seconds?: number;
  };
  if (typeof candidate.toMillis === 'function') return candidate.toMillis();
  if (typeof candidate.toDate === 'function') return candidate.toDate().getTime();
  return typeof candidate.seconds === 'number' ? candidate.seconds * 1000 : 0;
}

function historyEntriesAt(
  loan: Pick<KoperasiLoanLike, 'history'>,
  asOf?: Date,
): KoperasiLoanHistoryLike[] {
  if (!Array.isArray(loan.history)) return [];
  if (!asOf) return [...loan.history];
  const cutoff = asOf.getTime();
  return loan.history.filter(entry => {
    const timestamp = timestampMillis(entry.timestamp);
    // Untimestamped legacy history is retained rather than silently erased.
    return timestamp === 0 || timestamp <= cutoff;
  });
}

function loanCreationMillis(loan: KoperasiLoanLike): number {
  const explicitDates = [loan.tanggalPengajuan, loan.tanggalDisetujui]
    .map(timestampMillis)
    .filter(value => value > 0);
  const historyDates = (loan.history || [])
    .map(entry => timestampMillis(entry.timestamp))
    .filter(value => value > 0);
  return Math.min(...explicitDates, ...historyDates);
}

export function koperasiLoanExistsAtPeriod(
  loan: KoperasiLoanLike,
  asOf: Date,
): boolean {
  const createdAt = loanCreationMillis(loan);
  return createdAt === Infinity || createdAt <= asOf.getTime();
}

export function latestKoperasiLoanHistory(
  loan: Pick<KoperasiLoanLike, 'history'>,
  asOf?: Date,
): KoperasiLoanHistoryLike | undefined {
  const history = historyEntriesAt(loan, asOf);
  if (history.length === 0) return undefined;
  return history.sort(
    (a, b) => timestampMillis(b.timestamp) - timestampMillis(a.timestamp),
  )[0];
}

/**
 * Resolve the same display status used by Audit Simpan Pinjam. A payment
 * history entry is an event, not a state: it keeps a normal loan active, but
 * must not erase a pending restructuring or a completed top-level state.
 */
export function resolveKoperasiLoanStatus(loan: KoperasiLoanLike): string {
  return resolveKoperasiLoanStatusAtPeriod(loan);
}

export function resolveKoperasiLoanStatusAtPeriod(
  loan: KoperasiLoanLike,
  asOf?: Date,
): string {
  const latestStatus = latestKoperasiLoanHistory(loan, asOf)?.status;

  // A payment history entry is an event rather than a state transition.  The
  // Koperasi payroll bridge can append the final payment event while updating
  // the document's top-level status to Lunas.  For the current record, keep
  // that terminal state instead of turning the settled loan back into an
  // active one.  Historical projections intentionally continue to use only
  // history entries at the selected cutoff.
  if (latestStatus === KOPERASI_PAYMENT_HISTORY_STATUS) {
    if (!asOf && loan.status === KOPERASI_PAID_LOAN_STATUS) {
      return KOPERASI_PAID_LOAN_STATUS;
    }

    // A restructuring request is not effective until its replacement loan is
    // approved. Payments made while approval is pending must therefore keep
    // the original loan in that pending state so the next monthly installment
    // remains payable and the restructuring workflow can still resolve it.
    const pendingRestructuringAtCutoff =
      loan.status === KOPERASI_PENDING_RESTRUCTURING_STATUS &&
      (!asOf || historyEntriesAt(loan, asOf).some(
        entry => entry.status === KOPERASI_PENDING_RESTRUCTURING_STATUS,
      ));
    if (pendingRestructuringAtCutoff) {
      return KOPERASI_PENDING_RESTRUCTURING_STATUS;
    }

    return KOPERASI_ACTIVE_LOAN_STATUS;
  }

  return latestStatus || loan.status || '';
}

export function isKoperasiPayrollPayableStatus(status: string): boolean {
  return status === KOPERASI_ACTIVE_LOAN_STATUS ||
    status === KOPERASI_PENDING_RESTRUCTURING_STATUS;
}

export function koperasiMonthlyInstallment(loan: KoperasiLoanLike): number {
  const principal = Number(loan.jumlahPinjaman) || 0;
  const tenor = Number(loan.tenor) || 0;
  return tenor > 0 ? Math.round(principal / tenor) : 0;
}

export function koperasiPaidInstallments(loan: KoperasiLoanLike): number {
  return koperasiPaidInstallmentsAtPeriod(loan);
}

export function koperasiPaidInstallmentsAtPeriod(
  loan: KoperasiLoanLike,
  asOf?: Date,
): number {
  const history = historyEntriesAt(loan, asOf);
  const allHistory = historyEntriesAt(loan);
  const recorded = Number(loan.jumlahMenyicil);

  // For an as-of period, future payment events are authoritative: using the
  // current aggregate jumlahMenyicil would incorrectly show today's count.
  if (asOf && allHistory.some(entry => entry.status === 'Pembayaran Cicilan')) {
    return history.filter(entry => entry.status === 'Pembayaran Cicilan').length;
  }
  if (Number.isFinite(recorded) && recorded >= 0) return Math.floor(recorded);
  return history.filter(entry => entry.status === 'Pembayaran Cicilan').length;
}

export interface KoperasiLoanPeriodProjection extends KoperasiLoanLike {
  status: string;
  history: KoperasiLoanHistoryLike[];
  jumlahPinjaman: number;
  sisaHutang: number;
  tenor: number;
  cicilan: number;
  paidInstallments: number;
  currentInstallmentNum: number;
}

/** Number of installments paid after applying the selected period's scheduled payment. */
export function koperasiProjectedPaidInstallments(
  loan: Pick<KoperasiLoanPeriodProjection, 'paidInstallments' | 'tenor'>,
): number {
  const tenor = Math.max(0, Number(loan.tenor) || 0);
  const paid = Math.max(0, Number(loan.paidInstallments) || 0);
  return tenor > 0 ? Math.min(tenor, paid + (paid < tenor ? 1 : 0)) : 0;
}

/** Balance after the scheduled installment for the selected period. */
export function koperasiProjectedRemainingBalance(
  loan: Pick<KoperasiLoanPeriodProjection, 'paidInstallments' | 'tenor' | 'sisaHutang' | 'cicilan'>,
): number {
  const paid = Math.max(0, Number(loan.paidInstallments) || 0);
  const tenor = Math.max(0, Number(loan.tenor) || 0);
  const installment = Math.max(0, Number(loan.cicilan) || 0);
  const currentBalance = Math.max(0, Number(loan.sisaHutang) || 0);
  return Math.max(0, Math.round(currentBalance - (paid < tenor ? installment : 0)));
}

export function koperasiRemainingDebtAtPeriod(
  loan: KoperasiLoanLike,
  asOf: Date,
  paidInstallments = koperasiPaidInstallmentsAtPeriod(loan, asOf),
): number {
  const principal = Math.max(0, Number(loan.jumlahPinjaman) || 0);
  const installment = koperasiMonthlyInstallment(loan);
  const allPayments = historyEntriesAt(loan).filter(
    entry => entry.status === 'Pembayaran Cicilan',
  );
  const paymentsAtPeriod = historyEntriesAt(loan, asOf).filter(
    entry => entry.status === 'Pembayaran Cicilan',
  );

  // Once every known payment is inside the selected period, the current
  // sisaHutang is the authoritative final balance.  Otherwise reconstruct the
  // historical balance from the principal and payments known at that cutoff.
  if (paymentsAtPeriod.length >= allPayments.length && Number.isFinite(Number(loan.sisaHutang))) {
    return Math.max(0, Math.round(Number(loan.sisaHutang)));
  }
  return Math.max(0, Math.round(principal - paidInstallments * installment));
}

export function projectKoperasiLoanForPeriod(
  loan: KoperasiLoanLike,
  asOf: Date,
): KoperasiLoanPeriodProjection | null {
  if (!koperasiLoanExistsAtPeriod(loan, asOf)) return null;

  const history = historyEntriesAt(loan, asOf);
  const tenor = Math.max(0, Math.floor(Number(loan.tenor) || 0));
  const paidInstallments = koperasiPaidInstallmentsAtPeriod(loan, asOf);
  const currentInstallmentNum = Math.min(tenor || 1, paidInstallments + 1);
  const approvalTimestamp = timestampMillis(loan.tanggalDisetujui);
  const visibleApprovalDate = approvalTimestamp > asOf.getTime()
    ? undefined
    : loan.tanggalDisetujui;

  return {
    ...loan,
    tanggalDisetujui: visibleApprovalDate,
    status: resolveKoperasiLoanStatusAtPeriod(loan, asOf),
    history,
    jumlahPinjaman: Math.max(0, Math.round(Number(loan.jumlahPinjaman) || 0)),
    sisaHutang: koperasiRemainingDebtAtPeriod(loan, asOf, paidInstallments),
    tenor,
    cicilan: koperasiMonthlyInstallment(loan),
    paidInstallments,
    currentInstallmentNum,
  };
}

/**
 * Select one head per restructuring lineage from the loans visible at a
 * specific cutoff.  Future loans must not hide their historical ancestors.
 */
export function selectKoperasiLineageHeads<T extends KoperasiLoanLike>(
  loans: readonly T[],
): T[] {
  const ancestorIds = new Set(
    loans
      .map(loan => loan.restructuredFromLoanId)
      .filter((id): id is string => typeof id === 'string' && id.length > 0),
  );
  return loans.filter(loan => !loan.id || !ancestorIds.has(loan.id));
}

/**
 * Loans visible as current employee obligations. This legacy-named selector
 * includes the original loan while restructuring approval is pending because
 * its installments remain payable. Rejected, cancelled, and replacement
 * applications stay out of employee-facing obligation cards.
 */
export function selectKoperasiActiveLoans<T extends KoperasiLoanLike>(
  loans: readonly T[],
): T[] {
  return loans.filter(loan =>
    isKoperasiPayrollPayableStatus(resolveKoperasiLoanStatus(loan)),
  );
}

/**
 * Walk the restructuredFromLoanId chain exactly as the audit modal does.  The
 * visited set makes malformed/cyclic references safe to render.
 */
export function composeKoperasiLoanHistoryTrail(
  loan: KoperasiLoanLike,
  allLoans: readonly KoperasiLoanLike[],
  asOf?: Date,
): KoperasiLoanHistorySegment[] {
  const segments: KoperasiLoanHistorySegment[] = [];
  let currentId = loan.restructuredFromLoanId;
  const visited = new Set<string>();

  while (currentId && !visited.has(currentId)) {
    visited.add(currentId);
    const ancestor = allLoans.find(candidate => candidate.id === currentId);
    if (!ancestor || (asOf && !koperasiLoanExistsAtPeriod(ancestor, asOf))) break;
    segments.unshift({
      loanId: ancestor.id || currentId,
      loanLabel: `#${(ancestor.id || currentId).substring(0, 8)}`,
      entries: historyEntriesAt(ancestor, asOf),
    });
    currentId = ancestor.restructuredFromLoanId;
  }

  const currentLoanId = loan.id || 'loan-current';
  segments.push({
    loanId: currentLoanId,
    loanLabel: `#${currentLoanId.substring(0, 8)}${asOf ? ' (Periode Terpilih)' : ' (Saat Ini)'}`,
    entries: historyEntriesAt(loan, asOf),
  });

  return segments;
}
