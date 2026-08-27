import type { PhotoAuditMetadata, SatpamPayType } from '@/lib/payroll/domain';

export const SATPAM_SHIFT_DRAFT_STORAGE_VERSION = 3;
export const SATPAM_SHIFT_DRAFT_SCHEMA_VERSION = 2;
export const SATPAM_SHIFT_DRAFTS_COLLECTION = 'SatpamShiftDrafts';

export type SatpamDraftShiftName = 'Pagi' | 'Sore' | 'Malam';

export interface SatpamShiftDraftAssignment {
  postId: string;
  employeeId: string;
  shiftType?: SatpamPayType | string;
  coveredEmployeeId?: string;
  overtimeReason?: string;
  photoUrl?: string;
  photoAuditMetadata?: PhotoAuditMetadata;
}

export interface SatpamShiftPendingDraft {
  id?: string;
  revision?: number;
  requestId?: string;
  savedAt?: string;
  payload: {
    dutyDate: string;
    shiftName?: SatpamDraftShiftName;
    /**
     * A complete snapshot contains all nine post rows, including intentional
     * blanks. Legacy v3 local drafts omitted blank rows, so the flag is
     * optional and old drafts continue to restore as overlays.
     */
    completeSnapshot?: boolean;
    /** Distinguishes an intentionally cleared form from an untouched form. */
    hasUserChanges?: boolean;
    /** Keeps the Tambah Petugas card open even before its first field is set. */
    extraVisible?: boolean;
    baseOccurrenceId?: string;
    baseOccurrenceRevision?: number;
    dutyPlanId?: string;
    dutyPlanRevision?: number;
    assignments: SatpamShiftDraftAssignment[];
    extraAssignment?: SatpamShiftDraftAssignment;
  };
}

const VALID_POST_IDS = new Set(
  Array.from({ length: 9 }, (_, index) => `Pos ${index + 1}`),
);
const VALID_SHIFT_NAMES = new Set<SatpamDraftShiftName>([
  'Pagi',
  'Sore',
  'Malam',
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

/**
 * Date is part of the key as well as the stored payload. Keeping both checks is
 * intentional: a stale React render used to write one date's form under the
 * next date's key, and a malformed/legacy draft must never be trusted merely
 * because it happened to be found at the expected key.
 */
export function satpamShiftDraftStorageKey(
  employeeId: string,
  dutyDate: string,
): string {
  if (!employeeId || !/^\d{4}-\d{2}-\d{2}$/.test(dutyDate)) return '';
  return `unipdu:satpam-draft:v${SATPAM_SHIFT_DRAFT_STORAGE_VERSION}:${employeeId}:${dutyDate}`;
}

/** Server document id for the one in-progress shift form owned per Ketua/date. */
export function satpamShiftDraftDocumentId(
  employeeId: string,
  dutyDate: string,
): string {
  if (!employeeId || !/^\d{4}-\d{2}-\d{2}$/.test(dutyDate)) return '';
  // Firestore document ids cannot contain '/'. linkedEmployeeId itself is a
  // Firestore document id, but keep this defensive normalization at the API
  // boundary so a malformed profile can never change the collection path.
  const safeEmployeeId = employeeId.replace(/\//g, '_').slice(0, 500);
  return `${safeEmployeeId}__${dutyDate.replaceAll('-', '')}`;
}

function optionalString(
  value: Record<string, unknown>,
  key: string,
): string | undefined {
  return typeof value[key] === 'string' ? (value[key] as string) : undefined;
}

function normalizeDraftAssignment(
  raw: unknown,
  keepBlank: boolean,
): SatpamShiftDraftAssignment | null {
  if (!isRecord(raw)) return null;
  if (typeof raw.postId !== 'string' || !VALID_POST_IDS.has(raw.postId)) {
    return null;
  }
  const employeeId = typeof raw.employeeId === 'string' ? raw.employeeId : '';
  const assignment: SatpamShiftDraftAssignment = {
    postId: raw.postId,
    employeeId,
    ...(optionalString(raw, 'shiftType') !== undefined
      ? { shiftType: optionalString(raw, 'shiftType') }
      : {}),
    ...(optionalString(raw, 'coveredEmployeeId') !== undefined
      ? { coveredEmployeeId: optionalString(raw, 'coveredEmployeeId') }
      : {}),
    ...(optionalString(raw, 'overtimeReason') !== undefined
      ? { overtimeReason: optionalString(raw, 'overtimeReason') }
      : {}),
    ...(optionalString(raw, 'photoUrl') !== undefined
      ? { photoUrl: optionalString(raw, 'photoUrl') }
      : {}),
    ...(isRecord(raw.photoAuditMetadata)
      ? {
          photoAuditMetadata:
            raw.photoAuditMetadata as unknown as PhotoAuditMetadata,
        }
      : {}),
  };
  const hasProgress = Boolean(
    employeeId.trim() ||
      assignment.coveredEmployeeId?.trim() ||
      assignment.overtimeReason?.trim() ||
      assignment.photoUrl?.trim(),
  );
  return keepBlank || hasProgress ? assignment : null;
}

/**
 * Parses only the small portion of a locally queued draft that the form knows
 * how to restore. Invalid, empty, or cross-date payloads are ignored instead
 * of being allowed to seed a daily report.
 */
export function parseSatpamShiftPendingDraft(
  raw: string | null,
  expectedDutyDate: string,
): SatpamShiftPendingDraft | null {
  if (!raw) return null;

  try {
    const parsed: unknown = JSON.parse(raw);
    if (!isRecord(parsed) || !isRecord(parsed.payload)) return null;

    const payload = parsed.payload;
    if (
      payload.dutyDate !== expectedDutyDate ||
      !Array.isArray(payload.assignments)
    ) {
      return null;
    }

    const completeSnapshot = payload.completeSnapshot === true;
    const hasUserChanges = payload.hasUserChanges === true;
    const seenPosts = new Set<string>();
    const assignments = payload.assignments.flatMap((assignment) => {
      const normalized = normalizeDraftAssignment(
        assignment,
        completeSnapshot && hasUserChanges,
      );
      if (!normalized || seenPosts.has(normalized.postId)) return [];
      seenPosts.add(normalized.postId);
      return [normalized];
    });
    // A guard may fill in the extra-officer card in any order (photo first,
    // post first, officer first) before being backgrounded mid-entry. Restore
    // whatever was captured instead of discarding the whole card just because
    // one field — often the post, picked last — isn't filled in yet.
    const rawExtra = payload.extraAssignment;
    const extraPostId =
      isRecord(rawExtra) &&
      typeof rawExtra.postId === 'string' &&
      VALID_POST_IDS.has(rawExtra.postId)
        ? rawExtra.postId
        : '';
    const extraEmployeeId =
      isRecord(rawExtra) && typeof rawExtra.employeeId === 'string'
        ? rawExtra.employeeId
        : '';
    const extraPhotoUrl =
      isRecord(rawExtra) && typeof rawExtra.photoUrl === 'string'
        ? rawExtra.photoUrl
        : '';
    const extraOvertimeReason =
      isRecord(rawExtra) && typeof rawExtra.overtimeReason === 'string'
        ? rawExtra.overtimeReason
        : '';
    const extraVisible =
      payload.extraVisible === true ||
      Boolean(
        extraPostId ||
          extraEmployeeId.trim() ||
          extraPhotoUrl.trim() ||
          extraOvertimeReason.trim(),
      );
    const extraAssignment =
      isRecord(rawExtra) &&
      (extraVisible ||
        extraPostId ||
        extraEmployeeId.trim() ||
        extraPhotoUrl.trim() ||
        extraOvertimeReason.trim())
        ? ({
            postId: extraPostId,
            employeeId: extraEmployeeId,
            overtimeReason: extraOvertimeReason,
            photoUrl: extraPhotoUrl,
            photoAuditMetadata: isRecord(rawExtra.photoAuditMetadata)
              ? (rawExtra.photoAuditMetadata as unknown as PhotoAuditMetadata)
              : undefined,
          } satisfies SatpamShiftDraftAssignment)
        : undefined;

    if (
      assignments.length === 0 &&
      !extraAssignment &&
      !extraVisible &&
      !hasUserChanges
    ) {
      return null;
    }

    const shiftName = VALID_SHIFT_NAMES.has(
      payload.shiftName as SatpamDraftShiftName,
    )
      ? (payload.shiftName as SatpamDraftShiftName)
      : undefined;

    return {
      ...(typeof parsed.id === 'string' ? { id: parsed.id } : {}),
      ...(Number.isInteger(parsed.revision) && Number(parsed.revision) > 0
        ? { revision: Number(parsed.revision) }
        : {}),
      ...(typeof parsed.requestId === 'string'
        ? { requestId: parsed.requestId }
        : {}),
      ...(typeof parsed.savedAt === 'string' ? { savedAt: parsed.savedAt } : {}),
      payload: {
        dutyDate: expectedDutyDate,
        ...(shiftName ? { shiftName } : {}),
        ...(completeSnapshot ? { completeSnapshot: true } : {}),
        ...(hasUserChanges ? { hasUserChanges: true } : {}),
        ...(extraVisible ? { extraVisible: true } : {}),
        ...(typeof payload.baseOccurrenceId === 'string'
          ? { baseOccurrenceId: payload.baseOccurrenceId }
          : {}),
        ...(Number.isInteger(payload.baseOccurrenceRevision) &&
        Number(payload.baseOccurrenceRevision) > 0
          ? {
              baseOccurrenceRevision: Number(
                payload.baseOccurrenceRevision,
              ),
            }
          : {}),
        ...(typeof payload.dutyPlanId === 'string'
          ? { dutyPlanId: payload.dutyPlanId }
          : {}),
        ...(Number.isInteger(payload.dutyPlanRevision)
          ? { dutyPlanRevision: Number(payload.dutyPlanRevision) }
          : {}),
        assignments,
        ...(extraAssignment ? { extraAssignment } : {}),
      },
    };
  } catch {
    return null;
  }
}
