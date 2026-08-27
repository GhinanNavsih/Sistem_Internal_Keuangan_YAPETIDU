"use client";

import {
  Plus,
} from 'lucide-react';
import type { EmployeeActivitiesModel } from './activityModel';

interface EmployeeActivityFabProps {
  model: EmployeeActivitiesModel;
}

export default function EmployeeActivityFab({ model }: EmployeeActivityFabProps) {
  const {
    userJobCategory,
    isSopir,
    setShowForm,
    setShowSatpamSpjChoice,
    resetForm,
  } = model;

  return (
    <>
{!isSopir && (
        <button
          onClick={() => {
            if (userJobCategory === 'SATPAM') {
              setShowSatpamSpjChoice(true);
            } else {
              resetForm();
              setShowForm(true);
            }
          }}
          className="fixed bottom-6 right-6 z-40 min-w-14 h-14 px-4 rounded-2xl bg-gradient-to-br from-teal-500 to-cyan-600 text-white shadow-xl shadow-teal-300/40 hover:shadow-2xl hover:shadow-teal-300/50 hover:scale-105 active:scale-95 transition-all duration-200 flex items-center justify-center gap-2"
        >
          <Plus className="w-6 h-6" />
          <span className="font-bold">
            {userJobCategory === 'SATPAM' ? 'Lapor SPJ Pribadi' : 'Tambah Kegiatan'}
          </span>
        </button>
      )}
    </>
  );
}
