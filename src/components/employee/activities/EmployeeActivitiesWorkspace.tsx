"use client";

import { Suspense } from 'react';
import type { EmployeeActivityWorkflow } from '@/lib/employeeActivities';
import { ActivitiesPageSkeleton } from '@/components/EmployeeActivitiesSkeleton';
import EmployeeActivitiesView from './EmployeeActivitiesView';
import { useEmployeeActivitiesModel } from './activityModel';

interface EmployeeActivitiesWorkspaceProps {
  workflow: EmployeeActivityWorkflow;
}

function ActivitiesContent({ workflow }: EmployeeActivitiesWorkspaceProps) {
  const model = useEmployeeActivitiesModel({ workflow });
  return <EmployeeActivitiesView model={model} />;
}

export default function EmployeeActivitiesWorkspace({
  workflow,
}: EmployeeActivitiesWorkspaceProps) {
  return (
    <Suspense fallback={<ActivitiesPageSkeleton />}>
      <ActivitiesContent workflow={workflow} />
    </Suspense>
  );
}
