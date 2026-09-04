/**
 * Central registry of query keys and freshness tiers for cached Firestore reads.
 *
 * Keys are declared here (rather than inline at each call site) so that a write
 * can invalidate exactly what it changed without guessing at the string another
 * module used. Prefix-matching is intentional: invalidating `['salaryMatrix']`
 * drops every matrix variant, while `salaryMatrixKeys.rows('SalaryMatrix', v)`
 * drops just one version's rows.
 */

/** How long data stays fresh before a background refetch, by volatility. */
export const STALE_TIME = {
  /** Fallback for anything not explicitly tiered. */
  default: 5 * 60 * 1000,
  /**
   * Near-static config: salary matrices, position lookups, department lists.
   * These only change when an admin edits them, and that edit invalidates.
   */
  reference: 30 * 60 * 1000,
  /** Employee master data — edited from the employees page, which invalidates. */
  employees: 5 * 60 * 1000,
  /** Koperasi loans/members, owned by a separate Firebase project. */
  koperasi: 5 * 60 * 1000,
  /**
   * Active workflow state that gates or queues admin actions: correction
   * approval queues, period open/closed status. The write path's own
   * invalidation — not the passage of time — is the real freshness mechanism
   * here; this tier only bounds how long a write made in *another* tab can go
   * unnoticed.
   */
  workflow: 5 * 60 * 1000,
} as const;

/** How long an unused cache entry is kept before eviction. */
export const DEFAULT_GC_TIME = 30 * 60 * 1000;

/** Which matrix collection a key refers to. */
export type SalaryMatrixCollection =
  | 'SalaryMatrix'
  | 'SalaryMatrix_WhiteCollar'
  | 'SalaryMatrix_Functional'
  | 'SalaryMatrix_Kepangkatan';

export const employeeKeys = {
  all: ['employees'] as const,
  loyalis: () => ['employees', 'loyalis'] as const,
  blueCollar: () => ['employees', 'blueCollar'] as const,
};

export const salaryMatrixKeys = {
  all: ['salaryMatrix'] as const,
  /** The `_config` doc holding `activeVersion` for one matrix collection. */
  config: (collectionName: SalaryMatrixCollection) =>
    ['salaryMatrix', collectionName, 'config'] as const,
  /** The version doc itself (carries `metadata.gradeCodes`). */
  version: (collectionName: SalaryMatrixCollection, version: string) =>
    ['salaryMatrix', collectionName, 'version', version] as const,
  /** The `rows` subcollection of one version. */
  rows: (collectionName: SalaryMatrixCollection, version: string) =>
    ['salaryMatrix', collectionName, 'rows', version] as const,
  /** Everything belonging to one matrix collection, across versions. */
  collection: (collectionName: SalaryMatrixCollection) =>
    ['salaryMatrix', collectionName] as const,
};

export const koperasiKeys = {
  all: ['koperasi'] as const,
  loans: () => ['koperasi', 'loans'] as const,
  users: () => ['koperasi', 'users'] as const,
};

export const referenceKeys = {
  all: ['reference'] as const,
  jabatanStruktural: () => ['reference', 'jabatanStruktural'] as const,
  departments: () => ['reference', 'departments'] as const,
  signatures: () => ['reference', 'signatures'] as const,
  satpamShiftTeams: () => ['reference', 'satpamShiftTeams'] as const,
};

/**
 * `PayrollPeriods/{period}` — open/closed status. Kept out of `referenceKeys`
 * because it is a workflow gate (it decides whether a proposal may still be
 * edited), not near-static config, and so carries a much shorter stale time.
 */
export const payrollPeriodKeys = {
  all: ['payrollPeriods'] as const,
  doc: (period: string) => ['payrollPeriods', period] as const,
};

/**
 * The whole `LoyalisPresenceCorrections` collection. Read unfiltered by both
 * the raw-presence page and the corrections review queue, then filtered
 * client-side by `date` (never by the unreliable optional `period` field).
 */
export const loyalisPresenceCorrectionsKeys = {
  all: ['loyalisPresenceCorrections'] as const,
};

/**
 * Combined `ProposalKegiatan` + `PelaporanKegiatan` across every period —
 * feeds only the "clone from historical baseline" dialog.
 */
export const kegiatanHistoryKeys = {
  all: ['kegiatanHistory'] as const,
};
