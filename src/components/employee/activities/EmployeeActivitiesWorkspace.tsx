"use client";

import { Suspense } from 'react';
import { Loader2 } from 'lucide-react';
import type { EmployeeActivityWorkflow } from '@/lib/employeeActivities';
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
    <Suspense
      fallback={
        <div className="min-h-screen flex items-center justify-center bg-slate-50">
          <Loader2 className="w-8 h-8 animate-spin text-indigo-600" />
        </div>
      }
    >
      <ActivitiesContent workflow={workflow} />
    </Suspense>
  );
}
