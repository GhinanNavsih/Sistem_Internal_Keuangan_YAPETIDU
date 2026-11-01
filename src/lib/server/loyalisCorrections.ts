import { adminDb } from '@/lib/firebase-admin';
import { periodCalendarFromData } from '@/lib/payroll/calendar';
import { loyalisLogDateToIso } from '@/lib/payroll/loyalisAutoLeave';
import {
  applyApprovedCorrectionsToLoyalisEntry,
  isApplicableApprovedCorrection,
  loyalisCorrectionOverlayApplies,
  type ApprovedLoyalisCorrection,
} from '@/lib/payroll/loyalisCorrectionOverlay';
import type { LoyalisPaidLeaveEntry } from '@/lib/payroll/loyalisPaidLeave';
import { timestampToMillis } from '@/lib/payroll/presenceCorrections';
import {
  annualCalendarRef,
  annualDatesFrom,
  isPeriodClosed,
} from './payrollPeriod';

/**
 * Every approved izin resmi / scan correction of the period, oldest decision
 * first so the latest one for a day wins. `date` is the field the whole app
 * treats as authoritative for the month a request belongs to.
 */
async function loadApprovedLoyalisCorrections(
  period: string,
): Promise<ApprovedLoyalisCorrection[]> {
  const snapshot = await adminDb
    .collection('LoyalisPresenceCorrections')
    .where('status', '==', 'approved')
    .get();
  return snapshot.docs
    .map((doc) => ({
      correction: { id: doc.id, ...doc.data() } as ApprovedLoyalisCorrection,
      decidedAt: timestampToMillis(doc.data().updatedAt),
    }))
    .filter(
      ({ correction }) =>
        String(correction.date || '').startsWith(`${period}-`) &&
        isApplicableApprovedCorrection(correction),
    )
    .sort((left, right) => left.decidedAt - right.decidedAt)
    .map(({ correction }) => correction);
}

/**
 * A saved Loyalis presence document with every approved izin resmi and scan
 * correction of an open month applied on top. The approval edits the saved
 * rows once, and a later scanner import or page save replaces them, so the
 * approved request is the durable record and this puts its effect back.
 *
 * Months before the overlay's start period, and closed months, are returned
 * as saved.
 */
export async function applyApprovedLoyalisCorrectionsToPresence<
  T extends Record<string, unknown>,
>(period: string, presence: T | null): Promise<T | null> {
  if (!presence || !loyalisCorrectionOverlayApplies(period)) return presence;
  const [periodSnapshot, annualCalendar, corrections] = await Promise.all([
    adminDb.collection('PayrollPeriods').doc(period).get(),
    annualCalendarRef(period).get(),
    loadApprovedLoyalisCorrections(period),
  ]);
  if (isPeriodClosed(periodSnapshot.data())) return presence;
  if (corrections.length === 0) return presence;

  const offDays = new Set(
    periodCalendarFromData(period, periodSnapshot.data(), annualDatesFrom(annualCalendar))
      .premiumDates,
  );
  const workingDays = Number(presence.workingDays) > 0 ? Number(presence.workingDays) : 25;
  const expectedHours = Number(presence.expectedHours) > 0 ? Number(presence.expectedHours) : 6.5;
  const mode = presence.mode === 'absent' ? 'absent' : 'worked';
  const entries = presence.entries && typeof presence.entries === 'object'
    ? { ...(presence.entries as Record<string, LoyalisPaidLeaveEntry>) }
    : {};

  const byEmployee = new Map<string, ApprovedLoyalisCorrection[]>();
  for (const correction of corrections) {
    const list = byEmployee.get(correction.employeeId) || [];
    list.push(correction);
    byEmployee.set(correction.employeeId, list);
  }

  for (const [employeeId, employeeCorrections] of byEmployee) {
    const entry = entries[employeeId] || {
      employeeId,
      minutes: 0,
      absenceMinutes: workingDays * expectedHours * 60,
      stratum: 5,
      deduction: 250_000,
      netBonus: 0,
      activeDaysCount: 0,
      incompleteDaysCount: 0,
      absentDaysCount: 0,
      dailyLogs: [],
    };
    entries[employeeId] = applyApprovedCorrectionsToLoyalisEntry({
      entry,
      corrections: employeeCorrections,
      expectedHours,
      workingDays,
      mode,
      isOffDay: (tanggal) => offDays.has(loyalisLogDateToIso(tanggal)),
    });
  }
  return { ...presence, entries };
}
