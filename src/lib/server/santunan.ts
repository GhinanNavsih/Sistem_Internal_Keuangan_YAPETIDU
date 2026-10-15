import { createHash } from 'node:crypto';
import admin, { adminDb } from '@/lib/firebase-admin';
import {
  BANSOS_EVENT_SOURCE_KIND,
  BANSOS_KIND_LABELS,
  BANSOS_REQUESTS_COLLECTION,
  assertBansosHandover,
  bansosCounts,
  bansosEventId,
  bansosPaidInCash,
  bansosPayoutPeriod,
  bansosStatus,
  buildBansosEventWorkers,
  defaultBansosAmount,
  isBansosAwaiting,
  isBansosKind,
  planBansosDecision,
  possibleDuplicate,
  type BansosAction,
  type BansosEmployeeClass,
  type BansosKind,
  type BansosRequest,
  type BansosSide,
  type BansosSubmission,
} from '@/lib/payroll/santunan';
import { jobCategoryForPayrollPeriod } from '@/lib/payroll/blueCollarCategory';
import { assertRequestId } from '@/lib/payroll/domain';
import {
  vakasiWorkerCollection,
  type ResolvedVakasiWorker,
  type VakasiEmployeeCollection,
  type VakasiWorkerLike,
} from '@/lib/payroll/vakasiTambahan';
import { buildFinancialAuditRecord, newFinancialAuditRef } from './audit';
import { HttpError, requireRole, type AuthenticatedProfile } from './auth';
import { isPeriodClosed, jakartaToday } from './payrollPeriod';
import {
  assertVakasiSlipsEditable,
  rememberVakasiOwnedLabels,
  vakasiAffectedEmployeeIds,
  vakasiProjectionQuery,
  writeVakasiPekaryaProjections,
} from './vakasiEventWrite';
import { propagateVakasiEmployees } from './vakasiPropagation';

/** Who may look at every ajuan; only the first two decide (each on its own side). */
export const BANSOS_REVIEW_READER_ROLES = ['loyalis_admin', 'super_admin', 'finance_verifier'] as const;

const SIDE_BY_ROLE: Partial<Record<AuthenticatedProfile['role'], BansosSide>> = {
  loyalis_admin: 'admin',
  super_admin: 'finance',
};

/** The side a role decides, if any. Both deciders may also mark a Duka handed over. */
export function bansosSideForRole(role: AuthenticatedProfile['role']): BansosSide | undefined {
  return SIDE_BY_ROLE[role];
}

function requests() {
  return adminDb.collection(BANSOS_REQUESTS_COLLECTION);
}

function timestampToIso(value: unknown): string {
  if (value && typeof value === 'object' && 'toDate' in value &&
    typeof (value as { toDate?: unknown }).toDate === 'function') {
    return (value as { toDate: () => Date }).toDate().toISOString();
  }
  return typeof value === 'string' ? value : '';
}

function optionalString(value: unknown): string | undefined {
  return typeof value === 'string' && value ? value : undefined;
}

export function parseBansosId(value: unknown, message = 'ID ajuan tidak valid.'): string {
  const id = typeof value === 'string' ? value.trim() : '';
  try {
    assertRequestId(id);
  } catch {
    throw new HttpError(400, message);
  }
  return id;
}

export function serializeBansosRequest(id: string, data: FirebaseFirestore.DocumentData): BansosRequest {
  const decision = (value: unknown) =>
    value === 'accepted' || value === 'rejected' ? value : 'pending';
  const adminDecision = decision(data.adminDecision);
  const financeDecision = decision(data.financeDecision);
  const withdrawn = data.withdrawn === true;
  const handedOver = data.handedOver === true;
  const kind = isBansosKind(data.kind) ? data.kind : 'duka';
  const employeeCollection = vakasiWorkerCollection(data as VakasiWorkerLike);
  return {
    id,
    employeeId: String(data.employeeId || ''),
    employeeCollection,
    employeeClass: data.employeeClass === 'pekarya' ? 'pekarya' : 'loyalis',
    employeeName: String(data.employeeName || ''),
    ...(optionalString(data.jobCategory) ? { jobCategory: String(data.jobCategory) } : {}),
    kind,
    eventDate: String(data.eventDate || ''),
    subjectName: String(data.subjectName || ''),
    ...(optionalString(data.relationship) ? { relationship: data.relationship } : {}),
    ...(optionalString(data.relationshipOther) ? { relationshipOther: String(data.relationshipOther) } : {}),
    ...(optionalString(data.note) ? { note: String(data.note) } : {}),
    proofName: String(data.proofName || ''),
    proofUrl: String(data.proofUrl || ''),
    proofContentType: String(data.proofContentType || ''),
    proofSize: Number(data.proofSize || 0),
    adminDecision,
    ...(optionalString(data.adminReason) ? { adminReason: String(data.adminReason) } : {}),
    ...(optionalString(data.adminByName) ? { adminByName: String(data.adminByName) } : {}),
    ...(data.adminAt ? { adminAt: timestampToIso(data.adminAt) } : {}),
    financeDecision,
    ...(optionalString(data.financeReason) ? { financeReason: String(data.financeReason) } : {}),
    ...(optionalString(data.financeByName) ? { financeByName: String(data.financeByName) } : {}),
    ...(data.financeAt ? { financeAt: timestampToIso(data.financeAt) } : {}),
    amount: Number(data.amount || 0),
    period: String(data.period || ''),
    ...(optionalString(data.paidPeriod) ? { paidPeriod: String(data.paidPeriod) } : {}),
    withdrawn,
    handedOver,
    ...(optionalString(data.handedOverByName) ? { handedOverByName: String(data.handedOverByName) } : {}),
    ...(data.handedOverAt ? { handedOverAt: timestampToIso(data.handedOverAt) } : {}),
    status: bansosStatus({ kind, adminDecision, financeDecision, withdrawn, handedOver }),
    revision: Number(data.revision || 1),
    submittedAt: timestampToIso(data.submittedAt),
  };
}

// ── Employee side ──────────────────────────────────────────────────────────

export interface BansosEmployee {
  ref: FirebaseFirestore.DocumentReference;
  id: string;
  collection: VakasiEmployeeCollection;
  employeeClass: BansosEmployeeClass;
  name: string;
}

/**
 * The signed-in employee's own record. Loyalis accounts submit for their
 * Employees_Loyalis record; Pekarya (honorer and Ketua Shift Satpam) for their
 * Employees_BlueCollar record. Both must still be active.
 */
export async function requireSelfBansosEmployee(actor: AuthenticatedProfile): Promise<BansosEmployee> {
  requireRole(actor, ['loyalis', 'honorer', 'ketua_shift_satpam']);
  const employeeId = actor.linkedEmployeeId?.trim() || '';
  if (!employeeId) throw new HttpError(409, 'Akun Anda belum terhubung ke data pegawai.');
  if (actor.role === 'loyalis') {
    const snapshot = await adminDb.collection('Employees_Loyalis').doc(employeeId).get();
    if (!snapshot.exists || snapshot.data()?.personal_info?.status !== 'AKTIF') {
      throw new HttpError(409, 'Data Loyalis aktif tidak ditemukan.');
    }
    return {
      ref: snapshot.ref,
      id: snapshot.id,
      collection: 'Employees_Loyalis',
      employeeClass: 'loyalis',
      name: String(snapshot.data()?.personal_info?.name || actor.displayName || ''),
    };
  }
  const snapshot = await adminDb.collection('Employees_BlueCollar').doc(employeeId).get();
  if (!snapshot.exists || snapshot.data()?.employment?.status !== 'active') {
    throw new HttpError(409, 'Data Pekarya aktif tidak ditemukan.');
  }
  return {
    ref: snapshot.ref,
    id: snapshot.id,
    collection: 'Employees_BlueCollar',
    employeeClass: 'pekarya',
    name: String(snapshot.data()?.name || actor.displayName || ''),
  };
}

export async function listOwnBansosRequests(employeeId: string): Promise<BansosRequest[]> {
  const snapshot = await requests().where('employeeId', '==', employeeId).get();
  return snapshot.docs
    .map((doc) => serializeBansosRequest(doc.id, doc.data()))
    .sort((left, right) => right.submittedAt.localeCompare(left.submittedAt));
}

// ── The Vakasi event that pays them ────────────────────────────────────────

interface EventSync {
  eventId: string;
  period: string;
  affectedEmployeeIds: string[];
  write: () => void;
}

function workersFromEventDoc(data: FirebaseFirestore.DocumentData | undefined): ResolvedVakasiWorker[] {
  const workers = data?.eventWorkers && typeof data.eventWorkers === 'object'
    ? data.eventWorkers as Record<string, VakasiWorkerLike & { payGiven?: unknown }>
    : {};
  return Object.entries(workers).map(([employeeId, worker]) => {
    const employeeCollection = vakasiWorkerCollection(worker);
    return {
      employeeId,
      employeeName: String(worker?.employeeName || employeeId),
      payGiven: Number(worker?.payGiven || 0),
      employeeCollection,
      ...(employeeCollection === 'Employees_BlueCollar' && typeof worker?.jobCategory === 'string'
        ? { jobCategory: worker.jobCategory }
        : {}),
    };
  });
}

/**
 * Reads everything one month's BanSos event of a kind depends on and works
 * out its new state, with `changed` standing in for the ajuan being written in
 * this transaction. The returned `write` must run after the caller's other
 * reads; it rebuilds the event, its Pekarya SPJ projections (only when who is
 * paid changed) and the counts on the event card.
 */
async function prepareBansosEventSync(
  transaction: FirebaseFirestore.Transaction,
  input: {
    period: string;
    kind: BansosKind;
    changed: BansosRequest;
    actor: AuthenticatedProfile;
    now: FirebaseFirestore.FieldValue;
  },
): Promise<EventSync> {
  const eventId = bansosEventId(input.period, input.kind);
  const eventRef = adminDb.collection('VakasiTambahan').doc(eventId);
  const [eventSnapshot, inPeriod, paidInPeriod, existingProjections] = await Promise.all([
    transaction.get(eventRef),
    transaction.get(requests().where('period', '==', input.period)),
    transaction.get(requests().where('paidPeriod', '==', input.period)),
    transaction.get(vakasiProjectionQuery(eventId)),
  ]);
  const byId = new Map<string, BansosRequest>();
  for (const doc of [...inPeriod.docs, ...paidInPeriod.docs]) {
    byId.set(doc.id, serializeBansosRequest(doc.id, doc.data()));
  }
  byId.set(input.changed.id, input.changed);
  const members = [...byId.values()].filter((request) =>
    request.kind === input.kind && bansosPayoutPeriod(request) === input.period,
  );

  const before = eventSnapshot.exists ? eventSnapshot.data() : undefined;
  const previousWorkers = workersFromEventDoc(before);
  const currentWorkers = buildBansosEventWorkers(members);
  const eventName = BANSOS_KIND_LABELS[input.kind];
  const wasPayable = before?.status === 'approved';
  const willBePayable = currentWorkers.length > 0;
  const affectedEmployeeIds = vakasiAffectedEmployeeIds({
    previousWorkers,
    previousEventName: eventName,
    wasPayable,
    currentWorkers,
    currentEventName: eventName,
    willBePayable,
  });
  const names = new Map([...previousWorkers, ...currentWorkers].map((worker) => [worker.employeeId, worker.employeeName]));
  await assertVakasiSlipsEditable(
    transaction,
    input.period,
    affectedEmployeeIds,
    (employeeId) => names.get(employeeId) || employeeId,
  );

  return {
    eventId,
    period: input.period,
    affectedEmployeeIds,
    write: () => {
      const revision = Number(before?.revision || 0) + 1;
      const after: Record<string, unknown> = {
        eventName,
        period: input.period,
        sourceKind: BANSOS_EVENT_SOURCE_KIND,
        bansosKind: input.kind,
        isEndOfMonth: true,
        departmentUnit: null,
        eventWorkers: Object.fromEntries(currentWorkers.map((worker) => [
          worker.employeeId,
          {
            employeeName: worker.employeeName,
            payGiven: worker.payGiven,
            employeeCollection: worker.employeeCollection,
            ...(worker.jobCategory ? { jobCategory: worker.jobCategory } : {}),
          },
        ])),
        totalPayout: currentWorkers.reduce((sum, worker) => sum + worker.payGiven, 0),
        ownedEarningLabelsByEmployee: rememberVakasiOwnedLabels({
          before: before?.ownedEarningLabelsByEmployee,
          previousWorkers,
          previousEventName: eventName,
          currentWorkers,
          currentEventName: eventName,
        }),
        status: willBePayable ? 'approved' : 'pending_review',
        bansosCounts: bansosCounts(members),
        revision,
        createdAt: before?.createdAt || input.now,
        createdBy: before?.createdBy || 'system:bansos',
        submittedBy: 'system:bansos',
        submittedByName: 'Ajuan BanSos',
        updatedAt: input.now,
        updatedBy: input.actor.uid,
        schemaVersion: 3,
      };
      transaction.set(eventRef, after);
      if (affectedEmployeeIds.length > 0 || wasPayable !== willBePayable) {
        writeVakasiPekaryaProjections(transaction, {
          eventId,
          eventName,
          period: input.period,
          workers: currentWorkers,
          approved: willBePayable,
          eventRevision: revision,
          existingProjections,
          actorUid: input.actor.uid,
          now: input.now,
        });
      }
    },
  };
}

async function propagate(
  actor: AuthenticatedProfile,
  syncs: readonly EventSync[],
  requestId: string,
): Promise<Record<string, number>> {
  const summary: Record<string, number> = {};
  for (const sync of syncs) {
    if (sync.affectedEmployeeIds.length === 0) continue;
    const result = await propagateVakasiEmployees(actor, {
      period: sync.period,
      periodKey: sync.period.replace('-', '_'),
      employeeIds: sync.affectedEmployeeIds,
      requestId: `bansos_${createHash('sha256').update(`${requestId}:${sync.period}`).digest('hex').slice(0, 32)}`,
    });
    for (const [outcome, count] of Object.entries(result.summary)) {
      summary[outcome] = (summary[outcome] || 0) + count;
    }
  }
  return summary;
}

// ── Submit and withdraw ────────────────────────────────────────────────────

export interface CreateBansosInput {
  requestId: string;
  submission: BansosSubmission;
  fingerprint: string;
  proof: { name: string; path: string; url: string; contentType: string; size: number };
}

/**
 * Stores a new ajuan. For Melahirkan it also makes sure its month's event
 * exists, so it shows in the Vakasi list straight away; Duka is paid in cash
 * and has no event. The proof is already uploaded by the caller.
 */
export async function createBansosRequest(
  actor: AuthenticatedProfile,
  employee: BansosEmployee,
  input: CreateBansosInput,
): Promise<{ requestId: string; status: string; idempotent?: boolean }> {
  const requestRef = requests().doc(input.requestId);
  return adminDb.runTransaction(async (transaction) => {
    const [existing, latestEmployee] = await Promise.all([
      transaction.get(requestRef),
      transaction.get(employee.ref),
    ]);
    if (existing.exists) {
      const data = existing.data() || {};
      if (data.employeeId === employee.id && data.fingerprint === input.fingerprint) {
        return { requestId: input.requestId, status: serializeBansosRequest(existing.id, data).status, idempotent: true };
      }
      throw new HttpError(409, 'ID ajuan sudah digunakan. Muat ulang halaman lalu kirim lagi.');
    }
    const employeeData = latestEmployee.data() || {};
    const active = employee.collection === 'Employees_Loyalis'
      ? employeeData.personal_info?.status === 'AKTIF'
      : employeeData.employment?.status === 'active';
    if (!latestEmployee.exists || !active) throw new HttpError(409, 'Data pegawai aktif tidak ditemukan.');

    const period = jakartaToday().slice(0, 7);
    const jobCategory = employee.collection === 'Employees_BlueCollar'
      ? jobCategoryForPayrollPeriod(employeeData, period).normalize('NFKC').trim()
      : '';
    const now = admin.firestore.FieldValue.serverTimestamp();
    const stored: Record<string, unknown> = {
      employeeId: employee.id,
      employeeCollection: employee.collection,
      employeeClass: employee.employeeClass,
      employeeName: employee.name,
      ...(jobCategory ? { jobCategory } : {}),
      submitterUid: actor.uid,
      ...input.submission,
      proofName: input.proof.name,
      proofPath: input.proof.path,
      proofUrl: input.proof.url,
      proofContentType: input.proof.contentType,
      proofSize: input.proof.size,
      fingerprint: input.fingerprint,
      adminDecision: 'pending',
      financeDecision: 'pending',
      handedOver: false,
      amount: defaultBansosAmount(input.submission.kind, employee.employeeClass),
      period,
      withdrawn: false,
      revision: 1,
      submittedAt: now,
    };
    const created = serializeBansosRequest(input.requestId, { ...stored, submittedAt: new Date().toISOString() });
    const sync = bansosPaidInCash(input.submission.kind)
      ? null
      : await prepareBansosEventSync(transaction, { period, kind: input.submission.kind, changed: created, actor, now });

    transaction.create(requestRef, stored);
    sync?.write();
    transaction.create(newFinancialAuditRef(), buildFinancialAuditRecord(actor, {
      action: 'BANSOS_SUBMITTED',
      entityType: BANSOS_REQUESTS_COLLECTION,
      entityId: input.requestId,
      reason: `${BANSOS_KIND_LABELS[input.submission.kind]} diajukan`,
      requestId: input.requestId,
      after: { ...stored, submittedAt: null },
    }));
    return { requestId: input.requestId, status: created.status };
  });
}

/** The employee takes back an ajuan nobody has fully decided yet. */
export async function withdrawBansosRequest(
  actor: AuthenticatedProfile,
  employee: BansosEmployee,
  requestId: string,
): Promise<{ requestId: string; status: string }> {
  const requestRef = requests().doc(requestId);
  return adminDb.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(requestRef);
    if (!snapshot.exists || snapshot.data()?.employeeId !== employee.id) {
      throw new HttpError(404, 'Ajuan tidak ditemukan.');
    }
    const current = serializeBansosRequest(snapshot.id, snapshot.data()!);
    if (current.status === 'withdrawn') return { requestId, status: 'withdrawn' };
    if (!isBansosAwaiting(current.status)) {
      throw new HttpError(409, 'Ajuan yang sudah disetujui atau ditolak tidak dapat ditarik.');
    }
    const now = admin.firestore.FieldValue.serverTimestamp();
    const changed: BansosRequest = { ...current, withdrawn: true, status: 'withdrawn', revision: current.revision + 1 };
    const sync = bansosPaidInCash(current.kind)
      ? null
      : await prepareBansosEventSync(transaction, {
        period: bansosPayoutPeriod(current), kind: current.kind, changed, actor, now,
      });
    transaction.update(requestRef, { withdrawn: true, withdrawnAt: now, revision: changed.revision });
    sync?.write();
    transaction.create(newFinancialAuditRef(), buildFinancialAuditRecord(actor, {
      action: 'BANSOS_WITHDRAWN',
      entityType: BANSOS_REQUESTS_COLLECTION,
      entityId: requestId,
      reason: 'Ajuan ditarik pegawai',
      before: { adminDecision: current.adminDecision, financeDecision: current.financeDecision },
    }));
    return { requestId, status: 'withdrawn' };
  });
}

// ── Reviewer side ──────────────────────────────────────────────────────────

async function withDuplicateFlags(list: BansosRequest[]): Promise<BansosRequest[]> {
  const employeeIds = [...new Set(list.map((request) => request.employeeId))];
  const others: BansosRequest[] = [];
  for (let index = 0; index < employeeIds.length; index += 30) {
    const snapshot = await requests().where('employeeId', 'in', employeeIds.slice(index, index + 30)).get();
    snapshot.docs.forEach((doc) => others.push(serializeBansosRequest(doc.id, doc.data())));
  }
  return list.map((request) => ({ ...request, possibleDuplicate: possibleDuplicate(request, others) }));
}

export type BansosReviewTab = 'waiting' | 'handover' | 'decided' | 'all';

export function isBansosReviewTab(value: unknown): value is BansosReviewTab {
  return value === 'waiting' || value === 'handover' || value === 'decided' || value === 'all';
}

/**
 * The Verifikasi Ajuan Santunan list, seen from one side. "waiting" is what
 * still needs that side's decision (for Super Admin only Duka: Melahirkan is
 * decided in the Vakasi page), "handover" the Duka whose cash is still to be
 * handed over, "decided" what that side already decided.
 */
export async function listBansosForReview(tab: BansosReviewTab, side: BansosSide = 'admin'): Promise<BansosRequest[]> {
  const decisionField = side === 'admin' ? 'adminDecision' : 'financeDecision';
  const snapshot = tab === 'waiting'
    ? await requests().where(decisionField, '==', 'pending').get()
    : tab === 'handover'
      ? await requests().where('adminDecision', '==', 'accepted').get()
      : tab === 'decided'
        ? await requests().where(decisionField, 'in', ['accepted', 'rejected']).get()
        : await requests().orderBy('submittedAt', 'desc').limit(300).get();
  const list = snapshot.docs
    .map((doc) => serializeBansosRequest(doc.id, doc.data()))
    .filter((request) => {
      if (tab === 'waiting') return isBansosAwaiting(request.status) && (side === 'admin' || bansosPaidInCash(request.kind));
      if (tab === 'handover') return request.status === 'awaiting_handover';
      return true;
    })
    .sort((left, right) => right.submittedAt.localeCompare(left.submittedAt));
  return withDuplicateFlags(list);
}

/** The ajuan of one month's event of a kind, for the Vakasi page panel. */
export async function listBansosForEvent(period: string, kind: BansosKind): Promise<BansosRequest[]> {
  const [inPeriod, paidInPeriod] = await Promise.all([
    requests().where('period', '==', period).get(),
    requests().where('paidPeriod', '==', period).get(),
  ]);
  const byId = new Map<string, BansosRequest>();
  for (const doc of [...inPeriod.docs, ...paidInPeriod.docs]) {
    byId.set(doc.id, serializeBansosRequest(doc.id, doc.data()));
  }
  const list = [...byId.values()]
    .filter((request) => request.kind === kind && bansosPayoutPeriod(request) === period)
    .sort((left, right) => left.submittedAt.localeCompare(right.submittedAt));
  return withDuplicateFlags(list);
}

export interface BansosDecisionCommand {
  requestId: string;
  bansosRequestId: string;
  action: BansosAction;
  expectedRevision: number;
  reason?: string;
  amount?: number;
}

export type BansosHandoverCommand = Pick<BansosDecisionCommand, 'requestId' | 'bansosRequestId' | 'expectedRevision'> & {
  action: 'handover';
};

/** A reviewer's POST: one side's decision, or marking a Duka's cash handed over. */
export function parseBansosReviewCommand(raw: unknown): BansosDecisionCommand | BansosHandoverCommand {
  if (!raw || typeof raw !== 'object') throw new HttpError(400, 'Perintah tidak valid.');
  const value = raw as Record<string, unknown>;
  const action = value.action;
  if (action !== 'accept' && action !== 'reject' && action !== 'reset' && action !== 'handover') {
    throw new HttpError(400, 'Tindakan tidak valid.');
  }
  const expectedRevision = value.expectedRevision;
  if (typeof expectedRevision !== 'number' || !Number.isSafeInteger(expectedRevision) || expectedRevision < 1) {
    throw new HttpError(400, 'Revisi ajuan wajib dikirim. Muat ulang data.');
  }
  const base = {
    requestId: parseBansosId(value.requestId, 'requestId tidak valid.'),
    bansosRequestId: parseBansosId(value.bansosRequestId),
    expectedRevision,
  };
  if (action === 'handover') return { ...base, action };
  return {
    ...base,
    action,
    ...(typeof value.reason === 'string' ? { reason: value.reason } : {}),
    ...(value.amount !== undefined ? { amount: value.amount as number } : {}),
  };
}

export interface BansosDecisionResult {
  bansosRequestId: string;
  status: string;
  revision: number;
  paidPeriod?: string;
  propagationSummary: Record<string, number>;
  idempotent?: boolean;
}

function replayedResult(bansosRequestId: string, previous: FirebaseFirestore.DocumentData): BansosDecisionResult {
  return {
    bansosRequestId,
    status: String(previous.resultingStatus || ''),
    revision: Number(previous.revision || 0),
    ...(previous.paidPeriod ? { paidPeriod: String(previous.paidPeriod) } : {}),
    propagationSummary: {},
    idempotent: true,
  };
}

/**
 * One reviewer's decision. Admin Karyawan decides the "admin" side, Super Admin
 * the "finance" side; neither can decide for the other. When a Melahirkan
 * starts or stops being paid, its month's event is rebuilt in the same
 * transaction and the slips are refreshed after it. A Duka has no event.
 */
export async function decideBansos(
  actor: AuthenticatedProfile,
  command: BansosDecisionCommand,
): Promise<BansosDecisionResult> {
  const side = SIDE_BY_ROLE[actor.role];
  if (!side) throw new HttpError(403, 'Anda tidak berhak memutuskan ajuan BanSos.');
  const requestRef = requests().doc(command.bansosRequestId);
  const idempotencyRef = adminDb
    .collection('FinancialIdempotencyKeys')
    .doc(`${actor.uid}__bansos__${command.requestId}`);
  const requestHash = createHash('sha256').update(JSON.stringify(command)).digest('hex');

  const outcome = await adminDb.runTransaction(async (transaction) => {
    const [snapshot, idempotency] = await transaction.getAll(requestRef, idempotencyRef);
    if (idempotency.exists) {
      const previous = idempotency.data()!;
      if (previous.requestHash !== requestHash) {
        throw new HttpError(409, 'requestId sudah digunakan untuk keputusan lain.');
      }
      return { result: replayedResult(command.bansosRequestId, previous), syncs: [] as EventSync[] };
    }
    if (!snapshot.exists) throw new HttpError(404, 'Ajuan tidak ditemukan.');
    const current = serializeBansosRequest(snapshot.id, snapshot.data()!);
    if (current.revision !== command.expectedRevision) {
      throw new HttpError(409, 'Ajuan telah berubah di perangkat lain. Muat ulang sebelum melanjutkan.');
    }

    let plan;
    try {
      plan = planBansosDecision(current, side, command.action, { reason: command.reason, amount: command.amount });
    } catch (error) {
      throw new HttpError(409, error instanceof Error ? error.message : 'Keputusan tidak dapat diproses.');
    }

    // The month it is paid in: its own, or the current one when its own has
    // closed meanwhile. A payout leaving a closed month is refused.
    const currentMonth = jakartaToday().slice(0, 7);
    let paidPeriod: string | undefined;
    if (plan.willBePaid) {
      const [ownPeriod, thisMonth] = await transaction.getAll(
        adminDb.collection('PayrollPeriods').doc(current.period),
        adminDb.collection('PayrollPeriods').doc(currentMonth),
      );
      if (isPeriodClosed(ownPeriod.data())) {
        if (isPeriodClosed(thisMonth.data())) {
          throw new HttpError(409, `Periode ${current.period} dan ${currentMonth} sudah ditutup.`);
        }
        paidPeriod = currentMonth;
      }
    } else if (plan.wasPaid) {
      const payout = await transaction.get(adminDb.collection('PayrollPeriods').doc(bansosPayoutPeriod(current)));
      if (isPeriodClosed(payout.data())) {
        throw new HttpError(409, `Periode ${bansosPayoutPeriod(current)} sudah ditutup, pembayaran ini tidak dapat dibatalkan.`);
      }
    }

    // Who is paid is read fresh from the employee record at payment time.
    let jobCategory = current.jobCategory;
    let employeeName = current.employeeName;
    if (plan.willBePaid) {
      const employeeSnapshot = await transaction.get(adminDb.collection(current.employeeCollection).doc(current.employeeId));
      const data = employeeSnapshot.data() || {};
      const active = current.employeeCollection === 'Employees_Loyalis'
        ? data.personal_info?.status === 'AKTIF'
        : data.employment?.status === 'active';
      if (!employeeSnapshot.exists || !active) {
        throw new HttpError(409, `${current.employeeName || current.employeeId} sudah tidak aktif, ajuan tidak dapat dibayar.`);
      }
      if (current.employeeCollection === 'Employees_BlueCollar') {
        jobCategory = jobCategoryForPayrollPeriod(data, paidPeriod || current.period).normalize('NFKC').trim();
        if (!jobCategory) throw new HttpError(409, `Kategori Pekarya ${current.employeeName} belum diisi.`);
        employeeName = String(data.name || employeeName);
      } else {
        employeeName = String(data.personal_info?.name || employeeName);
      }
    }

    const decisionFields = side === 'admin'
      ? { adminDecision: plan.decision }
      : { financeDecision: plan.decision };
    const changed: BansosRequest = {
      ...current,
      ...decisionFields,
      amount: plan.amount,
      employeeName,
      ...(jobCategory ? { jobCategory } : {}),
      paidPeriod: plan.willBePaid ? paidPeriod : undefined,
      revision: current.revision + 1,
    };
    changed.status = bansosStatus(changed);

    const periods = bansosPaidInCash(current.kind)
      ? []
      : [...new Set([bansosPayoutPeriod(current), bansosPayoutPeriod(changed)])];
    const syncs: EventSync[] = [];
    for (const period of periods) {
      syncs.push(await prepareBansosEventSync(transaction, {
        period, kind: current.kind, changed, actor, now: admin.firestore.FieldValue.serverTimestamp(),
      }));
    }

    const now = admin.firestore.FieldValue.serverTimestamp();
    const prefix = side === 'admin' ? 'admin' : 'finance';
    const update: Record<string, unknown> = {
      ...decisionFields,
      [`${prefix}Reason`]: plan.reason,
      [`${prefix}By`]: plan.decision === 'pending' ? null : actor.uid,
      [`${prefix}ByName`]: plan.decision === 'pending' ? null : actor.displayName || actor.email || null,
      [`${prefix}At`]: plan.decision === 'pending' ? null : now,
      amount: plan.amount,
      employeeName,
      ...(jobCategory ? { jobCategory } : {}),
      paidPeriod: plan.willBePaid && paidPeriod ? paidPeriod : admin.firestore.FieldValue.delete(),
      revision: changed.revision,
      updatedAt: now,
    };
    transaction.update(requestRef, update);
    syncs.forEach((sync) => sync.write());
    transaction.create(newFinancialAuditRef(), buildFinancialAuditRecord(actor, {
      action: `BANSOS_${side.toUpperCase()}_${command.action.toUpperCase()}`,
      entityType: BANSOS_REQUESTS_COLLECTION,
      entityId: command.bansosRequestId,
      reason: plan.reason || `${BANSOS_KIND_LABELS[current.kind]}: ${command.action}`,
      requestId: command.requestId,
      before: {
        adminDecision: current.adminDecision,
        financeDecision: current.financeDecision,
        amount: current.amount,
        paidPeriod: current.paidPeriod || null,
      },
      after: {
        adminDecision: changed.adminDecision,
        financeDecision: changed.financeDecision,
        amount: changed.amount,
        paidPeriod: changed.paidPeriod || null,
      },
      metadata: {
        resultingStatus: changed.status,
        affectedEmployeeIds: syncs.flatMap((sync) => sync.affectedEmployeeIds),
        eventIds: syncs.map((sync) => sync.eventId),
      },
    }));
    transaction.create(idempotencyRef, {
      requestHash,
      entityId: command.bansosRequestId,
      revision: changed.revision,
      resultingStatus: changed.status,
      ...(changed.paidPeriod ? { paidPeriod: changed.paidPeriod } : {}),
      createdAt: now,
    });
    return {
      result: {
        bansosRequestId: command.bansosRequestId,
        status: changed.status,
        revision: changed.revision,
        ...(changed.paidPeriod ? { paidPeriod: changed.paidPeriod } : {}),
        propagationSummary: {},
      } as BansosDecisionResult,
      syncs,
    };
  });

  return {
    ...outcome.result,
    propagationSummary: await propagate(actor, outcome.syncs, command.requestId),
  };
}

/**
 * Admin Karyawan or Super Admin records that a Duka's cash was handed over.
 * It must be accepted by both first; afterwards neither decision can change.
 */
export async function markBansosHandedOver(
  actor: AuthenticatedProfile,
  command: BansosHandoverCommand,
): Promise<BansosDecisionResult> {
  if (!SIDE_BY_ROLE[actor.role]) throw new HttpError(403, 'Anda tidak berhak menandai penyerahan santunan.');
  const requestRef = requests().doc(command.bansosRequestId);
  const idempotencyRef = adminDb
    .collection('FinancialIdempotencyKeys')
    .doc(`${actor.uid}__bansos__${command.requestId}`);
  const requestHash = createHash('sha256').update(JSON.stringify(command)).digest('hex');

  return adminDb.runTransaction(async (transaction) => {
    const [snapshot, idempotency] = await transaction.getAll(requestRef, idempotencyRef);
    if (idempotency.exists) {
      const previous = idempotency.data()!;
      if (previous.requestHash !== requestHash) {
        throw new HttpError(409, 'requestId sudah digunakan untuk keputusan lain.');
      }
      return replayedResult(command.bansosRequestId, previous);
    }
    if (!snapshot.exists) throw new HttpError(404, 'Ajuan tidak ditemukan.');
    const current = serializeBansosRequest(snapshot.id, snapshot.data()!);
    if (current.revision !== command.expectedRevision) {
      throw new HttpError(409, 'Ajuan telah berubah di perangkat lain. Muat ulang sebelum melanjutkan.');
    }
    try {
      assertBansosHandover(current);
    } catch (error) {
      throw new HttpError(409, error instanceof Error ? error.message : 'Penyerahan tidak dapat dicatat.');
    }

    const now = admin.firestore.FieldValue.serverTimestamp();
    const revision = current.revision + 1;
    transaction.update(requestRef, {
      handedOver: true,
      handedOverAt: now,
      handedOverBy: actor.uid,
      handedOverByName: actor.displayName || actor.email || null,
      revision,
      updatedAt: now,
    });
    transaction.create(newFinancialAuditRef(), buildFinancialAuditRecord(actor, {
      action: 'BANSOS_HANDED_OVER',
      entityType: BANSOS_REQUESTS_COLLECTION,
      entityId: command.bansosRequestId,
      reason: `${BANSOS_KIND_LABELS[current.kind]} diserahkan tunai`,
      requestId: command.requestId,
      before: { handedOver: false },
      after: { handedOver: true, amount: current.amount },
    }));
    transaction.create(idempotencyRef, {
      requestHash,
      entityId: command.bansosRequestId,
      revision,
      resultingStatus: 'handed_over',
      createdAt: now,
    });
    return { bansosRequestId: command.bansosRequestId, status: 'handed_over', revision, propagationSummary: {} };
  });
}
