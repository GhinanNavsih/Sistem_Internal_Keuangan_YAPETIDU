"use client";

import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { authenticatedJson, createFinancialRequestId } from '@/lib/payroll/client';
import {
  runLockJob,
  type LockJobProgress,
  type LockJobTarget,
} from '@/lib/payroll/lockJob';

interface VerifyAndLockReceipt {
  koperasi: { loans: Array<{ outcome: string }> };
}

export interface PayrollLockJob {
  status: 'running' | 'done';
  /** The period being locked, as YYYY-MM. */
  periodToken: string;
  /** For display, e.g. "Oktober 2026". */
  periodLabel: string;
  progress: LockJobProgress;
  /** The person asked to stop; the run ends after the slip in hand. */
  stopRequested: boolean;
  /** Done only: the run ended early, leaving `skipped` slips as draft. */
  stopped: boolean;
  skipped: number;
  /** Done only: the roster could not be sealed, so nothing was locked. */
  fatalError: string | null;
}

export interface StartPayrollLockOptions {
  periodToken: string;
  periodLabel: string;
  targets: LockJobTarget[];
}

interface PayrollLockJobContextType {
  job: PayrollLockJob | null;
  isPayrollLockRunning: boolean;
  /** False when another run is already going. */
  startPayrollLockJob: (options: StartPayrollLockOptions) => boolean;
  stopPayrollLockJob: () => void;
  dismissPayrollLockJob: () => void;
}

const PayrollLockJobContext = createContext<PayrollLockJobContextType | null>(null);

/**
 * Owns the "Verifikasi & Kunci Semua" run for the whole dashboard. The run lives
 * here rather than in the payroll page, so moving to another page does not
 * interrupt it; a reload or closing the tab still does.
 */
export function PayrollLockJobProvider({ children }: { children: React.ReactNode }) {
  const [job, setJob] = useState<PayrollLockJob | null>(null);
  const runningRef = useRef(false);
  const stopRef = useRef(false);

  const startPayrollLockJob = useCallback((options: StartPayrollLockOptions): boolean => {
    if (runningRef.current) return false;
    runningRef.current = true;
    stopRef.current = false;
    const { periodToken, periodLabel, targets } = options;
    const slipPeriod = periodToken.replace('-', '_');

    setJob({
      status: 'running',
      periodToken,
      periodLabel,
      progress: {
        phase: 'sealing',
        completed: 0,
        total: targets.length + 1,
        currentName: '',
        lockedIds: [],
        failures: [],
        advancedLoans: 0,
        paidOffLoans: 0,
      },
      stopRequested: false,
      stopped: false,
      skipped: 0,
      fatalError: null,
    });

    void runLockJob({
      targets,
      // Sealing is idempotent: an already sealed period answers with success.
      seal: async () => {
        await authenticatedJson('/api/payroll/periods', {
          method: 'POST',
          body: JSON.stringify({
            period: periodToken,
            attendanceStatus: 'closed',
            reason: 'Penyegelan roster lengkap sebelum Verifikasi & Kunci massal',
          }),
        });
      },
      // Koperasi installments are applied one employee at a time: each is a
      // resumable saga, and a failure must leave only that slip as draft.
      lockOne: async (target) => {
        const receipt = await authenticatedJson<VerifyAndLockReceipt>('/api/payroll/slips', {
          method: 'POST',
          body: JSON.stringify({
            action: 'verify_and_lock',
            employeeId: target.id,
            period: slipPeriod,
            requestId: createFinancialRequestId('bulk_verify_lock'),
            reason: 'Verifikasi angka dan penguncian final seluruh roster oleh Badan Keuangan',
          }),
        });
        const loans = receipt.koperasi?.loans ?? [];
        return {
          advancedLoans: loans.filter((loan) => loan.outcome !== 'already_applied').length,
          paidOffLoans: loans.filter((loan) => loan.outcome === 'paid_off').length,
        };
      },
      shouldStop: () => stopRef.current,
      onProgress: (progress) =>
        setJob((current) => (current ? { ...current, progress } : current)),
    })
      .then((result) => {
        setJob((current) =>
          current
            ? {
                ...current,
                status: 'done',
                progress: result,
                stopped: result.stopped,
                skipped: result.skipped,
                fatalError: result.fatalError,
              }
            : current,
        );
      })
      .catch((error: unknown) => {
        // runLockJob reports step failures itself; this is an unexpected throw.
        console.error('Verifikasi & Kunci massal terhenti:', error);
        setJob((current) =>
          current
            ? {
                ...current,
                status: 'done',
                fatalError: error instanceof Error ? error.message : 'Terjadi kesalahan sistem',
              }
            : current,
        );
      })
      .finally(() => {
        runningRef.current = false;
      });
    return true;
  }, []);

  const stopPayrollLockJob = useCallback(() => {
    if (!runningRef.current) return;
    stopRef.current = true;
    setJob((current) => (current ? { ...current, stopRequested: true } : current));
  }, []);

  const dismissPayrollLockJob = useCallback(() => {
    if (runningRef.current) return;
    setJob(null);
  }, []);

  // A reload or closed tab ends the run partway: warn first.
  const isPayrollLockRunning = job?.status === 'running';
  useEffect(() => {
    if (!isPayrollLockRunning) return;
    const handler = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [isPayrollLockRunning]);

  return (
    <PayrollLockJobContext.Provider
      value={{
        job,
        isPayrollLockRunning,
        startPayrollLockJob,
        stopPayrollLockJob,
        dismissPayrollLockJob,
      }}
    >
      {children}
    </PayrollLockJobContext.Provider>
  );
}

export function usePayrollLockJob(): PayrollLockJobContextType {
  const context = useContext(PayrollLockJobContext);
  if (!context) {
    throw new Error('usePayrollLockJob must be used within PayrollLockJobProvider');
  }
  return context;
}
