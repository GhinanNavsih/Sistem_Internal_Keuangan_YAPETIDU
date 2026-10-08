import { createHash } from 'node:crypto';
import admin, { adminDb } from '@/lib/firebase-admin';
import { normalizeNipy } from '@/lib/payroll/attendance';
import {
  applySenamPagiCommand,
  BONUS_TRIWULAN_AMOUNT,
  BONUS_TRIWULAN_COLLECTION,
  BONUS_TRIWULAN_LABEL,
  BONUS_TRIWULAN_SOURCE_KIND,
  BONUS_TRIWULAN_START_PERIOD,
  bonusTriwulanEventId,
  bonusTriwulanResultMatches,
  bonusTriwulanWindow,
  evaluateBonusTriwulan,
  isBonusTriwulanSeedPeriod,
  isValidPeriod,
  parseSenamPagiDoc,
  periodLabel,
  SENAM_PAGI_COLLECTION,
  senamPagiStanding,
  shiftPeriod,
  storedBonusTriwulanMissing,
  storedBonusTriwulanRecipients,
  type BonusTriwulanEvaluation,
  type SenamPagiCommand,
  type SenamPagiMonth,
  type SenamPagiStanding,
  type StratumEntryLike,
} from '@/lib/payroll/bonusTriwulan';
import { assertRequestId } from '@/lib/payroll/domain';
import { isPayrollEmployeeEligible } from '@/lib/payroll/payrollRoster';
import { SENAM_PAGI_EDITOR_ROLES, type UserRole } from '@/lib/payroll/roles';
import type { ResolvedVakasiWorker } from '@/lib/payroll/vakasiTambahan';
import { buildFinancialAuditRecord, newFinancialAuditRef } from './audit';
import { HttpError, type AuthenticatedProfile } from './auth';
import { loadEffectiveLoyalisPresence } from './loyalisPresence';
import { assertPeriodAcceptsInput, isPeriodClosed, jakartaToday } from './payrollPeriod';
import {
  assertVakasiSlipsEditable,
  rememberVakasiOwnedLabels,
  vakasiAffectedEmployeeIds,
} from './vakasiEventWrite';
import { propagateVakasiEmployees } from './vakasiPropagation';

/** Who may record Senam Pagi (and so trigger the bonus). */
export const SENAM_PAGI_WRITER_ROLES = SENAM_PAGI_EDITOR_ROLES;
/** Who may look at both, and ask for a recalculation (the presence page's save does). */
export const BONUS_TRIWULAN_READER_ROLES: readonly UserRole[] = ['super_admin', 'loyalis_admin', 'finance_verifier'];

const SYSTEM_ACTOR = 'system:bonus_triwulan';

function senamRef(period: string) {
  return adminDb.collection(SENAM_PAGI_COLLECTION).doc(period);
}

function resultRef(period: string) {
  return adminDb.collection(BONUS_TRIWULAN_COLLECTION).doc(period);
}

function periodRef(period: string) {
  return adminDb.collection('PayrollPeriods').doc(period);
}

export function parsePeriodParam(value: unknown): string {
  if (!isValidPeriod(value)) throw new HttpError(400, 'Periode wajib berformat YYYY-MM.');
  return value;
}

function timestampToIso(value: unknown): string | null {
  if (value && typeof value === 'object' && 'toDate' in value &&
    typeof (value as { toDate?: unknown }).toDate === 'function') {
    return (value as { toDate: () => Date }).toDate().toISOString();
  }
  return null;
}

// ── Roster ─────────────────────────────────────────────────────────────────

export interface LoyalisRosterEntry {
  employeeId: string;
  employeeName: string;
  nipy: string;
  unit: string;
}

/** Loyalis on the payroll in `period`, sorted by name. */
export async function loadLoyalisRoster(period: string): Promise<LoyalisRosterEntry[]> {
  const snapshot = await adminDb.collection('Employees_Loyalis').get();
  return snapshot.docs
    .filter((doc) => /^[A-Za-z0-9_-]{1,128}$/.test(doc.id) &&
      isPayrollEmployeeEligible('Employees_Loyalis', doc.data(), period))
    .map((doc) => {
      const data = doc.data();
      return {
        employeeId: doc.id,
        employeeName: String(data.personal_info?.name || doc.id),
        nipy: normalizeNipy(data.nipy || data.personal_info?.employee_id_niy || ''),
        unit: String(data.employment_profile?.department_unit || ''),
      };
    })
    .sort((left, right) => left.employeeName.localeCompare(right.employeeName, 'id-ID'));
}

// ── Evaluation ─────────────────────────────────────────────────────────────

export async function loadSenamPagiMonth(period: string): Promise<SenamPagiMonth | null> {
  const snapshot = await senamRef(period).get();
  return snapshot.exists ? parseSenamPagiDoc(period, snapshot.data()) : null;
}

function presenceEntries(
  presence: Record<string, unknown> | null,
): Record<string, StratumEntryLike | undefined> | null {
  const entries = presence?.entries;
  return entries && typeof entries === 'object'
    ? entries as Record<string, StratumEntryLike | undefined>
    : null;
}

interface ComputedBonus {
  evaluation: BonusTriwulanEvaluation;
  roster: LoyalisRosterEntry[];
  /** The month's own SenamPagi revision the evaluation read. */
  senamRevision: number;
}

/** Works month M out from what is stored now. Reads only. */
export async function computeBonusTriwulan(period: string): Promise<ComputedBonus> {
  const window = bonusTriwulanWindow(period);
  const [roster, presences, senams, priors] = await Promise.all([
    loadLoyalisRoster(period),
    Promise.all(window.map((month) => loadEffectiveLoyalisPresence(month))),
    Promise.all(window.map((month) => loadSenamPagiMonth(month))),
    adminDb.getAll(...window.slice(0, -1).map((month) => resultRef(month))),
  ]);
  const evaluation = evaluateBonusTriwulan({
    period,
    employees: roster,
    months: window.map((month, index) => ({
      period: month,
      presence: presenceEntries(presences[index]),
      senam: senams[index],
    })),
    priorRecipients: priors.map((snapshot, index) => ({
      period: window[index],
      recipients: snapshot.exists ? storedBonusTriwulanRecipients(snapshot.data()) : null,
    })),
  });
  return { evaluation, roster, senamRevision: senams[senams.length - 1]?.revision ?? 0 };
}

function workersFromEventDoc(data: FirebaseFirestore.DocumentData | undefined): ResolvedVakasiWorker[] {
  const workers = data?.eventWorkers && typeof data.eventWorkers === 'object'
    ? data.eventWorkers as Record<string, { employeeName?: unknown; payGiven?: unknown }>
    : {};
  return Object.entries(workers).map(([employeeId, worker]) => ({
    employeeId,
    employeeName: String(worker?.employeeName || employeeId),
    payGiven: Number(worker?.payGiven || 0),
    employeeCollection: 'Employees_Loyalis',
  }));
}

export interface BonusTriwulanSyncResult {
  period: string;
  changed: boolean;
  recipients: number;
  missing: string[];
  propagation: Record<string, number>;
}

/**
 * Works month M out again and makes the stored result, the Vakasi event that
 * pays it and the draft slips agree with it. A no-op when nothing changed.
 * When a later month already has a SAKU result and is still open, it is
 * recalculated too, since this month's payout resets its count.
 */
export async function evaluateAndSyncBonusTriwulan(
  actor: AuthenticatedProfile,
  period: string,
  requestId: string,
  options: { cascade?: boolean } = {},
): Promise<BonusTriwulanSyncResult> {
  if (period < BONUS_TRIWULAN_START_PERIOD) {
    throw new HttpError(409, `Bonus Triwulan dihitung otomatis mulai ${periodLabel(BONUS_TRIWULAN_START_PERIOD)}.`);
  }
  const eventRef = adminDb.collection('VakasiTambahan').doc(bonusTriwulanEventId(period));

  // The evaluation reads outside the transaction (three months of presence are
  // too large to hold in one); the month's own Senam Pagi revision is checked
  // inside it, so a roll call saved in between makes this run start over.
  let attempt = 0;
  for (;;) {
    attempt += 1;
    const { evaluation, roster, senamRevision } = await computeBonusTriwulan(period);
    const names = new Map(roster.map((entry) => [entry.employeeId, entry.employeeName]));
    const outcome = await adminDb.runTransaction(async (transaction) => {
      const [periodSnapshot, senamSnapshot, eventSnapshot, resultSnapshot] = await transaction.getAll(
        periodRef(period),
        senamRef(period),
        eventRef,
        resultRef(period),
      );
      assertPeriodAcceptsInput(
        periodSnapshot.data(),
        `Periode ${periodLabel(period)} sudah ditutup; Bonus Triwulan bulan ini tidak dapat dihitung ulang.`,
      );
      if (Number(senamSnapshot.data()?.revision || 0) !== senamRevision) {
        return { retry: true as const };
      }
      const before = eventSnapshot.exists ? eventSnapshot.data() : undefined;
      if (before && before.sourceKind !== BONUS_TRIWULAN_SOURCE_KIND) {
        throw new HttpError(409, `Dokumen ${eventRef.id} sudah dipakai kegiatan lain.`);
      }
      const storedResult = resultSnapshot.exists
        ? {
            recipients: storedBonusTriwulanRecipients(resultSnapshot.data()) || [],
            missing: storedBonusTriwulanMissing(resultSnapshot.data()),
          }
        : null;

      const previousWorkers = workersFromEventDoc(before);
      const currentWorkers: ResolvedVakasiWorker[] = evaluation.recipients.map((employeeId) => ({
        employeeId,
        employeeName: names.get(employeeId) || employeeId,
        payGiven: BONUS_TRIWULAN_AMOUNT,
        employeeCollection: 'Employees_Loyalis',
      }));
      const wasPayable = before?.status === 'approved';
      const willBePayable = currentWorkers.length > 0;
      const affectedEmployeeIds = vakasiAffectedEmployeeIds({
        previousWorkers,
        previousEventName: BONUS_TRIWULAN_LABEL,
        wasPayable,
        currentWorkers,
        currentEventName: BONUS_TRIWULAN_LABEL,
        willBePayable,
      });
      const eventInStep = before ? wasPayable === willBePayable : !willBePayable;
      if (affectedEmployeeIds.length === 0 && eventInStep &&
        bonusTriwulanResultMatches(storedResult, evaluation)) {
        return { retry: false as const, changed: false, affectedEmployeeIds, revision: 0 };
      }
      const previousNames = new Map(previousWorkers.map((worker) => [worker.employeeId, worker.employeeName]));
      await assertVakasiSlipsEditable(
        transaction,
        period,
        affectedEmployeeIds,
        (employeeId) => names.get(employeeId) || previousNames.get(employeeId) || employeeId,
      );

      const now = admin.firestore.FieldValue.serverTimestamp();
      if (before || willBePayable) {
        transaction.set(eventRef, {
          eventName: BONUS_TRIWULAN_LABEL,
          period,
          sourceKind: BONUS_TRIWULAN_SOURCE_KIND,
          isEndOfMonth: true,
          departmentUnit: null,
          eventWorkers: Object.fromEntries(currentWorkers.map((worker) => [
            worker.employeeId,
            {
              employeeName: worker.employeeName,
              payGiven: worker.payGiven,
              employeeCollection: worker.employeeCollection,
            },
          ])),
          totalPayout: currentWorkers.length * BONUS_TRIWULAN_AMOUNT,
          ownedEarningLabelsByEmployee: rememberVakasiOwnedLabels({
            before: before?.ownedEarningLabelsByEmployee,
            previousWorkers,
            previousEventName: BONUS_TRIWULAN_LABEL,
            currentWorkers,
            currentEventName: BONUS_TRIWULAN_LABEL,
          }),
          status: willBePayable ? 'approved' : 'pending_review',
          revision: Number(before?.revision || 0) + 1,
          createdAt: before?.createdAt || now,
          createdBy: before?.createdBy || SYSTEM_ACTOR,
          submittedBy: SYSTEM_ACTOR,
          submittedByName: 'Bonus Triwulan (Senam Pagi)',
          updatedAt: now,
          updatedBy: actor.uid,
          schemaVersion: 3,
        });
      }
      const revision = Number(resultSnapshot.data()?.revision || 0) + 1;
      const after = {
        period,
        source: 'saku',
        recipients: Object.fromEntries(currentWorkers.map((worker) => [
          worker.employeeId,
          { employeeName: worker.employeeName },
        ])),
        missing: evaluation.missing,
        amount: BONUS_TRIWULAN_AMOUNT,
        revision,
        evaluatedAt: now,
        evaluatedBy: actor.uid,
        evaluatedByName: actor.displayName || actor.email || actor.uid,
        schemaVersion: 1,
      };
      transaction.set(resultRef(period), after);
      transaction.create(newFinancialAuditRef(), buildFinancialAuditRecord(actor, {
        action: 'BONUS_TRIWULAN_EVALUATED',
        entityType: 'BonusTriwulan',
        entityId: period,
        reason: `Bonus Triwulan ${periodLabel(period)} dihitung ulang.`,
        requestId,
        before: storedResult,
        after: { recipients: evaluation.recipients, missing: evaluation.missing },
        metadata: { affectedEmployeeIds, eventId: eventRef.id },
      }));
      return { retry: false as const, changed: true, affectedEmployeeIds, revision };
    });

    if (outcome.retry) {
      if (attempt >= 3) {
        throw new HttpError(409, 'Senam Pagi sedang diubah; coba hitung ulang sebentar lagi.');
      }
      continue;
    }

    let propagation: Record<string, number> = {};
    if (outcome.affectedEmployeeIds.length > 0) {
      const result = await propagateVakasiEmployees(actor, {
        period,
        periodKey: period.replace('-', '_'),
        employeeIds: outcome.affectedEmployeeIds,
        requestId: `bonus_triwulan_${createHash('sha256')
          .update(`${requestId}:${period}:${outcome.revision}`)
          .digest('hex')
          .slice(0, 32)}`,
      });
      propagation = result.summary;
    }

    if (outcome.changed && options.cascade !== false) {
      const next = shiftPeriod(period, 1);
      const [nextResult, nextPeriod] = await adminDb.getAll(resultRef(next), periodRef(next));
      if (nextResult.exists && nextResult.data()?.source === 'saku' && !isPeriodClosed(nextPeriod.data())) {
        await evaluateAndSyncBonusTriwulan(actor, next, requestId, { cascade: true });
      }
    }

    return {
      period,
      changed: outcome.changed,
      recipients: evaluation.recipients.length,
      missing: evaluation.missing,
      propagation,
    };
  }
}

/**
 * Why month M may not close yet, or null. Used by the period-close route:
 * Senam Pagi must be recorded and the stored result must match a fresh one.
 */
export async function bonusTriwulanCloseBlocker(period: string): Promise<string | null> {
  if (period < BONUS_TRIWULAN_START_PERIOD) return null;
  const [{ evaluation }, stored] = await Promise.all([
    computeBonusTriwulan(period),
    resultRef(period).get(),
  ]);
  if (evaluation.missing.length > 0) {
    return `Bonus Triwulan belum dapat dihitung: ${evaluation.missing.join(' ')}`;
  }
  const storedResult = stored.exists
    ? {
        recipients: storedBonusTriwulanRecipients(stored.data()) || [],
        missing: storedBonusTriwulanMissing(stored.data()),
      }
    : null;
  if (!bonusTriwulanResultMatches(storedResult, evaluation)) {
    return 'Bonus Triwulan belum diperbarui — buka Senam Pagi › Hitung ulang.';
  }
  return null;
}

// ── What the page reads ────────────────────────────────────────────────────

export interface SenamPagiView {
  period: string;
  periodClosed: boolean;
  /** Before the automatic start: a paper month, or one with nothing to record. */
  readOnlyReason: string | null;
  month: {
    source: 'saku' | 'paper';
    noSessions: boolean;
    sessions: Array<{ date: string; presentEmployeeIds: string[] }>;
    revision: number;
  } | null;
  roster: Array<LoyalisRosterEntry & { standing: SenamPagiStanding }>;
}

export async function getSenamPagiView(period: string): Promise<SenamPagiView> {
  const [roster, month, periodSnapshot] = await Promise.all([
    loadLoyalisRoster(period),
    loadSenamPagiMonth(period),
    periodRef(period).get(),
  ]);
  const periodClosed = isPeriodClosed(periodSnapshot.data());
  let readOnlyReason: string | null = null;
  if (month?.source === 'paper') {
    readOnlyReason = 'Data bulan ini diambil dari arsip kertas.';
  } else if (period < BONUS_TRIWULAN_START_PERIOD) {
    readOnlyReason = `Senam Pagi dicatat di SAKU mulai ${periodLabel(BONUS_TRIWULAN_START_PERIOD)}.`;
  } else if (periodClosed) {
    readOnlyReason = 'Periode payroll bulan ini sudah ditutup.';
  }
  return {
    period,
    periodClosed,
    readOnlyReason,
    month: month
      ? { source: month.source, noSessions: month.noSessions, sessions: month.sessions, revision: month.revision }
      : null,
    roster: roster.map((entry) => ({ ...entry, standing: senamPagiStanding(month, entry.employeeId) })),
  };
}

export interface BonusTriwulanView {
  period: string;
  periodClosed: boolean;
  amount: number;
  /** A paper month: only who was paid is known. */
  paper: boolean;
  evaluation: BonusTriwulanEvaluation | null;
  stored: {
    recipients: Array<{ employeeId: string; employeeName: string }>;
    missing: string[];
    evaluatedAt: string | null;
    evaluatedByName: string | null;
  } | null;
  /** The stored result no longer matches what the data says now. */
  stale: boolean;
}

export async function getBonusTriwulanView(period: string): Promise<BonusTriwulanView> {
  const [stored, periodSnapshot] = await adminDb.getAll(resultRef(period), periodRef(period));
  const data = stored.exists ? stored.data() : undefined;
  const recipients = data?.recipients && typeof data.recipients === 'object'
    ? Object.entries(data.recipients as Record<string, { employeeName?: unknown }>)
        .map(([employeeId, value]) => ({ employeeId, employeeName: String(value?.employeeName || employeeId) }))
        .sort((left, right) => left.employeeName.localeCompare(right.employeeName, 'id-ID'))
    : [];
  const storedView = stored.exists
    ? {
        recipients,
        missing: storedBonusTriwulanMissing(data),
        evaluatedAt: timestampToIso(data?.evaluatedAt),
        evaluatedByName: typeof data?.evaluatedByName === 'string' ? data.evaluatedByName : null,
      }
    : null;
  const base = {
    period,
    periodClosed: isPeriodClosed(periodSnapshot.data()),
    amount: BONUS_TRIWULAN_AMOUNT,
    stored: storedView,
  };
  if (period < BONUS_TRIWULAN_START_PERIOD) {
    return { ...base, paper: true, evaluation: null, stale: false };
  }
  const { evaluation } = await computeBonusTriwulan(period);
  return {
    ...base,
    paper: false,
    evaluation,
    stale: !bonusTriwulanResultMatches(
      storedView ? { recipients: recipients.map((item) => item.employeeId), missing: storedView.missing } : null,
      evaluation,
    ),
  };
}

// ── Recording Senam Pagi ───────────────────────────────────────────────────

export interface SenamPagiWriteCommand {
  period: string;
  requestId: string;
  expectedRevision: number;
  command: SenamPagiCommand;
}

export function parseSenamPagiWriteCommand(raw: unknown): SenamPagiWriteCommand {
  if (!raw || typeof raw !== 'object') throw new HttpError(400, 'Permintaan tidak valid.');
  const body = raw as Record<string, unknown>;
  const period = parsePeriodParam(body.period);
  const requestId = typeof body.requestId === 'string' ? body.requestId : '';
  try {
    assertRequestId(requestId);
  } catch {
    throw new HttpError(400, 'requestId tidak valid.');
  }
  const expectedRevision = Number(body.expectedRevision);
  if (!Number.isInteger(expectedRevision) || expectedRevision < 0) {
    throw new HttpError(400, 'Revisi data Senam Pagi tidak valid.');
  }
  const date = typeof body.date === 'string' ? body.date : '';
  let command: SenamPagiCommand;
  switch (body.action) {
    case 'save_session': {
      const ids = Array.isArray(body.presentEmployeeIds) ? body.presentEmployeeIds : null;
      if (!ids || ids.length > 1000 ||
        ids.some((id) => typeof id !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(id))) {
        throw new HttpError(400, 'Daftar peserta Senam Pagi tidak valid.');
      }
      command = { action: 'save_session', date, presentEmployeeIds: ids as string[] };
      break;
    }
    case 'delete_session':
      command = { action: 'delete_session', date };
      break;
    case 'set_no_sessions':
      if (typeof body.noSessions !== 'boolean') throw new HttpError(400, 'Pilihan tidak valid.');
      command = { action: 'set_no_sessions', noSessions: body.noSessions };
      break;
    default:
      throw new HttpError(400, 'Aksi tidak valid.');
  }
  return { period, requestId, expectedRevision, command };
}

const AUDIT_ACTIONS: Record<SenamPagiCommand['action'], string> = {
  save_session: 'SENAM_PAGI_SESSION_SAVED',
  delete_session: 'SENAM_PAGI_SESSION_DELETED',
  set_no_sessions: 'SENAM_PAGI_NO_SESSIONS_SET',
};

export interface SenamPagiWriteResult {
  view: SenamPagiView;
  bonus: BonusTriwulanSyncResult | null;
  /** Set when the attendance saved but the bonus could not be recalculated. */
  bonusNote: string | null;
}

export async function writeSenamPagi(
  actor: AuthenticatedProfile,
  input: SenamPagiWriteCommand,
): Promise<SenamPagiWriteResult> {
  const { period, command } = input;
  if (period < BONUS_TRIWULAN_START_PERIOD || isBonusTriwulanSeedPeriod(period)) {
    throw new HttpError(409, `Senam Pagi dicatat di SAKU mulai ${periodLabel(BONUS_TRIWULAN_START_PERIOD)}.`);
  }
  const roster = await loadLoyalisRoster(period);
  const rosterIds = new Set(roster.map((entry) => entry.employeeId));

  await adminDb.runTransaction(async (transaction) => {
    const [periodSnapshot, senamSnapshot] = await transaction.getAll(periodRef(period), senamRef(period));
    assertPeriodAcceptsInput(
      periodSnapshot.data(),
      `Periode ${periodLabel(period)} sudah ditutup; Senam Pagi tidak dapat diubah.`,
    );
    const current = senamSnapshot.exists ? parseSenamPagiDoc(period, senamSnapshot.data()) : null;
    if ((current?.revision ?? 0) !== input.expectedRevision) {
      throw new HttpError(409, 'Data Senam Pagi baru saja diubah orang lain. Muat ulang halaman lalu coba lagi.');
    }
    const applied = applySenamPagiCommand(current, command, { period, today: jakartaToday(), rosterIds });
    if ('error' in applied) throw new HttpError(409, applied.error);

    const now = admin.firestore.FieldValue.serverTimestamp();
    const storedSessions = senamSnapshot.data()?.sessions && typeof senamSnapshot.data()?.sessions === 'object'
      ? senamSnapshot.data()!.sessions as Record<string, Record<string, unknown>>
      : {};
    const sessions = Object.fromEntries(applied.month.sessions.map((session) => {
      const changed = command.action === 'save_session' && command.date === session.date;
      const previous = storedSessions[session.date] || {};
      return [session.date, {
        presentEmployeeIds: session.presentEmployeeIds,
        recordedAt: changed ? now : previous.recordedAt || now,
        recordedBy: changed ? actor.uid : previous.recordedBy || actor.uid,
        recordedByName: changed
          ? actor.displayName || actor.email || actor.uid
          : previous.recordedByName || '',
      }];
    }));
    const revision = (current?.revision ?? 0) + 1;
    transaction.set(senamRef(period), {
      period,
      source: 'saku',
      noSessions: applied.month.noSessions,
      sessions,
      revision,
      createdAt: senamSnapshot.data()?.createdAt || now,
      updatedAt: now,
      updatedBy: actor.uid,
      schemaVersion: 1,
    });
    const sessionBefore = current?.sessions.find((session) => 'date' in command && session.date === command.date);
    transaction.create(newFinancialAuditRef(), buildFinancialAuditRecord(actor, {
      action: AUDIT_ACTIONS[command.action],
      entityType: 'SenamPagi',
      entityId: period,
      reason: `Senam Pagi ${periodLabel(period)} diperbarui.`,
      requestId: input.requestId,
      before: command.action === 'set_no_sessions'
        ? { noSessions: current?.noSessions ?? false }
        : sessionBefore ?? null,
      after: command.action === 'set_no_sessions'
        ? { noSessions: applied.month.noSessions }
        : applied.month.sessions.find((session) => session.date === command.date) ?? null,
      metadata: { revision },
    }));
  });

  let bonus: BonusTriwulanSyncResult | null = null;
  let bonusNote: string | null = null;
  try {
    bonus = await evaluateAndSyncBonusTriwulan(actor, period, input.requestId);
  } catch (error) {
    if (!(error instanceof HttpError)) {
      console.error('Gagal menghitung ulang Bonus Triwulan setelah Senam Pagi disimpan:', error);
    }
    bonusNote = error instanceof HttpError
      ? `Senam Pagi tersimpan, tetapi Bonus Triwulan belum diperbarui: ${error.message}`
      : 'Senam Pagi tersimpan, tetapi Bonus Triwulan belum diperbarui. Tekan "Hitung ulang" di tab Bonus Triwulan.';
  }
  return { view: await getSenamPagiView(period), bonus, bonusNote };
}
