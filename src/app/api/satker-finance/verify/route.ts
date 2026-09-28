import { timingSafeEqual } from 'node:crypto';
import { NextRequest } from 'next/server';
import { adminDb } from '@/lib/firebase-admin';
import { UNIT_COLLECTION, yearRef } from '@/lib/server/satkerFinance';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const unitId = request.nextUrl.searchParams.get('unitId') || '';
  const academicYear = request.nextUrl.searchParams.get('academicYear') || '';
  const month = request.nextUrl.searchParams.get('month') || '';
  const code = request.nextUrl.searchParams.get('code') || '';
  if (!/^[a-z0-9][a-z0-9-]{1,49}$/.test(unitId) || !/^\d{4}-\d{4}$/.test(academicYear) || !/^(0[1-9]|1[0-2])$/.test(month) || !/^[a-f0-9]{36}$/.test(code)) {
    return Response.json({ verified: false }, { status: 400, headers: { 'Cache-Control': 'no-store' } });
  }
  try {
    const [report, unit] = await Promise.all([
      yearRef(unitId, academicYear).collection('reports').doc(month).get(),
      adminDb.collection(UNIT_COLLECTION).doc(unitId).get(),
    ]);
    const stored = report.data()?.verificationCode;
    const verified = report.data()?.status === 'APPROVED' && typeof stored === 'string' && stored.length === code.length && timingSafeEqual(Buffer.from(stored), Buffer.from(code));
    if (!verified || !unit.exists) return Response.json({ verified: false }, { status: 404, headers: { 'Cache-Control': 'no-store' } });
    return Response.json({ verified: true, unitName: report.data()?.unitName || unit.data()?.name, academicYear, month: Number(month),
      submittedName: report.data()?.submittedName || '', bakApprovedName: report.data()?.bakApprovedName || '',
      rectorApprovedName: report.data()?.rectorApprovedName || '',
      income: report.data()?.snapshot?.incomeStatement?.income ?? 0,
      expense: report.data()?.snapshot?.incomeStatement?.expense ?? 0,
      endingCash: report.data()?.snapshot?.cashFlow?.endingCash ?? 0,
    }, { headers: { 'Cache-Control': 'no-store' } });
  } catch {
    return Response.json({ verified: false }, { status: 404, headers: { 'Cache-Control': 'no-store' } });
  }
}
