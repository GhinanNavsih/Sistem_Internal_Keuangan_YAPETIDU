import { NextRequest } from 'next/server';
import { URAIAN_EDITOR_ROLES } from '@/lib/payroll/roles';
import {
  errorResponse,
  HttpError,
  requireAuthenticatedProfile,
  requireRole,
  type AuthenticatedProfile,
} from '@/lib/server/auth';
import {
  propagateUraianToDraftSlips,
  type PropagationCommand,
} from '@/lib/server/uraianSlipPropagation';

export const dynamic = 'force-dynamic';

function parseCommand(raw: unknown): PropagationCommand {
  if (!raw || typeof raw !== 'object') {
    throw new HttpError(400, 'Perintah propagasi tidak valid.');
  }
  const command = raw as Record<string, unknown>;

  const scope = command.scope;
  if (scope !== 'pekarya' && scope !== 'loyalis') {
    throw new HttpError(400, 'Scope propagasi tidak valid.');
  }

  const rawPeriod = typeof command.period === 'string' ? command.period : '';
  const periodMatch = /^(\d{4})[-_](\d{2})$/.exec(rawPeriod);
  if (!periodMatch) {
    throw new HttpError(400, 'Periode wajib menggunakan format YYYY-MM.');
  }
  const periodKey = `${periodMatch[1]}_${periodMatch[2]}`;
  const periodToken = `${periodMatch[1]}-${periodMatch[2]}`;

  const requestId = typeof command.requestId === 'string' ? command.requestId : '';
  if (!/^[A-Za-z0-9_-]{8,128}$/.test(requestId)) {
    throw new HttpError(400, 'requestId tidak valid.');
  }

  let jobCategory = '';
  if (scope === 'pekarya') {
    jobCategory = typeof command.jobCategory === 'string' ? command.jobCategory : '';
    if (!/^[A-Za-z0-9_ -]{1,64}$/.test(jobCategory)) {
      throw new HttpError(400, 'Kategori pekerjaan tidak valid.');
    }
  }

  return { scope, periodKey, periodToken, jobCategory, requestId };
}

/**
 * A Satker head may only propagate the categories they are responsible for.
 * Finance roles and super_admin are unrestricted, matching the Uraian rules.
 */
function assertCategoryAllowed(actor: AuthenticatedProfile, command: PropagationCommand): void {
  if (actor.role === 'loyalis_admin') {
    if (command.scope !== 'loyalis') {
      throw new HttpError(403, 'Anda hanya berwenang atas presensi Loyalis.');
    }
    return;
  }
  if (actor.role !== 'satker_head' && actor.role !== 'satker_head_loyalis') return;
  if (command.scope === 'loyalis') {
    if (actor.role !== 'satker_head_loyalis') {
      throw new HttpError(403, 'Anda tidak berwenang atas presensi Loyalis.');
    }
    return;
  }
  if (!actor.permittedCategories.includes(command.jobCategory)) {
    throw new HttpError(403, `Anda tidak berwenang atas kategori ${command.jobCategory}.`);
  }
}

/**
 * Pushes a saved Uraian rekap (or the Loyalis presence calculator) onto the
 * draft payslips for that period. See `propagateUraianToDraftSlips`.
 */
export async function POST(request: NextRequest) {
  try {
    const actor = await requireAuthenticatedProfile(request);
    requireRole(actor, [...URAIAN_EDITOR_ROLES, 'loyalis_admin']);
    const command = parseCommand(await request.json());
    assertCategoryAllowed(actor, command);
    const result = await propagateUraianToDraftSlips(command, actor);
    return Response.json(result, { status: 200, headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    return errorResponse(error);
  }
}
