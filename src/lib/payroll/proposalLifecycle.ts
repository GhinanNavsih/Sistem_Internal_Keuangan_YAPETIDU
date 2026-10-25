export const PROPOSAL_FIELDS = [
  'reportName',
  'departmentUnit',
  'totalBudget',
  'pemasukanRows',
  'yayasanPercentage',
  'unipduPercentage',
  'pengeluaranRows',
  'kepanitiaaanPercentage',
  'signatures',
] as const;

export const LPJ_FIELDS = [
  'realisasiEnabled',
  'vakasiPengujiEnabled',
  'kepanitiaaanEnabled',
  'receiptEnabled',
  'realisasiTitle',
  'lpjPemasukanRows',
  'lpjPengeluaranRows',
  'vakasiPengujiTitle',
  'vakasiRoles',
  'vakasiPengujiRows',
  'kepanitiaaanTitle',
  'kepanitiaaanPhases',
  'kepanitiaaanRows',
  'receiptTitle',
  'receiptRows',
  'lpjSignatures',
  'lpjSignaturesFollowProposal',
  'expenseReports',
] as const;

export type ProposalStage = 'proposal' | 'lpj';
export type ProposalAction =
  | 'save_draft'
  | 'save_lpj'
  | 'submit_proposal'
  | 'submit_lpj'
  | 'review';

export interface ProposalWriteResult {
  proposalId: string;
  revision: number;
  status: string;
  proposalQueueNumber?: number;
}

export function proposalContent(data: Record<string, unknown>, stage: ProposalStage) {
  const allowed = stage === 'proposal' ? PROPOSAL_FIELDS : LPJ_FIELDS;
  return Object.fromEntries(allowed.filter((key) => key in data).map((key) => [key, data[key]]));
}

export function canEditProposalStage(role: string, status: string, stage: ProposalStage): boolean {
  if (stage === 'proposal')
    return role === 'super_admin' || ['proposal_draft', 'proposal_revision'].includes(status);
  return ['proposal_approved', 'lpj_draft', 'lpj_revision'].includes(status);
}
