/**
 * Read-only Pekarya SPJ reconciliation.
 *
 * This script intentionally contains no Firestore write calls.
 * Usage: npm run audit:pekarya-spj -- --period 2026-07
 */
import { adminDb } from '../src/lib/firebase-admin';
import {
  allowsManualSpjEntry,
  isPekaryaJobCategory,
  MANUAL_SPJ_ENTRY_CATEGORIES,
  normalizeActivityIdentityPart,
  pekaryaPayrollWindow,
  sumApprovedActivitySpj,
  sumApprovedEventSpj,
} from '../src/lib/payroll/pekaryaSpj';

interface Finding {
  severity: 'critical' | 'warning';
  code: string;
  documentId: string;
  detail: string;
}

type AuditDocument = { id: string } & Record<string, unknown>;

function requiredPeriod(): string {
  const index = process.argv.indexOf('--period');
  const period = index >= 0 ? process.argv[index + 1] : '';
  if (!/^\d{4}-\d{2}$/.test(period)) {
    throw new Error('Gunakan --period YYYY-MM. Audit dibatalkan tanpa membaca database.');
  }
  return period;
}

async function main() {
  const period = requiredPeriod();
  const window = pekaryaPayrollWindow(period);
  const [employeeSnapshot, eventSnapshot, slipSnapshot, ...activitySnapshots] =
    await Promise.all([
      adminDb.collection('Employees_BlueCollar').get(),
      adminDb.collection('KegiatanSpj').where('period', '==', period).get(),
      adminDb
        .collection('PayrollSlipStates')
        .where('period', '==', period.replace('-', '_'))
        .get(),
      ...window.sourceMonths.map((sourceMonth) =>
        adminDb.collection('ActivityReports').where('period', '==', sourceMonth).get(),
      ),
    ]);

  const employees = new Map(
    employeeSnapshot.docs.map((document) => [
      document.id,
      {
        category: String(document.data().employment?.jobCategory || ''),
      },
    ]),
  );
  const reports = activitySnapshots.flatMap((snapshot) =>
    snapshot.docs.map(
      (document) => ({ id: document.id, ...document.data() }) as AuditDocument,
    ),
  );
  const events = eventSnapshot.docs.map(
    (document) => ({ id: document.id, ...document.data() }) as AuditDocument,
  );
  // Categories still on paper SPJ for this period take their canonical value
  // from the manually entered Rekap Uraian instead of the activity sum.
  const manualSpj = new Map<string, number>();
  for (const jobCategory of MANUAL_SPJ_ENTRY_CATEGORIES) {
    if (!allowsManualSpjEntry(jobCategory, period)) continue;
    const uraianSnapshot = await adminDb
      .collection('UraianGaji')
      .doc(`${period.replace('-', '_')}_${jobCategory}`)
      .get();
    const entries = (uraianSnapshot.data()?.entries || {}) as Record<
      string,
      { values?: Record<string, unknown> }
    >;
    for (const [employeeId, entry] of Object.entries(entries)) {
      const value = Number(entry?.values?.spj);
      if (Number.isFinite(value)) manualSpj.set(employeeId, value);
    }
  }

  const findings: Finding[] = [];
  const semanticIdentities = new Map<string, string>();

  for (const report of reports) {
    if (report.jobCategory === 'SATPAM') continue;
    const identity = [
      report.employeeId,
      report.activityDate,
      report.timeStart,
      report.timeEnd,
      normalizeActivityIdentityPart(String(report.activityName || '')),
    ].join('|');
    const previous = semanticIdentities.get(identity);
    if (previous) {
      findings.push({
        severity: 'critical',
        code: 'DUPLICATE_ACTIVITY_IDENTITY',
        documentId: report.id,
        detail: `Duplikat semantik dengan ${previous}.`,
      });
    } else {
      semanticIdentities.set(identity, report.id);
    }
    if (
      report.status === 'approved' &&
      (typeof report.fee !== 'number' ||
        !Number.isSafeInteger(report.fee) ||
        report.fee <= 0)
    ) {
      findings.push({
        severity: 'critical',
        code: 'INVALID_APPROVED_AMOUNT',
        documentId: report.id,
        detail: `Laporan approved memiliki fee=${String(report.fee)}.`,
      });
    }
    if (
      report.status === 'approved' &&
      report.jobCategory === 'SOPIR' &&
      report.upahBersih !== undefined &&
      report.fee !== report.upahBersih
    ) {
      findings.push({
        severity: 'warning',
        code: 'LEGACY_DRIVER_AMOUNT_DIVERGENCE',
        documentId: report.id,
        detail: `fee=${String(report.fee)}, upahBersih=${String(report.upahBersih)}; canonical menggunakan upahBersih.`,
      });
    }
  }

  for (const event of events) {
    const eventWorkers =
      event.eventWorkers && typeof event.eventWorkers === 'object'
        ? (event.eventWorkers as Record<string, unknown>)
        : {};
    for (const employeeId of Object.keys(eventWorkers)) {
      const employee = employees.get(employeeId);
      if (!employee) {
        findings.push({
          severity: 'critical',
          code: 'UNKNOWN_EVENT_RECIPIENT',
          documentId: event.id,
          detail: `Penerima ${employeeId} tidak ditemukan.`,
        });
      } else if (event.jobCategory && event.jobCategory !== employee.category) {
        findings.push({
          severity: 'critical',
          code: 'CROSS_CATEGORY_EVENT_RECIPIENT',
          documentId: event.id,
          detail: `${employeeId} berkategori ${employee.category}, event berkategori ${event.jobCategory}.`,
        });
      }
    }
  }

  for (const slipDocument of slipSnapshot.docs) {
    const slip = slipDocument.data();
    const employeeId = String(slip.employeeId || '');
    const employee = employees.get(employeeId);
    if (!employee || !isPekaryaJobCategory(employee.category)) continue;
    const canonical =
      allowsManualSpjEntry(employee.category, period) &&
      manualSpj.has(employeeId)
        ? manualSpj.get(employeeId)!
        : sumApprovedActivitySpj(
            reports,
            employeeId,
            employee.category,
            period,
          ) +
          sumApprovedEventSpj(events, employeeId, employee.category, period);
    const earnings = Array.isArray(slip.earnings) ? slip.earnings : [];
    const slipSpj = earnings
      .filter(
        (field: unknown): field is { label: string; amount: number } =>
          Boolean(
            field &&
              typeof field === 'object' &&
              'label' in field &&
              'amount' in field &&
              typeof field.label === 'string' &&
              typeof field.amount === 'number' &&
              field.label.trim().toUpperCase() === 'SPJ',
          ),
      )
      .reduce((sum: number, field: { amount: number }) => sum + field.amount, 0);
    if (slipSpj !== canonical) {
      findings.push({
        severity: ['confirmed', 'locked', 'payment_created', 'paid'].includes(slip.status)
          ? 'critical'
          : 'warning',
        code: 'PAYSLIP_SPJ_MISMATCH',
        documentId: slipDocument.id,
        detail: `Slip SPJ=${slipSpj}; canonical=${canonical}. Audit hanya membaca.`,
      });
    }
  }

  process.stdout.write(
    `${JSON.stringify(
      {
        mode: 'READ_ONLY',
        period,
        scanned: {
          employees: employeeSnapshot.size,
          activityReports: reports.length,
          spjEvents: events.length,
          payrollSlips: slipSnapshot.size,
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
