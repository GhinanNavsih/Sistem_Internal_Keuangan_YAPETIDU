"use client";

import React, { createContext, useContext, useState, useEffect, useRef } from 'react';
import { generatePaySlipPdf } from '@/utils/generatePaySlipPdf';
import { authenticatedJson, createFinancialRequestId } from '@/lib/payroll/client';

export interface QueueItem {
  employeeId: string;
  employeeName: string;
  email: string;
  slipData: any;
  status: 'pending' | 'success' | 'failed';
  error?: string;
  requestId?: string;
}

interface BulkEmailContextType {
  sendingBulkEmail: boolean;
  bulkEmailProgress: number;
  emailTargetCount: number;
  currentBulkEmailName: string;
  currentBulkEmailAddress: string;
  bulkEmailResults: QueueItem[];
  showBulkSnackbar: boolean;
  setShowBulkSnackbar: (show: boolean) => void;
  showBulkDetailModal: boolean;
  setShowBulkDetailModal: (show: boolean) => void;
  bulkEmailDone: boolean;
  isBulkEmailPaused: boolean;
  startBulkEmailJob: (queue: QueueItem[], period: string, dbPeriod: string) => void;
  pauseBulkEmailJob: () => void;
  resumeBulkEmailJob: () => void;
  retryFailedEmails: () => void;
  dismissJob: () => void;
  period: string;
  dbPeriod: string;
}

const BulkEmailContext = createContext<BulkEmailContextType | null>(null);

export function BulkEmailProvider({ children }: { children: React.ReactNode }) {
  const [period, setPeriod] = useState('');
  const [dbPeriod, setDbPeriod] = useState('');
  const [queue, setQueue] = useState<QueueItem[]>([]);
  const [jobStatus, setJobStatus] = useState<'idle' | 'sending' | 'paused' | 'done'>('idle');
  
  const [currentBulkEmailName, setCurrentBulkEmailName] = useState('');
  const [currentBulkEmailAddress, setCurrentBulkEmailAddress] = useState('');
  
  const [showBulkSnackbar, setShowBulkSnackbar] = useState(false);
  const [showBulkDetailModal, setShowBulkDetailModal] = useState(false);
  
  const pausedRef = useRef<boolean>(false);
  const activeLoopRef = useRef<boolean>(false);

  // background loop trigger
  useEffect(() => {
    if (jobStatus === 'sending' && !activeLoopRef.current) {
      runSendingLoop();
    }
  }, [jobStatus, queue]);

  const runSendingLoop = async () => {
    if (activeLoopRef.current) return;
    activeLoopRef.current = true;

    // Work on local copies to avoid closure issues
    let currentQueue = [...queue];
    
    // Find the first pending index
    for (let i = 0; i < currentQueue.length; i++) {
      // Re-read queue state in case it updated
      if (currentQueue[i].status !== 'pending') {
        continue;
      }

      // Check if paused
      while (pausedRef.current) {
        await new Promise((resolve) => setTimeout(resolve, 200));
        // If status changed to idle or done, break
        if (jobStatus === 'idle') {
          activeLoopRef.current = false;
          return;
        }
      }

      const item = currentQueue[i];
      setCurrentBulkEmailName(item.employeeName);
      setCurrentBulkEmailAddress(item.email);

      try {
        // Generate PDF base64 dynamically
        const pdfDoc = generatePaySlipPdf(item.slipData, false);
        const pdfBase64 = pdfDoc.output('datauristring').split(',')[1];

        // Format breakdown text from slipData
        const totalEarnings = item.slipData.earnings.reduce((sum: number, e: any) => sum + e.amount, 0);
        const totalDeductions = item.slipData.deductions.reduce((sum: number, d: any) => sum + d.amount, 0);
        const netSalary = totalEarnings - totalDeductions;

        const formatIDR = (amount: number): string => {
          return new Intl.NumberFormat('id-ID', {
            style: 'currency',
            currency: 'IDR',
            minimumFractionDigits: 0,
            maximumFractionDigits: 0,
          }).format(amount);
        };

        let textBreakdown = `PENDAPATAN:\n`;
        item.slipData.earnings.forEach((e: any) => {
          textBreakdown += `• ${e.label}: ${formatIDR(e.amount)}\n`;
        });
        textBreakdown += `Total Pendapatan: ${formatIDR(totalEarnings)}\n\n`;

        textBreakdown += `POTONGAN:\n`;
        if (item.slipData.deductions.length > 0) {
          item.slipData.deductions.forEach((d: any) => {
            textBreakdown += `• ${d.label}: ${formatIDR(d.amount)}\n`;
          });
          textBreakdown += `Total Potongan: ${formatIDR(totalDeductions)}\n\n`;
        } else {
          textBreakdown += `• Tidak ada potongan\n\n`;
        }
        textBreakdown += `GAJI BERSIH (Diterima): ${formatIDR(netSalary)}`;

        // Send API call
        item.requestId = item.requestId || createFinancialRequestId('bulk_email');
        await authenticatedJson('/api/payroll/send-email', {
          method: 'POST',
          body: JSON.stringify({
            employeeId: item.employeeId,
            dbPeriod,
            requestId: item.requestId,
            pdfBase64,
          }),
        });

        // Update the in-memory item. Salary payloads are never persisted in
        // browser storage.
        item.status = 'success';
      } catch (err: any) {
        console.error(`Failed sending bulk email to ${item.employeeName}:`, err);
        item.status = 'failed';
        item.error = err?.message || 'Gagal mengirim';
      }

      // Save progress to local state only.
      const updatedQueue = [...currentQueue];
      updatedQueue[i] = { ...item };
      setQueue(updatedQueue);
      currentQueue = updatedQueue;

      const nextStatus = updatedQueue.every(q => q.status !== 'pending') ? 'done' : (pausedRef.current ? 'paused' : 'sending');
      
      if (nextStatus === 'done') {
        setJobStatus('done');
        setCurrentBulkEmailAddress('');
        setCurrentBulkEmailName('');
        activeLoopRef.current = false;
        return;
      }

      // Add delay between sends if there is another pending item
      const hasMorePending = updatedQueue.some((q, idx) => idx > i && q.status === 'pending');
      if (hasMorePending) {
        await new Promise((resolve) => setTimeout(resolve, 1500));
      }
    }

    activeLoopRef.current = false;
  };

  const startBulkEmailJob = (newQueue: QueueItem[], jobPeriod: string, jobDbPeriod: string) => {
    setPeriod(jobPeriod);
    setDbPeriod(jobDbPeriod);
    setQueue(newQueue);
    setJobStatus('sending');
    pausedRef.current = false;
    setShowBulkSnackbar(true);
    setShowBulkDetailModal(false);

  };

  const pauseBulkEmailJob = () => {
    pausedRef.current = true;
    setJobStatus('paused');
  };

  const resumeBulkEmailJob = () => {
    pausedRef.current = false;
    setJobStatus('sending');
  };

  const retryFailedEmails = () => {
    const updatedQueue = queue.map(item => {
      if (item.status === 'failed') {
        return { ...item, status: 'pending' as const, error: undefined };
      }
      return item;
    });
    setQueue(updatedQueue);
    setJobStatus('sending');
    pausedRef.current = false;
    setShowBulkDetailModal(false);
  };

  const dismissJob = () => {
    setQueue([]);
    setPeriod('');
    setDbPeriod('');
    setJobStatus('idle');
    setShowBulkSnackbar(false);
    setShowBulkDetailModal(false);
    pausedRef.current = false;
  };

  const bulkEmailProgress = queue.filter(q => q.status === 'success' || q.status === 'failed').length;
  const emailTargetCount = queue.length;
  const sendingBulkEmail = jobStatus === 'sending';
  const bulkEmailDone = jobStatus === 'done';
  const isBulkEmailPaused = jobStatus === 'paused';

  return (
    <BulkEmailContext.Provider
      value={{
        sendingBulkEmail,
        bulkEmailProgress,
        emailTargetCount,
        currentBulkEmailName,
        currentBulkEmailAddress,
        bulkEmailResults: queue,
        showBulkSnackbar,
        setShowBulkSnackbar,
        showBulkDetailModal,
        setShowBulkDetailModal,
        bulkEmailDone,
        isBulkEmailPaused,
        startBulkEmailJob,
        pauseBulkEmailJob,
        resumeBulkEmailJob,
        retryFailedEmails,
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
