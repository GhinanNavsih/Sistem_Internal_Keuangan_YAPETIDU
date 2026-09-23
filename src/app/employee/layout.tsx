"use client";

import { usePathname } from 'next/navigation';
import ProtectedRoute from '@/components/ProtectedRoute';
import { PayslipPageSkeleton } from '@/components/PayslipSkeleton';
import { ActivitiesWorkflowSkeleton } from '@/components/EmployeeActivitiesSkeleton';
import { SimpanPinjamPageSkeleton } from '@/components/SimpanPinjamSkeleton';
import { LeavePageSkeleton } from '@/components/LeaveSkeleton';
import { FacilityReportsPageSkeleton } from '@/components/FacilityReportsSkeleton';
import { DriverHistoryPageSkeleton } from '@/components/DriverHistorySkeleton';
import { SatpamDutyPlanPageSkeleton } from '@/components/SatpamDutyPlanSkeleton';
import { JourneyReportPageSkeleton } from '@/components/JourneyReportSkeleton';
import {
  EMPLOYEE_ACTIVITY_PATHS,
  SOPIR_JOURNEY_REPORT_PATH,
  type EmployeeActivityWorkflow,
} from '@/lib/employeeActivities';

// Exact landing-page paths only — the sopir journey-report sub-page has its
// own distinct layout/skeleton and is handled as its own branch below.
const ACTIVITY_WORKFLOW_BY_PATH: Record<string, EmployeeActivityWorkflow> = Object.fromEntries(
  Object.entries(EMPLOYEE_ACTIVITY_PATHS).map(([workflow, path]) => [path, workflow as EmployeeActivityWorkflow]),
);

export default function EmployeeLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();

  let fallback: React.ReactNode;
  if (pathname === '/employee/payslip') {
    fallback = <PayslipPageSkeleton />;
  } else if (pathname === SOPIR_JOURNEY_REPORT_PATH) {
    fallback = <JourneyReportPageSkeleton />;
  } else if (ACTIVITY_WORKFLOW_BY_PATH[pathname]) {
    fallback = <ActivitiesWorkflowSkeleton workflow={ACTIVITY_WORKFLOW_BY_PATH[pathname]} />;
  } else if (pathname === '/employee/simpan-pinjam') {
    fallback = <SimpanPinjamPageSkeleton />;
  } else if (pathname === '/employee/facility-reports') {
    fallback = <FacilityReportsPageSkeleton />;
  } else if (pathname === '/employee/driver-history') {
    fallback = <DriverHistoryPageSkeleton />;
  } else if (pathname === '/employee/satpam-duty-plan') {
    fallback = <SatpamDutyPlanPageSkeleton />;
  } else if (pathname === '/employee/leave') {
    // Role (Satpam vs Pekarya) isn't known yet at this pre-profile phase —
    // see LeaveCardSkeleton's "unknown" variant.
    fallback = <LeavePageSkeleton variant="unknown" />;
  }

  return <ProtectedRoute fallback={fallback}>{children}</ProtectedRoute>;
}
