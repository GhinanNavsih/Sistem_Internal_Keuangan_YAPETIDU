import { adminDb } from '@/lib/firebase-admin';
import type { LoyalisPresenceDocument } from '@/lib/payroll/uraianPropagation';
import { applyApprovedLoyalisDayCreditsToPresence } from './annualPaidLeave';

export type EffectiveLoyalisPresence = LoyalisPresenceDocument & Record<string, unknown>;

/**
 * A month's saved Loyalis presence with every approved cuti and ganti libur
 * applied, so the strata match what the slip's Bonus Presensi pays. Null when
 * the month has no saved presence.
 *
 * LoyalisPresence was historically stored with the payroll document key
 * (YYYY_MM); the canonical YYYY-MM id is read first and the old one after.
 */
export async function loadEffectiveLoyalisPresence(
  period: string,
): Promise<EffectiveLoyalisPresence | null> {
  const [canonical, legacy] = await Promise.all([
    adminDb.collection('LoyalisPresence').doc(period).get(),
    adminDb.collection('LoyalisPresence').doc(period.replace('-', '_')).get(),
  ]);
  const data = canonical.exists ? canonical.data() : legacy.data();
  return applyApprovedLoyalisDayCreditsToPresence(
    period,
    (data || null) as EffectiveLoyalisPresence | null,
  );
}
