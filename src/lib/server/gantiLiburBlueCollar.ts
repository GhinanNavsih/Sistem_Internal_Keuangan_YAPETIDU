import admin, { adminDb } from '@/lib/firebase-admin';
import { pekaryaAttendanceAmount } from '@/lib/payroll/attendance';
import { satpamRatesForDutyDate } from '@/lib/payroll/domain';
import {
  evaluateGantiLiburAttendance,
  gantiLiburAttendanceCorrection,
  gantiLiburPeriod,
  type GantiLiburRequest,
} from '@/lib/payroll/gantiLibur';
import type { AuthenticatedProfile } from '@/lib/server/auth';
import { HttpError } from '@/lib/server/auth';
import {
  ATTENDANCE_IMPORTS_COLLECTION,
  ATTENDANCE_MANUAL_LINKS_COLLECTION,
  PEKARYA_CORRECTIONS_COLLECTION,
  PEKARYA_CORRECTION_HEADS_COLLECTION,
  PEKARYA_PUBLICATIONS_COLLECTION,
  attendanceCorrectionHeadId,
  pekaryaPublicationId,
} from '@/lib/server/attendanceStore';
import {
  buildPekaryaAttendanceView,
  presenceBonusValuesAfterCorrection,
} from '@/lib/server/pekaryaAttendance';
import { buildPeriodMaterialization } from '@/lib/server/payrollPeriod';

function version(snapshot: FirebaseFirestore.DocumentSnapshot): string {
  return `${snapshot.id}:${snapshot.updateTime?.toDate().toISOString() || 'missing'}:${snapshot.updateTime?.nanoseconds || 0}`;
}

function queryVersion(snapshot: FirebaseFirestore.QuerySnapshot): string {
  return snapshot.docs.map(version).sort().join('|');
}

/** Capture source versions before calculating totals, then recheck them inside
 * the approval transaction so an import, identity link or correction cannot
 * change between attendance verification and posting the paid day. */
export async function prepareBlueCollarGantiLiburReview(request: GantiLiburRequest) {
  const { employeeId, dayOffDate, workedDate } = request;
  const category = request.category || '';
  const dayOffPeriod = gantiLiburPeriod('blue_collar', dayOffDate);
  const workedPeriod = gantiLiburPeriod('blue_collar', workedDate);
  const periods = [...new Set([workedPeriod, dayOffPeriod])];
  const periodRef = adminDb.collection('PayrollPeriods').doc(dayOffPeriod);
  const publicationRef = adminDb.collection(PEKARYA_PUBLICATIONS_COLLECTION)
    .doc(pekaryaPublicationId(dayOffPeriod, category));
  const uraianRef = adminDb.collection('UraianGaji').doc(`${dayOffPeriod.replace('-', '_')}_${category}`);
  const documentRefs = [
    ...periods.flatMap((period) => [
      adminDb.collection(ATTENDANCE_IMPORTS_COLLECTION).doc(period),
      adminDb.collection('PayrollPeriods').doc(period),
    ]),
    ...[...new Set(periods.map((period) => period.slice(0, 4)))].map((year) =>
      adminDb.collection('PayrollHolidayCalendars').doc(year)),
    publicationRef,
    uraianRef,
  ];
  const queries = [
    adminDb.collection(PEKARYA_CORRECTION_HEADS_COLLECTION).where('employeeId', '==', employeeId),
    adminDb.collection('PekaryaOfficialLeaveRequests').where('employeeId', '==', employeeId),
    adminDb.collection('SatpamAbsenceRequests').where('employeeId', '==', employeeId),
    adminDb.collection('ActivityReports').where('employeeId', '==', employeeId),
    ...periods.map((period) => adminDb.collection(ATTENDANCE_MANUAL_LINKS_COLLECTION).where('period', '==', period)),
  ];
  const [documents, querySnapshots] = await Promise.all([
    adminDb.getAll(...documentRefs),
    Promise.all(queries.map((query) => query.get())),
  ]);
  const [workedView, dayOffView] = await Promise.all([
    buildPekaryaAttendanceView(workedPeriod, category, { allowMissingActiveImport: true }),
    buildPekaryaAttendanceView(dayOffPeriod, category, { allowMissingActiveImport: true }),
  ]);
  const employee = dayOffView.employees.find((item) => item.employeeId === employeeId);
  const workedEmployee = workedView.employees.find((item) => item.employeeId === employeeId);
  if (!employee || !workedEmployee || employee.publishBlocked || workedEmployee.publishBlocked) {
    throw new HttpError(409, 'Identitas presensi pegawai belum lengkap atau NIPY digunakan pegawai lain.');
  }
  const workedDay = workedEmployee.days.find((day) => day.date === workedDate);
  const currentDay = employee.days.find((day) => day.date === dayOffDate);
  const attendanceUploaded = workedView.importRevisionId && workedEmployee.days.some((day) =>
    day.date >= workedDate && day.sourceRows.some((rowNumber) => rowNumber > 0));
  const attendanceCheck = attendanceUploaded
    ? evaluateGantiLiburAttendance(workedDay?.present ? {
      'Jam kerja': workedDay.workStatus,
      'Scan masuk': workedDay.scanIn,
      'Scan pulang': workedDay.scanOut,
      scanMasukAuto: workedDay.scanInAuto,
      scanPulangAuto: workedDay.scanOutAuto,
    } : null)
    : { verdict: 'awaiting_upload' as const, scanIn: '', scanOut: '' };
  const [heads, officialLeaves, satpamAbsences, activities] = querySnapshots;
  const onDayOff = (data: FirebaseFirestore.DocumentData) =>
    String(data.dutyDate || data.date || data.activityDate || '') === dayOffDate;
  const dayOffConflict = Boolean(currentDay?.present) ||
    [...officialLeaves.docs, ...satpamAbsences.docs].some((doc) =>
      doc.data().status === 'approved' && onDayOff(doc.data())) ||
    activities.docs.some((doc) => doc.data().status === 'approved' && onDayOff(doc.data()) &&
      ['Harian', 'Jumat & Libur', 'Lembur Sendiri', 'Lembur Cover'].includes(String(doc.data().shiftType || '')));
  return {
    request, employee, workedView, dayOffView, attendanceCheck, dayOffConflict,
    documentRefs, documents, queries, querySnapshots, periodRef, publicationRef, uraianRef,
    head: heads.docs.find((doc) => doc.data().period === dayOffPeriod && doc.data().date === dayOffDate)?.data(),
    currentDay,
  };
}

type PreparedReview = Awaited<ReturnType<typeof prepareBlueCollarGantiLiburReview>>;

export async function readBlueCollarGantiLiburReview(
  transaction: FirebaseFirestore.Transaction,
  prepared: PreparedReview,
) {
  const [documents, queries] = await Promise.all([
    Promise.all(prepared.documentRefs.map((ref) => transaction.get(ref))),
    Promise.all(prepared.queries.map((query) => transaction.get(query))),
  ]);
  return {
    unchanged: documents.every((doc, index) => version(doc) === version(prepared.documents[index])) &&
      queries.every((query, index) => queryVersion(query) === queryVersion(prepared.querySnapshots[index])),
  };
}

export function postBlueCollarGantiLibur(
  transaction: FirebaseFirestore.Transaction,
  prepared: PreparedReview,
  actor: AuthenticatedProfile,
) {
  const { request, employee, dayOffView: view, head, currentDay } = prepared;
  const period = gantiLiburPeriod('blue_collar', request.dayOffDate);
  const now = admin.firestore.FieldValue.serverTimestamp();
  const documentData = (path: string) => prepared.documents.find((doc) => doc.ref.path === path)?.data();
  const materialization = buildPeriodMaterialization({
    period,
    periodData: documentData(prepared.periodRef.path),
    annualDates: view.premiumDates,
    actorUid: actor.uid,
    reason: `Kalender periode dibekukan saat persetujuan ganti libur ${period}`,
  });
  if (materialization) transaction.set(prepared.periodRef, materialization, { merge: true });
  if (request.category === 'SATPAM') return satpamRatesForDutyDate(request.dayOffDate).Harian;

  const correction = gantiLiburAttendanceCorrection();
  const amount = pekaryaAttendanceAmount(correction.scanIn, correction.scanOut, false);
  const correctionRef = adminDb.collection(PEKARYA_CORRECTIONS_COLLECTION).doc();
  const headRef = adminDb.collection(PEKARYA_CORRECTION_HEADS_COLLECTION)
    .doc(attendanceCorrectionHeadId(period, request.employeeId, request.dayOffDate));
  const record = {
    period,
    category: request.category,
    employeeId: request.employeeId,
    employeeName: employee.name,
    nipy: employee.nipy,
    date: request.dayOffDate,
    revision: Number(head?.revision || 0) + 1,
    supersedesCorrectionId: head?.correctionId || null,
    beforeEffectiveValue: currentDay ? {
      present: currentDay.present, workStatus: currentDay.workStatus,
      scanIn: currentDay.scanIn, scanOut: currentDay.scanOut,
    } : null,
    effectiveValue: correction,
    importRevisionId: view.importRevisionId,
    calendarRevision: view.calendarRevision,
    reason: `Ganti libur untuk bekerja pada ${request.workedDate}`,
    actorUid: actor.uid,
    actorName: actor.displayName,
    sourceType: 'ganti_libur',
    sourceId: request.id,
    createdAt: now,
  };
  transaction.create(correctionRef, record);
  transaction.set(headRef, { ...record, ...correction, correctionId: correctionRef.id, updatedAt: now });

  const publication = documentData(prepared.publicationRef.path);
  if (publication?.state === 'published' && publication.stale !== true) {
    const uraian = documentData(prepared.uraianRef.path);
    if (!uraian) throw new HttpError(409, 'Rekap Uraian publikasi tidak ditemukan. Publikasikan ulang kategori.');
    const entries = { ...(uraian.entries || {}) };
    const existing = entries[request.employeeId] || {};
    const publicationRevision = Number(publication.publicationRevision || 0) + 1;
    entries[request.employeeId] = {
      ...existing, employeeId: request.employeeId, name: employee.name,
      values: {
        ...existing.values,
        harian: employee.harianAmount + amount,
        jumatLibur: employee.jumatLiburAmount,
        ...presenceBonusValuesAfterCorrection({
          category: request.category || '',
          period,
          premiumDates: view.premiumDates,
          employeeDays: employee.days,
          date: request.dayOffDate,
          correction,
        }),
      },
      counts: { ...existing.counts, harian: employee.harianCount + 1, jumatLibur: employee.jumatLiburCount },
      attendanceSource: { importRevisionId: view.importRevisionId, calendarRevision: view.calendarRevision, publicationRevision },
    };
    transaction.update(prepared.uraianRef, { entries, updatedAt: now });
    transaction.update(prepared.publicationRef, {
      publicationRevision,
      'totals.harian': Number(publication.totals?.harian || 0) + 1,
      'totals.amount': Number(publication.totals?.amount || 0) + amount,
      correctedAt: now, correctedBy: actor.uid, stale: false, updatedAt: now,
    });
  }
  return amount;
}
