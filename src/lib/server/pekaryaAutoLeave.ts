import admin, { adminDb } from '@/lib/firebase-admin';
import { employeeInPayrollPeriod } from '@/lib/employeeConversion';
import { planAutoAbsenceLeave, AUTO_ABSENCE_LEAVE_START_PERIOD } from '@/lib/payroll/autoAbsenceLeave';
import { annualPaidLeaveBalanceEntitlementForYear, nextAnnualPaidLeaveBalanceRevision } from '@/lib/payroll/annualPaidLeave';
import { jobCategoryForPayrollPeriod } from '@/lib/payroll/blueCollarCategory';
import { periodCalendarFromData, periodDateRange } from '@/lib/payroll/calendar';
import { calculateEditableDriverJourneyTimeline } from '@/lib/payroll/driverJourney';
import { attendancePublicationMatchesPolicy, pekaryaAttendanceAmount } from '@/lib/payroll/attendance';
import { isImmutablePayrollStatus, satpamRatesForDutyDate, type SatpamShiftName } from '@/lib/payroll/domain';
import { PEKARYA_JOB_CATEGORIES, ALL_BLUE_COLLAR_CATEGORY } from '@/lib/payroll/pekaryaSpj';
import { presenceBonusColumnKey } from '@/lib/payroll/pekaryaPresenceBonus';
import { pekaryaAutoLeaveCandidates, type AutoLeaveScheduledDuty } from '@/lib/payroll/pekaryaAutoLeave';
import { type AutoLeaveEmployeeResult, type AutoLeaveSummary } from '@/lib/payroll/loyalisAutoLeave';
import { annualPaidLeaveEmployeeFromData, annualPaidLeaveDocumentId, annualPaidLeaveBalanceDocumentId } from './annualPaidLeave';
import { attendanceJoinNipy, loadAttendanceEmployeeIdentities, loadEffectiveAttendanceDays, pekaryaPublicationId } from './attendanceStore';
import { buildPekaryaAttendanceView } from './pekaryaAttendance';
import { buildFinancialAuditRecord, newFinancialAuditRef } from './audit';
import { HttpError, type AuthenticatedProfile } from './auth';
import { annualCalendarRef, annualDatesFrom, buildPeriodMaterialization, isPeriodClosed, jakartaToday, shiftPeriod } from './payrollPeriod';
import { type AutomaticLeaveActor, autoLeaveStateRef, markAutoLeaveDirty, writeAutomaticLeaveWithdrawal } from './automaticLeavePosting';
import { syncSatpamDutyReconciliation } from './satpamDutyPlan';

type Data = FirebaseFirestore.DocumentData;
const active = (data: Data) => data.status === 'pending' || data.status === 'approved';
const version = (snapshot: FirebaseFirestore.DocumentSnapshot) =>
  `${snapshot.ref.path}:${snapshot.updateTime?.seconds ?? ''}:${snapshot.updateTime?.nanoseconds ?? ''}`;
const queryVersion = (snapshot: FirebaseFirestore.QuerySnapshot) => snapshot.docs.map(version).sort().join('|');

export function permittedAutoLeaveCategories(actor: AuthenticatedProfile, category = ALL_BLUE_COLLAR_CATEGORY): string[] {
  if (!['super_admin', 'finance_verifier', 'satker_head'].includes(actor.role)) throw new HttpError(403, 'Tidak berwenang merekonsiliasi cuti Pekarya.');
  const allowed = [...PEKARYA_JOB_CATEGORIES].filter((item) => actor.role !== 'satker_head' || actor.permittedCategories.includes(item));
  if (category === ALL_BLUE_COLLAR_CATEGORY) {
    if (!allowed.length) throw new HttpError(403, 'Tidak memiliki kategori Pekarya yang diizinkan.');
    return allowed;
  }
  if (!allowed.includes(category as (typeof allowed)[number])) throw new HttpError(403, 'Kategori Pekarya tidak diizinkan.');
  return [category];
}

/** Immutable import rows are guarded by their active root and revision metadata.
 * Capture every mutable input before computing attendance, then recheck it in
 * each posting transaction (including query membership and new identity links). */
async function prepareSources(period: string) {
  const periods = [period, shiftPeriod(period, 1)];
  const refs = periods.map((month) => adminDb.doc(`AttendanceImports/${month}`));
  const queries: FirebaseFirestore.Query[] = [
    ...['Employees_BlueCollar', 'Employees_Loyalis', 'Employees_WhiteCollar'].map((collection) => adminDb.collection(collection)),
    ...periods.flatMap((month) => [
      adminDb.collection('AttendanceManualLinks').where('period', '==', month),
      adminDb.collection('PekaryaAttendanceCorrectionHeads').where('period', '==', month),
    ]),
    adminDb.collection('ActivityReports').where('period', 'in', [-1, 0, 1, 2].map((delta) => shiftPeriod(period, delta))).select(),
  ];
  const [documents, snapshots] = await Promise.all([adminDb.getAll(...refs), Promise.all(queries.map((query) => query.get()))]);
  for (const document of documents.filter((snapshot) => snapshot.ref.parent.id === 'AttendanceImports')) {
    const revision = document.data()?.activeRevisionId;
    if (revision) refs.push(adminDb.doc(`AttendanceImportRevisions/${revision}`));
  }
  const extraDocuments = refs.length > documents.length ? await adminDb.getAll(...refs.slice(documents.length)) : [];
  documents.push(...extraDocuments);
  const identities = await loadAttendanceEmployeeIdentities(period);
  const attendance = await Promise.all(periods.map((month) => loadEffectiveAttendanceDays(month, {
    allowMissingActiveImport: true, includeAutomaticLeave: false, identities,
  })));
  return { refs, queries, documents, snapshots, identities, attendance,
    rows: attendance.flatMap((item) => item.rows), days: attendance.flatMap((item) => item.days) };
}
type Sources = Awaited<ReturnType<typeof prepareSources>>;

async function checkSources(transaction: FirebaseFirestore.Transaction, source: Sources) {
  const [documents, snapshots] = await Promise.all([
    Promise.all(source.refs.map((ref) => transaction.get(ref))),
    Promise.all(source.queries.map((query) => transaction.get(query))),
  ]);
  if (documents.some((doc, index) => version(doc) !== version(source.documents[index])) ||
      snapshots.some((snapshot, index) => queryVersion(snapshot) !== queryVersion(source.snapshots[index]))) {
    throw new HttpError(409, 'Sumber presensi berubah saat rekonsiliasi cuti. Muat ulang dan ulangi.');
  }
}

async function reconcileEmployee(period: string, employeeId: string, source: Sources,
  actor: AutomaticLeaveActor, now: Date, dryRun: boolean): Promise<AutoLeaveEmployeeResult> {
  return adminDb.runTransaction(async (transaction) => {
    const year = Number(period.slice(0, 4));
    const employeeRef = adminDb.doc(`Employees_BlueCollar/${employeeId}`);
    const balanceRef = adminDb.doc(`AnnualPaidLeaveBalances/${annualPaidLeaveBalanceDocumentId(employeeId, year)}`);
    const periodRef = adminDb.doc(`PayrollPeriods/${period}`);
    const [employeeDoc, balanceDoc, periodDoc, holiday, slip, requests, official, absences, ganti, reports, plans] = await Promise.all([
      transaction.get(employeeRef), transaction.get(balanceRef), transaction.get(periodRef), transaction.get(annualCalendarRef(period)),
      transaction.get(adminDb.doc(`PayrollSlipStates/${period.replace('-', '_')}_${employeeId}`)),
      transaction.get(adminDb.collection('AnnualPaidLeaveRequests').where('employeeId', '==', employeeId)),
      transaction.get(adminDb.collection('PekaryaOfficialLeaveRequests').where('employeeId', '==', employeeId)),
      transaction.get(adminDb.collection('SatpamAbsenceRequests').where('employeeId', '==', employeeId)),
      transaction.get(adminDb.collection('GantiLiburRequests').where('employeeId', '==', employeeId)),
      transaction.get(adminDb.collection('ActivityReports').where('employeeId', '==', employeeId)),
      transaction.get(adminDb.collection('SatpamDutyPlans').where('period', '==', period)),
    ]);
    const raw = employeeDoc.data() || {};
    const result: AutoLeaveEmployeeResult = { employeeId, employeeName: String(raw.name || employeeId), covered: [], released: [], uncovered: [], held: [] };
    if (isPeriodClosed(periodDoc.data()) || isImmutablePayrollStatus(slip.data()?.status)) {
      result.skipped = 'Periode tertutup atau slip sudah final.'; return result;
    }
    const employee = annualPaidLeaveEmployeeFromData(employeeId, 'blue_collar', raw);
    if (!employee) { result.skipped = 'Tanggal mulai kerja belum lengkap.'; return result; }
    employee.category = jobCategoryForPayrollPeriod(raw, period).trim().toUpperCase();
    const requestDocs = requests.docs.filter((doc) => String(doc.data().leaveDate || '').startsWith(`${period}-`));
    const existingAuto = requestDocs.filter((doc) => doc.data().employeeKind === 'blue_collar' && doc.data().source === 'auto_absence' && doc.data().status === 'approved');
    const existingAutoDates = new Set(existingAuto.map((doc) => String(doc.data().leaveDate)));
    const blockedDates = new Set(requestDocs.filter((doc) =>
      (doc.data().source !== 'auto_absence' || active(doc.data())) && !existingAutoDates.has(String(doc.data().leaveDate)))
      .map((doc) => String(doc.data().leaveDate)));
    for (const doc of [...official.docs, ...absences.docs]) if (active(doc.data())) blockedDates.add(String(doc.data().date || doc.data().dutyDate));
    for (const doc of ganti.docs) if (active(doc.data())) blockedDates.add(String(doc.data().dayOffDate));
    const workDates = new Set(reports.docs.filter((doc) => doc.data().status === 'approved' &&
      ['Harian', 'Jumat & Libur', 'Lembur Cover', 'Lembur Sendiri'].includes(String(doc.data().shiftType)))
      .map((doc) => String(doc.data().dutyDate || doc.data().activityDate)));
    for (const doc of reports.docs) if (['pending', 'submitted', 'pending_review'].includes(String(doc.data().status))) {
      const report = doc.data();
      blockedDates.add(String(report.dutyDate || report.activityDate));
      if (report.jobCategory === 'SOPIR') {
        const start = String(report.dateStart || report.activityDate || '');
        const end = report.timeStart && report.timeEnd
          ? calculateEditableDriverJourneyTimeline({ dateStart: start, dateEnd: report.dateEnd,
              timeStart: report.timeStart, timeEnd: report.timeEnd, isMultiDay: report.isMultiDay === true }).dateEnd
          : String(report.dateEnd || start);
        for (const date of periodDateRange(period)) if (date >= start && date <= end) blockedDates.add(date);
      }
    }
    const schedules: AutoLeaveScheduledDuty[] = plans.docs.flatMap((doc) => {
      const data = doc.data();
      if (data.status !== 'published' || !Array.isArray(data.generatedDays)) return [];
      return data.generatedDays.flatMap((day: Data) => {
        if (!['Pagi', 'Sore', 'Malam'].includes(String(day.shiftName)) ||
            !Array.isArray(day.assignments) || !day.assignments.some((assignment: Data) => assignment.employeeId === employeeId)) return [];
        return [{ planId: doc.id, planRevision: Number(data.revision || 1), teamId: String(data.teamId || ''),
          dutyDate: String(day.dutyDate), shiftName: day.shiftName as SatpamShiftName,
          reviewRequired: [data.staleDates, data.lateBackfillDates].some((dates) => Array.isArray(dates) && dates.includes(day.dutyDate)) }];
      });
    });
    const calendar = periodCalendarFromData(period, periodDoc.data(), annualDatesFrom(holiday));
    const identity = source.identities.identities.find((item) => item.employeeCollection === 'Employees_BlueCollar' && item.employeeId === employeeId);
    const candidates = pekaryaAutoLeaveCandidates({ period, category: employee.category,
      nipy: identity ? attendanceJoinNipy(identity) : '',
      identityValid: Boolean(employee.active && employeeInPayrollPeriod('Employees_BlueCollar', raw, period) && identity?.nipy &&
        source.identities.byNipy.get(identity.nipy)?.length === 1),
      importAvailable: Boolean(source.attendance[0].importData.activeRevisionId), rows: source.rows, days: source.days,
      premiumDates: new Set(calendar.premiumDates), blockedDates, workDates, schedules, now });
    result.held = candidates.held;
    const balance = balanceDoc.data() || {};
    const plan = planAutoAbsenceLeave({ period, serviceDate: employee.serviceDate, absentDates: candidates.dates,
      blockedDates, existingAutoDates, balance: { usedDays: Math.max(0, Number(balance.usedDays || 0)),
        reservedDays: Math.max(0, Number(balance.reservedDays || 0)), manualUsedDays: Math.max(0, Number(balance.manualUsedDays || 0)) } });
    result.covered = plan.cover; result.released = plan.release; result.uncovered = plan.uncovered;
    const entitlementDays = annualPaidLeaveBalanceEntitlementForYear(employee.serviceDate, year, jakartaToday(now));
    const nextUsedDays = Math.max(0, Number(balance.usedDays || 0) + plan.cover.length - plan.release.length);
    result.balance = { entitlementDays, usedDays: nextUsedDays, reservedDays: Number(balance.reservedDays || 0),
      availableDays: Math.max(0, entitlementDays - nextUsedDays - Number(balance.reservedDays || 0) - Number(balance.manualUsedDays || 0)) };
    const payment = (date: string) => {
      const payType = calendar.premiumDates.includes(date) ? 'Jumat & Libur' : 'Harian';
      return { payType, amount: employee.category === 'SATPAM'
        ? satpamRatesForDutyDate(date)[payType]
        : pekaryaAttendanceAmount('07:30:00', '14:00:00', false) };
    };
    const updated = plan.keep.filter((date) => {
      const before = existingAuto.find((doc) => doc.data().leaveDate === date)!.data();
      const pay = payment(date);
      return before.approvedAmount !== pay.amount || before.approvedPayType !== pay.payType ||
        before.category !== employee.category || JSON.stringify(before.scheduledShift || null) !== JSON.stringify(candidates.shifts.get(date) || null);
    });
    result.updated = updated;
    if (dryRun || !(plan.cover.length || plan.release.length || updated.length)) return result;
    // The source guard re-reads every employee and activity report, so it runs
    // only for the employees that actually write; a no-op result moves no money.
    await checkSources(transaction, source);
    const timestamp = admin.firestore.FieldValue.serverTimestamp();
    const materialization = buildPeriodMaterialization({ period, periodData: periodDoc.data(), annualDates: annualDatesFrom(holiday),
      actorUid: actor.uid, reason: 'Kalender dibekukan saat penerapan cuti otomatis Pekarya.' });
    if (materialization) transaction.set(periodRef, materialization, { merge: true });
    for (const date of [...plan.cover, ...updated]) {
      const requestRef = adminDb.doc(`AnnualPaidLeaveRequests/${annualPaidLeaveDocumentId(employeeId, date)}`);
      const before = requestDocs.find((doc) => doc.id === requestRef.id)?.data() || null;
      const revision = Number(before?.revision || 0) + 1;
      const pay = payment(date);
      const scheduledShift = candidates.shifts.get(date);
      const after = { id: requestRef.id, employeeId, employeeName: employee.name, employeeKind: 'blue_collar',
        employeeCollection: 'Employees_BlueCollar', category: employee.category, leaveDate: date, period, year,
        serviceDate: employee.serviceDate, qualifyingDate: employee.qualifyingDate, reason: 'Tidak hadir penuh pada hari dinas; saldo cuti digunakan otomatis.',
        attachments: [], source: 'auto_absence', status: 'approved', revision,
        approvedPayType: pay.payType, approvedAmount: pay.amount,
        ...(scheduledShift ? { scheduledShift } : {}),
        sourceImportRevisionId: String(source.attendance[0].importData.activeRevisionId), calendarRevision: calendar.revision,
        submittedBy: actor.uid, submittedByName: actor.displayName, submittedAt: before?.submittedAt || timestamp,
        decidedBy: actor.uid, decidedByName: actor.displayName, decidedAt: timestamp,
        decisionReason: 'Cuti otomatis dari ketidakhadiran penuh dengan sumber presensi yang lengkap.', updatedAt: timestamp, schemaVersion: 1 };
      transaction.set(requestRef, after);
      transaction.set(adminDb.doc(`AnnualPaidLeavePayrollPosts/${requestRef.id}`), {
        annualPaidLeaveRequestId: requestRef.id, employeeId, employeeName: employee.name, employeeKind: 'blue_collar',
        employeeCollection: 'Employees_BlueCollar', category: employee.category, leaveDate: date, period, year,
        ...pay, source: 'auto_absence', status: 'posted', sourceRevision: revision,
        ...(scheduledShift ? { scheduledShift } : {}), payrollMode: employee.category === 'SATPAM' ? 'satpam_annual_leave' : 'pekarya_attendance_overlay',
        postedBy: actor.uid, postedAt: timestamp, schemaVersion: 1,
      });
      transaction.create(adminDb.doc(`AnnualPaidLeaveRequestRevisions/${requestRef.id}__r${revision}`), {
        annualPaidLeaveRequestId: requestRef.id, revision, action: before?.status === 'approved' ? 'auto_refresh' : 'auto_approve',
        before, after, actorUid: actor.uid, reason: after.decisionReason, createdAt: timestamp,
      });
      transaction.create(newFinancialAuditRef(), buildFinancialAuditRecord(actor, {
        action: 'ANNUAL_PAID_LEAVE_AUTO_APPLIED', entityType: 'AnnualPaidLeaveRequest', entityId: requestRef.id,
        reason: after.decisionReason, before, after,
      }));
      markAutoLeaveDirty(transaction, period, employee.category);
    }
    for (const date of plan.release) {
      const current = existingAuto.find((doc) => doc.data().leaveDate === date)!;
      writeAutomaticLeaveWithdrawal(transaction, current.ref, current.data(), actor,
        'Cuti otomatis dibatalkan karena presensi, jadwal, pengajuan, atau hak cuti berubah.');
    }
    const balanceRevision = nextAnnualPaidLeaveBalanceRevision(balance.balanceRevision);
    const afterBalance = { employeeId, employeeKind: 'blue_collar', employeeCollection: 'Employees_BlueCollar', year,
      serviceDate: employee.serviceDate, qualifyingDate: employee.qualifyingDate,
      entitlementDays: annualPaidLeaveBalanceEntitlementForYear(employee.serviceDate, year, jakartaToday(now)),
      usedDays: Math.max(0, Number(balance.usedDays || 0) + plan.cover.length - plan.release.length),
      reservedDays: Number(balance.reservedDays || 0), balanceRevision, updatedAt: timestamp, schemaVersion: 1 };
    transaction.set(balanceRef, afterBalance, { merge: true });
    transaction.create(adminDb.doc(`AnnualPaidLeaveBalanceRevisions/${balanceRef.id}__r${balanceRevision}`), {
      employeeId, year, revision: balanceRevision, action: 'auto_reconcile', before: balance, after: afterBalance,
      actorUid: actor.uid, createdAt: timestamp,
    });
    return result;
  });
}

/** Refresh only previously published regular attendance. Never bypass warnings
 * or turn an unreviewed/stale import into a publication. */
async function refreshDerived(period: string, category: string, actor: AutomaticLeaveActor, source: Sources) {
  const stateRef = autoLeaveStateRef(period, category);
  const state = await stateRef.get();
  if (!state.data()?.dirty) return;
  const revision = Number(state.data()?.revision || 0);
  if (category === 'SATPAM') {
    await syncSatpamDutyReconciliation(period, actor.uid, { autoLeaveRevision: revision });
    return;
  }
  const view = await buildPekaryaAttendanceView(period, category, { allowMissingActiveImport: true });
  const publicationRef = adminDb.doc(`PekaryaAttendancePublications/${pekaryaPublicationId(period, category)}`);
  const uraianRef = adminDb.doc(`UraianGaji/${period.replace('-', '_')}_${category}`);
  await adminDb.runTransaction(async (transaction) => {
    await checkSources(transaction, source);
    const [latest, publication, uraian, periodDoc, holiday, ...slips] = await Promise.all([
      transaction.get(stateRef), transaction.get(publicationRef), transaction.get(uraianRef),
      transaction.get(adminDb.doc(`PayrollPeriods/${period}`)),
      transaction.get(annualCalendarRef(period)),
      ...view.employees.map((employee) => transaction.get(adminDb.doc(`PayrollSlipStates/${period.replace('-', '_')}_${employee.employeeId}`))),
    ]);
    if (isPeriodClosed(periodDoc.data()) || Number(latest.data()?.revision || 0) !== revision ||
        periodCalendarFromData(period, periodDoc.data(), annualDatesFrom(holiday)).revision !== view.calendarRevision) {
      throw new HttpError(409, 'Sumber cuti berubah; ulangi rekonsiliasi.');
    }
    if (publication.data()?.state === 'published' && publication.data()?.stale !== true &&
        attendancePublicationMatchesPolicy(publication.data(), view.singleScanPolicy) &&
        publication.data()?.importRevisionId === view.importRevisionId && Number(publication.data()?.calendarRevision) === view.calendarRevision) {
      if (!uraian.exists) throw new HttpError(409, 'Rekap Uraian publikasi belum tersedia.');
      const entries = { ...(uraian.data()?.entries || {}) };
      const publicationRevision = Number(publication.data()?.publicationRevision || 0) + 1;
      for (const [index, employee] of view.employees.entries()) {
        if (isImmutablePayrollStatus(slips[index]?.data()?.status)) continue;
        const current = entries[employee.employeeId] || {};
        const bonusKey = presenceBonusColumnKey(category);
        entries[employee.employeeId] = { ...current, employeeId: employee.employeeId, name: employee.name,
          values: { ...(current.values || {}), harian: employee.harianAmount, jumatLibur: employee.jumatLiburAmount,
            ...(bonusKey && employee.presenceBonus ? { [bonusKey]: employee.presenceBonus.amount } : {}) },
          counts: { ...(current.counts || {}), harian: employee.harianCount, jumatLibur: employee.jumatLiburCount },
          attendanceSource: { importRevisionId: view.importRevisionId, calendarRevision: view.calendarRevision,
            singleScanPolicy: view.singleScanPolicy, publicationRevision } };
      }
      transaction.set(uraianRef, { entries, attendancePublication: { importRevisionId: view.importRevisionId,
        calendarRevision: view.calendarRevision, singleScanPolicy: view.singleScanPolicy, publicationRevision }, updatedAt: admin.firestore.FieldValue.serverTimestamp() }, { merge: true });
      transaction.update(publicationRef, { publicationRevision, totals: {
        harian: view.employees.reduce((sum, employee) => sum + employee.harianCount, 0),
        jumatLibur: view.employees.reduce((sum, employee) => sum + employee.jumatLiburCount, 0),
        amount: view.employees.reduce((sum, employee) => sum + employee.totalAmount, 0),
      } });
    }
    transaction.set(stateRef, { dirty: false, derivedRevision: revision,
      reconciledAt: admin.firestore.FieldValue.serverTimestamp() }, { merge: true });
  });
}

export async function reconcilePekaryaAutoLeave(period: string, actor: AutomaticLeaveActor,
  options: { categories?: readonly string[]; employeeIds?: readonly string[]; dryRun?: boolean; now?: Date } = {}): Promise<AutoLeaveSummary> {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(period)) throw new HttpError(400, 'Periode wajib menggunakan format YYYY-MM.');
  if (period < AUTO_ABSENCE_LEAVE_START_PERIOD || isPeriodClosed((await adminDb.doc(`PayrollPeriods/${period}`).get()).data())) {
    return { period, applicable: false, note: 'Periode sebelum 2026-09 atau sudah ditutup.', results: [] };
  }
  const source = await prepareSources(period);
  const categories = options.categories || PEKARYA_JOB_CATEGORIES;
  const previousRequests = await adminDb.collection('AnnualPaidLeaveRequests').where('period', '==', period).get();
  const autoEmployees = new Set(previousRequests.docs.filter((doc) => doc.data().source === 'auto_absence' && doc.data().status === 'approved').map((doc) => String(doc.data().employeeId)));
  const employees = source.snapshots[0].docs.filter((doc) =>
    ((doc.data().employment?.status === 'active' && doc.data().flags?.isActive !== false && doc.data().flags?.isPayrollEligible !== false) || autoEmployees.has(doc.id)) &&
    categories.includes(jobCategoryForPayrollPeriod(doc.data(), period).trim().toUpperCase()) &&
    (!options.employeeIds || options.employeeIds.includes(doc.id)));
  const balances = employees.length ? await adminDb.getAll(...employees.map((doc) =>
    adminDb.doc(`AnnualPaidLeaveBalances/${annualPaidLeaveBalanceDocumentId(doc.id, Number(period.slice(0, 4)))}`))) : [];
  const importedNipys = new Set(source.attendance[0].days.filter((day) => day.sourceRows.some((row) => row > 0)).map((day) => day.nipy));
  const results: AutoLeaveEmployeeResult[] = [];
  for (let offset = 0; offset < employees.length; offset += 4) {
    results.push(...await Promise.all(employees.slice(offset, offset + 4).map(async (doc) => {
      const identity = source.identities.identities.find((item) => item.employeeCollection === 'Employees_BlueCollar' && item.employeeId === doc.id);
      const identityValid = Boolean(identity?.nipy && source.identities.byNipy.get(identity.nipy)?.length === 1);
      // A hold with no existing automatic credit cannot write any money. Do
      // not lock/re-read the entire source for employees absent from the file.
      if (!autoEmployees.has(doc.id) && (!identityValid || !identity || !importedNipys.has(attendanceJoinNipy(identity)))) {
        const employee = annualPaidLeaveEmployeeFromData(doc.id, 'blue_collar', doc.data());
        const balance = balances.find((snapshot) => snapshot.id === annualPaidLeaveBalanceDocumentId(doc.id, Number(period.slice(0, 4))))?.data() || {};
        const entitlementDays = employee ? annualPaidLeaveBalanceEntitlementForYear(employee.serviceDate, Number(period.slice(0, 4)), jakartaToday(options.now)) : 0;
        return { employeeId: doc.id, employeeName: String(doc.data().name || doc.id), covered: [], released: [], uncovered: [],
          held: [{ date: null, reason: identityValid ? 'Menunggu data presensi pegawai pada import aktif.' : 'Identitas presensi belum unik atau belum lengkap.' }],
          balance: { entitlementDays, usedDays: Number(balance.usedDays || 0), reservedDays: Number(balance.reservedDays || 0),
            availableDays: Math.max(0, entitlementDays - Number(balance.usedDays || 0) - Number(balance.reservedDays || 0) - Number(balance.manualUsedDays || 0)) } };
      }
      try { return await reconcileEmployee(period, doc.id, source, actor, options.now || new Date(), options.dryRun === true); }
      catch (error) { return { employeeId: doc.id, employeeName: String(doc.data().name || doc.id), covered: [], released: [], uncovered: [],
        failed: true, skipped: error instanceof Error ? error.message : 'Rekonsiliasi cuti gagal.' }; }
    })));
  }
  if (!options.dryRun && !results.some((result) => result.failed)) {
    for (const category of categories) {
      try { await refreshDerived(period, category, actor, source); }
      catch (error) { results.push({ employeeId: '', employeeName: category, covered: [], released: [], uncovered: [],
        failed: true, skipped: error instanceof Error ? error.message : 'Perhitungan upah belum selesai.' }); }
    }
  }
  if (!options.dryRun) for (const category of categories) {
    const categoryResults = results.filter((result) =>
      employees.find((employee) => employee.id === result.employeeId && jobCategoryForPayrollPeriod(employee.data(), period).trim().toUpperCase() === category) || result.employeeName === category);
    // A run for chosen employees must not erase what the page lists for the rest.
    const chosen = options.employeeIds;
    const kept: AutoLeaveEmployeeResult[] = chosen
      ? ((await autoLeaveStateRef(period, category).get()).data()?.summary?.results || [])
          .filter((item: AutoLeaveEmployeeResult) => item.employeeId && !chosen.includes(item.employeeId))
      : [];
    await autoLeaveStateRef(period, category).set({ period, category,
      summary: { period, applicable: true, results: [...kept, ...categoryResults] },
    }, { merge: true });
  }
  return { period, applicable: true, results };
}

export async function ensurePekaryaAutoLeave(period: string, actor: AutomaticLeaveActor,
  categories: readonly string[] = PEKARYA_JOB_CATEGORIES, employeeIds?: readonly string[]) {
  const summary = await reconcilePekaryaAutoLeave(period, actor, { categories, employeeIds });
  if (summary.results.some((result) => result.failed)) throw new HttpError(409,
    'Cuti otomatis belum selesai diproses. Ulangi rekonsiliasi sebelum memperbarui atau mengunci slip.');
  return summary;
}

/** A reservation, withdrawal or balance correction can change which absence
 * the allowance covers. Reconcile the employee's editable imported months. */
export async function refreshEmployeeAutoLeaveHistory(employeeId: string, actor: AutomaticLeaveActor) {
  const [employee, imports, requests] = await Promise.all([
    adminDb.doc(`Employees_BlueCollar/${employeeId}`).get(),
    adminDb.collection('AttendanceImports').select('activeRevisionId').get(),
    adminDb.collection('AnnualPaidLeaveRequests').where('employeeId', '==', employeeId).get(),
  ]);
  if (!employee.exists) return;
  const periods = new Set([
    ...imports.docs.filter((doc) => doc.data().activeRevisionId).map((doc) => doc.id),
    ...requests.docs.filter((doc) => doc.data().source === 'auto_absence').map((doc) => String(doc.data().period)),
  ]);
  for (const period of [...periods].filter((month) => month >= AUTO_ABSENCE_LEAVE_START_PERIOD).sort()) {
    await ensurePekaryaAutoLeave(period, actor, [jobCategoryForPayrollPeriod(employee.data()!, period).trim().toUpperCase()], [employeeId]);
  }
}
