import { dependentHistory, type DependentEnrollment, type FamilyAllowanceMetrics } from './familyAllowance';

export interface FamilyAllowanceHistoryEvent {
  occurredAt: number;
  changes?: { field: string; oldValue: unknown }[];
  beforeMetrics?: FamilyAllowanceMetrics;
}

/** Older EmpEditLog rows stored a readable stage summary rather than its JSON. */
function oldEnrollment(id: string, value: unknown): DependentEnrollment | null {
  if (value && typeof value === 'object') {
    const stage = value as DependentEnrollment;
    return stage.id === id && ['SD', 'SLTP', 'SLTA', 'S1', 'S2', 'PT'].includes(stage.level)
      ? { ...stage } : null;
  }
  if (typeof value !== 'string') return null;
  const level = /; (SD|SLTP|SLTA|S1|S2|PT);/.exec(value)?.[1] as DependentEnrollment['level'] | undefined;
  const date = /; (masuk|lahir) (\d{4}-\d{2}-\d{2}|belum dicatat)(?:;|$)/.exec(value);
  const childId = /; ID anak ([^;]+)$/.exec(value)?.[1];
  if (!level || !date || !childId) return null;
  const start = date[2] === 'belum dicatat' ? '' : date[2];
  const ended = /; dihentikan (\d{4}-\d{2}-\d{2})/.exec(value)?.[1];
  return {
    id, child_id: childId, level, enrolled_at: start,
    ...(date[1] === 'lahir' ? { birth_date: start } : {}),
    ...(ended ? { ended_at: ended } : {}),
    ...(value.includes('; tidak lanjut sekolah') ? { no_further_study: true } : {}),
  };
}

/** Undo later profile edits, retaining the school stages applicable at locking. */
export function familyMetricsBeforeEdits(
  current: FamilyAllowanceMetrics,
  events: readonly FamilyAllowanceHistoryEvent[],
  finalizedAt: number,
): FamilyAllowanceMetrics | null {
  let metrics = structuredClone(current);
  for (const event of [...events].filter(event => event.occurredAt > finalizedAt)
    .sort((a, b) => b.occurredAt - a.occurredAt)) {
    if (event.beforeMetrics) {
      metrics = structuredClone(event.beforeMetrics);
      continue;
    }
    for (const change of [...(event.changes || [])].reverse()) {
      if (!change.field.startsWith('family_allowance_metrics.')) continue;
      const field = change.field.slice('family_allowance_metrics.'.length);
      if (field.startsWith('dependents.')) {
        const id = field.slice('dependents.'.length);
        const history = dependentHistory(metrics);
        const index = history.findIndex(stage => stage.id === id);
        if (change.oldValue === null) {
          if (index >= 0) history.splice(index, 1);
        } else {
          const previous = oldEnrollment(id, change.oldValue);
          if (!previous) return null;
          if (index >= 0) history[index] = previous;
          else history.push(previous);
        }
        metrics.dependents = history;
      } else if (field === 'dependents') {
        if (change.oldValue === null) delete metrics.dependents;
        else if (Array.isArray(change.oldValue)) metrics.dependents = structuredClone(change.oldValue);
        else return null;
      } else if (['spouse_count', 'children_sd', 'children_sltp', 'children_slta',
        'children_s1', 'children_s2', 'children_pt'].includes(field)) {
        if (change.oldValue === null) delete metrics[field];
        else if (typeof change.oldValue === 'number') metrics[field] = change.oldValue;
        else return null;
      } else return null;
    }
  }
  return metrics;
}
