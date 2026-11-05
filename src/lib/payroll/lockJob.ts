/**
 * The run behind "Verifikasi & Kunci Semua": seal the roster once, then lock
 * the draft slips one at a time. It is kept free of React and Firebase so it can
 * keep running while the person moves between pages (the caller owns the long
 * lived state) and so its bookkeeping is unit tested.
 *
 * Progress is honest: the seal counts as one step and every slip as one more,
 * and a step only counts once it has finished, successfully or not.
 */

export interface LockJobTarget {
  id: string;
  name: string;
}

export interface LockJobFailure {
  name: string;
  message: string;
}

export interface LockJobProgress {
  phase: 'sealing' | 'locking';
  /** Steps finished: the seal, then each slip that was tried. */
  completed: number;
  /** One seal step plus one step per slip. */
  total: number;
  /** The slip being locked right now; empty between steps. */
  currentName: string;
  lockedIds: string[];
  failures: LockJobFailure[];
  /** Koperasi installments this run applied (not those already recorded). */
  advancedLoans: number;
  paidOffLoans: number;
}

export interface LockJobResult extends LockJobProgress {
  /** True when the person stopped the run before every slip was tried. */
  stopped: boolean;
  /** Slips left untouched (still draft) because the run was stopped. */
  skipped: number;
  /** Set when the seal failed, so nothing was locked. */
  fatalError: string | null;
}

export interface LockOneOutcome {
  advancedLoans: number;
  paidOffLoans: number;
}

export function lockJobPercent(completed: number, total: number): number {
  if (!Number.isFinite(total) || total <= 0) return 0;
  return Math.max(0, Math.min(100, Math.round((completed / total) * 100)));
}

function describe(error: unknown): string {
  return error instanceof Error && error.message ? error.message : 'Operasi gagal';
}

export async function runLockJob(input: {
  targets: readonly LockJobTarget[];
  /** Seals the roster. Throws when the period cannot be sealed. */
  seal: () => Promise<void>;
  /** Verifies and locks one slip. Throws when that slip stays draft. */
  lockOne: (target: LockJobTarget) => Promise<LockOneOutcome>;
  /** Checked before each slip; true ends the run without locking more. */
  shouldStop: () => boolean;
  onProgress: (progress: LockJobProgress) => void;
}): Promise<LockJobResult> {
  const total = input.targets.length + 1;
  const progress: LockJobProgress = {
    phase: 'sealing',
    completed: 0,
    total,
    currentName: '',
    lockedIds: [],
    failures: [],
    advancedLoans: 0,
    paidOffLoans: 0,
  };
  const publish = () =>
    input.onProgress({
      ...progress,
      lockedIds: [...progress.lockedIds],
      failures: [...progress.failures],
    });

  publish();
  try {
    await input.seal();
  } catch (error) {
    return {
      ...progress,
      stopped: false,
      skipped: input.targets.length,
      fatalError: describe(error),
    };
  }
  progress.phase = 'locking';
  progress.completed = 1;
  publish();

  let tried = 0;
  for (const target of input.targets) {
    if (input.shouldStop()) break;
    progress.currentName = target.name;
    publish();
    try {
      const outcome = await input.lockOne(target);
      progress.lockedIds.push(target.id);
      progress.advancedLoans += outcome.advancedLoans;
      progress.paidOffLoans += outcome.paidOffLoans;
    } catch (error) {
      progress.failures.push({ name: target.name, message: describe(error) });
    }
    tried += 1;
    progress.completed += 1;
    progress.currentName = '';
    publish();
  }

  const skipped = input.targets.length - tried;
  return { ...progress, stopped: skipped > 0, skipped, fatalError: null };
}
