import { createHash } from 'node:crypto';

export const PEKARYA_NIPY_FORMULA_VERSION = 1;
export const PEKARYA_NIPY_SEQUENCE_LIMIT = 999;

export type PekaryaNipyGroup =
  | 'KEBERSIHAN'
  | 'SOPIR'
  | 'SATPAM'
  | 'TEKNISI';

export const PEKARYA_NIPY_PREFIXES: Readonly<
  Record<PekaryaNipyGroup, string>
> = Object.freeze({
  KEBERSIHAN: '13',
  SOPIR: '14',
  SATPAM: '15',
  TEKNISI: '16',
});

export type PekaryaNipyAssignmentStatus = 'issued' | 'reserved';

export interface PekaryaNipyAssignment {
  formulaVersion: number;
  categoryGroup: PekaryaNipyGroup;
  prefixCode: string;
  sourceStartDate: string | null;
  sequence: number;
  status: PekaryaNipyAssignmentStatus;
  source: 'formula';
}

export interface PekaryaNipyEmployeeInput {
  employeeId: string;
  name: string;
  category: string;
  startDate: string | null;
  active: boolean;
  nipy: string;
  assignment?: Partial<PekaryaNipyAssignment> | null;
}

export type PekaryaNipyPreviewState =
  | 'ready'
  | 'reserved'
  | 'existing'
  | 'blocked'
  | 'conflict';

export interface PekaryaNipyPreviewItem {
  employeeId: string;
  name: string;
  category: string;
  categoryGroup: PekaryaNipyGroup | null;
  prefixCode: string | null;
  startDate: string | null;
  sequence: number | null;
  proposedNipy: string | null;
  currentNipy: string | null;
  state: PekaryaNipyPreviewState;
  needsWrite: boolean;
  reasonCode: string | null;
  reason: string | null;
}

export interface PekaryaNipyPreview {
  formulaVersion: number;
  initialized: boolean;
  items: PekaryaNipyPreviewItem[];
  counters: Record<PekaryaNipyGroup, number>;
  summary: {
    active: number;
    ready: number;
    reserved: number;
    existing: number;
    blocked: number;
    conflicts: number;
    pendingWrites: number;
  };
  previewHash: string;
}

const DATE_ONLY_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const NIPY_RE = /^\d{11}$/;
const BC_ID_RE = /^BC_(\d{3})$/;

export function pekaryaNipyGroup(
  category: unknown,
): PekaryaNipyGroup | null {
  const normalized = String(category || '').trim().toUpperCase();
  if (
    normalized === 'KEBERSIHAN' ||
    normalized === 'KEBERSIHAN_PONTI'
  ) {
    return 'KEBERSIHAN';
  }
  if (
    normalized === 'SOPIR' ||
    normalized === 'SATPAM' ||
    normalized === 'TEKNISI'
  ) {
    return normalized;
  }
  return null;
}

export function pekaryaEmployeeOrder(employeeId: unknown): number | null {
  const match = BC_ID_RE.exec(String(employeeId || '').trim().toUpperCase());
  if (!match) return null;
  const order = Number(match[1]);
  return Number.isSafeInteger(order) && order > 0 ? order : null;
}

export function normalizePekaryaStartDate(value: unknown): string | null {
  const source = String(value || '').trim();
  const match = DATE_ONLY_RE.exec(source);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    return null;
  }
  return source;
}

export function formatPekaryaNipyDate(startDate: unknown): string | null {
  const normalized = normalizePekaryaStartDate(startDate);
  if (!normalized) return null;
  const [year, month, day] = normalized.split('-');
  return `${day}${month}${year.slice(-2)}`;
}

export function generatePekaryaNipy(
  category: unknown,
  startDate: unknown,
  sequence: number,
): string {
  const group = pekaryaNipyGroup(category);
  if (!group) throw new Error('Kategori Pekarya tidak mendukung formula NIPY.');
  const dateCode = formatPekaryaNipyDate(startDate);
  if (!dateCode) throw new Error('Tanggal mulai kerja wajib berupa tanggal valid.');
  if (
    !Number.isSafeInteger(sequence) ||
    sequence < 1 ||
    sequence > PEKARYA_NIPY_SEQUENCE_LIMIT
  ) {
    throw new Error('Nomor urut NIPY harus berada antara 001 dan 999.');
  }
  return `${PEKARYA_NIPY_PREFIXES[group]}${dateCode}${String(sequence).padStart(3, '0')}`;
}

export function isValidPekaryaNipy(value: unknown): boolean {
  return NIPY_RE.test(String(value || '').trim());
}

function assignmentSequence(
  employee: PekaryaNipyEmployeeInput,
  group: PekaryaNipyGroup,
): number | null {
  if (
    employee.assignment?.categoryGroup !== group ||
    !Number.isSafeInteger(employee.assignment?.sequence) ||
    Number(employee.assignment?.sequence) < 1 ||
    Number(employee.assignment?.sequence) > PEKARYA_NIPY_SEQUENCE_LIMIT
  ) {
    return null;
  }
  return Number(employee.assignment?.sequence);
}

function summaryFor(items: PekaryaNipyPreviewItem[]) {
  return {
    active: items.length,
    ready: items.filter((item) => item.state === 'ready').length,
    reserved: items.filter((item) => item.state === 'reserved').length,
    existing: items.filter((item) => item.state === 'existing').length,
    blocked: items.filter((item) => item.state === 'blocked').length,
    conflicts: items.filter((item) => item.state === 'conflict').length,
    pendingWrites: items.filter((item) => item.needsWrite).length,
  };
}

function previewHash(
  items: PekaryaNipyPreviewItem[],
  counters: Record<PekaryaNipyGroup, number>,
  initialized: boolean,
) {
  return createHash('sha256')
    .update(
      JSON.stringify({
        formulaVersion: PEKARYA_NIPY_FORMULA_VERSION,
        initialized,
        counters,
        items: items.map((item) => ({
          employeeId: item.employeeId,
          category: item.category,
          startDate: item.startDate,
          sequence: item.sequence,
          proposedNipy: item.proposedNipy,
          currentNipy: item.currentNipy,
          state: item.state,
          needsWrite: item.needsWrite,
          reasonCode: item.reasonCode,
        })),
      }),
    )
    .digest('hex');
}

export function buildPekaryaNipyPreview(
  employees: PekaryaNipyEmployeeInput[],
  options?: {
    initialized?: boolean;
    counters?: Partial<Record<PekaryaNipyGroup, number>>;
    identityOwners?: Map<
      string,
      { employeeId: string; employeeCollection: string }
    >;
  },
): PekaryaNipyPreview {
  const initialized = options?.initialized === true;
  const counters: Record<PekaryaNipyGroup, number> = {
    KEBERSIHAN: Number(options?.counters?.KEBERSIHAN || 0),
    SOPIR: Number(options?.counters?.SOPIR || 0),
    SATPAM: Number(options?.counters?.SATPAM || 0),
    TEKNISI: Number(options?.counters?.TEKNISI || 0),
  };
  const sorted = employees
    .filter((employee) => employee.active)
    .sort((left, right) => {
      const leftOrder = pekaryaEmployeeOrder(left.employeeId);
      const rightOrder = pekaryaEmployeeOrder(right.employeeId);
      if (leftOrder !== null && rightOrder !== null) {
        return leftOrder - rightOrder;
      }
      if (leftOrder !== null) return -1;
      if (rightOrder !== null) return 1;
      return left.employeeId.localeCompare(right.employeeId);
    });
  const initialGroupCounts: Record<PekaryaNipyGroup, number> = {
    KEBERSIHAN: 0,
    SOPIR: 0,
    SATPAM: 0,
    TEKNISI: 0,
  };
  const allocatedCounts = { ...counters };
  const usedNipys = new Map<
    string,
    { employeeId: string; employeeCollection: string }
  >(options?.identityOwners || []);
  const items: PekaryaNipyPreviewItem[] = [];

  for (const employee of sorted) {
    const group = pekaryaNipyGroup(employee.category);
    const storedGroup = pekaryaNipyGroup(employee.assignment?.categoryGroup);
    const storedSequence =
      Number.isSafeInteger(employee.assignment?.sequence) &&
      Number(employee.assignment?.sequence) >= 1 &&
      Number(employee.assignment?.sequence) <= PEKARYA_NIPY_SEQUENCE_LIMIT
        ? Number(employee.assignment?.sequence)
        : null;
    if (
      employee.nipy &&
      employee.assignment?.status === 'issued' &&
      storedGroup &&
      storedSequence
    ) {
      initialGroupCounts[storedGroup] = Math.max(
        initialGroupCounts[storedGroup],
        storedSequence,
      );
      allocatedCounts[storedGroup] = Math.max(
        allocatedCounts[storedGroup],
        storedSequence,
      );
      const currentStartDate = normalizePekaryaStartDate(employee.startDate);
      const sourceChanged =
        group !== storedGroup ||
        currentStartDate !== employee.assignment.sourceStartDate;
      items.push({
        employeeId: employee.employeeId,
        name: employee.name,
        category: employee.category,
        categoryGroup: storedGroup,
        prefixCode: PEKARYA_NIPY_PREFIXES[storedGroup],
        startDate: employee.startDate,
        sequence: storedSequence,
        proposedNipy: employee.nipy,
        currentNipy: employee.nipy,
        state: 'existing',
        needsWrite: false,
        reasonCode: sourceChanged
          ? 'SOURCE_CHANGED_AFTER_ISSUANCE'
          : null,
        reason: sourceChanged
          ? 'Kategori atau tanggal mulai berubah; NIPY permanen tidak diubah otomatis.'
          : null,
      });
      usedNipys.set(employee.nipy, {
        employeeId: employee.employeeId,
        employeeCollection: 'Employees_BlueCollar',
      });
      continue;
    }
    if (!group) {
      items.push({
        employeeId: employee.employeeId,
        name: employee.name,
        category: employee.category,
        categoryGroup: null,
        prefixCode: null,
        startDate: employee.startDate,
        sequence: null,
        proposedNipy: null,
        currentNipy: employee.nipy || null,
        state: 'blocked',
        needsWrite: false,
        reasonCode: 'CATEGORY_UNSUPPORTED',
        reason: 'Kategori belum memiliki kode formula NIPY.',
      });
      continue;
    }

    const existingSequence = assignmentSequence(employee, group);
    let sequence = existingSequence;
    if (!sequence) {
      if (!initialized) {
        initialGroupCounts[group] += 1;
        sequence = initialGroupCounts[group];
      } else {
        allocatedCounts[group] += 1;
        sequence = allocatedCounts[group];
      }
    } else {
      initialGroupCounts[group] = Math.max(initialGroupCounts[group], sequence);
      allocatedCounts[group] = Math.max(allocatedCounts[group], sequence);
    }

    if (sequence > PEKARYA_NIPY_SEQUENCE_LIMIT) {
      items.push({
        employeeId: employee.employeeId,
        name: employee.name,
        category: employee.category,
        categoryGroup: group,
        prefixCode: PEKARYA_NIPY_PREFIXES[group],
        startDate: employee.startDate,
        sequence,
        proposedNipy: null,
        currentNipy: employee.nipy || null,
        state: 'blocked',
        needsWrite: false,
        reasonCode: 'SEQUENCE_EXHAUSTED',
        reason: 'Nomor urut kategori telah mencapai batas 999.',
      });
      continue;
    }

    const normalizedStartDate = normalizePekaryaStartDate(employee.startDate);
    if (!normalizedStartDate) {
      items.push({
        employeeId: employee.employeeId,
        name: employee.name,
        category: employee.category,
        categoryGroup: group,
        prefixCode: PEKARYA_NIPY_PREFIXES[group],
        startDate: employee.startDate,
        sequence,
        proposedNipy: null,
        currentNipy: employee.nipy || null,
        state: employee.nipy ? 'conflict' : 'reserved',
        needsWrite: !employee.nipy && existingSequence === null,
        reasonCode: 'START_DATE_MISSING',
        reason: 'Tanggal mulai kerja belum tersedia atau tidak valid.',
      });
      continue;
    }

    const proposedNipy = generatePekaryaNipy(
      group,
      normalizedStartDate,
      sequence,
    );
    if (employee.nipy) {
      const state = employee.nipy === proposedNipy ? 'existing' : 'conflict';
      items.push({
        employeeId: employee.employeeId,
        name: employee.name,
        category: employee.category,
        categoryGroup: group,
        prefixCode: PEKARYA_NIPY_PREFIXES[group],
        startDate: normalizedStartDate,
        sequence,
        proposedNipy,
        currentNipy: employee.nipy,
        state,
        needsWrite: false,
        reasonCode: state === 'conflict' ? 'EXISTING_NIPY_MISMATCH' : null,
        reason:
          state === 'conflict'
            ? 'NIPY tersimpan tidak sesuai formula atau metadata urutannya.'
            : null,
      });
      usedNipys.set(employee.nipy, {
        employeeId: employee.employeeId,
        employeeCollection: 'Employees_BlueCollar',
      });
      continue;
    }

    const owner = usedNipys.get(proposedNipy);
    const isConflict = Boolean(
      owner &&
        (owner.employeeId !== employee.employeeId ||
          owner.employeeCollection !== 'Employees_BlueCollar'),
    );
    items.push({
      employeeId: employee.employeeId,
      name: employee.name,
      category: employee.category,
      categoryGroup: group,
      prefixCode: PEKARYA_NIPY_PREFIXES[group],
      startDate: normalizedStartDate,
      sequence,
      proposedNipy,
      currentNipy: null,
      state: isConflict ? 'conflict' : 'ready',
      needsWrite: !isConflict,
      reasonCode: isConflict ? 'NIPY_DUPLICATE' : null,
      reason: isConflict ? 'NIPY sudah dimiliki pegawai lain.' : null,
    });
    if (!isConflict) {
      usedNipys.set(proposedNipy, {
        employeeId: employee.employeeId,
        employeeCollection: 'Employees_BlueCollar',
      });
    }
  }

  if (!initialized) {
    for (const group of Object.keys(counters) as PekaryaNipyGroup[]) {
      counters[group] = Math.max(counters[group], initialGroupCounts[group]);
    }
  } else {
    for (const group of Object.keys(counters) as PekaryaNipyGroup[]) {
      counters[group] = Math.max(counters[group], allocatedCounts[group]);
    }
  }
  const summary = summaryFor(items);
  return {
    formulaVersion: PEKARYA_NIPY_FORMULA_VERSION,
    initialized,
    items,
    counters,
    summary,
    previewHash: previewHash(items, counters, initialized),
  };
}
