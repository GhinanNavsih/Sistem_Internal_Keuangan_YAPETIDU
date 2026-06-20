"use client";

import ProtectedRoute from '@/components/ProtectedRoute';
import { DashboardDataProvider } from '@/lib/DashboardDataContext';
import { BulkEmailProvider } from '@/lib/BulkEmailContext';
import BulkEmailGlobalUI from '@/components/BulkEmailGlobalUI';

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  return (
    <ProtectedRoute>
      <DashboardDataProvider>
        <BulkEmailProvider>
          {children}
          <BulkEmailGlobalUI />
        </BulkEmailProvider>
      </DashboardDataProvider>
    </ProtectedRoute>
  );
}

