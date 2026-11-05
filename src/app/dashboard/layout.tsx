"use client";

import { Suspense } from 'react';
import ProtectedRoute from '@/components/ProtectedRoute';
import { DashboardDataProvider } from '@/lib/DashboardDataContext';
import { BulkEmailProvider } from '@/lib/BulkEmailContext';
import BulkEmailGlobalUI from '@/components/BulkEmailGlobalUI';
import { PayrollLockJobProvider } from '@/lib/PayrollLockJobContext';
import PayrollLockGlobalUI from '@/components/PayrollLockGlobalUI';
import Sidebar from '@/components/Sidebar';

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  return (
    <ProtectedRoute>
      <DashboardDataProvider>
        <BulkEmailProvider>
          <PayrollLockJobProvider>
            <div className="flex flex-col md:flex-row min-h-screen">
              <Suspense fallback={null}>
                <Sidebar />
              </Suspense>
              <main className="flex-1 min-h-screen overflow-x-hidden">
                {children}
              </main>
            </div>
            <BulkEmailGlobalUI />
            <PayrollLockGlobalUI />
          </PayrollLockJobProvider>
        </BulkEmailProvider>
      </DashboardDataProvider>
    </ProtectedRoute>
  );
}


