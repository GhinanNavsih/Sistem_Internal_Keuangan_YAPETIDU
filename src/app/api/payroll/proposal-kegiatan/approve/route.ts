import { NextRequest } from 'next/server';
import admin, { adminDb } from '@/lib/firebase-admin';
import {
  ensureExpenseRowIds,
  ExpenseReport,
  normalizeExpenseReportLinksToGroups,
  normalizeExpenseReports,
  ProposalExpenseRow,
} from '@/lib/payroll/proposalExpenseReports';
import { validateLpjApproval } from '@/lib/payroll/proposalExpenseApproval';
import {
  errorResponse,
  HttpError,
  requireAuthenticatedProfile,
  requireRole,
} from '@/lib/server/auth';
import { FINANCE_ROLES } from '@/lib/payroll/roles';

export const dynamic = 'force-dynamic';

interface ProposalData {
  period?: unknown;
  reportName?: unknown;
  departmentUnit?: unknown;
  status?: unknown;
  lpjPengeluaranRows?: unknown;
  pengeluaranRows?: unknown;
  expenseReports?: unknown;
}

interface NormalizedLpjData {
  rows: ProposalExpenseRow[];
  reports: ExpenseReport[];
}

function parseCommand(raw: unknown): { proposalId: string; note: string } {
  if (!raw || typeof raw !== 'object') throw new HttpError(400, 'Perintah persetujuan LPJ tidak valid.');
  const value = raw as Record<string, unknown>;
  const proposalId = typeof value.proposalId === 'string' ? value.proposalId.trim() : '';
  if (!proposalId || proposalId.length > 150) throw new HttpError(400, 'ID proposal tidak valid.');
  const note = typeof value.note === 'string' ? value.note.trim().slice(0, 2000) : '';
  return { proposalId, note };
}

function asRows(value: unknown): ProposalExpenseRow[] {
  if (!Array.isArray(value)) return [];
  return value.filter((row): row is ProposalExpenseRow => Boolean(row && typeof row === 'object')).map((row) => ({
    ...(row as ProposalExpenseRow),
    type: (row as ProposalExpenseRow).type === 'group_header' ? 'group_header' : 'item',
    uraian: typeof (row as ProposalExpenseRow).uraian === 'string' ? (row as ProposalExpenseRow).uraian : '',
    rincianQty: typeof (row as ProposalExpenseRow).rincianQty === 'string' ? (row as ProposalExpenseRow).rincianQty : '',
    rincianRate: Number.isFinite(Number((row as ProposalExpenseRow).rincianRate)) ? Number((row as ProposalExpenseRow).rincianRate) : 0,
    realisasi: Number.isFinite(Number((row as ProposalExpenseRow).realisasi)) ? Number((row as ProposalExpenseRow).realisasi) : 0,
  }));
}

function normalizeLpjData(data: ProposalData): NormalizedLpjData {
  const proposalRows = ensureExpenseRowIds(asRows(data.pengeluaranRows));
  const lpjRows = ensureExpenseRowIds(asRows(data.lpjPengeluaranRows).length > 0 ? asRows(data.lpjPengeluaranRows) : proposalRows.map((row) => ({
    ...row,
    realisasi: row.type === 'group_header' ? 0 : (row.realisasi ?? 0),
  })));

  const rowsWithLegacyLinks = lpjRows.map((row, index) => {
    const proposalRow = proposalRows.find((candidate) => candidate.rowId === row.rowId) || proposalRows[index];
    return row.type === 'group_header' && !row.reportId && proposalRow?.reportId
      ? { ...row, reportId: proposalRow.reportId, reportType: proposalRow.reportType }
      : row;
  });
  const reports = normalizeExpenseReports(data.expenseReports, rowsWithLegacyLinks);
  const normalizedLinks = normalizeExpenseReportLinksToGroups(rowsWithLegacyLinks, reports);
  const rowsWithReportIds = normalizedLinks.rows.map((row) => {
    if (row.type !== 'group_header' || row.reportId) return row;
    const linked = normalizedLinks.reports.find((report) => report.expenseRowId === row.rowId);
    return linked ? { ...row, reportId: linked.id } : row;
  });
  return { rows: rowsWithReportIds, reports: normalizedLinks.reports };
}

function getEmployeeIds(reports: ExpenseReport[]): string[] {
  return Array.from(new Set(reports
    .filter((report) => report.mode === 'employee')
    .flatMap((report) => report.rows.map((row) => row.employeeId.trim()).filter(Boolean))));
}

function payrollDocumentId(proposalId: string, reportId: string): string {
  return `proposal_lpj_${proposalId}_${reportId}`.replace(/[^A-Za-z0-9_-]/g, '_').slice(0, 140);
}

async function readActiveEmployees(employeeIds: string[]): Promise<Map<string, string>> {
  const snapshots = await Promise.all(employeeIds.map((employeeId) => adminDb.collection('Employees_Loyalis').doc(employeeId).get()));
  const names = new Map<string, string>();
  snapshots.forEach((snapshot, index) => {
    const data = snapshot.data();
    if (snapshot.exists && data?.personal_info?.status === 'AKTIF') {
      names.set(employeeIds[index], String(data.personal_info?.name || ''));
    }
  });
  return names;
}

function approvalError(errors: string[]): HttpError {
  const visibleErrors = errors.slice(0, 12);
  const suffix = errors.length > visibleErrors.length ? `\n... dan ${errors.length - visibleErrors.length} masalah lain.` : '';
  return new HttpError(400, `LPJ belum dapat disetujui:\n${visibleErrors.map((error) => `- ${error}`).join('\n')}${suffix}`);
}

export async function POST(request: NextRequest) {
  try {
    const actor = await requireAuthenticatedProfile(request);
    requireRole(actor, FINANCE_ROLES);
    const command = parseCommand(await request.json());
    const proposalRef = adminDb.collection('ProposalKegiatan').doc(command.proposalId);
    const initialSnapshot = await proposalRef.get();
    if (!initialSnapshot.exists) throw new HttpError(404, 'Proposal kegiatan tidak ditemukan.');

    const initialData = initialSnapshot.data() as ProposalData;
    const initialStatus = typeof initialData.status === 'string' ? initialData.status : '';
    if (initialStatus !== 'lpj_submitted' && initialStatus !== 'lpj_approved') {
      throw new HttpError(409, 'LPJ harus berada pada antrean pemeriksaan sebelum disetujui.');
    }
    const period = typeof initialData.period === 'string' ? initialData.period : '';
    if (!/^\d{4}-\d{2}$/.test(period)) throw new HttpError(400, 'Periode proposal tidak valid.');

    const initialNormalized = normalizeLpjData(initialData);
    const employeeIds = getEmployeeIds(initialNormalized.reports);
    const employeeNames = await readActiveEmployees(employeeIds);
    const validation = validateLpjApproval(initialNormalized.rows, initialNormalized.reports, new Set(employeeNames.keys()));
    if (!validation.valid) throw approvalError(validation.errors);

    const previousSourceSnapshot = await adminDb
      .collection('VakasiTambahan')
      .where('sourceProposalId', '==', command.proposalId)
      .get();
    const previousSourceDocs = previousSourceSnapshot.docs.filter((snapshot) => snapshot.data().sourceKind === 'proposal_lpj_report');

    const result = await adminDb.runTransaction(async (transaction) => {
      const proposalSnapshot = await transaction.get(proposalRef);
      const periodSnapshot = await transaction.get(adminDb.collection('PayrollPeriods').doc(period));
      if (!proposalSnapshot.exists) throw new HttpError(404, 'Proposal kegiatan tidak ditemukan.');
      if (periodSnapshot.data()?.attendanceStatus === 'closed') {
        throw new HttpError(409, 'Periode payroll sudah ditutup sehingga LPJ tidak dapat disetujui.');
      }
      const currentData = proposalSnapshot.data() as ProposalData;
      const currentStatus = typeof currentData.status === 'string' ? currentData.status : '';
      if (currentStatus !== 'lpj_submitted' && currentStatus !== 'lpj_approved') {
        throw new HttpError(409, 'Status LPJ berubah. Muat ulang proposal sebelum mencoba lagi.');
      }

      // The proposal document is the transaction boundary. The initial
      // validation protects the user-facing request, while this reread stops
      // a concurrent edit from being silently approved.
      const currentNormalized = normalizeLpjData(currentData);
      const currentEmployeeIds = getEmployeeIds(currentNormalized.reports);
      const currentEmployeeNames = currentEmployeeIds.length === employeeIds.length && currentEmployeeIds.every((id) => employeeIds.includes(id))
        ? employeeNames
        : await readActiveEmployees(currentEmployeeIds);
      const currentValidation = validateLpjApproval(currentNormalized.rows, currentNormalized.reports, new Set(currentEmployeeNames.keys()));
      if (!currentValidation.valid) throw approvalError(currentValidation.errors);

      const activePayrollIds = new Set<string>();
      let totalPayout = 0;
      let syncedReports = 0;
      currentValidation.linkedReports.forEach((report) => {
        if (report.mode !== 'employee') return;
        const workers = (currentValidation.workersByReport.get(report.id) || []).map((worker) => ({
          employeeName: currentEmployeeNames.get(worker.employeeId) || worker.employeeName,
          payGiven: worker.payGiven,
        }));
        const sourceId = payrollDocumentId(command.proposalId, report.id);
        activePayrollIds.add(sourceId);
        const totalReportPayout = workers.reduce((sum, worker) => sum + worker.payGiven, 0);
        totalPayout += totalReportPayout;
        transaction.set(adminDb.collection('VakasiTambahan').doc(sourceId), {
          eventName: report.title || report.expenseLabel || 'Laporan LPJ',
          period,
          totalPayout: totalReportPayout,
          isEndOfMonth: false,
          departmentUnit: typeof currentData.departmentUnit === 'string' ? currentData.departmentUnit : '',
          eventWorkers: Object.fromEntries(currentValidation.workersByReport.get(report.id)?.map((worker) => [worker.employeeId, {
            employeeName: currentEmployeeNames.get(worker.employeeId) || worker.employeeName,
            payGiven: worker.payGiven,
          }]) || []),
          status: 'approved',
          active: true,
          sourceKind: 'proposal_lpj_report',
          sourceProposalId: command.proposalId,
          sourceExpenseReportId: report.id,
          sourceExpenseRowId: report.expenseRowId,
          approvedBy: actor.uid,
          approvedByName: actor.displayName,
          approvedAt: admin.firestore.FieldValue.serverTimestamp(),
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
          createdAt: previousSourceDocs.find((snapshot) => snapshot.id === sourceId)?.data().createdAt || admin.firestore.FieldValue.serverTimestamp(),
        }, { merge: true });
        syncedReports += 1;
      });

      let staleReports = 0;
      previousSourceDocs.forEach((snapshot) => {
        if (activePayrollIds.has(snapshot.id)) return;
        transaction.set(adminDb.collection('VakasiTambahan').doc(snapshot.id), {
          status: 'void',
          active: false,
          voidedAt: admin.firestore.FieldValue.serverTimestamp(),
          voidedBy: actor.uid,
          voidedReason: 'Tidak lagi terhubung ke laporan LPJ yang disetujui.',
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        }, { merge: true });
        staleReports += 1;
      });

      transaction.set(proposalRef, {
        status: 'lpj_approved',
        reviewedBy: actor.uid,
        reviewedByName: actor.displayName,
        reviewedAt: admin.firestore.FieldValue.serverTimestamp(),
        reviewNote: command.note || null,
        payrollSyncedAt: admin.firestore.FieldValue.serverTimestamp(),
        payrollSyncedBy: actor.uid,
        payrollReportIds: Array.from(activePayrollIds),
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      }, { merge: true });

      return { syncedReports, staleReports, totalPayout };
    });

    return Response.json({ status: 'lpj_approved', ...result }, { status: 200, headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    return errorResponse(error);
  }
}
