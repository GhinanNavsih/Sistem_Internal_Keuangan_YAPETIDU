export const USER_ROLES = [
  'super_admin',
  'finance_verifier',
  'satker_head',
  'satker_head_loyalis',
  'loyalis_admin',
  'honorer',
  'loyalis',
  'ketua_shift_satpam',
] as const;

export type UserRole = (typeof USER_ROLES)[number];

/**
 * Role ids retired when Employee Admin and PJ Presensi Loyalis were merged into
 * `loyalis_admin`. A profile still carrying one is read as `loyalis_admin`
 * until `npm run migrate:loyalis-admin-role -- --apply` rewrites it; the
 * Firestore and Storage rules accept them for the same transition. New
 * profiles can never be saved with one, because `isUserRole` rejects them.
 */
export const LEGACY_ROLE_ALIASES: Readonly<Record<string, UserRole>> = {
  employee_admin: 'loyalis_admin',
  loyalis_presence_admin: 'loyalis_admin',
};

/**
 * Loyalis Admin keeps master data of employees and runs Loyalis presence:
 * the monthly import/calculator, presence corrections and Loyalis leave.
 * These are the only pages the role may open; the first is its home.
 */
export const LOYALIS_ADMIN_PATHS = [
  '/dashboard/employees',
  '/dashboard/payroll/uraian/presensi-loyalis-raw',
  '/dashboard/payroll/uraian/presence-corrections',
] as const;

export const LOYALIS_ADMIN_HOME_PATH = LOYALIS_ADMIN_PATHS[0];

export function isLoyalisAdminPath(pathname: string): boolean {
  return (LOYALIS_ADMIN_PATHS as readonly string[]).includes(pathname);
}

export const FINANCE_ROLES: readonly UserRole[] = [
  'super_admin',
  'finance_verifier',
];

/**
 * Who may edit an employee profile, and therefore trigger propagation of that
 * profile onto open-period payslips. Narrower than payroll authority: the
 * propagation route derives every amount server-side, so these roles never get
 * to name a figure.
 */
export const EMPLOYEE_PROFILE_EDITOR_ROLES: readonly UserRole[] = [
  'super_admin',
  'loyalis_admin',
];

/**
 * Who may save an Uraian rekap or the Loyalis presence calculator, and can
 * therefore trigger propagation of those numbers onto draft slips. Mirrors the
 * Firestore rules for `UraianGaji` (finance roles plus the Satker heads).
 * Satker heads are additionally confined to their own permittedCategories by
 * the propagation route.
 */
export const URAIAN_EDITOR_ROLES: readonly UserRole[] = [
  'super_admin',
  'finance_verifier',
  'satker_head',
  'satker_head_loyalis',
];

/**
 * Who may reserve campus venues in SIMPEL UNIPDU from SAKU. Kepala SatKer
 * Loyalis books rooms and equipment for their events; Super Admin can test the
 * whole flow and act on every reservation made through SAKU. The route guard,
 * both navigation menus and the API all read this list, so they cannot drift.
 */
export const VENUE_RESERVATION_ROLES: readonly UserRole[] = [
  'super_admin',
  'satker_head_loyalis',
];

export function canReserveVenues(role: UserRole | null | undefined): boolean {
  return !!role && VENUE_RESERVATION_ROLES.includes(role);
}

export function isUserRole(value: unknown): value is UserRole {
  return typeof value === 'string' && (USER_ROLES as readonly string[]).includes(value);
}

/** A stored role as the app should treat it, mapping retired ids to their successor. */
export function normalizeUserRole(value: unknown): UserRole | null {
  if (isUserRole(value)) return value;
  if (typeof value === 'string' && Object.hasOwn(LEGACY_ROLE_ALIASES, value)) {
    return LEGACY_ROLE_ALIASES[value];
  }
  return null;
}

export function canVerifyPayroll(role: UserRole): boolean {
  return role === 'finance_verifier' || role === 'super_admin';
}

export function canOperatePayments(role: UserRole): boolean {
  return role === 'finance_verifier' || role === 'super_admin';
}
