import admin, { adminDb } from '@/lib/firebase-admin';
import {
  attendanceDayKey,
  hasSatpamAttendanceEvidence,
  PEKARYA_ATTENDANCE_RATES,
  satpamAttendanceEvidenceDates,
  summarizePekaryaAttendance,
} from '@/lib/payroll/attendance';
import {
  loadAttendanceEmployeeIdentities,
  loadEffectiveAttendanceDays,
  loadPeriodPremiumDates,
  pekaryaPublicationId,
  PEKARYA_CORRECTIONS_COLLECTION,
  PEKARYA_PUBLICATIONS_COLLECTION,
} from '@/lib/server/attendanceStore';
import { isPeriodClosed } from './payrollPeriod';
import { SATPAM_ABSENCE_REQUESTS_COLLECTION } from '@/lib/server/satpamDutyPlan';
import { satpamAttendanceReportType } from '@/lib/payroll/satpamAttendance';

export interface PekaryaAttendanceEmployeeView {
  employeeId: string;
  name: string;
  nipy: string;
  category: string;
  publishBlocked: boolean;
  warnings: string[];
  harianCount: number;
  jumatLiburCount: number;
  totalAmount: number;
  payableDays: number;
  incompletePunchCount: number;
  correctedDayCount: number;
  days: ReturnType<typeof summarizePekaryaAttendance>['days'];
}

export interface SatpamAttendanceMismatch {
  code:
    | 'REPORT_WITHOUT_ATTENDANCE'
    | 'ATTENDANCE_WITHOUT_REPORT'
    | 'INCOMPLETE_PUNCH'
    | 'IDENTITY_INCONSISTENCY'
    | 'ATTENDANCE_DURING_APPROVED_ABSENCE'
    | 'APPROVED_ABSENCE_WORK_CONFLICT';
  employeeId: string | null;
  employeeName: string;
  nipy: string;
  dutyDate: string;
  reportId: string | null;
  message: string;
}

export interface PekaryaAttendanceViewOptions {
  allowMissingActiveImport?: boolean;
}

function activeBlueCollar(identity: {
  employeeCollection: string;
  active: boolean;
  jobCategory: string | null;
}) {
  return identity.employeeCollection === 'Employees_BlueCollar' && identity.active;
}

export async function buildPekaryaAttendanceView(
  period: string,
  category: string,
  options: PekaryaAttendanceViewOptions = {},
) {
  const [
    { days, rows, importData, revisionData, correctionRevisions },
    { identities, byNipy },
    { calendar, premiumDates },
    publicationSnapshot,
    correctionHistorySnapshot,
  ] = await Promise.all([
    loadEffectiveAttendanceDays(period, options),
    loadAttendanceEmployeeIdentities(),
    loadPeriodPremiumDates(period),
    adminDb
      .collection(PEKARYA_PUBLICATIONS_COLLECTION)
      .doc(pekaryaPublicationId(period, category))
      .get(),
    adminDb
      .collection(PEKARYA_CORRECTIONS_COLLECTION)
      .where('period', '==', period)
      .get(),
  ]);

  const activeEmployees = identities
    .filter(
      (identity) =>
        activeBlueCollar(identity) && identity.jobCategory === category,
    )
    .sort((left, right) => left.name.localeCompare(right.name, 'id'));
  const rawRowsByDay = new Map<string, typeof rows>();
  for (const row of rows) {
    if (!row.nipy || !row.date) continue;
    const key = attendanceDayKey(row.nipy, row.date);
    const existing = rawRowsByDay.get(key) || [];
    existing.push(row);
    rawRowsByDay.set(key, existing);
  }
  const employees: PekaryaAttendanceEmployeeView[] = activeEmployees.map(
    (employee) => {
      const duplicateIdentity = Boolean(
        employee.nipy && (byNipy.get(employee.nipy)?.length || 0) > 1,
      );
      const warnings: string[] = [];
      if (!employee.nipy) warnings.push('NIPY_MISSING');
      if (duplicateIdentity) warnings.push('NIPY_DUPLICATE');
      const summary = summarizePekaryaAttendance(
        employee.nipy,
        days,
        premiumDates,
      );
      const summarizedDays = summary.days.map((day) => ({
        ...day,
        correctionRevision:
          correctionRevisions.get(attendanceDayKey(employee.nipy, day.date)) || 0,
        rawValue: (rawRowsByDay.get(
          attendanceDayKey(employee.nipy, day.date),
        ) || []).map((row) => ({
          rowNumber: row.rowNumber,
          workStatus: row.workStatus,
          scanIn: row.scanIn,
          scanOut: row.scanOut,
          issues: row.issues,
        })),
      }));
      if (summary.payableDays === 0) warnings.push('MISSING_ATTENDANCE');
      if (summary.incompletePunchCount > 0) warnings.push('INCOMPLETE_PUNCH');
      if (summary.correctedDayCount > 0) warnings.push('CORRECTED_ATTENDANCE');
      if (
        employee.nipy &&
        !days.some((day) => day.nipy === employee.nipy)
      ) {
        warnings.push('NO_IMPORTED_ROWS');
      }
      return {
        employeeId: employee.employeeId,
        name: employee.name,
        category,
        publishBlocked: !employee.nipy || duplicateIdentity,
        warnings,
        ...summary,
        days: summarizedDays,
      };
    },
  );
  const knownNipys = new Set(
    activeEmployees.map((employee) => employee.nipy).filter(Boolean),
  );
  const unmatchedNipys = Array.from(
    new Set(
      days
        .filter((day) => day.nipy && !byNipy.has(day.nipy))
        .map((day) => day.nipy),
    ),
  ).sort();

  return {
    period,
    category,
    importRevision: Number(importData.activeRevision || 0),
    importRevisionId: String(importData.activeRevisionId || ''),
    importHash: String(revisionData.fileHash || revisionData.sha256 || ''),
    calendarRevision: calendar.revision,
    premiumDates: calendar.premiumDates,
    publication: publicationSnapshot.exists
      ? { id: publicationSnapshot.id, ...publicationSnapshot.data() }
      : null,
    employees,
    exceptions: {
      unmatchedNipys,
      duplicateNipys: employees
        .filter((employee) => employee.warnings.includes('NIPY_DUPLICATE'))
        .map((employee) => employee.nipy),
      missingNipyEmployeeIds: employees
        .filter((employee) => !employee.nipy)
        .map((employee) => employee.employeeId),
      incompletePunches: employees.reduce(
        (sum, employee) => sum + employee.incompletePunchCount,
        0,
      ),
      correctedDays: employees.reduce(
        (sum, employee) => sum + employee.correctedDayCount,
        0,
      ),
      attendanceForOtherIdentities: days.filter(
        (day) => day.nipy && !knownNipys.has(day.nipy),
      ).length,
      duplicateEmployeeDays: days.filter((day) =>
        day.issues.includes('DUPLICATE_EMPLOYEE_DAY'),
      ).length,
    },
    correctionHistory: correctionHistorySnapshot.docs
      .filter((snapshot) => snapshot.data().category === category)
      .map((snapshot) => ({ id: snapshot.id, ...snapshot.data() }))
      .sort(
        (left, right) =>
          String((right as Record<string, unknown>).date || '').localeCompare(
            String((left as Record<string, unknown>).date || ''),
          ) ||
          Number((right as Record<string, unknown>).revision || 0) -
            Number((left as Record<string, unknown>).revision || 0),
      ),
  };
}

export async function buildSatpamAttendanceMismatches(
  period: string,
  options: PekaryaAttendanceViewOptions = {},
) {
  const [
    { days, importData },
    { identities, byNipy },
    { calendar },
    absenceSnapshot,
  ] =
    await Promise.all([
      loadEffectiveAttendanceDays(period, options),
      loadAttendanceEmployeeIdentities(),
      loadPeriodPremiumDates(period),
      adminDb
        .collection(SATPAM_ABSENCE_REQUESTS_COLLECTION)
        .where('period', '==', period)
        .get(),
    ]);
  const satpam = identities.filter(
    (identity) =>
      activeBlueCollar(identity) && identity.jobCategory === 'SATPAM',
  );
  const satpamById = new Map(satpam.map((employee) => [employee.employeeId, employee]));
  const occurrenceSnapshot = await adminDb
    .collection('ShiftOccurrences')
    .where('payrollPeriod', '==', period)
    .get();
  const reportIds = Array.from(
    new Set(
      occurrenceSnapshot.docs.flatMap((snapshot) => {
        const data = snapshot.data();
        return Array.isArray(data.reportIds)
          ? data.reportIds.filter(
              (id: unknown): id is string => typeof id === 'string',
            )
          : [];
      }),
    ),
  );
  const reportSnapshots =
    reportIds.length > 0
      ? await adminDb.getAll(
          ...reportIds.map((id) => adminDb.collection('ActivityReports').doc(id)),
        )
      : [];
  const mismatches: SatpamAttendanceMismatch[] = [];
  const reportedDayKeys = new Set<string>();
  const approvedAbsenceKeys = new Set(
    absenceSnapshot.docs.flatMap((snapshot) => {
      const absence = snapshot.data();
      return absence.status === 'approved' &&
        satpamAttendanceReportType(absence) === 'izin_resmi'
        ? [`${String(absence.employeeId || '')}__${String(absence.dutyDate || '')}`]
        : [];
    }),
  );
  for (const snapshot of reportSnapshots) {
    if (!snapshot.exists) continue;
    const report = snapshot.data()!;
    if (report.reportKind !== 'satpam_shift_assignment' && !report.sourceOccurrenceId) {
      continue;
    }
    const employee = satpamById.get(String(report.employeeId || ''));
    const dutyDate = String(report.dutyDate || report.activityDate || '');
    const shiftName = String(report.reportedShiftName || report.shiftName || '');
    if (approvedAbsenceKeys.has(`${String(report.employeeId || '')}__${dutyDate}`)) {
      mismatches.push({
        code: 'APPROVED_ABSENCE_WORK_CONFLICT',
        employeeId: String(report.employeeId || '') || null,
        employeeName: String(report.employeeName || ''),
        nipy: employee?.nipy || '',
        dutyDate,
        reportId: snapshot.id,
        message: 'Pegawai tercatat bekerja sekaligus memiliki izin dibayar yang disetujui.',
      });
    }
    if (!employee?.nipy || (byNipy.get(employee.nipy)?.length || 0) !== 1) {
      mismatches.push({
        code: 'IDENTITY_INCONSISTENCY',
        employeeId: employee?.employeeId || String(report.employeeId || '') || null,
        employeeName: employee?.name || String(report.employeeName || ''),
        nipy: employee?.nipy || '',
        dutyDate,
        reportId: snapshot.id,
        message: 'NIPY Satpam belum tersedia atau tidak unik.',
      });
      continue;
    }
    satpamAttendanceEvidenceDates(dutyDate, shiftName).forEach((evidenceDate) =>
      reportedDayKeys.add(`${employee.nipy}__${evidenceDate}`),
    );
    if (!hasSatpamAttendanceEvidence(employee.nipy, dutyDate, shiftName, days)) {
      mismatches.push({
        code: 'REPORT_WITHOUT_ATTENDANCE',
        employeeId: employee.employeeId,
        employeeName: employee.name,
        nipy: employee.nipy,
        dutyDate,
        reportId: snapshot.id,
        message: 'Ada laporan shift, tetapi tidak ditemukan scan pada tanggal bukti yang diizinkan.',
      });
    }
  }
  for (const employee of satpam) {
    if (!employee.nipy) continue;
    for (const day of days.filter(
      (candidate) => candidate.nipy === employee.nipy && candidate.present,
    )) {
      const hasApprovedAbsence = approvedAbsenceKeys.has(
        `${employee.employeeId}__${day.date}`,
      );
      if (hasApprovedAbsence) {
        mismatches.push({
          code: 'ATTENDANCE_DURING_APPROVED_ABSENCE',
          employeeId: employee.employeeId,
          employeeName: employee.name,
          nipy: employee.nipy,
          dutyDate: day.date,
          reportId: null,
          message: 'Ditemukan scan kehadiran pada tanggal izin dibayar yang disetujui.',
        });
      } else if (!reportedDayKeys.has(`${employee.nipy}__${day.date}`)) {
        mismatches.push({
          code: 'ATTENDANCE_WITHOUT_REPORT',
          employeeId: employee.employeeId,
          employeeName: employee.name,
          nipy: employee.nipy,
          dutyDate: day.date,
          reportId: null,
          message: 'Ada scan kehadiran, tetapi tidak ada laporan shift pada tanggal ini.',
        });
      }
      if (!day.completePunch) {
        mismatches.push({
          code: 'INCOMPLETE_PUNCH',
          employeeId: employee.employeeId,
          employeeName: employee.name,
          nipy: employee.nipy,
          dutyDate: day.date,
          reportId: null,
          message: 'Scan masuk atau scan pulang tidak lengkap.',
        });
      }
    }
  }
  return {
    period,
    category: 'SATPAM',
    importRevision: Number(importData.activeRevision || 0),
    importRevisionId: String(importData.activeRevisionId || ''),
    calendarRevision: calendar.revision,
    paymentSource: 'Ketua Shift',
    mismatches: mismatches.sort(
      (left, right) =>
        left.dutyDate.localeCompare(right.dutyDate) ||
        left.employeeName.localeCompare(right.employeeName, 'id'),
    ),
  };
}

function periodLabel(period: string): string {
  const [year, month] = period.split('-').map(Number);
  const months = [
    'Januari',
    'Februari',
    'Maret',
    'April',
    'Mei',
    'Juni',
    'Juli',
    'Agustus',
    'September',
    'Oktober',
    'November',
    'Desember',
  ];
  return `${months[month - 1]} ${year}`;
}

export async function publishPekaryaAttendance(
  period: string,
  category: string,
  actorUid: string,
  requestId: string,
  acknowledgedWarnings: string[],
  requestHash?: string,
) {
  if (category === 'SATPAM') {
    throw new Error('Presensi Satpam hanya menjadi bukti dan tidak dipublikasikan sebagai upah.');
  }
  const view = await buildPekaryaAttendanceView(period, category);
  const blocked = view.employees.filter((employee) => employee.publishBlocked);
  if (blocked.length > 0) {
    throw new Error(
      `Publikasi diblokir karena ${blocked.length} pegawai belum memiliki NIPY yang unik.`,
    );
  }
  const requiredAcknowledgments = Array.from(
    new Set(
      view.employees.flatMap((employee) =>
        employee.warnings.filter(
          (warning) =>
            warning !== 'NIPY_MISSING' && warning !== 'NIPY_DUPLICATE',
        ),
      ),
    ),
  );
  const missingAcknowledgment = requiredAcknowledgments.find(
    (warning) => !acknowledgedWarnings.includes(warning),
  );
  if (missingAcknowledgment) {
    throw new Error(
      `Peringatan ${missingAcknowledgment} harus diakui sebelum publikasi.`,
    );
  }
  const publicationRef = adminDb
    .collection(PEKARYA_PUBLICATIONS_COLLECTION)
    .doc(pekaryaPublicationId(period, category));
  const uraianRef = adminDb
    .collection('UraianGaji')
    .doc(`${period.replace('-', '_')}_${category}`);
  const idempotencyRef = adminDb
    .collection('FinancialIdempotencyKeys')
    .doc(`${actorUid}__${requestId}`);
  return adminDb.runTransaction(async (transaction) => {
    const [
      publicationSnapshot,
      uraianSnapshot,
      periodSnapshot,
      importSnapshot,
      idempotencySnapshot,
    ] =
      await Promise.all([
        transaction.get(publicationRef),
        transaction.get(uraianRef),
        transaction.get(adminDb.collection('PayrollPeriods').doc(period)),
        transaction.get(adminDb.collection('AttendanceImports').doc(period)),
        transaction.get(idempotencyRef),
      ]);
    if (idempotencySnapshot.exists) {
      if (
        requestHash &&
        idempotencySnapshot.data()?.requestHash !== requestHash
      ) {
        throw new Error('requestId sudah dipakai untuk publikasi lain.');
      }
      return {
        ...(idempotencySnapshot.data()?.response || {}),
        idempotent: true,
      };
    }
    if (isPeriodClosed(periodSnapshot.data())) {
      throw new Error('Periode payroll sudah ditutup permanen.');
    }
    if (
      String(importSnapshot.data()?.activeRevisionId || '') !== view.importRevisionId
    ) {
      throw new Error('Revisi import berubah. Muat ulang halaman sebelum publikasi.');
    }
    const currentCalendarRevision = Number(
      (periodSnapshot.data()?.workCalendar as { revision?: number } | undefined)
        ?.revision || 1,
    );
    if (currentCalendarRevision !== view.calendarRevision) {
      throw new Error('Kalender berubah. Muat ulang halaman sebelum publikasi.');
    }
    const previousPublication = publicationSnapshot.data() || {};
    const nextPublicationRevision =
      Number(previousPublication.publicationRevision || 0) + 1;
    const existingEntries =
      uraianSnapshot.exists &&
      uraianSnapshot.data()?.entries &&
      typeof uraianSnapshot.data()?.entries === 'object'
        ? (uraianSnapshot.data()!.entries as Record<
            string,
            Record<string, unknown>
          >)
        : {};
    const entries = { ...existingEntries };
    for (const employee of view.employees) {
      const existing = entries[employee.employeeId] || {};
      const values =
        existing.values && typeof existing.values === 'object'
          ? { ...(existing.values as Record<string, unknown>) }
          : {};
      const counts =
        existing.counts && typeof existing.counts === 'object'
          ? { ...(existing.counts as Record<string, unknown>) }
          : {};
      values.harian = employee.harianCount * PEKARYA_ATTENDANCE_RATES.Harian;
      values.jumatLibur =
        employee.jumatLiburCount *
        PEKARYA_ATTENDANCE_RATES['Jumat & Libur'];
      delete values.presensi;
      counts.harian = employee.harianCount;
      counts.jumatLibur = employee.jumatLiburCount;
      entries[employee.employeeId] = {
        ...existing,
        employeeId: employee.employeeId,
        name: employee.name,
        values,
        counts,
        attendanceSource: {
          importRevisionId: view.importRevisionId,
          calendarRevision: view.calendarRevision,
          publicationRevision: nextPublicationRevision,
        },
      };
    }
    const now = admin.firestore.FieldValue.serverTimestamp();
    transaction.set(
      uraianRef,
      {
        period,
        periodLabel: periodLabel(period),
        jobCategory: category,
        entries,
        attendancePublication: {
          importRevisionId: view.importRevisionId,
          calendarRevision: view.calendarRevision,
          publicationRevision: nextPublicationRevision,
        },
        updatedAt: now,
      },
      { merge: true },
    );
    transaction.set(
      publicationRef,
      {
        period,
        category,
        state: 'published',
        stale: false,
        importRevision: view.importRevision,
        importRevisionId: view.importRevisionId,
        calendarRevision: view.calendarRevision,
        publicationRevision: nextPublicationRevision,
        acknowledgedWarnings: Array.from(new Set(acknowledgedWarnings)),
        employeeCount: view.employees.length,
        totals: {
          harian: view.employees.reduce(
            (sum, employee) => sum + employee.harianCount,
            0,
          ),
          jumatLibur: view.employees.reduce(
            (sum, employee) => sum + employee.jumatLiburCount,
            0,
          ),
          amount: view.employees.reduce(
            (sum, employee) => sum + employee.totalAmount,
            0,
          ),
        },
        publishedBy: actorUid,
        publishedAt: now,
        requestId,
        updatedAt: now,
      },
      { merge: true },
    );
    const response = {
      publicationRevision: nextPublicationRevision,
      employeeCount: view.employees.length,
      idempotent: false,
    };
    transaction.create(idempotencyRef, {
      actorUid,
      requestId,
      requestHash: requestHash || null,
      entityType: 'PekaryaAttendancePublication',
      entityId: publicationRef.id,
      response,
      createdAt: now,
    });
    return response;
  });
}
