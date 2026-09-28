import {
  dependentChildren,
  dependentHistory,
  eligibleFamilyMetrics,
  graduationDate,
  isDateOnly,
  isDependentEligible,
  nextDependentLevel,
  validateDependentHistory,
  withCurrentFamilyCounts,
  type DependentLevel,
  type FamilyAllowanceMetrics,
} from './familyAllowance';

export const FAMILY_ALLOWANCE_REQUESTS_COLLECTION = 'FamilyAllowanceRequests';
export const FAMILY_PROOF_MAX_BYTES = 5 * 1024 * 1024;
export const NEW_CHILD_TARGET = 'new';

export type FamilyAllowanceRequestStatus = 'pending' | 'approved' | 'rejected' | 'withdrawn';

export interface FamilyAllowanceRequest {
  id: string;
  employeeId: string;
  employeeName: string;
  requestedChildId: string;
  level: DependentLevel;
  enrolledAt: string;
  proofName: string;
  proofPath: string;
  proofUrl: string;
  proofContentType: string;
  proofSize: number;
  status: FamilyAllowanceRequestStatus;
  revision: number;
  submittedAt: string;
  reviewedAt?: string;
  reviewedBy?: string;
  reviewReason?: string;
  appliedChildId?: string;
}

export interface FamilyRequestChildOption {
  id: string;
  number: number;
  level: string;
  enrolledAt: string;
  graduatedAt: string;
  eligibleToday: boolean;
  requestable: boolean;
}

export interface EnrollmentProposal {
  targetChildId: string;
  level: DependentLevel;
  enrolledAt: string;
  stageId: string;
}

export function assertActiveEnrollment(level: unknown, enrolledAt: unknown, today: string): asserts level is DependentLevel {
  if (!['SD', 'SLTP', 'SLTA', 'S1', 'S2'].includes(String(level))) {
    throw new Error('Jenjang sekolah tidak valid.');
  }
  if (!isDateOnly(enrolledAt) || enrolledAt > today) {
    throw new Error('Tanggal pertama masuk harus valid dan tidak di masa depan.');
  }
  if (graduationDate(enrolledAt, level as DependentLevel) <= today) {
    throw new Error('Jenjang ini sudah berakhir. Ajukan jenjang yang masih aktif.');
  }
}

/** Applies an approved request to the latest profile snapshot, never to client-supplied counts. */
export function applyRequestedEnrollment(
  metrics: FamilyAllowanceMetrics | null | undefined,
  proposal: EnrollmentProposal,
  today: string,
): { metrics: FamilyAllowanceMetrics; childId: string } {
  assertActiveEnrollment(proposal.level, proposal.enrolledAt, today);
  const spouseCount = Number(metrics?.spouse_count ?? 0);
  if (!Number.isSafeInteger(spouseCount) || spouseCount < 0 || spouseCount > 1) {
    throw new Error('Data pasangan pada profil tidak valid. Admin perlu memeriksanya.');
  }
  if (!/^[A-Za-z0-9_-]{8,128}$/.test(proposal.stageId)) {
    throw new Error('Identitas pengajuan tidak valid.');
  }
  const history = dependentHistory(metrics);
  const children = dependentChildren(metrics);
  let nextHistory = [...history];
  let childId = proposal.targetChildId;

  if (proposal.targetChildId === NEW_CHILD_TARGET) {
    if (history.length >= 100) throw new Error('Jumlah riwayat tanggungan sudah mencapai batas.');
    childId = proposal.stageId;
    nextHistory.push({ id: childId, child_id: childId, level: proposal.level, enrolled_at: proposal.enrolledAt });
  } else {
    const child = children.find(item => item.id === proposal.targetChildId);
    if (!child) throw new Error('Anak yang dipilih tidak ditemukan. Muat ulang data karyawan.');
    const latest = child.latest;
    if (latest.ended_at) {
      throw new Error('Tunjangan anak ini telah dihentikan. Admin perlu memeriksa datanya secara manual.');
    }
    if (!isDateOnly(latest.enrolled_at)) {
      if (!/^legacy-(SD|SLTP|SLTA|S1|S2|PT)-\d+$/.test(latest.id) || child.stages.length !== 1) {
        throw new Error('Riwayat anak ini tidak lengkap. Admin perlu memeriksa datanya secara manual.');
      }
      if (latest.level === proposal.level) {
        nextHistory = nextHistory.map(stage => stage.id === latest.id
          ? { ...stage, enrolled_at: proposal.enrolledAt }
          : stage);
      } else if ((latest.level === 'PT' && (proposal.level === 'S1' || proposal.level === 'S2')) ||
        nextDependentLevel(latest.level) === proposal.level) {
        if (history.length >= 100) throw new Error('Jumlah riwayat tanggungan sudah mencapai batas.');
        nextHistory.push({
          id: proposal.stageId,
          child_id: child.id,
          level: proposal.level,
          enrolled_at: proposal.enrolledAt,
        });
      } else {
        throw new Error('Jenjang baru harus sama atau satu tingkat setelah jenjang anak yang tercatat.');
      }
    } else {
      if (isDependentEligible(latest, today)) {
        throw new Error('Anak ini sudah memiliki jenjang aktif dalam T. Keluarga.');
      }
      const priorGraduation = latest.level === 'PT' ? '' : graduationDate(latest.enrolled_at, latest.level);
      if (!priorGraduation || nextDependentLevel(latest.level) !== proposal.level ||
        proposal.enrolledAt < priorGraduation) {
        throw new Error('Jenjang berikutnya harus sesuai urutan sekolah dan dimulai setelah jenjang sebelumnya lulus.');
      }
      if (history.length >= 100) throw new Error('Jumlah riwayat tanggungan sudah mencapai batas.');
      nextHistory = nextHistory.map(stage => stage.id === latest.id
        ? { ...stage, no_further_study: false }
        : stage);
      nextHistory.push({
        id: proposal.stageId,
        child_id: child.id,
        level: proposal.level,
        enrolled_at: proposal.enrolledAt,
      });
    }
  }

  const nextMetrics: FamilyAllowanceMetrics = { ...(metrics || {}), dependents: nextHistory };
  validateDependentHistory(nextMetrics, today);
  const withCounts = withCurrentFamilyCounts(nextMetrics, today);
  const eligible = eligibleFamilyMetrics(withCounts, today);
  if (eligible.children_sd + eligible.children_sltp + eligible.children_slta + eligible.children_pt > 100) {
    throw new Error('Jumlah anak tanggungan terlalu banyak.');
  }
  return { metrics: withCounts, childId };
}
