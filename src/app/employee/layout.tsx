"use client";

import { usePathname } from 'next/navigation';
import ProtectedRoute from '@/components/ProtectedRoute';
import { PayslipPageSkeleton } from '@/components/PayslipSkeleton';
import { ActivitiesPageSkeleton } from '@/components/EmployeeActivitiesSkeleton';
import { EMPLOYEE_ACTIVITY_PATHS } from '@/lib/employeeActivities';

const ACTIVITY_LANDING_PATHS: readonly string[] = Object.values(EMPLOYEE_ACTIVITY_PATHS);

export default function EmployeeLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();

  let fallback: React.ReactNode;
  if (pathname === '/employee/payslip') {
    fallback = <PayslipPageSkeleton />;
  } else if (ACTIVITY_LANDING_PATHS.includes(pathname)) {
    fallback = <ActivitiesPageSkeleton />;
  }

  return <ProtectedRoute fallback={fallback}>{children}</ProtectedRoute>;
}
