import ProtectedRoute from '@/components/ProtectedRoute';
import { DashboardDataProvider } from '@/lib/DashboardDataContext';

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  return (
    <ProtectedRoute>
      <DashboardDataProvider>
        {children}
      </DashboardDataProvider>
    </ProtectedRoute>
  );
}

