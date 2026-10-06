import { NextRequest } from 'next/server';
import { errorResponse, requireAuthenticatedProfile } from '@/lib/server/auth';
import { listLinkedAccounts } from '@/lib/server/linkedAccounts';

export const dynamic = 'force-dynamic';

/** The signed-in person's other accounts, for the "Ganti Peran" menu. */
export async function GET(request: NextRequest) {
  try {
    const caller = await requireAuthenticatedProfile(request);
    // Inside a Super Admin impersonation session the menu is hidden, and a
    // switch would be refused anyway.
    const accounts = caller.impersonatedBy ? [] : await listLinkedAccounts(caller.uid);
    return Response.json(
      { accounts },
      { headers: { 'Cache-Control': 'no-store, max-age=0, must-revalidate' } },
    );
  } catch (error) {
    return errorResponse(error);
  }
}
