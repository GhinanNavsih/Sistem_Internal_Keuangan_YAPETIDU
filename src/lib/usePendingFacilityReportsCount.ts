"use client";

import { useQuery } from '@tanstack/react-query';
import { useAuth } from '@/lib/AuthContext';
import { canViewFacilityNotifications } from '@/lib/facilityReports';
import { authenticatedJson } from '@/lib/payroll/client';

export const FACILITY_PENDING_COUNT_QUERY_KEY = ['facilityReports', 'pendingCount'] as const;

export function usePendingFacilityReportsCount(): number {
  const { profile, activeProfile } = useAuth();
  const currentProfile = activeProfile || profile;

  const enabled = canViewFacilityNotifications(currentProfile);

  const query = useQuery({
    queryKey: FACILITY_PENDING_COUNT_QUERY_KEY,
    queryFn: async () => {
      const res = await authenticatedJson<{ openCount?: number }>(
        '/api/facility-reports?countOnly=true',
      );
      return Number(res.openCount) || 0;
    },
    enabled,
    staleTime: 30 * 1000,
    refetchInterval: 60 * 1000,
  });

  return enabled ? (query.data ?? 0) : 0;
}
