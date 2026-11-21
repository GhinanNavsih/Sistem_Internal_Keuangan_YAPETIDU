import type { MoneyField } from './domain';
import { DEVELOPER_ALLOWANCE_LABEL, isDeveloperAllowanceLabel } from './developerAllowance';

const OPTIONAL_ALLOWANCES = [
  {
    label: 'T. Instruksional',
    title: 'Instruksional',
    matches: (label: string) => ['instruksional', 't. instruksional', 'tunjangan instruksional'].includes(label.trim().toLowerCase()),
    note: 'Tunjangan Instruksional = tunjangan khusus berdasarkan kebijakan/kondisi tertentu.',
  },
  {
    label: DEVELOPER_ALLOWANCE_LABEL,
    title: 'Developer',
    matches: isDeveloperAllowanceLabel,
    note: null,
  },
];

export function isOptionalLoyalisAllowanceLabel(label: string): boolean {
  return OPTIONAL_ALLOWANCES.some(allowance => allowance.matches(label));
}

export function optionalLoyalisAllowanceRows(earnings: readonly MoneyField[]) {
  return OPTIONAL_ALLOWANCES.flatMap(allowance => {
    const row = earnings.find(field => field.amount > 0 && allowance.matches(field.label));
    return row ? [{ label: allowance.label, title: allowance.title, note: allowance.note, amount: row.amount }] : [];
  });
}

export function loyalisFixedAllowanceGuidance(earnings: readonly MoneyField[]) {
  const rows = optionalLoyalisAllowanceRows(earnings);
  return {
    title: ['Tunjangan Hari Tua', ...rows.map(row => row.title)].join(' & '),
    bullets: [
      'Tunjangan Hari Tua = 10% dari Gaji Pokok (subsidi dari Yayasan).',
      ...rows.flatMap(row => row.note ? [row.note] : []),
    ],
    rows,
  };
}
