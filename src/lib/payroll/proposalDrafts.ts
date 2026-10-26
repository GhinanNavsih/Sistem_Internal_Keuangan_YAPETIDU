import type { ProposalAction, ProposalStage, ProposalWriteResult } from './proposalLifecycle';

export interface LocalProposalDraft {
  id: string;
  actorUid: string;
  ownerUid: string;
  ownerName: string;
  period: string;
  revision: number;
  status: string;
  stage: ProposalStage;
  data: Record<string, unknown>;
  requestId: string;
  createdAt?: number;
  updatedAt: number;
  localRevision: number;
  predecessorRequestIds: string[];
}

export const proposalDraftStorageKey = (uid: string, period: string) =>
  `proposal_kegiatan_drafts_v1_${uid}_${period}`;

export function readProposalDrafts(
  storage: Pick<Storage, 'getItem'> | undefined,
  uid: string,
  period: string,
): LocalProposalDraft[] {
  if (!storage || !uid) return [];
  try {
    const values = JSON.parse(storage.getItem(proposalDraftStorageKey(uid, period)) || '[]');
    return Array.isArray(values)
      ? values.filter(
          (draft): draft is LocalProposalDraft =>
            draft &&
            draft.actorUid === uid &&
            draft.period === period &&
            typeof draft.id === 'string' &&
            /^[A-Za-z0-9_-]{1,150}$/.test(draft.id) &&
            typeof draft.requestId === 'string' &&
            draft.data &&
            typeof draft.data === 'object' &&
            Number.isSafeInteger(draft.revision) &&
            draft.revision >= 0,
        )
      : [];
  } catch {
    return [];
  }
}

export type ProposalDraftStatus = 'idle' | 'saving' | 'saved' | 'error';
export type ProposalPersist = (
  draft: LocalProposalDraft,
  action: ProposalAction,
  options?: Record<string, unknown>,
) => Promise<ProposalWriteResult>;

/** Retains the latest input locally, serializes writes, and flushes on navigation. */
export class ProposalDraftQueue {
  private pending: LocalProposalDraft | null = null;
  private running: Promise<boolean> | null = null;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private paused = false;
  private deleting = false;
  private explicitWrite: Promise<ProposalWriteResult> | null = null;
  private failure: unknown = null;
  private version: ProposalWriteResult;

  constructor(
    initial: ProposalWriteResult,
    private readonly persist: ProposalPersist,
    private readonly onLocal: (draft: LocalProposalDraft) => boolean | void,
    private readonly onSaved: (draft: LocalProposalDraft, result: ProposalWriteResult) => void,
    private readonly onStatus: (status: ProposalDraftStatus, error?: unknown) => void,
  ) {
    this.version = initial;
  }

  get currentVersion() {
    return this.version;
  }
  get lastError() {
    return this.failure;
  }
  get busy() {
    return Boolean(this.pending || this.running || this.paused || this.deleting);
  }
  private getPending(): LocalProposalDraft | null {
    return this.pending;
  }

  observe(version: ProposalWriteResult) {
    if (!this.busy && version.revision >= this.version.revision) this.version = version;
  }

  update(draft: LocalProposalDraft) {
    this.pending = { ...draft, revision: this.version.revision, status: this.version.status };
    if (this.onLocal(this.pending) === false) {
      this.pending = null;
      return;
    }
    this.onStatus('saving');
    clearTimeout(this.timer);
    if (!this.deleting) {
      this.timer = setTimeout(() => {
        void this.flush();
      }, 600);
    }
  }

  flush(): Promise<boolean> {
    clearTimeout(this.timer);
    if (this.running) return this.running;
    if (this.paused || this.deleting) return Promise.resolve(false);
    this.running = this.drain().finally(() => {
      this.running = null;
    });
    return this.running;
  }

  private async drain(): Promise<boolean> {
    while (this.pending && !this.paused && !this.deleting) {
      const draft = {
        ...this.pending,
        revision: this.version.revision,
        status: this.version.status,
      };
      this.pending = null;
      try {
        this.version = await this.persist(draft, 'save_draft');
        this.failure = null;
        const newer = this.getPending();
        if (newer) {
          this.pending = { ...newer, revision: this.version.revision, status: this.version.status };
          if (this.onLocal(this.pending) === false) this.pending = null;
        }
        this.onSaved(draft, this.version);
      } catch (error) {
        this.failure = error;
        if (!this.pending) this.pending = draft;
        if (this.onLocal(this.pending) === false) this.pending = null;
        this.onStatus('error', error);
        return false;
      }
    }
    this.onStatus('saved');
    return true;
  }

  async perform(
    draft: LocalProposalDraft,
    action: ProposalAction,
    options: Record<string, unknown> = {},
  ) {
    // Serialize explicit saves and decisions with the same queue as autosave.
    if (this.deleting) throw new Error('Proposal sedang dihapus.');
    if (!(await this.flush())) throw this.failure || new Error('Draft belum tersimpan.');
    if (this.deleting) throw new Error('Proposal sedang dihapus.');
    this.paused = true;
    this.onStatus('saving');
    if (action !== 'review') this.onLocal(draft);
    try {
      this.explicitWrite = this.persist(
        { ...draft, revision: this.version.revision, status: this.version.status },
        action,
        options,
      );
      const result = await this.explicitWrite;
      this.version = result;
      this.onSaved(draft, result);
      this.onStatus('saved');
      return result;
    } catch (error) {
      this.failure = error;
      if (action !== 'review' && !this.pending) {
        this.pending = { ...draft, revision: this.version.revision, status: this.version.status };
        if (this.onLocal(this.pending) === false) this.pending = null;
      }
      this.onStatus('error', error);
      throw error;
    } finally {
      this.explicitWrite = null;
      this.paused = false;
      if (this.pending && !this.deleting) void this.flush();
    }
  }

  /** Stop new writes and let already-started requests settle before deletion. */
  async prepareDeletion() {
    this.deleting = true;
    clearTimeout(this.timer);
    await Promise.allSettled([this.running, this.explicitWrite]);
  }

  cancelDeletion(error: unknown) {
    this.deleting = false;
    this.failure = this.pending ? error : null;
    this.onStatus(this.pending ? 'error' : 'saved', this.failure);
  }

  discard() {
    clearTimeout(this.timer);
    this.pending = null;
  }
}
