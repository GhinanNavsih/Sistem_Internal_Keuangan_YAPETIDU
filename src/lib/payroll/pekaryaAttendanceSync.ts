/**
 * Rules for writing Pekarya attendance into the Uraian rekap automatically,
 * without a reviewer pressing Publish.
 *
 * The server sync (`src/lib/server/pekaryaAttendanceSync.ts`) builds the
 * attendance view, then uses these rules to decide whether anything changed
 * and what each employee's rekap entry becomes. An employee without a unique
 * NIPY cannot be paid from scans safely (their rows may belong to someone
 * else), so they are held on their own: their entry keeps whatever money it
 * had and carries `attendanceHold`, which stops slip creation and slip
 * propagation for them until the NIPY is fixed. Everyone else flows through.
 *
 * Pure module — no Firebase — so the rules are unit tested.
 */

export type AttendanceHoldReason = 'NIPY_MISSING' | 'NIPY_DUPLICATE';

export interface AttendanceHold {
  reason: AttendanceHoldReason;
}

/** The parts of one employee's attendance view that reach the rekap. */
export interface AttendanceSyncEmployee {
  employeeId: string;
  name: string;
  publishBlocked: boolean;
  warnings: readonly string[];
  harianAmount: number;
  jumatLiburAmount: number;
  harianCount: number;
  jumatLiburCount: number;
  presenceBonus: { amount: number } | null;
}

/** The parts of one category's attendance view that reach the rekap. */
export interface AttendanceSyncView {
  category: string;
  importRevisionId: string;
  calendarRevision: number;
  singleScanPolicy: string;
  employees: readonly AttendanceSyncEmployee[];
}

type RekapEntry = Record<string, unknown>;

export function attendanceHoldReason(
  employee: Pick<AttendanceSyncEmployee, 'publishBlocked' | 'warnings'>,
): AttendanceHoldReason | null {
  if (!employee.publishBlocked) return null;
  return employee.warnings.includes('NIPY_DUPLICATE') ? 'NIPY_DUPLICATE' : 'NIPY_MISSING';
}

/**
 * A stable text of everything the sync writes for a category. Two views with
 * the same text write the same rekap, so the server can skip the write (it
 * hashes this into the stored fingerprint).
 */
export function attendanceSyncSource(view: AttendanceSyncView, bonusKey: string | null): string {
  const employees = [...view.employees]
    .sort((left, right) => left.employeeId.localeCompare(right.employeeId))
    .map((employee) => [
      employee.employeeId,
      employee.name,
      attendanceHoldReason(employee),
      employee.harianAmount,
      employee.jumatLiburAmount,
      employee.harianCount,
      employee.jumatLiburCount,
      bonusKey && employee.presenceBonus ? employee.presenceBonus.amount : null,
    ]);
  return JSON.stringify([
    view.category,
    view.importRevisionId,
    view.calendarRevision,
    view.singleScanPolicy,
    bonusKey,
    employees,
  ]);
}

export interface AutoPublishedEntries {
  entries: Record<string, RekapEntry>;
  heldEmployees: Array<{ employeeId: string; name: string; reason: AttendanceHoldReason }>;
  /** Over the employees whose attendance was written (held ones excluded). */
  totals: { harian: number; jumatLibur: number; amount: number; employeeCount: number };
}

function objectOrEmpty(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? { ...(value as Record<string, unknown>) }
    : {};
}

/**
 * The rekap entries after writing a category's attendance. Entries for
 * employees outside the view (and every non-attendance column) are kept as
 * they are. A held employee's money is left untouched and marked held; a
 * released one loses the mark.
 */
export function buildAutoPublishedEntries(
  existingEntries: Readonly<Record<string, RekapEntry>>,
  view: AttendanceSyncView,
  options: { bonusKey: string | null; publicationRevision: number },
): AutoPublishedEntries {
  const entries: Record<string, RekapEntry> = { ...existingEntries };
  const heldEmployees: AutoPublishedEntries['heldEmployees'] = [];
  const totals = { harian: 0, jumatLibur: 0, amount: 0, employeeCount: 0 };
  const attendanceSource = {
    singleScanPolicy: view.singleScanPolicy,
    importRevisionId: view.importRevisionId,
    calendarRevision: view.calendarRevision,
    publicationRevision: options.publicationRevision,
  };

  for (const employee of view.employees) {
    const existing = objectOrEmpty(entries[employee.employeeId]);
    const reason = attendanceHoldReason(employee);
    if (reason) {
      heldEmployees.push({ employeeId: employee.employeeId, name: employee.name, reason });
      entries[employee.employeeId] = {
        values: {},
        ...existing,
        employeeId: employee.employeeId,
        name: employee.name,
        attendanceHold: { reason } satisfies AttendanceHold,
      };
      continue;
    }

    const values = objectOrEmpty(existing.values);
    const counts = objectOrEmpty(existing.counts);
    values.harian = employee.harianAmount;
    values.jumatLibur = employee.jumatLiburAmount;
    if (options.bonusKey && employee.presenceBonus) {
      values[options.bonusKey] = employee.presenceBonus.amount;
    }
    delete values.presensi;
    counts.harian = employee.harianCount;
    counts.jumatLibur = employee.jumatLiburCount;

    const next: RekapEntry = {
      ...existing,
      employeeId: employee.employeeId,
      name: employee.name,
      values,
      counts,
      attendanceSource,
    };
    delete next.attendanceHold;
    entries[employee.employeeId] = next;

    totals.harian += employee.harianCount;
    totals.jumatLibur += employee.jumatLiburCount;
    totals.amount += employee.harianAmount + employee.jumatLiburAmount;
    totals.employeeCount += 1;
  }

  return { entries, heldEmployees, totals };
}

/** True when a rekap entry is held from payroll until its NIPY is unique. */
export function isAttendanceHeld(entry: unknown): boolean {
  const hold = (entry as { attendanceHold?: { reason?: unknown } } | null | undefined)?.attendanceHold;
  return Boolean(hold && typeof hold === 'object' && hold.reason);
}

export const ATTENDANCE_HOLD_MESSAGE =
  'Presensi pegawai ditahan dari slip karena NIPY belum ada atau dipakai pegawai lain. Perbaiki NIPY di Data Pegawai.';
