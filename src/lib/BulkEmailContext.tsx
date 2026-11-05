"use client";

import React, { createContext, useContext, useState, useEffect, useRef, useCallback } from 'react';
import { generatePaySlipPdf, type PaySlipData } from '@/utils/generatePaySlipPdf';
import { ApiError, authenticatedJson, createFinancialRequestId } from '@/lib/payroll/client';
import { auth } from '@/lib/firebase';
import {
  BULK_EMAIL_STORAGE_KEY,
  restoreBulkEmailJob,
  serializeBulkEmailJob,
  type RestoredBulkEmailJob,
} from '@/lib/payroll/bulkEmailStorage';

/** Per-item attempts before an item is parked as failed (retryable errors only). */
const MAX_ATTEMPTS = 3;
/** A single send may never hang the whole queue. */
const REQUEST_TIMEOUT_MS = 90_000;
/** Breathing room for the SMTP relay between two sends. */
const DELAY_BETWEEN_SENDS_MS = 1_200;
/** Consecutive failures that mean "something systemic is broken" — auto-pause. */
const CONSECUTIVE_FAILURE_LIMIT = 5;
/** Rough per-item cost used for the ETA before we have live measurements. */
export const ESTIMATED_SECONDS_PER_EMAIL = 2.5;

export type QueueItemStatus = 'pending' | 'sending' | 'success' | 'failed';

export interface QueueItem {
  employeeId: string;
  employeeName: string;
  email: string;
  slipData: PaySlipData;
  status: QueueItemStatus;
  error?: string;
  requestId?: string;
  attempts?: number;
  /** The server skipped it because the slip had already been emailed. */
  alreadySent?: boolean;
}

export interface EmailDetailPeriod {
  /** YYYY_MM. */
  dbPeriod: string;
  /** For display, e.g. "Oktober 2026". */
  label: string;
}

export interface StartBulkEmailOptions {
  /** Called once per employee whose slip really left the server. */
  onSent?: (employeeId: string) => void;
}

interface BulkEmailContextType {
  sendingBulkEmail: boolean;
  /** True while a job exists and is not finished — sending *or* paused. */
  isBulkEmailActive: boolean;
  bulkEmailProgress: number;
  emailTargetCount: number;
  currentBulkEmailName: string;
  currentBulkEmailAddress: string;
  bulkEmailResults: QueueItem[];
  successCount: number;
  failedCount: number;
  remainingCount: number;
  /** Seconds left, or null when it cannot be estimated yet. */
  etaSeconds: number | null;
  /** Set when the queue auto-paused after repeated failures. */
  fatalError: string | null;
  showBulkSnackbar: boolean;
  setShowBulkSnackbar: (show: boolean) => void;
  showBulkDetailModal: boolean;
  setShowBulkDetailModal: (show: boolean) => void;
  /**
   * The period the detail modal shows the history of; null means the running
   * job's period.
   */
  detailPeriod: EmailDetailPeriod | null;
  /** Opens "Detail Pengiriman Email" for a period, with or without a job. */
  openEmailHistory: (period: EmailDetailPeriod) => void;
  closeEmailDetail: () => void;
  bulkEmailDone: boolean;
  isBulkEmailPaused: boolean;
  startBulkEmailJob: (
    queue: QueueItem[],
    period: string,
    dbPeriod: string,
    options?: StartBulkEmailOptions,
  ) => void;
  pauseBulkEmailJob: () => void;
  resumeBulkEmailJob: () => void;
  retryFailedEmails: () => void;
  /** Stops the run and marks whatever is still pending as skipped. */
  cancelBulkEmailJob: () => void;
  dismissJob: () => void;
  period: string;
  dbPeriod: string;
}

const BulkEmailContext = createContext<BulkEmailContextType | null>(null);

function describeError(error: unknown): string {
  if (error instanceof ApiError) return error.message;
  if (error instanceof DOMException && error.name === 'AbortError') {
    return 'Waktu tunggu server habis (timeout).';
  }
  if (error instanceof TypeError) return 'Koneksi jaringan terputus.';
  if (error instanceof Error && error.message) return error.message;
  return 'Gagal mengirim.';
}

/**
 * Only errors that a later attempt could plausibly survive. A 400/403/404/409
 * ("slip belum terkunci", "email karyawan kosong") will fail identically
 * forever, so retrying them only burns the operator's time.
 */
function isRetryable(error: unknown): boolean {
  if (error instanceof ApiError) {
    if (error.status === 429) return true;
    // 409 from the idempotency guard means the very same requestId is still
    // in flight server-side; waiting and re-asking resolves it.
    if (error.status === 409 && /sedang diproses/i.test(error.message)) return true;
    return error.status >= 500;
  }
  // Network drop or our own timeout.
  return true;
}

/** The run saved before a reload, if it belongs to the signed-in user. */
function readStoredJob(): RestoredBulkEmailJob<QueueItem> | null {
  if (typeof window === 'undefined') return null;
  try {
    return restoreBulkEmailJob<QueueItem>(
      window.sessionStorage.getItem(BULK_EMAIL_STORAGE_KEY),
      auth.currentUser?.uid || '',
      Date.now(),
    );
  } catch {
    return null;
  }
}

export function BulkEmailProvider({ children }: { children: React.ReactNode }) {
  // The provider mounts only after sign-in (inside ProtectedRoute), so the
  // saved run can be matched to the user on the first render.
  const [initialJob] = useState(readStoredJob);
  const [period, setPeriod] = useState(initialJob?.period ?? '');
  const [dbPeriod, setDbPeriod] = useState(initialJob?.dbPeriod ?? '');
  const [queue, setQueue] = useState<QueueItem[]>(initialJob?.queue ?? []);
  const [jobStatus, setJobStatus] = useState<'idle' | 'sending' | 'paused' | 'done'>(
    initialJob?.status ?? 'idle',
  );
  const [fatalError, setFatalError] = useState<string | null>(null);
  /** Rolling average of a real send, used for the live ETA. */
  const [averageSendMs, setAverageSendMs] = useState(ESTIMATED_SECONDS_PER_EMAIL * 1000);

  const [currentBulkEmailName, setCurrentBulkEmailName] = useState('');
  const [currentBulkEmailAddress, setCurrentBulkEmailAddress] = useState('');

  const [showBulkSnackbar, setShowBulkSnackbar] = useState(Boolean(initialJob));
  const [showBulkDetailModal, setShowBulkDetailModal] = useState(false);
  const [detailPeriod, setDetailPeriod] = useState<EmailDetailPeriod | null>(null);

  const pausedRef = useRef(initialJob?.status === 'paused');
  const activeLoopRef = useRef(false);
  /**
   * Bumped by every start/cancel/dismiss. The running loop compares it against
   * the generation it was launched with and bails out at each await boundary,
   * so a dismissed job can never keep mailing people in the background.
   */
  const generationRef = useRef(0);
  const abortRef = useRef<AbortController | null>(null);
  const queueRef = useRef<QueueItem[]>(initialJob?.queue ?? []);
  const dbPeriodRef = useRef(initialJob?.dbPeriod ?? '');
  const onSentRef = useRef<((employeeId: string) => void) | undefined>(undefined);
  const durationsRef = useRef<number[]>([]);
  // Re-arms the launcher effect when a loop exits without a state change.
  const [loopTick, setLoopTick] = useState(0);

  const writeQueue = useCallback((next: QueueItem[]) => {
    queueRef.current = next;
    setQueue(next);
  }, []);

  const patchItem = useCallback((index: number, patch: Partial<QueueItem>) => {
    const next = queueRef.current.map((item, idx) => (idx === index ? { ...item, ...patch } : item));
    queueRef.current = next;
    setQueue(next);
  }, []);

  /** Sleep that wakes early when the job is cancelled or restarted. */
  const interruptibleSleep = useCallback(async (ms: number, generation: number) => {
    const deadline = Date.now() + ms;
    while (Date.now() < deadline) {
      if (generation !== generationRef.current) return;
      await new Promise((resolve) => setTimeout(resolve, Math.min(120, deadline - Date.now())));
    }
  }, []);

  const sendOne = useCallback(
    async (
      item: QueueItem,
      index: number,
      generation: number,
    ): Promise<{ ok: boolean; alreadySent?: boolean; error?: string }> => {
      let lastError = 'Gagal mengirim.';

      for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
        if (generation !== generationRef.current) return { ok: false, error: 'Dibatalkan.' };
        patchItem(index, { attempts: attempt });

        const controller = new AbortController();
        abortRef.current = controller;
        const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

        try {
          // Regenerate per attempt: jsPDF documents are single-use.
          const pdfDoc = generatePaySlipPdf(item.slipData, false);
          const pdfBase64 = pdfDoc.output('datauristring').split(',')[1];
          if (!pdfBase64) throw new Error('Gagal membuat lampiran PDF slip.');

          const response = await authenticatedJson<{ alreadySent?: boolean }>('/api/payroll/send-email', {
            method: 'POST',
            signal: controller.signal,
            body: JSON.stringify({
              employeeId: item.employeeId,
              dbPeriod: dbPeriodRef.current,
              // Stable across attempts: the server dedupes on it, so a retry
              // after a client timeout can never send a second email.
              requestId: item.requestId,
              // A slip the server already marked as emailed is skipped, so a
              // run resumed after a crash or reload never mails anyone twice.
              skipIfSent: true,
              pdfBase64,
            }),
          });
          return { ok: true, alreadySent: response.alreadySent === true };
        } catch (err: unknown) {
          if (generation !== generationRef.current) return { ok: false, error: 'Dibatalkan.' };
          lastError = describeError(err);
          console.error(`Bulk email gagal untuk ${item.employeeName} (percobaan ${attempt}):`, err);
          if (attempt === MAX_ATTEMPTS || !isRetryable(err)) break;
          // 1.5s, 4.5s — enough for a relay hiccup or an in-flight duplicate.
          await interruptibleSleep(1_500 * 3 ** (attempt - 1), generation);
        } finally {
          clearTimeout(timer);
          if (abortRef.current === controller) abortRef.current = null;
        }
      }

      return { ok: false, error: lastError };
    },
    [interruptibleSleep, patchItem],
  );

  const runSendingLoop = useCallback(
    async (generation: number) => {
      if (activeLoopRef.current) return;
      activeLoopRef.current = true;
      let consecutiveFailures = 0;

      try {
        while (true) {
          if (generation !== generationRef.current) return;

          while (pausedRef.current) {
            await new Promise((resolve) => setTimeout(resolve, 150));
            if (generation !== generationRef.current) return;
          }

          const index = queueRef.current.findIndex((entry) => entry.status === 'pending');
          if (index === -1) break;

          const item = queueRef.current[index];
          setCurrentBulkEmailName(item.employeeName);
          setCurrentBulkEmailAddress(item.email);
          patchItem(index, { status: 'sending' });

          const startedAt = Date.now();
          const result = await sendOne(item, index, generation);
          if (generation !== generationRef.current) return;

          durationsRef.current.push(Date.now() - startedAt);
          if (durationsRef.current.length > 10) durationsRef.current.shift();
          setAverageSendMs(
            durationsRef.current.reduce((sum, value) => sum + value, 0) / durationsRef.current.length,
          );

          if (result.ok) {
            patchItem(index, { status: 'success', error: undefined, alreadySent: result.alreadySent });
            consecutiveFailures = 0;
            try {
              onSentRef.current?.(item.employeeId);
            } catch (callbackErr) {
              console.error('Bulk email onSent callback error:', callbackErr);
            }
          } else {
            patchItem(index, { status: 'failed', error: result.error });
            consecutiveFailures += 1;
          }

          const stillPending = queueRef.current.some((entry) => entry.status === 'pending');
          if (!stillPending) break;

          if (consecutiveFailures >= CONSECUTIVE_FAILURE_LIMIT) {
            // Don't grind through 170 more guaranteed failures — stop and let
            // the operator fix the root cause, then resume.
            pausedRef.current = true;
            setJobStatus('paused');
            setFatalError(
              `${consecutiveFailures} pengiriman gagal berturut-turut (${result.error}). Pengiriman dijeda otomatis — periksa koneksi atau konfigurasi email server, lalu lanjutkan.`,
            );
            consecutiveFailures = 0;
            continue;
          }

          await interruptibleSleep(DELAY_BETWEEN_SENDS_MS, generation);
        }

        if (generation !== generationRef.current) return;
        setJobStatus('done');
        setCurrentBulkEmailName('');
        setCurrentBulkEmailAddress('');
      } finally {
        activeLoopRef.current = false;
        setLoopTick((tick) => tick + 1);
      }
    },
    [interruptibleSleep, patchItem, sendOne],
  );

  // Single launcher: only ever one loop, and it re-arms whenever the queue,
  // the status, or a just-exited loop says there may be work left.
  useEffect(() => {
    if (jobStatus === 'sending' && !activeLoopRef.current) {
      void runSendingLoop(generationRef.current);
    }
  }, [jobStatus, queue, loopTick, runSendingLoop]);

  // A reload mid-run drops the remaining slips silently — warn first.
  useEffect(() => {
    if (jobStatus !== 'sending' && jobStatus !== 'paused') return;
    const handler = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [jobStatus]);

  // Save the run so a reload picks it up again (see bulkEmailStorage.ts).
  useEffect(() => {
    try {
      const uid = auth.currentUser?.uid;
      if (jobStatus === 'idle' || queue.length === 0 || !uid) {
        window.sessionStorage.removeItem(BULK_EMAIL_STORAGE_KEY);
        return;
      }
      window.sessionStorage.setItem(
        BULK_EMAIL_STORAGE_KEY,
        serializeBulkEmailJob({ uid, period, dbPeriod, status: jobStatus, savedAt: Date.now(), queue }),
      );
    } catch (storageError) {
      // Storage full or blocked: the run still works, it just won't survive a reload.
      console.warn('Antrean email tidak dapat disimpan untuk dimuat ulang:', storageError);
    }
  }, [jobStatus, queue, period, dbPeriod]);

  const openEmailHistory = useCallback((target: EmailDetailPeriod) => {
    setDetailPeriod(target);
    setShowBulkDetailModal(true);
  }, []);

  const closeEmailDetail = useCallback(() => {
    setShowBulkDetailModal(false);
    setDetailPeriod(null);
  }, []);

  const startBulkEmailJob = useCallback(
    (newQueue: QueueItem[], jobPeriod: string, jobDbPeriod: string, options?: StartBulkEmailOptions) => {
      // Orphan any loop still running from a previous job before replacing state.
      generationRef.current += 1;
      abortRef.current?.abort();
      abortRef.current = null;
      pausedRef.current = false;
      durationsRef.current = [];
      onSentRef.current = options?.onSent;
      dbPeriodRef.current = jobDbPeriod;

      setPeriod(jobPeriod);
      setDbPeriod(jobDbPeriod);
      setFatalError(null);
      setAverageSendMs(ESTIMATED_SECONDS_PER_EMAIL * 1000);
      setCurrentBulkEmailName('');
      setCurrentBulkEmailAddress('');
      writeQueue(
        newQueue.map((item) => ({
          ...item,
          status: 'pending' as const,
          error: undefined,
          attempts: 0,
          alreadySent: undefined,
          requestId: item.requestId || createFinancialRequestId('bulk_email'),
        })),
      );
      setJobStatus('sending');
      setShowBulkSnackbar(true);
      setShowBulkDetailModal(false);
      setDetailPeriod(null);
    },
    [writeQueue],
  );

  const pauseBulkEmailJob = useCallback(() => {
    pausedRef.current = true;
    setJobStatus('paused');
  }, []);

  const resumeBulkEmailJob = useCallback(() => {
    pausedRef.current = false;
    setFatalError(null);
    setJobStatus('sending');
  }, []);

  const retryFailedEmails = useCallback(() => {
    const next = queueRef.current.map((item) =>
      item.status === 'failed'
        ? { ...item, status: 'pending' as const, error: undefined, attempts: 0 }
        : item,
    );
    if (!next.some((item) => item.status === 'pending')) return;
    pausedRef.current = false;
    setFatalError(null);
    writeQueue(next);
    setJobStatus('sending');
    setShowBulkSnackbar(true);
  }, [writeQueue]);

  const cancelBulkEmailJob = useCallback(() => {
    // Kill the loop, abort the in-flight request, and park the rest as failed
    // so the summary honestly reports what never went out.
    generationRef.current += 1;
    abortRef.current?.abort();
    abortRef.current = null;
    pausedRef.current = false;

    const next = queueRef.current.map((item) =>
      item.status === 'pending' || item.status === 'sending'
        ? { ...item, status: 'failed' as const, error: 'Dibatalkan oleh pengguna.' }
        : item,
    );
    writeQueue(next);
    setJobStatus('done');
    setFatalError(null);
    setCurrentBulkEmailName('');
    setCurrentBulkEmailAddress('');
  }, [writeQueue]);

  const dismissJob = useCallback(() => {
    generationRef.current += 1;
    abortRef.current?.abort();
    abortRef.current = null;
    pausedRef.current = false;
    onSentRef.current = undefined;
    durationsRef.current = [];
    dbPeriodRef.current = '';

    writeQueue([]);
    setPeriod('');
    setDbPeriod('');
    setJobStatus('idle');
    setFatalError(null);
    setAverageSendMs(ESTIMATED_SECONDS_PER_EMAIL * 1000);
    setCurrentBulkEmailName('');
    setCurrentBulkEmailAddress('');
    setShowBulkSnackbar(false);
    setShowBulkDetailModal(false);
    setDetailPeriod(null);
  }, [writeQueue]);

  const successCount = queue.filter((entry) => entry.status === 'success').length;
  const failedCount = queue.filter((entry) => entry.status === 'failed').length;
  const remainingCount = queue.filter(
    (entry) => entry.status === 'pending' || entry.status === 'sending',
  ).length;
  const bulkEmailProgress = successCount + failedCount;
  const emailTargetCount = queue.length;
  const sendingBulkEmail = jobStatus === 'sending';
  const bulkEmailDone = jobStatus === 'done';
  const isBulkEmailPaused = jobStatus === 'paused';
  const isBulkEmailActive = jobStatus === 'sending' || jobStatus === 'paused';
  const etaSeconds = isBulkEmailActive && remainingCount > 0
    ? Math.round((remainingCount * (averageSendMs + DELAY_BETWEEN_SENDS_MS)) / 1000)
    : null;

  return (
    <BulkEmailContext.Provider
      value={{
        sendingBulkEmail,
        isBulkEmailActive,
        bulkEmailProgress,
        emailTargetCount,
        currentBulkEmailName,
        currentBulkEmailAddress,
        bulkEmailResults: queue,
        successCount,
        failedCount,
        remainingCount,
        etaSeconds,
        fatalError,
        showBulkSnackbar,
        setShowBulkSnackbar,
        showBulkDetailModal,
        setShowBulkDetailModal,
        detailPeriod,
        openEmailHistory,
        closeEmailDetail,
        bulkEmailDone,
        isBulkEmailPaused,
        startBulkEmailJob,
        pauseBulkEmailJob,
        resumeBulkEmailJob,
        retryFailedEmails,
        cancelBulkEmailJob,
        dismissJob,
        period,
        dbPeriod,
      }}
    >
      {children}
    </BulkEmailContext.Provider>
  );
}

export function useBulkEmail() {
  const ctx = useContext(BulkEmailContext);
  if (!ctx) {
    throw new Error('useBulkEmail must be used within a BulkEmailProvider');
  }
  return ctx;
}
