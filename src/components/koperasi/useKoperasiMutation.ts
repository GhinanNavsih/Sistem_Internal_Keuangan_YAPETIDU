"use client";

import { useRef, useState } from 'react';
import { ApiError, authenticatedJson, createFinancialRequestId } from '@/lib/payroll/client';

/** Keep the same request id when a response is lost; edited payloads get a new id. */
export function useKoperasiMutation() {
  const busy = useRef(false);
  const pending = useRef<{ fingerprint: string; requestId: string } | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [stale, setStale] = useState(false);
  async function submit<T>(url: string, method: string, payload: Record<string, unknown>, onSaved: (result: T) => Promise<void> | void) {
    if (busy.current) return;
    busy.current = true;
    setSaving(true); setError(''); setStale(false);
    const fingerprint = JSON.stringify({ url, method, payload });
    if (pending.current?.fingerprint !== fingerprint) pending.current = { fingerprint, requestId: createFinancialRequestId('koperasi-member') };
    try {
      const result = await authenticatedJson<T>(url, { method, body: JSON.stringify({ ...payload, requestId: pending.current.requestId }) });
      await onSaved(result);
    } catch (error) {
      setError(error instanceof Error ? error.message : 'Perubahan gagal disimpan. Silakan coba lagi.');
      setStale(error instanceof ApiError && error.status === 409);
    } finally { busy.current = false; setSaving(false); }
  }
  return { saving, error, stale, submit };
}
