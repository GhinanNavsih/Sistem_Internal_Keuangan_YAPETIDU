import { NextRequest } from 'next/server';
import { errorResponse, requireAuthenticatedProfile } from '@/lib/server/auth';
import { callReferralPmb, loyalisReferralOwner } from '@/lib/server/loyalisReferralBridge';
import { generateLoyalisReferralPdf } from '@/lib/server/loyalisReferralPdf';
import type { ReferralLetter } from '@/lib/loyalis-referral-contract';
import { referralLetterFileName } from '@/lib/loyalisReferralFileName';
export async function GET(request: NextRequest, { params }: { params: Promise<{ letterId: string }> }) {
  try {
    const owner = await loyalisReferralOwner(await requireAuthenticatedProfile(request));
    const { letter } = await callReferralPmb<{ letter: ReferralLetter }>({ action: 'get', owner, letterId: (await params).letterId });
    const bytes = await generateLoyalisReferralPdf(letter, process.env.PMB_REFERRAL_ORIGIN!);
    return new Response(new Uint8Array(bytes), { headers: { 'Content-Type': 'application/pdf', 'Content-Disposition': `attachment; filename="${referralLetterFileName(letter)}"`, 'Cache-Control': 'private, no-store' } });
  } catch (error) { return errorResponse(error); }
}
