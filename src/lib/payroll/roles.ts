export const USER_ROLES = [
  'super_admin',
  'finance_verifier',
  'satker_head',
  'satker_head_loyalis',
  'employee_admin',
  'honorer',
  'loyalis',
  'loyalis_presence_admin',
  'ketua_shift_satpam',
] as const;

export type UserRole = (typeof USER_ROLES)[number];

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
  'employee_admin',
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

export function canVerifyPayroll(role: UserRole): boolean {
  return role === 'finance_verifier' || role === 'super_admin';
}

export function canOperatePayments(role: UserRole): boolean {
  return role === 'finance_verifier' || role === 'super_admin';
}
