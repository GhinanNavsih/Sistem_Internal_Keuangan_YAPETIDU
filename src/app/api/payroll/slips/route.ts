import { createHash } from 'node:crypto';
import { NextRequest } from 'next/server';
import admin, { adminDb } from '@/lib/firebase-admin';
import {
  calculatePayrollTotals,
  isImmutablePayrollStatus,
  validateMoneyFields,
} from '@/lib/payroll/domain';
import {
  allowsHistoricalPaperSpjEntry,
  allowsManualSpjEntry,
  isPekaryaJobCategory,
  pekaryaPayrollWindow,
  sumApprovedActivitySpj,
  sumApprovedEventSpj,
} from '@/lib/payroll/pekaryaSpj';
import { isSatpamDutyPlanRequired } from '@/lib/payroll/satpamDutyPlan';
import {
  resolveGapokFromMatrix,
  toSlipEmployeeView,
} from '@/lib/payroll/salaryMatrix';
import {
  shouldValidateNewSlipSources,
  validateNewSlipGapok,
} from '@/lib/payroll/pekaryaSlipPreview';
import {
  ActiveSalaryMatrix,
  loadActiveSalaryMatrix,
} from '@/lib/server/pekaryaSlipPreview';
import { isPayrollEmployeeEligible } from '@/lib/payroll/payrollRoster';
import { DRIFT_NOTICES_COLLECTION } from '@/lib/payroll/slipPropagation';
import {
  canOperatePayments,
  FINANCE_ROLES,
} from '@/lib/payroll/roles';
import { buildFinancialAuditRecord, newFinancialAuditRef } from '@/lib/server/audit';
import {
  errorResponse,
  HttpError,
  requireAuthenticatedProfile,
  requireRole,
} from '@/lib/server/auth';
import {
  pekaryaPublicationId,
  PEKARYA_PUBLICATIONS_COLLECTION,
} from '@/lib/server/attendanceStore';
import {
  prepareKoperasiPlanForDraft,
  verifyAndLockWithKoperasi,
} from '@/lib/server/payrollKoperasiSaga';
import {
  KoperasiBridgeError,
  replaceKoperasiLoanDeduction,
} from '@/lib/server/koperasiPayrollBridge';

export const dynamic = 'force-dynamic';

type PayrollAction =
  | 'save_draft'
  | 'repair_missing_draft'
  | 'verify_and_lock'
  | 'create_payment'
  | 'mark_paid'
  | 'record_email_sent'
  | 'request_correction';

interface PayrollCommand {
  action: PayrollAction;
  employeeId: string;
  period: string;
  requestId: string;
  reason?: string;
  earnings?: unknown;
  deductions?: unknown;
  paymentBatchId?: string;
  bankReference?: string;
}

function parseCommand(raw: unknown): PayrollCommand {
  if (!raw || typeof raw !== 'object') {
    throw new HttpError(400, 'Perintah payroll tidak valid.');
  }
  const command = raw as Partial<PayrollCommand>;
  const actions: PayrollAction[] = [
    'save_draft',
    'repair_missing_draft',
    'verify_and_lock',
    'create_payment',
    'mark_paid',
    'record_email_sent',
    'request_correction',
  ];
  if (!command.action || !actions.includes(command.action)) {
    throw new HttpError(400, 'Aksi payroll tidak valid.');
  }
  if (
    typeof command.employeeId !== 'string' ||
    !/^[A-Za-z0-9_-]{1,128}$/.test(command.employeeId) ||
    typeof command.period !== 'string' ||
    !/^\d{4}_\d{2}$/.test(command.period) ||
    typeof command.requestId !== 'string' ||
    !/^[A-Za-z0-9_-]{8,128}$/.test(command.requestId)
  ) {
    throw new HttpError(400, 'employeeId, period, atau requestId tidak valid.');
  }
  return command as PayrollCommand;
}

function snapshotHash(payload: unknown): string {
  return createHash('sha256').update(JSON.stringify(payload)).digest('hex');
}

function requireReason(command: PayrollCommand): string {
  const reason = command.reason?.trim() || '';
  if (reason.length < 8 || reason.length > 500) {
    throw new HttpError(400, 'Alasan wajib diisi antara 8 dan 500 karakter.');
  }
  return reason;
}

const LEGACY_CLOSED_DRAFT_REPAIR_PERIOD = '2026_07';

function isDraftWriteAction(action: PayrollAction): boolean {
  return action === 'save_draft' || action === 'repair_missing_draft';
}

/** First day of the payroll month a "YYYY_MM" period token names. */
function periodTargetDate(period: string): Date {
  const [year, month] = period.split('_').map(Number);
  return new Date(year, month - 1, 1);
}

function bridgeHttpError(error: KoperasiBridgeError): HttpError {
  return new HttpError(
    error.status >= 500 ? 503 : 409,
    `${error.message}${error.message.includes('Slip tetap berstatus draf') ? '' : ' Slip tetap berstatus draf.'}`,
  );
}

export async function POST(request: NextRequest) {
  try {
    const actor = await requireAuthenticatedProfile(request);
    requireRole(actor, FINANCE_ROLES);
    const command = parseCommand(await request.json());
    const slipId = `${command.period}_${command.employeeId}`;

    if (command.action === 'verify_and_lock') {
      const result = await verifyAndLockWithKoperasi(command, actor);
      return Response.json(result, {
        status: result.idempotent ? 200 : 201,
        headers: { 'Cache-Control': 'no-store' },
      });
    }

    let effectiveCommand = command;
    let koperasiInstallmentPlan = null;
    let repairedKoperasiDeduction: number | null = null;
    if (isDraftWriteAction(command.action)) {
      try {
        koperasiInstallmentPlan = await prepareKoperasiPlanForDraft(
          effectiveCommand,
          actor,
        );
      } catch (error) {
        const details = error instanceof KoperasiBridgeError
          ? error.details as { actualDeduction?: unknown } | null
          : null;
        const actualDeduction = Number(details?.actualDeduction);
        if (
          command.action === 'repair_missing_draft' &&
          error instanceof KoperasiBridgeError &&
          error.code === 'DEDUCTION_MISMATCH' &&
          Number.isSafeInteger(actualDeduction) &&
          actualDeduction >= 0
        ) {
          effectiveCommand = {
            ...command,
            deductions: replaceKoperasiLoanDeduction(
              validateMoneyFields(command.deductions, 'deductions'),
              actualDeduction,
            ),
          };
          repairedKoperasiDeduction = actualDeduction;
          try {
            koperasiInstallmentPlan = await prepareKoperasiPlanForDraft(
              effectiveCommand,
              actor,
            );
          } catch (retryError) {
            if (retryError instanceof KoperasiBridgeError) {
              throw bridgeHttpError(retryError);
            }
            throw retryError;
          }
        } else if (error instanceof KoperasiBridgeError) {
          throw bridgeHttpError(error);
        } else {
          throw error;
        }
      }
    }

    // The active matrices are read before the transaction: a new slip's Gaji
    // Pokok must equal what the matrix says, and nothing else, so a client
    // cannot persist a stale `salaryProfile.baseSalaryAmount` as though it
    // were the current figure.
    const activeMatrices: {
      blue: ActiveSalaryMatrix;
      loyalis: ActiveSalaryMatrix;
    } | null = isDraftWriteAction(command.action)
      ? {
          blue: await loadActiveSalaryMatrix('SalaryMatrix'),
          loyalis: await loadActiveSalaryMatrix('SalaryMatrix_WhiteCollar'),
        }
      : null;

    const result = await adminDb.runTransaction(async (transaction) => {
      const slipRef = adminDb.collection('PayrollSlipStates').doc(slipId);
      const idempotencyRef = adminDb
        .collection('FinancialIdempotencyKeys')
        .doc(`${actor.uid}__${command.requestId}`);
      const periodRef = adminDb
        .collection('PayrollPeriods')
        .doc(command.period.replace('_', '-'));
      const blueEmployeeRef = adminDb
        .collection('Employees_BlueCollar')
        .doc(command.employeeId);
      const loyalisEmployeeRef = adminDb
        .collection('Employees_Loyalis')
        .doc(command.employeeId);
      const periodSlipsQuery = adminDb
        .collection('PayrollSlipStates')
        .where('period', '==', command.period);
      const [
        slipSnapshot,
        idempotencySnapshot,
        periodSnapshot,
        blueEmployeeSnapshot,
        loyalisEmployeeSnapshot,
        periodSlipsSnapshot,
      ] = await Promise.all([
        transaction.get(slipRef),
        transaction.get(idempotencyRef),
        transaction.get(periodRef),
        transaction.get(blueEmployeeRef),
        transaction.get(loyalisEmployeeRef),
        transaction.get(periodSlipsQuery),
      ]);
      const before = slipSnapshot.exists ? slipSnapshot.data()! : null;
      const commandHash = snapshotHash(command);

      if (idempotencySnapshot.exists) {
        const previous = idempotencySnapshot.data()!;
        if (previous.requestHash !== commandHash || previous.entityId !== slipId) {
          throw new HttpError(409, 'requestId sudah digunakan untuk perintah berbeda.');
        }
        return {
          slipId,
          status: previous.resultingStatus,
          idempotent: true,
        };
      }
      if (!blueEmployeeSnapshot.exists && !loyalisEmployeeSnapshot.exists) {
        throw new HttpError(404, 'Pegawai payroll tidak ditemukan.');
      }
      const canRunOutsideClosedPeriod = [
        'record_email_sent',
        'request_correction',
      ].includes(command.action);
      const periodData = periodSnapshot.data();
      const periodClosed = periodData?.attendanceStatus === 'closed';
      if (command.action === 'save_draft' && periodClosed) {
        throw new HttpError(
          409,
          'Periode payroll sudah ditutup. Draf dan seluruh sumber nilainya telah dibekukan.',
        );
      }
      if (command.action === 'repair_missing_draft') {
        if (
          command.period !== LEGACY_CLOSED_DRAFT_REPAIR_PERIOD ||
          !periodClosed ||
          Number(periodData?.dataSealVersion || 0) !== 1 ||
          periodData?.payrollRosterSeal?.schemaVersion === 1
        ) {
          throw new HttpError(
            409,
            'Perbaikan draf tertutup hanya diizinkan untuk transisi Juli 2026 yang belum memiliki segel roster.',
          );
        }
        if (before) {
          throw new HttpError(
            409,
            'Draf pegawai sudah tersedia dan tidak boleh ditimpa oleh proses perbaikan. Muat ulang halaman.',
          );
        }
        if (blueEmployeeSnapshot.exists && loyalisEmployeeSnapshot.exists) {
          throw new HttpError(
            409,
            'ID pegawai ditemukan di dua koleksi payroll; perbaiki master data terlebih dahulu.',
          );
        }
        const eligible = blueEmployeeSnapshot.exists
          ? isPayrollEmployeeEligible(
              'Employees_BlueCollar',
              blueEmployeeSnapshot.data()!,
            )
          : isPayrollEmployeeEligible(
              'Employees_Loyalis',
              loyalisEmployeeSnapshot.data()!,
            );
        if (!eligible) {
          throw new HttpError(
            409,
            'Pegawai tidak termasuk roster payroll aktif yang dapat diperbaiki.',
          );
        }
      }
      if (
        !isDraftWriteAction(command.action) &&
        !canRunOutsideClosedPeriod &&
        !periodClosed
      ) {
        throw new HttpError(
          409,
          'Tutup periode payroll sebelum verifikasi, penguncian, atau pembayaran.',
        );
      }

      const now = admin.firestore.FieldValue.serverTimestamp();
      let after: Record<string, unknown>;
      let reason = command.reason?.trim() || 'Operasi payroll terotorisasi';
      let auditAction = command.action.toUpperCase();

      let canonicalPekaryaSpj: number | null = null;
      let canonicalAttendance:
        | { harian: number; jumatLibur: number }
        | null = null;
      let canonicalSatpamDuty:
        | { harian: number; jumatLibur: number; bonusPresensiBulanan: number }
        | null = null;
      const validateNewSlipSources = shouldValidateNewSlipSources(before);
      // Canonical source validation applies when the slip is materialized for
      // the first time (including the legacy missing-draft repair). An existing
      // editable draft is a stored snapshot: ordinary saves preserve Finance's
      // values, and the explicit Refresh flow is what opts into newer matrix,
      // SPJ, attendance, or SATPAM reconciliation inputs.
      if (
        isDraftWriteAction(command.action) &&
        blueEmployeeSnapshot.exists &&
        validateNewSlipSources
      ) {
        const employee = blueEmployeeSnapshot.data()!;
        const jobCategory = employee.employment?.jobCategory;
        if (!isPekaryaJobCategory(jobCategory)) {
          throw new HttpError(409, 'Kategori Pekarya pada master data tidak valid.');
        }
        const periodToken = command.period.replace('_', '-');
        const periodWindow = pekaryaPayrollWindow(periodToken);
        const canonicalSnapshots = await Promise.all([
          ...periodWindow.sourceMonths.map((sourceMonth) =>
            transaction.get(
              adminDb
                .collection('ActivityReports')
                .where('employeeId', '==', command.employeeId)
                .where('period', '==', sourceMonth),
            ),
          ),
          transaction.get(
            adminDb.collection('KegiatanSpj').where('period', '==', periodToken),
          ),
        ]);
        const activitySnapshots = canonicalSnapshots.slice(
          0,
          periodWindow.sourceMonths.length,
        );
        const eventSnapshot = canonicalSnapshots[canonicalSnapshots.length - 1];
        const activityReports = activitySnapshots.flatMap((snapshot) =>
          snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() })),
        );
        const events = eventSnapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
        canonicalPekaryaSpj =
          sumApprovedActivitySpj(
            activityReports,
            command.employeeId,
            jobCategory,
            periodToken,
          ) +
          sumApprovedEventSpj(events, command.employeeId, jobCategory, periodToken);

        if (
          allowsManualSpjEntry(jobCategory, periodToken) ||
          allowsHistoricalPaperSpjEntry(
            jobCategory,
            periodToken,
            command.employeeId,
          )
        ) {
          // The manual-SPJ categories had no digital activity reporting in the
          // July 2026 transition period, so the Kepala Satker's manual rekap
          // entry — not the activity sum — is the official SPJ. BC_053 and
          // BC_054 are the two historical paper-based KEBERSIHAN exceptions;
          // their locked July Rekap Uraian values are authoritative as well.
          const manualSpjSnapshot = await transaction.get(
            adminDb
              .collection('UraianGaji')
              .doc(`${command.period}_${jobCategory}`),
          );
          const storedSpj = Number(
            manualSpjSnapshot.data()?.entries?.[command.employeeId]?.values
              ?.spj,
          );
          if (Number.isFinite(storedSpj) && storedSpj >= 0) {
            canonicalPekaryaSpj = storedSpj;
          }
        }

        if (periodToken >= '2026-08' && jobCategory !== 'SATPAM') {
          const publicationRef = adminDb
            .collection(PEKARYA_PUBLICATIONS_COLLECTION)
            .doc(pekaryaPublicationId(periodToken, jobCategory));
          const uraianRef = adminDb
            .collection('UraianGaji')
            .doc(`${command.period}_${jobCategory}`);
          const importRef = adminDb
            .collection('AttendanceImports')
            .doc(periodToken);
          const [publicationSnapshot, uraianSnapshot, importSnapshot] =
            await Promise.all([
              transaction.get(publicationRef),
              transaction.get(uraianRef),
              transaction.get(importRef),
            ]);
          const publication = publicationSnapshot.data();
          const calendarRevision = Number(
            periodSnapshot.data()?.workCalendar?.revision || 1,
          );
          if (
            !publicationSnapshot.exists ||
            publication?.state !== 'published' ||
            publication?.stale === true ||
            publication?.importRevisionId !==
              importSnapshot.data()?.activeRevisionId ||
            Number(publication?.calendarRevision || 0) !== calendarRevision
          ) {
            throw new HttpError(
              409,
              `Presensi ${jobCategory} belum dipublikasikan pada revisi import dan kalender terbaru.`,
            );
          }
          const entry = uraianSnapshot.data()?.entries?.[command.employeeId];
          if (!entry) {
            throw new HttpError(
              409,
              'Hasil presensi resmi pegawai belum tersedia di Rekap Uraian.',
            );
          }
          canonicalAttendance = {
            harian: Number(entry.values?.harian || 0),
            jumatLibur: Number(entry.values?.jumatLibur || 0),
          };
        } else if (
          jobCategory === 'SATPAM' &&
          isSatpamDutyPlanRequired(
            periodToken,
            periodSnapshot.data() || null,
          )
        ) {
          const uraianSnapshot = await transaction.get(
            adminDb
              .collection('UraianGaji')
              .doc(`${command.period}_SATPAM`),
          );
          const entry =
            uraianSnapshot.data()?.entries?.[command.employeeId];
          if (
            !entry ||
            !entry.satpamDutySource ||
            uraianSnapshot.data()?.satpamDutyReconciliation?.blockerCount > 0
          ) {
            throw new HttpError(
              409,
              'Rekonsiliasi kewajiban dinas dan bonus Satpam belum final.',
            );
          }
          canonicalSatpamDuty = {
            harian: Number(entry.values?.harian || 0),
            jumatLibur: Number(entry.values?.jumatLibur || 0),
            bonusPresensiBulanan: Number(
              entry.values?.bonusPresensiBulanan || 0,
            ),
          };
        }
      }

      switch (command.action) {
        case 'save_draft':
        case 'repair_missing_draft': {
          const isLegacyRepair = command.action === 'repair_missing_draft';
          if (before && before.status !== 'draft') {
            throw new HttpError(
              409,
              `Slip berstatus ${before.status}; hanya draf yang dapat diubah.`,
            );
          }
          const earnings = validateMoneyFields(effectiveCommand.earnings, 'earnings');
          const deductions = validateMoneyFields(effectiveCommand.deductions, 'deductions');
          // A slip being created for the first time must carry exactly the
          // matrix's Gaji Pokok. Drafts that already exist keep whatever
          // manual edit Finance made until the next Refresh recalculates them.
          if (validateNewSlipSources && activeMatrices) {
            const isBlueCollar = blueEmployeeSnapshot.exists;
            const employeeData = isBlueCollar
              ? blueEmployeeSnapshot.data()!
              : loyalisEmployeeSnapshot.data()!;
            const active = isBlueCollar
              ? activeMatrices.blue
              : activeMatrices.loyalis;
            const resolution = resolveGapokFromMatrix(
              toSlipEmployeeView(
                { id: command.employeeId, ...employeeData },
                isBlueCollar ? 'blue' : 'loyalis',
              ),
              active.matrix,
              periodTargetDate(command.period),
            );
            const gapokError = validateNewSlipGapok(
              earnings,
              resolution,
              active.version,
            );
            if (gapokError) throw new HttpError(409, gapokError);
          }
          const plannedLoanIds = new Set(
            koperasiInstallmentPlan?.loans.map((loan) => loan.loanId) || [],
          );
          const conflictingSlip = periodSlipsSnapshot.docs.find((document) => {
            if (document.id === slipId) return false;
            const otherLoanIds = document.data()?.koperasiInstallmentPlan?.loans;
            return Array.isArray(otherLoanIds) && otherLoanIds.some(
              (loan: { loanId?: unknown }) =>
                typeof loan.loanId === 'string' && plannedLoanIds.has(loan.loanId),
            );
          });
          if (conflictingSlip) {
            throw new HttpError(
              409,
              `Pinjaman Koperasi juga cocok dengan slip ${conflictingSlip.id}. Perbaiki tautan UID pegawai sebelum menyimpan draf.`,
            );
          }
          if (canonicalPekaryaSpj !== null) {
            const spjFields = earnings.filter(
              (field) => field.label.trim().toUpperCase() === 'SPJ',
            );
            const submittedSpj = spjFields.reduce((sum, field) => sum + field.amount, 0);
            if (spjFields.length > 1 || submittedSpj !== canonicalPekaryaSpj) {
              throw new HttpError(
                409,
                `SPJ tidak sinkron. Nilai resmi adalah Rp${canonicalPekaryaSpj.toLocaleString('id-ID')}; muat ulang dan simpan rekap Pekarya.`,
              );
            }
          }
          if (canonicalAttendance) {
            const submittedHarian = earnings.filter(
              (field) => field.label.trim().toUpperCase() === 'VAKASI HARIAN',
            );
            const submittedPremium = earnings.filter(
              (field) => field.label.trim().toUpperCase() === 'JUMAT & LIBUR',
            );
            if (
              submittedHarian.length !== 1 ||
              submittedPremium.length !== 1 ||
              submittedHarian[0].amount !== canonicalAttendance.harian ||
              submittedPremium[0].amount !== canonicalAttendance.jumatLibur
            ) {
              throw new HttpError(
                409,
                'Nilai Harian/Jumat & Libur tidak sama dengan publikasi Presensi Pekarya terbaru. Muat ulang draf.',
              );
            }
          }
          if (canonicalSatpamDuty) {
            const submittedHarian = earnings.filter(
              (field) => field.label.trim().toUpperCase() === 'VAKASI HARIAN',
            );
            const submittedPremium = earnings.filter(
              (field) => field.label.trim().toUpperCase() === 'JUMAT & LIBUR',
            );
            const submittedBonus = earnings.filter(
              (field) =>
                field.label.trim().toUpperCase() ===
                'BONUS PRESENSI BULANAN',
            );
            if (
              submittedHarian.length !== 1 ||
              submittedPremium.length !== 1 ||
              submittedBonus.length !== 1 ||
              submittedHarian[0].amount !== canonicalSatpamDuty.harian ||
              submittedPremium[0].amount !== canonicalSatpamDuty.jumatLibur ||
              submittedBonus[0].amount !==
                canonicalSatpamDuty.bonusPresensiBulanan
            ) {
              throw new HttpError(
                409,
                'Nilai Harian, Jumat & Libur, atau Bonus Presensi Satpam tidak sama dengan rekonsiliasi terbaru. Muat ulang draf.',
              );
            }
          }
          const totals = calculatePayrollTotals(earnings, deductions);
          after = {
            employeeId: command.employeeId,
            period: command.period,
            status: 'draft',
            earnings,
            deductions,
            ...totals,
            revision: Number(before?.revision || 0) + 1,
            generatedAt: before?.generatedAt || now,
            updatedAt: now,
            updatedBy: actor.uid,
            koperasiInstallmentPlan,
            ...(isLegacyRepair
              ? {
                  closureRepair: {
                    schemaVersion: 1,
                    source: 'legacy_2026_07_missing_draft',
                    repairedAt: now,
                    repairedBy: actor.uid,
                    koperasiDeductionAdjusted:
                      repairedKoperasiDeduction !== null,
                    repairedKoperasiDeduction,
                  },
                }
              : {}),
            schemaVersion: 2,
          };
          reason = command.reason?.trim() || (isLegacyRepair
            ? 'Perbaikan draf payroll yang hilang pada penutupan Juli 2026'
            : 'Penyimpanan draf payroll');
          auditAction = isLegacyRepair
            ? 'PAYROLL_MISSING_DRAFT_REPAIRED'
            : auditAction;
          if (isLegacyRepair) {
            transaction.create(slipRef, after);
            transaction.set(periodRef, {
              legacyDraftRepairCount: admin.firestore.FieldValue.increment(1),
              legacyDraftRepairEmployeeIds:
                admin.firestore.FieldValue.arrayUnion(command.employeeId),
              legacyDraftRepairLastAt: now,
              legacyDraftRepairLastBy: actor.uid,
            }, { merge: true });
          } else {
            transaction.set(slipRef, after);
          }
          // A manual save re-derives from current data, so any profile drift
          // recorded against this slip has now been dealt with.
          transaction.delete(
            adminDb.collection(DRIFT_NOTICES_COLLECTION).doc(slipId),
          );
          break;
        }

        case 'verify_and_lock':
          // Handled before entering the single-project transaction because
          // Koperasi progression is a resumable cross-project saga.
          throw new HttpError(500, 'Jalur Verifikasi & Kunci tidak valid.');

        case 'create_payment': {
          if (!canOperatePayments(actor.role)) {
            throw new HttpError(403, 'Hanya Badan Keuangan yang dapat membuat pembayaran.');
          }
          if (!before || before.status !== 'locked') {
            throw new HttpError(409, 'Pembayaran hanya dapat dibuat dari slip terkunci.');
          }
          const paymentBatchId = command.paymentBatchId?.trim() || '';
          if (!/^[A-Za-z0-9_-]{8,128}$/.test(paymentBatchId)) {
            throw new HttpError(400, 'paymentBatchId tidak valid.');
          }
          const paymentRef = adminDb.collection('PayrollPayments').doc(slipId);
          const paymentSnapshot = await transaction.get(paymentRef);
          if (paymentSnapshot.exists) {
            throw new HttpError(409, 'Pembayaran employee-period ini sudah pernah dibuat.');
          }
          transaction.create(paymentRef, {
            employeeId: command.employeeId,
            period: command.period,
            slipId,
            paymentBatchId,
            amount: before.netSalary,
            currency: 'IDR',
            status: 'created',
            lockedSnapshotHash: before.lockedSnapshotHash || null,
            createdAt: now,
            createdBy: actor.uid,
            schemaVersion: 1,
          });
          after = {
            ...before,
            status: 'payment_created',
            paymentBatchId,
            paymentCreatedAt: now,
            paymentCreatedBy: actor.uid,
            updatedAt: now,
          };
          reason = command.reason?.trim() || 'Instruksi pembayaran dibuat';
          transaction.set(slipRef, after);
          break;
        }

        case 'mark_paid': {
          if (!canOperatePayments(actor.role)) {
            throw new HttpError(403, 'Hanya Badan Keuangan yang dapat mencatat pembayaran.');
          }
          if (!before || before.status !== 'payment_created') {
            throw new HttpError(409, 'Slip belum memiliki instruksi pembayaran.');
          }
          const bankReference = command.bankReference?.trim() || '';
          if (bankReference.length < 6 || bankReference.length > 128) {
            throw new HttpError(400, 'Referensi bank wajib diisi.');
          }
          const paymentRef = adminDb.collection('PayrollPayments').doc(slipId);
          const paymentSnapshot = await transaction.get(paymentRef);
          if (!paymentSnapshot.exists || paymentSnapshot.data()?.status !== 'created') {
            throw new HttpError(409, 'Status instruksi pembayaran tidak valid.');
          }
          transaction.update(paymentRef, {
            status: 'paid',
            bankReference,
            paidAt: now,
            paidBy: actor.uid,
          });
          after = {
            ...before,
            status: 'paid',
            bankReference,
            paidAt: now,
            paidBy: actor.uid,
            updatedAt: now,
          };
          reason = requireReason(command);
          transaction.set(slipRef, after);
          break;
        }

        case 'record_email_sent': {
          if (!before || !isImmutablePayrollStatus(before.status)) {
            throw new HttpError(409, 'Email hanya dapat dikirim untuk slip terkunci.');
          }
          after = {
            ...before,
            emailSent: true,
            emailSentAt: now,
            emailSentBy: actor.uid,
            updatedAt: now,
          };
          reason = command.reason?.trim() || 'Slip terkunci dikirim melalui email';
          transaction.set(slipRef, after);
          break;
        }

        case 'request_correction': {
          if (!before || !isImmutablePayrollStatus(before.status)) {
            throw new HttpError(409, 'Koreksi terkunci hanya berlaku untuk slip final.');
          }
          reason = requireReason(command);
          const correctionRef = adminDb.collection('PayrollCorrectionRequests').doc();
          transaction.create(correctionRef, {
            slipId,
            employeeId: command.employeeId,
            period: command.period,
            lockedSnapshotHash: before.lockedSnapshotHash || null,
            reason,
            status: 'pending',
            requestedAt: now,
            requestedBy: actor.uid,
            schemaVersion: 1,
          });
          after = before;
          auditAction = 'PAYROLL_CORRECTION_REQUESTED';
          break;
        }
      }

      transaction.create(
        newFinancialAuditRef(),
        buildFinancialAuditRecord(actor, {
          action: auditAction,
          entityType: 'PayrollSlipState',
          entityId: slipId,
          reason,
          requestId: command.requestId,
          before,
          after,
        }),
      );
      transaction.create(idempotencyRef, {
        actorUid: actor.uid,
        requestId: command.requestId,
        requestHash: commandHash,
        entityType: 'PayrollSlipState',
        entityId: slipId,
        resultingStatus: after.status,
        createdAt: now,
      });

      return {
        slipId,
        status: after.status,
        idempotent: false,
        ...(isDraftWriteAction(command.action) && koperasiInstallmentPlan
          ? {
              koperasiPlan: {
                loanCount: koperasiInstallmentPlan.loans.length,
                expectedDeduction: koperasiInstallmentPlan.expectedDeduction,
                matchType: koperasiInstallmentPlan.matchType,
                repairedDeduction: repairedKoperasiDeduction,
              },
            }
          : {}),
      };
    });

    return Response.json(result, {
      status: result.idempotent ? 200 : 201,
      headers: { 'Cache-Control': 'no-store' },
    });
  } catch (error) {
    return errorResponse(error);
  }
}
