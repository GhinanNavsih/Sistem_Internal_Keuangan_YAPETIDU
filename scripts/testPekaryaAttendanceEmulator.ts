/** Existing blank-status imports must reach review, publication and payslips. Emulator only. */
import assert from 'node:assert/strict';
import { NextRequest } from 'next/server';
import { PEKARYA_JOB_CATEGORIES } from '../src/lib/payroll/pekaryaSpj';
import { categoryUsesAttendanceImport } from '../src/utils/rekapConfig';

const PROJECT = 'demo-pekarya-attendance';

async function main() {
  if (
    process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID !== PROJECT ||
    !/^(localhost|127\.0\.0\.1):8188$/.test(process.env.FIRESTORE_EMULATOR_HOST || '') ||
    !/^(localhost|127\.0\.0\.1):9198$/.test(process.env.FIREBASE_AUTH_EMULATOR_HOST || '')
  ) {
    throw new Error('This test requires the demo Pekarya attendance Firestore and Auth emulators.');
  }
  const { adminDb: db, default: admin } = await import('../src/lib/firebase-admin');
  const { GET } = await import('../src/app/api/attendance/pekarya/route');
  const { POST: publish } = await import('../src/app/api/attendance/pekarya/publish/route');
  const { POST: correct } = await import('../src/app/api/attendance/pekarya/corrections/route');
  const { POST: reviewReport } = await import('../src/app/api/attendance/pekarya/official-leave/review/route');
  const { POST: saveSlip } = await import('../src/app/api/payroll/slips/route');
  const { POST: closePeriod } = await import('../src/app/api/payroll/periods/route');
  const { POST: propagate } = await import('../src/app/api/payroll/uraian-propagation/route');
  const { loadPekaryaSlipPreviews } = await import('../src/lib/server/pekaryaSlipPreview');
  const { attendanceCorrectionHeadId } = await import('../src/lib/server/attendanceStore');
  const signup = await fetch(
    `http://${process.env.FIREBASE_AUTH_EMULATOR_HOST}/identitytoolkit.googleapis.com/v1/accounts:signUp?key=demo`,
    {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'attendance-reviewer@example.test', password: 'password123', returnSecureToken: true }),
    },
  );
  const identity = await signup.json();
  assert.ok(identity.idToken, JSON.stringify(identity));
  await db.doc(`users/${identity.localId}`).set({ role: 'super_admin', displayName: 'Attendance reviewer' });
  const headers = { Authorization: `Bearer ${identity.idToken}`, 'Content-Type': 'application/json' };
  const period = '2026-09';
  const revisionId = '2026_09__r0001';
  await db.doc(`AttendanceImports/${period}`).set({ activeRevisionId: revisionId, activeRevision: 1 });
  await db.doc(`AttendanceImportRevisions/${revisionId}`).set({ revision: 1, status: 'active' });
  await db.doc(`PayrollPeriods/${period}`).set({ attendanceStatus: 'open', workCalendar: { revision: 1 } });

  const categories = PEKARYA_JOB_CATEGORIES.filter(categoryUsesAttendanceImport);
  const fixtures: Array<{ category: string; employeeId: string; nipy: string }> = [];
  const scans = [
    ['2026-09-01', '', '06:10:31', '16:01:32'],
    ['2026-09-02', '', '06:58:10', '14:01:52'],
    ['2026-09-03', '', '06:04:44', null],
    ['2026-09-04', '', '07:30:00', '14:00:00'],
    ['2026-09-05', 'TIDAK HADIR', '07:30:00', '14:00:00'],
    ['2026-09-06', '', '07:30:00', '14:00:00'],
    ['2026-09-07', '', null, null],
  ] as const;
  for (const [index, category] of categories.entries()) {
    const employeeId = `BC_ATTENDANCE_${index}`;
    const nipy = `140110000${String(index + 1).padStart(2, '0')}`;
    fixtures.push({ category, employeeId, nipy });
    await db.doc(`Employees_BlueCollar/${employeeId}`).set({
      name: `Worker ${category}`, nipy,
      employment: { status: 'active', jobCategory: category === 'KEBERSIHAN' ? 'SOPIR' : category, startDate: '2025-01-01',
        ...(category === 'KEBERSIHAN' ? { jobCategoryHistory: [
          { category: 'KEBERSIHAN', effectiveFrom: '2025-01-01' },
          { category: 'SOPIR', effectiveFrom: '2026-11-01' },
        ] } : {}),
      },
      flags: { isActive: true, isPayrollEligible: true },
    });
    for (const [dayIndex, [date, workStatus, scanIn, scanOut]] of scans.entries()) {
      // Exactly the old database shape, including its incorrect derived issue.
      await db.doc(`AttendanceImportRows/${employeeId}_${date}`).set({
        revisionId, period, rowNumber: index * 100 + dayIndex + 2,
        nipy, name: `Worker ${category}`, department: '', date, workStatus, scanIn, scanOut,
        issues: scanIn || scanOut ? ['SCAN_WITHOUT_MASUK'] : [],
      });
    }
    await db.doc(`PekaryaAttendanceCorrectionHeads/${attendanceCorrectionHeadId(period, employeeId, '2026-09-06')}`).set({
      period, employeeId, nipy, date: '2026-09-06', present: false, revision: 1,
    });
  }
  const getView = async (category: string, selectedPeriod = period) => {
    const response = await GET(new NextRequest(`http://localhost/api/attendance/pekarya?period=${selectedPeriod}&category=${category}`, { headers }));
    const result = await response.json();
    assert.equal(response.status, 200, JSON.stringify(result));
    return result;
  };
  for (const fixture of fixtures) {
    const view = await getView(fixture.category);
    assert.equal(view.employees.length, 1);
    const employee = view.employees[0];
    assert.equal(employee.payableDays, 4, fixture.category);
    const windowPolicy = ['KEBERSIHAN', 'TEKNISI'].includes(fixture.category);
    assert.equal(employee.harianAmount, windowPolicy ? 37_500 : 29_808);
    assert.equal(employee.jumatLiburAmount, 25_001);
    assert.equal(employee.totalAmount, windowPolicy ? 62_501 : 54_809);
    assert.equal(employee.incompletePunchCount, 1);
    assert.deepEqual(employee.days.map((day: { amount: number }) => day.amount), [12_500, 12_500, windowPolicy ? 12_500 : 4_808, 25_001, 0, 0, 0]);
    const denied = employee.days.find((day: { date: string }) => day.date === '2026-09-06');
    assert.equal(denied.present, false);
    assert.equal(denied.corrected, true);
    const partial = employee.days.find((day: { date: string }) => day.date === '2026-09-03');
    assert.equal(partial.scanOut, ['KEBERSIHAN', 'TEKNISI'].includes(fixture.category) ? '14:00:00' : '10:00:00');
    assert.equal(partial.scanOutAuto, true);
    assert.deepEqual(partial.issues, ['INCOMPLETE_PUNCH']);
  }
  const all = await getView('ALL');
  assert.equal(all.employees.length, fixtures.length);
  const employeeIds = fixtures.map((fixture) => fixture.employeeId);
  const provisional = await loadPekaryaSlipPreviews(period, employeeIds);
  for (const fixture of fixtures) {
    const preview = provisional.previews[fixture.employeeId];
    assert.equal(preview.meta.attendanceSource, 'uploaded_attendance');
    assert.ok(preview.meta.warnings.some((warning) => warning.code === 'attendance_unpublished'));
    assert.equal(provisional.attendanceLogs![fixture.employeeId].reduce((sum, day) => sum + day.amount, 0), ['KEBERSIHAN', 'TEKNISI'].includes(fixture.category) ? 62_501 : 54_809);
  }

  // Publication must persist those same exact amounts and keep source scans intact.
  const publication = await publish(new NextRequest('http://localhost/api/attendance/pekarya/publish', {
    method: 'POST', headers,
    body: JSON.stringify({
      requestId: 'pekarya-attendance-blank-status-test', period, category: 'ALL',
      acknowledgedWarnings: ['INCOMPLETE_PUNCH', 'CORRECTED_ATTENDANCE'],
    }),
  }));
  const published = await publication.json();
  assert.equal(publication.status, 200, JSON.stringify(published));
  for (const fixture of fixtures) {
    const uraian = (await db.doc(`UraianGaji/2026_09_${fixture.category}`).get()).data()!;
    const entry = uraian.entries[fixture.employeeId];
    assert.equal(uraian.attendancePublication.singleScanPolicy,
      ['KEBERSIHAN', 'TEKNISI'].includes(fixture.category) ? 'work_window_inferred' : 'offset_150_minutes');
    assert.equal(entry.values.harian, ['KEBERSIHAN', 'TEKNISI'].includes(fixture.category) ? 37_500 : 29_808);
    assert.equal(entry.values.jumatLibur, 25_001);
    assert.deepEqual(entry.counts, { harian: 3, jumatLibur: 1 });
    const source = (await db.doc(`AttendanceImportRows/${fixture.employeeId}_2026-09-03`).get()).data()!;
    assert.equal(source.workStatus, '');
    assert.equal(source.scanOut, null);
    assert.deepEqual(source.issues, ['SCAN_WITHOUT_MASUK']);
  }
  const final = await loadPekaryaSlipPreviews(period, employeeIds);
  for (const fixture of fixtures) {
    const preview = final.previews[fixture.employeeId];
    assert.equal(preview.meta.attendanceSource, 'uraian');
    assert.equal(preview.meta.warnings.some((warning) => warning.code === 'attendance_unpublished'), false);
  }

  async function post(handler: (request: NextRequest) => Promise<Response>, body: Record<string, unknown>, status: number) {
    const response = await handler(new NextRequest('http://localhost/test', {
      method: 'POST', headers, body: JSON.stringify(body),
    }));
    const data = await response.json();
    assert.equal(response.status, status, JSON.stringify(data));
    return data;
  }
  const technician = fixtures.find(f => f.category === 'TEKNISI')!;
  const cleaner = fixtures.find(f => f.category === 'KEBERSIHAN')!;
  const technicianPublication = db.doc('PekaryaAttendancePublications/2026_09__TEKNISI');
  await technicianPublication.update({ singleScanPolicy: admin.firestore.FieldValue.delete() });
  assert.equal((await getView('TEKNISI')).publication.stale, true);
  const stalePreview = await loadPekaryaSlipPreviews(period, [technician.employeeId]);
  assert.equal(stalePreview.previews[technician.employeeId].meta.attendanceSource, 'uploaded_attendance');
  assert.ok(stalePreview.previews[technician.employeeId].meta.warnings.some(w => w.code === 'attendance_unpublished'));
  const staleSave = { action: 'save_draft', period: '2026_09', employeeId: technician.employeeId,
    requestId: 'stale-policy-new-slip', earnings: [], deductions: [] };
  assert.match((await post(saveSlip, staleSave, 409)).error, /aturan scan/);
  await db.doc(`PayrollSlipStates/2026_09_${technician.employeeId}`).set({
    period: '2026_09', employeeId: technician.employeeId, status: 'draft', earnings: [], deductions: [],
  });
  assert.match((await post(saveSlip, { ...staleSave, requestId: 'stale-policy-existing-slip' }, 409)).error, /aturan scan/);
  assert.match((await post(propagate, { scope: 'pekarya', period, jobCategory: 'TEKNISI', requestId: 'stale-policy-propagation' }, 409)).error, /aturan scan/);
  await db.doc('LoyalisPresence/2026_09').set({ sourceImportRevision: 1, sourceCalendarRevision: 1 });
  await db.doc(`PayrollPeriods/${period}`).update({ calendarReconciliationStatus: 'complete' });
  assert.match((await post(closePeriod, { period, attendanceStatus: 'closed' }, 409)).error, /aturan scan/);
  // The same refusal as a progress stream: finished steps count up, then the error.
  const streamed = await closePeriod(new NextRequest('http://localhost/test', {
    method: 'POST',
    headers: { ...headers, 'x-progress-stream': '1' },
    body: JSON.stringify({ period, attendanceStatus: 'closed' }),
  }));
  assert.match(streamed.headers.get('content-type') || '', /application\/x-ndjson/);
  const events = (await streamed.text()).trim().split('\n').map((line) => JSON.parse(line));
  const steps = events.filter((event) => event.type === 'progress');
  assert.deepEqual(steps.map((event) => event.completed), [0, 1, 2], 'one step finished per event');
  assert.ok(steps.every((event) => event.total === 5 && event.label));
  assert.equal(events.at(-1).type, 'error');
  assert.equal(events.at(-1).status, 409);
  assert.match(events.at(-1).message, /aturan scan/);
  await post(publish, { period, category: 'TEKNISI', requestId: 'republish-new-scan-policy',
    acknowledgedWarnings: ['INCOMPLETE_PUNCH', 'CORRECTED_ATTENDANCE'] }, 200);
  assert.equal((await getView('TEKNISI')).publication.stale, false);

  // A one-sided correction and a correction that leaves the imported side in
  // place must both persist exactly what the next review and payslip display.
  const correction = { period, category: 'TEKNISI', employeeId: technician.employeeId,
    date: '2026-09-03', present: true, scanIn: '08:30', scanOut: null, expectedRevision: 0,
    requestId: 'correct-one-sided-policy', reason: 'Koreksi jam masuk pegawai' };
  await post(correct, correction, 200);
  const correctedView = await getView('TEKNISI');
  const correctedDay = correctedView.employees[0].days.find((day: { date: string }) => day.date === correction.date);
  assert.deepEqual([correctedDay.scanIn, correctedDay.scanOut, correctedDay.amount], ['08:30:00', '14:00:00', 10_577]);
  assert.equal((await db.doc('UraianGaji/2026_09_TEKNISI').get()).data()!.entries[technician.employeeId].values.harian, 35_577);
  assert.equal((await post(correct, correction, 200)).idempotent, true);
  await post(correct, { ...correction, category: 'KEBERSIHAN', employeeId: cleaner.employeeId,
    requestId: 'correct-preserve-source-side', scanIn: undefined, scanOut: '12:00' }, 200);
  const cleanedView = await getView('KEBERSIHAN');
  const cleanedDay = cleanedView.employees[0].days.find((day: { date: string }) => day.date === correction.date);
  assert.deepEqual([cleanedDay.scanIn, cleanedDay.scanOut, cleanedDay.amount], ['06:04:44', '12:00:00', 8_654]);
  assert.equal((await db.doc('UraianGaji/2026_09_KEBERSIHAN').get()).data()!.entries[cleaner.employeeId].values.harian, 33_654);
  const correctionPreviews = await loadPekaryaSlipPreviews(period, [technician.employeeId, cleaner.employeeId]);
  assert.equal(correctionPreviews.attendanceLogs![technician.employeeId].find(day => day.date === correction.date)!.amount, 10_577);
  assert.equal(correctionPreviews.attendanceLogs![cleaner.employeeId].find(day => day.date === correction.date)!.amount, 8_654);
  await db.doc('PekaryaOfficialLeaveRequests/cleaner-scan-report').set({
    employeeId: cleaner.employeeId, category: 'KEBERSIHAN', period, date: '2026-09-08',
    reportType: 'scan', scanIn: '08:30', scanOut: '13:00', status: 'pending', revision: 1,
  });
  await post(reviewReport, { officialLeaveRequestId: 'cleaner-scan-report', action: 'approve',
    requestId: 'approve-historical-category-report', expectedRevision: 1, reason: 'Jam presensi sudah diverifikasi' }, 200);
  assert.equal((await db.doc('UraianGaji/2026_09_KEBERSIHAN').get()).data()!.entries[cleaner.employeeId].values.harian, 42_308);
  const reviewedDay = (await getView('KEBERSIHAN')).employees[0].days.find((day: { date: string }) => day.date === '2026-09-08');
  assert.deepEqual([reviewedDay.scanIn, reviewedDay.scanOut, reviewedDay.amount], ['08:30:00', '13:00:00', 8_654]);
  const frozen = { period: '2026_09', employeeId: cleaner.employeeId, status: 'locked',
    earnings: [{ label: 'Presensi Harian', amount: 33_654 }], deductions: [] };
  await db.doc(`PayrollSlipStates/2026_09_${cleaner.employeeId}`).set(frozen);
  await post(correct, { ...correction, category: 'KEBERSIHAN', employeeId: cleaner.employeeId,
    expectedRevision: 1, requestId: 'immutable-scan-correction' }, 409);
  assert.deepEqual((await db.doc(`PayrollSlipStates/2026_09_${cleaner.employeeId}`).get()).data(), frozen);
  const satpam = await publish(new NextRequest('http://localhost/api/attendance/pekarya/publish', {
    method: 'POST', headers, body: JSON.stringify({ requestId: 'satpam-attendance-test', period, category: 'SATPAM' }),
  }));
  assert.equal(satpam.status, 403);
  await db.doc(`PayrollPeriods/${period}`).update({ attendanceStatus: 'closed' });
  const afterClosure = await getView('TEKNISI');
  assert.equal(afterClosure.singleScanPolicy, 'work_window_inferred');
  assert.deepEqual(afterClosure.employees[0].days, correctedView.employees[0].days);
  const closedPreview = await loadPekaryaSlipPreviews(period, [technician.employeeId]);
  assert.deepEqual(closedPreview.attendanceLogs![technician.employeeId], correctionPreviews.attendanceLogs![technician.employeeId]);

  // A legacy closed publication without policy metadata keeps the old fill.
  await db.doc('PayrollPeriods/2026-08').set({ attendanceStatus: 'closed', workCalendar: { revision: 1 } });
  await db.doc('AttendanceImports/2026-08').set({ activeRevisionId: 'legacy-august', activeRevision: 1 });
  await db.doc('AttendanceImportRevisions/legacy-august').set({ revision: 1 });
  await db.doc('AttendanceImportRows/legacy-one-sided').set({
    period: '2026-08', revisionId: 'legacy-august', rowNumber: 2, nipy: technician.nipy,
    date: '2026-08-03', workStatus: '', scanIn: '06:34:00', scanOut: null, issues: [],
  });
  await db.doc('PekaryaAttendancePublications/2026_08__TEKNISI').set({ state: 'published', importRevisionId: 'legacy-august', calendarRevision: 1 });
  const legacyResponse = await GET(new NextRequest('http://localhost/api/attendance/pekarya?period=2026-08&category=TEKNISI', { headers }));
  const legacy = await legacyResponse.json();
  assert.equal(legacyResponse.status, 200, JSON.stringify(legacy));
  assert.equal(legacy.singleScanPolicy, 'offset_150_minutes');
  assert.deepEqual([legacy.employees[0].days[0].scanOut, legacy.employees[0].days[0].amount], ['10:00:00', 4_808]);
  const closed = await publish(new NextRequest('http://localhost/api/attendance/pekarya/publish', {
    method: 'POST', headers,
    body: JSON.stringify({ requestId: 'closed-attendance-test', period, category: 'ALL', acknowledgedWarnings: ['INCOMPLETE_PUNCH', 'CORRECTED_ATTENDANCE'] }),
  }));
  assert.equal(closed.status, 409);

  // Replay Sugeng's actual source shape through review, publication, employee
  // payslips and partial corrections, including both affected categories.
  const inferredPeriod = '2026-10';
  const inferredRevision = '2026_10__r0001';
  await db.doc(`PayrollPeriods/${inferredPeriod}`).set({ attendanceStatus: 'open', workCalendar: { revision: 1 } });
  await db.doc(`AttendanceImports/${inferredPeriod}`).set({ activeRevisionId: inferredRevision, activeRevision: 1 });
  await db.doc(`AttendanceImportRevisions/${inferredRevision}`).set({ revision: 1 });
  const mixedScans = [
    ['26', '06:51:22', null], ['26', '19:39:59', '06:46:26'],
    ['28', '06:50:51', null], ['28', '19:46:07', '06:58:26'], ['29', '15:01:40', null],
  ] as const;
  for (const fixture of fixtures) {
    for (const [index, [date, scanIn, scanOut]] of mixedScans.entries()) {
      await db.doc(`AttendanceImportRows/inference-${fixture.employeeId}-${index}`).set({
        period: inferredPeriod, revisionId: inferredRevision, rowNumber: index + 2,
        nipy: fixture.nipy, name: `Worker ${fixture.category}`, department: '', date: `2026-10-${date}`,
        workStatus: 'MASUK', scanIn, scanOut, issues: [],
      });
    }
    const employee = (await getView(fixture.category, inferredPeriod)).employees[0];
    const inferred = ['KEBERSIHAN', 'TEKNISI'].includes(fixture.category);
    assert.equal(employee.harianAmount, inferred ? 37_500 : 0, fixture.category);
    if (inferred) {
      assert.deepEqual(employee.days.map((day: { scanIn: string; scanOut: string }) => [day.scanIn, day.scanOut]), [
        ['06:51:22', '14:00:00'], ['06:50:51', '14:00:00'], ['07:30:00', '15:01:40'],
      ]);
      assert.equal(employee.incompletePunchCount, 3);
      assert.equal(employee.presenceBonus.lateDates.includes('2026-10-29'), false);
    }
  }
  const inferredPreviews = await loadPekaryaSlipPreviews(inferredPeriod, employeeIds);
  for (const fixture of [cleaner, technician]) {
    assert.equal(inferredPreviews.attendanceLogs![fixture.employeeId].reduce((sum, day) => sum + day.amount, 0), 37_500);
  }
  await post(publish, { period: inferredPeriod, category: 'ALL', requestId: 'publish-inferred-punches',
    acknowledgedWarnings: ['INCOMPLETE_PUNCH'] }, 200);
  for (const fixture of [cleaner, technician]) {
    assert.equal((await db.doc(`UraianGaji/2026_10_${fixture.category}`).get()).data()!.entries[fixture.employeeId].values.harian, 37_500);
  }
  // A corrected side must not resurrect the machine's misplaced other side.
  await post(correct, { period: inferredPeriod, category: 'TEKNISI', employeeId: technician.employeeId,
    date: '2026-10-29', scanOut: '12:00', present: true, expectedRevision: 0,
    requestId: 'correct-inferred-departure', reason: 'Pulang lebih awal sudah diverifikasi' }, 200);
  const correctedInference = await getView('TEKNISI', inferredPeriod);
  const inferredDay = correctedInference.employees[0].days.find((day: { date: string }) => day.date === '2026-10-29');
  assert.deepEqual([inferredDay.scanIn, inferredDay.scanOut, inferredDay.amount], ['07:30:00', '12:00:00', 8_654]);
  assert.equal((await db.doc('UraianGaji/2026_10_TEKNISI').get()).data()!.entries[technician.employeeId].values.harian, 33_654);
  const rawInference = (await db.doc(`AttendanceImportRows/inference-${technician.employeeId}-4`).get()).data()!;
  assert.deepEqual([rawInference.scanIn, rawInference.scanOut], ['15:01:40', null]);
  await db.doc(`PayrollPeriods/${inferredPeriod}`).update({ attendanceStatus: 'closed' });
  assert.deepEqual((await getView('TEKNISI', inferredPeriod)).employees[0].days, correctedInference.employees[0].days);
  console.log(`PASS: ${categories.length} categories agree across review/publication/payslips; category history, partial corrections, stale-policy save/propagation/closure guards, immutable slips and closed-policy retention passed.`);
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
