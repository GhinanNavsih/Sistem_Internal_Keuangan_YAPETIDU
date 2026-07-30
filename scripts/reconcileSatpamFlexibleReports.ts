/**
 * Idempotent Satpam report classification and SPJ reconciliation.
 *
 * Dry run is the default:
 *   npm run reconcile:satpam-flexible -- --period 2026-07
 *
 * Apply only after reviewing the JSON output:
 *   npm run reconcile:satpam-flexible -- --period 2026-07 --apply
 *
 * Closed periods are never financially rewritten. Their differences are
 * emitted as correction-workflow items.
 */
import './initEnv';
import admin, { adminDb } from '../src/lib/firebase-admin';
import {
  dedupeSatpamActivityReports,
  inferLegacySatpamReportKind,
  payrollPeriodForDutyDate,
  SATPAM_RATES,
  type SatpamActivityLike,
  type SatpamReportKind,
} from '../src/lib/payroll/domain';
import {
  activityBelongsToPayrollPeriod,
  approvedActivitySpjAmount,
  sumApprovedEventSpj,
} from '../src/lib/payroll/pekaryaSpj';

type Report = SatpamActivityLike & {
  id: string;
  jobCategory?: string;
  period?: string;
  payrollPeriod?: string;
  status?: string;
  activityDate?: string;
  reviewedBy?: string;
  approvedBy?: string;
  reviewedAt?: unknown;
  approvedAt?: unknown;
};

function optionalPeriod(): string | null {
  const index = process.argv.indexOf('--period');
  if (index < 0) return null;
  const value = process.argv[index + 1] || '';
  if (!/^\d{4}-\d{2}$/.test(value)) {
    throw new Error('Gunakan --period YYYY-MM.');
  }
  return value;
}

function classify(report: Report): SatpamReportKind {
  return inferLegacySatpamReportKind(report);
}

function reportPeriod(report: Report): string {
  return String(
    report.payrollPeriod ||
      (typeof report.activityDate === 'string'
        ? payrollPeriodForDutyDate(report.activityDate)
        : report.period || ''),
  );
}

async function updateInChunks(
  operations: Array<(batch: FirebaseFirestore.WriteBatch) => void>,
) {
  for (let offset = 0; offset < operations.length; offset += 400) {
    const batch = adminDb.batch();
    operations.slice(offset, offset + 400).forEach((operation) => operation(batch));
    await batch.commit();
  }
}

async function main() {
  const periodFilter = optionalPeriod();
  const apply = process.argv.includes('--apply');
  const [activitySnapshot, periodSnapshot, eventSnapshot] = await Promise.all([
    adminDb.collection('ActivityReports').where('jobCategory', '==', 'SATPAM').get(),
    adminDb.collection('PayrollPeriods').get(),
    adminDb.collection('KegiatanSpj').where('jobCategory', '==', 'SATPAM').get(),
  ]);
  const allReports: Report[] = activitySnapshot.docs
    .map((snapshot) => ({ id: snapshot.id, ...snapshot.data() } as Report))
    .filter((report) => !periodFilter || reportPeriod(report) === periodFilter);
  const openPeriods = new Set(
    periodSnapshot.docs
      .filter((snapshot) => snapshot.data()?.attendanceStatus === 'open')
      .map((snapshot) => snapshot.id),
  );
  const classifications = allReports
    .map((report) => ({
      report,
      reportKind: classify(report),
    }))
    .filter(({ report, reportKind }) => report.reportKind !== reportKind);
  const personalSpj = allReports.filter(
    (report) => classify(report) === 'satpam_spj',
  );
  const approvedPersonalSpj = personalSpj.filter(
    (report) => report.status === 'approved' && approvedActivitySpjAmount({
      ...report,
      reportKind: 'satpam_spj',
    }) > 0,
  );
  const ledgerRefs = approvedPersonalSpj.map((report) =>
    adminDb.collection('PayrollLedgerEntries').doc(`SPJ_ACTIVITY__${report.id}`),
  );
  const ledgerSnapshots = ledgerRefs.length
    ? await adminDb.getAll(...ledgerRefs)
    : [];
  const missingLedgers = approvedPersonalSpj.filter(
    (_, index) => !ledgerSnapshots[index]?.exists,
  );
  const correctionWorkflow = missingLedgers
    .filter((report) => !openPeriods.has(reportPeriod(report)))
    .map((report) => ({
      reportId: report.id,
      employeeId: report.employeeId,
      period: reportPeriod(report),
      amount: approvedActivitySpjAmount({ ...report, reportKind: 'satpam_spj' }),
      reason: 'Periode sudah tertutup; buat koreksi payroll, jangan ubah recap terkunci.',
    }));
  const openMissingLedgers = missingLedgers.filter((report) =>
    openPeriods.has(reportPeriod(report)),
  );
  const affectedOpenKeys = new Set(
    allReports
      .filter(
        (report) =>
          report.status === 'approved' &&
          typeof report.employeeId === 'string' &&
          openPeriods.has(reportPeriod(report)),
      )
      .map((report) => `${reportPeriod(report)}|${report.employeeId}`),
  );

  const recapChanges: Array<{
    period: string;
    employeeId: string;
    personalSpj: number;
    eventSpj: number;
    totalSpj: number;
    shiftCounts: Record<string, number>;
  }> = [];
  for (const key of affectedOpenKeys) {
    const [period, employeeId] = key.split('|');
    const reports = dedupeSatpamActivityReports(
      allReports.filter(
        (report) =>
          report.employeeId === employeeId &&
          report.status === 'approved' &&
          activityBelongsToPayrollPeriod(report, period),
      ),
    );
    const personalAmount = reports.reduce(
      (sum, report) =>
        sum +
        approvedActivitySpjAmount({
          ...report,
          reportKind: classify(report),
        }),
      0,
    );
    const eventAmount = sumApprovedEventSpj(
      eventSnapshot.docs.map((snapshot) => ({ id: snapshot.id, ...snapshot.data() })),
      employeeId,
      'SATPAM',
      period,
    );
    const shiftCounts = {
      harian: 0,
      jumatLibur: 0,
      lemburSendiri: 0,
      lemburCover: 0,
    };
    reports
      .filter((report) => classify(report) === 'satpam_shift_assignment')
      .forEach((report) => {
        if (report.shiftType === 'Harian') shiftCounts.harian += 1;
        if (report.shiftType === 'Jumat & Libur') shiftCounts.jumatLibur += 1;
        if (report.shiftType === 'Lembur Sendiri') shiftCounts.lemburSendiri += 1;
        if (report.shiftType === 'Lembur Cover') shiftCounts.lemburCover += 1;
      });
    recapChanges.push({
      period,
      employeeId,
      personalSpj: personalAmount,
      eventSpj: eventAmount,
      totalSpj: personalAmount + eventAmount,
      shiftCounts,
    });
  }

  process.stdout.write(`${JSON.stringify({
    mode: apply ? 'APPLY' : 'DRY_RUN',
    period: periodFilter || 'ALL',
    scanned: allReports.length,
    classificationBackfill: classifications.length,
    approvedPersonalSpj: {
      count: approvedPersonalSpj.length,
      amount: approvedPersonalSpj.reduce(
        (sum, report) =>
          sum + approvedActivitySpjAmount({ ...report, reportKind: 'satpam_spj' }),
        0,
      ),
    },
    missingOpenPeriodLedgers: openMissingLedgers.length,
    correctionWorkflow,
    recapChanges,
  }, null, 2)}\n`);

  if (!apply) return;

  const operations: Array<(batch: FirebaseFirestore.WriteBatch) => void> = [];
  classifications.forEach(({ report, reportKind }) => {
    operations.push((batch) =>
      batch.set(
        adminDb.collection('ActivityReports').doc(report.id),
        {
          reportKind,
          classificationBackfilledAt: admin.firestore.FieldValue.serverTimestamp(),
          classificationSchemaVersion: 1,
        },
        { merge: true },
      ),
    );
  });
  openMissingLedgers.forEach((report) => {
    operations.push((batch) =>
      batch.create(adminDb.collection('PayrollLedgerEntries').doc(`SPJ_ACTIVITY__${report.id}`), {
        employeeId: report.employeeId,
        jobCategory: 'SATPAM',
        period: reportPeriod(report),
        sourceType: 'ActivityReport',
        sourceId: report.id,
        reportKind: 'satpam_spj',
        earningCode: 'SPJ',
        amount: approvedActivitySpjAmount({ ...report, reportKind: 'satpam_spj' }),
        status: 'active',
        approvedBy: report.reviewedBy || report.approvedBy || null,
        approvedAt: report.reviewedAt || report.approvedAt || null,
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
        reconciliationVersion: 1,
        schemaVersion: 1,
      }),
    );
  });
  await updateInChunks(operations);

  for (const recap of recapChanges) {
    const recapRef = adminDb
      .collection('UraianGaji')
      .doc(`${recap.period.replace('-', '_')}_SATPAM`);
    await adminDb.runTransaction(async (transaction) => {
      const snapshot = await transaction.get(recapRef);
      if (!snapshot.exists) return;
      const entries = { ...(snapshot.data()?.entries || {}) };
      const current = entries[recap.employeeId];
      if (!current) return;
      entries[recap.employeeId] = {
        ...current,
        values: {
          ...(current.values || {}),
          harian: recap.shiftCounts.harian * SATPAM_RATES.Harian,
          jumatLibur:
            recap.shiftCounts.jumatLibur * SATPAM_RATES['Jumat & Libur'],
          lemburSendiri:
            recap.shiftCounts.lemburSendiri * SATPAM_RATES['Lembur Sendiri'],
          lemburCover:
            recap.shiftCounts.lemburCover * SATPAM_RATES['Lembur Cover'],
          spj: recap.totalSpj,
        },
        counts: {
          ...(current.counts || {}),
          ...recap.shiftCounts,
          spj: 0,
        },
      };
      transaction.update(recapRef, {
        entries,
        satpamReconciledAt: admin.firestore.FieldValue.serverTimestamp(),
      });
    });
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack || error.message : error);
  process.exitCode = 1;
});
