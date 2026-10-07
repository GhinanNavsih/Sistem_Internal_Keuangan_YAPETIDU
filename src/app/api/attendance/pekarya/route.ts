import { NextRequest } from 'next/server';
import { adminDb } from '@/lib/firebase-admin';
import {
  ATTENDANCE_PAYROLL_START_PERIOD,
} from '@/lib/payroll/attendance';
import {
  buildPekaryaAttendanceView,
  buildPekaryaAttendanceViewForCategories,
  buildSatpamAttendanceDetails,
  buildSatpamAttendanceMismatches,
  listActivePekaryaAttendanceCategories,
  loadAttendanceViewContext,
} from '@/lib/server/pekaryaAttendance';
import { loadAttendanceEmployeeIdentities } from '@/lib/server/attendanceStore';
import { ALL_BLUE_COLLAR_CATEGORY } from '@/lib/payroll/pekaryaSpj';
import {
  errorResponse,
  HttpError,
  requireAuthenticatedProfile,
  requireRole,
} from '@/lib/server/auth';
import { PEKARYA_OFFICIAL_LEAVE_REQUESTS_COLLECTION } from '@/lib/server/pekaryaOfficialLeave';

export const dynamic = 'force-dynamic';

// This page offers linking, so it also lists the rows no department claims.
const VIEW_OPTIONS = {
  allowMissingActiveImport: true,
  includeUnrouted: true,
} as const;

function queryValue(request: NextRequest, key: string): string {
  return request.nextUrl.searchParams.get(key)?.trim() || '';
}

type UnroutedFields = {
  unroutedLinkCandidates?: Array<{ category: string }>;
  unroutedUnmatched?: unknown[];
  exceptions?: { unroutedUnmatched?: unknown[] } & Record<string, unknown>;
};

/**
 * Rows no department claims, and the employees they could be linked to, are
 * for the roles that link attendance only. A Satker head may link only into
 * their own categories.
 */
function restrictUnrouted<T extends UnroutedFields>(
  result: T,
  actor: { role: string; permittedCategories: readonly string[] },
): T {
  const mayLink = actor.role === 'super_admin' || actor.role === 'satker_head';
  const permitted = new Set(
    actor.permittedCategories.map((item) => item.trim().toUpperCase()),
  );
  const candidates = (result.unroutedLinkCandidates || []).filter(
    (candidate) =>
      actor.role === 'super_admin' ||
      (mayLink && permitted.has(candidate.category.toUpperCase())),
  );
  return {
    ...result,
    ...('unroutedLinkCandidates' in result
      ? { unroutedLinkCandidates: candidates }
      : {}),
    ...('unroutedUnmatched' in result
      ? { unroutedUnmatched: mayLink ? result.unroutedUnmatched : [] }
      : {}),
    ...(result.exceptions
      ? {
          exceptions: {
            ...result.exceptions,
            unroutedUnmatched: mayLink ? result.exceptions.unroutedUnmatched : [],
          },
        }
      : {}),
  };
}

export async function GET(request: NextRequest) {
  try {
    const actor = await requireAuthenticatedProfile(request);
    requireRole(actor, [
      'super_admin',
      'finance_verifier',
      'satker_head',
      'loyalis_admin',
    ]);
    const period = queryValue(request, 'period');
    const category = queryValue(request, 'category').toUpperCase();
    if (!/^\d{4}-\d{2}$/.test(period) || period < ATTENDANCE_PAYROLL_START_PERIOD) {
      throw new HttpError(
        400,
        'Presensi Pekarya berlaku mulai periode 2026-08.',
      );
    }
    if (
      !category ||
      (!/^[A-Z0-9_ -]{2,80}$/.test(category) &&
        category !== ALL_BLUE_COLLAR_CATEGORY)
    ) {
      throw new HttpError(400, 'Kategori Pekarya tidak valid.');
    }
    let visibleCategories: string[] | null = null;
    // The roster comes first so an account with no visible category is refused
    // before the month's scan file is read.
    const identityIndex =
      category === ALL_BLUE_COLLAR_CATEGORY
        ? await loadAttendanceEmployeeIdentities(period)
        : null;
    if (category === ALL_BLUE_COLLAR_CATEGORY) {
      const activeCategories = await listActivePekaryaAttendanceCategories(
        period,
        identityIndex ?? undefined,
      );
      const permittedCategories = new Set(
        actor.permittedCategories.map((item) => item.trim().toUpperCase()),
      );
      visibleCategories =
        actor.role === 'satker_head'
          ? activeCategories.filter((item) =>
              permittedCategories.has(item),
            )
          : activeCategories;
      if (visibleCategories.length === 0) {
        throw new HttpError(
          403,
          'Anda tidak memiliki akses ke kategori Pekarya aktif.',
        );
      }
    } else {
      if (
        actor.role === 'satker_head' &&
        !actor.permittedCategories
          .map((item) => item.trim().toUpperCase())
          .includes(category)
      ) {
        throw new HttpError(403, `Anda tidak memiliki akses kategori ${category}.`);
      }
      visibleCategories = category === 'SATPAM' ? null : [category];
    }
    // "Semua Pekarya" shows several categories, plus Satpam, of one month. They
    // share the roster, the scan file and the correction log, so these load once.
    const sharedContext = identityIndex
      ? await loadAttendanceViewContext(
          period,
          VIEW_OPTIONS,
          identityIndex,
        )
      : null;
    // Satpam is paid from shift reports and approved leave, not from scans, so
    // it is shown beside the Pekarya cards for review only. It follows the same
    // access the Satpam view itself has.
    const canViewSatpam =
      actor.role !== 'satker_head' ||
      actor.permittedCategories
        .map((item) => item.trim().toUpperCase())
        .includes('SATPAM');
    const [result, satpamAttendance] = await Promise.all([
      category === 'SATPAM'
        ? buildSatpamAttendanceMismatches(period, VIEW_OPTIONS)
        : category === ALL_BLUE_COLLAR_CATEGORY
          ? buildPekaryaAttendanceViewForCategories(
              period,
              visibleCategories || [],
              VIEW_OPTIONS,
              sharedContext ?? undefined,
            )
          : buildPekaryaAttendanceView(period, category, VIEW_OPTIONS),
      sharedContext && canViewSatpam
        ? buildSatpamAttendanceDetails(
            period,
            VIEW_OPTIONS,
            new Date(),
            sharedContext,
          ).catch((error) => {
            // Review-only extra: never take the Pekarya cards down with it.
            console.error('Satpam attendance detail failed', error);
            return null;
          })
        : Promise.resolve(null),
    ]);
    const officialLeaveSnapshot =
      category === 'SATPAM'
        ? null
        : await adminDb
            .collection(PEKARYA_OFFICIAL_LEAVE_REQUESTS_COLLECTION)
            .where('period', '==', period)
            .get();
    return Response.json({
      ...restrictUnrouted(result, actor),
      ...(satpamAttendance ? { satpamAttendance } : {}),
      officialLeaves:
        officialLeaveSnapshot?.docs
          .map((document): { id: string; [key: string]: unknown } => ({
            id: document.id,
            ...(document.data() as Record<string, unknown>),
          }))
          .filter((item) =>
            (visibleCategories || []).includes(
              String(item.category || '').trim().toUpperCase(),
            ),
          )
          .sort((left, right) =>
            String(right.date || '').localeCompare(String(left.date || '')),
          ) || [],
    });
  } catch (error) {
    return errorResponse(error);
  }
}
