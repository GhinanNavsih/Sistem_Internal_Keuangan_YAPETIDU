import { createHash, randomUUID } from 'node:crypto';
import admin, { adminDb } from '@/lib/firebase-admin';
import {
  ensureExpenseRowIds, normalizeExpenseReportLinksToGroups, normalizeExpenseReports,
  type ExpenseReport, type ProposalExpenseRow,
} from '@/lib/payroll/proposalExpenseReports';
import { validateLpjApproval } from '@/lib/payroll/proposalExpenseApproval';
import { PROPOSAL_LPJ_PAYROLL_SOURCE_KIND, type ResolvedVakasiWorker } from '@/lib/payroll/vakasiTambahan';
import { HttpError, type AuthenticatedProfile } from './auth';
import { assertVakasiSlipsEditable, rememberVakasiOwnedLabels, vakasiAffectedEmployeeIds } from './vakasiEventWrite';
import { propagateVakasiEmployees } from './vakasiPropagation';
import { buildFinancialAuditRecord, newFinancialAuditRef } from './audit';

export const proposalPayrollEventId = (proposalId: string, reportId: string) =>
  `LPJ_PAYROLL_${createHash('sha256').update(`${proposalId}\0${reportId}`).digest('hex').slice(0, 40)}`;

export function normalizeProposalLpj(data: FirebaseFirestore.DocumentData): { rows: ProposalExpenseRow[]; reports: ExpenseReport[] } {
  const proposalRows = ensureExpenseRowIds(Array.isArray(data.pengeluaranRows) ? data.pengeluaranRows : []);
  const rows = ensureExpenseRowIds(Array.isArray(data.lpjPengeluaranRows) && data.lpjPengeluaranRows.length
    ? data.lpjPengeluaranRows : proposalRows);
  const linkedRows = rows.map((row, index) => {
    const original = proposalRows.find(candidate => candidate.rowId === row.rowId) || proposalRows[index];
    return row.type === 'group_header' && !row.reportId && original?.reportId
      ? { ...row, reportId: original.reportId, reportType: original.reportType } : row;
  });
  const linked = normalizeExpenseReportLinksToGroups(linkedRows, normalizeExpenseReports(data.expenseReports, linkedRows));
  return { rows: linked.rows.map(row => {
    const report = linked.reports.find(candidate => candidate.expenseRowId === row.rowId);
    return row.type === 'group_header' && !row.reportId && report ? { ...row, reportId: report.id } : row;
  }), reports: linked.reports };
}

function historicalWorkers(data: FirebaseFirestore.DocumentData | undefined): ResolvedVakasiWorker[] {
  return Object.entries(data?.eventWorkers || {}).map(([employeeId, raw]) => {
    const worker = raw as { employeeName: string; payGiven: number };
    return { employeeId, employeeName: worker.employeeName, payGiven: worker.payGiven, employeeCollection: 'Employees_Loyalis' };
  });
}

/** Read and validate everything before the caller starts writing. */
export async function prepareProposalPayroll(transaction: FirebaseFirestore.Transaction, input: {
  proposalId: string; proposal: FirebaseFirestore.DocumentData; approved: boolean;
  revision: number; actor: AuthenticatedProfile;
  requestId: string;
}) {
  const { proposal, proposalId, actor } = input;
  const existingSnapshot = await transaction.get(adminDb.collection('VakasiTambahan').where('sourceProposalId', '==', proposalId));
  const existing = new Map(existingSnapshot.docs.filter(doc => doc.data().sourceKind === PROPOSAL_LPJ_PAYROLL_SOURCE_KIND).map(doc => [doc.id, doc]));
  const normalized = input.approved ? normalizeProposalLpj(proposal) : { rows: [], reports: [] };
  const ids = [...new Set(normalized.reports.filter(report => report.mode === 'employee').flatMap(report => report.rows.map(row => row.employeeId).filter(Boolean)))];
  if (ids.some(id => !/^[A-Za-z0-9_-]{1,128}$/.test(id))) throw new HttpError(400, 'ID penerima LPJ tidak valid.');
  const employees = ids.length ? await transaction.getAll(...ids.map(id => adminDb.collection('Employees_Loyalis').doc(id))) : [];
  const names = new Map(employees.filter(snapshot => snapshot.exists && snapshot.data()?.personal_info?.status === 'AKTIF')
    .map(snapshot => [snapshot.id, String(snapshot.data()!.personal_info.name || snapshot.id)]));
  if (input.approved) {
    const validation = validateLpjApproval(normalized.rows, normalized.reports, new Set(names.keys()));
    if (!validation.valid) throw new HttpError(400, `LPJ belum dapat disetujui:\n${validation.errors.slice(0, 12).join('\n')}`);
    if (new Set(normalized.reports.map(report => report.id)).size !== normalized.reports.length)
      throw new HttpError(400, 'ID laporan LPJ tidak boleh duplikat.');
    // Validate raw money before compatibility normalization can sanitize it.
    for (const report of Array.isArray(proposal.expenseReports) ? proposal.expenseReports : []) {
      if (!report || typeof report !== 'object' || report.mode !== 'employee') continue;
      if (!Array.isArray(report.rows)) throw new HttpError(400, 'Rincian laporan pegawai tidak valid.');
      for (const row of report.rows || []) {
        if (!row || typeof row !== 'object') throw new HttpError(400, 'Baris pembayaran pegawai tidak valid.');
        if (row.realisasi !== undefined && (!Number.isSafeInteger(row.realisasi) || row.realisasi < 0))
          throw new HttpError(400, 'REALISASI pembayaran pegawai wajib berupa rupiah bulat, nol atau lebih.');
      }
    }
  }
  const desired = new Map<string, { report: ExpenseReport; eventName: string; workers: ResolvedVakasiWorker[] }>();
  for (const report of normalized.reports.filter(report => report.mode === 'employee')) {
    const amounts = new Map<string, number>();
    for (const row of report.rows) {
      if (!row.employeeId) continue;
      if (!Number.isSafeInteger(row.realisasi) || row.realisasi < 0)
        throw new HttpError(400, 'REALISASI pembayaran pegawai wajib berupa rupiah bulat, nol atau lebih.');
      const sum = (amounts.get(row.employeeId) || 0) + row.realisasi;
      if (!Number.isSafeInteger(sum)) throw new HttpError(400, 'Total pembayaran pegawai melebihi batas nominal.');
      amounts.set(row.employeeId, sum);
    }
    const workers: ResolvedVakasiWorker[] = [...amounts].filter(([, amount]) => amount > 0).map(([employeeId, payGiven]) => ({
      employeeId, payGiven, employeeName: names.get(employeeId)!, employeeCollection: 'Employees_Loyalis',
    }));
    if (workers.length) desired.set(proposalPayrollEventId(proposalId, report.id), { report, workers, eventName: `${proposal.reportName} — ${report.title}` });
  }
  const affected = new Set<string>();
  for (const id of new Set([...existing.keys(), ...desired.keys()])) {
    const before = existing.get(id)?.data();
    const next = desired.get(id);
    for (const employeeId of vakasiAffectedEmployeeIds({ previousWorkers: historicalWorkers(before), previousEventName: before?.eventName || '',
      wasPayable: before?.status === 'approved', currentWorkers: next?.workers || [], currentEventName: next?.eventName || before?.eventName || '', willBePayable: Boolean(next) })) affected.add(employeeId);
  }
  const employeeIds = [...affected];
  await assertVakasiSlipsEditable(transaction, proposal.period, employeeIds, id => names.get(id) || id);
  const totalPayout = [...desired.values()].reduce((sum, entry) => sum + entry.workers.reduce((amount, worker) => amount + worker.payGiven, 0), 0);
  if (!Number.isSafeInteger(totalPayout)) throw new HttpError(400, 'Total pembayaran LPJ melebihi batas nominal.');
  return {
    employeeIds, payrollReportIds: [...desired.keys()], totalPayout, syncedReports: desired.size,
    payrollReportIdsByReport: Object.fromEntries([...desired].map(([id, entry]) => [entry.report.id, id])),
    staleReports: [...existing.keys()].filter(id => !desired.has(id)).length,
    write() {
      const now = admin.firestore.FieldValue.serverTimestamp();
      for (const [id, entry] of desired) {
        const before = existing.get(id)?.data();
        const after = {
          sourceKind: PROPOSAL_LPJ_PAYROLL_SOURCE_KIND, sourceProposalId: proposalId, sourceReportId: entry.report.id,
          sourceProposalRevision: input.revision, eventName: entry.eventName, period: proposal.period,
          departmentUnit: proposal.departmentUnit || null, isEndOfMonth: false,
          eventWorkers: Object.fromEntries(entry.workers.map(({ employeeId, ...worker }) => [employeeId, worker])),
          totalPayout: entry.workers.reduce((sum, worker) => sum + worker.payGiven, 0), status: 'approved',
          ownedEarningLabelsByEmployee: rememberVakasiOwnedLabels({ before: before?.ownedEarningLabelsByEmployee,
            previousWorkers: historicalWorkers(before), previousEventName: before?.eventName || '', currentWorkers: entry.workers, currentEventName: entry.eventName }),
          submittedBy: proposal.submittedBy || null, submittedByName: proposal.submittedByName || null, submittedByEmail: proposal.submittedByEmail || null,
          createdAt: before?.createdAt || now, createdBy: before?.createdBy || actor.uid,
          updatedAt: now, updatedBy: actor.uid, approvedBy: actor.uid, approvedAt: now,
          revision: Number(before?.revision || 0) + 1, schemaVersion: 3,
        };
        transaction.set(adminDb.collection('VakasiTambahan').doc(id), after);
        transaction.create(newFinancialAuditRef(), buildFinancialAuditRecord(actor, {
          action: 'PROPOSAL_LPJ_PAYROLL_PUBLISH', entityType: 'VakasiTambahan', entityId: id, requestId: input.requestId,
          reason: 'Pembayaran pegawai dari LPJ disetujui', before: before || null, after,
        }));
      }
      for (const [id, snapshot] of existing) if (!desired.has(id)) {
        const before = snapshot.data();
        const patch = { status: 'voided', sourceProposalRevision: input.revision, revision: Number(before.revision || 0) + 1,
          updatedAt: now, updatedBy: actor.uid, voidedAt: now, voidedBy: actor.uid };
        transaction.set(snapshot.ref, patch, { merge: true });
        transaction.create(newFinancialAuditRef(), buildFinancialAuditRecord(actor, {
          action: 'PROPOSAL_LPJ_PAYROLL_WITHDRAW', entityType: 'VakasiTambahan', entityId: id, requestId: input.requestId,
          reason: 'Pembayaran pegawai ditarik karena revisi atau penghapusan LPJ', before, after: { ...before, ...patch },
        }));
      }
    },
  };
}

/** The durable operation survives a lost response, a propagation error or deletion. */
export function proposalOperationRef(actorUid: string, requestId: string) {
  return adminDb.collection('FinancialIdempotencyKeys').doc(`proposal_${actorUid}__${requestId}`);
}

export async function finishProposalPayrollSync(actor: AuthenticatedProfile, operationId: string) {
  const ref = adminDb.collection('FinancialIdempotencyKeys').doc(operationId);
  const operation = (await ref.get()).data();
  if (!operation || operation.entityType !== 'ProposalKegiatan') throw new HttpError(404, 'Sinkronisasi LPJ tidak ditemukan.');
  if (!['super_admin', 'finance_verifier'].includes(actor.role) && operation.actorUid !== actor.uid) throw new HttpError(403, 'Sinkronisasi LPJ bukan milik akun Anda.');
  if (operation.payrollSyncStatus === 'complete') return { ...operation.result, payrollSyncStatus: 'complete', payrollSyncOperationId: operationId, propagationSummary: operation.propagationSummary || {} };
  const summary: Record<string, number> = {};
  // A retry must reevaluate statuses that blocked an earlier attempt. The
  // propagation merge recomputes totals, so a fresh attempt never adds twice.
  const attemptId = randomUUID();
  let error = '';
  try {
    for (let offset = 0; offset < operation.employeeIds.length; offset += 200) {
      const result = await propagateVakasiEmployees(actor, {
        period: operation.period, periodKey: operation.period.replace('-', '_'), employeeIds: operation.employeeIds.slice(offset, offset + 200),
        requestId: `lpj_${createHash('sha256').update(`${operationId}:${attemptId}:${offset}`).digest('hex').slice(0, 40)}`,
      });
      for (const [key, value] of Object.entries(result.summary)) summary[key] = (summary[key] || 0) + value;
      if (Object.entries(result.summary).some(([key, value]) => value > 0 && !['updated', 'unchanged', 'no_slip'].includes(key)))
        error = 'Perubahan payroll belum dapat diterapkan ke semua slip. Periksa status slip dan periode.';
    }
  } catch (failure) { error = failure instanceof Error ? failure.message : 'Sinkronisasi payroll gagal.'; }
  const payrollSyncStatus = error ? 'pending' : 'complete';
  await adminDb.runTransaction(async transaction => {
    const proposalRef = adminDb.collection('ProposalKegiatan').doc(operation.entityId);
    const proposal = await transaction.get(proposalRef);
    transaction.set(ref, { payrollSyncStatus, propagationSummary: summary, lastError: error || null, updatedAt: admin.firestore.FieldValue.serverTimestamp() }, { merge: true });
    if (proposal.exists && proposal.data()?.payrollSyncOperationId === operationId)
      transaction.update(proposalRef, { payrollSyncStatus, payrollSyncError: error || null });
  });
  return { ...operation.result, payrollSyncStatus, payrollSyncOperationId: operationId, propagationSummary: summary, ...(error ? { payrollSyncError: error } : {}) };
}
