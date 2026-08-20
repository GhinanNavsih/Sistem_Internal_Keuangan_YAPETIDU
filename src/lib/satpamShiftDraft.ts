import type { PhotoAuditMetadata, SatpamPayType } from '@/lib/payroll/domain';

export const SATPAM_SHIFT_DRAFT_STORAGE_VERSION = 3;

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
  requestId?: string;
  savedAt?: string;
  payload: {
    dutyDate: string;
    shiftName?: SatpamDraftShiftName;
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

    const assignments = payload.assignments.filter(
      (assignment): assignment is SatpamShiftDraftAssignment =>
        isRecord(assignment) &&
        typeof assignment.postId === 'string' &&
        VALID_POST_IDS.has(assignment.postId) &&
        typeof assignment.employeeId === 'string' &&
        Boolean(assignment.employeeId.trim()),
    );
    const extraAssignment =
      isRecord(payload.extraAssignment) &&
      typeof payload.extraAssignment.postId === 'string' &&
      VALID_POST_IDS.has(payload.extraAssignment.postId) &&
      typeof payload.extraAssignment.employeeId === 'string' &&
      Boolean(payload.extraAssignment.employeeId.trim())
        ? (payload.extraAssignment as unknown as SatpamShiftDraftAssignment)
        : undefined;

    if (assignments.length === 0 && !extraAssignment) return null;

    const shiftName = VALID_SHIFT_NAMES.has(
      payload.shiftName as SatpamDraftShiftName,
    )
      ? (payload.shiftName as SatpamDraftShiftName)
      : undefined;

    return {
      ...(typeof parsed.requestId === 'string'
        ? { requestId: parsed.requestId }
        : {}),
      ...(typeof parsed.savedAt === 'string' ? { savedAt: parsed.savedAt } : {}),
      payload: {
        dutyDate: expectedDutyDate,
        ...(shiftName ? { shiftName } : {}),
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
