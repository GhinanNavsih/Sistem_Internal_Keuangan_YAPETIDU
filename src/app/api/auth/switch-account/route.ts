import { NextRequest } from 'next/server';
import { errorResponse, HttpError, requireAuthenticatedProfile } from '@/lib/server/auth';
import { startAccountSwitch } from '@/lib/server/linkedAccounts';

export const dynamic = 'force-dynamic';

/**
 * Switches the signed-in person to another of their own accounts ("Ganti
 * Peran"). Returns a custom token for that account; the browser signs in with
 * it, which replaces the current session.
 */
export async function POST(request: NextRequest) {
  try {
    const caller = await requireAuthenticatedProfile(request);
    const body: unknown = await request.json().catch(() => null);
    const targetUid =
      body && typeof body === 'object' ? (body as Record<string, unknown>).targetUid : null;
    if (typeof targetUid !== 'string' || !targetUid.trim()) {
      throw new HttpError(400, 'Akun tujuan wajib dipilih.');
    }

    const { customToken, target } = await startAccountSwitch(caller, targetUid.trim());
    return Response.json(
      { customToken, targetProfile: target },
      { headers: { 'Cache-Control': 'no-store' } },
    );
  } catch (error) {
    return errorResponse(error);
  }
}
