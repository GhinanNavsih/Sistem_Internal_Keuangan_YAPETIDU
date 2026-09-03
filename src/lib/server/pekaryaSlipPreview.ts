import { adminDb } from '@/lib/firebase-admin';
import {
  attendanceWorkedSeconds,
  summarizePekaryaAttendance,
} from '@/lib/payroll/attendance';
import { periodCalendarFromData } from '@/lib/payroll/calendar';
import { DriverPiketSchedule } from '@/lib/payroll/driverPiket';
import {
  KegiatanSpjFinancialLike,
  PekaryaActivityFinancialLike,
  pekaryaPayrollWindow,
  sumApprovedActivitySpj,
  sumApprovedEventSpj,
} from '@/lib/payroll/pekaryaSpj';
import {
  buildPekaryaSlipPreview,
  PekaryaAttendanceGate,
  PekaryaAttendanceLog,
  PekaryaPreviewEmployee,
  PekaryaSlipPreview,
} from '@/lib/payroll/pekaryaSlipPreview';
import { isSatpamDutyPlanRequired } from '@/lib/payroll/satpamDutyPlan';
import {
  attendanceJoinNipy,
  loadAttendanceEmployeeIdentities,
  loadEffectiveAttendanceDays,
  PEKARYA_PUBLICATIONS_COLLECTION,
  pekaryaPublicationId,
} from '@/lib/server/attendanceStore';
import { annualCalendarRef, annualDatesFrom } from '@/lib/server/payrollPeriod';
import {
  isSatpamLegacyBonusColumn,
  normalizeSatpamUraianEntry,
} from '@/lib/payroll/satpamCompensation';
import { RekapColumn, SalaryMatrix, UraianEntry } from '@/types';

/**
 * Loads everything `buildPekaryaSlipPreview` needs out of Firestore, once per
 * period rather than once per employee, and returns the finished previews.
 *
 * The dashboard and the employee payslip page both call this through
 * /api/payroll/slip-preview, which is what makes "identical rows and totals
 * for the same employee and period" a structural guarantee rather than a
 * coincidence of two hand-maintained calculations.
 */

export const BLUE_COLLAR_COLLECTION = 'Employees_BlueCollar';

function asNumber(value: unknown): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

export interface ActiveSalaryMatrix {
  version: string;
  matrix: SalaryMatrix;
}

/**
 * The active version of a gapok matrix and its rows, keyed grade → years.
 * Used for both `SalaryMatrix` (Pekarya) and `SalaryMatrix_WhiteCollar`.
 */
export async function loadActiveSalaryMatrix(
  collectionName: 'SalaryMatrix' | 'SalaryMatrix_WhiteCollar',
): Promise<ActiveSalaryMatrix> {
  const config = await adminDb.collection(collectionName).doc('_config').get();
  const version = String(config.data()?.activeVersion || '2026_v1');
  const rows = await adminDb
    .collection(collectionName)
    .doc(version)
    .collection('rows')
    .get();

  const matrix: SalaryMatrix = {};
  rows.docs.forEach((row) => {
    const data = row.data();
    const year = asNumber(data.tahun);
    if (!year) return;
    Object.entries(data.salaries || {}).forEach(([grade, amount]) => {
      if (!matrix[grade]) matrix[grade] = {};
      matrix[grade][year] = asNumber(amount);
    });
  });

  return { version, matrix };
}

export function loadActiveBlueCollarMatrix(): Promise<ActiveSalaryMatrix> {
  return loadActiveSalaryMatrix('SalaryMatrix');
}

/**
 * Piket rows are matched on the denormalized `period` field, but older rows
 * predate it, so the date range is queried as well and the two are merged on
 * document id. `countDriverPiketInPeriod` accepts either shape.
 */
async function loadPiketSchedules(
  period: string,
): Promise<DriverPiketSchedule[]> {
  const window = pekaryaPayrollWindow(period);
  const [byPeriod, byDate] = await Promise.all([
    adminDb.collection('DriverPiketSchedules').where('period', '==', period).get(),
    adminDb
      .collection('DriverPiketSchedules')
      .where('date', '>=', window.startsOn)
      .where('date', '<=', window.endsOn)
      .get(),
  ]);

  const merged = new Map<string, DriverPiketSchedule>();
  [...byPeriod.docs, ...byDate.docs].forEach((snapshot) => {
    merged.set(snapshot.id, {
      id: snapshot.id,
      ...(snapshot.data() as Omit<DriverPiketSchedule, 'id'>),
    });
  });
  return [...merged.values()];
}

interface CategoryAttendanceState {
  gate: PekaryaAttendanceGate;
  entries: Record<string, UraianEntry>;
  customColumns: RekapColumn[];
}

/**
 * Reproduces the publication gate `/api/payroll/slips` enforces on a draft
 * write, so the preview can warn before the user gets a 409 on save.
 */
async function loadCategoryAttendanceState(
  period: string,
  periodKey: string,
  category: string,
  periodData: Record<string, unknown> | null,
  activeImportRevisionId: string,
): Promise<CategoryAttendanceState> {
  const uraianSnapshot = await adminDb
    .collection('UraianGaji')
    .doc(`${periodKey}_${category}`)
    .get();
  const uraianData = uraianSnapshot.data();
  const rawEntries = (uraianData?.entries || {}) as Record<string, UraianEntry>;
  const rawCustomColumns = Array.isArray(uraianData?.customColumns)
    ? (uraianData!.customColumns as RekapColumn[])
    : [];
  let entries = rawEntries;
  let customColumns = rawCustomColumns;

  // The old Satpam bonus was stored in UraianGaji before it was consolidated
  // into Tunjangan Jabatan. Normalize it at the server boundary so current
  // and historical previews agree even before a one-time data cleanup runs.
  if (category === 'SATPAM') {
    const teamSnapshot = await adminDb.collection('SatpamShiftTeams').get();
    const ketuaShiftIds = new Set(
      teamSnapshot.docs
        .map((snapshot) => String(snapshot.data()?.ketuaShiftId || '').trim())
        .filter(Boolean),
    );
    entries = Object.fromEntries(
      Object.entries(rawEntries).map(([employeeId, entry]) => [
        employeeId,
        entry
          ? normalizeSatpamUraianEntry(
              entry,
              ketuaShiftIds.has(employeeId),
            )
          : entry,
      ]),
    ) as Record<string, UraianEntry>;
    customColumns = rawCustomColumns.filter(
      (column) => !isSatpamLegacyBonusColumn(column),
    );
  }

  if (period >= '2026-08' && category !== 'SATPAM') {
    const publicationSnapshot = await adminDb
      .collection(PEKARYA_PUBLICATIONS_COLLECTION)
      .doc(pekaryaPublicationId(period, category))
      .get();
    const publication = publicationSnapshot.data();
    const calendarRevision = asNumber(
      (periodData?.workCalendar as { revision?: unknown } | undefined)
        ?.revision || 1,
    );
    const satisfied =
      Boolean(activeImportRevisionId) &&
      publicationSnapshot.exists &&
      publication?.state === 'published' &&
      publication?.stale !== true &&
      publication?.importRevisionId === activeImportRevisionId &&
      asNumber(publication?.calendarRevision) === calendarRevision;

    return {
      gate: {
        required: true,
        satisfied,
        reason: satisfied
          ? undefined
          : `Presensi ${category} belum dipublikasikan pada revisi import dan kalender terbaru.`,
      },
      entries,
      customColumns,
    };
  }

  if (category === 'SATPAM' && isSatpamDutyPlanRequired(period, periodData)) {
    const blockerCount = asNumber(
      (uraianData?.satpamDutyReconciliation as { blockerCount?: unknown } | undefined)
        ?.blockerCount,
    );
    return {
      gate: {
        required: true,
        // buildPekaryaSlipPreview adds the matching employee-level
        // satpamDutySource warning after this period-wide verdict. It still
        // exposes the Rekap shift columns provisionally while this gate is
        // pending, but keeps slip creation blocked.
        satisfied: blockerCount === 0,
        reason:
          blockerCount === 0
            ? undefined
            : 'Rekonsiliasi kewajiban dinas dan bonus Satpam belum final.',
      },
      entries,
      customColumns,
    };
  }

  return { gate: { required: false, satisfied: true }, entries, customColumns };
}

export interface PekaryaPreviewLoadResult {
  period: string;
  matrixVersion: string;
  previews: Record<string, PekaryaSlipPreview>;
  /**
   * Active scanner rows keyed by employee. This is intentionally scoped to
   * the employees included in this request (one employee for an employee
   * payslip, all employees for Finance), so the payslip cannot read another
   * employee's attendance log.
   */
  attendanceLogs?: Record<string, PekaryaAttendanceLog[]>;
  attendanceImportRevisionId: string | null;
}

/**
 * Builds previews for every Pekarya employee in the period, or only for
 * `employeeIds` when the caller is scoped to one person.
 */
export async function loadPekaryaSlipPreviews(
  period: string,
  employeeIds?: readonly string[],
): Promise<PekaryaPreviewLoadResult> {
  const [year, month] = period.split('-').map(Number);
  const periodKey = `${year}_${String(month).padStart(2, '0')}`;
  const targetDate = new Date(year, month - 1, 1);
  const window = pekaryaPayrollWindow(period);

  const employeeSnapshots = employeeIds
    ? await Promise.all(
        employeeIds.map((id) =>
          adminDb.collection(BLUE_COLLAR_COLLECTION).doc(id).get(),
        ),
      )
    : (await adminDb.collection(BLUE_COLLAR_COLLECTION).get()).docs;

  const employees = employeeSnapshots
    .filter((snapshot) => snapshot.exists)
    .map((snapshot) => ({
      id: snapshot.id,
      ...(snapshot.data() as Record<string, unknown>),
    }) as PekaryaPreviewEmployee)
    .filter((employee) => {
      const category = employee.employment?.jobCategory;
      return typeof category === 'string' && category.trim().length > 0;
    });

  // Active BlueCollar master data is authoritative; newly introduced job
  // categories participate without requiring a code-list deployment first.
  const categoryOf = (employee: PekaryaPreviewEmployee): string =>
    employee.employment?.jobCategory as string;

  const categories = [...new Set(employees.map(categoryOf))];

  // A one-employee request scopes the activity query to that employee; a
  // period-wide dashboard request reads the whole month once instead of
  // issuing one query per employee.
  const scopedEmployeeId =
    employeeIds && employeeIds.length === 1 ? employeeIds[0] : null;
  const activityQueries = window.sourceMonths.map((sourceMonth) => {
    const base = adminDb
      .collection('ActivityReports')
      .where('period', '==', sourceMonth);
    return scopedEmployeeId
      ? base.where('employeeId', '==', scopedEmployeeId).get()
      : base.get();
  });

  // The same normalized rows, manual links, corrections, and time-based
  // calculator used by Presensi Pekarya also drive provisional payslip money.
  // Resolve them once per request so a period-wide Finance preview does not
  // re-read the attendance workbook once for every job category.
  const needsUploadedAttendance =
    period >= '2026-08' &&
    employees.some(
      (employee) => categoryOf(employee).trim().toUpperCase() !== 'SATPAM',
    );
  const attendanceIdentityPromise =
    needsUploadedAttendance
      ? loadAttendanceEmployeeIdentities()
      : Promise.resolve(null);
  const effectiveAttendancePromise = attendanceIdentityPromise.then(
    (identities) =>
      identities
        ? loadEffectiveAttendanceDays(period, {
            allowMissingActiveImport: true,
            identities,
          })
        : null,
  );

  const [
    { version: matrixVersion, matrix },
    periodSnapshot,
    annualSnapshot,
    piketSchedules,
    eventSnapshot,
    activitySnapshots,
    attendanceIdentities,
    effectiveAttendance,
  ] = await Promise.all([
    loadActiveBlueCollarMatrix(),
    // PayrollPeriods is keyed by the dashed period token, unlike UraianGaji,
    // which uses the underscored payroll document key.
    adminDb.collection('PayrollPeriods').doc(period).get(),
    annualCalendarRef(period).get(),
    loadPiketSchedules(period),
    adminDb.collection('KegiatanSpj').where('period', '==', period).get(),
    Promise.all(activityQueries),
    attendanceIdentityPromise,
    effectiveAttendancePromise,
  ] as const);

  const periodData = periodSnapshot.exists
    ? (periodSnapshot.data() as Record<string, unknown>)
    : null;
  const premiumDates = new Set(
    periodCalendarFromData(period, periodData, annualDatesFrom(annualSnapshot))
      .premiumDates,
  );
  const activeImportRevisionId = String(
    effectiveAttendance?.importData.activeRevisionId || '',
  );
  const attendanceIdentityByEmployeeId = new Map(
    (attendanceIdentities?.identities || [])
      .filter(
        (identity) => identity.employeeCollection === BLUE_COLLAR_COLLECTION,
      )
      .map((identity) => [identity.employeeId, identity] as const),
  );
  const uploadedAttendanceEntries: Record<string, UraianEntry> = {};
  const attendanceLogs: Record<string, PekaryaAttendanceLog[]> = {};
  const shouldReturnAttendanceLogs = Boolean(employeeIds);
  if (activeImportRevisionId && effectiveAttendance) {
    for (const employee of employees) {
      const identity = attendanceIdentityByEmployeeId.get(employee.id);
      if (
        !identity ||
        !identity.active ||
        identity.employeeCollection !== BLUE_COLLAR_COLLECTION ||
        identity.jobCategory === 'SATPAM'
      ) {
        continue;
      }
      const summary = summarizePekaryaAttendance(
        attendanceJoinNipy(identity),
        effectiveAttendance.days,
        premiumDates,
      );
      if (shouldReturnAttendanceLogs) {
        attendanceLogs[employee.id] = summary.days.map((day) => ({
          date: day.date,
          workStatus: day.workStatus,
          scanIn: day.scanIn,
          scanOut: day.scanOut,
          scanInAuto: day.scanInAuto,
          scanOutAuto: day.scanOutAuto,
          present: day.present,
          completePunch: day.completePunch,
          corrected: day.corrected,
          payType: day.payType,
          amount: day.amount,
          durationSeconds: attendanceWorkedSeconds(day.scanIn, day.scanOut),
        }));
      }
      uploadedAttendanceEntries[employee.id] = {
        employeeId: employee.id,
        name: identity.name,
        values: {
          harian: summary.harianAmount,
          jumatLibur: summary.jumatLiburAmount,
        },
        counts: {
          harian: summary.harianCount,
          jumatLibur: summary.jumatLiburCount,
        },
      };
    }
  }

  const activityReports: PekaryaActivityFinancialLike[] =
    activitySnapshots.flatMap((snapshot) =>
      snapshot.docs.map(
        (document) =>
          ({ id: document.id, ...document.data() }) as PekaryaActivityFinancialLike,
      ),
    );
  const events: KegiatanSpjFinancialLike[] = eventSnapshot.docs.map(
    (document) =>
      ({ id: document.id, ...document.data() }) as KegiatanSpjFinancialLike,
  );

  const attendanceStates = new Map<string, CategoryAttendanceState>();
  await Promise.all(
    categories.map(async (category) => {
      attendanceStates.set(
        category,
        await loadCategoryAttendanceState(
          period,
          periodKey,
          category,
          periodData,
          activeImportRevisionId,
        ),
      );
    }),
  );

  const previews: Record<string, PekaryaSlipPreview> = {};
  for (const employee of employees) {
    const category = categoryOf(employee);
    const state = attendanceStates.get(category)!;
    previews[employee.id] = buildPekaryaSlipPreview({
      employee,
      period,
      targetDate,
      salaryMatrix: matrix,
      matrixVersion,
      uraianEntry: state.entries[employee.id],
      uploadedAttendanceEntry: uploadedAttendanceEntries[employee.id],
      uraianCustomColumns: state.customColumns,
      approvedActivitySpj: sumApprovedActivitySpj(
        activityReports,
        employee.id,
        category,
        period,
      ),
      approvedEventSpj: sumApprovedEventSpj(
        events,
        employee.id,
        category,
        period,
      ),
      piketSchedules,
      premiumDates,
      attendanceGate: state.gate,
    });
  }

  return {
    period,
    matrixVersion,
    previews,
    ...(activeImportRevisionId && shouldReturnAttendanceLogs
      ? { attendanceLogs }
      : {}),
    attendanceImportRevisionId: activeImportRevisionId || null,
  };
}
