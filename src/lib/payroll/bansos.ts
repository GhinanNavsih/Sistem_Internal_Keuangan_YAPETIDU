import type { ResolvedVakasiWorker, VakasiEmployeeCollection } from './vakasiTambahan';

/**
 * BanSos (bantuan sosial): Ajuan Duka and Ajuan Melahirkan.
 *
 * An employee (Loyalis or Pekarya) submits an ajuan with proof. Two people
 * decide on it in either order: Admin Karyawan (the "admin" side) and Super
 * Admin (the "finance" side, who also sets the amount). Once both accept, the
 * ajuan is paid through one VakasiTambahan event per month and kind, named
 * "Ajuan Duka" / "Ajuan Melahirkan", which every payroll reader already knows
 * how to pay.
 *
 * Pure module, no Firebase, so the rules are unit tested and shared by the
 * pages and the API.
 */

export const BANSOS_REQUESTS_COLLECTION = 'BansosRequests';
export const BANSOS_EVENT_SOURCE_KIND = 'bansos';

export const BANSOS_KINDS = ['duka', 'melahirkan'] as const;
export type BansosKind = (typeof BANSOS_KINDS)[number];

export type BansosEmployeeClass = 'loyalis' | 'pekarya';
export type BansosDecision = 'pending' | 'accepted' | 'rejected';
export type BansosSide = 'admin' | 'finance';
export type BansosAction = 'accept' | 'reject' | 'reset';
export type BansosStatus =
  | 'awaiting_both'
  | 'awaiting_admin'
  | 'awaiting_finance'
  | 'paid'
  | 'rejected'
  | 'withdrawn';

/** Also the Vakasi event name, so it is the earning label on the slip. */
export const BANSOS_KIND_LABELS: Readonly<Record<BansosKind, string>> = {
  duka: 'Ajuan Duka',
  melahirkan: 'Ajuan Melahirkan',
};

export const BANSOS_DEFAULT_AMOUNTS: Readonly<Record<BansosKind, Readonly<Record<BansosEmployeeClass, number>>>> = {
  duka: { loyalis: 1_000_000, pekarya: 750_000 },
  melahirkan: { loyalis: 500_000, pekarya: 500_000 },
};

/** Same ceiling as one Vakasi recipient. */
export const BANSOS_MAX_AMOUNT = 100_000_000;

/** Whose death an Ajuan Duka is for. Any family member counts; Admin Karyawan judges. */
export const BANSOS_RELATIONSHIPS = [
  { value: 'pasangan', label: 'Suami/Istri' },
  { value: 'anak', label: 'Anak' },
  { value: 'ayah', label: 'Ayah' },
  { value: 'ibu', label: 'Ibu' },
  { value: 'ayah_mertua', label: 'Ayah Mertua' },
  { value: 'ibu_mertua', label: 'Ibu Mertua' },
  { value: 'saudara_kandung', label: 'Saudara Kandung' },
  { value: 'lainnya', label: 'Lainnya' },
] as const;
export type BansosRelationship = (typeof BANSOS_RELATIONSHIPS)[number]['value'];

export const BANSOS_SIDE_LABELS: Readonly<Record<BansosSide, string>> = {
  admin: 'Admin Karyawan',
  finance: 'Super Admin',
};

export const BANSOS_STATUS_LABELS: Readonly<Record<BansosStatus, string>> = {
  awaiting_both: 'Menunggu pemeriksaan',
  awaiting_admin: 'Menunggu Admin Karyawan',
  awaiting_finance: 'Menunggu Super Admin',
  paid: 'Disetujui',
  rejected: 'Ditolak',
  withdrawn: 'Ditarik',
};

/** One ajuan as the pages see it. `status` is derived, never stored. */
export interface BansosRequest {
  id: string;
  employeeId: string;
  employeeCollection: VakasiEmployeeCollection;
  employeeClass: BansosEmployeeClass;
  employeeName: string;
  jobCategory?: string;
  kind: BansosKind;
  /** Date of death (Duka) or birth (Melahirkan). */
  eventDate: string;
  /** Duka: who died. Melahirkan: the baby's name, if given. */
  subjectName: string;
  relationship?: BansosRelationship;
  relationshipOther?: string;
  note?: string;
  proofName: string;
  proofUrl: string;
  proofContentType: string;
  proofSize: number;
  adminDecision: BansosDecision;
  adminReason?: string;
  adminByName?: string;
  adminAt?: string;
  financeDecision: BansosDecision;
  financeReason?: string;
  financeByName?: string;
  financeAt?: string;
  amount: number;
  /** The month it was submitted in, and the month its event lives in. */
  period: string;
  /** Set only when it was paid in a later month because `period` had closed. */
  paidPeriod?: string;
  withdrawn: boolean;
  status: BansosStatus;
  revision: number;
  submittedAt: string;
  /** Reviewer pages only: another live ajuan looks like the same event. */
  possibleDuplicate?: boolean;
}

export function isBansosKind(value: unknown): value is BansosKind {
  return typeof value === 'string' && (BANSOS_KINDS as readonly string[]).includes(value);
}

export function isBansosRelationship(value: unknown): value is BansosRelationship {
  return typeof value === 'string' && BANSOS_RELATIONSHIPS.some((option) => option.value === value);
}

export function bansosRelationshipLabel(request: Pick<BansosRequest, 'relationship' | 'relationshipOther'>): string {
  if (request.relationship === 'lainnya') return request.relationshipOther || 'Lainnya';
  return BANSOS_RELATIONSHIPS.find((option) => option.value === request.relationship)?.label || '';
}

export function employeeClassForCollection(collection: VakasiEmployeeCollection): BansosEmployeeClass {
  return collection === 'Employees_BlueCollar' ? 'pekarya' : 'loyalis';
}

export function defaultBansosAmount(kind: BansosKind, employeeClass: BansosEmployeeClass): number {
  return BANSOS_DEFAULT_AMOUNTS[kind][employeeClass];
}

/** The one VakasiTambahan document holding every ajuan of a kind paid in a month. */
export function bansosEventId(period: string, kind: BansosKind): string {
  return `BANSOS_${period}_${kind.toUpperCase()}`;
}

export function isBansosEventId(eventId: string): boolean {
  return eventId.startsWith('BANSOS_');
}

export function bansosStatus(request: {
  adminDecision: BansosDecision;
  financeDecision: BansosDecision;
  withdrawn?: boolean;
}): BansosStatus {
  if (request.withdrawn) return 'withdrawn';
  if (request.adminDecision === 'rejected' || request.financeDecision === 'rejected') return 'rejected';
  if (request.adminDecision === 'accepted' && request.financeDecision === 'accepted') return 'paid';
  if (request.adminDecision === 'accepted') return 'awaiting_finance';
  if (request.financeDecision === 'accepted') return 'awaiting_admin';
  return 'awaiting_both';
}

export function isBansosAwaiting(status: BansosStatus): boolean {
  return status === 'awaiting_both' || status === 'awaiting_admin' || status === 'awaiting_finance';
}

/** The month a paid ajuan is paid in. */
export function bansosPayoutPeriod(request: Pick<BansosRequest, 'period' | 'paidPeriod'>): string {
  return request.paidPeriod || request.period;
}

/** Whole rupiah from 1 to the ceiling, or null. */
export function parseBansosAmount(value: unknown): number | null {
  return typeof value === 'number' &&
    Number.isSafeInteger(value) &&
    value >= 1 &&
    value <= BANSOS_MAX_AMOUNT
    ? value
    : null;
}

function isDateOnly(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

function cleanText(value: unknown, maxLength: number): string {
  return typeof value === 'string'
    ? value.normalize('NFKC').replace(/\s+/g, ' ').trim().slice(0, maxLength)
    : '';
}

export interface BansosSubmission {
  kind: BansosKind;
  eventDate: string;
  subjectName: string;
  relationship?: BansosRelationship;
  relationshipOther?: string;
  note?: string;
}

/** Checks and tidies what the employee sent. Throws an Error with the message to show. */
export function validateBansosSubmission(raw: Record<string, unknown>, today: string): BansosSubmission {
  const kind = raw.kind;
  if (!isBansosKind(kind)) throw new Error('Pilih jenis ajuan: Duka atau Melahirkan.');
  const eventDate = typeof raw.eventDate === 'string' ? raw.eventDate.trim() : '';
  const dateName = kind === 'duka' ? 'Tanggal meninggal' : 'Tanggal lahir';
  if (!isDateOnly(eventDate)) throw new Error(`${dateName} wajib diisi.`);
  if (eventDate > today) throw new Error(`${dateName} tidak boleh setelah hari ini.`);
  const subjectName = cleanText(raw.subjectName, 120);
  const note = cleanText(raw.note, 500);

  if (kind === 'melahirkan') {
    return { kind, eventDate, subjectName, ...(note ? { note } : {}) };
  }

  const relationship = raw.relationship;
  if (!isBansosRelationship(relationship)) throw new Error('Pilih hubungan keluarga dengan almarhum/almarhumah.');
  const relationshipOther = relationship === 'lainnya' ? cleanText(raw.relationshipOther, 80) : '';
  if (relationship === 'lainnya' && relationshipOther.length < 2) {
    throw new Error('Tuliskan hubungan keluarga dengan almarhum/almarhumah.');
  }
  if (subjectName.length < 2) throw new Error('Nama almarhum/almarhumah wajib diisi.');
  return {
    kind,
    eventDate,
    subjectName,
    relationship,
    ...(relationshipOther ? { relationshipOther } : {}),
    ...(note ? { note } : {}),
  };
}

function sameName(left: string, right: string): boolean {
  const normalize = (value: string) => value.normalize('NFKC').replace(/\s+/g, ' ').trim().toLocaleLowerCase('id-ID');
  return normalize(left) === normalize(right);
}

/**
 * Whether another live ajuan of the same employee looks like the same event:
 * same kind and date, and for Duka the same person. Only a hint for the
 * reviewers; two births on one day (twins) are real.
 */
export function possibleDuplicate(
  request: Pick<BansosRequest, 'id' | 'employeeId' | 'kind' | 'eventDate' | 'subjectName'>,
  others: readonly Pick<BansosRequest, 'id' | 'employeeId' | 'kind' | 'eventDate' | 'subjectName' | 'status'>[],
): boolean {
  return others.some((other) =>
    other.id !== request.id &&
    other.employeeId === request.employeeId &&
    other.kind === request.kind &&
    other.eventDate === request.eventDate &&
    other.status !== 'rejected' &&
    other.status !== 'withdrawn' &&
    (request.kind !== 'duka' || sameName(other.subjectName, request.subjectName)),
  );
}

export interface BansosDecisionState {
  adminDecision: BansosDecision;
  financeDecision: BansosDecision;
  withdrawn?: boolean;
  amount: number;
}

export interface BansosDecisionPlan {
  decision: BansosDecision;
  reason: string | null;
  amount: number;
  wasPaid: boolean;
  willBePaid: boolean;
}

/**
 * What one side's decision does to an ajuan. Each side changes only its own
 * decision; a decided side must reset before deciding again, and a rejection
 * by either side ends the ajuan for the other until it is reset.
 */
export function planBansosDecision(
  request: BansosDecisionState,
  side: BansosSide,
  action: BansosAction,
  input: { reason?: unknown; amount?: unknown } = {},
): BansosDecisionPlan {
  if (request.withdrawn) throw new Error('Ajuan ini sudah ditarik pegawai.');
  if (side === 'admin' && input.amount !== undefined) {
    throw new Error('Nominal hanya dapat diubah Super Admin.');
  }
  const own = side === 'admin' ? request.adminDecision : request.financeDecision;
  const other = side === 'admin' ? request.financeDecision : request.adminDecision;
  const wasPaid = bansosStatus(request) === 'paid';
  let decision: BansosDecision;
  let reason: string | null = null;
  let amount = request.amount;

  if (action === 'reset') {
    if (own === 'pending') throw new Error('Belum ada keputusan yang dapat dibatalkan.');
    decision = 'pending';
  } else {
    if (own !== 'pending') throw new Error('Ajuan ini sudah Anda putuskan. Batalkan keputusan dulu untuk mengubahnya.');
    if (other === 'rejected') {
      throw new Error(`Ajuan ini sudah ditolak ${BANSOS_SIDE_LABELS[side === 'admin' ? 'finance' : 'admin']}.`);
    }
    if (action === 'reject') {
      reason = cleanText(input.reason, 500);
      if (reason.length < 3) throw new Error('Alasan penolakan wajib diisi.');
      decision = 'rejected';
    } else {
      decision = 'accepted';
      if (side === 'finance') {
        const parsed = parseBansosAmount(input.amount);
        if (parsed === null) throw new Error('Nominal harus berupa rupiah bulat antara Rp 1 dan Rp 100.000.000.');
        amount = parsed;
      }
    }
  }
  const next = side === 'admin'
    ? { ...request, adminDecision: decision }
    : { ...request, financeDecision: decision };
  return {
    decision,
    reason,
    amount,
    wasPaid,
    willBePaid: bansosStatus(next) === 'paid',
  };
}

/**
 * The event's recipients: the paid ajuan of one month and kind, one row per
 * employee (two ajuan of one employee in a month are summed, because a Vakasi
 * event pays each employee once).
 */
export function buildBansosEventWorkers(
  requests: readonly Pick<BansosRequest, 'employeeId' | 'employeeCollection' | 'employeeName' | 'jobCategory' | 'amount' | 'status'>[],
): ResolvedVakasiWorker[] {
  const byEmployee = new Map<string, ResolvedVakasiWorker>();
  for (const request of requests) {
    if (request.status !== 'paid') continue;
    const existing = byEmployee.get(request.employeeId);
    if (existing) {
      existing.payGiven += request.amount;
      continue;
    }
    byEmployee.set(request.employeeId, {
      employeeId: request.employeeId,
      employeeName: request.employeeName,
      payGiven: request.amount,
      employeeCollection: request.employeeCollection,
      ...(request.employeeCollection === 'Employees_BlueCollar' && request.jobCategory
        ? { jobCategory: request.jobCategory }
        : {}),
    });
  }
  return [...byEmployee.values()].sort((left, right) =>
    left.employeeName.localeCompare(right.employeeName, 'id') ||
    left.employeeId.localeCompare(right.employeeId),
  );
}

/** For the event card's badge: how many wait, are paid, were rejected. */
export function bansosCounts(requests: readonly Pick<BansosRequest, 'status'>[]): {
  waiting: number;
  paid: number;
  rejected: number;
} {
  return requests.reduce(
    (counts, request) => {
      if (isBansosAwaiting(request.status)) counts.waiting += 1;
      else if (request.status === 'paid') counts.paid += 1;
      else if (request.status === 'rejected') counts.rejected += 1;
      return counts;
    },
    { waiting: 0, paid: 0, rejected: 0 },
  );
}
