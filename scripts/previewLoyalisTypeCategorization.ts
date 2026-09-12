import * as dotenv from 'dotenv';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';

type LoyalisType = 'Keluarga' | 'Dosen' | 'Admin';
type ClassificationStatus = 'ready' | 'needs_review';

const COLLECTION_NAME = 'Employees_Loyalis';
const DEFAULT_OUTPUT_PATH = 'tmp/loyalis-type-categorization-active-only-dry-run.json';
const RATE_MATRIX_GROUPS = new Set(['Administrasi', 'Sosial', 'Eksakta', 'Kesehatan']);

const NIPY_PREFIX_TYPES: Record<string, LoyalisType> = {
  '01': 'Keluarga',
  '10': 'Keluarga',
  '11': 'Dosen',
  '12': 'Admin',
};

const EDUCATION_GROUP_PATTERNS: Array<[string, string]> = [
  ['Administrasi', 'administrasi'],
  ['Sosial', 'sosial'],
  ['Eksakta', 'eksakta'],
  ['Kesehatan', 'kesehatan'],
];

function getNestedValue(data: Record<string, unknown>, pathParts: string[]): unknown {
  let value: unknown = data;

  for (const part of pathParts) {
    if (!value || typeof value !== 'object' || !(part in value)) {
      return null;
    }
    value = (value as Record<string, unknown>)[part];
  }

  return value;
}

function toText(value: unknown): string | null {
  if (value === null || value === undefined) {
    return null;
  }

  const text = String(value).trim();
  return text.length > 0 ? text : null;
}

function normalizeNipy(value: unknown): string | null {
  const text = toText(value);
  return text ? text.replace(/\s+/g, '') : null;
}

function getEducationGroup(value: string | null): string | null {
  if (!value) {
    return null;
  }

  const normalized = value.toLowerCase();
  if (normalized === 'khusus') {
    return 'Khusus';
  }

  const matched = EDUCATION_GROUP_PATTERNS.find(([, marker]) => normalized.includes(marker));
  return matched?.[0] ?? 'Unmapped';
}

function getOutputPath(): string {
  const outputArgument = process.argv
    .slice(2)
    .find((argument) => argument.startsWith('--output='));

  const requestedPath = outputArgument?.slice('--output='.length) || DEFAULT_OUTPUT_PATH;
  return path.resolve(process.cwd(), requestedPath);
}

function countValues(values: unknown[]): Record<string, number> {
  return values.reduce<Record<string, number>>((counts, value) => {
    const key = value === null || value === undefined || value === '' ? 'blank' : String(value);
    counts[key] = (counts[key] || 0) + 1;
    return counts;
  }, {});
}

function toBoolean(value: unknown): boolean | null {
  if (typeof value === 'boolean') {
    return value;
  }

  const text = toText(value)?.toLowerCase();
  if (text === 'true') {
    return true;
  }
  if (text === 'false') {
    return false;
  }

  return null;
}

function getDosenDecision(educationLevel: string | null, educationGroup: string | null) {
  if (!educationLevel) {
    return {
      status: 'needs_review' as const,
      proposedIsDosen: null,
      reason: 'education_level is blank, so the independent lecturer flag cannot be determined.',
      reviewFlags: ['MISSING_EDUCATION_LEVEL_FOR_IS_DOSEN'],
    };
  }

  const proposedIsDosen = educationGroup !== 'Administrasi';

  return {
    status: 'determined' as const,
    proposedIsDosen,
    reason:
      educationGroup === 'Khusus'
        ? "The education level is Khusus, which is explicitly defined as lecturer, so isDosen is true."
        : proposedIsDosen
          ? "The education level is not in the Administrasi group, so isDosen is true."
          : "The education level is in the Administrasi group, so isDosen is false.",
    reviewFlags: [] as string[],
  };
}

function getObligationPreview(loyalisType: LoyalisType | null, jabatan: string | null) {
  const jabatanIsDosen = jabatan ? jabatan.toLowerCase() === 'dosen' : null;

  if (loyalisType === 'Keluarga') {
    return {
      status: 'determined' as const,
      applicability: 'none' as const,
      hasAttendanceObligation: false,
      baseObligationSks: 0,
      baseObligationRecognizedAttendance: 0,
      jabatanType: jabatan
        ? (jabatanIsDosen ? ('dosen' as const) : ('non_dosen' as const))
        : ('unknown' as const),
      jabatanIsDosen,
      reductionSks: 0,
      reductionRecognizedAttendance: 0,
      effectiveObligationSks: 0,
      effectiveObligationRecognizedAttendance: 0,
      allRecognizedTeachingAttendanceCountsAsKjm: true,
      kjmTreatment: 'all_recognized_teaching_attendance_is_excess' as const,
      reason:
        'Keluarga loyalis have no attendance obligation, so all recognized lecturing attendance goes into KJM; the jabatan-based obligation reduction does not apply.',
      reviewFlags: [] as string[],
    };
  }

  if (!jabatan) {
    return {
      status: 'needs_review' as const,
      applicability: 'unknown' as const,
      hasAttendanceObligation: loyalisType === null ? null : true,
      baseObligationSks: null,
      baseObligationRecognizedAttendance: null,
      jabatanType: 'unknown' as const,
      jabatanIsDosen,
      reductionSks: null,
      reductionRecognizedAttendance: null,
      effectiveObligationSks: null,
      effectiveObligationRecognizedAttendance: null,
      allRecognizedTeachingAttendanceCountsAsKjm: null,
      kjmTreatment: 'needs_review' as const,
      reason: 'jabatan is blank, so the non-family obligation reduction cannot be determined.',
      reviewFlags: ['MISSING_JABATAN_FOR_KJM_OBLIGATION_PREVIEW'],
    };
  }

  return {
    status: 'determined' as const,
    applicability: loyalisType ? ('applies' as const) : ('unknown' as const),
    hasAttendanceObligation: loyalisType ? true : null,
    baseObligationSks: null,
    baseObligationRecognizedAttendance: null,
    jabatanType: jabatanIsDosen ? ('dosen' as const) : ('non_dosen' as const),
    jabatanIsDosen,
    reductionSks: jabatanIsDosen ? 0 : 2,
    reductionRecognizedAttendance: jabatanIsDosen ? 0 : 28,
    effectiveObligationSks: null,
    effectiveObligationRecognizedAttendance: null,
    allRecognizedTeachingAttendanceCountsAsKjm: false,
    kjmTreatment: 'attendance_above_effective_obligation_is_excess' as const,
    reason: jabatanIsDosen
      ? 'The jabatan is Dosen, so the 2-SKS/28-attendance reduction does not apply.'
      : 'The jabatan is not Dosen, so the 2-SKS/28-attendance reduction applies to the non-family obligation.',
    reviewFlags: [] as string[],
  };
}

function classifyLoyalis(data: Record<string, unknown>, documentId: string) {
  const name = toText(getNestedValue(data, ['personal_info', 'name']));
  const status = toText(getNestedValue(data, ['personal_info', 'status']));
  const nipyRaw = toText(getNestedValue(data, ['personal_info', 'employee_id_niy']));
  const nipyNormalized = normalizeNipy(nipyRaw);
  const nipyPrefix = nipyNormalized?.slice(0, 2) || null;
  const educationLevel = toText(getNestedValue(data, ['academic_and_tier', 'education_level']));
  const educationGroup = getEducationGroup(educationLevel);
  const jabatan = toText(getNestedValue(data, ['employment_profile', 'job_role']));
  const currentLoyalisType = toText(getNestedValue(data, ['loyalisType']));
  const currentIsDosen = toBoolean(getNestedValue(data, ['isDosen']));
  const reviewFlags: string[] = [];
  const prefixLoyalisType = nipyPrefix ? (NIPY_PREFIX_TYPES[nipyPrefix] ?? null) : null;
  const educationRateGroupMapped = educationGroup ? RATE_MATRIX_GROUPS.has(educationGroup) : null;
  let proposedLoyalisType: LoyalisType | null = null;
  let classificationReason = '';

  if (!nipyNormalized) {
    reviewFlags.push('MISSING_NIPY');
    classificationReason = 'No NIPY is available, so no prefix-based category can be proposed.';
  } else if (!/^\d+$/.test(nipyNormalized)) {
    reviewFlags.push('NON_NUMERIC_NIPY');
    classificationReason = 'The normalized NIPY contains non-numeric characters, so its prefix is not trusted.';
  } else if (nipyPrefix && prefixLoyalisType) {
    proposedLoyalisType = prefixLoyalisType;
    classificationReason = `NIPY prefix ${nipyPrefix} maps directly to loyalisType ${proposedLoyalisType}.`;
  } else {
    reviewFlags.push('UNKNOWN_NIPY_PREFIX');
    classificationReason =
      `NIPY prefix ${nipyPrefix || '(blank)'} is not covered by the agreed prefix rules.`;
  }

  if (educationLevel && !educationRateGroupMapped) {
    reviewFlags.push('EDUCATION_GROUP_NOT_IN_RATE_MATRIX');
  }

  if (!educationLevel) {
    reviewFlags.push('MISSING_EDUCATION_LEVEL');
  }

  const dosenDecision = getDosenDecision(educationLevel, educationGroup);
  const loyalisTypeStatus: ClassificationStatus = proposedLoyalisType ? 'ready' : 'needs_review';
  const isDosenStatus: ClassificationStatus = dosenDecision.status === 'determined' ? 'ready' : 'needs_review';
  const classificationStatus: ClassificationStatus =
    loyalisTypeStatus === 'ready' && isDosenStatus === 'ready' ? 'ready' : 'needs_review';
  const obligationPreview = getObligationPreview(proposedLoyalisType, jabatan);
  const proposedFields: Record<string, LoyalisType | boolean> = {};
  if (proposedLoyalisType !== null) {
    proposedFields.loyalisType = proposedLoyalisType;
  }
  if (dosenDecision.proposedIsDosen !== null) {
    proposedFields.isDosen = dosenDecision.proposedIsDosen;
  }

  return {
    documentId,
    name,
    status,
    nipyRaw,
    nipyNormalized,
    nipyPrefix,
    prefixLoyalisType,
    currentLoyalisType,
    currentIsDosen,
    educationLevel,
    educationGroup,
    educationRateGroupMapped,
    jabatan,
    proposedLoyalisType,
    proposedIsDosen: dosenDecision.proposedIsDosen,
    isDosenReason: dosenDecision.reason,
    classificationStatus,
    loyalisTypeStatus,
    isDosenStatus,
    classificationReason,
    legacyAdminToLecturerCase:
      proposedLoyalisType === 'Admin' && dosenDecision.proposedIsDosen === true,
    reviewFlags,
    isDosenReviewFlags: dosenDecision.reviewFlags,
    obligationPreview,
    proposedFields,
    wouldChangeLoyalisType:
      proposedLoyalisType !== null && currentLoyalisType !== proposedLoyalisType,
    wouldChangeIsDosen:
      dosenDecision.proposedIsDosen !== null && currentIsDosen !== dosenDecision.proposedIsDosen,
    wouldChangeAnyCategorization:
      (proposedLoyalisType !== null && currentLoyalisType !== proposedLoyalisType) ||
      (dosenDecision.proposedIsDosen !== null && currentIsDosen !== dosenDecision.proposedIsDosen),
  };
}

async function main() {
  dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });

  // Import after dotenv so the Firebase Admin initialization sees the local credentials.
  const { adminDb } = await import('../src/lib/firebase-admin');
  const outputPath = getOutputPath();
  const snapshot = await adminDb.collection(COLLECTION_NAME).get();
  const activeDocuments = snapshot.docs.filter((document) => {
    const data = document.data() as Record<string, unknown>;
    const status = toText(getNestedValue(data, ['personal_info', 'status']));
    return status?.toUpperCase() === 'AKTIF';
  });
  const records = activeDocuments
    .slice()
    .sort((left, right) => left.id.localeCompare(right.id, undefined, { numeric: true }))
    .map((document) => classifyLoyalis(document.data() as Record<string, unknown>, document.id));

  const proposedTypes = records.map((record) => record.proposedLoyalisType);
  const currentTypes = records.map((record) => record.currentLoyalisType);
  const proposedIsDosen = records.map((record) => record.proposedIsDosen);
  const currentIsDosen = records.map((record) => record.currentIsDosen);
  const prefixes = records.map((record) => record.nipyPrefix);
  const educationGroups = records.map((record) => record.educationGroup);

  const report = {
    dryRun: true,
    generatedAt: new Date().toISOString(),
    source: {
      collection: COLLECTION_NAME,
      readOnly: true,
      statusFilter: "Include only records whose personal_info.status equals 'AKTIF' (case-insensitive).",
      scannedDocumentCount: snapshot.size,
      includedActiveDocumentCount: activeDocuments.length,
      excludedNonAktifDocumentCount: snapshot.size - activeDocuments.length,
      scannedStatusCounts: countValues(
        snapshot.docs.map((document) => {
          const data = document.data() as Record<string, unknown>;
          return toText(getNestedValue(data, ['personal_info', 'status']))?.toUpperCase() || null;
        }),
      ),
      fields: {
        nipy: 'personal_info.employee_id_niy',
        name: 'personal_info.name',
        status: 'personal_info.status',
        educationLevel: 'academic_and_tier.education_level',
        jabatan: 'employment_profile.job_role',
        loyalisType: 'loyalisType',
        isDosen: 'isDosen',
      },
    },
    ruleVersion: 'loyalis-type-v3-family-no-attendance-obligation',
    ruleInterpretation: {
      statusFilter: "Non-AKTIF loyalis are excluded; only status AKTIF is eligible for categorization.",
      nipyNormalization: 'Trim the value and remove internal whitespace before reading the first two digits.',
      loyalisTypeRule:
        'loyalisType is determined independently from the first two NIPY digits: 01/10 = Keluarga, 11 = Dosen, 12 = Admin.',
      prefixMap: {
        '01': 'Keluarga',
        '10': 'Keluarga',
        '11': 'Dosen',
        '12': 'Admin',
      },
      isDosenRule:
        "isDosen is independent of loyalisType: education levels containing 'Administrasi' produce false; any other non-blank education level produces true; blank education_level remains unresolved.",
      prefix12Behavior:
        'A prefix-12 record remains loyalisType Admin even when isDosen is true. This represents a legacy admin whose current education level identifies them as a lecturer.',
      keluargaObligation:
        'Keluarga loyalis have no attendance obligation. Their base and effective obligation are zero, all recognized lecturing attendance goes into KJM, and the jabatan-based 2-SKS/28-attendance reduction is not applied, even when isDosen is true.',
      educationGroups: {
        Administrasi: "Values containing 'Administrasi'",
        Sosial: "Values containing 'Sosial'",
        Eksakta: "Values containing 'Eksakta'",
        Kesehatan: "Values containing 'Kesehatan'",
        Khusus: "The exact value 'Khusus'; this explicitly produces isDosen true but has no rate-matrix column.",
        Unmapped: 'A non-blank value that does not match the four known rate-matrix groups',
      },
      obligationPreview:
        "For KJM only: jabatan exactly equal to 'Dosen' has a 0-SKS/0-attendance reduction; another non-blank jabatan has a 2-SKS/28-recognized-attendance reduction; blank jabatan remains unresolved.",
      privacy: 'The report includes only fields needed to review categorization and the KJM obligation preview; it does not copy full employee documents.',
    },
    summary: {
      totalRecords: records.length,
      scannedRecords: snapshot.size,
      includedActiveRecords: records.length,
      excludedNonAktifRecords: snapshot.size - records.length,
      currentLoyalisTypeCounts: countValues(currentTypes),
      currentIsDosenCounts: countValues(currentIsDosen),
      proposedLoyalisTypeCounts: countValues(proposedTypes),
      proposedIsDosenCounts: countValues(proposedIsDosen),
      nipyPrefixCounts: countValues(prefixes),
      educationGroupCounts: countValues(educationGroups),
      loyalisTypeReady: records.filter((record) => record.loyalisTypeStatus === 'ready').length,
      isDosenDetermined: records.filter((record) => record.isDosenStatus === 'ready').length,
      fullyResolved: records.filter((record) => record.classificationStatus === 'ready').length,
      needsReview: records.filter((record) => record.classificationStatus === 'needs_review').length,
      wouldChangeLoyalisType: records.filter((record) => record.wouldChangeLoyalisType).length,
      wouldChangeIsDosen: records.filter((record) => record.wouldChangeIsDosen).length,
      wouldChangeAnyCategorization: records.filter((record) => record.wouldChangeAnyCategorization).length,
      legacyAdminToLecturerCases: records.filter((record) => record.legacyAdminToLecturerCase).length,
      familyLecturerCases: records.filter(
        (record) => record.proposedLoyalisType === 'Keluarga' && record.proposedIsDosen === true,
      ).length,
      familyNoAttendanceObligation: records.filter(
        (record) => record.obligationPreview.applicability === 'none',
      ).length,
      familyAllRecognizedAttendanceCountsAsKjm: records.filter(
        (record) => record.obligationPreview.kjmTreatment === 'all_recognized_teaching_attendance_is_excess',
      ).length,
      missingNipy: records.filter((record) => record.reviewFlags.includes('MISSING_NIPY')).length,
      unknownNipyPrefix: records.filter((record) => record.reviewFlags.includes('UNKNOWN_NIPY_PREFIX')).length,
      missingEducationLevel: records.filter((record) => record.reviewFlags.includes('MISSING_EDUCATION_LEVEL')).length,
      educationGroupNotInRateMatrix: records.filter((record) =>
        record.reviewFlags.includes('EDUCATION_GROUP_NOT_IN_RATE_MATRIX'),
      ).length,
      missingJabatanForObligationPreview: records.filter((record) =>
        record.obligationPreview.reviewFlags.includes('MISSING_JABATAN_FOR_KJM_OBLIGATION_PREVIEW'),
      ).length,
    },
    records,
  };

  await fs.mkdir(path.dirname(outputPath), { recursive: true });
  await fs.writeFile(outputPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');

  console.log(`Read ${snapshot.size} ${COLLECTION_NAME} documents (read-only).`);
  console.log(`Included ${records.length} AKTIF documents.`);
  console.log(`Excluded ${snapshot.size - records.length} non-AKTIF documents.`);
  console.log(`Loyalis types ready: ${report.summary.loyalisTypeReady}`);
  console.log(`isDosen values determined: ${report.summary.isDosenDetermined}`);
  console.log(`Fully resolved records: ${report.summary.fullyResolved}`);
  console.log(`Needs review: ${report.summary.needsReview}`);
  console.log(`Legacy admin lecturer cases: ${report.summary.legacyAdminToLecturerCases}`);
  console.log(`JSON written to: ${outputPath}`);
}

main().catch((error) => {
  console.error('Loyalis categorization dry run failed:', error);
  process.exitCode = 1;
});
