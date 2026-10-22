import { NextRequest } from 'next/server';
import { errorResponse, HttpError, requireAuthenticatedProfile } from '@/lib/server/auth';
import { callReferralPmb, loyalisReferralOwner } from '@/lib/server/loyalisReferralBridge';
import { adminDb } from '@/lib/firebase-admin';
import { REFERRAL_BONUSES } from '@/lib/server/loyalisReferralPayroll';
import { localReferralPayrollTestEnabled } from '@/lib/loyalis-referral-contract';
export async function GET(request: NextRequest) {
  try {
    const owner = await loyalisReferralOwner(await requireAuthenticatedProfile(request));
    const data = await callReferralPmb<Record<string, unknown>>({ action: 'list', owner });
    const bonuses = await adminDb.collection(REFERRAL_BONUSES).where('employeeId', '==', owner.employeeId).get();
    const canIssue = (await adminDb.collection('Employees_Loyalis').doc(owner.employeeId).get()).get('personal_info.status') === 'AKTIF';
    return Response.json({ ...data, canIssue, preview: process.env.NODE_ENV === 'development' && process.env.LOYALIS_REFERRAL_LOCAL_PREVIEW === 'true', payrollTest: localReferralPayrollTestEnabled(), bonuses: bonuses.docs.map(doc => ({ claimId: doc.id, status: doc.get('status'), postedPeriod: doc.get('postedPeriod'), amount: doc.get('amount'), payrollTest: doc.get('payrollTest') === true })) }, { headers: { 'Cache-Control': 'private, no-store' } });
  } catch (error) { return errorResponse(error); }
}
export async function POST(request: NextRequest) {
  try {
    const input = await request.json();
    if (!['issue', 'revoke'].includes(input.action)) throw new HttpError(400, 'Perintah tidak dikenal.');
    const owner = await loyalisReferralOwner(await requireAuthenticatedProfile(request), input.action === 'issue');
    const result = await callReferralPmb({ action: input.action, owner, cycleId: input.cycleId, prospectName: input.prospectName, letterId: input.letterId, requestId: input.requestId });
    return Response.json(result, { headers: { 'Cache-Control': 'private, no-store' } });
  } catch (error) { return errorResponse(error); }
}
