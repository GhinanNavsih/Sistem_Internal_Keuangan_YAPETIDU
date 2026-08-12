import { NextRequest, NextResponse } from 'next/server';
import { adminDb } from '@/lib/firebase-admin';
import { FINANCE_ROLES } from '@/lib/payroll/roles';
import { errorResponse, HttpError, requireAuthenticatedProfile } from '@/lib/server/auth';
import { assertValidProofFile, isPayrollPeriodOpen, saveUploadedFile } from '@/lib/server/storageUpload';

const SAFE_JOURNEY_ID = /^[A-Za-z0-9_-]{1,180}$/;

export async function POST(request: NextRequest) {
  try {
    const actor = await requireAuthenticatedProfile(request);
    const form = await request.formData();
    const journeyId = String(form.get('journeyId') || '');
    const type = String(form.get('type') || '');
    const file = form.get('file');

    if (!SAFE_JOURNEY_ID.test(journeyId)) {
      throw new HttpError(400, 'ID perjalanan tidak valid.');
    }
    if (type !== 'bbm' && type !== 'toll') {
      throw new HttpError(400, 'Jenis bukti tidak valid.');
    }
    assertValidProofFile(file, 5 * 1024 * 1024, { allowPdf: true });

    const journeySnapshot = await adminDb.collection('DriverJourneys').doc(journeyId).get();
    if (!journeySnapshot.exists) {
      throw new HttpError(404, 'Perjalanan dinas tidak ditemukan.');
    }
    const journey = journeySnapshot.data()!;

    const period = String(journey.payrollPeriod || journey.period || '');
    if (!(await isPayrollPeriodOpen(period))) {
      throw new HttpError(409, `Periode payroll ${period} sudah ditutup.`);
    }

    const isFinance = FINANCE_ROLES.includes(actor.role);
    const isOwner = Boolean(actor.linkedEmployeeId) && actor.linkedEmployeeId === journey.employeeId;
    if (!isFinance && actor.role !== 'satker_head' && !isOwner) {
      throw new HttpError(403, 'Perjalanan dinas ini bukan milik Anda.');
    }

    const extension = file.type === 'application/pdf' ? 'pdf' : 'jpg';
    const storagePath = `receipts/${journeyId}/${type}_${Date.now()}.${extension}`;
    const url = await saveUploadedFile(storagePath, file, actor.uid);
    return NextResponse.json({ url });
  } catch (error) {
    return errorResponse(error);
  }
}
