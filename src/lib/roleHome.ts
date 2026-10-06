import {
  getEmployeeActivitiesPath,
  type EmployeeActivityRouteProfile,
} from '@/lib/employeeActivities';
import { LOYALIS_ADMIN_HOME_PATH, normalizeUserRole } from '@/lib/payroll/roles';

/**
 * The page a role lands on after signing in, switching to another of the
 * person's accounts, or starting a Super Admin preview or impersonation. Every
 * one of those must agree with the route guard (`ProtectedRoute`), or the user
 * is bounced a second time on arrival.
 */
export function getRoleHomePath(profile: EmployeeActivityRouteProfile): string {
  switch (normalizeUserRole(profile.role)) {
    case 'honorer':
    case 'ketua_shift_satpam':
      return getEmployeeActivitiesPath(profile);
    case 'loyalis':
      return '/employee/payslip';
    case 'satker_head':
      return '/dashboard/payroll/activity-review';
    case 'satker_head_loyalis':
      return '/dashboard/payroll/uraian';
    case 'satker_finance_admin':
    case 'rector_finance':
      return '/dashboard/satker-finance';
    case 'loyalis_admin':
      return LOYALIS_ADMIN_HOME_PATH;
    default:
      return '/dashboard/payroll';
  }
}
