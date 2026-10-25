'use client';

import { useEffect, useMemo, useState } from 'react';
import { authenticatedJson, createFinancialRequestId } from '@/lib/payroll/client';
import {
  LocalProposalDraft,
  ProposalDraftQueue,
  proposalDraftStorageKey,
  readProposalDrafts,
  type ProposalDraftStatus,
} from '@/lib/payroll/proposalDrafts';
import type {
  ProposalAction,
  ProposalStage,
  ProposalWriteResult,
} from '@/lib/payroll/proposalLifecycle';

interface Actor {
  uid: string;
  displayName?: string;
}
interface ProposalRecord {
  id: string;
  revision?: number;
  status?: string;
  submittedBy?: string;
  submittedByName?: string;
  proposalQueueNumber?: number;
}

interface ControllerCallbacks {
  drafts: (value: LocalProposalDraft[]) => void;
  status: (value: ProposalDraftStatus) => void;
  error: (value: string) => void;
}

function createProposalDraftController(
  uid: string,
  actorName: string,
  period: string,
  callbacks: ControllerCallbacks,
) {
  let storage: Storage | undefined;
  try {
    if (typeof window !== 'undefined') storage = window.localStorage;
  } catch {
    /* Remote saving remains available. */
  }
  const cached = new Map(
    readProposalDrafts(storage, uid, period).map((draft) => [draft.id, draft]),
  );
  const sessions = new Map<string, ProposalDraftQueue>();
  const records = new Map<string, ProposalRecord>();
  const statuses = new Map<string, { status: ProposalDraftStatus; error?: unknown }>();
  let activeId: string | null = null;
  let mounted = false;
  let storageWarning = '';
  const reportStatus = () => {
    if (!mounted) return;
    const all = [...statuses.values()];
    const failure = all.find((item) => item.status === 'error');
    callbacks.status(
      failure
        ? 'error'
        : all.some((item) => item.status === 'saving')
          ? 'saving'
          : all.length
            ? 'saved'
            : 'idle',
    );
    callbacks.error(failure?.error instanceof Error ? failure.error.message : storageWarning);
  };

  const publish = (id: string, value?: LocalProposalDraft, savedRequestId?: string) => {
    try {
      if (storage) {
        // A request started on the previous page may finish after remount.
        // Change only its own draft and never erase newer local input.
        const latest = new Map(
          readProposalDrafts(storage, uid, period).map((draft) => [draft.id, draft]),
        );
        if (value) {
          if (!latest.has(id) || (latest.get(id)?.localRevision || 0) <= value.localRevision)
            latest.set(id, value);
        } else if (!savedRequestId || latest.get(id)?.requestId === savedRequestId)
          latest.delete(id);
        storage.setItem(proposalDraftStorageKey(uid, period), JSON.stringify([...latest.values()]));
        cached.clear();
        for (const [key, draft] of latest) cached.set(key, draft);
      }
    } catch {
      storageWarning =
        'Penyimpanan draft di perangkat tidak tersedia. Pastikan draft tersimpan sebelum meninggalkan halaman.';
      reportStatus();
    }
    if (mounted) callbacks.drafts([...cached.values()]);
    return !value || cached.get(id)?.requestId === value.requestId;
  };
  const session = (id: string) => {
    let queue = sessions.get(id);
    if (queue) return queue;
    const record = records.get(id);
    const local = cached.get(id);
    queue = new ProposalDraftQueue(
      {
        proposalId: id,
        revision: local?.revision ?? record?.revision ?? 0,
        status: local?.status || record?.status || 'proposal_draft',
      },
      async (draft, action, options) => {
        const body = JSON.stringify({
          actorUid: uid,
          proposalId: draft.id,
          period,
          expectedRevision: draft.revision,
          requestId: draft.requestId,
          predecessorRequestIds: draft.predecessorRequestIds,
          action,
          stage: draft.stage,
          data: draft.data,
          ...options,
        });
        return authenticatedJson<ProposalWriteResult>('/api/payroll/proposal-kegiatan', {
          method: 'POST',
          keepalive: new TextEncoder().encode(body).byteLength < 60_000,
          body,
        });
      },
      (draft) => {
        cached.set(id, draft);
        return publish(id, draft);
      },
      (draft, result) => {
        const current = cached.get(id);
        if (current?.requestId === draft.requestId) cached.delete(id);
        else if (current)
          cached.set(id, { ...current, revision: result.revision, status: result.status });
        records.set(id, { ...records.get(id), id, ...result });
        publish(
          id,
          current && current.requestId !== draft.requestId ? cached.get(id) : undefined,
          draft.requestId,
        );
      },
      (nextStatus, failure) => {
        statuses.set(id, { status: nextStatus, error: failure });
        reportStatus();
      },
    );
    sessions.set(id, queue);
    return queue;
  };
  const ensureId = (selectedId?: string | null) => {
    if (selectedId) activeId = selectedId;
    if (!activeId) activeId = `${period}_${createFinancialRequestId('prop')}`;
    return activeId;
  };
  const snapshot = (
    id: string,
    data: Record<string, unknown>,
    stage: ProposalStage,
  ): LocalProposalDraft => {
    const record = records.get(id);
    const version = session(id).currentVersion;
    const previous =
      readProposalDrafts(storage, uid, period).find((draft) => draft.id === id) || cached.get(id);
    return {
      id,
      period,
      actorUid: uid,
      ownerUid: record?.submittedBy || uid,
      ownerName: record?.submittedByName || actorName,
      ...version,
      stage,
      data,
      localRevision: (previous?.localRevision || 0) + 1,
      predecessorRequestIds: [
        ...(previous?.predecessorRequestIds || []),
        ...(previous ? [previous.requestId] : []),
      ].slice(-100),
      requestId: createFinancialRequestId('proposal'),
      updatedAt: Date.now(),
    };
  };
  const flush = () => {
    for (const queue of sessions.values()) void queue.flush();
  };
  const remove = (id: string) => {
    sessions.get(id)?.discard();
    sessions.delete(id);
    statuses.delete(id);
    cached.delete(id);
    records.delete(id);
    if (activeId === id) activeId = null;
    publish(id);
    reportStatus();
  };

  return {
    mount() {
      mounted = true;
      callbacks.drafts([...cached.values()]);
      callbacks.status(cached.size ? 'saving' : 'idle');
      callbacks.error('');
      for (const draft of [...cached.values()]) session(draft.id).update(draft);
      const hidden = () => {
        if (document.visibilityState === 'hidden') flush();
      };
      window.addEventListener('pagehide', flush);
      window.addEventListener('online', flush);
      document.addEventListener('visibilitychange', hidden);
      return () => {
        mounted = false;
        window.removeEventListener('pagehide', flush);
        window.removeEventListener('online', flush);
        document.removeEventListener('visibilitychange', hidden);
        flush();
      };
    },
    ensureId,
    currentId: () => activeId,
    select(record: ProposalRecord) {
      records.set(record.id, record);
      activeId = record.id;
      session(record.id).observe({
        proposalId: record.id,
        revision: Number(record.revision || 0),
        status: record.status || 'proposal_draft',
      });
    },
    observe(remote: ProposalRecord[]) {
      for (const record of remote) {
        records.set(record.id, record);
        sessions.get(record.id)?.observe({
          proposalId: record.id,
          revision: Number(record.revision || 0),
          status: record.status || 'proposal_draft',
        });
      }
    },
    newDraft() {
      flush();
      activeId = null;
    },
    capture(selectedId: string | null, data: Record<string, unknown>, stage: ProposalStage) {
      const id = ensureId(selectedId);
      session(id).update(snapshot(id, data, stage));
      return id;
    },
    save(
      action: ProposalAction,
      selectedId: string | null,
      data: Record<string, unknown>,
      stage: ProposalStage,
      options?: Record<string, unknown>,
    ) {
      const id = ensureId(selectedId);
      return session(id).perform(snapshot(id, data, stage), action, options);
    },
    async flush(id: string) {
      const queue = session(id);
      if (!(await queue.flush())) throw queue.lastError || new Error('Draft belum tersimpan.');
      return queue.currentVersion;
    },
    async delete(id: string, deleteRemote: () => Promise<void>) {
      const queue = session(id);
      await queue.prepareDeletion();
      try {
        await deleteRemote();
        remove(id);
      } catch (error) {
        // Keep recoverable input until the server confirms the deletion.
        queue.cancelDeletion(error);
        throw error;
      }
    },
    async recoverAndReload(record: ProposalRecord) {
      const local = cached.get(record.id);
      if (local) {
        sessions.get(record.id)?.discard();
        if (sessions.get(record.id)) await sessions.get(record.id)!.flush();
        const newId = `${period}_${createFinancialRequestId('prop')}`;
        const copy = snapshot(
          newId,
          { ...local.data, reportName: `${local.data.reportName || 'Kegiatan'} (Salinan draft)` },
          'proposal',
        );
        session(newId).update(copy);
        sessions.delete(record.id);
        statuses.delete(record.id);
        cached.delete(record.id);
        publish(record.id);
      }
      records.set(record.id, record);
      activeId = record.id;
      session(record.id).observe({
        proposalId: record.id,
        revision: record.revision || 0,
        status: record.status || 'proposal_draft',
      });
      reportStatus();
    },
    retry: flush,
  };
}

export function useProposalDrafts(actor: Actor | null, period: string) {
  const [drafts, setDrafts] = useState<LocalProposalDraft[]>([]);
  const [status, setStatus] = useState<ProposalDraftStatus>('idle');
  const [error, setError] = useState('');
  const uid = actor?.uid || '';
  const actorName = actor?.displayName || '';
  const controller = useMemo(
    () =>
      createProposalDraftController(uid, actorName, period, {
        drafts: setDrafts,
        status: setStatus,
        error: setError,
      }),
    [uid, actorName, period],
  );

  useEffect(() => {
    if (uid) return controller.mount();
  }, [controller, uid]);

  return {
    controller,
    drafts: uid ? drafts : [],
    status: uid ? status : ('idle' as const),
    error: uid ? error : '',
  };
}
