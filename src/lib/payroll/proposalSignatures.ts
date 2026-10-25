export interface ProposalSignature {
  label: string;
  name: string;
  title: string;
  employeeId?: string;
}

const DEFAULT_TITLES = [
  'Wakil Rektor Bid. Keuangan, SDM dan Umum',
  'Ketua BAK',
  'Kepala SatKer',
];

const LEGACY_LPJ_TITLES = [DEFAULT_TITLES[0], '', 'Direktur'];

export function createProposalSignatures(): ProposalSignature[] {
  return DEFAULT_TITLES.map((title) => ({ label: '', name: '', title }));
}

/** Unselected positions stay editable, but take up no space in the PDF. */
export function getPrintableProposalSignatures(signatures: readonly ProposalSignature[]): ProposalSignature[] {
  return signatures.filter((signature) => signature.name.trim().length > 0);
}

/** Keep document snapshots, excluding transient search/dropdown state. */
export function normalizeProposalSignatures(value: unknown): ProposalSignature[] {
  const slots = Array.isArray(value) ? value : [];
  return createProposalSignatures().map((fallback, index) => {
    const slot = slots[index];
    if (!slot || typeof slot !== 'object') return fallback;
    return {
      label: typeof slot.label === 'string' ? slot.label : '',
      name: typeof slot.name === 'string' ? slot.name : '',
      title: typeof slot.title === 'string' ? slot.title : fallback.title,
      ...(typeof slot.employeeId === 'string' && slot.employeeId ? { employeeId: slot.employeeId } : {}),
    };
  });
}

export function loadProposalSignatureState(record: {
  signatures?: unknown;
  lpjSignatures?: unknown;
  lpjSignaturesFollowProposal?: unknown;
}) {
  const proposalSignatures = normalizeProposalSignatures(record.signatures);
  const storedLpj = Array.isArray(record.lpjSignatures) ? record.lpjSignatures : [];
  // Older drafts eagerly saved these empty LPJ placeholders. Treat only those
  // untouched defaults as inherited; retain names and customized titles.
  const hasCustomLpj = storedLpj.some((slot, index) => slot && (
    (typeof slot.name === 'string' && slot.name.trim()) ||
    (typeof slot.label === 'string' && slot.label.trim()) ||
    (typeof slot.title === 'string' && slot.title !== LEGACY_LPJ_TITLES[index])
  ));
  const lpjSignaturesFollowProposal = typeof record.lpjSignaturesFollowProposal === 'boolean'
    ? record.lpjSignaturesFollowProposal
    : !hasCustomLpj;

  return {
    proposalSignatures,
    lpjSignaturesFollowProposal,
    lpjSignatures: normalizeProposalSignatures(lpjSignaturesFollowProposal ? proposalSignatures : storedLpj),
  };
}
