"use client";

import { useEffect } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import { useAuth } from '@/lib/AuthContext';
import { Loader2 } from 'lucide-react';

export default function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const { user, profile, loading } = useAuth();
  const router = useRouter();
  const pathname = usePathname();

  useEffect(() => {
    if (!loading) {
      if (!user) {
        router.replace('/login');
      } else if (profile) {
        // Enforce role-based route access
        if (profile.role === 'satker_head') {
          // SatKer Heads are allowed to access /dashboard/payroll/uraian and /dashboard/payroll/activity-review
          const allowedPaths = ['/dashboard/payroll/uraian', '/dashboard/payroll/activity-review'];
          if (!allowedPaths.includes(pathname)) {
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
          <p className="text-sm text-slate-500 font-medium animate-pulse">Memeriksa sesi...</p>
        </div>
      </div>
    );
  }

  if (!user || !profile) return null;

  // Additional block in case they somehow render before the useEffect redirect completes
  if (profile.role === 'satker_head' && !['/dashboard/payroll/uraian', '/dashboard/payroll/activity-review'].includes(pathname)) {
    return null;
  }
  if (profile.role === 'employee_admin' && pathname !== '/dashboard/employees') {
    return null;
  }
  if (profile.role === 'honorer' && !pathname.startsWith('/employee/')) {
    return null;
  }

  return <>{children}</>;
}

