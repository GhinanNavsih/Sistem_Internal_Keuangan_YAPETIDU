import { NextRequest } from 'next/server';
import { adminDb } from '@/lib/firebase-admin';
import { assertDateOnly, getRegularSatpamPayType } from '@/lib/payroll/domain';
import { pekaryaPayrollWindow } from '@/lib/payroll/pekaryaSpj';
import { isSatpamFlexibilityEnabled } from '@/lib/server/satpamFlexibility';
import { getSatpamShiftForTeam } from '@/utils/satpamRotation';
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

    const holidaysSnapshot = year
      ? await adminDb.collection('PayrollHolidayCalendars').doc(year).get()
      : null;
    const holidayDates = new Set<string>(
      holidaysSnapshot?.exists && Array.isArray(holidaysSnapshot.data()?.dates)
        ? holidaysSnapshot.data()!.dates.filter(
            (date: unknown): date is string => typeof date === 'string',
          )
        : [],
    );

    const teamNumber = Number(teamSnapshot.id.split('_')[1]);
    if (![1, 2, 3].includes(teamNumber)) {
      throw new HttpError(409, 'Nomor regu Satpam tidak valid.');
    }
    const openPeriodSnapshot = await adminDb
      .collection('PayrollPeriods')
      .where('attendanceStatus', '==', 'open')
      .get();
    const openPeriods = openPeriodSnapshot.docs
      .flatMap((snapshot) => {
        if (!/^\d{4}-\d{2}$/.test(snapshot.id)) return [];
        const window = pekaryaPayrollWindow(snapshot.id);
        return [{
          period: snapshot.id,
          startDate: window.startsOn,
          endDate: window.endsOn,
        }];
      })
      .sort((left, right) => left.startDate.localeCompare(right.startDate));
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
        holidayCalendarConfigured: Boolean(holidaysSnapshot?.exists),
        openPeriods,
        flexibilityEnabled: isSatpamFlexibilityEnabled(teamSnapshot.id),
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
