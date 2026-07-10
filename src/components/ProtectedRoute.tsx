"use client";

import { useEffect, useState } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import { useAuth } from '@/lib/AuthContext';
import { Loader2 } from 'lucide-react';

export default function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const { user, profile, loading } = useAuth();
  const router = useRouter();
  const pathname = usePathname();

  const [progress, setProgress] = useState(0);

  useEffect(() => {
    if (loading) {
      setProgress(0);
      const timer = setInterval(() => {
        setProgress((prev) => {
          if (prev >= 90) return prev;
          const diff = Math.random() * 15 + 5;
          return Math.min(prev + diff, 90);
        });
      }, 100);
      return () => clearInterval(timer);
    } else {
      setProgress(100);
    }
  }, [loading]);

  useEffect(() => {
    if (!loading) {
      if (!user) {
        router.replace('/login');
      } else if (profile) {
        // Enforce role-based route access
        if (profile.role === 'satker_head') {
          // SatKer Heads are allowed to access /dashboard/payroll/uraian (including sub-routes) and /dashboard/payroll/activity-review
          if (pathname !== '/dashboard/payroll/activity-review' && !pathname.startsWith('/dashboard/payroll/uraian')) {
            router.replace('/dashboard/payroll/activity-review');
          }
        } else if (profile.role === 'satker_head_loyalis') {
          // SatKer Loyalis is ONLY allowed to access /dashboard/payroll/uraian (including sub-routes)
          if (!pathname.startsWith('/dashboard/payroll/uraian')) {
            router.replace('/dashboard/payroll/uraian');
          }
        } else if (profile.role === 'employee_admin') {
          // Employee Admins are ONLY allowed to access /dashboard/employees
          if (pathname !== '/dashboard/employees') {
            router.replace('/dashboard/employees');
          }
        } else if (profile.role === 'honorer') {
          // Honorer employees are ONLY allowed to access /employee/activities
          if (!pathname.startsWith('/employee/')) {
            router.replace('/employee/activities');
          }
        } else if (profile.role === 'loyalis') {
          // Loyalis employees can access payslip and presensi-correction
          if (pathname !== '/employee/payslip' && pathname !== '/employee/presensi-correction') {
            router.replace('/employee/payslip');
          }
        } else if (profile.role === 'loyalis_presence_admin') {
          // PJ Presensi Loyalis can access raw presence and presence-corrections
          if (pathname !== '/dashboard/payroll/uraian/presensi-loyalis-raw' && pathname !== '/dashboard/payroll/presence-corrections') {
            router.replace('/dashboard/payroll/uraian/presensi-loyalis-raw');
          }
        }
      }
    }
  }, [user, profile, loading, router, pathname]);

  if (loading) {
    return (
      <div className="min-h-screen bg-[#F8FAFC] flex items-center justify-center">
        <div className="flex flex-col items-center gap-4">
          <div className="w-12 h-12 rounded-2xl bg-gradient-to-tr from-indigo-500 to-purple-400 flex items-center justify-center shadow-lg shadow-indigo-200">
            <Loader2 className="w-6 h-6 text-white animate-spin" />
          </div>
          <div className="flex flex-col items-center gap-2">
            <p className="text-sm text-slate-500 font-medium animate-pulse">Memeriksa sesi...</p>
            <div className="w-48 h-1.5 bg-slate-200/80 rounded-full overflow-hidden shadow-inner">
              <div 
                className="h-full bg-gradient-to-r from-indigo-500 to-purple-500 rounded-full transition-all duration-300 ease-out"
                style={{ width: `${progress}%` }}
              />
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (!user || !profile) return null;

  // Additional block in case they somehow render before the useEffect redirect completes
  if (profile.role === 'satker_head' && pathname !== '/dashboard/payroll/activity-review' && !pathname.startsWith('/dashboard/payroll/uraian')) {
    return null;
  }
  if (profile.role === 'satker_head_loyalis' && !pathname.startsWith('/dashboard/payroll/uraian')) {
    return null;
  }
  if (profile.role === 'employee_admin' && pathname !== '/dashboard/employees') {
    return null;
  }
  if (profile.role === 'honorer' && !pathname.startsWith('/employee/')) {
    return null;
  }
  if (profile.role === 'loyalis' && pathname !== '/employee/payslip' && pathname !== '/employee/presensi-correction') {
    return null;
  }
  if (profile.role === 'loyalis_presence_admin' && pathname !== '/dashboard/payroll/uraian/presensi-loyalis-raw' && pathname !== '/dashboard/payroll/presence-corrections') {
    return null;
  }

  return <>{children}</>;
}

