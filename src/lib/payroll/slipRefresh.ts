import type { MoneyField } from './domain';
import { normalizeLabel } from './slipPropagation';

export interface SlipRefreshFields {
  earnings: MoneyField[];
  deductions: MoneyField[];
}

export interface SlipRefreshDiff {
  type: keyof SlipRefreshFields;
  label: string;
  oldValue: number | null;
  newValue: number | null;
}

export interface SlipRefreshPreview extends SlipRefreshFields {
  /** null means the comparison was prepared before a saved slip existed. */
  expectedRevision?: number | null;
}

export const refreshFieldKey = (diff: Pick<SlipRefreshDiff, 'type' | 'label'>): string =>
  `${diff.type}::${normalizeLabel(diff.label)}`;

function grouped(fields: readonly MoneyField[]): Map<string, MoneyField> {
  const result = new Map<string, MoneyField>();
  for (const field of fields) {
    const key = normalizeLabel(field.label);
    const previous = result.get(key);
    result.set(key, { label: previous?.label || field.label, amount: (previous?.amount || 0) + field.amount });
  }
  return result;
}

/** A base row and multiple events can share a label; compare their total once. */
export function diffSlipRefresh(current: SlipRefreshFields, fresh: SlipRefreshFields): SlipRefreshDiff[] {
  const result: SlipRefreshDiff[] = [];
  for (const type of ['earnings', 'deductions'] as const) {
    const previous = grouped(current[type]);
    const next = grouped(fresh[type]);
    for (const key of new Set([...previous.keys(), ...next.keys()])) {
      const before = previous.get(key);
      const after = next.get(key);
      const oldValue = before?.amount ?? null;
      const newValue = after?.amount ?? null;
      if (oldValue !== newValue) result.push({ type, label: after?.label || before!.label, oldValue, newValue });
    }
  }
  return result;
}

/** Replace every occurrence of a selected label; retain all unchecked rows. */
export function applySlipRefresh(current: SlipRefreshFields, diffs: readonly SlipRefreshDiff[], selected?: ReadonlySet<string>): SlipRefreshFields {
  const result: SlipRefreshFields = { earnings: [], deductions: [] };
  for (const type of ['earnings', 'deductions'] as const) {
    const changes = new Map(diffs.filter(diff => diff.type === type && (!selected || selected.has(refreshFieldKey(diff))))
      .map(diff => [normalizeLabel(diff.label), diff]));
    for (const field of current[type]) {
      const key = normalizeLabel(field.label);
      if (!changes.has(key)) { result[type].push({ ...field }); continue; }
      const diff = changes.get(key)!;
      if (diff.newValue !== null) result[type].push({ label: diff.label, amount: diff.newValue });
      // Further occurrences of the same changed label are removed.
      changes.set(key, { ...diff, newValue: null });
    }
    for (const diff of changes.values()) {
      if (diff.newValue !== null) result[type].push({ label: diff.label, amount: diff.newValue });
    }
  }
  return result;
}
