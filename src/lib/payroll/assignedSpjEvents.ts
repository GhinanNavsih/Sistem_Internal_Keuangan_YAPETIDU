import { authenticatedJson } from './client';

export interface AssignedSpjEvent {
  id: string;
  eventName: string;
  period: string;
  jobCategory: string;
  payGiven: number;
  sourceKind: string;
  sourceVakasiEventId: string | null;
  approvedAt: string | null;
}

export async function fetchAssignedSpjEvents(
  period: string,
): Promise<AssignedSpjEvent[]> {
  const response = await authenticatedJson<{ events?: AssignedSpjEvent[] }>(
    `/api/pekarya/spj-events?period=${encodeURIComponent(period)}&mine=true`,
    { method: 'GET' },
  );
  return response.events || [];
}
