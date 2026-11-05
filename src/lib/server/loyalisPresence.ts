import type { LoyalisPresenceDocument } from '@/lib/payroll/loyalisPresencePay';
import { applyApprovedLoyalisDayCreditsToPresence } from './annualPaidLeave';
import { loyalisPresenceRefs } from './gantiLibur';
import { reconcileLoyalisAutoLeave } from './loyalisAutoLeave';
import { HttpError, type AuthenticatedProfile } from './auth';

export type EffectiveLoyalisPresence = LoyalisPresenceDocument & Record<string, unknown>;

/**
 * A month's saved Loyalis presence with every approved cuti and ganti libur
 * applied, so the strata match what the slip's Bonus Presensi pays. Null when
 * the month has no saved presence.
 *
 * LoyalisPresence was historically stored with the payroll document key
 * (YYYY_MM). Read it first, just like the editor and automatic-leave planner,
 * then fall back to YYYY-MM for canonical-only records.
 */
export async function loadEffectiveLoyalisPresence(
  period: string,
): Promise<EffectiveLoyalisPresence | null> {
  const snapshots = await Promise.all(loyalisPresenceRefs(period).map((reference) => reference.get()));
  const data = snapshots.find((snapshot) => snapshot.exists)?.data();
  return applyApprovedLoyalisDayCreditsToPresence(
    period,
    (data || null) as EffectiveLoyalisPresence | null,
  );
}

/** Refresh commands apply the allowance rule before calculating any pay. */
export async function reconcileAndLoadLoyalisPresence(
  period: string,
  actor: AuthenticatedProfile,
): Promise<EffectiveLoyalisPresence | null> {
  if (!await loadEffectiveLoyalisPresence(period)) return null;
  const summary = await reconcileLoyalisAutoLeave(period, actor);
  if (summary.results.some((result) => result.failed)) {
    throw new HttpError(409, 'Cuti otomatis belum selesai diproses. Ulangi sinkronisasi sebelum memperbarui slip.');
  }
  return loadEffectiveLoyalisPresence(period);
}
