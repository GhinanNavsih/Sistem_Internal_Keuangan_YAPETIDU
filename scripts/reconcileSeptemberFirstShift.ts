import './initEnv';
import admin, { adminDb } from '../src/lib/firebase-admin';
import type { SatpamDutyPlanDay } from '../src/lib/payroll/satpamDutyPlan';

async function main() {
  const occurrenceId = 'team_3__20260901__pagi';
  const planDocId = '202609__team_3';

  const [occSnap, planSnap] = await Promise.all([
    adminDb.collection('ShiftOccurrences').doc(occurrenceId).get(),
    adminDb.collection('SatpamDutyPlans').doc(planDocId).get(),
  ]);

  if (!occSnap.exists) {
    throw new Error(`Occurrence ${occurrenceId} not found`);
  }
  if (!planSnap.exists) {
    throw new Error(`Plan ${planDocId} not found`);
  }

  const planData = planSnap.data()!;
  const planDay: SatpamDutyPlanDay | undefined = (planData.generatedDays || []).find(
    (d: any) => d.dutyDate === '2026-09-01',
  );
  if (!planDay) {
    throw new Error('Plan day for 2026-09-01 not found in duty plan');
  }

  const occData = occSnap.data()!;
  console.log('Current occurrence status:', {
    id: occurrenceId,
    dutyPlanId: occData.dutyPlanId,
    anomalyCodes: occData.anomalyCodes,
  });

  const reportIds: string[] = Array.isArray(occData.reportIds) ? occData.reportIds : [];
  const reports = await Promise.all(
    reportIds.map((id) => adminDb.collection('ActivityReports').doc(id).get()),
  );

  const batch = adminDb.batch();

  // Update Occurrence
  batch.update(occSnap.ref, {
    dutyPlanId: planDocId,
    dutyPlanRevision: planData.revision || 1,
    plannedAssignmentSnapshot: planDay,
    dutyPlanStale: false,
    anomalyCodes: ['DUTY_PLAN_BACKFILL_PENDING'],
    anomalies: [
      {
        code: 'DUTY_PLAN_BACKFILL_PENDING',
        severity: 'warning',
        message: 'Rencana dinas diterbitkan setelah tanggal ini dimulai (backfill).',
      },
    ],
    blockingAnomalyCount: 0,
    warningAnomalyCount: 1,
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  });

  // Update Reports
  for (const reportSnap of reports) {
    if (!reportSnap.exists) continue;
    const r = reportSnap.data()!;
    let scheduleRelation = 'planned_post';
    if (r.assignmentKind === 'extra') {
      scheduleRelation = 'off_duty_extra';
    } else if (r.postId === 'Pos 9') {
      scheduleRelation = 'designated_pos9';
    }

    batch.update(reportSnap.ref, {
      dutyPlanId: planDocId,
      dutyPlanRevision: planData.revision || 1,
      scheduleRelation,
      anomalyCodes: ['DUTY_PLAN_BACKFILL_PENDING'],
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    });
  }

  await batch.commit();
  console.log(`Successfully reconciled occurrence ${occurrenceId} and ${reports.length} reports.`);
}

main().catch(console.error);
