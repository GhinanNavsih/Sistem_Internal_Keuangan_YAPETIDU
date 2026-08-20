export const PROPOSAL_LPJ_SANDBOX_SOURCE_KIND = 'proposal_lpj_report';

interface VakasiTambahanFinancialRecord {
  sourceKind?: unknown;
  status?: unknown;
}

function asFinancialRecord(value: unknown): VakasiTambahanFinancialRecord {
  return value && typeof value === 'object'
    ? value as VakasiTambahanFinancialRecord
    : {};
}

/** Proposal/LPJ report assignments are sandbox data and must never become payroll earnings. */
export function isProposalLpjSandboxSource(value: unknown): boolean {
  return asFinancialRecord(value).sourceKind === PROPOSAL_LPJ_SANDBOX_SOURCE_KIND;
}

/** Shared guard for every VakasiTambahan reader that contributes to a payslip. */
export function isPayableVakasiTambahan(value: unknown): boolean {
  const record = asFinancialRecord(value);
  if (isProposalLpjSandboxSource(record)) return false;
  return !record.status || record.status === 'approved';
}
