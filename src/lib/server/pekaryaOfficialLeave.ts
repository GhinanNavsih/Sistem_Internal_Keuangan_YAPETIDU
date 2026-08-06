import { createHash } from 'node:crypto';

export const PEKARYA_OFFICIAL_LEAVE_REQUESTS_COLLECTION =
  'PekaryaOfficialLeaveRequests';
export const PEKARYA_OFFICIAL_LEAVE_REVISIONS_COLLECTION =
  'PekaryaOfficialLeaveRequestRevisions';

export function officialLeaveRequestId(employeeId: string, date: string): string {
  return createHash('sha256')
    .update(`${employeeId}|${date}`)
    .digest('hex');
}
