import { RekapColumn, SalaryMatrix, UraianEntry } from '@/types';
import { computeSlipAmount } from '@/utils/rekapConfig';
import { resolveRekapColumnsForSlip, SlipField } from '@/lib/payroll/slipBuilders';
import {
  GapokResolution,
  resolveGapokFromMatrix,
  toSlipEmployeeView,
} from '@/lib/payroll/salaryMatrix';
import {
  classifyDriverPiketDatesInPeriod,
  countDriverPiketInPeriod,
  DriverPiketSchedule,
} from '@/lib/payroll/driverPiket';
import {
  allowsHistoricalPaperSpjEntry,
  allowsManualSpjEntry,
} from '@/lib/payroll/pekaryaSpj';

/**
 * The single Pekarya (blue-collar) earnings calculation.
 *
 * The employee payslip page, the Tinjau Slip Gaji modal, every export, and
 * every newly prepared draft all run through here, so one employee and one
 * period can only ever produce one set of rows. It is deliberately pure and
 * Firebase-free: the server route loads the documents, this decides the money.
 *
 * The rule that motivates the module is Gaji Pokok. It comes from the active
 * SalaryMatrix and nowhere else — `salaryProfile.baseSalaryAmount` is a stale
 * denormalized copy that silently under-pays anyone who has crossed a
 * service-year boundary since it was last written.
 */

export type PekaryaPreviewWarningCode =
  | 'matrix_unavailable'
  | 'grade_missing'
  | 'grade_unknown'
  | 'matrix_year_unavailable'
  | 'attendance_unpublished'
  | 'uraian_entry_missing';

export interface PekaryaPreviewWarning {
  code: PekaryaPreviewWarningCode;
  message: string;
  /** A blocking warning forbids creating or locking a slip from this preview. */
  blocking: boolean;
}

/**
 * Whether the official attendance publication this period requires is in
 * place. The server computes it (it depends on publication state, import
 * revision, and calendar revision); this module only reacts to the verdict.
 */
export interface PekaryaAttendanceGate {
  required: boolean;
  satisfied: boolean;
  reason?: string;
}

export interface PekaryaPreviewEmployee {
  id: string;
  salaryProfile?: { salaryGradeCode?: string; tunjanganBeras?: number };
  employment?: { startDate?: unknown; dateRecognized?: unknown; jobCategory?: string };
  bpjs?: { allowanceAmount?: number };
  [key: string]: unknown;
}

export interface PekaryaPreviewInputs {
  employee: PekaryaPreviewEmployee;
  /** Payroll period token, "YYYY-MM". */
  period: string;
  targetDate: Date;
  salaryMatrix: SalaryMatrix;
  matrixVersion?: string | null;
  uraianEntry?: UraianEntry;
  uraianCustomColumns?: readonly RekapColumn[];
  /** Sum of approved ActivityReports SPJ (SOPIR rows already use upahBersih). */
  approvedActivitySpj?: number;
  /** Sum of approved KegiatanSpj event payments for this employee. */
  approvedEventSpj?: number;
  piketSchedules?: readonly DriverPiketSchedule[];
  premiumDates?: ReadonlySet<string> | readonly string[];
  attendanceGate?: PekaryaAttendanceGate;
  vakasiTambahanList?: readonly { eventName: string; payGiven: number }[];
}

export interface PekaryaPreviewMeta {
  employeeId: string;
  jobCategory: string;
  period: string;
  matrixVersion: string | null;
  gradeLevel: string;
  serviceYears: number;
  effectiveMatrixYear: number | null;
  gapokStatus: GapokResolution['status'];
  /** Where the SPJ figure came from. */
  spjSource: 'activity_and_events' | 'uraian_manual';
  /** Where Harian / Jumat & Libur / Piket came from. */
  attendanceSource: 'uraian' | 'piket_estimate';
  /** True while any row still rests on an estimate rather than published data. */
  isProvisional: boolean;
  /** False when a slip must not be created or locked from this preview. */
  canCreateSlip: boolean;
  warnings: PekaryaPreviewWarning[];
}

export interface PekaryaSlipPreview {
  earnings: SlipField[];
  gapok: number;
  meta: PekaryaPreviewMeta;
}

const GAPOK_WARNING_MESSAGES: Record<
  Exclude<GapokResolution['status'], 'ok'>,
  string
> = {
  matrix_unavailable:
    'Matriks gaji aktif tidak dapat dibaca, sehingga Gaji Pokok tidak dapat dihitung.',
  grade_missing: 'Pegawai belum memiliki golongan gaji pada data induk.',
  grade_unknown:
    'Golongan gaji pegawai tidak terdapat pada matriks gaji aktif.',
  matrix_year_unavailable:
    'Matriks gaji aktif tidak memiliki baris masa kerja yang berlaku untuk pegawai ini.',
};

/**
 * Read one rekap column out of a published Uraian entry.
 *
 * Returns `null` — not `0` — when the rekap does not carry the column, so a
 * deliberately published zero stays zero instead of being overwritten by an
 * estimate.
 */
function readUraianAmount(
  column: RekapColumn,
  uraian?: UraianEntry,
): number | null {
  if (!uraian) return null;
  if (
    column.type === 'count' &&
    uraian.counts &&
    uraian.counts[column.key] !== undefined
  ) {
    return computeSlipAmount(column, uraian.counts[column.key]);
  }
  if (uraian.values && uraian.values[column.key] !== undefined) {
    return uraian.values[column.key] ?? 0;
  }
  return null;
}

function toPremiumDateSet(
  dates: ReadonlySet<string> | readonly string[] | undefined,
): ReadonlySet<string> {
  if (!dates) return new Set<string>();
  return dates instanceof Set ? dates : new Set(dates as readonly string[]);
}

export function buildPekaryaSlipPreview(
  inputs: PekaryaPreviewInputs,
): PekaryaSlipPreview {
  const {
    employee,
    period,
    targetDate,
    salaryMatrix,
    uraianEntry,
    uraianCustomColumns,
    piketSchedules = [],
    vakasiTambahanList = [],
  } = inputs;

  const employeeId = employee.id;
  const jobCategory = employee.employment?.jobCategory || '';
  const warnings: PekaryaPreviewWarning[] = [];

  // ─── Gaji Pokok: matrix only, never the profile snapshot ─────────────
  const gapokResolution = resolveGapokFromMatrix(
    toSlipEmployeeView(employee, 'blue'),
    salaryMatrix,
    targetDate,
  );
  if (gapokResolution.status !== 'ok') {
    warnings.push({
      code: gapokResolution.status,
      message: GAPOK_WARNING_MESSAGES[gapokResolution.status],
      blocking: true,
    });
  }

  // ─── SPJ ─────────────────────────────────────────────────────────────
  // The canonical figure is the approved activity total plus approved event
  // payments — the exact sum /api/payroll/slips validates a draft against.
  // The July 2026 transition categories are the one exception: they had no
  // digital reporting, so the Kepala Satker's typed rekap value is official.
  const usesManualSpj =
    allowsManualSpjEntry(jobCategory, period) ||
    allowsHistoricalPaperSpjEntry(jobCategory, period, employeeId);
  const canonicalSpj =
    (inputs.approvedActivitySpj || 0) + (inputs.approvedEventSpj || 0);

  // ─── Attendance ──────────────────────────────────────────────────────
  // Published Uraian values win. Until then a Piket assignment is evidence
  // the driver was present, so it stands in as an estimate, split by the same
  // premium-date rule the eventual real attendance will use.
  const premiumDates = toPremiumDateSet(inputs.premiumDates);
  const piketCount = countDriverPiketInPeriod(
    employeeId,
    period,
    piketSchedules,
  );
  const piketSplit = classifyDriverPiketDatesInPeriod(
    employeeId,
    period,
    piketSchedules,
    premiumDates,
  );

  const columns = resolveRekapColumnsForSlip(
    jobCategory,
    uraianEntry,
    uraianCustomColumns ? [...uraianCustomColumns] : undefined,
  );

  let usedEstimate = false;
  const earnings: SlipField[] = [
    { label: 'Gaji Pokok', amount: gapokResolution.amount },
  ];

  for (const column of columns) {
    if (!column.slipLabel) continue;
    const published = readUraianAmount(column, uraianEntry);
    let amount = published ?? 0;

    if (column.key === 'spj') {
      amount = usesManualSpj ? (published ?? 0) : canonicalSpj;
    } else if (column.key === 'piket' && published === null) {
      amount = computeSlipAmount(column, piketCount);
      if (amount !== 0) usedEstimate = true;
    } else if (
      (column.key === 'harian' || column.key === 'jumatLibur') &&
      published === null
    ) {
      amount = computeSlipAmount(
        column,
        column.key === 'harian' ? piketSplit.harian : piketSplit.jumatLibur,
      );
      if (amount !== 0) usedEstimate = true;
    }

    earnings.push({ label: column.slipLabel, amount });
  }

  if (employee.bpjs?.allowanceAmount) {
    earnings.push({
      label: 'BPJS (Tunjangan)',
      amount: Math.round(employee.bpjs.allowanceAmount),
    });
  }
  earnings.push({
    label: 'Tunjangan Beras',
    amount: employee.salaryProfile?.tunjanganBeras ?? 0,
  });
  for (const item of vakasiTambahanList) {
    earnings.push({ label: item.eventName, amount: item.payGiven });
  }

  // ─── Publication state ───────────────────────────────────────────────
  const attendanceGate: PekaryaAttendanceGate = inputs.attendanceGate ?? {
    required: false,
    satisfied: true,
  };
  if (attendanceGate.required && !attendanceGate.satisfied) {
    warnings.push({
      code: 'attendance_unpublished',
      message:
        attendanceGate.reason ||
        `Presensi ${jobCategory} belum dipublikasikan pada revisi import dan kalender terbaru.`,
      blocking: true,
    });
  }
  if (attendanceGate.required && attendanceGate.satisfied && !uraianEntry) {
    warnings.push({
      code: 'uraian_entry_missing',
      message: 'Hasil presensi resmi pegawai belum tersedia di Rekap Uraian.',
      blocking: true,
    });
  }

  const attendanceSource: PekaryaPreviewMeta['attendanceSource'] = uraianEntry
    ? 'uraian'
    : 'piket_estimate';

  return {
    earnings,
    gapok: gapokResolution.amount,
    meta: {
      employeeId,
      jobCategory,
      period,
      matrixVersion: inputs.matrixVersion ?? null,
      gradeLevel: gapokResolution.gradeKey,
      serviceYears: gapokResolution.serviceYears,
      effectiveMatrixYear: gapokResolution.effectiveYear,
      gapokStatus: gapokResolution.status,
      spjSource: usesManualSpj ? 'uraian_manual' : 'activity_and_events',
      attendanceSource,
      isProvisional:
        usedEstimate ||
        !uraianEntry ||
        (attendanceGate.required && !attendanceGate.satisfied),
      canCreateSlip: warnings.every((warning) => !warning.blocking),
      warnings,
    },
  };
}

/**
 * The Gaji Pokok a new draft must carry, as a plain number, for callers that
 * only need to validate one field.
 */
export function previewGapok(preview: PekaryaSlipPreview): number {
  return preview.gapok;
}

// ─── Slip-preview API authorization ──────────────────────────────────────

export type SlipPreviewScope =
  | { kind: 'period' }
  | { kind: 'employee'; employeeId: string }
  | { kind: 'denied'; status: 403 | 409; message: string };

/** Roles that hold a payslip of their own rather than a payroll dashboard. */
export const EMPLOYEE_PORTAL_PREVIEW_ROLES: readonly string[] = [
  'honorer',
  'ketua_shift_satpam',
];

/**
 * Who may read which previews.
 *
 * Finance may take the whole period at once, or narrow to one employee.
 * An employee-portal role is confined to its own linked employee — asking for
 * anyone else is a refusal, not a silently narrowed result.
 */
export function resolveSlipPreviewScope(input: {
  role: string;
  financeRoles: readonly string[];
  linkedEmployeeId?: string;
  requestedEmployeeId?: string;
}): SlipPreviewScope {
  const requested = input.requestedEmployeeId?.trim() || '';

  if (input.financeRoles.includes(input.role)) {
    return requested
      ? { kind: 'employee', employeeId: requested }
      : { kind: 'period' };
  }

  if (EMPLOYEE_PORTAL_PREVIEW_ROLES.includes(input.role)) {
    if (!input.linkedEmployeeId) {
      return {
        kind: 'denied',
        status: 409,
        message: 'Akun ini belum terhubung ke data pegawai.',
      };
    }
    if (requested && requested !== input.linkedEmployeeId) {
      return {
        kind: 'denied',
        status: 403,
        message: 'Anda hanya dapat melihat slip gaji sendiri.',
      };
    }
    return { kind: 'employee', employeeId: input.linkedEmployeeId };
  }

  return {
    kind: 'denied',
    status: 403,
    message: 'Anda tidak memiliki akses ke pratinjau slip gaji.',
  };
}

// ─── New-slip Gaji Pokok guard ───────────────────────────────────────────

const GAPOK_LABELS = ['GAJI POKOK', 'GAPOK'];

/**
 * The rule a slip must satisfy the first time it is written: exactly one Gaji
 * Pokok row, holding exactly the active matrix's figure.
 *
 * Returns the refusal message, or `null` when the earnings are acceptable.
 * Existing drafts are not passed through here — they keep any manual edit
 * until the next Refresh recalculates them.
 */
export function validateNewSlipGapok(
  earnings: readonly SlipField[],
  resolution: GapokResolution,
  matrixVersion: string,
): string | null {
  if (resolution.status !== 'ok') {
    return `Gaji Pokok tidak dapat dihitung dari matriks gaji aktif (${matrixVersion}); periksa golongan pegawai sebelum membuat slip.`;
  }

  const gapokFields = earnings.filter((field) =>
    GAPOK_LABELS.includes(field.label.trim().toUpperCase()),
  );
  if (gapokFields.length !== 1 || gapokFields[0].amount !== resolution.amount) {
    return `Gaji Pokok tidak sinkron dengan matriks gaji aktif. Nilai resmi adalah Rp${resolution.amount.toLocaleString('id-ID')}; muat ulang draf.`;
  }

  return null;
}
