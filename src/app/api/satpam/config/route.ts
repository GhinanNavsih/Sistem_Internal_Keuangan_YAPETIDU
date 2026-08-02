import { NextRequest } from 'next/server';
import { adminDb } from '@/lib/firebase-admin';
import {
  assertDateOnly,
  getRegularSatpamPayType,
  payrollPeriodForDutyDate,
} from '@/lib/payroll/domain';
import { periodCalendarFromData } from '@/lib/payroll/calendar';
import { pekaryaPayrollPeriodForDate, pekaryaPayrollWindow } from '@/lib/payroll/pekaryaSpj';
import {
  isSatpamDutyPlanRequired,
  satpamAdvancePlanningPeriod,
} from '@/lib/payroll/satpamDutyPlan';
import { isSatpamFlexibilityEnabled } from '@/lib/server/satpamFlexibility';
import {
  SATPAM_DUTY_PLANS_COLLECTION,
  loadSatpamDutyPlanContext,
} from '@/lib/server/satpamDutyPlan';
import { getSatpamShiftForTeam } from '@/utils/satpamRotation';
import { isPeriodClosed, jakartaToday } from '@/lib/server/payrollPeriod';
import {
  errorResponse,
  HttpError,
  requireAuthenticatedProfile,
  requireRole,
} from '@/lib/server/auth';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  try {
    const actor = await requireAuthenticatedProfile(request);
    requireRole(actor, ['ketua_shift_satpam']);
    if (!actor.linkedEmployeeId) {
      throw new HttpError(409, 'Akun Ketua Shift belum terhubung ke data Satpam.');
    }

    const dutyDate = request.nextUrl.searchParams.get('dutyDate') || '';
    try {
      assertDateOnly(dutyDate);
    } catch {
      throw new HttpError(400, 'dutyDate wajib berupa tanggal YYYY-MM-DD yang valid.');
    }
    const year = dutyDate.slice(0, 4);
    const teamQuery = await adminDb
      .collection('SatpamShiftTeams')
      .where('ketuaShiftId', '==', actor.linkedEmployeeId)
      .limit(2)
      .get();

    if (teamQuery.size !== 1) {
      throw new HttpError(409, 'Konfigurasi regu Ketua Shift harus tepat satu.');
    }

    const teamSnapshot = teamQuery.docs[0];
    const team = teamSnapshot.data();
    const memberIds = Array.isArray(team.memberEmployeeIds)
      ? team.memberEmployeeIds.filter((id): id is string => typeof id === 'string')
      : [];
    const rosterIds = Array.from(new Set([actor.linkedEmployeeId, ...memberIds]));
    if (rosterIds.length !== 10 || memberIds.length !== 9) {
      throw new HttpError(409, 'Regu Satpam wajib berisi satu Ketua dan sembilan anggota unik.');
    }

    const [employeeSnapshot, rosterSnapshots] = await Promise.all([
      adminDb
        .collection('Employees_BlueCollar')
        .where('employment.jobCategory', '==', 'SATPAM')
        .get(),
      adminDb.getAll(
        ...rosterIds.map((employeeId) =>
          adminDb.collection('Employees_BlueCollar').doc(employeeId),
        ),
      ),
    ]);
    const employeeDocuments = new Map(
      [...employeeSnapshot.docs, ...rosterSnapshots]
        .filter((snapshot) => snapshot.exists)
        .map((snapshot) => [snapshot.id, snapshot]),
    );
    const employees = Array.from(employeeDocuments.values())
      .map((snapshot) => {
        const data = snapshot.data()!;
        return {
          id: snapshot.id,
          name: String(data.name || ''),
          isActive:
            data.employment?.jobCategory === 'SATPAM' &&
            (data.employment?.status === 'active' || data.flags?.isActive === true),
        };
      })
      .filter((employee) => employee.name)
      .sort((left, right) => left.name.localeCompare(right.name, 'id'));

    const dutyPeriod = payrollPeriodForDutyDate(dutyDate);
    const pos9PlansSnapshot = await adminDb
      .collection(SATPAM_DUTY_PLANS_COLLECTION)
      .where('period', '==', dutyPeriod)
      .get();
    const [holidaysSnapshot, dutyPeriodSnapshot] = await Promise.all([
      year
        ? adminDb.collection('PayrollHolidayCalendars').doc(year).get()
        : Promise.resolve(null),
      adminDb.collection('PayrollPeriods').doc(dutyPeriod).get(),
    ]);
    const annualDates =
      holidaysSnapshot?.exists && Array.isArray(holidaysSnapshot.data()?.dates)
        ? holidaysSnapshot.data()!.dates.filter(
            (date: unknown): date is string => typeof date === 'string',
          )
        : [];
    const periodCalendar = periodCalendarFromData(
      dutyPeriod,
      dutyPeriodSnapshot.exists ? dutyPeriodSnapshot.data()! : null,
      annualDates,
    );
    const holidayDates = new Set<string>(periodCalendar.premiumDates);
    const dutyPlanContext = await loadSatpamDutyPlanContext(
      dutyPeriod,
      teamSnapshot.id,
      dutyDate,
    );
    const pos9Guards = pos9PlansSnapshot.docs
      .filter((snapshot) => snapshot.data()?.status !== 'stale')
      .map((snapshot) => {
        const data = snapshot.data();
        const employeeId = String(data.fixedPost9EmployeeId || '');
        const employee = employeeDocuments.get(employeeId);
        return employeeId
          ? {
              employeeId,
              teamId: String(data.teamId || snapshot.id),
              name: String(employee?.data()?.name || employeeId),
            }
          : null;
      })
      .filter(
        (value): value is { employeeId: string; teamId: string; name: string } =>
          value !== null,
      );

    const teamNumber = Number(teamSnapshot.id.split('_')[1]);
    if (![1, 2, 3].includes(teamNumber)) {
      throw new HttpError(409, 'Nomor regu Satpam tidak valid.');
    }
    // Periods are open by default; only an explicit permanent closure removes
    // one from service. The current period is therefore always open even when
    // it has no PayrollPeriods document yet -- a straggling past period stays
    // open only if its document exists and was never closed. The immediately
    // following month remains advance-planning-only, matching the existing
    // duty-plan-ahead workflow.
    const currentPeriod = pekaryaPayrollPeriodForDate(jakartaToday());
    const advancePeriod = satpamAdvancePlanningPeriod();
    const allPeriodsSnapshot = await adminDb.collection('PayrollPeriods').get();
    const periodDataById = new Map(
      allPeriodsSnapshot.docs
        .filter((snapshot) => /^\d{4}-\d{2}$/.test(snapshot.id))
        .map((snapshot) => [snapshot.id, snapshot.data()]),
    );

    const openPeriodIds = new Set<string>(
      Array.from(periodDataById.entries())
        .filter(([period, data]) => period <= currentPeriod && !isPeriodClosed(data))
        .map(([period]) => period),
    );
    openPeriodIds.add(currentPeriod);
    if (dutyPeriod <= currentPeriod && !isPeriodClosed(periodDataById.get(dutyPeriod))) {
      openPeriodIds.add(dutyPeriod);
    }

    const openPeriods = Array.from(openPeriodIds)
      .map((period) => {
        const window = pekaryaPayrollWindow(period);
        return {
          period,
          startDate: window.startsOn,
          endDate: window.endsOn,
          planningOnly: false,
        };
      })
      .sort((left, right) => left.startDate.localeCompare(right.startDate));
    const planningPeriods = [...openPeriods];
    if (
      !planningPeriods.some((item) => item.period === advancePeriod) &&
      !isPeriodClosed(periodDataById.get(advancePeriod))
    ) {
      const advanceWindow = pekaryaPayrollWindow(advancePeriod);
      planningPeriods.push({
        period: advancePeriod,
        startDate: advanceWindow.startsOn,
        endDate: advanceWindow.endsOn,
        planningOnly: true,
      });
    }
    planningPeriods.sort((left, right) =>
      left.startDate.localeCompare(right.startDate),
    );
    return Response.json(
      {
        team: {
          id: teamSnapshot.id,
          ketuaShiftId: actor.linkedEmployeeId,
          ketuaShiftName: String(team.ketuaShiftName || actor.displayName),
          memberEmployeeIds: memberIds,
        },
        employees,
        shiftName: getSatpamShiftForTeam(teamNumber, dutyDate),
        regularPayType: getRegularSatpamPayType(dutyDate, holidayDates),
        holidayCalendarConfigured:
          Boolean(dutyPeriodSnapshot.data()?.workCalendar) ||
          Boolean(holidaysSnapshot?.exists),
        openPeriods,
        planningPeriods,
        flexibilityEnabled: isSatpamFlexibilityEnabled(teamSnapshot.id),
        pos9Guards,
        dutyPlan: {
          enabled: isSatpamDutyPlanRequired(
            dutyPeriod,
            dutyPeriodSnapshot.data() || null,
          ),
          planId: dutyPlanContext.plan?.id || null,
          revision: dutyPlanContext.plan?.revision || 0,
          status: dutyPlanContext.plan?.status || 'missing',
          day: dutyPlanContext.day,
          warning: !dutyPlanContext.plan
            ? 'Rencana dinas belum diterbitkan. Laporan tetap dapat dikirim dan akan direkonsiliasi.'
            : dutyPlanContext.plan.status !== 'published'
              ? 'Rencana dinas masih memerlukan pemeriksaan Kepala SatKer.'
              : null,
          fixedPost9EmployeeId:
            dutyPlanContext.plan?.fixedPost9EmployeeId || null,
        },
      },
      {
        headers: {
          'Cache-Control': 'no-store, max-age=0, must-revalidate',
        },
      },
    );
  } catch (error) {
    return errorResponse(error);
  }
}
