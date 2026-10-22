import { NextRequest } from 'next/server';
import { adminDb } from '@/lib/firebase-admin';
import { errorResponse, HttpError, requireAuthenticatedProfile, requireRole } from '@/lib/server/auth';
import { applyReferralRecovery, settleUnpaidReferral, REFERRAL_RECOVERIES, REFERRAL_BONUSES } from '@/lib/server/loyalisReferralPayroll';
export async function GET(request: NextRequest) {
  try {
    const actor = await requireAuthenticatedProfile(request); requireRole(actor, ['super_admin', 'finance_verifier']);
    const [recoveries, unpaid] = await Promise.all([adminDb.collection(REFERRAL_RECOVERIES).get(), adminDb.collection(REFERRAL_BONUSES).where('status', '==', 'finance_review').get()]);
    return Response.json({ recoveries: recoveries.docs.map(doc => ({ id: doc.id, ...doc.data() })), unpaid: unpaid.docs.map(doc => ({ id: doc.id, ...doc.data() })) }, { headers: { 'Cache-Control': 'private, no-store' } });
  } catch (error) { return errorResponse(error); }
}
export async function POST(request: NextRequest) {
  try {
    const actor = await requireAuthenticatedProfile(request); requireRole(actor, ['super_admin', 'finance_verifier']);
    const body = await request.json();
    if (typeof body.claimId !== 'string' || !/^RL-\d{4}-[A-F0-9]{16}$/.test(body.claimId)) throw new HttpError(400, 'ID klaim tidak valid.');
    if (['manual', 'settle_bonus'].includes(body.action) && (typeof body.reference !== 'string' || body.reference.trim().length < 3 || body.reference.length > 500)) throw new HttpError(400, 'Tuliskan referensi penyelesaian manual.');
    if (!['apply', 'manual', 'settle_bonus'].includes(body.action)) throw new HttpError(400, 'Perintah tidak dikenal.');
    if (body.action === 'settle_bonus') return Response.json(await settleUnpaidReferral(body.claimId, body.reference.trim(), actor));
    return Response.json(await applyReferralRecovery(body.claimId, actor, body.action === 'manual' ? body.reference.trim() : undefined));
  } catch (error) { return errorResponse(error); }
}
