import { adminDb } from '@/lib/firebase-admin';
import { isImmutablePayrollStatus } from '@/lib/payroll/domain';
import {
  buildVakasiPekaryaProjectionInputs,
  VAKASI_PEKARYA_PROJECTION_SOURCE_KIND,
  type ResolvedVakasiWorker,
} from '@/lib/payroll/vakasiTambahan';
import { HttpError } from '@/lib/server/auth';

/**
 * Write steps shared by every route that changes who a VakasiTambahan event
 * pays: the Vakasi event editor and the BanSos decisions. Each one runs inside
 * the caller's transaction, so an event, its Pekarya SPJ projections and the
 * slip-lock check always move together.
 */

/**
 * What a worker's row means for money. Two states with the same signature pay
 * the same, so a change that keeps it never needs to touch a slip.
 */
export function vakasiFinancialSignature(
  worker: ResolvedVakasiWorker | undefined,
  eventName: string,
): string {
  return worker
    ? [
        worker.employeeCollection,
        worker.jobCategory || '',
        worker.payGiven,
        worker.employeeCollection === 'Employees_Loyalis' ? eventName : '',
      ].join('|')
    : '';
}

/** The employees whose pay from this event changes between the two states. */
export function vakasiAffectedEmployeeIds(input: {
  previousWorkers: readonly ResolvedVakasiWorker[];
  previousEventName: string;
  wasPayable: boolean;
  currentWorkers: readonly ResolvedVakasiWorker[];
  currentEventName: string;
  willBePayable: boolean;
}): string[] {
  const previousById = new Map(input.previousWorkers.map((worker) => [worker.employeeId, worker]));
  const currentById = new Map(input.currentWorkers.map((worker) => [worker.employeeId, worker]));
  const allEmployeeIds = [...new Set([...previousById.keys(), ...currentById.keys()])];
  return allEmployeeIds.filter((employeeId) => {
    const previous = input.wasPayable ? previousById.get(employeeId) : undefined;
    const current = input.willBePayable ? currentById.get(employeeId) : undefined;
    return (
      vakasiFinancialSignature(previous, input.previousEventName) !==
      vakasiFinancialSignature(current, input.currentEventName)
    );
  });
}

/**
 * Refuses the change when any affected employee's slip for the period is
 * already locked or paid. Reads only, so it must run before the caller writes.
 */
export async function assertVakasiSlipsEditable(
  transaction: FirebaseFirestore.Transaction,
  period: string,
  affectedEmployeeIds: readonly string[],
  nameFor: (employeeId: string) => string,
): Promise<void> {
  if (affectedEmployeeIds.length === 0) return;
  const slipRefs = affectedEmployeeIds.map((employeeId) =>
    adminDb
      .collection('PayrollSlipStates')
      .doc(`${period.replace('-', '_')}_${employeeId}`),
  );
  const slipSnapshots = await transaction.getAll(...slipRefs);
  const immutableNames = slipSnapshots.flatMap((slipSnapshot, index) =>
    slipSnapshot.exists && isImmutablePayrollStatus(slipSnapshot.data()?.status)
      ? [nameFor(affectedEmployeeIds[index])]
      : [],
  );
  if (immutableNames.length > 0) {
    throw new HttpError(
      409,
      `Perubahan ditolak karena slip penerima berikut sudah dikunci/dibayar: ${immutableNames.join(', ')}.`,
    );
  }
}

/**
 * Every earning label a Loyalis worker has carried from this event, kept so a
 * renamed or removed row is still recognized (and cleaned up) on the slip.
 */
export function rememberVakasiOwnedLabels(input: {
  before: unknown;
  previousWorkers: readonly ResolvedVakasiWorker[];
  previousEventName: string;
  currentWorkers: readonly ResolvedVakasiWorker[];
  currentEventName: string;
}): Record<string, string[]> {
  const ownedEarningLabelsByEmployee = Object.fromEntries(
    Object.entries(
      input.before && typeof input.before === 'object'
        ? input.before as Record<string, unknown>
        : {},
    ).flatMap(([employeeId, labels]) => {
      const validLabels = Array.isArray(labels)
        ? labels.filter((label): label is string => typeof label === 'string' && Boolean(label.trim()))
        : [];
      return validLabels.length > 0 ? [[employeeId, validLabels.slice(-20)]] : [];
    }),
  ) as Record<string, string[]>;
  const remember = (worker: ResolvedVakasiWorker, label: string) => {
    if (worker.employeeCollection !== 'Employees_Loyalis' || !label.trim()) return;
    const labels = ownedEarningLabelsByEmployee[worker.employeeId] || [];
    if (!labels.some((existing) => existing.trim().toLocaleLowerCase('id-ID') === label.trim().toLocaleLowerCase('id-ID'))) {
      labels.push(label.trim());
    }
    ownedEarningLabelsByEmployee[worker.employeeId] = labels.slice(-20);
  };
  input.previousWorkers.forEach((worker) => remember(worker, input.previousEventName));
  input.currentWorkers.forEach((worker) => remember(worker, input.currentEventName));
  return ownedEarningLabelsByEmployee;
}

/** The KegiatanSpj projections an event owns; read it before any write. */
export function vakasiProjectionQuery(eventId: string): FirebaseFirestore.Query {
  return adminDb
    .collection('KegiatanSpj')
    .where('sourceVakasiEventId', '==', eventId);
}

/**
 * Writes one approved KegiatanSpj projection per Pekarya job category of an
 * approved event, and voids the projections it no longer owns. Returns the
 * ids it keeps.
 */
export function writeVakasiPekaryaProjections(
  transaction: FirebaseFirestore.Transaction,
  input: {
    eventId: string;
    eventName: string;
    period: string;
    workers: readonly ResolvedVakasiWorker[];
    approved: boolean;
    eventRevision: number;
    existingProjections: FirebaseFirestore.QuerySnapshot;
    actorUid: string;
    now: FirebaseFirestore.FieldValue;
  },
): string[] {
  const desiredProjections = input.approved
    ? buildVakasiPekaryaProjectionInputs({
        sourceVakasiEventId: input.eventId,
        eventName: input.eventName,
        period: input.period,
        workers: [...input.workers],
      })
    : [];
  const desiredProjectionIds = new Set(desiredProjections.map((projection) => projection.id));
  const existingProjections = new Map(
    input.existingProjections.docs.map((snapshot) => [snapshot.id, snapshot]),
  );

  for (const projection of desiredProjections) {
    const projectionRef = adminDb.collection('KegiatanSpj').doc(projection.id);
    const existingData = existingProjections.get(projection.id)?.data() || null;
    transaction.set(projectionRef, {
      ...projection,
      status: 'approved',
      revision: Number(existingData?.revision || 0) + 1,
      sourceVakasiRevision: input.eventRevision,
      approvedAt:
        existingData?.status === 'approved' && existingData.approvedAt
          ? existingData.approvedAt
          : input.now,
      approvedBy:
        existingData?.status === 'approved' && existingData.approvedBy
          ? existingData.approvedBy
          : input.actorUid,
      createdAt: existingData?.createdAt || input.now,
      createdBy: existingData?.createdBy || input.actorUid,
      updatedAt: input.now,
      updatedBy: input.actorUid,
      schemaVersion: 3,
    });
  }

  for (const projectionSnapshot of input.existingProjections.docs) {
    if (desiredProjectionIds.has(projectionSnapshot.id)) continue;
    const projectionData = projectionSnapshot.data();
    transaction.set(
      projectionSnapshot.ref,
      {
        status: 'voided',
        sourceKind: VAKASI_PEKARYA_PROJECTION_SOURCE_KIND,
        sourceVakasiEventId: input.eventId,
        sourceVakasiRevision: input.eventRevision,
        revision: Number(projectionData.revision || 0) + 1,
        voidedAt: input.now,
        voidedBy: input.actorUid,
        updatedAt: input.now,
        updatedBy: input.actorUid,
      },
      { merge: true },
    );
  }

  return desiredProjections.map((projection) => projection.id);
}
