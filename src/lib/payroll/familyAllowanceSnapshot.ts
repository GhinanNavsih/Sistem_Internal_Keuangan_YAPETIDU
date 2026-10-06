import {
  eligibleFamilyMetrics,
  familyAllowancePercentage,
  familyAllowancePeriodDate,
  type EligibleFamilyMetrics,
  type FamilyAllowanceMetrics,
} from './familyAllowance';
import type { MoneyField } from './domain';

export interface FamilyAllowanceSnapshot {
  schemaVersion: 1;
  asOf: string;
  metrics: EligibleFamilyMetrics;
}

export interface FamilyAllowanceExplanation {
  /** Null when the historical breakdown cannot be established. */
  metrics: EligibleFamilyMetrics | null;
  /** Always describes the saved amount, including legacy slips without counts. */
  percentage: number;
}

export function createFamilyAllowanceSnapshot(
  metrics: FamilyAllowanceMetrics | null | undefined,
  period: string,
): FamilyAllowanceSnapshot {
  const asOf = familyAllowancePeriodDate(period);
  return { schemaVersion: 1, asOf, metrics: eligibleFamilyMetrics(metrics, asOf) };
}

export function readFamilyAllowanceSnapshot(raw: unknown, period: string): EligibleFamilyMetrics | null {
  if (!raw || typeof raw !== 'object') return null;
  const snapshot = raw as Partial<FamilyAllowanceSnapshot>;
  if (snapshot.schemaVersion !== 1 || snapshot.asOf !== familyAllowancePeriodDate(period) ||
    !snapshot.metrics || typeof snapshot.metrics !== 'object') return null;
  const metrics = snapshot.metrics;
  const fields = ['spouse_count', 'children_sd', 'children_sltp', 'children_slta',
    'children_s1', 'children_s2', 'children_pt'] as const;
  if (fields.some(field => !Number.isSafeInteger(metrics[field]) || metrics[field] < 0 || metrics[field] > 100) ||
    metrics.spouse_count > 1 || metrics.children_pt < metrics.children_s1 + metrics.children_s2) return null;
  return { ...metrics };
}

/** Never infer dependent categories from an amount: several combinations have the same rate. */
export function explainFamilyAllowance(
  earnings: readonly MoneyField[],
  metrics: FamilyAllowanceMetrics | null | undefined,
  period: string,
): FamilyAllowanceExplanation {
  const label = (value: string) => value.trim().toLowerCase();
  const gapok = earnings.find(field => ['gaji pokok', 'gapok'].includes(label(field.label)))?.amount;
  const amount = earnings.find(field => ['t. keluarga', 'tunjangan keluarga'].includes(label(field.label)))?.amount;
  const percentage = gapok && Number.isFinite(gapok) && Number.isFinite(amount)
    ? amount! / gapok : 0;
  const eligible = metrics ? eligibleFamilyMetrics(metrics, familyAllowancePeriodDate(period)) : null;
  const matches = eligible && gapok !== undefined && amount !== undefined &&
    Math.round(gapok * familyAllowancePercentage(eligible)) === amount;
  return { metrics: matches ? eligible : null, percentage };
}
