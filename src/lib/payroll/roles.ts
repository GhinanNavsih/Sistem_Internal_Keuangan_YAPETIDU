export const USER_ROLES = [
  'super_admin',
  'finance_verifier',
  'payroll_authorizer',
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
  'payroll_authorizer',
];

export function isUserRole(value: unknown): value is UserRole {
  return typeof value === 'string' && (USER_ROLES as readonly string[]).includes(value);
}

export function canVerifyPayroll(role: UserRole): boolean {
  return role === 'finance_verifier' || role === 'super_admin';
}

export function canAuthorizePayroll(role: UserRole): boolean {
  return role === 'payroll_authorizer' || role === 'super_admin';
}

export function canOperatePayments(role: UserRole): boolean {
  return role === 'finance_verifier' || role === 'super_admin';
}

