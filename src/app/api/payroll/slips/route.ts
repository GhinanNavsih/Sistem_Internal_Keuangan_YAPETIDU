import { createHash } from 'node:crypto';
import { NextRequest } from 'next/server';
import admin, { adminDb } from '@/lib/firebase-admin';
import {
  calculatePayrollTotals,
  isImmutablePayrollStatus,
  validateMoneyFields,
} from '@/lib/payroll/domain';
import {
  isPekaryaJobCategory,
  pekaryaPayrollWindow,
  sumApprovedActivitySpj,
  sumApprovedEventSpj,
} from '@/lib/payroll/pekaryaSpj';
import { isSatpamDutyPlanRequired } from '@/lib/payroll/satpamDutyPlan';
import {
  canAuthorizePayroll,
  canOperatePayments,
  canVerifyPayroll,
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

export const dynamic = 'force-dynamic';

type PayrollAction =
  | 'save_draft'
  | 'finance_verify'
  | 'kbu_approve'
  | 'lock'
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
    'finance_verify',
    'kbu_approve',
    'lock',
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

export async function POST(request: NextRequest) {
  try {
    const actor = await requireAuthenticatedProfile(request);
    requireRole(actor, FINANCE_ROLES);
    const command = parseCommand(await request.json());
    const slipId = `${command.period}_${command.employeeId}`;

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
      const [
        slipSnapshot,
        idempotencySnapshot,
        periodSnapshot,
        blueEmployeeSnapshot,
        loyalisEmployeeSnapshot,
      ] = await Promise.all([
        transaction.get(slipRef),
        transaction.get(idempotencyRef),
        transaction.get(periodRef),
        transaction.get(blueEmployeeRef),
        transaction.get(loyalisEmployeeRef),
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
      const requiresConfiguredPeriod = ![
        'record_email_sent',
        'request_correction',
      ].includes(command.action);
      // Periods are open by default, so drafting never waits on an
      // administrator. Verification, locking, and payment still require an
      // explicit closure, which the attendanceStatus check below enforces.
      const periodData = periodSnapshot.data();
      if (
        requiresConfiguredPeriod &&
        command.action !== 'save_draft' &&
        periodData?.attendanceStatus !== 'closed'
      ) {
        throw new HttpError(
          409,
          'Tutup periode kehadiran sebelum verifikasi, penguncian, atau pembayaran.',
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
      if (command.action === 'save_draft' && blueEmployeeSnapshot.exists) {
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
        case 'save_draft': {
          if (before && before.status !== 'draft') {
            throw new HttpError(
              409,
              `Slip berstatus ${before.status}; hanya draf yang dapat diubah.`,
            );
          }
          const earnings = validateMoneyFields(command.earnings, 'earnings');
          const deductions = validateMoneyFields(command.deductions, 'deductions');
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
            schemaVersion: 2,
          };
          reason = command.reason?.trim() || 'Penyimpanan draf payroll';
          transaction.set(slipRef, after);
          break;
        }

        case 'finance_verify': {
          if (!canVerifyPayroll(actor.role)) {
            throw new HttpError(403, 'Hanya Badan Keuangan yang dapat memverifikasi.');
          }
          if (!before || before.status !== 'draft') {
            throw new HttpError(409, 'Hanya slip draf yang dapat diverifikasi.');
          }
          calculatePayrollTotals(
            validateMoneyFields(before.earnings, 'earnings'),
            validateMoneyFields(before.deductions, 'deductions'),
          );
          reason = requireReason(command);
          after = {
            ...before,
            status: 'finance_verified',
            financeVerifiedAt: now,
            financeVerifiedBy: actor.uid,
            financeVerificationReason: reason,
            revision: Number(before.revision || 0) + 1,
            updatedAt: now,
          };
          transaction.set(slipRef, after);
          break;
        }

        case 'kbu_approve': {
          if (!canAuthorizePayroll(actor.role)) {
            throw new HttpError(403, 'Hanya Kepala Biro Umum yang dapat mengesahkan.');
          }
          if (!before || before.status !== 'finance_verified') {
            throw new HttpError(409, 'Slip harus diverifikasi Badan Keuangan terlebih dahulu.');
          }
          if (before.financeVerifiedBy === actor.uid) {
            throw new HttpError(
              409,
              'Pengesah KBU harus berbeda dari petugas verifikasi Keuangan.',
            );
          }
          reason = requireReason(command);
          after = {
            ...before,
            status: 'kbu_approved',
            kbuApprovedAt: now,
            kbuApprovedBy: actor.uid,
            kbuApprovalReason: reason,
            revision: Number(before.revision || 0) + 1,
            updatedAt: now,
          };
          transaction.set(slipRef, after);
          break;
        }

        case 'lock': {
          if (!canAuthorizePayroll(actor.role)) {
            throw new HttpError(403, 'Hanya Kepala Biro Umum yang dapat mengunci payroll.');
          }
          if (!before || before.status !== 'kbu_approved') {
            throw new HttpError(409, 'Slip harus disahkan KBU sebelum dikunci.');
          }
          if (before.financeVerifiedBy === actor.uid) {
            throw new HttpError(
              409,
              'Pengunci harus berbeda dari petugas verifikasi Keuangan.',
            );
          }
          const immutableSnapshot = {
            employeeId: before.employeeId,
            period: before.period,
            earnings: before.earnings,
            deductions: before.deductions,
            totalEarnings: before.totalEarnings,
            totalDeductions: before.totalDeductions,
            netSalary: before.netSalary,
            financeVerifiedBy: before.financeVerifiedBy,
            kbuApprovedBy: before.kbuApprovedBy,
            revision: before.revision,
          };
          const lockedSnapshotHash = snapshotHash(immutableSnapshot);
          after = {
            ...before,
            status: 'locked',
            lockedAt: now,
            lockedBy: actor.uid,
            lockedSnapshotHash,
            lockedSnapshot: immutableSnapshot,
            revision: Number(before.revision || 0) + 1,
            updatedAt: now,
          };
          reason = command.reason?.trim() || 'Snapshot payroll disahkan dan dikunci';
          transaction.set(slipRef, after);
          break;
        }

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

      return { slipId, status: after.status, idempotent: false };
    });

    return Response.json(result, {
      status: result.idempotent ? 200 : 201,
      headers: { 'Cache-Control': 'no-store' },
    });
  } catch (error) {
    return errorResponse(error);
  }
}
