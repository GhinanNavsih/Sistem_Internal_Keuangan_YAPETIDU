"use client";

import { useCallback, useEffect, useRef, useState } from 'react';
import { ApiError, authenticatedJson } from '@/lib/payroll/client';
import {
  driverJourneyReportDraftPayload,
  JourneyReportDraftSaveQueue,
  type DriverJourneyReportDraftState,
  type JourneyReportDraftSaveStatus,
} from '@/lib/payroll/driverJourneyReportDraft';

export function useJourneyReportDraft(
  journeyId: string | null,
  state: DriverJourneyReportDraftState,
) {
  const queueRef = useRef<JourneyReportDraftSaveQueue | null>(null);
  const latestSnapshotRef = useRef<string | null>(null);
  const pausedRef = useRef(false);
  const [status, setStatus] = useState<JourneyReportDraftSaveStatus>('saving');
  const [conflict, setConflict] = useState(false);
  const snapshot = JSON.stringify(state);

  useEffect(() => {
    if (!journeyId) return;
    pausedRef.current = false;
    let disposed = false;
    let retryable = true;
    let saveConflict = false;
    let retryTimer: ReturnType<typeof setTimeout> | undefined;
    const queue = new JourneyReportDraftSaveQueue(
      async (serialized) => {
        try {
          await authenticatedJson('/api/driver-journeys', {
            method: 'POST',
            keepalive: true,
            body: JSON.stringify({
              action: 'save_draft',
              journeyId,
              draft: driverJourneyReportDraftPayload(JSON.parse(serialized)),
            }),
          });
          saveConflict = false;
        } catch (error) {
          saveConflict = error instanceof ApiError && error.status === 409 &&
            error.message.startsWith('Draft perjalanan sudah diperbarui');
          retryable = !(error instanceof ApiError) || error.status === 408 ||
            error.status === 429 || error.status >= 500;
          throw error;
        }
      },
      (nextStatus) => {
        if (disposed) return;
        setStatus(nextStatus);
        setConflict(nextStatus === 'error' && saveConflict);
        clearTimeout(retryTimer);
        if (nextStatus === 'error' && retryable) {
          retryTimer = setTimeout(() => { void queue.flush(); }, 10_000);
        }
      },
    );
    queueRef.current = queue;
    const flush = () => { void queue.flush(); };
    const onVisibilityChange = () => {
      if (document.visibilityState === 'hidden') flush();
    };
    window.addEventListener('online', flush);
    window.addEventListener('pagehide', flush);
    document.addEventListener('visibilitychange', onVisibilityChange);
    return () => {
      disposed = true;
      clearTimeout(retryTimer);
      window.removeEventListener('online', flush);
      window.removeEventListener('pagehide', flush);
      document.removeEventListener('visibilitychange', onVisibilityChange);
      // Already captured changes can finish saving after navigation.
      void queue.flush();
      if (queueRef.current === queue) queueRef.current = null;
    };
  }, [journeyId]);

  useEffect(() => {
    if (!journeyId) return;
    const capturedSnapshot = JSON.stringify({ ...JSON.parse(snapshot), updatedAt: Date.now() });
    latestSnapshotRef.current = capturedSnapshot;
    if (pausedRef.current) return;
    try {
      localStorage.setItem(`journey_draft_${journeyId}`, capturedSnapshot);
    } catch (error) {
      console.error('Failed to save journey draft locally:', error);
    }
    queueRef.current?.update(capturedSnapshot);
  }, [journeyId, snapshot]);

  const flush = useCallback(async () => queueRef.current?.flush() ?? false, []);
  const pause = useCallback(async () => {
    pausedRef.current = true;
    await queueRef.current?.pause();
  }, []);
  const resume = useCallback(() => {
    pausedRef.current = false;
    queueRef.current?.resume();
    if (latestSnapshotRef.current) {
      if (journeyId) {
        try {
          localStorage.setItem(`journey_draft_${journeyId}`, latestSnapshotRef.current);
        } catch (error) {
          console.error('Failed to save journey draft locally:', error);
        }
      }
      queueRef.current?.update(latestSnapshotRef.current);
    }
  }, [journeyId]);

  return { status, conflict, flush, pause, resume };
}
