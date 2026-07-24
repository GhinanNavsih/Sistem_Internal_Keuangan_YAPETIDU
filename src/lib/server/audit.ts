import admin, { adminDb } from '@/lib/firebase-admin';
import { AuthenticatedProfile } from './auth';

export interface FinancialAuditInput {
  action: string;
  entityType: string;
  entityId: string;
  reason: string;
  requestId?: string;
  before?: unknown;
  after?: unknown;
  metadata?: Record<string, unknown>;
}

export function buildFinancialAuditRecord(
  actor: AuthenticatedProfile,
  input: FinancialAuditInput,
): Record<string, unknown> {
  return {
    action: input.action,
    entityType: input.entityType,
    entityId: input.entityId,
    reason: input.reason,
    requestId: input.requestId || null,
    actorUid: actor.uid,
    actorRole: actor.role,
    actorEmail: actor.email,
    before: input.before ?? null,
    after: input.after ?? null,
    metadata: input.metadata || {},
    occurredAt: admin.firestore.FieldValue.serverTimestamp(),
    schemaVersion: 1,
  };
}

export function newFinancialAuditRef() {
  return adminDb.collection('FinancialAuditLogs').doc();
}

