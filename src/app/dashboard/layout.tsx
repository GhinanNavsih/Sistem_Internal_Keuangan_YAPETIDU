"use client";

import ProtectedRoute from '@/components/ProtectedRoute';
import { DashboardDataProvider } from '@/lib/DashboardDataContext';
import { BulkEmailProvider } from '@/lib/BulkEmailContext';
import BulkEmailGlobalUI from '@/components/BulkEmailGlobalUI';
import Sidebar from '@/components/Sidebar';

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  return (
    <ProtectedRoute>
      <DashboardDataProvider>
        <BulkEmailProvider>
          <div className="flex flex-col md:flex-row min-h-screen">
            <Sidebar />
            <main className="flex-1 min-h-screen overflow-x-hidden">
              {children}
            </main>
          </div>
          <BulkEmailGlobalUI />
        </BulkEmailProvider>
      </DashboardDataProvider>
    </ProtectedRoute>
  );
}


