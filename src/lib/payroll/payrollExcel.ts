import type { MoneyField } from './domain';
import type { KegiatanSpjFinancialLike } from './pekaryaSpj';
import { VAKASI_PEKARYA_PROJECTION_SOURCE_KIND } from './vakasiTambahan';

export interface PayrollVakasiSpjEvent extends KegiatanSpjFinancialLike {
  sourceKind?: string;
  eventName?: string;
}

/**
 * Pekarya Vakasi is already paid through SPJ. Itemize only its approved SPJ
 * projections for Excel, moving the amount out of SPJ rather than adding pay.
 * The supplied saved/preview earnings remain the authority for salary totals.
 */
export function itemizePekaryaVakasiForExport(input: {
  employeeId: string;
  jobCategory: string;
  period: string;
  earnings: readonly MoneyField[];
  events: readonly PayrollVakasiSpjEvent[];
}): MoneyField[] {
  const vakasiByLabel = new Map<string, number>();
  const seen = new Set<string>();
  for (const event of input.events) {
    if (
      event.sourceKind !== VAKASI_PEKARYA_PROJECTION_SOURCE_KIND ||
      event.period !== input.period ||
      (event.status && event.status !== 'approved') ||
      (event.jobCategory && event.jobCategory !== input.jobCategory)
    ) {
      continue;
    }
    const identity = event.id || JSON.stringify(event);
    if (seen.has(identity)) continue;
    seen.add(identity);
    const amount = event.eventWorkers?.[input.employeeId]?.payGiven ?? 0;
    if (!Number.isSafeInteger(amount) || amount <= 0) continue;
    const eventName = event.eventName?.trim();
    if (!eventName) {
      throw new Error('Nama kegiatan Vakasi belum tersedia. Periksa data kegiatan sebelum mengekspor.');
    }
    // The prefix keeps event names such as "SPJ" or "Gaji Pokok" separate
    // from the regular salary columns.
    const label = `Vakasi: ${eventName}`;
    vakasiByLabel.set(label, (vakasiByLabel.get(label) || 0) + amount);
  }

  const vakasiTotal = [...vakasiByLabel.values()].reduce((sum, amount) => sum + amount, 0);
  if (vakasiTotal === 0) return input.earnings.map(field => ({ ...field }));

  const isSpj = (field: MoneyField) => field.label.trim().toUpperCase() === 'SPJ';
  const spjTotal = input.earnings.filter(isSpj).reduce((sum, field) => sum + field.amount, 0);
  if (vakasiTotal > spjTotal) {
    throw new Error('Rincian Vakasi melebihi SPJ pada slip. Muat ulang payroll dan perbarui slip sebelum mengekspor.');
  }

  let wroteSpj = false;
  const earnings = input.earnings.flatMap(field => {
    if (!isSpj(field)) return [{ ...field }];
    if (wroteSpj) return [];
    wroteSpj = true;
    return [{ label: field.label, amount: spjTotal - vakasiTotal }];
  });
  const vakasiFields = [...vakasiByLabel.entries()]
    .sort(([left], [right]) => left.localeCompare(right, 'id'))
    .map(([label, amount]) => ({ label, amount }));
  return [...earnings, ...vakasiFields];
}
