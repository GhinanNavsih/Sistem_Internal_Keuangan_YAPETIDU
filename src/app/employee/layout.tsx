import ProtectedRoute from '@/components/ProtectedRoute';

export default function EmployeeLayout({ children }: { children: React.ReactNode }) {
  return <ProtectedRoute>{children}</ProtectedRoute>;
}
