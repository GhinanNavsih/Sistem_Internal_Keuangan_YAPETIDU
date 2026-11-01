"use client";

import { useQuery } from '@tanstack/react-query';
import { useAuth } from '@/lib/AuthContext';
import { authenticatedJson } from '@/lib/payroll/client';

export const LOYALIS_TASKS_SUMMARY_QUERY_KEY = ['loyalisTasks', 'summary'] as const;

export interface LoyalisTasksSummary {
  /** Whether the Daftar Tugas page exists for this Loyalis (any task, done or not). */
  hasTasks: boolean;
  openCount: number;
}

const NO_TASKS: LoyalisTasksSummary = { hasTasks: false, openCount: 0 };

/**
 * What the Loyalis menu needs to decide whether to show Daftar Tugas. Only a
 * `loyalis` account asks; an error (not linked, previewing) counts as no tasks.
 */
export function useLoyalisTasksSummary(): LoyalisTasksSummary {
  const { profile, activeProfile } = useAuth();
  const currentProfile = activeProfile || profile;
  const enabled = currentProfile?.role === 'loyalis';

  const query = useQuery({
    queryKey: LOYALIS_TASKS_SUMMARY_QUERY_KEY,
    queryFn: async (): Promise<LoyalisTasksSummary> => {
      try {
        const res = await authenticatedJson<Partial<LoyalisTasksSummary>>(
          '/api/employee/tasks?countOnly=true',
        );
        return { hasTasks: res.hasTasks === true, openCount: Number(res.openCount) || 0 };
      } catch {
        return NO_TASKS;
      }
    },
    enabled,
    staleTime: 30 * 1000,
    refetchInterval: 60 * 1000,
  });

  return enabled ? (query.data ?? NO_TASKS) : NO_TASKS;
}
