import { FieldValue } from 'firebase-admin/firestore';
import { NextRequest } from 'next/server';
import { adminDb } from '@/lib/firebase-admin';
import { EMPLOYEE_PROFILE_EDITOR_ROLES } from '@/lib/payroll/roles';
import { isDateOnly } from '@/lib/payroll/familyAllowance';
import { isLoyalisBirthMonth } from '@/lib/payroll/loyalisRetirement';
import { errorResponse, HttpError, requireAuthenticatedProfile, requireRole } from '@/lib/server/auth';
import { jakartaToday } from '@/lib/server/payrollPeriod';

const COLLECTION = 'LoyalisRetirementBirthMonths';
const headers = { 'Cache-Control': 'private, no-store' };

function isEmployeeId(value: unknown): value is string {
  return typeof value === 'string' && Boolean(value) && Buffer.byteLength(value) <= 1500 &&
    !value.includes('/') && value !== '.' && value !== '..' && !/^__.*__$/.test(value);
}

function isBirthDate(value: unknown, today: string): value is string {
  return isDateOnly(value) && value <= today;
}

export async function GET(request: NextRequest) {
  try {
    const actor = await requireAuthenticatedProfile(request);
    requireRole(actor, EMPLOYEE_PROFILE_EDITOR_ROLES);

    const today = jakartaToday();
    const employeeId = request.nextUrl.searchParams.get('employeeId');
    if (employeeId !== null) {
      if (!isEmployeeId(employeeId)) throw new HttpError(400, 'ID Loyalis tidak valid.');
      const snapshot = await adminDb.collection(COLLECTION).doc(employeeId).get();
      const birthMonth: unknown = snapshot.get('birthMonth');
      const birthDate: unknown = snapshot.get('birthDate');
      return Response.json({
        birthMonth: isLoyalisBirthMonth(birthMonth, today) ? birthMonth : null,
        birthDate: isBirthDate(birthDate, today) && birthDate.slice(0, 7) === birthMonth ? birthDate : null,
      }, { headers });
    }

    const snapshot = await adminDb.collection(COLLECTION).select('birthMonth').get();
    const birthMonths = snapshot.docs.flatMap(doc => {
      const birthMonth: unknown = doc.get('birthMonth');
      return isLoyalisBirthMonth(birthMonth, today) ? [{ employeeId: doc.id, birthMonth }] : [];
    });
    return Response.json({ birthMonths }, { headers });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function PUT(request: NextRequest) {
  try {
    const actor = await requireAuthenticatedProfile(request);
    requireRole(actor, EMPLOYEE_PROFILE_EDITOR_ROLES);

    const body = await request.json().catch(() => { throw new HttpError(400, 'JSON tidak valid.'); });
    const { employeeId, birthDate } = body ?? {};
    if (!isEmployeeId(employeeId)) throw new HttpError(400, 'ID Loyalis tidak valid.');
    const today = jakartaToday();
    if (birthDate !== undefined && !isBirthDate(birthDate, today)) {
      throw new HttpError(400, 'Tanggal lahir tidak valid.');
    }
    const birthMonth: unknown = birthDate?.slice(0, 7) ?? body?.birthMonth;
    if (!isLoyalisBirthMonth(birthMonth, today)) {
      throw new HttpError(400, 'Bulan lahir tidak valid.');
    }

    const employee = adminDb.collection('Employees_Loyalis').doc(employeeId);
    const confirmed = adminDb.collection(COLLECTION).doc(employeeId);
    await adminDb.runTransaction(async transaction => {
      const [employeeSnapshot, confirmationSnapshot] = await transaction.getAll(employee, confirmed);
      if (!employeeSnapshot.exists) throw new HttpError(404, 'Data Loyalis tidak ditemukan.');
      const storedDate: unknown = confirmationSnapshot.get('birthDate');
      if (birthDate === undefined && isBirthDate(storedDate, today) && storedDate.slice(0, 7) !== birthMonth) {
        throw new HttpError(409, 'Ubah tanggal lahir lengkap melalui Edit Data Karyawan.');
      }
      if (confirmationSnapshot.get('birthMonth') !== birthMonth ||
          (birthDate !== undefined && storedDate !== birthDate)) {
        transaction.set(confirmed, {
          birthMonth,
          ...(birthDate ? { birthDate } : {}),
          confirmedBy: actor.uid,
          confirmedAt: FieldValue.serverTimestamp(),
        });
      }
    });
    return Response.json({ employeeId, birthMonth, ...(birthDate ? { birthDate } : {}) }, { headers });
  } catch (error) {
    return errorResponse(error);
  }
}
