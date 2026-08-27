"use client";

import type { EmployeeActivitiesModel } from './activityModel';
import ActivityHistoryPanel from './ActivityHistoryPanel';
import EmployeeActivityFab from './EmployeeActivityFab';
import ActivityFormDialog from './ActivityFormDialog';

interface PekaryaActivitiesViewProps {
  model: EmployeeActivitiesModel;
}

export default function PekaryaActivitiesView({ model }: PekaryaActivitiesViewProps) {
  return (
    <>
<ActivityHistoryPanel model={model} />
<EmployeeActivityFab model={model} />
<ActivityFormDialog model={model} />
</>
  );
}
