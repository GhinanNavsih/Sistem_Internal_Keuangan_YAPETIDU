"use client";

import { useEffect, useState } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import { useAuth } from '@/lib/AuthContext';
import { isUserRole } from '@/lib/payroll/roles';
import { Loader2 } from 'lucide-react';

/**
 * Ketua Shift reports daily work, maintains the once-per-period duty plan, and
 * can view their own payslip (the page already resolves this role against
 * Employees_BlueCollar the same way it does 'honorer').
 */
const KETUA_SHIFT_SATPAM_ROUTES = [
  '/employee/activities',
  '/employee/satpam-duty-plan',
  '/employee/payslip',
];

/**
 * Loyalis staff see their own payslip, request presence corrections, and
 * report broken campus facilities to the Kepala SatKer.
 */
const LOYALIS_ROUTES = [
  '/employee/payslip',
  '/employee/presensi-correction',
  '/employee/facility-reports',
  '/employee/simpan-pinjam',
];

export default function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const { user, profile, activeProfile, loading, uiPreviewHydrated } = useAuth();
  const router = useRouter();
  const pathname = usePathname();

  const currentProfile = activeProfile || profile;
  const [progress, setProgress] = useState(0);

  useEffect(() => {
    if (loading || !uiPreviewHydrated) {
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
  }, [loading, uiPreviewHydrated]);

  useEffect(() => {
    if (!loading && uiPreviewHydrated) {
      if (!user) {
        router.replace('/login');
      } else if (currentProfile && !isUserRole(currentProfile.role)) {
        router.replace('/login');
      } else if (currentProfile) {
        // Enforce role-based route access
        if (currentProfile.role === 'super_admin') {
          // Super Admins without active UI preview shouldn't get stuck on employee-only pages
          if (pathname.startsWith('/employee/')) {
            router.replace('/dashboard/users');
          }
        } else if (currentProfile.role === 'satker_head') {
          // SatKer Heads are allowed to access /dashboard/payroll/uraian, /dashboard/payroll/activity-review, /dashboard/payroll/driver-journeys, and the facility damage review
          if (
            pathname !== '/dashboard/payroll/activity-review' &&
            !pathname.startsWith('/dashboard/payroll/uraian') &&
            !pathname.startsWith('/dashboard/payroll/driver-journeys') &&
            !pathname.startsWith('/dashboard/payroll/journey-dashboard') &&
            !pathname.startsWith('/dashboard/payroll/facility-reports')
          ) {
            router.replace('/dashboard/payroll/activity-review');
          }
        } else if (currentProfile.role === 'satker_head_loyalis') {
          // SatKer Loyalis is ONLY allowed to access /dashboard/payroll/uraian (including sub-routes)
          if (!pathname.startsWith('/dashboard/payroll/uraian')) {
            router.replace('/dashboard/payroll/uraian');
          }
        } else if (currentProfile.role === 'employee_admin') {
          // Employee Admins are ONLY allowed to access /dashboard/employees
          if (pathname !== '/dashboard/employees') {
            router.replace('/dashboard/employees');
          }
        } else if (currentProfile.role === 'honorer') {
          // Honorer employees are ONLY allowed to access /employee/activities
          if (!pathname.startsWith('/employee/')) {
            router.replace('/employee/activities');
          }
        } else if (currentProfile.role === 'ketua_shift_satpam') {
          if (!pathname.startsWith('/employee/')) {
            router.replace('/employee/activities');
          }
        } else if (currentProfile.role === 'finance_verifier') {
          if (!pathname.startsWith('/dashboard/payroll')) {
            router.replace('/dashboard/payroll');
          }
        } else if (currentProfile.role === 'loyalis') {
          // Loyalis employees can access payslip, presensi-correction, and broken-facility reporting
          if (!LOYALIS_ROUTES.includes(pathname)) {
            router.replace('/employee/payslip');
          }
        } else if (currentProfile.role === 'loyalis_presence_admin') {
          // PJ Presensi Loyalis can access raw presence and presence-corrections
          if (pathname !== '/dashboard/payroll/uraian/presensi-loyalis-raw' && pathname !== '/dashboard/payroll/uraian/presence-corrections') {
            router.replace('/dashboard/payroll/uraian/presensi-loyalis-raw');
          }
        }
      }
    }
  }, [user, profile, currentProfile, loading, uiPreviewHydrated, router, pathname]);

  if (loading || !uiPreviewHydrated) {
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

  if (!user || !profile || !isUserRole(profile.role)) return null;

  // Additional block in case they somehow render before the useEffect redirect completes
  if (
    profile.role === 'satker_head' &&
    pathname !== '/dashboard/payroll/activity-review' &&
    !pathname.startsWith('/dashboard/payroll/uraian') &&
    !pathname.startsWith('/dashboard/payroll/driver-journeys') &&
    !pathname.startsWith('/dashboard/payroll/journey-dashboard') &&
    !pathname.startsWith('/dashboard/payroll/facility-reports')
  ) {
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
  if (
    profile.role === 'ketua_shift_satpam' &&
    !KETUA_SHIFT_SATPAM_ROUTES.includes(pathname)
  ) {
    return null;
  }
  if (
    profile.role === 'finance_verifier' &&
    !pathname.startsWith('/dashboard/payroll')
  ) {
    return null;
  }
  if (profile.role === 'loyalis' && !LOYALIS_ROUTES.includes(pathname)) {
    return null;
  }
  if (profile.role === 'loyalis_presence_admin' && pathname !== '/dashboard/payroll/uraian/presensi-loyalis-raw' && pathname !== '/dashboard/payroll/uraian/presence-corrections') {
    return null;
  }

  return <>{children}</>;
}
