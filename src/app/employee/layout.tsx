"use client";

import { usePathname } from 'next/navigation';
import ProtectedRoute from '@/components/ProtectedRoute';
import { PayslipPageSkeleton } from '@/components/PayslipSkeleton';
import { ActivitiesWorkflowSkeleton } from '@/components/EmployeeActivitiesSkeleton';
import { SimpanPinjamPageSkeleton } from '@/components/SimpanPinjamSkeleton';
import { LeavePageSkeleton } from '@/components/LeaveSkeleton';
import { FacilityReportsPageSkeleton } from '@/components/FacilityReportsSkeleton';
import { EMPLOYEE_ACTIVITY_PATHS, type EmployeeActivityWorkflow } from '@/lib/employeeActivities';

// Exact landing-page paths only (not e.g. the sopir journey-report sub-page,
// which has its own distinct layout the workspace skeletons don't model).
const ACTIVITY_WORKFLOW_BY_PATH: Record<string, EmployeeActivityWorkflow> = Object.fromEntries(
  Object.entries(EMPLOYEE_ACTIVITY_PATHS).map(([workflow, path]) => [path, workflow as EmployeeActivityWorkflow]),
);

export default function EmployeeLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();

  let fallback: React.ReactNode;
  if (pathname === '/employee/payslip') {
    fallback = <PayslipPageSkeleton />;
  } else if (ACTIVITY_WORKFLOW_BY_PATH[pathname]) {
    fallback = <ActivitiesWorkflowSkeleton workflow={ACTIVITY_WORKFLOW_BY_PATH[pathname]} />;
  } else if (pathname === '/employee/simpan-pinjam') {
    fallback = <SimpanPinjamPageSkeleton />;
  } else if (pathname === '/employee/facility-reports') {
    fallback = <FacilityReportsPageSkeleton />;
  } else if (pathname === '/employee/leave') {
    // Role (Satpam vs Pekarya) isn't known yet at this pre-profile phase —
    // see LeaveCardSkeleton's "unknown" variant.
    fallback = <LeavePageSkeleton variant="unknown" />;
  }

  return <ProtectedRoute fallback={fallback}>{children}</ProtectedRoute>;
}
