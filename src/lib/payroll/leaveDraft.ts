import type { PhotoEvidence } from '@/lib/payroll/domain';
import { normalizePhotoAuditMetadata } from '@/lib/photoEvidence';

export const LEAVE_DRAFT_STORAGE_VERSION = 1;
export const PEKARYA_LEAVE_DRAFT_PREFIX = 'unipdu:leave-draft:pekarya:v1:';
export const SATPAM_LEAVE_DRAFT_PREFIX = 'unipdu:leave-draft:satpam:v1:';

export function pekaryaLeaveDraftStorageKey(employeeId: string): string {
  if (!employeeId || typeof employeeId !== 'string' || !employeeId.trim()) return '';
  return `${PEKARYA_LEAVE_DRAFT_PREFIX}${employeeId.trim()}`;
}

export function satpamLeaveDraftStorageKey(employeeId: string): string {
  if (!employeeId || typeof employeeId !== 'string' || !employeeId.trim()) return '';
  return `${SATPAM_LEAVE_DRAFT_PREFIX}${employeeId.trim()}`;
}

export interface PekaryaLeaveDraftPayload {
  date?: string;
  reportType?: 'scan' | 'izin_resmi';
  scanIn?: string;
  scanOut?: string;
  reason?: string;
  evidence?: PhotoEvidence | null;
}

export interface PekaryaLeaveDraft extends PekaryaLeaveDraftPayload {
  version: number;
  savedAt: string;
}

export interface SatpamLeaveDraftPayload {
  period?: string;
  dutyDate?: string;
  reportType?: 'scan' | 'izin_resmi';
  scanIn?: string;
  scanOut?: string;
  absenceType?: string;
  reason?: string;
}

export interface SatpamLeaveDraft extends SatpamLeaveDraftPayload {
  version: number;
  savedAt: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

export function isPekaryaLeaveDraftEmpty(
  draft: PekaryaLeaveDraftPayload | null | undefined,
): boolean {
  if (!draft) return true;
  const hasReason = Boolean(draft.reason && draft.reason.trim().length > 0);
  const hasEvidence = Boolean(draft.evidence && draft.evidence.url);
  const hasCustomDate = Boolean(draft.date && draft.date.trim().length > 0);
  const hasCustomType = Boolean(draft.reportType && draft.reportType !== 'izin_resmi');
  const hasCustomScanIn = Boolean(draft.scanIn && draft.scanIn !== '08:00');
  const hasCustomScanOut = Boolean(draft.scanOut && draft.scanOut !== '14:00');
  return (
    !hasReason &&
    !hasEvidence &&
    !hasCustomDate &&
    !hasCustomType &&
    !hasCustomScanIn &&
    !hasCustomScanOut
  );
}

export function isSatpamLeaveDraftEmpty(
  draft: SatpamLeaveDraftPayload | null | undefined,
): boolean {
  if (!draft) return true;
  const hasReason = Boolean(draft.reason && draft.reason.trim().length > 0);
  const hasDutyDate = Boolean(draft.dutyDate && draft.dutyDate.trim().length > 0);
  const hasPeriod = Boolean(draft.period && draft.period.trim().length > 0);
  const hasCustomType = Boolean(draft.reportType && draft.reportType !== 'izin_resmi');
  const hasCustomAbsence = Boolean(draft.absenceType && draft.absenceType !== 'sakit');
  const hasCustomScanIn = Boolean(draft.scanIn && draft.scanIn !== '08:00');
  const hasCustomScanOut = Boolean(draft.scanOut && draft.scanOut !== '14:00');
  return (
    !hasReason &&
    !hasDutyDate &&
    !hasPeriod &&
    !hasCustomType &&
    !hasCustomAbsence &&
    !hasCustomScanIn &&
    !hasCustomScanOut
  );
}

export function serializePekaryaLeaveDraft(payload: PekaryaLeaveDraftPayload): string {
  const draft: PekaryaLeaveDraft = {
    version: LEAVE_DRAFT_STORAGE_VERSION,
    savedAt: new Date().toISOString(),
    date: payload.date?.trim() || '',
    reportType: payload.reportType === 'scan' ? 'scan' : 'izin_resmi',
    scanIn: payload.scanIn?.trim() || '08:00',
    scanOut: payload.scanOut?.trim() || '14:00',
    reason: payload.reason?.trim() || '',
    evidence:
      payload.evidence && typeof payload.evidence.url === 'string' && payload.evidence.url
        ? {
            url: payload.evidence.url,
            auditMetadata: payload.evidence.auditMetadata || null,
          }
        : null,
  };
  return JSON.stringify(draft);
}

export function parsePekaryaLeaveDraft(raw: string | null | undefined): PekaryaLeaveDraft | null {
  if (!raw || typeof raw !== 'string') return null;
  try {
    const parsed = JSON.parse(raw);
    if (!isRecord(parsed)) return null;
    if (parsed.version !== LEAVE_DRAFT_STORAGE_VERSION) return null;

    const reportType = parsed.reportType === 'scan' ? 'scan' : 'izin_resmi';
    const date = typeof parsed.date === 'string' ? parsed.date.trim() : '';
    const scanIn = typeof parsed.scanIn === 'string' ? parsed.scanIn.trim() : '08:00';
    const scanOut = typeof parsed.scanOut === 'string' ? parsed.scanOut.trim() : '14:00';
    const reason = typeof parsed.reason === 'string' ? parsed.reason.slice(0, 5000) : '';

    let evidence: PekaryaLeaveDraft['evidence'] = null;
    if (
      isRecord(parsed.evidence) &&
      typeof parsed.evidence.url === 'string' &&
      parsed.evidence.url
    ) {
      evidence = {
        url: parsed.evidence.url,
        auditMetadata: normalizePhotoAuditMetadata(
          isRecord(parsed.evidence.auditMetadata)
            ? (parsed.evidence.auditMetadata as Record<string, unknown>)
            : undefined,
        ),
      };
    }

    const draft: PekaryaLeaveDraft = {
      version: LEAVE_DRAFT_STORAGE_VERSION,
      savedAt: typeof parsed.savedAt === 'string' ? parsed.savedAt : '',
      date,
      reportType,
      scanIn,
      scanOut,
      reason,
      evidence,
    };

    if (isPekaryaLeaveDraftEmpty(draft)) return null;
    return draft;
  } catch {
    return null;
  }
}

export function serializeSatpamLeaveDraft(payload: SatpamLeaveDraftPayload): string {
  const draft: SatpamLeaveDraft = {
    version: LEAVE_DRAFT_STORAGE_VERSION,
    savedAt: new Date().toISOString(),
    period: payload.period?.trim() || '',
    dutyDate: payload.dutyDate?.trim() || '',
    reportType: payload.reportType === 'scan' ? 'scan' : 'izin_resmi',
    scanIn: payload.scanIn?.trim() || '08:00',
    scanOut: payload.scanOut?.trim() || '14:00',
    absenceType: payload.absenceType?.trim() || 'sakit',
    reason: payload.reason?.trim() || '',
  };
  return JSON.stringify(draft);
}

export function parseSatpamLeaveDraft(raw: string | null | undefined): SatpamLeaveDraft | null {
  if (!raw || typeof raw !== 'string') return null;
  try {
    const parsed = JSON.parse(raw);
    if (!isRecord(parsed)) return null;
    if (parsed.version !== LEAVE_DRAFT_STORAGE_VERSION) return null;

    const period = typeof parsed.period === 'string' ? parsed.period.trim() : '';
    const dutyDate = typeof parsed.dutyDate === 'string' ? parsed.dutyDate.trim() : '';
    const reportType = parsed.reportType === 'scan' ? 'scan' : 'izin_resmi';
    const scanIn = typeof parsed.scanIn === 'string' ? parsed.scanIn.trim() : '08:00';
    const scanOut = typeof parsed.scanOut === 'string' ? parsed.scanOut.trim() : '14:00';
    const absenceType = typeof parsed.absenceType === 'string' ? parsed.absenceType.trim() : 'sakit';
    const reason = typeof parsed.reason === 'string' ? parsed.reason.slice(0, 5000) : '';

    const draft: SatpamLeaveDraft = {
      version: LEAVE_DRAFT_STORAGE_VERSION,
      savedAt: typeof parsed.savedAt === 'string' ? parsed.savedAt : '',
      period,
      dutyDate,
      reportType,
      scanIn,
      scanOut,
      absenceType,
      reason,
    };

    if (isSatpamLeaveDraftEmpty(draft)) return null;
    return draft;
  } catch {
    return null;
  }
}

export function savePekaryaLeaveDraft(
  employeeId: string,
  payload: PekaryaLeaveDraftPayload,
): void {
  if (typeof window === 'undefined' || !employeeId) return;
  const key = pekaryaLeaveDraftStorageKey(employeeId);
  if (!key) return;
  try {
    if (isPekaryaLeaveDraftEmpty(payload)) {
      window.localStorage.removeItem(key);
    } else {
      window.localStorage.setItem(key, serializePekaryaLeaveDraft(payload));
    }
  } catch (err) {
    console.error('Failed to save pekarya leave draft to localStorage:', err);
  }
}

export function readPekaryaLeaveDraft(employeeId: string): PekaryaLeaveDraft | null {
  if (typeof window === 'undefined' || !employeeId) return null;
  const key = pekaryaLeaveDraftStorageKey(employeeId);
  if (!key) return null;
  try {
    return parsePekaryaLeaveDraft(window.localStorage.getItem(key));
  } catch (err) {
    console.error('Failed to read pekarya leave draft from localStorage:', err);
    return null;
  }
}

export function clearPekaryaLeaveDraft(employeeId: string): void {
  if (typeof window === 'undefined' || !employeeId) return;
  const key = pekaryaLeaveDraftStorageKey(employeeId);
  if (!key) return;
  try {
    window.localStorage.removeItem(key);
  } catch (err) {
    console.error('Failed to clear pekarya leave draft from localStorage:', err);
  }
}

export function saveSatpamLeaveDraft(
  employeeId: string,
  payload: SatpamLeaveDraftPayload,
): void {
  if (typeof window === 'undefined' || !employeeId) return;
  const key = satpamLeaveDraftStorageKey(employeeId);
  if (!key) return;
  try {
    if (isSatpamLeaveDraftEmpty(payload)) {
      window.localStorage.removeItem(key);
    } else {
      window.localStorage.setItem(key, serializeSatpamLeaveDraft(payload));
    }
  } catch (err) {
    console.error('Failed to save satpam leave draft to localStorage:', err);
  }
}

export function readSatpamLeaveDraft(employeeId: string): SatpamLeaveDraft | null {
  if (typeof window === 'undefined' || !employeeId) return null;
  const key = satpamLeaveDraftStorageKey(employeeId);
  if (!key) return null;
  try {
    return parseSatpamLeaveDraft(window.localStorage.getItem(key));
  } catch (err) {
    console.error('Failed to read satpam leave draft from localStorage:', err);
    return null;
  }
}

export function clearSatpamLeaveDraft(employeeId: string): void {
  if (typeof window === 'undefined' || !employeeId) return;
  const key = satpamLeaveDraftStorageKey(employeeId);
  if (!key) return;
  try {
    window.localStorage.removeItem(key);
  } catch (err) {
    console.error('Failed to clear satpam leave draft from localStorage:', err);
  }
}
