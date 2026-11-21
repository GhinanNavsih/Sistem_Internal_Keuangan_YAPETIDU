import type { MoneyField } from './domain';

export const DEVELOPER_ALLOWANCE_LABEL = 'T. Developer';

export function developerAllowanceAmount(value: unknown): number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0 ? value : 0;
}

export function isDeveloperAllowanceLabel(label: string): boolean {
  return label.trim().toLowerCase() === DEVELOPER_ALLOWANCE_LABEL.toLowerCase();
}

export function developerAllowanceFromEarnings(earnings: readonly MoneyField[]): number {
  return earnings.find((field) => isDeveloperAllowanceLabel(field.label))?.amount ?? 0;
}

export function developerAllowanceForReport(
  savedEarnings: readonly MoneyField[] | undefined,
  profileAmount: unknown,
): number {
  return Array.isArray(savedEarnings)
    ? developerAllowanceFromEarnings(savedEarnings)
    : developerAllowanceAmount(profileAmount);
}
