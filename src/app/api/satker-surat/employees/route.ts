import { NextRequest, NextResponse } from 'next/server';
import { adminDb } from '@/lib/firebase-admin';
import { canManageSuratMenyurat } from '@/lib/payroll/roles';
import { errorResponse, HttpError, requireAuthenticatedProfile } from '@/lib/server/auth';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  try {
    const actor = await requireAuthenticatedProfile(request);
    if (!canManageSuratMenyurat(actor.role)) throw new HttpError(403, 'Anda tidak memiliki akses surat-menyurat.');
    const [loyalis, pekarya] = await Promise.all([
      adminDb.collection('Employees_Loyalis').select('personal_info.name', 'personal_info.status', 'employment_profile.job_role', 'employment_profile.department_unit').get(),
      adminDb.collection('Employees_BlueCollar').select('name', 'employment.status', 'employment.jobCategory', 'flags.isActive').get(),
    ]);
    const people = [
      ...loyalis.docs.filter((doc) => !doc.data().personal_info?.status || doc.data().personal_info?.status === 'AKTIF').map((doc) => ({ id: doc.id, collection: 'Employees_Loyalis', name: String(doc.data().personal_info?.name || '').trim(), role: String(doc.data().employment_profile?.job_role || doc.data().employment_profile?.department_unit || '').trim() })),
      ...pekarya.docs.filter((doc) => doc.data().employment?.status !== 'inactive' && doc.data().flags?.isActive !== false).map((doc) => ({ id: doc.id, collection: 'Employees_BlueCollar', name: String(doc.data().name || '').trim(), role: String(doc.data().employment?.jobCategory || '').trim() })),
    ].filter((person) => person.name).sort((a, b) => a.name.localeCompare(b.name, 'id'));
    return NextResponse.json({ ok: true, people });
  } catch (error) {
    return errorResponse(error);
  }
}
