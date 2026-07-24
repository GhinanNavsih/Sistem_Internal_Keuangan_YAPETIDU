/**
 * Read-only SATPAM payroll reconciliation.
 *
 * This script intentionally contains no create/set/update/delete/batch calls.
 * It prints findings to stdout and never changes Firestore or local files.
 *
 * Usage:
 *   npm run audit:satpam-payroll -- --period 2026-07
 */
import { adminDb } from '../src/lib/firebase-admin';
import {
  getRegularSatpamPayType,
  SATPAM_RATES,
  SatpamActivityLike,
} from '../src/lib/payroll/domain';

interface AuditFinding {
  severity: 'critical' | 'warning';
  code: string;
  documentId: string;
  detail: string;
}

function requiredPeriod(): string {
  const index = process.argv.indexOf('--period');
  const period = index >= 0 ? process.argv[index + 1] : '';
  if (!/^\d{4}-\d{2}$/.test(period || '')) {
    throw new Error('Gunakan --period YYYY-MM. Audit dibatalkan tanpa membaca database.');
  }
  return period;
}

async function main() {
  const period = requiredPeriod();
  const year = period.slice(0, 4);
  const [activitySnapshot, slipSnapshot, paymentSnapshot, calendarSnapshot] =
    await Promise.all([
      adminDb.collection('ActivityReports').where('period', '==', period).get(),
      adminDb
        .collection('PayrollSlipStates')
        .where('period', '==', period.replace('-', '_'))
        .get(),
      adminDb
        .collection('PayrollPayments')
        .where('period', '==', period.replace('-', '_'))
        .get(),
      adminDb.collection('PayrollHolidayCalendars').doc(year).get(),
    ]);

  const holidayDates = new Set<string>(
    Array.isArray(calendarSnapshot.data()?.dates)
      ? calendarSnapshot
          .data()!
          .dates.filter((date: unknown): date is string => typeof date === 'string')
      : [],
  );
  const findings: AuditFinding[] = [];
  const financialKeys = new Map<string, string>();
  const allPeriodReports: Array<SatpamActivityLike & Record<string, unknown>> =
    activitySnapshot.docs.map((document) => ({
      id: document.id,
      ...document.data(),
    }));
  const satpamReports = allPeriodReports.filter(
    (report) => report.jobCategory === 'SATPAM',
  );

  for (const report of satpamReports) {
    const documentId = report.id || '(unknown)';
    if (report.shiftType === 'Off-Duty') {
      if (Number(report.fee || 0) !== 0) {
        findings.push({
          severity: 'critical',
          code: 'OFF_DUTY_NON_ZERO',
          documentId,
          detail: `Off-Duty memiliki fee ${String(report.fee)}.`,
        });
      }
      continue;
    }

    const financialKey =
      typeof report.sourceLedgerEntryId === 'string' && report.sourceLedgerEntryId
        ? report.sourceLedgerEntryId
        : [
            report.employeeId || '',
            report.activityDate || '',
            report.shiftName || '',
            report.postName || '',
            report.shiftType || '',
          ].join('|');
    const previousId = financialKeys.get(financialKey);
    if (previousId) {
      findings.push({
        severity: 'critical',
        code: 'DUPLICATE_FINANCIAL_IDENTITY',
        documentId,
        detail: `Duplikat dengan ${previousId}; key=${financialKey}.`,
      });
    } else {
      financialKeys.set(financialKey, documentId);
    }

    if (
      report.shiftType &&
      report.shiftType in SATPAM_RATES &&
      Number(report.fee) !== SATPAM_RATES[report.shiftType as keyof typeof SATPAM_RATES]
    ) {
      findings.push({
        severity: 'critical',
        code: 'RATE_MISMATCH',
        documentId,
        detail: `Fee ${String(report.fee)} tidak cocok dengan ${report.shiftType}.`,
      });
    }

    if (
      (report.shiftType === 'Harian' || report.shiftType === 'Jumat & Libur') &&
      report.activityDate
    ) {
      const expected = getRegularSatpamPayType(report.activityDate, holidayDates);
      if (report.shiftType !== expected) {
        findings.push({
          severity: 'warning',
          code: 'CALENDAR_CLASSIFICATION_MISMATCH',
          documentId,
          detail: `Tercatat ${report.shiftType}, kalender saat ini mengevaluasi ${expected}. Hanya review; jangan ubah otomatis.`,
        });
      }
    }
  }

  for (const document of slipSnapshot.docs) {
    const slip = document.data();
    const netSalary = Number(slip.netSalary);
    if (!Number.isFinite(netSalary) || netSalary < 0) {
      findings.push({
        severity: 'critical',
        code: 'INVALID_NET_SALARY',
        documentId: document.id,
        detail: `netSalary=${String(slip.netSalary)}.`,
      });
    }
    if (
      ['confirmed', 'locked', 'payment_created', 'paid'].includes(slip.status) &&
      !slip.lockedSnapshotHash
    ) {
      findings.push({
        severity: 'warning',
        code: 'LEGACY_FINAL_WITHOUT_HASH',
        documentId: document.id,
        detail: 'Slip final historis tidak memiliki hash snapshot; jangan ubah otomatis.',
      });
    }
  }

  const paymentKeys = new Set<string>();
  for (const document of paymentSnapshot.docs) {
    const payment = document.data();
    const key = `${String(payment.employeeId)}|${String(payment.period)}`;
    if (paymentKeys.has(key)) {
      findings.push({
        severity: 'critical',
        code: 'DUPLICATE_PAYMENT',
        documentId: document.id,
        detail: `Lebih dari satu pembayaran untuk ${key}.`,
      });
    }
    paymentKeys.add(key);
  }

  process.stdout.write(
    `${JSON.stringify(
      {
        mode: 'READ_ONLY',
        period,
        scanned: {
          activityReports: satpamReports.length,
          payrollSlips: slipSnapshot.size,
          payments: paymentSnapshot.size,
        },
        summary: {
          critical: findings.filter((finding) => finding.severity === 'critical').length,
          warning: findings.filter((finding) => finding.severity === 'warning').length,
        },
        findings,
      },
      null,
      2,
    )}\n`,
  );
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
