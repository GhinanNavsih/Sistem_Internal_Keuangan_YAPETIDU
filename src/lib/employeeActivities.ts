export const EMPLOYEE_ACTIVITY_PATHS = {
  satpam: '/employee/activities/satpam',
  sopir: '/employee/activities/sopir',
  pekarya: '/employee/activities/pekarya',
} as const;

export const SOPIR_JOURNEY_REPORT_PATH =
  '/employee/activities/sopir/journey-report';

export const RETIRED_EMPLOYEE_ACTIVITY_PATHS = [
  '/employee/activities',
  '/employee/activities/journey-report',
] as const;

const KETUA_SHIFT_SATPAM_ROUTES = [
  EMPLOYEE_ACTIVITY_PATHS.satpam,
  '/employee/satpam-duty-plan',
  '/employee/leave',
  '/employee/payslip',
] as const;

export type EmployeeActivityWorkflow = keyof typeof EMPLOYEE_ACTIVITY_PATHS;

export interface EmployeeActivityRouteProfile {
  role?: string | null;
  permittedCategories?: readonly string[] | null;
}

function normalizeCategory(category: string): string {
  return category.trim().toUpperCase();
}

function normalizePathname(pathname: string): string {
  const withoutQuery = pathname.split(/[?#]/, 1)[0] || '/';
  if (withoutQuery.length > 1 && withoutQuery.endsWith('/')) {
    return withoutQuery.slice(0, -1);
  }
  return withoutQuery;
}

/**
 * Resolves an employee to exactly one activity workflow. The ordering is a
 * deliberate product rule for the rare profile containing multiple categories:
 * Satpam takes priority over Sopir, and every other/missing category uses the
 * general Pekarya workflow.
 */
export function getEmployeeActivityWorkflow(
  profile: EmployeeActivityRouteProfile,
): EmployeeActivityWorkflow {
  const categories = new Set(
    (profile.permittedCategories || []).map(normalizeCategory),
  );

  if (
    profile.role === 'ketua_shift_satpam' ||
    categories.has('SATPAM')
  ) {
    return 'satpam';
  }

  if (categories.has('SOPIR')) {
    return 'sopir';
  }

  return 'pekarya';
}

export function getEmployeeActivitiesPath(
  profile: EmployeeActivityRouteProfile,
): (typeof EMPLOYEE_ACTIVITY_PATHS)[EmployeeActivityWorkflow] {
  return EMPLOYEE_ACTIVITY_PATHS[getEmployeeActivityWorkflow(profile)];
}

export function getEmployeeActivityWorkflowFromPath(
  pathname: string,
): EmployeeActivityWorkflow | null {
  const normalizedPathname = normalizePathname(pathname);

  if (normalizedPathname === EMPLOYEE_ACTIVITY_PATHS.satpam) return 'satpam';
  if (normalizedPathname === EMPLOYEE_ACTIVITY_PATHS.pekarya) return 'pekarya';
  if (
    normalizedPathname === EMPLOYEE_ACTIVITY_PATHS.sopir ||
    normalizedPathname === SOPIR_JOURNEY_REPORT_PATH
  ) {
    return 'sopir';
  }

  return null;
}

export function isEmployeeActivityPath(pathname: string): boolean {
  return getEmployeeActivityWorkflowFromPath(pathname) !== null;
}

export function canAccessEmployeeActivityPath(
  profile: EmployeeActivityRouteProfile,
  pathname: string,
): boolean {
  const requestedWorkflow = getEmployeeActivityWorkflowFromPath(pathname);
  return requestedWorkflow !== null &&
    requestedWorkflow === getEmployeeActivityWorkflow(profile);
}

/**
 * Returns the employee home route when a role/category is not allowed to open
 * the requested path. Retired URLs intentionally return null so Next.js can
 * render a real not-found response instead of creating a compatibility route.
 */
export function getEmployeeRouteRedirect(
  profile: EmployeeActivityRouteProfile,
  pathname: string,
): string | null {
  const activitiesPath = getEmployeeActivitiesPath(profile);

  if (!pathname.startsWith('/employee/')) return activitiesPath;

  if (
    (RETIRED_EMPLOYEE_ACTIVITY_PATHS as readonly string[]).includes(pathname)
  ) {
    return null;
  }

  if (
    getEmployeeActivityWorkflowFromPath(pathname) !== null &&
    !canAccessEmployeeActivityPath(profile, pathname)
  ) {
    return activitiesPath;
  }

  if (
    pathname === '/employee/driver-history' &&
    getEmployeeActivityWorkflow(profile) !== 'sopir'
  ) {
    return activitiesPath;
  }

  if (
    pathname === '/employee/satpam-duty-plan' &&
    profile.role !== 'ketua_shift_satpam'
  ) {
    return activitiesPath;
  }

  if (
    profile.role === 'ketua_shift_satpam' &&
    !(KETUA_SHIFT_SATPAM_ROUTES as readonly string[]).includes(pathname)
  ) {
    return activitiesPath;
  }

  return null;
}
