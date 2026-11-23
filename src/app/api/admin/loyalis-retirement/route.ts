import { FieldValue } from 'firebase-admin/firestore';
import { NextRequest } from 'next/server';
import { adminDb } from '@/lib/firebase-admin';
import { EMPLOYEE_PROFILE_EDITOR_ROLES } from '@/lib/payroll/roles';
import { isLoyalisBirthMonth } from '@/lib/payroll/loyalisRetirement';
import { errorResponse, HttpError, requireAuthenticatedProfile, requireRole } from '@/lib/server/auth';
import { jakartaToday } from '@/lib/server/payrollPeriod';

const COLLECTION = 'LoyalisRetirementBirthMonths';
const headers = { 'Cache-Control': 'private, no-store' };

export async function GET(request: NextRequest) {
  try {
    const actor = await requireAuthenticatedProfile(request);
    requireRole(actor, EMPLOYEE_PROFILE_EDITOR_ROLES);

    const snapshot = await adminDb.collection(COLLECTION).select('birthMonth').get();
    const today = jakartaToday();
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
    const { employeeId, birthMonth } = body ?? {};
    if (typeof employeeId !== 'string' || !employeeId || employeeId.length > 1500 ||
        employeeId.includes('/') || employeeId === '.' || employeeId === '..' || /^__.*__$/.test(employeeId)) {
      throw new HttpError(400, 'ID Loyalis tidak valid.');
    }
    if (!isLoyalisBirthMonth(birthMonth, jakartaToday())) {
      throw new HttpError(400, 'Bulan lahir tidak valid.');
    }

    const employee = adminDb.collection('Employees_Loyalis').doc(employeeId);
    const confirmed = adminDb.collection(COLLECTION).doc(employeeId);
    await adminDb.runTransaction(async transaction => {
      const [employeeSnapshot, confirmationSnapshot] = await transaction.getAll(employee, confirmed);
      if (!employeeSnapshot.exists) throw new HttpError(404, 'Data Loyalis tidak ditemukan.');
      if (confirmationSnapshot.get('birthMonth') !== birthMonth) {
        transaction.set(confirmed, { birthMonth, confirmedBy: actor.uid, confirmedAt: FieldValue.serverTimestamp() });
      }
    });
    return Response.json({ employeeId, birthMonth }, { headers });
  } catch (error) {
    return errorResponse(error);
  }
}
