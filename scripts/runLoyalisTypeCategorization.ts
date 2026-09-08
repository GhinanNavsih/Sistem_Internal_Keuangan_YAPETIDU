import * as dotenv from 'dotenv';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';

type LoyalisType = 'Keluarga' | 'Dosen' | 'Admin';

interface PreviewRecord {
  documentId: string;
  name: string | null;
  status: string | null;
  currentLoyalisType: string | null;
  currentIsDosen: boolean | null;
  proposedLoyalisType: LoyalisType | null;
  proposedIsDosen: boolean | null;
  classificationStatus: 'ready' | 'needs_review';
  proposedFields: Record<string, unknown>;
  reviewFlags: string[];
  isDosenReviewFlags: string[];
}

interface PreviewReport {
  dryRun: boolean;
  ruleVersion: string;
  source: {
    collection: string;
    scannedDocumentCount: number;
    includedActiveDocumentCount: number;
  };
  records: PreviewRecord[];
}

const COLLECTION_NAME = 'Employees_Loyalis';
const DEFAULT_PREVIEW_PATH = 'tmp/loyalis-type-categorization-active-only-dry-run.json';
const DEFAULT_RESULT_PATH = 'tmp/loyalis-type-categorization-write-result.json';
const ALLOWED_LOYALIS_TYPES = new Set<LoyalisType>(['Keluarga', 'Dosen', 'Admin']);

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

function resolveArgument(prefix: string, fallback: string): string {
  const argument = process.argv.slice(2).find((value) => value.startsWith(`${prefix}=`));
  return path.resolve(process.cwd(), argument?.slice(prefix.length + 1) || fallback);
}

async function readPreview(previewPath: string): Promise<PreviewReport> {
  const raw = await fs.readFile(previewPath, 'utf8');
  const report = JSON.parse(raw) as PreviewReport;

  if (!report.dryRun || report.source?.collection !== COLLECTION_NAME) {
    throw new Error('The supplied JSON is not a valid Employees_Loyalis dry-run report.');
  }

  if (!Array.isArray(report.records)) {
    throw new Error('The dry-run report does not contain a records array.');
  }

  return report;
}

function assertProposedFields(record: PreviewRecord): asserts record is PreviewRecord & {
  proposedLoyalisType: LoyalisType;
  proposedIsDosen: boolean;
} {
  const keys = Object.keys(record.proposedFields).sort();
  if (keys.join(',') !== 'isDosen,loyalisType') {
    throw new Error(
      `${record.documentId} does not have exactly the two allowed proposed fields: loyalisType and isDosen.`,
    );
  }

  if (!ALLOWED_LOYALIS_TYPES.has(record.proposedLoyalisType as LoyalisType)) {
    throw new Error(`${record.documentId} has an invalid proposed loyalisType.`);
  }

  if (typeof record.proposedIsDosen !== 'boolean') {
    throw new Error(`${record.documentId} has an invalid proposed isDosen value.`);
  }

  if (record.proposedFields.loyalisType !== record.proposedLoyalisType) {
    throw new Error(`${record.documentId} has inconsistent loyalisType preview fields.`);
  }

  if (record.proposedFields.isDosen !== record.proposedIsDosen) {
    throw new Error(`${record.documentId} has inconsistent isDosen preview fields.`);
  }
}

async function main() {
  if (!process.argv.slice(2).includes('--confirm')) {
    throw new Error('Refusing to write without the explicit --confirm flag.');
  }

  dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });
  const { adminDb } = await import('../src/lib/firebase-admin');
  const previewPath = resolveArgument('--preview', DEFAULT_PREVIEW_PATH);
  const resultPath = resolveArgument('--result', DEFAULT_RESULT_PATH);
  const preview = await readPreview(previewPath);
  const snapshot = await adminDb.collection(COLLECTION_NAME).get();
  const activeDocuments = snapshot.docs.filter((document) => {
    const data = document.data() as Record<string, unknown>;
    const status = toText(getNestedValue(data, ['personal_info', 'status']));
    return status?.toUpperCase() === 'AKTIF';
  });

  if (snapshot.size !== preview.source.scannedDocumentCount) {
    throw new Error(
      `Live document count changed from ${preview.source.scannedDocumentCount} to ${snapshot.size}; refusing to write.`,
    );
  }

  if (activeDocuments.length !== preview.source.includedActiveDocumentCount) {
    throw new Error(
      `Live active document count changed from ${preview.source.includedActiveDocumentCount} to ${activeDocuments.length}; refusing to write.`,
    );
  }

  const previewById = new Map(preview.records.map((record) => [record.documentId, record]));
  if (previewById.size !== preview.records.length || preview.records.length !== activeDocuments.length) {
    throw new Error('The preview record set does not exactly match the current active document set.');
  }

  const liveById = new Map(activeDocuments.map((document) => [document.id, document]));
  for (const record of preview.records) {
    if (record.status?.toUpperCase() !== 'AKTIF') {
      throw new Error(`${record.documentId} is not AKTIF in the preview; refusing to write.`);
    }

    const liveDocument = liveById.get(record.documentId);
    if (!liveDocument) {
      throw new Error(`${record.documentId} is missing from the live active set; refusing to write.`);
    }

    const data = liveDocument.data() as Record<string, unknown>;
    const liveStatus = toText(getNestedValue(data, ['personal_info', 'status']))?.toUpperCase();
    const liveLoyalisType = toText(getNestedValue(data, ['loyalisType']));
    const liveIsDosen = toBoolean(getNestedValue(data, ['isDosen']));

    if (liveStatus !== 'AKTIF') {
      throw new Error(`${record.documentId} is no longer AKTIF; refusing to write.`);
    }

    if (liveLoyalisType !== record.currentLoyalisType || liveIsDosen !== record.currentIsDosen) {
      throw new Error(`${record.documentId} changed since the preview was generated; refusing to write.`);
    }
  }

  const readyRecords = preview.records.filter((record) => record.classificationStatus === 'ready');
  const skippedRecords = preview.records
    .filter((record) => record.classificationStatus !== 'ready')
    .map((record) => ({
      documentId: record.documentId,
      name: record.name,
      status: record.status,
      proposedLoyalisType: record.proposedLoyalisType,
      proposedIsDosen: record.proposedIsDosen,
      reviewFlags: record.reviewFlags,
      isDosenReviewFlags: record.isDosenReviewFlags,
    }));

  const batch = adminDb.batch();
  for (const record of readyRecords) {
    assertProposedFields(record);
    const document = liveById.get(record.documentId);
    if (!document) {
      throw new Error(`${record.documentId} disappeared before the write batch was built.`);
    }

    batch.update(document.ref, {
      loyalisType: record.proposedLoyalisType,
      isDosen: record.proposedIsDosen,
    });
  }

  await batch.commit();

  const verificationSnapshot = await adminDb.collection(COLLECTION_NAME).get();
  const verificationById = new Map(verificationSnapshot.docs.map((document) => [document.id, document]));
  for (const record of readyRecords) {
    const document = verificationById.get(record.documentId);
    const data = document?.data() as Record<string, unknown> | undefined;
    if (
      !data ||
      toText(getNestedValue(data, ['loyalisType'])) !== record.proposedLoyalisType ||
      toBoolean(getNestedValue(data, ['isDosen'])) !== record.proposedIsDosen
    ) {
      throw new Error(`${record.documentId} failed post-write verification.`);
    }
  }

  const result = {
    writeRun: true,
    generatedAt: new Date().toISOString(),
    source: {
      collection: COLLECTION_NAME,
      previewPath,
      ruleVersion: preview.ruleVersion,
      activeOnly: true,
    },
    writtenFieldAllowlist: ['loyalisType', 'isDosen'],
    excludedFields: [
      'classificationReason',
      'reviewFlags',
      'isDosenReviewFlags',
      'obligationPreview',
      'proposedFields',
    ],
    summary: {
      scannedRecords: snapshot.size,
      activeRecords: activeDocuments.length,
      updatedRecords: readyRecords.length,
      skippedNeedsReview: skippedRecords.length,
      postWriteVerified: readyRecords.length,
    },
    skippedRecords,
  };

  await fs.mkdir(path.dirname(resultPath), { recursive: true });
  await fs.writeFile(resultPath, `${JSON.stringify(result, null, 2)}\n`, 'utf8');

  console.log(`Updated ${readyRecords.length} active ${COLLECTION_NAME} documents.`);
  console.log(`Skipped ${skippedRecords.length} records needing review.`);
  console.log('Fields written: loyalisType, isDosen');
  console.log(`Post-write verification passed for ${readyRecords.length} documents.`);
  console.log(`Result written to: ${resultPath}`);
}

main().catch((error) => {
  console.error('Loyalis categorization write failed:', error);
  process.exitCode = 1;
});
