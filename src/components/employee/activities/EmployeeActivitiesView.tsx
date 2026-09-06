"use client";

import {
  FloatingSnackbar,
} from '@/components/ui/floating-snackbar';
import {
  Card,
  CardContent,
} from '@/components/ui/card';
import {
  Button,
} from '@/components/ui/button';
import {
  LogOut,
  AlertCircle,
  ClipboardList,
} from 'lucide-react';
import EmployeeNavigationMenu from '@/components/EmployeeNavigationMenu';
import { ActivitiesWorkflowSkeleton } from '@/components/EmployeeActivitiesSkeleton';
import type { EmployeeActivitiesModel } from './activityModel';
import ActivityPeriodSelector from './ActivityPeriodSelector';
import PekaryaActivitiesView from './PekaryaActivitiesView';
import SatpamActivitiesView from './SatpamActivitiesView';
import SopirActivitiesView from './SopirActivitiesView';
import AssignedSpjHistoryPanel from './AssignedSpjHistoryPanel';

interface EmployeeActivitiesViewProps {
  model: EmployeeActivitiesModel;
}

export default function EmployeeActivitiesView({ model }: EmployeeActivitiesViewProps) {
  const { workflow, logout, profile, message, setMessage } = model;

  if (!profile) {
      return <ActivitiesWorkflowSkeleton workflow={workflow} />;
    }
  
  if (!profile.linkedEmployeeId) {
      return (
        <div className="min-h-screen bg-gradient-to-br from-slate-50 via-indigo-50/80 to-slate-100 flex items-center justify-center p-6 relative overflow-hidden">
          {/* Subtle decorative blobs */}
          <div className="absolute top-0 right-0 w-[600px] h-[600px] rounded-full bg-indigo-100/40 blur-[120px] pointer-events-none" />
          <div className="absolute bottom-0 left-0 w-[500px] h-[500px] rounded-full bg-purple-100/30 blur-[100px] pointer-events-none" />
          <Card className="max-w-md w-full rounded-3xl border-none shadow-xl bg-white relative z-10">
            <CardContent className="p-8 text-center space-y-4">
              <div className="w-16 h-16 mx-auto rounded-2xl bg-rose-50 flex items-center justify-center">
                <AlertCircle className="w-8 h-8 text-rose-500" />
              </div>
              <h2 className="text-xl font-bold text-slate-900">Akun Belum Terhubung</h2>
              <p className="text-sm text-slate-500 leading-relaxed">
                Akun Anda belum dihubungkan dengan data pegawai di sistem. Silakan hubungi administrator BAK untuk konfigurasi akun.
              </p>
              <Button
                onClick={() => logout()}
                variant="outline"
                className="rounded-xl mt-4"
              >
                <LogOut className="w-4 h-4 mr-2" />
                Keluar
              </Button>
            </CardContent>
          </Card>
        </div>
      );
    }

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 via-indigo-50/80 to-slate-100 font-sans selection:bg-indigo-100 relative overflow-hidden text-slate-800">
      <FloatingSnackbar message={message} onDismiss={() => setMessage(null)} />
      <div className="absolute top-0 right-0 w-[600px] h-[600px] rounded-full bg-indigo-100/40 blur-[120px] pointer-events-none" />
      <div className="absolute bottom-0 left-0 w-[500px] h-[500px] rounded-full bg-purple-100/30 blur-[100px] pointer-events-none" />

      <div className="sticky top-0 z-30 bg-white/80 backdrop-blur-xl border-b border-slate-100 shadow-sm relative z-20">
              <div className="max-w-2xl mx-auto px-4 py-3.5 flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-teal-500 to-cyan-600 flex items-center justify-center shadow-lg shadow-teal-200/50">
                    <ClipboardList className="w-4.5 h-4.5 text-white" />
                  </div>
                  <div>
                    <h1 className="text-sm font-bold text-slate-900 leading-tight">Laporan Kegiatan</h1>
                    <p className="text-[11px] text-slate-400 font-medium">{profile.displayName || 'Karyawan'}</p>
                  </div>
                </div>
                <div className="flex items-center gap-1.5 sm:gap-2">
                  <EmployeeNavigationMenu />
      
                  <Button
                    onClick={() => logout()}
                    variant="ghost"
                    size="icon"
                    className="text-slate-400 hover:text-rose-500 rounded-xl h-9 w-9 border border-slate-150/40 bg-white shadow-sm flex items-center justify-center cursor-pointer"
                    title="Keluar"
                  >
                    <LogOut className="w-4.5 h-4.5" />
                  </Button>
                </div>
              </div>
            </div>

      <div className="max-w-2xl mx-auto px-4 py-5 space-y-5 relative z-10">
        <ActivityPeriodSelector model={model} />
        {workflow === 'satpam' && <SatpamActivitiesView model={model} />}
        {workflow === 'sopir' && <SopirActivitiesView model={model} />}
        {workflow === 'pekarya' && <PekaryaActivitiesView model={model} />}
        {workflow !== 'sopir' && (
          <AssignedSpjHistoryPanel
            assignedSpjEvents={model.assignedSpjEvents}
            loadingAssignedSpjEvents={model.loadingAssignedSpjEvents}
          />
        )}
        <div className="h-20" />
      </div>
    </div>
  );
}
